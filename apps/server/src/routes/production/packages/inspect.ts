import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { relativePathSchema } from "@/utils/production/schema";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
export default Router().post("/", validateFields({ directory: z.string().min(1).max(4096), path: relativePathSchema }), async (req, res) => {
  const directory = await u.workspace.resolveWorkspace(req, req.body.directory);
  res.json(success(await u.production.inspectPackage(directory, req.body.path)));
});
