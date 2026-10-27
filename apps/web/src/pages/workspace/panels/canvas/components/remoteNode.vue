<template>
  <nodeSkeleton v-if="loading" loading :label="node.data.label || node.type" :handles="node.data.handles" :outputs="node.data.outputs" />
  <div v-else-if="code && frameState && !error && !runtimeError" class="isolatedNodeShell">
    <div class="isolatedDragBar">{{ node.data.label || node.type }}</div>
    <isolatedNodeView ref="isolatedView" :code="code" :state="frameState" :currentScope="currentFrameScope" :operate="operateFrame" />
    <template v-for="group in frameHandles" :key="group.type">
      <handle v-for="(item, index) in group.items" :id="item.id" :key="item.id" class="isolatedHandle" :type="group.type" :position="group.position" :isValidConnection="validateConnection" :style="{ top: `${((index + 1) / (group.items.length + 1)) * 100}%` }" :title="`${item.label ?? item.id} · ${Array.isArray(item.dataType) ? item.dataType.join(' / ') : item.dataType}`" />
    </template>
  </div>
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
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, inject, onErrorCaptured, ref, watch, type Component } from "vue";
import { useProductionStore } from "@/stores/production";
import type { CanvasContext } from "@toonflow/tool-canvas/runtime";
import { Handle, Position, useNode, useVueFlow } from "@vue-flow/core";
import { ElButton, ElCard } from "element-plus";
import { IconRefresh, IconX } from "@tabler/icons-vue";
import nodeSkeleton from "@toonflow/nodes-scaffold/nodeSkeleton";
import savedNodeOutput from "./savedNodeOutput.vue";
import { validateConnection, type NodeData } from "@toonflow/nodes-scaffold/connection";
import { sameNodeFrameScope, type NodeFrameScope, type NodeFrameState } from "@/lib/nodeFrameProtocol";
import { useNodeFrameAppearance } from "@/lib/nodeFrameAppearance";
import { useNodeInputs } from "@toonflow/nodes-scaffold/nodeInputs";
import { useNodeEvent } from "@toonflow/nodes-scaffold/nodeEvent";

