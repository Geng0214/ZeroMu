<template>
  <div class="nodeComposer">
    <teleport :to="expandedTarget || 'body'" :disabled="!expanded || !expandedTarget">
      <section class="composerBody nodrag nopan nowheel" :class="{ expandedComposer: expanded }" :aria-label="title"
        @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop @wheel.stop>
        <div class="composerHeader">
          <span v-if="referenceCount" class="referenceLabel">参考 <span>{{ referenceCount }}</span></span>
          <el-button class="expandButton" :icon="expanded ? IconMinimize : IconMaximize" text
            :title="expanded ? '收起创作面板' : '展开创作面板'" :aria-label="expanded ? '收起创作面板' : '展开创作面板'"
            @click="expanded = !expanded" />
        </div>
        <div v-if="referenceCount" class="composerReferences"><slot name="references" /></div>
        <div class="composerEditor"><slot :expanded="expanded" /></div>
        <div v-if="$slots.hint" class="composerHint" role="status"><slot name="hint" /></div>
        <div class="composerFooter"><slot name="footer" /></div>
      </section>
    </teleport>
    <el-dialog v-model="expanded" :title="title" width="min(960px, calc(100vw - 24px))" alignCenter appendToBody :closeOnClickModal="false">
      <div ref="expandedTarget" class="expandedTarget" />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { ElButton, ElDialog } from "element-plus";
import { IconMaximize, IconMinimize } from "@tabler/icons-vue";

defineProps<{ title: string; referenceCount: number }>();
const expanded = ref(false);
const expandedTarget = ref<HTMLElement>();
</script>

<style scoped lang="scss">
.composerBody {
  --reference-size: 60px;
  box-sizing: border-box;
  container-type: inline-size;
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: calc(var(--ui-radius, 8px) * 2);
  background: var(--el-bg-color-overlay);
  color: var(--el-text-color-primary);
  text-align: left;

  .composerHeader {
    display: flex;
    align-items: center;
    min-height: 28px;
    margin-bottom: 8px;
    .referenceLabel {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      color: var(--el-text-color-regular);
      font-size: 13px;
      span { color: var(--el-text-color-secondary); font-variant-numeric: tabular-nums; }
    }
    .expandButton { width: 28px; height: 28px; margin-left: auto; padding: 4px; color: var(--el-text-color-regular); }
  }
  .composerReferences { margin-bottom: 16px; }
  .composerEditor {
    min-height: 160px;
    :deep(.promptInputWrap) { margin: 0; }
    :deep(.el-textarea__inner) {
      min-height: 160px !important;
      padding: 0;
      border-radius: 0;
      box-shadow: none;
      background: transparent;
      font: inherit;
      line-height: 1.7;
      &::placeholder { color: var(--el-text-color-secondary); }
    }
    :deep(.promptInput) { --chat-text-placeholder: var(--el-text-color-secondary); --chat-box: transparent; }
  }
  .composerHint {
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 1.6;
    overflow-wrap: anywhere;
    :deep(p) { margin: 0 0 12px; }
    :deep(.errorText) { color: var(--el-color-danger); }
  }
  .composerFooter {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 12px;
    margin-top: 20px;
    :deep(.modelSelect) {
      width: 210px;
      max-width: calc(100% - 56px);
      min-width: 0;
      .el-select__wrapper { gap: 6px; padding: 6px; box-shadow: none; background: transparent; }
      .is-focused { box-shadow: 0 0 0 1px var(--el-color-primary) inset; }
    }
    :deep(.settingsButton) {
      height: 34px;
      max-width: 100%;
      margin: 0;
      padding: 6px 8px;
      font-size: 13px;
      > span { min-width: 0; gap: 6px; }
      > span > span:not(.ratioShape) { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    }
    :deep(.sendButton) {
      flex: 0 0 40px;
      width: 40px;
      height: 40px;
      margin: 0 0 0 auto;
      padding: 0;
      border-radius: calc(var(--ui-radius, 8px) * 1.5);
      --el-button-bg-color: var(--el-text-color-primary);
      --el-button-border-color: transparent;
      --el-button-text-color: var(--el-bg-color);
      --el-button-hover-bg-color: var(--el-text-color-regular);
      --el-button-hover-border-color: transparent;
      --el-button-hover-text-color: var(--el-bg-color);
      .el-icon { font-size: 21px; }
    }
    :deep(.el-button:focus-visible) { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
    @container (max-width: 420px) {
      :deep(.modelSelect) { width: calc(100% - 56px); order: 0; }
      :deep(.sendButton) { order: 1; }
      :deep(.settingsButton) { order: 2; }
    }
  }
  &.expandedComposer {
    border: 0;
    padding: 0;
    .composerEditor { min-height: min(42dvh, 400px); }
    .composerEditor :deep(.el-textarea__inner) { min-height: min(42dvh, 400px) !important; }
  }
}
</style>
