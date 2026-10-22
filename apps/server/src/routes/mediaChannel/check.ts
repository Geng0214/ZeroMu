import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({
  id: u.mediaProvider.providerIdSchema,
  apiUrl: z.url({ protocol: /^https?$/ }),
  apiKey: z.string().max(400).optional(),
  protocol: z.enum(["openai", "apimart", "minimax"]).optional(),
}), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once("close", abort);
  try {
    await u.mediaChannel.fetchMediaChannelModels(req.body, controller.signal, true);
    res.json(success({ message: "模型目录接口连接成功；尚不代表生成接口、用量或费用可用" }));
  } finally { res.off("close", abort); }
});
