<template>
  <panel class="canvasMenuPanel" position="top-left">
    <el-card class="canvasMenu" shadow="never" :bodyStyle="{ padding: '0' }">
      <div class="menuContent">
        <el-popover v-model:visible="menuVisible" trigger="click" placement="bottom-start" :width="172" :showArrow="false">
          <template #reference><el-button class="menuIcon canvasTopButton" text aria-label="画布菜单" :aria-expanded="menuVisible" @keydown.esc.stop="menuVisible = false"><icon-menu-2 :size="20" :strokeWidth="1.75" /></el-button></template>
          <div class="canvasMenuActions" @keydown.esc.stop="menuVisible = false">
            <router-link to="/home"><icon-home :size="16" />回到主页</router-link>
            <router-link to="/canvas"><icon-layout-grid :size="16" />画布管理</router-link>
            <taskButton @click="menuVisible = false" />
          </div>
        </el-popover>
        <router-link class="canvasProject" to="/home" :title="workspace.workspaceRoot?.directory || '选择工作空间'"><span>工作空间</span><strong>{{ workspace.workspaceRoot?.name || workspace.project?.name }}</strong></router-link>
        <router-link class="canvasManagement" to="/canvas" title="按工作空间管理画布" aria-label="画布管理"><icon-layout-grid :size="16" aria-hidden="true" /><span>画布管理</span></router-link>
        <el-popover v-model:visible="canvasListVisible" trigger="click" placement="bottom-start" :width="300" :showArrow="false" :disabled="!directory" popperClass="canvasPickerPopover"
          :popperOptions="{ strategy: 'fixed', modifiers: [{ name: 'preventOverflow', options: { rootBoundary: 'viewport', tether: false, altAxis: true, padding: 12 } }] }">
          <template #reference>
            <el-button class="canvasTrigger" :loading="busy" :disabled="busy || !directory" aria-label="画布项目" :title="activeCanvasName" :aria-expanded="canvasListVisible" @keydown.esc.stop="canvasListVisible = false">
              <span class="canvasName">{{ activeCanvasName }}</span><span class="canvasChevron" :class="{ expanded: canvasListVisible }"><icon-chevron-down :size="16" /></span>
            </el-button>
          </template>
          <div class="canvasPicker" @keydown.stop @keydown.esc="canvasListVisible = false">
            <div class="pickerHeader">
              <span>画布</span>
              <el-button class="addCanvasButton" text :icon="IconPlus" aria-label="新建画布" title="新建画布" :disabled="busy || editingId !== null || !directory" @click="handleAddCanvas" />
            </div>
            <el-scrollbar maxHeight="min(320px, 50dvh)">
              <div v-for="canvas in canvases" :key="canvas.id" class="canvasItem" :class="{ selected: activeCanvasId === canvas.id }">
                <el-input v-if="editingId === canvas.id" ref="nameInputs" v-model="canvasName" class="nameEditor" size="small" :disabled="busy" :maxlength="120" :aria-label="newCanvasId === canvas.id ? '新画布名称' : '画布名称'" @keydown.stop @keydown.enter="saveCanvas" @blur="saveCanvas" />
                <template v-else>
                  <button class="canvasChoice" type="button" :disabled="busy || editingId !== null" :aria-pressed="activeCanvasId === canvas.id" :title="canvas.name" @click="handleSwitchCanvas(canvas.id)">{{ canvas.name }}</button>
                  <div class="itemAction">
                    <icon-check v-if="activeCanvasId === canvas.id" class="selectedIcon" :size="18" aria-hidden="true" />
                    <el-button class="iconButton renameButton" text :icon="IconEdit" :disabled="busy || editingId !== null" :aria-label="`编辑 ${canvas.name}`" title="编辑" @click="editCanvas(canvas)" />
                    <el-button class="iconButton deleteButton" text type="danger" :icon="IconTrash" :disabled="busy || editingId !== null || canvases.length <= 1" :aria-label="`删除 ${canvas.name}`" :title="canvases.length <= 1 ? '至少保留一个画布' : '删除画布'" @click="removeCanvas(canvas)" />
                  </div>
                </template>
              </div>
            </el-scrollbar>
            <el-text v-if="renameError" type="danger" role="alert">{{ renameError }}</el-text>
          </div>
        </el-popover>
        <div v-if="activeCanvasId" class="canvasMeta">
          <el-popover v-model:visible="elementsVisible" trigger="click" placement="bottom-start" :width="300" :showArrow="false" popperClass="canvasElementsPopover"
            :popperOptions="{ strategy: 'fixed', modifiers: [{ name: 'preventOverflow', options: { rootBoundary: 'viewport', tether: false, altAxis: true, padding: 12 } }] }">
            <template #reference><button type="button" class="nodeCount" :aria-label="`画布元素，${nodeCount} 个节点`" :aria-expanded="elementsVisible" @keydown.esc.stop="elementsVisible = false">节点 {{ nodeCount }}</button></template>
            <div v-if="elementsVisible" @keydown.stop @keydown.esc="elementsVisible = false"><slot name="elements" /></div>
          </el-popover>
          <span class="statusDivider" aria-hidden="true"></span>
          <div class="canvasSaveStatus" :class="{ failed: saveStatus.includes('失败') }" role="status">
            <span :title="saveStatus">{{ saveStatus }}</span><button v-if="saveStatus.includes('失败')" type="button" @click="emit('retrySave')">重试保存</button>
          </div>
        </div>
      </div>
    </el-card>
  </panel>
