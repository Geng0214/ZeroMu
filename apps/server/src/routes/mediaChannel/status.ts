import { Router } from "express";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().get("/", validateFields({ id: u.mediaProvider.providerIdSchema }, "query"), async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(success(await u.mediaChannel.mediaChannelChecks(String(req.query.id))));
});
