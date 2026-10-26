<template>
  <nodeSkeleton class="mediaNode" v-bind="nodeProps" v-model:bottomVisible="node.selected"
    :bottomWidth="720" :downloadUrl="previewUrl" :downloadName="outputFile?.url.split(/[\\/]/).at(-1)"
    @fullscreen="enterFullscreen">
    <input ref="fileInput" type="file" accept="audio/*" hidden aria-label="选择音频" :disabled="generating || deleting || uploading" @change="replaceOutput" />
    <div ref="audioContent" class="audioContent nopan" :aria-busy="generating || uploading">
      <audio v-if="previewUrl" ref="audio" class="audioPreview nodrag nowheel" :src="previewUrl" controls preload="metadata"
        aria-label="音频试听" @pointerdown.stop @mousedown.stop @dblclick.stop
        @loadedmetadata="audioFailed = false; updateNodeInternals()" @error="audioFailed = true" />
      <div v-if="audioFailed" class="audioFailure" role="status">
        <span class="emptyHint">{{ previewUrl ? '音频暂时无法播放' : '音频文件无法读取，请重新上传' }}</span>
        <el-button v-if="previewUrl" class="nodrag" text @click.stop="retryAudio">重试播放</el-button>
      </div>
      <div v-else-if="!previewUrl && outputFile" class="mediaEmpty" role="status"><span class="emptyHint">正在加载音频…</span></div>
      <div v-else-if="!outputFile" class="mediaEmpty">
        <el-button class="uploadButton nodrag" text :loading="uploading" :disabled="generating || deleting || uploading" aria-label="上传音频" @dblclick.stop @click.stop="fileInput?.click()">
          <span class="uploadPrompt"><icon-upload :size="32" stroke="1.5" aria-hidden="true" /><span>上传音频</span></span>
        </el-button>
        <span class="emptyHint">{{ generating ? '正在生成语音…' : '或连接文本生成' }}</span>
      </div>
      <span v-if="generating && previewUrl" class="progressText" role="status">正在生成新语音，当前仍可试听上一次结果</span>
    </div>
    <template #bottom>
      <nodeComposer title="音频创作" :referenceCount="refList.length">
        <template #references>
          <referenceItem v-model="refList" @preview="setReferencePreview" @remove="removeReference" />
        </template>
        <el-input v-model="data.prompt" type="textarea" :rows="6" resize="none" :disabled="generating || deleting || uploading"
          placeholder="输入要朗读的文字，或连接文本节点" aria-label="朗读文本" />
        <template #hint>
          <p v-if="referenceHint || capabilityError">{{ referenceHint || capabilityError }}</p>
          <p v-else-if="refList.length">连接的文本按上方顺序接在输入文字之后朗读。</p>
          <p v-if="!modelsLoading && !models.length">请在设置 → 模型渠道中添加音频模型。</p>
          <p v-else-if="data.model && !selectedModel">原模型已不可用，请重新选择语音模型。</p>
          <p v-if="generationError" class="errorText" role="alert">{{ generationError }}</p>
        </template>
        <template #footer>
          <el-select v-model="data.model" class="modelSelect" filterable :loading="modelsLoading" :disabled="generating || deleting || uploading"
            placeholder="选择语音模型" aria-label="语音模型" noDataText="请先在模型渠道中配置音频 API"
            placement="top-start" @visible-change="visible => visible && refreshModels()">
            <template #prefix><icon-sparkles :size="17" /></template>
            <el-option-group v-for="provider in modelGroups" :key="provider.id" :label="provider.label">
              <el-option v-for="item in provider.models" :key="item.modelId" :label="item.label" :value="JSON.stringify([item.providerId, item.modelId])" />
            </el-option-group>
          </el-select>
          <el-popover trigger="click" placement="top-start" width="min(320px, calc(100vw - 24px))" :showArrow="false" :disabled="generating || deleting || uploading">
            <template #reference>
              <el-button class="settingsButton" text :disabled="generating || deleting || uploading" aria-label="音频生成设置">
                <icon-adjustments-horizontal :size="16" aria-hidden="true" />
                <span class="voiceSummary" :title="voiceLabel">{{ voiceLabel }}</span>
                <span v-if="selectedModel?.audioSpeedRange">· {{ data.speed }}×</span><span v-if="data.format">· {{ data.format.toUpperCase() }}</span>
                <icon-chevron-up :size="14" aria-hidden="true" />
              </el-button>
            </template>
            <el-form labelPosition="top" @submit.prevent>
              <div class="speechSettings nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop @wheel.stop>
                <el-form-item label="音色">
                  <el-select :teleported="false" v-if="selectedModel?.voices?.length" v-model="data.voice" filterable aria-label="语音音色" :disabled="generating || deleting || uploading">
                    <el-option v-for="voice in selectedModel.voices" :key="voice.voice" :label="voice.title" :value="voice.voice" />
                  </el-select>
                  <el-input v-else modelValue="渠道默认" aria-label="语音音色 ID" disabled />
                </el-form-item>
                <el-form-item label="语速">
                  <el-input-number v-if="selectedModel?.audioSpeedRange" v-model="data.speed" :min="selectedModel.audioSpeedRange.min" :max="selectedModel.audioSpeedRange.max" :step="0.05" :precision="2" controlsPosition="right"
                    aria-label="语音语速" :disabled="generating || deleting || uploading" />
                  <el-input v-else modelValue="渠道默认" aria-label="语音语速" disabled />
                </el-form-item>
                <el-form-item label="格式">
                  <el-select :teleported="false" v-model="data.format" aria-label="语音格式" :emptyValues="[null, undefined]" :disabled="generating || deleting || uploading || !formats.length">
                    <el-option label="渠道默认" value="" />
                    <el-option v-for="format in formats" :key="format" :label="format.toUpperCase()" :value="format" />
                  </el-select>
                </el-form-item>
              </div>

              <p class="speechHint">只显示模型已声明的参数；未声明项使用渠道默认。保存配置不代表已通过真实生成验证。</p>
              <el-button text :loading="modelsLoading" :disabled="generating || deleting || uploading" @click="refreshModels">刷新模型</el-button>
            </el-form>
          </el-popover>
          <p v-if="!ai.canGenerate" class="speechHint" role="status">隔离试运行暂未开放生成。</p>
          <el-button class="sendButton" :icon="generating ? IconPlayerStop : IconArrowUp"
            :disabled="deleting || uploading || (!generating && (!ai.canGenerate || !selectedModel || !generationPrompt || !!referenceHint || !!capabilityError))"
            :title="generating ? '停止生成' : ai.canGenerate ? '生成语音' : '隔离试运行暂未开放生成'" :aria-label="generating ? '停止生成' : '生成语音'"
            @click="generating ? generationController?.abort() : startGeneration().catch(reportError)" />
        </template>
      </nodeComposer>
    </template>
  </nodeSkeleton>
