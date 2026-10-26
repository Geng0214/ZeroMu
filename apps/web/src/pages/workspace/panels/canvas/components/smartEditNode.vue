<template>
  <section class="smartEditNode" :class="{ selected }">
    <header class="nodeHeader">
      <icon-player-play :size="14" aria-hidden="true" />
      <span>{{ data.label || "智能剪辑" }}</span>
    </header>
    <div class="nodeBody">
      <div class="previewFrame">
        <video
          v-if="activeSource && sourceUrls[activeSource.id]"
          :key="activeSource.id"
          :src="sourceUrls[activeSource.id]"
          muted
          playsinline
          preload="metadata"
          aria-label="智能剪辑预览"
          @loadedmetadata="setDuration(activeSource.id, $event)" />
        <span v-else class="emptyPreview">{{ activeSource ? "正在载入视频…" : "连接视频节点以开始剪辑" }}</span>
        <button class="openEditor" type="button" @pointerdown.stop @mousedown.stop @click.stop="production.openSmartEdit()">
          <icon-scissors :size="24" aria-hidden="true" />
          <span>打开智能剪辑</span>
        </button>
      </div>
      <div class="timelinePreview" aria-label="时间轴预览">
        <div class="timeRuler" aria-hidden="true">
          <span v-for="tick in timelineTicks" :key="tick">{{ formatTime(tick) }}</span>
        </div>
        <div v-for="source in videoSources" :key="source.id" class="trackRow" :title="source.label">
          <span class="trackName">{{ source.label }}</span>
          <button class="clipStrip" type="button" :aria-label="`预览 ${source.label}`" :aria-pressed="activeSource?.id === source.id" @click.stop="activeSourceId = source.id">
            <video v-if="sourceUrls[source.id]" :src="sourceUrls[source.id]" muted playsinline preload="metadata" tabindex="-1" />
            <span v-else class="emptyTrack" />
          </button>
        </div>
      </div>
    </div>
    <handle id="video" type="target" :position="Position.Left" :isValidConnection="validateConnection" aria-label="视频输入">
      <icon-circle-dashed :size="16" aria-hidden="true" />
    </handle>
  </section>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import { Handle, Position, useVueFlow, type NodeProps } from "@vue-flow/core";
import { IconCircleDashed, IconPlayerPlay, IconScissors } from "@tabler/icons-vue";
import { useNodeInputs } from "@toonflow/nodes-scaffold/nodeInputs";
import { validateConnection, type NodeHandle } from "@toonflow/nodes-scaffold/connection";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { useProductionStore } from "@/stores/production";
import { useWorkspaceStore } from "@/stores/workspace";

type VideoSource = { id: string; source: string; sourceHandle: string; label: string; url: string; mimeType: string };

const props = defineProps<NodeProps>();
const { findNode } = useVueFlow();
const inputs = useNodeInputs();
const workspace = useWorkspaceStore();
const files = useWorkspaceFiles(() => workspace.project?.directory);
const production = useProductionStore();
const id = props.id;
const data = props.data as typeof props.data & { label?: string; handles?: NodeHandle[] };
const videoSources = computed<VideoSource[]>(() => inputs.getTargetValues(id, "video").flatMap(input => {
  const value = input.value;
  if (!value || typeof value !== "object" || !("url" in value) || typeof value.url !== "string" || !value.url.trim()
    || !("mimeType" in value) || typeof value.mimeType !== "string" || !value.mimeType.startsWith("video/")) return [];
  return [{
    id: `${input.source}:${input.sourceHandle}`,
    source: input.source,
    sourceHandle: input.sourceHandle,
    label: String(findNode(input.source)?.data.label || "视频"),
    url: value.url,
    mimeType: value.mimeType,
  }];
}).slice(0, 64));
const sourceUrls = ref<Record<string, string>>({});
const sourceDurations = ref<Record<string, number>>({});
const activeSourceId = ref("");
const activeSource = computed(() => videoSources.value.find(source => source.id === activeSourceId.value) ?? videoSources.value[0]);
const selected = computed(() => props.selected === true);
const totalDuration = computed(() => videoSources.value.reduce((sum, source) => sum + (sourceDurations.value[source.id] || 0), 0));
const timelineTicks = computed(() => {
  const duration = totalDuration.value || 8;
  return Array.from({ length: 7 }, (_, index) => duration * index / 6);
});

watch(videoSources, (sources, _previous, onCleanup) => {
  let cancelled = false;
  onCleanup(() => { cancelled = true; });
  if (!sources.some(source => source.id === activeSourceId.value)) activeSourceId.value = sources[0]?.id ?? "";
  sourceUrls.value = {};
  sourceDurations.value = {};
  void Promise.all(sources.map(async source => {
    try {
      const url = /^(https?:|blob:|data:|\/)/i.test(source.url) ? source.url : await files.previewUrl(source.url, source.mimeType);
      if (!cancelled) sourceUrls.value[source.id] = url;
    } catch { /* 媒体预览失败时保留可连接的时间轴入口。 */ }
  }));
}, { immediate: true });

function setDuration(sourceId: string, event: Event) {
  const duration = (event.target as HTMLVideoElement).duration;
  if (Number.isFinite(duration) && duration > 0) sourceDurations.value[sourceId] = duration;
}
function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
onScopeDispose(() => { sourceUrls.value = {}; });
</script>

<style scoped lang="scss">
.smartEditNode {
  position: relative;
  width: 510px;
  color: var(--el-text-color-primary);

  .nodeHeader {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 4px 6px;
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }

  .nodeBody {
    padding: 7px;
    border: 1px solid var(--el-border-color);
    border-radius: 8px;
    background: var(--el-bg-color-overlay);
    box-shadow: 0 2px 8px rgb(0 0 0 / 22%);
  }

  .previewFrame {
    position: relative;
    display: grid;
    aspect-ratio: 16 / 9;
    place-items: center;
    overflow: hidden;
    border-radius: 6px;
    background: #080b0e;

    > video {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
  }

  .emptyPreview {
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }

  .openEditor {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 8px;
    border: 0;
    background: rgb(0 0 0 / 16%);
    color: #fff;
    cursor: pointer;
    font: inherit;
    font-size: 13px;

    span {
      padding: 6px 10px;
      border-radius: 5px;
      background: var(--el-color-primary);
      color: var(--el-color-white);
    }

    &:hover span { filter: brightness(1.08); }
    &:focus-visible { outline: 2px solid var(--el-color-primary-light-3); outline-offset: -3px; }
  }

  .timelinePreview {
    padding: 6px 4px 0;
  }

  .timeRuler {
    display: flex;
    justify-content: space-between;
    margin-left: 74px;
    color: var(--el-text-color-secondary);
    font-size: 9px;
  }

  .trackRow {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 21px;
    margin-top: 4px;
  }

  .trackName {
    width: 66px;
    overflow: hidden;
    color: var(--el-text-color-secondary);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .clipStrip {
    height: 17px;
    flex: 1;
    overflow: hidden;
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: #333;
    cursor: pointer;

    video {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: .72;
    }

    &[aria-pressed="true"] { outline: 1px solid var(--el-color-primary); }
    &:focus-visible { outline: 2px solid var(--el-color-primary-light-3); }
  }

  .emptyTrack { display: block; width: 100%; height: 100%; background: #292929; }

  :deep(.vue-flow__handle) {
    left: -8px;
    width: 16px;
    height: 16px;
    border: 0;
    background: transparent;
  }
}
</style>
