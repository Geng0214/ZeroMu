export const mediaCapabilityFields = ["mode", "imageSizes", "imageSizeRange", "imageRatios", "videoRatios", "maxImageCount", "imageReferenceLimit", "imageQualities", "durationResolutionMap", "audio", "voices", "audioFormats", "audioSpeedRange"] as const;

export type ImageSizeRange = { min: number; max: number; step: number };

export interface MediaCapabilities {
  mode?: unknown;
  imageSizes?: string[]; imageSizeRange?: ImageSizeRange; imageRatios?: string[]; videoRatios?: string[];
  maxImageCount?: number; imageReferenceLimit?: number; imageQualities?: ("low" | "medium" | "high")[];
  durationResolutionMap?: { duration: number[]; resolution: string[] }[];
  audio?: boolean | "optional"; voices?: { title: string; voice: string }[]; audioFormats?: string[]; audioSpeedRange?: { min: number; max: number };
}

export interface MediaCapabilityRequest {
  images?: readonly unknown[]; videos?: readonly unknown[]; audios?: readonly unknown[]; firstFrame?: unknown; lastFrame?: unknown;
  size?: string; ratio?: string; quality?: string; n?: number; voice?: string; format?: string; speed?: number;
  duration?: number; resolution?: string; generateAudio?: boolean; mode?: unknown;
}

export function getMediaCapabilityDeclarationError(model: MediaCapabilities, type: "image" | "video" | "audio") {
  if (model.mode === undefined) return;
  if (!Array.isArray(model.mode)) return "模型生成模式声明须为数组";
  const allowed = type === "image" ? ["text", "singleImage", "multiReference"] : type === "video" ? ["text", "singleImage", "startEndRequired", "endFrameOptional", "startFrameOptional"] : ["text"];
  if (model.mode.some(mode => Array.isArray(mode) ? type === "image" || mode.some(item => typeof item !== "string" || !(type === "audio" ? /^audioReference:\d+$/ : /^(image|video|audio)Reference:\d+$/).test(item)) : !allowed.includes(mode))) return `模型生成模式不适用于${{ image: "图片", video: "视频", audio: "音频" }[type]}入口，请检查能力声明`;
}

export function getMediaReferenceLimits(model: MediaCapabilities, type: "image" | "video" | "audio", selectedMode?: unknown): Record<"image" | "video" | "audio", number | undefined> {
  const modes = Array.isArray(model.mode) ? model.mode : [];
  if (type === "image") {
    const limit = model.imageReferenceLimit ?? (modes.includes("multiReference") ? undefined : modes.includes("singleImage") ? 1 : 0);
    return { image: modes.includes("singleImage") && !modes.includes("multiReference") ? Math.min(limit ?? 1, 1) : limit, video: 0, audio: 0 };
  }
  const options = selectedMode === undefined ? modes : modes.filter(mode => JSON.stringify(mode) === JSON.stringify(selectedMode));
  function maximum(kind: "image" | "video" | "audio") {
    return Math.max(0, ...options.map(mode => Array.isArray(mode) ? Number(mode.find(value => typeof value === "string" && value.startsWith(`${kind}Reference:`))?.split(":")[1] ?? 0)
      : kind !== "image" || type === "audio" ? 0 : mode === "singleImage" ? 1 : ["startEndRequired", "endFrameOptional", "startFrameOptional"].includes(mode) ? 2 : 0));
  }
  return { image: type === "audio" ? 0 : maximum("image"), video: type === "audio" ? 0 : maximum("video"), audio: maximum("audio") };
}

