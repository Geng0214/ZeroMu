import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
export default Router().post("/", validateFields({ directory: z.string().min(1).max(4096), jobId: z.uuid() }), async (req, res) => {
  const directory = await u.workspace.resolveWorkspace(req, req.body.directory);
  res.json(success(u.production.cancelPackage(directory, req.body.jobId)));
});
