<template>
  <div v-if="loaded" class="channelPage">
    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" showIcon>
      <el-button text @click="loadProviders">重新读取渠道</el-button>
    </el-alert>
    <section class="channelSection">
      <header class="cardHead">
        <div class="cardTitle">
          <h3>模型渠道<span v-if="savedModelCount" class="modelCount">{{ savedModelCount }} 个模型</span></h3>
        </div>
        <div class="channelTools"><el-button type="primary" :icon="IconPlus" :disabled="busy" @click="addRow">新增渠道</el-button></div>
      </header>
      <p v-if="!rows.length && !loadError" class="emptyHint">暂无渠道</p>
      <div v-for="row in rows" :key="row.id" class="channelRow">
        <div class="rowFields">
          <div class="channelField"><span>渠道名称</span>
            <el-input v-model="row.label" aria-label="渠道名称" placeholder="例如：我的模型服务" maxlength="60" :disabled="busy" @change="saveRow(row)" />
          </div>
          <div class="channelField"><span>API 格式</span>
          <el-select v-model="row.protocol" aria-label="API 格式" popperClass="channelSettingsPopper" :disabled="busy" @change="changeProtocol(row)">
            <el-option v-for="option in protocolOptions.filter(option => !option.disabled)" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
          </div>
          <div class="channelField"><span>API 地址</span>
          <el-input v-model="row.apiUrl" aria-label="API 地址" placeholder="粘贴服务商提供的 API 地址" spellcheck="false" :disabled="busy" @change="saveRow(row)" />
          </div>
          <div class="channelField"><span>API 密钥</span>
          <el-input v-model="row.apiKey" aria-label="API Key" type="password" showPassword :placeholder="row.apiKeyUnavailable ? '请重新输入密钥' : row.hasApiKey ? '已保存 · 可替换' : '输入 API Key'" autocomplete="new-password" spellcheck="false" maxlength="400" :disabled="busy" @change="saveRow(row)">
            <template v-if="row.hasApiKey && !row.apiKey" #append><el-button :disabled="busy" :aria-label="`清除 ${row.label} 的密钥`" @click="clearStoredKey(row)">清除</el-button></template>
          </el-input>
          </div>
        </div>
        <div class="rowActions">
          <span v-if="currentConnection(row)" class="connectionResult" :class="{ connectionFailed: !currentConnection(row)!.success }" role="status" aria-live="polite">
            <icon-circle-check v-if="currentConnection(row)!.success" :size="18" aria-hidden="true" />
            <icon-circle-x v-else :size="18" aria-hidden="true" />
            <span>{{ currentConnection(row)!.success ? '连接成功' : `连接失败：${currentConnection(row)!.message}` }}</span>
          </span>
          <el-button :disabled="busy || !canSave(row)" @click="openPicker(row)">管理模型{{ row.models.length ? `（${row.models.length}）` : '' }}</el-button>
          <el-button :loading="checkingId === row.id" :disabled="busy || !canPull(row) || !row.revision || isDirty(row)" @click="checkConnection(row)">{{ checkingId === row.id ? '检查中…' : '检查连接' }}</el-button>
          <el-button :disabled="busy" @click="confirmRemoveRow(row)">删除渠道</el-button>
        </div>
        <div v-if="row.loadError || row.saveError || !row.revision || !row.hasApiKey || row.apiKeyUnavailable" class="rowStatus">
          <el-text v-if="row.saveError" type="danger" size="small" role="alert">{{ row.saveError }}</el-text>
          <el-tag v-if="row.loadError" size="small" type="danger" effect="plain" :title="row.loadError">文件读取失败</el-tag>
          <el-tag v-else-if="!row.revision" size="small" type="warning" effect="plain">未保存</el-tag>
          <el-tag v-if="row.apiKeyUnavailable" size="small" type="warning" effect="plain">密钥无法解密，请重新输入</el-tag>
          <el-tag v-else-if="row.revision && !row.hasApiKey" size="small" type="warning" effect="plain">未配置密钥</el-tag>
        </div>
      </div>
    </section>

    <section class="defaultsSection" aria-label="默认模型">
      <header class="cardHead">
        <div class="cardTitle">
          <h3>默认模型</h3>
        </div>
      </header>
      <div class="fieldGrid">
        <el-form v-for="field in defaultFields" :key="field.kind" class="gridItem" labelPosition="top" @submit.prevent>
          <el-form-item :label="field.label">
            <el-select
              :modelValue="defaultValue(field.kind)"
              class="defaultSelect"
              popperClass="channelSettingsPopper"
              placeholder="未设置"
              :aria-label="field.label"
              :disabled="busy"
              noDataText="暂无模型，请先拉取渠道模型"
              clearable
              filterable
              @update:modelValue="value => setDefault(field.kind, typeof value === 'string' ? value : '')">
              <el-option-group v-for="group in optionsFor(field.kind)" :key="group.id" :label="group.label">
                <el-option v-for="option in group.options" :key="option.value" :label="option.label" :value="option.value" />
              </el-option-group>
            </el-select>
          </el-form-item>
        </el-form>
      </div>
    </section>

    <section class="creationSection" aria-label="创作默认参数">
      <header class="cardHead"><div class="cardTitle"><h3>生成参数</h3></div></header>
      <div class="fieldGrid">
        <el-form labelPosition="top" @submit.prevent>
          <el-form-item label="生图数量"><el-input-number v-model="preferenceDraft.imageCount" :min="1" :max="10" :precision="0" controlsPosition="right" aria-label="画布默认生图张数" @change="value => savePreference('imageCount', value)" /></el-form-item>
        </el-form>
        <el-form labelPosition="top" @submit.prevent>
          <el-form-item label="音频音色"><el-select v-model="preferenceDraft.voice" filterable allowCreate defaultFirstOption aria-label="默认音频声音" @change="value => savePreference('voice', value)"><el-option v-for="voice in ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']" :key="voice" :label="voice[0].toUpperCase() + voice.slice(1)" :value="voice" /></el-select></el-form-item>
        </el-form>
        <el-form labelPosition="top" @submit.prevent>
          <el-form-item label="音频格式"><el-select v-model="preferenceDraft.format" aria-label="默认音频格式" @change="value => savePreference('format', value)"><el-option v-for="format in audioFormats" :key="format" :label="format.toUpperCase()" :value="format" /></el-select></el-form-item>
        </el-form>
        <el-form labelPosition="top" @submit.prevent>
          <el-form-item label="音频语速"><el-input-number v-model="preferenceDraft.speed" :min="0.25" :max="4" :step="0.25" controlsPosition="right" aria-label="默认音频语速" @change="value => savePreference('speed', value)" /></el-form-item>
        </el-form>
      </div>
    </section>
    <details class="settingsDisclosure advancedSettings">
      <summary>高级配置</summary>
      <div class="switchGrid">
        <div v-for="option in creationSwitches" :key="option.key" class="switchItem">
          <div class="switchHeading"><span>{{ option.label }}</span><el-switch v-model="preferenceDraft[option.key]" :aria-label="option.label" @change="value => savePreference(option.key, value)" /></div>
        </div>
      </div>
    </details>

    <component :is="modelPicker" v-if="pickingRow" v-model="pickerVisible" :channel="pickingRow" :saving="!!savingId" :initialCandidates="candidatesFor(pickingRow)" @picked="onPicked" @fetched="onFetched" />
  </div>
  <el-skeleton v-else :rows="6" animated aria-label="正在读取模型配置" />
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef, type Component } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { IconCircleCheck, IconCircleX, IconPlus } from "@tabler/icons-vue";
import { invalidateNodeModels } from "@toonflow/nodes-scaffold/modelCache";
import { customProviders, modelChoices, saveSettings, syncSettings, settings } from "@/stores/settings";
import type { MediaProvider } from "../mediaModel/types";
import { protocolOptions, protocolKinds, type MediaChannelKind, type MediaChannelModel, type MediaChannelRow } from "./types";

