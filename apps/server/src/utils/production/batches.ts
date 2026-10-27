import { projectPath } from "@/utils/workspace/projectLayout";
import { lstat, mkdir, readFile, readdir, withFileAccess, writeAtomic } from "@toonflow/file";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { MediaGenerationRequest, MediaReference, MediaTaskRecord } from "@toonflow/tools-scaffold/runtime";
import { imageGenerationSchema, videoGenerationSchema, audioGenerationSchema } from "@toonflow/tool-media-generation/runtime";
import { currentProviderRevision, effectiveMediaRequest, listMediaModels } from "@/utils/media/generation";
import { validateModelCapabilities } from "@/utils/media/capabilities";
import { checkBatchBudget, collectTaskResults, getTask, resumeTask, startTask } from "@/utils/media/tasks";
import { assertCurrentQuote, newTaskCost, quoteMediaCost, readCostPolicy, summarizeMediaCosts } from "@/utils/media/costs";
import { lockWorkspaceFiles, resolveWorkspacePath } from "@/utils/workspace/files";
import { assertProductionPath, readProject, projectFileName } from "./format";
import { stableId, verifyVersion } from "./index";
import { batchInputSchema, batchSchema, type BatchInput, type BatchItem, type BatchRecord, type BatchView } from "./batchSchema";
import type { ProjectRecord } from "./schema";
import { transferResult } from "./transfer";

const live = new Map<string, AbortController>();
const activeStatuses = new Set(["queued", "submitting", "running", "downloading"]);
const slots = ["images", "videos", "audios", "firstFrame", "lastFrame"] as const;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest("hex");
const keyFor = (directory: string, id: string) => `${directory}\0${id}`;
const batchPath = (directory: string, id: string) => join(directory, projectPath(directory, "productionBatches"), `${id}.json`);
function fail(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }
function references(request: MediaGenerationRequest) { return slots.flatMap(slot => { const value = request[slot]; return Array.isArray(value) ? value : value ? [value] : []; }); }
function owned(batch: BatchRecord, directory: string) { if (batch.archived || batch.directory !== directory) fail("这是迁移或其他目录中的批次历史，仅可查看；重新生成须建立新批次", 403); }
export function hasRunningBatch(directory: string) { return [...live.keys()].some(key => key.startsWith(`${directory}\0`)); }

