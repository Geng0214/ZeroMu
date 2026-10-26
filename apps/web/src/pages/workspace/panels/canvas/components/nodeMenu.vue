<template>
  <selectionHandle
    v-if="!singleGroupSelected"
    ref="selectionHandleRef"
    @start="startSelectionConnection"
    @release="(event, nodes) => openMenu(event, true, [], undefined, nodes)" />
  <selectionHandle
    v-for="group in groups"
    :key="group.id"
    ref="groupHandleRefs"
    :nodes="[group]"
    @start="startSelectionConnection"
    @release="(event, nodes) => openMenu(event, true, [], undefined, nodes)" />
  <el-dropdown
    ref="menu"
    trigger="contextmenu"
    virtualTriggering
    :virtualRef="menuAnchor"
    placement="bottom-start"
    :showArrow="false"
    :showTimeout="0"
    :hideTimeout="0"
    :hideOnClick="false"
    @command="handleCommand"
    @visibleChange="(visible: boolean) => !visible && clearConnection()">
    <template #dropdown>
      <el-dropdown-menu
        ref="menuList"
        class="nodeMenu"
        :aria-label="menuLevel === 'selection' ? '选区操作' : menuLevel === 'arrange' ? '整理选中节点' : menuLevel === 'actions' ? '操作菜单' : '添加节点和资源'">
        <template v-if="menuLevel === 'selection'">
          <el-dropdown-item v-if="associatedShot" command="productionShot">查看关联分镜 · {{ associatedShot.title }}</el-dropdown-item>
          <el-dropdown-item command="duplicateSelection" :icon="IconCopyPlus" :disabled="selectionBusy || deleting || !selectedNodes.length">
            创建副本
          </el-dropdown-item>
          <el-dropdown-item command="arrange" :icon="IconLayoutGrid" :disabled="!canArrangeSelection">
            <span>整理选中节点</span>
            <icon-chevron-right class="nextIcon" :size="14" />
          </el-dropdown-item>
          <el-dropdown-item
            command="deleteSelection"
            :icon="IconTrash"
            :disabled="selectionBusy || deleting || !selectedNodes.some((node) => node.deletable !== false)">
            {{ deleting ? "删除中…" : `删除选中节点（${selectedNodes.length}）` }}
          </el-dropdown-item>
        </template>
        <template v-else-if="menuLevel === 'arrange'">
          <el-dropdown-item command="selection" :icon="IconChevronLeft">返回选区操作</el-dropdown-item>
          <el-divider />
          <el-dropdown-item command="horizontal" :icon="IconLayoutColumns" :disabled="!canArrangeSelection">水平排列</el-dropdown-item>
          <el-dropdown-item command="vertical" :icon="IconLayoutRows" :disabled="!canArrangeSelection">垂直排列</el-dropdown-item>
          <el-dropdown-item command="grid" :icon="IconLayoutGrid" :disabled="!canArrangeSelection">宫格排列</el-dropdown-item>
        </template>
        <template v-else-if="menuLevel === 'actions'">
          <el-dropdown-item command="upload" :icon="IconUpload" :disabled="!uploadFiles">上传</el-dropdown-item>
          <el-dropdown-item command="nodes" :icon="IconPlus">
            <span>添加节点</span>
            <icon-chevron-right class="nextIcon" :size="14" />
          </el-dropdown-item>
          <el-divider />
          <el-dropdown-item command="undo" :icon="IconArrowBackUp" :disabled="!canUndo">撤销</el-dropdown-item>
          <el-dropdown-item command="redo" :icon="IconArrowForwardUp" :disabled="!canRedo">重做</el-dropdown-item>
          <el-divider />
          <el-dropdown-item command="paste" :icon="IconClipboard" :disabled="!pasteNode || pasting">
            {{ pasting ? "粘贴中…" : "从剪贴板粘贴" }}
          </el-dropdown-item>
        </template>
        <template v-else>
          <el-dropdown-item v-if="!directNodes" command="actions" :icon="IconChevronLeft">返回操作菜单</el-dropdown-item>
          <el-dropdown-item v-else-if="!showChooserSections" disabled>添加节点</el-dropdown-item>
          <el-dropdown-item v-if="showChooserSections" disabled class="sectionTitle">添加节点</el-dropdown-item>
          <el-dropdown-item v-if="preparingNodes" disabled>正在读取可连接节点…</el-dropdown-item>
          <el-dropdown-item v-for="node in filteredNodes" :key="node.type" :command="node.type">
            <component :is="node.icon" class="nodeTypeIcon" :size="20" />
            {{ node.label }}
          </el-dropdown-item>
          <el-dropdown-item v-if="!preparingNodes && (pendingHandle || pendingGroup.length) && !filteredNodes.length" disabled>没有可连接的节点</el-dropdown-item>
          <el-dropdown-item v-if="showChooserSections" command="smartEdit" :icon="IconScissors">智能剪辑</el-dropdown-item>
          <template v-if="showChooserSections">
            <el-divider />
            <el-dropdown-item disabled class="sectionTitle">添加资源</el-dropdown-item>
            <el-dropdown-item command="upload" :icon="IconUpload" :disabled="!uploadFiles">上传</el-dropdown-item>
            <el-dropdown-item command="generationHistory" :icon="IconHistory" :disabled="historyLoading">从生成历史选择</el-dropdown-item>
          </template>
        </template>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
  <el-dialog v-model="historyVisible" class="historyDialog" title="从生成历史选择" width="min(760px, calc(100vw - 32px))" alignCenter appendToBody destroyOnClose>
    <p v-if="historyLoading" role="status">正在读取当前画布的生成历史…</p>
    <el-alert v-else-if="historyError" :title="historyError" type="error" :closable="false" />
    <el-empty v-else-if="!historyItems.length" description="当前画布还没有可复用的图片、视频或音频生成结果" />
    <div v-else class="historyPicker">
      <div class="historyList" role="listbox" aria-label="生成历史文件">
        <button v-for="item in historyItems" :key="item.path" type="button" class="historyItem" :class="{ selected: selectedHistory?.path === item.path }" :aria-pressed="selectedHistory?.path === item.path" @click="selectedHistory = item">
          <component :is="historyIcons[item.kind]" :size="18" />
          <span><strong>{{ item.name }}</strong><small>{{ item.nodeLabel }} · {{ item.kind === 'image' ? '图片' : item.kind === 'video' ? '视频' : '音频' }}</small></span>
        </button>
      </div>
      <div class="historyPreview" aria-label="生成结果预览">
        <el-alert v-if="historyPreviewError" :title="historyPreviewError" type="error" :closable="false" />
        <img v-else-if="historyPreviewUrl && selectedHistory?.kind === 'image'" :src="historyPreviewUrl" :alt="selectedHistory.name" />
        <video v-else-if="historyPreviewUrl && selectedHistory?.kind === 'video'" :src="historyPreviewUrl" controls playsinline preload="metadata" />
        <audio v-else-if="historyPreviewUrl" :src="historyPreviewUrl" controls preload="metadata" />
        <span v-else>选择一项预览</span>
      </div>
    </div>
    <template #footer>
      <el-button @click="historyVisible = false">取消</el-button>
      <el-button type="primary" :loading="historyAdding" :disabled="!selectedHistory || historyLoading" @click="addHistoryAsset">添加到画布</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { getNodeIcon } from "@toonflow/nodes-scaffold/nodeIcons";
