import { Router } from "express";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().get("/", validateFields(u.studioDrafts.scopeSchema.shape, "query"), async (req, res) => {
  const scope = await u.studioDrafts.resolveScope(req, req.query as { directory: string; kind: string });
  res.set("Cache-Control", "no-store").json(success(await u.studioDrafts.readDraft(scope)));
});
