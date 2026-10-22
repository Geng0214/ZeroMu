import { channelUrl } from "./channelUrl";
import { t } from "@/lib/i18n";
import { z } from "zod";
import { classifyChannelModel, getAgnesModelCapabilities, isSiliconFlow } from "@toonflow/providers/channelModels";
import { mediaCapabilityFields } from "@toonflow/providers/mediaCapabilities";
import conf, { publicSettings, restoreSettingsCredentials } from "@/utils/conf";
import { assertApiUrl } from "@/utils/conf/credentialSettings";
import { mediaProviders } from "@toonflow/providers";
import { getMediaProvider, getMediaProviderApiKey, providerIdSchema, writeMediaProviderSource } from "@/utils/media/provider";
import { mediaCapabilitySchema } from "@/utils/media/capabilities";
import { mkdir, readFile, withFileAccess, writeAtomic } from "@toonflow/file";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { currentProviderRevision } from "@/utils/media/generation";
import { providerGenerationChecks } from "@/utils/media/tasks";

/** 生成的供应商文件靠此前缀识别，避免渠道面板覆盖手写适配器。 */
const channelMarker = "ToonflowMediaChannel";
const channelVersion = "2";

const modelItemSchema = z.object({
  ...mediaCapabilitySchema.shape,
  id: z.string().trim().min(1).max(200),
  label: z.string().max(200).optional(),
  type: z.enum(["image", "video", "audio", "text"]).optional(),
}).catchall(z.json());

