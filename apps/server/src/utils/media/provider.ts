import { t, translateMessage, validationOptions } from "@/lib/i18n";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, unlink } from "@toonflow/file";
import { dirname, join } from "node:path";
import type { AudioConvertOptions, Provider, ProviderTools } from "@toonflow/providers";
import { parse, parseExpression } from "@babel/parser";
import { z } from "zod";
import conf from "@/utils/conf";
import { credentialFetch } from "@/utils/conf/credentialFetch";
import { isProtectedCredential } from "@/utils/conf/credentialStorage";
import { convertAudio } from "@/utils/media/audioProcessor";
import { getSystemSpeechVoices, synthesizeSystemSpeech } from "@/utils/media/systemSpeech";
import { getBackgroundRemovalStatus, removeBackground } from "@/utils/media/backgroundRemoval";
import { runMediaChannel } from "@/utils/media/channelRuntime";
import { createWorkspaceFfmpeg } from "@/utils/ffmpeg";
import { mediaCapabilitySchema } from "@/utils/media/capabilities";
import { getMediaCapabilityDeclarationError } from "@toonflow/providers/mediaCapabilities";
import { lockWorkspaceFiles, writeWorkspaceFile } from "@/utils/workspace/files";
import type { MediaGenerationRequest } from "@toonflow/tools-scaffold/runtime";
import { createIsolatedProvider } from "./isolatedProvider";
import { createProviderRuntime, mediaErrorMessage } from "./providerRuntime";
import { describeFfmpeg } from "@toonflow/ffmpeg/runtime";

type Expression = Extract<ReturnType<typeof parseExpression>, { type: "ParenthesizedExpression" }>["expression"];
type ObjectExpression = Extract<Expression, { type: "ObjectExpression" }>;

const providerTranspiler = new Bun.Transpiler({ loader: "ts", target: "bun", define: { require: "undefined" } });

export const providerIdSchema = z.string().max(96).regex(/^[a-z][a-zA-Z0-9]*$/)
  .refine(value => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value), "供应商 ID 不能是系统保留文件名");
export const mediaProviderFileSchema = z.string().refine(value => value.endsWith(".ts") && providerIdSchema.safeParse(value.slice(0, -3)).success, "供应商文件名无效");
export const mediaModelsSchema = z.array(z.object({
  ...mediaCapabilitySchema.shape,
  id: z.string().min(1).max(200).refine(value => !!value.trim()),
  label: z.string().min(1).max(200).refine(value => !!value.trim()),
  type: z.enum(["text", "image", "video", "audio"]),
}).catchall(z.json()).superRefine((model, context) => { if (model.type === "text") return; const error = getMediaCapabilityDeclarationError(model, model.type); if (error) context.addIssue({ code: "custom", path: ["mode"], message: error }); })).max(2000).refine(models => new Set(models.map(model => model.id)).size === models.length, "模型 ID 不能重复");

