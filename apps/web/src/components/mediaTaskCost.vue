<template>
  <details class="mediaTaskCost">
    <summary>{{ costLabel }}</summary>
    <template v-if="task.cost?.quote.kind === 'estimated'">
      <p>{{ task.cost.quote.rate.currency }} {{ task.cost.quote.rate.unitPrice }} / {{ unitLabels[task.cost.quote.rate.unit] }} × {{ task.cost.quote.quantity }}</p>
      <p>单价来源：{{ task.cost.quote.rate.source }} · {{ new Date(task.cost.quote.rate.updatedAt).toLocaleString() }}</p>
      <p>适用参数：{{ JSON.stringify(task.cost.quote.rate.conditions || {}) }}</p>
    </template>
    <p v-else>费用未知：{{ task.cost?.quote.kind === 'unknown' ? task.cost.quote.reason : '旧任务没有保存费用依据' }}</p>
    <p v-if="task.cost?.statement">人工核对账单：{{ task.cost.statement.currency }} {{ task.cost.statement.amount }} · {{ task.cost.statement.note }} · {{ new Date(task.cost.statement.recordedAt).toLocaleString() }}</p>
    <details v-if="task.cost?.statementHistory?.length"><summary>此前账单核对</summary><p v-for="(item, index) in task.cost.statementHistory" :key="index">{{ item.currency }} {{ item.amount }} · {{ item.note }} · {{ new Date(item.recordedAt).toLocaleString() }}</p></details>
    <section v-for="report in task.cost?.reports || []" :key="report.key" class="usageReceipt" aria-label="供应商用量回执"><p>供应商回执 · {{ new Date(report.reportedAt).toLocaleString() }}</p><dl><template v-for="(value, key) in report.values || {}" :key="key"><dt>{{ key }}</dt><dd>{{ value }}</dd></template></dl><p v-if="report.charge">供应商金额：{{ report.charge.currency }} {{ report.charge.amount }} · {{ report.complete ? '整项账单完整' : '尚未确认完整结算' }}</p></section>
    <p class="costHint">用量字段按供应商原样记录，不能直接当成金额。生成失败或停止等待不代表退款；未结算任务保留预估占用。</p>
    <form v-if="!task.archived" @submit.prevent="saveStatement" @input="dirty = true">
      <fieldset :disabled="busy || active"><legend>核对整项任务账单</legend>
        <div class="statementFields"><label>币种<input v-model="statement.currency" required pattern="[A-Z]{3}" maxlength="3" :aria-label="`任务 ${task.id} 账单币种`" /></label><label>实际金额<input :id="`statementAmount${task.id}`" v-model="statement.amount" inputmode="decimal" required :pattern="decimalPattern" :aria-label="`任务 ${task.id} 实际金额`" /></label><label class="statementNote">账单来源或核对说明<input v-model="statement.note" required maxlength="1000" :aria-label="`任务 ${task.id} 账单说明`" /></label></div>
        <p class="costHint">人工核对值用于本机预算，不伪装为供应商回执。填写整项任务最终金额，包括已收费的失败或重做；确认未收费时可填 0。{{ active ? '任务仍在处理，结束后可核对。' : '' }}</p>
        <el-button nativeType="submit" size="small" :loading="busy">保存账单核对</el-button>
      </fieldset>
    </form>
    <p v-else class="costHint">迁移的历史账单仅查看；不会计入此安装的新提交预算。</p>
    <p v-if="error" ref="errorBox" class="costError" role="alert" tabindex="-1">{{ error }} <a :href="`#statementAmount${task.id}`" @click.prevent="focusAmount">返回金额输入</a></p>
    <div v-if="conflict"><p class="costHint">输入已保留。载入最新账单会替换上面的草稿，请核对后再保存。</p><el-button size="small" :loading="busy" @click="loadLatestStatement">载入最新账单</el-button></div>
    <p v-if="saved" role="status">账单核对已保存。</p>
  </details>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import axios from "axios";
