import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
export default Router().put("/", validateFields({ directory: z.string().min(1).max(4096), uploadId: z.uuid() }, "query"), async (req, res) => {
  const directory = await u.workspace.resolveWorkspace(req, req.query.directory as string);
  res.json(success(await u.production.uploadPackage(directory, req.query.uploadId as string, req)));
});
