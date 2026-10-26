import { z } from "zod";
import { promptVariableNames, variableSchema } from "../promptLibrary/schema";

export const templateKeySchema = z.string().regex(/^[a-z][a-zA-Z0-9]{0,63}$/, "内部名称须以小写字母开头，只含字母和数字，最多 64 字符");
const name = z.string().trim().min(1, "请填写名称").max(200, "名称不能超过 200 字符");
const text = z.string().max(100000);
const mediaType = z.enum(["image", "video", "audio"]);
const reference = z.strictObject({ assetKey: templateKeySchema, versionKey: templateKeySchema, role: z.string().max(200) });
const generationNode = z.strictObject({ key: templateKeySchema, title: name, prompt: text, modelSlotKey: templateKeySchema, references: z.array(reference).max(100) });

export const productionTemplateSchema = z.strictObject({
  title: name, description: z.string().max(10000), tags: z.array(z.string().trim().min(1).max(40)).max(20),
  inputs: z.array(variableSchema).max(40),
  mediaInputs: z.array(z.strictObject({ key: templateKeySchema, label: name, description: z.string().max(2000), mediaType, assetKey: templateKeySchema, versionKey: templateKeySchema, required: z.boolean() })).max(32),
  workflow: z.array(z.strictObject({ title: name, description: z.string().max(10000) })).min(1).max(30),
  modelSlots: z.array(z.strictObject({ key: templateKeySchema, label: name, mediaType, purpose: z.string().max(2000), suggestedModelId: z.string().trim().min(1).max(256).optional() })).min(1).max(16),
  example: z.strictObject({
    name, output: z.strictObject({ width: z.number().int().min(64).max(8192), height: z.number().int().min(64).max(8192), frameRate: z.number().int().min(1).max(120) }),
    assets: z.array(z.strictObject({ key: templateKeySchema, name, kind: z.enum(["character", "scene", "prop", "image", "video", "audio", "text"]), versions: z.array(z.strictObject({ key: templateKeySchema, parentKey: templateKeySchema.optional(), text, description: z.string().max(10000) })).min(1).max(16) })).max(64),
    shots: z.array(generationNode.extend({ story: text, dialogue: text, expectedDuration: z.number().finite().positive().max(3600) })).min(1).max(200),
    generationNodes: z.array(generationNode).max(32),
  }),
}).superRefine((value, context) => {
  function issue(message: string, path: (string | number)[]) { context.addIssue({ code: "custom", path, message }); }
  function unique(keys: string[], path: (string | number)[]) { if (new Set(keys).size !== keys.length) issue("名称不能重复", path); }
  unique(value.inputs.map(input => input.key), ["inputs"]); unique(value.mediaInputs.map(input => input.key), ["mediaInputs"]);
  unique(value.modelSlots.map(slot => slot.key), ["modelSlots"]); unique(value.example.assets.map(asset => asset.key), ["example", "assets"]);
  unique([...value.example.shots, ...value.example.generationNodes].map(node => node.key), ["example", "shots"]);
  if (new Set(value.tags.map(tag => tag.toLowerCase())).size !== value.tags.length) issue("标签不能重复", ["tags"]);
  const assets = new Map(value.example.assets.map(asset => [asset.key, asset]));
  function checkReference(item: { assetKey: string; versionKey: string }, path: (string | number)[]) { if (!assets.get(item.assetKey)?.versions.some(version => version.key === item.versionKey)) issue("参考需要对应的素材与版本", path); }
  let versionCount = 0;
  value.example.assets.forEach((asset, index) => {
    versionCount += asset.versions.length; unique(asset.versions.map(version => version.key), ["example", "assets", index, "versions"]);
    for (const version of asset.versions) {
      const visited = new Set<string>([version.key]); let parent = version.parentKey;
      while (parent) { if (visited.has(parent)) { issue("版本父子关系不能循环", ["example", "assets", index]); break; } visited.add(parent); const previous = asset.versions.find(item => item.key === parent); if (!previous) { issue("父版本不属于同一素材", ["example", "assets", index]); break; } parent = previous.parentKey; }
    }
  });
  if (versionCount > 128) issue("单次模板最多包含 128 个参考版本", ["example", "assets"]);
  value.mediaInputs.forEach((input, index) => checkReference(input, ["mediaInputs", index]));
  for (const field of ["shots", "generationNodes"] as const) value.example[field].forEach((node, index) => {
    if (!value.modelSlots.some(slot => slot.key === node.modelSlotKey)) issue("生成节点需要对应的模型位置", ["example", field, index, "modelSlotKey"]);
    node.references.forEach((item, refIndex) => checkReference(item, ["example", field, index, "references", refIndex]));
  });
  if (value.modelSlots.some(slot => ![...value.example.shots, ...value.example.generationNodes].some(node => node.modelSlotKey === slot.key))) issue("每个模型位置至少需要用于一个镜头或辅助生成节点", ["modelSlots"]);
});
export type ProductionTemplate = z.infer<typeof productionTemplateSchema>;

