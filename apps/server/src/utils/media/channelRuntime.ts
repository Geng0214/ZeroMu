import { channelUrl } from "./channelUrl";
import { t } from "@/lib/i18n";

type ChannelKind = "image" | "video" | "audio";
type ChannelContext = ProviderContext;

function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function channelBase(context: ChannelContext) {
  const apiUrl = text(context.config.apiUrl).replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(apiUrl)) invalid("渠道 API 地址必须以 http:// 或 https:// 开头");
  return apiUrl;
}

/** 渠道路径可含 {id} 占位符；未声明时按 OpenAI 约定把任务号追加到末尾。 */
function bind(apiUrl: string, path: string, taskId = "") {
  const base = /^https?:\/\//i.test(path) ? path : channelUrl(apiUrl, path);
  if (!taskId) return base;
  if (base.includes("{id}")) return base.replace(/\{id\}/g, encodeURIComponent(taskId));
  return `${base.replace(/\/+$/, "")}/${encodeURIComponent(taskId)}`;
}

function authHeaders(context: ChannelContext) {
  const apiKey = text(context.config.apiKey).replace(/^Bearer\s+/i, "");
  return { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), "Content-Type": "application/json" };
}

function toInputReference(value: unknown): string {
  const input = record(value);
  if (typeof input.url === "string") return input.url;
  if (typeof input.data === "string") return `data:${input.mimeType ?? "application/octet-stream"};base64,${input.data}`;
  return "";
}

function referenceList(value: unknown) {
  return Array.isArray(value) ? value.map(toInputReference).filter(Boolean) : [];
}

function sleep(seconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    function abort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("已取消"));
    }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, seconds * 1000);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function hostOf(url: string) {
  return url.slice(url.indexOf("//") + 2).split("/")[0] || url;
}

async function send(context: ChannelContext, url: string, init: RequestInit) {
  context.signal?.throwIfAborted();
  let response: Response;
  try { response = await context.tool.fetch(url, { ...init, signal: context.signal }); }
  catch (error) { return invalid(t`无法连接渠道 ${hostOf(url)}：${context.tool.errorMessage(error) || String(error)}`); }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return invalid(t`渠道请求失败（HTTP ${response.status}）：${context.tool.errorMessage(body) || body.slice(0, 300)}`);
  }
  return response;
}

async function readJson(context: ChannelContext, url: string, init: RequestInit) {
  const response = await send(context, url, init);
  const body = await response.text().catch(() => "");
  try { return JSON.parse(body) as unknown; }
  catch { return body; }
}

/** 兼容直接返回二进制、以及返回 JSON 内嵌地址两种音频/视频接口。 */
async function readMedia(context: ChannelContext, url: string, init: RequestInit, mediaType: "video" | "audio"): Promise<MediaAsset[]> {
  const response = await send(context, url, init);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    const value = await response.json().catch(() => null);
    const assetUrl = pickUrl(value);
    if (assetUrl) return [{ type: "url", url: assetUrl, mediaType }];
    invalid(context.tool.errorMessage(value) || t`渠道未返回${mediaType === "audio" ? "音频" : "视频"}内容`);
  }
  const data = new Uint8Array(await response.arrayBuffer());
  if (!data.byteLength) invalid(t`渠道返回的${mediaType === "audio" ? "音频" : "视频"}内容为空`);
  return [{ type: "binary", data, mimeType: contentType || (mediaType === "audio" ? "audio/mpeg" : "video/mp4"), mediaType }];
}

/** 在任意层级的响应里找第一个可用的资源地址。 */
function pickUrl(value: unknown, depth = 0): string {
  if (depth > 6 || value == null) return "";
  if (typeof value === "string") return /^https?:\/\//.test(value) ? value : "";
  if (Array.isArray(value)) return value.map(item => pickUrl(item, depth + 1)).find(Boolean) ?? "";
  const source = record(value);
  for (const key of ["url", "video_url", "videoUrl", "result_url", "output_url", "content_url", "file_url", "download_url", "image_url"]) {
    const found = pickUrl(source[key], depth + 1);
    if (found) return found;
  }
  for (const key of ["data", "result", "task", "videos", "items", "output", "outputs"]) {
    const found = pickUrl(source[key], depth + 1);
    if (found) return found;
  }
  return "";
}

function pickTaskId(value: unknown, depth = 0): string {
  if (depth > 4 || value == null) return "";
  const source = record(value);
  for (const key of ["id", "request_id", "requestId", "task_id", "taskId", "video_id", "job_id"]) {
    const found = text(source[key]);
    if (found && found.length <= 200) return found;
  }
  for (const key of ["data", "result", "task"]) {
    const found = pickTaskId(source[key], depth + 1);
    if (found) return found;
  }
  return "";
}

function pickStatus(value: unknown): string {
  const source = record(value);
  for (const key of ["status", "state", "task_status", "job_status"]) {
    const found = text(source[key]).toLowerCase();
    if (found) return found;
  }
  for (const key of ["data", "result", "task"]) {
    const found = source[key] ? pickStatus(source[key]) : "";
    if (found) return found;
  }
  return "";
}

const failedStatus = ["failed", "failure", "error", "rejected", "canceled", "cancelled", "timeout"];
const succeededStatus = ["succeeded", "success", "completed", "complete", "finished", "done"];

