<template>
  <el-dialog v-model="visible" title="设置" class="settingsDialog" width="min(1080px, calc(100vw - 24px))" alignCenter appendToBody>
    <div class="settings">
      <aside class="sidebar" aria-label="设置分类">
        <template v-for="item in sidebarPanels" :key="item.id">
          <button class="settingsItem" type="button" :aria-label="item.id === 'about' && hasDesktopUpdate ? `${item.label}，有新版本可用` : item.label" :aria-pressed="activePanel.id === item.id" @click="activePanel = item">
            <el-badge class="panelIcon" isDot :hidden="item.id !== 'about' || !hasDesktopUpdate">
              <component :is="item.icon" :size="18" aria-hidden="true" />
            </el-badge>
            <span>{{ item.label }}</span>
          </button>
        </template>
      </aside>
      <section class="content" :aria-label="activePanel.label" tabindex="0">
        <h2 class="panelTitle">{{ activePanel.label }}</h2>
        <div class="panelContent">
          <panelStatus v-if="panelError" :error="panelError" />
          <keep-alive v-else include="personalization">
            <component
              :is="activePanel.component"
              v-bind="['pluginMarket', 'personalization'].includes(activePanel.id) ? { visible } : {}" />
          </keep-alive>
        </div>
      </section>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { defineAsyncComponent, onErrorCaptured, shallowRef, watch, type AsyncComponentLoader } from "vue";
import { hasDesktopUpdate } from "@/stores/desktopUpdate";
import panelStatus from "./panelStatus.vue";
import {
  IconPalette,
  IconSettings,
  IconBuildingStore,
  IconInfoCircle,
  IconUserCog,
  IconServer,
} from "@tabler/icons-vue";

function loadPanel(loader: AsyncComponentLoader) {
  return defineAsyncComponent({ loader, loadingComponent: panelStatus, errorComponent: panelStatus, delay: 150, timeout: 15000 });
}
const settingsPanels = [
  { id: "ui", label: "界面设置", icon: IconPalette, component: loadPanel(() => import("./panels/ui.vue")) },
  { id: "general", label: "画布设置", icon: IconSettings, component: loadPanel(() => import("./panels/general/index.vue")) },
  { id: "mediaChannel", label: "模型配置", icon: IconServer, component: loadPanel(() => import("./panels/mediaChannel/index.vue")) },
  { id: "personalization", label: "创作偏好", icon: IconUserCog, component: loadPanel(() => import("./panels/personalization.vue")) },
  {
    id: "pluginMarket",
    label: "扩展管理",
    icon: IconBuildingStore,
    component: loadPanel(() => import("./panels/pluginMarket/index.vue")),
  },
  { id: "about", label: "关于零幕", icon: IconInfoCircle, component: loadPanel(() => import("./panels/about.vue")) },
];
const props = defineProps<{ initialPanel?: string }>();
const sidebarPanels = settingsPanels;
const activePanel = shallowRef(settingsPanels[0]!);
const panelError = shallowRef<Error>();
const visible = defineModel<boolean>({ default: false });
onErrorCaptured((error, _instance, info) => {
  // 加载错误由异步组件的状态页处理；渲染异常也要隔离，避免破坏整个设置对话框。
  if (info !== "async component loader") panelError.value = error instanceof Error ? error : new Error("设置内容显示失败");
  console.error("设置面板显示失败", activePanel.value.id, error instanceof Error ? error.message : info);
  return false;
});
watch(activePanel, () => { panelError.value = undefined; });
watch(() => [visible.value, props.initialPanel] as const, ([isOpen, panel]) => {
  if (isOpen && panel) activePanel.value = settingsPanels.find(item => item.id === panel) ?? settingsPanels[0]!;
}, { immediate: true });
</script>

<style lang="scss" scoped>
.settings {
  display: grid;
  grid-template-columns: minmax(152px, 10.5rem) minmax(0, 1fr);
  height: min(76vh, calc(100dvh - 124px));
  overflow: hidden;
  font-size: 14px;

  .sidebar {
    min-height: 0;
    overflow-y: auto;
    padding: 2px 12px 2px 2px;
    border-right: 1px solid var(--el-border-color-lighter);


    .settingsItem {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      min-height: 44px;
      padding: 10px 12px;
      margin-bottom: 4px;
      border: 0;
      border-radius: var(--el-border-radius-base);
      background: transparent;
      color: var(--el-text-color-regular);
      font: inherit;
      text-align: start;
      cursor: pointer;

      .panelIcon { display: inline-flex; flex-shrink: 0; }

      > span {
        min-width: 0;
        white-space: nowrap;
      }

      &:hover {
        background: var(--el-fill-color-light);
      }

      &[aria-pressed="true"] {
        background: var(--el-color-primary-light-9);
        color: var(--el-color-primary);
      }

      &:focus-visible {
        outline: 2px solid var(--el-color-primary);
      }
    }
  }

  .content {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    padding: 0 0 0 24px;
    overflow: hidden;

    .panelTitle {
      flex-shrink: 0;
      margin: 0 0 20px;
      font-size: 18px;
    }

    .panelContent {
      container-type: inline-size;
      flex: 1;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 3px 12px 20px 3px;
      scrollbar-width: thin;
      scrollbar-color: var(--el-border-color) transparent;

      :deep(.settingsDisclosure) {
        border-top: 1px solid var(--el-border-color-lighter);
        padding-top: 16px;
        > summary {
          padding: 4px 0;
          color: var(--el-text-color-primary);
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; }
        }
        &[open] > summary { margin-bottom: 16px; }
      }

    }
  }

  @media (max-width: 700px) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    gap: 20px;
    height: calc(100dvh - 124px);

    .sidebar {

      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 4px;
      padding: 2px 2px 12px;
      border-right: 0;
      border-bottom: 1px solid var(--el-border-color-lighter);
      .settingsItem {
        justify-content: center;
        gap: 6px;
        padding: 8px 4px;
        margin: 0;
        font-size: 13px;
        > span { white-space: normal; overflow-wrap: anywhere; }
        .panelIcon { display: none; }
      }
    }

    .content {
      padding: 0;
      .panelTitle { font-size: 17px; margin-bottom: 16px; }
      .panelContent { padding-right: 5px; }
    }
  }
  @media (max-width: 700px) and (max-height: 520px) {
    gap: 12px;
    .sidebar { display: flex; overflow-x: auto; flex-shrink: 0; padding-bottom: 8px; .settingsItem { flex: 0 0 auto; width: auto; align-self: start; } }
    .content .panelTitle { margin-bottom: 8px; }
  }
}
</style>

<style lang="scss">
 .settingsDialog,.channelSettingsPicker,.channelSettingsPopper {
  color: var(--el-text-color-primary);
  .el-input__wrapper,.el-select__wrapper { background: var(--el-fill-color-blank); }
}
.settingsDialog.el-dialog {
  --el-text-color-secondary: #686c73;
  --el-text-color-placeholder: #767a82;
  --el-color-info: var(--el-text-color-secondary);
  padding: 24px;
  border-radius: var(--ui-radius-large, 12px);
  background: var(--el-bg-color);
  .el-dialog__header { padding-bottom: 24px; }
}
.dark .settingsDialog.el-dialog { --el-text-color-secondary: #a8abb2; --el-text-color-placeholder: #9ca0a8; }
.channelSettingsPicker.el-dialog { background: var(--el-bg-color); border: 1px solid var(--el-border-color); border-radius: var(--ui-radius-large, 12px); }
@media (max-width: 700px) { .settingsDialog.el-dialog { padding: 16px; .el-dialog__header { padding-bottom: 16px; } } }
</style>
