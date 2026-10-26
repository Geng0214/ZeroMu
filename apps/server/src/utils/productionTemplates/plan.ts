import { projectCanvasFolder, projectPath } from "@/utils/workspace/projectLayout";
import { createHash } from "node:crypto";
import { dirname, extname, join } from "node:path";
import { lstat, readdir, readFile, mkdir, writeAtomic } from "@toonflow/file";
import { z } from "zod";
import { readProject } from "@/utils/production/format";
import { readProjectFile } from "@/utils/production";
import { resolveWorkspacePath } from "@/utils/workspace/files";
import { readNode, nodesDirectory } from "@/utils/plugins/nodes";
import { listMediaModels, currentProviderRevision } from "@/utils/media/generation";
import { verifyTransferFile } from "@/utils/production/transfer";
import type { ProjectRecord } from "@/utils/production/schema";
import { templateApplicationInputSchema, renderProductionTemplate, templateMediaMimeTypes, type TemplateApplicationInput, type TemplatePreview } from "./schema";

export function templateFailure(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }
export const templateDigest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const compareKeys = (a: string, b: string) => a === b ? 0 : a < b ? -1 : 1;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => compareKeys(a, b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function applicationInput(value: unknown) { return templateApplicationInputSchema.parse(value); }
export function applicationHash(value: TemplateApplicationInput) {
  return templateDigest(JSON.stringify(canonical({ ...value, mappings: [...value.mappings].sort((a, b) => compareKeys(a.slotKey, b.slotKey)), mediaBindings: [...value.mediaBindings].sort((a, b) => compareKeys(a.key, b.key)) })));
}
export const templateFolder = (directory: string, id: string) => projectPath(directory, `productionTemplateInputs/${id}`);
export const templateCanvasId = (directory: string, id: string) => (projectCanvasFolder(directory) ? "canvases/" : "") + "template" + id.replaceAll("-", "") + ".json";
const mediaRecordSchema = z.strictObject({ key: z.string(), path: z.string(), mimeType: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive().max(100 * 1024 * 1024), stagedPath: z.string() });
const pendingSchema = z.strictObject({ zeromuTemplateApplication: z.literal(true), format: z.literal(1), inputHash: z.string().regex(/^[a-f0-9]{64}$/), input: templateApplicationInputSchema, media: z.array(mediaRecordSchema).max(32) });
type PendingApplication = z.infer<typeof pendingSchema>;
async function readPending(directory: string, id: string) {
  const path = `${templateFolder(directory, id)}/application.json`;
  const target = await resolveWorkspacePath(directory, path, true);
  const info = await lstat(target.path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return null; throw cause; });
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024) templateFailure("待完成模板记录无效，原目录已保留", 422);
  let saved: PendingApplication;
  try { saved = pendingSchema.parse(JSON.parse(await readFile(target.path, "utf8"))); }
  catch (cause) { if (cause instanceof SyntaxError || cause instanceof z.ZodError) templateFailure("待完成模板记录损坏或格式不受支持，原目录已保留", 422); throw cause; }
  if (saved.input.applicationId !== id || applicationHash(saved.input) !== saved.inputHash || new Set(saved.media.map(item => item.key)).size !== saved.media.length || saved.media.some(item => item.stagedPath !== stagedMediaPath(directory, saved.input, item.key))) templateFailure("待完成模板记录摘要或文件位置不匹配，原目录已保留", 422);
  return saved;
}
function stagedMediaPath(directory: string, input: TemplateApplicationInput, key: string) {
  const binding = input.mediaBindings.find(item => item.key === key);
  if (!binding) templateFailure("参考文件不属于模板输入", 422);
  const extension = extname(binding.path).toLowerCase();
  if (!/^\.[a-z0-9]{1,10}$/.test(extension)) templateFailure("参考文件需要可识别的扩展名", 400);
  return `${templateFolder(directory, input.applicationId)}/media${key}${extension}`;
}
async function mediaBytes(directory: string, item: TemplatePreview["media"][number], pending: boolean) {
  const bytes = pending ? await readProjectFile(directory, item.stagedPath).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return readProjectFile(directory, item.path); throw cause; }) : await readProjectFile(directory, item.path);
  if (bytes.length !== item.bytes || templateDigest(bytes) !== item.hash) templateFailure("参考文件与已预览内容不一致，请保留原文件并重新核对");
  return bytes;
}
export async function prepareTemplate(directory: string, project: ProjectRecord, raw: unknown) {
  const input = applicationInput(raw); const inputHash = applicationHash(input);
  let filled: ReturnType<typeof renderProductionTemplate>;
  try { filled = renderProductionTemplate(input.definition, input.values); }
  catch (cause) { templateFailure(cause instanceof z.ZodError ? `填值后的模板不符合要求：${cause.issues.slice(0, 4).map(issue => issue.message).join("；")}` : cause instanceof Error ? cause.message : "模板填值无效", 400); }
  const { rendered, unmatched } = filled;
  const pending = await readPending(directory, input.applicationId);
  if (pending && pending.inputHash !== inputHash) templateFailure("此应用编号已有待完成记录。请载入原草稿继续，或使用新编号创建独立应用");
  if (project.templateApplications?.some(record => record.applicationId === input.applicationId)) templateFailure("此模板应用已完成，请刷新项目查看制作单元");
  if (new Set(input.mappings.map(item => item.slotKey)).size !== input.mappings.length || input.mappings.length !== rendered.modelSlots.length || input.mappings.some(item => !rendered.modelSlots.some(slot => slot.key === item.slotKey))) templateFailure("每个模型位置都须选择实际模型，或明确选择稍后配置", 400);
  if (new Set(input.mediaBindings.map(item => item.key)).size !== input.mediaBindings.length || input.mediaBindings.some(item => !rendered.mediaInputs.some(required => required.key === item.key)) || rendered.mediaInputs.some(item => item.required && !input.mediaBindings.some(binding => binding.key === item.key))) templateFailure("参考文件有重复、未知输入或缺少必填项", 400);
  const models = await listMediaModels();
  const mappings: TemplatePreview["mappings"] = [];
  const warnings = ["应用仅创建独立制作对象，不会开始生成。生成前请核对模型的模式、时长、参考能力、音色与费用。"];
  for (const slot of rendered.modelSlots) {
    const mapping = input.mappings.find(item => item.slotKey === slot.key)!;
    if (mapping.deferred) { mappings.push({ slotKey: slot.key, label: slot.label, mediaType: slot.mediaType, selection: "稍后配置" }); warnings.push(`${slot.label}尚未配置，相关节点需选择模型后才能生成`); continue; }
    const model = models.find(item => item.providerId === mapping.providerId && item.modelId === mapping.modelId && item.type === slot.mediaType);
    if (!model) templateFailure(`${slot.label}所选模型已不可用或类型不符，请刷新模型目录`, 400);
    mappings.push({ slotKey: slot.key, label: slot.label, mediaType: slot.mediaType, selection: `${model.providerLabel} · ${model.label}（${model.modelId}）`, providerRevision: await currentProviderRevision(model.providerId) });
    if (slot.mediaType === "video" && !model.mode) warnings.push(`${slot.label}未声明生成模式能力，需在节点中核对`);
    if (slot.mediaType === "image" && model.imageReferenceLimit === undefined) warnings.push(`${slot.label}未声明参考图数量限制，需在节点中核对`);
  }
  let media: TemplatePreview["media"] = [];
  if (pending) {
    media = pending.media;
    if (media.length !== input.mediaBindings.length || media.some(item => { const binding = input.mediaBindings.find(binding => binding.key === item.key); return !binding || item.path !== binding.path || item.mimeType !== binding.mimeType; })) templateFailure("待完成模板的参考清单不一致", 422);
    for (const item of media) await mediaBytes(directory, item, true);
  } else for (const binding of input.mediaBindings) {
    const requirement = rendered.mediaInputs.find(item => item.key === binding.key)!;
    if (templateMediaMimeTypes[extname(binding.path).slice(1).toLowerCase()] !== binding.mimeType) templateFailure("参考文件扩展名与媒体类型不匹配或暂不支持", 400);
    if (!binding.mimeType.startsWith(`${requirement.mediaType}/`)) templateFailure(`${requirement.label}的文件类型不符`, 400);
    const bytes = await readProjectFile(directory, binding.path);
    if (!bytes.length) templateFailure("参考文件不能为空", 400);
    const hash = templateDigest(bytes);
    if (/^(assets\/production|references\/versions)\//i.test(binding.path.replaceAll("\\", "/"))) {
      const fixed = project.assetVersions.flatMap(version => version.files).find(file => file.path.toLowerCase() === binding.path.replaceAll("\\", "/").toLowerCase());
      if (!fixed || fixed.hash !== hash || fixed.mimeType !== binding.mimeType) templateFailure("固定参考文件未登记或内容已改变");
    }
    if (/^(assets\/transfers|references\/transfers)\//i.test(binding.path.replaceAll("\\", "/"))) await verifyTransferFile(directory, binding.path, bytes);
    media.push({ ...binding, hash, bytes: bytes.length, stagedPath: stagedMediaPath(directory, input, binding.key) });
    if (media.reduce((sum, item) => sum + item.bytes, 0) > 500 * 1024 * 1024) templateFailure("单次模板参考文件合计不能超过 500 MB", 413);
  }
  if (media.reduce((sum, item) => sum + item.bytes, 0) > 500 * 1024 * 1024) templateFailure("单次模板参考文件合计不能超过 500 MB", 413);
  for (const slot of rendered.modelSlots) {
    const mapping = input.mappings.find(item => item.slotKey === slot.key)!;
    if (mapping.deferred) continue;
    const model = models.find(item => item.providerId === mapping.providerId && item.modelId === mapping.modelId && item.type === slot.mediaType)!;
    const counts = [...rendered.example.shots, ...rendered.example.generationNodes].filter(node => node.modelSlotKey === slot.key).map(node => media.filter(file => { const requirement = rendered.mediaInputs.find(item => item.key === file.key)!; return node.references.some(reference => reference.assetKey === requirement.assetKey && reference.versionKey === requirement.versionKey); }));
    if (slot.mediaType === "image" && model.imageReferenceLimit !== undefined && counts.some(files => files.filter(file => file.mimeType.startsWith("image/")).length > model.imageReferenceLimit!)) warnings.push(`${slot.label}的部分镜头超过已声明参考图上限；生成前需调整参考或更换模型`);
    if (slot.mediaType === "video" && Array.isArray(model.mode) && model.mode.length > 0 && model.mode.every(mode => mode === "text") && counts.some(files => files.length)) warnings.push(`${slot.label}仅声明文生视频，但模板连接了媒体参考；生成前需移除媒体参考或更换模型`);
    if (slot.mediaType === "audio" && counts.some(files => files.some(file => !file.mimeType.startsWith("audio/")))) warnings.push(`${slot.label}连接了非音频参考；生成前需核对并调整引用`);
  }
  const usedTypes = new Set([...rendered.modelSlots.map(slot => slot.mediaType), ...media.map(item => rendered.mediaInputs.find(input => input.key === item.key)!.mediaType), ...(rendered.example.assets.length ? ["text"] : [])]);
  for (const type of usedTypes) {
    await readNode(`${type}Node`);
    if (await lstat(join(nodesDirectory, `${type}Node.disabled`)).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return null; throw cause; })) templateFailure(`请先启用${type}Node节点`, 400);
  }
  const versions = rendered.example.assets.reduce((sum, asset) => sum + asset.versions.length, 0);
  if (project.canvases.length >= 10000 || project.sequences.length >= 1000 || (project.templateApplications?.length ?? 0) >= 1000 || project.shots.length + rendered.example.shots.length > 10000 || project.assets.length + rendered.example.assets.length > 10000 || project.assetVersions.length + versions > 100000) templateFailure("项目已接近制作对象上限，请应用到另一个项目", 413);
  const missingMedia = rendered.mediaInputs.filter(item => !media.some(file => file.key === item.key));
  if (missingMedia.length) warnings.push(`尚未补充可选参考：${missingMedia.map(item => item.label).join("、")}；将保留文字资料节点`);
  if (unmatched.length) warnings.push(`以下未声明占位符按原文保留：${unmatched.join("、")}`);
  const preview: TemplatePreview = { definition: rendered, inputHash, previewFingerprint: templateDigest(JSON.stringify(canonical({ inputHash, media, mappings }))), title: rendered.example.name, canvasId: templateCanvasId(directory, input.applicationId), counts: { shots: rendered.example.shots.length, assets: rendered.example.assets.length, versions, generationNodes: rendered.example.shots.length + rendered.example.generationNodes.length, referenceNodes: versions + media.length }, mappings, media, warnings, resuming: !!pending };
  return { input, rendered, preview, pending };
}
export async function previewTemplate(directory: string, expectedRevision: number, value: unknown) {
  const project = await readProject(directory);
  if (!project) templateFailure("请先建立项目制作记录", 404);
  if (project.revision !== expectedRevision) templateFailure("项目已更新，请刷新制作记录后重新预览");
  return (await prepareTemplate(directory, project, value)).preview;
}
export async function freezeTemplateInputs(directory: string, plan: Awaited<ReturnType<typeof prepareTemplate>>) {
  const folder = (await resolveWorkspacePath(directory, templateFolder(directory, plan.input.applicationId), true)).path;
  await mkdir(folder, { recursive: true });
  const record: PendingApplication = { zeromuTemplateApplication: true, format: 1, inputHash: plan.preview.inputHash, input: plan.input, media: plan.preview.media };
  const text = JSON.stringify(pendingSchema.parse(record), null, 2);
  if (Buffer.byteLength(text) > 8 * 1024 * 1024) templateFailure("模板应用草稿超过 8 MB", 413);
  await writeAtomic(join(folder, "application.json"), text, { exclusive: true }).catch(async (cause: NodeJS.ErrnoException) => { if (cause.code !== "EEXIST") throw cause; const saved = await readPending(directory, plan.input.applicationId); if (saved?.inputHash !== record.inputHash || JSON.stringify(saved.media) !== JSON.stringify(record.media)) templateFailure("待完成模板记录冲突，原内容保留"); });
  for (const item of record.media) await writeFrozenFile(directory, item.stagedPath, await mediaBytes(directory, item, !!plan.pending));
}
export async function writeFrozenFile(directory: string, path: string, bytes: string | Uint8Array) {
  const target = (await resolveWorkspacePath(directory, path, true)).path;
  await mkdir(dirname(target), { recursive: true });
  await writeAtomic(target, bytes, { exclusive: true }).catch(async (cause: NodeJS.ErrnoException) => { if (cause.code !== "EEXIST") throw cause; if (templateDigest(await readProjectFile(directory, path)) !== templateDigest(bytes)) templateFailure("中断应用的文件与原内容冲突，现有文件已保留"); });
}
export async function pendingTemplates(directory: string) {
  const project = await readProject(directory);
  const root = (await resolveWorkspacePath(directory, projectPath(directory, "productionTemplateInputs"), true)).path;
  const entries = await readdir(root, { withFileTypes: true }).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return []; throw cause; });
  if (entries.length > 1000) templateFailure("模板应用目录过多，请先保留备份并整理项目", 413);
  const items: TemplateApplicationInput[] = []; const warnings: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !z.uuid().safeParse(entry.name).success || project?.templateApplications?.some(item => item.applicationId === entry.name)) continue;
    try { const saved = await readPending(directory, entry.name); if (saved) items.push(saved.input); }
    catch { warnings.push(`待完成应用${entry.name}无法读取，原目录已保留`); }
  }
  return { items, warnings };
}
