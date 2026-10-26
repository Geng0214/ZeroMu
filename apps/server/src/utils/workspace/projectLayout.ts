import { existsSync, readFileSync } from "@toonflow/file";
import { join } from "node:path";

export function projectLayoutVersion(directory: string) {
  const path = join(directory, "projectData", "layout.json");
  if (!existsSync(path)) return 0;
  try {
    const version = JSON.parse(readFileSync(path, "utf8")).zeromuProjectLayout;
    return version === 2 ? 2 : 1;
  } catch { return 1; }
}

export function hasProjectLayout(directory: string) {
  return projectLayoutVersion(directory) > 0;
}

export function projectCanvasFolder(directory: string) {
  return projectLayoutVersion(directory) === 1 ? "canvases" : "";
}

// 旧项目保留原路径；新项目写入清晰的分类目录，清单中始终记录实际相对路径。
export function projectPath(directory: string, path: string) {
  if (!hasProjectLayout(directory)) return path;
  const prefixes: Record<string, string> = {
    "assets/production": "references/versions",
    "assets/transfers": "references/transfers",
    studioDrafts: "projectData/drafts",
    studioReferences: "references/studio",
    projectBackups: "projectData/backups",
    productionTasks: "projectData/tasks",
    productionBatches: "projectData/tasks/batches",
    productionTransfers: "projectData/history/transfers",
    productionImageEdits: "projectData/history/imageEdits",
    productionTemplateInputs: "projectData/history/templateInputs",
    productionLibraryImports: "projectData/history/libraryImports",
    productionExports: "exports",
    projectPackages: "exports/packages",
    projectImports: "projectData/cache/imports",
  };
  const prefix = Object.keys(prefixes).find(prefix => path === prefix || path.startsWith(`${prefix}/`));
  return prefix ? prefixes[prefix] + path.slice(prefix.length) : path;
}
