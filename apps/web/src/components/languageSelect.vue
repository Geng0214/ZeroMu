<template>
  <el-popover
    v-if="popover"
    v-model:visible="visible"
    trigger="click"
    placement="bottom-end"
    role="dialog"
    :aria-label="translate('语言')"
    :width="500"
    :showArrow="false"
    :offset="10"
    :popperStyle="{ maxWidth: 'calc(100vw - 32px)', padding: '12px', borderRadius: 'calc(var(--ui-radius, 8px) * 1.75)' }"
    @after-enter="popoverPanel?.focusSelected()">
    <template #reference>
      <button ref="triggerButton" class="languageTrigger" type="button" :aria-label="translate('语言')" @keydown.esc.stop.prevent="closePopover">
        <svg class="languageFlag" viewBox="0 0 32 24" aria-hidden="true"><use :href="`${languageFlags}#${flagIds[uiSettings.language]}`" /></svg>
        <span class="triggerName" :lang="uiSettings.language">{{ selectedName }}</span>
        <icon-chevron-down class="triggerChevron" :class="{ opened: visible }" :size="15" aria-hidden="true" />
      </button>
    </template>
    <div class="languagePopup" @keydown.esc.stop.prevent="closePopover">
      <header class="popupHeader">
        <div class="popupHeading">
          <span class="headingIcon"><icon-language :size="20" aria-hidden="true" /></span>
          <strong>{{ translate('语言') }}</strong>
        </div>
        <button class="closeButton" type="button" :aria-label="translate('关闭')" @click="closePopover"><icon-x :size="18" aria-hidden="true" /></button>
      </header>
      <languageSelect ref="popoverPanel" @select="closePopover" />
    </div>
  </el-popover>
  <div v-else ref="panel" class="languagePanel" role="radiogroup" :aria-label="translate('语言')" @keydown="navigateLanguages">
    <div class="languageGrid">
      <button
        v-for="language in uiLanguages"
        :key="language.code"
        class="languageCard"
        type="button"
        role="radio"
        :aria-checked="uiSettings.language === language.code"
        :tabindex="uiSettings.language === language.code ? 0 : -1"
        :data-language="language.code"
        @click="changeLanguage(language.code)">
        <span class="cardTop">
          <svg class="languageFlag" viewBox="0 0 32 24" aria-hidden="true"><use :href="`${languageFlags}#${flagIds[language.code]}`" /></svg>
          <span class="selectionMark" aria-hidden="true"><icon-check v-if="uiSettings.language === language.code" :size="12" :strokeWidth="3" /></span>
        </span>
        <span class="languageName" :lang="language.code" dir="auto">{{ language.name }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { IconCheck, IconChevronDown, IconLanguage, IconX } from "@tabler/icons-vue";
import { translate } from "@toonflow/i18n/vue";
import { uiLanguages, uiSettings, updateUiSettings } from "@/stores/settings";
import languageFlags from "@/assets/languageFlags.svg?url";

defineProps<{ popover?: boolean }>();
const emit = defineEmits<{ select: [] }>();
const visible = ref(false);
const panel = ref<HTMLDivElement>();
const triggerButton = ref<HTMLButtonElement>();
const popoverPanel = ref<{ focusSelected: () => void }>();
const flagIds = { "zh-CN": "cn", "zh-TW": "cn", en: "us" };
const selectedName = computed(() => uiLanguages.find(language => language.code === uiSettings.value.language)?.name);

function changeLanguage(language: typeof uiLanguages[number]["code"]) {
  if (uiSettings.value.language !== language) updateUiSettings({ language });
  emit("select");
}
function focusSelected() {
  focusLanguage(panel.value?.querySelector<HTMLButtonElement>('[aria-checked="true"]'));
}
function focusLanguage(button?: HTMLButtonElement | null) {
  if (!button) return;
  const popup = button.closest<HTMLElement>(".languagePopup");
  button.focus({ preventScroll: !!popup });
  if (!popup) return;
  // ACT: 仅滚动语言弹层，避免聚焦时连带滚动 hello 页面。
  const cardRect = button.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  if (cardRect.top < popupRect.top) popup.scrollTop += cardRect.top - popupRect.top;
  else if (cardRect.bottom > popupRect.bottom) popup.scrollTop += cardRect.bottom - popupRect.bottom;
}
function navigateLanguages(event: KeyboardEvent) {
  const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0;
  if (!direction && !["Home", "End"].includes(event.key)) return;
  const buttons = [...(panel.value?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])];
  const current = buttons.findIndex(button => button === event.target);
  if (current < 0) return;
  event.preventDefault();
  const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + direction + buttons.length) % buttons.length;
  const button = buttons[index];
  updateUiSettings({ language: button.dataset.language });
  void nextTick(() => focusLanguage(button));
}
function closePopover() {
  visible.value = false;
  void nextTick(() => triggerButton.value?.focus({ preventScroll: true }));
}
defineExpose({ focusSelected });
</script>

