import * as zod from "zod";
import { deserialize, serialize } from "node:v8";
import type { ToolPlugin } from "@toonflow/tools-scaffold/runtime";
import { ToolChannel } from "./toolChannel";
import { createFfmpeg, type describeFfmpeg } from "@toonflow/ffmpeg/runtime";
import type { FfmpegCommand, ToolContext } from "@toonflow/tools-scaffold/runtime";

Bun.plugin({
  name: "toolHost",
  setup(build) { build.module("toonflow:tool-zod", () => ({ exports: zod, loader: "object" })); },
});

let channel: ToolChannel | undefined;
let plugin: ToolPlugin | undefined;
let moduleUrl: string | undefined;
let syncServer: ReturnType<typeof Bun.serve> | undefined;
const commands = new Set<FfmpegCommand>();

function stopCommands() {
  for (const command of commands) command.kill("SIGKILL");
}

process.on("exit", stopCommands);

process.on("message", (message: any) => {
  if (message?.type === "bootstrap" && !channel) {
    let callbackUrl = message.url;
    channel = new ToolChannel("worker", value => process.send?.(value), value => {
      const response = Bun.spawnSync([process.execPath, message.syncClient], {
        stdin: serialize({ url: callbackUrl, token: message.token, message: value }),
        stdout: "pipe", stderr: "pipe", windowsHide: true, timeout: 3500,
      });
      if (response.exitCode !== 0) throw Object.assign(new Error("插件宿主同步回调失败"), { code: "TOOL_SYNC_TRANSPORT" });
      return deserialize(response.stdout);
    });
    channel.register("enableSync", (url: string) => {
      if (syncServer) throw new Error("插件同步通道已创建");
      const target = new URL(url);
      if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || target.username || target.password) throw new Error("插件同步地址无效");
      callbackUrl = url;
      syncServer = Bun.serve({
        hostname: "127.0.0.1", port: 0, maxRequestBodySize: 16 * 1024 * 1024,
        async fetch(request) {
          if (request.method !== "POST" || request.headers.get("origin") !== null || request.headers.get("authorization") !== `Bearer ${message.token}`) return new Response(null, { status: 403 });
          try {
            const input = deserialize(Buffer.from(await request.arrayBuffer()));
            if (typeof input?.scope !== "string" || !input.scope || input.scope === "init") return new Response(null, { status: 400 });
            // 不同传输的到达顺序不同；本次认证请求先登记自己的范围。
            await channel!.receive({ type: "scopeStart", scope: input.scope });
            return new Response(serialize(channel!.receiveSync(input)), { headers: { "content-type": "application/octet-stream" } });
          } catch { return new Response(null, { status: 400 }); }
        },
      });
      return `http://127.0.0.1:${syncServer.port}/`;
    });
    channel.register("load", async (source: string) => {
      if (plugin) throw new Error("工具工作进程已绑定插件源码");
      moduleUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      const loaded = await import(moduleUrl);
      if (typeof loaded.default?.validateConfig !== "function" || typeof loaded.default?.createTools !== "function") {
        throw Object.assign(new Error("未导出有效的工具插件"), { status: 400 });
      }
      plugin = loaded.default;
      return { pid: process.pid };
    });
    channel.register("validate", async config => {
      if (!plugin) throw new Error("工具尚未加载");
      return zod.z.record(zod.z.string(), zod.z.json()).parse(await plugin.validateConfig(config));
    });
    channel.register("create", async (context: ToolContext) => {
      if (!plugin) throw new Error("工具尚未加载");
      const ffmpeg = context.ffmpeg;
      const definitions = await plugin.createTools({ ...context, ffmpeg: async signal => {
        signal?.throwIfAborted();
        const runtime = await ffmpeg(signal) as unknown as ReturnType<typeof describeFfmpeg> & { signal: AbortSignal };
        signal = runtime.signal;
        signal?.throwIfAborted();
        const factory = createFfmpeg(runtime.directory, {
          validateOutput: runtime.validateOutput,
          onCommand(command) {
            commands.add(command);
            const release = () => { commands.delete(command); signal?.removeEventListener("abort", stop); };
            const stop = () => { command.kill("SIGKILL"); release(); };
            command.on("start", () => { if (signal?.aborted) stop(); });
            command.once("end", release);
            command.once("error", release);
            signal?.addEventListener("abort", stop, { once: true });
            if (signal?.aborted) stop();
          },
        });
        factory.setFfmpegPath(runtime.ffmpegPath!);
        factory.setFfprobePath(runtime.ffprobePath!);
        return factory;
      } });
      if (!Array.isArray(definitions)) return definitions;
      return definitions.map(definition => {
        if (!definition) return definition;
        const wrapped = { ...definition };
        const prepare = definition?.prepareArguments;
        if (typeof prepare === "function" && !channel!.isRemote(prepare)) wrapped.prepareArguments = (args: unknown) => {
          const result = Reflect.apply(prepare, definition, [args]);
          if (result && typeof (result as { then?: unknown }).then === "function") {
            void Promise.resolve(result).catch(() => {});
            throw Object.assign(new Error("参数准备钩子必须同步返回参数对象"), { code: "TOOL_SYNC_HOOK_ASYNC", status: 400 });
          }
          // 参数离开调用范围后仍可使用，不保留指向插件对象的临时引用。
          return structuredClone(result);
        };
        for (const name of ["renderCall", "renderResult"] as const) {
          const render = definition[name];
          if (typeof render !== "function" || channel!.isRemote(render)) continue;
          wrapped[name] = (...args: any[]) => {
            const context = args.at(-1);
            if (typeof context?.invalidate === "function") {
              const invalidate = context.invalidate;
              // 刷新是通知；不能在子进程等待宿主期间再同步进入子进程组件。
              args[args.length - 1] = { ...context, invalidate: () => { void invalidate(); } };
            }
            const component = Reflect.apply(render, definition, args);
            if (component && typeof component.then === "function") {
              void Promise.resolve(component).catch(() => {});
              throw Object.assign(new Error("工具显示钩子必须同步返回组件"), { code: "TOOL_SYNC_HOOK_ASYNC", status: 400 });
            }
            if (!component || typeof component.render !== "function" || typeof component.invalidate !== "function") throw new Error("工具显示钩子没有返回有效组件");
            channel!.markMutable(component, ["focused"]);
            return component;
          };
        }
        return wrapped;
      });
    });
    process.send?.({ type: "ready" });
    return;
  }
  if (!channel) { process.exitCode = 1; process.disconnect?.(); return; }
  void channel.receive(message).catch(() => { process.exitCode = 1; process.disconnect?.(); });
});

process.on("disconnect", () => {
  void syncServer?.stop(true);
  stopCommands();
  channel?.close();
  if (moduleUrl) URL.revokeObjectURL(moduleUrl);
  process.exit(0);
});
