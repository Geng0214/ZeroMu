import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/lib/middleware";

export default Router().post("/", validateFields({ id: z.uuid(), directory: z.string().min(1).max(4096), expectedRevision: z.number().int().nonnegative(), money: u.mediaCosts.moneySchema, note: z.string().trim().min(1).max(1000) }), async (req, res) => {
  const directory = await u.workspace.resolveWorkspace(req, req.body.directory);
  const input = req.body;
  res.json(success(await u.mediaTasks.recordTaskStatement(input.id, directory, input.expectedRevision, u.mediaCosts.moneySchema.parse(input.money), input.note.trim())));
});