import type { ChannelCandidate } from "./fetchChannelModels";
import { creationPreferences, audioFormats } from "@/lib/creationPreferences";
type DefaultKind = MediaChannelKind | "text";
type ModelOption = { value: string; label: string };
type ModelGroup = { id: string; label: string; options: ModelOption[] };

const channelMarker = "ToonflowMediaChannel|";
const defaultFields: { kind: DefaultKind; label: string }[] = [
  { kind: "image", label: "默认生图模型" },
  { kind: "video", label: "默认视频模型" },
  { kind: "text", label: "默认文本模型" },
  { kind: "audio", label: "默认音频模型" },
];

const modelPicker = shallowRef<Component>();
const providers = ref<MediaProvider[]>([]);
const rows = ref<MediaChannelRow[]>([]);
const loaded = ref(false);
const loadError = ref("");
const savingId = ref("");
const deletingId = ref("");
const pickingRow = ref<MediaChannelRow>();
const pickerVisible = ref(false);
let loadRequest = 0;
const savedRows = new Map<string, string>();
function rowSnapshot(row: MediaChannelRow) { const { revision, loadError, saveError, fileName, ...draft } = row; return JSON.stringify(draft); }
function isDirty(row: MediaChannelRow) { return rowSnapshot(row) !== savedRows.get(row.id); }
const connectionResults = ref<Record<string, { revision: string; snapshot: string; success: boolean; message: string }>>({});
const checkingId = ref("");
function currentConnection(row: MediaChannelRow) {
  const result = connectionResults.value[row.id];
  return result?.revision === row.revision && result.snapshot === rowSnapshot(row) ? result : undefined;
}
async function checkConnection(row: MediaChannelRow) {
  if (busy.value || isDirty(row)) return;
  checkingId.value = row.id;
  delete connectionResults.value[row.id];
  const checked = { revision: row.revision, snapshot: rowSnapshot(row) };
  try {
    const { data } = await axios.post("/api/mediaChannel/check", { id: row.id, apiUrl: row.apiUrl.trim(), protocol: row.protocol }, { timeout: 35000, headers: { "x-toonflow-workspace": "1" } });
    if (data.code !== 200) throw new Error(data.message || "请稍后重试");
    connectionResults.value[row.id] = { ...checked, success: true, message: "连接成功" };
  } catch (cause) {
    connectionResults.value[row.id] = { ...checked, success: false, message: errorMessage(cause, "请检查地址和密钥后重试") };
  } finally { checkingId.value = ""; }
}

