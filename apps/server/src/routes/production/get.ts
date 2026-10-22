import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().get("/", validateFields({ directory: z.string().min(1).max(4096) }, "query"), async (req, res) => {
  const directory = await u.workspace.resolveWorkspace(req, req.query.directory as string);
  const project = await u.production.readProject(directory);
  res.set("Cache-Control", "no-store").json(success({ project, recoverableVersions: await u.production.recoverableVersions(directory, project) }));
});
