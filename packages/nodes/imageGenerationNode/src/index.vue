<template>
  <nodeSkeleton class="mediaNode"
    v-bind="nodeProps"
    v-model:bottomVisible="node.selected"
    :downloadUrl="originalUrl"
    :downloadName="outputFile?.url.split(/[\\/]/).at(-1)"
    @fullscreen="previewVisible = true"
    :bottomWidth="720">
    <input ref="fileInput" type="file" accept="image/*" hidden aria-label="选择图片" :disabled="generating || deleting || uploading" @change="replaceOutput" />
    <div v-loading="generating || uploading" class="imageContent nopan" :aria-busy="generating || uploading">
      <img
        v-if="previewUrl"
        class="imagePreview"
        :src="previewUrl"
        draggable="false"
        alt="图片"
        role="button"
        tabindex="0"
        aria-label="放大图片"
        @load="resizeImage"
        @click.stop="previewVisible = true"
        @keydown.enter.stop="previewVisible = true"
        @keydown.space.stop.prevent="previewVisible = true"
        @error="handlePreviewError" />
      <span v-if="previewUrl && imageDimensions" class="imageInfo">{{ imageDimensions }}<template v-if="imageFileSize"> · {{ imageFileSize }}</template></span>
      <div v-else-if="outputFile" class="mediaEmpty">
        <template v-if="previewFailed && originalUrl">
          <el-button class="nodrag" text @click.stop="previewFailed = false">重新加载</el-button>
          <el-button class="nodrag" text :disabled="!originalUrl" @click.stop="previewVisible = true">查看原图</el-button>
        </template>
        <span class="emptyHint">{{ previewFailed ? (originalUrl ? '图片无法加载，请重试' : '原图无法读取，请重新上传图片') : '正在加载图片…' }}</span>
      </div>
      <div v-else class="mediaEmpty">
        <el-button class="uploadButton nodrag" text :disabled="generating || deleting || uploading" aria-label="上传图片" @dblclick.stop @click.stop="fileInput?.click()">
          <span class="uploadPrompt"><icon-upload :size="32" stroke="1.5" aria-hidden="true" /><span>上传图片</span></span>
        </el-button>
        <span class="emptyHint">或连接输入生成</span>
      </div>
    </div>
    <template #bottom>
      <nodeComposer title="图片创作" :referenceCount="refList.length">
        <template #references>
          <referenceItem
            v-if="refList.length"
            v-model="refList"
            @preview="setReferencePreview"
            @remove="removeReference" />
        </template>
        <template #hint><p v-if="referenceHint || capabilityError">{{ referenceHint || capabilityError }}</p><p v-else-if="selectedModel">参数使用模型已声明的能力；未声明项使用渠道默认。</p></template>
        <template #default="{ expanded }">
          <promptInput v-model="data.promptModel" v-model:text="data.prompt" :references="referenceMentions" :minHeight="160" placeholder="描述想生成的画面，输入 @ 引用参考" :expandedLayout="expanded" />
        </template>
        <template #footer>
          <el-select
            v-model="data.model"
            class="modelSelect"
            filterable
            :loading="modelsLoading"
            :disabled="generating || deleting"
            placeholder="选择模型"
            aria-label="生成模型"
            noDataText="请先在设置中添加图片模型"
            placement="top-start"
            @visible-change="(visible) => visible && loadModels().catch((error) => showNodeError(error, '模型读取失败'))">
            <template #prefix><icon-sparkles :size="17" /></template>
            <el-option-group v-for="provider in modelGroups" :key="provider.id" :label="provider.label">
              <el-option
                v-for="item in provider.models"
                :key="item.modelId"
                :label="item.label"
                :value="JSON.stringify([item.providerId, item.modelId])" />
            </el-option-group>
          </el-select>
          <generationSettings
            v-model:quality="data.quality"
            v-model:count="data.n"
            v-model:size="data.size"
            v-model:ratio="data.ratio"
            :sizes="sizeOptions"
            :ratios="ratioOptions"
            :model="selectedModel"
            :disabled="generating || deleting || !selectedModel" />
          <cameraControl v-model="data.camera" :disabled="generating || deleting || uploading" />
          <el-button
            class="sendButton"
            :icon="generating ? IconPlayerStop : IconArrowUp"
            :disabled="deleting || uploading || (!generating && (!ai.canGenerate || !generationPrompt || !selectedModel || !!referenceHint || !!capabilityError))"
            :title="generating ? '停止生成' : ai.canGenerate ? '生成图片' : '隔离试运行暂未开放生成'"
            :aria-label="generating ? '停止生成' : '生成图片'"
            @click="generating ? generationController?.abort() : startGeneration().catch((error) => showNodeError(error, '图片生成失败'))" />
          <p v-if="!ai.canGenerate" class="generationUnavailable" role="status">隔离试运行暂未开放生成。</p>
        </template>
      </nodeComposer>
    </template>
  </nodeSkeleton>
  <el-image-viewer
    v-if="previewVisible && originalUrl"
    :urlList="[originalUrl]"
    teleported
    @close="previewVisible = false" />
