import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({ directory: z.string().min(1).max(4096), path: z.string().min(1).max(4096), mimeType: z.string().max(200).regex(/^(image|video|audio)\/[a-z0-9.+-]+$/i).optional() }), async (req, res) => {
  const { directory } = await u.workspaceFile.resolveWorkspaceFile(req, req.body.directory, req.body.path);
  res.json(success({ url: `/api/workspaces/files/preview?token=${u.workspacePreview.createPreviewToken(directory, req.body.path, req.body.mimeType)}` }));
});
