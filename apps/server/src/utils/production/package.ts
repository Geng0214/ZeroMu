import { hasProjectLayout, projectCanvasFolder, projectPath } from "@/utils/workspace/projectLayout";
import { pendingLibraryImports, libraryFolder } from "./library";
import { createWriteStream, link, lstat, mkdir, readFile, readdir, realpath, rename, rm, statfs, withFileAccess, writeAtomic } from "@toonflow/file";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import type { Request } from "express";
import { z } from "zod";
import conf from "@/utils/conf";
import { archivedTasks, getTask } from "@/utils/media/tasks";
import { listMediaModels } from "@/utils/media/generation";
import { isWithin, lockWorkspaceFiles, resolveWorkspacePath } from "@/utils/workspace/files";
import { projectFileName, readProject } from "./format";
import { relativePathSchema } from "./schema";
import { extractArchiveFile, hashBytes, hashFile, maxArchiveBytes, readArchiveFile, readArchiveIndex, writeArchive, type ArchiveFile } from "./archive";
import { hasRunningBatch, readBatch, listBatches } from "./batches";
import { pendingTemplates, templateFolder } from "../productionTemplates/plan";
import { readDraft } from "@/utils/studioDrafts";

const fileSchema = z.strictObject({ path: relativePathSchema, size: z.number().int().nonnegative().max(2 * 1024 ** 3), hash: z.string().regex(/^[a-f0-9]{64}$/) });
const manifestSchema = z.strictObject({ zeromuPackage: z.literal(true), format: z.literal(1), packageId: z.uuid(), projectId: z.uuid(), name: z.string().min(1).max(200), revision: z.number().int().nonnegative(), createdAt: z.number().finite().nonnegative(), totalBytes: z.number().int().nonnegative().max(maxArchiveBytes), files: z.array(fileSchema).min(1).max(49999), dependencies: z.strictObject({ nodes: z.array(z.string().max(200)).max(1000), models: z.array(z.strictObject({ providerId: z.string().max(200), modelId: z.string().max(200) })).max(10000) }), warnings: z.array(z.string().max(2000)).max(10000) });
export type ProjectPackageManifest = z.infer<typeof manifestSchema>;
type PackageJob = { jobId: string; directory: string; kind: "export" | "import"; status: "running" | "completed" | "failed" | "cancelled"; phase: string; bytes: number; totalBytes: number; createdAt: number; path?: string; targetParent?: string; folderName?: string; resultDirectory?: string; error?: string; warnings: string[] };
const live = new Map<string, { job: PackageJob; controller: AbortController }>();
export function hasRunningPackage(directory: string) { return [...live.values()].some(({ job }) => job.directory === directory); }
const jobsDirectory = () => join(dirname(conf.path), "projectTransferJobs");
function invalid(message: string, status = 422): never { throw Object.assign(new Error(message), { status }); }
async function saveJob(job: PackageJob) { await mkdir(jobsDirectory(), { recursive: true }); await writeAtomic(join(jobsDirectory(), `${job.jobId}.json`), JSON.stringify(job, null, 2)); }
const keyForPath = (path: string) => path.normalize("NFC").toLowerCase();
function portablePath(path: string) {
  relativePathSchema.parse(path);
  if (path.includes("\\") || path.split("/").some(part => /[<>:"|?*]|[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) invalid("项目包文件路径不兼容 Windows");
  if (["settings.json", "projectimportstate.json", "packagemanifest.json"].includes(path.toLowerCase()) || /^\.env(?:\.|$)/i.test(basename(path)) || /^(?:credentials|secrets)(?:\.|$)/i.test(basename(path)) || /^(?:projectPackages|projectImports|nodes|providers|tools)\//i.test(path)) invalid("项目包不能包含凭据、插件安装目录、导入控制文件或其他项目包");
  return path;
}
function inspectCredentials(value: unknown, redact = false, warnings: string[] = [], sourceDirectory = ""): unknown {
  if (typeof value === "string") { if (/sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}/.test(value)) { if (!redact) invalid("固定资料中发现疑似凭据，请将凭据移到本机设置后再打包"); warnings.push("归集副本已移除疑似凭据文本，原画布保持完整"); return value.replace(/sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}/g, "[已移除凭据]"); } const normalized = value.replaceAll("\\", "/"); const root = sourceDirectory.replaceAll("\\", "/"); if (redact && root && normalized.toLowerCase().startsWith(root.toLowerCase() + "/")) return normalized.slice(root.length + 1); return value; }
  if (Array.isArray(value)) return value.map(item => inspectCredentials(item, redact, warnings, sourceDirectory));
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:apiKey|authorization|accessToken|refreshToken|password|clientSecret|credentialStorageKeyId)$/i.test(key.replace(/[-_\s]/g, "")) && item) { if (!redact) invalid("固定资料中含凭据字段，无法安全打包；原文件保留"); warnings.push(`画布归集副本已移除凭据字段 ${key}`); continue; }
    result[key] = inspectCredentials(item, redact, warnings, sourceDirectory);
  }
  return result;
}
const canvasSchema = z.object({ toonflowCanvas: z.literal(true), nodes: z.array(z.object({ id: z.string().min(1), type: z.string().optional(), position: z.object({ x: z.number().finite(), y: z.number().finite() }), data: z.record(z.string(), z.json()).optional() }).passthrough()).max(10000), edges: z.array(z.object({ id: z.string().min(1), source: z.string(), target: z.string() }).passthrough()).max(100000), viewport: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().finite().positive() }) }).passthrough().superRefine((canvas, context) => { const ids = new Set(canvas.nodes.map(node => node.id)); if (ids.size !== canvas.nodes.length || new Set(canvas.edges.map(edge => edge.id)).size !== canvas.edges.length || canvas.edges.some(edge => !ids.has(edge.source) || !ids.has(edge.target))) context.addIssue({ code: "custom", message: "画布节点或连线身份与引用不一致" }); });
function mediaReference(value: string, key: string, directory = "") {
  if (!value || /^(?:prompt|text|story|dialogue|description|name|label|title|outputDirectory)$/i.test(key)) return;
  const normalized = value.replaceAll("\\", "/"); const root = directory.replaceAll("\\", "/");
  const path = root && normalized.toLowerCase().startsWith(root.toLowerCase() + "/") ? normalized.slice(root.length + 1) : normalized;
  const pathField = /^(?:path|url|textPath|modelPath|filePath|src)$/i.test(key);
  if (pathField && /^(?:https?:|file:|blob:|[a-z]:[\\/])/i.test(path)) invalid("画布引用外部文件或临时链接，请先在原节点保存为项目内媒体后再打包");
  if (/^(assets|productionExports|media|references|exports)\//.test(path) || pathField && relativePathSchema.safeParse(path).success) return portablePath(path);
}
function validateMediaReferences(value: unknown, paths: Set<string>, key = "") {
  if (Array.isArray(value)) { for (const item of value) validateMediaReferences(item, paths, key); return; }
  if (value && typeof value === "object") { for (const [field, item] of Object.entries(value)) validateMediaReferences(item, paths, field); return; }
  if (typeof value !== "string") return; const path = mediaReference(value, key);
  if (path && !paths.has(path) && ![...paths].some(file => file.startsWith(path + "/"))) invalid(`画布引用的媒体未包含在包内：${path}`);
}
async function canvasFiles(directory: string) {
  const result: string[] = [];
  async function visit(folder: string, depth: number) {
    if (depth > 12) invalid("画布目录层级超过归集上限");
    if (folder && await lstat(join(directory, folder, projectFileName)).catch(() => null)) return;
    for (const entry of await readdir(join(directory, folder), { withFileTypes: true })) {
      const path = [folder, entry.name].filter(Boolean).join("/");
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && !entry.name.startsWith(".projectImport") && !/^(?:assets|projectBackups|productionTransfers|productionExports|productionTasks|productionBatches|productionImageEdits|productionTemplateInputs|productionLibraryImports|projectPackages|projectImports|\.git|node_modules)$/.test(entry.name)) await visit(path, depth + 1);
      else if (entry.isFile() && /\.json$/i.test(entry.name) && entry.name !== projectFileName) { const info = await lstat(join(directory, path)); if (info.size > 20 * 1024 ** 2) invalid(`JSON 文件超过归集检查上限：${path}`); if (/"toonflowCanvas"\s*:\s*true/.test(await readFile(join(directory, path), "utf8"))) result.push(path); }
      if (result.length > 10000) invalid("画布数量超过上限");
    }
  }
  await visit(projectCanvasFolder(directory), 0); return result;
}
async function collectPackage(directory: string, job: PackageJob, signal: AbortSignal) {
  const project = await readProject(directory); if (!project) invalid("请先建立制作记录", 404); inspectCredentials(project);
  if (hasRunningBatch(directory)) invalid("镜头批次正在编排，请先暂停并等待已派发任务结束后打包", 409);
  if (project.exports.some(record => record.status === "pending")) invalid("当前项目仍在导出成片，请等待完成或停止后打包", 409);
  const sourceProjectHash = await hashFile(join(directory, projectFileName), signal);
  const files = new Map<string, ArchiveFile>(); const sourceHashes = new Map<string, string>(); const warnings: string[] = []; const nodeTypes = new Set<string>(); const tasks = new Set<string>(); const models = new Map<string, { providerId: string; modelId: string }>();
  async function add(path: string, mutable = false, optional = false) {
    portablePath(path); const name = `project/${path}`; const key = keyForPath(name); if (files.has(key)) { if (files.get(key)!.name !== name) invalid("项目路径仅大小写不同，无法安全迁移"); return; }
    signal.throwIfAborted();
    let target; try { target = await resolveWorkspacePath(directory, path); const info = await lstat(target.path); if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 ** 3) invalid(`不能归集此文件：${path}`); }
    catch (error) { if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") { warnings.push(`历史原始位置已缺失：${path}`); return; } throw error; }
    const info = await lstat(target.path); const hash = await hashFile(target.path, signal); sourceHashes.set(path, hash);
    let bytes: Uint8Array | undefined;
    if (/\.json$/i.test(path)) {
      if (info.size > 20 * 1024 ** 2) invalid(`JSON 文件超过 20 MB：${path}`);
      const raw = await readFile(target.path); if (hashBytes(raw) !== hash) invalid("JSON 在归集期间变化，请保存后重新打包", 409);
      const value = JSON.parse(raw.toString("utf8")); mutable ||= value?.toonflowCanvas === true;
      const safe = inspectCredentials(value, mutable, warnings, directory);
      if (mutable) bytes = Buffer.from(JSON.stringify(safe, null, 2));
    }
    files.set(key, { name, path: target.path, bytes, size: bytes?.length ?? info.size, hash: bytes ? hashBytes(bytes) : hash });
    if (files.size > 49999) invalid("项目包文件数量超过上限");
  }
  let visited = 0;
  async function tree(path: string, optional = false, depth = 0) {
    if (++visited > 100000 || depth > 32) invalid("引用目录数量或层级超过归集上限");
    const target = await resolveWorkspacePath(directory, path, true); const info = await lstat(target.path).catch((error: NodeJS.ErrnoException) => { if (optional && error.code === "ENOENT") return null; throw error; }); if (!info) return;
    if (info.isSymbolicLink()) invalid("项目引用目录包含链接，不能打包");
    if (info.isFile()) return add(path, false, optional);
    for (const entry of await readdir(target.path, { withFileTypes: true })) { if (entry.isSymbolicLink()) invalid("项目引用目录包含链接，不能打包"); if (entry.isDirectory()) await tree(`${path}/${entry.name}`, false, depth + 1); else await add(`${path}/${entry.name}`); }
  }
  async function references(value: unknown, key = "", optional = false) {
    if (Array.isArray(value)) { for (const item of value) await references(item, key, optional); return; }
    if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      if (typeof object.providerId === "string" && typeof object.modelId === "string") models.set(JSON.stringify([object.providerId, object.modelId]), { providerId: object.providerId, modelId: object.modelId });
      if (typeof object.model === "string" && object.model.startsWith("[")) {
        try { const selected: unknown = JSON.parse(object.model); if (Array.isArray(selected) && selected.length === 2 && selected.every(item => typeof item === "string" && item.length > 0 && item.length <= 200)) models.set(JSON.stringify(selected), { providerId: selected[0], modelId: selected[1] }); }
        catch (cause) { if (!(cause instanceof SyntaxError)) throw cause; }
      }
      for (const [field, id] of Object.entries(object)) if (/^(?:taskId|generationTaskId|lastTaskId|latestTaskId)$/i.test(field) && z.uuid().safeParse(id).success) tasks.add(id as string);
      for (const [name, item] of Object.entries(object)) await references(item, name, optional); return;
    }
    if (typeof value !== "string" || !value) return;
    const path = mediaReference(value, key, directory);
    if (path) { const target = await resolveWorkspacePath(directory, path, true); const info = await lstat(target.path).catch((error: NodeJS.ErrnoException) => { if (optional && error.code === "ENOENT") return null; throw error; }); if (info?.isDirectory()) await tree(path, optional); else if (info) await add(path, false, optional); }
  }
  await add(projectFileName);
  if (hasProjectLayout(directory)) await add("projectData/layout.json");
  if (JSON.stringify(project) !== JSON.stringify(await readProject(directory))) invalid("制作记录在归集开始时变化，请保存后重新打包", 409);
  for (const version of project.assetVersions) {
    if (version.taskId) tasks.add(version.taskId);
    for (const file of version.files) {
      await add(file.path);
      if (files.get(keyForPath(`project/${file.path}`))!.hash !== file.hash) invalid("固定版本内容已改变，不能打包", 409);
    }
    await add(projectPath(directory, `assets/production/${version.versionId}/versionManifest.json`), false, true);
  }
  const canvases = [...new Set([...project.canvases.map(canvas => canvas.canvasId), ...await canvasFiles(directory)])];
  for (const path of canvases) {
    await add(path, true); const value = JSON.parse(Buffer.from(files.get(keyForPath(`project/${path}`))!.bytes!).toString());
    const checked = canvasSchema.parse(value);
    for (const node of checked.nodes) { if (node.type?.startsWith("remote-")) nodeTypes.add(node.type); if (/^[a-zA-Z0-9-]+$/.test(node.id)) await tree(`assets/${node.id}`, true); await references(node.data); }
  }
  await tree(projectPath(directory, "productionTransfers"), true); await tree(projectPath(directory, "projectBackups"), true);
  for (const [kind, historyFile] of [["image", "studioImageHistory.json"], ["video", "studioVideoHistory.json"], ["audio", "studioAudioHistory.json"]] as const) {
    const path = hasProjectLayout(directory) ? `projectData/history/${historyFile}` : historyFile;
    const target = await resolveWorkspacePath(directory, path, true);
    const info = await lstat(target.path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if (!info) continue;
    await add(path);
    const bytes = await readFile(target.path);
    if (hashBytes(bytes) !== sourceHashes.get(path)) invalid("工作站结果记录在归集期间变化，请保存后重新打包", 409);
    const history = z.object({
      version: z.literal(1),
      items: z.array(z.object({
        id: z.string(), path: relativePathSchema, mediaType: z.literal(kind), mimeType: z.string(),
        prompt: z.string(), model: z.string(), createdAt: z.number().finite(),
        contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), taskId: z.uuid().optional(),
      }).passthrough()).max(49999),
      hiddenResults: z.array(z.string()).optional(),
    }).passthrough().parse(JSON.parse(bytes.toString("utf8")));
    for (const item of history.items) {
      await add(item.path);
      if (item.contentHash && files.get(keyForPath(`project/${item.path}`))!.hash !== item.contentHash) invalid("工作站结果文件摘要已改变，请核对原件后再打包", 409);
    }
    await references(history, "", true);
  }
  for (const kind of ["image", "video", "audio"] as const) {
    const folder = projectPath(directory, `studioDrafts/${kind}`);
    const draft = await readDraft({ root: directory, path: folder });
    if (!draft.value) continue;
    const path = `${folder}/draft.json`;
    await add(path);
    if (files.get(keyForPath(`project/${path}`))!.hash !== draft.revision) invalid("工作站草稿在归集期间变化，请保存后重新打包", 409);
    // 仅移除旧目录的上传缓存映射；正文、参数及已保存草稿的参考原件随项目包保留。
    const value = { schemaVersion: 1, value: { ...draft.value, references: draft.value.references.map(({ paths: _paths, ...reference }) => reference) } };
    inspectCredentials(value);
    const bytes = Buffer.from(JSON.stringify(value, null, 2));
    files.set(keyForPath(`project/${path}`), { name: `project/${path}`, bytes, size: bytes.length, hash: hashBytes(bytes) });
    for (const reference of draft.value.references) {
      const path = `${folder}/files/${reference.fileHash}`;
      await add(path);
      if (files.get(keyForPath(`project/${path}`))!.hash !== reference.fileHash) invalid("工作站草稿参考内容已改变，不能打包", 409);
    }
    await references({ model: draft.value.fields.selectedModel });
  }
  const pendingAssets = await pendingLibraryImports(directory);
  if (pendingAssets.warnings.length) invalid("待完成素材带入记录无法完整读取，请保留项目并修复后再打包", 422);
  for (const operation of pendingAssets.items) { await tree(libraryFolder(directory, operation.importId)); warnings.push("项目包保留了待完成的全局素材带入；若副本尚未写完，需要重新选择原素材核对"); }
  const pendingApplications = await pendingTemplates(directory);
  if (pendingApplications.warnings.length) invalid("待完成模板记录无法完整读取，请保留项目并修复后再打包", 422);
  for (const input of pendingApplications.items) { await tree(templateFolder(directory, input.applicationId)); await references(input.mediaBindings, "", true); warnings.push("项目包保留了待完成模板输入，导入后须重新预览并核对模型与参考文件后继续"); }
  const batchFolder = await resolveWorkspacePath(directory, projectPath(directory, "productionBatches"), true);
  const batchFiles = await readdir(batchFolder.path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return []; throw cause; });
  for (const file of batchFiles) if (/^[a-f0-9-]{36}\.json$/i.test(file)) {
    const batch = (await readBatch(directory, file.slice(0, -5)))!;
    await add(projectPath(directory, `productionBatches/${file}`));
    const { directory: _directory, ...record } = batch;
    const archived = { ...record, archived: true }; inspectCredentials(archived);
    const bytes = Buffer.from(JSON.stringify(archived, null, 2));
    files.set(keyForPath(`project/${projectPath(directory, `productionBatches/${file}`)}`), { name: `project/${projectPath(directory, `productionBatches/${file}`)}`, bytes, size: bytes.length, hash: hashBytes(bytes) });
    await references(record, "", true);
  }
  for (const record of project.exports) {
    if (record.status === "completed" && record.path) { await add(record.path); if (record.outputHash && files.get(keyForPath(`project/${record.path}`))!.hash !== record.outputHash) invalid("成片内容摘要已改变，不能打包", 409); }
    if (record.manifestPath) await tree(dirname(record.manifestPath).replaceAll("\\", "/"), true);
  }
  for (const candidate of project.candidates) { if (candidate.taskId) tasks.add(candidate.taskId); await references(candidate.basis.request, "", true); }
  for (const id of tasks) try {
    const task = await getTask(id, directory);
    if (["queued", "submitting", "running", "downloading"].includes(task.status)) invalid("当前项目仍有进行中媒体任务，请核对完成后再打包", 409);
    const { directory: _directory, ...record } = task;
    const receipt = { ...record, archiveProjectId: project.projectId, canResume: false, canCancel: false, archived: true }; inspectCredentials(receipt);
    const bytes = Buffer.from(JSON.stringify(receipt, null, 2)); const name = `project/${projectPath(directory, `productionTasks/${id}.json`)}`; files.set(keyForPath(name), { name, bytes, size: bytes.length, hash: hashBytes(bytes) });
    await references(task.request, "", true); await references(task.results, "", true);
  } catch (error) { if ((error as NodeJS.ErrnoException & { status?: number }).code === "ENOENT" || (error as { status?: number }).status === 404) warnings.push(`任务 ${id} 原记录不可用，素材版本或候选中的固定生成依据仍保留`); else throw error; }
  await tree(projectPath(directory, "productionTasks"), true);
  if (hasProjectLayout(directory)) { await tree("assets", true); await tree("media", true); await tree("references", true); await tree("projectData/history", true); }
  const totalBytes = [...files.values()].reduce((sum, file) => sum + file.size, 0); if (totalBytes > maxArchiveBytes - 32 * 1024 ** 2) invalid("项目包超过当前 3 GB 上限", 413);
  const manifest: ProjectPackageManifest = { zeromuPackage: true, format: 1, packageId: job.jobId, projectId: project.projectId, name: project.name, revision: project.revision, createdAt: job.createdAt, totalBytes, files: [...files.values()].map(file => ({ path: file.name.slice(8), size: file.size, hash: file.hash })), dependencies: { nodes: [...nodeTypes], models: [...models.values()] }, warnings: [...new Set(warnings)] };
  job.totalBytes = totalBytes; job.warnings = manifest.warnings; return { manifest, files: [...files.values()], sourceHashes, sourceProjectHash };
}

