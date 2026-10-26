import { lstat, rmdir, unlink } from "@toonflow/file";
import { relative } from "node:path";
import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { metadataFile, relocateMetadata } from '@/utils/assets/metadata';

const router = Router();

export default router.delete("/", validateFields({ path: z.string().min(1).max(4096) }), async (req, res) => {
  const root = await u.assets.getAssetsDirectory();
  const { directory, path } = await u.workspaceFile.resolveWorkspacePath(root, req.body.path);
  u.workspaceFile.protectWorkspaceRoot(directory, path);
  const release = u.workspaceFile.lockWorkspaceFiles([path]);
  try {
    if ((await lstat(path)).isDirectory()) await rmdir(path);
    else await unlink(path);
    await relocateMetadata(relative(root, path), undefined, metadataFile(root));
  } finally { release(); }
  res.json(success());
});
