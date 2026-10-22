import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().get("/", validateFields({ directory: z.string().min(1).max(4096), mediaType: z.enum(["image", "video", "audio"]).optional(),
  offset: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().min(1).max(100).optional(),
}, "query"), async (req, res) => {
  const directory = await u.workspace.resolveWorkspace(req, req.query.directory as string);
  res.set("Cache-Control", "no-store").json(success(await u.mediaTasks.listTasks(directory, req.query.mediaType as "image" | "video" | "audio",
    Number(req.query.offset ?? 0), Number(req.query.limit ?? 100))));
});