<style scoped lang="scss">
.languageFlag {
  display: block;
  flex-shrink: 0;
  width: 24px;
  height: 18px;
  overflow: hidden;
  border-radius: var(--ui-radius-small, 4px);
  background: #fff;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 7%);
}

.languageTrigger {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  max-width: 100%;
  min-height: 40px;
  padding: 8px 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--ui-radius-large, 12px);
  background: var(--el-bg-color-overlay);
  color: var(--el-text-color-primary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.18s, box-shadow 0.18s;

  .triggerName { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .triggerChevron {
    flex-shrink: 0;
    color: var(--el-text-color-secondary);
    transition: transform 0.18s;
    &.opened { transform: rotate(180deg); }
  }
  &:hover { border-color: var(--el-color-primary-light-5); box-shadow: var(--el-box-shadow-lighter); }
  &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; }
}

.languagePopup {
  max-height: min(600px, calc(100dvh - 110px));
  overflow-y: auto;
  overscroll-behavior: contain;

  .popupHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;

    .popupHeading {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--el-text-color-primary);
      .headingIcon { display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--ui-radius, 8px); background: var(--el-fill-color-light); }
      strong { font-size: 15px; font-weight: 600; }
    }
    .closeButton {
      display: grid;
      place-items: center;
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      padding: 0;
      border: 0;
      border-radius: var(--ui-radius, 8px);
      color: var(--el-text-color-secondary);
      background: transparent;
      cursor: pointer;
      &:hover { color: var(--el-text-color-primary); background: var(--el-fill-color); }
      &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
    }
  }
}

.languagePanel {
  display: grid;
  gap: 8px;
  min-width: 0;
  container-type: inline-size;

  .languageCard {
    min-width: 0;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: calc(var(--ui-radius, 8px) * 1.25);
    background: var(--el-bg-color-overlay);
    color: var(--el-text-color-primary);
    font: inherit;
    text-align: start;
    cursor: pointer;
    transition: border-color 0.18s, background-color 0.18s, box-shadow 0.18s;

    .selectionMark {
      display: grid;
      place-items: center;
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      border: 1px solid var(--el-border-color);
      border-radius: 50%;
      background: var(--el-bg-color-overlay);
      color: var(--el-color-white);
    }
    &:hover { border-color: var(--el-color-primary-light-5); background: var(--el-fill-color-extra-light); }
    &[aria-checked="true"] {
      border-color: var(--el-color-primary);
      background: var(--el-color-primary-light-9);
      box-shadow: inset 0 0 0 1px var(--el-color-primary-light-8);
      .selectionMark { border-color: var(--el-color-primary); background: var(--el-color-primary); }
    }
    &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
  }
  .languageGrid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;

    .languageCard {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 6px;
      min-height: 60px;
      padding: 8px;

      .cardTop { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .languageName { font-size: 13px; line-height: 1.45; font-weight: 500; text-align: start; overflow-wrap: anywhere; }
    }
  }
  @container (max-width: 275px) {
    .languageGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
}

@media (prefers-reduced-motion: reduce) {
  .languageTrigger,
  .languageTrigger .triggerChevron,
  .languagePanel .languageCard { transition: none; }
}
</style>
