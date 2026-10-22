import axios from 'axios';
import useWorkspaceFiles from './workspaceFiles';
import { useWorkspaceStore } from '@/stores/workspace';

// 保留旧存储目录，移除界面上的项目层级，避免迁移破坏素材引用。
export function canvasDirectories() {
  const workspace = useWorkspaceStore();
  return [...new Set([workspace.project?.directory, ...workspace.projectList.map(item => item.directory)].filter((path): path is string => !!path))];
}

let preparing: Promise<string> | undefined;
export function ensureCanvasDirectory(): Promise<string> {
  if (preparing) return preparing;
  preparing = (async () => {
    const workspace = useWorkspaceStore();
    const existing = canvasDirectories()[0];
    if (existing) return existing;
    const { data } = await axios.get<{ data: { absolutePath: string; directories: { name: string }[] } }>('/api/workspaces/list');
    const root = data.data.absolutePath;
    if (!data.data.directories.some(item => item.name === 'canvases')) {
      try { await useWorkspaceFiles(root).mkdir('canvases'); }
      catch (error) { if (!axios.isAxiosError(error) || error.response?.status !== 409 || error.response.data?.data?.code !== 'EEXIST') throw error; }
    }
    await workspace.openProject(`${root.replace(/[\\/]$/, '')}/canvases`);
    return workspace.project!.directory;
  })().finally(() => { preparing = undefined; });
  return preparing;
}
