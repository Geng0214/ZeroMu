import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({ expectedRevision: z.number().int().nonnegative().safe(), operation: u.productionTemplates.productionTemplateMutationSchema }), async (req, res) => {
  res.set("Cache-Control", "no-store").json(success(await u.productionTemplates.updateProductionTemplateLibrary(req.body.expectedRevision, req.body.operation)));
});
