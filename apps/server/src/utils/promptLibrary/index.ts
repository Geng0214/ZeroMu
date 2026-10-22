import { dirname, join } from "node:path";
import { lstat, readFile, writeAtomic, withFileAccess } from "@toonflow/file";
import conf from "@/utils/conf";
import { builtinPrompts, promptLibrarySchema, promptMutationSchema, type PromptLibrary, type PromptLibraryView } from "./schema";

export { promptMutationSchema } from "./schema";
const libraryPath = () => join(dirname(conf.path), "promptLibrary.json");
function fail(message: string, status: number): never { throw Object.assign(new Error(message), { status }); }

async function readLibrary(): Promise<PromptLibrary> {
  const path = libraryPath();
  const info = await lstat(path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return null; throw cause; });
  if (!info) return { zeromuPromptLibrary: true, format: 1, revision: 0, entries: [], favorites: [] };
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024) fail("个人提示词库须为不超过 8 MB 的普通文件，请保留原件并恢复备份", 422);
  try { return promptLibrarySchema.parse(JSON.parse(await readFile(path, "utf8"))); }
  catch (cause) { if (cause instanceof SyntaxError || cause && typeof cause === "object" && "issues" in cause) fail("个人提示词库损坏或格式不受支持，原文件已保留，请从已导出的提示词恢复", 422); throw cause; }
}

function view(library: PromptLibrary): PromptLibraryView {
  return { revision: library.revision, entries: [
    ...builtinPrompts.map(entry => ({ ...entry, origin: "builtin" as const, favorite: library.favorites.includes(entry.id), archived: false })),
    ...library.entries.map(entry => ({ id: entry.id, definition: entry.definition, origin: "personal" as const, favorite: library.favorites.includes(entry.id), archived: entry.archivedAt !== undefined, updatedAt: entry.updatedAt })),
  ] };
}

export async function readPromptLibrary() { return view(await readLibrary()); }

export async function updatePromptLibrary(expectedRevision: number, value: unknown) {
  const operation = promptMutationSchema.parse(value);
  return withFileAccess([`${libraryPath()}.mutation`], "write", async () => {
    const library = await readLibrary();
    if (library.revision !== expectedRevision) fail("提示词库已在其他页面更新。草稿已保留，请刷新并核对最新内容", 409);
    let entryId: string;
    let changed = true;
    if (operation.type === "create") {
      if (library.entries.length >= 2000) fail("个人提示词库已达 2000 条上限，请先导出并整理库文件", 409);
      entryId = crypto.randomUUID(); const now = Date.now();
      library.entries.push({ id: entryId, definition: operation.definition, createdAt: now, updatedAt: now });
    } else {
      entryId = operation.id;
      const entry = library.entries.find(entry => entry.id === entryId);
      if (operation.type === "favorite") {
        if (!entry && !builtinPrompts.some(entry => entry.id === entryId)) fail("提示词不存在，请刷新列表", 404);
        if (entry?.archivedAt !== undefined) fail("请先恢复归档提示词再更改收藏", 409);
        changed = library.favorites.includes(entryId) !== operation.value;
        library.favorites = operation.value ? [...new Set([...library.favorites, entryId])] : library.favorites.filter(id => id !== entryId);
      } else {
        if (!entry) fail("个人提示词不存在，内置提示词请先另存副本", 404);
        if (operation.type === "archive") {
          changed = (entry.archivedAt !== undefined) !== operation.value;
          if (operation.value) entry.archivedAt = Date.now(); else delete entry.archivedAt;
        } else {
          if (entry.archivedAt !== undefined) fail("请先恢复归档提示词再编辑", 409);
          changed = JSON.stringify(entry.definition) !== JSON.stringify(operation.definition);
          entry.definition = operation.definition;
        }
        if (changed) entry.updatedAt = Date.now();
      }
    }
    if (changed) {
      library.revision++;
      const text = JSON.stringify(promptLibrarySchema.parse(library), null, 2);
      if (Buffer.byteLength(text) > 8 * 1024 * 1024) fail("个人提示词库超过 8 MB，本次未保存。请缩短内容后重试", 413);
      await writeAtomic(libraryPath(), text, { mode: 0o600 });
    }
    return { library: view(library), entryId };
  });
}
