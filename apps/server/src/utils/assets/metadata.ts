import { readFile, writeAtomic } from '@toonflow/file';
import { dirname, join } from 'node:path';
import { selectedWorkspace } from '@/utils/workspace/projects';

export type AssetMetadata = { title: string; description: string; category: string; tags: string[]; source: string };
const metadataPath = () => join(selectedWorkspace(), 'library', 'metadata.json');
export const metadataFile = (directory: string) => join(dirname(directory), 'metadata.json');
export const metadataKey = (path: string) => {
  const key = path.replaceAll('\\', '/').replace(/^\.\//, '');
  return process.platform === 'win32' ? key.toLowerCase() : key;
};
export async function readMetadata(path = metadataPath()): Promise<Record<string, AssetMetadata>> {
  try { return Object.assign(Object.create(null), JSON.parse(await readFile(path, 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Object.create(null); throw error; }
}
let pending: Promise<unknown> = Promise.resolve();
export function updateMetadata(update: (data: Record<string, AssetMetadata>) => void, path = metadataPath()) {
  const operation = pending.catch(() => {}).then(async () => {
    const data = await readMetadata(path);
    update(data);
    await writeAtomic(path, JSON.stringify(data));
  });
  pending = operation;
  return operation;
}
export function relocateMetadata(path: string, target?: string, file = metadataPath()) {
  path = metadataKey(path);
  target = target === undefined ? undefined : metadataKey(target);
  return updateMetadata(data => {
    for (const key of Object.keys(data)) {
      if (key !== path && !key.startsWith(path + '/')) continue;
      const value = data[key]!;
      delete data[key];
      if (target !== undefined) data[target + key.slice(path.length)] = value;
    }
  }, file);
}
