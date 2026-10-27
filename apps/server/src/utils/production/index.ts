import { projectPath } from "@/utils/workspace/projectLayout";
import { mkdir, readFile, readdir, lstat, copyFile, writeAtomic, open } from "@toonflow/file";
import { basename, extname, join } from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { lockWorkspaceFiles, resolveWorkspacePath } from "@/utils/workspace/files";
import { operationSchema, projectSchema, versionSchema, type AssetVersion, type ProductionOperation, type ProjectRecord, type ProductionSelection } from "./schema";
import { projectFileName, readProject } from "./format";
import { getTask, listTasks } from "@/utils/media/tasks";
import { applyDirectorOperation } from "./director";
import { validateEdit } from "./edit";
import { hasRunningBatch } from "./batches";
import { applyImageEdit, existingImageEdit } from "./image";
import { applyBackgroundRemoval, existingBackgroundRemoval } from "./backgroundRemoval";
import { assetImpact, candidateReferenceState } from "./referenceState";
import { existingFileRecovery, restoreVersionFile } from "./files";
import { existingLibraryImport, importLibraryAsset } from "./library";

export { readProject, assertProductionWrite } from "./format";
export { operationSchema } from "./schema";
export { transferResult } from "./transfer";
export { directorContext, directorCapture, directorTaskSource } from "./director";
export { editContext, startExport, listExports, cancelExport } from "./edit";

