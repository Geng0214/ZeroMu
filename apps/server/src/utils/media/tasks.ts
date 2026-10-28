import { mkdir, readdir, readFile, writeAtomic, lstat, unlink, withFileAccess } from "@toonflow/file";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import type { GeneratedMedia, MediaGenerationRequest, MediaTaskRecord, MediaTaskSource } from "@toonflow/tools-scaffold/runtime";
import { hasProjectLayout, projectPath } from "@/utils/workspace/projectLayout";
import conf from "@/utils/conf";
import { currentProviderRevision, effectiveMediaRequest, generateMedia, isGeneratingMedia } from "@/utils/media/generation";
import { lockWorkspaceFiles, resolveWorkspacePath } from "@/utils/workspace/files";
import { readProject } from "@/utils/production/format";
import { directorTaskSource } from "@/utils/production/director";
import { backgroundRemovalTaskSource } from "@/utils/production/backgroundRemoval";
import type { MediaCostQuote, MediaMoney } from "@toonflow/providers/mediaCosts";
import { assertCurrentQuote, assertMediaBudget, costAdmissionPath, newTaskCost, quoteMediaCost, readCostPolicy, summarizeMediaCosts, taskCostSchema, usageSchema } from "@/utils/media/costs";

type MediaTask = Omit<MediaTaskRecord, "canResume" | "canCancel" | "providerTaskId"> & {
  input?: MediaGenerationRequest;
  sourceInput?: MediaTaskSource;
  checkpoints: Record<string, { complete: boolean; value?: unknown }>;
  providerRevision?: string; assets?: MediaAsset[]; saved: Record<string, GeneratedMedia>; results: GeneratedMedia[];
};
type PreparedTask = { request: MediaGenerationRequest; providerRevision: string; quote?: MediaCostQuote; shotReferenceVersions?: MediaTaskSource["shotReferenceVersions"] };
const running = new Map<string, Promise<void>>();
const queued = new Map<string, MediaTask>();
const channelActive = new Map<string, number>();
export const sourceSchema = z.strictObject({
  kind: z.enum(["studio", "node", "agent", "legacy", "batch"]),
  batchId: z.uuid().optional(), batchItemId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  canvasId: z.string().min(1).max(2048).optional(), nodeId: z.string().min(1).max(256).optional(),
  shotId: z.string().min(1).max(256).optional(), toolCallId: z.string().min(1).max(256).optional(),
  directorShotId: z.uuid().optional(),
  imageEdit: z.strictObject({ contextId: z.uuid(), sourceCandidateId: z.uuid() }).optional(),
  referenceVersions: z.array(z.strictObject({ assetId: z.uuid(), versionId: z.uuid(), role: z.string().max(200).optional() })).max(100).optional(),
  shotReferenceVersions: z.array(z.strictObject({ assetId: z.uuid(), versionId: z.uuid(), role: z.string().max(200).optional() })).max(100).optional(),
});
const activeStatuses = new Set(["queued", "submitting", "running", "downloading"]);
const taskSchema = z.object({
  cost: taskCostSchema.optional(),
  id: z.uuid(), directory: z.string().min(1), mediaType: z.enum(["image", "video", "audio"]),
  request: z.object({ providerId: z.string(), modelId: z.string(), prompt: z.string() }).passthrough(),
  input: z.object({ providerId: z.string(), modelId: z.string(), prompt: z.string() }).passthrough().optional(),
  createdAt: z.number().finite(), updatedAt: z.number().finite().optional(), source: sourceSchema.optional(),
  sourceInput: sourceSchema.optional(),
  status: z.enum(["queued", "submitting", "running", "downloading", "unknown", "completed", "partial", "failed", "cancelled"]),
  phase: z.enum(["validation", "submission", "generation", "download"]).optional(),
  error: z.string().optional(), providerRevision: z.string().optional(),
  assets: z.array(z.object({ type: z.enum(["url", "base64"]), mediaType: z.enum(["image", "video", "audio"]) }).passthrough()).optional(),
  checkpoints: z.record(z.string(), z.object({ complete: z.boolean(), value: z.unknown().optional() })),
  saved: z.record(z.string(), z.object({ path: z.string(), mimeType: z.string(), mediaType: z.enum(["image", "video", "audio"]) }).passthrough()),
  results: z.array(z.object({ path: z.string(), mimeType: z.string(), mediaType: z.enum(["image", "video", "audio"]) }).passthrough()),
}).passthrough();
const taskIndex = new Map<string, { directory: string; providerRevision?: string; task: ReturnType<typeof view> }>();
let indexing: Promise<void> | undefined;
const invalidTasks = new Set<string>();
const collections = new Map<string, Promise<void>>();
const taskDirectory = () => join(dirname(conf.path), "mediaTasks");
const taskPath = (id: string) => join(taskDirectory(), `${id}.json`);
function indexTask(task: MediaTask) { taskIndex.set(task.id, { directory: task.directory, providerRevision: task.providerRevision, task: { ...view(task), status: task.status, error: task.error } }); }
async function writeTask(task: MediaTask) {
  task.updatedAt = Date.now();
  await writeAtomic(taskPath(task.id), JSON.stringify(task), { mode: 0o600 });
  indexTask(task);
  await saveProjectTask(task);
}
async function saveProjectTask(task: MediaTask) {
  if (hasProjectLayout(task.directory) && task.source.projectId) {
    const path = await resolveWorkspacePath(task.directory, `projectData/tasks/${task.id}.json`, true);
    await mkdir(dirname(path.path), { recursive: true });
    const { directory: _directory, ...record } = view(task);
    const snapshot = { ...record, archived: true, archiveProjectId: task.source.projectId };
    await writeAtomic(path.path, JSON.stringify(snapshot), { mode: 0o600 });
  }
}
function interruption(task: Pick<MediaTaskRecord, "id" | "status" | "canResume" | "error">) {
  if (!activeStatuses.has(task.status) || running.has(task.id) || queued.get(task.id)?.status === "queued") return { status: task.status, error: task.error };
  if (task.status === "queued") return { status: "interrupted" as const, error: "服务已重启，此任务尚未提交。可继续排队或取消排队。" };
  return { status: task.canResume ? "interrupted" as const : "unknown" as const, error: task.canResume
    ? "服务已重启，可继续查询原任务或取回结果。" : "服务已重启，提交结果尚未确认。请到渠道核对结果，避免重复生成。" };
}
function view(task: MediaTask): MediaTaskRecord {
  const collectionPending = !!task.collectionPending && (running.has(task.id) || collections.has(task.id));
  const collectionError = task.collectionError || (task.collectionPending && !collectionPending ? "服务已重启，结果已保存，可重新登记镜头候选" : undefined);
  const canResume = task.status === "queued" || !["completed", "cancelled"].includes(task.status) && (task.assets ? Object.keys(task.saved).length < task.assets.length
    : Object.values(task.checkpoints).some(item => item.complete) && !Object.values(task.checkpoints).some(item => !item.complete));
  const submission = task.checkpoints.videoSubmission?.value ?? Object.entries(task.checkpoints).find(([key, item]) => key.includes("Submission") && item.complete)?.[1].value;
  const source = submission && typeof submission === "object" ? submission as Record<string, unknown> : {};
  const nested = source.data && typeof source.data === "object" && !Array.isArray(source.data) ? source.data as Record<string, unknown> : {};
  const providerTaskId = typeof submission === "string" ? submission : [source.video_id, nested.video_id, source.id, source.task_id, source.requestId, nested.id, nested.task_id]
    .find(value => typeof value === "string" && value.trim());
  return { id: task.id, directory: task.directory, source: task.source ?? { kind: "studio" },
    providerTaskId: typeof providerTaskId === "string" ? providerTaskId : undefined, mediaType: task.mediaType,
    request: task.request, createdAt: task.createdAt, updatedAt: task.updatedAt ?? task.createdAt, results: task.results,
    phase: task.phase ?? "generation", cost: task.cost, collectionError, collectionPending, canResume, canCancel: task.status === "queued" && !task.cost?.submittedAt && !Object.keys(task.checkpoints).length, ...interruption({ ...task, canResume }) };
}
async function readTask(id: string, directory?: string) {
  const task = JSON.parse(await readFile(taskPath(id), "utf8")) as MediaTask;
  if (!taskSchema.safeParse(task).success || task.id !== id) throw Object.assign(new Error(`任务记录 ${id}.json 损坏，请先备份并检查该文件`), { status: 422 });
  if (directory !== undefined && task.directory !== directory) throw Object.assign(new Error("任务不属于当前工作空间"), { status: 403 });
  if (directory !== undefined && task.source?.projectId && task.source.projectId !== (await readProject(directory))?.projectId) throw Object.assign(new Error("任务不属于当前工作空间"), { status: 403 });
  task.source ??= { kind: "studio" };
  task.updatedAt ??= task.createdAt;
  task.phase ??= "generation";
  return task;
}
function execute(task: MediaTask) {
  if (running.has(task.id)) return;
  task.status = task.assets ? "downloading" : "running"; task.phase = task.assets ? "download" : "validation"; task.error = undefined;
  indexTask(task);
  const promise = (async () => {
    try {
      await writeTask(task);
      task.results = await generateMedia(task.directory, task.mediaType, task.request, undefined, {
        assets: task.assets, saved: task.saved,
        // 已确认提交的任务只沿用原请求查询或取回，不用新的能力规则阻断原任务恢复。
        validateCapabilities: !Object.values(task.checkpoints).some(item => item.complete),
        async onGenerating() {
          if (!task.cost?.submittedAt && !Object.keys(task.checkpoints).length) await withFileAccess([costAdmissionPath()], "write", async () => {
            await ensureTaskIndex();
            const policy = await readCostPolicy();
            task.cost ??= newTaskCost({ kind: "unknown", reason: "旧任务没有保存提交时的单价依据" });
            assertCurrentQuote(task.cost.quote, quoteMediaCost(policy, task.mediaType, task.request));
            assertMediaBudget(policy, task.directory, (await indexedCostTasks(task.directory)).filter(item => item.id !== task.id), [view(task)], [...invalidTasks]);
            task.cost.submittedAt = Date.now();
            await writeTask(task);
          });
          task.phase = Object.values(task.checkpoints).some(item => item.complete) ? "generation" : "submission";
          task.status = task.phase === "generation" ? "running" : "submitting";
          await writeTask(task);
        },
        async onProvider(revision) {
          if (task.providerRevision && task.providerRevision !== revision) throw new Error("此任务的渠道配置已变更，请还原渠道配置后继续查询原任务。");
          task.providerRevision = revision; await writeTask(task);
        },
        async onUsage(value) {
          const report = usageSchema.parse(value);
          await withFileAccess([costAdmissionPath()], "write", async () => {
            task.cost ??= newTaskCost({ kind: "unknown", reason: "旧任务没有保存提交时的单价依据" });
            const prior = task.cost.reports.findIndex(item => item.key === report.key);
            if (prior >= 0) task.cost.reports[prior] = { ...report, reportedAt: Date.now() };
            else if (task.cost.reports.length < 100) task.cost.reports.push({ ...report, reportedAt: Date.now() });
            else throw new Error("任务用量回执超过 100 份，请核对供应商账单");
            task.cost.revision++;
            await writeTask(task);
          });
        },
        task: { async run<T>(key: string, submit: () => Promise<T>): Promise<T> {
          const existing = task.checkpoints[key];
          if (existing?.complete) return existing.value as T;
          if (existing) throw new Error("提交响应尚未确认，已停止自动重提以避免重复计费，请在渠道核对任务。");
          task.checkpoints[key] = { complete: false }; await writeTask(task);
          const value = await submit();
          task.checkpoints[key] = { complete: true, value }; task.status = "running"; task.phase = "generation"; await writeTask(task);
          return value;
        } },
        async onAssets(assets) {
          task.status = "downloading"; task.phase = "download";
          task.assets = assets.map(asset => asset.type === "binary" ? { ...asset, type: "base64", data: Buffer.from(asset.data).toString("base64") } : asset);
          await writeTask(task);
        },
        async onSaved(index, item) {
          item.taskId = task.id;
          task.saved[index] = item;
          if (task.assets) task.assets[index] = { type: "url", url: "", mediaType: task.mediaType };
          task.results = Object.values(task.saved); await writeTask(task);
        },
      });
      task.status = task.results.some(item => item.warning) ? "partial" : "completed";
      task.error = task.results.find(item => item.warning)?.warning;
      if (task.assets && Object.keys(task.saved).length === task.assets.length) delete task.assets;
    } catch (cause) {
      task.status = !(cause as { submissionRejected?: boolean })?.submissionRejected && (Object.values(task.checkpoints).some(item => !item.complete) || task.phase === "submission") ? "unknown"
        : Object.keys(task.saved).length ? "partial" : "failed";
      task.error = cause instanceof Error ? cause.message : "生成失败";
      task.results = Object.values(task.saved);
    }
    task.collectionPending = !!(task.source.directorShotId || task.source.imageEdit || task.source.kind === "batch") && !!task.source.shotId && !!task.results.length;
    await writeTask(task);
    if (task.collectionPending) await collectDirectorResults(task);
  })();
  running.set(task.id, promise);
  void promise.catch(cause => console.error("保存媒体任务失败", cause)).finally(() => {
    running.delete(task.id);
    const count = (channelActive.get(task.request.providerId) ?? 1) - 1;
    if (count) channelActive.set(task.request.providerId, count); else channelActive.delete(task.request.providerId);
    scheduleQueuedTasks();
  });
}
export function scheduleQueuedTasks() {
  const configs = conf.get("settings", {}).mediaProviderConfigs as Record<string, { maxConcurrentTasks?: unknown }> | undefined;
  for (const task of queued.values()) {
    if (task.status !== "queued") continue;
    const configured = configs?.[task.request.providerId]?.maxConcurrentTasks;
    // ACT: 内置背景模型每次加载一份 CPU 模型，统一队列保留其单进程容量上限。
    const limit = task.request.providerId === "biRefNet" ? 1 : typeof configured === "number" && Number.isInteger(configured) ? Math.min(8, Math.max(1, configured)) : 2;
    const count = channelActive.get(task.request.providerId) ?? 0;
    if (count >= limit) continue;
    queued.delete(task.id);
    channelActive.set(task.request.providerId, count + 1);
    execute(task);
  }
}
export async function startTask(id: string, directory: string, mediaType: MediaTask["mediaType"], request: MediaGenerationRequest, source: MediaTaskSource = { kind: "studio" }, prepared?: PreparedTask) {
  if (!z.uuid().safeParse(id).success) throw Object.assign(new Error("任务编号无效"), { status: 400 });
  source = sourceSchema.parse(source);
  if (source.kind === "batch" && (!prepared || !source.batchId || !source.batchItemId || !source.shotId)) throw Object.assign(new Error("批次任务须通过已确认的批次提交"), { status: 403 });
  return withFileAccess([join(directory, projectPath(directory, "studioReferences")), costAdmissionPath()], "write", async () => {
    const release = lockWorkspaceFiles([join(directory, projectPath(directory, "studioReferences"))]);
    try {
      await mkdir(taskDirectory(), { recursive: true });
      // 已有编号先按原始输入返回；镜头之后归档或改引用不影响原任务的重放。
      const prior = await readTask(id, directory).catch((cause: NodeJS.ErrnoException) => { if (cause.code !== "ENOENT") throw cause; return undefined; });
      if (prior) {
        if (prior.mediaType !== mediaType || !isDeepStrictEqual(prior.input ?? prior.request, request) || !isDeepStrictEqual(prior.sourceInput ?? prior.source, source)) throw Object.assign(new Error("任务编号已用于其他请求"), { status: 409 });
        return view(prior);
      }
      const project = await readProject(directory);
      if (!project) throw Object.assign(new Error("请先选择一个工作空间"), { status: 409 });
      if (source.projectId && source.projectId !== project?.projectId) throw Object.assign(new Error("任务归属的工作空间标识不匹配"), { status: 409 });
      const contextualSource = await directorTaskSource(directory, project, await backgroundRemovalTaskSource(directory, project, source, request), request);
      const shot = contextualSource.shotId ? project?.shots.find(item => item.shotId === contextualSource.shotId && !item.archived)
        : source.canvasId && source.nodeId ? project?.shots.find(item => !item.archived && item.canvasId === source.canvasId && item.nodeId === source.nodeId) : undefined;
      if (contextualSource.shotId && !shot) throw Object.assign(new Error("镜头不存在或已归档，请重新选择目标"), { status: 409 });
      const capture = project?.directorShots.find(item => item.directorShotId === contextualSource.directorShotId);
      const fixedReferences = capture ? [capture.sceneVersionId, capture.referenceVersionId].flatMap(id => { const version = project?.assetVersions.find(version => version.versionId === id); return version ? [{ assetId: version.assetId, versionId: version.versionId, role: "导演生成依据" }] : []; }) : [];
      const shotReferences = shot ? source.kind === "batch" ? source.shotReferenceVersions : prepared?.shotReferenceVersions ?? shot.references : undefined;
      const taskSource = project ? { ...contextualSource, shotReferenceVersions: undefined, projectId: project.projectId, ...(shot ? {
        shotId: shot.shotId, shotReferenceVersions: shotReferences && structuredClone(shotReferences),
        referenceVersions: source.kind === "batch" ? structuredClone(source.referenceVersions ?? []) : [...structuredClone(shotReferences ?? []).filter(reference => !fixedReferences.some(fixed => fixed.assetId === reference.assetId)), ...fixedReferences],
      } : {}) } : { ...contextualSource, shotReferenceVersions: undefined };
      const task: MediaTask = { id, directory, mediaType, source: taskSource, sourceInput: source, input: request, request: { ...request }, createdAt: Date.now(), updatedAt: Date.now(), status: "queued", phase: "validation", checkpoints: {}, saved: {}, results: [] };
      try { task.request = prepared ? structuredClone(prepared.request) : await effectiveMediaRequest(mediaType, request); task.providerRevision = prepared?.providerRevision ?? await currentProviderRevision(request.providerId); }
      catch (cause) { task.status = "failed"; task.error = cause instanceof Error ? cause.message : "渠道配置无法读取"; }
      await ensureTaskIndex();
      const policy = await readCostPolicy();
      task.cost = newTaskCost(prepared?.quote ?? quoteMediaCost(policy, mediaType, task.request));
      if (task.status === "queued") try { assertMediaBudget(policy, directory, await indexedCostTasks(directory), [view(task)], [...invalidTasks]); }
      catch (cause) { task.status = "failed"; task.error = cause instanceof Error ? cause.message : "预算校验失败"; }
      try { await writeAtomic(taskPath(id), JSON.stringify(task), { exclusive: true, mode: 0o600 }); }
      catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
        const current = await readTask(id, directory);
        if (current.mediaType !== mediaType || !isDeepStrictEqual(current.input ?? current.request, request) || !isDeepStrictEqual(current.sourceInput ?? current.source, source)) throw Object.assign(new Error("任务编号已用于其他请求"), { status: 409 });
        return view(current);
      }
      indexTask(task);
      await saveProjectTask(task);
      if (task.status === "queued") { queued.set(id, task); scheduleQueuedTasks(); }
      return view(task);
    } finally { release(); }
  });
}
async function initializeTaskIndex() {
  const files = await readdir(taskDirectory()).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return []; throw cause; });
  for (const file of files.filter(file => /^[a-f0-9-]{36}\.json$/i.test(file))) {
    const id = file.slice(0, -5);
    if (taskIndex.has(id)) continue;
    try {
      const task = await readTask(id);
      if (!taskIndex.has(id)) indexTask(task);
    } catch (cause) {
      if (cause instanceof SyntaxError || (cause as { status?: number }).status === 422 || (cause as NodeJS.ErrnoException).code === "ENOENT") {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") invalidTasks.add(file);
        console.warn("已跳过损坏或消失的任务记录", { file });
        continue;
      }
      throw cause;
    }
  }
}
async function ensureTaskIndex() { indexing ??= initializeTaskIndex().catch(cause => { indexing = undefined; throw cause; }); await indexing; }
async function indexedCostTasks(directory: string) {
  const project = await readProject(directory);
  return [...taskIndex.values()].filter(item => item.directory === directory && (!item.task.source.projectId || item.task.source.projectId === project?.projectId)).map(item => item.task);
}
export async function projectMediaCosts(directory: string) {
  await ensureTaskIndex();
  const policy = await readCostPolicy();
  return { summary: summarizeMediaCosts(await indexedCostTasks(directory), policy.budgets.find(item => item.directory === directory)), warnings: [...invalidTasks].map(file => `任务记录 ${file} 损坏，预算占用可能不完整`) };
}
export async function checkBatchBudget(directory: string, items: { taskId: string; quote?: MediaCostQuote }[]) {
  return withFileAccess([costAdmissionPath()], "write", async () => {
    await ensureTaskIndex();
    const policy = await readCostPolicy(); const tasks = await indexedCostTasks(directory);
    const pending = items.filter(item => !tasks.some(task => task.id === item.taskId)).map(item => ({ id: item.taskId, cost: newTaskCost(item.quote ?? { kind: "unknown", reason: "旧批次没有保存单价依据" }), status: "queued" as const, phase: "validation" as const, createdAt: Date.now() }));
    if (!pending.length) return;
    assertMediaBudget(policy, directory, tasks, pending, [...invalidTasks]);
  });
}
export async function recordTaskStatement(id: string, directory: string, expectedRevision: number, money: MediaMoney, note: string) {
  return withFileAccess([costAdmissionPath()], "write", async () => {
    if (running.has(id) || queued.has(id)) throw Object.assign(new Error("任务仍在运行或排队，请完成后核对账单"), { status: 409 });
    const task = await readTask(id, directory);
    task.cost ??= newTaskCost({ kind: "unknown", reason: "旧任务没有保存提交时的单价依据" });
    if (task.cost.revision !== expectedRevision) throw Object.assign(new Error("费用回执已变化，请刷新后重试"), { status: 409 });
    if (task.cost.statement) {
      if ((task.cost.statementHistory?.length ?? 0) >= 100) throw Object.assign(new Error("本任务已保留 100 次账单修改，请先导出核对记录"), { status: 409 });
      task.cost.statementHistory = [...task.cost.statementHistory ?? [], task.cost.statement];
    }
    task.cost.statement = { ...money, note, recordedAt: Date.now() }; task.cost.revision++;
    await writeTask(task); return view(task);
  });
}
export async function getTask(id: string, directory: string) {
  if (!z.uuid().safeParse(id).success) throw Object.assign(new Error("任务编号无效"), { status: 400 });
  const cached = taskIndex.get(id);
  if (cached) {
    if (cached.directory !== directory || cached.task.source.projectId && cached.task.source.projectId !== (await readProject(directory))?.projectId) { const archived = await archivedTask(id, directory); if (archived) return archived; throw Object.assign(new Error("任务不属于当前工作空间"), { status: 403 }); }
    return { ...cached.task, ...interruption(cached.task) };
  }
  let task: MediaTask;
  try { task = await readTask(id, directory); }
  catch (error) { const cause = error as NodeJS.ErrnoException & { status?: number }; if (cause.code === "ENOENT" || cause.status === 403) { const archived = await archivedTask(id, directory); if (archived) return archived; } throw error; }
  indexTask(task);
  return view(task);
}
const archivedTaskSchema = z.object({ id: z.uuid(), archiveProjectId: z.uuid(), archived: z.literal(true), mediaType: z.enum(["image", "video", "audio"]), source: sourceSchema, request: taskSchema.shape.request, createdAt: z.number().finite(), updatedAt: z.number().finite(), status: z.enum(["queued", "submitting", "running", "downloading", "unknown", "interrupted", "completed", "partial", "failed", "cancelled"]), phase: z.enum(["validation", "submission", "generation", "download"]), error: z.string().optional(), results: z.array(z.object({ path: z.string(), mimeType: z.string(), mediaType: z.enum(["image", "video", "audio"]) }).passthrough()).max(10000) }).passthrough();
async function archivedTask(id: string, directory: string): Promise<MediaTaskRecord | null> {
  const path = await resolveWorkspacePath(directory, projectPath(directory, `productionTasks/${id}.json`), true);
  const info = await lstat(path.path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; }); if (!info) return null;
  if (!info.isFile() || info.size > 8 * 1024 * 1024) throw Object.assign(new Error("迁移任务记录无效"), { status: 422 });
  const saved = archivedTaskSchema.parse(JSON.parse(await readFile(path.path, "utf8"))); const project = await readProject(directory);
  if (saved.cost !== undefined) taskCostSchema.parse(saved.cost);
  if (!project || saved.archiveProjectId !== project.projectId || saved.id !== id) throw Object.assign(new Error("迁移任务记录与工作空间不一致"), { status: 422 });
  const incomplete = !["completed", "failed", "cancelled"].includes(saved.status);
  return { ...saved, directory, archived: true, status: incomplete ? "unknown" : saved.status, canResume: false, canCancel: false, collectionPending: false, collectionError: undefined, error: incomplete ? "这是迁移的历史任务，请在原机器核对未完成提交；本机不会继续原付费请求" : saved.error } as MediaTaskRecord;
}
export async function archivedTasks(directory: string) { const folder = await resolveWorkspacePath(directory, projectPath(directory, "productionTasks"), true); const names = await readdir(folder.path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; }); const result: MediaTaskRecord[] = []; for (const name of names) if (/^[a-f0-9-]{36}\.json$/i.test(name)) { const task = await archivedTask(name.slice(0, -5), directory); if (task) result.push(task); } return result; }
export async function waitForTask(id: string, directory: string, signal?: AbortSignal) {
  while (true) {
    signal?.throwIfAborted();
    const task = await getTask(id, directory);
    if (!activeStatuses.has(task.status)) {
      if (task.results.length) return task.results.map(item => ({ ...item, taskId: id, ...(task.error ? { warning: task.error } : {}) }));
      throw new Error(`任务 ${id}：${task.error || "没有可保存的生成结果"}；可在任务中心查看记录。`);
    }
    await setTimeout(500, undefined, { signal });
  }
}
export async function generateTask(directory: string, mediaType: MediaTask["mediaType"], request: MediaGenerationRequest, source: MediaTaskSource, signal?: AbortSignal, prepared?: PreparedTask) {
  signal?.throwIfAborted();
  const task = await startTask(crypto.randomUUID(), directory, mediaType, request, source, prepared);
  return waitForTask(task.id, directory, signal);
}
async function collectDirectorResults(task: MediaTask) {
  const prior = collections.get(task.id); if (prior) return prior;
  const job = Promise.resolve().then(async () => {
    try {
      if (task.source.imageEdit) {
        const project = await readProject(task.directory);
        if (!project) throw new Error("来源工作空间不存在，背景移除结果已保存，请保留任务和文件");
        const { updateProject } = await import("@/utils/production");
        await updateProject(task.directory, project.revision, { type: "addBackgroundRemovedCandidate", contextId: task.source.imageEdit.contextId, taskId: task.id });
        task.collectionError = undefined;
        return;
      }
      if (!(task.source.directorShotId || task.source.kind === "batch") || !task.source.shotId || !task.results.length) throw new Error("此任务没有可登记的镜头结果");
      const { transferResult } = await import("@/utils/production/transfer");
      for (const result of task.results) await transferResult(task.directory, { resultId: `${task.id}:${result.path}`, taskId: task.id, path: result.path, mimeType: result.mimeType, mediaType: result.mediaType, prompt: task.request.prompt, request: task.request, contentHash: result.contentHash }, { kind: "shot", shotId: task.source.shotId });
      task.collectionError = undefined;
    } catch (cause) { task.collectionError = cause instanceof Error ? cause.message : "镜头候选登记失败，可重试登记已保存结果"; }
    finally { task.collectionPending = false; try { await writeTask(task); } finally { collections.delete(task.id); } }
  });
  collections.set(task.id, job); return job;
}
export async function collectTaskResults(id: string, directory: string) {
  if (!z.uuid().safeParse(id).success) throw Object.assign(new Error("任务编号无效"), { status: 400 });
  if (running.has(id) || queued.has(id)) throw Object.assign(new Error("任务仍在处理中，请稍后登记已有结果"), { status: 409 });
  const task = await readTask(id, directory);
  await collectDirectorResults(task);
  if (task.collectionError) throw Object.assign(new Error(`结果文件已保存，候选仍待登记：${task.collectionError}`), { status: 409 });
  return getTask(id, directory);
}
export async function listTasks(directory: string, mediaType?: MediaTask["mediaType"], offset = 0, limit = 100) {
  // ACT: 单进程写入同步维护轻量索引，启动时只读一遍记录；外部手工修复后重启服务重建。
  indexing ??= initializeTaskIndex().catch(cause => { indexing = undefined; throw cause; });
  await indexing;
  const project = await readProject(directory);
  const current = [...taskIndex.values()].filter(item => item.directory === directory && (!item.task.source.projectId || item.task.source.projectId === project?.projectId)).map(({ task }) => ({ ...task, ...interruption(task) }));
  const tasks = [...current, ...await archivedTasks(directory).then(tasks => tasks.filter(task => !current.some(item => item.id === task.id)))].filter(task => !mediaType || task.mediaType === mediaType).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  return { tasks: tasks.slice(offset, offset + limit), total: tasks.length, runningCount: tasks.filter(task => activeStatuses.has(task.status)).length,
    attentionCount: tasks.filter(task => !!task.collectionError || ["unknown", "interrupted", "partial", "failed"].includes(task.status)).length,
    warnings: [...invalidTasks].map(file => `任务记录 ${file} 损坏，已跳过；请备份并修复后重启服务`) };
}

