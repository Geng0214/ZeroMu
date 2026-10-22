<template>
  <el-dialog v-model="visible" class="channelSettingsPicker" title="选择渠道模型" width="min(1120px, 94vw)" alignCenter appendToBody destroyOnClose :closeOnClickModal="false" :closeOnPressEscape="!saving" :showClose="!saving">
    <template #header><div class="pickerHeading"><h2>选择渠道模型</h2><span>已选择 {{ selectedModels.length }} / {{ availableModels.length }} 可接入</span></div></template>
    <div class="pickerToolbar">
      <form class="pickerSearch" role="search" @submit.prevent><el-input v-model="query" aria-label="搜索模型" placeholder="搜索模型" clearable><template #append><el-button :icon="IconSearch" nativeType="submit" aria-label="搜索" /></template></el-input></form>
      <form class="pickerAdd" @submit.prevent="addModel"><el-input v-model="newModelId" aria-label="输入模型名称" placeholder="输入模型名称" spellcheck="false" /><el-button nativeType="submit" :disabled="!newModelId.trim() || pulling || saving">增加模型</el-button><el-button :icon="IconRefresh" :loading="pulling" :disabled="saving || channel.protocol === 'minimax'" :title="channel.protocol === 'minimax' ? '此格式请手动添加模型 ID' : undefined" @click="pullModels">拉取模型列表</el-button></form>
    </div>
    <div class="pickerTabs" role="tablist" aria-label="模型来源">
      <button id="newModelTab" role="tab" :aria-selected="activeTab === 'new'" aria-controls="channelModelList" :tabindex="activeTab === 'new' ? 0 : -1" @click="activeTab = 'new'" @keydown.right.prevent="switchTab('existing', $event)" @keydown.left.prevent="switchTab('existing', $event)">新获取的模型 ({{ newModels.length }})</button>
      <button id="existingModelTab" role="tab" :aria-selected="activeTab === 'existing'" aria-controls="channelModelList" :tabindex="activeTab === 'existing' ? 0 : -1" @click="activeTab = 'existing'" @keydown.right.prevent="switchTab('new', $event)" @keydown.left.prevent="switchTab('new', $event)">已有的模型 ({{ existingModels.length }})</button>
    </div>
    <div class="pickerSelection"><span>当前列表已选择 {{ selectedInList }} / {{ selectableModels.length }} 可接入<span v-if="filteredModels.length > selectableModels.length"> · {{ filteredModels.length - selectableModels.length }} 个不支持</span></span><div><el-button size="small" :disabled="saving || !selectableModels.length || selectedInList === selectableModels.length" @click="selectList(true)">全选当前列表</el-button><el-button size="small" :disabled="saving || !selectedInList" @click="selectList(false)">取消当前列表</el-button></div></div>
    <div id="channelModelList" class="pickerList" role="tabpanel" :aria-labelledby="activeTab === 'new' ? 'newModelTab' : 'existingModelTab'" tabindex="0">
      <p v-if="pulling && !filteredModels.length" class="pickerEmpty" role="status">正在拉取模型列表…</p>
      <p v-else-if="!filteredModels.length" class="pickerEmpty">没有匹配的模型</p>
      <div v-else class="pickerGrid">
        <label v-for="model in filteredModels" :key="model.id" class="pickerModel" :class="{ selected: selectedIds.includes(model.id), unavailable: !model.type }"><input v-model="selectedIds" type="checkbox" :disabled="saving || !model.type" :value="model.id" :aria-label="'选择模型 ' + model.id" /><span :title="model.id">{{ model.id }}<small v-if="!model.type">{{ model.unavailableReason }}</small><small v-else-if="model.label && model.label !== model.id">{{ model.label }}</small></span></label>
      </div>
    </div>
    <el-alert v-if="error" class="pickerError" :title="error" type="error" :closable="false" showIcon />
    <template #footer><el-button :disabled="saving" @click="visible = false">取消</el-button><el-button class="pickerConfirm" :disabled="pulling" :loading="saving" @click="confirm">确定</el-button></template>
  </el-dialog>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { IconSearch, IconRefresh } from "@tabler/icons-vue";
import { protocolKinds, type MediaChannelModel, type MediaChannelRow } from "./types";
import fetchChannelModels, { type ChannelCandidate } from "./fetchChannelModels";
import { classifyChannelModel } from "@toonflow/providers/channelModels";

