import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { transferSourceSchema, transferTargetSchema } from "@/utils/production/schema";
import u from "@/utils";

export default Router().post("/", validateFields({ directory: z.string().min(1).max(4096), source: transferSourceSchema, target: transferTargetSchema }), async (req, res) => {
  const directory = await u.workspace.resolveWorkspace(req, req.body.directory);
  res.json(success(await u.production.transferResult(directory, req.body.source, req.body.target)));
});
