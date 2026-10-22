import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({ directory: z.string().min(1).max(4096), batchId: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), action: z.enum(["run", "pause"]) }), async (req, res) => {
  const directory = await u.workspace.resolveWorkspace(req, req.body.directory);
  res.set("Cache-Control", "no-store").json(success(await u.production.controlBatch(directory, req.body.batchId, req.body.fingerprint, req.body.action)));
});
