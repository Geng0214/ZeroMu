import { z } from "zod";
import { imageGenerationSchema, videoGenerationSchema, audioGenerationSchema } from "@toonflow/tool-media-generation/runtime";

export const relativePathSchema = z.string().min(1).max(2048).refine(path => !/^[\\/]|[:\u0000-\u001f]/.test(path) && path.split(/[\\/]/).every(part => part && part !== "." && part !== ".."), "必须是项目内相对路径");
const id = z.uuid();
const name = z.string().trim().min(1).max(200);
const timestamp = z.number().finite().nonnegative();
// ACT: 制作模板功能已移除。老项目的 zeromuProject.json 里可能仍有 templateApplications，读出来只为做重复与引用校验，不再写入新记录，故用宽松对象保留未知字段，避免历史项目打不开。
const templateApplicationRecordSchema = z.looseObject({ applicationId: id, sequenceId: id, versionIds: z.array(id).max(128) });
const referenceSchema = z.strictObject({ assetId: id, versionId: id, role: z.string().max(200).optional() });
const mediaFileSchema = z.strictObject({ path: relativePathSchema, mimeType: z.string().min(1).max(200), view: z.string().max(100).optional(), hash: z.string().regex(/^[a-f0-9]{64}$/) });
const fileRecoveryRecordSchema = z.strictObject({ recoveryId: id, versionId: id, fileIndex: z.number().int().min(0).max(63), sourcePath: relativePathSchema, hash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: timestamp });
export const restoreVersionFileSchema = z.strictObject({ type: z.literal("restoreVersionFile"), recoveryId: id, versionId: id, fileIndex: z.number().int().min(0).max(63), path: relativePathSchema, expectedHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: timestamp });
export type FileRecoveryOperation = z.infer<typeof restoreVersionFileSchema>;
export type VersionFileInspection = { projectId: string; revision: number; versionId: string; files: { index: number; path: string; mimeType: string; view?: string; hash: string; status: "available" | "missing" | "changed" | "unreadable"; message: string }[] };
export type PreparedFileRecovery = { projectId: string; revision: number; operation: FileRecoveryOperation; bytes: number; alreadyPresent: boolean };
const outputSchema = z.strictObject({ width: z.number().int().min(64).max(8192), height: z.number().int().min(64).max(8192), frameRate: z.number().int().min(1).max(120) });
// 用户提交仍使用工具的严格输入；历史依据另外保留服务端冻结的传输参数。
export const recordedMediaRequestSchema = z.union([imageGenerationSchema.extend({ imageTransport: z.strictObject({ streamImages: z.boolean(), codexCli: z.boolean(), returnBase64: z.boolean().optional() }).optional() }), videoGenerationSchema, audioGenerationSchema]);