</template>

<script setup lang="ts">
import { audioNodeIcon } from "@toonflow/nodes-scaffold/nodeIcons";
import { computed, inject, onMounted, onScopeDispose, ref, watch, type Ref } from "vue";
import { ElButton, ElPopover, ElForm, ElFormItem, ElInput, ElInputNumber, ElSelect, ElOption, ElOptionGroup } from "element-plus";
import { IconUpload, IconPlayerStop, IconArrowUp, IconSparkles, IconAdjustmentsHorizontal, IconChevronUp } from "@tabler/icons-vue";
import { getMediaCapabilityError, groupNodeModels, invalidateNodeModels, nodeSkeleton, nodeComposer, nodeTools, showNodeError, useNode, useNodeGeneration, useNodeReferences, z, type NodeMediaModel, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import referenceItem from "@toonflow/nodes-scaffold/referenceItem";

defineOptions({
  inheritAttrs: false,
  icon: audioNodeIcon,
  handles: [
    { id: "in", type: "target", dataType: ["STRING", "IMAGE", "VIDEO", "AUDIO"], label: "参考输入" },
    { id: "audio", type: "source", dataType: "AUDIO", label: "音频输出" },
  ] satisfies NodeHandle[],
});
const { id, node, nodeProps, nodeEvent, outputs, files, ai, updateNodeInternals } = useNode({ label: "音频" });
// ACT: 保留旧类型、节点 ID 和文件引用，只统一内置默认标题。
if (["音频素材", "音频生成", "语音生成"].includes(String(node.data.label))) node.data.label = "音频";
const data = computed(() => node.data as { prompt: string; model: string; voice: string; speed: number; format: string });
data.value.prompt ??= "";
data.value.model ??= "";
data.value.voice ??= "";
data.value.speed ??= 1;
data.value.format ??= "mp3";
const formats = computed(() => selectedModel.value?.audioFormats ?? []);
const { refList, setReferencePreview, removeReference } = useNodeReferences();
const referenceHint = computed(() => refList.value.some(item => item.dataType !== "STRING")
  ? "参考已连接；当前语音生成接口仅支持朗读文本，请先将媒体转为文本或移除此引用。" : "");
const models = ref<NodeMediaModel[]>([]);
const modelsLoading = ref(false);
const deleting = ref(false);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement>();
const generationError = ref("");
const audioContent = ref<HTMLDivElement>();
let disposed = false;
let generationController: AbortController | undefined;
let generation: Promise<void> | undefined;
let modelsRequest: Promise<void> | undefined;
const generationState = useNodeGeneration(outputs, () => generationController?.abort());
const { generating } = generationState;
const selectedModel = computed(() => models.value.find(item => JSON.stringify([item.providerId, item.modelId]) === data.value.model));
const voiceLabel = computed(() => selectedModel.value?.voices?.find(item => item.voice === data.value.voice)?.title || data.value.voice || "渠道默认");
const speechParameters = computed(() => ({ ...(data.value.voice.trim() ? { voice: data.value.voice.trim() } : {}), ...(selectedModel.value?.audioSpeedRange ? { speed: data.value.speed } : {}), ...(data.value.format ? { format: data.value.format } : {}) }));
const capabilityError = computed(() => selectedModel.value ? getMediaCapabilityError(selectedModel.value, "audio", speechParameters.value) : undefined);
const modelGroups = computed(() => groupNodeModels(models.value));
const generationPrompt = computed(() => [data.value.prompt.trim(), ...refList.value.flatMap(item =>
  item.dataType === "STRING" && item.value?.trim() ? [item.value.trim()] : [])].filter(Boolean).join("\n\n"));
const outputFile = computed(() => outputs.value.audio?.dataType === "AUDIO" ? outputs.value.audio.value : undefined);
const audio = ref<HTMLAudioElement>();
const audioFailed = ref(false);
const previewUrl = files.useFileUrl(outputFile, () => { audioFailed.value = true; });
const canvasActive = inject<Readonly<Ref<boolean>>>("nodeCanvasActive", ref(true));
watch(previewUrl, () => { audioFailed.value = false; });
watch(canvasActive, active => { if (!active) audio.value?.pause(); });
async function retryAudio() {
  if (!audio.value) return;
  audioFailed.value = false;
  audio.value.load();
  try { await audio.value.play(); }
  catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) audioFailed.value = true; }
}
watch(selectedModel, choice => {
  if (modelsLoading.value || !choice) return;
  if (choice?.voices?.length && !choice.voices.some(item => item.voice === data.value.voice)) data.value.voice = choice.voices[0]!.voice;
  if (!choice.voices?.length) data.value.voice = "";
  if (!choice.audioFormats?.includes(data.value.format)) data.value.format = "";
  if (choice.audioSpeedRange && (data.value.speed < choice.audioSpeedRange.min || data.value.speed > choice.audioSpeedRange.max)) data.value.speed = Math.min(choice.audioSpeedRange.max, Math.max(choice.audioSpeedRange.min, 1));
}, { flush: "sync" });