const pulledModels = ref<Record<string, { connection: string; models: ChannelCandidate[] }>>({});
const savedModelCount = computed(() => defaultFields.reduce((count, field) => count + optionsFor(field.kind).reduce((total, group) => total + group.options.length, 0), 0));
const preferenceDraft = ref({ ...creationPreferences.value });
const creationSwitches = [
  { key: "streamImages", label: "流式传输" },
  { key: "returnBase64", label: "返回 Base64 图片数据" },
  { key: "codexCli", label: "Codex CLI 兼容模式" },
] as const;
async function savePreference(key: keyof typeof creationPreferences.value, value: unknown) {
  if (value === undefined || value === null) return;
  try { await saveSettings(current => ({ mediaCreationPreferences: { ...creationPreferences.value, ...record(current.mediaCreationPreferences), [key]: value } })); }
  catch (error) { preferenceDraft.value = { ...creationPreferences.value }; ElMessage.error(errorMessage(error, "默认参数保存失败")); }
}
const busy = computed(() => !!savingId.value || !!deletingId.value || !!checkingId.value);
function connectionKey(row: MediaChannelRow) { return JSON.stringify([row.protocol, row.apiUrl.trim(), row.apiKey.trim(), row.apiKeyRevision]); }
function canPull(row: MediaChannelRow) { return canSave(row) && (!!row.apiKey.trim() || (row.hasApiKey && !row.apiKeyUnavailable)) && row.protocol !== "minimax" && !row.loadError; }
function candidatesFor(row: MediaChannelRow) { const cached = pulledModels.value[row.id]; return cached?.connection === connectionKey(row) ? cached.models : []; }
function cacheModels(row: MediaChannelRow, models: ChannelCandidate[]) { pulledModels.value[row.id] = { connection: connectionKey(row), models }; }
function onFetched(models: ChannelCandidate[]) { if (pickingRow.value) cacheModels(pickingRow.value, models); }
const mediaGroups = computed(() => {
  const groups: Record<MediaChannelKind, ModelGroup[]> = { image: [], video: [], audio: [], text: [] };
  for (const provider of providers.value) {
    if (provider.requiresApiKey !== false && (!providerConfig(provider.id).hasApiKey || providerConfig(provider.id).apiKeyUnavailable)) continue;
    for (const model of provider.models) {
      if (model.type !== "image" && model.type !== "video" && model.type !== "audio") continue;
      const list = groups[model.type];
      const option: ModelOption = { value: JSON.stringify([provider.id, model.id]), label: model.label || model.id };
      const found = list.find(group => group.id === provider.id);
      if (found) found.options.push(option);
      else list.push({ id: provider.id, label: provider.label, options: [option] });
    }
  }
  return groups;
});
const textGroups = computed<ModelGroup[]>(() => {
  const groups: ModelGroup[] = [];
  for (const choice of modelChoices.value) {
    const option: ModelOption = { value: choice.value, label: choice.label };
    const label = customProviders.value.find(provider => provider.id === choice.providerId)?.label ?? choice.providerId;
    const found = groups.find(group => group.id === choice.providerId);
    if (found) found.options.push(option);
    else groups.push({ id: choice.providerId, label, options: [option] });
  }
  return groups;
});

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringOf(value: unknown) {
  return typeof value === "string" ? value : "";
}

