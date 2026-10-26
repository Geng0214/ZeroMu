<template>
  <nodeSkeleton class="textNode"
    v-bind="nodeProps"
    v-model:bottomVisible="node.selected"
    :downloadUrl="downloadUrl"
    :downloadName="`${nodeProps.label || '文本'}.txt`"
    :bottomWidth="720"
    @fullscreen="fullscreen = true; editing = true">
    <div class="textContent" :class="{ empty: !outputs.text.value.trim() }">
      <div v-if="outputs.text.value.trim()" class="textPreview nopan nowheel" aria-label="文本内容">{{ outputs.text.value }}</div>
      <el-button class="editButton nodrag nopan" :icon="IconEdit" :disabled="generating || !textReady" text @dblclick.stop @click.stop="editing = true">编辑</el-button>
    </div>
    <template #bottom>
      <nodeComposer title="文本创作" :referenceCount="refList.length">
        <template #references>
          <referenceItem
            v-model="refList"
            @preview="setReferencePreview"
            @remove="removeReference" />
        </template>
        <template #hint><p v-if="referenceHint">{{ referenceHint }}</p></template>
        <template #default="{ expanded }">
          <promptInput v-model="promptModel" v-model:text="prompt" :references="referenceMentions" :minHeight="160" placeholder="描述想写的内容，输入 @ 引用参考" :expandedLayout="expanded" />
        </template>
        <template #footer>
          <span v-if="!ai.canGenerate" class="generationUnavailable" role="status">隔离试运行暂未开放生成。</span>
          <el-select v-model="model" class="modelSelect" filterable :loading="modelsLoading" :disabled="generating" placeholder="选择模型" aria-label="生成模型" noDataText="请先在设置中添加模型" placement="top-start" @visible-change="visible => visible && loadModels()">
            <template #prefix><icon-sparkles :size="17" /></template>
            <el-option-group v-for="provider in modelGroups" :key="provider.id" :label="provider.label">
              <el-option v-for="item in provider.models" :key="item.modelId" :label="item.label" :value="JSON.stringify([item.providerId, item.modelId])" />
            </el-option-group>
          </el-select>
          <el-button class="sendButton" :icon="IconArrowUp" :loading="generating" :disabled="!ai.canGenerate || !prompt.trim() || !selectedModel || generating || !textReady || !!referenceHint" :title="ai.canGenerate ? '生成文本' : '隔离试运行暂未开放生成'" aria-label="生成文本" @click="generateText" />
        </template>
      </nodeComposer>
    </template>
  </nodeSkeleton>
  <el-dialog v-model="editing" title="编辑文本" width="min(860px, calc(100vw - 32px))" :fullscreen="fullscreen" alignCenter appendToBody @closed="fullscreen = false">
    <el-input class="textEditor" :class="{ fullscreen }" v-model="outputs.text.value" type="textarea" :rows="1" :disabled="generating" resize="none" aria-label="编辑文本内容" />
  </el-dialog>
</template>

