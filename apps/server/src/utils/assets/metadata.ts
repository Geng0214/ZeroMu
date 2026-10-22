import { readFile, writeAtomic } from '@toonflow/file';
import { dirname, join } from 'node:path';
import conf from '@/utils/conf';

export type AssetMetadata = { title: string; description: string; category: string; tags: string[]; source: string };
const metadataPath = () => join(dirname(conf.path), 'assetMetadata.json');
export const metadataKey = (path: string) => {
  const key = path.replaceAll('\\', '/').replace(/^\.\//, '');
  return process.platform === 'win32' ? key.toLowerCase() : key;
};
export async function readMetadata(): Promise<Record<string, AssetMetadata>> {
  try { return Object.assign(Object.create(null), JSON.parse(await readFile(metadataPath(), 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Object.create(null); throw error; }
}
let pending: Promise<unknown> = Promise.resolve();
export function updateMetadata(update: (data: Record<string, AssetMetadata>) => void) {
  const operation = pending.catch(() => {}).then(async () => {
    const data = await readMetadata();
    update(data);
    await writeAtomic(metadataPath(), JSON.stringify(data));
  });
  pending = operation;
  return operation;
}
export function relocateMetadata(path: string, target?: string) {
  path = metadataKey(path);
  target = target === undefined ? undefined : metadataKey(target);
  return updateMetadata(data => {
    for (const key of Object.keys(data)) {
      if (key !== path && !key.startsWith(path + '/')) continue;
      const value = data[key]!;
      delete data[key];
      if (target !== undefined) data[target + key.slice(path.length)] = value;
    }
  });
}