async function missingDependencies(manifest: ProjectPackageManifest) {
  const warnings = [...manifest.warnings];
  for (const type of manifest.dependencies.nodes) { const name = type.replace(/^remote-/, ""); if (!/^[a-z][a-zA-Z0-9]*$/.test(name) || !await lstat(join(dirname(conf.path), "nodes", `${name}.umd.js`)).catch(() => null)) warnings.push(`缺少节点插件 ${type}；可以查看已保存媒体，继续编辑需启用对应插件`); }
  const availableModels = manifest.dependencies.models.length ? await listMediaModels().catch(() => []) : [];
  for (const model of manifest.dependencies.models) if (!availableModels.some(item => item.providerId === model.providerId && item.modelId === model.modelId)) warnings.push(`生成渠道 ${model.providerId} / ${model.modelId} 需在本机重新配置`);
  return [...new Set(warnings)];
}
async function packageIndex(path: string) {
  const entries = await readArchiveIndex(path); const keys = new Set<string>();
  for (const entry of entries) { const key = keyForPath(entry.name); if (keys.has(key)) invalid("项目包路径重复或大小写冲突"); keys.add(key); if (entry.name !== "packageManifest.json") { if (!entry.name.startsWith("project/")) invalid("项目包包含未声明目录"); portablePath(entry.name.slice(8)); } }
  const manifestEntry = entries.find(entry => entry.name === "packageManifest.json"); if (!manifestEntry) invalid("项目包缺少清单");
  const manifest = manifestSchema.parse(JSON.parse((await readArchiveFile(path, manifestEntry, 20 * 1024 ** 2)).toString()));
  inspectCredentials(manifest);
  const declared = new Set(manifest.files.map(file => keyForPath(`project/${portablePath(file.path)}`)));
  const entriesByName = new Map(entries.map(entry => [entry.name, entry]));
  if (declared.size !== manifest.files.length || declared.size + 1 !== entries.length || !declared.has(keyForPath(`project/${projectFileName}`))) invalid("项目包清单数量或制作记录不完整");
  for (const file of manifest.files) { const entry = entriesByName.get(`project/${file.path}`); if (!entry || entry.size !== file.size) invalid("项目包文件与清单不一致"); }
  if (manifest.totalBytes !== manifest.files.reduce((sum, file) => sum + file.size, 0)) invalid("项目包总大小不一致");
  return { entriesByName, manifest };
}
export async function inspectPackage(directory: string, path: string) { const target = await resolveWorkspacePath(directory, path); const { manifest } = await packageIndex(target.path); return { manifest, warnings: await missingDependencies(manifest) }; }
async function runJob(job: PackageJob, action: (controller: AbortController) => Promise<void>) {
  const controller = new AbortController(); live.set(job.jobId, { job, controller }); try { await saveJob(job); } catch (error) { live.delete(job.jobId); throw error; }
  void action(controller).then(() => { job.status = "completed"; job.phase = "完成"; }).catch(error => { job.status = controller.signal.aborted ? "cancelled" : "failed"; job.error = controller.signal.aborted ? "操作已停止；原项目保持完整" : error instanceof z.ZodError ? `项目包内容格式无效：${error.issues.slice(0, 4).map(issue => issue.message).join("；")}` : error instanceof Error ? error.message : String(error); }).finally(async () => { try { await saveJob(job); } finally { live.delete(job.jobId); } }).catch(error => console.error("归集状态保存失败，文件保留供核对", error));
  return job;
}
export async function exportPackage(directory: string, expectedRevision: number, jobId: string) {
  return withFileAccess([join(jobsDirectory(), "admission")], "write", async () => {
  const existing = await readJob(jobId, directory, true); if (existing) { if (existing.kind !== "export") invalid("操作标识属于导入", 409); return existing; }
  const project = await readProject(directory); if (!project || project.revision !== expectedRevision) invalid("项目制作记录已变化，请刷新后打包", 409);
  if ([...live.values()].some(item => item.job.directory === directory)) invalid("此项目正在归集或导入", 409);
  if (hasRunningBatch(directory)) invalid("镜头批次正在编排，请先暂停后打包", 409);
  const job: PackageJob = { jobId, directory, kind: "export", status: "running", phase: "归集引用", bytes: 0, totalBytes: 0, createdAt: Date.now(), warnings: [] };
  return runJob(job, async controller => {
    const { manifest, files, sourceHashes, sourceProjectHash } = await collectPackage(directory, job, controller.signal);
    const disk = await statfs(directory); if (disk.bavail * disk.bsize < manifest.totalBytes + 64 * 1024 ** 2) invalid("打包磁盘空间不足", 507);
    const folder = (await resolveWorkspacePath(directory, projectPath(directory, `projectPackages/${jobId}`), true)).path; await mkdir(folder, { recursive: true });
    const bytes = Buffer.from(JSON.stringify(manifest, null, 2)); if (bytes.length > 20 * 1024 ** 2) invalid("项目包清单超过 20 MB", 413); job.totalBytes += bytes.length; const partial = join(folder, "partial.zip"); job.phase = "写入项目包";
    await writeArchive(partial, [{ name: "packageManifest.json", bytes, size: bytes.length, hash: hashBytes(bytes) }, ...files], controller.signal, bytes => { job.bytes = bytes; });
    job.phase = "核对来源";
    if (await hashFile(join(directory, projectFileName), controller.signal) !== sourceProjectHash) invalid("项目制作记录在归集期间变化，请重新打包", 409);
    for (const [path, hash] of sourceHashes) if (await hashFile(join(directory, path), controller.signal) !== hash) invalid("项目文件在归集期间变化，请重新打包", 409);
    controller.signal.throwIfAborted(); await packageIndex(partial); await rename(partial, join(folder, "project.zeromu.zip"));
    job.path = projectPath(directory, `projectPackages/${jobId}/project.zeromu.zip`);
  });
  });
}
export async function uploadPackage(directory: string, uploadId: string, request: Request) {
  if (!request.is("application/octet-stream")) invalid("请上传项目包文件原始内容", 400);
  const path = projectPath(directory, `projectImports/${uploadId}.zip`); const target = await resolveWorkspacePath(directory, path, true); await mkdir(dirname(target.path), { recursive: true }); let bytes = 0;
  const disk = await statfs(directory); const length = Number(request.get("content-length")); if (length > maxArchiveBytes || length > disk.bavail * disk.bsize - 64 * 1024 ** 2) invalid("项目包过大或磁盘空间不足", 413);
  const limit = Math.min(maxArchiveBytes, disk.bavail * disk.bsize - 64 * 1024 ** 2);
  await pipeline(request, new Transform({ transform(chunk: Buffer, _encoding, done) { bytes += chunk.length; done(bytes > limit ? Object.assign(new Error("项目包过大或磁盘空间不足"), { status: 413 }) : null, chunk); } }), createWriteStream(target.path + ".partial", { flags: "wx", mode: 0o600 }));
  if (await lstat(target.path).catch(() => null)) invalid("此上传编号已使用", 409); await rename(target.path + ".partial", target.path);
  return { path, bytes };
}
async function safeRemoveStage(parent: string, stage: string, jobId: string) {
  const actualParent = await realpath(parent); const actual = await realpath(stage).catch(() => null);
  if (actual && isWithin(actualParent, actual) && resolve(actual) === resolve(parent, `.projectImport${jobId}`) && !(await lstat(stage)).isSymbolicLink()) await rm(stage, { recursive: true, force: true });
}
export async function importPackage(directory: string, path: string, targetParent: string, folderName: string, jobId: string) {
  return withFileAccess([join(jobsDirectory(), "admission")], "write", async () => {
  const prior = await readJob(jobId, directory, true); if (prior) { if (prior.kind !== "import" || prior.path !== path || prior.targetParent !== targetParent || prior.folderName !== folderName) invalid("导入标识与原输入冲突", 409); return prior; }
  if (!folderName || folderName.includes("/") || folderName.includes("\\")) invalid("导入项目名称必须是单个文件夹名", 400); portablePath(folderName);
  const archive = await resolveWorkspacePath(directory, path); const { manifest, entriesByName } = await packageIndex(archive.path); const final = (await resolveWorkspacePath(targetParent, folderName, true)).path;
  if (await lstat(final).catch(() => null)) invalid("目标目录已经存在，请选择新名称", 409);
  if ([...live.values()].some(item => item.job.directory === directory)) invalid("此项目正在归集或导入", 409);
  const disk = await statfs(targetParent); if (disk.bavail * disk.bsize < manifest.totalBytes + 64 * 1024 ** 2) invalid("导入磁盘空间不足", 507);
  const job: PackageJob = { jobId, directory, kind: "import", status: "running", phase: "校验并暂存", bytes: 0, totalBytes: manifest.totalBytes, createdAt: Date.now(), warnings: await missingDependencies(manifest), path, targetParent, folderName };
  return runJob(job, async controller => {
    const stage = resolve(targetParent, `.projectImport${jobId}`); await resolveWorkspacePath(targetParent, basename(stage), true); await mkdir(stage);
    let createdFinal = false;
    try {
      for (const file of manifest.files) { controller.signal.throwIfAborted(); const target = await resolveWorkspacePath(stage, file.path, true); await mkdir(dirname(target.path), { recursive: true }); const entry = entriesByName.get(`project/${file.path}`)!; await extractArchiveFile(archive.path, entry, target.path, file.hash, controller.signal, bytes => { job.bytes += bytes; }); }
      const project = await readProject(stage); if (!project || project.projectId !== manifest.projectId || project.revision !== manifest.revision) invalid("项目身份或修订与包清单不一致");
      inspectCredentials(project);
      const filesByPath = new Map(manifest.files.map(file => [file.path, file]));
      for (const version of project.assetVersions) { const detailsHash = hashBytes(JSON.stringify({ files: version.files.map(({ path, ...file }) => file), text: version.text, description: version.description, details: version.details })); if (detailsHash !== version.contentHash) invalid("固定版本资料摘要损坏"); for (const file of version.files) if (filesByPath.get(file.path)?.hash !== file.hash) invalid("固定版本文件摘要与项目不一致"); }
      for (const canvas of project.canvases) if (!manifest.files.some(file => file.path === canvas.canvasId)) invalid("项目登记画布缺失");
      for (const record of project.exports) if (record.status === "completed" && record.path && record.outputHash && filesByPath.get(record.path)?.hash !== record.outputHash) invalid("完成成片缺失或摘要不一致");
      const paths = new Set(manifest.files.map(file => file.path));
      for (const file of manifest.files.filter(file => /\.json$/i.test(file.path))) { if (file.size > 20 * 1024 ** 2) invalid("项目包 JSON 文件超过读取上限"); const value = JSON.parse(await readFile(join(stage, file.path), "utf8")); inspectCredentials(value); if (value.toonflowCanvas || project.canvases.some(canvas => canvas.canvasId === file.path)) { const canvas = canvasSchema.parse(value); if (!file.path.startsWith(projectPath(directory, "projectBackups/"))) for (const node of canvas.nodes) validateMediaReferences(node.data, paths); } }
      await archivedTasks(stage);
      const batches = await listBatches(stage); if (batches.some(batch => batch.state !== "archived")) invalid("迁移批次须为只读历史，不能导入可执行批次");
      controller.signal.throwIfAborted(); job.phase = "提交独立目录"; const release = lockWorkspaceFiles([final]);
      try {
        await mkdir(final); createdFinal = true; await writeAtomic(join(final, "projectImportState.json"), JSON.stringify({ importing: true, jobId }), { exclusive: true });
        // 目标根目录独占新建，文件硬链接也仅新建；暂存位于同一盘，避免覆盖既有目录和额外复制大媒体。
        for (const file of [...manifest.files.filter(file => file.path !== projectFileName), manifest.files.find(file => file.path === projectFileName)!]) { const target = await resolveWorkspacePath(final, file.path, true); await mkdir(dirname(target.path), { recursive: true }); await link(join(stage, file.path), target.path); }
        await writeAtomic(join(final, "projectImportState.json"), JSON.stringify({ importing: false, jobId, packageId: manifest.packageId, importedAt: Date.now(), warnings: job.warnings })); job.resultDirectory = final;
      } finally { release(); }
    } finally { if (!createdFinal || job.resultDirectory) await safeRemoveStage(targetParent, stage, jobId); }
  });
  });
}
async function readJob(jobId: string, directory: string, optional = false): Promise<PackageJob | null> {
  z.uuid().parse(jobId); const active = live.get(jobId); const job = active?.job ?? await readFile(join(jobsDirectory(), `${jobId}.json`), "utf8").then(value => JSON.parse(value) as PackageJob).catch((error: NodeJS.ErrnoException) => { if (optional && error.code === "ENOENT") return null; throw error; });
  if (!job) return null; if (job.directory !== directory) invalid("归集操作不属于此项目", 403);
  if (job.status === "running" && !active) { job.status = "failed"; job.error = "服务已重启，归集或导入中断；原项目保留，请重新操作，已创建的目录需先核对"; await saveJob(job); }
  return job;
}
export async function packageJobs(directory: string) { const names = await readdir(jobsDirectory()).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; }); const result = []; for (const name of names) if (z.uuid().safeParse(name.replace(/\.json$/, "")).success) { const saved = JSON.parse(await readFile(join(jobsDirectory(), name), "utf8")) as PackageJob; if (saved.directory === directory) result.push(await readJob(saved.jobId, directory)); } return result; }
export function cancelPackage(directory: string, jobId: string) { const active = live.get(jobId); if (!active || active.job.directory !== directory) invalid("此操作已结束或不属于当前项目", 409); if (active.job.phase === "提交独立目录") invalid("目录正在提交，请等待完成后打开", 409); active.controller.abort(); return { jobId }; }