</template>

<script setup lang="ts">
import { imageNodeIcon } from "@toonflow/nodes-scaffold/nodeIcons";
import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from "vue";
import { ElButton, ElSelect, ElOption, ElOptionGroup, ElLoading, ElImageViewer } from "element-plus";
import { IconUpload, IconSparkles, IconArrowUp, IconPlayerStop } from "@tabler/icons-vue";
import { appendCameraPrompt, cameraControl, cameraSettingsSchema, readCameraSettings, getMediaCapabilityError, supportsImageSize, groupNodeModels, nodeSkeleton, nodeComposer, nodeTools, showNodeError, useNode, useNodeGeneration, useNodeReferences, z, type CameraSettings, type NodeMediaModel, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import promptInput from "@toonflow/nodes-scaffold/promptInput";
import referenceItem from "@toonflow/nodes-scaffold/referenceItem";
import generationSettings from "./components/generationSettings.vue";

defineOptions({
  inheritAttrs: false,
  icon: imageNodeIcon,
  handles: [
    { id: "in", type: "target", dataType: ["STRING", "IMAGE", "VIDEO", "AUDIO"], label: "参考输入" },
    { id: "image", type: "source", dataType: "IMAGE", label: "图片输出" },
  ] satisfies NodeHandle[],
});
const vLoading = ElLoading.directive;
const { id, node, nodeProps, nodeEvent, outputs, files, ai, updateNodeInternals } = useNode({
  label: "图片",
});
// ACT: 保留旧类型、节点 ID 和文件引用，只统一内置默认标题。
if (["图片素材", "图片生成"].includes(String(node.data.label))) node.data.label = "图片";
type PromptModel = NonNullable<InstanceType<typeof promptInput>["$props"]["modelValue"]>;
const data = computed(() => node.data as { prompt: string; promptModel: PromptModel; model: string; size: string; ratio: string; n: number; quality?: string; camera?: CameraSettings });
data.value.n ??= 1;
data.value.quality ??= "";
data.value.prompt ??= "";
data.value.promptModel ??= [];
data.value.model ??= "";
data.value.size ??= "";
data.value.ratio ??= "16:9";
const { refList, referenceMentions, setReferencePreview, removeReference } = useNodeReferences();
const referenceHint = computed(() => refList.value.some(item => item.dataType === "VIDEO" || item.dataType === "AUDIO")
  ? "参考已连接；当前图片生成接口仅支持文本和图片，请先将视频、音频转为支持的参考或移除此引用。" : "");
const models = ref<NodeMediaModel[]>([]);
const modelsLoading = ref(false);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement>();
let disposed = false;
const deleting = ref(false);
const previewVisible = ref(false);
const imageDimensions = ref("");
const imageBytes = ref<number>();
const imageFileSize = computed(() => {
  const size = imageBytes.value;
  if (size === undefined) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
});
let generationController: AbortController | undefined;
const generationState = useNodeGeneration(outputs, () => generationController?.abort());
const { generating } = generationState;
let generation: Promise<void> | undefined;
let modelsRequest: Promise<void> | undefined;
const selectedModel = computed(() => models.value.find((item) => JSON.stringify([item.providerId, item.modelId]) === data.value.model));
const sizeOptions = computed(() => selectedModel.value?.imageSizes ?? []);
const ratioOptions = computed(() => selectedModel.value?.imageRatios ?? []);
const capabilityError = computed(() => selectedModel.value ? getMediaCapabilityError(selectedModel.value, "image", { size: data.value.size || undefined, ratio: data.value.ratio || undefined, quality: data.value.quality || undefined, n: data.value.n, images: refList.value.filter(item => item.dataType === "IMAGE"), videos: refList.value.filter(item => item.dataType === "VIDEO"), audios: refList.value.filter(item => item.dataType === "AUDIO") }) : undefined);
watch(
  selectedModel,
  (choice) => {
    if (modelsLoading.value || !choice) return;
    // ACT: 现有分辨率使用 K 单位；出现其他单位时再统一换算，未知名称排在数值选项之后。
    if (data.value.size && !supportsImageSize(choice, data.value.size)) data.value.size = "";
    if (!ratioOptions.value.includes(data.value.ratio)) data.value.ratio = "";
    if (data.value.quality && !choice.imageQualities?.includes(data.value.quality as "low" | "medium" | "high")) data.value.quality = "";
    if (!Number.isInteger(data.value.n) || data.value.n < 1 || data.value.n > (choice.maxImageCount ?? 1)) data.value.n = 1;
  },
  { flush: "sync" }
);
const modelGroups = computed(() => groupNodeModels(models.value));
const generationPrompt = computed(() =>
  [
    data.value.prompt.trim(),
    ...refList.value.flatMap((item, index) => (item.dataType === "STRING" && item.value?.trim() ? [`参考 ${index + 1}：\n${item.value.trim()}`] : [])),
  ]
    .filter(Boolean)
    .join("\n\n")
);
const outputFile = computed(() => outputs.value.image?.dataType === "IMAGE" ? outputs.value.image.value : undefined);
const previewInfo = files.useMediaPreview(outputFile);
const thumbnailFailed = ref(false);
const previewFailed = ref(false);
// ACT: 优先使用缩略图；未安装 FFmpeg 或缩略图加载失败时，直接在节点内显示原图。
const previewUrl = computed(() => previewFailed.value ? "" : (!thumbnailFailed.value && previewInfo.value?.thumbnailUrl) || originalUrl.value);
const originalUrl = computed(() => previewInfo.value?.originalUrl || "");
watch(previewInfo, info => {
  thumbnailFailed.value = false;
  previewFailed.value = !!info && !info.thumbnailUrl && !info.originalUrl;
  imageBytes.value = info?.bytes;
  imageDimensions.value = info?.width && info.height ? `${info.width} × ${info.height}` : "";
});

function handlePreviewError() {
  if (!thumbnailFailed.value && previewInfo.value?.thumbnailUrl && previewInfo.value.thumbnailUrl !== originalUrl.value) thumbnailFailed.value = true;
  else previewFailed.value = true;
}

onMounted(() => loadModels().catch((error) => showNodeError(error, "模型读取失败")));
onScopeDispose(() => {
  disposed = true;
  generationController?.abort();
});

async function replaceOutput(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || generating.value || deleting.value || uploading.value || disposed) return;
  if (!file.type.startsWith("image/")) return void showNodeError("请选择图片文件", "图片替换失败");
  if (!file.size || file.size > 100 * 1024 * 1024) return void showNodeError("图片不能为空且不能超过 100 MB", "图片替换失败");
  uploading.value = true;
  try {
    const workspace = files.getWorkspaceFiles();
    const url = await files.uploadFile(file);
    if (disposed) {
      await workspace.remove(url);
      return;
    }
    // ACT: 保留历史输出文件，避免破坏撤销记录和复制节点的引用。
    outputs.value.image = { dataType: "IMAGE", value: { url, mimeType: file.type } };
  } catch (error) {
    showNodeError(error, "图片替换失败");
  } finally {
    uploading.value = false;
  }
}

