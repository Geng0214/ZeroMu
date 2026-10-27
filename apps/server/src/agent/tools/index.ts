import { t } from "@/lib/i18n";
import { currentProviderRevision, effectiveMediaRequest, listMediaModels } from "@/utils/media/generation";
import { validateModelCapabilities } from "@/utils/media/capabilities";
import { generateTask } from "@/utils/media/tasks";
import { assertCurrentQuote, quoteMediaCost, readCostPolicy } from "@/utils/media/costs";
import { createWorkspaceFfmpeg } from "@/utils/ffmpeg";
import { basename, dirname, join, relative, resolve } from "node:path";
import { access, constants, copyFile, lstat, mkdir, readFile, readdir, rm, rmdir, stat, withFileAccess } from "@toonflow/file";
import {
  defineTool, createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition, createLsToolDefinition,
  detectSupportedImageMimeTypeFromFile, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { CanvasContext, QuestionContext, ToolContext, ToolFiles, MediaGenerationRequest, MediaTaskSource } from "@toonflow/tools-scaffold/runtime";
import conf from "@/utils/conf";
import { isWithin, resolveWorkspacePath, writeWorkspaceFile, renameWorkspaceFile, lockWorkspaceFiles, protectWorkspaceRoot } from "@/utils/workspace/files";
import { listTools, loadTool, validateToolConfig } from "@/utils/plugins/tools";
import { createSkillContext } from "@/agent/skills";
import { assertProductionWrite } from "@/utils/production/format";
import { readProject, updateProject } from "@/utils/production";
import { shotInputSchema } from "@/utils/production/schema";
import { z } from "zod";

export function createAgentToolContext(cwd: string, config: Record<string, unknown> = {}, canvas?: CanvasContext, question?: QuestionContext): ToolContext {
  async function generate(mediaType: "image" | "video" | "audio", input: MediaGenerationRequest, signal?: AbortSignal, source?: Partial<MediaTaskSource>) {
    signal?.throwIfAborted();
    const original = structuredClone(input);
    const providerRevision = await currentProviderRevision(original.providerId);
    const request = await effectiveMediaRequest(mediaType, original);
    const model = (await listMediaModels()).find(model => model.providerId === request.providerId && model.modelId === request.modelId && model.type === mediaType);
    if (!model) throw new Error("所选模型已改变或不可用，请重新查询模型列表");
    validateModelCapabilities(model, mediaType, request);
    const project = await readProject(cwd);
    if (source?.projectId && source.projectId !== project?.projectId) throw new Error("生成所属项目已变化，请重新核对范围。");
    const sourceCanvasId = canvas?.id ?? source?.canvasId;
    const shot = project?.shots.find(shot => !shot.archived && (source?.shotId ? shot.shotId === source.shotId : !!source?.nodeId && shot.canvasId === sourceCanvasId && shot.nodeId === source.nodeId));
    const shotReferenceVersions = shot && structuredClone(shot.references);
    const shotReferenceLabel = shotReferenceVersions?.map(reference => { const asset = project?.assets.find(asset => asset.assetId === reference.assetId); return `${asset?.name ?? "素材"} · v${(asset?.versionIds.indexOf(reference.versionId) ?? -1) + 1}${reference.role ? ` · ${reference.role}` : ""}`; }).join("；");
    const quote = quoteMediaCost(await readCostPolicy(), mediaType, request);
    const costLabel = quote.kind === "estimated" ? `预估 ${quote.money.currency} ${quote.money.amount}；单价来源：${quote.rate.source}；更新于 ${new Date(quote.rate.updatedAt).toLocaleString()}，以渠道账单为准。` : `费用未知：${quote.reason}，以渠道账单为准。`;
    if (await currentProviderRevision(request.providerId) !== providerRevision) throw new Error("渠道或模型能力已改变，请重新查询模型列表。");
    const preferences = conf.get("settings", {}).agentPreferences as { autoGenerateMedia?: boolean } | undefined;
    if (preferences?.autoGenerateMedia === false) {
      if (!question) throw new Error("当前会话无法确认生成，请在画布中手动执行。");
      const { prompt, ...parameters } = request;
      const answer = await question.ask(source?.toolCallId ?? crypto.randomUUID(), {
        title: `确认生成${{ image: "图片", video: "视频", audio: "音频" }[mediaType]}`,
        question: `渠道：${model.providerLabel || model.providerId}\n模型：${model.label || model.modelId}\n本次范围：1 个任务；${costLabel}\n参数与参考素材：\n${JSON.stringify(parameters, null, 2)}${shot ? `\n镜头资料快照（不替代实际媒体输入）：${shotReferenceLabel || "无"}` : ""}\n\n提示词${prompt.length > 600 ? `（前 600 字，共 ${prompt.length} 字）` : ""}：\n${prompt.slice(0, 600)}`,
        options: ["确认生成", "取消生成"],
      }, signal);
      if (answer.skipped || answer.answer !== "确认生成") throw new Error("用户未确认生成。请停止本次生成，等待用户的新指令。");
    }
    signal?.throwIfAborted();
    if (await currentProviderRevision(request.providerId) !== providerRevision) throw new Error("确认期间渠道或模型能力已改变，请重新查询模型并确认本次生成。");
    assertCurrentQuote(quote, quoteMediaCost(await readCostPolicy(), mediaType, request));
    return generateTask(cwd, mediaType, original, { ...source, projectId: source?.projectId ?? project?.projectId, shotId: shot?.shotId ?? source?.shotId, kind: "agent", ...(canvas ? { canvasId: canvas.id } : {}) }, signal, { request, providerRevision, quote, shotReferenceVersions });
  }
  const skillsDirectory = join(dirname(conf.path), "skills");
  const resolvePath = async (path: string, readOnly = false) => {
    const absolute = resolve(cwd, path);
    const root = readOnly && isWithin(skillsDirectory, absolute) ? skillsDirectory : cwd;
    return (await resolveWorkspacePath(root, relative(root, absolute), true)).path;
  };
  const withWritePaths = async (paths: string[], operation: (targets: string[]) => Promise<void>, readOnlyCount = 0, includeParents = false) => {
    const targets = await Promise.all(paths.map(path => resolvePath(path)));
    await assertProductionWrite(cwd, targets.slice(readOnlyCount), includeParents);
    const release = lockWorkspaceFiles(targets);
    try { await operation(targets); }
    finally { release(); }
  };
  const files: ToolFiles = {
    readFile: async (path, readOnly = false) => readFile(await resolvePath(path, readOnly)),
    access: async (path, readOnly = false) => access(await resolvePath(path, readOnly)),
    stat: async (path, readOnly = false) => stat(await resolvePath(path, readOnly)),
    readdir: async (path, readOnly = false) => readdir(await resolvePath(path, readOnly)),
    detectImageMimeType: async (path, readOnly = false) => {
      const target = await resolvePath(path, readOnly);
      return withFileAccess([target], "read", () => detectSupportedImageMimeTypeFromFile(target));
    },
    writeFile: (path, content, exclusive = false) => withWritePaths([path], async ([target]) => {
      await writeWorkspaceFile(target, content, exclusive);
    }),
    mkdir: (path, recursive = false) => withWritePaths([path], async ([target]) => {
      await mkdir(target, { recursive });
    }),
    rename: (path, target) => withWritePaths([path, target], async ([source, destination]) => {
      protectWorkspaceRoot(cwd, source);
      protectWorkspaceRoot(cwd, destination);
      await renameWorkspaceFile(source, resolve(dirname(destination), basename(resolve(cwd, target))));
    }, 0, true),
    remove: (path, recursive = false) => withWritePaths([path], async ([target]) => {
      protectWorkspaceRoot(cwd, target);
      if ((await lstat(target)).isDirectory() && !recursive) await rmdir(target);
      else await rm(target, { recursive });
    }, 0, true),
    copyFile: (path, target, exclusive = false) => withWritePaths([path, target], async ([source, destination]) => {
      await copyFile(source, destination, exclusive ? constants.COPYFILE_EXCL : 0);
    }, 1),
  };
  return {
    cwd, config, files, resolvePath, writeFile: files.writeFile, canvas, question, skills: createSkillContext(cwd),
    ffmpeg: signal => createWorkspaceFfmpeg(cwd, signal),
    media: {
      listModels: listMediaModels,
      generateImage: (request, signal, source) => generate("image", request, signal, source),
      generateVideo: (request, signal, source) => generate("video", request, signal, source),
      generateAudio: (request, signal, source) => generate("audio", request, signal, source),
    },
    sdk: {
      defineTool, createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition, createLsToolDefinition,
      detectSupportedImageMimeTypeFromFile: path => files.detectImageMimeType(path, true),
    },
  };
}

export type AgentTools = ToolDefinition[] & { dispose(): Promise<void> };

export async function createAgentTools(cwd: string, canvas?: CanvasContext, question?: QuestionContext, signal?: AbortSignal): Promise<AgentTools> {
  const plugins: Awaited<ReturnType<typeof loadTool>>["plugin"][] = [];
  const dispose = async () => { await Promise.allSettled(plugins.map(plugin => plugin.dispose())); };
  const tools: ToolDefinition[] = [{
    name: "getProjectProduction", label: "读取项目制作记录",
    description: "读取当前项目的制作单元、镜头、固定素材版本、候选和用户采用状态。没有制作记录时返回 null；不得把文字评价当作已采用或已检查状态。",
    parameters: z.toJSONSchema(z.strictObject({})),
    async execute(_id, _params, signal) {
      signal?.throwIfAborted(); const project = await readProject(cwd);
      return { content: [{ type: "text", text: JSON.stringify(project) }], details: project };
    },
  }];
  const names = new Set(tools.map(tool => tool.name));
  const context = createAgentToolContext(cwd, {}, canvas, question);
  try {
    for (const item of await listTools()) {
      signal?.throwIfAborted();
      if (!item.enabled) continue;
      if (item.loadError) throw new Error(`${item.displayName}：${item.loadError}`);
      const { plugin, metadata } = await loadTool(item.name);
      plugins.push(plugin);
      const config = await validateToolConfig(plugin, item.config);
      const definitions = await plugin.createTools({ ...context, config });
      for (const tool of definitions) {
        if (!tool.name || typeof tool.execute !== "function") throw new Error(t`${item.displayName} 返回了无效的工具`);
        if (names.has(tool.name)) throw new Error(t`工具名称重复：${tool.name}`);
        names.add(tool.name);
        tools.push({
          ...tool,
          async execute(toolCallId, params, signal, ...rest) {
            const mediaNames = ["generateImage", "generateVideo", "generateAudio"];
            const operation = tool.name === "nodeTools" ? String((params as Record<string, unknown>).name ?? "").replace(/^node:/, "") : tool.name;
            const preferences = conf.get("settings", {}).agentPreferences as { autoGenerateMedia?: boolean } | undefined;
            if (preferences?.autoGenerateMedia === false && tool.name === "nodeTools" && mediaNames.includes(operation)) {
              if (!question) throw new Error("当前会话无法确认生成，请在画布中手动执行。");
              const label = { generateImage: "图片", generateVideo: "视频", generateAudio: "音频" }[operation];
              const prompt = (params as Record<string, unknown>).prompt;
              const answer = await question.ask(toolCallId, {
                title: `确认生成${label}`,
                question: `Agent 准备生成${label}，是否继续？${typeof prompt === "string" ? `\n\n${prompt.slice(0, 600)}` : ""}`,
                options: ["确认生成", "取消生成"],
              }, signal);
              if (answer.skipped || answer.answer !== "确认生成") throw new Error("用户未确认生成。请停止本次生成，等待用户的新指令。");
            }
            signal?.throwIfAborted();
            return tool.execute(toolCallId, params, signal, ...rest);
          },
          promptGuidelines: [
            ...(metadata.prompt ? [metadata.prompt] : []),
            ...(tool.promptGuidelines ?? []),
          ],
        });
      }
    }
    signal?.throwIfAborted();
    return Object.defineProperty(tools, "dispose", { value: dispose }) as AgentTools;
  } catch (error) { await dispose(); throw error; }
}