function providerConfig(id: string) {
  return record(record(settings.value.mediaProviderConfigs)[id]);
}

function isValidUrl(value: string) {
  if (!/^https?:\/\/\S+$/i.test(value)) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash && !url.search;
  } catch { return false; }
}

function canSave(row: MediaChannelRow) {
  return !!row.label.trim() && isValidUrl(row.apiUrl.trim());
}

function rowFromProvider(provider: MediaProvider): MediaChannelRow {
  const config = providerConfig(provider.id);
  const declared = stringOf(config.kind);
  const fallbackKind = declared === "video" || declared === "audio" ? declared : "image";
  return {
    id: provider.id,
    fileName: provider.fileName,
    revision: provider.revision,
    loadError: provider.loadError ?? "",
    label: provider.label,
    protocol: config.protocol === "apimart" || config.protocol === "minimax" ? config.protocol : "openai",
    apiUrl: stringOf(config.apiUrl),
    apiKey: "",
    hasApiKey: config.hasApiKey === true,
    apiKeyUnavailable: config.apiKeyUnavailable === true,
    apiKeyRevision: stringOf(config.apiKeyRevision),
    returnBase64: config.returnBase64 === true,
    maxConcurrentTasks: typeof config.maxConcurrentTasks === "number" ? Math.min(8, Math.max(1, config.maxConcurrentTasks)) : 2,
    submitPath: stringOf(config.submitPath),
    pollPath: stringOf(config.pollPath),
    contentPath: stringOf(config.contentPath),
    models: provider.models.map(model => ({ ...model, id: model.id, label: model.label, type: model.type === "image" || model.type === "video" || model.type === "audio" || model.type === "text" ? model.type : fallbackKind })),
  };
}

