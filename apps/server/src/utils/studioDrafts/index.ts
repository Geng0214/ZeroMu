import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Request } from "express";
import { lstat, mkdir, readFile, realpath, statfs, withFileAccess, writeAtomic } from "@toonflow/file";
import conf from "@/utils/conf";
import { assertAppRequest } from "@/utils/mcp/control";
import { resolveWorkspace } from "@/utils/workspace";
import { lockWorkspaceFiles, resolveWorkspacePath } from "@/utils/workspace/files";
import { draftSchema, fileHashSchema, scopeSchema, storedDraftSchema, type StudioDraftData } from "./schema";

export { draftSchema, fileHashSchema, scopeSchema, revisionSchema } from "./schema";
type DraftScope = { root: string; path: string };
const hashBytes = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
function invalid(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }

export async function resolveScope(req: Request, input: { directory: string; kind: string }): Promise<DraftScope> {
  assertAppRequest(req);
  const value = scopeSchema.parse(input);
  const root = value.directory ? await resolveWorkspace(req, value.directory) : await realpath(dirname(conf.path));
  // 已选项目的正文与附件随目录移动；未选位置的输入保存在应用数据目录。
  return { root, path: `studioDrafts/${value.directory ? "" : "unbound/"}${value.kind}` };
}

async function draftPath(scope: DraftScope, name: string) {
  return (await resolveWorkspacePath(scope.root, `${scope.path}/${name}`, true)).path;
}

export async function readDraft(scope: DraftScope): Promise<{ revision: string; value: StudioDraftData | null }> {
  const path = await draftPath(scope, "draft.json");
  let bytes: Buffer;
  try { bytes = await readFile(path); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { revision: "", value: null }; throw cause; }
  if (bytes.length > 8 * 1024 ** 2) invalid("草稿记录过大，原文件已保留，请先备份后处理", 413);
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { invalid("草稿记录无法读取，原文件已保留，请先备份后处理", 409); }
  const parsed = storedDraftSchema.safeParse(value);
  if (!parsed.success) invalid("草稿格式无法读取，原文件已保留，请使用支持此格式的版本", 409);
  return { revision: hashBytes(bytes), value: parsed.data.value };
}

export async function saveDraft(scope: DraftScope, revision: string, input: StudioDraftData) {
  const value = draftSchema.parse(input);
  const path = await draftPath(scope, "draft.json");
  const release = lockWorkspaceFiles([path]);
  try {
    return await withFileAccess([`${path}.admission`], "write", async () => {
      const current = await readDraft(scope);
      const sameContent = current.value && isDeepStrictEqual({ ...current.value, savedAt: 0 }, { ...value, savedAt: 0 });
      if (revision !== current.revision && !sameContent) invalid("草稿已在其他窗口更新，本页输入未覆盖原记录。请先保留本页输入，再重新打开工作站", 409);
      for (const reference of value.references) {
        const file = await draftPath(scope, `files/${reference.fileHash}`);
        const info = await lstat(file).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return null; throw cause; });
        if (!info?.isFile() || info.size !== reference.size) invalid("草稿参考文件缺失或大小变化，请保留本页输入并重新添加该参考", 409);
      }
      // 响应丢失后的同内容重试只确认原修订，不覆盖另一窗口的内容。
      if (sameContent) return { revision: current.revision };
      const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, value }));
      if (bytes.length > 8 * 1024 ** 2) invalid("草稿内容过大，请减少输入后重试", 413);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeAtomic(path, bytes, { mode: 0o600 });
      return { revision: hashBytes(bytes) };
    });
  } finally { release(); }
}

export async function writeDraftFile(scope: DraftScope, fileHash: string, bytes: Buffer) {
  fileHashSchema.parse(fileHash);
  if (!bytes.length || bytes.length > 100 * 1024 ** 2 || hashBytes(bytes) !== fileHash) invalid("草稿参考内容或摘要无效");
  const path = await draftPath(scope, `files/${fileHash}`);
  const release = lockWorkspaceFiles([path]);
  try {
    const disk = await statfs(scope.root);
    if (disk.bavail * disk.bsize < bytes.length + 1024 ** 2) invalid("保存草稿参考的磁盘空间不足，请保留页面并腾出空间后重试", 507);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try { await writeAtomic(path, bytes, { exclusive: true, mode: 0o600 }); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
      if (!(await readFile(path)).equals(bytes)) invalid("草稿参考原文件内容与摘要不符，原文件已保留，请先备份后处理", 409);
    }
    return { fileHash, size: bytes.length };
  } finally { release(); }
}

export async function readDraftFile(scope: DraftScope, fileHash: string) {
  fileHashSchema.parse(fileHash);
  const path = await draftPath(scope, `files/${fileHash}`);
  if (!(await lstat(path)).isFile()) invalid("草稿参考不是文件");
  return path;
}
