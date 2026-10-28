import { projectCanvasFolder } from './projectPaths';
import { useWorkspaceStore } from '@/stores/workspace';

export function canvasProjects() {
  const workspace = useWorkspaceStore();
  const projects = [...workspace.projectList, ...(workspace.project ? [workspace.project] : [])];
  return [...new Map(projects.map(project => [project.directory, project])).values()];
}
export async function canvasFolder(directory: string) {
  return projectCanvasFolder(directory);
}
export async function ensureCanvasDirectory(): Promise<string> {
  const workspace = useWorkspaceStore();
  await workspace.initialize();
  if (!workspace.project) {
    const { default: router } = await import('@/router');
    await router.push({ path: '/home' });
    throw new Error('请先打开工作空间');
  }
  return workspace.project.directory;
}
