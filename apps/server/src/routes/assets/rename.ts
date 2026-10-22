import { Router } from "express";
import { basename, dirname, resolve, relative } from "node:path";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { relocateMetadata } from '@/utils/assets/metadata';

const router = Router();

export default router.post("/", validateFields({ path: z.string().min(1).max(4096), target: z.string().min(1).max(4096) }), async (req, res) => {
  const root = await u.assets.getAssetsDirectory();
  const source = await u.workspaceFile.resolveWorkspacePath(root, req.body.path);
  const target = await u.workspaceFile.resolveWorkspacePath(root, req.body.target);
  u.workspaceFile.protectWorkspaceRoot(source.directory, source.path);
  u.workspaceFile.protectWorkspaceRoot(target.directory, target.path);
  target.path = resolve(dirname(target.path), basename(resolve(root, req.body.target)));
  const release = u.workspaceFile.lockWorkspaceFiles([source.path, target.path]);
  try { await u.workspaceFile.renameWorkspaceFile(source.path, target.path); await relocateMetadata(relative(root, source.path), relative(root, target.path)); }
  finally { release(); }
  res.json(success());
});