function invalid(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

function unwrap(expression: Expression): Expression {
  while (expression.type === "TSAsExpression" || expression.type === "TSSatisfiesExpression" || expression.type === "ParenthesizedExpression" || expression.type === "TSTypeAssertion") {
    expression = expression.expression;
  }
  return expression;
}

function properties(object: ObjectExpression) {
  const result = new Map<string, ObjectExpression["properties"][number]>();
  for (const property of object.properties) {
    if (property.type === "SpreadElement" || property.computed) invalid("供应商对象和模型配置不能使用展开或计算属性");
    const name = property.key.type === "Identifier" ? property.key.name : property.key.type === "StringLiteral" ? property.key.value : undefined;
    if (name === undefined || result.has(name)) invalid("供应商对象和模型配置包含无效或重复属性");
    result.set(name, property);
  }
  return result;
}

function literal(value: Expression): z.infer<ReturnType<typeof z.json>> {
  const expression = unwrap(value);
  if (expression.type === "NumericLiteral" && !Number.isFinite(expression.value)) invalid("models 数值必须有限");
  if (expression.type === "StringLiteral" || expression.type === "NumericLiteral" || expression.type === "BooleanLiteral") return expression.value;
  if (expression.type === "NullLiteral") return null;
  if (expression.type === "TemplateLiteral" && !expression.expressions.length) return expression.quasis[0]?.value.cooked ?? "";
  if (expression.type === "UnaryExpression" && (expression.operator === "-" || expression.operator === "+") && expression.argument.type === "NumericLiteral") {
    if (!Number.isFinite(expression.argument.value)) invalid("models 数值必须有限");
    return expression.operator === "-" ? -expression.argument.value : expression.argument.value;
  }
  if (expression.type === "ArrayExpression") return expression.elements.map(item => {
    if (!item || item.type === "SpreadElement") invalid("models 仅支持 JSON 字面量");
    return literal(item);
  });
  if (expression.type === "ObjectExpression") return Object.fromEntries([...properties(expression)].map(([name, property]) => {
    if (property.type !== "ObjectProperty" || property.shorthand) invalid("models 仅支持 JSON 字面量");
    return [name, literal(property.value as Expression)];
  }));
  return invalid("供应商元数据和 models 必须直接使用字面量");
}

function parseProvider(source: string) {
  if (Buffer.byteLength(source, "utf8") > 2 * 1024 * 1024) invalid("供应商文件不能超过 2 MB");
  let module: ReturnType<typeof parse>;
  try { module = parse(source, { sourceType: "module", plugins: ["typescript"] }); }
  catch (err) { return invalid(t`供应商 TypeScript 语法错误：${err instanceof Error ? err.message : String(err)}`); }
  const exported = module.program.body.find(item => item.type === "ExportDefaultDeclaration");
  if (!exported || exported.type !== "ExportDefaultDeclaration") {
    const legacy = module.program.body.some(item => {
      if (item.type !== "ExpressionStatement" || item.expression.type !== "AssignmentExpression") return false;
      const target = item.expression.left;
      if (target.type !== "MemberExpression" || target.object.type !== "Identifier" || target.object.name !== "exports") return false;
      const name = !target.computed && target.property.type === "Identifier" ? target.property.name
        : target.computed && target.property.type === "StringLiteral" ? target.property.value : "";
      return ["vendor", "textRequest", "imageRequest", "videoRequest", "ttsRequest"].includes(name);
    });
    if (legacy) invalid("检测到旧版供应商格式，请根据当前供应商模板和接口资料重新生成后导入。");
    invalid("供应商须通过 export default 导出对象");
  }
  const object = unwrap(exported.declaration as Expression);
  if (object.type !== "ObjectExpression") invalid("供应商须直接导出对象字面量");
  const entries = properties(object);
  function value(name: string) {
    const property = entries.get(name);
    if (!property) return undefined;
    if (property.type !== "ObjectProperty" || (property.shorthand && name !== "version")) invalid(t`${name} 必须直接使用字面量`);
    let expression = unwrap(property.value as Expression);
    if (name === "version" && expression.type === "Identifier") {
      const identifier = expression.name;
      const declaration = module.program.body.flatMap(item => item.type === "VariableDeclaration" && item.kind === "const" ? item.declarations : [])
        .find(item => item.id.type === "Identifier" && item.id.name === identifier);
      if (!declaration?.init) invalid("version 必须使用字符串字面量或顶层 const 字符串常量");
      expression = declaration.init;
    }
    return literal(expression);
  }
  const id = value("id");
  const label = value("label");
  const version = value("version");
  const readme = value("readme");
  const modelsUrl = value("modelsUrl");
  const requiresApiKey = value("requiresApiKey");
  if (!providerIdSchema.safeParse(id).success) invalid("供应商 ID 必须为小驼峰文件名");
  if (typeof label !== "string" || !label.trim() || label.length > 200) invalid("供应商名称无效");
  if (version !== undefined && (typeof version !== "string" || !version.trim())) invalid("供应商版本必须为非空字符串");
  if (readme !== undefined && typeof readme !== "string") invalid("供应商说明必须为字符串");
  if (requiresApiKey !== undefined && typeof requiresApiKey !== "boolean") invalid("API Key 要求必须为布尔值");
  if (modelsUrl !== undefined && !z.url({ protocol: /^https?$/ }).refine(value => {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash;
  }).safeParse(modelsUrl).success) invalid("模型列表地址须为不含凭据或片段的 HTTP URL");
  const models = mediaModelsSchema.safeParse(value("models") ?? [], validationOptions());
  if (!models.success) invalid(models.error.issues.map(issue => translateMessage(issue.message)).join("; "));
  return { object, modelProperty: entries.get("models"), id: id as string, label, version: version?.trim(), readme, modelsUrl: modelsUrl as string | undefined, requiresApiKey: requiresApiKey !== false, models: models.data };
}

async function withLocalCapabilities<T extends { type: string }>(id: string, models: T[]): Promise<T[]> {
  if (id === "biRefNet") {
    const status = await getBackgroundRemovalStatus();
    if (status.phase !== "ready") invalid(status.error ?? "请先在模型配置中下载本机背景移除模型", 424);
    return models;
  }
  if (id !== "windowsSpeech") return models;
  const voices = (await getSystemSpeechVoices()).map(voice => ({ title: `${voice.name} · ${voice.culture}`, voice: voice.name }));
  return models.map(model => model.type === "audio" ? { ...model, voices } : model);
}

async function metadata(fileName: string, source: string) {
  const { id, label, version, readme, modelsUrl, requiresApiKey, models } = parseProvider(source);
  if (fileName !== `${id}.ts`) invalid("供应商 ID 与文件名不一致");
  return { fileName, id, label, version, readme, modelsUrl, requiresApiKey, models: await withLocalCapabilities(id, models),
    revision: createHash("sha256").update(source).digest("hex"), loadError: "" };
}

async function directory(create = false) {
  const path = join(dirname(conf.path), "providers");
  if (create) {
    await mkdir(dirname(conf.path), { recursive: true });
    await mkdir(path).catch((err: NodeJS.ErrnoException) => { if (err.code !== "EEXIST") throw err; });
  }
  const info = await lstat(path).catch((err: NodeJS.ErrnoException) => { if (err.code === "ENOENT") return null; throw err; });
  if (info && (info.isSymbolicLink() || !info.isDirectory())) invalid("供应商目录不能是符号链接或文件", 403);
  return info ? path : null;
}

async function readProvider(path: string, fileName: string) {
  if (!mediaProviderFileSchema.safeParse(fileName).success) invalid("供应商文件名无效");
  const file = join(path, fileName);
  const info = await lstat(file);
  if (info.isSymbolicLink() || !info.isFile()) invalid("供应商文件不能是符号链接或目录", 403);
  if (info.size > 2 * 1024 * 1024) invalid("供应商文件不能超过 2 MB");
  const source = await readFile(file, "utf8");
  return { fileName, id: fileName.slice(0, -3), source, revision: createHash("sha256").update(source).digest("hex") };
}

export async function getMediaProvider(id: string) {
  if (!providerIdSchema.safeParse(id).success) invalid("供应商 ID 无效");
  const path = await directory();
  if (!path) invalid("请先在媒体模型设置中添加供应商", 404);
  const current = await readProvider(path, `${id}.ts`).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") invalid("请先在媒体模型设置中添加供应商", 404);
    throw error;
  });
  return { ...await metadata(current.fileName, current.source), source: current.source };
}

