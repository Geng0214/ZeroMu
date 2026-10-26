import { projectPath } from "@/utils/workspace/projectLayout";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { MediaGenerationRequest, MediaTaskSource } from "@toonflow/tools-scaffold/runtime";
import type { ProductionOperation, ProjectRecord } from "./schema";
import { createVersion, readProjectFile, stableId, verifyVersion } from "./index";
import { readProject } from "./format";

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function fail(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }
const coordinate = z.number().finite().min(-10000).max(10000);
const vector = z.strictObject({ x: coordinate, y: coordinate, z: coordinate });
const anchorSchema = z.object({ id: z.string().min(1).max(256), name: z.string().max(80).optional(), time: z.number().finite().min(0).max(300).optional(), aspect: z.enum(["16:9", "9:16", "4:3", "1:1"]).optional(),
  camera: z.strictObject({ position: vector, fov: z.number().finite().min(10).max(120), near: z.number().finite().min(0.01).max(10), far: z.number().finite().min(20).max(10000) }), controls: z.strictObject({ target: vector }),
});
type DirectorRecord = ProjectRecord["directorShots"][number];
type DirectorOperation = Extract<ProductionOperation, { type: "bindDirector" | "reserveDirectorCapture" | "finishDirectorCapture" }>;

async function readDirector(directory: string, canvasId: string, nodeId: string) {
  const canvas = JSON.parse((await readProjectFile(directory, canvasId)).toString("utf8"));
  const node = canvas.toonflowCanvas === true && Array.isArray(canvas.nodes) ? canvas.nodes.find((node: { id?: string }) => node?.id === nodeId) : undefined;
  if (!node || node.type !== "remote-director3dNode" || !node.data) fail("导演节点已失效，请重新打开画布", 404);
  const anchors = z.array(anchorSchema).max(1000).parse(node.data.anchors || []);
  const path = `assets/${nodeId}/model.json`;
  if (node.data.modelPath !== path) return { node, anchors, document: undefined, documentHash: undefined };
  const bytes = await readProjectFile(directory, path);
  const document = JSON.parse(bytes.toString("utf8"));
  if (document.version !== 1 || !document.scene || !Array.isArray(document.plans)) fail("导演场景文件不可读取，请保留原件并恢复", 422);
  return { node, anchors, document, documentHash: digest(bytes) };
}

function stateForAnchor(value: Awaited<ReturnType<typeof readDirector>>, anchorId: string) {
  const anchor = value.anchors.find(anchor => anchor.id === anchorId);
  if (!anchor) fail("机位已被移除，请重新选择机位", 404);
  if (!value.document) fail("请先在导演台保存场景，再生成镜头参考");
  const selectedPlanId = value.node.data.selectedPlanId as string | undefined;
  const plan = value.document.plans.find((plan: { id?: string }) => plan.id === selectedPlanId);
  const lighting = value.node.data.lighting ?? null;
  const settings = value.node.data.sceneSettings ?? null;
  const sceneHash = digest(JSON.stringify({ scene: value.document.scene, plan: plan ?? null, lighting, settings }));
  const aspectName = anchor.aspect ?? value.node.data.aspectRatio ?? "16:9";
  const [width, height] = String(aspectName).split(":").map(Number);
  if (!width || !height || !Number.isFinite(width / height)) fail("机位画幅无效", 422);
  const view = { camera: anchor.camera, controls: anchor.controls, time: anchor.time ?? 0, aspect: aspectName };
  const stateHash = digest(JSON.stringify({ sceneHash, view }));
  const focalLength = 35 / Math.max(width / height, 1) / (2 * Math.tan(anchor.camera.fov * Math.PI / 360));
  const snapshot = { anchor: { ...anchor, ...view }, aspect: width / height, focalLength, time: view.time, lighting, settings, selectedPlanId: plan?.id ?? null };
  return { sceneHash, stateHash, snapshot, anchor, plan, modelPath: value.node.data.modelPath as string };
}

