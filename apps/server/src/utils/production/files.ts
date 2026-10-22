import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { lstat, mkdir, writeAtomic } from "@toonflow/file";
import { resolveWorkspacePath } from "@/utils/workspace/files";
import { readProject } from "./format";
import { readProjectFile, verifyVersionMetadata } from "./index";
import type { AssetVersion, FileRecoveryOperation, PreparedFileRecovery, ProjectRecord, VersionFileInspection } from "./schema";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function fail(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }
function fixedFile(project: ProjectRecord, versionId: string, index: number) {
  const version = project.assetVersions.find(item => item.versionId === versionId);
  if (!version) fail("固定版本不存在，请刷新制作记录", 404);
  verifyVersionMetadata(version);
  const file = version.files[index];
  if (!file) fail("此固定版本没有所选文件", 404);
  return file;
}
async function fileState(directory: string, file: AssetVersion["files"][number]) {
  try {
    const target = await resolveWorkspacePath(directory, file.path, true);
    const info = await lstat(target.path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return null; throw cause; });
    if (!info) return { status: "missing" as const, message: "文件缺失，可选择相同内容的原文件补回" };
    const bytes = await readProjectFile(directory, file.path);
    return hash(bytes) === file.hash ? { status: "available" as const, message: "文件内容与固定版本一致" } : { status: "changed" as const, message: "文件内容已变化。现有文件保留，请恢复原件；不同内容应保存为新版本" };
  } catch { return { status: "unreadable" as const, message: "文件不可读取，请检查目录、权限或文件类型；原记录保留" }; }
}
export async function inspectVersionFiles(directory: string, versionId: string): Promise<VersionFileInspection> {
  const project = await readProject(directory);
  if (!project) fail("请先建立制作记录", 404);
  const version = project.assetVersions.find(item => item.versionId === versionId);
  if (!version) fail("固定版本不存在", 404);
  verifyVersionMetadata(version);
  const files: VersionFileInspection["files"] = [];
  // ACT: 每版最多 64 个文件，逐个读取避免同时持有多份 100 MB 媒体。
  for (const [index, file] of version.files.entries()) files.push({ index, ...file, ...await fileState(directory, file) });
  return { projectId: project.projectId, revision: project.revision, versionId, files };
}
async function planRecovery(directory: string, project: ProjectRecord, operation: FileRecoveryOperation) {
  const file = fixedFile(project, operation.versionId, operation.fileIndex);
  if (file.hash !== operation.expectedHash) fail("固定版本摘要与核对时不同，请刷新记录后重试");
  const bytes = await readProjectFile(directory, operation.path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") fail("所选原文件已不存在，请重新选择并核对", 404); throw cause; });
  if (hash(bytes) !== file.hash) fail("所选文件与原固定版本内容不同，本次未补回。请重新选择原件；改动内容应保存为新版本");
  const state = await fileState(directory, file);
  if (state.status === "changed" || state.status === "unreadable") fail("固定位置已有不同或不可读文件，本次不会覆盖。请保留现有文件并先恢复目录或权限");
  return { file, bytes, alreadyPresent: state.status === "available" };
}
export async function prepareFileRecovery(directory: string, expectedRevision: number, input: Omit<FileRecoveryOperation, "type" | "expectedHash">): Promise<PreparedFileRecovery> {
  const project = await readProject(directory);
  if (!project) fail("请先建立制作记录", 404);
  if (project.revision !== expectedRevision) fail("制作记录已更新，所选原文件保留，请刷新后重新核对");
  const file = fixedFile(project, input.versionId, input.fileIndex);
  const operation: FileRecoveryOperation = { type: "restoreVersionFile", ...input, expectedHash: file.hash };
  const plan = await planRecovery(directory, project, operation);
  return { projectId: project.projectId, revision: project.revision, operation, bytes: plan.bytes.length, alreadyPresent: plan.alreadyPresent };
}
export async function existingFileRecovery(directory: string, project: ProjectRecord, operation: FileRecoveryOperation) {
  const prior = project.fileRecoveries?.find(item => item.recoveryId === operation.recoveryId);
  if (!prior) return false;
  if (prior.versionId !== operation.versionId || prior.fileIndex !== operation.fileIndex || prior.sourcePath !== operation.path || prior.hash !== operation.expectedHash || prior.createdAt !== operation.createdAt) fail("此恢复编号已用于其他输入，请保留记录并重新核对");
  const file = fixedFile(project, operation.versionId, operation.fileIndex);
  if ((await fileState(directory, file)).status !== "available") fail("此前补回的固定文件再次缺失或发生变化，请选择原件重新恢复");
  return true;
}
export async function restoreVersionFile(directory: string, project: ProjectRecord, operation: FileRecoveryOperation) {
  if ((project.fileRecoveries?.length ?? 0) >= 10000) fail("文件恢复记录达到当前上限，请保留项目备份后整理制作范围", 413);
  const plan = await planRecovery(directory, project, operation);
  const target = (await resolveWorkspacePath(directory, plan.file.path, true)).path;
  await mkdir(dirname(target), { recursive: true });
  await writeAtomic(target, plan.bytes, { exclusive: true }).catch(async (cause: NodeJS.ErrnoException) => {
    if (cause.code !== "EEXIST") throw cause;
    if (hash(await readProjectFile(directory, plan.file.path)) !== plan.file.hash) fail("补回期间固定位置出现了不同内容，现有文件已保留");
  });
  if (hash(await readProjectFile(directory, plan.file.path)) !== plan.file.hash) fail("补回后的文件摘要不一致，请保留目录并检查");
  project.fileRecoveries ??= [];
  project.fileRecoveries.push({ recoveryId: operation.recoveryId, versionId: operation.versionId, fileIndex: operation.fileIndex, sourcePath: operation.path, hash: operation.expectedHash, createdAt: operation.createdAt });
  return operation.versionId;
}
