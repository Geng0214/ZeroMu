<template>
  <mini-map v-if="showMap" class="canvasMiniMap" :style="{ bottom: `${dockHeight + 24}px` }" position="bottom-left" :pannable="true" :zoomable="true" nodeColor="var(--el-fill-color-dark)" maskColor="var(--el-mask-color-extra-light)" />
  <panel position="bottom-left" class="viewControlsPanel">
    <div ref="viewControlsRef" class="viewControls" role="group" aria-label="画布视图">
      <button :title="showMap ? '隐藏小地图' : '显示小地图'" aria-label="画布小地图" :aria-pressed="showMap" :class="{ active: showMap }" @click="showMap = !showMap"><icon-map-2 :size="20" /></button>
      <button :title="arranging ? '正在整理画布…' : '整理画布'" aria-label="整理画布" :disabled="!canArrange" :aria-busy="arranging" @click="arrangeNodes"><icon-layout-grid :size="20" /></button>
      <button :title="showEdges ? '隐藏连线' : '显示连线'" aria-label="隐藏连线" :aria-pressed="!showEdges" :class="{ active: !showEdges }" @click="showEdges = !showEdges"><icon-route :size="20" /></button>
      <button :title="snapEnabled ? '关闭网格吸附' : '开启网格吸附'" aria-label="网格吸附" :aria-pressed="snapEnabled" :class="{ active: snapEnabled }" @click="snapEnabled = !snapEnabled"><icon-magnet :size="20" /></button>
      <input class="zoomSlider" type="range" min="20" max="800" :value="zoomPercent" :aria-valuetext="`${zoomPercent}%`" aria-label="画布缩放" @input="applyZoom(Number(($event.target as HTMLInputElement).value))" />
      <el-popover v-model:visible="zoomMenuVisible" trigger="click" placement="top-start" :width="200" :showArrow="false">
        <template #reference><button class="zoomValue" title="缩放选项" :aria-label="`缩放选项，当前 ${zoomPercent}%`" :aria-expanded="zoomMenuVisible">{{ zoomPercent }}%</button></template>
        <div class="zoomMenu">
          <div class="zoomInput"><el-input-number :modelValue="zoomPercent" :min="20" :max="800" :controls="false" aria-label="缩放百分比" @change="applyZoom" /><span>%</span></div>
          <el-button text @click="applyZoom(100); zoomMenuVisible = false">重置为 100%</el-button>
          <el-button text @click="fitCanvasView">适合屏幕</el-button>
        </div>
      </el-popover>
    </div>
  </panel>
  <panel position="bottom-center" class="creationToolsPanel" :style="{ bottom: `${stackTools ? controlsSize.height + 28 : 15}px` }">
    <div ref="creationToolsRef" class="creationTools" role="toolbar" aria-label="画布工具栏">
      <button aria-label="选择工具" title="选择工具" :aria-pressed="selectedTool === 'move'" :class="{ active: selectedTool === 'move' }" @click="selectedTool = 'move'"><icon-pointer :size="18" /></button>
      <button aria-label="拖动画布" title="拖动画布（空格）" :aria-pressed="selectedTool === 'hand'" :class="{ active: selectedTool === 'hand' }" @click="selectedTool = 'hand'"><icon-hand-stop :size="18" /></button>
      <button aria-label="撤销" title="撤销" :disabled="!canUndo" @click="emit('undo')"><icon-arrow-back-up :size="18" /></button>
      <button aria-label="重做" title="重做" :disabled="!canRedo" @click="emit('redo')"><icon-arrow-forward-up :size="18" /></button>
      <span class="toolDivider"></span>
      <button v-for="item in quickNodes" :key="item.type" :aria-label="item.label" :title="item.label" :disabled="!canvasId || !remoteNodes.some(node => node.type === item.type)" @click="emit('addNode', item.type)"><component :is="item.icon" :size="18" /></button>
      <button aria-label="导演台" title="添加导演台" :disabled="!canvasId || !remoteNodes.some(node => node.type === 'remote-director3dNode')" @click="emit('addNode', 'remote-director3dNode')"><component :is="IconCube3dSphere" :size="18" /></button>
      <span class="toolDivider"></span>
      <el-popover v-for="library in libraries" :key="library.id" :visible="libraryVisible === library.id" trigger="click" placement="top-end" :width="340" :showArrow="false" :persistent="true" popperClass="canvasLibraryPopover"
        :popperOptions="{ strategy: 'fixed', modifiers: [{ name: 'preventOverflow', options: { rootBoundary: 'viewport', tether: false, altAxis: true, padding: 12 } }] }"
        @update:visible="updateLibraryVisibility(library.id, $event)">
        <template #reference><button :aria-label="library.label" :title="library.label" :aria-expanded="libraryVisible === library.id" :class="{ active: libraryVisible === library.id }" aria-haspopup="dialog" @keydown.esc.stop="libraryVisible = ''"><component :is="library.icon" :size="18" /></button></template>
        <section class="libraryPanel" role="dialog" :aria-label="library.label" @dblclick.stop @keydown.esc.capture.stop="libraryVisible = ''">
          <header><h3>{{ library.label }}</h3><el-button text :icon="IconX" :aria-label="`关闭${library.label}`" @click="libraryVisible = ''" /></header>
          <slot :name="library.id" />
        </section>
      </el-popover>
      <canvasAppearance />
    </div>
  </panel>