export async function providerGenerationChecks(providerId: string, revision: string) {
  indexing ??= initializeTaskIndex().catch(cause => { indexing = undefined; throw cause; });
  await indexing;
  const latest = new Map<string, MediaTaskRecord>();
  for (const item of taskIndex.values()) {
    const task = item.task;
    if (task.request.providerId !== providerId || item.providerRevision !== revision) continue;
    // 本地参数校验和未提交排队不能证明渠道生成接口的行为。
    if (task.phase === "validation" || task.status === "queued" || task.status === "cancelled") continue;
    const previous = latest.get(task.request.modelId);
    if (!previous || task.createdAt > previous.createdAt) latest.set(task.request.modelId, task);
  }
  return [...latest.values()].map(task => ({ modelId: task.request.modelId, mediaType: task.mediaType, taskId: task.id, status: interruption(task).status, checkedAt: task.updatedAt, resultCount: task.results.length }));
}

export async function latestShotTasks(directory: string) {
  const { warnings, tasks } = await listTasks(directory, undefined, 0, 100000);
  const latest = new Map<string, MediaTaskRecord>();
  for (const task of tasks) {
    if (!task.source.shotId) continue;
    const previous = latest.get(task.source.shotId);
    if (!previous || previous.createdAt < task.createdAt || previous.createdAt === task.createdAt && previous.id.localeCompare(task.id) > 0) latest.set(task.source.shotId, task);
  }
  return { tasks: [...latest.values()].map(task => ({ id: task.id, shotId: task.source.shotId!, createdAt: task.createdAt, updatedAt: task.updatedAt, collectionPending: task.collectionPending, collectionError: task.collectionError, ...interruption(task), resultCount: task.results.length })), warnings };
}