export { prepareBatch, listBatches, controlBatch, readBatch, batchView } from "./batches";
export { prepareImageEdit } from "./image";
export { assetImpact } from "./referenceState";
export { inspectVersionFiles, prepareFileRecovery } from "./files";
export { prepareLibraryImport, previewLibraryImport, pendingLibraryImports } from "./library";
const defaultOutput = { width: 1280, height: 720, frameRate: 24 };
function invalid(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
const digest = (content: Uint8Array | string) => createHash("sha256").update(content).digest("hex");
export function stableId(value: string) { const hash = digest(value).slice(0, 32); return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20)}`; }
async function backupDirectory(directory: string, path = projectPath(directory, "projectBackups")) {
  const target = await resolveWorkspacePath(directory, path, true);
  await mkdir(target.path, { recursive: true });
  return target.path;
}

export async function readProjectFile(directory: string, path: string) {
  const target = await resolveWorkspacePath(directory, path);
  const info = await lstat(target.path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 100 * 1024 * 1024) invalid("制作文件须为不超过 100 MB 的普通文件");
  return readFile(target.path);
}

export async function createProject(directory: string, name = basename(directory)) {
  const release = lockWorkspaceFiles([join(directory, projectFileName)]);
  try {
    const existing = await readProject(directory);
    if (existing) return existing;
    const project: ProjectRecord = { zeromuProject: true, schemaVersion: 1, projectId: crypto.randomUUID(), name, revision: 0, createdAt: Date.now(), updatedAt: Date.now(), canvases: [], sequences: [], shots: [], assets: [], assetVersions: [], candidates: [], adoptionHistory: [], directorBindings: [], directorShots: [], edits: [], exports: [], snapshots: [], storyboardDrafts: [] };
    const entries = await readdir(directory, { withFileTypes: true });
    const backup = projectPath(directory, `projectBackups/baseline${crypto.randomUUID()}`);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const target = await resolveWorkspacePath(directory, entry.name);
      const handle = await open(target.path, "r");
      const header = Buffer.alloc(512);
      try { await handle.read(header, 0, 512, 0); } finally { await handle.close(); }
      if (!/"toonflowCanvas"\s*:\s*true/.test(header.toString("utf8"))) continue;
      await copyFile(join(directory, entry.name), join(await backupDirectory(directory, backup), entry.name));
      project.canvases.push({ canvasId: entry.name, name: entry.name.slice(0, -5) });
    }
    await writeAtomic(join(directory, projectFileName), JSON.stringify(projectSchema.parse(project), null, 2), { exclusive: true });
    return project;
  } finally { release(); }
}

export function verifyVersionMetadata(version: AssetVersion) {
  if (digest(JSON.stringify({ files: version.files.map(({ path, ...file }) => file), text: version.text, description: version.description, details: version.details })) !== version.contentHash) invalid("固定版本资料摘要不匹配，请保留记录并恢复原版本", 409);
}
export async function verifyVersion(directory: string, version: AssetVersion) {
  verifyVersionMetadata(version);
  for (const file of version.files) if (digest(await readProjectFile(directory, file.path)) !== file.hash) invalid("固定版本文件的内容已改变，请恢复原文件或创建新版本", 409);
}

// 调用方持有制作记录锁；共用修订、关系校验和写入前备份。
export async function writeProjectRevision(directory: string, original: ProjectRecord, project: ProjectRecord) {
  project.revision = original.revision + 1; project.updatedAt = Date.now();
  const checked = projectSchema.safeParse(project);
  if (!checked.success) invalid(`制作关系校验失败：${checked.error.issues.map(issue => issue.message).slice(0, 4).join("；")}`);
  const content = JSON.stringify(checked.data, null, 2);
  if (Buffer.byteLength(content) > 20 * 1024 * 1024) invalid("制作记录超过 20 MB 上限，请分拆为独立项目；原记录保持完整", 413);
  await backupDirectory(directory);
  await writeAtomic(join(directory, projectPath(directory, "projectBackups"), `revision${original.revision}${crypto.randomUUID()}.json`), JSON.stringify(original, null, 2), { exclusive: true });
  await writeAtomic(join(directory, projectFileName), content);
  return checked.data;
}

export async function recoverableVersions(directory: string, project: ProjectRecord | null) {
  const root = (await resolveWorkspacePath(directory, projectPath(directory, "assets/production"), true)).path;
  const entries = await readdir(root, { withFileTypes: true }).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return []; throw cause; });
  const known = new Set(project?.assetVersions.map(item => item.versionId));
  const result: { versionId: string; status: "ready" | "incomplete"; assetId?: string }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name) || known.has(entry.name)) continue;
    try {
      const version = versionSchema.parse(JSON.parse((await readProjectFile(directory, projectPath(directory, `assets/production/${entry.name}/versionManifest.json`))).toString("utf8")));
      if (version.versionId !== entry.name) invalid("版本清单标识错误");
      result.push({ versionId: entry.name, assetId: version.assetId, status: "ready" });
    } catch { result.push({ versionId: entry.name, status: "incomplete" }); }
  }
  return result;
}

export async function createVersion(directory: string, input: Extract<ProductionOperation, { type: "createAssetVersion" }>, identity?: { versionId: string; createdAt: number; fileHash?: string }): Promise<AssetVersion> {
  if (!input.files.length && !input.text.trim()) invalid("素材版本需要文件或文本");
  if (input.source === "generation" && !input.taskId) invalid("生成版本需要实际来源任务；手动导入请使用导入来源");
  const task = input.taskId ? await getTask(input.taskId, directory) : undefined;
  if (task && input.files.some(file => !task.results.some(result => result.path === file.path && result.mimeType === file.mimeType))) invalid("文件不属于指定的来源任务");
  const versionId = identity?.versionId ?? crypto.randomUUID();
  const version: AssetVersion = { versionId, assetId: input.assetId, parentVersionId: input.parentVersionId, createdAt: identity?.createdAt ?? Date.now(), files: [], text: input.text, description: input.description, details: input.details, contentHash: "", source: input.source, taskId: input.taskId };
  const folder = projectPath(directory, `assets/production/${versionId}`);
  await resolveWorkspacePath(directory, folder, true);
  await mkdir(join(directory, folder), { recursive: true });
  for (const [index, file] of input.files.entries()) {
    const extension = extname(file.path);
    const path = `${folder}/reference${index}${/^\.[a-z0-9]{1,10}$/i.test(extension) ? extension.toLowerCase() : ""}`;
    const bytes = await readProjectFile(directory, file.path).catch(async (cause: NodeJS.ErrnoException) => {
      if (!identity?.fileHash || cause.code !== "ENOENT") throw cause;
      return readProjectFile(directory, path);
    });
    if (identity?.fileHash && digest(bytes) !== identity.fileHash) invalid("原结果或中断副本已改变，请保留文件并检查", 409);
    const generated = task?.results.find(item => item.path === file.path);
    if (generated?.contentHash && digest(bytes) !== generated.contentHash) invalid("来源任务的结果文件已改变，请恢复原结果或作为手动导入的新版本保存", 409);
    await writeAtomic(join(directory, path), bytes, { exclusive: true }).catch(async (cause: NodeJS.ErrnoException) => {
      if (!identity || cause.code !== "EEXIST") throw cause;
      if (digest(await readProjectFile(directory, path)) !== digest(bytes)) invalid("中断版本的文件与原传递内容冲突，请保留文件并检查", 409);
    });
    version.files.push({ path, mimeType: file.mimeType, view: file.view, hash: digest(bytes) });
  }
  version.contentHash = digest(JSON.stringify({ files: version.files.map(({ path, ...file }) => file), text: version.text, description: version.description, details: version.details }));
  await writeAtomic(join(directory, folder, "versionManifest.json"), JSON.stringify(versionSchema.parse(version), null, 2), { exclusive: true }).catch(async (cause: NodeJS.ErrnoException) => {
    if (!identity || cause.code !== "EEXIST") throw cause;
    const saved = versionSchema.parse(JSON.parse((await readProjectFile(directory, `${folder}/versionManifest.json`)).toString("utf8")));
    if (!isDeepStrictEqual(saved, JSON.parse(JSON.stringify(version)))) invalid("中断版本的资料与原传递内容冲突，请保留清单并检查", 409);
  });
  return version;
}

function mergeRestored(project: ProjectRecord, restored: ProjectRecord) {
  for (const old of restored.libraryImports ?? []) { const current = project.libraryImports?.find(item => item.importId === old.importId); if (current && !isDeepStrictEqual(current, old)) invalid("快照中的素材带入记录与当前内容冲突，请保留快照并检查", 409); }
  for (const old of restored.fileRecoveries ?? []) {
    const current = project.fileRecoveries?.find(item => item.recoveryId === old.recoveryId);
    if (current && !isDeepStrictEqual(current, old)) invalid("快照中的文件恢复记录与当前内容冲突，请保留快照并检查", 409);
  }
  for (const old of restored.templateApplications ?? []) {
    const current = project.templateApplications?.find(item => item.applicationId === old.applicationId);
    if (current && !isDeepStrictEqual(current, old)) invalid("快照中的模板应用记录与当前内容冲突，请保留快照并检查", 409);
  }
  for (const field of ["assetVersions", "candidates"] as const) {
    const key = field === "assetVersions" ? "versionId" : "candidateId";
    for (const old of restored[field]) {
      const current = project[field].find(item => Reflect.get(item, key) === Reflect.get(old, key));
      if (current && !isDeepStrictEqual(current, old)) invalid("快照中的固定版本或候选与当前记录冲突，请保留快照并检查", 409);
    }
  }
  function merge<T>(current: T[], previous: T[], key: (item: T) => string) {
    return [...previous, ...current.filter(item => !previous.some(old => key(old) === key(item)))];
  }
  if (project.libraryImports || restored.libraryImports) restored.libraryImports = merge(project.libraryImports ?? [], restored.libraryImports ?? [], item => item.importId);
  restored.assetVersions = merge(project.assetVersions, restored.assetVersions, item => item.versionId);
  restored.candidates = merge(project.candidates, restored.candidates, item => item.candidateId);
  restored.adoptionHistory = merge(project.adoptionHistory, restored.adoptionHistory, item => item.adoptionId);
  restored.exports = merge(project.exports, restored.exports, item => item.exportId);
  restored.snapshots = merge(project.snapshots, restored.snapshots, item => item.snapshotId);
  restored.directorShots = merge(project.directorShots, restored.directorShots, item => item.directorShotId);
  if (project.templateApplications || restored.templateApplications) restored.templateApplications = merge(project.templateApplications ?? [], restored.templateApplications ?? [], item => item.applicationId);
  if (project.fileRecoveries || restored.fileRecoveries) restored.fileRecoveries = merge(project.fileRecoveries ?? [], restored.fileRecoveries ?? [], item => item.recoveryId);
  restored.shots = merge(project.shots.map(shot => ({ ...shot, archived: true })), restored.shots, item => item.shotId);
  restored.assets = merge(project.assets.map(asset => ({ ...asset, archived: true })), restored.assets, item => item.assetId);
  restored.sequences = merge(project.sequences.map(sequence => ({ ...sequence, archived: true, shotIds: [] })), restored.sequences, item => item.sequenceId);
  for (const shot of restored.shots) shot.candidateIds = restored.candidates.filter(item => item.shotId === shot.shotId).map(item => item.candidateId);
  for (const asset of restored.assets) asset.versionIds = restored.assetVersions.filter(item => item.assetId === asset.assetId).map(item => item.versionId);
  return restored;
}

export async function updateProject(directory: string, expectedRevision: number, value: unknown) {
  const operation = operationSchema.parse(value);
  const release = lockWorkspaceFiles([join(directory, projectFileName)]);
  try {
    const existing = await readProject(directory);
    if (!existing) invalid("请先建立项目制作记录", 404);
    let project: ProjectRecord = existing;
    if (operation.type === "importLibraryAsset") { const prior = await existingLibraryImport(directory, project, operation); if (prior) return { project, resultId: prior.versionId }; }
    if (operation.type === "restoreVersionFile" && await existingFileRecovery(directory, project, operation)) return { project, resultId: operation.versionId };
    if (operation.type === "editImageCandidate") {
      const prior = existingImageEdit(project, operation);
      if (prior) { await verifyVersion(directory, prior); return { project, resultId: operation.editId }; }
    }
    if (operation.type === "addBackgroundRemovedCandidate") {
      const prior = existingBackgroundRemoval(project, operation);
      if (prior) { await verifyVersion(directory, prior.version); return { project, resultId: prior.candidate.candidateId }; }
    }
    if (project.revision !== expectedRevision) invalid("制作记录已在其他页面更新，请刷新后重新修改", 409);
    const original = structuredClone(project);
    const findShot = (id: string) => { const shot = project.shots.find(item => item.shotId === id && !item.archived); if (!shot) invalid("镜头不存在或已归档", 404); return shot; };
    const findAsset = (id: string) => { const asset = project.assets.find(item => item.assetId === id && !item.archived); if (!asset) invalid("素材不存在或已归档", 404); return asset; };
    const findSequence = (id: string) => { const sequence = project.sequences.find(item => item.sequenceId === id && !item.archived); if (!sequence) invalid("制作单元不存在或已归档", 404); return sequence; };
    const findVersion = (id: string) => { const version = project.assetVersions.find(item => item.versionId === id); if (!version) invalid("素材版本不存在", 404); return version; };
    let resultId: string | undefined;
    switch (operation.type) {
      case "importLibraryAsset": resultId = await importLibraryAsset(directory, project, operation); break;
      case "restoreVersionFile": resultId = await restoreVersionFile(directory, project, operation); break;
      case "editImageCandidate": resultId = await applyImageEdit(directory, project, operation); break;
      case "addBackgroundRemovedCandidate": resultId = await applyBackgroundRemoval(directory, project, operation); break;
      case "registerCanvas": {
        const canvas = JSON.parse((await readProjectFile(directory, operation.canvasId)).toString("utf8"));
        if (canvas.toonflowCanvas !== true || !Array.isArray(canvas.nodes) || !Array.isArray(canvas.edges)) invalid("文件不是有效画布");
        if (!project.canvases.some(item => item.canvasId === operation.canvasId)) project.canvases.push({ canvasId: operation.canvasId, name: operation.name });
        resultId = operation.canvasId; break;
      }
      case "importCandidate": {
        const shot = findShot(operation.shotId);
        const prior = project.candidates.find(item => item.candidateId === operation.importId);
        if (prior) {
          if (prior.shotId !== shot.shotId || prior.taskId !== operation.source.taskId) invalid("传递标识已用于其他候选", 409);
          await verifyVersion(directory, findVersion(prior.versionId));
          return { project, resultId: prior.candidateId };
        }
        const task = operation.source.taskId ? await getTask(operation.source.taskId, directory) : undefined;
        const source = operation.source;
        if (!source.mimeType.startsWith(`${source.mediaType}/`)) invalid("结果媒体类型不匹配");
        const assetId = stableId(`${operation.importId}:asset`);
        const versionId = stableId(`${operation.importId}:version`);
        const version = await createVersion(directory, { type: "createAssetVersion", assetId, files: [{ path: source.path, mimeType: source.mimeType }], text: task?.request.prompt ?? source.prompt, description: "工作站结果", details: source.modelLabel ? { modelLabel: source.modelLabel } : {}, source: task ? "generation" : "import", taskId: task?.id }, { versionId, createdAt: operation.createdAt, fileHash: source.contentHash });
        if (project.assets.some(asset => asset.assetId === assetId) || project.assetVersions.some(item => item.versionId === versionId)) invalid("传递素材标识冲突，请保留现有资料并检查", 409);
        project.assets.push({ assetId, name: (source.prompt.trim() || `${source.mediaType}结果`).slice(0, 80), kind: source.mediaType, versionIds: [versionId], activeVersionId: versionId });
        project.assetVersions.push(version);
        project.candidates.push({ candidateId: operation.importId, shotId: shot.shotId, versionId, taskId: task?.id, createdAt: operation.createdAt, basis: { references: task?.source.referenceVersions ?? [], shotReferences: task ? task.source.shotReferenceVersions && structuredClone(task.source.shotReferenceVersions) : structuredClone(shot.references), request: task?.request ?? source.request, directorShotId: task?.source.directorShotId, unknown: !task } });
        shot.candidateIds.push(operation.importId); resultId = operation.importId; break;
      }
      case "addSequence": {
        resultId = crypto.randomUUID(); project.sequences.push({ sequenceId: resultId, name: operation.name, shotIds: [], output: operation.output ?? defaultOutput }); break;
      }
      case "saveShot": {
        const sequence = findSequence(operation.sequenceId);
        const { canvasId, nodeId } = operation.shot;
        if (!!canvasId !== !!nodeId) invalid("画布与节点需要一起绑定或解除");
        if (canvasId && nodeId) {
          if (project.shots.some(shot => !shot.archived && shot.shotId !== operation.shotId && shot.canvasId === canvasId && shot.nodeId === nodeId)) invalid("此节点已绑定另一个活动镜头，请先解除原绑定", 409);
          const canvas = JSON.parse((await readProjectFile(directory, canvasId)).toString("utf8"));
          if (canvas.toonflowCanvas !== true || !Array.isArray(canvas.nodes) || !canvas.nodes.some((node: { id?: string }) => node.id === nodeId)) invalid("绑定节点不存在，请重新选择画布节点", 409);
          if (!project.canvases.some(item => item.canvasId === canvasId)) project.canvases.push({ canvasId, name: basename(canvasId, ".json") });
        }
        if (operation.shotId) { const shot = findShot(operation.shotId); if (shot.sequenceId !== sequence.sequenceId) invalid("镜头不能改为其他单元的标识"); Object.assign(shot, operation.shot, { canvasId, nodeId }); resultId = shot.shotId; }
        else { resultId = crypto.randomUUID(); project.shots.push({ ...operation.shot, shotId: resultId, sequenceId: sequence.sequenceId, candidateIds: [] }); sequence.shotIds.push(resultId); }
        break;
      }
      case "reorderShots": {
        const sequence = findSequence(operation.sequenceId);
        if (operation.shotIds.length !== sequence.shotIds.length || new Set(operation.shotIds).size !== operation.shotIds.length || operation.shotIds.some(id => !sequence.shotIds.includes(id))) invalid("镜头排序必须完整保留当前单元的所有镜头");
        sequence.shotIds = operation.shotIds; break;
      }
      case "deleteShot": {
        const shot = findShot(operation.shotId);
        if (!operation.confirmReferences && (shot.references.length || shot.candidateIds.length || project.edits.some(edit => edit.clips.some(clip => clip.shotId === shot.shotId)))) invalid("此镜头仍有关联参考、候选或剪辑片段。确认关系后才可归档；原媒体会保留", 409);
        shot.archived = true; findSequence(shot.sequenceId).shotIds = findSequence(shot.sequenceId).shotIds.filter(id => id !== shot.shotId);
        for (const edit of project.edits) edit.clips = edit.clips.filter(clip => clip.shotId !== shot.shotId);
        break;
      }
      case "createAsset": resultId = crypto.randomUUID(); project.assets.push({ assetId: resultId, kind: operation.kind, name: operation.name, versionIds: [] }); break;
      case "renameAsset": findAsset(operation.assetId).name = operation.name; break;
      case "deleteAsset": {
        const impact = assetImpact(project, operation.assetId);
        if (impact.shots.length || impact.draftIds.length || impact.exportIds.length) invalid("素材仍被镜头、候选、草案或已导出作品引用，不能删除", 409);
        findAsset(operation.assetId).archived = true; break;
      }
      case "replaceShotReferences": {
        const asset = findAsset(operation.assetId); const version = findVersion(operation.versionId);
        if (version.assetId !== asset.assetId) invalid("目标版本不属于当前素材", 400);
        const shots = operation.shotIds.map(findShot);
        if (shots.some(shot => !shot.references.some(reference => reference.assetId === asset.assetId))) invalid("所选镜头没有引用此素材，请刷新影响范围", 409);
        await verifyVersion(directory, version);
        resultId = version.versionId;
        if (shots.every(shot => shot.references.filter(reference => reference.assetId === asset.assetId).every(reference => reference.versionId === version.versionId))) return { project, resultId };
        for (const shot of shots) shot.references = shot.references.map(reference => reference.assetId === asset.assetId ? { ...reference, versionId: version.versionId } : reference);
        break;
      }
      case "createAssetVersion": {
        const asset = findAsset(operation.assetId);
        if (operation.parentVersionId && findVersion(operation.parentVersionId).assetId !== asset.assetId) invalid("父版本不属于当前素材");
        const version = await createVersion(directory, operation); project.assetVersions.push(version); asset.versionIds.push(version.versionId); asset.activeVersionId = resultId = version.versionId; break;
      }
      case "recoverAssetVersion": {
        if (project.assetVersions.some(item => item.versionId === operation.versionId)) invalid("此版本已登记", 409);
        const version = versionSchema.parse(JSON.parse((await readProjectFile(directory, projectPath(directory, `assets/production/${operation.versionId}/versionManifest.json`))).toString("utf8")));
        if (version.versionId !== operation.versionId) invalid("恢复版本标识不匹配");
        await verifyVersion(directory, version); const asset = findAsset(version.assetId); project.assetVersions.push(version); asset.versionIds.push(version.versionId); asset.activeVersionId = resultId = version.versionId; break;
      }
      case "addCandidate": {
        const shot = findShot(operation.shotId); const version = findVersion(operation.versionId);
        const fileIndex = operation.fileIndex ?? version.files.findIndex(file => /^(image|video|audio)\//.test(file.mimeType));
        if (fileIndex < 0 || !/^(image|video|audio)\//.test(version.files[fileIndex]?.mimeType || "")) invalid("镜头候选需要指定图片、视频或音频文件");
        await verifyVersion(directory, version); resultId = crypto.randomUUID();
        const basis = structuredClone(operation.basis);
        delete basis.shotReferences;
        if (operation.taskId) {
          if (version.taskId !== operation.taskId) invalid("候选来源任务与媒体版本不匹配");
          const task = await getTask(operation.taskId, directory);
          basis.request = JSON.parse(JSON.stringify(task.request));
          basis.directorShotId = task.source.directorShotId;
          if (task.source.referenceVersions) basis.references = structuredClone(task.source.referenceVersions);
          if (task.source.shotReferenceVersions) basis.shotReferences = structuredClone(task.source.shotReferenceVersions);
        } else { basis.unknown = true; basis.shotReferences = structuredClone(shot.references); }
        project.candidates.push({ candidateId: resultId, shotId: shot.shotId, versionId: version.versionId, fileIndex, taskId: operation.taskId, parentCandidateId: operation.parentCandidateId, basis, createdAt: Date.now() });
        shot.candidateIds.push(resultId); break;
      }
      case "adoptCandidate": {
        const shot = findShot(operation.shotId);
        const candidate = project.candidates.find(item => item.candidateId === operation.candidateId && item.shotId === shot.shotId);
        if (!candidate) invalid("采用候选不属于此镜头", 404);
        if (candidateReferenceState(shot, candidate) === "changed" && !operation.confirmReferenceChanges) invalid("此候选记录的参考与镜头当前参考不同，请核对后明确采用旧依据", 409);
        await verifyVersion(directory, findVersion(candidate.versionId));
        if (shot.adoptedCandidateId !== candidate.candidateId) { project.adoptionHistory.push({ adoptionId: crypto.randomUUID(), shotId: shot.shotId, candidateId: candidate.candidateId, previousCandidateId: shot.adoptedCandidateId, createdAt: Date.now() }); shot.adoptedCandidateId = candidate.candidateId; }
        resultId = candidate.candidateId; break;
      }
      case "bindDirector": case "reserveDirectorCapture": case "finishDirectorCapture": {
        const result = await applyDirectorOperation(directory, project, operation);
        resultId = result.resultId;
        if (result.unchanged) return { project, resultId };
        break;
      }
      case "undoAdoption": {
        const shot = findShot(operation.shotId);
        const adoption = project.adoptionHistory.findLast(item => item.shotId === shot.shotId);
        if (!adoption || adoption.adoptionId !== operation.adoptionId || adoption.undoOfAdoptionId || adoption.candidateId !== shot.adoptedCandidateId) invalid("采用状态已变化，请查看当前采用结果", 409);
        if (adoption.previousCandidateId) {
          const previous = project.candidates.find(item => item.candidateId === adoption.previousCandidateId && item.shotId === shot.shotId);
          if (!previous) invalid("原候选不存在，无法撤销", 409);
          if (candidateReferenceState(shot, previous) === "changed" && !operation.confirmReferenceChanges) invalid("原候选记录的参考与镜头当前参考不同，请核对后明确恢复旧依据", 409);
          await verifyVersion(directory, findVersion(previous.versionId));
        }
        project.adoptionHistory.push({ adoptionId: crypto.randomUUID(), shotId: shot.shotId, candidateId: adoption.previousCandidateId, previousCandidateId: adoption.candidateId, undoOfAdoptionId: adoption.adoptionId, createdAt: Date.now() });
        shot.adoptedCandidateId = resultId = adoption.previousCandidateId;
        break;
      }
      case "snapshot": {
        resultId = crypto.randomUUID(); const path = projectPath(directory, `projectBackups/snapshot${resultId}.json`);
        await backupDirectory(directory); await writeAtomic(join(directory, path), JSON.stringify(project, null, 2), { exclusive: true });
        project.snapshots.push({ snapshotId: resultId, name: operation.name, revision: project.revision, createdAt: Date.now(), path }); break;
      }
      case "restoreSnapshot": {
        if (hasRunningBatch(directory) || (await listTasks(directory, undefined, 0, 100000)).tasks.some(task => task.source.kind === "batch" && ["queued", "submitting", "running", "downloading"].includes(task.status))) invalid("批次仍在编排或有已派发任务进行中，请等待任务结束后再恢复快照", 409);
        const snapshot = project.snapshots.find(item => item.snapshotId === operation.snapshotId); if (!snapshot) invalid("快照不存在", 404);
        const restored = projectSchema.parse(JSON.parse((await readProjectFile(directory, snapshot.path)).toString("utf8")));
        if (restored.projectId !== project.projectId) invalid("快照属于其他项目", 409);
        for (const version of restored.assetVersions) await verifyVersion(directory, version);
        project = mergeRestored(project, restored); break;
      }
      case "proposeStoryboard": resultId = crypto.randomUUID(); project.storyboardDrafts.push({ draftId: resultId, name: operation.name, shots: operation.shots, source: operation.source, createdAt: Date.now() }); break;
      case "acceptStoryboard": {
        const draft = project.storyboardDrafts.find(item => item.draftId === operation.draftId); if (!draft) invalid("分镜草案不存在", 404);
        if (draft.acceptedSequenceId) invalid("此草案已经采用，请查看对应制作单元", 409);
        resultId = crypto.randomUUID(); const shotIds = draft.shots.map(shot => { const shotId = crypto.randomUUID(); project.shots.push({ ...shot, shotId, sequenceId: resultId!, candidateIds: [] }); return shotId; });
        project.sequences.push({ sequenceId: resultId, name: draft.name, shotIds, output: operation.output ?? defaultOutput }); draft.acceptedSequenceId = resultId; break;
      }
      case "saveEdit": { findSequence(operation.edit.sequenceId); await validateEdit(directory, project, operation.edit); const index = project.edits.findIndex(item => item.sequenceId === operation.edit.sequenceId); if (index < 0) project.edits.push(operation.edit); else project.edits[index] = operation.edit; break; }
    }
    return { project: await writeProjectRevision(directory, original, project), resultId };
  } finally { release(); }
}

export async function getAdoptedSelection(directory: string, shotId: string): Promise<ProductionSelection> {
  const project = await readProject(directory);
  const shot = project?.shots.find(item => item.shotId === shotId && !item.archived);
  if (!project || !shot) invalid("镜头不存在或已归档", 404);
  const candidate = project.candidates.find(item => item.candidateId === shot.adoptedCandidateId && item.shotId === shotId);
  const version = project.assetVersions.find(item => item.versionId === candidate?.versionId);
  if (!candidate || !version) invalid("镜头尚未采用有效候选", 409);
  await verifyVersion(directory, version);
  const fileIndex = candidate.fileIndex ?? version.files.findIndex(file => /^(image|video|audio)\//.test(file.mimeType));
  const file = version.files[fileIndex];
  if (!file || !/^(image|video|audio)\//.test(file.mimeType)) invalid("采用版本的媒体文件已失效", 409);
  return { projectId: project.projectId, revision: project.revision, shotId, candidateId: candidate.candidateId, versionId: version.versionId, fileIndex, canvasId: shot.canvasId, nodeId: shot.nodeId, file, basis: candidate.basis, taskId: candidate.taskId };
}
