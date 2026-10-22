import { mediaProviders, type Provider } from "@toonflow/providers";
import { channelUrl } from "./channelUrl";
import { t } from "@/lib/i18n";
import conf from "@/utils/conf";
import { createParser } from "eventsource-parser";
import { getAgnesModelCapabilities, isSiliconFlow } from "@toonflow/providers/channelModels";
import { getMediaCapabilityError } from "@toonflow/providers/mediaCapabilities";
import type { MediaGenerationRequest } from "@toonflow/tools-scaffold/runtime";
import { mediaUsageValues } from "@toonflow/providers/mediaCosts";

type ChannelKind = "image" | "video" | "audio";
type ChannelContext = ProviderContext;

function invalid(message: string, submissionRejected = false): never {
  throw Object.assign(new Error(message), { status: 400, ...(submissionRejected ? { submissionRejected: true } : {}) });
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
  signal?.throwIfAborted();
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
  const timeout = AbortSignal.timeout(120000);
  try { response = await context.tool.fetch(url, { ...init, signal: context.signal ? AbortSignal.any([context.signal, timeout]) : timeout }); }
  catch (error) { context.signal?.throwIfAborted(); return invalid(t`无法连接渠道 ${hostOf(url)}：${context.tool.errorMessage(error) || String(error)}`); }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw Object.assign(new Error(t`渠道请求失败（HTTP ${response.status}）：${context.tool.errorMessage(body) || body.slice(0, 300)}`), {
      status: 400, submissionRejected: [400, 401, 403, 404, 405, 422, 429].includes(response.status),
    });
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
  for (const key of ["data", "result", "results", "task", "videos", "items", "output", "outputs"]) {
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
const succeededStatus = ["succeed", "succeeded", "success", "completed", "complete", "finished", "done"];

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

async function generateImage(context: ChannelContext, source: object, imageTransport?: MediaGenerationRequest["imageTransport"]): Promise<MediaAsset[]> {
  const request = record(source);
  const preferences = imageTransport ?? record(conf.get("settings", {}).mediaCreationPreferences);
  const agnes = getAgnesModelCapabilities(channelBase(context), text(request.model));
  if (agnes?.imageSizes) {
    const error = getMediaCapabilityError(agnes, "image", source as ImageRequest);
    if (error) invalid(error, true);
    if (preferences.streamImages === true || preferences.codexCli === true) invalid("Agnes 图片接口未声明流式图片或 Codex 兼容模式，请关闭这些选项后生成", true);
  }
  const silicon = isSiliconFlow(channelBase(context));
  const stream = !silicon && preferences.streamImages === true;
  const codex = !silicon && preferences.codexCli === true;
  const count = Number(request.n ?? 1);
  const body: Record<string, unknown> = { model: request.model, prompt: codex ? `Use the following text as the complete prompt. Do not rewrite it:\n${request.prompt}` : request.prompt };
  if (!codex && !stream) body.n = count;
  if (stream) body.stream = true;
  const size = text(request.size);
  const ratio = text(request.ratio);
  // ACT: 严格 OpenAI 网关会拒绝未知参数，因此只在没有像素尺寸时下发宽高比。
  if (size) body.size = size;
  else if (ratio) body.aspect_ratio = ratio;
  if (text(request.quality) && !codex) body.quality = text(request.quality);
  if ((preferences.returnBase64 ?? context.config.returnBase64) === true) body.response_format = "b64_json";
  const images = referenceList(request.images);
  if (images.length) body.image = images.length === 1 ? images[0] : images;
  if (agnes?.imageSizes) {
    delete body.n; delete body.quality; delete body.aspect_ratio; delete body.image; delete body.response_format;
    body.size = size || "1K";
    if (ratio) body.ratio = ratio;
    const base64 = (preferences.returnBase64 ?? context.config.returnBase64) === true;
    if (images.length) body.extra_body = { image: images, response_format: base64 ? "b64_json" : "url" };
    else if (base64) body.return_base64 = true;
    else body.extra_body = { response_format: "url" };
  }
  if (silicon) {
    delete body.n; delete body.size; delete body.aspect_ratio; delete body.quality; delete body.response_format;
    if (/image-edit/i.test(String(request.model))) {
      if (!images.length) invalid("该图片编辑模型需要参考图片");
    } else if (size) body.image_size = size;
    const referenceLimit = /qwen-image-edit-2509/i.test(String(request.model)) ? 3 : 1;
    if (images.length > referenceLimit) invalid(`该模型最多支持 ${referenceLimit} 张参考图片`);
    images.forEach((image, index) => { body[index ? `image${index + 1}` : "image"] = image; });
  }
  const assets: MediaAsset[] = [];
  // ACT: 流式与兼容网关逐张请求，避免这些接口不支持 n；保留取消信号。
  for (let index = 0; index < (silicon || stream || codex ? count : 1); index++) {
    try {
    const response = await send(context, channelUrl(channelBase(context), "/v1/images/generations"), { method: "POST", headers: authHeaders(context), body: JSON.stringify(body) });
    if (response.headers.get("content-type")?.includes("text/event-stream")) assets.push(...await readImageStream(response, context, `imageStream:${index}`));
    else {
      const result = await response.json();
      const images = readAssets(result);
      if (!images.length) invalid(context.tool.errorMessage(result) || "渠道未返回图片结果");
      assets.push(...images);
    }
    } catch (cause) { if (!assets.length) throw cause; break; }
  }
  if (!assets.length) invalid("渠道未返回图片结果");
  return assets;
}

async function readImageStream(response: Response, context: ChannelContext, usageKey: string): Promise<MediaAsset[]> {
  const reader = response.body?.getReader();
  if (!reader) invalid("渠道没有返回可读取的图片流");
  const decoder = new TextDecoder();
  const images = new Map<string, MediaAsset>();
  let completed = false;
  let usage: Record<string, number> | undefined;
  const parser = createParser({ maxBufferSize: 140 * 1024 * 1024, onEvent(event) {
    if (event.data === "[DONE]") { completed = true; return; }
    let value: Record<string, unknown>;
    try { value = record(JSON.parse(event.data)); } catch { invalid("图片流事件格式无效"); }
    usage = mediaUsageValues(value) ?? usage;
    const type = text(value.type, event.event || text(value.object));
    if (value.error || /(?:error|failed)$/.test(type)) invalid(context.tool.errorMessage(value) || "图片流返回错误");
    if (type.includes("partial") || value.partial_image_b64) return;
    const batch = Array.isArray(value.data) ? readAssets(value) : readAssets([value]);
    batch.forEach((asset, index) => images.set(String(value.image_index ?? index), asset));
  } });
  try {
    while (!completed) {
      context.signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }
    parser.feed(decoder.decode());
    parser.reset({ consume: true });
  } finally { await reader.cancel(); if (usage) await context.tool.reportUsage?.({ key: usageKey, values: usage }); }
  if (!images.size) invalid("图片流未返回最终图片，请重试；中间预览不会作为生成结果保存");
  return [...images.values()];
}

async function generateAudio(context: ChannelContext, source: object): Promise<MediaAsset[]> {
  const request = record(source);
  if (referenceList(request.audios).length) invalid("当前语音接口只支持文本配音，尚未接入参考音频克隆");
  const body: Record<string, unknown> = { model: request.model, input: request.text ?? request.prompt };
  if (text(request.voice)) body.voice = text(request.voice);
  if (text(request.format)) body.response_format = request.format;
  if (typeof request.speed === "number") body.speed = request.speed;
  if (typeof request.sampleRate === "number") body.sample_rate = request.sampleRate;
  if (isSiliconFlow(channelBase(context))) {
    const voice = text(request.voice);
    if (voice) body.voice = voice.includes(":") ? voice : `${request.model}:${voice}`;
    if (body.response_format && !["mp3", "opus", "wav", "pcm"].includes(String(body.response_format))) invalid("硅基流动语音接口支持 MP3、Opus、WAV 或 PCM 格式");
  }
  return readMedia(context, channelUrl(channelBase(context), "/v1/audio/speech"), { method: "POST", headers: authHeaders(context), body: JSON.stringify(body) }, "audio");
}

async function submitVideo(context: ChannelContext, url: string, init: RequestInit) {
  return context.tool.task ? context.tool.task.run("videoSubmission", () => readJson(context, url, init)) : readJson(context, url, init);
}

async function generateVideo(context: ChannelContext, source: object): Promise<MediaAsset[]> {
  const request = record(source);
  const body: Record<string, unknown> = { model: request.model, prompt: request.prompt };
  if (typeof request.generateAudio === "boolean") body.generate_audio = request.generateAudio;
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
  const agnes = getAgnesModelCapabilities(apiUrl, text(request.model));
  if (agnes?.durationResolutionMap) {
    const error = getMediaCapabilityError(agnes, "video", source as VideoRequest);
    if (error) invalid(error, true);
    if ([firstFrame, lastFrame, ...images, ...videos, ...audios].some(value => value && !/^https?:\/\//i.test(value))) {
      invalid("Agnes 视频参考要求供应商可访问的公开媒体地址；当前本地参考尚未上传，不能作为公开 URL 提交", true);
    }
    const startFrame = firstFrame || (request.mode === "singleImage" ? images[0] : "");
    const mode = startFrame || lastFrame ? "keyframe" : images.length || videos.length || audios.length ? "reference" : "text";
    const payload = { model: request.model, prompt: request.prompt, mode, seconds: String(request.duration ?? 5), size: resolution || size || "720P",
      ...(ratio ? { aspect_ratio: ratio } : {}), ...(startFrame ? { first_frame: startFrame } : {}), ...(lastFrame ? { last_frame: lastFrame } : {}),
      ...(mode === "reference" && images.length ? { images } : {}), ...(audios.length ? { audios } : {}), ...(videos.length ? { videos: videos.map(url => ({ url })) } : {}),
    };
    const submitted = await submitVideo(context, channelUrl(apiUrl, "/v1/videos"), { method: "POST", headers: authHeaders(context), body: JSON.stringify(payload) });
    if (failedStatus.includes(pickStatus(submitted))) invalid(context.tool.errorMessage(submitted) || "视频提交失败");
    const videoId = text(record(submitted).video_id);
    if (!videoId || videoId.length > 200) invalid("Agnes 未返回 video_id，提交结果待渠道核对，不能使用 task_id 重新生成");
    const pollUrl = new URL("/agnesapi", apiUrl);
    pollUrl.searchParams.set("video_id", videoId); pollUrl.searchParams.set("model_name", text(request.model));
    // 复用 videoSubmission 检查点；恢复仅查询同一 video_id，带有早期 URL 的非完成响应也继续等待。
    for (let attempt = 0; attempt < 360; attempt++) {
      context.signal?.throwIfAborted();
      if (attempt) await sleep(5, context.signal);
      const status = await readJson(context, pollUrl.href, { method: "GET", headers: authHeaders(context) });
      if (failedStatus.includes(pickStatus(status))) invalid(`视频生成失败：${context.tool.errorMessage(status) || pickStatus(status)}`);
      if (succeededStatus.includes(pickStatus(status))) {
        const url = text(record(status).url);
        if (!/^https?:\/\//i.test(url)) invalid("Agnes 视频任务已完成，但未返回有效结果地址");
        return [{ type: "url", url, mediaType: "video" }];
      }
    }
    invalid("Agnes 视频等待超时，可继续查询原任务；不要重新提交生成");
  }
  if (isSiliconFlow(apiUrl)) {
    if (/i2v/i.test(String(request.model)) && !firstFrame && !images.length) invalid("该视频模型需要首帧图片");
    if (lastFrame || videos.length || audios.length) invalid("硅基流动视频接口当前不支持尾帧、视频或音频参考");
    if (images.length > 1 || firstFrame && images.length) invalid("硅基流动视频接口只支持一张首帧图片");
    if (request.duration !== undefined || resolution || request.generateAudio === true) invalid("硅基流动视频接口不支持自定义时长、分辨率档位或音轨，请使用默认值");
    const ratio = text(request.ratio);
    const imageSize = size || ({ "16:9": "1280x720", "9:16": "720x1280", "1:1": "960x960" }[ratio]);
    if (imageSize && !["1280x720", "720x1280", "960x960"].includes(imageSize)) invalid("硅基流动视频支持 16:9、9:16 或 1:1 尺寸");
    const submitted = await submitVideo(context, channelUrl(apiUrl, "/v1/video/submit"), { method: "POST", headers: authHeaders(context), body: JSON.stringify({ model: request.model, prompt: request.prompt, ...(imageSize ? { image_size: imageSize } : {}), ...(firstFrame || images[0] ? { image: firstFrame || images[0] } : {}) }) });
    const taskId = pickTaskId(submitted);
    if (!taskId) invalid(context.tool.errorMessage(submitted) || "渠道未返回视频任务 ID");
    for (let attempt = 0; attempt < 360; attempt++) {
      if (attempt) await sleep(5, context.signal);
      const status = await readJson(context, channelUrl(apiUrl, "/v1/video/status"), { method: "POST", headers: authHeaders(context), body: JSON.stringify({ requestId: taskId }) });
      if (failedStatus.includes(pickStatus(status))) invalid(context.tool.errorMessage(status) || text(record(status).reason, "视频生成失败"));
      if (succeededStatus.includes(pickStatus(status))) {
        const url = pickUrl(record(status).results);
        if (!url) invalid("视频任务已完成，但未返回视频地址");
        return [{ type: "url", url, mediaType: "video" }];
      }
    }
    invalid("视频生成超时，请稍后重试");
  }
  const submitPath = text(context.config.submitPath, "/v1/videos");
  const pollPath = text(context.config.pollPath, "/v1/videos/{id}");
  const contentPath = text(context.config.contentPath);
  const submitted = await submitVideo(context, bind(apiUrl, submitPath, ""), { method: "POST", headers: authHeaders(context), body: JSON.stringify(body) });
  const failure = context.tool.errorMessage(submitted);
  if (failedStatus.includes(pickStatus(submitted))) invalid(failure || "视频提交失败");
  const immediate = pickUrl(submitted);
  if (immediate) return [{ type: "url", url: immediate, mediaType: "video" }];
  const taskId = pickTaskId(submitted);
  if (!taskId) invalid(failure || "渠道未返回视频任务 ID");
  const pollUrl = bind(apiUrl, pollPath, taskId);
  // 轮询上限 30 分钟；创作页保留任务响应，超时后可继续查询。
  for (let attempt = 0; attempt < 360; attempt++) {
    context.signal?.throwIfAborted();
    if (attempt) await sleep(5, context.signal);
    const status = await readJson(context, pollUrl, { method: "GET", headers: authHeaders(context) });
    if (failedStatus.includes(pickStatus(status))) invalid(`视频生成失败：${context.tool.errorMessage(status) || pickStatus(status)}`);
    const assetUrl = pickUrl(status);
    if (assetUrl) return [{ type: "url", url: assetUrl, mediaType: "video" }];
    if (contentPath && succeededStatus.includes(pickStatus(status))) return readMedia(context, bind(apiUrl, contentPath, taskId), { method: "GET", headers: authHeaders(context) }, "video");
  }
  invalid(failure || "视频生成超时，请稍后重试");
}

export async function runMediaChannel(kind: ChannelKind, context: ChannelContext, request: object, imageTransport?: MediaGenerationRequest["imageTransport"]): Promise<MediaAsset[]> {
  const protocol = text(context.config.protocol, "openai");
  if (protocol !== "openai") {
    const provider: Provider | undefined = mediaProviders.find(item => item.id === ({ apimart: "apiMart", minimax: "meta" }[protocol]));
    if (!provider) invalid("当前 API 格式尚未接入");
    const adapterContext = { ...context, config: { ...context.config, baseUrl: protocol === "apimart" ? channelUrl(channelBase(context), "/v1") : channelBase(context) } };
    if (kind === "image" && provider.generateImage) return provider.generateImage.call(adapterContext, request as ImageRequest);
    if (kind === "video" && provider.generateVideo) return provider.generateVideo.call(adapterContext, request as VideoRequest);
    if (kind === "audio" && provider.generateAudio) return provider.generateAudio.call(adapterContext, request as AudioRequest);
    invalid("当前 API 格式不支持该模型用途");
  }
  if (kind === "image") return generateImage(context, request, imageTransport);
  if (kind === "audio") return generateAudio(context, request);
  return generateVideo(context, request);
}
