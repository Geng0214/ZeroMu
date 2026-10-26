import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({ directory: z.string().min(1).max(4096), projectId: z.uuid(), name: u.workspaceProjects.projectNameSchema }), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const root = await u.workspace.resolveWorkspace(req, u.workspaceProjects.selectedWorkspace());
  const directory = await u.workspace.resolveWorkspace(req, req.body.directory);
  res.json(success(await u.workspaceProjects.renameWorkspaceProject(directory, req.body.projectId, req.body.name, root)));
});