export async function readBatch(directory: string, id: string) {
  batchInputSchema.shape.batchId.parse(id);
  const target = await resolveWorkspacePath(directory, projectPath(directory, `productionBatches/${id}.json`), true);
  const info = await lstat(target.path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return null; throw cause; });
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 ** 2) fail("批次记录须为不超过 16 MB 的普通文件", 422);
  const batch = batchSchema.parse(JSON.parse(await readFile(target.path, "utf8")));
  const project = await readProject(directory);
  if (batch.batchId !== id || !project || batch.projectId !== project.projectId) fail("批次与当前项目身份不一致", 422);
  if (!batch.archived && batch.directory === directory) {
    const items = batch.items.map(({ resolvedRequest, resolvedReferences, dispatchedAt, error, ...item }) => item);
    if (batch.fingerprint !== digest({ projectId: batch.projectId, sequenceId: batch.sequenceId, sourceRevision: batch.sourceRevision, name: batch.name, items })) fail("批次确认范围摘要不匹配，请保留原记录", 422);
  }
  return batch;
}
async function saveBatch(directory: string, batch: BatchRecord, exclusive = false) {
  batch.updatedAt = Date.now(); const value = JSON.stringify(batchSchema.parse(batch), null, 2);
  if (Buffer.byteLength(value) > 16 * 1024 ** 2) fail("批次超过 16 MB，请减少镜头或提示词长度", 413);
  const target = await resolveWorkspacePath(directory, projectPath(directory, "productionBatches"), true); await mkdir(target.path, { recursive: true });
  await writeAtomic(batchPath(directory, batch.batchId), value, { exclusive, mode: 0o600 });
}
async function childTask(item: BatchItem, directory: string) {
  return getTask(item.taskId, directory).catch((cause: NodeJS.ErrnoException & { status?: number }) => { if (cause.code === "ENOENT" || cause.status === 404 || cause.status === 422 || cause instanceof SyntaxError) return null; throw cause; });
}
function validateGraph(items: BatchInput["items"] | BatchRecord["items"]) {
  const byId = new Map(items.map(item => [item.itemId, item]));
  if (byId.size !== items.length) fail("批次项标识重复", 400);
  const degree = new Map(items.map(item => [item.itemId, new Set(item.dependencies.map(dependency => dependency.itemId)).size]));
  const children = new Map<string, string[]>();
  for (const item of items) {
    const fixed = new Set<string>();
    for (const dependency of item.dependencies) {
      const parent = byId.get(dependency.itemId);
      if (!parent || parent === item) fail("依赖镜头不存在或引用自身", 400);
      const type = dependency.slot === "videos" ? "video" : dependency.slot === "audios" ? "audio" : "image";
      if (parent.mediaType !== type) fail("依赖输出类型与参考位置不匹配", 400);
      if (dependency.slot === "firstFrame" || dependency.slot === "lastFrame") { if (fixed.has(dependency.slot) || (item.request as MediaGenerationRequest)[dependency.slot]) fail("首尾帧位置不能重复指定", 400); fixed.add(dependency.slot); }
      if (parent.mediaType !== "image" && dependency.resultIndex !== 0 || parent.mediaType === "image" && dependency.resultIndex >= ((parent.request as MediaGenerationRequest).n ?? 1)) fail("依赖结果序号超过上游声明的输出数量", 400);
    }
    for (const id of new Set(item.dependencies.map(dependency => dependency.itemId))) children.set(id, [...children.get(id) ?? [], item.itemId]);
  }
  const ready = [...degree].filter(([, count]) => !count).map(([id]) => id); let count = 0;
  for (let index = 0; index < ready.length; index++) { count++; for (const id of children.get(ready[index]!) ?? []) { degree.set(id, degree.get(id)! - 1); if (!degree.get(id)) ready.push(id); } }
  if (count !== items.length) fail("批次存在循环依赖，请调整参考来源", 400);
  return ready;
}
function attach(request: MediaGenerationRequest, slot: typeof slots[number], file: MediaReference) {
  if (slot === "firstFrame" || slot === "lastFrame") request[slot] = file;
  else request[slot] = [...request[slot] ?? [], file];
}
async function fixedReferences(directory: string, project: ProjectRecord, request: MediaGenerationRequest): Promise<BatchItem["referenceVersions"]> {
  const versions = new Map<string, ProjectRecord["assetVersions"][number]>();
  const files = new Map(project.assetVersions.flatMap(version => version.files.map(file => [file.path, { version, file }] as const)));
  for (const reference of references(request)) {
    const entry = files.get(reference.path);
    if (!entry || entry.file.mimeType !== reference.mimeType) fail("批次已有参考须为项目中登记的固定版本；请先用素材带入或生成结果登记版本", 400);
    versions.set(entry.version.versionId, entry.version);
  }
  for (const version of versions.values()) await verifyVersion(directory, version);
  return [...versions.values()].map(version => ({ assetId: version.assetId, versionId: version.versionId, role: "批次固定输入" }));
}
export async function prepareBatch(directory: string, value: unknown) {
  const input = batchInputSchema.parse(value);
  return withFileAccess([batchPath(directory, input.batchId) + ".admission"], "write", async () => {
    const prior = await readBatch(directory, input.batchId);
    if (prior) { owned(prior, directory); if (prior.inputHash !== digest(input)) fail("批次编号已用于其他输入"); return batchView(directory, prior); }
    const release = lockWorkspaceFiles([join(directory, projectFileName)]);
    try {
      const project = await readProject(directory);
      if (!project || project.revision !== input.expectedRevision) fail("制作记录已改变，请刷新后准备批次");
      const sequence = project.sequences.find(sequence => sequence.sequenceId === input.sequenceId && !sequence.archived);
      if (!sequence) fail("制作单元不存在或已归档");
      const models = await listMediaModels(); const items: BatchItem[] = []; const costPolicy = await readCostPolicy();
      for (const item of input.items) {
        const shot = project.shots.find(shot => shot.shotId === item.shotId && shot.sequenceId === sequence.sequenceId && !shot.archived);
        if (!shot) fail("批次包含其他单元、缺失或已归档镜头", 400);
        const requestInput = (item.mediaType === "image" ? imageGenerationSchema : item.mediaType === "video" ? videoGenerationSchema : audioGenerationSchema).parse(item.request);
        const providerRevision = await currentProviderRevision(requestInput.providerId);
        const request = await effectiveMediaRequest(item.mediaType, requestInput);
        const output = await resolveWorkspacePath(directory, request.outputDirectory ?? "assets/generated", true); assertProductionPath(directory, [output.path]);
        const model = models.find(model => model.providerId === request.providerId && model.modelId === request.modelId && model.type === item.mediaType);
        if (!model) fail("批次模型不可用，请重新查询模型列表", 400);
        const preview = structuredClone(request);
        item.dependencies.forEach(dependency => attach(preview, dependency.slot, { path: "pendingDependency", mimeType: `${dependency.slot === "videos" ? "video" : dependency.slot === "audios" ? "audio" : "image"}/pending` }));
        validateModelCapabilities(model, item.mediaType, preview);
        const captured = await fixedReferences(directory, project, request);
        const directors = project.directorShots.filter(capture => capture.shotId === shot.shotId && capture.status === "completed" && project.assetVersions.find(version => version.versionId === capture.referenceVersionId)?.files.some(file => references(request).some(reference => reference.path === file.path)));
        for (const reference of shot.references) if (!captured.some(item => item.versionId === reference.versionId)) captured.push({ ...reference, role: `镜头资料，未作为媒体输入${reference.role ? ` · ${reference.role}` : ""}`.slice(0, 200) });
        if (captured.length + item.dependencies.length > 100) fail("批次项最多登记 100 个固定参考版本", 400);
        items.push({ ...item, title: shot.title, canvasId: shot.canvasId, nodeId: shot.nodeId, directorShotId: directors.length === 1 ? directors[0]!.directorShotId : undefined, request, quote: quoteMediaCost(costPolicy, item.mediaType, preview), referenceVersions: captured, shotReferenceVersions: structuredClone(shot.references), taskId: stableId(`${input.batchId}:${item.itemId}`), providerRevision });
      }
      validateGraph(items);
      const plan = { projectId: project.projectId, sequenceId: sequence.sequenceId, sourceRevision: project.revision, name: input.name, items };
      const batch: BatchRecord = { zeromuBatch: true, format: 1, batchId: input.batchId, directory, createdAt: Date.now(), updatedAt: Date.now(), state: "ready", inputHash: digest(input), fingerprint: digest(plan), ...plan };
      await saveBatch(directory, batch, true); return batchView(directory, batch);
    } finally { release(); }
  });
}

