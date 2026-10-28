<template>
  <div
    ref="canvasElement"
    class="canvas"
    :style="{ '--canvasImageInfoDisplay': canvasAppearance.imageInfo ? 'block' : 'none' }"
    :class="{ edgesHidden: !showEdges, handMode, compositingEnabled: generalSettings.canvasCompositingEnabled }"
    @dblclick="openNodeMenu"
    @wheel.capture="zoomCanvas"
    @gesturestart.capture="zoomCanvas"
    @gesturechange.capture="zoomCanvas"
    @gestureend.capture="zoomCanvas"
    @auxclick.capture="preventMiddleClick"
    @pointermove="pointerPosition = { x: $event.clientX, y: $event.clientY }"
    @pointerleave="pointerPosition = undefined"
    @pointerdown.capture="clearBackgroundSelection"
    @dragover="dragFilesOver"
    @drop="dropFiles">
    <vue-flow
      class="canvasFlow"
      :id="runtimeKey"
      :only-render-visible-elements="false"
      :nodes-draggable="true"
      :node-types="nodeTypes"
      :snap-to-grid="snapEnabled"
      :snap-grid="[16, 16]"
      :min-zoom="0.2"
      :max-zoom="8"
      :nodes-connectable="true"
      :connection-mode="ConnectionMode.Strict"
      :nodes-focusable="false"
      :edges-focusable="false"
      :edges-updatable="false"
      :elevate-nodes-on-select="true"
      :elevate-edges-on-select="false"
      :disable-keyboard-a11y="true"
      :selectNodesOnDrag="false"
      :auto-pan-on-node-drag="false"
      :auto-pan-on-connect="false"
      :zoom-on-double-click="false"
      :zoomOnScroll="false"
      :zoomOnPinch="active && !settingsVisible"
      :panOnScroll="false"
      :panOnScrollSpeed="1"
      :panOnDrag="handMode ? true : [1]"
      :panOnScrollMode="PanOnScrollMode.Free"
      :delete-key-code="null"
      :selectionKeyCode="!handMode"
      :selectionMode="SelectionMode.Partial"
      :multi-selection-key-code="null"
      :zoomActivationKeyCode="zoomKeyPressed ? true : null"
      :pan-activation-key-code="null"
      @connect="addEdges"
      @edgeClick="showEdgeDisconnect"
      @paneClick="clearEdgeSelection"
      @nodeClick="clearEdgeSelection"
      @moveStart="edgeDisconnect = undefined"
      :default-edge-options="defaultEdgeOptions">
      <template v-for="type in ['default', 'simple-bezier']" :key="type" #[`edge-${type}`]="edgeProps">
        <canvasEdge v-bind="edgeProps" :focused="selectedEdgeId === edgeProps.id" />
      </template>
      <template v-for="type in remoteNodeTypes" :key="type" #[`node-${type}`]="nodeProps">
        <remoteNode
          v-bind="nodeProps"
          :component="nodeTypes[type]"
          :code="nodeFrameCodes.get(type)"
          :framePilot="nodeFramePilot"
          :error="nodeErrors[type]"
          :loading="nodeLoads.has(type) || (nodeListLoading && !nodeTypes[type] && !nodeErrors[type])" />
      </template>
      <background v-if="canvasAppearance.grid !== 'blank'" :gap="32" :variant="canvasAppearance.grid === 'dots' ? BackgroundVariant.Dots : BackgroundVariant.Lines" :patternColor="canvasAppearance.grid === 'dots' ? 'var(--el-border-color-darker)' : 'var(--canvasGridColor)'" :lineWidth=".5" :size="1" />
      <canvasMenu ref="canvasMenuRef" v-model:canvasId="canvasId" :directory="project?.directory" :initialCanvasId="initialCanvasId" :activateCanvas="activateCanvas" :flushSave="flushCanvases ?? flushCanvasSave" :saveStatus="saveStatus" @loaded="rememberCanvasSnapshot" @retrySave="flushCanvasSave().catch(() => {})">
        <template #elements><canvasElements :flowId="runtimeKey" :directory="project?.directory" /></template>
      </canvasMenu>
      <canvasControls
        ref="canvasControlsRef"
        v-model:snapEnabled="snapEnabled"
        v-model:showEdges="showEdges"
        v-model:libraryVisible="libraryVisible"
        :canvasId="canvasId"
        :directory="project?.directory"
        :batchHistory="canvasHistory.batch"
        v-model:selectedTool="selectedTool"
        :remoteNodes="nodeChoices"
        :canUndo="canUndo"
        :canRedo="canRedo"
        :canSplitImage="!!splitImageNode && !!imageNodeType && canvasReady"
        :assetsInteractionActive="assetLibraryRef?.interactionActive"
        @undo="changeHistory('undo')"
        @redo="changeHistory('redo')"
        @addNode="addQuickNode"
        @splitImage="openImageSplit"
        @update:showEdges="edgeDisconnect = undefined">
        <template #assets><assetLibrary ref="assetLibraryRef" v-model="assetsVisible" :directory="project?.directory" /></template>
        <template #prompts><canvasPrompts :disabled="!canvasReady" :contextKey="JSON.stringify([project?.directory, canvasId])" @usePrompt="addQuickNode('remote-textNode', $event)" /></template>
      </canvasControls>
      <nodeMenu
        :key="JSON.stringify(['nodeMenu', project?.directory, canvasId])"
        ref="nodeMenuRef"
        :remoteNodes="nodeChoices"
        :directory="project?.directory"
        :loadNodes="loadNodeTypes"
        :pasteNode="pasteClipboardNode"
        :uploadFiles="canvasId && project?.directory ? selectFiles : undefined"
        :canUndo="canUndo"
        :canRedo="canRedo"
        :selectionBusy="selectionToolbarRef?.busy"
        :batchHistory="canvasHistory.batch"
        @duplicateSelection="selectionToolbarRef?.operate('duplicate')"
        @history="canvasHistory.commit"
        @undo="changeHistory('undo')"
        @redo="changeHistory('redo')" />
      <selectionToolbar
        :key="JSON.stringify(['selectionToolbar', project?.directory, canvasId])"
        ref="selectionToolbarRef"
        :batchHistory="canvasHistory.batch"
        :getSignal="() => canvasController.signal"
        :disabled="!canvasId || !project?.directory" />
      <nodeSearch ref="nodeSearchRef" :disabled="!active || settingsVisible || !canvasId || !project?.directory" />
      <imageSplitDialog v-if="splitRequest" :key="JSON.stringify([splitRequest.directory, splitRequest.canvasId, splitRequest.nodeId])" v-bind="splitRequest" :loadNodes="loadNodeTypes" :batchHistory="canvasHistory.batch" @close="splitRequest = undefined" />
    </vue-flow>
    <teleport to="body">
      <el-button
        v-if="edgeDisconnect && findEdge(edgeDisconnect.id)"
        class="edgeDisconnect"
        type="danger"
        circle
        aria-label="断开连接"
        title="断开连接"
        :style="{ left: `${edgeDisconnect.x}px`, top: `${edgeDisconnect.y}px` }"
        @click.stop="
          removeEdges(edgeDisconnect.id);
          edgeDisconnect = undefined;
        "
        @mouseleave="edgeDisconnect = undefined">
        <icon-unlink :size="16" />
      </el-button>
    </teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, markRaw, nextTick, onBeforeUnmount, onMounted, onScopeDispose, provide, ref, shallowReactive, shallowRef, watch } from "vue";
