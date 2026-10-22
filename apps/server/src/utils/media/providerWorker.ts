import { createContext, SourceTextModule } from "node:vm";
import { deserialize, serialize } from "node:v8";
import type { Provider, ProviderTools } from "@toonflow/providers";
import type { FfmpegCommand } from "@toonflow/tools-scaffold/runtime";
import { createFfmpeg, type describeFfmpeg } from "@toonflow/ffmpeg/runtime";
import { ToolChannel } from "../plugins/toolChannel";
import { createProviderRuntime, mediaErrorMessage } from "./providerRuntime";

let channel: ToolChannel | undefined;
let definition: Provider | undefined;
let config: Record<string, unknown>;
function providerError(error: unknown) {
  const value = error as Error & { code?: string; status?: number; submissionRejected?: boolean };
  return Object.assign(new Error(mediaErrorMessage(value, config ?? {}) || String(error)), { name: value?.name ?? "Error", code: value?.code, status: value?.status, submissionRejected: value?.submissionRejected });
}
const commands = new Set<FfmpegCommand>();
const stopCommands = () => { for (const command of commands) command.kill("SIGKILL"); };
process.on("exit", stopCommands);

process.on("message", (message: any) => {
  if (message?.type === "bootstrap" && !channel) {
    channel = new ToolChannel("worker", value => process.send?.(value), value => {
      const result = Bun.spawnSync([process.execPath, message.syncClient], {
        stdin: serialize({ url: message.url, token: message.token, message: value }),
        stdout: "pipe", stderr: "pipe", windowsHide: true, timeout: 3500,
      });
      if (result.exitCode !== 0) throw Object.assign(new Error("供应商宿主同步回调失败"), { code: "PROVIDER_SYNC_TRANSPORT" });
      return deserialize(result.stdout);
    });
    channel.register("load", async (source: string, id: string, inputConfig: Record<string, unknown>) => {
      try {
        if (definition) throw new Error("供应商工作进程已绑定源码");
        const context = createContext({ Buffer, URL, URLSearchParams, TextEncoder, TextDecoder, Blob, AbortController, AbortSignal, setTimeout, clearTimeout }, { codeGeneration: { strings: false, wasm: false } });
        const rejectImport = () => { throw new Error("供应商不能导入模块，请使用 this.tool 中的宿主工具"); };
        const module = new SourceTextModule(source, { context, identifier: id + ".ts", importModuleDynamically: rejectImport });
        await module.link(rejectImport);
        await module.evaluate({ timeout: 1000 });
        definition = (module.namespace as { default: Provider }).default;
        const rules = Array.isArray(definition.rules) ? definition.rules : [];
        config = { ...Object.fromEntries(rules.map(rule => [rule.field, rule.value])), ...inputConfig };
        // 元数据是快照；不把供应商 getter、闭包或原型交给宿主。
        const metadata = JSON.parse(JSON.stringify({ id: definition.id, label: definition.label, version: definition.version, apiUrl: definition.apiUrl, modelsUrl: definition.modelsUrl, requiresApiKey: definition.requiresApiKey, readme: definition.readme, rules, config }));
        return { metadata, methods: ["generateImage", "generateVideo", "generateAudio", "checkForUpdates", "updateVendor"].filter(name => typeof definition![name as keyof Provider] === "function") };
      } catch (error) { throw providerError(error); }
    });
    channel.register("run", async (name: keyof Provider, request: any, models: Provider["models"], remote: any, signal: AbortSignal) => {
      if (!definition || !["generateImage", "generateVideo", "generateAudio", "checkForUpdates", "updateVendor"].includes(name)) throw new Error("供应商方法不存在");
      const fetchRequest = Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
        const response = await remote.fetch({ url: request.url, method: request.method, headers: [...request.headers], redirect: request.redirect, body: typeof init?.body === "string" ? init.body : request.body ? new Uint8Array(await request.arrayBuffer()) : undefined, signal: request.signal });
        const body = response.read ? new ReadableStream<Uint8Array>({
          async pull(controller) { try { const next = await response.read(); if (next.done) controller.close(); else controller.enqueue(next.value); } catch (error) { controller.error(error); } },
          async cancel() { await response.cancel(); },
        }, { highWaterMark: 0 }) : null;
        const result = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
        for (const key of ["url", "redirected", "type"] as const) Object.defineProperty(result, key, { value: response[key] });
        return result;
      }, { preconnect: (url: Parameters<typeof fetch.preconnect>[0], options?: Parameters<typeof fetch.preconnect>[1]) => remote.preconnect(String(url), options && structuredClone(options)) }) as typeof fetch;
      const tools: ProviderTools = {
        task: remote.task && { run: (key, submit) => remote.task.run(key, async () => structuredClone(await submit())) },
        onAsset: remote.onAsset && (asset => remote.onAsset(structuredClone(asset))),
        reportUsage: remote.reportUsage && (report => remote.reportUsage(structuredClone(report))),
        fetch: fetchRequest, hash: Bun.hash, image: Bun.Image,
        errorMessage: value => mediaErrorMessage(value, config),
        audio: {
          convert: (input, options) => remote.audio.convert(structuredClone(input), structuredClone(options)),
          synthesize: input => remote.audio.synthesize(structuredClone(input)),
        },
        imageProcessing: { removeBackground: input => remote.imageProcessing.removeBackground(structuredClone(input)) },
        mediaChannel: (kind, _context, request) => remote.mediaChannel(kind, structuredClone(request)),
        ffmpeg: async () => {
          signal.throwIfAborted();
          const runtime = await remote.ffmpeg() as ReturnType<typeof describeFfmpeg>;
          const factory = createFfmpeg(runtime.directory, {
            validateOutput: runtime.validateOutput,
            onCommand(command) {
              commands.add(command);
              const release = () => { commands.delete(command); signal.removeEventListener("abort", stop); };
              const stop = () => { command.kill("SIGKILL"); release(); };
              command.on("start", () => { if (signal.aborted) stop(); });
              command.once("end", release); command.once("error", release);
              signal.addEventListener("abort", stop, { once: true });
              if (signal.aborted) stop();
            },
          });
          factory.setFfmpegPath(runtime.ffmpegPath!); factory.setFfprobePath(runtime.ffprobePath!);
          return factory;
        },
      };
      const provider = createProviderRuntime({ ...definition, models }, config, signal, tools);
      const operation = provider[name];
      if (typeof operation !== "function") throw new Error("供应商没有实现此方法");
      signal.throwIfAborted();
      try { return structuredClone(await Reflect.apply(operation, provider, [request])); }
      catch (error) { throw providerError(error); }
    });
    process.send?.({ type: "ready" });
    return;
  }
  if (!channel) { process.exitCode = 1; process.disconnect?.(); return; }
  void channel.receive(message).catch(() => { process.exitCode = 1; process.disconnect?.(); });
});
process.on("disconnect", () => { stopCommands(); channel?.close(); process.exit(0); });
