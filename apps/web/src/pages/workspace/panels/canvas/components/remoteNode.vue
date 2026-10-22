<template>
  <nodeSkeleton v-if="loading" loading :label="node.data.label || node.type" :handles="node.data.handles" :outputs="node.data.outputs" />
  <component v-else-if="component && !error && !runtimeError" :is="component" v-bind="$attrs" />
  <el-card v-else class="remoteNodeState failed" shadow="never" role="alert">
    <div class="stateHeader">
      <strong>{{ node.data.label || node.type }}</strong>
      <span class="stateLabel">error</span>
      <div class="stateActions nodrag nopan" @pointerdown.stop @mousedown.stop @dblclick.stop>
        <el-button :icon="IconRefresh" text :loading="reloading" title="重新加载节点" aria-label="重新加载节点" @click.stop="retry" />
        <el-button :icon="IconX" text title="移除节点" aria-label="移除节点" @click.stop="removeNodes(node.id)" />
      </div>
    </div>
    <p>{{ error || runtimeError || "远程节点未加载，请确认插件已安装并启用" }}</p>
    <savedNodeOutput :outputs="node.data.outputs" :textPath="savedTextPath" :label="node.data.label" />
  </el-card>
  <button v-if="boundShot" class="productionNodeBadge nodrag nopan" :title="`查看镜头：${boundShot.title}`" @pointerdown.stop @mousedown.stop @click.stop="production.openShot(boundShot.shotId)">{{ isAdoptedOutput ? '采用结果' : boundShot.adoptedCandidateId ? '其他输出 · 查看采用' : '待采用' }} · {{ boundShot.title }}</button>
</template>

<script setup lang="ts">
import { computed, inject, onErrorCaptured, ref, watch, type Component } from "vue";
import { useProductionStore } from "@/stores/production";
import type { CanvasContext } from "@toonflow/tool-canvas/runtime";
import { useNode, useVueFlow } from "@vue-flow/core";
import { ElButton, ElCard } from "element-plus";
import { IconRefresh, IconX } from "@tabler/icons-vue";
import nodeSkeleton from "@toonflow/nodes-scaffold/nodeSkeleton";
import savedNodeOutput from "./savedNodeOutput.vue";
import type { NodeData } from "@toonflow/nodes-scaffold/connection";

defineOptions({ inheritAttrs: false });
const props = defineProps<{ component?: Component | string; error?: string; loading?: boolean }>();
const { node } = useNode<NodeData>();
const savedTextPath = computed(() => { const data = node.data as NodeData & { textPath?: unknown }; return typeof data.textPath === "string" ? data.textPath : undefined; });
const production = useProductionStore();
const getCanvas = inject<() => CanvasContext | undefined>("canvas");
const boundShot = computed(() => production.project?.shots.find(shot => !shot.archived && shot.canvasId === getCanvas?.()?.id && shot.nodeId === node.id));
const isAdoptedOutput = computed(() => {
  const selection = node.data.productionSelection;
  if (!selection || selection.projectId !== production.project?.projectId || selection.candidateId !== boundShot.value?.adoptedCandidateId) return false;
  const type = selection.file.mimeType.split("/")[0]!;
  const value = node.data.outputs?.[type]?.value;
  return !!value && typeof value === "object" && "url" in value && value.url === selection.file.path;
});
const { removeNodes } = useVueFlow();
const reload = inject<((type: string) => Promise<void>)>("reloadRemoteNode");
const runtimeError = ref("");
const reloading = ref(false);

onErrorCaptured(error => {
  runtimeError.value = error instanceof Error ? error.message : String(error);
  console.error(`远程节点 ${node.type} (${node.id}) 运行失败`, error);
  return false;
});
watch(() => props.component, () => { runtimeError.value = ""; });

async function retry() {
  if (!reload || reloading.value) return;
  reloading.value = true;
  try { await reload(node.type); }
  catch (error) { runtimeError.value = error instanceof Error ? error.message : String(error); }
  finally { reloading.value = false; }
}
</script>

<style scoped lang="scss">
.productionNodeBadge { position: absolute; top: -28px; left: 0; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border: 1px solid var(--el-border-color-light); border-radius: 5px; padding: 4px 7px; background: var(--el-bg-color-overlay); color: var(--el-color-primary); font-size: 11px; cursor: pointer; &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; } }
:global(.vue-flow__node:has(> button.productionNodeBadge) > .nodeSkeleton > .floatingSlot.topSlot) { bottom: calc(100% + 44px); }
.remoteNodeState {
  width: 320px;
  &.failed { border-color: var(--el-color-danger); }
  .stateHeader {
    display: flex;
    align-items: center;
    gap: 8px;
    strong { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .stateLabel { font-size: 12px; color: var(--el-text-color-secondary); }
    .stateActions {
      display: flex;
      .el-button { width: 28px; height: 28px; margin: 0; padding: 0; }
    }
  }
  &.failed .stateLabel { color: var(--el-color-danger); }
  p { margin: 10px 0 0; font-size: 12px; color: var(--el-text-color-secondary); white-space: pre-wrap; overflow-wrap: anywhere; }
}
</style>