function captureFrom(project: ProjectRecord, id: string) {
  const capture = project.directorShots.find(item => item.directorShotId === id);
  if (!capture?.canvasId || !capture.nodeId || !capture.anchorId || !capture.stateHash) fail("机位快照不存在或来源不完整", 404);
  return capture;
}

export async function directorCapture(directory: string, captureId: string) {
  const project = await readProject(directory);
  if (!project) fail("请先建立制作记录", 404);
  const capture = captureFrom(project, captureId);
  const sceneVersion = project.assetVersions.find(version => version.versionId === capture.sceneVersionId);
  if (!sceneVersion) fail("固定场景版本缺失", 422);
  await verifyVersion(directory, sceneVersion);
  const file = sceneVersion.files.find(file => file.mimeType === "application/json");
  if (!file) fail("固定场景文件缺失", 422);
  const modelDocument = JSON.parse((await readProjectFile(directory, file.path)).toString("utf8"));
  const reference = project.assetVersions.find(version => version.versionId === capture.referenceVersionId);
  if (reference) await verifyVersion(directory, reference);
  return { projectId: project.projectId, ...capture, snapshot: { ...(capture.cameraSnapshot as object), modelDocument }, file: reference?.files[0], referenceNodeId: stableId(captureId + ":referenceNode"), imageNodeId: stableId(captureId + ":imageNode"), videoNodeId: stableId(captureId + ":videoNode"), previewNodeId: stableId(captureId + ":previewNode") };
}

export async function directorContext(directory: string, canvasId: string, nodeId: string) {
  const project = await readProject(directory);
  if (!project) return { projectId: null, shots: [], bindings: [], states: [], references: [] };
  const value = await readDirector(directory, canvasId, nodeId);
  const states = value.document ? value.anchors.map(anchor => { const state = stateForAnchor(value, anchor.id); return { anchorId: anchor.id, stateHash: state.stateHash }; }) : [];
  const references = project.directorShots.filter(item => item.canvasId === canvasId && item.nodeId === nodeId).map(item => {
    const current = states.find(state => state.anchorId === item.anchorId);
    return { ...item, stale: !current || current.stateHash !== item.stateHash };
  });
  return { projectId: project.projectId, revision: project.revision, shots: project.shots.filter(shot => !shot.archived).map(({ shotId, title, story, dialogue }) => ({ shotId, title, story, dialogue })),
    bindings: project.directorBindings.filter(item => item.canvasId === canvasId && item.nodeId === nodeId), states, references };
}

