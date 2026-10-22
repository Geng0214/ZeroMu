<template>
  <div v-if="loaded" class="channelPage">
    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" showIcon>
      <el-button text @click="loadProviders">重新读取渠道</el-button>
    </el-alert>
    <section class="channelSection">
      <header class="cardHead">
        <div class="cardTitle">
          <h3>模型渠道</h3>
          <el-text type="info" size="small">填写连接信息 → 选择模型 → 确认模型能力 → 前往创作页生成。修改后自动保存，失败时保留输入。</el-text>
        </div>
        <el-button :icon="IconPlus" :disabled="busy" @click="addRow">新增渠道</el-button>
      </header>
      <el-text v-if="!rows.length && !loadError" class="emptyHint" type="info" size="small">还没有模型渠道，点击「新增渠道」开始配置。</el-text>
      <div v-for="row in rows" :key="row.id" class="channelRow">
        <div class="rowFields">
          <div class="channelField"><span>渠道名称</span>
            <el-input v-model="row.label" aria-label="渠道名称" placeholder="例如：我的模型服务" maxlength="60" :disabled="busy" @change="saveRow(row)" />
          </div>
          <div class="channelField"><span>API 格式</span>
          <el-select v-model="row.protocol" aria-label="API 格式" popperClass="channelSettingsPopper" :disabled="busy" @change="changeProtocol(row)">
            <el-option v-for="option in protocolOptions" :key="option.value" :label="option.label" :value="option.value" :disabled="option.disabled" />
          </el-select>
          </div>
          <div class="channelField"><span>API 地址</span>
          <el-input v-model="row.apiUrl" aria-label="API 地址" placeholder="https://api.example.com/v1" spellcheck="false" :disabled="busy" @change="saveRow(row)" />
          </div>
          <div class="channelField"><span>API 密钥</span>
          <el-input v-model="row.apiKey" aria-label="API Key" type="password" showPassword :placeholder="row.apiKeyUnavailable ? '请重新输入密钥' : row.hasApiKey ? '已保存 · 可替换' : '输入 API Key'" autocomplete="new-password" spellcheck="false" maxlength="400" :disabled="busy" @change="saveRow(row)">
            <template v-if="row.hasApiKey && !row.apiKey" #append><el-button :disabled="busy" :aria-label="`清除 ${row.label} 的密钥`" @click="clearStoredKey(row)">清除</el-button></template>
          </el-input>
          </div>
        </div>
        <div class="rowActions">
          <label class="concurrencyField">渠道并发<el-input-number v-model="row.maxConcurrentTasks" :min="1" :max="8" :precision="0" controlsPosition="right" :aria-label="`${row.label || '当前渠道'} 并发任务上限`" :disabled="busy" @change="saveRow(row)" /></label>
          <el-button :disabled="busy || !canSave(row)" @click="openPicker(row)">选择模型</el-button>
          <el-button :disabled="busy || !row.models.length" @click="capabilityRow = row; capabilityVisible = true">模型能力</el-button>
          <el-button :loading="checkingId === row.id" :disabled="busy || !canPull(row) || !row.revision || isDirty(row)" @click="checkConnection(row)">检查连接</el-button>
          <el-button :disabled="busy || !row.revision" @click="refreshChecks(row)">刷新验收状态</el-button>
          <el-popconfirm title="确定删除此渠道及其模型？" popperClass="channelSettingsPopper" confirmButtonText="删除" cancelButtonText="取消" @confirm="removeRow(row)">
            <template #reference>
              <el-button :disabled="busy || (!!deletingId && deletingId !== row.id)">删除渠道</el-button>
            </template>
          </el-popconfirm>
        </div>
        <div v-if="row.loadError || row.saveError || !row.revision || !row.hasApiKey || row.apiKeyUnavailable" class="rowStatus">
          <el-text v-if="row.saveError" type="danger" size="small" role="alert">{{ row.saveError }}</el-text>
          <el-tag v-if="row.loadError" size="small" type="danger" effect="plain" :title="row.loadError">文件读取失败</el-tag>
          <el-tag v-else-if="!row.revision" size="small" type="warning" effect="plain">未保存</el-tag>
          <el-tag v-if="row.apiKeyUnavailable" size="small" type="warning" effect="plain">密钥无法解密，请重新输入</el-tag>
          <el-tag v-else-if="row.revision && !row.hasApiKey" size="small" type="warning" effect="plain">未配置密钥</el-tag>
        </div>
        <ul class="verificationList" :aria-label="`${row.label || '当前渠道'} 验收状态`" aria-live="polite">
          <li><span>保存配置</span><strong>{{ savingId === row.id ? '保存中…' : row.saveError ? '保存失败' : !row.revision || isDirty(row) ? '待保存' : '已保存' }}</strong></li>
          <li v-for="field in checkFields" :key="field.key"><span>{{ field.label }}</span><strong :class="{ checkFailed: currentChecks(row)?.[field.key]?.status === 'failed' }" :title="currentChecks(row)?.[field.key]?.message">{{ currentChecks(row)?.[field.key]?.message || '尚未检查' }}</strong><time v-if="currentChecks(row)?.[field.key]">{{ checkTime(currentChecks(row)![field.key]!.checkedAt) }}</time></li>
          <li><span>生成验收</span><div v-if="currentChecks(row)?.generation.length" class="generationChecks"><span v-for="check in currentChecks(row)!.generation" :key="check.modelId" :title="`任务 ${check.taskId}`">{{ check.modelId }} · {{ generationLabels[check.status] || check.status }}<time>{{ checkTime(check.checkedAt) }}</time></span></div><strong v-else>当前配置尚无已提交的生成回执</strong></li>
        </ul>
        <el-text v-if="checkErrors[row.id]" type="danger" size="small" role="alert">{{ checkErrors[row.id] }}</el-text>
        <el-text class="verificationHint" type="info" size="small">连接与模型列表检查使用模型目录接口，不发起生成。生成状态来自本机任务回执，仅证明对应模型；费用未核实时按未知处理。</el-text>
      </div>
    </section>

    <section class="modelListSection" aria-label="模型列表">
      <header class="modelListHeader">
        <div class="modelSummary"><h3>已接入 {{ savedModelCount }} 个模型</h3><el-text type="info" size="small">{{ modelCountSummary }}</el-text></div>
        <el-button :icon="IconRefresh" :loading="pullingAll" :disabled="busy || !rows.some(canPull)" @click="pullAllModels">拉取全部渠道</el-button>
      </header>
      <div v-if="pullReports.length" class="pullReports" aria-live="polite">
        <div v-for="report in pullReports" :key="report.id" class="pullReport">
          <span class="reportName" :title="report.label">{{ report.label }}</span>
          <el-text class="reportStatus" :type="report.error ? 'warning' : 'info'" size="small">{{ report.message }}</el-text>
          <el-button v-if="report.count" :disabled="busy" :aria-label="`选择 ${report.label} 的模型`" @click="selectPulled(report.id)">选择模型</el-button>
        </div>
      </div>
    </section>

    <section class="systemSpeechSection" aria-label="本机配音">
      <header class="cardHead">
        <div class="cardTitle">
          <h3>Windows 系统配音</h3>
          <el-text type="info" size="small">使用运行设备已安装的系统音色，无需 API 地址和密钥，支持 MP3、WAV。</el-text>
        </div>
      </header>
      <el-alert v-if="systemSpeechProvider?.loadError" :title="systemSpeechProvider.loadError" type="warning" :closable="false" showIcon />
      <el-text v-else-if="systemSpeechProvider" class="emptyHint" type="info" size="small" aria-live="polite">已启用 · {{ systemSpeechVoiceCount }} 个音色。前往音频创作，选择「Windows 系统语音」开始配音。</el-text>
      <div class="systemSpeechActions">
        <el-button v-if="!systemSpeechProvider" :loading="systemSpeechBusy" :disabled="busy" @click="enableSystemSpeech">启用本机配音</el-button>
        <template v-else>
          <el-button :loading="systemSpeechBusy" :disabled="busy" @click="refreshSystemSpeech">刷新状态</el-button>
          <el-popconfirm title="停用后将不再提供新配音，已生成音频仍会保留。" popperClass="channelSettingsPopper" confirmButtonText="停用" cancelButtonText="取消" @confirm="removeRow(systemSpeechProvider)">
            <template #reference><el-button :disabled="busy">停用本机配音</el-button></template>
          </el-popconfirm>
        </template>
      </div>
    </section>

    <section class="backgroundRemovalSection" aria-label="本机背景移除">
      <header class="cardHead"><div class="cardTitle"><h3>本机背景移除</h3><el-text type="info" size="small">使用 BiRefNet 分离图片主体与背景，输出原尺寸透明 PNG。素材只在本机处理，无需 API Key；首次下载约 224 MB。</el-text></div></header>
      <p v-if="backgroundRemovalStatus?.phase === 'downloading'" class="backgroundDownloadText" role="status">{{ backgroundCancelRequested ? '正在停止下载…' : `正在下载模型 · ${(backgroundRemovalStatus.received / 1000000).toFixed(1)} / 224.0 MB` }}</p>
      <el-progress v-if="backgroundRemovalStatus?.phase === 'downloading'" :percentage="backgroundDownloadPercent" :strokeWidth="8" :showText="false" aria-label="背景模型下载进度" />
      <p v-else-if="backgroundRemovalStatus?.phase === 'ready'" class="backgroundDownloadText" role="status">{{ backgroundRemovalProvider && !backgroundRemovalProvider.loadError ? '已启用 · 前往生图创作选择「BiRefNet 背景移除 · 本机」，添加一张图片。' : '模型已就绪，启用后可在生图创作中选择。' }}</p>
      <p v-else-if="backgroundRemovalStatus?.phase === 'cancelled'" class="backgroundDownloadText" role="status">下载已取消，可以重新下载。原项目和素材保持完整。</p>
      <p v-else-if="!backgroundRemovalStatus && !backgroundReadError" class="backgroundDownloadText" role="status">正在读取本机模型状态…</p>
      <el-alert v-if="backgroundReadError || backgroundRemovalStatus?.error || backgroundRemovalProvider?.loadError" :title="backgroundReadError || backgroundRemovalStatus?.error || backgroundRemovalProvider?.loadError || ''" type="warning" :closable="false" showIcon />
      <div class="backgroundRemovalActions">
        <el-button v-if="backgroundRemovalStatus?.phase === 'downloading'" :loading="backgroundActionBusy || backgroundCancelRequested" :disabled="backgroundCancelRequested" @click="cancelBackgroundDownload">取消下载</el-button>
        <el-button v-else-if="backgroundRemovalStatus?.phase !== 'ready'" :loading="backgroundActionBusy" :disabled="busy || !backgroundRemovalStatus" @click="downloadBackgroundModel">{{ backgroundRemovalStatus?.phase === 'failed' ? '重新下载（保留现有文件）' : '下载模型（224 MB）' }}</el-button>
        <el-button v-else-if="!backgroundRemovalProvider" :loading="backgroundActionBusy" :disabled="busy" @click="enableBackgroundRemoval">启用本机背景移除</el-button>
        <el-button :disabled="busy || backgroundCancelRequested" @click="refreshBackgroundRemoval">刷新状态</el-button>
        <el-popconfirm v-if="backgroundRemovalProvider" title="停用后不再提供新处理，模型和已生成图片保留。" popperClass="channelSettingsPopper" confirmButtonText="停用" cancelButtonText="取消" @confirm="removeRow(backgroundRemovalProvider)"><template #reference><el-button :disabled="busy || backgroundRemovalStatus?.phase === 'downloading'">停用本机背景移除</el-button></template></el-popconfirm>
      </div>
      <el-text class="backgroundModelHint" type="info" size="small">需先在「扩展管理」配置 FFmpeg。CPU 每次处理一张图片；复杂边缘与半透明物体请预览后再采用。<a href="https://github.com/ZhengPeng7/BiRefNet" target="_blank" rel="noopener noreferrer">模型与 MIT 授权说明</a></el-text>
    </section>

    <section class="defaultsSection" aria-label="默认模型">
      <header class="cardHead">
        <div class="cardTitle">
          <h3>默认模型</h3>
        </div>
      </header>
      <div class="fieldGrid">
        <el-form v-for="field in defaultFields" :key="field.kind" class="gridItem" labelPosition="top" @submit.prevent>
          <el-form-item :label="`${field.label}（${optionsFor(field.kind).reduce((count, group) => count + group.options.length, 0)}）`">
            <el-select
              :model-value="defaultValue(field.kind)"
              class="defaultSelect"
              popperClass="channelSettingsPopper"
              placeholder="未设置"
              :aria-label="field.label"
              :disabled="busy"
              noDataText="暂无模型，请先拉取渠道模型"
              clearable
              filterable
              @update:model-value="value => setDefault(field.kind, typeof value === 'string' ? value : '')">
              <el-option-group v-for="group in optionsFor(field.kind)" :key="group.id" :label="group.label">
                <el-option v-for="option in group.options" :key="option.value" :label="option.label" :value="option.value" />
              </el-option-group>
            </el-select>
          </el-form-item>
        </el-form>
      </div>
    </section>

    <section class="creationSection" aria-label="创作默认参数">
      <header class="cardHead"><div class="cardTitle"><h3>生成参数</h3><el-text type="info" size="small">用于新建节点与草稿，创作时仍可单独调整。</el-text></div></header>
      <div class="fieldGrid">
        <el-form labelPosition="top" @submit.prevent>
          <el-form-item label="生图数量"><el-input-number v-model="preferenceDraft.imageCount" :min="1" :max="10" :precision="0" controlsPosition="right" aria-label="画布默认生图张数" @change="value => savePreference('imageCount', value)" /></el-form-item>
        </el-form>
        <el-form labelPosition="top" @submit.prevent>
          <el-form-item label="音频音色"><el-select v-model="preferenceDraft.voice" filterable allowCreate defaultFirstOption aria-label="默认音频声音" @change="value => savePreference('voice', value)"><el-option v-for="voice in ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']" :key="voice" :label="voice[0].toUpperCase() + voice.slice(1)" :value="voice" /></el-select></el-form-item>
          <el-text type="info" size="small">可填写模型支持的音色 ID。</el-text>
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
          <el-text type="info" size="small">{{ option.description }}</el-text>
        </div>
      </div>
    <section class="promptSection">
      <header class="cardHead">
        <div class="cardTitle">
          <h3>系统提示词</h3>
          <el-text type="info" size="small">覆盖 AI 助手与文本节点的基础指令，留空使用内置提示词。日常风格请在「创作偏好」中设置。</el-text>
        </div>
      </header>
      <el-input
        v-model="promptDraft"
        type="textarea"
        :rows="4"
        :maxlength="promptMaxLength || undefined"
        showWordLimit
        resize="vertical"
        placeholder="留空使用内置提示词"
        aria-label="系统提示词"
        @change="savePrompt" />
    </section>
    </details>

    <component :is="modelPicker" v-if="pickingRow" v-model="pickerVisible" :channel="pickingRow" :saving="!!savingId" :initialCandidates="candidatesFor(pickingRow)" @picked="onPicked" @fetched="onFetched" />
    <modelCapabilitiesDialog v-if="capabilityRow" v-model="capabilityVisible" :channel="capabilityRow" :saving="!!savingId" :saveError="capabilityRow.saveError" @save="saveCapabilities" />
  </div>
  <el-skeleton v-else :rows="6" animated aria-label="正在读取模型配置" />
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Component } from "vue";
import { ElMessage } from "element-plus";
import { IconPlus, IconRefresh } from "@tabler/icons-vue";
import { invalidateNodeModels } from "@toonflow/nodes-scaffold/modelCache";
import windowsSpeechSource from "@toonflow/providers/media/windowsSpeech?raw";
import biRefNetSource from "@toonflow/providers/media/biRefNet?raw";
import { customProviders, modelChoices, saveSettings, syncSettings, settings } from "@/stores/settings";
import type { MediaProvider } from "../mediaModel/types";
import { kindLabels, protocolOptions, protocolKinds, type MediaChannelKind, type MediaChannelModel, type MediaChannelRow } from "./types";