defineOptions({ inheritAttrs: false });
const props = defineProps<{ component?: Component | string; code?: string; framePilot?: boolean; error?: string; loading?: boolean }>();
const { node } = useNode<NodeData>();
const frameAppearance = useNodeFrameAppearance();
const isolatedNodeView = defineAsyncComponent(() => import("./isolatedNodeView.vue"));
const isolatedView = ref<InstanceType<typeof import("./isolatedNodeView.vue")["default"]>>();
function invokeIsolated(action: "save" | "copy" | "delete", reason?: "reload") {
  if (!isolatedView.value) throw new Error("节点界面尚未就绪");
  return isolatedView.value.invoke(action, reason);
}
if (props.framePilot) {
  const events = useNodeEvent(node.id, useVueFlow());
  events.on("save", reason => props.code ? invokeIsolated("save", reason).then(() => {}) : undefined);
  events.on("delete", () => props.code ? invokeIsolated("delete").then(() => {}) : undefined);
  events.on("copy", async () => {
    if (!props.code) return {};
    const data = await invokeIsolated("copy");
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("节点复制结果无效");
    return data as Record<string, unknown>;
  });
  events.on("canUnload", () => !props.code || isolatedView.value?.canUnload === true);
}
const savedTextPath = computed(() => { const data = node.data as NodeData & { textPath?: unknown }; return typeof data.textPath === "string" ? data.textPath : undefined; });
const production = useProductionStore();
const getCanvas = inject<() => CanvasContext | undefined>("canvas");
const getDirectory = inject<() => string>("workspaceDirectory");
const getNodeConfig = inject<(type: string) => Record<string, unknown>>("nodeConfig");
const nodeInputs = useNodeInputs();
const frameHandles = computed(() => [
  { type: "target" as const, position: Position.Left, items: (node.data.handles ?? []).filter(handle => handle.type === "target") },
  { type: "source" as const, position: Position.Right, items: (node.data.handles ?? []).filter(handle => handle.type === "source") },
]);
const frameSessionId = crypto.randomUUID();
const initialFrameScope = ref<NodeFrameScope>();
let acceptedData = "";
watch(() => props.code, code => {
  if (!code || initialFrameScope.value) return;
  const current = currentFrameScope();
  if (!current) return;
  initialFrameScope.value = current;
  acceptedData = JSON.stringify(node.data);
}, { immediate: true });
function currentFrameScope(): NodeFrameScope | undefined {
  try {
    const canvas = getCanvas?.();
    const directory = getDirectory?.();
    return canvas && directory ? { directory, canvasId: canvas.id, nodeId: node.id, nodeType: node.type, sessionId: frameSessionId } : undefined;
  } catch { return; }
}
const frameState = computed<NodeFrameState | undefined>(() => {
  if (!props.code || !initialFrameScope.value) return;
  const inputs = Object.fromEntries((node.data.handles ?? []).filter(handle => handle.type === "target")
    .map(handle => [handle.id, nodeInputs.getTargetValues(node.id, handle.id)]));
  return {
    scope: initialFrameScope.value,
    node: { id: node.id, type: node.type, data: JSON.parse(JSON.stringify(node.data)), selected: node.selected },
    inputs,
    config: getNodeConfig?.(node.type) ?? {},
    appearance: frameAppearance.value,
  };
});
async function operateFrame(action: string, payload: unknown, signal: AbortSignal) {
  if (action === "draft.get" || action === "draft.set" || action === "draft.remove") {
    signal.throwIfAborted();
    if (node.type !== "remote-textNode" || !initialFrameScope.value || !sameNodeFrameScope(currentFrameScope(), initialFrameScope.value)) throw new Error("文本草稿所属节点已切换");
    const key = `toonflow.textDraft:${JSON.stringify([initialFrameScope.value.directory, `assets/${node.id}/content.md`])}`;
    if (action === "draft.get") return localStorage.getItem(key);
    if (action === "draft.remove") return localStorage.removeItem(key);
    const value = (payload as { value?: unknown } | null)?.value;
    if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > 1_000_000) throw new Error("文本草稿超过 1 MB");
    localStorage.setItem(key, value);
    return;
  }
  if (action === "ai.models" || action === "ai.mediaModels") {
    const response = await fetch(action === "ai.models" ? "/api/ai/models" : "/api/ai/media/models", { signal, cache: "no-store" });
    const result = await response.json() as { code?: number; data?: unknown; message?: string };
    if (!response.ok || result.code !== 200 || !Array.isArray(result.data)) throw new Error(result.message || "节点模型列表读取失败");
    return result.data;
  }
  if (action === "node.disconnect") {
    signal.throwIfAborted();
    const target = payload as { handleId?: unknown; source?: unknown; sourceHandle?: unknown } | null;
    const current = currentFrameScope();
    if (!current || !initialFrameScope.value || !sameNodeFrameScope(current, initialFrameScope.value) || findNode(node.id)?.data !== node.data
      || typeof target?.handleId !== "string" || typeof target.source !== "string" || typeof target.sourceHandle !== "string") throw new Error("节点连线请求无效");
    removeEdges(edges => edges.filter(edge => edge.target === node.id && edge.targetHandle === target.handleId && edge.source === target.source && edge.sourceHandle === target.sourceHandle));
    return;
  }
  if (action !== "node.data") throw new Error("节点界面操作未授权");
  signal.throwIfAborted();
  const data = (payload as { data?: unknown } | null)?.data;
  const current = currentFrameScope();
  if (!data || typeof data !== "object" || Array.isArray(data) || !initialFrameScope.value || !current
    || current.directory !== initialFrameScope.value.directory || current.canvasId !== initialFrameScope.value.canvasId) throw new Error("节点状态或会话无效");
  if (JSON.stringify(node.data) !== acceptedData) throw new Error("节点数据已在主界面改变，请重新打开节点");
  const next = data as Record<string, unknown>;
  if (Object.keys(next).some(key => key === "__proto__" || key === "constructor" || key === "prototype")) throw new Error("节点状态字段无效");
  for (const key of Object.keys(node.data)) if (!(key in next)) delete (node.data as Record<string, unknown>)[key];
  Object.assign(node.data, next);
  if (node.type === "remote-textNode" && (node.data as NodeData & { textPath?: string }).textPath === `assets/${node.id}/content.md` && node.data.outputs) {
    Object.defineProperty(node.data.outputs, "toJSON", { value: () => ({}), configurable: true });
  }
  acceptedData = JSON.stringify(node.data);
}
const boundShot = computed(() => production.project?.shots.find(shot => !shot.archived && shot.canvasId === getCanvas?.()?.id && shot.nodeId === node.id));
const isAdoptedOutput = computed(() => {
  const selection = node.data.productionSelection;
  if (!selection || selection.projectId !== production.project?.projectId || selection.candidateId !== boundShot.value?.adoptedCandidateId) return false;
  const type = selection.file.mimeType.split("/")[0]!;
  const value = node.data.outputs?.[type]?.value;
  return !!value && typeof value === "object" && "url" in value && value.url === selection.file.path;
});
const { findNode, removeNodes, removeEdges } = useVueFlow();
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
.isolatedNodeShell {
  position: relative;
  width: 320px;
  .isolatedDragBar {
    height: 30px;
    padding: 5px 10px;
    border: 1px solid var(--el-border-color);
    border-radius: 6px 6px 0 0;
    background: var(--el-bg-color-overlay);
    font-size: 12px;
    font-weight: 600;
    cursor: grab;
  }
  .isolatedHandle {
    z-index: 2;
    width: 16px;
    height: 16px;
    border: 2px solid var(--el-border-color-darker);
    border-radius: 50%;
    background: var(--el-bg-color-overlay);
  }
}
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
