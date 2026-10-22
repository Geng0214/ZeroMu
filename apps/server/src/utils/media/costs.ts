import { mkdir, readFile, withFileAccess, writeAtomic } from "@toonflow/file";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { MediaBudget, MediaCostPolicy, MediaCostQuote, MediaCostSummary, MediaMoney, MediaPriceRule, MediaTaskCost } from "@toonflow/providers/mediaCosts";
import type { MediaGenerationRequest, MediaTaskRecord } from "@toonflow/tools-scaffold/runtime";
import conf from "@/utils/conf";
import { decimalSchema, policySchema } from "./costSchema";
export { moneySchema, priceRuleSchema, budgetSchema, policySchema, quoteSchema, usageSchema, taskCostSchema } from "./costSchema";

const policyPath = () => join(dirname(conf.path), "mediaCosts.json");
export const costAdmissionPath = () => `${policyPath()}.admission`;
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest("hex");
function fail(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }
export function moneyUnits(value: string) { if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) fail("金额格式无效", 400); const [integer, fraction = ""] = value.split("."); return BigInt(integer!) * 1_000_000n + BigInt(fraction.padEnd(6, "0")); }
export function moneyText(value: bigint) { const sign = value < 0n ? "-" : ""; const amount = value < 0n ? -value : value; const fraction = String(amount % 1_000_000n).padStart(6, "0").replace(/0+$/, ""); return `${sign}${amount / 1_000_000n}${fraction ? `.${fraction}` : ""}`; }

