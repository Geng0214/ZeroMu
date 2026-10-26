import { mkdir, realpath } from "@toonflow/file";
import { join } from "node:path";
import { selectedWorkspace } from "@/utils/workspace/projects";

export async function getAssetsDirectory() {
  const directory = join(selectedWorkspace(), "library", "files");
  await mkdir(directory, { recursive: true });
  return realpath(directory);
}