export const mediaChannelSchema = z.object({
  id: providerIdSchema,
  label: z.string().min(1).max(60).refine(value => !!value.trim()),
  kind: z.enum(["image", "video", "audio"]).optional(),
  protocol: z.enum(["openai", "apimart", "minimax"]).default("openai"),
  apiUrl: z.url({ protocol: /^https?$/ }).refine(value => {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash;
  }, "API 地址不能包含凭据、片段或查询参数"),
  models: z.array(modelItemSchema).max(2000).refine(items => new Set(items.map(item => item.id)).size === items.length, "模型 ID 不能重复"),
  apiKey: z.string().max(400).optional(),
  apiKeyRevision: z.string().max(64).optional(),
  maxConcurrentTasks: z.number().int().min(1).max(8).optional(),
  revision: z.string().regex(/^(?:[a-f0-9]{64})?$/).optional(),
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
    { field: "protocol", value: channel.protocol },
  ];
  if (channel.protocol === "openai" && channel.returnBase64 === true) rules.push({ field: "returnBase64", value: true });
  // ACT: 视频任务地址沿用 OpenAI 约定，只在渠道声明不同时写入覆盖项。
  if (channel.protocol === "openai") {
    for (const field of ["submitPath", "pollPath", "contentPath"] as const) {
      if (channel[field]) rules.push({ field, value: channel[field] });
    }
  }
  const models = channel.models.map(model => {
    const { type, unavailableReason } = classifyChannelModel({ ...model, type: model.type ?? channel.kind }, channel.protocol);
    if (!type) invalid(`${model.id}：${unavailableReason}`);
    if (channel.protocol === "openai" && type === "audio" && model.mode?.some(mode => Array.isArray(mode))) invalid(`${model.id}：当前语音适配器只支持文本配音，不能声明参考音频克隆能力`);
    const adapterId = channel.protocol === "apimart" ? "apiMart" : channel.protocol === "minimax" ? "meta" : undefined;
    const known = adapterId ? mediaProviders.find(provider => provider.id === adapterId)?.models.find(item => item.id === model.id && item.type === type) : undefined;
    const declared = { ...(channel.protocol === "openai" ? getAgnesModelCapabilities(channel.apiUrl, model.id) : undefined), ...model };
    const capabilities = Object.fromEntries(mediaCapabilityFields.filter(field => declared[field] !== undefined).map(field => [field, declared[field]]));
    return { ...known, ...capabilities, id: model.id, label: (model.label ?? model.id).trim() || model.id, type };
  });
  const methods = [...new Set(models.map(model => model.type))].filter(kind => kind !== "text").map(kind => `${generateNames[kind]}: async function (request) { return this.tool.mediaChannel("${kind}", this, request); },`).join("\n  ");
  return `export default {
  id: ${JSON.stringify(channel.id)},
  label: ${JSON.stringify(channel.label)},
  version: ${JSON.stringify(channelVersion)},
  readme: ${JSON.stringify(`${channelMarker}|由「设置 → 模型渠道」生成，修改渠道会自动覆盖此文件，请勿手动编辑。`)},
  rules: ${json(rules)},
  models: ${json(models)},
  ${methods}
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
  const source = channelProviderSource(channel);
  const models = channel.models.map(model => ({ id: model.id, label: model.label?.trim() || model.id, type: classifyChannelModel({ ...model, type: model.type ?? channel.kind }, channel.protocol).type! }));
  const provider = await writeMediaProviderSource(source, channel.revision ?? existing?.revision ?? "", () => {
    const settings = conf.get("settings", {});
    const configs = { ...(settings.mediaProviderConfigs as Record<string, Record<string, unknown>> ?? {}) };
    const previous = configs[channel.id] ?? {};
    const visible = publicSettings({ channel: previous }).channel as Record<string, unknown>;
    const next = { ...visible, apiUrl: channel.apiUrl, protocol: channel.protocol, ...(channel.maxConcurrentTasks !== undefined ? { maxConcurrentTasks: channel.maxConcurrentTasks } : {}), ...(channel.apiKey !== undefined ? { apiKey: channel.apiKey } : {}) };
    const config = restoreSettingsCredentials({ channel: next }, { channel: previous }, { channel: { ...visible, apiKeyRevision: channel.apiKeyRevision ?? "" } }).channel as Record<string, unknown>;
    for (const key of ["kind", "returnBase64", "submitPath", "pollPath", "contentPath"]) delete config[key];
    if (channel.protocol === "openai") {
      if (channel.returnBase64) config.returnBase64 = true;
      for (const key of ["submitPath", "pollPath", "contentPath"] as const) if (channel[key]) config[key] = channel[key];
    }
    configs[channel.id] = config;
    const defaults = { ...(settings.mediaChannelDefaults as Record<string, { providerId?: string; modelId?: string }> ?? {}) };
    for (const kind of Object.keys(defaults)) if (defaults[kind]?.providerId === channel.id && !models.some(model => model.id === defaults[kind]?.modelId && model.type === kind)) delete defaults[kind];
    const customProviders = Array.isArray(settings.customProviders) ? settings.customProviders.filter(provider => provider?.id !== channel.id) : [];
    const textModels = models.filter(model => model.type === "text");
    if (textModels.length) customProviders.push({ id: channel.id, label: channel.label, apiUrl: channel.apiUrl, apiKey: config.apiKey ?? "", protocol: "openai-completions", models: textModels });
    conf.set("settings", { ...settings, mediaProviderConfigs: configs, mediaChannelDefaults: defaults, customProviders });
  });
  return { provider, settings: publicSettings() };
}

type ChannelCheck = { status: "passed" | "failed"; checkedAt: number; message: string };
type ChannelChecks = { fingerprint: string; connection?: ChannelCheck; models?: ChannelCheck };
function checkPath(id: string) { return join(dirname(conf.path), "mediaChannelChecks", `${id}.json`); }
function connectionFingerprint(apiUrl: string, protocol: string | undefined, apiKey: string) { return createHash("sha256").update(JSON.stringify([apiUrl.trim().replace(/\/+$/, ""), protocol ?? "openai", apiKey.replace(/^Bearer\s+/i, "").trim()])).digest("hex"); }
async function readChecks(id: string): Promise<ChannelChecks | undefined> {
  try { return JSON.parse(await readFile(checkPath(id), "utf8")); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw cause; }
}
async function saveChecks(id: string, next: ChannelChecks) {
  const path = checkPath(id);
  await withFileAccess([`${path}.admission`], "write", async () => {
    const previous = await readChecks(id);
    await mkdir(dirname(path), { recursive: true });
    await writeAtomic(path, JSON.stringify({ ...(previous?.fingerprint === next.fingerprint ? previous : {}), ...next }), { mode: 0o600 });
  });
}
export async function mediaChannelChecks(id: string) {
  const provider = await getMediaProvider(id);
  const config = (conf.get("settings", {}).mediaProviderConfigs as Record<string, Record<string, unknown>> | undefined)?.[id] ?? {};
  const receipt = await readChecks(id);
  const current = receipt?.fingerprint === connectionFingerprint(String(config.apiUrl ?? ""), String(config.protocol ?? "openai"), getMediaProviderApiKey(id));
  return { id, revision: provider.revision, connection: current ? receipt?.connection : undefined, models: current ? receipt?.models : undefined,
    generation: await providerGenerationChecks(id, await currentProviderRevision(id)) };
}

export async function fetchMediaChannelModels(input: { id: string; apiUrl: string; apiKey?: string; protocol?: "openai" | "apimart" | "minimax" }, signal?: AbortSignal, checkOnly = false) {
  if (input.protocol === "minimax") invalid("此 API 格式不提供统一模型列表，请手动添加模型 ID");
  if (!providerIdSchema.safeParse(input.id).success) invalid("渠道 ID 无效");
  const checked = mediaChannelSchema.pick({ apiUrl: true }).safeParse(input);
  if (!checked.success) invalid(checked.error.issues[0]?.message ?? "API 地址无效");
  assertApiUrl(checked.data.apiUrl);
  if (input.apiKey === undefined) {
    const savedUrl = conf.get(`settings.mediaProviderConfigs.${input.id}.apiUrl`);
    if (typeof savedUrl !== "string" || channelUrl(savedUrl, "/v1/models") !== channelUrl(checked.data.apiUrl, "/v1/models")) invalid("地址已改变，请重新提供 API 密钥");
  }
  // ACT: 未保存的密钥也用于本次列表请求，保证面板里改完 Key 能立刻拉取模型。
  const apiKey = (input.apiKey === undefined ? getMediaProviderApiKey(input.id) : input.apiKey.trim()).replace(/^Bearer\s+/i, "");
  const url = channelUrl(checked.data.apiUrl, "/v1/models");
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
  const receipt: ChannelChecks = { fingerprint: connectionFingerprint(checked.data.apiUrl, input.protocol, apiKey) };
  let modelCount = 0;
  let failure: unknown;
  async function readModels(address: string) {
    let response: Response;
    try { response = await fetch(address, {
      headers: { Accept: "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      signal: requestSignal, redirect: "error",
    }); } catch {
      requestSignal.throwIfAborted();
      throw new Error(`无法连接渠道 ${new URL(url).host}，请检查地址和网络`);
    }
    receipt.connection = { status: response.ok ? "passed" : "failed", checkedAt: Date.now(), message: response.ok ? `模型目录接口响应 HTTP ${response.status}；尚不代表生成可用` : `模型目录接口响应 HTTP ${response.status}，请检查地址、凭据和权限` };
    if (!response.ok) { await response.body?.cancel(); throw new Error(t`获取模型列表失败（HTTP ${response.status}）`); }
    if (checkOnly) { await response.body?.cancel(); return []; }
    const payload = await response.json().catch(() => null);
    const envelope = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    if (envelope.has_more === true || envelope.next_page) invalid("渠道返回了分页模型列表，当前接口未返回完整目录");
    const list = Array.isArray(payload) ? payload : Array.isArray(envelope.data) ? envelope.data : null;
    const models = z.array(modelItemSchema.omit({ type: true })).max(2000).safeParse(list);
    if (!models.success) invalid("模型列表格式不受支持，请检查 API 地址");
    return models.data;
  }
  try {
    const models = await readModels(url);
    // 硅基流动总目录不返回类型，通过官方分类接口补全；只标记总目录中的 ID。
    if (isSiliconFlow(input.apiUrl)) {
      for (const field of ["type", "sub_type"] as const) {
        const values = field === "type" ? ["text", "image", "video", "audio"] : ["embedding", "reranker", "speech-to-text"];
        for (let start = 0; start < values.length; start += 3) {
          await Promise.all(values.slice(start, start + 3).map(async value => {
            const list = await readModels(`${url}?${field}=${value}`);
            const ids = new Set(list.map(model => model.id));
            for (const model of models) if (ids.has(model.id)) model[field] = value;
          }));
        }
      }
    }
    const seen = new Set<string>();
    const result = models.flatMap(model => {
      const id = model.id.trim();
      if (!id || seen.has(id)) return [];
      seen.add(id);
      const name = (model as Record<string, unknown>).name;
      return [{ ...(input.protocol === undefined || input.protocol === "openai" ? getAgnesModelCapabilities(input.apiUrl, id) : undefined), ...model, id, label: model.label?.trim() || (typeof name === "string" && name.trim() ? name.trim() : id), ...classifyChannelModel(model, input.protocol) }];
    });
    modelCount = result.length;
    return result;
  } catch (cause) { failure = cause; throw cause; }
  finally {
    const message = failure instanceof Error ? failure.message : failure ? "渠道检查失败" : "";
    receipt.connection ??= { status: "failed", checkedAt: Date.now(), message: message || "连接未完成" };
    if (!checkOnly) receipt.models = { status: failure ? "failed" : "passed", checkedAt: Date.now(), message: message || `已获取 ${modelCount} 个模型；尚不代表生成可用` };
    await saveChecks(input.id, receipt);
  }
}