import fetchChannelModels, { type ChannelCandidate } from "./fetchChannelModels";
import { creationPreferences, audioFormats } from "@/lib/creationPreferences";
import modelCapabilitiesDialog from "./modelCapabilitiesDialog.vue";
const capabilityRow = ref<MediaChannelRow>(); const capabilityVisible = ref(false);
async function saveCapabilities(models: MediaChannelModel[]) { const row = capabilityRow.value; if (!row) return; const previous = row.models; row.models = models; if (await saveRow(row)) capabilityVisible.value = false; else row.models = previous; }

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
const systemSpeechBusy = ref(false);
type BackgroundRemovalStatus = { phase: "idle" | "downloading" | "ready" | "cancelled" | "failed"; received: number; error?: string };
const backgroundRemovalStatus = ref<BackgroundRemovalStatus>();
const backgroundRemovalProvider = computed(() => providers.value.find(provider => provider.id === "biRefNet"));
const backgroundDownloadPercent = computed(() => Math.min(100, Math.floor((backgroundRemovalStatus.value?.received ?? 0) / 224005088 * 100)));
const backgroundActionBusy = ref(false);
const backgroundCancelRequested = ref(false);
const backgroundReadError = ref("");
let backgroundReader: AbortController | undefined;
let backgroundPoll: ReturnType<typeof setTimeout> | undefined;
let backgroundDisposed = false;
const systemSpeechProvider = computed(() => providers.value.find(provider => provider.id === "windowsSpeech"));
const systemSpeechVoiceCount = computed(() => {
  const voices = systemSpeechProvider.value?.models.find(model => model.type === "audio")?.voices;
  return Array.isArray(voices) ? voices.length : 0;
});
const pickingRow = ref<MediaChannelRow>();
const pickerVisible = ref(false);
const promptDraft = ref("");
const promptDefault = ref("");
const promptMaxLength = ref(0);
let loadRequest = 0;
const savedRows = new Map<string, string>();
function rowSnapshot(row: MediaChannelRow) { const { revision, loadError, saveError, fileName, ...draft } = row; return JSON.stringify(draft); }
function isDirty(row: MediaChannelRow) { return rowSnapshot(row) !== savedRows.get(row.id); }
type ChannelChecks = { revision: string; connection?: { status: string; checkedAt: number; message: string }; models?: { status: string; checkedAt: number; message: string }; generation: { modelId: string; taskId: string; status: string; checkedAt: number }[] };
const checks = ref<Record<string, ChannelChecks>>({});
const checkErrors = ref<Record<string, string>>({});
const checkingId = ref("");
const checkFields = [{ key: "connection", label: "检查连接" }, { key: "models", label: "模型列表" }] as const;
const generationLabels: Record<string, string> = { queued: "排队中", submitting: "提交中", running: "生成中", downloading: "取回中", interrupted: "待恢复", unknown: "待核对", completed: "已完成", partial: "部分完成", failed: "失败", cancelled: "已取消" };
function currentChecks(row: MediaChannelRow) { return !isDirty(row) && checks.value[row.id]?.revision === row.revision ? checks.value[row.id] : undefined; }
function checkTime(value: number) { return new Date(value).toLocaleString(); }
async function refreshChecks(row: MediaChannelRow) {
  if (!row.revision) return;
  try { const { data } = await axios.get<{ data: ChannelChecks }>("/api/mediaChannel/status", { params: { id: row.id } }); checks.value[row.id] = data.data; delete checkErrors.value[row.id]; }
  catch (cause) { checkErrors.value[row.id] = errorMessage(cause, "读取验收状态失败，请重试"); }
}
async function checkConnection(row: MediaChannelRow) {
  if (busy.value || isDirty(row)) return;
  checkingId.value = row.id;
  try { await axios.post("/api/mediaChannel/check", { id: row.id, apiUrl: row.apiUrl.trim(), protocol: row.protocol }, { timeout: 35000, headers: { "x-toonflow-workspace": "1" } }); }
  catch (cause) { ElMessage.error(errorMessage(cause, "检查连接失败")); }
  finally { checkingId.value = ""; await refreshChecks(row); }
}