export async function cleanupReferences(directory: string) {
  await listTasks(directory, "image", 0, 1);
  if (invalidTasks.size) throw Object.assign(new Error("存在损坏的任务记录，无法确认素材引用；修复记录后再清理"), { status: 409 });
  if (isGeneratingMedia(directory) || [...taskIndex.values()].some(item => item.directory === directory && (running.has(item.task.id) || queued.has(item.task.id)))) {
    throw Object.assign(new Error("工作空间仍有生成任务，请等待完成后再清理"), { status: 409 });
  }
  const release = lockWorkspaceFiles([directory]);
  try {
    const root = (await resolveWorkspacePath(directory, projectPath(directory, "studioReferences"))).path;
    const entries = await readdir(root, { withFileTypes: true }).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return []; throw cause; });
    const candidates: string[] = [];
    for (const entry of entries) if (entry.isFile() && /^[a-f0-9-]{36}$/i.test(entry.name)) {
      const info = await lstat(join(root, entry.name));
      if (Date.now() - info.mtimeMs >= 24 * 3600_000) candidates.push(entry.name);
    }
    if (!candidates.length) return { removed: 0 };
    const retained = new Set<string>();
    function collect(text: string) {
      for (const match of text.matchAll(/(?:studioReferences|references(?:[\\/]|%2f|%5c)+studio)(?:[\\/]|%2f|%5c)+([a-f0-9-]{36})/gi)) retained.add(match[1]!.toLowerCase());
    }
    for (const item of taskIndex.values()) if (item.directory === directory) collect(JSON.stringify(item.task.request));
    async function scan(path: string) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const child = join(path, entry.name);
        if (entry.isSymbolicLink()) throw new Error("工作空间包含链接，无法完整确认引用，已停止清理");
        if (entry.isDirectory()) { if (child !== root) await scan(child); }
        else if (entry.isFile() && /\.(json|jsonl|md|markdown|txt|csv)$/i.test(entry.name)) {
          const text = await readFile(child, "utf8");
          if (/\.json$/i.test(entry.name)) JSON.parse(text);
          if (/\.jsonl$/i.test(entry.name)) for (const line of text.split(/\r?\n/)) if (line.trim()) JSON.parse(line);
          collect(text);
        }
      }
    }
    await scan(directory);
    const unused = candidates.filter(name => !retained.has(name.toLowerCase()));
    // ACT: 只清理本功能生成的 UUID 缓存；保留最近一天、任务、项目文档及对话的引用，检查失败时不删除。
    for (const name of unused) await unlink(join(root, name));
    return { removed: unused.length };
  } finally { release(); }
}
export async function resumeTask(id: string, directory: string) {
  const task = await readTask(id, directory);
  if (task.status === "completed" || running.has(id) || queued.get(id)?.status === "queued") return getTask(id, directory);
  if (!view(task).canResume) throw Object.assign(new Error("该渠道未保存可恢复的任务响应，请在渠道确认原任务状态，避免重复生成。"), { status: 409 });
  task.status = "queued";
  task.error = undefined;
  await writeTask(task);
  queued.set(id, task);
  scheduleQueuedTasks();
  return view(task);
}
export async function cancelTask(id: string, directory: string) {
  const task = queued.get(id) ?? await readTask(id, directory);
  if (task.directory !== directory) throw Object.assign(new Error("任务不属于当前工作空间"), { status: 403 });
  if (task.status === "cancelled") return view(task);
  if (task.status !== "queued" || running.has(id) || task.cost?.submittedAt || Object.keys(task.checkpoints).length) throw Object.assign(new Error("任务已经开始处理，不能取消排队。停止等待不代表终止远端生成或计费。"), { status: 409 });
  task.status = "cancelled";
  task.error = "排队已取消，未向渠道提交生成。";
  indexTask(task);
  try { await writeTask(task); }
  catch (cause) {
    task.error = "本次排队已停止，但取消记录保存失败。请检查数据目录，重启后重新核对并取消。";
    indexTask(task);
    throw cause;
  }
  queued.delete(id);
  return view(task);
}