import { newGenerationData } from "@/lib/creationPreferences";
import { computed, inject, nextTick, onBeforeUnmount, ref, shallowRef, watch, type Component } from "vue";
import { useProductionStore } from "@/stores/production";
import type { CanvasContext } from "@toonflow/tool-canvas/runtime";
import { useVueFlow, type ConnectingHandle, type GraphNode, type HandleType } from "@vue-flow/core";
import { isTypeCompatible, validateConnection, type NodeHandle } from "@toonflow/nodes-scaffold/connection";
import { useNodeEvent } from "@toonflow/nodes-scaffold/nodeEvent";
import { ElAlert, ElButton, ElDialog, ElEmpty, ElMessage } from "element-plus";
import type { DropdownInstance } from "element-plus";
import { IconHistory, IconMusic, IconPhoto, IconScissors, IconVideo } from "@tabler/icons-vue";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { importCanvasFiles } from "../canvasDrop";
import selectionHandle from "./selectionHandle.vue";
import { getSelectionConnections } from "../selectionConnections";
import { getSelectionRoots, getSelectionTree } from "../selectionNodes";
import { arrangeSelection } from "../arrangeSelection";
import {
  IconClipboard,
  IconCopyPlus,
  IconTrash,
  IconBox,
  IconUpload,
  IconPlus,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconChevronLeft,
  IconChevronRight,
  IconLayoutColumns,
  IconLayoutRows,
  IconLayoutGrid,
} from "@tabler/icons-vue";

