import { join } from "node:path";
import { lstat, readFile, writeAtomic, withFileAccess } from "@toonflow/file";
import { selectedWorkspace } from "@/utils/workspace/projects";
import { builtinProductionTemplates, productionTemplateLibrarySchema, productionTemplateMutationSchema, type ProductionTemplateLibrary, type ProductionTemplateLibraryView } from "./schema";

export { productionTemplateMutationSchema } from "./schema";
const libraryPath = () => join(selectedWorkspace(), "promptLibrary", "templates.json");
function fail(message: string, status: number): never { throw Object.assign(new Error(message), { status }); }

async function readLibrary(path = libraryPath()): Promise<ProductionTemplateLibrary> {
  const info = await lstat(path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return null; throw cause; });
  if (!info) return { zeromuProductionTemplateLibrary: true, format: 1, revision: 0, entries: [], favorites: [] };
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024) fail("个人制作模板库须为不超过 8 MB 的普通文件，请保留原件并恢复备份", 422);
  try {
    const library = productionTemplateLibrarySchema.parse(JSON.parse(await readFile(path, "utf8")));
    if (library.favorites.some(id => !library.entries.some(entry => entry.id === id) && !builtinProductionTemplates.some(entry => entry.id === id))) fail("模板收藏指向不存在的记录，请保留库文件并恢复备份", 422);
    return library;
  }
  catch (cause) { if (cause instanceof SyntaxError || cause && typeof cause === "object" && "issues" in cause) fail("个人制作模板库损坏或格式不受支持，原文件已保留，请从已导出的制作模板恢复", 422); throw cause; }
}

function view(library: ProductionTemplateLibrary): ProductionTemplateLibraryView {
  return { revision: library.revision, entries: [
    ...builtinProductionTemplates.map(entry => ({ ...entry, origin: "builtin" as const, favorite: library.favorites.includes(entry.id), archived: false })),
    ...library.entries.map(entry => ({ id: entry.id, definition: entry.definition, origin: "personal" as const, favorite: library.favorites.includes(entry.id), archived: entry.archivedAt !== undefined, updatedAt: entry.updatedAt })),
  ] };
}

export async function readProductionTemplateLibrary() { return view(await readLibrary()); }

export async function updateProductionTemplateLibrary(expectedRevision: number, value: unknown) {
  const operation = productionTemplateMutationSchema.parse(value);
  const path = libraryPath();
  return withFileAccess([`${path}.mutation`], "write", async () => {
    const library = await readLibrary(path);
    if (library.revision !== expectedRevision) fail("制作模板库已在其他页面更新。草稿已保留，请刷新并核对最新内容", 409);
    let entryId: string;
    let changed = true;
    if (operation.type === "create") {
      if (library.entries.length >= 500) fail("个人制作模板库已达 500 条上限，请先导出并整理库文件", 409);
      entryId = crypto.randomUUID(); const now = Date.now();
      library.entries.push({ id: entryId, definition: operation.definition, createdAt: now, updatedAt: now });
    } else {
      entryId = operation.id;
      const entry = library.entries.find(entry => entry.id === entryId);
      if (operation.type === "favorite") {
        if (!entry && !builtinProductionTemplates.some(entry => entry.id === entryId)) fail("制作模板不存在，请刷新列表", 404);
        if (entry?.archivedAt !== undefined) fail("请先恢复归档制作模板再更改收藏", 409);
        changed = library.favorites.includes(entryId) !== operation.value;
        library.favorites = operation.value ? [...new Set([...library.favorites, entryId])] : library.favorites.filter(id => id !== entryId);
      } else {
        if (!entry) fail("个人制作模板不存在，内置制作模板请先另存副本", 404);
        if (operation.type === "archive") {
          changed = (entry.archivedAt !== undefined) !== operation.value;
          if (operation.value) entry.archivedAt = Date.now(); else delete entry.archivedAt;
        } else {
          if (entry.archivedAt !== undefined) fail("请先恢复归档制作模板再编辑", 409);
          changed = JSON.stringify(entry.definition) !== JSON.stringify(operation.definition);
          entry.definition = operation.definition;
        }
        if (changed) entry.updatedAt = Date.now();
      }
    }
    if (changed) {
      library.revision++;
      const text = JSON.stringify(productionTemplateLibrarySchema.parse(library), null, 2);
      if (Buffer.byteLength(text) > 8 * 1024 * 1024) fail("个人制作模板库超过 8 MB，本次未保存。请缩短内容后重试", 413);
      await writeAtomic(path, text, { mode: 0o600 });
    }
    return { library: view(library), entryId };
  });
}
export { previewTemplate, pendingTemplates } from "./plan";
export { captureTemplate, captureOptionsSchema } from "./capture";
export { templateApplicationInputSchema } from "./schema";
