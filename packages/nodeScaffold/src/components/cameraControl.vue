<template>
  <el-popover v-model:visible="visible" trigger="click" placement="top" :width="320" :disabled="disabled" :showArrow="false">
    <template #reference>
      <el-button class="settingsButton" :type="settings.enabled ? 'primary' : 'default'" text :icon="IconCamera" :disabled="disabled" :aria-expanded="visible" aria-label="镜头参数">
        {{ settings.enabled ? '镜头已启用' : '镜头参数' }}
      </el-button>
    </template>
    <section class="cameraControl" aria-label="镜头参数" @keydown.stop @keydown.esc.stop.prevent="visible = false" @pointerdown.stop @dblclick.stop>
      <header><strong>镜头参数</strong><el-button text :icon="IconX" aria-label="关闭镜头参数" @click="visible = false" /></header>
      <fieldset :disabled="disabled">
        <label class="cameraToggle"><input type="checkbox" :checked="settings.enabled" @change="update('enabled', ($event.target as HTMLInputElement).checked)" />生成时加入镜头要求</label>
        <label>拍摄预设<select aria-label="拍摄预设" :value="presetId" @change="applyPreset(($event.target as HTMLSelectElement).value)"><option value="" disabled>选择预设或自定义参数</option><option v-for="preset in cameraPresets" :key="preset.id" :value="preset.id">{{ preset.label }}</option></select></label>
        <div class="cameraFields">
          <label v-for="field in fields" :key="field.key">{{ field.label }}<select :aria-label="field.label" :value="settings[field.key]" @change="update(field.key, ($event.target as HTMLSelectElement).value)"><option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
        </div>
      </fieldset>
      <p class="cameraHint">作为画面描述发送给模型，实际效果取决于模型。关闭后保留参数。</p>
      <details v-if="preview"><summary>查看附加提示词</summary><p class="cameraPreview">{{ preview }}</p></details>
    </section>
  </el-popover>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElButton, ElPopover } from "element-plus";
import { IconCamera, IconX } from "@tabler/icons-vue";
import { cameraFields, cameraPresets, cameraPrompt, cameraSettingsSchema, readCameraSettings, type CameraSettings } from "../cameraSettings";

const props = defineProps<{ video?: boolean; disabled?: boolean }>();
const model = defineModel<CameraSettings>();
const visible = ref(false);
const settings = computed(() => readCameraSettings(model.value));
const fields = computed(() => cameraFields.filter(field => props.video || field.key !== "motion"));
const preview = computed(() => cameraPrompt(settings.value, props.video));
const presetId = computed(() => settings.value.enabled ? cameraPresets.find(preset => fields.value.every(field => preset.settings[field.key] === settings.value[field.key]))?.id ?? "" : "");
function update(key: keyof CameraSettings, value: unknown) {
  if (!props.disabled) model.value = cameraSettingsSchema.parse({ ...settings.value, [key]: value });
}
function applyPreset(id: string) {
  const preset = cameraPresets.find(item => item.id === id);
  if (preset && !props.disabled) model.value = { ...preset.settings };
}
watch(() => props.disabled, disabled => { if (disabled) visible.value = false; });
</script>

<style scoped lang="scss">
.cameraControl {
  color: var(--el-text-color-primary);
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  fieldset {
    display: grid; gap: 12px; min-width: 0; margin: 0; padding: 0; border: 0;
    label { display: grid; gap: 6px; font-size: 13px; }
    select { width: 100%; min-width: 0; min-height: 36px; padding: 6px; border: 1px solid var(--el-border-color); border-radius: var(--ui-radius, 6px); background: var(--el-bg-color); color: inherit; font: inherit; }
    .cameraToggle { display: flex; align-items: center; gap: 8px; min-height: 36px; input { accent-color: var(--el-color-primary); } }
    .cameraFields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  }
  .cameraHint, .cameraPreview { font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
  .cameraHint { color: var(--el-text-color-secondary); }
  details { font-size: 12px; summary { cursor: pointer; padding: 6px 0; } }
  :focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
}
</style>