const { remoteNodes = [], directory, loadNodes, pasteNode, uploadFiles, canUndo = false, canRedo = false, selectionBusy = false, batchHistory } = defineProps<{
  remoteNodes?: { type: string; label: string }[];
  directory?: string;
  loadNodes: (types: string[]) => Promise<void>;
  pasteNode?: (position: { x: number; y: number }) => Promise<boolean>;
  uploadFiles?: (position: { x: number; y: number }) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  selectionBusy?: boolean;
  batchHistory?: (action: () => Promise<void>) => Promise<void>;
}>();
const emit = defineEmits<{ history: []; undo: []; redo: []; duplicateSelection: [] }>();
const menu = ref<DropdownInstance>();
const menuList = ref<{ $el: HTMLElement }>();
const menuLevel = ref<"actions" | "nodes" | "selection" | "arrange">("actions");
const selectedNodes = shallowRef<GraphNode[]>([]);
const production = useProductionStore();
const getCanvas = inject<() => CanvasContext | undefined>("canvas");
function boundShot(nodeId: string) { return production.project?.shots.find(shot => !shot.archived && shot.canvasId === getCanvas?.()?.id && shot.nodeId === nodeId); }
const associatedShot = computed(() => selectedNodes.value.length === 1 ? boundShot(selectedNodes.value[0]!.id) : undefined);
const deleting = ref(false);
const pasting = ref(false);
const directNodes = ref(false);
const menuAnchor = shallowRef({ getBoundingClientRect: () => new DOMRect() });
const flow = useVueFlow();
const { addNodes, screenToFlowCoordinate, onPaneContextMenu, onSelectionContextMenu, onPaneClick, onMoveStart } = flow;
let nodePosition = { x: 0, y: 0 };
type DraggedHandle = { node: GraphNode; id: string; type: HandleType; start: ConnectingHandle };
const pendingHandle = shallowRef<DraggedHandle>();
const pendingGroup = shallowRef<GraphNode[]>([]);
const preparingNodes = ref(false);
let menuRequest = 0;
const selectionHandleRef = ref<InstanceType<typeof selectionHandle>>();
const groupHandleRefs = ref<InstanceType<typeof selectionHandle>[]>([]);
const groups = computed(() => flow.getNodes.value.filter(node => node.type === "canvasGroup" && !node.hidden));
const singleGroupSelected = computed(() => flow.getSelectedNodes.value.length === 1 && flow.getSelectedNodes.value[0]?.type === "canvasGroup");
const showChooserSections = computed(() => !!directory && !pendingHandle.value && !pendingGroup.value.length && !selectedNodes.value.length);
const historyVisible = ref(false);
const historyLoading = ref(false);
const historyAdding = ref(false);
const historyError = ref("");
const historyPreviewError = ref("");
const historyPreviewUrl = ref("");
const historyItems = ref<HistoryItem[]>([]);
const selectedHistory = ref<HistoryItem>();
const historyIcons = { image: IconPhoto, video: IconVideo, audio: IconMusic };
type HistoryKind = keyof typeof historyIcons;
type HistoryItem = { path: string; name: string; mimeType: string; kind: HistoryKind; nodeId: string; nodeLabel: string };
const historyMimeTypes: Record<string, string> = {
  avif: "image/avif", apng: "image/apng", bmp: "image/bmp", gif: "image/gif", ico: "image/x-icon", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", svg: "image/svg+xml", tif: "image/tiff", tiff: "image/tiff", webp: "image/webp",
  avi: "video/x-msvideo", m4v: "video/mp4", mkv: "video/x-matroska", mov: "video/quicktime", mp4: "video/mp4", ogv: "video/ogg", webm: "video/webm",
  aac: "audio/aac", flac: "audio/flac", m4a: "audio/mp4", mp3: "audio/mpeg", ogg: "audio/ogg", opus: "audio/opus", wav: "audio/wav",
};
let historyRequest = 0;
let historyController: AbortController | undefined;
let historyImportController: AbortController | undefined;
let releaseHistoryPreview: (() => void) | undefined;
const canArrangeSelection = computed(() => {
  const nodes = getSelectionRoots(selectedNodes.value, flow.getNodes.value);
  return !selectionBusy && !deleting.value && nodes.length > 1
    && nodes.every(node => flow.findNode(node.id) === node && node.draggable !== false
      && Number.isFinite(node.dimensions.width) && node.dimensions.width > 0
      && Number.isFinite(node.dimensions.height) && node.dimensions.height > 0);
});
const filteredNodes = computed(() => {
  const nodes = remoteNodes.map(node => ({
    ...node,
    icon: getNodeIcon(node.type) ?? (flow.nodeTypes?.value?.[node.type] as { icon?: Component } | undefined)?.icon ?? IconBox,
  }));
  if (pendingGroup.value.length) {
    if (!flow.nodesConnectable.value || pendingGroup.value.some(node => flow.findNode(node.id) !== node || node.connectable === false)) return [];
    return nodes.filter(node => {
      const targets = (flow.nodeTypes?.value?.[node.type] as { handles?: NodeHandle[] } | undefined)?.handles?.filter(handle => handle.type === "target") ?? [];
      return pendingGroup.value.every(source => (source.data.handles as NodeHandle[] | undefined)?.some(output =>
        output.type === "source" && targets.some(input => isTypeCompatible(output.dataType, input.dataType))));
    });
  }
  const handle = pendingHandle.value;
  if (!handle) return nodes;
  if (flow.findNode(handle.node.id) !== handle.node || !flow.nodesConnectable.value || handle.node.connectable === false) return [];
  const port = (handle.node.data.handles as NodeHandle[] | undefined)?.find((item) => item.id === handle.id && item.type === handle.type);
  if (!port) return [];
  return nodes.filter((node) => {
    const handles = (flow.nodeTypes?.value?.[node.type] as { handles?: NodeHandle[] } | undefined)?.handles;
    return handles?.some((item) => item.type !== port.type && isTypeCompatible(port.dataType, item.dataType));
  });
});
watch(historyVisible, visible => {
  if (visible) void loadGenerationHistory();
  else { historyController?.abort(); historyImportController?.abort(); historyRequest++; historyLoading.value = false; }
});
watch([historyVisible, selectedHistory, () => directory], async ([visible, item, path], _, onCleanup) => {
  releaseHistoryPreview?.();
  releaseHistoryPreview = undefined;
  historyPreviewUrl.value = "";
  historyPreviewError.value = "";
  if (!visible || !item || !path) return;
  const preview = useWorkspaceFiles(path).acquireUrl(item.path, item.mimeType);
  releaseHistoryPreview = preview.release;
  let current = true;
  onCleanup(() => { current = false; preview.release(); if (releaseHistoryPreview === preview.release) releaseHistoryPreview = undefined; });
  try { const url = await preview.url; if (current) historyPreviewUrl.value = url; }
  catch (error) { if (current) historyPreviewError.value = error instanceof Error ? error.message : "生成结果预览失败"; }
}, { flush: "sync" });

