<template>
  <div class="canvasHost">
    <canvasPanel
      v-for="entry in entries"
      :key="entry.key"
      :ref="value => setInstance(entry.key, value)"
      class="canvasRuntime"
      :class="{ backgroundCanvas: entry.key !== activeKey }"
      :aria-hidden="entry.key !== activeKey"
      :inert="entry.key !== activeKey"
      :runtimeKey="entry.key"
      :initialCanvasId="entry.fileName"
      :active="active && entry.key === activeKey"
      :settingsVisible="settingsVisible"
      :activateCanvas="activateCanvas"
      :resolveCanvasContext="resolveCanvasContext"
      :flushCanvases="flushSave" />
  </div>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, provide, shallowReactive, shallowRef, ref, watch, type ComponentPublicInstance } from "vue";
import type { CanvasContext } from "@toonflow/tool-canvas/runtime";
import type { ProductionSelection } from "@toonflow/server/production";
import axios from "axios";
import { waitForControlValue } from "@/lib/mcpControl";
import canvasPanel from "./index.vue";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { useWorkspaceStore } from "@/stores/workspace";
import { createCanvasMention, mentionNodeOutputs, queryMentionNodes, type MentionCanvasSource } from "@toonflow/server/agent/mentionSources";
import type { CanvasHistoryState } from "./useCanvasHistory";

const props = withDefaults(defineProps<{ active?: boolean; settingsVisible?: boolean }>(), { active: true, settingsVisible: false });
type CanvasInstance = InstanceType<typeof canvasPanel>;
const entries = shallowRef<{ key: string; fileName?: string }[]>([{ key: crypto.randomUUID() }]);
const activeKey = ref(entries.value[0]!.key);
const instances = shallowReactive(new Map<string, CanvasInstance>());
const activeInstance = computed(() => instances.get(activeKey.value));
const canvasId = computed(() => activeInstance.value?.canvasId ?? "");
const canvasReady = computed(() => activeInstance.value?.canvasReady ?? false);
const lifetime = new AbortController();
const workspaceStore = useWorkspaceStore();
watch(canvasId, value => { const directory = workspaceStore.project?.directory; if (directory && value) workspaceStore.lastCanvas = { directory, canvasId: value }; });
const canvases = shallowRef<{ id: string; flow?: unknown }[]>([]);
const histories = new WeakMap<object, CanvasHistoryState>();
const lastUsed = new Map<string, number>();
provide("canvasList", canvases);
provide("canvasAssetNodes", (id: string) => [...instances.values()].find(panel => panel.canvasId === id)?.getRetainedNodes()
  ?? histories.get(canvases.value.find(canvas => canvas.id === id) ?? {})?.nodes ?? []);
watch(canvases, (current, previous) => {
  const removed = new Set(previous.filter(canvas => !current.includes(canvas)).map(canvas => canvas.id));
  if (!removed.size) return;
  entries.value = entries.value.filter(entry => {
    const panel = instances.get(entry.key);
    if (!removed.has(panel?.canvasId || entry.fileName || "")) return true;
    // 卸载会刷新待保存内容，删除文件后必须先取消，避免重新创建 JSON。
    panel?.cancelSave();
    return false;
  });
  if (!entries.value.some(entry => entry.key === activeKey.value)) activeKey.value = entries.value[0]?.key ?? "";
}, { flush: "sync" });
onScopeDispose(() => lifetime.abort(new Error("工作区已关闭")));
let releasing = false;
async function releaseIdleCanvases() {
  if (releasing || lifetime.signal.aborted || entries.value.length <= 4) return;
  releasing = true;
  try {
    const candidates = entries.value.filter(entry => entry.key !== activeKey.value && Date.now() - (lastUsed.get(entry.key) ?? 0) >= 30000)
      .sort((a, b) => (lastUsed.get(a.key) ?? 0) - (lastUsed.get(b.key) ?? 0));
    for (const entry of candidates) {
      if (entries.value.length <= 4 || lifetime.signal.aborted) break;
      const panel = instances.get(entry.key);
      if (!panel?.canRelease) continue;
      await panel.flushSave();
      if (entry.key === activeKey.value || !panel.canRelease || lifetime.signal.aborted) continue;
      const canvas = canvases.value.find(canvas => canvas.id === panel.canvasId);
      if (!canvas) continue;
      histories.set(canvas, panel.exportHistory());
      delete canvas.flow;
      // ACT: 保留轻量撤销数据，只释放闲置渲染实例；未声明可卸载状态的旧插件继续保留。
      panel.cancelSave();
      entries.value = entries.value.filter(item => item !== entry);
      lastUsed.delete(entry.key);
    }
  } catch (error) { console.warn("空闲画布暂未释放", error); }
  finally { releasing = false; }
}
const releaseTimer = setInterval(() => void releaseIdleCanvases(), 30000);
onScopeDispose(() => clearInterval(releaseTimer));

