import { z } from "zod";

export const scopeSchema = z.object({ directory: z.string().max(4096), kind: z.enum(["image", "video", "audio"]) });
export const fileHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const revisionSchema = z.string().regex(/^(?:[a-f0-9]{64})?$/);
export const draftSchema = z.object({
  fields: z.record(z.string().max(64), z.union([z.string().max(2_000_000), z.number().finite(), z.boolean(), z.null()]))
    .refine(value => Object.keys(value).length <= 64, "草稿参数过多"),
  references: z.array(z.object({
    id: z.uuid(), kind: scopeSchema.shape.kind, name: z.string().max(512), fileHash: fileHashSchema,
    mimeType: z.string().max(200), size: z.number().int().positive().max(100 * 1024 ** 2),
    paths: z.record(z.string().max(4096), z.string().regex(/^(?:studioReferences|references\/studio)\/[a-f0-9-]{36}$/i)).optional(),
  }).refine(value => value.mimeType.startsWith(`${value.kind}/`) && (value.kind !== "audio" || value.size <= 15 * 1024 ** 2), "草稿参考的类型或大小无效")).max(192),
  savedAt: z.number().int().nonnegative(),
});
export type StudioDraftData = z.infer<typeof draftSchema>;

export const storedDraftSchema = z.object({ schemaVersion: z.literal(1), value: draftSchema });