const pullingAll = ref(false);
const pullReports = ref<{ id: string; label: string; message: string; error?: boolean; count?: number }[]>([]);
const pulledModels = ref<Record<string, { connection: string; models: ChannelCandidate[] }>>({});
let pullController: AbortController | undefined;
const savedModelCount = computed(() => defaultFields.reduce((count, field) => count + optionsFor(field.kind).reduce((total, group) => total + group.options.length, 0), 0));
const modelCountSummary = computed(() => Object.entries(kindLabels).map(([kind, label]) => `${label} ${optionsFor(kind as MediaChannelKind).reduce((count, group) => count + group.options.length, 0)}`).join(" / "));
const preferenceDraft = ref({ ...creationPreferences.value });
const creationSwitches = [
  { key: "streamImages", label: "流式传输", description: "OpenAI 图片接口使用流式请求，持续读取事件并保存最终图片。" },
  { key: "returnBase64", label: "返回 Base64 图片数据", description: "OpenAI 图片请求使用 b64_json 返回格式。" },
  { key: "codexCli", label: "Codex CLI 兼容模式", description: "OpenAI 图片请求省略质量参数，逐张生成，并添加防止改写提示词的前缀。" },
] as const;
async function savePreference(key: keyof typeof creationPreferences.value, value: unknown) {
  if (value === undefined || value === null) return;
  try { await saveSettings(current => ({ mediaCreationPreferences: { ...creationPreferences.value, ...record(current.mediaCreationPreferences), [key]: value } })); }
  catch (error) { preferenceDraft.value = { ...creationPreferences.value }; ElMessage.error(errorMessage(error, "默认参数保存失败")); }
}
const busy = computed(() => !!savingId.value || !!deletingId.value || pullingAll.value || !!checkingId.value || systemSpeechBusy.value || backgroundActionBusy.value);
function connectionKey(row: MediaChannelRow) { return JSON.stringify([row.protocol, row.apiUrl.trim(), row.apiKey.trim(), row.apiKeyRevision]); }
function canPull(row: MediaChannelRow) { return canSave(row) && (!!row.apiKey.trim() || (row.hasApiKey && !row.apiKeyUnavailable)) && row.protocol !== "minimax" && !row.loadError; }
function candidatesFor(row: MediaChannelRow) { const cached = pulledModels.value[row.id]; return cached?.connection === connectionKey(row) ? cached.models : []; }
function cacheModels(row: MediaChannelRow, models: ChannelCandidate[]) { pulledModels.value[row.id] = { connection: connectionKey(row), models }; }
function reportModels(row: MediaChannelRow, models: ChannelCandidate[]) {
  cacheModels(row, models);
  const supported = models.filter(model => !!model.type).length;
  const message = `获取 ${models.length} · 可接入 ${supported} · 不支持 ${models.length - supported} · 已接入 ${row.models.length}`;
  const report = pullReports.value.find(item => item.id === row.id);
  const next = { id: row.id, label: row.label, count: models.length, message, error: false };
  if (report) Object.assign(report, next); else pullReports.value.push(next);
}
function onFetched(models: ChannelCandidate[]) { if (pickingRow.value) { reportModels(pickingRow.value, models); void refreshChecks(pickingRow.value); } }
watch(() => rows.value.map(row => [row.id, connectionKey(row), row.label]), () => {
  for (const report of [...pullReports.value]) {
    const row = rows.value.find(item => item.id === report.id);
    if (!row || (pulledModels.value[report.id] && pulledModels.value[report.id].connection !== connectionKey(row))) {
      delete pulledModels.value[report.id];
      pullReports.value = pullReports.value.filter(item => item.id !== report.id);
    } else if (row) report.label = row.label;
  }
});
function selectPulled(id: string) { const row = rows.value.find(item => item.id === id); if (row) openPicker(row); }
async function pullAllModels() {
  if (busy.value || !rows.value.some(canPull)) return;
  pullingAll.value = true;
  pullController = new AbortController();
  const { signal } = pullController;
  const channels = rows.value.map(row => ({ ...row }));
  pullReports.value = channels.map(row => ({ id: row.id, label: row.label || "未命名渠道", message: canPull(row) ? "等待拉取…" : row.protocol === "minimax" ? "请手动添加模型 ID" : "已跳过：请检查地址、密钥和渠道状态" }));
  try {
    // ACT: 每批最多三个渠道，单个失败不影响其他渠道，也不覆盖已保存模型。
    for (let start = 0; start < channels.length && !signal.aborted; start += 3) {
      await Promise.all(channels.slice(start, start + 3).map(async row => {
        if (!canPull(row)) return;
        const report = pullReports.value.find(item => item.id === row.id)!;
        report.message = "正在拉取…";
        try {
          const models = await fetchChannelModels(row, signal);
          if (signal.aborted) return;
          reportModels(row, models);
        } catch (error) {
          if (signal.aborted) return;
          delete pulledModels.value[row.id];
          Object.assign(report, { error: true, message: errorMessage(error, "拉取失败，请重试") });
        }
      }));
    }
  } finally { pullingAll.value = false; pullController = undefined; await Promise.all(rows.value.map(refreshChecks)); }
}
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
  void loadPrompt();
  void readBackgroundStatus();
  window.addEventListener("toonflow:plugin-installed", refreshInstalled);
});
onBeforeUnmount(() => {
  pullController?.abort();
  backgroundDisposed = true; backgroundReader?.abort(); clearTimeout(backgroundPoll);
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
    await Promise.all(rows.value.map(refreshChecks));
  } catch (error) {
    if (request === loadRequest) loadError.value = errorMessage(error, "读取模型渠道失败，请重试");
  } finally {
    if (request === loadRequest) loaded.value = true;
  }
}