</template>

<script setup lang="ts">
import { textNodeIcon, imageNodeIcon, videoNodeIcon, audioNodeIcon } from "@toonflow/nodes-scaffold/nodeIcons";
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { Panel, useVueFlow } from "@vue-flow/core";
import { MiniMap } from "@vue-flow/minimap";
import { IconMap2, IconMagnet, IconLayoutGrid, IconPointer, IconHandStop, IconArrowBackUp, IconArrowForwardUp, IconCube3dSphere, IconRoute, IconFolders, IconBook, IconX } from "@tabler/icons-vue";
import { ElMessage } from "element-plus";
import { arrangeCanvas } from "../arrangeCanvas";
import canvasAppearance from "./canvasAppearance.vue";

const props = defineProps<{
  canvasId: string;
  remoteNodes: { type: string; label: string }[];
  canUndo: boolean;
  canRedo: boolean;
  assetsInteractionActive?: boolean;
  directory: string | undefined;
  batchHistory: (action: () => Promise<void>) => Promise<void>;
}>();
const emit = defineEmits<{ undo: []; redo: []; addNode: [type: string] }>();
const selectedTool = defineModel<'move' | 'hand'>('selectedTool', { default: 'move' });
const libraryVisible = defineModel<"assets" | "prompts" | "">("libraryVisible", { default: "" });
const libraries = [{ id: "assets", label: "资产库", icon: IconFolders }, { id: "prompts", label: "提示词库", icon: IconBook }] as const;
function updateLibraryVisibility(id: "assets" | "prompts", visible: boolean) {
  if (visible) libraryVisible.value = id;
  // 素材预览和操作菜单挂在 body 下，不能把它们的点击当作离开资产库。
  else if (libraryVisible.value === id && !(id === "assets" && props.assetsInteractionActive)) libraryVisible.value = "";
}
const quickNodes = [
  { type: 'remote-textNode', label: '添加文本节点', icon: textNodeIcon },
  { type: 'remote-imageNode', label: '添加图片节点', icon: imageNodeIcon },
  { type: 'remote-videoNode', label: '添加视频节点', icon: videoNodeIcon },
  { type: 'remote-audioNode', label: '添加音频节点', icon: audioNodeIcon },
];
const snapEnabled = defineModel<boolean>("snapEnabled", { required: true });
const showEdges = defineModel<boolean>("showEdges", { required: true });
const showMap = ref(false);
const zoomMenuVisible = ref(false);
const viewControlsRef = ref<HTMLElement>();
const creationToolsRef = ref<HTMLElement>();
const controlsSize = reactive({ width: 356, height: 44, toolsWidth: 456, toolsHeight: 50 });
watch([viewControlsRef, creationToolsRef], ([controls, tools], _, onCleanup) => {
  if (!controls || !tools) return;
  const observer = new ResizeObserver(() => {
    controlsSize.width = controls.scrollWidth;
    controlsSize.height = controls.offsetHeight;
    controlsSize.toolsWidth = tools.scrollWidth;
    controlsSize.toolsHeight = tools.offsetHeight;
  });
  observer.observe(controls);
  observer.observe(tools);
  onCleanup(() => observer.disconnect());
}, { flush: "post" });
const flow = useVueFlow();
// ACT: 按真实控件宽度避让，兼容字体调整、浏览器缩放和左右侧栏伸缩。
const stackTools = computed(() => flow.dimensions.value.width < controlsSize.width * 2 + controlsSize.toolsWidth + 64);
const dockHeight = computed(() => stackTools.value ? controlsSize.height + controlsSize.toolsHeight + 28 : Math.max(controlsSize.height, controlsSize.toolsHeight) + 15);
const { viewport, zoomTo, fitView, getNodes } = flow;
const zoomPercent = computed(() => Math.round(viewport.value.zoom * 100));
const arranging = ref(false);
let arrangeController: AbortController | undefined;
const canArrange = computed(() => {
  const nodes = getNodes.value.filter((node) => !node.parentNode);
  return (
    !!props.canvasId &&
    !!props.directory &&
    !arranging.value &&
    nodes.length > 0 &&
    nodes.every((node) => node.dimensions.width > 0 && node.dimensions.height > 0)
  );
});
defineExpose({ arrangeNodes });

watch(
  () => [props.canvasId, props.directory],
  () => {
    arrangeController?.abort();
  },
  { flush: "sync" }
);
onBeforeUnmount(() => arrangeController?.abort());


