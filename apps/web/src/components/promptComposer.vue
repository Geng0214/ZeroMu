<template>
  <form class="promptComposer" @submit.prevent="usePrompt">
    <div v-if="error" ref="errorBox" class="promptError" role="alert" tabindex="-1"><strong>{{ error }}</strong><button v-for="key in missing" :key="key" type="button" @click="focusVariable(key)">填写{{ definition.variables.find(variable => variable.key === key)?.label || key }}</button></div>
    <fieldset v-if="definition.variables.length" :disabled="disabled"><legend>填入本次内容</legend><p class="promptHint">只填充文字；不会执行生成或更改已保存的默认值。</p><label v-for="variable in definition.variables" :key="variable.key" :for="`${fieldId}${variable.key}`">{{ variable.label }}<span v-if="variable.required"> · 必填</span><textarea :id="`${fieldId}${variable.key}`" v-model="values[variable.key]" :aria-label="variable.label" :aria-required="variable.required" :aria-invalid="missing.includes(variable.key)" :aria-describedby="missing.includes(variable.key) ? `${fieldId}${variable.key}Error` : undefined" rows="2" maxlength="10000" /><span v-if="missing.includes(variable.key)" :id="`${fieldId}${variable.key}Error`" class="promptError">请填写{{ variable.label }}</span></label></fieldset>
    <details v-if="definition.variables.length" class="promptSource"><summary>查看提示词模板</summary><p>{{ definition.text }}</p></details>
    <p class="previewLabel">{{ definition.variables.length ? '填充预览' : '提示词内容' }}</p>
    <p class="promptPreview" tabindex="0" aria-label="提示词预览">{{ preview.text }}</p>
    <p v-if="preview.error" class="promptError">{{ preview.error }}</p>
    <p v-if="copied" class="promptHint" role="status">提示词已复制</p>
    <div class="promptActions"><button type="button" :disabled="disabled" @click="copyPrompt">复制提示词</button><button v-if="actionLabel" class="primaryAction" type="submit" :disabled="disabled">{{ actionLabel }}</button></div>
  </form>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import { fillPrompt, type PromptDefinition } from "@toonflow/server/promptLibrary";
const props = defineProps<{ definition: PromptDefinition; actionLabel?: string; disabled?: boolean }>();
const emit = defineEmits<{ usePrompt: [text: string] }>();
const fieldId = useId(); const values = ref<Record<string, string>>({}); const error = ref(""); const missing = ref<string[]>([]); const copied = ref(false); const errorBox = ref<HTMLElement>();
watch(() => JSON.stringify(props.definition), () => { values.value = Object.fromEntries(props.definition.variables.map(variable => [variable.key, variable.defaultValue])); error.value = ""; missing.value = []; copied.value = false; }, { immediate: true });
watch(values, () => { copied.value = false; if (missing.value.length) { missing.value = preview.value.missing; if (!missing.value.length && !preview.value.error) error.value = ""; } }, { deep: true });
const preview = computed(() => { try { return { ...fillPrompt(props.definition, values.value), error: "" }; } catch (cause) { return { text: props.definition.text, missing: [], error: cause instanceof Error ? cause.message : "变量内容无效" }; } });
function focusVariable(key: string) { document.getElementById(`${fieldId}${key}`)?.focus(); }
async function validated() {
  missing.value = preview.value.missing; error.value = preview.value.error || (missing.value.length ? "请填写必填变量，再使用提示词" : "");
  if (error.value) { await nextTick(); errorBox.value?.focus(); return null; }
  return preview.value.text;
}
async function usePrompt() { if (props.disabled) return; const text = await validated(); if (text !== null) emit("usePrompt", text); }
async function copyPrompt() {
  if (props.disabled) return; const text = await validated(); if (text === null) return;
  try { await navigator.clipboard.writeText(text); copied.value = true; }
  catch { error.value = "复制失败，请在预览中选择文字后手动复制"; await nextTick(); errorBox.value?.focus(); }
}
</script>

<style scoped lang="scss">
.promptComposer {
  min-width: 0; display: flex; flex-direction: column; gap: 12px; color: var(--homeText, var(--el-text-color-primary));
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; legend { font-size: 14px; font-weight: 600; } label { display: block; margin: 12px 0; font-size: 13px; line-height: 1.7; > span { color: var(--homeMuted, var(--el-text-color-secondary)); } } }
  fieldset { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: 0 16px; .promptHint { grid-column: 1 / -1; } }
  textarea { display: block; box-sizing: border-box; width: 100%; resize: vertical; min-height: 64px; margin-top: 6px; padding: 10px 12px; font: inherit; color: inherit; border: 1px solid var(--homeLine, var(--el-border-color)); border-radius: 6px; background: var(--homeBg, var(--el-bg-color)); }
  .promptHint, .previewLabel { margin: 0; font-size: 12px; color: var(--homeMuted, var(--el-text-color-secondary)); line-height: 1.7; }
  .previewLabel { font-weight: 600; }
  .promptSource { font-size: 12px; color: var(--homeMuted, var(--el-text-color-secondary)); summary { cursor: pointer; } p { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 160px; overflow: auto; } }
  .promptPreview { margin: 0; font-size: 15px; line-height: 1.9; white-space: pre-wrap; overflow-wrap: anywhere; max-height: min(400px, 45dvh); overflow: auto; min-height: 60px; }
  .promptError { color: var(--el-color-danger); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; strong { display: block; } button { display: block; border: 0; background: none; color: inherit; text-decoration: underline; padding: 4px 0; text-align: left; font: inherit; cursor: pointer; } }
  .promptActions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; padding-top: 16px; border-top: 1px solid var(--homeLine, var(--el-border-color-light)); button { min-height: 40px; padding: 9px 14px; border: 1px solid var(--homeLine, var(--el-border-color)); border-radius: 6px; background: transparent; color: inherit; cursor: pointer; font: inherit; font-size: 13px; &.primaryAction { background: var(--homeAccent, var(--el-color-primary)); color: var(--homeBg, var(--el-color-white)); border-color: transparent; } &:disabled { opacity: .5; cursor: not-allowed; } } }
  :focus-visible { outline: 2px solid var(--homeAccent, var(--el-color-primary)); outline-offset: 3px; }
  @media(max-width:720px) { .promptActions button { min-height: 44px; flex: 1 1 auto; } }
}
</style>