export async function readCostPolicy(): Promise<MediaCostPolicy> {
  try { return policySchema.parse(JSON.parse(await readFile(policyPath(), "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, revision: 0, prices: [], budgets: [] }; throw error; }
}
export async function saveCostPolicy(value: unknown) {
  const next = policySchema.parse(value);
  return withFileAccess([costAdmissionPath()], "write", async () => {
    const prior = await readCostPolicy();
    if (next.revision !== prior.revision) fail("费用配置已被修改，请刷新后重试");
    if (next.budgets.some(budget => budget.startsAt > Date.now())) fail("预算周期不能从未来开始", 400);
    const prices = next.prices.map(rule => { const old = prior.prices.find(item => item.id === rule.id); return { ...rule, updatedAt: old && fingerprint({ ...old, updatedAt: 0 }) === fingerprint({ ...rule, updatedAt: 0 }) ? old.updatedAt : Date.now() }; });
    const policy = { ...next, prices, revision: prior.revision + 1 };
    await mkdir(dirname(policyPath()), { recursive: true });
    await writeAtomic(policyPath(), JSON.stringify(policy, null, 2), { mode: 0o600 });
    return policy;
  });
}

export function quoteMediaCost(policy: MediaCostPolicy, mediaType: MediaPriceRule["mediaType"], request: MediaGenerationRequest): MediaCostQuote {
  const fields = { ...request, mode: Array.isArray(request.mode) ? request.mode.join(",") : request.mode, imageReferences: (request.images?.length ?? 0) + Number(!!request.firstFrame) + Number(!!request.lastFrame), videoReferences: request.videos?.length ?? 0, audioReferences: request.audios?.length ?? 0 };
  const matches = policy.prices.filter(rule => rule.providerId === request.providerId && rule.modelId === request.modelId && rule.mediaType === mediaType && Object.entries(rule.conditions ?? {}).every(([key, value]) => fields[key as keyof typeof fields] === value));
  const specificity = Math.max(-1, ...matches.map(rule => Object.keys(rule.conditions ?? {}).length));
  const selected = matches.filter(rule => Object.keys(rule.conditions ?? {}).length === specificity);
  if (selected.length !== 1) return { kind: "unknown", reason: selected.length ? "有多条同等适用的单价，请核对计费范围" : "尚无适用于当前模型和参数的单价" };
  const rate = selected[0]!;
  let units = 1_000_000n;
  if (rate.unit === "image") units = BigInt(request.n ?? 1) * 1_000_000n;
  if (rate.unit === "second") {
    if (!request.duration || !decimalSchema.safeParse(String(request.duration)).success) return { kind: "unknown", reason: "未确定视频时长，不能按秒估算" };
    units = moneyUnits(String(request.duration));
  }
  if (rate.unit === "thousandCharacters") units = BigInt([...request.prompt].length) * 1000n;
  const amount = moneyText((moneyUnits(rate.unitPrice) * units + 999_999n) / 1_000_000n);
  if (!decimalSchema.safeParse(amount).success) return { kind: "unknown", reason: "本次估算金额超出支持范围" };
  return { kind: "estimated", money: { currency: rate.currency, amount }, quantity: moneyText(units), rate: structuredClone(rate), priceFingerprint: fingerprint(rate) };
}
export function newTaskCost(quote: MediaCostQuote): MediaTaskCost { return { quote: structuredClone(quote), revision: 0, reports: [] }; }
export function assertCurrentQuote(quote: MediaCostQuote, current: MediaCostQuote) {
  if (quote.kind === "unknown" && current.kind === "unknown") return;
  if (fingerprint(quote) !== fingerprint(current)) fail("单价或计费范围已变化，请核对费用后重新提交；不会自动发起生成");
}

function actualAmounts(cost: MediaTaskCost | undefined) {
  if (cost?.statement) return { amounts: [cost.statement as MediaMoney], complete: true };
  const amounts = cost?.reports.flatMap(report => report.charge ? [report.charge] : []) ?? [];
  return { amounts, complete: amounts.length > 0 && !!cost?.reports.some(report => report.complete) };
}
export function summarizeMediaCosts(tasks: Pick<MediaTaskRecord, "id" | "archived" | "cost" | "status" | "phase" | "createdAt">[], budget?: MediaBudget): MediaCostSummary {
  const totals = new Map<string, { actual: bigint; estimated: bigint; reserved: bigint; exposure: bigint }>();
  const row = (currency: string) => { let value = totals.get(currency); if (!value) { value = { actual: 0n, estimated: 0n, reserved: 0n, exposure: 0n }; totals.set(currency, value); } return value; };
  let unknownCount = 0; let unsubmittedCount = 0;
  for (const task of tasks) {
    if (task.archived || budget && task.createdAt < budget.startsAt) continue;
    const submitted = task.cost ? !!task.cost.submittedAt : task.phase !== "validation";
    const actual = actualAmounts(task.cost);
    if (!submitted && ["failed", "cancelled"].includes(task.status) && !actual.amounts.length) continue;
    const amounts = new Map<string, bigint>();
    for (const money of actual.amounts) { const units = moneyUnits(money.amount); row(money.currency).actual += units; amounts.set(money.currency, (amounts.get(money.currency) ?? 0n) + units); }
    if (!submitted) unsubmittedCount++;
    const quote = task.cost?.quote;
    let unknownCost = false;
    if (!actual.complete) {
      if (quote?.kind === "estimated") {
        const amount = moneyUnits(quote.money.amount); const total = row(quote.money.currency);
        if (submitted) total.estimated += amount; else total.reserved += amount;
        const observed = amounts.get(quote.money.currency) ?? 0n;
        amounts.set(quote.money.currency, amount > observed ? amount : observed);
      } else unknownCost = true;
    }
    for (const [currency, amount] of amounts) row(currency).exposure += amount;
    if (budget && [...amounts.keys()].some(currency => currency !== budget.currency)) unknownCost = true;
    if (unknownCost) unknownCount++;
  }
  const exposure = totals.get(budget?.currency ?? "")?.exposure ?? 0n;
  return { currencies: [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, values]) => ({ currency, actual: moneyText(values.actual), estimated: moneyText(values.estimated), reserved: moneyText(values.reserved), exposure: moneyText(values.exposure) })), unknownCount, unsubmittedCount,
    ...(budget ? { budget: { ...budget, exposure: moneyText(exposure), remaining: moneyText(moneyUnits(budget.limit) - exposure), unknownCount } } : {}) };
}
export function assertMediaBudget(policy: MediaCostPolicy, directory: string, tasks: Parameters<typeof summarizeMediaCosts>[0], pending: Parameters<typeof summarizeMediaCosts>[0] = [], warnings: string[] = []) {
  const budget = policy.budgets.find(item => item.directory === directory);
  if (!budget) return;
  if (budget.startsAt > Date.now()) fail("预算周期尚未开始，请核对周期和系统时间后再提交");
  if (warnings.length) fail("存在损坏的任务记录，无法核对预算占用；请先备份并修复记录");
  const summary = summarizeMediaCosts([...tasks, ...pending], budget);
  if (summary.unknownCount) fail("本预算周期有费用未知或币种不匹配的任务，请维护单价或核对账单后再新增提交");
  if (moneyUnits(summary.budget!.exposure) > moneyUnits(budget.limit)) fail(`本次提交会超过 ${budget.currency} ${budget.limit} 的项目预算；已提交任务仍可查询和取回结果`);
}
