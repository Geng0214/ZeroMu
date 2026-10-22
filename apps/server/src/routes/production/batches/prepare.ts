import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { batchInputSchema } from "@/utils/production/batchSchema";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({ directory: z.string().min(1).max(4096), ...batchInputSchema.shape }), async (req, res) => {
  const { directory: requested, ...input } = req.body;
  const directory = await u.workspace.resolveWorkspace(req, requested);
  res.set("Cache-Control", "no-store").json(success(await u.production.prepareBatch(directory, input)));
});
