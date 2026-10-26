import { lstat } from "@toonflow/file";
import { basename, relative } from "node:path";
import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { metadataFile, metadataKey, updateMetadata } from "@/utils/assets/metadata";

const router = Router();

export default router.post("/", validateFields({
  paths: z.array(z.string().min(1).max(4096)).min(1).max(500),
  category: z.string().max(100).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).min(1).max(30).optional(),
  tagMode: z.enum(["add", "remove"]).optional(),
}), async (req, res) => {
  const { paths, category, tags, tagMode = "add" } = req.body as { paths: string[]; category?: string; tags?: string[]; tagMode?: "add" | "remove" };
  if (category === undefined && tags === undefined) throw Object.assign(new Error("请选择要更新的分类或标签"), { status: 400 });
  const root = await u.assets.getAssetsDirectory();
  const resolved = await Promise.all(paths.map(path => u.workspaceFile.resolveWorkspacePath(root, path)));
  const targets = [...new Map(resolved.map(item => [metadataKey(relative(root, item.path)), item.path])).entries()];
  const release = u.workspaceFile.lockWorkspaceFiles(targets.map(([, path]) => path));
  try {
    await Promise.all(targets.map(async ([, path]) => {
      if (!(await lstat(path)).isFile()) throw Object.assign(new Error("请选择素材文件"), { status: 400 });
    }));
    const normalizedTags = tags?.map(tag => tag.trim());
    await updateMetadata(data => {
      const updates = targets.map(([key, path]) => {
        const current = data[key] ?? { title: basename(path), description: "", category: relative(root, path).replaceAll("\\", "/").split("/").slice(0, -1).join("/"), tags: [], source: "" };
        const nextTags = normalizedTags === undefined ? current.tags : tagMode === "remove"
          ? current.tags.filter(tag => !normalizedTags.includes(tag))
          : [...new Set([...current.tags, ...normalizedTags])];
        if (nextTags.length > 30) throw Object.assign(new Error(`“${current.title}”的标签将超过 30 个，请减少标签后重试`), { status: 400 });
        return { key, metadata: { ...current, ...(category === undefined ? {} : { category: category.trim() }), tags: nextTags } };
      });
      for (const { key, metadata } of updates) data[key] = metadata;
    }, metadataFile(root));
  } finally { release(); }
  res.json(success({ count: targets.length }));
});