</template>

<script setup lang="ts">
import axios from "axios";
import { useRoute } from "vue-router";
import { translate } from "@toonflow/i18n/vue";
import { computed, inject, nextTick, ref, shallowRef, watch, type ShallowRef } from "vue";
import { Panel, useVueFlow, type FlowExportObject } from "@vue-flow/core";
import { ElMessage, ElMessageBox, type InputInstance } from "element-plus";
import { IconEdit, IconCheck, IconChevronDown, IconPlus, IconTrash, IconMenu2, IconHome, IconLayoutGrid } from "@tabler/icons-vue";
import { canvasDraftKey, clearCanvasDraft } from "@/lib/canvasDraft";
import { validateCanvas, validCanvasName } from "@/pages/canvasLibrary/canvasTransfer";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { getCanvasAssetDirectories, isCanvasFile } from "@/pages/workspace/canvasFile";
import { useWorkspaceStore } from "@/stores/workspace";
import { canvasFolder } from "@/lib/canvasStorage";
import createNumberedCanvas from "@/pages/workspace/createCanvas";
import taskButton from "@/components/taskButton.vue";

const props = defineProps<{
  directory?: string;
  initialCanvasId?: string;
  saveStatus: string;
  activateCanvas?: (id: string, signal?: AbortSignal) => Promise<void>;
  flushSave: (action?: () => Promise<void>) => Promise<void>;
}>();
const emit = defineEmits<{ retrySave: []; loaded: [] }>();
const workspace = useWorkspaceStore();
const route = useRoute();
type Canvas = { id: string; name: string; flow?: Pick<FlowExportObject, "nodes" | "edges" | "viewport"> };
const canvases = inject<ShallowRef<Canvas[]>>("canvasList", shallowRef<Canvas[]>([]));
const getRetainedNodes = inject<(id: string) => { id: string; data?: unknown }[]>("canvasAssetNodes", () => []);
const boundCanvas = shallowRef<Canvas>();
const activeCanvasId = defineModel<string>("canvasId", { default: "" });
watch(canvases, () => {
  if (boundCanvas.value) activeCanvasId.value = canvases.value.includes(boundCanvas.value) ? boundCanvas.value.id : "";
}, { flush: "sync" });
const canvasListVisible = ref(false);
const menuVisible = ref(false);
const elementsVisible = ref(false);
const activeCanvasName = computed(() => canvases.value.find(canvas => canvas.id === activeCanvasId.value)?.name || translate("选择画布"));
const busy = ref(false);
const loadError = ref("");
const editingId = ref<string | null>(null);
const newCanvasId = ref<string | null>(null);
const nameInputs = ref<InputInstance[]>([]);
const canvasName = ref("");
const renameError = ref("");
const { toObject, setNodes, setEdges, setViewport, getNodes } = useVueFlow();
const nodeCount = computed(() => getNodes.value.filter(node => !node.hidden).length);