function loadModels() {
  if (modelsRequest) return modelsRequest;
  modelsLoading.value = true;
  modelsRequest = ai.getMediaModels().then((items) => {
    if (generating.value || deleting.value) return;
    models.value = items.filter((item) => item.type === "image");
  }).finally(() => {
    modelsLoading.value = false;
    modelsRequest = undefined;
  });
  return modelsRequest;
}

async function startGeneration() {
  const choice = selectedModel.value;
  if (generating.value) throw new Error("图片正在生成，请等待完成");
  if (uploading.value) throw new Error("图片正在替换，请等待完成");
  if (deleting.value) throw new Error("节点正在删除");
  if (referenceHint.value) throw new Error(referenceHint.value);
  if (!choice) throw new Error("请先选择图片模型");
  if (capabilityError.value) throw new Error(capabilityError.value);
  if (!generationPrompt.value) throw new Error("请输入生成提示词");
  if (refList.value.some(item => item.value === undefined)) throw new Error("引用节点暂无内容，请先补充引用内容");
  const workspace = files.getWorkspaceFiles();
  const controller = new AbortController();
  const input = {
    providerId: choice.providerId,
    modelId: choice.modelId,
    prompt: appendCameraPrompt(generationPrompt.value, data.value.camera),
    size: data.value.size || undefined,
    ratio: data.value.ratio || undefined,
    n: data.value.n,
    quality: data.value.quality || undefined,
    outputDirectory: `assets/${id}`,
    images: refList.value.flatMap((item) => (item.dataType === "IMAGE" && item.value ? [{ path: item.value.url, mimeType: item.value.mimeType }] : [])),
  };
  generationController = controller;
  // ACT: 工具立即返回，任务由节点持有，停止或卸载时取消。
  generation = generationState.run(() => workspace
    .list()
    .then(({ directory }) => {
      controller.signal.throwIfAborted();
      return ai.generateImage({ ...input, directory }, controller.signal);
    })
    .then(([result]) => {
      controller.signal.throwIfAborted();
      if (!result) throw new Error("供应商未返回图片");
      if (result.warning) showNodeError(result.warning, "部分结果未完成");
      outputs.value.image = { dataType: "IMAGE", value: { url: result.path, mimeType: result.mimeType } };
    }))
    .catch((error) => showNodeError(error, "图片生成失败"))
    .finally(() => {
      generationController = undefined;
    });
  return { status: "generating" };
}

