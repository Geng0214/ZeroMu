import { z } from "zod";
import { planningPrompts, creationPrompts } from "./catalog";

export { planningPrompts, creationPrompts } from "./catalog";

const variableKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,63}$/, "变量名须以英文字母开头，只含字母和数字，最多 64 字符");
export const variableSchema = z.strictObject({ key: variableKey, label: z.string().trim().min(1).max(100), defaultValue: z.string().max(10000), required: z.boolean() });
const promptFieldsSchema = z.strictObject({
  title: z.string().trim().min(1, "请填写提示词标题").max(200),
  mode: z.enum(["image", "video", "audio", "home"]),
  kind: z.string().trim().min(1, "请填写分类名称").max(80),
  text: z.string().trim().min(1, "请填写提示词内容").max(100000),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  variables: z.array(variableSchema).max(40),
});

export function promptVariableNames(text: string) {
  return [...new Set([...text.matchAll(/\{\{([^{}]*)\}\}/g)].map(match => match[1]!.trim()).filter(key => variableKey.safeParse(key).success))];
}

export const promptDefinitionSchema = promptFieldsSchema.superRefine((value, context) => {
  const names = promptVariableNames(value.text);
  const remainder = value.text.replace(/\{\{([^{}]*)\}\}/g, (_match, key: string) => variableKey.safeParse(key.trim()).success ? "" : "{{invalid}}");
  if (remainder.includes("{{") || remainder.includes("}}")) context.addIssue({ code: "custom", path: ["text"], message: "变量请使用 {{product}} 格式，名称只含字母和数字" });
  if (new Set(value.variables.map(variable => variable.key)).size !== value.variables.length) context.addIssue({ code: "custom", path: ["variables"], message: "变量名称不能重复" });
  if (names.length !== value.variables.length || names.some(key => !value.variables.some(variable => variable.key === key))) context.addIssue({ code: "custom", path: ["variables"], message: "变量说明必须与提示词中的变量一致" });
  if (new Set(value.tags.map(tag => tag.toLocaleLowerCase())).size !== value.tags.length) context.addIssue({ code: "custom", path: ["tags"], message: "标签不能重复" });
});
export type PromptDefinition = z.infer<typeof promptDefinitionSchema>;

const labels = { image: "生图创作", video: "视频创作", audio: "音频创作", home: "故事构思" };
export const builtinPrompts: { id: string; definition: PromptDefinition }[] = [
  ...creationPrompts.map(item => ({ id: item.id, definition: { title: item.title, mode: item.mode, kind: labels[item.mode], text: item.text, tags: [], variables: [] } })),
  ...planningPrompts.map(item => ({ id: item.id, definition: { title: item.title, mode: "home" as const, kind: item.kind, text: item.text, tags: [], variables: [] } })),
];

export function fillPrompt(definition: PromptDefinition, values: Record<string, string>) {
  const prompt = promptDefinitionSchema.parse(definition);
  if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).some(key => !prompt.variables.some(variable => variable.key === key)) || Object.values(values).some(value => typeof value !== "string" || value.length > 10000)) throw new Error("变量值无效或包含未声明的变量");
  const variables = new Map(prompt.variables.map(variable => [variable.key, variable]));
  const missing = prompt.variables.filter(variable => variable.required && !(Object.hasOwn(values, variable.key) ? values[variable.key] : variable.defaultValue)?.trim()).map(variable => variable.key);
  const text = prompt.text.replace(/\{\{([^{}]*)\}\}/g, (match, key: string) => {
    const variable = variables.get(key.trim())!;
    if (missing.includes(variable.key)) return match;
    return Object.hasOwn(values, variable.key) ? values[variable.key]! : variable.defaultValue;
  });
  if (text.length > 300000) throw new Error("填充后的提示词超过 30 万字符，请缩短变量内容");
  return { text, missing };
}

const promptRecordSchema = z.strictObject({ id: z.uuid(), definition: promptDefinitionSchema, createdAt: z.number().finite().nonnegative(), updatedAt: z.number().finite().nonnegative(), archivedAt: z.number().finite().nonnegative().optional() });
// 兼容旧版对内置示例的收藏；个人记录及其收藏不受影响。
export const promptLibrarySchema = z.strictObject({ zeromuPromptLibrary: z.literal(true), format: z.literal(1), revision: z.number().int().nonnegative().safe(), entries: z.array(promptRecordSchema).max(2000), favorites: z.array(z.string().min(1).max(100)).max(2100).transform(ids => ids.filter(id => !/^builtin(?:Creation|Planning)[0-5]$/.test(id))) }).superRefine((value, context) => {
  const ids = new Set(value.entries.map(entry => entry.id));
  if (ids.size !== value.entries.length) context.addIssue({ code: "custom", message: "提示词编号重复" });
  if (new Set(value.favorites).size !== value.favorites.length || value.favorites.some(id => !ids.has(id) && !builtinPrompts.some(entry => entry.id === id))) context.addIssue({ code: "custom", message: "收藏引用无效" });
});
export type PromptLibrary = z.infer<typeof promptLibrarySchema>;
export type PromptLibraryEntry = { id: string; definition: PromptDefinition; origin: "builtin" | "personal"; favorite: boolean; archived: boolean; updatedAt?: number };
export type PromptLibraryView = { revision: number; entries: PromptLibraryEntry[] };
export const promptMutationSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("create"), definition: promptDefinitionSchema }),
  z.strictObject({ type: z.literal("update"), id: z.uuid(), definition: promptDefinitionSchema }),
  z.strictObject({ type: z.literal("favorite"), id: z.string().min(1).max(100), value: z.boolean() }),
  z.strictObject({ type: z.literal("archive"), id: z.uuid(), value: z.boolean() }),
]);
export type PromptMutation = z.infer<typeof promptMutationSchema>;
export const promptExportSchema = z.strictObject({ zeromuPrompt: z.literal(true), format: z.literal(1), prompt: promptDefinitionSchema });

export function exportPrompt(definition: PromptDefinition, includeDefaults = false) {
  const prompt = promptDefinitionSchema.parse(definition);
  return promptExportSchema.parse({ zeromuPrompt: true, format: 1, prompt: { ...prompt, variables: prompt.variables.map(variable => ({ ...variable, defaultValue: includeDefaults ? variable.defaultValue : "" })) } });
}
