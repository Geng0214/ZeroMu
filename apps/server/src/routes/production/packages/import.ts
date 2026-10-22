import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { relativePathSchema } from "@/utils/production/schema";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
export default Router().post("/", validateFields({ directory: z.string().min(1).max(4096), path: relativePathSchema, targetParent: z.string().min(1).max(4096), folderName: z.string().min(1).max(200), jobId: z.uuid() }), async (req, res) => {
  const directory = await u.workspace.resolveWorkspace(req, req.body.directory);
  const targetParent = await u.workspace.resolveWorkspace(req, req.body.targetParent);
  res.json(success(await u.production.importPackage(directory, req.body.path, targetParent, req.body.folderName, req.body.jobId)));
});