import axios from "axios";
import type { ProductionSelection } from "@toonflow/server/production";
import { debounce } from "lodash-es";
import { ElMessage } from "element-plus";
import { storeToRefs } from "pinia";
import { IconUnlink } from "@tabler/icons-vue";
import * as vueRuntime from "vue";
import * as vueFlowRuntime from "@vue-flow/core";
import * as elementPlusRuntime from "element-plus";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import "element-plus/dist/index.css";
import {
  VueFlow,
  PanOnScrollMode,
  ConnectionMode,
  SelectionMode,
  useVueFlow,
  wheelDelta,
  isMacOs,
  isNode,
  type Node,
  type Edge,
  type EdgeMouseEvent,
  type NodeTypesObject,
  type XYPosition,
} from "@vue-flow/core";
import { Background, BackgroundVariant } from "@vue-flow/background";
import { useCanvasTools } from "./useCanvasTools";
import type { CanvasContext } from "@toonflow/tool-canvas/runtime";
import { loadNodeComponent } from "./loadNodeComponent";
import { useCanvasHistory } from "./useCanvasHistory";
import { copyNodeToClipboard, copyNodesToClipboard, nodeClipboardCommand, readClipboardNodes } from "./nodeClipboard";
import { readClipboardText } from "@/lib/clipboard";
import nodeMenu from "./components/nodeMenu.vue";
import remoteNode from "./components/remoteNode.vue";
import canvasMenu from "./components/canvasMenu.vue";
import canvasControls from "./components/canvasControls.vue";
import canvasEdge from "./components/canvasEdge.vue";
import canvasElements from "./components/canvasElements.vue";
import canvasPrompts from "./components/canvasPrompts.vue";
import { newGenerationData } from "@/lib/creationPreferences";
import assetLibrary from "./components/assetLibrary.vue";
import groupNode from "./components/groupNode.vue";
import smartEditNode from "./components/smartEditNode.vue";
import selectionToolbar from "./components/selectionToolbar.vue";
import nodeSearch from "./components/nodeSearch.vue";
import { finishGroupDrag, getSelectionTree } from "./selectionNodes";
import { isNodeOutput, type NodeOutput } from "@toonflow/nodes-scaffold/values";
import type { NodeConnectionFeedback, NodeHandle } from "@toonflow/nodes-scaffold/connection";
import { useNodeEvent } from "@toonflow/nodes-scaffold/nodeEvent";
import { useNodeToolsContext } from "@toonflow/nodes-scaffold/nodeTools";
import { useWorkspaceStore } from "@/stores/workspace";
import { canvasAppearance, generalSettings } from "@/stores/settings";
import { getShortcutBindings, shortcutLabel, shortcutMatches, shortcutPressed } from "@/lib/canvasShortcuts";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { useProductionStore } from "@/stores/production";
import type { DirectorCapture, DirectorCaptureJob, DirectorProductionBridge, DirectorProductionContext } from "@toonflow/nodes-scaffold/directorProduction";
import { saveCanvasDraft, clearCanvasDraft } from "@/lib/canvasDraft";
import { dropCanvasFiles, importCanvasFiles, isCanvasFileDrag } from "./canvasDrop";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/minimap/dist/style.css";

const props = withDefaults(defineProps<{
  active?: boolean;
  settingsVisible?: boolean;
  runtimeKey?: string;
  initialCanvasId?: string;
  activateCanvas?: (canvasId: string, signal?: AbortSignal) => Promise<void>;
  resolveCanvasContext?: (canvasId: string) => CanvasContext | undefined;
  flushCanvases?: (action?: () => Promise<void>) => Promise<void>;
}>(), { active: true, settingsVisible: false });
const { project } = storeToRefs(useWorkspaceStore());

const canvasElement = ref<HTMLElement>();
const canvasId = ref("");
const imageSplitDialog = defineAsyncComponent(() => import("./components/imageSplitDialog.vue"));
const splitRequest = shallowRef<{ nodeId: string; directory: string; canvasId: string; nodeType: string; signal: AbortSignal }>();
const imageNodeType = computed(() => nodeChoices.value.find(node => ["remote-imageNode", "remote-imageGenerationNode"].includes(node.type))?.type);
const splitImageNode = computed(() => {
  if (flow.getSelectedNodes.value.length !== 1) return undefined;
  const node = flow.getSelectedNodes.value[0]!;
  const output = node.data.outputs?.image;
  return isNodeOutput(output) && output.dataType === "IMAGE" && output.value.url ? node : undefined;
});
function openImageSplit() {
  if (!canvasReady.value || !splitImageNode.value || !imageNodeType.value || !project.value?.directory) return;
  splitRequest.value = { nodeId: splitImageNode.value.id, directory: project.value.directory, canvasId: canvasId.value, nodeType: imageNodeType.value, signal: canvasController.signal };
}
watch([canvasId, () => project.value?.directory], () => { splitRequest.value = undefined; });
const nodeMenuRef = ref<InstanceType<typeof nodeMenu>>();
const canvasMenuRef = ref<InstanceType<typeof canvasMenu>>();
const canvasControlsRef = ref<InstanceType<typeof canvasControls>>();
const selectionToolbarRef = ref<InstanceType<typeof selectionToolbar>>();
const nodeSearchRef = ref<InstanceType<typeof nodeSearch>>();
const nodeTypes = shallowRef<NodeTypesObject>({ canvasGroup: markRaw(groupNode), smartEdit: markRaw(smartEditNode) });
const nodeFramePilot = new URLSearchParams(window.location.search).get("nodeFramePilot") === "1";
const nodeFrameCodes = shallowReactive(new Map<string, string>());
const nodeConfigs = shallowRef<Record<string, Record<string, unknown>>>({});
const nodeOptions = ref<{ type: string; label: string }[]>([]);
const nodeLoads = shallowReactive(new Map<string, Promise<void>>());
const nodeReloads = new Set<string>();
const nodeErrors = ref<Record<string, string>>({});
const nodeOrder: Record<string, number> = {
  "remote-textNode": 0, "remote-imageNode": 1, "remote-videoNode": 2, "remote-audioNode": 3,
  "remote-imageGenerationNode": 1, "remote-videoGenerationNode": 2, "remote-audioGenerationNode": 3, "remote-director3dNode": 4,
};
const availableNodes = computed(() => nodeOptions.value.filter(node => !nodeErrors.value[node.type])
  .sort((left, right) => (nodeOrder[left.type] ?? 8) - (nodeOrder[right.type] ?? 8) || left.type.localeCompare(right.type)));
// 旧类型继续加载和粘贴，新建入口每种媒体只展示一个；统一节点未启用时沿用兼容入口。
const nodeChoices = computed(() => availableNodes.value.filter(node => {
  const match = /^remote-(image|video|audio)GenerationNode$/.exec(node.type);
  return !match || !availableNodes.value.some(item => item.type === `remote-${match[1]}Node`);
}));
const nodeListLoading = ref(true);
const remoteNodeTypes = computed(() => [
  ...new Set(flow.nodes.value.map((item) => item.type).filter((type): type is string => !!type?.startsWith("remote-"))),
]);
let loadRequest = 0;
const snapEnabled = ref(false);
const zoomKeyPressed = ref(false);
const panKeyPressed = ref(false);
const selectedTool = ref<"move" | "hand">("move");
const handMode = computed(() => props.active && !props.settingsVisible && (selectedTool.value === "hand" || panKeyPressed.value));
let pointerPosition: XYPosition | undefined;
const pressedCodes = new Set<string>();
let gestureScale: number | undefined;
let zoomFrame: number | undefined;
let pendingZoom: { factor: number; point?: XYPosition; event: Event } | undefined;
const isDesktop = new URLSearchParams(window.location.search).get("desktop") === "1";
let copyingNodes = false;
const showEdges = ref(true);
const libraryVisible = ref<"assets" | "prompts" | "">("");
const assetsVisible = computed({
  get: () => libraryVisible.value === "assets",
  set: visible => { libraryVisible.value = visible ? "assets" : libraryVisible.value === "assets" ? "" : libraryVisible.value; },
});
const assetLibraryRef = ref<InstanceType<typeof assetLibrary>>();
const edgeDisconnect = ref<{ id: string; x: number; y: number }>();
const selectedEdgeId = ref("");
watch([canvasId, () => props.active], () => clearEdgeSelection());
const flow = useVueFlow(props.runtimeKey);
let dragCopy: ReturnType<InstanceType<typeof selectionToolbar>["startDragCopy"]>;
flow.onNodeDragStart(({ event, nodes }) => {
  dragCopy = undefined;
  if (!props.active || props.settingsVisible) return;
  const shortcuts = generalSettings.value.canvasShortcuts;
  const withEdges = shortcutPressed(event, shortcuts.duplicateOnDrag, pressedCodes);
  if (withEdges || shortcutPressed(event, shortcuts.copyOnDrag, pressedCodes)) {
    dragCopy = selectionToolbarRef.value?.startDragCopy(nodes, withEdges);
  }
});
flow.onNodeDrag(() => dragCopy?.update());
flow.onNodeDragStop(({ nodes }) => {
  const copy = dragCopy;
  dragCopy = undefined;
  if (copy) copy.finish();
  else finishGroupDrag(flow.getNodes.value, nodes);
});
const canvasHistory = useCanvasHistory(flow, () =>
  project.value?.directory && canvasId.value ? JSON.stringify([project.value.directory, canvasId.value]) : ""
);
const { canUndo, canRedo } = canvasHistory;
provide("batchCanvasHistory", canvasHistory.batch);
const getNodeTools = useNodeToolsContext();
const { addNodes, addEdges, removeEdges, findEdge, findNode, toObject, viewport, screenToFlowCoordinate } = flow;
provide("copyNodeToClipboard", (node: Parameters<typeof copyNodeToClipboard>[0]) => copyNodeToClipboard(node, project.value?.directory ?? ""));
provide("retainNodeFiles", true);
provide("nodeGenerationDisabled", nodeFramePilot);
provide("nodeCanvasActive", computed(() => props.active));
provide("selectionConnection", shallowRef<NodeConnectionFeedback>());
provide("saveNodeToAssets", (label: string, outputs: { label: string; output: NodeOutput }[]) => assetLibraryRef.value?.openSave(label, outputs));
let canvasController = new AbortController();
let workspaceController = new AbortController();
const createCanvasContext = useCanvasTools({
  availableNodes,
  nodeChoices,
  loadNodes: loadNodeTypes,
  flushSave: flushCanvasSave,
  menu() {
    if (!canvasMenuRef.value) throw new Error("画布菜单尚未就绪");
    return canvasMenuRef.value;
  },
  getCanvasBinding: () => ({ id: canvasId.value, signal: canvasController.signal }),
  resolveCanvasContext: id => props.resolveCanvasContext?.(id),
});
const canvasCalls = ref(0);
function getCanvasContext() {
  if (!canvasId.value) return;
  const context = createCanvasContext(canvasId.value, canvasController.signal, workspaceController.signal);
  return { ...context, get tools() { return context.tools; }, async call(...args: Parameters<CanvasContext["call"]>) {
    canvasCalls.value++;
    try { return await context.call(...args); }
    finally { canvasCalls.value--; }
  } };
}
const canvasReady = computed(() => !!canvasId.value && !nodeListLoading.value && nodeLoads.size === 0
  && remoteNodeTypes.value.every(type => nodeTypes.value[type] || !availableNodes.value.some(node => node.type === type)));