async function loadGenerationHistory() {
  const path = directory;
  if (!path) return;
  historyController?.abort();
  const controller = historyController = new AbortController();
  const request = ++historyRequest;
  historyLoading.value = true;
  historyError.value = "";
  historyItems.value = [];
  selectedHistory.value = undefined;
  const files = useWorkspaceFiles(path);
  const sources = flow.getNodes.value.filter(node => ["remote-imageNode", "remote-videoNode", "remote-audioNode"].includes(node.type) && node.id && node.id !== "." && node.id !== ".." && !/[\\/]/.test(node.id));
  const items: HistoryItem[] = [];
  try {
    for (const node of sources) {
      const kind = node.type === "remote-imageNode" ? "image" : node.type === "remote-videoNode" ? "video" : "audio";
      let entries: Awaited<ReturnType<typeof files.list>>["entries"];
      try { entries = (await files.list(`assets/${node.id}`, controller.signal)).entries; }
      catch (error) {
        if (controller.signal.aborted) return;
        if ((error as { response?: { status?: number } })?.response?.status === 404) continue;
        throw error;
      }
      for (const entry of entries) {
        const mimeType = historyMimeTypes[entry.name.split(".").at(-1)?.toLowerCase() ?? ""];
        if (entry.type !== "file" || !mimeType?.startsWith(`${kind}/`)) continue;
        items.push({ path: entry.path, name: entry.name, mimeType, kind, nodeId: node.id, nodeLabel: String(node.data.label || node.id) });
      }
    }
    if (controller.signal.aborted || request !== historyRequest || path !== directory) return;
    historyItems.value = items.sort((left, right) => right.path.localeCompare(left.path, "zh-CN", { numeric: true }));
    selectedHistory.value = historyItems.value[0];
  } catch (error) {
    if (!controller.signal.aborted && request === historyRequest) historyError.value = error instanceof Error ? error.message : "读取生成历史失败";
  } finally { if (!controller.signal.aborted && request === historyRequest) historyLoading.value = false; }
}