export async function applyDirectorOperation(directory: string, project: ProjectRecord, operation: DirectorOperation): Promise<{ resultId?: string; unchanged?: boolean }> {
  if (operation.type === "bindDirector") {
    const value = await readDirector(directory, operation.canvasId, operation.nodeId);
    if (!value.anchors.some(anchor => anchor.id === operation.anchorId)) fail("机位已失效，请重新选择", 404);
    if (operation.shotId && !project.shots.some(shot => shot.shotId === operation.shotId && !shot.archived)) fail("镜头不存在或已归档", 404);
    const bindingId = stableId(JSON.stringify([project.projectId, operation.canvasId, operation.nodeId, operation.anchorId]));
    const old = project.directorBindings.find(item => item.bindingId === bindingId);
    if (old?.shotId === operation.shotId || !old && !operation.shotId) return { resultId: bindingId, unchanged: true };
    project.directorBindings = project.directorBindings.filter(item => item.bindingId !== bindingId);
    if (operation.shotId) project.directorBindings.push({ bindingId, shotId: operation.shotId, canvasId: operation.canvasId, nodeId: operation.nodeId, anchorId: operation.anchorId });
    return { resultId: bindingId };
  }
  if (operation.type === "reserveDirectorCapture") {
    const old = project.directorShots.find(item => item.directorShotId === operation.captureId);
    if (old) {
      if (old.shotId !== operation.shotId || old.canvasId !== operation.canvasId || old.nodeId !== operation.nodeId || old.anchorId !== operation.anchorId || old.stateHash !== operation.stateHash || old.mediaType !== operation.mediaType || old.createdAt !== operation.createdAt) fail("同一机位快照编号已用于其他输入");
      await verifyVersion(directory, project.assetVersions.find(version => version.versionId === old.sceneVersionId)!);
      return { resultId: old.directorShotId, unchanged: true };
    }
    const binding = project.directorBindings.find(item => item.canvasId === operation.canvasId && item.nodeId === operation.nodeId && item.anchorId === operation.anchorId && item.shotId === operation.shotId);
    if (!binding || !project.shots.some(shot => shot.shotId === binding.shotId && !shot.archived)) fail("机位对应镜头已变化，请重新读取绑定");
    const value = await readDirector(directory, operation.canvasId, operation.nodeId);
    const state = stateForAnchor(value, operation.anchorId);
    if (state.stateHash !== operation.stateHash) fail("场景、方案或机位已变化，请重新读取后生成参考");
    if (operation.mediaType === "video" && !state.plan) fail("动画视频参考需要先选择有效动画方案");
    const assetId = stableId(JSON.stringify([project.projectId, operation.canvasId, operation.nodeId, "scene"]));
    let asset = project.assets.find(item => item.assetId === assetId);
    if (!asset) { asset = { assetId, kind: "scene", name: `${String(value.node.data.label || '导演台').slice(0, 180)} · 场景`, versionIds: [] }; project.assets.push(asset); }
    let version = project.assetVersions.find(version => version.assetId === assetId && version.details.sceneHash === state.sceneHash);
    if (version) await verifyVersion(directory, version);
    else {
      version = await createVersion(directory, { type: "createAssetVersion", assetId, files: [{ path: state.modelPath, mimeType: "application/json" }], text: "", description: "导演场景与动画方案快照", details: { sceneHash: state.sceneHash, lighting: state.snapshot.lighting, settings: state.snapshot.settings }, source: "director" }, { versionId: stableId(operation.captureId + ":scene"), createdAt: operation.createdAt, fileHash: value.documentHash });
      project.assetVersions.push(version); asset.versionIds.push(version.versionId);
    }
    asset.activeVersionId = version.versionId;
    project.directorShots.push({ directorShotId: operation.captureId, shotId: operation.shotId, sceneVersionId: version.versionId, cameraSnapshot: state.snapshot, createdAt: operation.createdAt, canvasId: operation.canvasId, nodeId: operation.nodeId, anchorId: operation.anchorId, name: state.anchor.name || "机位", stateHash: state.stateHash, mediaType: operation.mediaType, status: "pending" });
    return { resultId: operation.captureId };
  }
  const capture = captureFrom(project, operation.captureId);
  if (capture.status === "completed") {
    if (capture.mediaSourcePath !== operation.mediaPath || capture.mediaHash !== operation.mediaHash) fail("参考已保存，同一编号不能覆盖为另一媒体");
    await verifyVersion(directory, project.assetVersions.find(version => version.versionId === capture.referenceVersionId)!);
    return { resultId: capture.directorShotId, unchanged: true };
  }
  const shot = project.shots.find(shot => shot.shotId === capture.shotId && !shot.archived);
  if (!shot) fail("目标镜头已归档，场景快照仍被保留，请重新选择镜头");
  const bytes = await readProjectFile(directory, operation.mediaPath).catch((cause: NodeJS.ErrnoException) => { if (cause.code !== "ENOENT") throw cause; return readProjectFile(directory, projectPath(directory, `assets/production/${stableId(capture.directorShotId + ":reference")}/reference0.${capture.mediaType === "image" ? "png" : "mp4"}`)); });
  if (digest(bytes) !== operation.mediaHash) fail("参考文件内容已改变，请保留原文件并重新生成参考");
  if (capture.mediaType === "image" ? !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : bytes.subarray(4, 8).toString() !== "ftyp") fail("导演参考需要实际 PNG 图片或 MP4 视频", 400);
  const assetId = stableId(JSON.stringify([project.projectId, capture.canvasId, capture.nodeId, capture.anchorId, capture.mediaType]));
  let asset = project.assets.find(item => item.assetId === assetId);
  if (!asset) { asset = { assetId, kind: capture.mediaType!, name: `${capture.name} · ${capture.mediaType === 'image' ? '截图' : '动画'}参考`, versionIds: [] }; project.assets.push(asset); }
  const version = await createVersion(directory, { type: "createAssetVersion", assetId, files: [{ path: operation.mediaPath, mimeType: capture.mediaType === "image" ? "image/png" : "video/mp4" }], text: "", description: `${capture.name} · 固定参考`, details: { directorShotId: capture.directorShotId, sceneVersionId: capture.sceneVersionId, stateHash: capture.stateHash! }, source: "director" }, { versionId: stableId(capture.directorShotId + ":reference"), createdAt: capture.createdAt, fileHash: operation.mediaHash });
  project.assetVersions.push(version); asset.versionIds.push(version.versionId); asset.activeVersionId = version.versionId;
  capture.referenceVersionId = version.versionId; capture.mediaSourcePath = operation.mediaPath; capture.mediaHash = operation.mediaHash; capture.status = "completed";
  const scene = project.assetVersions.find(version => version.versionId === capture.sceneVersionId)!;
  const role = `导演参考:${capture.canvasId}:${capture.nodeId}:${capture.anchorId}`;
  shot.references = shot.references.filter(reference => reference.role !== role && reference.role !== role + ":场景");
  shot.references.push({ assetId, versionId: version.versionId, role }, { assetId: scene.assetId, versionId: scene.versionId, role: role + ":场景" });
  shot.directorShotId = capture.directorShotId;
  return { resultId: capture.directorShotId };
}

