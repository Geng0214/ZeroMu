import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
export default Router().post("/", validateFields({ directory: z.string().min(1).max(4096), path: z.string().min(1).max(4096), mimeType: z.string().max(200).regex(/^(image|video)\/[a-z0-9.+-]+$/i).optional() }), async (req, res) => {
  const directory = await u.workspace.resolveWorkspace(req, req.body.directory);
  res.set("Cache-Control", "no-store").json(success(await u.workspacePreview.prepareMediaPreview(directory, req.body.path, req.body.mimeType)));
});
