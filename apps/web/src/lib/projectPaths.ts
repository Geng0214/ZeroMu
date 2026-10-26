import axios from "axios";
import useWorkspaceFiles from "./workspaceFiles";

export async function projectLayoutVersion(directory: string) {
  try {
    const layout = await useWorkspaceFiles(directory).readJson<{ zeromuProjectLayout?: number }>("projectData/layout.json");
    return layout.zeromuProjectLayout === 2 ? 2 : 1;
  } catch (cause) {
    if (axios.isAxiosError(cause) && cause.response?.status === 404) return 0;
    throw cause;
  }
}
export async function organizedProject(directory: string) {
  return (await projectLayoutVersion(directory)) > 0;
}
export async function projectCanvasFolder(directory: string) {
  return await projectLayoutVersion(directory) === 1 ? "canvases" : "";
}
export async function legacyProjectAssets(directory: string) {
  return await projectLayoutVersion(directory) === 1;
}
export async function projectHistoryPath(directory: string, name: string) {
  return await organizedProject(directory) ? `projectData/history/${name}` : name;
}
export async function projectReferencesPath(directory: string) {
  return await organizedProject(directory) ? "references/studio" : "studioReferences";
}