nodeEvent.on("canUnload", () => !generating.value && !uploading.value && !deleting.value);
nodeEvent.on("save", (reason) => {
  if (reason === "reload" && (generating.value || uploading.value || deleting.value)) throw new Error("图片处理中，请完成后再刷新节点");
});
nodeEvent.on("delete", async () => {
  if (uploading.value) throw new Error("图片正在替换，请稍后删除节点");
  deleting.value = true;
  generationController?.abort();
  try {
    await generation;
    await files.removeNodeFiles();
  } finally {
    deleting.value = false;
  }
});

async function resizeImage(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  if (!image.naturalWidth || !image.naturalHeight) return;
  imageDimensions.value = `${previewInfo.value?.width || image.naturalWidth} × ${previewInfo.value?.height || image.naturalHeight}`;
  await nextTick();
  updateNodeInternals();
}

nodeTools.register({
  name: "setImage",
  description: "选择工作区内已有的图片文件作为此节点的输出，path 使用工作区相对路径",
  parameters: z.strictObject({
    path: z.string().min(1).max(4096),
    mimeType: z.string().regex(/^image\/[a-zA-Z0-9.+-]+$/),
  }),
  async execute({ path, mimeType }, { signal }) {
    signal?.throwIfAborted();
    if (disposed || uploading.value || generating.value || deleting.value) throw new Error("图片处理中，请稍后重试");
    uploading.value = true;
    try {
      const content = await files.getWorkspaceFiles().read(path);
      signal?.throwIfAborted();
      if (!content.byteLength || content.byteLength > 100 * 1024 * 1024) throw new Error("图片不能为空且不能超过 100 MB");
      if (disposed) throw new Error("节点已关闭");
      outputs.value.image = { dataType: "IMAGE", value: { url: path, mimeType } };
      return outputs.value.image;
    } finally {
      uploading.value = false;
    }
  },
});

function getConfig() {
  return {
    config: {
      providerId: selectedModel.value?.providerId ?? "",
      modelId: selectedModel.value?.modelId ?? "",
      size: data.value.size,
      ratio: data.value.ratio,
      n: data.value.n,
      quality: data.value.quality || undefined,
      camera: readCameraSettings(data.value.camera),
    },
    models: models.value,
  };
}