watch([remoteNodeTypes, nodeOptions, canvasId, () => project.value?.directory], ([types, _options, id, directory]) => {
  if (!id || !directory) return;
  // 只加载画布实际用到的类型，导入、粘贴和撤销恢复的节点也走同一入口。
  void loadNodeTypes(types.filter(type => availableNodes.value.some(node => node.type === type)))
    .catch(error => console.error("加载画布节点失败", error));
});
provide("canvas", getCanvasContext);
const production = useProductionStore();
const directorHeaders = { "x-toonflow-workspace": "1" };
const directorFocus = ref<{ nodeId: string; viewport: { x: number; y: number; zoom: number } }>();
let focusingDirector = false;
async function focusDirectorControls(nodeId: string) {
  const target = findNode(nodeId); if (!target || !props.active) return;
  focusingDirector = true;
  try {
    const dimensions = flow.dimensions.value;
    const zoom = Math.min(1, Math.max(0.2, (dimensions.width - 40) / 720), Math.max(0.2, (dimensions.height - 160) / ((target.dimensions.height || 240) + 400)));
    await flow.setViewport({ zoom, x: dimensions.width / 2 - (target.computedPosition.x + (target.dimensions.width || 320) / 2) * zoom, y: 100 - target.computedPosition.y * zoom }, { duration: 0 });
    directorFocus.value = { nodeId, viewport: { ...flow.viewport.value } };
  } finally { focusingDirector = false; }
}
watch(() => { const focus = directorFocus.value; const node = focus && findNode(focus.nodeId); return node ? [node.dimensions.width, node.dimensions.height, node.selected] as const : undefined; }, async (value, previous) => {
  const focus = directorFocus.value;
  if (!focus || !value || focusingDirector) return;
  if (!value[2]) { directorFocus.value = undefined; return; }
  if (value[0] === previous?.[0] && value[1] === previous?.[1]) return;
  const current = flow.viewport.value;
  // 用户自己平移或缩放后保留其取景；只跟随刚准备的节点在输出到达时改变的尺寸。
  if (["x", "y", "zoom"].some(key => Math.abs(current[key as keyof typeof current] - focus.viewport[key as keyof typeof current]) > 0.001)) { directorFocus.value = undefined; return; }
  await focusDirectorControls(focus.nodeId);
}, { flush: "post" });
function directorScope() { if (!project.value?.directory || !canvasId.value || !canvasReady.value) throw new Error("请等待当前画布保存并载入"); return { directory: project.value.directory, canvasId: canvasId.value }; }
async function readDirectorCapture(captureId: string) {
  const scope = directorScope();
  const { data } = await axios.get<{ data: DirectorCapture }>("/api/production/director/capture", { params: { directory: scope.directory, captureId }, headers: directorHeaders });
  if (scope.directory !== project.value?.directory) throw new Error("工作空间已切换，请重新打开导演参考");
  return data.data;
}
async function updateDirector(operation: Parameters<typeof production.update>[0]) { const scope = directorScope(); await flushCanvasSave(); await production.load(); await production.update(operation, scope.directory); }
const directorBridge: DirectorProductionBridge = {
  async context(nodeId) { const scope = directorScope(); await flushCanvasSave(); const { data } = await axios.get<{ data: DirectorProductionContext }>("/api/production/director/context", { params: { ...scope, nodeId }, headers: directorHeaders }); return data.data; },
  async bind(nodeId, anchorId, shotId) { const scope = directorScope(); await updateDirector({ type: "bindDirector", canvasId: scope.canvasId, nodeId, anchorId, shotId }); },
  async reserve(nodeId, job: DirectorCaptureJob) { const scope = directorScope(); const { mediaPath: _path, mediaHash: _hash, ...input } = job; await updateDirector({ type: "reserveDirectorCapture", ...input, canvasId: scope.canvasId, nodeId }); return readDirectorCapture(job.captureId); },
  capture: readDirectorCapture,
  async finish(captureId, mediaPath, mediaHash) { await updateDirector({ type: "finishDirectorCapture", captureId, mediaPath, mediaHash }); return readDirectorCapture(captureId); },
  prepare: prepareDirectorGeneration,
  flush: flushCanvasSave,
};
provide("directorProduction", directorBridge);
function directorNodePosition(x: number, y: number, width: number) {
  for (const node of [...flow.getNodes.value].sort((a, b) => a.computedPosition.y - b.computedPosition.y)) {
    const position = node.computedPosition;
    if (position.x < x + width && position.x + (node.dimensions.width || 320) > x && position.y < y + 320 && position.y + (node.dimensions.height || 300) > y) y = position.y + (node.dimensions.height || 300) + 64;
  }
  return { x, y };
}
async function prepareDirectorGeneration(captureId: string, mediaType: "image" | "video") {
  const scope = directorScope(); const capture = await readDirectorCapture(captureId);
  if (!capture.file || capture.status !== "completed" || capture.canvasId !== scope.canvasId) throw new Error("请先保存当前画布的导演参考");
  if (mediaType === "image" && !capture.file.mimeType.startsWith("image/")) throw new Error("图片生成需要机位截图参考，请先生成截图");
  const type = `remote-${mediaType}Node`; const referenceType = capture.file.mimeType.startsWith("image/") ? "image" : "video";
  if (!availableNodes.value.some(item => item.type === type) || !availableNodes.value.some(item => item.type === `remote-${referenceType}Node`)) throw new Error("请先启用对应媒体节点插件");
  const targetId = mediaType === "image" ? capture.imageNodeId : capture.videoNodeId;
  const origin = findNode(capture.nodeId!);
  if (!origin) throw new Error("原导演节点已被移除，请查看机位快照或重新绑定");
  if (!findNode(capture.referenceNodeId)) addNodes({ id: capture.referenceNodeId, type: `remote-${referenceType}Node`, position: directorNodePosition(origin.computedPosition.x + 440, origin.computedPosition.y + 380, 480), data: { label: `${capture.name} · 固定参考`, outputs: { [referenceType]: { dataType: referenceType === "image" ? "IMAGE" : "VIDEO", value: { url: capture.file.path, mimeType: capture.file.mimeType } } } } });
  if (!findNode(targetId)) {
    const shot = production.project?.shots.find(shot => shot.shotId === capture.shotId);
    const snapshot = capture.snapshot as { anchor: { aspect: string; camera: { fov: number } } };
    addNodes({ id: targetId, type, position: directorNodePosition(origin.computedPosition.x + 960, origin.computedPosition.y + (mediaType === "image" ? 0 : 380), 480), data: { ...newGenerationData(type), label: `${shot?.title || '镜头'} · ${mediaType === 'image' ? '图片' : '视频'}候选`, prompt: [shot?.story, shot?.dialogue && `对白：${shot.dialogue}`, `参考机位：${capture.name}，画幅 ${snapshot.anchor.aspect}，视场角 ${snapshot.anchor.camera.fov.toFixed(1)}°。保持参考构图。`].filter(Boolean).join("\n"), ratio: snapshot.anchor.aspect, productionDirector: { projectId: capture.projectId, shotId: capture.shotId, directorShotId: capture.directorShotId } } });
  }
  const edgeId = `${capture.referenceNodeId}:${targetId}`;
  if (!findEdge(edgeId)) addEdges({ id: edgeId, source: capture.referenceNodeId, sourceHandle: referenceType, target: targetId, targetHandle: "in" });
  flow.getNodes.value.forEach(node => { node.selected = node.id === targetId; });
  await nextTick();
  // 节点参数面板在媒体框外，定位时为其预留宽度和高度，避免把空输出框放大到挡住生成控件。
  await focusDirectorControls(targetId);
  await flushCanvasSave();
}
async function openDirectorSource(capture: DirectorCapture) {
  if (capture.canvasId !== canvasId.value) throw new Error("请先打开机位所属画布");
  const snapshot = capture.snapshot as { modelDocument: unknown; anchor: { id: string }; lighting: unknown; settings: unknown; selectedPlanId: string | null };
  if (!availableNodes.value.some(item => item.type === "remote-director3dNode")) throw new Error("请先启用导演台插件");
  if (!findNode(capture.previewNodeId)) addNodes({ id: capture.previewNodeId, type: "remote-director3dNode", position: { x: Math.max(0, ...flow.getNodes.value.map(node => node.computedPosition.x)) + 480, y: 0 }, data: { label: `机位快照 · ${capture.name}`, outputs: {}, modelSnapshot: snapshot.modelDocument, anchors: [snapshot.anchor], lighting: snapshot.lighting ?? undefined, sceneSettings: snapshot.settings ?? undefined, selectedPlanId: snapshot.selectedPlanId ?? undefined, productionReferenceSource: capture.directorShotId } });
  flow.getNodes.value.forEach(node => { node.selected = node.id === capture.previewNodeId; });
  await nextTick();
  await flushCanvasSave();
  const context = getCanvasContext(); if (!context) throw new Error("画布尚未就绪，请重新打开快照");
  await context.call({ name: "nodeTools", args: { nodeId: capture.previewNodeId, name: "node:openDirector", args: { anchorId: snapshot.anchor.id } } });
}
async function applyProductionSelection(selection: ProductionSelection, directory: string) {
  if (directory !== project.value?.directory || selection.canvasId !== canvasId.value || !selection.nodeId) throw new Error("目标画布已切换，请重新同步采用结果");
  const node = flow.findNode(selection.nodeId);
  const context = getCanvasContext();
  if (!node || !context) throw new Error("绑定节点已删除，请在分镜中重新绑定");
  await nextTick();
  const mediaType = selection.file.mimeType.split("/")[0] as "image" | "video" | "audio";
  const tool = { image: "node:setImage", video: "node:setVideo", audio: "node:setAudio" }[mediaType];
  if (!tool || !node.data.handles?.some((handle: { type: string; id: string }) => handle.type === "source" && handle.id === mediaType)) throw new Error(`当前绑定节点不能显示${{ image: "图片", video: "视频", audio: "音频" }[mediaType] || '此类媒体'}，请重新绑定对应媒体节点`);
  await context.call({ name: "nodeTools", args: { nodeId: node.id, name: tool, args: { path: selection.file.path, mimeType: selection.file.mimeType } } });
  if (directory !== project.value?.directory || flow.findNode(node.id) !== node || selection.canvasId !== canvasId.value) throw new Error("目标节点已变化，采用记录仍在原工作空间，请重新同步");
  // 采用依据独立于可继续编辑的生成草稿，不改写节点的提示词或模型选择。
  node.data.productionSelection = JSON.parse(JSON.stringify(selection));
  await flushCanvasSave();
}
function hasProductionSelection(nodeId: string, candidateId: string) { return flow.findNode(nodeId)?.data.productionSelection?.candidateId === candidateId; }
defineExpose({ canvasId, canvasReady, getCanvasContext, readDocumentNode, saveDocumentNode, flushSave: flushCanvasSave, cancelSave: cancelCanvasSave,
  applyProductionSelection, hasProductionSelection, openDirectorSource,
  getMentionNodes: () => flow.nodes.value, findMentionNode: flow.findNode,
  getRetainedNodes: canvasHistory.getRetainedNodes,
  exportHistory: canvasHistory.exportState, importHistory: canvasHistory.importState,
  get canRelease() { return canvasReady.value && !canvasCalls.value && !savePaused && !canvasDirty.value && canvasHistory.canUnload()
    && flow.getNodes.value.every(node => node.type === "canvasGroup" || useNodeEvent(node.id, flow).emit("canUnload")); },
  get saveBusy() { return savePaused; }, get loadError() { return canvasMenuRef.value?.loadError ?? ""; },
});