<script setup lang="ts">
import { textNodeIcon } from "@toonflow/nodes-scaffold/nodeIcons";
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElButton, ElInput, ElSelect, ElDialog, ElOption, ElOptionGroup, ElMessage, ElMessageBox } from "element-plus";
import { IconEdit, IconSparkles, IconArrowUp } from "@tabler/icons-vue";
import { groupNodeModels, nodeSkeleton, nodeComposer, nodeTools, nodeFileDirectory, useNode, useNodeReferences, z, type NodeAiModel, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import referenceItem from "@toonflow/nodes-scaffold/referenceItem";
import promptInput from "@toonflow/nodes-scaffold/promptInput";

type PromptModel = NonNullable<InstanceType<typeof promptInput>["$props"]["modelValue"]>;

defineOptions({
  inheritAttrs: false,
  icon: textNodeIcon,
  handles: [
    { id: "in", type: "target", dataType: ["STRING", "IMAGE", "VIDEO", "AUDIO"], label: "参考输入" },
    { id: "text", type: "source", dataType: "STRING", label: "文本输出" },
  ] satisfies NodeHandle[],
});
const { node, nodeProps, outputs, ai, files, nodeEvent } = useNode({
  label: "文本",
  outputs: { text: { dataType: "STRING", value: "" } },
});
const { refList, referenceMentions, setReferencePreview, removeReference } = useNodeReferences();
const referenceHint = computed(() => refList.value.some(item => item.dataType === "AUDIO")
  ? "音频已连接；当前文本生成接口暂不支持音频参考，请先转写为文本或移除此引用。" : "");
const editing = ref(false);
const fullscreen = ref(false);
const downloadUrl = ref("");
watch([() => outputs.value.text.value, () => node.selected], ([text, selected], _previous, onCleanup) => {
  downloadUrl.value = "";
  if (!selected || !text.trim()) return;
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  downloadUrl.value = url;
  onCleanup(() => URL.revokeObjectURL(url));
}, { immediate: true });
const data = computed(() => node.data as typeof node.data & { prompt?: string; promptModel?: PromptModel; model?: string; textPath?: string; textSnapshot?: string });
const prompt = computed({ get: () => data.value.prompt ?? "", set: (value: string) => { data.value.prompt = value; } });
const model = computed({ get: () => data.value.model ?? "", set: (value: string) => { data.value.model = value; } });
const models = ref<NodeAiModel[]>([]);
const modelsLoading = ref(false);
const generating = ref(false);
const selectedModel = computed(() => models.value.find(item => JSON.stringify([item.providerId, item.modelId]) === model.value));
const modelGroups = computed(() => groupNodeModels(models.value));
const textReady = ref(false);
const initialOutputs = node.data.outputs ?? {};
// ACT: 加载期间沿用原内联内容，文件加载成功后才从画布快照排除正文。
Object.defineProperty(outputs.value, "toJSON", { value: () => textReady.value ? {} : initialOutputs });
let textPath = `assets/${node.id}/content.md`;
let textFiles: ReturnType<typeof files.getWorkspaceFiles>;
let textLoading: Promise<void> | undefined;
let textSaving = Promise.resolve();
let textDraftKey = "";
const nodeDraftStore = inject<{ get(): Promise<string | null>; set(value: string): Promise<void>; remove(): Promise<void> }>("nodeDraftStore", {
  get: async () => localStorage.getItem(textDraftKey),
  set: async value => { localStorage.setItem(textDraftKey, value); },
  remove: async () => { localStorage.removeItem(textDraftKey); },
});
const textDirty = ref(false);
let textRevision = 0;
const protectText = (event: BeforeUnloadEvent) => { if (textDirty.value) { event.preventDefault(); event.returnValue = ""; } };
window.addEventListener("beforeunload", protectText);
onBeforeUnmount(() => window.removeEventListener("beforeunload", protectText));
function saveText(value: string) {
  const revision = ++textRevision;
  textDirty.value = true;
  textSaving = textSaving.catch(() => {}).then(async () => {
    try { await nodeDraftStore.set(value); } catch { /* 草稿写入失败仍继续磁盘保存，关闭页面前保持保护。 */ }
    await textFiles.write(textPath, value);
    if (revision === textRevision) {
      textDirty.value = false;
      try { if (await nodeDraftStore.get() === value) await nodeDraftStore.remove(); } catch { /* 不影响已完成的磁盘保存。 */ }
    }
  });
  return textSaving;
}
nodeEvent.on("canUnload", () => !generating.value && !editing.value && textReady.value && !textDirty.value);
nodeEvent.on("save", async (reason) => {
  await textLoading;
  if (!textReady.value) throw new Error("文本尚未加载，无法保存");
  if (reason === "reload" && generating.value) throw new Error("文本正在生成，请完成后再刷新节点");
  // 普通编辑已由 watcher 入队；生成中补存当前片段，不因画布保存重复写未改动的文本。
  if (generating.value) saveText(outputs.value.text.value);
  let pending: Promise<void>;
  do {
    pending = textSaving;
    try { await pending; }
    catch { await saveText(outputs.value.text.value); }
  } while (pending !== textSaving);
  if (reason === "reload" && generating.value) throw new Error("文本正在生成，请完成后再刷新节点");
});
onMounted(() => { textLoading = loadText(); });
async function loadText() {
  try {
    if (!node.id || /[\\/]/.test(node.id) || node.id === "." || node.id === "..") throw new Error("节点 ID 不能作为文件夹名称");
    textFiles = files.getWorkspaceFiles();
    const nodeDirectory = await nodeFileDirectory(textFiles, node.id);
    textPath = `${nodeDirectory}/content.md`;
    const sourcePath = data.value.textPath;
    if (sourcePath !== undefined && (typeof sourcePath !== "string" || sourcePath !== textPath && sourcePath !== `assets/${node.id}/content.md` && sourcePath !== `references/nodes/${node.id}/content.md` && !/^(?:assets\/production|references\/versions)\/[a-f0-9-]{36}\/reference\d+\.md$/i.test(sourcePath))) throw new Error("文本文件路径无效");
    const directory = textFiles.getDirectory?.() ?? (await textFiles.list()).directory;
    textDraftKey = `toonflow.textDraft:${JSON.stringify([directory, textPath])}`;
    let value = data.value.textSnapshot !== undefined ? data.value.textSnapshot : sourcePath ? await textFiles.readText(sourcePath) : outputs.value.text.value;
    if (typeof value !== "string") throw new Error("文本内容无效");
    let backup: string | null = null;
    try { backup = await nodeDraftStore.get(); } catch { /* 浏览器禁用存储时仍可读取磁盘文件。 */ }
    if (backup !== null && backup !== value) {
      const restore = await ElMessageBox.confirm("发现此文本节点未保存的内容，是否恢复？", "恢复文本", { confirmButtonText: "恢复内容", cancelButtonText: "使用磁盘版本", showClose: false, closeOnClickModal: false, closeOnPressEscape: false }).then(() => true, () => false);
      if (restore) { value = backup; await saveText(value); }
      else await nodeDraftStore.remove().catch(() => {});
    }
    if (sourcePath !== textPath) {
      const parts = nodeDirectory.split("/");
      for (const directory of parts.map((_part, index) => parts.slice(0, index + 1).join("/"))) {
        await textFiles.mkdir(directory).catch((error: { response?: { data?: { data?: { code?: string } } } }) => {
          if (error.response?.data?.data?.code !== "EEXIST") throw error;
        });
      }
      // 旧模板的固定参考只读取；独立编辑副本始终落在本节点目录，已有不同副本不覆盖。
      try { await textFiles.write(textPath, value, true); }
      catch (error) {
        if ((error as { response?: { data?: { data?: { code?: string } } } }).response?.data?.data?.code !== "EEXIST") throw error;
        if (await textFiles.readText(textPath) !== value) throw new Error("此节点已有不同文本副本，原文件均已保留，请先备份后处理");
      }
    }
    outputs.value.text.value = value;
    data.value.textPath = textPath;
    delete data.value.textSnapshot;
    textReady.value = true;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "文本加载失败");
  }
}