export const shotInputSchema = z.strictObject({
  title: name, story: z.string().max(100000), dialogue: z.string().max(100000), expectedDuration: z.number().finite().positive().max(3600),
  canvasId: relativePathSchema.optional(), nodeId: z.string().min(1).max(256).optional(), references: z.array(referenceSchema).max(100),
});
const shotSchema = shotInputSchema.extend({ shotId: id, sequenceId: id, candidateIds: z.array(id).max(10000), adoptedCandidateId: id.optional(), directorShotId: id.optional(), archived: z.boolean().optional() });
export const assetKindSchema = z.enum(["character", "scene", "prop", "image", "video", "audio", "text"]);
export const libraryTargetSchema = z.discriminatedUnion("mode", [z.strictObject({ mode: z.literal("new"), kind: assetKindSchema, name }), z.strictObject({ mode: z.literal("version"), assetId: id, parentVersionId: id.optional() })]);
export const librarySourceSchema = z.strictObject({ path: relativePathSchema, hash: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative().max(100 * 1024 * 1024), mimeType: z.string().min(1).max(200), metadata: z.strictObject({ title: z.string().max(200), description: z.string().max(4000), category: z.string().max(100), tags: z.array(z.string().min(1).max(50)).max(30), source: z.string().max(1000) }) });
export const importLibraryAssetSchema = z.strictObject({ type: z.literal("importLibraryAsset"), importId: id, createdAt: timestamp, source: librarySourceSchema, target: libraryTargetSchema });
export type LibraryImportOperation = z.infer<typeof importLibraryAssetSchema>;
export type LibraryImportPreview = { projectId: string; revision: number; operation: LibraryImportOperation; frozen: boolean; warning: string };
const libraryImportRecordSchema = z.strictObject({ importId: id, inputHash: z.string().regex(/^[a-f0-9]{64}$/), assetId: id, versionId: id, createdAt: timestamp, source: librarySourceSchema });
const assetSchema = z.strictObject({ assetId: id, kind: assetKindSchema, name, versionIds: z.array(id).max(10000), activeVersionId: id.optional(), archived: z.boolean().optional() });
export const versionSchema = z.strictObject({
  versionId: id, assetId: id, parentVersionId: id.optional(), createdAt: timestamp, files: z.array(mediaFileSchema).max(64),
  text: z.string().max(100000), description: z.string().max(10000), details: z.record(z.string(), z.json()),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), source: z.enum(["import", "generation", "edit", "director"]), taskId: id.optional(),
});
const candidateSchema = z.strictObject({
  candidateId: id, shotId: id, versionId: id, taskId: id.optional(), parentCandidateId: id.optional(), createdAt: timestamp,
  fileIndex: z.number().int().min(0).max(63).optional(),
  basis: z.strictObject({ references: z.array(referenceSchema).max(100), shotReferences: z.array(referenceSchema).max(100).optional(), request: recordedMediaRequestSchema.optional(), directorShotId: id.optional(), unknown: z.boolean() }),
});
export const imageEditParametersSchema = z.strictObject({
  crop: z.strictObject({ x: z.number().int().nonnegative().max(8191), y: z.number().int().nonnegative().max(8191), width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192) }),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  output: z.strictObject({ width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192) }).refine(value => value.width * value.height <= 16777216, "输出最多 1677 万像素"),
});
export type ImageEditParameters = z.infer<typeof imageEditParametersSchema>;
export type ImageEditContext = { contextId: string; projectId: string; revision: number; sourceCandidateId: string; sourceVersionId: string; width: number; height: number; preview: string };
export const editSchema = z.strictObject({
  sequenceId: id, clips: z.array(z.strictObject({ shotId: id, candidateId: id, inSeconds: z.number().finite().nonnegative(), outSeconds: z.number().finite().positive(), originalVolume: z.number().finite().min(0).max(4).optional() })).max(10000),
  audio: z.array(z.strictObject({ versionId: id, fileIndex: z.number().int().min(0).max(63).optional(), role: z.enum(["narration", "music"]).optional(), offsetSeconds: z.number().finite().nonnegative(), volume: z.number().finite().min(0).max(4) })).max(1000),
  subtitles: z.array(z.strictObject({ text: z.string().max(10000), startSeconds: z.number().finite().nonnegative(), endSeconds: z.number().finite().positive() })).max(10000),
  output: outputSchema,
});
export const projectSchema = z.strictObject({
  zeromuProject: z.literal(true), schemaVersion: z.literal(1), projectId: id, name, revision: z.number().int().nonnegative(), createdAt: timestamp, updatedAt: timestamp,
  canvases: z.array(z.strictObject({ canvasId: relativePathSchema, name })).max(10000),
  sequences: z.array(z.strictObject({ sequenceId: id, name, shotIds: z.array(id).max(10000), output: outputSchema, archived: z.boolean().optional() })).max(1000),
  shots: z.array(shotSchema).max(10000), assets: z.array(assetSchema).max(10000), assetVersions: z.array(versionSchema).max(100000), candidates: z.array(candidateSchema).max(100000),
  adoptionHistory: z.array(z.strictObject({ adoptionId: id, shotId: id, candidateId: id.optional(), previousCandidateId: id.optional(), undoOfAdoptionId: id.optional(), createdAt: timestamp })).max(100000),
  directorBindings: z.array(z.strictObject({ bindingId: id, shotId: id, canvasId: relativePathSchema, nodeId: z.string().min(1).max(256), anchorId: z.string().min(1).max(256) })).max(10000).default([]),
  directorShots: z.array(z.strictObject({ directorShotId: id, shotId: id, sceneVersionId: id, cameraSnapshot: z.json(), createdAt: timestamp,
    canvasId: relativePathSchema.optional(), nodeId: z.string().min(1).max(256).optional(), anchorId: z.string().min(1).max(256).optional(), name: name.optional(),
    stateHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), mediaType: z.enum(["image", "video"]).optional(), referenceVersionId: id.optional(),
    status: z.enum(["pending", "completed"]).optional(), mediaSourcePath: relativePathSchema.optional(), mediaHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })).max(10000),
  edits: z.array(editSchema).max(1000),
  exports: z.array(z.strictObject({ exportId: id, edit: editSchema, status: z.enum(["pending", "completed", "failed"]), createdAt: timestamp, path: relativePathSchema.optional(), actualDuration: z.number().finite().nonnegative().optional(), error: z.string().max(10000).optional(), manifestPath: relativePathSchema.optional(), partialPath: relativePathSchema.optional(), outputHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), totalFrames: z.number().int().positive().optional() })).max(10000),
  snapshots: z.array(z.strictObject({ snapshotId: id, name, revision: z.number().int().nonnegative(), createdAt: timestamp, path: relativePathSchema })).max(10000),
  storyboardDrafts: z.array(z.strictObject({ draftId: id, name, shots: z.array(shotInputSchema).min(1).max(500), createdAt: timestamp, source: z.enum(["user", "agent"]), acceptedSequenceId: id.optional() })).max(1000),
  templateApplications: z.array(templateApplicationRecordSchema).max(1000).optional(),
  fileRecoveries: z.array(fileRecoveryRecordSchema).max(10000).optional(),
  libraryImports: z.array(libraryImportRecordSchema).max(10000).optional(),
}).superRefine((project, context) => {
  function issue(message: string) { context.addIssue({ code: "custom", message }); }
  function index<T>(items: T[], key: (item: T) => string, label: string) {
    const map = new Map(items.map(item => [key(item), item]));
    if (map.size !== items.length) issue(`${label}标识重复`);
    return map;
  }
  const shots = index(project.shots, item => item.shotId, "镜头");
  const sequences = index(project.sequences, item => item.sequenceId, "制作单元");
  const assets = index(project.assets, item => item.assetId, "素材");
  const versions = index(project.assetVersions, item => item.versionId, "素材版本");
  const candidates = index(project.candidates, item => item.candidateId, "候选");
  const applications = index(project.templateApplications ?? [], item => item.applicationId, "模板应用");
  for (const application of applications.values()) if (!sequences.has(application.sequenceId) || application.versionIds.some(id => !versions.has(id))) issue("模板应用缺少制作单元或固定版本");
  const fileRecoveries = index(project.fileRecoveries ?? [], item => item.recoveryId, "文件恢复");
  for (const recovery of fileRecoveries.values()) if (versions.get(recovery.versionId)?.files[recovery.fileIndex]?.hash !== recovery.hash) issue("文件恢复缺少对应的固定文件摘要");
  const libraryImports = index(project.libraryImports ?? [], item => item.importId, "全局素材带入");
  for (const receipt of libraryImports.values()) if (versions.get(receipt.versionId)?.assetId !== receipt.assetId || versions.get(receipt.versionId)?.files[0]?.hash !== receipt.source.hash) issue("全局素材带入缺少对应的固定版本");
  const directors = index(project.directorShots, item => item.directorShotId, "机位");
  index(project.canvases, item => item.canvasId, "画布"); index(project.snapshots, item => item.snapshotId, "快照"); index(project.storyboardDrafts, item => item.draftId, "分镜草案"); index(project.exports, item => item.exportId, "导出");
  function checkReference(reference: z.infer<typeof referenceSchema>) {
    if (versions.get(reference.versionId)?.assetId !== reference.assetId) issue("参考版本与素材不匹配");
  }
  for (const sequence of project.sequences) {
    if (new Set(sequence.shotIds).size !== sequence.shotIds.length || sequence.shotIds.some(id => shots.get(id)?.sequenceId !== sequence.sequenceId || shots.get(id)?.archived)) issue("镜头顺序重复或归属错误");
  }
  for (const shot of project.shots) {
    if (!sequences.has(shot.sequenceId) || !shot.archived && !sequences.get(shot.sequenceId)?.shotIds.includes(shot.shotId)) issue("镜头未登记到所属制作单元");
    if (new Set(shot.candidateIds).size !== shot.candidateIds.length || shot.candidateIds.some(id => candidates.get(id)?.shotId !== shot.shotId)) issue("镜头候选归属错误");
    if (shot.adoptedCandidateId && !shot.candidateIds.includes(shot.adoptedCandidateId)) issue("采用结果不属于此镜头");
    if (shot.directorShotId && directors.get(shot.directorShotId)?.shotId !== shot.shotId) issue("机位不属于此镜头");
    shot.references.forEach(checkReference);
    if (!shot.archived && shot.references.some(reference => assets.get(reference.assetId)?.archived)) issue("活动镜头不能引用已归档素材");
  }
  for (const asset of project.assets) {
    if (new Set(asset.versionIds).size !== asset.versionIds.length || asset.versionIds.some(id => versions.get(id)?.assetId !== asset.assetId)) issue("素材版本归属错误");
    if (asset.activeVersionId && !asset.versionIds.includes(asset.activeVersionId)) issue("当前素材版本未登记");
  }
  for (const version of project.assetVersions) {
    if (!assets.get(version.assetId)?.versionIds.includes(version.versionId)) issue("版本未登记到所属素材");
    if (version.parentVersionId && versions.get(version.parentVersionId)?.assetId !== version.assetId) issue("父版本不属于同一素材");
    if (version.files.some(file => !file.path.startsWith(`assets/production/${version.versionId}/`) && !file.path.startsWith(`references/versions/${version.versionId}/`))) issue("版本文件须保存在独立版本目录");
  }
  for (const candidate of project.candidates) {
    if (!shots.get(candidate.shotId)?.candidateIds.includes(candidate.candidateId) || !versions.has(candidate.versionId)) issue("候选缺少镜头或媒体版本");
    if (candidate.parentCandidateId && candidates.get(candidate.parentCandidateId)?.shotId !== candidate.shotId) issue("父候选不属于同一镜头");
    candidate.basis.references.forEach(checkReference);
    candidate.basis.shotReferences?.forEach(checkReference);
    if (candidate.basis.directorShotId && directors.get(candidate.basis.directorShotId)?.shotId !== candidate.shotId) issue("候选机位依据不属于此镜头");
    if (candidate.fileIndex !== undefined && !/^(image|video|audio)\//.test(versions.get(candidate.versionId)?.files[candidate.fileIndex]?.mimeType || "")) issue("候选指定的媒体文件不可用");
  }
  const adoptions = index(project.adoptionHistory, item => item.adoptionId, "采用记录");
  for (const adoption of project.adoptionHistory) {
    if (!shots.has(adoption.shotId) || [adoption.candidateId, adoption.previousCandidateId].some(id => id && candidates.get(id)?.shotId !== adoption.shotId)) issue("采用历史不属于此镜头");
    if (adoption.undoOfAdoptionId && adoptions.get(adoption.undoOfAdoptionId)?.shotId !== adoption.shotId) issue("撤销记录不属于此镜头");
  }
  const bindings = index(project.directorBindings, item => item.bindingId, "机位绑定");
  if (new Set([...bindings.values()].map(item => JSON.stringify([item.canvasId, item.nodeId, item.anchorId]))).size !== bindings.size) issue("机位绑定重复");
  for (const binding of bindings.values()) if (!shots.has(binding.shotId)) issue("机位绑定缺少镜头");
  for (const director of project.directorShots) {
    if (!shots.has(director.shotId) || !versions.has(director.sceneVersionId)) issue("机位缺少镜头或场景版本");
    if (director.referenceVersionId && !versions.has(director.referenceVersionId)) issue("机位参考版本不存在");
  }
  for (const draft of project.storyboardDrafts) { draft.shots.forEach(shot => shot.references.forEach(checkReference)); if (draft.acceptedSequenceId && !sequences.has(draft.acceptedSequenceId)) issue("分镜草案采用单元缺失"); }
  for (const edit of [...project.edits, ...project.exports.map(record => record.edit)]) {
    if (!sequences.has(edit.sequenceId)) issue("剪辑决定所属单元不存在");
    for (const clip of edit.clips) if (shots.get(clip.shotId)?.sequenceId !== edit.sequenceId || candidates.get(clip.candidateId)?.shotId !== clip.shotId || clip.outSeconds <= clip.inSeconds) issue("剪辑片段归属或截取范围错误");
    for (const audio of edit.audio) if (!versions.has(audio.versionId)) issue("剪辑音轨版本不存在");
    for (const subtitle of edit.subtitles) if (subtitle.endSeconds <= subtitle.startSeconds) issue("字幕时间范围错误");
  }
});

export type ProjectRecord = z.infer<typeof projectSchema>;
export type ShotRecord = ProjectRecord["shots"][number];
export type AssetVersion = ProjectRecord["assetVersions"][number];
export type EditRecord = z.infer<typeof editSchema>;
export type ExportRecord = ProjectRecord["exports"][number];
export type ProductionSelection = { projectId: string; revision: number; shotId: string; candidateId: string; versionId: string; fileIndex: number; canvasId?: string; nodeId?: string; file: AssetVersion["files"][number]; basis: ProjectRecord["candidates"][number]["basis"]; taskId?: string };

export const transferSourceSchema = z.strictObject({
  resultId: z.string().min(1).max(256), taskId: id.optional(), path: relativePathSchema,
  mimeType: z.string().regex(/^(image|video|audio)\/[a-zA-Z0-9.+-]+$/), mediaType: z.enum(["image", "video", "audio"]),
  prompt: z.string().max(100000), request: recordedMediaRequestSchema.optional(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  modelLabel: z.string().max(1000).optional(),
});
export const transferTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("canvas"), canvasId: relativePathSchema.optional() }),
  z.strictObject({ kind: z.literal("shot"), shotId: id }),
]);
export type ProductionTransferSource = z.infer<typeof transferSourceSchema>;
export type ProductionTransferTarget = z.infer<typeof transferTargetSchema>;
export type ProductionTransferReceipt = { transferId: string; createdAt: number; status: "pending" | "completed"; source: ProductionTransferSource; target: ProductionTransferTarget; canvasId?: string; nodeId?: string; candidateId?: string };