type DocumentNodeData = { label?: string; handles?: NodeHandle[]; outputs?: Record<string, NodeOutput | undefined>; textPath?: string };

function checkDocumentDirectory(directory: string) {
  if (!directory || directory !== project.value?.directory) throw new Error("工作目录已切换，请重新打开节点");
}

function documentHandles(node: Node<DocumentNodeData>) {
  const handles = node.data?.handles;
  if (Array.isArray(handles) && handles.length) {
    return handles.filter(
      (handle) =>
        handle &&
        typeof handle.id === "string" &&
        handle.type === "source" &&
        (Array.isArray(handle.dataType) ? handle.dataType.includes("STRING") : handle.dataType === "STRING")
    );
  }
  return Object.entries(node.data?.outputs ?? {}).flatMap(([id, output]) => (output?.dataType === "STRING" ? [{ id, label: id }] : []));
}

async function readDocumentCanvas(directory: string, canvasPath: string, nodeId: string) {
  checkDocumentDirectory(directory);
  const files = useWorkspaceFiles(directory);
  const canvas = await files.readJson<{ toonflowCanvas?: boolean; nodes?: Node<DocumentNodeData>[] }>(canvasPath);
  checkDocumentDirectory(directory);
  if (canvas?.toonflowCanvas !== true || !Array.isArray(canvas.nodes)) throw new Error("文件不是有效画布");
  const node = canvas.nodes.find((item) => item && item.id === nodeId);
  if (!node) throw new Error("节点已删除，请刷新文件树");
  if (node.data !== undefined && (!node.data || typeof node.data !== "object" || Array.isArray(node.data))) throw new Error("节点数据无效");
  const liveNode = canvasId.value === canvasPath ? findNode(nodeId) : undefined;
  if (canvasId.value === canvasPath && !liveNode) throw new Error("节点已删除，请刷新文件树");
  const textPath = node.data?.textPath;
  if (
    textPath !== undefined &&
    (typeof textPath !== "string" ||
      !textPath.trim() ||
      /^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(textPath) ||
      textPath.includes("\0") ||
      textPath.split(/[\\/]/).includes(".."))
  )
    throw new Error("文本文件路径必须位于工作区内");
  return { files, canvas, node, liveNode, textPath };
}

async function readDocumentNode(directory: string, canvasPath: string, nodeId: string) {
  checkDocumentDirectory(directory);
  await flushCanvasSave();
  const { files, node, liveNode, textPath } = await readDocumentCanvas(directory, canvasPath, nodeId);
  const source = liveNode ?? node;
  const handles = documentHandles(source);
  if (!handles.length) throw new Error("节点没有文本输出，请刷新文件树");
  const storedText = textPath === undefined ? undefined : await files.readText(textPath);
  checkDocumentDirectory(directory);
  return {
    label: typeof source.data?.label === "string" ? source.data.label : nodeId,
    outputs: handles.map((handle) => {
      const output = source.data?.outputs?.[handle.id];
      return {
        id: handle.id,
        label: handle.label || handle.id,
        text: output?.dataType === "STRING" && typeof output.value === "string" ? output.value : storedText ?? "",
      };
    }),
  };
}

async function saveDocumentNode(directory: string, canvasPath: string, nodeId: string, handleId: string, text: string) {
  checkDocumentDirectory(directory);
  await flushCanvasSave(async () => {
    const { files, canvas, node, liveNode, textPath } = await readDocumentCanvas(directory, canvasPath, nodeId);
    if (!documentHandles(liveNode ?? node).some((handle) => handle.id === handleId)) throw new Error("文本输出已删除，请重新打开节点");
    if (liveNode?.type === "remote-textNode") {
      await getNodeTools().call({ nodeId, name: "node:setText", args: { text } }, canvasController.signal);
      checkDocumentDirectory(directory);
    }
    if (textPath !== undefined) {
      if (liveNode?.type !== "remote-textNode") await files.write(textPath, text);
    } else {
      const data = (node.data ??= {});
      const output = data.outputs?.[handleId];
      if (output?.dataType === "STRING") output.value = text;
      else (data.outputs ??= {})[handleId] = { dataType: "STRING", value: text };
      await files.writeJson(canvasPath, canvas);
    }
    checkDocumentDirectory(directory);
    if (liveNode && canvasId.value === canvasPath && findNode(nodeId) === liveNode) {
      const output = liveNode.data.outputs?.[handleId];
      if (output?.dataType === "STRING") output.value = text;
      else if (textPath === undefined) (liveNode.data.outputs ??= {})[handleId] = { dataType: "STRING", value: text };
    }
    canvasMenuRef.value?.syncDocumentNode(canvasPath, nodeId, handleId, text, textPath === undefined);
  });
}

function showEdgeDisconnect({ event, edge }: EdgeMouseEvent) {
  if (!(event instanceof MouseEvent)) return;
  event.stopPropagation();
  selectedEdgeId.value = edge.id;
  edgeDisconnect.value = { id: edge.id, x: event.clientX, y: event.clientY };
}

