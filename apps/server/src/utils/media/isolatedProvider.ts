import { existsSync } from "@toonflow/file";
import { dirname, resolve } from "node:path";
import { deserialize, serialize } from "node:v8";
import type { Provider } from "@toonflow/providers";
import { ToolChannel } from "../plugins/toolChannel";
import { getToolRuntimeDirectory } from "../plugins/toolProcess";

type ProviderMetadata = Pick<Provider, "id" | "label" | "version" | "apiUrl" | "modelsUrl" | "requiresApiKey" | "readme" | "rules"> & { config: Record<string, unknown> };

/** 单供应商源码实例；业务授权、持久任务和凭据请求继续由宿主处理。 */
export async function createIsolatedProvider(source: string, id: string, config: Record<string, unknown>, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const runtime = getToolRuntimeDirectory();
  const worker = [resolve(runtime, "providerWorker.js"), resolve(runtime, "../media/providerWorker.ts")].find(existsSync);
  const syncClient = [resolve(runtime, "toolSyncClient.js"), resolve(runtime, "toolSyncClient.ts")].find(existsSync);
  if (!worker || !syncClient) throw Object.assign(new Error("供应商工作进程缺失，请重新安装应用"), { status: 503, code: "PROVIDER_WORKER_MISSING" });
  const allowed = new Set(["path", "systemroot", "windir", "temp", "tmp", "tmpdir", "lang", "lc_all"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && allowed.has(key.toLowerCase()))) as Record<string, string>;
  const ready = Promise.withResolvers<void>(); void ready.promise.catch(() => {});
  const lifetime = new AbortController();
  const scopes = new Map<string, AbortController>();
  const callbacks = new Map<string, Set<Promise<unknown>>>();
  const wait = async (scope?: string) => {
    while (true) {
      const pending = scope ? [...(callbacks.get(scope) ?? [])] : [...callbacks.values()].flatMap(values => [...values]);
      if (!pending.length) return;
      await Promise.allSettled(pending);
    }
  };
  let initializing = true;
  let closing: Promise<void> | undefined;
  let channel: ToolChannel;
  let child: Bun.Subprocess<"ignore", "ignore", "ignore">;
  const token = crypto.randomUUID() + crypto.randomUUID();
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0, maxRequestBodySize: 16 * 1024 * 1024,
    async fetch(request) {
      if (closing || request.method !== "POST" || request.headers.get("origin") !== null || request.headers.get("authorization") !== "Bearer " + token) return new Response(null, { status: 403 });
      try { return new Response(serialize(channel.receiveSync(deserialize(Buffer.from(await request.arrayBuffer())))), { headers: { "content-type": "application/octet-stream" } }); }
      catch { return new Response(null, { status: 400 }); }
    },
  });
  const dispose = (reason: Error = Object.assign(new Error("供应商工作进程已结束；请核对原任务，不要自动重发"), { code: "PROVIDER_WORKER_CLOSED" })) => {
    if (closing) return closing;
    const finished = Promise.withResolvers<void>(); closing = finished.promise;
    void (async () => {
      lifetime.abort(reason); for (const controller of scopes.values()) controller.abort(reason);
      ready.reject(reason); channel?.abortSignals(reason);
      if (process.platform === "win32" && child && child.exitCode === null && child.signalCode === null) {
        try { await Bun.spawn([resolve(process.env.SystemRoot ?? "C:\\Windows", "System32/taskkill.exe"), "/PID", String(child.pid), "/T", "/F"], { stdin: "ignore", stdout: "ignore", stderr: "ignore", windowsHide: true, timeout: 3000 }).exited; }
        catch { /* 继续终止工作进程。 */ }
      }
      child?.kill("SIGKILL"); channel?.close(reason);
      // 已开始的保存和回执写入结束后才向调用方释放生命周期。
      await wait(); await child?.exited; await server.stop(true);
    })().then(finished.resolve, finished.reject);
    return closing;
  };
  channel = new ToolChannel("host", message => child.send(message), undefined, scope => {
    if (closing || (scope === "init" ? !initializing : !scopes.has(scope))) throw Object.assign(new Error("供应商调用上下文已结束"), { code: "PROVIDER_CALL_CLOSED" });
  });
  try {
    child = Bun.spawn([process.execPath, worker], {
      env, cwd: dirname(worker), stdin: "ignore", stdout: "ignore", stderr: "ignore", windowsHide: true, serialization: "advanced",
      ipc(message: any) {
        if (message?.type === "ready") { ready.resolve(); return; }
        const scope = message?.scope ?? "init";
        let pending = callbacks.get(scope); if (!pending) callbacks.set(scope, pending = new Set());
        const operation = channel.receive(message); pending.add(operation);
        void operation.catch(error => dispose(error)).finally(() => { pending.delete(operation); if (!pending.size) callbacks.delete(scope); }).catch(() => {});
      },
      onDisconnect() { void dispose(Object.assign(new Error("供应商工作进程已断开；不会自动重试执行"), { code: "PROVIDER_WORKER_EXIT" })); },
    });
  } catch (error) { await dispose(); throw error; }
  void child.exited.then(() => dispose(Object.assign(new Error("供应商工作进程已退出；不会自动重试执行"), { code: "PROVIDER_WORKER_EXIT" })));
  const cancelInitialization = () => { void dispose(signal?.reason); };
  signal?.addEventListener("abort", cancelInitialization, { once: true });
  const deadline = setTimeout(() => { void dispose(Object.assign(new Error("供应商初始化超过 5 秒"), { status: 504, code: "PROVIDER_WORKER_TIMEOUT" })); }, 5000);
  let loaded: { metadata: ProviderMetadata; methods: string[] };
  try {
    child.send({ type: "bootstrap", syncClient, token, url: "http://127.0.0.1:" + server.port + "/" });
    await ready.promise; signal?.throwIfAborted();
    loaded = await channel.request("method", "load", [source, id, config]);
  } catch (error) { await dispose(error instanceof Error ? error : undefined); throw error; }
  finally { clearTimeout(deadline); initializing = false; signal?.removeEventListener("abort", cancelInitialization); }
  return {
    ...loaded, pid: child.pid, dispose,
    async run(name: string, request: unknown, models: Provider["models"], tools: (signal: AbortSignal, markSynchronous: (callback: Function) => void) => object) {
      if (closing) throw new Error("供应商工作进程已关闭；请重新创建调用");
      signal?.throwIfAborted();
      const scope = crypto.randomUUID(); const controller = new AbortController(); scopes.set(scope, controller);
      const combined = AbortSignal.any([lifetime.signal, controller.signal, ...(signal ? [signal] : [])]);
      let cancellation: ReturnType<typeof setTimeout> | undefined;
      const cancel = () => { cancellation ??= setTimeout(() => { void dispose(Object.assign(new Error("供应商未响应取消，已结束工作进程；不要自动重发"), { code: "PROVIDER_WORKER_CANCELLED" })); }, 2000); };
      try {
        channel.openScope(scope); signal?.addEventListener("abort", cancel, { once: true }); if (signal?.aborted) cancel();
        const result = await channel.run(scope, () => channel.request("method", "run", [name, request, models, tools(combined, callback => channel.markSynchronous(callback)), combined]));
        combined.throwIfAborted(); return result;
      } finally {
        if (cancellation) clearTimeout(cancellation); signal?.removeEventListener("abort", cancel);
        controller.abort(Object.assign(new Error("供应商调用已结束"), { code: "PROVIDER_CALL_CLOSED" }));
        scopes.delete(scope); channel.releaseScope(scope); await wait(scope);
      }
    },
  };
}