export async function listMediaProviders() {
  const path = await directory();
  if (!path) return [];
  const files = await readdir(path, { withFileTypes: true });
  return Promise.all(files.filter(file => file.isFile() && mediaProviderFileSchema.safeParse(file.name).success)
    .sort((left, right) => left.name.localeCompare(right.name)).map(async file => {
      let current = { fileName: file.name, id: file.name.slice(0, -3), source: "", revision: "" };
      try {
        current = await readProvider(path, file.name);
        return await metadata(current.fileName, current.source);
      } catch (error) {
        // ACT: 元数据损坏不影响其他供应商；仍保留原文版本，允许用户明确删除。
        const { source, ...file } = current;
        return { ...file, label: current.id, version: "", readme: "", requiresApiKey: true, models: [], loadError: translateMessage(error instanceof Error ? error.message : "供应商文件无法读取") };
      }
    }));
}

export async function addMediaProvider(source: string) {
  const { id } = parseProvider(source);
  const fileName = `${id}.ts`;
  const result = await metadata(fileName, source);
  const path = join((await directory(true))!, fileName);
  const release = lockWorkspaceFiles([path]);
  try { await writeWorkspaceFile(path, source, true); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") invalid(t`媒体供应商“${result.label}”已安装，请在「设置 → 媒体模型」中编辑，或先删除后重新安装。`, 409);
    throw error;
  }
  finally { release(); }
  return result;
}

