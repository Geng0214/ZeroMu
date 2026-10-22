<template>
  <section class="canvasElements" @dblclick.stop aria-label="画布节点列表">
    <div class="listHeading"><span>画布元素 <b>{{ nodes.length }}</b></span><select v-model="kind" aria-label="筛选节点类型"><option value="all">全部类型</option><option value="text">文本</option><option value="image">图片</option><option value="video">视频</option><option value="audio">音频</option><option value="group">分组</option></select></div>
    <el-input v-model="query" :prefixIcon="IconSearch" placeholder="搜索节点" aria-label="搜索画布节点" clearable size="small" />
    <div class="nodeList">
      <button v-for="item in filteredNodes" :key="item.node.id" class="nodeRow" :class="{ selected: item.node.selected }" :aria-pressed="!!item.node.selected" :title="item.label" @click="focusNode(item.node.id)">
        <span class="nodeThumbnail"><img v-if="item.thumbnail" :src="item.thumbnail" alt="" loading="lazy" @error="failedImages.add(item.node.id)" /><component v-else :is="item.icon" :size="21" /></span>
        <span class="nodeCopy"><strong>{{ item.label }}</strong><small>{{ item.kindLabel }}</small></span>
        <span v-if="item.node.selected" class="selectionDot" aria-hidden="true"></span>
      </button>
      <p v-if="!filteredNodes.length" class="emptyList">{{ nodes.length ? '没有匹配的节点' : '画布还是空的' }}<span v-if="!nodes.length">从底部工具栏添加节点，或拖入素材。</span></p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { textNodeIcon, imageNodeIcon, videoNodeIcon, audioNodeIcon } from "@toonflow/nodes-scaffold/nodeIcons";
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { IconSearch, IconBoxMultiple } from "@tabler/icons-vue";
import useWorkspaceFiles from "@/lib/workspaceFiles";

const props = defineProps<{ flowId?: string; directory?: string }>();
const flow = useVueFlow(props.flowId);
const query = ref("");
const kind = ref("all");
const failedImages = reactive(new Set<string>());
const kinds = { text: { label: "文本", icon: textNodeIcon }, image: { label: "图片", icon: imageNodeIcon }, video: { label: "视频", icon: videoNodeIcon }, audio: { label: "音频", icon: audioNodeIcon }, group: { label: "分组", icon: IconBoxMultiple } };
const files = useWorkspaceFiles(() => props.directory);
const thumbnailUrls = ref<Record<string, string>>({});
const imageSources = computed(() => flow.getNodes.value.filter(node => !node.hidden && node.type?.toLowerCase().includes("image")).map(node => {
  const value = node.data.outputs?.image?.value;
  return { id: node.id, path: typeof value === "string" ? value : value?.url };
}).filter(item => typeof item.path === "string" && item.path));
watch([imageSources, () => props.directory], async ([sources], _previous, onCleanup) => {
  let cancelled = false;
  failedImages.clear();
  onCleanup(() => { cancelled = true; });
  const entries = await Promise.all(sources.map(async item => {
    if (/^(https?:|blob:|data:image\/)/i.test(item.path)) return [item.id, item.path];
    if (!props.directory) return [item.id, ""];
    const info = await files.mediaPreview(item.path).catch(() => undefined);
    return [item.id, info?.thumbnailUrl || ""];
  }));
  if (!cancelled) thumbnailUrls.value = Object.fromEntries(entries);
}, { immediate: true });
const nodes = computed(() => flow.getNodes.value.filter(node => !node.hidden).map(node => {
  const type = node.type?.toLowerCase() ?? "";
  const category = type.includes("image") ? "image" : type.includes("video") ? "video" : type.includes("audio") ? "audio" : type.includes("group") ? "group" : "text";
  const thumbnail = !failedImages.has(node.id) ? thumbnailUrls.value[node.id] : "";
  return { node, category, label: String(node.data.label || kinds[category].label), kindLabel: kinds[category].label + (type.includes("generation") ? "生成" : ""), icon: kinds[category].icon, thumbnail };
}));
const filteredNodes = computed(() => nodes.value.filter(item => (kind.value === "all" || item.category === kind.value) && item.label.toLowerCase().includes(query.value.trim().toLowerCase())));
async function focusNode(id: string) {
  const node = flow.findNode(id);
  if (!node) return;
  flow.removeSelectedElements();
  flow.addSelectedNodes([node]);
  flow.nodesSelectionActive.value = false;
  await nextTick();
  await flow.fitView({ nodes: [id], padding: .4, maxZoom: 1, duration: 180 });
}
</script>

<style scoped lang="scss">
.canvasElements {
  display: flex; flex-direction: column; gap: 10px; min-height: 0; color: var(--el-text-color-primary);
  .listHeading {
    display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--el-text-color-regular);
    b { margin-left: 5px; font-weight: 500; font-variant-numeric: tabular-nums; }
    select { max-width: 100px; padding: 4px; border: 0; border-radius: var(--ui-radius, 8px); color: inherit; background: var(--el-bg-color-overlay); font: inherit; &:focus-visible { outline: 2px solid var(--el-color-primary); } }
  }
  .nodeList { max-height: min(320px, 40dvh); min-height: 0; overflow: auto; scrollbar-width: thin; scrollbar-color: var(--el-border-color) transparent; }
  .nodeRow {
    display: flex; align-items: center; gap: 9px; width: 100%; margin-bottom: 4px; padding: 8px; border: 1px solid transparent; border-radius: var(--ui-radius, 8px);
    color: inherit; background: transparent; font: inherit; text-align: left; cursor: pointer;
    &:hover { background: var(--el-fill-color-light); }
    &.selected { background: var(--el-fill-color-light); border-color: var(--el-border-color); }
    &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
    .nodeThumbnail { display: grid; place-items: center; flex-shrink: 0; width: 36px; height: 40px; background: var(--el-fill-color-light); border-radius: var(--ui-radius, 8px); color: var(--el-text-color-regular); img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; } }
    .nodeCopy { flex: 1; min-width: 0; display: grid; gap: 4px; strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 500; } small { color: var(--el-text-color-regular); font-size: 11px; } }
    .selectionDot { flex-shrink: 0; width: 5px; height: 5px; border-radius: 50%; background: var(--el-color-primary); }
  }
  .emptyList { margin: 0; padding: 24px 12px; text-align: center; font-size: 12px; color: var(--el-text-color-regular); line-height: 1.8; span { display: block; margin-top: 8px; } }
}
</style>
