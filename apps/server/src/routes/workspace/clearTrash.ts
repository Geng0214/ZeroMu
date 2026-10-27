import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

// confirm 必填：批量删除不可撤销，界面必须显式带确认位，避免误触发或别处复用同一请求。
export default Router().post("/", validateFields({ confirm: z.literal(true) }), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const root = u.workspaceProjects.selectedWorkspace();
  res.json(success(await u.workspaceProjects.clearWorkspaceTrash(root), "回收目录已清空"));
});
