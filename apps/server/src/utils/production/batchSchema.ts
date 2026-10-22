import { z } from "zod";
import { imageGenerationSchema, videoGenerationSchema, audioGenerationSchema } from "@toonflow/tool-media-generation/runtime";
import { recordedMediaRequestSchema, relativePathSchema } from "./schema";
import { quoteSchema } from "../media/costSchema";
import type { MediaCostSummary } from "@toonflow/providers/mediaCosts";

const reference = z.strictObject({ assetId: z.uuid(), versionId: z.uuid(), role: z.string().max(200).optional() });
export const batchDependencySchema = z.strictObject({ itemId: z.uuid(), resultIndex: z.number().int().min(0).max(9), slot: z.enum(["images", "videos", "audios", "firstFrame", "lastFrame"]) });
export const batchItemInputSchema = z.strictObject({ itemId: z.uuid(), shotId: z.uuid(), mediaType: z.enum(["image", "video", "audio"]), request: z.union([imageGenerationSchema, videoGenerationSchema, audioGenerationSchema]), dependencies: z.array(batchDependencySchema).max(64) });
export const batchInputSchema = z.strictObject({ batchId: z.uuid(), name: z.string().trim().min(1).max(200), sequenceId: z.uuid(), expectedRevision: z.number().int().nonnegative(), items: z.array(batchItemInputSchema).min(1).max(200) });
export const batchSchema = z.strictObject({
  zeromuBatch: z.literal(true), format: z.literal(1), batchId: z.uuid(), projectId: z.uuid(), sequenceId: z.uuid(), name: z.string().min(1).max(200),
  directory: z.string().optional(), archived: z.boolean().optional(), createdAt: z.number().finite(), updatedAt: z.number().finite(), sourceRevision: z.number().int().nonnegative(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), state: z.enum(["ready", "running", "paused", "finished"]), error: z.string().max(10000).optional(),
  items: z.array(z.strictObject({
    itemId: z.uuid(), shotId: z.uuid(), title: z.string().max(200), canvasId: relativePathSchema.optional(), nodeId: z.string().max(256).optional(), directorShotId: z.uuid().optional(), taskId: z.uuid(), mediaType: z.enum(["image", "video", "audio"]),
    request: recordedMediaRequestSchema, quote: quoteSchema.optional(), providerRevision: z.string().regex(/^[a-f0-9]{64}$/), dependencies: z.array(batchDependencySchema).max(64), referenceVersions: z.array(reference).max(300), shotReferenceVersions: z.array(reference).max(100).optional(),
    resolvedRequest: recordedMediaRequestSchema.optional(), resolvedReferences: z.array(reference).max(300).optional(), dispatchedAt: z.number().finite().nonnegative().optional(), error: z.string().max(10000).optional(),
  })).min(1).max(200),
});
export type BatchInput = z.infer<typeof batchInputSchema>;
export type BatchRecord = z.infer<typeof batchSchema>;
export type BatchItem = BatchRecord["items"][number];
export type BatchView = Omit<BatchRecord, "directory" | "items" | "state"> & {
  state: BatchRecord["state"] | "interrupted" | "archived";
  items: (BatchItem & { status: string; reason?: string; task?: { id: string; status: string; resultCount: number; error?: string; canResume: boolean; collectionPending?: boolean; collectionError?: string } })[];
  counts: Record<string, number>;
  costSummary?: MediaCostSummary;
};
