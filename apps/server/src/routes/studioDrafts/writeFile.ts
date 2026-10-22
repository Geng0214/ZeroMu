import { Router } from "express";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().put("/", validateFields({ ...u.studioDrafts.scopeSchema.shape, fileHash: u.studioDrafts.fileHashSchema }, "query"), async (req, res) => {
  if (!req.is("application/octet-stream") || !Buffer.isBuffer(req.body)) throw Object.assign(new Error("请发送草稿参考的原始内容"), { status: 400 });
  const scope = await u.studioDrafts.resolveScope(req, req.query as { directory: string; kind: string });
  res.set("Cache-Control", "no-store").json(success(await u.studioDrafts.writeDraftFile(scope, req.query.fileHash as string, req.body)));
});
