import { Router } from "express";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields(u.mediaChannel.mediaChannelSchema.shape), async (req, res) => {
  res.json(success(await u.mediaChannel.saveMediaChannel(req.body)));
});