watch(() => props.directory, async (directory, _previous, onCleanup) => {
  let cancelled = false;
  onCleanup(() => { cancelled = true; });
  busy.value = true;
  loadError.value = "";
  boundCanvas.value = undefined;
  activeCanvasId.value = "";
  try {
    if (!props.initialCanvasId) canvases.value = [];
    newCanvasId.value = null;
    editingId.value = null;
    renameError.value = "";
    if (!directory) return;
    if (props.initialCanvasId) {
      await applyCanvas(props.initialCanvasId, directory);
      return;
    }
    let loaded = await listCanvases(directory);
    if (cancelled) return;
    if (!loaded.length) {
      try {
        loaded = [await createCanvasFile(directory, "无限画布1")];
      } catch (err) {
        if (!axios.isAxiosError<{ data?: { code?: string } }>(err) || err.response?.status !== 409 || err.response.data.data?.code !== "EEXIST") throw err;
        // 同时打开工作区时，读取另一请求刚创建的默认画布，不覆盖同名文件。
        const refreshed = await listCanvases(directory);
        // 无限画布1.json 若被其他 JSON 占用，则使用下一个空闲名称，保留原文件。
        loaded = refreshed.length ? refreshed : [await createCanvasFile(directory)];
      }
    }
    if (cancelled) return;
    canvases.value = loaded;
    const requested = typeof route.query.canvas === "string" ? canvases.value.find(canvas => canvas.id === route.query.canvas) : undefined;
    const first = requested ?? canvases.value[0];
    if (first) await applyCanvas(first.id, directory);
  } catch (err) {
    if (!cancelled) {
      loadError.value = errorMessage(err, "读取画布失败");
      if (!props.initialCanvasId) ElMessage.error(loadError.value);
    }
  } finally {
    if (!cancelled) busy.value = false;
  }
}, { immediate: true });

function errorMessage(err: unknown, fallback: string) {
  return axios.isAxiosError<{ message?: string }>(err) ? err.response?.data.message || fallback : err instanceof Error ? err.message : fallback;
}

function getCanvases() {
  return canvases.value.map(({ id, name }) => ({ id, name }));
}

function getCanvasDirectory(signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!props.directory) throw new Error("请先选择工作目录");
  if (busy.value || editingId.value !== null) throw new Error("画布正在加载或编辑，请稍后重试");
  return props.directory;
}

function checkCanvasDirectory(directory: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (props.directory !== directory) throw new Error("工作目录已切换，本次画布操作已停止");
}