export function templateTextFields(value: ProductionTemplate) {
  return [value.title, value.description, value.example.name, ...value.workflow.flatMap(step => [step.title, step.description]), ...value.example.assets.flatMap(asset => [asset.name, ...asset.versions.flatMap(version => [version.text, version.description])]), ...value.example.shots.flatMap(shot => [shot.title, shot.prompt, shot.story, shot.dialogue]), ...value.example.generationNodes.flatMap(node => [node.title, node.prompt])];
}

export function renderProductionTemplate(value: ProductionTemplate, supplied: Record<string, string>) {
  const definition = productionTemplateSchema.parse(value);
  if (Object.keys(supplied).some(key => !definition.inputs.some(input => input.key === key)) || Object.values(supplied).some(value => typeof value !== "string" || value.length > 10000)) throw new Error("模板填值包含未声明的输入或超过长度限制");
  const values = Object.fromEntries(definition.inputs.map(input => [input.key, Object.hasOwn(supplied, input.key) ? supplied[input.key]! : input.defaultValue]));
  const missing = definition.inputs.filter(input => input.required && !values[input.key]?.trim()).map(input => input.label);
  if (missing.length) throw new Error(`请填写模板必填内容：${missing.join("、")}`);
  const declared = new Set(definition.inputs.map(input => input.key));
  const unmatched = [...new Set(templateTextFields(definition).flatMap(promptVariableNames).filter(key => !declared.has(key)))];
  function fill(text: string) {
    const result = text.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9]{0,63})\s*\}\}/g, (match, key: string) => Object.hasOwn(values, key) ? values[key]! : match);
    if (result.length > 100000) throw new Error("填值后的单项内容超过 10 万字符，请缩短输入");
    return result;
  }
  const rendered = productionTemplateSchema.parse({ ...definition, title: fill(definition.title), description: fill(definition.description), workflow: definition.workflow.map(step => ({ title: fill(step.title), description: fill(step.description) })), example: {
    ...definition.example, name: fill(definition.example.name), assets: definition.example.assets.map(asset => ({ ...asset, name: fill(asset.name), versions: asset.versions.map(version => ({ ...version, text: fill(version.text), description: fill(version.description) })) })),
    shots: definition.example.shots.map(shot => ({ ...shot, title: fill(shot.title), prompt: fill(shot.prompt), story: fill(shot.story), dialogue: fill(shot.dialogue) })), generationNodes: definition.example.generationNodes.map(node => ({ ...node, title: fill(node.title), prompt: fill(node.prompt) })),
  } });
  if (JSON.stringify(rendered).length > 1500000) throw new Error("填充后的模板内容过大，请缩短或拆分模板");
  return { rendered, values, unmatched };
}

export const templateMappingSchema = z.union([
  z.strictObject({ slotKey: templateKeySchema, deferred: z.literal(true) }),
  z.strictObject({ slotKey: templateKeySchema, deferred: z.literal(false), providerId: z.string().regex(/^[a-z][a-zA-Z0-9]{0,95}$/), modelId: z.string().trim().min(1).max(256) }),
]);
export const templateMediaMimeTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogv: "video/ogg", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", aac: "audio/aac", m4a: "audio/mp4", opus: "audio/opus" };
export const templateBindingSchema = z.strictObject({ key: templateKeySchema, path: z.string().min(1).max(2048).refine(path => !/^[\\/]|[:\u0000-\u001f]/.test(path) && path.split(/[\\/]/).every(part => part && part !== "." && part !== ".."), "请选择项目内的相对文件路径"), mimeType: z.string().min(1).max(100) });
export const templateApplicationInputSchema = z.strictObject({ applicationId: z.uuid(), createdAt: z.number().finite().nonnegative(), definition: productionTemplateSchema, values: z.record(z.string().max(64), z.string().max(10000)).refine(value => Object.keys(value).length <= 40), mappings: z.array(templateMappingSchema).max(16), mediaBindings: z.array(templateBindingSchema).max(32) });
export type TemplateApplicationInput = z.infer<typeof templateApplicationInputSchema>;
export const applyTemplateOperationSchema = templateApplicationInputSchema.extend({ type: z.literal("applyTemplate"), previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/) });
export type ApplyTemplateOperation = z.infer<typeof applyTemplateOperationSchema>;
export const templateApplicationRecordSchema = z.strictObject({ applicationId: z.uuid(), inputHash: z.string().regex(/^[a-f0-9]{64}$/), previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/), title: name, createdAt: z.number().finite().nonnegative(), sequenceId: z.uuid(), canvasId: z.string().min(1).max(2048), versionIds: z.array(z.uuid()).max(128), mappings: z.array(templateMappingSchema).max(16) });

