import { projectCanvasFolder, projectPath } from "@/utils/workspace/projectLayout";
import { createHash } from "node:crypto";
import { basename, extname, join } from "node:path";
import { mkdir, withFileAccess, writeAtomic } from "@toonflow/file";
import { z } from "zod";
import type { MediaGenerationRequest } from "@toonflow/tools-scaffold/runtime";
import { lockWorkspaceFiles, resolveWorkspacePath } from "@/utils/workspace/files";
import { getTask } from "@/utils/media/tasks";
import { assertProductionPath, readProject } from "./format";
import { readProjectFile, stableId, updateProject, verifyVersion } from "./index";
import { relativePathSchema, transferSourceSchema, transferTargetSchema, type ProductionTransferSource, type ProductionTransferTarget } from "./schema";

const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const frozenFileSchema = z.strictObject({ sourcePath: relativePathSchema, path: relativePathSchema, mimeType: z.string().min(1), hash: z.string().regex(/^[a-f0-9]{64}$/) });
const receiptSchema = z.strictObject({ transferId: z.uuid(), createdAt: z.number().nonnegative(), status: z.enum(["pending", "completed"]), source: transferSourceSchema, target: transferTargetSchema,
  inputFingerprint: z.string(), files: z.array(frozenFileSchema).max(200), canvasId: relativePathSchema.optional(), nodeId: z.string().min(1).max(256).optional(), candidateId: z.uuid().optional() });
type TransferReceipt = z.infer<typeof receiptSchema>;
function fail(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }
function normalized(path: string) { const value = path.replaceAll("\\", "/"); return process.platform === "win32" ? value.toLowerCase() : value; }

async function readReceipt(directory: string, path: string) {
  const bytes = await readProjectFile(directory, path).catch((cause: NodeJS.ErrnoException) => { if (cause.code !== "ENOENT") throw cause; return undefined; });
  if (!bytes) return;
  const result = receiptSchema.safeParse(JSON.parse(bytes.toString("utf8")));
  if (!result.success) fail("传递记录损坏，请保留记录并检查", 422);
  return result.data;
}

function canvasDocument(bytes: Buffer) {
  const document = JSON.parse(bytes.toString("utf8")) as { toonflowCanvas?: boolean; nodes: { id: string; type?: string; position: { x: number; y: number }; data: Record<string, unknown>; selected?: boolean }[]; edges: Record<string, unknown>[]; [key: string]: unknown };
  if (document.toonflowCanvas !== true || !Array.isArray(document.nodes) || !Array.isArray(document.edges) || document.nodes.some(node => !node || typeof node.id !== "string" || !node.data || !node.position) || new Set(document.nodes.map(node => node.id)).size !== document.nodes.length) fail("目标不是有效画布，请重新选择", 422);
  return document;
}

async function verifyReceipt(directory: string, receipt: TransferReceipt) {
  if (receipt.target.kind === "shot") {
    const project = await readProject(directory);
    const shotId = receipt.target.shotId;
    const shot = project?.shots.find(item => item.shotId === shotId && !item.archived);
    const candidate = project?.candidates.find(item => item.candidateId === receipt.candidateId && item.shotId === shot?.shotId);
    const version = project?.assetVersions.find(item => item.versionId === candidate?.versionId);
    if (!shot || !candidate || !version) fail("已登记的镜头或候选已失效，请重新选择目标");
    await verifyVersion(directory, version);
    return;
  }
  if (!receipt.canvasId || !receipt.nodeId) fail("传递记录缺少画布位置", 422);
  const document = canvasDocument(await readProjectFile(directory, receipt.canvasId));
  if (!document.nodes.some(node => node.id === receipt.nodeId && node.data.productionTransferId === receipt.transferId)) fail("已写入节点已被移除或画布已更名，请重新选择目标");
  for (const file of receipt.files) if (hash(await readProjectFile(directory, file.path)) !== file.hash) fail("已保存的传递素材发生变化，请恢复原文件");
}

