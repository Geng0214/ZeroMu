import { createHash } from "node:crypto";
import { basename, extname, join } from "node:path";
import { lstat, mkdir, readFile, readdir, writeAtomic } from "@toonflow/file";
import { getAssetsDirectory } from "@/utils/assets";
import { metadataKey, readMetadata } from "@/utils/assets/metadata";
import { mentionAssetType } from "@/agent/mentionSources";
import { resolveWorkspacePath } from "@/utils/workspace/files";
import { readProject } from "./format";
import { createVersion, readProjectFile, stableId, verifyVersion } from "./index";
import { importLibraryAssetSchema, librarySourceSchema, type LibraryImportOperation, type LibraryImportPreview, type ProjectRecord } from "./schema";

const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const inputHash = (operation: LibraryImportOperation) => digest(JSON.stringify(importLibraryAssetSchema.parse(operation)));
export const libraryFolder = (id: string) => `productionLibraryImports/${id}`;
function fail(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }
function sourcePath(operation: LibraryImportOperation) { const extension = extname(operation.source.path); return `${libraryFolder(operation.importId)}/original${/^\.[a-z0-9]{1,10}$/i.test(extension) ? extension.toLowerCase() : ".bin"}`; }
async function globalSource(path: string) {
  const root = await getAssetsDirectory();
  const target = await resolveWorkspacePath(root, path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") fail("全局素材原件不存在，请刷新素材库并重新选择", 404); throw cause; });
  const info = await lstat(target.path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") fail("全局素材原件不存在，请刷新素材库并重新选择", 404); throw cause; });
  if (!info.isFile() || info.isSymbolicLink() || info.size > 100 * 1024 * 1024) fail("请选择不超过 100 MB 的普通素材文件", 400);
  const bytes = await readFile(target.path);
  if (bytes.length > 100 * 1024 * 1024) fail("素材文件超过 100 MB", 413);
  const metadata = (await readMetadata())[metadataKey(path)] ?? { title: basename(path).slice(0, 200), description: "", category: "", tags: [], source: "" };
  const checked = librarySourceSchema.safeParse({ path: path.replaceAll("\\", "/"), hash: digest(bytes), bytes: bytes.length, mimeType: mentionAssetType(path).mimeType, metadata });
  if (!checked.success) fail("此素材的资料格式无法读取，请保留原件并在素材库核对后重试", 422);
  return { source: checked.data, bytes };
}
function checkTarget(project: ProjectRecord, operation: LibraryImportOperation) {
  const target = operation.target;
  if (target.mode === "version") {
    const asset = project.assets.find(item => item.assetId === target.assetId && !item.archived);
    if (!asset) fail("目标素材不存在或已归档，请重新选择");
    if (target.parentVersionId && !asset.versionIds.includes(target.parentVersionId)) fail("所选父版本不属于目标素材");
  }
  if ((project.libraryImports?.length ?? 0) >= 10000 || project.assetVersions.length >= 100000 || target.mode === "new" && project.assets.length >= 10000) fail("项目素材数量达到上限，请分拆项目后带入", 413);
}
async function stagedInput(directory: string, operation: LibraryImportOperation) {
  const path = `${libraryFolder(operation.importId)}/import.json`;
  try {
    const bytes = await readProjectFile(directory, path);
    if (bytes.length > 65536) fail("待完成素材记录过大，请保留目录并检查", 422);
    let raw: unknown;
    try { raw = JSON.parse(bytes.toString("utf8")); } catch { fail("待完成素材记录无法解析，请保留目录并检查", 422); }
    const checked = importLibraryAssetSchema.safeParse(raw);
    if (!checked.success) fail("待完成素材记录格式无效，请保留目录并检查", 422);
    const saved = checked.data;
    if (inputHash(saved) !== inputHash(operation)) fail("此带入编号已用于不同内容，请保留原输入并另建带入");
    return true;
  } catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false; throw cause; }
}
async function original(directory: string, operation: LibraryImportOperation) {
  const staged = await stagedInput(directory, operation);
  if (staged) {
    try { const bytes = await readProjectFile(directory, sourcePath(operation)); if (bytes.length !== operation.source.bytes || digest(bytes) !== operation.source.hash) fail("中断素材副本已变化，请保留文件并核对原件"); return { bytes, frozen: true }; }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; }
  }
  const current = await globalSource(operation.source.path);
  if (JSON.stringify(current.source) !== JSON.stringify(operation.source)) fail("全局素材内容或资料已改变，请重新核对后带入；原项目未改动");
  return { bytes: current.bytes, frozen: false };
}
export async function prepareLibraryImport(directory: string, expectedRevision: number, input: Omit<LibraryImportOperation, "type" | "source"> & { path: string }): Promise<LibraryImportPreview> {
  const project = await readProject(directory); if (!project) fail("请先建立制作记录", 404);
  if (project.revision !== expectedRevision) fail("制作记录已更新，请刷新后重新核对");
  const operation = importLibraryAssetSchema.parse({ type: "importLibraryAsset", importId: input.importId, createdAt: input.createdAt, target: input.target, source: (await globalSource(input.path)).source });
  checkTarget(project, operation); const prepared = await original(directory, operation);
  return preview(project, operation, prepared.frozen);
}
function preview(project: ProjectRecord, operation: LibraryImportOperation, frozen: boolean): LibraryImportPreview {
  return { projectId: project.projectId, revision: project.revision, operation, frozen, warning: mentionAssetType(operation.source.path).dataType === "STRING" && operation.source.bytes > 100000 ? "文本较大，完整原件将保存在固定文件中；不自动截断为文字设定。" : "" };
}
export async function previewLibraryImport(directory: string, expectedRevision: number, operation: LibraryImportOperation) {
  const project = await readProject(directory); if (!project) fail("请先建立制作记录", 404);
  if (project.revision !== expectedRevision) fail("制作记录已更新，请刷新后重新核对");
  checkTarget(project, operation); const prepared = await original(directory, operation); return preview(project, operation, prepared.frozen);
}
export async function existingLibraryImport(directory: string, project: ProjectRecord, operation: LibraryImportOperation) {
  const receipt = project.libraryImports?.find(item => item.importId === operation.importId); if (!receipt) return undefined;
  if (receipt.inputHash !== inputHash(operation)) fail("此带入编号已用于其他内容，请保留项目并另建带入");
  const version = project.assetVersions.find(item => item.versionId === receipt.versionId); if (!version) fail("带入记录的固定版本缺失，请恢复项目备份", 422);
  await verifyVersion(directory, version); return receipt;
}
export async function importLibraryAsset(directory: string, project: ProjectRecord, operation: LibraryImportOperation) {
  checkTarget(project, operation); const prepared = await original(directory, operation);
  const folder = libraryFolder(operation.importId); const target = (await resolveWorkspacePath(directory, folder, true)).path; await mkdir(target, { recursive: true });
  await writeAtomic(join(target, "import.json"), JSON.stringify(operation, null, 2), { exclusive: true }).catch(async (cause: NodeJS.ErrnoException) => { if (cause.code !== "EEXIST") throw cause; await stagedInput(directory, operation); });
  const path = sourcePath(operation);
  await writeAtomic((await resolveWorkspacePath(directory, path, true)).path, prepared.bytes, { exclusive: true }).catch(async (cause: NodeJS.ErrnoException) => { if (cause.code !== "EEXIST") throw cause; if (digest(await readProjectFile(directory, path)) !== operation.source.hash) fail("中断素材副本内容冲突，已保留原件"); });
  const assetId = operation.target.mode === "new" ? stableId(`${operation.importId}:libraryAsset`) : operation.target.assetId;
  const versionId = stableId(`${operation.importId}:libraryVersion`);
  if (project.assetVersions.some(item => item.versionId === versionId) || operation.target.mode === "new" && project.assets.some(item => item.assetId === assetId)) fail("带入素材标识冲突，请保留资料并检查");
  const metadata = operation.source.metadata;
  const text = mentionAssetType(operation.source.path).dataType === "STRING" && prepared.bytes.length <= 100000 ? prepared.bytes.toString("utf8") : "";
  const version = await createVersion(directory, { type: "createAssetVersion", assetId, parentVersionId: operation.target.mode === "version" ? operation.target.parentVersionId : undefined, files: [{ path, mimeType: operation.source.mimeType }], text, description: metadata.description || "从全局素材库带入", details: { librarySource: operation.source }, source: "import" }, { versionId, createdAt: operation.createdAt, fileHash: operation.source.hash });
  await verifyVersion(directory, version);
  if (operation.target.mode === "new") project.assets.push({ assetId, name: operation.target.name, kind: operation.target.kind, versionIds: [versionId], activeVersionId: versionId });
  else { const asset = project.assets.find(item => item.assetId === assetId)!; asset.versionIds.push(versionId); asset.activeVersionId = versionId; }
  project.assetVersions.push(version); project.libraryImports ??= [];
  project.libraryImports.push({ importId: operation.importId, inputHash: inputHash(operation), assetId, versionId, createdAt: operation.createdAt, source: operation.source });
  return versionId;
}
export async function pendingLibraryImports(directory: string) {
  const project = await readProject(directory); if (!project) return { items: [] as LibraryImportOperation[], warnings: [] as string[] };
  const folder = (await resolveWorkspacePath(directory, "productionLibraryImports", true)).path;
  const entries = await readdir(folder, { withFileTypes: true }).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return []; throw cause; });
  if (entries.length > 10000) fail("素材带入目录过多，请保留项目并检查", 413);
  const items: LibraryImportOperation[] = []; const warnings: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/i.test(entry.name) || project.libraryImports?.some(item => item.importId === entry.name)) continue;
    try { const bytes = await readProjectFile(directory, `${libraryFolder(entry.name)}/import.json`); if (bytes.length > 65536) fail("记录过大"); const operation = importLibraryAssetSchema.parse(JSON.parse(bytes.toString("utf8"))); if (operation.importId !== entry.name) fail("编号不同"); items.push(operation); }
    catch { warnings.push(`待完成素材 ${entry.name} 无法读取，请保留目录并检查`); }
  }
  return { items, warnings };
}
