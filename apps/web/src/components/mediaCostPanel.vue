<template>
  <section class="mediaCostPanel" aria-label="费用与预算">
    <header><h3>费用与预算</h3><el-button id="costRefreshButton" size="small" :loading="loading" :disabled="saving" @click="load">刷新</el-button></header>
    <p class="costHint">按币种分别记录，估算以维护的单价为依据。预算控制新增提交；已提交请求及最终账单仍由渠道处理。</p>
    <div v-if="error" ref="errorBox" role="alert" tabindex="-1" class="costError"><p>{{ error }}</p><a :href="`#${errorTarget}`" @click.prevent="focusErrorTarget">{{ errorTarget === 'costRefreshButton' ? '刷新费用配置' : '返回输入位置' }}</a></div>
    <p v-for="warning in warnings" :key="warning" class="costError" role="alert">{{ warning }}</p>
    <template v-if="summary">
      <div class="costTable"><table><caption>{{ summary.budget ? '本预算周期的本机任务' : '当前项目的本机任务' }}</caption><thead><tr><th>币种</th><th>已登记实际</th><th>未结算预估</th><th>排队预留</th><th>预算占用</th></tr></thead><tbody><tr v-for="row in summary.currencies" :key="row.currency"><th>{{ row.currency }}</th><td>{{ row.actual }}</td><td>{{ row.estimated }}</td><td>{{ row.reserved }}</td><td>{{ row.exposure }}</td></tr></tbody></table></div>
      <p class="costHint">{{ summary.unknownCount }} 项未定价或币种待核对 · {{ summary.unsubmittedCount }} 项尚未提交。未完整结算的回执与预估可能重叠，占用按同币种较高金额计算；迁移历史不计入本机预算。</p>
      <p v-if="summary.budget" class="budgetBalance" :class="{ costError: summary.budget.remaining.startsWith('-') }">预算 {{ summary.budget.currency }} {{ summary.budget.limit }} · 剩余 {{ summary.budget.remaining }}<span v-if="summary.budget.unknownCount"> · 存在未定价或币种待核对任务，暂停新增提交</span></p>
    </template>
    <details class="costSection"><summary>项目预算</summary>
      <form @submit.prevent="saveBudget" @input="budgetDirty = true">
        <fieldset :disabled="saving" class="costFormFields">
        <label class="checkField"><input v-model="budget.enabled" type="checkbox" :disabled="!directory || saving" />启用当前项目预算</label>
        <div v-if="budget.enabled" class="costFields">
          <label>币种<input v-model="budget.currency" required pattern="[A-Z]{3}" maxlength="3" aria-label="预算币种" /></label>
          <label>上限<input id="costBudgetLimit" v-model="budget.limit" inputmode="decimal" required :pattern="decimalPattern" aria-label="预算上限" /></label>
          <label class="wideField">周期开始<input type="datetime-local" step="1" :value="localDate(budget.startsAt)" required aria-label="预算周期开始" @change="budget.startsAt = new Date(($event.target as HTMLInputElement).value).getTime()" /></label>
        </div>
        <p class="costHint">费用未知、币种不匹配或占用将超限时，不提交新生成。更改周期开始会改变计入范围，历史记录保留。供应商实际费用可能高于预估。</p>
        <el-button nativeType="submit" size="small" :disabled="!directory" :loading="saving">保存项目预算</el-button>
        </fieldset>
      </form>
    </details>
    <details class="costSection"><summary>维护模型单价</summary>
      <p class="costHint">单价由你根据公开报价或账单维护；未配置表示未知。修改单价不改变旧任务依据，尚未提交的旧范围须重新确认。</p>
      <form @submit.prevent="savePrice">
        <fieldset :disabled="saving" class="costFormFields">
        <div class="costFields">
          <label class="wideField">渠道与模型<select v-model="price.modelKey" :disabled="!!price.id" required aria-label="单价模型"><option value="">选择模型</option><option v-for="model in priceModels" :key="model.key" :value="model.key">{{ model.label }}</option></select></label>
          <label>币种<input v-model="price.currency" required pattern="[A-Z]{3}" maxlength="3" aria-label="单价币种" /></label>
          <label>计费单位<select v-model="price.unit" aria-label="计费单位"><option value="request">每项任务（整个范围）</option><option v-if="chosenModel?.type === 'image'" value="image">每张图片</option><option v-if="chosenModel?.type === 'video'" value="second">每秒视频</option><option v-if="chosenModel?.type === 'audio'" value="thousandCharacters">每千字符</option></select></label>
          <label>单价<input id="costPriceAmount" v-model="price.unitPrice" inputmode="decimal" required :pattern="decimalPattern" aria-label="模型单价" /></label>
          <label class="wideField">单价来源<input v-model="price.source" required maxlength="1000" aria-label="单价来源" placeholder="报价页或账单说明" /></label>
        </div>
        <details class="priceConditions"><summary>适用参数</summary><label>匹配条件（JSON）<textarea id="costPriceConditions" v-model="price.conditions" rows="4" spellcheck="false" aria-label="单价匹配条件" @blur="checkConditions" /></label><p class="conditionFeedback costError" aria-live="polite">{{ conditionError || ' ' }}</p><p class="costHint">空对象适用于该模型全部参数。可按 size、resolution、duration、quality、voice、mode、参考数量等限定；例如 {"resolution":"720p"}。每千字符仅为字符估算，不替代厂商实际用量。</p></details>
        <div class="costActions"><el-button nativeType="submit" size="small" :loading="saving">{{ price.id ? '保存单价修改' : '新增单价' }}</el-button><el-button v-if="price.id" size="small" :disabled="saving" @click="clearPrice">取消编辑</el-button></div>
        </fieldset>
      </form>
      <ul class="priceList"><li v-for="rule in visiblePrices" :key="rule.id"><p>{{ rule.currency }} {{ rule.unitPrice }} / {{ unitLabels[rule.unit] }}<span> · {{ new Date(rule.updatedAt).toLocaleString() }}</span></p><p class="costHint">{{ rule.source }} · {{ JSON.stringify(rule.conditions || {}) }}</p><el-button size="small" text :disabled="saving" @click="editPrice(rule)">编辑</el-button><el-button size="small" text :disabled="saving" @click="removePrice(rule.id)">移除单价</el-button></li></ul>
    </details>
    <p v-if="saved" class="costHint" role="status">{{ saved }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onScopeDispose, reactive, ref, watch } from "vue";