async function prepareReceipt(directory: string, source: ProductionTransferSource, target: ProductionTransferTarget, transferId: string, inputFingerprint: string): Promise<TransferReceipt> {
  if (!source.mimeType.startsWith(`${source.mediaType}/`)) fail("结果媒体类型不匹配", 400);
  const task = source.taskId ? await getTask(source.taskId, directory) : undefined;
  const result = task?.results.find(item => item.path === source.path && item.mimeType === source.mimeType && item.mediaType === source.mediaType);
  if (task && !result) fail("所选文件不属于原任务结果");
  const bytes = await readProjectFile(directory, source.path);
  const contentHash = hash(bytes);
  if ((result?.contentHash && contentHash !== result.contentHash) || source.contentHash && source.contentHash !== contentHash) fail("原结果文件已改变，请恢复原结果或作为新素材导入");
  const verifiedSource = { ...source, prompt: task?.request.prompt ?? source.prompt, request: task?.request ?? source.request, modelLabel: task ? JSON.stringify([task.request.providerId, task.request.modelId]) : source.modelLabel, contentHash };
  const receipt: TransferReceipt = { transferId, inputFingerprint, createdAt: Date.now(), source: verifiedSource, target, status: "pending", files: [] };
  if (target.kind === "shot") { receipt.candidateId = transferId; return receipt; }
  receipt.canvasId = target.canvasId ?? (projectCanvasFolder(directory) ? "canvases/" : "") + "studioCanvas" + transferId + ".json";
  receipt.nodeId = transferId;
  const references = referenceFiles(verifiedSource);
  for (const [index, file] of [{ path: source.path, mimeType: source.mimeType }, ...references].entries()) {
    const extension = extname(file.path);
    const path = projectPath(directory, `assets/transfers/${transferId}/reference${index}${/^\.[a-z0-9]{1,10}$/i.test(extension) ? extension.toLowerCase() : ""}`);
    receipt.files.push({ sourcePath: file.path, mimeType: file.mimeType, path, hash: index ? hash(await readProjectFile(directory, file.path)) : contentHash });
  }
  return receipt;
}

function referenceFiles(source: ProductionTransferSource) {
  const request = source.request as MediaGenerationRequest | undefined;
  if (!request) return [];
  if (source.mediaType === "audio") return (request.audios ?? []).map(file => ({ ...file, kind: "audio" }));
  return [ ...(request.firstFrame ? [{ ...request.firstFrame, kind: "image" }] : []), ...(request.lastFrame ? [{ ...request.lastFrame, kind: "image" }] : []),
    ...(["image", "video", "audio"] as const).flatMap(kind => (request[`${kind}s`] ?? []).map(file => ({ ...file, kind }))) ];
}

async function freezeFiles(directory: string, receipt: TransferReceipt) {
  const folder = (await resolveWorkspacePath(directory, projectPath(directory, `assets/transfers/${receipt.transferId}`), true)).path;
  await mkdir(folder, { recursive: true });
  for (const file of receipt.files) {
    const existing = await readProjectFile(directory, file.path).catch((cause: NodeJS.ErrnoException) => { if (cause.code !== "ENOENT") throw cause; return undefined; });
    if (existing) { if (hash(existing) !== file.hash) fail("传递副本与原内容冲突，请保留文件并检查"); continue; }
    const bytes = await readProjectFile(directory, file.sourcePath);
    if (hash(bytes) !== file.hash) fail("等待传递期间参考文件发生变化，请恢复原文件或重新登记");
    await writeAtomic(join(directory, file.path), bytes, { exclusive: true });
  }
}

async function appendCanvas(directory: string, receipt: TransferReceipt) {
  const canvasId = receipt.canvasId!;
  assertProductionPath(directory, [join(directory, canvasId)]);
  const target = (await resolveWorkspacePath(directory, canvasId, true)).path;
  const release = lockWorkspaceFiles([target]);
  try {
    const existing = await readProjectFile(directory, canvasId).catch((cause: NodeJS.ErrnoException) => { if (cause.code !== "ENOENT" || receipt.target.kind !== "canvas" || receipt.target.canvasId) throw cause; return undefined; });
    const document = canvasDocument(existing ?? Buffer.from(JSON.stringify({ toonflowCanvas: true, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } })));
    const prior = document.nodes.find(node => node.id === receipt.nodeId);
    if (prior) { if (prior.data.productionTransferId !== receipt.transferId) fail("目标画布的节点标识冲突"); return; }
    await freezeFiles(directory, receipt);
    const { source, transferId } = receipt;
    const request = source.request as MediaGenerationRequest | undefined;
    const origin = { x: Math.max(0, ...document.nodes.map(node => Number.isFinite(node.position.x) ? node.position.x : 0)) + 500, y: 160 };
    const data = { ...request, label: { image: "图片", video: "视频", audio: "音频" }[source.mediaType], prompt: source.prompt,
      model: request ? JSON.stringify([request.providerId, request.modelId]) : "", ...(request?.mode ? { mode: JSON.stringify(request.mode) } : {}),
      generationConfig: request, generationTaskId: source.taskId, productionTransferId: transferId,
      sourceModelLabel: source.modelLabel,
      sourceReferenceFiles: receipt.files.slice(1), outputs: { [source.mediaType]: { dataType: source.mediaType.toUpperCase(), value: { url: receipt.files[0]!.path, mimeType: source.mimeType } } } };
    const references = referenceFiles(source).map((file, index) => ({ id: stableId(`${transferId}:reference${index}`), type: `remote-${file.kind}Node`, position: { x: origin.x - 300, y: origin.y + index * 230 }, data: { label: `参考素材 ${index + 1}`, outputs: { [file.kind]: { dataType: file.kind.toUpperCase(), value: { url: receipt.files[index + 1]!.path, mimeType: file.mimeType } } } } }));
    document.nodes.forEach(node => node.selected = false);
    document.nodes.push({ id: receipt.nodeId!, type: `remote-${source.mediaType}Node`, position: origin, selected: true, data }, ...references);
    if (source.mediaType !== "audio") document.edges.push(...references.map((node, index) => ({ id: stableId(`${transferId}:edge${index}`), source: node.id, target: receipt.nodeId, sourceHandle: referenceFiles(source)[index]!.kind, targetHandle: "in" })));
    if (existing) {
      const backup = (await resolveWorkspacePath(directory, projectPath(directory, `projectBackups/transfer${transferId}.json`), true)).path;
      await mkdir(join(directory, projectPath(directory, "projectBackups")), { recursive: true });
      await writeAtomic(backup, existing, { exclusive: true }).catch((cause: NodeJS.ErrnoException) => { if (cause.code !== "EEXIST") throw cause; });
    }
    await readProject(directory);
    await writeAtomic(target, JSON.stringify(document, null, 2), { exclusive: !existing });
  } finally { release(); }
}

