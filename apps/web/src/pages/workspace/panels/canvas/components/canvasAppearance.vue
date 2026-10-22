<template>
  <el-popover v-model:visible="visible" trigger="click" placement="top-end" :width="248" :showArrow="false" popperClass="canvasAppearancePopover"
    :popperOptions="{ strategy: 'fixed', modifiers: [{ name: 'preventOverflow', options: { rootBoundary: 'viewport', tether: false, altAxis: true, padding: 12 } }] }">
    <template #reference>
      <button class="appearanceTrigger" :class="{ active: visible }" type="button" aria-label="画布外观" title="画布外观" :aria-expanded="visible" aria-haspopup="dialog" @keydown.esc.stop="visible = false"><icon-palette :size="18" /></button>
    </template>
    <section class="appearancePanel" role="dialog" aria-label="画布外观" :aria-busy="saving" @keydown.esc.stop="visible = false">
      <h3>画布外观</h3>
      <fieldset :disabled="saving">
        <legend>主题模式</legend>
        <div class="choices">
          <button v-for="item in themes" :key="item.value" type="button" :aria-pressed="uiSettings.theme === item.value" @click="saveAppearance({ theme: item.value })"><component :is="item.icon" :size="16" />{{ item.label }}</button>
        </div>
      </fieldset>
      <fieldset :disabled="saving">
        <legend>网格样式</legend>
        <div class="choices">
          <button v-for="item in grids" :key="item.value" type="button" :aria-pressed="canvasAppearance.grid === item.value" @click="saveAppearance({ grid: item.value })"><component :is="item.icon" :size="16" />{{ item.label }}</button>
        </div>
      </fieldset>
      <div class="infoRow"><span><icon-info-circle :size="15" />图片信息</span><el-switch :modelValue="canvasAppearance.imageInfo" size="small" aria-label="图片信息" :disabled="saving" @change="saveAppearance({ imageInfo: $event === true })" /></div>
      <p v-if="saveError" class="saveError" role="alert">{{ saveError }}</p>
    </section>
  </el-popover>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { IconPalette, IconSun, IconMoon, IconCircleDot, IconGrid4x4, IconSquare, IconInfoCircle } from "@tabler/icons-vue";
import { canvasAppearance, saveSettings, uiSettings } from "@/stores/settings";

const visible = ref(false);
const saving = ref(false);
const saveError = ref("");
const themes = [{ value: "light", label: "浅色", icon: IconSun }, { value: "dark", label: "深色", icon: IconMoon }] as const;
const grids = [{ value: "dots", label: "点", icon: IconCircleDot }, { value: "lines", label: "线", icon: IconGrid4x4 }, { value: "blank", label: "空白", icon: IconSquare }] as const;

async function saveAppearance(patch: { theme?: "light" | "dark"; grid?: "dots" | "lines" | "blank"; imageInfo?: boolean }) {
  if (saving.value) return;
  saving.value = true;
  saveError.value = "";
  try {
    await saveSettings(current => {
      if (patch.theme) return { homeTheme: patch.theme };
      const raw = current.canvasAppearance;
      const existing = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      return { canvasAppearance: { ...existing, ...patch } };
    });
  } catch {
    saveError.value = "保存失败，请重试。";
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped lang="scss">
.appearanceTrigger {
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  width: 32px; height: 32px; padding: 0; border: 0; border-radius: calc(var(--ui-radius, 8px) * .75);
  color: var(--el-text-color-regular); background: transparent; cursor: pointer;
  &:hover, &.active { color: var(--el-text-color-primary); background: var(--el-fill-color); }
  &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
  @media (pointer: coarse) { min-width: 44px; height: 44px; }
}
.appearancePanel {
  color: var(--el-text-color-regular); font-size: 13px;
  h3 { margin: 0 0 14px; font-size: 14px; font-weight: 600; color: var(--el-text-color-primary); }
  fieldset { min-width: 0; padding: 0; margin: 0 0 16px; border: 0; }
  legend { padding: 0; margin-bottom: 7px; font-size: 12px; }
  .choices {
    display: flex; gap: 3px; padding: 3px; border-radius: var(--ui-radius, 8px); background: var(--el-fill-color-light);
    button {
      display: flex; align-items: center; justify-content: center; gap: 6px; flex: 1; min-width: 0; height: 34px; padding: 0 4px;
      border: 0; border-radius: calc(var(--ui-radius, 8px) * .75); font: inherit; color: inherit; background: transparent; cursor: pointer;
      &[aria-pressed="true"] { color: var(--el-text-color-primary); background: var(--el-fill-color-darker); }
      &:hover { background: var(--el-fill-color); }
      &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 1px; }
      &:disabled { cursor: wait; opacity: .65; }
    }
  }
  .infoRow { display: flex; justify-content: space-between; align-items: center; min-height: 24px; span { display: flex; align-items: center; gap: 6px; font-size: 12px; } }
  .saveError { margin: 10px 0 0; color: var(--el-color-danger); font-size: 12px; }
}
</style>

<style lang="scss">
.canvasAppearancePopover.el-popover { max-width: calc(100vw - 24px); padding: 14px; border-radius: var(--ui-radius-large, 12px); }
</style>