async function addHistoryAsset() {
  const item = selectedHistory.value;
  const path = directory;
  if (!item || !path || historyAdding.value) return;
  if (!flow.findNode(item.nodeId)) { historyError.value = "生成来源节点已删除，请重新读取历史"; return; }
  const controller = historyImportController = new AbortController();
  historyAdding.value = true;
  historyError.value = "";
  try {
    const content = await useWorkspaceFiles(path).read(item.path, controller.signal);
    if (controller.signal.aborted || path !== directory || !flow.findNode(item.nodeId)) throw new Error("画布或生成来源已变化，请重新选择历史文件");
    const file = new File([content], item.name, { type: item.mimeType });
    const action = () => importCanvasFiles([file], { ...nodePosition }, { directory: path, availableNodes: remoteNodes, signal: controller.signal, flow });
    if (batchHistory) await batchHistory(action); else await action();
    if (!controller.signal.aborted && path === directory) historyVisible.value = false;
  } catch (error) {
    if (!controller.signal.aborted) { historyError.value = error instanceof Error ? error.message : "添加生成结果失败"; ElMessage.error(historyError.value); }
  } finally { if (historyImportController === controller) { historyImportController = undefined; historyAdding.value = false; } }
}

function clearSelectionHandles() {
  selectionHandleRef.value?.clear();
  groupHandleRefs.value.forEach(handle => handle.clear());
}

function clearConnection() {
  menuRequest++;
  preparingNodes.value = false;
  if (pendingHandle.value) {
    pendingHandle.value = undefined;
    flow.endConnection();
  }
  if (pendingGroup.value.length) {
    pendingGroup.value = [];
    clearSelectionHandles();
  }
}

function startSelectionConnection() {
  clearConnection();
  clearSelectionHandles();
  menu.value?.handleClose();
}

