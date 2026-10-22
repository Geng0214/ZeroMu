<template>
  <g class="canvasEdge" :class="{ highlighted, focused: focused || selected }" :style="{ '--edgeStrokeScale': strokeScale }">
    <base-edge
      :id="id"
      :path="curve[0]"
      :label="label"
      :labelX="curve[1]"
      :labelY="curve[2]"
      :labelStyle="labelStyle"
      :labelShowBg="labelShowBg"
      :labelBgStyle="labelBgStyle"
      :labelBgPadding="labelBgPadding"
      :labelBgBorderRadius="labelBgBorderRadius"
      :markerStart="markerStart"
      :markerEnd="markerEnd"
      :interactionWidth="16 * strokeScale"
      :style="style" />
  </g>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { BaseEdge, getBezierPath, getSimpleBezierPath, useVueFlow, type EdgeProps } from "@vue-flow/core";

const props = defineProps<EdgeProps & { focused: boolean }>();
const { viewport } = useVueFlow();
// 平移不改变线宽，让无关连线跳过视口移动引起的组件更新。
const strokeScale = computed(() => 1 / viewport.value.zoom);
const curve = computed(() => props.type === "simple-bezier" ? getSimpleBezierPath(props) : getBezierPath(props));
const highlighted = computed(() => props.focused || props.selected || props.sourceNode.selected || props.sourceNode.dragging
  || props.targetNode.selected || props.targetNode.dragging);
</script>

<style lang="scss" scoped>
.canvasEdge {
  :deep(.vue-flow__edge-path) {
    // VueFlow 在外层 HTML 上缩放，SVG 的 non-scaling-stroke 无法抵消它。
    stroke-width: calc(1px * var(--edgeStrokeScale));
    stroke-dasharray: none;
    animation: none;
  }

  &.highlighted :deep(.vue-flow__edge-path) {
    stroke: var(--el-color-primary);
    stroke-width: calc(1.4px * var(--edgeStrokeScale));
  }

  &.focused :deep(.vue-flow__edge-path) {
    stroke-width: calc(1.6px * var(--edgeStrokeScale));
  }
}
</style>