export const operationSchema = z.discriminatedUnion("type", [
  restoreVersionFileSchema,
  importLibraryAssetSchema,
  z.strictObject({ type: z.literal("editImageCandidate"), editId: id, contextId: id, parameters: imageEditParametersSchema }),
  z.strictObject({ type: z.literal("addBackgroundRemovedCandidate"), contextId: id, taskId: id }),
  z.strictObject({ type: z.literal("registerCanvas"), canvasId: relativePathSchema, name }),
  z.strictObject({ type: z.literal("importCandidate"), importId: id, createdAt: timestamp, shotId: id, source: transferSourceSchema }),
  z.strictObject({ type: z.literal("addSequence"), name, output: outputSchema.optional() }),
  z.strictObject({ type: z.literal("saveShot"), sequenceId: id, shotId: id.optional(), shot: shotInputSchema }),
  z.strictObject({ type: z.literal("reorderShots"), sequenceId: id, shotIds: z.array(id).max(10000) }),
  z.strictObject({ type: z.literal("deleteShot"), shotId: id, confirmReferences: z.boolean() }),
  z.strictObject({ type: z.literal("createAsset"), name, kind: assetKindSchema }),
  z.strictObject({ type: z.literal("renameAsset"), assetId: id, name }),
  z.strictObject({ type: z.literal("deleteAsset"), assetId: id }),
  z.strictObject({ type: z.literal("replaceShotReferences"), assetId: id, versionId: id, shotIds: z.array(id).min(1).max(10000).refine(values => new Set(values).size === values.length, "镜头编号不能重复") }),
  z.strictObject({ type: z.literal("createAssetVersion"), assetId: id, parentVersionId: id.optional(), files: z.array(mediaFileSchema.omit({ hash: true })).max(64), text: z.string().max(100000), description: z.string().max(10000), details: z.record(z.string(), z.json()), source: z.enum(["import", "generation", "edit", "director"]), taskId: id.optional() }),
  z.strictObject({ type: z.literal("recoverAssetVersion"), versionId: id }),
  z.strictObject({ type: z.literal("addCandidate"), shotId: id, versionId: id, fileIndex: candidateSchema.shape.fileIndex, taskId: id.optional(), parentCandidateId: id.optional(), basis: candidateSchema.shape.basis }),
  z.strictObject({ type: z.literal("adoptCandidate"), shotId: id, candidateId: id, confirmReferenceChanges: z.boolean().optional() }),
  z.strictObject({ type: z.literal("undoAdoption"), shotId: id, adoptionId: id, confirmReferenceChanges: z.boolean().optional() }),
  z.strictObject({ type: z.literal("bindDirector"), canvasId: relativePathSchema, nodeId: z.string().min(1).max(256), anchorId: z.string().min(1).max(256), shotId: id.optional() }),
  z.strictObject({ type: z.literal("reserveDirectorCapture"), captureId: id, createdAt: timestamp, canvasId: relativePathSchema, nodeId: z.string().min(1).max(256), anchorId: z.string().min(1).max(256), shotId: id, stateHash: z.string().regex(/^[a-f0-9]{64}$/), mediaType: z.enum(["image", "video"]) }),
  z.strictObject({ type: z.literal("finishDirectorCapture"), captureId: id, mediaPath: relativePathSchema, mediaHash: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.strictObject({ type: z.literal("snapshot"), name }),
  z.strictObject({ type: z.literal("restoreSnapshot"), snapshotId: id }),
  z.strictObject({ type: z.literal("saveEdit"), edit: editSchema }),
]);
export type ProductionOperation = z.infer<typeof operationSchema>;
