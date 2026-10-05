<template>
  <div v-if="loaded" class="channelPage">
    <section class="card">
      <header class="cardHead">
        <div class="cardTitle">
          <h3>模型渠道</h3>
          <el-text type="info" size="small">用 OpenAI 兼容接口接入任意厂商，可为生图、视频、音频分别选择不同渠道的模型。</el-text>
        </div>
        <el-button :icon="IconPlus" :disabled="busy" @click="addRow">新增渠道</el-button>
      </header>
      <el-text v-if="!rows.length" class="emptyHint" type="info" size="small">还没有模型渠道，点击「新增渠道」开始配置。</el-text>
      <div v-for="row in rows" :key="row.id" class="channelRow">
        <div class="rowFields">
          <el-input v-model="row.label" class="field field--name" placeholder="渠道名称" maxlength="60" :disabled="busy" @change="saveRow(row)" />
          <el-select v-model="row.kind" class="field field--kind" :disabled="busy || !!row.models.length" @change="saveRow(row)">
            <el-option v-for="option in kindOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
          <el-input v-model="row.apiUrl" class="field field--url" placeholder="https://api.openai.com" spellcheck="false" :disabled="busy" @change="saveRow(row)" />
          <el-input v-model="row.apiKey" class="field field--key" type="password" show-password placeholder="API Key" spellcheck="false" maxlength="400" :disabled="busy" @change="saveRow(row)" />
          <el-button class="field field--pick" :disabled="busy || !canSave(row)" @click="openPicker(row)">选择</el-button>
          <el-popconfirm title="确定删除此渠道及其模型？" confirmButtonText="删除" cancelButtonText="取消" @confirm="removeRow(row)">
            <template #reference>
              <el-button class="field field--remove" type="danger" plain :disabled="busy || (!!deletingId && deletingId !== row.id)">删除</el-button>
            </template>
          </el-popconfirm>
        </div>
        <div class="rowMeta">
          <el-text size="small" type="info">已保存 {{ row.models.length }} 个模型</el-text>
          <el-tag v-if="row.loadError" size="small" type="danger" effect="plain" :title="row.loadError">文件读取失败</el-tag>
          <el-tag v-else-if="!row.revision" size="small" type="warning" effect="plain">未保存</el-tag>
          <el-tag v-if="row.revision && !row.apiKey" size="small" type="warning" effect="plain">未配置密钥</el-tag>
          <el-tag v-for="model in row.models" :key="model.id" class="modelTag" size="small" type="info" effect="plain" :title="model.label || model.id">{{ model.id }}</el-tag>
          <el-switch v-if="row.kind === 'image'" v-model="row.returnBase64" class="rowSwitch" size="small" inlinePrompt activeText="返回 Base64 图片数据" :disabled="busy" @change="saveRow(row)" />
          <el-popover v-if="row.kind === 'video'" trigger="click" width="320" placement="top">
            <template #reference><el-button text size="small" :disabled="busy">视频任务地址</el-button></template>
            <div class="pathForm">
              <el-input v-model="row.submitPath" size="small" placeholder="任务提交地址 /v1/videos" spellcheck="false" :disabled="busy" @change="saveRow(row)" />
              <el-input v-model="row.pollPath" size="small" placeholder="任务查询地址 /v1/videos/{id}" spellcheck="false" :disabled="busy" @change="saveRow(row)" />
              <el-input v-model="row.contentPath" size="small" placeholder="内容下载地址（可选）" spellcheck="false" :disabled="busy" @change="saveRow(row)" />
              <el-text type="info" size="small">留空使用 OpenAI 视频接口约定；仅在厂商地址不同时填写。</el-text>
            </div>
          </el-popover>
        </div>
      </div>
    </section>

    <section class="card">
      <header class="cardHead">
        <div class="cardTitle">
          <h3>模型列表</h3>
          <el-text type="info" size="small">当前已保存 {{ savedModels.length }} 个模型</el-text>
        </div>
        <el-button :icon="IconRefresh" :loading="!!pullingAll" :disabled="busy || !savedModels.length" @click="pullAllChannels">拉取全部渠道</el-button>
      </header>
      <el-text v-if="!savedModels.length" class="emptyHint" type="info" size="small">还没有模型，先在上方添加渠道并选择模型。</el-text>
      <el-table v-else :data="savedModels" size="small" max-height="280">
        <el-table-column label="渠道" min-width="140">
          <template #default="scope">{{ scope.row.channelLabel || scope.row.channelId }}</template>
        </el-table-column>
        <el-table-column label="类型" width="80">
          <template #default="scope">{{ kindOf(scope.row as SavedModel) }}</template>
        </el-table-column>
        <el-table-column prop="modelId" label="模型 ID" min-width="220" show-overflow-tooltip />
      </el-table>
    </section>

    <section class="card">
      <header class="cardHead">
        <div class="cardTitle">
          <h3>默认模型</h3>
          <el-text type="info" size="small">新建节点时自动选中，单个节点仍可单独修改；不改变已有节点的选择。</el-text>
        </div>
      </header>
      <div class="fieldGrid">
        <el-form v-for="field in defaultFields" :key="field.kind" class="gridItem" labelPosition="top" @submit.prevent>
          <el-form-item :label="field.label">
            <el-select
              :model-value="defaultValue(field.kind)"
              class="defaultSelect"
              placeholder="未设置"
              clearable
              filterable
              @update:model-value="value => setDefault(field.kind, typeof value === 'string' ? value : '')">
              <el-option-group v-for="group in optionsFor(field.kind)" :key="group.id" :label="group.label">
                <el-option v-for="option in group.options" :key="option.value" :label="option.label" :value="option.value" />
              </el-option-group>
            </el-select>
            <el-text v-if="field.hint" class="fieldHint" type="info" size="small">{{ field.hint }}</el-text>
          </el-form-item>
        </el-form>
      </div>
    </section>

    <section class="card">
      <header class="cardHead">
        <div class="cardTitle">
          <h3>系统提示词</h3>
          <el-text type="info" size="small">Agent 与文本节点共用；留空使用内置提示词。</el-text>
        </div>
      </header>
      <el-input
        v-model="promptDraft"
        type="textarea"
        :rows="4"
        :maxlength="promptMaxLength || undefined"
        showWordLimit
        resize="vertical"
        placeholder="例如：你是一位擅长电影感写实摄影的视觉导演。"
        aria-label="系统提示词"
        @change="savePrompt" />
    </section>

    <component :is="modelPicker" v-if="pickingRow" v-model="pickerVisible" :channel="pickingRow" @picked="onPicked" />
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef, type Component } from "vue";
import { ElMessage } from "element-plus";
import { IconPlus, IconRefresh } from "@tabler/icons-vue";
import { invalidateNodeModels } from "@toonflow/nodes-scaffold/nodeAi";
import { customProviders, modelChoices, saveSettings, settings } from "@/stores/settings";
import type { MediaProvider } from "../mediaModel/types";
import { kindLabels, type MediaChannelKind, type MediaChannelModel, type MediaChannelRow } from "./types";