watch(() => outputs.value.text.value, async (value) => {
  if (!textReady.value || generating.value) return;
  try { await saveText(value); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : "文本保存失败"); }
}, { flush: "sync" });
nodeEvent.on("copy", () => {
  if (!textReady.value) throw new Error("文本尚未加载");
  return { textPath: undefined, textSnapshot: outputs.value.text.value };
});

onMounted(loadModels);

async function loadModels() {
  if (modelsLoading.value) return;
  modelsLoading.value = true;
  try {
    models.value = await ai.getModels();
    if (!model.value) {
      const first = models.value[0];
      model.value = first ? JSON.stringify([first.providerId, first.modelId]) : "";
    }
  } catch (error) {
    if (error instanceof Error && error.name !== "AbortError") ElMessage.error(error.message);
  } finally {
    modelsLoading.value = false;
  }
}

async function generateText() {
  const choice = selectedModel.value;
  if (!textReady.value || generating.value || !choice || !prompt.value.trim()) return;
  generating.value = true;
  let text = "";
  try {
    if (referenceHint.value) throw new Error(referenceHint.value);
    if (refList.value.some(item => item.value === undefined)) throw new Error("引用节点暂无内容，请先补充引用内容");
    const references = refList.value
      .filter(item => item.value !== undefined && (item.dataType === "STRING" || item.dataType === "IMAGE" || item.dataType === "VIDEO"))
      .map(item => item.dataType === "STRING" ? { dataType: item.dataType, value: item.value } : { dataType: item.dataType, value: { ...item.value } });
    const input = { providerId: choice.providerId, modelId: choice.modelId, prompt: prompt.value.trim(), references };
    const directory = references.some(item => item.dataType !== "STRING") ? (await textFiles.list()).directory : undefined;
    const result = await ai.generate({
      ...input,
      directory,
      onEvent(event) {
        if (event.type === "text") outputs.value.text.value = text += event.delta;
      },
    });
    outputs.value.text.value = result.text;
  } catch (error) {
    if (error instanceof Error && error.name !== "AbortError") ElMessage.error(error.message);
  } finally {
    // 卸载会取消请求并停止 watcher，生成收尾必须自行保存已收到的正文。
    try { await saveText(outputs.value.text.value); }
    catch (error) { ElMessage.error(error instanceof Error ? error.message : "文本保存失败"); }
    generating.value = false;
  }
}
const promptModel = computed({ get: () => data.value.promptModel ?? [], set: (value: PromptModel) => { data.value.promptModel = value; } });

nodeTools.register({
  name: "setText",
  description: "修改此节点的文本输出",
  parameters: z.strictObject({ text: z.string() }),
  async execute({ text }) {
    if (!textReady.value) throw new Error("文本尚未加载");
    if (generating.value) throw new Error("文本生成中，请稍后修改");
    if (outputs.value.text.value === text) await saveText(text);
    else { outputs.value.text.value = text; await textSaving; }
    return { text };
  },
});
</script>

<style lang="scss" scoped>
.textNode {
  --node-handle-opacity: 1;
}
.generationUnavailable { color: var(--el-text-color-secondary); font-size: 12px; }

.textEditor {
  &.fullscreen :deep(.el-textarea__inner) {
    height: calc(100dvh - 112px);
  }

  :deep(.el-textarea__inner) {
    height: min(560px, calc(100dvh - 144px));
    padding: 16px 20px;
    overflow-y: auto;
    overscroll-behavior: contain;
    font-size: 14px;
    line-height: 1.8;
  }
}

.textNode { --nodeWidth: 320px; --nodeCardHeight: 200px; }
.textContent {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;

  &.empty {
    display: flex;
    align-items: center;
    justify-content: center;

    .editButton {
      align-self: center;
      margin: 0;
    }
  }

  .textPreview {
    flex: 1;
    min-height: 0;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: none;
  }

  .editButton {
    display: flex;
    flex-shrink: 0;
    align-self: flex-end;
    margin-top: 8px;
    margin-left: auto;
  }
}

</style>