export async function directorTaskSource(directory: string, project: ProjectRecord | null, source: MediaTaskSource, request: MediaGenerationRequest) {
  if (!project) { if (source.directorShotId) fail("导演参考需要有效制作项目"); return source; }
  let directorId = source.directorShotId;
  if (!directorId && source.kind !== "batch" && source.canvasId && source.nodeId && project.directorShots.length) {
    const canvas = JSON.parse((await readProjectFile(directory, source.canvasId)).toString("utf8"));
    directorId = canvas.nodes?.find((node: { id: string }) => node.id === source.nodeId)?.data?.productionDirector?.directorShotId;
  }
  if (!directorId) return source;
  const capture = captureFrom(project, directorId);
  const boundShot = source.canvasId && source.nodeId ? project.shots.find(shot => !shot.archived && shot.canvasId === source.canvasId && shot.nodeId === source.nodeId) : undefined;
  if (boundShot && boundShot.shotId !== capture.shotId) fail("节点绑定镜头与导演参考不一致，请重新绑定或准备正确镜头的生成节点");
  if (capture.status !== "completed" || !capture.referenceVersionId) fail("导演参考尚未保存完整，请重新生成参考");
  if (source.shotId && source.shotId !== capture.shotId) fail("导演参考与目标镜头不匹配");
  const version = project.assetVersions.find(version => version.versionId === capture.referenceVersionId)!;
  await verifyVersion(directory, version);
  const references = [...request.images || [], ...request.videos || [], ...request.audios || [], ...request.firstFrame ? [request.firstFrame] : [], ...request.lastFrame ? [request.lastFrame] : []];
  if (!version.files.some(file => references.some(reference => reference.path === file.path && reference.mimeType === file.mimeType))) fail("生成输入缺少所绑定的固定导演参考，请保留原参考或准备新的生成节点");
  return { ...source, projectId: project.projectId, shotId: capture.shotId, directorShotId: capture.directorShotId };
}
