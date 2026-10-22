import u from "@/utils";
import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { maxSystemPromptLength } from "@/agent/runtime/prompt";
import { t } from "@/lib/i18n";
import { isDeepStrictEqual } from "node:util";

const router = Router();

function mergeChanges(base: unknown, next: unknown, current: unknown, path = "设置"): unknown {
  if (isDeepStrictEqual(base, next)) return current;
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  if ((base === undefined || object(base)) && object(next) && object(current)) {
    base ??= {};
    const result = { ...current };
    for (const key of new Set([...Object.keys(base as Record<string, unknown>), ...Object.keys(next)])) {
      const value = mergeChanges((base as Record<string, unknown>)[key], next[key], current[key], `${path}.${key}`);
      if (value === undefined) delete result[key]; else result[key] = value;
    }
    return result;
  }
  if (!isDeepStrictEqual(base, current) && !isDeepStrictEqual(next, current)) {
    throw Object.assign(new Error(`${path}已在其他窗口修改，请刷新设置后重新操作；本次修改未覆盖其他窗口。`), { status: 409 });
  }
  return next;
}

const settingsSchema = z.record(z.string(), z.json()).and(z.object({
  agentPreferences: z.object({
    textProtocol: z.enum(["provider", "openai-completions", "openai-responses"]),
    streamResponses: z.boolean(), autoGenerateMedia: z.boolean(),
  }).optional(),
  agentSystemPrompt: z.string().max(maxSystemPromptLength, { error: () => t`系统提示词不能超过 ${maxSystemPromptLength} 个字符` }).optional(),
  mediaCreationPreferences: z.object({
    imageCount: z.number().int().min(1).max(10), voice: z.string().trim().min(1).max(256),
    format: z.enum(["mp3", "wav", "flac", "aac", "opus"]), speed: z.number().min(0.25).max(4),
    streamImages: z.boolean(), returnBase64: z.boolean(), codexCli: z.boolean(),
  }).optional(),
  desktopUpdateSource: z.enum(["official", "github", "custom"]).optional(),
  desktopUpdateCustomUrl: z.string().max(2048).optional(),
  mcp: z.object({ enabled: z.boolean().optional(), token: z.string().optional(), port: z.number().int().min(1).max(65535).optional() }).optional(),
})).refine(value => value.desktopUpdateSource !== "custom" || !!value.desktopUpdateCustomUrl, {
  path: ["desktopUpdateCustomUrl"], message: "选择自定义更新源前，请先填写有效地址",
});

export default router.put("/", validateFields({ settings: settingsSchema, base: z.record(z.string(), z.json()) }), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const previous = u.conf.get("settings", {});
  const merged = mergeChanges(req.body.base, req.body.settings, u.publicSettings(previous)) as Record<string, unknown>;
  settingsSchema.parse(merged);
  const settings = u.restoreSettingsCredentials(merged, previous, req.body.base);
  // 旧版 HTTP 更新源保持不可用，但不阻止用户保存语言、主题等无关设置。
  const sourceChanged = settings.desktopUpdateSource !== previous.desktopUpdateSource || settings.desktopUpdateCustomUrl !== previous.desktopUpdateCustomUrl;
  if (sourceChanged && settings.desktopUpdateCustomUrl && !u.desktop.isValidUpdateUrl(settings.desktopUpdateCustomUrl)) {
    throw Object.assign(new Error("更新源须为不含账号、查询参数或锚点的 HTTPS 地址；仅本机测试允许 HTTP"), { status: 400 });
  }
  u.removeLegacySettings(settings);
  u.conf.set("settings", settings);
  if (!isDeepStrictEqual(previous.mcp, settings.mcp)) await u.mcpRuntime.reloadMcpRuntime();
  res.set("Cache-Control", "no-store");
  res.json(success(u.publicSettings(), "设置已保存"));
});