export async function batchView(directory: string, batch: BatchRecord): Promise<BatchView> {
  const tasks = new Map<string, MediaTaskRecord | null>();
  for (const item of batch.items) tasks.set(item.itemId, await childTask(item, directory));
  const states = new Map<string, string>();
  function dependencyState(dependency: BatchItem["dependencies"][number]) {
    const parent = tasks.get(dependency.itemId);
    if (!parent) return ["failed", "blocked", "cancelled"].includes(states.get(dependency.itemId) ?? "") ? "blocked" : "waiting";
    if (parent.collectionError || parent.collectionPending) return "waiting";
    if (["completed", "partial"].includes(parent.status) && parent.results[dependency.resultIndex]) return "completed";
    return ["failed", "partial", "completed", "cancelled"].includes(parent.status) ? "blocked" : "waiting";
  }
  for (const id of validateGraph(batch.items)) {
    const item = batch.items.find(item => item.itemId === id)!; const task = tasks.get(id);
    const dependencies = item.dependencies.map(dependencyState);
    states.set(id, task?.status ?? (item.dispatchedAt !== undefined ? "unknown" : item.error ? "failed" : dependencies.includes("blocked") ? "blocked" : dependencies.includes("waiting") ? "waiting" : "ready"));
  }
  const items = batch.items.map(item => {
    const task = tasks.get(item.itemId);
    const unavailable = item.dependencies.map(dependency => tasks.get(dependency.itemId)).find(parent => !parent || parent.status !== "completed" || parent.collectionError || parent.collectionPending);
    const parentFailed = states.get(item.itemId) === "blocked";
    const waiting = item.dependencies.some(dependency => dependencyState(dependency) === "waiting");
    return { ...item, status: states.get(item.itemId)!, reason: !task && item.dispatchedAt !== undefined ? "已派发子任务的记录缺失或损坏，不能确认提交结果。请恢复原记录或到渠道核对；不会自动重新生成。" : item.error || (parentFailed ? "指定的上游结果不可用，保留其他已完成结果；重新生成须建立新批次" : waiting ? unavailable?.collectionError || "等待指定上游结果保存及固定候选登记" : undefined), task: task ? { id: task.id, status: task.status, error: task.error, resultCount: task.results.length, canResume: task.canResume, collectionError: task.collectionError, collectionPending: task.collectionPending } : undefined };
  });
  const { directory: _directory, state, ...record } = batch;
  const counts: Record<string, number> = {}; for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
  const costSummary = summarizeMediaCosts(batch.items.map(item => { const task = tasks.get(item.itemId); return task ? { ...task, archived: false } : { id: item.taskId, status: "queued", phase: "validation", createdAt: batch.createdAt, cost: newTaskCost(item.quote ?? { kind: "unknown", reason: "旧批次没有保存单价依据" }) }; }));
  return { ...record, state: batch.archived || batch.directory !== directory ? "archived" : state === "running" && !live.has(keyFor(directory, batch.batchId)) ? "interrupted" : state, items, counts, costSummary };
}
export async function listBatches(directory: string) {
  const folder = await resolveWorkspacePath(directory, projectPath(directory, "productionBatches"), true);
  const names = await readdir(folder.path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return []; throw cause; });
  const result: BatchView[] = [];
  for (const name of names) if (/^[a-f0-9-]{36}\.json$/i.test(name)) { const batch = await readBatch(directory, name.slice(0, -5)); if (batch) result.push(await batchView(directory, batch)); }
  return result.sort((a, b) => b.createdAt - a.createdAt);
}
async function resolveDependencies(directory: string, batch: BatchRecord, item: BatchItem) {
  const request = structuredClone(item.request); const captured = [...item.referenceVersions];
  for (const dependency of item.dependencies) {
    const parent = batch.items.find(parent => parent.itemId === dependency.itemId)!; const task = await childTask(parent, directory);
    if (!task || !["completed", "partial"].includes(task.status) || task.collectionPending) return null;
    if (task.collectionError) await collectTaskResults(task.id, directory);
    const result = task.results[dependency.resultIndex]; if (!result) return null;
    const receipt = await transferResult(directory, { resultId: `${task.id}:${result.path}`, taskId: task.id, path: result.path, mimeType: result.mimeType, mediaType: result.mediaType, prompt: task.request.prompt, request: task.request, contentHash: result.contentHash }, { kind: "shot", shotId: parent.shotId });
    const project = (await readProject(directory))!;
    const candidate = project.candidates.find(candidate => candidate.candidateId === receipt.candidateId);
    const version = project.assetVersions.find(version => version.versionId === candidate?.versionId); const file = version?.files.find(file => file.hash === result.contentHash);
    if (!version || !file) fail("上游固定候选尚未登记，未提交下游任务");
    await verifyVersion(directory, version); attach(request, dependency.slot, { path: file.path, mimeType: file.mimeType });
    if (!captured.some(reference => reference.versionId === version.versionId)) captured.push({ assetId: version.assetId, versionId: version.versionId, role: `上游 ${parent.title} 结果 ${dependency.resultIndex + 1}` });
  }
  return { request, captured };
}
async function runBatch(directory: string, id: string, controller: AbortController) {
  try {
    while (!controller.signal.aborted) {
      const complete = await withFileAccess([batchPath(directory, id) + ".admission"], "write", async () => {
        const batch = (await readBatch(directory, id))!; if (batch.state !== "running") return true;
        for (const item of batch.items) {
          if (controller.signal.aborted) break;
          const existing = await childTask(item, directory); if (existing || item.error) continue;
          if (item.dispatchedAt !== undefined) continue;
          try {
            const resolved = await resolveDependencies(directory, batch, item);
            if (!resolved) continue;
            if (item.resolvedRequest && (digest(item.resolvedRequest) !== digest(resolved.request) || digest(item.resolvedReferences) !== digest(resolved.captured))) fail("上次解析的依赖范围已变化，请保留原批次并重新确认");
            item.resolvedRequest = resolved.request; item.resolvedReferences = resolved.captured; item.dispatchedAt = Date.now();
            await saveBatch(directory, batch);
            const resolvedRequest: MediaGenerationRequest = resolved.request;
            const { imageTransport: _transport, ...input } = resolvedRequest;
            await startTask(item.taskId, directory, item.mediaType, input, { kind: "batch", batchId: id, batchItemId: item.itemId, projectId: batch.projectId, shotId: item.shotId, canvasId: item.canvasId, nodeId: item.nodeId, directorShotId: item.directorShotId, referenceVersions: resolved.captured, shotReferenceVersions: item.shotReferenceVersions }, { request: resolved.request, providerRevision: item.providerRevision, quote: item.quote ?? { kind: "unknown", reason: "旧批次没有保存单价依据" } });
          } catch (cause) { item.error = (cause instanceof Error ? cause.message : "批次项校验失败").slice(0, 10000); await saveBatch(directory, batch); }
        }
        const view = await batchView(directory, batch);
        const active = view.items.some(item => activeStatuses.has(item.status) || item.task?.collectionPending);
        const ready = view.items.some(item => item.status === "ready");
        if (!active && !ready) { batch.state = view.items.some(item => ["unknown", "interrupted", "waiting"].includes(item.status) || item.task?.collectionError) ? "paused" : "finished"; await saveBatch(directory, batch); return true; }
        return false;
      });
      if (complete) return;
      await setTimeout(500, undefined, { signal: controller.signal });
    }
  } catch (cause) {
    if (!controller.signal.aborted) await withFileAccess([batchPath(directory, id) + ".admission"], "write", async () => { const batch = await readBatch(directory, id); if (batch) { batch.state = "paused"; batch.error = (cause instanceof Error ? cause.message : "批次中断").slice(0, 10000); await saveBatch(directory, batch); } });
  } finally { if (live.get(keyFor(directory, id)) === controller) live.delete(keyFor(directory, id)); }
}
export async function controlBatch(directory: string, id: string, fingerprint: string, action: "run" | "pause") {
  return withFileAccess([batchPath(directory, id) + ".admission"], "write", async () => {
    const batch = await readBatch(directory, id); if (!batch) fail("批次不存在", 404); owned(batch, directory);
    if (batch.fingerprint !== fingerprint) fail("批次确认范围已改变，请重新查看");
    const key = keyFor(directory, id);
    if (action === "pause") { live.get(key)?.abort(); batch.state = "paused"; await saveBatch(directory, batch); return batchView(directory, batch); }
    if (live.has(key) && !live.get(key)!.signal.aborted) return batchView(directory, batch);
    // 确认前核对所有渠道，避免已有一部分提交后才发现另一模型已换配置。
    const costPolicy = await readCostPolicy();
    for (const item of batch.items) if (!await childTask(item, directory)) {
      if (await currentProviderRevision(item.request.providerId) !== item.providerRevision) fail("批次中的渠道或能力已改变，请保留历史并重新准备批次");
      const preview = structuredClone(item.request);
      item.dependencies.forEach(dependency => attach(preview, dependency.slot, { path: "pendingDependency", mimeType: `${dependency.slot === "videos" ? "video" : dependency.slot === "audios" ? "audio" : "image"}/pending` }));
      assertCurrentQuote(item.quote ?? { kind: "unknown", reason: "旧批次没有保存单价依据" }, quoteMediaCost(costPolicy, item.mediaType, preview));
    }
    await checkBatchBudget(directory, batch.items);
    for (const item of batch.items) {
      const task = await childTask(item, directory);
      if (task && task.canResume && !activeStatuses.has(task.status)) await resumeTask(task.id, directory);
      if (task && ["completed", "partial"].includes(task.status) && task.collectionError && task.results.length) await collectTaskResults(task.id, directory);
      if (!task) delete item.error;
    }
    batch.state = "running"; delete batch.error; await saveBatch(directory, batch);
    const controller = new AbortController(); live.set(key, controller);
    void runBatch(directory, id, controller).catch(cause => console.error("保存镜头批次失败", cause));
    return batchView(directory, batch);
  });
}
