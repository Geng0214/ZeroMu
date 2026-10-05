import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({
  id: u.mediaProvider.providerIdSchema,
  apiUrl: z.url({ protocol: /^https?$/ }),
  apiKey: z.string().max(400).optional(),
}), async (req, res) => {
  res.json(success(await u.mediaChannel.fetchMediaChannelModels(req.body)));
});
