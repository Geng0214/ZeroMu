import { Router } from "express";
import { success } from "@/lib/responseFormat";
import { cancelBackgroundRemovalDownload } from "@/utils/media/backgroundRemoval";
import u from "@/utils";

export default Router().post("/", (req, res) => {
  u.mcpControl.assertAppRequest(req);
  res.json(success(cancelBackgroundRemovalDownload()));
});
