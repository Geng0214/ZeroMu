import { Router } from "express";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields(u.mediaChannel.mediaChannelSchema.shape), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  res.set("Cache-Control", "no-store");
  const result = await u.mediaChannel.saveMediaChannel(req.body);
  u.mediaTasks.scheduleQueuedTasks();
  res.json(success(result));
});
