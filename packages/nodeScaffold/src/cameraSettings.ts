import { z } from "zod";

export const cameraSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  framing: z.enum(["wide", "full", "medium", "close", "detail"]).default("medium"),
  angle: z.enum(["eye", "low", "high", "overhead"]).default("eye"),
  focalLength: z.enum(["24", "35", "50", "85", "135"]).default("50"),
  depth: z.enum(["natural", "shallow", "deep"]).default("natural"),
  motion: z.enum(["static", "push", "pull", "track", "pan", "handheld"]).default("static"),
});
export type CameraSettings = z.infer<typeof cameraSettingsSchema>;

export const cameraFields = [
  { key: "framing", label: "景别", options: [
    { value: "wide", label: "远景", prompt: "远景构图，交代环境与主体的位置关系" },
    { value: "full", label: "全景", prompt: "全景构图，完整呈现主体和动作空间" },
    { value: "medium", label: "中景", prompt: "中景构图，兼顾人物表情、动作与周边环境" },
    { value: "close", label: "近景", prompt: "近景构图，突出主体表情与情绪" },
    { value: "detail", label: "特写", prompt: "特写构图，集中呈现一个关键细节" },
  ] },
  { key: "angle", label: "视角", options: [
    { value: "eye", label: "平视", prompt: "平视机位" },
    { value: "low", label: "仰视", prompt: "低机位向上拍摄" },
    { value: "high", label: "俯视", prompt: "高机位向下拍摄" },
    { value: "overhead", label: "正俯拍", prompt: "垂直向下的正俯拍机位" },
  ] },
  { key: "focalLength", label: "等效焦距", options: [
    { value: "24", label: "24 mm · 广角", prompt: "24mm 等效广角观感，突出环境纵深" },
    { value: "35", label: "35 mm · 环境人像", prompt: "35mm 等效焦距观感，保留人物与环境关系" },
    { value: "50", label: "50 mm · 标准", prompt: "50mm 等效标准焦距观感，自然比例" },
    { value: "85", label: "85 mm · 人像", prompt: "85mm 等效中长焦观感，突出人物" },
    { value: "135", label: "135 mm · 长焦", prompt: "135mm 等效长焦观感，压缩前后景的视觉距离" },
  ] },
  { key: "depth", label: "景深", options: [
    { value: "natural", label: "自然景深", prompt: "自然景深，焦点落在叙事主体" },
    { value: "shallow", label: "浅景深", prompt: "浅景深，主体清晰，背景柔和虚化" },
    { value: "deep", label: "深景深", prompt: "深景深，前景、主体与背景保持可辨细节" },
  ] },
  { key: "motion", label: "运镜", options: [
    { value: "static", label: "固定机位", prompt: "固定机位，保持构图稳定" },
    { value: "push", label: "缓慢推进", prompt: "镜头平稳缓慢向主体推进" },
    { value: "pull", label: "缓慢拉远", prompt: "镜头缓慢拉远，逐步揭示周围环境" },
    { value: "track", label: "跟随主体", prompt: "镜头平稳跟随主体移动，保持主体在画面中的位置" },
    { value: "pan", label: "水平摇镜", prompt: "机位固定，镜头平缓水平转动以展示场景" },
    { value: "handheld", label: "轻微手持", prompt: "克制的轻微手持起伏，主体始终清晰可辨" },
  ] },
] as const;

export const cameraPresets: { id: string; label: string; settings: CameraSettings }[] = [
  { id: "establishing", label: "环境交代", settings: { enabled: true, framing: "wide", angle: "eye", focalLength: "24", depth: "deep", motion: "pan" } },
  { id: "dialogue", label: "人物对话", settings: { enabled: true, framing: "medium", angle: "eye", focalLength: "50", depth: "natural", motion: "static" } },
  { id: "emotion", label: "情绪近景", settings: { enabled: true, framing: "close", angle: "eye", focalLength: "85", depth: "shallow", motion: "push" } },
  { id: "hero", label: "角色登场", settings: { enabled: true, framing: "full", angle: "low", focalLength: "35", depth: "natural", motion: "push" } },
  { id: "detail", label: "道具特写", settings: { enabled: true, framing: "detail", angle: "eye", focalLength: "85", depth: "shallow", motion: "static" } },
  { id: "overhead", label: "俯拍布局", settings: { enabled: true, framing: "wide", angle: "overhead", focalLength: "35", depth: "deep", motion: "static" } },
];

export function readCameraSettings(value: unknown): CameraSettings {
  const parsed = cameraSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : cameraSettingsSchema.parse({});
}

export function cameraPrompt(value: unknown, video = false) {
  const settings = readCameraSettings(value);
  if (!settings.enabled) return "";
  const descriptions = cameraFields.filter(field => video || field.key !== "motion")
    .map(field => field.options.find(option => option.value === settings[field.key])?.prompt);
  return `镜头要求：${descriptions.filter(Boolean).join("；")}。这些要求仅用于画面呈现，不要在画面中添加摄影器材、参数文字或水印。`;
}

export function appendCameraPrompt(prompt: string, value: unknown, video = false) {
  // ACT: 每次提交从原始提示词组装，不回写编辑器；重试不会累积镜头描述。
  return prompt.trim() ? [prompt, cameraPrompt(value, video)].filter(Boolean).join("\n\n") : prompt;
}