async function applyCanvas(canvasId: string, directory: string, signal?: AbortSignal) {
  checkCanvasDirectory(directory, signal);
  const nextCanvas = canvases.value.find(canvas => canvas.id === canvasId);
  const currentCanvas = canvases.value.find(canvas => canvas.id === activeCanvasId.value);
  if (!nextCanvas) throw new Error("画布不存在，请重新获取画布列表");
  if (nextCanvas === currentCanvas) return;
  if (currentCanvas && props.activateCanvas) {
    await props.activateCanvas(canvasId, signal);
    checkCanvasDirectory(directory, signal);
    return;
  }
  if (!nextCanvas.flow) {
    let data = await useWorkspaceFiles(directory).readJson<Partial<NonNullable<Canvas["flow"]>> & { toonflowCanvas?: boolean } | null>(nextCanvas.id);
    checkCanvasDirectory(directory, signal);
    if (data?.toonflowCanvas !== true || !Array.isArray(data.nodes) || !Array.isArray(data.edges) || !data.viewport
      || ![data.viewport.x, data.viewport.y, data.viewport.zoom].every(Number.isFinite) || data.viewport.zoom <= 0) throw new Error("画布文件格式无效");
    let backup: string | null = null;
    try { backup = localStorage.getItem(canvasDraftKey(directory, nextCanvas.id)); } catch { /* 浏览器存储不可用时继续读取磁盘。 */ }
    if (backup) {
      let draft: { savedAt: number; data: unknown } | undefined;
      try { draft = JSON.parse(backup); validateCanvas(draft?.data); }
      catch { draft = undefined; ElMessage.warning("本地画布备份无法读取，已打开磁盘版本"); }
      if (draft) {
        const restore = await ElMessageBox.confirm(`发现 ${new Date(draft.savedAt).toLocaleString()} 的未保存修改，是否恢复？`, "恢复画布", { confirmButtonText: "恢复修改", cancelButtonText: "使用磁盘版本", showClose: false, closeOnClickModal: false, closeOnPressEscape: false }).then(() => true, () => false);
        if (restore) { validateCanvas(draft.data); await useWorkspaceFiles(directory).writeJson(nextCanvas.id, draft.data); data = draft.data; }
        clearCanvasDraft(directory, nextCanvas.id, backup);
        checkCanvasDirectory(directory, signal);
      }
    }
    validateCanvas(data);
    // 旧画布可能保存了临时导出进度，重新打开时任务已不存在。
    for (const node of data.nodes) if (node.type === "remote-videoNode" && node.data) delete node.data.exportProgress;
    nextCanvas.flow = { nodes: data.nodes, edges: data.edges, viewport: data.viewport };
  }
  await props.flushSave();
  checkCanvasDirectory(directory, signal);
  if (currentCanvas) currentCanvas.flow = toObject();
  // 应用画布数据时暂时清空文件名，避免初始化触发自动保存。
  activeCanvasId.value = "";
  setNodes(nextCanvas.flow.nodes);
  // 命中宽度由画布统一配置，不使用旧文件中的覆盖值。
  setEdges(nextCanvas.flow.edges.map(({ interactionWidth, ...edge }) => edge));
  await setViewport(nextCanvas.flow.viewport);
  await nextTick();
  checkCanvasDirectory(directory);
  emit("loaded");
  boundCanvas.value = nextCanvas;
  activeCanvasId.value = nextCanvas.id;
  signal?.throwIfAborted();
}

async function switchCanvas(canvasId: string, signal?: AbortSignal) {
  const directory = getCanvasDirectory(signal);
  canvasListVisible.value = false;
  busy.value = true;
  try {
    if (props.activateCanvas) await props.activateCanvas(canvasId, signal);
    else await applyCanvas(canvasId, directory, signal);
    checkCanvasDirectory(directory, signal);
  } finally {
    if (props.directory === directory) busy.value = false;
  }
}

async function handleSwitchCanvas(canvasId: string) {
  const directory = props.directory;
  try {
    await switchCanvas(canvasId);
  } catch (err) {
    if (props.directory === directory) ElMessage.error(errorMessage(err, "切换画布失败"));
  }
}

async function removeCanvas(canvas: Canvas) {
  if (busy.value || editingId.value !== null || !props.directory || canvases.value.length <= 1) return;
  const directory = props.directory;
  const id = canvas.id;
  busy.value = true;
  canvasListVisible.value = false;
  try {
    const confirmed = await ElMessageBox.confirm(`确定删除“${canvas.name}”？对应的 ${id} 文件及独占的节点素材也会被删除，其他画布共用的素材会保留。此操作不可撤销。`, "删除画布", {
      type: "warning", confirmButtonText: "删除", cancelButtonText: "取消", closeOnClickModal: false,
    }).then(() => true, () => false);
    if (!confirmed) return;
    checkCanvasDirectory(directory);
    const nextCanvas = canvases.value.find(item => item.id !== id);
    if (!nextCanvas) throw new Error("至少保留一个画布");
    if (activeCanvasId.value === id) await applyCanvas(nextCanvas.id, directory);
    await props.flushSave(async () => {
      checkCanvasDirectory(directory);
      if (canvas.id !== id || !canvases.value.includes(canvas)) throw new Error("画布已变更，请重新选择");
      if (canvases.value.length <= 1) throw new Error("至少保留一个画布");
      const files = useWorkspaceFiles(directory);
      const storedCanvases = await Promise.all((await listCanvases(directory)).map(async canvas => {
        const data = await files.readJson<{ toonflowCanvas?: boolean; nodes?: { id: string; data?: unknown }[] }>(canvas.id);
        if (data?.toonflowCanvas !== true || !Array.isArray(data.nodes) || data.nodes.some(node => !node || typeof node.id !== "string")) {
          throw new Error(`无法确认 ${canvas.id} 的素材引用，已停止删除`);
        }
        return { id: canvas.id, nodes: [...data.nodes, ...getRetainedNodes(canvas.id)] };
      }));
      const removedCanvas = storedCanvases.find(canvas => canvas.id === id);
      if (!removedCanvas) throw new Error("画布不存在，请重新获取画布列表");
      if (storedCanvases.length <= 1) throw new Error("至少保留一个画布");
      const assetDirectories = getCanvasAssetDirectories(removedCanvas.nodes, storedCanvases.filter(canvas => canvas.id !== id).flatMap(canvas => canvas.nodes));
      checkCanvasDirectory(directory);
      await files.remove(id);
      checkCanvasDirectory(directory);
      canvases.value = canvases.value.filter(item => item !== canvas);
      // 等待宿主停止并卸载已删除画布，再恢复其他画布的自动保存。
      await nextTick();
      const results = await Promise.allSettled(assetDirectories.map(path => files.remove(path, true).catch(error => {
        if (!axios.isAxiosError<{ data?: { code?: string } }>(error) || error.response?.data.data?.code !== "ENOENT") throw error;
      })));
      const failed = results.flatMap((result, index) => result.status === "rejected" ? [assetDirectories[index]] : []);
      if (failed.length) throw new Error(`画布已删除，但 ${failed.length} 个素材目录清理失败：${failed.join("、")}`);
    });
    if (props.directory === directory) ElMessage.success("画布已删除");
  } catch (err) {
    if (props.directory === directory) ElMessage.error(errorMessage(err, "删除画布失败"));
  } finally {
    if (props.directory === directory) busy.value = false;
  }
}

