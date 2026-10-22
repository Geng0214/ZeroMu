import { Router } from "express";
import { z } from "zod";
import { imageGenerationSchema, videoGenerationSchema, audioGenerationSchema } from "@toonflow/tool-media-generation/runtime";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({ id: z.uuid(), directory: z.string().min(1).max(4096), mediaType: z.enum(["image", "video", "audio"]), request: z.record(z.string(), z.unknown()), source: u.mediaTasks.sourceSchema.optional() }), async (req, res) => {
  const { id, directory, mediaType, request, source } = req.body;
  const parsed = (mediaType === "image" ? imageGenerationSchema : mediaType === "video" ? videoGenerationSchema : audioGenerationSchema).safeParse(request);
  if (!parsed.success) throw Object.assign(new Error(parsed.error.issues.map(issue => issue.message).join("；")), { status: 400 });
  const cwd = await u.workspace.resolveWorkspace(req, directory);
  res.json(success(await u.mediaTasks.startTask(id, cwd, mediaType, parsed.data, source)));
});