const props = defineProps<{ channel: MediaChannelRow; initialCandidates?: ChannelCandidate[]; saving?: boolean }>();
const emit = defineEmits<{ picked: [MediaChannelModel[]]; fetched: [ChannelCandidate[]] }>();
const visible = defineModel<boolean>({ default: false });
const existingModels = ref<ChannelCandidate[]>([]);
const candidates = ref<ChannelCandidate[]>([]);
const supportedKinds = computed(() => protocolKinds[props.channel.protocol]);
const newModels = computed(() => candidates.value.filter(model => !existingModels.value.some(item => item.id === model.id)));
const allModels = computed(() => [...existingModels.value, ...newModels.value]);
const availableModels = computed(() => allModels.value.filter(model => !!model.type));
const selectedIds = ref<string[]>([]);
const selectedModels = computed(() => availableModels.value.filter(model => selectedIds.value.includes(model.id)));
const activeTab = ref<'new' | 'existing'>('existing');
const query = ref('');
const newModelId = ref('');
const pulling = ref(false);
const error = ref('');
const filteredModels = computed(() => (activeTab.value === 'new' ? newModels.value : existingModels.value).filter(model => [model.id, model.label].join(' ').toLowerCase().includes(query.value.trim().toLowerCase())));
const selectableModels = computed(() => filteredModels.value.filter(model => !!model.type));
const selectedInList = computed(() => selectableModels.value.filter(model => selectedIds.value.includes(model.id)).length);
const manualIds = new Set<string>();
let pullController: AbortController | undefined;
onBeforeUnmount(() => pullController?.abort());
function normalize(model: ChannelCandidate): ChannelCandidate {
  const classified = classifyChannelModel(model, props.channel.protocol);
  return { ...model, id: model.id, label: model.label, ...classified };
}
watch(visible, value => {
  pullController?.abort(); pullController = undefined; pulling.value = false;
  if (!value) return;
  candidates.value = [...new Map((props.initialCandidates ?? []).map(model => [model.id, normalize(model)])).values()];
  existingModels.value = props.channel.models.map(model => normalize({ ...model, ...candidates.value.find(item => item.id === model.id) }));
  manualIds.clear();
  selectedIds.value = existingModels.value.filter(model => !!model.type).map(model => model.id);
  activeTab.value = existingModels.value.length || !newModels.value.length ? 'existing' : 'new';
  query.value = ''; newModelId.value = ''; error.value = '';
}, { immediate: true });
function switchTab(tab: 'new' | 'existing', event: KeyboardEvent) {
  activeTab.value = tab;
  const current = event.currentTarget as HTMLElement;
  const target = tab === 'new' ? current.previousElementSibling : current.nextElementSibling;
  (target as HTMLElement | null)?.focus();
}
function addModel() {
  if (pulling.value || props.saving) return;
  const id = newModelId.value.trim();
  if (!id) return;
  if (id.length > 200 || allModels.value.length >= 2000 && !allModels.value.some(model => model.id === id)) { error.value = '模型 ID 最长 200 字符，每个渠道最多 2000 个模型'; return; }
  manualIds.add(id);
  if (!allModels.value.some(model => model.id === id)) candidates.value.push(normalize({ id, label: id }));
  if (allModels.value.find(model => model.id === id)?.type && !selectedIds.value.includes(id)) selectedIds.value.push(id);
  activeTab.value = existingModels.value.some(model => model.id === id) ? 'existing' : 'new';
  query.value = ''; newModelId.value = ''; error.value = '';
}
function selectList(select: boolean) {
  const ids = new Set(selectableModels.value.map(model => model.id));
  selectedIds.value = select ? [...new Set([...selectedIds.value, ...ids])] : selectedIds.value.filter(id => !ids.has(id));
}
function isValidUrl(value: string) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}
async function pullModels() {
  if (pulling.value || props.saving) return;
  if (!isValidUrl(props.channel.apiUrl.trim())) { error.value = '请先在渠道行里填写正确的 API 地址（http/https）'; return; }
  error.value = ''; pulling.value = true;
  const controller = pullController = new AbortController();
  try {
    const models = await fetchChannelModels(props.channel, controller.signal);
    if (controller.signal.aborted) return;
    const combined = new Map(candidates.value.filter(model => manualIds.has(model.id)).map(model => [model.id, model]));
    for (const model of models) combined.set(model.id, normalize(model));
    existingModels.value = existingModels.value.map(model => { const fresh = models.find(item => item.id === model.id); return fresh ? normalize({ ...model, ...fresh }) : model; });
    candidates.value = [...combined.values()];
    selectedIds.value = selectedIds.value.filter(id => availableModels.value.some(model => model.id === id));
    emit('fetched', models);
    activeTab.value = 'new'; query.value = '';
    ElMessage.success(`已获取 ${models.length} 个模型`);
  } catch (err) {
    if (controller.signal.aborted || axios.isCancel(err)) return;
    error.value = axios.isAxiosError(err) ? err.response?.data?.message || err.message : err instanceof Error ? err.message : '获取模型列表失败，请重试';
  } finally { if (pullController === controller) { pulling.value = false; pullController = undefined; } }
}
function confirm() {
  if (pulling.value || props.saving) return;
  const invalid = selectedModels.value.find(model => !model.type || !supportedKinds.value.includes(model.type));
  if (invalid) {
    activeTab.value = existingModels.value.some(model => model.id === invalid.id) ? 'existing' : 'new'; query.value = invalid.id;
    error.value = `当前 API 格式不支持 ${invalid.id} 的模型类型，请取消勾选该模型或更换渠道的 API 格式。`;
    return;
  }
  emit('picked', selectedModels.value.map(model => ({ ...model, type: model.type! })));
}

