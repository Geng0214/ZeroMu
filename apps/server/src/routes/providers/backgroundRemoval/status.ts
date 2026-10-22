import { Router } from "express";
import { success } from "@/lib/responseFormat";
import { getBackgroundRemovalStatus } from "@/utils/media/backgroundRemoval";

export default Router().get("/", async (_req, res) => {
  res.set("Cache-Control", "no-store").json(success(await getBackgroundRemovalStatus()));
});