onMounted(() => loadModels().catch(error => showNodeError(error, "模型读取失败")));
onScopeDispose(() => { disposed = true; generationController?.abort(); });
function reportError(error: unknown) {
  if (disposed) return;
  generationError.value = error instanceof Error && error.name === "AbortError" ? "生成已取消" : error instanceof Error ? error.message : "语音生成失败";
  showNodeError(error, "语音生成失败");
}
async function refreshModels() {
  invalidateNodeModels("media");
  try { await loadModels(); }
  catch (error) { showNodeError(error, "模型读取失败"); }
}
function loadModels() {
  if (modelsRequest) return modelsRequest;
  modelsLoading.value = true;
  modelsRequest = ai.getMediaModels().then(items => {
    if (disposed || generating.value || deleting.value || uploading.value) return;
    models.value = items.filter(item => item.type === "audio");
  }).finally(() => { modelsLoading.value = false; modelsRequest = undefined; });
  return modelsRequest;
}
async function replaceOutput(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || generating.value || deleting.value || uploading.value || disposed) return;
  if (!file.type.startsWith("audio/")) return void showNodeError("请选择音频文件", "音频替换失败");
  if (!file.size || file.size > 100 * 1024 * 1024) return void showNodeError("音频不能为空且不能超过 100 MB", "音频替换失败");
  uploading.value = true;
  try {
    const workspace = files.getWorkspaceFiles();
    const url = await files.uploadFile(file);
    if (disposed) {
      await workspace.remove(url);
      return;
    }
    // ACT: 保留历史输出文件，避免破坏撤销记录和复制节点的引用。
    outputs.value.audio = { dataType: "AUDIO", value: { url, mimeType: file.type } };
  } catch (error) {
    showNodeError(error, "音频替换失败");
  } finally {
    uploading.value = false;
  }
}

