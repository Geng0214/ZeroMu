<template>
  <button type="button" class="taskButton" :title="label" :aria-label="label" :aria-expanded="center.visible" @click="center.open()">
    <icon-list-check :size="18" :strokeWidth="1.7" aria-hidden="true" />
    <span>任务</span><span v-if="center.runningCount" class="taskCount">{{ center.runningCount }}</span>
    <icon-alert-circle v-else-if="center.attentionCount || center.summaryError" :size="15" aria-label="有任务需要处理" />
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { IconListCheck, IconAlertCircle } from "@tabler/icons-vue";
import { useTaskCenterStore } from "@/stores/taskCenter";
const center = useTaskCenterStore();
const label = computed(() => `任务中心${center.runningCount ? `，${center.runningCount} 个进行中` : ""}${center.attentionCount ? `，${center.attentionCount} 个需要处理` : ""}${center.summaryError ? "，状态读取失败" : ""}`);
</script>

<style scoped lang="scss">
.taskButton {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; width: auto; min-height: 36px; padding: 0 10px;
  border: 1px solid var(--el-border-color-light); border-radius: var(--ui-radius, 8px); background: var(--el-bg-color-overlay); color: var(--el-text-color-primary); font: inherit; font-size: 12px; cursor: pointer;
  &:hover { background: var(--el-fill-color-light); }
  &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
  .taskCount { font-variant-numeric: tabular-nums; color: var(--el-color-primary); }
  @media (pointer: coarse) { min-height: 44px; }
}
</style>
