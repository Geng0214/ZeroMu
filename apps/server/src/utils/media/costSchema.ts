import { z } from "zod";

export const decimalSchema = z.string().regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/, "金额须为非负十进制数，最多六位小数");
const currency = z.string().regex(/^[A-Z]{3}$/, "币种须为三个大写英文字母");
export const moneySchema = z.strictObject({ currency, amount: decimalSchema });
export const priceRuleSchema = z.strictObject({
  id: z.uuid(), providerId: z.string().min(1).max(200), modelId: z.string().min(1).max(200), mediaType: z.enum(["image", "video", "audio"]),
  currency, unit: z.enum(["request", "image", "second", "thousandCharacters"]), unitPrice: decimalSchema,
  source: z.string().trim().min(1).max(1000), updatedAt: z.number().finite().nonnegative(),
  conditions: z.strictObject({
    size: z.string().max(100).optional(), ratio: z.string().max(100).optional(), quality: z.string().max(100).optional(), resolution: z.string().max(100).optional(),
    duration: z.number().positive().finite().optional(), generateAudio: z.boolean().optional(), mode: z.string().max(200).optional(),
    imageReferences: z.number().int().nonnegative().max(100).optional(), videoReferences: z.number().int().nonnegative().max(100).optional(), audioReferences: z.number().int().nonnegative().max(100).optional(),
    voice: z.string().max(200).optional(), format: z.string().max(100).optional(), speed: z.number().positive().finite().optional(), sampleRate: z.number().positive().finite().optional(), volume: z.number().nonnegative().finite().optional(), n: z.number().int().positive().max(100).optional(),
  }).optional(),
}).superRefine((rule, context) => {
  if (rule.unit === "image" && rule.mediaType !== "image" || rule.unit === "second" && rule.mediaType !== "video" || rule.unit === "thousandCharacters" && rule.mediaType !== "audio") context.addIssue({ code: "custom", message: "计费单位与媒体类型不匹配" });
});
export const budgetSchema = z.strictObject({ directory: z.string().min(1).max(4096), currency, limit: decimalSchema, startsAt: z.number().finite().nonnegative() });
export const policySchema = z.strictObject({ schemaVersion: z.literal(1), revision: z.number().int().nonnegative(), prices: z.array(priceRuleSchema).max(2000), budgets: z.array(budgetSchema).max(2000) }).superRefine((policy, context) => {
  if (new Set(policy.prices.map(rule => rule.id)).size !== policy.prices.length) context.addIssue({ code: "custom", message: "单价编号重复" });
  if (new Set(policy.budgets.map(budget => budget.directory)).size !== policy.budgets.length) context.addIssue({ code: "custom", message: "同一工作空间只能有一个预算" });
});
export const quoteSchema = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("unknown"), reason: z.string().max(1000) }), z.strictObject({
  kind: z.literal("estimated"), money: moneySchema, quantity: decimalSchema, rate: priceRuleSchema, priceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})]);
export const usageSchema = z.strictObject({ key: z.string().min(1).max(200), values: z.record(z.string().min(1).max(100), z.number().finite().nonnegative()).refine(value => Object.keys(value).length <= 64).optional(), charge: moneySchema.optional(), complete: z.boolean().optional() });
export const taskCostSchema = z.strictObject({ quote: quoteSchema, revision: z.number().int().nonnegative(), submittedAt: z.number().finite().nonnegative().optional(),
  reports: z.array(usageSchema.extend({ reportedAt: z.number().finite().nonnegative() })).max(100),
  statement: moneySchema.extend({ note: z.string().trim().min(1).max(1000), recordedAt: z.number().finite().nonnegative() }).optional(),
  statementHistory: z.array(moneySchema.extend({ note: z.string().trim().min(1).max(1000), recordedAt: z.number().finite().nonnegative() })).max(100).optional(),
});
