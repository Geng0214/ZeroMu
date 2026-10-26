import { lstat, writeAtomic } from '@toonflow/file';
import { relative } from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import u from '@/utils';
import { validateFields } from '@/lib/middleware';
import { success } from '@/lib/responseFormat';
import { metadataFile, metadataKey, updateMetadata } from '@/utils/assets/metadata';

const router = Router();
export default router.post('/', validateFields({
  path: z.string().min(1).max(4096), title: z.string().trim().min(1).max(200), description: z.string().max(4000),
  category: z.string().max(100), tags: z.array(z.string().min(1).max(50)).max(30), source: z.string().max(1000), content: z.string().max(262144).optional(),
}), async (req, res) => {
  const root = await u.assets.getAssetsDirectory();
  const { path } = await u.workspaceFile.resolveWorkspacePath(root, req.body.path);
  const release = u.workspaceFile.lockWorkspaceFiles([path]);
  try {
  if (!(await lstat(path)).isFile()) throw Object.assign(new Error('请选择素材文件'), { status: 400 });
  const { title, description, category, tags, source, content } = req.body;
  if (content !== undefined) {
    if (!/\.(txt|md|markdown|csv|json)$/i.test(path)) throw Object.assign(new Error('此素材不支持文本编辑'), { status: 400 });
    await writeAtomic(path, content);
  }
  await updateMetadata(data => { data[metadataKey(relative(root, path))] = { title: title.trim(), description, category: category.trim(), tags: [...new Set<string>(tags.map((tag: string) => tag.trim()).filter(Boolean))], source: source.trim() }; }, metadataFile(root));
  } finally { release(); }
  res.json(success());
});