export async function writeMediaProviderSource(source: string, revision?: string, commit?: () => void) {
  const { id } = parseProvider(source);
  const result = await metadata(`${id}.ts`, source);
  const path = join((await directory(true))!, `${id}.ts`);
  const release = lockWorkspaceFiles([path]);
  try {
    const previous = await readProvider((await directory())!, `${id}.ts`).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (revision !== undefined && (previous?.revision ?? "") !== revision) invalid("渠道已被修改，请刷新后重试", 409);
    await writeWorkspaceFile(path, source);
    try { commit?.(); }
    catch (error) {
      if (previous) await writeWorkspaceFile(path, previous.source);
      else await unlink(path);
      throw error;
    }
  }
  finally { release(); }
  return result;
}

export async function saveMediaProvider(fileName: string, models: z.infer<typeof mediaModelsSchema>, revision: string, expectedApiKey?: string) {
  if (!mediaProviderFileSchema.safeParse(fileName).success) invalid("供应商文件名无效");
  const checked = mediaModelsSchema.safeParse(models, validationOptions());
  if (!checked.success) invalid(checked.error.issues.map(issue => translateMessage(issue.message)).join("; "));
  const path = await directory();
  if (!path) invalid("供应商文件不存在", 404);
  const release = lockWorkspaceFiles([join(path, fileName)]);
  try {
    const current = await readProvider(path, fileName);
    if (current.revision !== revision) invalid("供应商文件已被修改，请刷新页面后再编辑", 409);
    const { object, modelProperty } = parseProvider(current.source);
    const newline = current.source.includes("\r\n") ? "\r\n" : "\n";
    const formatted = JSON.stringify(checked.data, null, 2).replace(/\n/g, `${newline}  `);
    const start = modelProperty?.type === "ObjectProperty" ? modelProperty.value.start! : object.start! + 1;
    const end = modelProperty?.type === "ObjectProperty" ? modelProperty.value.end! : start;
    const replacement = modelProperty ? formatted : `${newline}  models: ${formatted},`;
    // ACT: 只替换 models 源码区间，保留供应商函数及其余用户编辑。
    const source = current.source.slice(0, start) + replacement + current.source.slice(end);
    const result = await metadata(fileName, source);
    if (expectedApiKey !== undefined && getMediaProviderApiKey(result.id) !== expectedApiKey) invalid("供应商配置已变更，请重试", 409);
    await writeWorkspaceFile(join(path, fileName), source);
    return result;
  } finally { release(); }
}

export function getMediaProviderApiKey(id: string) {
  const value: unknown = conf.get(`settings.mediaProviderConfigs.${id}.apiKey`);
  return typeof value === "string" ? value.trim().replace(/^Bearer(?:\s+|$)/i, "").trim() : "";
}