export async function transferResult(directory: string, rawSource: unknown, rawTarget: unknown) {
  return withFileAccess([join(directory, projectPath(directory, "productionTransfers"), "admission")], "write", async () => {
  const source = transferSourceSchema.parse(rawSource);
  source.modelLabel = source.modelLabel?.trim() || undefined;
  const target = transferTargetSchema.parse(rawTarget);
  const identity = { resultId: source.resultId, taskId: source.taskId, path: normalized(source.path), target: target.kind === "shot" ? target : { kind: "canvas", canvasId: target.canvasId ? normalized(target.canvasId) : undefined } };
  const transferId = stableId(JSON.stringify(identity));
  const path = projectPath(directory, `productionTransfers/${transferId}.json`);
  const folder = (await resolveWorkspacePath(directory, projectPath(directory, "productionTransfers"), true)).path;
  const release = lockWorkspaceFiles([folder]);
  try {
    await readProject(directory);
    const inputFingerprint = hash(JSON.stringify({ source, target }));
    let receipt = await readReceipt(directory, path);
    if (receipt && (receipt.transferId !== transferId || receipt.inputFingerprint !== inputFingerprint)) fail("同一传递标识的输入已变化，请保留原记录并重新选择结果");
    if (receipt?.status === "completed") { await verifyReceipt(directory, receipt); return receipt; }
    if (!receipt) {
      receipt = await prepareReceipt(directory, source, target, transferId, inputFingerprint);
      await mkdir(folder, { recursive: true });
      await writeAtomic(join(directory, path), JSON.stringify(receipt, null, 2), { exclusive: true });
    }
    if (target.kind === "canvas") {
      await appendCanvas(directory, receipt);
      const project = await readProject(directory);
      if (project && !project.canvases.some(canvas => canvas.canvasId === receipt.canvasId)) await updateProject(directory, project.revision, { type: "registerCanvas", canvasId: receipt.canvasId!, name: basename(receipt.canvasId!, ".json") });
    } else {
      const project = await readProject(directory);
      if (!project) fail("请先建立制作记录并选择有效镜头", 404);
      const result = await updateProject(directory, project.revision, { type: "importCandidate", importId: transferId, createdAt: receipt.createdAt, shotId: target.shotId, source: receipt.source });
      const shot = result.project.shots.find(shot => shot.shotId === target.shotId)!;
      receipt.candidateId = result.resultId; receipt.canvasId = shot.canvasId; receipt.nodeId = shot.nodeId;
    }
    receipt.status = "completed";
    await verifyReceipt(directory, receipt);
    await writeAtomic(join(directory, path), JSON.stringify(receipt, null, 2));
    return receipt;
  } finally { release(); }
  });
}

export async function verifyTransferFile(directory: string, path: string, bytes: Uint8Array) {
  const id = path.replaceAll("\\", "/").split("/")[2];
  if (!id || !z.uuid().safeParse(id).success) fail("传递参考的标识无效", 422);
  const receipt = await readReceipt(directory, projectPath(directory, `productionTransfers/${id}.json`));
  const file = receipt?.files.find(file => normalized(file.path) === normalized(path));
  if (!file || hash(bytes) !== file.hash) fail("固定传递参考已改变或依据缺失，请恢复原文件后再生成");
}
