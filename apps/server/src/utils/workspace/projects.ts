import { lstat, mkdir, mkdirSync, open, readFile, readdir, realpath, rm, rmdir, writeAtomic, withFileAccess } from "@toonflow/file";
import { basename, dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import conf from "@/utils/conf";
import { projectFileName, readProject } from "@/utils/production/format";
import { projectSchema } from "@/utils/production/schema";
import { projectCanvasFolder, projectLayoutVersion } from "./projectLayout";
import { isWithin, lockWorkspaceFiles, renameWorkspaceFile } from "./files";

const workspaceFile = "zeromuWorkspace.json";
const workspaceSchema = z.strictObject({ zeromuWorkspace: z.literal(true), schemaVersion: z.literal(1), workspaceId: z.uuid(), name: z.string().min(1), createdAt: z.number(), lastProject: z.string().optional() });
const storedProjectSchema = z.object({ directory: z.string().min(1).max(4096), name: z.string().optional(), projectId: z.string().optional(), lastOpenedAt: z.number().optional(), canvasCount: z.number().optional(), updatedAt: z.number().optional() });
export const projectNameSchema = z.string().trim().min(1).max(100).refine(value => !/[<>:"/\\|?*\x00-\x1f]/.test(value) && !/[. ]$/.test(value) && !/^(\.{1,2}|con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(value), "请输入有效的项目名称");
function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
async function info(path: string) { return lstat(path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT" || cause.code === "ENOTDIR") return null; throw cause; }); }
async function ensureFolder(path: string) {
  for (let parent = path; ; parent = dirname(parent)) {
    const existing = await info(parent);
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) fail("保存路径中包含链接或非文件夹内容，请选择普通文件夹", 409);
    if (parent === dirname(parent)) break;
  }
  await mkdir(path, { recursive: true });
}
export function selectedWorkspace() {
  const directory = conf.get("workspaceDirectory", "") || join(dirname(conf.path), "workspaces");
  mkdirSync(directory, { recursive: true });
  mkdirSync(join(directory, "library"), { recursive: true });
  mkdirSync(join(directory, "promptLibrary"), { recursive: true });
  return directory;
}
async function readWorkspace(directory: string) {
  const path = join(directory, workspaceFile);
  const value = await info(path);
  if (!value?.isFile() || value.isSymbolicLink() || value.size > 65536) fail("工作空间记录无效，请重新选择完整的工作空间", 422);
  try { return workspaceSchema.parse(JSON.parse(await readFile(path, "utf8"))); }
  catch { fail("工作空间记录无法读取，原文件已保留", 422); }
}
async function canvasSummary(directory: string) {
  const folder = projectCanvasFolder(directory);
  const root = folder ? join(directory, folder) : directory;
  const entries = await readdir(root, { withFileTypes: true }).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return []; throw cause; });
  let count = 0, updatedAt = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !/\.json$/i.test(entry.name)) continue;
    const path = join(root, entry.name), handle = await open(path, "r"), header = Buffer.alloc(512);
    try { await handle.read(header, 0, 512, 0); } finally { await handle.close(); }
    if (!/"toonflowCanvas"\s*:\s*true/.test(header.toString("utf8"))) continue;
    count++; updatedAt = Math.max(updatedAt, (await lstat(path)).mtimeMs);
  }
  return { count, updatedAt };
}
async function projectInfo(directory: string, name?: string) {
  const record = await readProject(directory);
  const summary = await canvasSummary(directory);
  if (!record && !summary.count) fail("所选文件夹中没有零幕项目或画布文件", 422);
  const layout = projectLayoutVersion(directory);
  return {
    directory,
    name: record?.name || name || basename(directory),
    ...(record?.projectId ? { projectId: record.projectId } : {}),
    layout: layout > 0 ? "organized" as const : "legacy" as const,
    lastOpenedAt: Date.now(),
    canvasCount: summary.count,
    updatedAt: Math.max(record?.updatedAt ?? 0, summary.updatedAt),
  };
}
function directoryKey(path: string) {
  const value = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return process.platform === "win32" ? value.toLowerCase() : value;
}
function storedState() {
  const stores = conf.get("settings", {}).stores;
  const raw = stores && typeof stores === "object" ? (stores as Record<string, unknown>)["toonflow.projectList"] : undefined;
  let value: unknown = raw;
  if (typeof raw === "string") { try { value = JSON.parse(raw); } catch { value = undefined; } }
  const schema = z.object({
    project: storedProjectSchema.nullable().optional(),
    projectList: z.array(storedProjectSchema).optional(),
    legacyProjects: z.array(storedProjectSchema).optional(),
  });
  return schema.safeParse(raw === undefined ? {} : value);
}
function localProjectAccess() {
  return ["win32", "darwin"].includes(process.platform) && (process.env.toonflowDesktop === "1" || process.env.NODE_ENV === "dev");
}
async function savedProjects() {
  const parsed = storedState();
  if (!parsed.success) return { candidates: [] as z.infer<typeof storedProjectSchema>[], active: null, issues: ["原项目索引无法读取；选择项目文件夹可重新接入。"] };
  const candidates = [...(parsed.data.projectList ?? []), ...(parsed.data.legacyProjects ?? []), ...(parsed.data.project ? [parsed.data.project] : [])];
  return { candidates, active: parsed.data.project ?? null, issues: [] as string[] };
}
export async function workspaceState(directory = conf.get("workspaceDirectory", "")) {
  const issues: string[] = [];
  let workspace: { directory: string; name: string; workspaceId: string } | null = null;
  let candidates: z.infer<typeof storedProjectSchema>[] = [];
  let active: z.infer<typeof storedProjectSchema> | null = null;
  const saved = await savedProjects();
  issues.push(...saved.issues);
  candidates.push(...saved.candidates);
  active = saved.active;
  if (directory) {
    try {
      const record = await readWorkspace(directory);
      const root = await realpath(directory);
      workspace = { directory: root, name: record.name, workspaceId: record.workspaceId };
      const legacyRoot = join(root, "projects");
      if (!active && record.lastProject && !isAbsolute(record.lastProject) && !record.lastProject.split(/[\\/]/).includes("..")) {
        const directDirectory = join(root, record.lastProject);
        active = { directory: await info(directDirectory) ? directDirectory : join(legacyRoot, record.lastProject), name: basename(record.lastProject) };
      }
      for (const parent of [root, legacyRoot]) {
        for (const entry of await readdir(parent, { withFileTypes: true }).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return []; throw cause; })) {
          if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
          const projectDirectory = join(parent, entry.name);
          if (parent === root && !(await info(join(projectDirectory, projectFileName)))?.isFile()) continue;
          candidates.push({ directory: projectDirectory, name: entry.name });
        }
      }
    } catch (cause) { issues.push(cause instanceof Error ? cause.message : "旧工作空间读取失败"); }
  }
  const result: Awaited<ReturnType<typeof projectInfo>>[] = [];
  const seen = new Set<string>();
  const allowedRoot = await realpath(join(dirname(conf.path), "workspaces")).catch(() => "");
  const legacyCanvasDirectory = directoryKey(join(dirname(conf.path), "workspaces", "canvases"));
  for (const candidate of candidates) {
    if (!isAbsolute(candidate.directory) || seen.has(directoryKey(candidate.directory))) continue;
    seen.add(directoryKey(candidate.directory));
    try {
      const value = await info(candidate.directory);
      if (!value?.isDirectory() || value.isSymbolicLink()) continue;
      const actual = await realpath(candidate.directory);
      if (!localProjectAccess() && (!allowedRoot || !isWithin(allowedRoot, actual))) continue;
      const legacyName = directoryKey(actual) === legacyCanvasDirectory ? "原有创作" : undefined;
      const details = await projectInfo(actual, legacyName ?? candidate.name);
      result.push({ ...details, ...(legacyName ? { name: legacyName } : {}), lastOpenedAt: candidate.lastOpenedAt ?? 0 });
    } catch (cause) { issues.push((candidate.name || candidate.directory) + "：" + (cause instanceof Error ? cause.message : "项目读取失败")); }
  }
  result.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
  const current = active && result.find(item => directoryKey(item.directory) === directoryKey(active!.directory));
  return { workspace, projects: result, project: current ?? null, recoverableProjects: [] as typeof result, issues };
}
export async function selectWorkspace(directory: string) {
  return withFileAccess([join(directory, workspaceFile) + ".mutation"], "write", async () => {
    if (!await info(join(directory, workspaceFile))) {
      if (await info(join(directory, projectFileName)) || directory === process.env.TOONFLOW_DATA_DIR) fail("请选择用于存放项目的独立工作空间文件夹");
      for (const name of ["library", "promptLibrary"]) await ensureFolder(join(directory, name));
      await writeAtomic(join(directory, workspaceFile), JSON.stringify({ zeromuWorkspace: true, schemaVersion: 1, workspaceId: crypto.randomUUID(), name: basename(directory), createdAt: Date.now() }, null, 2), { exclusive: true });
    }
    await readWorkspace(directory);
    for (const name of ["library", "promptLibrary"]) await ensureFolder(join(directory, name));
    conf.set("workspaceDirectory", directory);
    return workspaceState(directory);
  });
}
export async function openWorkspaceProject(directory: string) {
  return projectInfo(await realpath(directory));
}
export async function newWorkspaceProject(directory = selectedWorkspace()) {
  const root = await realpath(directory);
  await readWorkspace(root);
  const releaseName = lockWorkspaceFiles([join(root, ".projectNames.create")]);
  try {
    const state = await workspaceState(root);
    const latestNumber = state.projects.reduce((latest, item) => {
      const match = /^我的项目(\d+)$/.exec(item.name);
      const number = Number(match?.[1] ?? 0);
      return Number.isSafeInteger(number) ? Math.max(latest, number) : latest;
    }, 0);
    for (let number = latestNumber + 1; ; number++) {
      if (!Number.isSafeInteger(number)) fail("项目编号已超出范围", 409);
      const name = "我的项目" + number;
      const projectDirectory = join(root, name);
      try { await mkdir(projectDirectory); }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code === "EEXIST") continue; throw cause; }
      const dataDirectory = join(projectDirectory, "projectData");
      const canvasPath = join(projectDirectory, "无限画布1.json");
      const layoutPath = join(dataDirectory, "layout.json");
      const manifestPath = join(projectDirectory, projectFileName);
      let dataCreated = false, canvasCreated = false, layoutCreated = false, manifestCreated = false;
      try {
        const projectRecord = projectSchema.parse({
          zeromuProject: true, schemaVersion: 1, projectId: crypto.randomUUID(), name, revision: 0,
          createdAt: Date.now(), updatedAt: Date.now(), canvases: [{ canvasId: "无限画布1.json", name: "无限画布1" }],
          sequences: [], shots: [], assets: [], assetVersions: [], candidates: [], adoptionHistory: [], directorBindings: [],
          directorShots: [], edits: [], exports: [], snapshots: [], storyboardDrafts: [],
        });
        await mkdir(dataDirectory);
        dataCreated = true;
        await writeAtomic(canvasPath, JSON.stringify({ toonflowCanvas: true, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, null, 2), { exclusive: true });
        canvasCreated = true;
        await writeAtomic(layoutPath, JSON.stringify({ zeromuProjectLayout: 2 }, null, 2), { exclusive: true });
        layoutCreated = true;
        await writeAtomic(manifestPath, JSON.stringify(projectRecord, null, 2), { exclusive: true });
        manifestCreated = true;
        return await projectInfo(projectDirectory);
      } catch (cause) {
        if (manifestCreated) await rm(manifestPath).catch(error => console.warn("项目初始化回滚失败", error));
        if (layoutCreated) await rm(layoutPath).catch(error => console.warn("项目初始化回滚失败", error));
        if (canvasCreated) await rm(canvasPath).catch(error => console.warn("项目初始化回滚失败", error));
        if (dataCreated) await rmdir(dataDirectory).catch(error => console.warn("项目初始化回滚失败", error));
        await rmdir(projectDirectory).catch(error => console.warn("项目初始化回滚失败", error));
        throw cause;
      }
    }
  } finally { releaseName(); }
}
export async function importWorkspaceProject(directory: string) {
  return openWorkspaceProject(directory);
}
export async function deleteWorkspaceProject(directory: string, projectId?: string, root = selectedWorkspace()) {
  const projectDirectory = await realpath(directory);
  const value = await lstat(projectDirectory);
  if (!value.isDirectory() || value.isSymbolicLink()) fail("项目必须是普通文件夹", 409);
  const state = await workspaceState(root);
  const listed = state.projects.find(item => directoryKey(item.directory) === directoryKey(projectDirectory))
    ?? state.recoverableProjects?.find(item => directoryKey(item.directory) === directoryKey(projectDirectory));
  if (!listed) fail("项目已不在列表中，请刷新后重试", 409);

  const protectedDirectories = [dirname(conf.path), root, state.workspace?.directory].filter((path): path is string => !!path);
  for (const path of protectedDirectories) {
    const protectedDirectory = await realpath(path).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT" || cause.code === "ENOTDIR") return "";
      throw cause;
    });
    if (protectedDirectory && (directoryKey(projectDirectory) === directoryKey(protectedDirectory) || isWithin(projectDirectory, protectedDirectory))) {
      fail("不能删除应用数据目录或工作空间根目录", 409);
    }
  }

  const record = await readProject(projectDirectory);
  if ((projectId && listed.projectId !== projectId) || (listed.projectId && record?.projectId !== listed.projectId)) {
    fail("项目已变更，请刷新项目列表后重试", 409);
  }

  const release = lockWorkspaceFiles([projectDirectory]);
  try {
    const current = await info(projectDirectory);
    if (!current?.isDirectory() || current.isSymbolicLink() || directoryKey(await realpath(projectDirectory)) !== directoryKey(projectDirectory)) {
      fail("项目目录已变更，请刷新项目列表后重试", 409);
    }
    const latest = await workspaceState(root);
    const latestProject = latest.projects.find(item => directoryKey(item.directory) === directoryKey(projectDirectory));
    if (!latestProject) fail("项目已不在列表中，请刷新后重试", 409);
    if ((projectId && latestProject.projectId !== projectId) || (listed.projectId && latestProject.projectId !== listed.projectId)) {
      fail("项目已变更，请刷新项目列表后重试", 409);
    }
    await rm(projectDirectory, { recursive: true });
  } finally { release(); }
  return workspaceState(root);
}
export async function renameWorkspaceProject(directory: string, projectId: string, name: string, root = selectedWorkspace()) {
  name = projectNameSchema.parse(name);
  const projectDirectory = await realpath(directory);
  const value = await lstat(projectDirectory);
  if (!value.isDirectory() || value.isSymbolicLink()) fail("项目必须是普通文件夹", 409);
  const state = await workspaceState(root);
  const listed = state.projects.find(item => directoryKey(item.directory) === directoryKey(projectDirectory));
  const record = await readProject(projectDirectory);
  if (!listed || listed.projectId !== projectId || !record || record.projectId !== projectId) fail("项目已变更，请刷新项目列表后重试", 409);

  const targetDirectory = join(dirname(projectDirectory), name);
  const directoryChanged = directoryKey(projectDirectory) !== directoryKey(targetDirectory);
  const release = lockWorkspaceFiles([projectDirectory, targetDirectory]);
  try {
    if (directoryChanged) await renameWorkspaceFile(projectDirectory, targetDirectory);
    try {
      if (record.name !== name) {
        record.name = name;
        record.revision++;
        record.updatedAt = Date.now();
        await writeAtomic(join(targetDirectory, projectFileName), JSON.stringify(record, null, 2));
      }
    } catch (cause) {
      if (directoryChanged) await renameWorkspaceFile(targetDirectory, projectDirectory).catch(error => console.warn("项目重命名回滚失败", error));
      throw cause;
    }
    const renamedDirectory = directoryChanged ? targetDirectory : projectDirectory;
    const renamed = { ...listed, directory: renamedDirectory, name, ...(record.updatedAt ? { updatedAt: record.updatedAt } : {}) };
    return {
      ...state,
      projects: state.projects.map(item => directoryKey(item.directory) === directoryKey(projectDirectory) ? renamed : item),
      project: state.project && directoryKey(state.project.directory) === directoryKey(projectDirectory) ? renamed : state.project,
      recoverableProjects: state.recoverableProjects?.map(item => directoryKey(item.directory) === directoryKey(projectDirectory) ? renamed : item),
    };
  } finally {
    release();
  }
}
