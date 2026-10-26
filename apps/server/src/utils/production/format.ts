import { lstat, readFile } from "@toonflow/file";
import { join, relative, resolve } from "node:path";
import { projectSchema } from "./schema";

export const projectFileName = "zeromuProject.json";

export async function readProject(directory: string) {
  const importInfo = await lstat(join(directory, "projectImportState.json")).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  if (importInfo && (!importInfo.isFile() || importInfo.isSymbolicLink() || importInfo.size > 65536)) throw Object.assign(new Error("导入状态文件无效，请保留目录并从项目包恢复"), { status: 423 });
  const importState = importInfo ? await readFile(join(directory, "projectImportState.json"), "utf8") : null;
  if (importState && JSON.parse(importState).importing) throw Object.assign(new Error("此目录仍在导入或导入中断，请从完整项目包恢复到新的目录；现有文件保留供核对"), { status: 423 });
  const path = join(directory, projectFileName);
  const info = await lstat(path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return null; throw cause; });
  if (!info) return null;
  if (info.isSymbolicLink() || !info.isFile() || info.size > 20 * 1024 * 1024) throw Object.assign(new Error("项目制作记录须为不超过 20 MB 的普通文件"), { status: 422 });
  let value: unknown;
  try { value = JSON.parse(await readFile(path, "utf8")); }
  catch (cause) { if (!(cause instanceof SyntaxError)) throw cause; throw Object.assign(new Error("项目制作记录无法解析，请保留原件并从备份恢复"), { status: 422 }); }
  if (value && typeof value === "object" && "zeromuProject" in value && value.zeromuProject === true && "schemaVersion" in value && typeof value.schemaVersion === "number" && value.schemaVersion > 1) {
    throw Object.assign(new Error("此项目采用较新的制作格式，请更新零幕后再修改；当前版本不会覆盖项目"), { status: 409 });
  }
  const checked = projectSchema.safeParse(value);
  if (!checked.success) throw Object.assign(new Error(`项目制作记录损坏或格式不受支持：${checked.error.issues.map(issue => issue.message).slice(0, 4).join("；")}。请保留原件并从备份恢复。`), { status: 422 });
  return checked.data;
}

export async function assertProductionWrite(directory: string, paths: string[], includeParents = false) {
  await readProject(directory);
  assertProductionPath(directory, paths, includeParents);
}

export function assertProductionPath(directory: string, paths: string[], includeParents = false) {
  for (const value of paths) {
    const raw = relative(directory, resolve(directory, value)).replaceAll("\\", "/");
    const path = process.platform === "win32" ? raw.toLowerCase() : raw;
    const reserved = [projectFileName, "references/versions", "references/transfers", "projectData/layout.json", "projectData/drafts", "projectData/backups", "projectData/tasks", "projectData/cache", "projectData/history/transfers", "projectData/history/imageEdits", "projectData/history/templateInputs", "projectData/history/libraryImports", "exports", "studioDrafts", "assets/production", "assets/transfers", "projectBackups", "productionTransfers", "productionExports", "productionTasks", "productionBatches", "productionImageEdits", "productionTemplateInputs", "productionLibraryImports", "projectPackages", "projectImports", "projectImportState.json"].map(value => process.platform === "win32" ? value.toLowerCase() : value);
    if (reserved.some(target => path === target || path.startsWith(`${target}/`) || includeParents && target.startsWith(`${path}/`))) {
      throw Object.assign(new Error("制作记录、工作站草稿、固定版本和恢复备份由对应功能管理，请通过分镜、工作站、素材版本或快照操作修改"), { status: 409 });
    }
  }
}