async function enterFullscreen() {
  try { await audioContent.value?.requestFullscreen(); }
  catch (error) { showNodeError(error, "无法进入全屏"); }
}
async function startGeneration() {
  if (disposed || generating.value || deleting.value || uploading.value) throw new Error("节点正在生成或删除，请稍后重试");
  if (referenceHint.value) throw new Error(referenceHint.value);
  const choice = selectedModel.value;
  if (!choice) throw new Error("请先配置并选择语音模型");
  if (!generationPrompt.value) throw new Error("请输入朗读文本或连接文本节点");
  if (refList.value.some(item => item.value === undefined)) throw new Error("引用节点暂无内容，请先补充引用内容");
  if (capabilityError.value) throw new Error(capabilityError.value);
  const workspace = files.getWorkspaceFiles();
  const input = {
    providerId: choice.providerId, modelId: choice.modelId, prompt: generationPrompt.value,
    ...speechParameters.value, outputDirectory: `assets/${id}`,
  };
  const controller = new AbortController();
  generationController = controller;
  generationError.value = "";
  generation = generationState.run(async () => {
    const { directory } = await workspace.list();
    controller.signal.throwIfAborted();
    const [result] = await ai.generateAudio({ ...input, directory }, controller.signal);
    controller.signal.throwIfAborted();
    if (!result) throw new Error("供应商未返回音频");
    outputs.value.audio = { dataType: "AUDIO", value: { url: result.path, mimeType: result.mimeType } };
  }).catch(reportError).finally(() => { generationController = undefined; });
  return { status: "generating" };
}
nodeEvent.on("canUnload", () => !generating.value && !uploading.value && !deleting.value);
nodeEvent.on("save", reason => {
  if (reason === "reload" && (generating.value || deleting.value || uploading.value)) throw new Error("语音处理中，请完成后再刷新节点");
});
nodeEvent.on("delete", async () => {
  if (uploading.value) throw new Error("音频正在上传，请稍后删除节点");
  deleting.value = true;
  generationController?.abort();
  try { await generation; await files.removeNodeFiles(); }
  finally { deleting.value = false; }
});
nodeTools.register({
  name: "setAudio",
  description: "选择工作区内已有的音频文件作为此节点的输出，path 使用工作区相对路径",
  parameters: z.strictObject({
    path: z.string().min(1).max(4096),
    mimeType: z.string().regex(/^audio\/[a-zA-Z0-9.+-]+$/),
  }),
  async execute({ path, mimeType }, { signal }) {
    signal?.throwIfAborted();
    if (disposed || uploading.value || generating.value || deleting.value) throw new Error("音频处理中，请稍后重试");
    uploading.value = true;
    try {
      const content = await files.getWorkspaceFiles().read(path);
      signal?.throwIfAborted();
      if (!content.byteLength || content.byteLength > 100 * 1024 * 1024) throw new Error("音频不能为空且不能超过 100 MB");
      if (disposed) throw new Error("节点已关闭");
      outputs.value.audio = { dataType: "AUDIO", value: { url: path, mimeType } };
      return outputs.value.audio;
    } finally {
      uploading.value = false;
    }
  },
});