function applyZoom(value: number | undefined) {
  if (value !== undefined && Number.isFinite(value)) void zoomTo(value / 100);
}

function fitCanvasView() {
  const bounds = flow.vueFlowRef.value?.getBoundingClientRect();
  // 为实际工具栏高度留出空间，避免节点的播放等操作被浮层遮住。
  const reserved = Math.max(64, ...[viewControlsRef.value, creationToolsRef.value].map(element =>
    bounds && element ? bounds.bottom - element.getBoundingClientRect().top : 0
  ));
  void fitView({ padding: { top: "32px", left: "32px", right: "32px", bottom: `${reserved + 16}px` }, duration: 0 });
  zoomMenuVisible.value = false;
}

async function arrangeNodes() {
  if (!canArrange.value) return;
  const controller = new AbortController();
  arrangeController = controller;
  arranging.value = true;
  try {
    await props.batchHistory(async () => {
      // 整理统一进入画布历史，可通过工具栏或快捷键撤销。
      await arrangeCanvas(flow, controller.signal);
      controller.signal.throwIfAborted();
    });
  } catch (error) {
    if (!controller.signal.aborted) ElMessage.error(error instanceof Error ? error.message : "整理画布失败");
  } finally {
    arrangeController = undefined;
    arranging.value = false;
  }
}

</script>

<style lang="scss" scoped>
.viewControls, .creationTools {
  display: flex; align-items: center;
  button { display: inline-flex; justify-content: center; align-items: center; width: 32px; height: 32px; flex-shrink: 0; padding: 0; border: 0; border-radius: calc(var(--ui-radius, 8px) * 0.75); background: none; color: var(--el-text-color-regular); cursor: pointer; font: inherit; &:hover, &.active { background: var(--el-fill-color); color: var(--el-text-color-primary); } &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; } &:disabled { opacity: .35; cursor: not-allowed; } }
}
.viewControlsPanel.vue-flow__panel { margin: 0; left: 12px; bottom: max(15px, env(safe-area-inset-bottom)); max-width: calc(100% - 24px); }
.canvasMiniMap.vue-flow__minimap { max-width: calc(100% - 24px); max-height: min(160px, 25dvh); }
.viewControls {
  gap: clamp(2px, .6cqw, 8px); padding: 4px; max-width: 100%; background: var(--el-bg-color); border-radius: var(--ui-radius, 8px);
  button { width: 36px; height: 36px; }
  .zoomSlider {
    appearance: none; width: 84px; min-width: 24px; height: 36px; margin: 0; padding: 0; border: 0; background: transparent; cursor: pointer;
    &::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: var(--el-border-color-darker); }
    &::-moz-range-track { height: 4px; border-radius: 2px; background: var(--el-border-color-darker); }
    &::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; margin-top: -5px; border: 2px solid var(--el-text-color-primary); border-radius: 50%; background: var(--el-bg-color-overlay); }
    &::-moz-range-thumb { box-sizing: border-box; width: 14px; height: 14px; border: 2px solid var(--el-text-color-primary); border-radius: 50%; background: var(--el-bg-color-overlay); }
    &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; border-radius: 4px; }
  }
  .zoomValue { width: 60px; font-size: 16px; font-weight: 500; font-variant-numeric: tabular-nums; color: var(--el-text-color-primary); }
}
.creationToolsPanel.vue-flow__panel { width: max-content; max-width: calc(100% - 24px); margin: 0; }
.creationTools { max-width: 100%; overflow-x: auto; scrollbar-width: thin; gap: 3px; padding: 7px; background: var(--el-bg-color-overlay); border: 1px solid var(--el-border-color); border-radius: var(--ui-radius-large, 12px); .toolDivider { flex-shrink: 0; height: 20px; width: 1px; margin: 0 4px; background: var(--el-border-color); } }
.zoomMenu {
  display: flex; flex-direction: column; gap: 8px;
  .zoomInput { display: flex; align-items: center; gap: 8px; color: var(--el-text-color-regular); .el-input-number { flex: 1; min-width: 0; } }
  .el-button { margin: 0; }
}
.libraryPanel {
  max-height: calc(100dvh - 180px); overflow: auto; scrollbar-width: thin;
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; h3 { margin: 0; font-size: 14px; font-weight: 600; color: var(--el-text-color-primary); } .el-button { width: 28px; height: 28px; padding: 0; } }
  :deep(.assetLibrary) { width: 100%; max-height: none; border: 0; background: transparent; .el-card__body { padding: 0 !important; } .libraryToolbar .toolbarButton:last-child { display: none; } }
}
@media (pointer: coarse) { .creationTools button, .viewControls button { min-width: 44px; height: 44px; } }
</style>

<style lang="scss">
.canvasLibraryPopover.el-popover { max-width: calc(100vw - 24px); padding: 14px; border-radius: var(--ui-radius-large, 12px); }
</style>