onBeforeUnmount(clearConnection);
onBeforeUnmount(() => { historyRequest++; historyController?.abort(); historyImportController?.abort(); releaseHistoryPreview?.(); });
flow.onConnectStart(() => {
  pendingHandle.value = undefined;
  clearConnection();
  menu.value?.handleClose();
});

flow.onConnectEnd((event) => {
  const handle = flow.connectionStartHandle.value;
  if (!handle || flow.connectionStatus.value === "valid" || !event || event.type === "touchcancel") return;
  const node = flow.findNode(handle.nodeId);
  if (!node || handle.id == null) return;
  const point = "changedTouches" in event ? event.changedTouches[0] : event;
  if (!point) return;
  const target = document.elementFromPoint(point.clientX, point.clientY);
  if (!target?.classList.contains("vue-flow__pane") || !flow.vueFlowRef.value?.contains(target)) return;
  void openMenu(event, true, [], { node, id: handle.id, type: handle.type, start: { ...handle } });
});

async function openMenu(event: MouseEvent | TouchEvent, nodesOnly = false, selection: GraphNode[] = [], handle?: DraggedHandle, group: GraphNode[] = []) {
  event.preventDefault();
  event.stopPropagation();
  emit("history");
  menu.value?.handleClose();
  clearConnection();
  await nextTick();
  if (!menu.value || (handle && flow.findNode(handle.node.id) !== handle.node)) return;
  pendingHandle.value = handle;
  pendingGroup.value = group;
  directNodes.value = nodesOnly;
  selectedNodes.value = [...selection];
  menuLevel.value = selection.length ? "selection" : nodesOnly ? "nodes" : "actions";
  const point = "changedTouches" in event ? event.changedTouches[0] : event;
  if (!point) return;
  const { clientX, clientY } = point;
  nodePosition = screenToFlowCoordinate({ x: clientX, y: clientY });
  menuAnchor.value = { getBoundingClientRect: () => new DOMRect(clientX, clientY, 0, 0) };
  if (handle) {
    const bounds = flow.vueFlowRef.value!.getBoundingClientRect();
    // ACT: VueFlow 在释放后清空拖线；菜单期间复用其预览，避免创建临时节点或边。
    flow.startConnection(handle.start, { x: clientX - bounds.left, y: clientY - bounds.top });
  }
  await nextTick();
  menu.value?.handleOpen();
  if (handle || group.length) {
    const request = ++menuRequest;
    preparingNodes.value = true;
    // 拖线添加节点需要插件声明的端口；按需读取后再筛选兼容类型。
    await Promise.allSettled(remoteNodes.map(node => loadNodes([node.type])));
    if (request === menuRequest) preparingNodes.value = false;
  }
}

onPaneContextMenu(openMenu);
onSelectionContextMenu(({ event, nodes }) => openMenu(event, false, nodes));
onPaneClick(() => menu.value?.handleClose());
onMoveStart(() => menu.value?.handleClose());
flow.onNodeContextMenu(({ event, node }) => {
  if (boundShot(node.id)) { void openMenu(event, false, [node]); return; }
  clearConnection();
  menu.value?.handleClose();
});
defineExpose({ openMenu, deleteSelection });