function getConfig() {
  return { config: { providerId: selectedModel.value?.providerId ?? "", modelId: selectedModel.value?.modelId ?? "",
    voice: data.value.voice, speed: data.value.speed, format: data.value.format }, models: models.value, formats: formats.value };
}
nodeTools.register({
  name: "getConfig", description: "读取语音节点配置与可选音频模型、音色及格式，不含密钥",
  parameters: z.strictObject({}),
  async execute(_args, { signal }) { signal?.throwIfAborted(); await loadModels(); signal?.throwIfAborted(); return getConfig(); },
});
nodeTools.register({
  name: "setConfig", description: "设置语音模型、音色、语速和格式；providerId 与 modelId 同时提供，不启动生成",
  parameters: z.strictObject({ providerId: z.string().min(1).optional(), modelId: z.string().min(1).optional(),
    voice: z.string().trim().max(256).optional(), speed: z.number().finite().positive().optional(), format: z.string().max(64).optional(),
  }).refine(args => (args.providerId === undefined) === (args.modelId === undefined), "providerId 与 modelId 必须同时提供"),
  async execute(args, { signal }) {
    signal?.throwIfAborted();
    if (generating.value || deleting.value || uploading.value) throw new Error("节点正在生成或删除");
    await loadModels(); signal?.throwIfAborted();
    if (generating.value || deleting.value || uploading.value) throw new Error("节点正在生成或删除");
    const choice = args.modelId === undefined ? selectedModel.value : models.value.find(item => item.providerId === args.providerId && item.modelId === args.modelId);
    if (!choice) throw new Error("请选择 getConfig 返回的有效语音模型");
    if (args.voice && !choice.voices?.some(item => item.voice === args.voice)) throw new Error("当前模型未声明支持该音色");
    if (args.speed !== undefined && (!choice.audioSpeedRange || args.speed < choice.audioSpeedRange.min || args.speed > choice.audioSpeedRange.max)) throw new Error("当前模型未声明支持此语速");
    if (args.format && !choice.audioFormats?.includes(args.format)) throw new Error("当前模型未声明支持此音频格式");
    data.value.model = JSON.stringify([choice.providerId, choice.modelId]);
    if (args.voice !== undefined) data.value.voice = args.voice;
    if (args.speed !== undefined) data.value.speed = args.speed;
    if (args.format !== undefined) data.value.format = args.format;
    return getConfig();
  },
});
nodeTools.register({
  name: "setPrompt", description: "设置要朗读的文本，不启动生成；连接的文本排在此文本之后",
  parameters: z.strictObject({ prompt: z.string() }),
  execute({ prompt }) { if (generating.value || deleting.value || uploading.value) throw new Error("节点正在生成或删除"); data.value.prompt = prompt; return { prompt }; },
});
nodeTools.register({
  name: "generateAudio", description: "使用当前配置启动后台语音生成；getGenerationStatus 查询结果，cancelGeneration 停止生成",
  parameters: z.strictObject({}),
  execute(_args, { signal }) { signal?.throwIfAborted(); return startGeneration(); },
});
</script>

<style scoped lang="scss">
.mediaNode { --node-handle-opacity: 1; --nodeWidth: 360px; --nodeCardHeight: 144px; }
.mediaEmpty {
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 4px;
  min-height: 0;
  height: 100%;
  .uploadButton {
    height: auto;
    min-height: 76px;
    padding: 12px 24px;
    color: var(--el-text-color-regular);
    &:hover { color: var(--el-color-primary); }
    .uploadPrompt { display: grid; justify-items: center; gap: 10px; font-size: 13px; }
  }
  .emptyHint { color: var(--el-text-color-secondary); font-size: 12px; }
}

.audioContent {
  display: grid;
  place-items: center;
  box-sizing: border-box;
  min-height: 0;
  height: 100%;
  padding: 12px;
  gap: 8px;
  .audioPreview { width: 100%; }
  .audioFailure { display: flex; align-items: center; gap: 8px; color: var(--el-text-color-secondary); font-size: 12px; }
  .progressText { color: var(--el-text-color-secondary); font-size: 12px; }
  &:fullscreen { background: var(--el-bg-color); padding: 40px; }
}
.voiceSummary { max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.speechSettings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 12px;
  > :first-child { grid-column: 1 / -1; }
  :deep(.el-input-number) { width: 100%; }
}
.speechHint { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; }
</style>