async function loadPrompt() {
  const saved = settings.value.agentSystemPrompt;
  promptDraft.value = typeof saved === "string" && saved.trim() ? saved : "";
  try {
    const { data } = await axios.get<{ code: number; data: { defaultSystemPrompt: string; maxLength: number } }>("/api/settings/systemPrompt", { headers: { "x-toonflow-workspace": "1" } });
    if (typeof data.data?.defaultSystemPrompt !== "string") return;
    promptDefault.value = data.data.defaultSystemPrompt;
    promptMaxLength.value = data.data.maxLength;
  } catch { /* ACT: 读取失败时只隐藏字数上限，不影响渠道配置。 */ }
}

async function enableSystemSpeech() {
  if (busy.value) return;
  systemSpeechBusy.value = true;
  try {
    await axios.post("/api/providers/media/add", { source: windowsSpeechSource });
    await loadProviders();
    invalidateNodeModels("media");
    if (!loadError.value) ElMessage.success("本机配音已启用，请在音频创作中刷新模型并选择音色");
  } catch (error) { ElMessage.error(errorMessage(error, "启用本机配音失败，请检查 Windows 系统音色")); }
  finally { systemSpeechBusy.value = false; }
}

async function refreshSystemSpeech() {
  if (busy.value) return;
  systemSpeechBusy.value = true;
  try { await loadProviders(); invalidateNodeModels("media"); }
  finally { systemSpeechBusy.value = false; }
}