async function createCanvasFile(directory: string, name?: string, signal?: AbortSignal) {
  if (name === undefined) return createNumberedCanvas(directory, signal);
  name = normalizeCanvasName(name);
  const files = useWorkspaceFiles(directory);
  const flow = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
  checkCanvasDirectory(directory, signal);
  const folder = await canvasFolder(directory);
  const id = `${folder ? folder + "/" : ""}${name}.json`;
  await files.writeJson(id, { toonflowCanvas: true, ...flow }, true);
  return { id, name, flow };
}

async function listCanvases(directory: string): Promise<Canvas[]> {
  const files = useWorkspaceFiles(directory);
  const { entries } = await files.list(await canvasFolder(directory));
  const loaded = await Promise.all(entries.filter(entry => entry.type === "file" && /\.json$/i.test(entry.name)).map(async entry => {
    if (!(await isCanvasFile(files, entry.path))) return null;
    return { id: entry.path, name: entry.name.slice(0, -5) };
  }));
  return loaded.filter(canvas => canvas !== null).sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true }));
}

async function addCanvas(name?: string, signal?: AbortSignal): Promise<string> {
  const directory = getCanvasDirectory(signal);
  busy.value = true;
  try {
    const canvas = await createCanvasFile(directory, name, signal);
    checkCanvasDirectory(directory);
    canvases.value = [...canvases.value, canvas];
    signal?.throwIfAborted();
    await applyCanvas(canvas.id, directory, signal);
    canvasListVisible.value = false;
    return canvas.id;
  } finally {
    if (props.directory === directory) busy.value = false;
  }
}

async function handleAddCanvas() {
  if (busy.value || editingId.value !== null || !props.directory) return;
  const directory = props.directory;
  try {
    await addCanvas();
  } catch (err) {
    if (props.directory === directory) ElMessage.error(errorMessage(err, "新增画布失败"));
  } finally {
    if (props.directory === directory) busy.value = false;
  }
}

async function editCanvas(canvas: { id: string; name: string }) {
  if (busy.value || editingId.value !== null) return;
  editingId.value = canvas.id;
  canvasName.value = canvas.name;
  renameError.value = "";
  await nextTick();
  nameInputs.value[0]?.focus();
  nameInputs.value[0]?.select();
}

async function finishEdit() {
  if (busy.value) return;
  editingId.value = null;
  renameError.value = "";
  const createdId = newCanvasId.value;
  newCanvasId.value = null;
  if (createdId) await handleSwitchCanvas(createdId);
}

