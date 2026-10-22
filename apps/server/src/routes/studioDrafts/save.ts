import { Router } from "express";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().put("/", validateFields({ ...u.studioDrafts.scopeSchema.shape,
  revision: u.studioDrafts.revisionSchema, value: u.studioDrafts.draftSchema,
}), async (req, res) => {
  const scope = await u.studioDrafts.resolveScope(req, req.body);
  res.set("Cache-Control", "no-store").json(success(await u.studioDrafts.saveDraft(scope, req.body.revision, req.body.value)));
});