async function readBackgroundStatus() {
  if (backgroundDisposed) return;
  clearTimeout(backgroundPoll); backgroundReader?.abort();
  const reader = backgroundReader = new AbortController();
  try {
    const { data } = await axios.get<{ data: BackgroundRemovalStatus }>("/api/providers/backgroundRemoval/status", { signal: reader.signal });
    if (reader.signal.aborted || backgroundDisposed) return;
    backgroundRemovalStatus.value = data.data; backgroundReadError.value = "";
    if (data.data.phase !== "downloading") backgroundCancelRequested.value = false;
    if (data.data.phase === "downloading") backgroundPoll = setTimeout(readBackgroundStatus, 1200);
  } catch (error) { if (!reader.signal.aborted && !backgroundDisposed) backgroundReadError.value = errorMessage(error, "无法读取本机模型状态，请刷新重试"); }
}

async function downloadBackgroundModel() {
  if (busy.value) return;
  backgroundActionBusy.value = true; backgroundReadError.value = "";
  try { await axios.post("/api/providers/backgroundRemoval/download", {}, { headers: { "x-toonflow-workspace": "1" } }); await readBackgroundStatus(); }
  catch (error) { backgroundReadError.value = errorMessage(error, "模型下载未能开始，请重试"); }
  finally { backgroundActionBusy.value = false; }
}

