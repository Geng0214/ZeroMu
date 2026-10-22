import { lstat } from "@toonflow/file";
import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { sendFile } from "@/utils/fileHttp";
import { validateFields } from "@/lib/middleware";

export default Router().get("/", validateFields({ token: z.string().min(1).max(24000) }, "query"), async (req, res, next) => {
  const { path, mimeType } = await u.workspacePreview.resolvePreviewToken(req.query.token as string);
  if (!(await lstat(path)).isFile()) throw Object.assign(new Error("只能预览文件"), { status: 400 });
  if (mimeType) res.type(mimeType);
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "sandbox", "X-Content-Type-Options": "nosniff" });
  await sendFile(res, path, { dotfiles: "allow" }, err => { if (err) next(err); });
});
