import type { FlowExportObject } from '@vue-flow/core';
import useWorkspaceFiles from '@/lib/workspaceFiles';
import saveFile from '@/lib/saveFile';
import { legacyProjectAssets } from '@/lib/projectPaths';

export type CanvasDocument = FlowExportObject & { toonflowCanvas: true; bundledAssets?: { path: string; base64: string }[] };

export function validateCanvas(value: unknown): asserts value is CanvasDocument {
  const data = value as Partial<CanvasDocument> | null;
  if (data?.toonflowCanvas !== true || !Array.isArray(data.nodes) || !Array.isArray(data.edges) || !data.viewport
    || ![data.viewport.x, data.viewport.y, data.viewport.zoom].every(Number.isFinite) || data.viewport.zoom <= 0
    || data.nodes.some(node => !node || typeof node.id !== 'string' || !node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y))
    || data.edges.some(edge => !edge || typeof edge.id !== 'string' || typeof edge.source !== 'string' || typeof edge.target !== 'string')) throw new Error('不是有效的零幕画布文件');
  if (new Set(data.nodes.map(node => node.id)).size !== data.nodes.length) throw new Error('画布包含重复节点');
}

export function validCanvasName(value: string) {
  return !!value.trim() && value.trim().length <= 120 && !/[<>:"/\\|?*\x00-\x1f]/.test(value.trim())
    && !/[. ]$/.test(value.trim()) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value.trim());
}

function assetPath(value: string) {
  return !!value && !/^[\\/]|[<>:"|?*\x00-\x1f]/.test(value)
    && !value.replaceAll('\\', '/').split('/').some(part => !part || part === '..' || part === '.' || /[. ]$/.test(part)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

function canvasAssetPaths(data: CanvasDocument) {
  const paths = new Set<string>();
  JSON.stringify(data.nodes, (key, value) => {
    if (typeof value === 'string' && assetPath(value)
      && (/^(assets|studioReferences|media|references)[/\\]/.test(value) || ['url', 'path', 'textPath', 'modelPath'].includes(key))) paths.add(value);
    return value;
  });
  return paths;
}

async function bundleCanvas(directory: string, path: string) {
  const files = useWorkspaceFiles(directory);
  const data = await files.readJson<CanvasDocument>(path);
  validateCanvas(data);
  delete data.bundledAssets;
  const paths = canvasAssetPaths(data);
  const bundledAssets: NonNullable<CanvasDocument['bundledAssets']> = [];
  for (const path of paths) {
    const bytes = new Uint8Array(await files.read(path));
    let binary = '';
    for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
    bundledAssets.push({ path, base64: btoa(binary) });
  }
  return { ...data, bundledAssets };
}

export async function exportCanvas(directory: string, path: string) {
  const data = await bundleCanvas(directory, path);
  await saveFile(new Blob([JSON.stringify(data)], { type: "application/json" }), path.split("/").at(-1)!);
}

export async function copyCanvasFile(directory: string, source: string, target: string) {
  const data = await bundleCanvas(directory, source);
  await importCanvasAssets(directory, data, target);
}

export async function importCanvasAssets(directory: string, data: CanvasDocument, target: string) {
  const { bundledAssets, ...canvas } = data;
  const files = useWorkspaceFiles(directory);
  const references = canvasAssetPaths(canvas);
  if (bundledAssets === undefined || Array.isArray(bundledAssets) && !bundledAssets.length) {
    for (const path of references) {
      const parts = path.replaceAll('\\', '/').split('/');
      const name = parts.pop();
      try {
        if (!(await files.list(parts.join('/'))).entries.some(item => item.type === 'file' && item.name === name)) throw new Error('缺少素材');
      } catch { throw new Error(`画布缺少素材 ${path}，请从原工作空间完整导出后重新导入`); }
    }
    const ids = new Map(canvas.nodes.map(node => [node.id, crypto.randomUUID()]));
    return files.writeJson(target, JSON.parse(JSON.stringify(canvas, (_key, value) => typeof value === 'string' ? ids.get(value) ?? value : value)), true);
  }
  if (!Array.isArray(bundledAssets) || bundledAssets.some(item => !item || typeof item.path !== 'string' || !assetPath(item.path) || typeof item.base64 !== 'string')) throw new Error('画布素材数据无效');
  if (new Set(bundledAssets.map(item => item.path)).size !== bundledAssets.length) throw new Error('画布包含重复素材路径');
  for (const path of references) if (!bundledAssets.some(asset => asset.path === path)) throw new Error(`画布缺少素材 ${path}，请重新完整导出后导入`);
  const paths = new Map<string, string>();
  const nodeIds = new Map(canvas.nodes.map(node => [node.id, crypto.randomUUID()]));
  const createdDirectories: string[] = [];
  const organized = await legacyProjectAssets(directory);
  const nodeRoot = organized ? 'references/nodes' : 'assets';
  const prefix = `${organized ? 'references' : 'assets'}/import${crypto.randomUUID().replaceAll('-', '')}`;
  if (!organized && !(await files.list()).entries.some(item => item.name === 'assets' && item.type === 'directory')) await files.mkdir('assets');
  await files.mkdir(prefix);
  createdDirectories.push(prefix);
  try {
  for (const [index, item] of bundledAssets.entries()) {
    const extension = item.path.match(/\.[a-z0-9]{1,10}$/i)?.[0] ?? '';
    const parts = item.path.replaceAll('\\', '/').split('/');
    const owner = parts[0] === 'assets' ? nodeIds.get(parts[1]) : parts[0] === 'references' && parts[1] === 'nodes' ? nodeIds.get(parts[2]) : undefined;
    const suffix = parts.slice(parts[0] === 'assets' ? 2 : 3).join('/');
    const path = owner ? `${nodeRoot}/${owner}/${suffix}` : `${prefix}/${index}${extension}`;
    if (owner) {
      const segments = path.split('/');
      for (let depth = nodeRoot.split('/').length + 1; depth < segments.length; depth++) {
        const parent = segments.slice(0, depth).join('/');
        if (!createdDirectories.includes(parent)) { await files.mkdir(parent); createdDirectories.push(parent); }
      }
    }
    const binary = atob(item.base64);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    await files.write(path, bytes.buffer, true);
    paths.set(item.path, path);
  }
    const imported = JSON.parse(JSON.stringify(canvas, (_key, value) => typeof value === 'string' ? paths.get(value) ?? nodeIds.get(value) ?? value : value)) as CanvasDocument;
    await files.writeJson(target, imported, true);
  } catch (error) {
    for (const path of createdDirectories.filter(path => path === prefix || path.split('/').length === nodeRoot.split('/').length + 1 && path.startsWith(nodeRoot + '/'))) {
      await files.remove(path, true).catch(cleanupError => console.warn('导入素材清理失败', cleanupError));
    }
    throw error;
  }
}
