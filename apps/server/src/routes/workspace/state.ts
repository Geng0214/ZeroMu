import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

export default Router().get("/", async (req, res) => {
  const saved = u.conf.get("workspaceDirectory", "");
  if (saved) await u.workspace.resolveWorkspace(req, saved);
  res.set("Cache-Control", "no-store").json(success(await u.workspaceProjects.workspaceState()));
});