function normalizeCanvasName(name: string) {
  name = name.trim();
  if (!validCanvasName(name)) {
    throw new Error("画布名称不是有效文件名");
  }
  return name;
}

async function renameCanvasFile(id: string, name: string, directory: string, signal?: AbortSignal) {
  checkCanvasDirectory(directory, signal);
  const canvas = canvases.value.find(item => item.id === id);
  if (!canvas) throw new Error("画布不存在，请重新获取画布列表");
  name = normalizeCanvasName(name);
  if (name === canvas.name) return;
  await props.flushSave(async () => {
    checkCanvasDirectory(directory, signal);
    const target = id.replace(/[^/]+$/, `${name}.json`);
    await useWorkspaceFiles(directory).rename(id, target);
    checkCanvasDirectory(directory);
    // 文件已改名时先更新保存路径，再响应取消，避免自动保存重新创建旧文件。
    if (activeCanvasId.value === id) activeCanvasId.value = target;
    if (newCanvasId.value === id) newCanvasId.value = target;
    if (editingId.value === id) editingId.value = target;
    Object.assign(canvas, { id: target, name });
    canvases.value = [...canvases.value];
    signal?.throwIfAborted();
  });
  checkCanvasDirectory(directory, signal);
}

async function renameCanvas(canvasId: string, name: string, signal?: AbortSignal) {
  const directory = getCanvasDirectory(signal);
  busy.value = true;
  try {
    await renameCanvasFile(canvasId, name, directory, signal);
  } finally {
    if (props.directory === directory) busy.value = false;
  }
}

async function saveCanvas(event?: Event) {
  if (event instanceof KeyboardEvent && event.isComposing) return;
  const id = editingId.value;
  if (busy.value || !props.directory || id === null) return;
  const directory = props.directory;
  const canvas = canvases.value.find(item => item.id === id);
  if (!canvasName.value.trim() || canvasName.value.trim() === canvas?.name) {
    await finishEdit();
    return;
  }
  busy.value = true;
  renameError.value = "";
  try {
    await renameCanvasFile(id, canvasName.value, directory);
    busy.value = false;
    await finishEdit();
  } catch (err) {
    if (props.directory === directory) {
      renameError.value = errorMessage(err, "重命名画布失败");
      canvasListVisible.value = true;
    }
  } finally {
    if (props.directory === directory) busy.value = false;
  }
}

function syncDocumentNode(canvasId: string, nodeId: string, handleId: string, text: string, inline: boolean) {
  const node = canvases.value.find(canvas => canvas.id === canvasId)?.flow?.nodes.find(node => node.id === nodeId);
  if (!node) return;
  const data = node.data ??= {};
  const output = data.outputs?.[handleId];
  if (output?.dataType === "STRING") output.value = text;
  else if (inline) (data.outputs ??= {})[handleId] = { dataType: "STRING", value: text };
}

defineExpose({ getCanvases, addCanvas, switchCanvas, renameCanvas, syncDocumentNode, loadError });
</script>

<style lang="scss" scoped>
.canvasMenuActions {
  display: flex; flex-direction: column; gap: 4px;
  a { display: flex; align-items: center; gap: 9px; padding: 10px; color: var(--el-text-color-primary); text-decoration: none; border-radius: var(--ui-radius, 8px); font-size: 13px; &:hover { background: var(--el-fill-color); } &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; } }
}
.canvasMenuPanel.vue-flow__panel {
  left: 0;
  max-width: calc(100% - 175px);
}

