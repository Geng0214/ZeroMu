<template>
  <div class="general">
    <section class="settingSection" aria-labelledby="canvasCompositingTitle">
      <div class="settingHeader">
        <div class="settingInfo">
          <h3 id="canvasCompositingTitle">画布合成优化</h3>
          <p class="description">提升大量节点时的平移、缩放流畅度；可能增加显存占用或使文字变模糊。</p>
        </div>
        <el-switch
          :modelValue="generalSettings.canvasCompositingEnabled"
          aria-label="画布合成优化"
          @change="(value) => updateGeneralSettings({ canvasCompositingEnabled: value === true })" />
      </div>
    </section>
    <details class="settingsDisclosure">
      <summary>快捷键与手势</summary>
      <canvasShortcuts />
    </details>
  </div>
</template>

<script setup lang="ts">
import { generalSettings, updateGeneralSettings } from "@/stores/settings";
import canvasShortcuts from "./canvasShortcuts.vue";
</script>

<style lang="scss" scoped>
.general {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 0 4px 8px;

  .settingSection {
    .settingHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;

      > .el-switch { flex-shrink: 0; }

      .settingInfo {
        min-width: 0;

        h3 {
          margin: 0;
          color: var(--el-text-color-primary);
          font-size: 14px;
          font-weight: 600;
        }

        .description {
          margin: 6px 0 0;
          color: var(--el-text-color-secondary);
          font-size: 12px;
          line-height: 1.6;
        }
      }
    }
  }

}
</style>
