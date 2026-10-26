import { Router } from "express";
import { validateFields } from "@/lib/middleware";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({ name: u.workspaceProjects.projectNameSchema }), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const root = u.workspaceProjects.selectedWorkspace();
  res.json(success(await u.workspaceProjects.removeWorkspaceTrash(req.body.name as string, root), "回收条目已彻底删除"));
});
