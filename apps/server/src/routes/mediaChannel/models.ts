import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({
  id: u.mediaProvider.providerIdSchema,
  apiUrl: z.url({ protocol: /^https?$/ }),
  apiKey: z.string().max(400).optional(),
  protocol: z.enum(["openai", "apimart", "minimax"]).optional(),
}), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once("close", abort);
  try { res.json(success(await u.mediaChannel.fetchMediaChannelModels(req.body, controller.signal))); }
  finally { res.off("close", abort); }
});