import axios from "axios";
import type { MediaBudget, MediaCostPolicy, MediaCostSummary, MediaPriceRule } from "@toonflow/providers/mediaCosts";
import type { MediaModel } from "@toonflow/tools-scaffold/runtime";

const props = defineProps<{ directory: string; active: boolean }>();
const policy = ref<MediaCostPolicy>({ schemaVersion: 1, revision: 0, prices: [], budgets: [] });
const models = ref<MediaModel[]>([]);
const summary = ref<MediaCostSummary>();
const warnings = ref<string[]>([]);
const error = ref(""); const saved = ref(""); const errorTarget = ref("costRefreshButton");
const errorBox = ref<HTMLElement>(); const loading = ref(false); const saving = ref(false);
const budgetDirty = ref(false);
const budget = reactive({ enabled: false, currency: "CNY", limit: "", startsAt: Date.now() });
const budgetDrafts = new Map<string, typeof budget & { dirty: boolean }>();
const price = reactive({ id: "", modelKey: "", currency: "CNY", unit: "request" as MediaPriceRule["unit"], unitPrice: "", source: "", conditions: "{}" });
const conditionError = ref("");
const decimalPattern = "(?:0|[1-9][0-9]{0,8})(?:\\.[0-9]{1,6})?";
const unitLabels = { request: "项任务", image: "张图片", second: "秒视频", thousandCharacters: "千字符" };
const headers = { "x-toonflow-workspace": "1" };
let reader: AbortController | undefined;
const keyFor = (value: { providerId: string; modelId: string; type: string }) => JSON.stringify([value.providerId, value.modelId, value.type]);
const priceModels = computed(() => {
  const entries = models.value.map(model => ({ key: keyFor(model), label: `${model.providerLabel} / ${model.label}`, providerId: model.providerId, modelId: model.modelId, type: model.type }));
  for (const rule of policy.value.prices) { const key = keyFor({ ...rule, type: rule.mediaType }); if (!entries.some(item => item.key === key)) entries.push({ key, label: `${rule.providerId} / ${rule.modelId}（已有单价）`, providerId: rule.providerId, modelId: rule.modelId, type: rule.mediaType }); }
  return entries;
});
const chosenModel = computed(() => priceModels.value.find(model => model.key === price.modelKey));
const visiblePrices = computed(() => policy.value.prices.filter(rule => keyFor({ ...rule, type: rule.mediaType }) === price.modelKey));
function localDate(timestamp: number) { const date = new Date(timestamp); return Number.isFinite(timestamp) ? new Date(timestamp - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19) : ""; }
function message(cause: unknown) { return axios.isAxiosError<{ message?: string }>(cause) ? cause.response?.data?.message || cause.message : cause instanceof Error ? cause.message : "费用配置保存失败"; }
async function showError(cause: unknown, target = "costRefreshButton") { error.value = message(cause); errorTarget.value = target; await nextTick(); errorBox.value?.focus(); }
function focusErrorTarget() { const target = document.getElementById(errorTarget.value); const details = target?.closest("details"); if (details) details.open = true; target?.focus(); }
async function load() {
  reader?.abort(); if (!props.active) return;
  const current = reader = new AbortController(); const directory = props.directory; loading.value = true; error.value = "";
  try {
    const [book, available, costs] = await Promise.all([axios.get<{ data: MediaCostPolicy }>("/api/ai/media/costs/policy", { headers, signal: current.signal }), axios.get<{ data: MediaModel[] }>("/api/ai/media/models", { headers, signal: current.signal }), directory ? axios.get<{ data: { summary: MediaCostSummary; warnings: string[] } }>("/api/ai/media/costs/summary", { params: { directory }, headers, signal: current.signal }) : undefined]);
    if (current.signal.aborted || props.directory !== directory) return;
    policy.value = book.data.data; models.value = available.data.data; summary.value = costs?.data.data.summary; warnings.value = costs?.data.data.warnings ?? [];
    if (!price.modelKey) price.modelKey = priceModels.value[0]?.key ?? "";
    if (!budgetDirty.value) { const stored = policy.value.budgets.find(item => item.directory === directory); Object.assign(budget, { enabled: !!stored, currency: stored?.currency ?? "CNY", limit: stored?.limit ?? "", startsAt: stored?.startsAt ?? Date.now() }); }
  } catch (cause) { if (!current.signal.aborted) await showError(cause); }
  finally { if (reader === current) loading.value = false; }
}
async function persist(next: MediaCostPolicy, success: string) {
  const { data } = await axios.put<{ data: MediaCostPolicy }>("/api/ai/media/costs/save", next, { headers });
  policy.value = data.data; saved.value = success;
}
async function saveBudget() {
  const directory = props.directory; if (!directory || saving.value) return;
  const draft = { ...budget };
  saving.value = true; error.value = ""; saved.value = "";
  try {
    const budgets = policy.value.budgets.filter(item => item.directory !== directory);
    if (draft.enabled) budgets.push({ directory, currency: draft.currency, limit: draft.limit, startsAt: draft.startsAt } satisfies MediaBudget);
    await persist({ ...policy.value, budgets }, "项目预算已保存");
    if (props.directory === directory) { budgetDirty.value = false; await load(); }
    else { budgetDrafts.set(directory, { ...draft, dirty: false }); saved.value = "刚才项目的预算已保存"; }
  } catch (cause) { await showError(cause, "costBudgetLimit"); }
  finally { saving.value = false; }
}
function checkConditions() { try { const value = JSON.parse(price.conditions || "{}"); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("匹配条件须为 JSON 对象"); conditionError.value = ""; return value as MediaPriceRule["conditions"]; } catch { conditionError.value = "匹配条件不是有效的 JSON 对象"; return undefined; } }
async function savePrice() {
  if (saving.value || !chosenModel.value) return;
  const conditions = checkConditions(); if (!conditions) { await showError(new Error(conditionError.value), "costPriceConditions"); return; }
  saving.value = true; error.value = ""; saved.value = "";
  try {
    const model = chosenModel.value;
    const rule: MediaPriceRule = { id: price.id || crypto.randomUUID(), providerId: model.providerId, modelId: model.modelId, mediaType: model.type, currency: price.currency, unit: price.unit, unitPrice: price.unitPrice, source: price.source, conditions, updatedAt: policy.value.prices.find(item => item.id === price.id)?.updatedAt ?? 0 };
    await persist({ ...policy.value, prices: [...policy.value.prices.filter(item => item.id !== rule.id), rule] }, "模型单价已保存，旧任务仍保留原依据"); clearPrice();
  } catch (cause) { await showError(cause, "costPriceAmount"); }
  finally { saving.value = false; }
}
function editPrice(rule: MediaPriceRule) { Object.assign(price, { ...rule, modelKey: keyFor({ ...rule, type: rule.mediaType }), conditions: JSON.stringify(rule.conditions ?? {}, null, 2) }); conditionError.value = ""; }
function clearPrice() { Object.assign(price, { id: "", currency: "CNY", unit: "request", unitPrice: "", source: "", conditions: "{}" }); conditionError.value = ""; error.value = ""; }
async function removePrice(id: string) { if (saving.value) return; saving.value = true; error.value = ""; try { await persist({ ...policy.value, prices: policy.value.prices.filter(item => item.id !== id) }, "单价已移除，历史任务依据保留"); if (price.id === id) clearPrice(); } catch (cause) { await showError(cause); } finally { saving.value = false; } }
watch(() => props.directory, (_directory, previous) => { if (previous) budgetDrafts.set(previous, { ...budget, dirty: budgetDirty.value }); const draft = budgetDrafts.get(props.directory); Object.assign(budget, draft ?? { enabled: false, currency: "CNY", limit: "", startsAt: Date.now() }); budgetDirty.value = draft?.dirty ?? false; saved.value = ""; summary.value = undefined; });
watch([() => props.active, () => props.directory], () => void load(), { immediate: true });
watch(() => chosenModel.value?.type, type => { if (price.unit !== "request" && price.unit !== ({ image: "image", video: "second", audio: "thousandCharacters" }[type ?? "image"])) price.unit = "request"; });
onScopeDispose(() => reader?.abort());
defineExpose({ load });
</script>