import type { MediaTaskRecord } from "@toonflow/tools-scaffold/runtime";
const props = defineProps<{ task: MediaTaskRecord }>();
const emit = defineEmits<{ changed: [] }>();
const busy = ref(false); const error = ref(""); const saved = ref(false); const errorBox = ref<HTMLElement>();
const conflict = ref(false);
const dirty = ref(false); const basisRevision = ref(props.task.cost?.revision ?? 0);
const statement = reactive({ currency: props.task.cost?.statement?.currency ?? (props.task.cost?.quote.kind === "estimated" ? props.task.cost.quote.money.currency : "CNY"), amount: props.task.cost?.statement?.amount ?? "", note: props.task.cost?.statement?.note ?? "" });
const decimalPattern = "(?:0|[1-9][0-9]{0,8})(?:\\.[0-9]{1,6})?";
function focusAmount() { document.getElementById(`statementAmount${props.task.id}`)?.focus(); }
const unitLabels = { request: "项任务", image: "张图片", second: "秒视频", thousandCharacters: "千字符" };
const active = computed(() => ["queued", "submitting", "running", "downloading"].includes(props.task.status));
const costLabel = computed(() => { const cost = props.task.cost; if (cost?.statement) return `人工核对 ${cost.statement.currency} ${cost.statement.amount}`; if (cost?.reports.some(report => report.charge)) return "费用与供应商回执"; const unsubmitted = cost && !cost.submittedAt && ["failed", "cancelled"].includes(props.task.status) ? "未提交 · " : ""; return cost?.quote.kind === "estimated" ? `${unsubmitted}费用预估 ${cost.quote.money.currency} ${cost.quote.money.amount}` : `${unsubmitted}费用未知`; });
async function saveStatement() {
  if (busy.value || active.value) return;
  const task = props.task; const input = { id: task.id, directory: task.directory, expectedRevision: basisRevision.value, money: { currency: statement.currency, amount: statement.amount }, note: statement.note };
  busy.value = true; error.value = ""; saved.value = false; conflict.value = false;
  try { const { data } = await axios.post<{ data: MediaTaskRecord }>("/api/ai/media/costs/statement", input, { headers: { "x-toonflow-workspace": "1" } }); saved.value = true; dirty.value = false; basisRevision.value = data.data.cost?.revision ?? 0; emit("changed"); }
  catch (cause) { conflict.value = axios.isAxiosError(cause) && cause.response?.status === 409; error.value = axios.isAxiosError<{ message?: string }>(cause) ? cause.response?.data?.message || cause.message : "账单核对保存失败"; await nextTick(); errorBox.value?.focus(); }
  finally { busy.value = false; }
}
async function loadLatestStatement() {
  if (busy.value) return;
  busy.value = true;
  try {
    const { data } = await axios.get<{ data: MediaTaskRecord }>("/api/ai/media/tasks/get", { params: { id: props.task.id, directory: props.task.directory }, headers: { "x-toonflow-workspace": "1" } });
    const cost = data.data.cost;
    Object.assign(statement, { currency: cost?.statement?.currency ?? (cost?.quote.kind === "estimated" ? cost.quote.money.currency : "CNY"), amount: cost?.statement?.amount ?? "", note: cost?.statement?.note ?? "" });
    basisRevision.value = cost?.revision ?? 0; dirty.value = false; conflict.value = false; error.value = ""; emit("changed");
  } catch (cause) { error.value = axios.isAxiosError<{ message?: string }>(cause) ? cause.response?.data?.message || cause.message : "账单读取失败，草稿已保留"; await nextTick(); errorBox.value?.focus(); }
  finally { busy.value = false; if (!error.value) { await nextTick(); focusAmount(); } }
}
watch(() => props.task.cost?.revision ?? 0, revision => { if (dirty.value || busy.value) return; basisRevision.value = revision; const saved = props.task.cost?.statement; if (saved) Object.assign(statement, { currency: saved.currency, amount: saved.amount, note: saved.note }); });
</script>

<style scoped lang="scss">
.mediaTaskCost {
  margin: 10px 0; font-size: 12px; color: var(--el-text-color-regular); line-height: 1.7;
  summary { cursor: pointer; color: var(--el-text-color-primary); }
  p { overflow-wrap: anywhere; }
  .usageReceipt { border-left: 2px solid var(--el-border-color); padding-left: 10px; dl { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 12px; dt { overflow-wrap: anywhere; } dd { margin: 0; } } }
  fieldset { border: 1px solid var(--el-border-color-light); padding: 10px; min-width: 0; legend { padding-inline: 5px; } }
  .statementFields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; label { display: grid; gap: 5px; min-width: 0; }.statementNote { grid-column: 1 / -1; } input { box-sizing: border-box; width: 100%; min-width: 0; min-height: 34px; border: 1px solid var(--el-border-color); border-radius: 6px; padding: 7px; background: var(--el-fill-color-blank); color: var(--el-text-color-primary); font: inherit; } }
  .costHint { color: var(--el-text-color-regular); }
  .costError { color: var(--el-color-danger); a { color: inherit; } }
  :focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; }
}
</style>
