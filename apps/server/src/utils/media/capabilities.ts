import { z } from "zod";
import type { MediaGenerationRequest } from "@toonflow/tools-scaffold/runtime";
import { getMediaCapabilityError } from "@toonflow/providers/mediaCapabilities";

const ratio = z.string().regex(/^[1-9]\d{0,3}:[1-9]\d{0,3}$/);
const option = z.string().trim().min(1).max(64);
const referenceMode = z.string().regex(/^(image|video|audio)Reference:([1-9]\d?|1\d{2}|2[0-4]\d|25[0-6])$/);
export const mediaCapabilitySchema = z.object({
  mode: z.array(z.union([z.enum(["text", "singleImage", "multiReference", "startEndRequired", "endFrameOptional", "startFrameOptional"]), z.array(referenceMode).min(1).max(3).refine(values => new Set(values.map(value => value.split(":")[0])).size === values.length, "每个参考类型只声明一次")])).max(64).refine(values => new Set(values.map(value => JSON.stringify(value))).size === values.length, "生成模式不能重复").optional(),
  imageSizes: z.array(option).max(100).optional(), imageRatios: z.array(ratio).max(100).optional(), videoRatios: z.array(ratio).max(100).optional(),
  imageSizeRange: z.strictObject({ min: z.number().int().min(1).max(8192), max: z.number().int().min(1).max(8192), step: z.number().int().min(1).max(8192) }).refine(value => value.min <= value.max && Math.ceil(value.min / value.step) * value.step <= value.max, "图片尺寸范围内须至少包含一个对齐尺寸").optional(),
  maxImageCount: z.number().int().min(1).max(10).optional(), imageReferenceLimit: z.number().int().min(0).max(64).optional(),
  imageQualities: z.array(z.enum(["low", "medium", "high"])).max(3).optional(),
  durationResolutionMap: z.array(z.object({ duration: z.array(z.number().finite().positive().max(3600)).max(256), resolution: z.array(option).max(100) })).max(64).optional(),
  audio: z.union([z.boolean(), z.literal("optional")]).optional(),
  voices: z.array(z.object({ title: z.string().max(256), voice: z.string().min(1).max(256) })).max(1000).optional(),
  audioFormats: z.array(option).max(64).optional(),
  audioSpeedRange: z.object({ min: z.number().finite().positive(), max: z.number().finite().positive() }).refine(value => value.max >= value.min).optional(),
});

function invalid(message: string): never { throw Object.assign(new Error(message), { status: 400 }); }

export function validateModelCapabilities(value: unknown, mediaType: "image" | "video" | "audio", request: MediaGenerationRequest) {
  const checked = mediaCapabilitySchema.safeParse(value);
  if (!checked.success) invalid("模型能力声明无效，请修正渠道模型配置");
  const error = getMediaCapabilityError(checked.data, mediaType, request);
  if (error) invalid(error);
}