async function cancelBackgroundDownload() {
  if (backgroundCancelRequested.value) return;
  backgroundCancelRequested.value = true; backgroundActionBusy.value = true;
  try { await axios.post("/api/providers/backgroundRemoval/cancel", {}, { headers: { "x-toonflow-workspace": "1" } }); await readBackgroundStatus(); }
  catch (error) { backgroundCancelRequested.value = false; backgroundReadError.value = errorMessage(error, "取消下载未完成，请刷新状态"); }
  finally { backgroundActionBusy.value = false; }
}

async function enableBackgroundRemoval() {
  if (busy.value) return;
  backgroundActionBusy.value = true;
  try {
    await axios.post("/api/providers/media/add", { source: biRefNetSource }); await loadProviders(); invalidateNodeModels("media");
    if (!loadError.value) ElMessage.success("本机背景移除已启用，请在生图创作中刷新模型并添加一张图片");
  } catch (error) { backgroundReadError.value = errorMessage(error, "启用本机背景移除失败，请核对模型和 FFmpeg"); }
  finally { backgroundActionBusy.value = false; }
}

async function refreshBackgroundRemoval() {
  if (busy.value) return;
  backgroundActionBusy.value = true;
  try { await readBackgroundStatus(); await loadProviders(); invalidateNodeModels("media"); }
  finally { backgroundActionBusy.value = false; }
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
    const fresh = rows.value.find(item => item.id === row.id);
    if (fresh && pulledModels.value[fresh.id]?.connection === connectionKey(fresh)) reportModels(fresh, candidatesFor(fresh));
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
    ElMessage.warning("该 API 格式不支持渠道中部分模型的用途，请先在“选择”中调整模型");
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
    pullReports.value = pullReports.value.filter(item => item.id !== row.id);
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
  if (savingId.value || pullingAll.value) return;
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
  gap: 24px;
  font-size: 13px;
  :deep(.el-input__wrapper), :deep(.el-select__wrapper) { min-height: 32px; font-size: 13px; }
  :deep(.el-button) { margin-left: 0; }
  :deep(.el-text--small) { font-size: 12px; line-height: 1.6; }
  :deep(.el-input__inner)::placeholder { color: var(--el-text-color-placeholder); }
  .cardHead { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  .cardTitle { display: grid; gap: 3px; min-width: 0; h3 { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.5; } }
  .emptyHint { display: block; padding: 5px 0; }
  .channelRow {
    padding: 14px;
    margin-top: 12px;
    background: var(--el-fill-color-light);
    border-radius: var(--ui-radius, 8px);
    .rowFields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px;
      .channelField { display: grid; gap: 6px; min-width: 0; > span { font-size: 12px; color: var(--el-text-color-regular); } }
    }
    .rowActions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 12px;
      .concurrencyField { display: inline-flex; align-items: center; gap: 8px; margin-right: auto; font-size: 12px; color: var(--el-text-color-secondary); .el-input-number { width: 96px; } }
    }
    .rowStatus { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 6px; min-height: 22px; }
    .verificationList { list-style: none; margin: 14px 0 8px; padding: 0; border-top: 1px solid var(--el-border-color-lighter); font-size: 12px;
      li { display: grid; grid-template-columns: 76px minmax(0, 1fr) auto; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--el-border-color-extra-light); line-height: 1.6; align-items: start;
        > span { color: var(--el-text-color-secondary); }
        strong { font-weight: 400; overflow-wrap: anywhere; }
        time { color: var(--el-text-color-secondary); font-size: 11px; }
        .checkFailed { color: var(--el-color-danger); }
        .generationChecks { display: grid; gap: 4px; overflow-wrap: anywhere; > span { display: flex; flex-wrap: wrap; gap: 4px 12px; } }
      }
      @media (max-width: 700px) { li { grid-template-columns: 70px minmax(0, 1fr); > time { grid-column: 2; } } }
    }
    .verificationHint { display: block; line-height: 1.6; }
  }
  .modelListSection { padding-bottom: 20px; border-bottom: 1px solid var(--el-border-color-lighter);
    .modelListHeader { display: flex; align-items: center; justify-content: space-between; gap: 12px; >.el-button { flex-shrink: 0; } }
    .modelSummary { display: grid; gap: 4px; min-width: 0; h3 { margin: 0; font-size: 14px; line-height: 1.5; } }
    .pullReports { margin-top: 12px; border-top: 1px solid var(--el-border-color-lighter); max-height: 240px; overflow: auto; scrollbar-width: thin; scrollbar-color: var(--el-border-color) transparent; }
    .pullReport { display: grid; grid-template-columns: minmax(100px, .8fr) minmax(0, 2fr) auto; align-items: center; gap: 16px; min-height: 48px; padding: 10px 0; border-bottom: 1px solid var(--el-border-color-extra-light);
      &:last-child { border-bottom: 0; padding-bottom: 0; }
      .reportName { font-size: 13px; overflow-wrap: anywhere; }
      .reportStatus { justify-self: start; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
      >.el-button { grid-column: 3; }
    }
    @media (max-width: 620px) {
      .modelListHeader { align-items: flex-start; }
      .modelSummary { flex-direction: column; align-items: flex-start; gap: 4px; }
      .pullReport { grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px;
        .reportName { grid-column: 1; grid-row: 1; }
        .reportStatus { grid-column: 1; grid-row: 2; }
        >.el-button { grid-column: 2; grid-row: 1 / 3; }
      }
    }
  }
  .systemSpeechSection {
    .systemSpeechActions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
  }
  .backgroundRemovalSection {
    .backgroundDownloadText { margin: 8px 0; line-height: 1.6; color: var(--el-text-color-regular); }
    .backgroundRemovalActions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; :deep(.el-button + .el-button) { margin-left: 0; } }
    .backgroundModelHint { display: block; margin-top: 12px; line-height: 1.6; a { color: var(--el-color-primary); text-decoration: underline; text-underline-offset: 3px; } }
    @media (max-width: 600px) { .backgroundRemovalActions :deep(.el-button) { min-height: 44px; max-width: 100%; white-space: normal; } }
  }
  .defaultsSection { .cardHead { margin-bottom: 14px; } }
  .fieldGrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;
    .gridItem { min-width: 0; }
    :deep(.el-form-item) { margin-bottom: 0; }
    :deep(.el-form-item__label) { font-size: 12px; margin-bottom: 6px; line-height: 1.5; color: var(--el-text-color-regular); }
    .defaultSelect { width: 100%; }
  }
  .promptSection { margin-top: 24px; :deep(.el-textarea__inner) { font-size: 13px; line-height: 1.7; } }
  .creationSection {
    :deep(.el-input-number), :deep(.el-select) { width: 100%; }
  }
  .advancedSettings {
    .switchGrid { display: grid; gap: 16px; }
    .switchHeading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 2px; font-weight: 500; > .el-switch { flex-shrink: 0; } }
  }
  @media (max-width: 900px) { .fieldGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 620px) {
    .cardHead { flex-wrap: wrap; }
    .channelRow .rowFields { grid-template-columns: minmax(0, 1fr); }
    .modelListSection .modelListHeader { flex-wrap: wrap; }
  }
}
</style>