export const productionTemplateExportSchema = z.strictObject({ zeromuProductionTemplate: z.literal(true), format: z.literal(1), template: productionTemplateSchema });
export function exportProductionTemplate(value: ProductionTemplate, options = { includeDefaults: false, includeExampleContent: false, includeModelHints: false }) {
  const template = productionTemplateSchema.parse(value);
  if (!options.includeDefaults) template.inputs = template.inputs.map(input => ({ ...input, defaultValue: "" }));
  if (!options.includeModelHints) template.modelSlots = template.modelSlots.map(({ suggestedModelId: _suggested, ...slot }) => slot);
  if (!options.includeExampleContent) {
    const summary = template.inputs.map(input => `${input.label}：{{${input.key}}}`).join("\n");
    template.example.name = "模板制作单元";
    template.example.assets = template.example.assets.map((asset, index) => ({ ...asset, name: `参考素材${index + 1}`, versions: asset.versions.map((version, versionIndex) => ({ ...version, text: "", description: `参考版本${versionIndex + 1}` })) }));
    template.mediaInputs = template.mediaInputs.map((input, index) => ({ ...input, label: `参考文件${index + 1}`, description: "请选择目标项目中的参考文件" }));
    template.example.shots = template.example.shots.map((shot, index) => ({ ...shot, title: `镜头${index + 1}`, story: "待填写本镜头剧情", dialogue: "", prompt: `${summary}${summary ? "\n" : ""}根据已确认的资料完成镜头${index + 1}。`, references: shot.references.map(reference => ({ ...reference, role: "参考" })) }));
    template.example.generationNodes = template.example.generationNodes.map((node, index) => ({ ...node, title: `辅助创作${index + 1}`, prompt: summary || "请填写本次创作内容", references: node.references.map(reference => ({ ...reference, role: "参考" })) }));
  }
  return productionTemplateExportSchema.parse({ zeromuProductionTemplate: true, format: 1, template });
}

const templateEntrySchema = z.strictObject({ id: z.uuid(), definition: productionTemplateSchema, createdAt: z.number().finite().nonnegative(), updatedAt: z.number().finite().nonnegative(), archivedAt: z.number().finite().nonnegative().optional() });
// 仅清理已移除范例的收藏，不改写用户自己创建的制作模板。
export const productionTemplateLibrarySchema = z.strictObject({ zeromuProductionTemplateLibrary: z.literal(true), format: z.literal(1), revision: z.number().int().nonnegative().safe(), entries: z.array(templateEntrySchema).max(500), favorites: z.array(z.string().min(1).max(100)).max(510).transform(ids => ids.filter(id => !["builtinDialogue", "builtinProductAd", "builtinShortComic"].includes(id))) }).superRefine((value, context) => { if (new Set(value.entries.map(entry => entry.id)).size !== value.entries.length || new Set(value.favorites).size !== value.favorites.length) context.addIssue({ code: "custom", message: "模板或收藏编号重复" }); });
export type ProductionTemplateLibrary = z.infer<typeof productionTemplateLibrarySchema>;
export type ProductionTemplateEntry = { id: string; definition: ProductionTemplate; origin: "builtin" | "personal"; favorite: boolean; archived: boolean };
export type ProductionTemplateLibraryView = { revision: number; entries: ProductionTemplateEntry[] };
export const productionTemplateMutationSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("create"), definition: productionTemplateSchema }), z.strictObject({ type: z.literal("update"), id: z.uuid(), definition: productionTemplateSchema }), z.strictObject({ type: z.literal("archive"), id: z.uuid(), value: z.boolean() }), z.strictObject({ type: z.literal("favorite"), id: z.string().min(1).max(100), value: z.boolean() }),
]);
export type ProductionTemplateMutation = z.infer<typeof productionTemplateMutationSchema>;
export { builtinProductionTemplates } from "./catalog";
export type TemplatePreview = {
  definition: ProductionTemplate;
  inputHash: string; previewFingerprint: string; title: string; canvasId: string;
  counts: { shots: number; assets: number; versions: number; generationNodes: number; referenceNodes: number };
  mappings: { slotKey: string; label: string; mediaType: "image" | "video" | "audio"; selection: string; providerRevision?: string }[];
  media: { key: string; path: string; mimeType: string; hash: string; bytes: number; stagedPath: string }[];
  warnings: string[]; resuming: boolean;
};