<style scoped lang="scss">
.mediaCostPanel {
  padding: 16px 0; border-block: 1px solid var(--el-border-color-light); margin-bottom: 16px;
  > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; h3 { margin: 0; font-size: 15px; } }
  .costHint { font-size: 12px; line-height: 1.7; color: var(--el-text-color-regular); overflow-wrap: anywhere; }
  .costError { color: var(--el-color-danger); font-size: 12px; line-height: 1.7; a { color: inherit; text-decoration: underline; } }
  .costTable { overflow: auto; table { width: 100%; font-size: 12px; border-collapse: collapse; caption { text-align: left; padding: 8px 0; } th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--el-border-color-lighter); white-space: nowrap; } } }
  .budgetBalance { font-size: 13px; line-height: 1.7; }
  .costSection { border-top: 1px solid var(--el-border-color-lighter); padding: 12px 0; summary { cursor: pointer; font-size: 13px; } form { margin-top: 14px; } }
  .costFields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); gap: 12px; .wideField { grid-column: 1 / -1; } }
  .costFormFields { border: 0; padding: 0; margin: 0; min-width: 0; }
  label { display: grid; gap: 6px; font-size: 12px; color: var(--el-text-color-regular); min-width: 0; }
  input:not([type="checkbox"]), select, textarea { box-sizing: border-box; width: 100%; min-width: 0; min-height: 34px; padding: 7px 9px; border: 1px solid var(--el-border-color); border-radius: 6px; background: var(--el-fill-color-blank); color: var(--el-text-color-primary); font: inherit; }
  .checkField { display: flex; align-items: center; margin-bottom: 14px; input { accent-color: var(--el-color-primary); } }
  .priceConditions { margin: 14px 0; summary { margin-bottom: 10px; } textarea { resize: vertical; font-family: monospace; } }
  .conditionFeedback { min-height: 1.7em; margin-block: 8px; }
  .costActions { display: flex; flex-wrap: wrap; gap: 8px; }
  .priceList { list-style: none; padding: 0; li { padding: 12px 0; border-top: 1px solid var(--el-border-color-lighter); font-size: 12px; p { overflow-wrap: anywhere; } span { color: var(--el-text-color-secondary); } } }
  :focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; }
}
</style>
