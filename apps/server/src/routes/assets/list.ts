import { readdir, lstat, readFile } from "@toonflow/file";
import { join, relative, sep } from "node:path";
import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { metadataFile, readMetadata, metadataKey, type AssetMetadata } from '@/utils/assets/metadata';

type AssetEntry = { name: string; path: string; type: "file" | "directory"; children?: AssetEntry[] };

const router = Router();

async function listEntries(root: string, directory: string, metadata: Record<string, AssetMetadata>): Promise<AssetEntry[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return Promise.all(entries.filter(entry => entry.isFile() || entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }))
    .map(async entry => {
      const path = join(directory, entry.name);
      const info = await lstat(path);
      const key = relative(root, path).split(sep).join('/');
      return {
        name: entry.name,
        path: relative(root, path).split(sep).join("/"),
        type: entry.isDirectory() ? "directory" : "file",
        ...(entry.isDirectory() ? { children: await listEntries(root, path, metadata) } : { size: info.size, modifiedAt: info.mtime.toISOString(), metadata: metadata[metadataKey(key)], ...(/\.(txt|md|markdown|csv|json)$/i.test(entry.name) && info.size <= 262144 ? { content: await readFile(path, 'utf8') } : {}) }),
      };
    }));
}

export default router.get("/", async (_req, res) => {
  const directory = await u.assets.getAssetsDirectory();
  res.set("Cache-Control", "no-store").json(success({ entries: await listEntries(directory, directory, await readMetadata(metadataFile(directory))) }));
});
