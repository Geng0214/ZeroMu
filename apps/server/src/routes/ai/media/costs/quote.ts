import { Router } from "express";
import { z } from "zod";
import { imageGenerationSchema, videoGenerationSchema, audioGenerationSchema } from "@toonflow/tool-media-generation/runtime";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/lib/middleware";

export default Router().post("/", validateFields({ mediaType: z.enum(["image", "video", "audio"]), request: z.record(z.string(), z.unknown()) }), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const mediaType = req.body.mediaType as "image" | "video" | "audio";
  const input = (mediaType === "image" ? imageGenerationSchema : mediaType === "video" ? videoGenerationSchema : audioGenerationSchema).parse(req.body.request);
  const request = await u.mediaGeneration.effectiveMediaRequest(mediaType, input);
  res.json(success(u.mediaCosts.quoteMediaCost(await u.mediaCosts.readCostPolicy(), mediaType, request)));
});