async function handleCommand(command: unknown) {
  if (command === "productionShot" && associatedShot.value) { menu.value?.handleClose(); production.openShot(associatedShot.value.shotId); return; }
  if (command === "smartEdit") {
    menu.value?.handleClose();
    const createNode = async () => {
      const id = crypto.randomUUID();
      const order = flow.getNodes.value.filter(node => node.type === "smartEdit").length + 1;
      flow.removeSelectedElements();
      flow.nodesSelectionActive.value = false;
      addNodes({
        id,
        type: "smartEdit",
        position: { ...nodePosition },
        data: {
          label: `智能剪辑 ${order}`,
          handles: [{ id: "video", type: "target", dataType: "VIDEO", label: "视频输入" } satisfies NodeHandle],
          outputs: {},
        },
      });
      await nextTick();
      const created = flow.findNode(id);
      if (created) flow.addSelectedNodes([created]);
    };
    try { if (batchHistory) await batchHistory(createNode); else await createNode(); }
    catch (error) { ElMessage.error(error instanceof Error ? error.message : "添加智能剪辑节点失败"); }
    return;
  }
  if (command === "generationHistory") { menu.value?.handleClose(); historyVisible.value = true; return; }
  if (command === "nodes" || command === "actions" || command === "selection" || command === "arrange") {
    if (command === "arrange" && !canArrangeSelection.value) return;
    menuLevel.value = command;
    await nextTick();
    menuList.value?.$el.focus();
    return;
  }
  if (command === "duplicateSelection") {
    if (selectionBusy || deleting.value || !selectedNodes.value.length) return;
    menu.value?.handleClose();
    emit("duplicateSelection");
    return;
  }
  if (command === "upload") {
    menu.value?.handleClose();
    uploadFiles?.({ ...nodePosition });
    return;
  }
  if (command === "undo" || command === "redo") {
    if (command === "undo" ? !canUndo : !canRedo) return;
    menu.value?.handleClose();
    if (command === "undo") emit("undo");
    else emit("redo");
    return;
  }
  if (batchHistory) {
    try {
      await batchHistory(() => runCommand(command));
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "画布操作失败");
    }
    return;
  }
  await runCommand(command);
}

async function runCommand(command: unknown) {
  if (command === "horizontal" || command === "vertical" || command === "grid") {
    if (!canArrangeSelection.value) return;
    arrangeSelection(flow, selectedNodes.value, command);
    menu.value?.handleClose();
    return;
  }
  if (command === "paste") {
    if (!pasteNode || pasting.value) return;
    pasting.value = true;
    try {
      if (await pasteNode({ ...nodePosition })) menu.value?.handleClose();
    } finally {
      pasting.value = false;
    }
    return;
  }
  if (command === "deleteSelection") {
    await deleteSelection();
    return;
  }
  const node = filteredNodes.value.find((option) => option.type === command);
  if (!node) return;
  const handle = pendingHandle.value;
  const group = pendingGroup.value;
  const request = menuRequest;
  const position = { ...nodePosition };
  await loadNodes([node.type]);
  if (request !== menuRequest) return;
  if (handle && flow.findNode(handle.node.id) !== handle.node) return;
  if (group.some(source => flow.findNode(source.id) !== source)) return;
  const id = crypto.randomUUID();
  addNodes({ id, type: node.type, position, data: { ...newGenerationData(node.type), label: node.label } });
  if (!handle && !group.length) {
    flow.removeSelectedElements();
    flow.nodesSelectionActive.value = false;
    const created = flow.findNode(id);
    if (created) flow.addSelectedNodes([created]);
    return menu.value?.handleClose();
  }
  // ACT: 远端节点挂载后才注册端口，沿用画布工具的 nextTick 等待方式。
  await nextTick();
  const created = flow.findNode(id);
  if (group.length) {
    if (!created) return;
    const connections = flow.nodesConnectable.value
      ? getSelectionConnections(group, created, flow.getNodes.value, flow.getEdges.value)
      : undefined;
    if (connections) {
      flow.addEdges(connections);
      flow.removeSelectedElements();
      flow.nodesSelectionActive.value = false;
      clearConnection();
      menu.value?.handleClose();
    } else {
      flow.removeNodes(id, true);
      flow.removeSelectedElements();
      flow.addSelectedNodes(group);
      flow.nodesSelectionActive.value = true;
      ElMessage.warning("该节点的接收规则不允许整组选中节点连接");
    }
    return;
  }
  if (!handle) return;
  if (!created || flow.findNode(handle.node.id) !== handle.node) {
    clearConnection();
    return menu.value?.handleClose();
  }
  const sourceNode = handle.type === "source" ? handle.node : created;
  const targetNode = handle.type === "target" ? handle.node : created;
  const connection = (created.data.handles as NodeHandle[] | undefined)
    ?.filter((item) => item.type !== handle.type)
    .map((item) => ({
      source: sourceNode.id,
      target: targetNode.id,
      sourceHandle: handle.type === "source" ? handle.id : item.id,
      targetHandle: handle.type === "target" ? handle.id : item.id,
    }))
    .find(
      (item) =>
        flow.nodesConnectable.value &&
        sourceNode.connectable !== false &&
        targetNode.connectable !== false &&
        validateConnection(item, { sourceNode, targetNode, nodes: flow.getNodes.value, edges: flow.getEdges.value })
    );
  if (connection) flow.addEdges(connection);
  else ElMessage.warning("节点已创建，但没有兼容的端口可连接");
  clearConnection();
  menu.value?.handleClose();
}