function clearEdgeSelection() {
  selectedEdgeId.value = "";
  edgeDisconnect.value = undefined;
}

function clearBackgroundSelection(event: PointerEvent) {
  if (event.button !== 0 || !props.active || props.settingsVisible || !(event.target instanceof Element)
    || !event.target.classList.contains("vue-flow__pane")) return;
  // ACT: 框选或平移可能消耗 click；空白处按下时就清除边和节点的关联高亮。
  clearEdgeSelection();
  flow.removeSelectedElements();
}

function dragFilesOver(event: DragEvent) {
  if (!props.active || props.settingsVisible || !canvasId.value || !project.value?.directory || !isCanvasFileDrag(event)) return;
  if (!(event.target instanceof Element) || !event.target.closest(".vue-flow__pane")) return;
  event.preventDefault();
  event.dataTransfer!.dropEffect = "copy";
  return true;
}

async function dropFiles(event: DragEvent) {
  const directory = project.value?.directory;
  if (!directory || !dragFilesOver(event)) return;
  try {
    await canvasHistory.batch(() => dropCanvasFiles(event, { directory, availableNodes: availableNodes.value, signal: canvasController.signal, flow }));
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "文件导入失败");
  }
}

function selectFiles(position: { x: number; y: number }) {
  const directory = project.value?.directory;
  if (!props.active || props.settingsVisible || !canvasId.value || !directory) return;
  const context = { directory, availableNodes: availableNodes.value, signal: canvasController.signal, flow };
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.onchange = async () => {
    const files = Array.from(input.files ?? []);
    if (!files.length || context.signal.aborted) return;
    try {
      await canvasHistory.batch(() => importCanvasFiles(files, position, context));
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "文件导入失败");
    }
  };
  input.click();
}