nodeTools.register({
  name: "getConfig",
  description: "读取此图片生成节点的当前模型、分辨率、比例及可选图片模型能力，不含密钥；未声明分辨率或比例时分别使用 2K、16:9",
  parameters: z.strictObject({}),
  async execute(_args, { signal }) {
    signal?.throwIfAborted();
    await loadModels();
    signal?.throwIfAborted();
    return getConfig();
  },
});

nodeTools.register({
  name: "setConfig",
  description: "修改此图片生成节点的模型、分辨率或比例；先用 getConfig 查询可选能力，providerId 与 modelId 必须同时提供；不修改提示词、不启动生成",
  parameters: z.strictObject({
    providerId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    size: z.string().max(64).optional(),
    ratio: z.string().max(64).optional(),
    n: z.number().int().min(1).max(10).optional(),
    camera: cameraSettingsSchema.optional(),
  }).refine((args) => (args.providerId === undefined) === (args.modelId === undefined), "providerId 与 modelId 必须同时提供"),
  async execute(args, { signal }) {
    signal?.throwIfAborted();
    if (generating.value || deleting.value) throw new Error("节点正在生成或删除，请稍后修改配置");
    await loadModels();
    signal?.throwIfAborted();
    if (generating.value || deleting.value) throw new Error("节点正在生成或删除，请稍后修改配置");
    const choice = args.modelId === undefined ? selectedModel.value
      : models.value.find((item) => item.providerId === args.providerId && item.modelId === args.modelId);
    if (!choice) throw new Error("请选择 getConfig 返回的有效图片模型");
    if (args.size && !supportsImageSize(choice, args.size)) throw new Error(`当前模型未声明支持尺寸 ${args.size}，请使用 getConfig 返回的档位或像素范围`);
    if (args.ratio && !choice.imageRatios?.includes(args.ratio)) throw new Error(`当前模型未声明支持比例 ${args.ratio}`);
    if (args.n !== undefined && args.n > (choice.maxImageCount ?? 1)) throw new Error(`当前模型一次最多生成 ${choice.maxImageCount ?? 1} 张`);
    data.value.model = JSON.stringify([choice.providerId, choice.modelId]);
    if (args.size !== undefined) data.value.size = args.size;
    if (args.ratio !== undefined) data.value.ratio = args.ratio;
    if (args.n !== undefined) data.value.n = args.n;
    if (args.camera !== undefined) data.value.camera = args.camera;
    return getConfig();
  },
});

nodeTools.register({
  name: "setPrompt",
  description: "修改此节点的图片生成提示词，支持 {{ref 1}} 等参考标记；只修改提示词，不启动生成",
  parameters: z.strictObject({ prompt: z.string() }),
  execute({ prompt: value }) {
    if (deleting.value) throw new Error("节点正在删除，请稍后修改");
    data.value.prompt = value;
    data.value.promptModel = value.split("\n").map((text) => [{ type: "Write", text }]);
    return { prompt: value };
  },
});

nodeTools.register({
  name: "generateImage",
  description: "启动此节点的后台图片生成，使用当前提示词、模型、分辨率、比例和参考图片；立即返回已开始，用 getGenerationStatus 查询完成结果，cancelGeneration 停止生成",
  parameters: z.strictObject({}),
  execute(_args, { signal }) {
    signal?.throwIfAborted();
    return startGeneration();
  },
});
</script>

<style scoped lang="scss">
.mediaNode { --node-handle-opacity: 1; --nodeWidth: 320px; --nodeCardHeight: 240px; }
.generationUnavailable { color: var(--el-text-color-secondary); font-size: 12px; }
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

.imageContent {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  border-radius: var(--el-border-radius-base);

  .imageInfo {
    display: var(--canvasImageInfoDisplay, block);
    position: absolute; right: 6px; bottom: 6px; max-width: calc(100% - 12px);
    padding: 3px 6px; border-radius: 4px; background: #000b; color: #fff;
    font-size: 11px; line-height: 1.4; font-variant-numeric: tabular-nums;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none;
  }


  :deep(.el-loading-mask) {
    pointer-events: none;
  }

  .imagePreview {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 0;
    max-height: 100%;
    object-fit: contain;
    border-radius: var(--el-border-radius-base);
  }

}

</style>
