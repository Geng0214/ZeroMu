import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { relativePathSchema } from "@/utils/production/schema";

export default Router().get("/", validateFields({ directory: z.string().min(1).max(4096), canvasId: relativePathSchema, nodeId: z.string().min(1).max(256) }, "query"), async (req, res) => {
  const directory = await u.workspace.resolveWorkspace(req, req.query.directory as string);
  res.set("Cache-Control", "no-store").json(success(await u.production.directorContext(directory, req.query.canvasId as string, req.query.nodeId as string)));
});