.canvasPicker {
  max-height: calc(100dvh - 120px);
  overflow: auto;
  scrollbar-width: thin;
  .iconButton { width: 28px; height: 28px; padding: 0; margin: 0; }

  .pickerHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px 10px;
    font-size: 14px;
    font-weight: 600;
    color: var(--el-text-color-regular);
    .addCanvasButton { width: 32px; height: 32px; padding: 0; margin: 0; color: var(--el-text-color-primary); }
  }

  .canvasItem {
    display: flex;
    align-items: center;
    min-height: 52px;
    border-radius: var(--ui-radius-large, 12px);

    .nameEditor {
      width: 100%;
      padding: 2px 0;
    }

    &:hover, &:focus-within {
      background: var(--el-fill-color);
      .itemAction {
        .renameButton, .deleteButton { opacity: 1; }
        .selectedIcon { visibility: hidden; }
      }
    }

    .canvasChoice {
      flex: 1;
      min-width: 0;
      padding: 12px 14px;
      border: 0;
      background: transparent;
      color: var(--el-text-color-primary);
      font: inherit;
      font-size: 16px;
      text-align: left;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;

      &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; border-radius: inherit; }
    }

    .itemAction {
      position: relative;
      display: flex;
      flex-shrink: 0;
      width: 56px;
      height: 28px;
      margin-right: 10px;

      .selectedIcon { position: absolute; top: 5px; right: 12px; pointer-events: none; }
      .renameButton, .deleteButton { opacity: 0; }
    }
  }

  @media (hover: none) {
    .canvasItem .itemAction {
      display: flex;
      width: auto;
      align-items: center;
      .selectedIcon { position: static; visibility: visible; }
      .renameButton, .deleteButton { opacity: 1; }
    }
  }
}

.canvasMenu {
  margin-left: 0;
  border: none;
  background: transparent;
  max-width: 100%;

  .menuIcon { margin: 0; flex-shrink: 0; }

  .menuContent {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;

    .canvasProject { display: flex; align-items: center; gap: 7px; min-width: 0; max-width: 200px; padding: 8px 4px; color: var(--el-text-color-primary); font-size: 12px; text-decoration: none; span { flex-shrink: 0; color: var(--el-text-color-secondary); } strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; } &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; } }
    .canvasManagement { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; padding: 8px; border-radius: var(--ui-radius, 8px); background: var(--el-bg-color-overlay); color: var(--el-text-color-primary); font-size: 12px; text-decoration: none; &:hover { background: var(--el-fill-color); } &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; } }

    .canvasTrigger {
      padding: 0;
      min-width: 0;
      max-width: clamp(100px, 20cqw, 240px);
      height: var(--canvasTopButtonSize, 36px);
      border: 0;
      border-radius: var(--ui-radius, 8px);
      background: var(--el-bg-color-overlay);
      color: var(--el-text-color-primary);
      overflow: hidden;
      :deep(> span) { display: flex; align-items: stretch; min-width: 0; height: 100%; }
      :deep(> .el-icon) { margin-left: 10px; }
      .canvasName { align-self: center; padding: 0 12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .canvasChevron { display: grid; place-items: center; width: 28px; flex-shrink: 0; background: var(--el-fill-color); &.expanded svg { transform: rotate(180deg); } }
      &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
    }
    .canvasMeta {
      display: flex; align-items: center; gap: 10px; min-width: 0; color: var(--el-text-color-regular); font-size: 12px;
      .nodeCount { flex-shrink: 0; padding: 6px 0; border: 0; border-radius: 4px; background: transparent; color: inherit; font: inherit; font-variant-numeric: tabular-nums; cursor: pointer; &:hover, &[aria-expanded="true"] { color: var(--el-text-color-primary); } &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; } }
      .statusDivider { width: 1px; height: 12px; flex-shrink: 0; background: var(--el-border-color); }
      .canvasSaveStatus {
        display: flex; align-items: center; gap: 8px; min-width: 0;
        > span { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        &.failed { color: var(--el-color-danger); }
        button { flex-shrink: 0; padding: 4px; border: 0; border-radius: 4px; background: transparent; color: inherit; font: inherit; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; &:focus-visible { outline: 2px solid var(--el-color-primary); } }
      }
    }
  }
}
@container (max-width: 640px) {
  .canvasMenuPanel.vue-flow__panel { max-width: calc(100% - 78px); }
  .canvasMenu .menuContent { gap: 6px; .canvasProject { max-width: 120px; span { display: none; } } .canvasManagement span { display: none; } .canvasTrigger .canvasName { padding: 0 8px; } .canvasMeta { gap: 6px; } }
}
</style>

<style lang="scss">
.canvasPickerPopover.el-popover { max-width: calc(100vw - 24px); padding: 8px; border-radius: var(--ui-radius-large, 12px); }
.canvasElementsPopover.el-popover { max-width: calc(100vw - 24px); border-radius: var(--ui-radius-large, 12px); }
</style>