/** 工作站、节点和服务端共用同一参数检查；没有声明的可选参数使用渠道默认值。 */
export function getMediaCapabilityError(model: MediaCapabilities, type: "image" | "video" | "audio", request: MediaCapabilityRequest): string | undefined {
  const declarationError = getMediaCapabilityDeclarationError(model, type); if (declarationError) return declarationError;
  const images = request.images?.length ?? 0, videos = request.videos?.length ?? 0, audios = request.audios?.length ?? 0;
  const modes = Array.isArray(model.mode) ? model.mode : [];
  function supported(value: string | undefined, options: string[] | undefined, name: string) {
    if (value === undefined || value === "") return;
    if (!options?.length) return `当前模型未声明可调整的${name}，请使用渠道默认值或补全能力声明`;
    if (!options.includes(value)) return `当前模型不支持${name} ${value}；可选：${options.join("、")}`;
  }
  if (type === "image") {
    if (videos || audios || request.firstFrame || request.lastFrame) return "图片生成只接受已声明的图片参考";
    const sizeError = request.size !== undefined && model.imageSizeRange ? supportsImageSize(model, request.size) ? undefined : `图片尺寸须为已声明档位，或 ${model.imageSizeRange.min} 到 ${model.imageSizeRange.max} 像素且为 ${model.imageSizeRange.step} 的倍数` : supported(request.size, model.imageSizes, "图片尺寸");
    const optionError = sizeError || supported(request.ratio, model.imageRatios, "图片比例") || supported(request.quality, model.imageQualities, "画质档位"); if (optionError) return optionError;
    if (request.n !== undefined && (!Number.isInteger(request.n) || request.n < 1 || request.n > (model.maxImageCount ?? 1))) return `当前模型生成数量须为 1 到 ${model.maxImageCount ?? 1} 的整数；未声明数量上限时一次生成一张`;
    const limit = getMediaReferenceLimits(model, type).image;
    if (limit !== undefined && images > limit) return limit ? `当前模型最多支持 ${limit} 张图片参考` : "当前模型未声明图片参考能力";
    if (!images && modes.length && !modes.includes("text")) return "当前模型需要图片参考，请先添加参考图片";
    return;
  }
  if (type === "audio") {
    if (images || videos || request.firstFrame || request.lastFrame) return "当前语音生成入口不接受图片、视频或首尾帧参考";
    if (audios > (getMediaReferenceLimits(model, type).audio ?? 0)) return "当前模型未声明足够的参考音频能力";
    if (!audios && modes.length && !modes.includes("text")) return "当前模型需要参考音频，请先添加当前模式需要的参考";
    if (model.voices?.length && !request.voice) return "请选择当前模型已声明的音色，避免使用不确定的默认音色";
    const optionError = supported(request.voice, model.voices?.map(item => item.voice), "音色") || supported(request.format, model.audioFormats, "音频格式"); if (optionError) return optionError;
    if (request.speed !== undefined) { if (!model.audioSpeedRange) return "当前模型未声明可调整语速，请使用渠道默认值"; if (!Number.isFinite(request.speed) || request.speed < model.audioSpeedRange.min || request.speed > model.audioSpeedRange.max) return `当前模型语速范围为 ${model.audioSpeedRange.min} 到 ${model.audioSpeedRange.max}`; }
    return;
  }
  const ratioError = supported(request.ratio, model.videoRatios, "视频比例"); if (ratioError) return ratioError;
  const pairs = model.durationResolutionMap;
  if (request.duration !== undefined) { if (!pairs?.length) return "当前模型未声明可调整的视频时长，请使用渠道默认值"; if (!pairs.some(item => item.duration.includes(request.duration!))) return "视频时长超出当前模型能力，请重新选择"; }
  if (request.resolution !== undefined && request.resolution !== "") { if (!pairs?.length) return "当前模型未声明可调整的视频分辨率，请使用渠道默认值"; if (!pairs.some(item => item.resolution.includes(request.resolution!) && (request.duration === undefined || item.duration.includes(request.duration)))) return "时长与分辨率组合不受当前模型支持"; }
  if (request.generateAudio !== undefined && (model.audio === undefined || typeof model.audio === "boolean" && model.audio !== request.generateAudio)) return "当前模型不支持此声音设置，请按模型声明选择";
  const hasReferences = images + videos + audios + Number(!!request.firstFrame) + Number(!!request.lastFrame) > 0;
  const mode = request.mode;
  if (mode === undefined) { if (hasReferences) return "生成带参考的视频前，请选择模型已声明的参考模式"; if (modes.length && !modes.includes("text")) return "当前模型需要参考输入，请选择已声明的生成模式"; return; }
  if (!modes.some(item => JSON.stringify(item) === JSON.stringify(mode))) return "当前模型未声明此视频生成模式";
  if (Array.isArray(mode)) { if (!hasReferences || request.firstFrame || request.lastFrame) return "媒体参考模式需要参考素材，首尾帧应使用独立的首尾帧模式"; const limits = getMediaReferenceLimits(model, type, mode); for (const [kind, count] of Object.entries({ image: images, video: videos, audio: audios })) { const limit = limits[kind as keyof typeof limits] ?? 0; if (count > limit) return `当前模式最多支持 ${limit} 个${{ image: "图片", video: "视频", audio: "音频" }[kind as "image" | "video" | "audio"]}参考`; } return; }
  if (mode === "text") { if (hasReferences) return "文生视频模式不接受参考素材"; return; }
  if (videos || audios) return "首尾帧模式只接受图片参考";
  if (mode === "singleImage") { if (images !== 1 || request.firstFrame || request.lastFrame) return "单图模式需要一张图片参考"; return; }
  if (images) return "首尾帧请使用 firstFrame 和 lastFrame 字段";
  if (mode === "startEndRequired" && (!request.firstFrame || !request.lastFrame)) return "当前模式需要首帧和尾帧";
  if (mode === "endFrameOptional" && !request.firstFrame) return "当前模式需要首帧";
  if (mode === "startFrameOptional" && !request.lastFrame) return "当前模式需要尾帧";
}

/** 精确档位与显式声明的像素范围可以并存；缺少声明不推断任意尺寸。 */
export function supportsImageSize(model: { imageSizes?: readonly string[]; imageSizeRange?: ImageSizeRange }, value: string) {
  if (model.imageSizes?.includes(value)) return true;
  const range = model.imageSizeRange;
  if (!range || !/^\d+x\d+$/.test(value)) return false;
  return value.split("x").map(Number).every(edge => Number.isSafeInteger(edge) && edge >= range.min && edge <= range.max && edge % range.step === 0);
}
