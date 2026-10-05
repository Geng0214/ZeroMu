import { channelUrl } from "./channelUrl";
import { t } from "@/lib/i18n";
import { z } from "zod";
import { getMediaProvider, getMediaProviderApiKey, providerIdSchema, writeMediaProviderSource } from "@/utils/media/provider";

/** 生成的供应商文件靠此前缀识别，避免渠道面板覆盖手写适配器。 */
const channelMarker = "ToonflowMediaChannel";
const channelVersion = "1";

const modelItemSchema = z.object({
  id: z.string().min(1).max(200).refine(value => !!value.trim()),
  label: z.string().max(200).optional(),
}).catchall(z.json());

export const mediaChannelSchema = z.object({
  id: providerIdSchema,
  label: z.string().min(1).max(60).refine(value => !!value.trim()),
  kind: z.enum(["image", "video", "audio"]),
  apiUrl: z.url({ protocol: /^https?$/ }).refine(value => {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash && !url.search;
  }, "API 地址不能包含凭据、片段或查询参数"),
  models: z.array(modelItemSchema).max(500).refine(items => new Set(items.map(item => item.id)).size === items.length, "模型 ID 不能重复"),
  returnBase64: z.boolean().optional(),
  submitPath: z.string().max(300).regex(/^\//, "路径需以 / 开头").optional(),
  pollPath: z.string().max(300).regex(/^\//, "路径需以 / 开头").optional(),
  contentPath: z.string().max(300).regex(/^\//, "路径需以 / 开头").optional(),
});

export type MediaChannel = z.infer<typeof mediaChannelSchema>;

function invalid(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

function json(value: unknown) {
  return JSON.stringify(value, null, 2).replace(/\n/g, "\n  ");
}

const generateNames = { image: "generateImage", video: "generateVideo", audio: "generateAudio" } as const;

export function channelProviderSource(channel: MediaChannel) {
  const rules: { field: string; value: unknown }[] = [
    { field: "apiKey", value: "" },
    { field: "apiUrl", value: channel.apiUrl },
  ];
  if (channel.kind === "image" && channel.returnBase64 === true) rules.push({ field: "returnBase64", value: true });
  // ACT: 视频任务地址沿用 OpenAI 约定，只在渠道声明不同时写入覆盖项。
  if (channel.kind === "video") {
    for (const field of ["submitPath", "pollPath", "contentPath"] as const) {
      if (channel[field]) rules.push({ field, value: channel[field] });
    }
  }
  const models = channel.models.map(model => ({ id: model.id, label: (model.label ?? model.id).trim() || model.id, type: channel.kind }));
  return `export default {
  id: ${JSON.stringify(channel.id)},
  label: ${JSON.stringify(channel.label)},
  version: ${JSON.stringify(channelVersion)},
  readme: ${JSON.stringify(`${channelMarker}|由「设置 → 模型渠道」生成，修改渠道会自动覆盖此文件，请勿手动编辑。`)},
  rules: ${json(rules)},
  models: ${json(models)},
  ${generateNames[channel.kind]}: async function (request) { return this.tool.mediaChannel("${channel.kind}", this, request); },
};
`;
}

export async function saveMediaChannel(input: unknown) {
  const checked = mediaChannelSchema.safeParse(input);
  if (!checked.success) invalid(checked.error.issues.map(issue => issue.message).join("; "));
  const channel = checked.data;
  const existing = await getMediaProvider(channel.id).catch((error: unknown) => {
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  });
  if (existing && !existing.readme?.startsWith(`${channelMarker}|`)) invalid(t`“${channel.label}”的渠道 ID 已被手写供应商文件占用，请更换名称后重试`);
  return await writeMediaProviderSource(channelProviderSource(channel));
}

export async function fetchMediaChannelModels(input: { id: string; apiUrl: string; apiKey?: string }) {
  if (!providerIdSchema.safeParse(input.id).success) invalid("渠道 ID 无效");
  const checked = mediaChannelSchema.pick({ apiUrl: true }).safeParse(input);
  if (!checked.success) invalid(checked.error.issues[0]?.message ?? "API 地址无效");
  // ACT: 未保存的密钥也用于本次列表请求，保证面板里改完 Key 能立刻拉取模型。
  const apiKey = (input.apiKey === undefined ? getMediaProviderApiKey(input.id) : input.apiKey.trim()).replace(/^Bearer\s+/i, "");
  const url = channelUrl(checked.data.apiUrl, "/v1/models");
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      signal: AbortSignal.timeout(30000), redirect: "error",
    });
  } catch (error) {
    const host = url.slice(url.indexOf("//") + 2).split("/")[0];
    throw new Error(t`无法连接渠道 ${host}：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(t`获取模型列表失败（HTTP ${response.status}）`);
  const payload = await response.json().catch(() => null);
  const list = Array.isArray(payload) ? payload : Array.isArray((payload as { data?: unknown } | null)?.data) ? (payload as { data: unknown[] }).data : [];
  const models = z.array(modelItemSchema).max(2000).safeParse(list);
  if (!models.success) invalid("模型列表格式不受支持，请手动填写模型 ID");
  const seen = new Set<string>();
  return models.data.flatMap(model => {
    const id = model.id.trim();
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const name = (model as Record<string, unknown>).name;
    return [{ id, label: typeof name === "string" && name.trim() ? name.trim() : id }];
  });
}
