import { existsSync } from "@toonflow/file";
import { dirname, resolve } from "node:path";
import { deserialize, serialize } from "node:v8";
import { MessageChannel, receiveMessageOnPort, Worker, type MessagePort } from "node:worker_threads";
import { describeFfmpeg } from "@toonflow/ffmpeg/runtime";
import type { ToolContext, ToolDefinition } from "@toonflow/tools-scaffold/runtime";
import { ToolChannel } from "./toolChannel";
import { getToolRuntimeDirectory } from "./toolProcess";

/** 单插件实例的生命周期；宿主 SDK、工作区文件能力及其事务仍在宿主执行。 */
export async function createIsolatedTool(source: string, workerDirectory = getToolRuntimeDirectory()) {
  const locate = (name: string) => {
    const path = [resolve(workerDirectory, `${name}.ts`), resolve(workerDirectory, `${name}.js`)].find(existsSync);
    if (!path) throw Object.assign(new Error("工具执行工作进程缺失"), { status: 503, code: "TOOL_WORKER_MISSING" });
    return path;
  };
  const worker = locate("toolRuntimeWorker");
  const syncClient = locate("toolSyncClient");
  const allowedEnvironment = new Set(["path", "systemroot", "windir", "temp", "tmp", "tmpdir", "lang", "lc_all"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && allowedEnvironment.has(key.toLowerCase()))) as Record<string, string>;
  const ready = Promise.withResolvers<void>();
  void ready.promise.catch(() => {});
  const activeScopes = new Set(["init"]);
  const renderScope = crypto.randomUUID();
  let renderScopeOpened = false;
  const lifetime = new AbortController();
  const scopeControllers = new Map<string, AbortController>();
  const fileOperations = new Map<string, Set<Promise<unknown>>>();
  const waitForFiles = async (scope?: string) => {
    while (true) {
      const operations = scope ? [...(fileOperations.get(scope) ?? [])] : [...fileOperations.values()].flatMap(values => [...values]);
      if (!operations.length) return;
      await Promise.allSettled(operations);
    }
  };
  let closing: Promise<void> | undefined;
  let channel: ToolChannel;
  let child: Bun.Subprocess<"ignore", "ignore", "ignore">;
  let relay: Worker | undefined;
  let relayPort: MessagePort | undefined;
  let relayWake: Int32Array | undefined;
  let relayReady: ReturnType<typeof Promise.withResolvers<string>> | undefined;
  let syncTarget: string | undefined;
  let syncDeadline: number | undefined;
  const syncReplies = new Map<string, { data?: Uint8Array; error?: string } | undefined>();
  const token = crypto.randomUUID() + crypto.randomUUID();
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0, maxRequestBodySize: 16 * 1024 * 1024,
    async fetch(request) {
      if (closing || request.method !== "POST" || request.headers.get("origin") !== null || request.headers.get("authorization") !== `Bearer ${token}`) return new Response(null, { status: 403 });
      try {
        const message = deserialize(Buffer.from(await request.arrayBuffer()));
        return new Response(serialize(channel.receiveSync(message)), { headers: { "content-type": "application/octet-stream" } });
      } catch { return new Response(null, { status: 400 }); }
    },
  });
  const dispose = (reason = new Error("工具执行工作进程已结束；执行可能已产生副作用，请核对原任务后继续")) => {
    if (closing) return closing;
    const finished = Promise.withResolvers<void>();
    closing = finished.promise;
    void (async () => {
      activeScopes.clear();
      lifetime.abort(reason);
      for (const controller of scopeControllers.values()) controller.abort(reason);
      scopeControllers.clear();
      channel?.abortSignals(reason);
      ready.reject(reason);
      relayReady?.reject(reason);
      // Windows 需在父进程还存活时结束整棵树，涵盖插件内仍在运行的 FFmpeg。
      if (process.platform === "win32" && child && child.exitCode === null && child.signalCode === null) {
        try {
          const stopped = Bun.spawn([resolve(process.env.SystemRoot ?? "C:\\Windows", "System32/taskkill.exe"), "/PID", String(child.pid), "/T", "/F"], {
            stdin: "ignore", stdout: "ignore", stderr: "ignore", windowsHide: true, timeout: 3000,
          });
          await stopped.exited;
        } catch { /* 仍调用 Bun 子进程的终止方法。 */ }
      }
      child?.kill("SIGKILL");
      // 已进入宿主的文件操作必须结束后才释放 SDK 回调，避免过早释放编辑队列。
      await waitForFiles();
      channel?.close(reason);
      await child?.exited;
      await relay?.terminate();
      relayPort?.close();
      await server.stop(true);
    })().then(finished.resolve, finished.reject);
    return closing;
  };
  const receiveRelay = (message: any) => {
    if (message?.type === "ready" && typeof message.url === "string") { relayReady?.resolve(message.url); return; }
    if (message?.type === "reply" && syncReplies.has(message.id)) { syncReplies.set(message.id, message); return; }
    if (message?.type !== "callback" || typeof message.id !== "string" || !(message.data instanceof Uint8Array)) return;
    let reply;
    try { reply = channel.receiveSync(deserialize(Buffer.from(message.data))); }
    catch { reply = { error: channel.encode(new Error("插件同步回调数据无效")) }; }
    relayPort?.postMessage({ type: "callbackReply", id: message.id, data: serialize(reply) });
  };
  const synchronize = (message: Parameters<ToolChannel["receiveSync"]>[0]) => {
    if (!relayPort || !relayWake || !syncTarget) throw Object.assign(new Error("插件同步通道尚未就绪"), { code: "TOOL_SYNC_CALLBACK_UNAVAILABLE" });
    if (syncReplies.size >= 8) throw new Error("插件同步调用嵌套过深");
    const id = crypto.randomUUID();
    const rendering = message.scope === renderScope && !activeScopes.has(renderScope);
    const renderController = rendering ? new AbortController() : undefined;
    if (renderController) { activeScopes.add(renderScope); scopeControllers.set(renderScope, renderController); }
    const deadline = syncDeadline ?? performance.now() + 2000;
    syncDeadline = deadline;
    syncReplies.set(id, undefined);
    try {
      relayPort.postMessage({ type: "request", id, url: syncTarget, data: serialize(message) });
      while (true) {
        const version = Atomics.load(relayWake, 0);
        for (let count = 0; count < 32; count++) {
          if (performance.now() >= deadline) throw new Error("插件同步钩子超过 2 秒");
          const received = receiveMessageOnPort(relayPort);
          if (!received) break;
          receiveRelay(received.message);
        }
        const reply = syncReplies.get(id);
        if (reply) {
          if (reply.error || !(reply.data instanceof Uint8Array)) throw new Error(reply.error || "插件同步响应无效");
          return deserialize(Buffer.from(reply.data));
        }
        const remaining = deadline - performance.now();
        if (remaining <= 0) throw new Error("插件同步钩子超过 2 秒");
        Atomics.wait(relayWake, 0, version, Math.min(20, remaining));
      }
    } catch (error) {
      const failure = Object.assign(new Error(error instanceof Error ? error.message : "插件同步传输失败"), { code: "TOOL_SYNC_TRANSPORT", status: 504 });
      void dispose(failure);
      throw failure;
    } finally {
      syncReplies.delete(id);
      if (!syncReplies.size) syncDeadline = undefined;
      if (renderController) {
        activeScopes.delete(renderScope);
        renderController.abort(Object.assign(new Error("工具显示上下文已结束"), { code: "TOOL_CALL_CLOSED" }));
        void waitForFiles(renderScope).finally(() => {
          if (scopeControllers.get(renderScope) === renderController) scopeControllers.delete(renderScope);
        }).catch(() => {});
      }
    }
  };
  channel = new ToolChannel("host", message => child.send(message), synchronize, (scope, message) => {
    if (closing || (!activeScopes.has(scope) && !(scope === renderScope && channel.canUsePassive(message)))) throw Object.assign(new Error("工具调用上下文已结束"), { code: "TOOL_CALL_CLOSED" });
  });
  try { child = Bun.spawn([process.execPath, worker], {
    env, cwd: dirname(worker), stdin: "ignore", stdout: "ignore", stderr: "ignore", windowsHide: true, serialization: "advanced",
    ipc(message: any) {
      if (message?.type === "ready") { ready.resolve(); return; }
      void channel.receive(message).catch(error => dispose(error));
    },
    onDisconnect() { void dispose(Object.assign(new Error("工具工作进程已断开；不会自动重试执行"), { code: "TOOL_WORKER_EXIT" })); },
  }); } catch (error) { await dispose(); throw error; }
  void child.exited.then(() => dispose(Object.assign(new Error("工具工作进程已退出；不会自动重试执行"), { code: "TOOL_WORKER_EXIT" })));
  const initialize = async <T>(operation: () => Promise<T>) => {
    if (closing) throw new Error("工具工作进程已关闭");
    activeScopes.add("init");
    const timeout = setTimeout(() => { void dispose(Object.assign(new Error("工具初始化或定义创建超过 5 秒"), { status: 504, code: "TOOL_WORKER_TIMEOUT" })); }, 5000);
    try { return await channel.run("init", operation); }
    catch (error) { await dispose(error instanceof Error ? error : new Error("工具初始化失败")); throw error; }
    finally { clearTimeout(timeout); activeScopes.delete("init"); await waitForFiles("init"); }
  };
  const enableSync = async () => {
    if (syncTarget) return;
    const { port1, port2 } = new MessageChannel();
    relayPort = port1;
    relayWake = new Int32Array(new SharedArrayBuffer(4));
    relayReady = Promise.withResolvers<string>();
    void relayReady.promise.catch(() => {});
    relayPort.on("message", receiveRelay);
    relay = new Worker(locate("toolSyncRelay"), { workerData: { port: port2, wake: relayWake, token }, transferList: [port2] });
    relay.on("error", error => { void dispose(error instanceof Error ? error : new Error("插件同步传输失败")); });
    relay.on("exit", () => { if (!closing) void dispose(new Error("插件同步传输线程已结束")); });
    syncTarget = await channel.request("method", "enableSync", [await relayReady.promise]);
    const target = new URL(syncTarget!);
    if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || target.username || target.password) throw new Error("插件同步地址无效");
  };
  try {
    child.send({ type: "bootstrap", syncClient, token, url: `http://127.0.0.1:${server.port}/` });
    await initialize(async () => { await ready.promise; return channel.request("method", "load", [source]); });
  } catch (error) { await dispose(); throw error; }

  const signal = (original?: AbortSignal) => {
    const scoped = scopeControllers.get(channel.currentScope())?.signal;
    return AbortSignal.any([lifetime.signal, ...(scoped ? [scoped] : []), ...(original ? [original] : [])]);
  };
  const contextForWorker = (context: ToolContext): ToolContext => {
    const assertActiveScope = () => {
      lifetime.signal.throwIfAborted();
      const scope = channel.currentScope();
      if (!activeScopes.has(scope)) throw Object.assign(new Error("工具调用上下文已结束"), { code: "TOOL_CALL_CLOSED" });
      scopeControllers.get(scope)?.signal.throwIfAborted();
      return scope;
    };
    // 能力表仅包含公开契约；不能把宿主对象新增的成员自动导出给插件。
    const fileNames = ["readFile", "access", "stat", "readdir", "detectImageMimeType", "writeFile", "mkdir", "rename", "remove", "copyFile"] as const;
    const files = Object.fromEntries(fileNames.map(name => [name, (...args: any[]) => {
      const scope = assertActiveScope();
      const operationSignal = scopeControllers.get(scope)?.signal ?? lifetime.signal;
      let operations = fileOperations.get(scope);
      if (!operations) fileOperations.set(scope, operations = new Set());
      const pending = Promise.resolve().then(() => {
        operationSignal.throwIfAborted();
        assertActiveScope();
        return Reflect.apply(context.files[name], context.files, args);
      });
      operations.add(pending);
      void pending.finally(() => {
        operations.delete(pending);
        if (!operations.size) fileOperations.delete(scope);
      }).catch(() => {});
      return pending;
    }])) as unknown as ToolContext["files"];
    // SDK 的默认本机 I/O 必须替换为当前工作区授权能力。
    const sdk: ToolContext["sdk"] = {
      defineTool: context.sdk.defineTool,
      createReadToolDefinition: (_cwd, options) => context.sdk.createReadToolDefinition(context.cwd, {
        autoResizeImages: options?.autoResizeImages,
        operations: {
          readFile: path => files.readFile(path, true), access: path => files.access(path, true),
          detectImageMimeType: path => files.detectImageMimeType(path, true),
        },
      }),
      createWriteToolDefinition: () => context.sdk.createWriteToolDefinition(context.cwd, {
        operations: { writeFile: files.writeFile, mkdir: path => files.mkdir(path, true) },
      }),
      createEditToolDefinition: () => context.sdk.createEditToolDefinition(context.cwd, {
        operations: { readFile: files.readFile, access: files.access, writeFile: files.writeFile },
      }),
      createLsToolDefinition: () => context.sdk.createLsToolDefinition(context.cwd, {
        operations: {
          exists: async path => {
            try { await files.access(path, true); return true; }
            catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
          },
          stat: path => files.stat(path, true), readdir: path => files.readdir(path, true),
        },
      }),
      detectSupportedImageMimeTypeFromFile: path => files.detectImageMimeType(path, true),
    };
    for (const name of ["defineTool", "createReadToolDefinition", "createWriteToolDefinition", "createEditToolDefinition", "createLsToolDefinition"] as const) channel.markSynchronous(sdk[name]);
    const getNodeLabel = context.canvas?.getNodeLabel && ((id: string) => context.canvas!.getNodeLabel!(id));
    if (getNodeLabel) channel.markSynchronous(getNodeLabel);
    const listSkills = context.skills && ((scope?: Parameters<NonNullable<ToolContext["skills"]>["list"]>[0]) => context.skills!.list(scope));
    if (listSkills) channel.markSynchronous(listSkills);
    return {
      cwd: context.cwd, config: context.config, sdk, files, writeFile: files.writeFile,
      resolvePath: (path, readOnly) => context.resolvePath(path, readOnly),
      // 工厂在插件内恢复，原生流和事件不跨进程；输出业务保护仍回调宿主。
      ffmpeg: (async (original?: AbortSignal) => {
        const combined = signal(original);
        const runtime = describeFfmpeg(await context.ffmpeg(combined));
        if (runtime.validateOutput) channel.markSynchronous(runtime.validateOutput);
        return { ...runtime, signal: combined };
      }) as unknown as ToolContext["ffmpeg"],
      canvas: context.canvas && { id: context.canvas.id, tools: context.canvas.tools, getNodeLabel, call: (request, original) => context.canvas!.call(request, signal(original)) },
      question: context.question && { ask: (id, request, original) => context.question!.ask(id, request, signal(original)) },
      skills: context.skills && {
        list: listSkills!,
        read: (request, original) => context.skills!.read(request, signal(original)),
        create: (request, original) => context.skills!.create(request, signal(original)),
        update: (request, original) => context.skills!.update(request, signal(original)),
      },
      media: context.media && {
        listModels: () => context.media!.listModels(),
        generateImage: (request, original, source) => context.media!.generateImage(request, signal(original), source),
        generateVideo: (request, original, source) => context.media!.generateVideo(request, signal(original), source),
        generateAudio: (request, original, source) => context.media!.generateAudio(request, signal(original), source),
      },
    };
  };
  return {
    pid: child.pid,
    dispose,
    validateConfig: (config: Record<string, unknown>) => initialize(() => channel.request("method", "validate", [config])) as Promise<Record<string, unknown>>,
    async createTools(context: ToolContext): Promise<ToolDefinition[]> {
      const definitions = await initialize(() => channel.request("method", "create", [contextForWorker(context)]));
      if (!Array.isArray(definitions)) { await dispose(); throw new Error("插件没有返回工具列表"); }
      for (const definition of definitions) {
        if (!definition || typeof definition.name !== "string" || !definition.name || typeof definition.execute !== "function") {
          await dispose(); throw new Error("插件返回了无效的工具定义");
        }
      }
      if (definitions.some(definition => ["prepareArguments", "renderCall", "renderResult"].some(name => typeof definition[name] === "function" && channel.isRemote(definition[name])))) await initialize(enableSync);
      if (!renderScopeOpened && definitions.some(definition => ["renderCall", "renderResult"].some(name => typeof definition[name] === "function" && channel.isRemote(definition[name])))) {
        channel.openScope(renderScope);
        renderScopeOpened = true;
      }
      return definitions.map((definition: ToolDefinition) => ({
        ...definition,
        ...Object.fromEntries((["renderCall", "renderResult"] as const).filter(name => typeof definition[name] === "function" && channel.isRemote(definition[name]!)).map(name => [name, (...args: any[]) => {
          if (closing) throw new Error("工具工作进程已关闭；显示组件已释放");
          const context = args.at(-1);
          const theme = args.at(-2);
          if (theme && typeof theme === "object") { channel.markOpaque(theme); channel.markPassive(theme); }
          if (context?.state && typeof context.state === "object") channel.markMutable(context.state);
          if (typeof context?.invalidate === "function") channel.markPassive(context.invalidate);
          return channel.run(renderScope, () => Reflect.apply(definition[name]!, definition, args));
        }])),
        ...(typeof definition.prepareArguments === "function" && channel.isRemote(definition.prepareArguments) ? {
          prepareArguments(args: unknown) {
            if (closing) throw new Error("工具工作进程已关闭；请重新创建会话工具");
            const scope = crypto.randomUUID();
            activeScopes.add(scope);
            const controller = new AbortController();
            scopeControllers.set(scope, controller);
            try {
              channel.openScope(scope);
              return channel.run(scope, () => definition.prepareArguments!(args));
            }
            finally {
              activeScopes.delete(scope);
              controller.abort(Object.assign(new Error("参数准备上下文已结束"), { code: "TOOL_CALL_CLOSED" }));
              channel.releaseScope(scope);
              void waitForFiles(scope).finally(() => scopeControllers.delete(scope)).catch(() => {});
            }
          },
        } : {}),
        async execute(...args: Parameters<ToolDefinition["execute"]>) {
          if (closing) throw new Error("工具工作进程已关闭；请重新创建会话工具");
          args[2]?.throwIfAborted();
          const scope = crypto.randomUUID();
          activeScopes.add(scope);
          const controller = new AbortController();
          scopeControllers.set(scope, controller);
          let cancellation: ReturnType<typeof setTimeout> | undefined;
          const cancel = () => {
            activeScopes.delete(scope);
            controller.abort(args[2]?.reason ?? Object.assign(new Error("工具调用已取消"), { name: "AbortError" }));
            if (cancellation) return;
            cancellation = setTimeout(() => { void dispose(Object.assign(new Error("插件未响应取消，已结束工作进程；请核对原任务，不要自动重试"), { code: "TOOL_WORKER_CANCELLED" })); }, 2000);
          };
          try {
            channel.openScope(scope);
            if (args[4]) {
              const original = args[4];
              // 延迟读取安全会话状态，不传递模型凭据、会话管理器或宿主生命周期控制。
              const context = Object.create(null);
              for (const name of ["cwd", "mode"] as const) Object.defineProperty(context, name, { enumerable: true, get: () => original[name] });
              Object.defineProperty(context, "hasUI", { enumerable: true, value: false });
              Object.defineProperty(context, "signal", { enumerable: true, get: () => signal(original.signal) });
              for (const name of ["isIdle", "isProjectTrusted", "hasPendingMessages", "getContextUsage"] as const) {
                Object.defineProperty(context, name, { enumerable: true, value: () => original[name]() });
              }
              args[4] = context;
              channel.markOpaque(context);
            }
            args[2]?.addEventListener("abort", cancel, { once: true });
            if (args[2]?.aborted) cancel();
            const result = await channel.run(scope, () => definition.execute(...args));
            if (args[2]?.aborted) throw args[2].reason ?? Object.assign(new Error("工具调用已取消"), { name: "AbortError" });
            return result;
          } finally {
            if (cancellation) clearTimeout(cancellation);
            args[2]?.removeEventListener("abort", cancel);
            activeScopes.delete(scope);
            controller.abort(Object.assign(new Error("工具调用上下文已结束"), { code: "TOOL_CALL_CLOSED" }));
            await waitForFiles(scope);
            scopeControllers.delete(scope);
            channel.releaseScope(scope);
          }
        },
      }));
    },
  };
}