</script>

<style lang="scss">
.channelSettingsPicker.el-dialog {
  display: flex; flex-direction: column; height: min(560px, 90dvh); max-height: 90dvh; padding: 24px 28px 20px; border-radius: var(--ui-radius, 8px);
  .el-dialog__header { flex-shrink: 0; padding-bottom: 12px; padding-right: 24px; }
  .el-dialog__headerbtn { top: 10px; right: 8px; }
  .pickerHeading { display: flex; align-items: baseline; gap: 12px; h2 { font-size: 16px; line-height: 1.4; font-weight: 600; margin: 0; } span { font-size: 12px; color: var(--el-text-color-secondary); } }
  .el-dialog__body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .pickerToolbar { display: grid; grid-template-columns: 1fr 1.14fr; gap: 12px; flex-shrink: 0; form { min-width: 0; } .el-input { min-width: 0; } }
  .pickerAdd { display: flex; .el-input { flex: 1; .el-input__wrapper { border-radius: calc(var(--ui-radius, 8px) * 0.625) 0 0 calc(var(--ui-radius, 8px) * 0.625); } } .el-button { margin: 0 0 0 -1px; padding-inline: 12px; border-radius: 0; &:last-child { border-radius: 0 calc(var(--ui-radius, 8px) * 0.625) calc(var(--ui-radius, 8px) * 0.625) 0; } } }
  .pickerTabs { display: flex; gap: 32px; height: 60px; border-bottom: 1px solid var(--el-border-color-light); flex-shrink: 0;
    button { position: relative; padding: 0; border: 0; background: none; color: var(--el-text-color-secondary); font: inherit; font-size: 13px; cursor: pointer; &[aria-selected="true"] { color: var(--el-text-color-primary); &::after { content: ''; height: 2px; position: absolute; bottom: -1px; left: 0; right: 0; background: var(--el-color-primary); } } }
  }
  .pickerSelection { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 64px; padding-block: 12px; border-bottom: 1px solid var(--el-border-color-light); flex-shrink: 0; font-size: 12px; color: var(--el-text-color-secondary); >div { display: flex; gap: 8px; .el-button { margin: 0; } } }
  .pickerList { flex: 1; min-height: 0; overflow: auto; scrollbar-width: thin; scrollbar-color: var(--el-border-color) transparent; }
  .pickerGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 24px; align-content: start; padding-block: 12px; }
  .pickerEmpty { display: grid; place-items: center; margin: 0; height: 100%; min-height: 70px; color: var(--el-text-color-secondary); font-size: 13px; }
  .pickerModel { min-width: 0; display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 10px 8px; border-bottom: 1px solid var(--el-border-color-extra-light); cursor: pointer; font-size: 13px; color: var(--el-text-color-regular);
    &:hover, &:focus-within { background: var(--el-fill-color-light); } span { overflow-wrap: anywhere; line-height: 1.5; } small { display: block; color: var(--el-text-color-secondary); margin-top: 3px; } input { margin: 0; width: 15px; height: 15px; flex-shrink: 0; accent-color: var(--el-color-primary); cursor: pointer; } &.unavailable { opacity: .7; cursor: not-allowed; } &.selected { color: var(--el-text-color-primary); } }
  .pickerError { margin-top: 10px; flex-shrink: 0; }
  .el-dialog__footer { flex-shrink: 0; padding-top: 16px; border-top: 1px solid var(--el-border-color-light); .pickerConfirm { background: var(--el-color-primary); border-color: var(--el-color-primary); color: var(--el-color-white); &:hover { background: var(--el-color-primary-light-3); border-color: var(--el-color-primary-light-3); } } }
  button:focus-visible, input:focus-visible, [tabindex="0"]:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
  @media(max-width: 1000px) { .pickerGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 16px; } }
  @media(max-width: 650px) { padding: 18px 16px 14px; height: 92dvh; max-height: 92dvh; .pickerToolbar { grid-template-columns: 1fr; gap: 10px; } .pickerTabs { gap: 24px; height: 52px; } .pickerSelection { align-items: flex-start; flex-direction: column; gap: 10px; padding-block: 12px; } .pickerGrid { grid-template-columns: minmax(0, 1fr); } .pickerModel { min-height: 44px; padding: 8px 2px; } .pickerAdd .el-button { padding-inline: 8px; } }
}
</style>
