import { Router } from "express";
import { validateFields } from "@/lib/middleware";
import { sendFile } from "@/utils/fileHttp";
import u from "@/utils";

export default Router().get("/", validateFields({ ...u.studioDrafts.scopeSchema.shape, fileHash: u.studioDrafts.fileHashSchema }, "query"), async (req, res) => {
  const scope = await u.studioDrafts.resolveScope(req, req.query as { directory: string; kind: string });
  const path = await u.studioDrafts.readDraftFile(scope, req.query.fileHash as string);
  res.set({ "Cache-Control": "no-store", "Content-Type": "application/octet-stream", "Content-Security-Policy": "sandbox", "X-Content-Type-Options": "nosniff" });
  await sendFile(res, path);
});
