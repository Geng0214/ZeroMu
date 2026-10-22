import type { MediaCapabilities } from "./mediaCapabilities";

export type ChannelModelKind = "image" | "video" | "audio" | "text";
export type ChannelProtocol = "openai" | "apimart" | "minimax";
export const channelProtocolKinds: Record<ChannelProtocol, ChannelModelKind[]> = { openai: ["image", "video", "audio", "text"], apimart: ["image", "video"], minimax: ["video"] };

export function isSiliconFlow(apiUrl: string) {
  try { return ["api.siliconflow.cn", "api.siliconflow.com"].includes(new URL(apiUrl).hostname.toLowerCase()); }
  catch { return false; }
}

/** 2026-10-19 核对 Agnes 官方 /en/docs/agnes-image-25-flash、agnes-video-25(-flash)；只匹配实际网关和已记录型号。 */
export function getAgnesModelCapabilities(apiUrl: string, modelId: string): MediaCapabilities | undefined {
  try {
    const url = new URL(apiUrl);
    if (url.protocol !== "https:" || url.hostname !== "apihub.agnes-ai.com" || url.port || !["", "/v1"].includes(url.pathname.replace(/\/+$/, ""))) return;
  } catch { return; }
  if (["agnes-image-2.1-flash", "agnes-image-2.5-flash"].includes(modelId)) return {
    mode: ["text", "multiReference"], imageSizes: ["1K", "2K", "3K", "4K"],
    imageRatios: ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"], maxImageCount: 1,
  };
  if (!["agnes-video-2.5", "agnes-video-2.5-flash"].includes(modelId)) return;
  const flash = modelId.endsWith("-flash");
  return {
    mode: ["text", "singleImage", "startEndRequired", "endFrameOptional", "startFrameOptional",
      [`imageReference:${flash ? 5 : 8}`, "audioReference:3", ...(flash ? [] : ["videoReference:1"])]],
    durationResolutionMap: [{ duration: Array.from({ length: 9 }, (_, index) => index + 4), resolution: flash ? ["720P"] : ["720P", "1080P", "1K", "2K"] }],
    videoRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
  };
}

/** 按输出能力分类；向量、重排、识别不能当成对话或语音生成。 */
export function classifyChannelModel(model: { id: string; type?: unknown; sub_type?: unknown; output_modalities?: unknown; supported_endpoint_types?: unknown; unavailableReason?: string }, protocol: ChannelProtocol = "openai"): { type?: ChannelModelKind; unavailableReason?: string } {
  const id = model.id.toLowerCase();
  const subtype = String(model.sub_type ?? "").toLowerCase();
  if (/embedding|rerank/.test(subtype) || /embed|rerank|(?:^|\/)bge-/.test(id)) return { unavailableReason: "向量或重排序模型，当前创作功能不支持" };
  if (/speech-to-text|transcription|asr/.test(subtype) || /whisper|sensevoice|asr|xingchengsr/.test(id)) return { unavailableReason: "语音识别模型，不用于语音生成" };
  if (model.unavailableReason) return { unavailableReason: model.unavailableReason };
  let type: ChannelModelKind | undefined;
  if (/text-to-image|image-to-image/.test(subtype)) type = "image";
  else if (/text-to-video|image-to-video/.test(subtype)) type = "video";
  else if (/text-to-speech|tts/.test(subtype)) type = "audio";
  else if (subtype === "chat") type = "text";
  const output = Array.isArray(model.output_modalities) && model.output_modalities.length === 1 ? model.output_modalities[0] : model.type;
  if (!type && ["image", "video", "audio", "text"].includes(String(output))) type = output as ChannelModelKind;
  if (!type) {
    if (/(?:^|[\/_-])(?:video|sora|veo|kling|hunyuanvideo|wan\d*|hailuo|vidu|seedance|runway|minimax-h)(?=[\d.\/_-]|$)/.test(id)) type = "video";
    else if (/(?:tts|speech|cosyvoice|fishaudio|suno|music|chirp)/.test(id)) type = "audio";
    else if (!/image-text|image-to-text/.test(id) && /(?:^|[\/_-])(?:image|imagen|dall-e|flux|stable-diffusion|sdxl|sd\d|kolors|midjourney|ideogram|recraft|seedream|nano-banana)(?=[\d.\/_-]|$)/.test(id)) type = "image";
    else if (/(?:^|[\/_-])(?:agnes-\d|gpt|chatgpt|o[134](?:-|$)|claude|gemini|deepseek|qwen|glm|grok|llama|mistral|kimi)/.test(id)) type = "text";
    else if (protocol === "minimax") type = "video";
  }
  // 私有别名无法仅凭名称准确识别，保留在列表并说明原因，不能猜成文本。
  if (!type) return { unavailableReason: "接口未提供可识别的模型能力" };
  if (!channelProtocolKinds[protocol].includes(type)) return { unavailableReason: "当前 API 格式不支持此模型能力" };
  return { type };
}
