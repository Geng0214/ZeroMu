import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({ directory: z.string().min(1).max(4096), sequenceId: z.uuid(), expectedRevision: z.number().int().nonnegative(), exportId: z.uuid() }), async (req, res) => {
  const directory = await u.workspace.resolveWorkspace(req, req.body.directory);
  res.json(success(await u.production.startExport(directory, req.body.sequenceId, req.body.expectedRevision, req.body.exportId)));
});