export async function refreshMediaProviderModels(fileName: string, revision?: string) {
  if (!mediaProviderFileSchema.safeParse(fileName).success) invalid("供应商文件名无效");
  const provider = await getMediaProvider(fileName.slice(0, -3));
  if (revision !== undefined && revision !== provider.revision) invalid("供应商文件已被修改，请刷新页面后再获取", 409);
  if (!provider.modelsUrl) invalid("供应商未配置 modelsUrl");
  const apiKey = getMediaProviderApiKey(provider.id);
  const response = await credentialFetch(provider.modelsUrl, apiKey)(provider.modelsUrl, {
    headers: { Accept: "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    signal: AbortSignal.timeout(30000), redirect: "error",
  });
  if (!response.ok) throw new Error(t`获取媒体模型列表失败（HTTP ${response.status}）`);
  const result = z.object({ data: z.array(mediaModelsSchema.element.partial({ label: true, type: true })).max(2000) }).parse(await response.json());
  if (!result.data.length) throw new Error("未获取到媒体模型，保留原有列表");
  const requestedType = z.enum(["text", "image", "video", "audio"]).safeParse(new URL(provider.modelsUrl).searchParams.get("type"));
  const models = result.data.map(model => {
    const id = model.id.trim();
    const previous = provider.models.find(item => item.id === id);
    const type = model.type ?? (requestedType.success ? requestedType.data : previous?.type);
    if (!type) invalid(t`模型 ${id} 缺少 type，请在返回数据或 modelsUrl 的 type 参数中指定`);
    // ACT: 只有 ID 的列表沿用同名模型参数，新模型不猜测生成能力。
    return { ...previous, ...model, id, label: model.label ?? previous?.label
      ?? (typeof model.display_name === "string" ? model.display_name : typeof model.displayName === "string" ? model.displayName : id), type };
  });
  const types = new Set(models.map(model => model.type));
  return saveMediaProvider(fileName, [...provider.models.filter(model => !types.has(model.type)), ...models], provider.revision, apiKey);
}

export async function deleteMediaProvider(fileName: string, revision: string) {
  if (!mediaProviderFileSchema.safeParse(fileName).success) invalid("供应商文件名无效");
  const path = await directory();
  if (!path) invalid("供应商文件不存在", 404);
  const file = join(path, fileName);
  const release = lockWorkspaceFiles([file]);
  try {
    const current = await readProvider(path, fileName);
    if (current.revision !== revision) invalid("供应商文件已被修改，请刷新页面后再删除", 409);
    await unlink(file);
    try {
      const settings = conf.get("settings", {});
      const configs = { ...(settings.mediaProviderConfigs as Record<string, unknown> ?? {}) };
      const defaults = { ...(settings.mediaChannelDefaults as Record<string, { providerId?: string }> ?? {}) };
      delete configs[current.id];
      for (const kind of Object.keys(defaults)) if (defaults[kind]?.providerId === current.id) delete defaults[kind];
      const customProviders = Array.isArray(settings.customProviders) ? settings.customProviders.filter(provider => provider?.id !== current.id) : [];
      conf.set("settings", { ...settings, mediaProviderConfigs: configs, mediaChannelDefaults: defaults, customProviders });
    } catch (error) { await writeWorkspaceFile(file, current.source); throw error; }
  } finally { release(); }
}

export async function loadMediaProviderSource(source: string, config: Record<string, unknown> = {}, signal?: AbortSignal, fetchRequest = fetch, cwd?: string, task?: ProviderTools["task"], onAsset?: ProviderTools["onAsset"], imageTransport?: MediaGenerationRequest["imageTransport"], reportUsage?: ProviderTools["reportUsage"]) {
  signal?.throwIfAborted();
  const { id, models } = parseProvider(source);
  const availableModels = await withLocalCapabilities(id, models) as Provider["models"];
  const instance = await createIsolatedProvider(providerTranspiler.transformSync(source), id, config, signal);
  try {
    const providerConfig = instance.metadata.config;
    if (isProtectedCredential(providerConfig.apiKey)) invalid("密钥无法解密，请在设置中重新输入");
    const protectedFetch = credentialFetch(typeof providerConfig.apiUrl === "string" ? providerConfig.apiUrl : undefined, typeof providerConfig.apiKey === "string" ? providerConfig.apiKey : "", fetchRequest);
    const tools = (activeSignal: AbortSignal, markSynchronous: (callback: Function) => void) => {
      const fetchWithSignal = Object.assign((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        activeSignal.throwIfAborted();
        const original = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        return protectedFetch(input, { ...init, signal: original ? AbortSignal.any([activeSignal, original]) : activeSignal });
      }, { preconnect: protectedFetch.preconnect }) as typeof fetch;
      const hostTools: ProviderTools = {
        task, onAsset, reportUsage, fetch: fetchWithSignal, hash: Bun.hash, image: Bun.Image,
        errorMessage: value => mediaErrorMessage(value, providerConfig),
        imageProcessing: { removeBackground: input => removeBackground(input, activeSignal) },
        audio: { convert: (input, options: AudioConvertOptions) => convertAudio(input, options, activeSignal), synthesize: input => synthesizeSystemSpeech(input, activeSignal) },
        mediaChannel: () => { throw new Error("宿主渠道不接受供应商覆盖的上下文"); },
        ffmpeg: async () => {
          activeSignal.throwIfAborted();
          if (!cwd) throw new Error("当前操作没有工作目录，无法使用 FFmpeg");
          return createWorkspaceFfmpeg(cwd, activeSignal);
        },
      };
      const channelProvider = createProviderRuntime({ ...instance.metadata, models: availableModels,
        generateImage(request) { return runMediaChannel("image", this, request, imageTransport); },
        generateVideo(request) { return runMediaChannel("video", this, request, imageTransport); },
        generateAudio(request) { return runMediaChannel("audio", this, request, imageTransport); },
      }, providerConfig, activeSignal, hostTools);
      const preconnect = (url: string, options?: Parameters<typeof fetch.preconnect>[1]) => { activeSignal.throwIfAborted(); protectedFetch.preconnect(url, options); };
      markSynchronous(preconnect);
      // 仅导出当前任务所需能力；请求和响应流不传递宿主原生对象。
      return {
        task, onAsset, reportUsage, audio: hostTools.audio, imageProcessing: hostTools.imageProcessing, preconnect,
        async fetch(input: { url: string; method: string; headers: [string, string][]; redirect: RequestInit["redirect"]; body?: string | Uint8Array; signal: AbortSignal }) {
          const response = await fetchWithSignal(input.url, { method: input.method, headers: input.headers, redirect: input.redirect, body: typeof input.body === "string" ? input.body : input.body && new Uint8Array(input.body).buffer, signal: input.signal });
          const reader = response.body?.getReader();
          const cancel = () => { void reader?.cancel().catch(() => {}); };
          activeSignal.addEventListener("abort", cancel, { once: true });
          const release = () => { activeSignal.removeEventListener("abort", cancel); };
          return { status: response.status, statusText: response.statusText, headers: [...response.headers], url: response.url, redirected: response.redirected, type: response.type,
            read: reader && (async () => { try { activeSignal.throwIfAborted(); const next = await reader.read(); if (next.done) release(); return next; } catch (error) { release(); throw error; } }),
            cancel: reader && (async () => { try { await reader.cancel(); } finally { release(); } }),
          };
        },
        mediaChannel(kind: "image" | "video" | "audio", request: ImageRequest & VideoRequest & AudioRequest) {
          activeSignal.throwIfAborted();
          const generate = { image: channelProvider.generateImage!, video: channelProvider.generateVideo!, audio: channelProvider.generateAudio! }[kind];
          return generate.call(channelProvider, request);
        },
        async ffmpeg() {
          const runtime = describeFfmpeg(await hostTools.ffmpeg());
          if (runtime.validateOutput) { const validate = runtime.validateOutput; runtime.validateOutput = path => { activeSignal.throwIfAborted(); validate(path); }; markSynchronous(runtime.validateOutput); }
          return runtime;
        },
      };
    };
    type Method = "generateImage" | "generateVideo" | "generateAudio" | "checkForUpdates" | "updateVendor";
    const provider: Omit<Provider, Method> & { [Name in Method]?: OmitThisParameter<NonNullable<Provider[Name]>> } & { config: Record<string, unknown>; dispose: typeof instance.dispose; pid: number } = { ...instance.metadata, models: availableModels, config: providerConfig, pid: instance.pid, dispose: instance.dispose };
    for (const name of instance.methods) {
      if (!["generateImage", "generateVideo", "generateAudio", "checkForUpdates", "updateVendor"].includes(name)) throw new Error("供应商方法无效");
      Object.assign(provider, { [name]: (request: unknown) => instance.run(name, request, availableModels, tools) });
    }
    return provider;
  } catch (error) { await instance.dispose(); throw error; }
}
