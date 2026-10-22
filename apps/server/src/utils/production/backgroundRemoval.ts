import { createHash } from "node:crypto";
import type { MediaGenerationRequest, MediaTaskSource } from "@toonflow/tools-scaffold/runtime";
import { getTask } from "@/utils/media/tasks";
import { createVersion, readProjectFile, stableId, verifyVersion } from "./index";
import { imageCandidateSource, readImageEditContext } from "./image";
import type { ProductionOperation, ProjectRecord } from "./schema";

type BackgroundOperation = Extract<ProductionOperation, { type: "addBackgroundRemovedCandidate" }>;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const candidateIdFor = (taskId: string) => stableId(`${taskId}:backgroundCandidate`);
function fail(message: string): never { throw Object.assign(new Error(message), { status: 409 }); }

async function fixedSource(directory: string, project: ProjectRecord, contextId: string) {
  const context = await readImageEditContext(directory, contextId);
  const source = imageCandidateSource(project, context.sourceCandidateId);
  if (context.projectId !== project.projectId || context.sourceVersionId !== source.version.versionId || context.sourceFileIndex !== source.fileIndex || context.sourceHash !== source.file.hash) fail("背景移除的固定原图与候选不匹配，请重新打开编辑器");
  await verifyVersion(directory, source.version);
  const inputPath = `productionImageEdits/${contextId}/source.png`;
  if (digest(await readProjectFile(directory, inputPath)) !== context.normalizedHash) fail("背景移除的固定输入已改变，请保留文件并重新打开编辑器");
  return { context, source, inputPath };
}

export async function backgroundRemovalTaskSource(directory: string, project: ProjectRecord | null, source: MediaTaskSource, request: MediaGenerationRequest): Promise<MediaTaskSource> {
  if (!source.imageEdit) return source;
  if (!project || source.kind !== "studio" || source.directorShotId || source.batchId || source.canvasId || source.nodeId) fail("背景移除任务来源不受支持");
  const fixed = await fixedSource(directory, project, source.imageEdit.contextId);
  if (source.imageEdit.sourceCandidateId !== fixed.source.candidate.candidateId || source.shotId && source.shotId !== fixed.source.shot.shotId) fail("背景移除任务的原候选或镜头不匹配");
  if (request.providerId !== "biRefNet" || request.modelId !== "biRefNetTiny" || request.n !== 1 || request.images?.length !== 1 || request.images[0]?.path !== fixed.inputPath || request.images[0]?.mimeType !== "image/png") fail("背景移除需要使用本机模型和编辑器准备的单张固定原图");
  return { ...source, projectId: project.projectId, shotId: fixed.source.shot.shotId };
}

export function existingBackgroundRemoval(project: ProjectRecord, operation: BackgroundOperation) {
  const candidate = project.candidates.find(item => item.candidateId === candidateIdFor(operation.taskId));
  if (!candidate) return;
  const version = project.assetVersions.find(item => item.versionId === candidate.versionId);
  const details = version?.details.backgroundRemoval as { contextId?: string; taskId?: string } | undefined;
  if (!version || details?.contextId !== operation.contextId || details.taskId !== operation.taskId) fail("背景移除任务标识已用于其他候选");
  return { candidate, version };
}

export async function applyBackgroundRemoval(directory: string, project: ProjectRecord, operation: BackgroundOperation) {
  const fixed = await fixedSource(directory, project, operation.contextId);
  const task = await getTask(operation.taskId, directory);
  const edit = task.source.imageEdit;
  if (task.mediaType !== "image" || task.status !== "completed" || edit?.contextId !== operation.contextId || edit.sourceCandidateId !== fixed.source.candidate.candidateId || task.source.shotId !== fixed.source.shot.shotId || task.source.projectId !== project.projectId || task.results.length !== 1) fail("背景移除结果尚未完成，或不属于此原图和镜头");
  await backgroundRemovalTaskSource(directory, project, task.source, task.request);
  const result = task.results[0]!; const bytes = await readProjectFile(directory, result.path);
  if (result.mimeType !== "image/png" || result.mediaType !== "image" || !result.contentHash || digest(bytes) !== result.contentHash || bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes[25] !== 6 || bytes.readUInt32BE(16) !== fixed.context.width || bytes.readUInt32BE(20) !== fixed.context.height) fail("背景移除结果不是与原图同尺寸的完整透明 PNG，请保留任务和文件检查");
  const candidateId = candidateIdFor(task.id);
  const version = await createVersion(directory, {
    type: "createAssetVersion", assetId: fixed.source.version.assetId, parentVersionId: fixed.source.version.versionId,
    files: [{ path: result.path, mimeType: "image/png", view: "背景移除" }], text: fixed.source.version.text,
    description: `本机背景移除 · ${fixed.context.width}×${fixed.context.height} · 透明 PNG`,
    details: { ...fixed.source.version.details, backgroundRemoval: { schemaVersion: 1, taskId: task.id, contextId: operation.contextId, sourceCandidateId: fixed.source.candidate.candidateId, sourceVersionId: fixed.source.version.versionId, sourceFileIndex: fixed.source.fileIndex, sourceHash: fixed.source.file.hash, inputHash: fixed.context.normalizedHash, inputPath: fixed.inputPath, width: fixed.context.width, height: fixed.context.height, request: JSON.parse(JSON.stringify(task.request)) } },
    source: "edit", taskId: task.id,
  }, { versionId: stableId(`${task.id}:backgroundVersion`), createdAt: task.createdAt, fileHash: result.contentHash });
  const asset = project.assets.find(item => item.assetId === version.assetId)!;
  project.assetVersions.push(version); asset.versionIds.push(version.versionId); asset.activeVersionId = version.versionId;
  project.candidates.push({ candidateId, shotId: fixed.source.shot.shotId, versionId: version.versionId, fileIndex: 0, taskId: task.id, parentCandidateId: fixed.source.candidate.candidateId, createdAt: task.createdAt, basis: { ...structuredClone(fixed.source.candidate.basis), request: JSON.parse(JSON.stringify(task.request)), unknown: false } });
  fixed.source.shot.candidateIds.push(candidateId);
  return candidateId;
}
