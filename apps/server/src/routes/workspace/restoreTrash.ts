import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({ name: u.workspaceProjects.projectNameSchema }), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const root = u.workspaceProjects.selectedWorkspace();
  res.json(success(await u.workspaceProjects.restoreWorkspaceTrash(req.body.name as string, root), "项目已从回收目录还原"));
});