async function deleteSelection(selection = selectedNodes.value) {
  if (selectionBusy || deleting.value) return;
  const nodes = getSelectionTree(selection.filter(node => node.deletable !== false), flow.getNodes.value).reverse();
  const nodeIds = new Set(nodes.filter(node => node.deletable !== false).map(node => node.id));
  deleting.value = true;
  try {
    for (const node of nodes) {
      if (node.deletable === false || flow.findNode(node.id) !== node) continue;
      if (flow.getNodes.value.some(item => item.parentNode === node.id && !nodeIds.has(item.id))) throw new Error("分组中存在不可删除的节点");
      if (flow.getConnectedEdges(node.id).some((edge) => edge.deletable === false)) throw new Error("节点存在不可删除的连接");
    }
    for (const node of nodes) {
      if (node.deletable === false || flow.findNode(node.id) !== node) continue;
      await useNodeEvent(node.id, flow).emit("delete");
      if (flow.getNodes.value.some(item => item.parentNode === node.id)) throw new Error("分组内容已变化，请重新删除");
      if (flow.findNode(node.id) === node) flow.removeNodes(node.id, true);
    }
    menu.value?.handleClose();
  } catch (error) {
    const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
    ElMessage.error(message || (error instanceof Error ? error.message : "删除选中节点失败"));
  } finally {
    selectedNodes.value = selectedNodes.value.filter((node) => flow.findNode(node.id) === node);
    deleting.value = false;
  }
}
</script>

<style lang="scss" scoped>
.nodeMenu {
  min-width: 180px;

  .nodeTypeIcon {
    flex-shrink: 0;
    margin-right: 10px;
  }

  :deep(.el-divider--horizontal) {
    margin: 4px 0;
  }

  .sectionTitle { height: 24px; color: var(--el-text-color-secondary); font-size: 12px; cursor: default; }

  .nextIcon {
    margin-left: auto;
  }
}

.historyPicker {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(0, 1.6fr);
  gap: 16px;
  min-height: 300px;

  .historyList { max-height: 360px; overflow: auto; }
  .historyItem { display: flex; width: 100%; align-items: center; gap: 10px; padding: 10px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--el-text-color-primary); text-align: left; cursor: pointer;
    &:hover, &.selected { background: var(--el-fill-color-light); }
    &.selected { border-color: var(--el-color-primary-light-5); }
    span { min-width: 0; display: grid; gap: 4px; }
    strong, small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    strong { font-size: 13px; font-weight: 500; }
    small { color: var(--el-text-color-secondary); font-size: 11px; }
    &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
  }
  .historyPreview { display: grid; min-height: 300px; place-items: center; overflow: hidden; border-radius: 6px; background: var(--el-fill-color-darker); color: var(--el-text-color-secondary);
    img, video { max-width: 100%; max-height: 360px; object-fit: contain; }
    audio { width: min(100%, 440px); }
  }
}

@media (max-width: 620px) {
  .historyPicker { grid-template-columns: 1fr; .historyList { max-height: 180px; } .historyPreview { min-height: 180px; } }
}
</style>