function newChannelId() {
  const taken = new Set(providers.value.map(provider => provider.id));
  let id = "";
  do {
    id = `channel${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.replace(/[^a-z0-9]/g, "").toLowerCase();
  } while (taken.has(id) || !/^[a-z][a-z0-9]{1,90}$/.test(id));
  return id;
}

onMounted(() => {
  void loadProviders();
  window.addEventListener("toonflow:plugin-installed", refreshInstalled);
});
onBeforeUnmount(() => {
  loadRequest++;
  window.removeEventListener("toonflow:plugin-installed", refreshInstalled);
});

function refreshInstalled(event: WindowEventMap["toonflow:plugin-installed"]) {
  if (event.detail.type === "provider") void loadProviders();
}

async function loadProviders() {
  const request = ++loadRequest;
  loadError.value = "";
  try {
    const { data } = await axios.get<{ data: MediaProvider[] }>("/api/providers/media/list");
    if (request !== loadRequest) return;
    providers.value = data.data ?? [];
    const channelProviders = providers.value.filter(provider => provider.readme?.startsWith(channelMarker));
    const saved = new Set(channelProviders.map(provider => provider.id));
    // ACT: 保存后重载会带回同一渠道，只保留服务端还不存在的草稿行。
    rows.value = [...channelProviders.map(provider => {
      const fresh = rowFromProvider(provider);
      const draft = rows.value.find(row => row.id === provider.id);
      const dirty = draft && rowSnapshot(draft) !== savedRows.get(provider.id);
      savedRows.set(provider.id, rowSnapshot(fresh));
      return dirty ? { ...draft, revision: fresh.revision, fileName: fresh.fileName } : fresh;
    }), ...rows.value.filter(row => !row.revision && !saved.has(row.id))];
  } catch (error) {
    if (request === loadRequest) loadError.value = errorMessage(error, "读取模型渠道失败，请重试");
  } finally {
    if (request === loadRequest) loaded.value = true;
  }
}

function errorMessage(error: unknown, fallback: string) {
  if (!axios.isAxiosError(error)) return error instanceof Error ? error.message : fallback;
  const result = error.response?.data; const details = Array.isArray(result?.data) ? result.data.filter((item: unknown): item is string => typeof item === "string").slice(0, 4) : [];
  return [result?.message || error.message || fallback, ...details].join("；");
}

function payloadOf(row: MediaChannelRow) {
  const payload: Record<string, unknown> = {
    id: row.id,
    label: row.label.trim(),
    protocol: row.protocol,
    maxConcurrentTasks: row.maxConcurrentTasks,
    apiUrl: row.apiUrl.trim(),
    ...(row.apiKey.trim() || row.clearApiKey ? { apiKey: row.apiKey.trim() } : {}),
    apiKeyRevision: row.apiKeyRevision, revision: row.revision,
    models: row.models.map(model => ({ ...model, id: model.id, label: (model.label ?? model.id).trim() || model.id, type: model.type })),
  };
  if (row.protocol === "openai" && row.returnBase64) payload.returnBase64 = true;
  if (row.protocol === "openai") {
    for (const field of ["submitPath", "pollPath", "contentPath"] as const) {
      const value = row[field].trim();
      if (value) payload[field] = value;
    }
  }
  return payload;
}

async function saveRow(row: MediaChannelRow, reload = true) {
  if (savingId.value || deletingId.value || !canSave(row)) return false;
  row.saveError = "";
  savingId.value = row.id;
  try {
    const snapshot = { ...row, models: row.models.map(model => ({ ...model })) };
    await syncSettings(async () => {
      const { data } = await axios.post("/api/mediaChannel/save", payloadOf(snapshot), { timeout: 20000, headers: { "x-toonflow-workspace": "1" } });
      if (data.code !== 200) throw new Error(data.message || "保存渠道失败");
      row.revision = data.data.provider.revision;
      row.fileName = data.data.provider.fileName;
      const credential = record(record(data.data.settings.mediaProviderConfigs)[row.id]);
      const saved = { hasApiKey: credential.hasApiKey === true, apiKeyUnavailable: credential.apiKeyUnavailable === true, apiKeyRevision: stringOf(credential.apiKeyRevision), apiKey: "", clearApiKey: false };
      if (row.apiKey === snapshot.apiKey) Object.assign(row, saved);
      savedRows.set(row.id, rowSnapshot({ ...snapshot, ...saved }));
      invalidateNodeModels("media"); invalidateNodeModels("language");
      return data.data.settings;
    });
    if (reload) await loadProviders();
    return true;
  } catch (error) {
    row.saveError = errorMessage(error, "保存渠道失败，请重试");
    ElMessage.error(row.saveError);
    return false;
  } finally { savingId.value = ""; }
}

async function clearStoredKey(row: MediaChannelRow) {
  row.clearApiKey = true;
  if (!await saveRow(row)) row.clearApiKey = false;
}

async function changeProtocol(row: MediaChannelRow) {
  if (row.models.some(model => !protocolKinds[row.protocol].includes(model.type))) {
    ElMessage.warning("该 API 格式不支持渠道中部分模型的用途，请先在“管理模型”中调整");
    row.protocol = savedRows.has(row.id) ? JSON.parse(savedRows.get(row.id)!).protocol : "openai";
    return;
  }
  await saveRow(row);
}

function addRow() {
  if (busy.value) return;
  rows.value = [...rows.value, {
    id: newChannelId(), fileName: "", revision: "", loadError: "", label: "", protocol: "openai",
    apiUrl: "", apiKey: "", returnBase64: false, maxConcurrentTasks: 2, submitPath: "", pollPath: "", contentPath: "", models: [],
  }];
}

async function confirmRemoveRow(row: MediaChannelRow) {
  if (busy.value) return;
  const confirmed = await ElMessageBox.confirm("确定删除此渠道及其模型？", "删除渠道", { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" }).then(() => true, () => false);
  if (confirmed) await removeRow(row);
}

async function removeRow(row: Pick<MediaProvider, "id" | "fileName" | "revision">) {
  if (busy.value) return;
  if (!row.revision) {
    rows.value = rows.value.filter(item => item.id !== row.id);
    return;
  }
  deletingId.value = row.id;
  let deleted = false;
  try {
    await syncSettings(async () => {
      await axios.delete("/api/providers/media/delete", { data: { fileName: row.fileName, revision: row.revision } });
      deleted = true;
      const { data } = await axios.get("/api/settings/get", { headers: { "x-toonflow-workspace": "1" } });
      if (data.code !== 200) throw new Error("读取最新设置失败");
      return data.data;
    });
    delete pulledModels.value[row.id];
    savedRows.delete(row.id);
    await loadProviders();
    invalidateNodeModels("media");
  } catch (error) {
    ElMessage.error(deleted ? `渠道已删除，本页设置刷新失败，请刷新页面：${errorMessage(error, "读取配置失败")}` : errorMessage(error, "删除失败，请重试"));
  } finally { deletingId.value = ""; }
}

function openPicker(row: MediaChannelRow) {
  if (busy.value || !canSave(row)) return;
  modelPicker.value ??= defineAsyncComponent(() => import("./modelPickerDialog.vue"));
  pickingRow.value = row;
  pickerVisible.value = true;
}

async function onPicked(models: MediaChannelModel[]) {
  const row = pickingRow.value;
  if (!row) return;
  const previous = row.models;
  row.models = models;
  if (await saveRow(row)) pickerVisible.value = false;
  else row.models = previous;
}

function defaultValue(kind: DefaultKind) {
  const ref = record(record(settings.value.mediaChannelDefaults)[kind]);
  return typeof ref.providerId === "string" && typeof ref.modelId === "string" ? JSON.stringify([ref.providerId, ref.modelId]) : "";
}

async function setDefault(kind: DefaultKind, value: string) {
  if (savingId.value) return;
  if (value) {
    if (!optionsFor(kind).some(group => group.options.some(option => option.value === value))) {
      ElMessage.warning("请先接入该模型，再设置为默认模型"); return;
    }
  }
  try { await saveSettings(current => {
    const defaults = { ...record(current.mediaChannelDefaults) };
    if (!value) delete defaults[kind];
    else {
      const [providerId, modelId] = JSON.parse(value) as string[];
      defaults[kind] = { providerId, modelId };
    }
    return { mediaChannelDefaults: defaults };
  });
  invalidateNodeModels(kind === "text" ? "language" : "media");
  } catch (error) { ElMessage.error(errorMessage(error, "默认模型保存失败，请重试")); }
}

function optionsFor(kind: DefaultKind) {
  return kind === "text" ? textGroups.value : mediaGroups.value[kind];
}


</script>

<style lang="scss" scoped>
.channelPage {
  display: grid; gap: 24px; font-size: 13px;
  :deep(.el-input__wrapper), :deep(.el-select__wrapper) { min-height: 36px; font-size: 13px; }
  :deep(.el-button) { margin-left: 0; }
  :deep(.el-text--small) { font-size: 12px; line-height: 1.6; }
  :deep(.el-input__inner)::placeholder { color: var(--el-text-color-placeholder); }
  .cardHead { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
  .cardTitle { min-width: 0; h3 { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; margin: 0; font-size: 15px; font-weight: 600; line-height: 1.5; } .modelCount { color: var(--el-text-color-secondary); font-size: 12px; font-weight: 400; } }
  .channelTools { display: flex; flex-wrap: wrap; gap: 8px; }
  .channelSection, .defaultsSection { padding-bottom: 24px; border-bottom: 1px solid var(--el-border-color-light); }
  .emptyHint { margin: 0; padding: 20px 0; color: var(--el-text-color-secondary); }
  .channelRow {
    padding: 16px; margin-top: 16px; border: 1px solid var(--el-border-color); border-radius: var(--ui-radius, 8px);
    .rowFields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px;
      .channelField { display: grid; gap: 6px; min-width: 0; > span { font-size: 12px; color: var(--el-text-color-regular); } }
    }
    .rowActions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    .rowStatus { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
    .rowActions {
      .connectionResult {
        display: flex; flex: 1 1 120px; align-items: center; gap: 6px; min-width: 0; color: color-mix(in srgb, var(--el-color-success) 40%, var(--el-text-color-primary)); line-height: 1.6;
        > svg { flex-shrink: 0; }
        > span { overflow-wrap: anywhere; }
        &.connectionFailed { color: color-mix(in srgb, var(--el-color-danger) 40%, var(--el-text-color-primary)); }
      }
    }
  }
  .fieldGrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;
    > * { min-width: 0; }
    :deep(.el-form-item) { margin-bottom: 0; }
    :deep(.el-form-item__label) { font-size: 12px; margin-bottom: 8px; line-height: 1.5; color: var(--el-text-color-regular); }
    :deep(.el-input-number), :deep(.el-select) { width: 100%; }
  }
  .advancedSettings {
    .switchGrid { display: grid; gap: 16px; }
    .switchHeading { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-weight: 500; > .el-switch { flex-shrink: 0; } }
  }
  @media (max-width: 900px) { .fieldGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 620px) {
    .cardHead { align-items: flex-start; flex-wrap: wrap; }
    .channelRow { padding: 12px; .rowFields { grid-template-columns: minmax(0, 1fr); } .rowActions { justify-content: flex-start; } }
  }
}
</style>