function readAssets(value: unknown): MediaAsset[] {
  const source = record(value);
  const list = [source.data, source.images, value].flatMap(item => Array.isArray(item) ? item : []);
  const assets: MediaAsset[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      if (/^https?:\/\//.test(item)) assets.push({ type: "url", url: item, mediaType: "image" });
      continue;
    }
    const entry = record(item);
    const encoded = text(entry.b64_json) || text(entry.b64) || text(entry.base64);
    if (encoded) assets.push({ type: "base64", data: encoded, mimeType: text(entry.mime_type, "image/png"), mediaType: "image" });
    else {
      const assetUrl = text(entry.url) || text(entry.image_url);
      if (assetUrl) assets.push({ type: "url", url: assetUrl, mediaType: "image" });
    }
  }
  return assets;
}

async function generateImage(context: ChannelContext, source: object): Promise<MediaAsset[]> {
  const request = record(source);
  const body: Record<string, unknown> = { model: request.model, prompt: request.prompt, n: request.n ?? 1 };
  const size = text(request.size);
  const ratio = text(request.ratio);
  // ACT: 严格 OpenAI 网关会拒绝未知参数，因此只在没有像素尺寸时下发宽高比。
  if (size) body.size = size;
  else if (ratio) body.aspect_ratio = ratio;
  if (context.config.returnBase64 === true) body.response_format = "b64_json";
  const images = referenceList(request.images);
  if (images.length) body.image = images.length === 1 ? images[0] : images;
  const result = await readJson(context, channelUrl(channelBase(context), "/v1/images/generations"), { method: "POST", headers: authHeaders(context), body: JSON.stringify(body) });
  const assets = readAssets(result);
  if (!assets.length) invalid(context.tool.errorMessage(result) || "渠道未返回图片结果");
  return assets;
}

async function generateAudio(context: ChannelContext, source: object): Promise<MediaAsset[]> {
  const request = record(source);
  const body: Record<string, unknown> = { model: request.model, input: request.text ?? request.prompt, voice: text(request.voice, "alloy") };
  if (text(request.format)) body.response_format = request.format;
  if (typeof request.speed === "number") body.speed = request.speed;
  if (typeof request.sampleRate === "number") body.sample_rate = request.sampleRate;
  return readMedia(context, channelUrl(channelBase(context), "/v1/audio/speech"), { method: "POST", headers: authHeaders(context), body: JSON.stringify(body) }, "audio");
}

async function generateVideo(context: ChannelContext, source: object): Promise<MediaAsset[]> {
  const request = record(source);
  const body: Record<string, unknown> = { model: request.model, prompt: request.prompt };
  if (typeof request.duration === "number") body.duration = request.duration;
  const size = text(request.size);
  if (size) body.size = size;
  const ratio = text(request.ratio);
  if (ratio) body.aspect_ratio = ratio;
  const resolution = text(request.resolution);
  if (resolution) body.resolution = resolution;
  const firstFrame = toInputReference(request.firstFrame);
  const lastFrame = toInputReference(request.lastFrame);
  const images = referenceList(request.images);
  if (firstFrame || images.length) body.image = firstFrame || (images.length === 1 ? images[0] : images);
  if (lastFrame) body.image_tail = lastFrame;
  const videos = referenceList(request.videos);
  if (videos.length) body.video = videos.length === 1 ? videos[0] : videos;
  const audios = referenceList(request.audios);
  if (audios.length) body.audio = audios.length === 1 ? audios[0] : audios;

  const apiUrl = channelBase(context);
  const submitPath = text(context.config.submitPath, "/v1/videos");
  const pollPath = text(context.config.pollPath, "/v1/videos/{id}");
  const contentPath = text(context.config.contentPath);
  const submitted = await readJson(context, bind(apiUrl, submitPath, ""), { method: "POST", headers: authHeaders(context), body: JSON.stringify(body) });
  const failure = context.tool.errorMessage(submitted);
  const immediate = pickUrl(submitted);
  if (immediate) return [{ type: "url", url: immediate, mediaType: "video" }];
  const taskId = pickTaskId(submitted);
  if (!taskId) invalid(failure || "渠道未返回视频任务 ID");
  const pollUrl = bind(apiUrl, pollPath, taskId);
  // ACT: 轮询上限 30 分钟、间隔 5 秒；更长的任务由用户在节点上重新发起。
  for (let attempt = 0; attempt < 360; attempt++) {
    context.signal?.throwIfAborted();
    if (attempt) await sleep(5, context.signal);
    const status = await readJson(context, pollUrl, { method: "GET", headers: authHeaders(context) });
    const assetUrl = pickUrl(status);
    if (assetUrl) return [{ type: "url", url: assetUrl, mediaType: "video" }];
    if (contentPath && succeededStatus.includes(pickStatus(status))) return readMedia(context, bind(apiUrl, contentPath, taskId), { method: "GET", headers: authHeaders(context) }, "video");
    if (failedStatus.includes(pickStatus(status))) invalid(`视频生成失败：${context.tool.errorMessage(status) || status}`);
  }
  invalid(failure || "视频生成超时，请稍后重试");
}

export async function runMediaChannel(kind: ChannelKind, context: ChannelContext, request: object): Promise<MediaAsset[]> {
  if (kind === "image") return generateImage(context, request);
  if (kind === "audio") return generateAudio(context, request);
  return generateVideo(context, request);
}