type DefaultKind = MediaChannelKind | "text";
type ModelOption = { value: string; label: string };
type ModelGroup = { id: string; label: string; options: ModelOption[] };
type SavedModel = { channelId: string; channelLabel: string; kind: MediaChannelKind; modelId: string };

const channelMarker = "ToonflowMediaChannel|";
const kindOptions = (Object.keys(kindLabels) as MediaChannelKind[]).map(value => ({ label: kindLabels[value], value }));
const defaultFields: { kind: DefaultKind; label: string; hint?: string }[] = [
  { kind: "image", label: "默认生图模型" },
  { kind: "video", label: "默认视频模型" },
  { kind: "text", label: "默认文本模型" },
  { kind: "audio", label: "默认音频模型", hint: "画布暂无语音节点，该默认值只影响 Agent 音频工具的可选顺序。" },
];

const modelPicker = shallowRef<Component>();
const providers = ref<MediaProvider[]>([]);
const rows = ref<MediaChannelRow[]>([]);
const loaded = ref(false);
const savingId = ref("");
const deletingId = ref("");
const pullingAll = ref("");
const pickingRow = ref<MediaChannelRow>();
const pickerVisible = ref(false);
const promptDraft = ref("");
const promptDefault = ref("");
const promptMaxLength = ref(0);
let loadRequest = 0;

