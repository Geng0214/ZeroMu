import { Router } from "express";
import { z } from "zod";
import { importLibraryAssetSchema, relativePathSchema } from "@/utils/production/schema";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
export default Router().post("/", validateFields({ directory: z.string().min(1).max(4096), expectedRevision: z.number().int().nonnegative(), input: importLibraryAssetSchema.omit({ type: true, source: true }).extend({ path: relativePathSchema }) }), async (req, res) => {
  const directory = await u.workspace.resolveWorkspace(req, req.body.directory);
  res.set("Cache-Control", "no-store").json(success(await u.production.prepareLibraryImport(directory, req.body.expectedRevision, req.body.input)));
});
