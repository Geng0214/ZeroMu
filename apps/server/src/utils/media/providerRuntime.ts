import { createHash } from "node:crypto";
import type { Provider, ProviderTools } from "@toonflow/providers";
import { mediaUsageValues } from "@toonflow/providers/mediaCosts";

export function mediaErrorMessage(value: unknown, config: Record<string, unknown>, depth = 0): string {
  if (depth > 6 || value == null) return "";
  let message = "";
  if (typeof value === "string") {
    message = value.trim();
    if (/^[\[{]/.test(message)) {
      try { message = mediaErrorMessage(JSON.parse(message), config, depth + 1); }
      catch { /* ACT: 非 JSON 错误正文按纯文本显示。 */ }
    }
  } else if (Array.isArray(value)) {
    message = value.slice(0, 10).map(item => mediaErrorMessage(item, config, depth + 1)).filter(Boolean).join("；");
  } else if (typeof value === "object") {
    const data = value as Record<string, unknown>;
    const messages: string[] = [];
    for (const key of ["failReason", "fail_reason", "error", "errors", "detail", "details", "error_description", "data", "task", "message", "msg", "status_msg"]) {
      if ((key === "data" || key === "task") && typeof data[key] !== "object") continue;
      const detail = mediaErrorMessage(data[key], config, depth + 1);
      if (detail) messages.push(...detail.split("\n"));
    }
    message = [...new Set(messages)].join("\n");
    if (!message && typeof data.data === "string") message = mediaErrorMessage(data.data, config, depth + 1);
  }
  if (!message || /^\s*<(?:!doctype|html|head|body)\b/i.test(message)) return "";
  for (const [key, secret] of Object.entries(config)) {
    if (!/api.?key|secret|token|password|authorization|cookie/i.test(key) || typeof secret !== "string" || !secret.trim()) continue;
    const token = secret.trim().replace(/^Bearer\s*/i, "");
    if (token) message = message.replaceAll(token, "••••••");
  }
  return message.replace(/(Bearer\s+)[^\s"'<>]+/gi, "$1••••••")
    .replace(/([?&][^=&#\s]+)=[^&#\s"'<>]*/g, "$1=••••••")
    .replace(/((?:api[_-]?key|secret|token|password|authorization|cookie)["']?\s*[:=]\s*["']?)[^\s"',;}&<>]+/gi, "$1••••••")
    .slice(0, 4000);
}

async function responseErrorMessage(response: Response, config: Record<string, unknown>) {
  if (!response.body || !/json|text|^$/i.test(response.headers.get("content-type") ?? "")) return "";
  const reader = response.clone().body!.getReader();
  const timer = setTimeout(() => { void reader.cancel().catch(() => {}); }, 3000);
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    // ACT: 错误正文最多读取 16 KB / 3 秒；大响应须由供应商在标准错误字段中提供摘要。
    while (size < 16000) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value.subarray(0, 16000 - size), { stream: true });
      size += value.byteLength;
    }
    return mediaErrorMessage(text + decoder.decode(), config);
  } catch { return ""; }
  finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
}


/** 受信任的响应与用量处理；供应商闭包由独立工作进程调用。 */
export function createProviderRuntime(definition: Provider, providerConfig: Record<string, unknown>, signal: AbortSignal | undefined, tools: ProviderTools, reportUsage = tools.reportUsage) {
  const provider = { ...definition, config: providerConfig, signal, tool: tools };
  for (const name of ["generateImage", "generateVideo", "generateAudio"] as const) {
    const generate = definition[name];
    if (!generate) continue;
    Object.assign(provider, { [name]: async (request: ImageRequest & VideoRequest & AudioRequest) => {
      let failure: { status?: number; message: string } | undefined;
      let pendingRequests = 0;
      let overlappingRequests = false;
      let requestCount = 0;
      const tool = { ...provider.tool, fetch: Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (++pendingRequests > 1) overlappingRequests = true;
        const requestId = ++requestCount;
        failure = undefined;
        try {
          const response = await provider.tool.fetch(input, init);
          if (!response.ok) failure = { status: response.status, message: await responseErrorMessage(response, provider.config) };
          else {
            const readJson = response.json;
            const readText = response.text;
            const address = input instanceof Request ? input.url : String(input);
            const method = init?.method ?? (input instanceof Request ? input.method : "GET");
            const usageKey = `response:${createHash("sha256").update(`${method}:${new URL(address).pathname}:${method.toUpperCase() === "GET" ? "" : requestId}`).digest("hex")}`;
            const captureUsage = async (value: unknown) => {
              const values = mediaUsageValues(value);
              if (values) await reportUsage?.({ key: usageKey, values });
            };
            Object.assign(response, { json: async function(this: Response) {
              const result = await readJson.call(this);
              await captureUsage(result);
              if (this === response && requestId === requestCount && !overlappingRequests && result && typeof result === "object") {
                const data = result as Record<string, unknown>;
                const failed = [data, data.data, data.task].some(item => {
                  if (!item || typeof item !== "object") return false;
                  const state = item as Record<string, unknown>;
                  return ["failed", "failure", "error", "rejected"].includes(String(state.status ?? state.state ?? "").toLowerCase())
                    || state.success === false || (typeof state.code === "number" && state.code >= 400 && state.code < 600);
                });
                if (failed) failure = { message: mediaErrorMessage(result, provider.config) };
              }
              return result;
            }, text: async function(this: Response) {
              const result = await readText.call(this);
              let parsed: unknown; try { parsed = JSON.parse(result); } catch { return result; }
              await captureUsage(parsed);
              return result;
            } });
          }
          return response;
        } finally { pendingRequests--; }
      }, { preconnect: provider.tool.fetch.preconnect }) as typeof fetch };
      try { return await generate.call({ ...provider, tool }, request); }
      catch (error) {
        const info = error as { name?: unknown; message?: unknown } | null;
        if (signal?.aborted || info?.name === "AbortError") throw error;
        let message = mediaErrorMessage(error, provider.config);
        if (!message) throw error;
        // ACT: 只补充串行请求中匹配的错误；并发时无法精确关联响应，由适配器使用 errorMessage 提取。
        const matchesFailure = failure?.status !== undefined
          ? new RegExp(`\\b(?:HTTP|status(?: code)?)\\s*[:：]?\\s*${failure.status}[)）.。\\s]*$`, "i").test(message)
          : failure?.message.includes(message) || /(?:未返回任务\s*ID|^(?:图片|视频)?生成失败|^素材审核失败)$/.test(message);
        if (!overlappingRequests && failure?.message && matchesFailure) {
          message = [...new Set([...message.split("\n"), ...failure.message.split("\n")])].join("\n").slice(0, 4000);
        }
        if (error instanceof Error && message === error.message) throw error;
        throw Object.assign(new Error(message), typeof error === "object" ? error : undefined, { message, cause: error });
      }
    } });
  }
  return provider;
}