function setInstance(key: string, value: Element | ComponentPublicInstance | null) {
  if (value) instances.set(key, value as CanvasInstance);
  else instances.delete(key);
}

async function activateCanvas(fileName: string, signal?: AbortSignal) {
  const callSignal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(120000), ...(signal ? [signal] : [])]);
  callSignal.throwIfAborted();
  const previousKey = activeKey.value;
  let entry = entries.value.find(item => instances.get(item.key)?.canvasId === fileName || (!instances.get(item.key)?.canvasId && item.fileName === fileName));
  if (!entry) {
    // 初始实例正在载入路由画布时先等它完成，避免同一文件被两个实例分别初始化，覆盖刚设置的选择与视口。
    const initializing = entries.value.find(item => !item.fileName && !instances.get(item.key)?.canvasId && !instances.get(item.key)?.loadError);
    if (initializing) {
      await waitForControlValue(() => { const panel = instances.get(initializing.key); return panel?.canvasReady || panel?.loadError ? panel : undefined; }, callSignal);
      entry = entries.value.find(item => instances.get(item.key)?.canvasId === fileName);
    }
  }
  if (!entry) {
    entry = { key: crypto.randomUUID(), fileName };
    entries.value = [...entries.value, entry];
  }
  activeKey.value = entry.key;
  lastUsed.set(entry.key, Date.now());
  const key = entry.key;
  try {
    const panel = await waitForControlValue(() => {
      const instance = instances.get(key);
      return instance?.canvasReady || instance?.loadError ? instance : undefined;
    }, callSignal);
    if (panel.loadError) throw new Error(panel.loadError);
    const canvas = canvases.value.find(canvas => canvas.id === fileName);
    const history = canvas && histories.get(canvas);
    if (history) { panel.importHistory(history); histories.delete(canvas!); }
  } catch (error) {
    if (activeKey.value === key) activeKey.value = previousKey;
    if (!instances.get(key)?.canvasId) entries.value = entries.value.filter(item => item.key !== key);
    throw error;
  }
}

function resolveCanvasContext(fileName: string): CanvasContext | undefined {
  return [...instances.values()].find(instance => instance.canvasId === fileName)?.getCanvasContext();
}

function getCanvasContext() {
  return props.active ? activeInstance.value?.getCanvasContext() : undefined;
}

async function flushSave(action?: () => Promise<void>) {
  const panels = entries.value.map(entry => instances.get(entry.key)).filter((panel): panel is CanvasInstance => !!panel);
  if (!action) {
    await Promise.all(panels.map(panel => panel.flushSave()));
    return;
  }
  // 重命名文件期间暂停所有实例自动保存，目标实例同步新路径后再恢复。
  const run = (index: number): Promise<void> => index < panels.length ? panels[index]!.flushSave(() => run(index + 1)) : action();
  await run(0);
}

function documentInstance(canvasPath: string) {
  const instance = [...instances.values()].find(panel => panel.canvasId === canvasPath) ?? activeInstance.value;
  if (!instance) throw new Error("画布尚未就绪");
  return instance;
}

function readDocumentNode(...args: Parameters<CanvasInstance["readDocumentNode"]>) {
  return documentInstance(args[1]).readDocumentNode(...args);
}

function saveDocumentNode(...args: Parameters<CanvasInstance["saveDocumentNode"]>) {
  return documentInstance(args[1]).saveDocumentNode(...args);
}

function cancelSave() {
  for (const panel of instances.values()) panel.cancelSave();
}

function mentionInstance(canvasId: string) {
  return [...instances.values()].find(panel => panel.canvasId === canvasId);
}