function centerPosition() {
  const rect = flow.vueFlowRef.value?.getBoundingClientRect();
  return rect ? screenToFlowCoordinate({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 0, y: 0 };
}
async function addQuickNode(type: string, text?: string) {
  const option = availableNodes.value.find(item => item.type === type);
  if (!option || !canvasReady.value) return;
  await canvasHistory.batch(async () => {
    const id = crypto.randomUUID();
    flow.removeSelectedElements();
    const position = centerPosition();
    addNodes({ id, type, position: { x: position.x - 160, y: position.y - 100 }, data: { ...newGenerationData(type), label: option.label, ...(text ? { outputs: { text: { dataType: 'STRING', value: text } } } : {}) } });
    await nextTick();
    const created = flow.findNode(id);
    if (created) flow.addSelectedNodes([created]);
  }).catch(error => ElMessage.error(error instanceof Error ? error.message : '添加节点失败'));
}

function openNodeMenu(event: MouseEvent) {
  if (event.target instanceof Element && event.target.classList.contains("vue-flow__pane")) nodeMenuRef.value?.openMenu(event, true);
}

function addNodeAtPointer() {
  const rect = canvasElement.value?.getBoundingClientRect();
  if (!rect) return;
  const position = pointerPosition ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  void nodeMenuRef.value?.openMenu(new MouseEvent("contextmenu", { clientX: position.x, clientY: position.y }), true);
}

async function changeHistory(direction: "undo" | "redo") {
  try {
    await canvasHistory[direction]();
    edgeDisconnect.value = undefined;
  } catch (error) {
    ElMessage.error(
      axios.isAxiosError<{ message?: string }>(error)
        ? error.response?.data.message || "恢复画布失败"
        : error instanceof Error
        ? error.message
        : "恢复画布失败"
    );
  }
}

let saving = Promise.resolve();
let flushing = Promise.resolve();
let saveError: unknown;
let savePaused = false;
let saveCancelled = false;
let changedWhilePaused = false;
let saveRevision = 0;
let savedSnapshotKey = "";
const saveStatus = ref("已保存");
const canvasDirty = ref(false);
const pendingCanvasSaves = new Map<string, {
  directory: string;
  fileName: string;
  snapshot: ReturnType<typeof toObject>;
  revision: number;
  draft?: string;
}>();
// 正常自动保存不闪动状态；停下编辑后仍未保存完成，才显示进度。
const showSavePending = debounce(() => {
  if (canvasDirty.value && !saveStatus.value.includes("失败")) saveStatus.value = "正在保存…";
}, 1000);
function getCanvasSnapshot() {
  const snapshot = toObject();
  for (const node of snapshot.nodes) Reflect.deleteProperty(node, "initialized");
  for (const edge of snapshot.edges) {
    for (const key of ["sourceX", "sourceY", "targetX", "targetY", "initialized"]) Reflect.deleteProperty(edge, key);
  }
  return snapshot;
}
function rememberCanvasSnapshot() {
  savedSnapshotKey = JSON.stringify(getCanvasSnapshot());
}
function backupCanvas(snapshot?: ReturnType<typeof toObject>) {
  if (!canvasDirty.value || !project.value?.directory || !canvasId.value) return;
  try { return saveCanvasDraft(project.value.directory, canvasId.value, { toonflowCanvas: true, ...(snapshot ?? getCanvasSnapshot()) }); }
  catch { saveStatus.value = "本地备份失败，请保持页面开启并保存"; }
}
function protectCanvas(event: BeforeUnloadEvent) {
  if (!canvasDirty.value) return;
  backupCanvas();
  saveCanvas.flush();
  event.preventDefault(); event.returnValue = "";
}
window.addEventListener("beforeunload", protectCanvas);
onScopeDispose(() => { showSavePending.cancel(); window.removeEventListener("beforeunload", protectCanvas); });
const saveCanvas = debounce((directory: string, fileName: string) => {
  const snapshot = getCanvasSnapshot();
  const key = JSON.stringify([directory, fileName]);
  // ACT: 备份和写盘共用一次快照；慢请求期间同一文件只保留最新待保存版本。
  pendingCanvasSaves.set(key, { directory, fileName, snapshot, revision: saveRevision, draft: backupCanvas(snapshot) });
  saving = saving.then(async () => {
    const pending = pendingCanvasSaves.get(key);
    if (!pending) return;
    pendingCanvasSaves.delete(key);
    const { directory, fileName, snapshot, revision, draft } = pending;
    try {
      const snapshotKey = JSON.stringify(snapshot);
      // ACT: 在串行写队列中比较，保留慢写期间再次编辑或撤回到原内容的保存。
      if (snapshotKey !== savedSnapshotKey) {
        await useWorkspaceFiles(directory).writeJson(fileName, { toonflowCanvas: true, nodes: snapshot.nodes, edges: snapshot.edges, viewport: snapshot.viewport });
        savedSnapshotKey = snapshotKey;
      }
      saveError = undefined;
      if (revision === saveRevision) { showSavePending.cancel(); canvasDirty.value = false; saveStatus.value = "已保存"; }
      if (draft) clearCanvasDraft(directory, fileName, draft);
    } catch (err) {
      showSavePending.cancel();
      saveError = err;
      canvasDirty.value = true; saveStatus.value = "保存失败，修改仍保留在当前页面";
      ElMessage.error(
        axios.isAxiosError<{ message?: string }>(err)
          ? err.response?.data.message || "画布保存失败"
          : err instanceof Error
          ? err.message
          : "画布保存失败"
      );
    }
  });
}, 150, { maxWait: 1000 });

function scheduleCanvasSave() {
  queueCanvasSave(true);
}

function queueCanvasSave(showStatus: boolean) {
  if (saveCancelled) return;
  saveRevision++;
  if (project.value?.directory && canvasId.value) {
    canvasDirty.value = true;
    if (showStatus) showSavePending();
  }
  if (savePaused) {
    changedWhilePaused = true;
    return;
  }
  const directory = project.value?.directory;
  if (directory && canvasId.value) saveCanvas(directory, canvasId.value);
}

function scheduleCanvasChange() {
  scheduleCanvasSave();
  canvasHistory.record();
}

const elementSaveWatchers = new Map<Node | Edge, () => void>();
const nodeRuntimeFields = new Set([
  "data",
  "computedPosition",
  "handleBounds",
  "selected",
  "dimensions",
  "isParent",
  "resizing",
  "dragging",
  "position",
  "events",
  "initialized",
]);
const edgeRuntimeFields = new Set(["data", "selected", "sourceNode", "targetNode", "sourceX", "sourceY", "targetX", "targetY", "events", "initialized"]);
// ACT: 仅增删、替换元素时扫描列表；位移与 data 各自监听，单个节点变化不遍历其余节点。
watch(
  () => [...flow.nodes.value, ...flow.edges.value],
  (elements) => {
    const current = new Set<Node | Edge>(elements);
    for (const [element, stop] of elementSaveWatchers) {
      if (!current.has(element)) {
        stop();
        elementSaveWatchers.delete(element);
      }
    }
    for (const element of elements) {
      if (elementSaveWatchers.has(element)) continue;
      // 与 toObject 排除的运行态字段保持一致，其他自定义持久字段仍参与自动保存。
      const runtimeFields = isNode(element) ? nodeRuntimeFields : edgeRuntimeFields;
      const stopFields = watch(
        () =>
          Object.keys(element)
            .filter((key) => !runtimeFields.has(key))
            .map((key) => Reflect.get(element, key)),
        scheduleCanvasChange,
        { deep: true, flush: "post" }
      );
      const stopData = watch(() => element.data, scheduleCanvasSave, { deep: true, flush: "post" });
      // 位移只监听坐标；拖动中不重复遍历全部持久字段或安排撤销快照。
      const stopPosition = isNode(element)
        ? watch(
            () => [element.position.x, element.position.y, element.dragging],
            () => {
              scheduleCanvasSave();
              if (!element.dragging) canvasHistory.record();
            },
            { flush: "post" }
          )
        : () => {};
      const stopName = isNode(element)
        ? watch(
            () => element.data?.label,
            () => canvasHistory.record(),
            { flush: "post" }
          )
        : () => {};
      elementSaveWatchers.set(element, () => {
        stopFields();
        stopData();
        stopPosition();
        stopName();
      });
    }
    scheduleCanvasChange();
  },
  { immediate: true, flush: "post" }
);
onScopeDispose(() => elementSaveWatchers.forEach((stop) => stop()));
// 平移和缩放仍记住视角，但不显示内容修改的保存提示。
watch(() => [viewport.value.x, viewport.value.y, viewport.value.zoom], () => queueCanvasSave(false), { flush: "post" });

watch(
  [() => project.value?.directory, canvasId],
  ([directory, fileName], [previousDirectory, previousFileName]) => {
    if (directory !== previousDirectory) {
      workspaceController.abort(new Error("工作区已切换，本轮画布操作已停止"));
      workspaceController = new AbortController();
    }
    edgeDisconnect.value = undefined;
    dragCopy = undefined;
    pointerPosition = undefined;
    resetCanvasKeys();
    // 同一实例只在重新装载画布时失效；重命名仅更新保存路径。
    if (directory !== previousDirectory || !fileName || !previousFileName) {
      canvasController.abort(new Error("画布已重新加载，本次画布调用已停止"));
      canvasController = new AbortController();
    }
    if (!savePaused) saveCanvas.flush();
  },
  { flush: "sync" }
);

// ACT: 切换显示面板不会卸载画布；仅清理交互，不中断本轮工具调用。
watch(() => props.active, (active) => {
  if (!active) { libraryVisible.value = ""; splitRequest.value = undefined; }
  edgeDisconnect.value = undefined;
  dragCopy = undefined;
  pointerPosition = undefined;
  resetCanvasKeys();
}, { flush: "sync" });

function flushCanvasSave(action?: () => Promise<void>): Promise<void> {
  // ACT: 完整保存及其文件操作串行执行，重命名暂停期间的显式保存也必须等待。
  const next = flushing.then(() => saveCanvasState(action));
  flushing = next.catch(() => {});
  return next;
}

async function saveCanvasState(action?: () => Promise<void>) {
  if (saveCancelled) throw new Error("画布保存已取消");
  await Promise.all(flow.getNodes.value.map((node) => useNodeEvent(node.id, flow).emit("save")));
  await nextTick();
  if (saveCancelled) throw new Error("画布保存已取消");
  if (saveError && project.value?.directory && canvasId.value) saveCanvas(project.value.directory, canvasId.value);
  if (action) savePaused = true;
  try {
    let revision: number;
    do {
      if (saveCancelled) throw new Error("画布保存已取消");
      revision = saveRevision;
      if (changedWhilePaused && project.value?.directory && canvasId.value) {
        saveCanvas(project.value.directory, canvasId.value);
        changedWhilePaused = false;
      }
      saveCanvas.flush();
      await saving;
      if (saveError) throw saveError;
      // 画布写入期间节点可能完成生成，等新增落盘后重新保存变化。
      await Promise.all(flow.getNodes.value.map((node) => useNodeEvent(node.id, flow).emit("save")));
      await nextTick();
    } while (revision !== saveRevision);
    if (saveCancelled) throw new Error("画布保存已取消");
    await action?.();
  } finally {
    if (action && !saveCancelled) {
      savePaused = false;
      if (changedWhilePaused && project.value?.directory && canvasId.value) saveCanvas(project.value.directory, canvasId.value);
      changedWhilePaused = false;
    }
  }
}

function cancelCanvasSave() {
  showSavePending.cancel();
  pendingCanvasSaves.clear();
  if (project.value?.directory && canvasId.value) clearCanvasDraft(project.value.directory, canvasId.value);
  canvasDirty.value = false;
  saveCancelled = true;
  savePaused = true;
  changedWhilePaused = false;
  saveCanvas.cancel();
}
const canvasControlSelector = "input, textarea, select, button, audio, video, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='slider']";
function canUseCanvasClipboard(event: Event) {
  const target = event.target;
  return props.active && !event.defaultPrevented && !props.settingsVisible && !!canvasId.value && !!project.value?.directory
    && target instanceof Element
    && !target.closest(canvasControlSelector) && !target.closest("[role='dialog'], #agentPanel")
    && (target === document.body || target === document.documentElement || canvasElement.value?.contains(target));
}

function beforeClipboard(event: Event) {
  if (!canUseCanvasClipboard(event)) return;
  if (event.type === "beforecopy" && (!flow.getSelectedNodes.value.length || window.getSelection()?.toString())) return;
  // ACT: WKWebView 通过 beforecopy/beforepaste 判定非输入区能否使用原生编辑菜单。
  event.preventDefault();
}

function copyNode(event: ClipboardEvent) {
  if (!canUseCanvasClipboard(event) || !flow.getSelectedNodes.value.length || window.getSelection()?.toString()) return;
  event.preventDefault();
  void copySelectedNodes();
}

async function copySelectedNodes() {
  if (copyingNodes || !project.value?.directory) return;
  const nodes = getSelectionTree(flow.getSelectedNodes.value, flow.getNodes.value);
  if (!nodes.length) return;
  const directory = project.value.directory;
  const signal = canvasController.signal;
  copyingNodes = true;
  try {
    const ids = new Set(nodes.map(node => node.id));
    const snapshot = toObject();
    const savedNodes = new Map(snapshot.nodes.map(node => [node.id, node]));
    const copies = await Promise.all(nodes.map(async node => {
      const patch = await useNodeEvent(node.id, flow).emit("copy");
      const saved = savedNodes.get(node.id)!;
      const parentNode = ids.has(saved.parentNode ?? "") ? saved.parentNode : undefined;
      return { ...saved, data: { ...saved.data, ...patch }, parentNode,
        ...(saved.parentNode && !parentNode ? { extent: undefined, expandParent: false } : {}),
        position: parentNode ? { ...saved.position } : { x: node.computedPosition.x, y: node.computedPosition.y } };
    }));
    signal.throwIfAborted();
    if (nodes.some(node => findNode(node.id) !== node)) throw new Error("节点已变化，请重新复制");
    const edges = snapshot.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
    await copyNodesToClipboard(copies, edges, directory);
  } catch (error) {
    if (!signal.aborted) ElMessage.error(error instanceof Error ? error.message : "节点复制失败");
  } finally {
    copyingNodes = false;
  }
}

async function pasteNode(event: ClipboardEvent) {
  if (!canUseCanvasClipboard(event)) return;
  const command = event.clipboardData?.getData("text/plain") ?? "";
  if (!nodeClipboardCommand.test(command)) return;
  event.preventDefault();
  await pasteNodeAtCenter(command);
}

async function pasteNodeAtCenter(command?: string) {
  const rect = canvasElement.value?.getBoundingClientRect();
  if (!rect) return;
  const position = screenToFlowCoordinate({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  await pasteClipboardNode(position, command);
}

async function pasteClipboardNode(position: { x: number; y: number }, command?: string) {
  if (!props.active || !canvasId.value || !project.value?.directory) return false;
  const canvasSignal = canvasController.signal;
  try {
    const directory = project.value.directory;
    const snapshot = await readClipboardNodes(command ?? (await readClipboardText()), directory);
    if (canvasSignal.aborted) return false;
    if (!snapshot) throw new Error("剪贴板中没有可粘贴的节点命令");
    if (snapshot.nodes.some(node => node.type !== "canvasGroup" && node.type !== "smartEdit" && !availableNodes.value.some(item => item.type === node.type))) {
      throw new Error("请先安装并启用对应的节点插件");
    }
    const ids = new Map(snapshot.nodes.map(node => [node.id, crypto.randomUUID()]));
    const roots = snapshot.nodes.filter(node => !node.parentNode);
    const left = Math.min(...roots.map(node => node.position.x));
    const top = Math.min(...roots.map(node => node.position.y));
    await canvasHistory.batch(async () => {
      flow.removeSelectedElements();
      addNodes(snapshot.nodes.map(node => ({ ...node, id: ids.get(node.id)!, parentNode: ids.get(node.parentNode ?? ""), selected: true,
        position: node.parentNode ? node.position : { x: position.x + node.position.x - left, y: position.y + node.position.y - top } })));
      await nextTick();
      if (canvasSignal.aborted) return;
      addEdges(snapshot.edges.map(edge => ({ ...edge, id: crypto.randomUUID(), source: ids.get(edge.source)!, target: ids.get(edge.target)! })));
    });
    return true;
  } catch (error) {
    const pasteShortcut = generalSettings.value.canvasShortcuts.paste;
    const clipboardMessage = getShortcutBindings(pasteShortcut).some(binding => /^(Ctrl|Meta)\+KeyV$/.test(binding))
      ? `无法读取剪贴板，请在画布上按 ${shortcutLabel(pasteShortcut)} 粘贴`
      : "无法读取剪贴板，请允许浏览器访问剪贴板";
    if (!canvasSignal.aborted)
      ElMessage.error(
        error instanceof DOMException && error.name === "NotAllowedError" ? clipboardMessage : error instanceof Error ? error.message : "节点粘贴失败"
      );
    return false;
  }
}

function zoomCanvas(event: WheelEvent | (Event & { scale: number })) {
  if (event.type === "gestureend") gestureScale = undefined;
  if (!props.active || props.settingsVisible || document.fullscreenElement || flow.userSelectionActive.value) return;
  if (!(event.target instanceof Element) || !event.target.closest(".vue-flow__pane, .vue-flow__node, .vue-flow__edge, .vue-flow__nodesselection")) return;
  if (event.target.closest(".nowheel, input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='dialog']")) return;
  let factor: number;
  let point = pointerPosition;
  if ("scale" in event) {
    if (!Number.isFinite(event.scale) || event.scale <= 0) return;
    factor = event.type === "gesturechange" && gestureScale !== undefined ? event.scale / gestureScale : 1;
    gestureScale = event.type === "gestureend" ? undefined : event.scale;
  } else {
    // ACT: Chromium 捏合发送 Ctrl+wheel，但不发送 Control 按键；WebKit 使用上方原生 gesture 事件。
    const pinching = event.ctrlKey && !pressedCodes.has("ControlLeft") && !pressedCodes.has("ControlRight");
    if (pinching && gestureScale !== undefined) {
      factor = 1;
    } else if (pinching) {
      factor = 2 ** (-event.deltaY * 0.02);
    } else {
      // ACT: @vue-flow/core 的 wheelDelta 在 macOS 下检测到 event.ctrlKey 会额外乘以 10（误判为捏合微步）；非捏合的实体 Ctrl 滚轮缩放需剔除该倍数，保留标准滚轮速度。
      factor = 2 ** (wheelDelta(event) / (event.ctrlKey && isMacOs() ? 10 : 1));
    }
    point = { x: event.clientX, y: event.clientY };
  }
  const zoom = flow.d3Zoom.value;
  const selection = flow.d3Selection.value;
  if (!zoom || !selection) return;
  event.preventDefault();
  event.stopPropagation();
  if (factor === 1) return;
  // 高频滚轮/触控板事件合并到一帧，避免同帧反复读取布局、更新全部连线。
  pendingZoom = { factor: (pendingZoom?.factor ?? 1) * factor, point, event };
  if (zoomFrame !== undefined) return;
  zoomFrame = requestAnimationFrame(() => {
    zoomFrame = undefined;
    const pending = pendingZoom;
    pendingZoom = undefined;
    const bounds = selection.node()?.getBoundingClientRect();
    if (!pending || !bounds) return;
    const anchor = pending.point ?? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    selection.call<[number, [number, number], Event]>(zoom.scaleBy, pending.factor, [anchor.x - bounds.left, anchor.y - bounds.top], pending.event);
  });
}

function preventMiddleClick(event: MouseEvent) {
  // Linux 下中键会直接粘贴 X 主选择区内容，需在画布范围内拦掉，避免误插入文本节点。
  if (event.button === 1) event.preventDefault();
}

function updateCanvasKeys(event: KeyboardEvent) {
  if (event.type === "keydown") {
    pressedCodes.add(event.code);
  } else pressedCodes.delete(event.code);
  if (!props.active || props.settingsVisible) return resetCanvasKeys();
  const target = event.target;
  const shortcuts = generalSettings.value.canvasShortcuts;
  const inCanvas =
    target instanceof Element &&
    !target.closest("[role='dialog'], #agentPanel") &&
    (target === document.body || target === document.documentElement || canvasElement.value?.contains(target));
  zoomKeyPressed.value = !event.isComposing && shortcutPressed(event, shortcuts.zoom, pressedCodes);
  const editing =
    !(target instanceof Element) ||
    !!target.closest(canvasControlSelector);
  panKeyPressed.value = !!inCanvas && !editing && !event.isComposing && shortcutPressed(event, shortcuts.pan, pressedCodes);
  if (event.type === "keyup" || event.defaultPrevented || event.isComposing || !inCanvas || editing) return;
  const action = ([
    "group", "mergeGroup", "ungroup", "addNode", "moveTool", "handTool", "arrange", "search",
    "delete", "copy", "paste", "undo", "redo", "zoomIn", "zoomOut", "fitView",
  ] as const).find((action) =>
    shortcutMatches(event, shortcuts[action])
  );
  if (!action) {
    const nativeClipboardKey = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
      && (event.code === "KeyV" || event.code === "KeyC" && flow.getSelectedNodes.value.length && !window.getSelection()?.toString());
    if (panKeyPressed.value || nativeClipboardKey) event.preventDefault();
    return;
  }
  if (!canvasId.value || !project.value?.directory) return;
  if (action === "copy" && (!flow.getSelectedNodes.value.length || window.getSelection()?.toString())) return;
  // 桌面快捷键直接复用原生剪贴板桥接；浏览器 Ctrl/Cmd+V 保留原生事件，避免额外读取权限。
  if (!isDesktop && action === "paste" && event.code === "KeyV" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) return;
  event.preventDefault();
  if (event.repeat) return;
  if (action === "delete") {
    const nodes = [...flow.getSelectedNodes.value];
    const menu = nodeMenuRef.value;
    if (!menu || !nodes.some((node) => node.deletable !== false)) return;
    void canvasHistory
      .batch(() => menu.deleteSelection(nodes))
      .catch((error) => {
        ElMessage.error(error instanceof Error ? error.message : "节点删除失败");
      });
    return;
  }
  if (action === "copy") void copySelectedNodes();
  else if (action === "paste") void pasteNodeAtCenter();
  else if (action === "undo" || action === "redo") void changeHistory(action);
  else if (action === "group" || action === "mergeGroup" || action === "ungroup") {
    void selectionToolbarRef.value?.operate(action);
  } else if (action === "addNode") addNodeAtPointer();
  else if (action === "moveTool" || action === "handTool") selectedTool.value = action === "handTool" ? "hand" : "move";
  else if (action === "arrange") void canvasControlsRef.value?.arrangeNodes();
  else if (action === "search") nodeSearchRef.value?.open();
  else void flow[action]();
}

function resetCanvasKeys() {
  if (zoomFrame !== undefined) cancelAnimationFrame(zoomFrame);
  zoomFrame = undefined;
  pendingZoom = undefined;
  pressedCodes.clear();
  gestureScale = undefined;
  zoomKeyPressed.value = false;
  panKeyPressed.value = false;
}

watch([() => props.settingsVisible, () => generalSettings.value.canvasShortcuts], resetCanvasKeys, { deep: true, flush: "sync" });

function refreshInstalled(event: WindowEventMap["toonflow:plugin-installed"]) {
  if (event.detail.type === "node") void loadRemoteNodes(event.detail.name);
}

const refreshNodeConfig = () => { void loadRemoteNodes(); };

onMounted(() => {
  // 在捕获阶段同步修饰键，避免节点编辑器截断 keydown/keyup 后缩放状态丢失或卡住。
  window.addEventListener("keydown", updateCanvasKeys, true);
  window.addEventListener("keyup", updateCanvasKeys, true);
  window.addEventListener("blur", resetCanvasKeys);
  window.addEventListener("toonflow:plugin-installed", refreshInstalled);
  window.addEventListener("toonflow:node-config-updated", refreshNodeConfig);
  document.addEventListener("paste", pasteNode);
  document.addEventListener("copy", copyNode);
  document.addEventListener("beforecopy", beforeClipboard);
  document.addEventListener("beforepaste", beforeClipboard);
  void loadRemoteNodes();
});
onBeforeUnmount(() => {
  resetCanvasKeys();
  window.removeEventListener("keydown", updateCanvasKeys, true);
  window.removeEventListener("keyup", updateCanvasKeys, true);
  window.removeEventListener("blur", resetCanvasKeys);
  window.removeEventListener("toonflow:plugin-installed", refreshInstalled);
  window.removeEventListener("toonflow:node-config-updated", refreshNodeConfig);
  document.removeEventListener("paste", pasteNode);
  document.removeEventListener("copy", copyNode);
  document.removeEventListener("beforecopy", beforeClipboard);
  document.removeEventListener("beforepaste", beforeClipboard);
  workspaceController.abort(new Error("工作区已关闭"));
  canvasController.abort(new Error("画布已关闭"));
  saveCanvas.flush();
  loadRequest++;
});

const nodeWindow = window as typeof window & {
  toonflowNodeHost?: { vue: typeof vueRuntime; vueFlow: typeof vueFlowRuntime; elementPlus: typeof elementPlusRuntime; ai: { runAgentLoop: typeof import("@earendil-works/pi-agent-core")["runAgentLoop"]; createAssistantMessageEventStream: typeof createAssistantMessageEventStream } };
  toonflowNodes?: NodeTypesObject;
};
nodeWindow.toonflowNodeHost ??= {
  vue: vueRuntime, vueFlow: vueFlowRuntime, elementPlus: elementPlusRuntime,
  ai: {
    // 节点插件共享宿主接口，只有真正运行 AI 时才加载代理运行库。
    runAgentLoop: (...args) => import("@earendil-works/pi-agent-core").then(({ runAgentLoop }) => runAgentLoop(...args)),
    createAssistantMessageEventStream,
  },
};
provide("nodeConfig", (nodeType: string) => nodeConfigs.value[nodeType] ?? {});
provide("workspaceFiles", () => {
  const directory = project.value?.directory;
  if (!directory) throw new Error("请先选择工作目录");
  return useWorkspaceFiles(directory);
});
provide("workspaceDirectory", () => {
  const directory = project.value?.directory;
  if (!directory) throw new Error("请先选择工作目录");
  return directory;
});
provide("reloadRemoteNode", (type: string) => {
  const name = type.replace(/^remote-/, "");
  if (!type.startsWith("remote-") || !/^[a-z][a-zA-Z0-9]*$/.test(name)) throw new Error("节点类型无效");
  return loadNode(name, `/api/nodes/files?name=${name}`, true);
});

async function loadNode(name: string, url: string, force = false): Promise<void> {
  const nodeType = `remote-${name}`;
  const signal = canvasController.signal;
  const pending = nodeLoads.get(nodeType);
  if (pending) {
    if (!force) return pending;
    await pending.catch(() => {});
  }
  if (!force && nodeTypes.value[nodeType] && !nodeErrors.value[nodeType]) return;
  if (force) {
    signal.throwIfAborted();
    // ACT: 复用画布修订号收敛等待期间的编辑；持续修改画布时延后刷新，不额外维护节点修订状态。
    let revision: number;
    do {
      revision = saveRevision;
      await Promise.all(flow.getNodes.value.filter(node => node.type === nodeType).map(node => useNodeEvent(node.id, flow).emit("save", "reload")));
      await nextTick();
      signal.throwIfAborted();
    } while (revision !== saveRevision);
    const loading = nodeLoads.get(nodeType);
    if (loading) return loading;
  }
  delete nodeErrors.value[nodeType];
  const componentLoad = nodeFramePilot && ["textNode", "imageNode", "imageGenerationNode", "videoNode", "videoGenerationNode", "audioNode", "audioGenerationNode"].includes(name)
    ? fetch(force ? `${url}&reload=${crypto.randomUUID()}` : url, { signal }).then(async response => {
      if (!response.ok) throw new Error("节点脚本加载失败");
      const code = await response.text();
      if (code.length > 5_000_000) throw new Error("节点脚本过大");
      nodeFrameCodes.set(nodeType, code);
      return markRaw({ render: () => null });
    })
    : loadNodeComponent(name, url, force);
  const nodeLoad = componentLoad
    .then((remoteNode) => {
      // 同类型节点共享组件，运行错误由每个节点自己的边界显示。
      nodeTypes.value = { ...nodeTypes.value, [nodeType]: markRaw(remoteNode) };
    })
    .catch((error) => {
      if (!signal.aborted) nodeErrors.value[nodeType] = error instanceof Error ? error.message : String(error);
      throw error;
    })
    .finally(() => nodeLoads.delete(nodeType));
  nodeLoads.set(nodeType, nodeLoad);
  return nodeLoad;
}

async function loadNodeTypes(types: string[]) {
  await Promise.all([...new Set(types)].map(async type => {
    const option = nodeOptions.value.find(node => node.type === type);
    if (!option) return;
    if (nodeErrors.value[type]) throw new Error(nodeErrors.value[type]);
    const name = type.slice("remote-".length);
    await loadNode(name, `/api/nodes/files?name=${name}`);
  }));
}

async function loadRemoteNodes(reloadName?: string) {
  if (reloadName) nodeReloads.add(reloadName);
  const requestId = ++loadRequest;
  const signal = canvasController.signal;
  nodeListLoading.value = true;
  try {
    const { data } = await axios.get<{ code: number; data: { name: string; displayName: string; url: string; enabled?: boolean; config?: Record<string, unknown> }[] }>(
      "/api/nodes/get",
      { headers: { "Cache-Control": "no-cache", "x-toonflow-workspace": "1" } }
    );
    if (requestId !== loadRequest) return;
    if (data.code !== 200 || !Array.isArray(data.data)) throw new Error("节点列表格式错误");
    const nodes = data.data.filter(node => {
      if (!node || typeof node.name !== "string" || !/^[a-z][a-zA-Z0-9]*$/.test(node.name) || node.url !== `/api/nodes/files?name=${node.name}`) {
        console.error("节点地址无效", node);
        return false;
      }
      return true;
    });
    nodeConfigs.value = Object.fromEntries(nodes.map(node => [`remote-${node.name}`, node.config ?? {}]));
    const enabledNodes = nodes.filter(node => node.enabled !== false);
    // 菜单先展示已启用的类型，组件脚本在实际使用时加载。
    nodeOptions.value = enabledNodes.map(node => ({ type: `remote-${node.name}`, label: node.displayName }));
    // ACT: 安装事件合并到最新列表请求，避免连续更新不同节点时丢失较早的刷新名称。
    const reloadNames = new Set(nodeReloads);
    nodeReloads.clear();
    await Promise.all(
      enabledNodes.map(async (node) => {
        const nodeType = `remote-${node.name}`;
        try {
          if (!remoteNodeTypes.value.includes(nodeType) && !reloadNames.has(node.name)) return;
          if (nodeTypes.value[nodeType] && !nodeErrors.value[nodeType] && !reloadNames.has(node.name)) return;
          await loadNode(node.name, node.url, reloadNames.has(node.name));
        } catch (error) {
          console.error("加载远端节点失败", node, error);
          // 保存拒绝时旧组件仍可用，不从节点菜单中移除；脚本加载错误仍排除。
          if (nodeTypes.value[nodeType] && !nodeErrors.value[nodeType]) {
            if (reloadNames.has(node.name) && !signal.aborted) ElMessage.warning({
              message: `${node.displayName}已安装，但当前节点无法刷新。请等待任务结束后，点击节点右上角的刷新按钮。`,
              grouping: true,
            });
          }
        }
      })
    );
  } catch (error) {
    if (requestId === loadRequest) console.error("获取远端节点列表失败", error);
  } finally {
    if (requestId === loadRequest) nodeListLoading.value = false;
  }
}

const defaultEdgeOptions = markRaw({
  type: "simple-bezier",
  animated: false,
  focusable: false,
  selectable: false,
  updatable: false,
  interactionWidth: 16,
});
</script>

<style lang="scss" scoped>
.canvas {
  --canvasGridColor: color-mix(in srgb, var(--el-border-color) 35%, transparent);
  width: 100%;
  height: 100%;
  display: flex;
  position: relative;
  container-type: inline-size;

  .canvasFlow { min-width: 0; flex: 1; height: 100%; container-type: inline-size; }

  &.compositingEnabled :deep(.vue-flow__transformationpane) {
    will-change: transform;
  }

  &.handMode :deep(.vue-flow__transformationpane),
  &.handMode :deep(.vue-flow__transformationpane *) {
    pointer-events: none !important;
  }

  &.handMode :deep(.vue-flow__pane) {
    cursor: grab;
  }

  &.edgesHidden :deep(.vue-flow__edges) {
    display: none;
  }
  &.edgesHidden :deep(.vue-flow__handle) {
    display: none !important;
  }

  &:has(.selectionConnection) :deep(.vue-flow__node:not(.selected) .nodeHandle.target .handleIcon) {
    opacity: 1;
  }

  :deep(.vue-flow__nodesselection-rect) {
    box-sizing: content-box;
    padding: 8px;
    margin: -8px;
    border-radius: var(--ui-radius-small, 4px);
  }
}
.edgeDisconnect {
  position: fixed;
  z-index: 1000;
  width: 32px;
  height: 32px;
  padding: 0;
  transform: translate(-50%, -50%);
}
</style>