const busy = computed(() => !!savingId.value || !!deletingId.value || !!pullingAll.value);
const mediaGroups = computed(() => {
  const groups: Record<MediaChannelKind, ModelGroup[]> = { image: [], video: [], audio: [] };
  for (const provider of providers.value) {
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
const savedModels = computed<SavedModel[]>(() => rows.value.flatMap(row => row.models.map(model => ({
  channelId: row.id, channelLabel: row.label, kind: row.kind, modelId: model.id,
}))));

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
  const type = provider.models[0]?.type;
  return {
    id: provider.id,
    fileName: provider.fileName,
    revision: provider.revision,
    loadError: provider.loadError ?? "",
    label: provider.label,
    kind: declared === "image" || declared === "video" || declared === "audio" ? declared : type === "video" || type === "audio" || type === "image" ? type : "image",
    apiUrl: stringOf(config.apiUrl),
    apiKey: stringOf(config.apiKey),
    returnBase64: config.returnBase64 === true,
    submitPath: stringOf(config.submitPath),
    pollPath: stringOf(config.pollPath),
    contentPath: stringOf(config.contentPath),
    models: provider.models.map(model => ({ id: model.id, label: model.label })),
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
  void loadPrompt();
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
  try {
    const { data } = await axios.get<{ data: MediaProvider[] }>("/api/providers/media/list");
    if (request !== loadRequest) return;
    providers.value = data.data ?? [];
    const channelProviders = providers.value.filter(provider => provider.readme?.startsWith(channelMarker));
    const saved = new Set(channelProviders.map(provider => provider.id));
    // ACT: 保存后重载会带回同一渠道，只保留服务端还不存在的草稿行。
    rows.value = [...channelProviders.map(rowFromProvider), ...rows.value.filter(row => !row.revision && !saved.has(row.id))];
  } catch (error) {
    if (request === loadRequest) ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.message || error.message : "读取模型渠道失败");
  } finally {
    if (request === loadRequest) loaded.value = true;
  }
}

async function loadPrompt() {
  try {
    const { data } = await axios.get<{ code: number; data: { defaultSystemPrompt: string; maxLength: number } }>("/api/settings/systemPrompt");
    if (typeof data.data?.defaultSystemPrompt !== "string") return;
    promptDefault.value = data.data.defaultSystemPrompt;
    promptMaxLength.value = data.data.maxLength;
    const saved = settings.value.agentSystemPrompt;
    promptDraft.value = typeof saved === "string" && saved.trim() ? saved : data.data.defaultSystemPrompt;
  } catch { /* ACT: 读取失败时只隐藏字数上限，不影响渠道配置。 */ }
}

function errorMessage(error: unknown, fallback: string) {
  return axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : fallback;
}

function payloadOf(row: MediaChannelRow) {
  const payload: Record<string, unknown> = {
    id: row.id,
    label: row.label.trim(),
    kind: row.kind,
    apiUrl: row.apiUrl.trim(),
    models: row.models.map(model => ({ id: model.id, label: (model.label ?? model.id).trim() || model.id })),
  };
  if (row.kind === "image" && row.returnBase64) payload.returnBase64 = true;
  if (row.kind === "video") {
    for (const field of ["submitPath", "pollPath", "contentPath"] as const) {
      const value = row[field].trim();
      if (value) payload[field] = value;
    }
  }
  return payload;
}

async function writeConfig(row: MediaChannelRow) {
  await saveSettings(current => {
    const map = record(current.mediaProviderConfigs);
    const config: Record<string, unknown> = { ...record(map[row.id]), apiUrl: row.apiUrl.trim(), kind: row.kind };
    for (const key of ["apiKey", "returnBase64", "submitPath", "pollPath", "contentPath"]) delete config[key];
    if (row.apiKey.trim()) config.apiKey = row.apiKey.trim();
    if (row.kind === "image" && row.returnBase64) config.returnBase64 = true;
    if (row.kind === "video") {
      for (const field of ["submitPath", "pollPath", "contentPath"] as const) {
        const value = row[field].trim();
        if (value) config[field] = value;
      }
    }
    return { mediaProviderConfigs: { ...map, [row.id]: config } };
  });
}

async function saveRow(row: MediaChannelRow, reload = true) {
  if (busy.value || !canSave(row)) return false;
  savingId.value = row.id;
  try {
    const { data } = await axios.post<{ code: number; message: string }>("/api/mediaChannel/save", payloadOf(row), { timeout: 20000 });
    if (data.code !== 200) throw new Error(data.message || "保存渠道失败");
    await writeConfig(row);
    invalidateNodeModels("media");
    if (reload) await loadProviders();
    return true;
  } catch (error) {
    ElMessage.error(errorMessage(error, "保存渠道失败，请重试"));
    return false;
  } finally { savingId.value = ""; }
}

function addRow() {
  if (busy.value) return;
  rows.value = [...rows.value, {
    id: newChannelId(), fileName: "", revision: "", loadError: "", label: "", kind: "image",
    apiUrl: "", apiKey: "", returnBase64: false, submitPath: "", pollPath: "", contentPath: "", models: [],
  }];
}

async function removeRow(row: MediaChannelRow) {
  if (busy.value) return;
  if (!row.revision) {
    rows.value = rows.value.filter(item => item.id !== row.id);
    return;
  }
  deletingId.value = row.id;
  let deleted = false;
  try {
    await axios.delete("/api/providers/media/delete", { data: { fileName: row.fileName, revision: row.revision } });
    deleted = true;
    clearDefault(row.id);
    invalidateNodeModels("media");
    await saveSettings(current => {
      const map = { ...record(current.mediaProviderConfigs) };
      if (!Object.hasOwn(map, row.id)) return;
      delete map[row.id];
      return { mediaProviderConfigs: map };
    });
    await loadProviders();
  } catch (error) {
    ElMessage.error(deleted ? `渠道已删除，连接配置未清理：${errorMessage(error, "清理配置失败")}` : errorMessage(error, "删除失败，请重试"));
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
  row.models = models;
  if (row.revision) await saveRow(row);
}

async function pullAllChannels() {
  if (busy.value) return;
  pullingAll.value = "all";
  const targets = rows.value.filter(row => isValidUrl(row.apiUrl.trim()));
  let added = 0;
  const failed: string[] = [];
  for (const row of targets) {
    try {
      const { data } = await axios.post<{ code: number; data: MediaChannelModel[]; message: string }>("/api/mediaChannel/models",
        { id: row.id, apiUrl: row.apiUrl.trim(), apiKey: row.apiKey.trim() }, { timeout: 35000 });
      if (data.code !== 200 || !Array.isArray(data.data)) throw new Error(data.message || "获取失败");
      const taken = new Set(row.models.map(model => model.id));
      const merged = [...row.models];
      for (const model of data.data) {
        if (taken.has(model.id)) continue;
        taken.add(model.id);
        merged.push({ id: model.id, label: model.label ?? model.id });
      }
      if (merged.length === row.models.length) continue;
      added += merged.length - row.models.length;
      row.models = merged;
      await saveRow(row, false);
    } catch (error) {
      failed.push(`${row.label || row.id}：${errorMessage(error, "获取失败")}`);
    }
  }
  pullingAll.value = "";
  await loadProviders();
  if (added) ElMessage.success(`新增 ${added} 个模型`);
  else if (!failed.length) ElMessage.success("各渠道模型已是最新");
  if (failed.length) ElMessage.error(failed.slice(0, 3).join("；"));
}

function defaultValue(kind: DefaultKind) {
  const ref = record(record(settings.value.mediaChannelDefaults)[kind]);
  return typeof ref.providerId === "string" && typeof ref.modelId === "string" ? JSON.stringify([ref.providerId, ref.modelId]) : "";
}

function setDefault(kind: DefaultKind, value: string) {
  saveSettings(current => {
    const defaults = { ...record(current.mediaChannelDefaults) };
    if (!value) delete defaults[kind];
    else {
      const [providerId, modelId] = JSON.parse(value) as string[];
      defaults[kind] = { providerId, modelId };
    }
    return { mediaChannelDefaults: defaults };
  });
  invalidateNodeModels(kind === "text" ? "language" : "media");
}

function clearDefault(channelId: string) {
  for (const field of defaultFields) {
    const value = defaultValue(field.kind);
    if (value && (JSON.parse(value) as string[])[0] === channelId) setDefault(field.kind, "");
  }
}

function optionsFor(kind: DefaultKind) {
  return kind === "text" ? textGroups.value : mediaGroups.value[kind];
}

function kindOf(model: SavedModel) {
  return kindLabels[model.kind];
}

async function savePrompt() {
  const value = !promptDraft.value.trim() || promptDraft.value === promptDefault.value ? "" : promptDraft.value;
  try {
    await saveSettings(() => ({ agentSystemPrompt: value }));
    ElMessage.success("系统提示词已保存");
  } catch (error) {
    ElMessage.error(errorMessage(error, "系统提示词保存失败"));
  }
}
</script>

<style lang="scss" scoped>
.channelPage {
  display: grid;
  gap: 20px;
}

.card {
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);

  .cardHead {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;

    .cardTitle {
      display: grid;
      gap: 4px;
      min-width: 0;

      h3 {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
        line-height: 1.5;
      }
    }
  }

  .emptyHint {
    display: block;
  }
}

.channelRow {
  padding: 12px 0;
  border-top: 1px solid var(--el-border-color-lighter);

  &:first-of-type {
    border-top: 0;
  }

  .rowFields {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;

    .field {
      flex: 1 1 160px;
      min-width: 0;
    }

    .field--name { flex: 0 1 160px; }
    .field--kind { flex: 0 0 104px; }
    .field--pick,
    .field--remove { flex: 0 0 auto; width: auto; }
  }

  .rowMeta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 8px;

    .modelTag {
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .rowSwitch {
      margin-left: auto;
    }
  }
}

.pathForm {
  display: grid;
  gap: 8px;
}

.fieldGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0 16px;

  .gridItem {
    min-width: 0;

    :deep(.el-form-item) {
      margin-bottom: 8px;
    }
  }

  .defaultSelect {
    width: 100%;
  }

  .fieldHint {
    display: block;
    margin-top: 2px;
    line-height: 1.6;
  }
}
</style>
