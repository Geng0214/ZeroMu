import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success, error } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().get("/", validateFields({ directory: z.string().min(1).max(4096), assetId: z.uuid() }, "query"), async (req, res) => {
  const directory = await u.workspace.resolveWorkspace(req, req.query.directory as string);
  const project = await u.production.readProject(directory);
  if (!project) return res.status(404).json(error("项目制作记录不存在", null, 404));
  res.set("Cache-Control", "no-store").json(success(u.production.assetImpact(project, req.query.assetId as string)));
});
