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
const commands = new Set<FfmpegCommand>();

function stopCommands() {
  for (const command of commands) command.kill("SIGKILL");
}

process.on("exit", stopCommands);

process.on("message", (message: any) => {
  if (message?.type === "bootstrap" && !channel) {
    channel = new ToolChannel("worker", value => process.send?.(value), value => {
      const response = Bun.spawnSync([process.execPath, message.syncClient], {
        stdin: serialize({ url: message.url, token: message.token, message: value }),
        stdout: "pipe", stderr: "pipe", windowsHide: true, timeout: 3500,
      });
      if (response.exitCode !== 0) throw Object.assign(new Error("插件宿主同步回调失败"), { code: "TOOL_SYNC_TRANSPORT" });
      return deserialize(response.stdout);
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
      return plugin.createTools({ ...context, ffmpeg: async signal => {
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
    });
    process.send?.({ type: "ready" });
    return;
  }
  if (!channel) { process.exitCode = 1; process.disconnect?.(); return; }
  void channel.receive(message).catch(() => { process.exitCode = 1; process.disconnect?.(); });
});

process.on("disconnect", () => {
  stopCommands();
  channel?.close();
  if (moduleUrl) URL.revokeObjectURL(moduleUrl);
  process.exit(0);
});
