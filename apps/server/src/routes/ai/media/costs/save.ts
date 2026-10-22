import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/lib/middleware";

export default Router().put("/", validateFields(u.mediaCosts.policySchema.shape), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const policy = u.mediaCosts.policySchema.parse(req.body);
  for (const budget of policy.budgets) budget.directory = await u.workspace.resolveWorkspace(req, budget.directory);
  res.json(success(await u.mediaCosts.saveCostPolicy(policy)));
});
