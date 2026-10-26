<template>
  <div class="canvasPreview">
    <vue-flow
      :nodes="previewNodes"
      :edges="previewEdges"
      :nodesDraggable="false"
      :nodesConnectable="false"
      :elementsSelectable="false"
      :edgesFocusable="false"
      :edgesUpdatable="false"
      :nodesFocusable="false"
      :zoomOnScroll="true"
      :zoomOnDoubleClick="false"
      :panOnDrag="true"
      :fitViewOnInit="true"
      :minZoom="0.08"
      :maxZoom="2">
      <template #node-previewNode="{ data }">
        <article class="previewNode">
          <handle type="target" :position="Position.Left" />
          <span class="nodeType">{{ data.typeLabel }}</span>
          <strong>{{ data.label }}</strong>
          <handle type="source" :position="Position.Right" />
        </article>
      </template>
      <background :variant="BackgroundVariant.Dots" :gap="32" patternColor="var(--el-border-color-lighter)" />
      <mini-map class="previewMiniMap" position="bottom-right" :pannable="true" :zoomable="true" nodeColor="var(--el-fill-color-dark)" maskColor="var(--el-mask-color-extra-light)" />
    </vue-flow>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Handle, Position, VueFlow } from "@vue-flow/core";
import { Background, BackgroundVariant } from "@vue-flow/background";
import { MiniMap } from "@vue-flow/minimap";
import type { CanvasDocument } from "./canvasTransfer";

const props = defineProps<{ canvasDocument: CanvasDocument }>();
const previewNodes = computed(() => props.canvasDocument.nodes.map(node => {
  const data = node.data && typeof node.data === "object" && !Array.isArray(node.data) ? node.data as Record<string, unknown> : {};
  const typeLabel = (node.type ?? "node").replace(/^remote-/, "").replace(/Node$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
  return {
    id: node.id,
    type: "previewNode",
    position: node.position,
    data: {
      label: typeof data.label === "string" && data.label.trim() ? data.label : typeLabel,
      typeLabel,
    },
  };
}));
const previewEdges = computed(() => props.canvasDocument.edges.map(edge => ({
  id: edge.id,
  source: edge.source,
  target: edge.target,
  type: "default",
})));
</script>

<style scoped lang="scss">
.canvasPreview {
  width: 100%;
  height: min(70vh, 720px);
  min-height: 360px;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-bg-color-page);

  .previewNode {
    position: relative;
    display: flex;
    width: 208px;
    min-height: 76px;
    flex-direction: column;
    justify-content: center;
    gap: 6px;
    padding: 11px 14px;
    overflow-wrap: anywhere;
    border: 1px solid var(--el-border-color);
    border-radius: 9px;
    background: var(--el-bg-color-overlay);
    box-shadow: 0 4px 14px rgb(0 0 0 / 10%);

    .nodeType {
      color: var(--el-text-color-secondary);
      font-size: 11px;
      line-height: 1.3;
    }

    strong {
      color: var(--el-text-color-primary);
      font-size: 13px;
      line-height: 1.45;
      font-weight: 600;
    }

    :deep(.vue-flow__handle) {
      width: 7px;
      height: 7px;
      border: 1px solid var(--el-bg-color-overlay);
      background: var(--el-color-primary);
    }
  }

  .previewMiniMap.vue-flow__minimap {
    max-width: calc(100% - 24px);
    max-height: min(150px, 24vh);
  }
}
</style>