const mentionSource: MentionCanvasSource = {
  currentCanvasId: () => canvasId.value,
  canvases: () => canvases.value.map(canvas => ({ id: canvas.id, name: canvas.id.replace(/\.json$/i, "") })),
  nodes(canvasId, options) {
    const panel = mentionInstance(canvasId);
    if (!panel) return;
    const nodes = panel.getMentionNodes();
    return queryMentionNodes(nodes, `${workspaceStore.project?.directory}:${canvasId}:${nodes.length}`, options);
  },
  outputs(canvasId, nodeId) {
    const panel = mentionInstance(canvasId);
    if (!panel) return;
    const node = panel.findMentionNode(nodeId);
    if (!node) throw new Error("节点已删除，请重新选择");
    return mentionNodeOutputs(node);
  },
  selectCanvas(canvasId, nodeId, outputId) {
    const panel = mentionInstance(canvasId);
    if (!panel) return;
    const node = panel.findMentionNode(nodeId);
    if (!node) throw new Error("节点已删除，请重新选择");
    const directory = workspaceStore.project?.directory;
    if (!directory) throw new Error("请先打开工作区");
    return createCanvasMention(node, canvasId, outputId, async path => {
      const text = await useWorkspaceFiles(directory).readText(path, 400001);
      if (text.length > 100000) throw new Error("文本引用最多支持 100000 个字符，请缩小内容后重试");
      return text;
    });
  },
};

async function locateTask(id: string, nodeId?: string) {
  await activateCanvas(id);
  if (!nodeId) return;
  const context = getCanvasContext();
  if (!context) throw new Error("画布仍未加载完成，请重新定位");
  await context.call({ name: "selectNodes", args: { nodeIds: [nodeId] } });
  await context.call({ name: "fitCanvas", args: { nodeIds: [nodeId] } });
}
async function applyProductionSelection(shotId: string, directory: string) {
  if (directory !== workspaceStore.project?.directory) throw new Error("项目已切换，请重新同步采用结果");
  const { data } = await axios.get<{ data: ProductionSelection }>("/api/production/selection", { params: { directory, shotId }, headers: { "x-toonflow-workspace": "1" }, signal: lifetime.signal });
  if (directory !== workspaceStore.project?.directory) throw new Error("项目已切换，采用记录保留在原项目");
  const selection = data.data;
  if (!selection.canvasId || !selection.nodeId) return selection;
  await activateCanvas(selection.canvasId, lifetime.signal);
  const panel = [...instances.values()].find(panel => panel.canvasId === selection.canvasId);
  if (!panel) throw new Error("绑定画布暂无法打开，请重新同步");
  await panel.applyProductionSelection(selection, directory);
  return selection;
}
async function openDirectorSource(captureId: string) {
  const directory = workspaceStore.project?.directory;
  if (!directory) throw new Error("请先打开项目");
  const { data } = await axios.get<{ data: import("@toonflow/nodes-scaffold/directorProduction").DirectorCapture }>("/api/production/director/capture", { params: { directory, captureId }, headers: { "x-toonflow-workspace": "1" }, signal: lifetime.signal });
  if (directory !== workspaceStore.project?.directory || !data.data.canvasId) throw new Error("机位所属项目已切换或缺少画布位置");
  await activateCanvas(data.data.canvasId, lifetime.signal);
  const panel = [...instances.values()].find(panel => panel.canvasId === data.data.canvasId);
  if (!panel) throw new Error("机位所属画布尚未打开，请重试");
  await panel.openDirectorSource(data.data);
}
function hasProductionSelection(canvasId: string, nodeId: string, candidateId: string) { return [...instances.values()].find(panel => panel.canvasId === canvasId)?.hasProductionSelection(nodeId, candidateId) || false; }
defineExpose({ canvasId, canvasReady, getCanvasContext, readDocumentNode, saveDocumentNode, flushSave, cancelSave, locateTask,
  applyProductionSelection, hasProductionSelection, openDirectorSource,
  mentionSource,
  get saveBusy() { return [...instances.values()].some(panel => panel.saveBusy); },
});
</script>

<style scoped lang="scss">
.canvasHost {
  position: relative;
  width: 100%;
  height: 100%;

  .canvasRuntime {
    position: absolute;
    inset: 0;

    &.backgroundCanvas {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    }
  }
}
</style>
