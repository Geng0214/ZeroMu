<template>
  <main class="libraryShell" :class="{ lightLibrary }">
    <appHeader :light="lightLibrary" @settings="openSettings" />
    <div class="libraryContent"><slot /></div>
    <settings v-model="settingsVisible" :initialPanel="settingsPanel" />
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import appHeader from "@/components/appHeader.vue";
import settings from "@/components/settings/index.vue";
import { settings as appSettings } from "@/stores/settings";

const lightLibrary = computed(() => appSettings.value.homeTheme === "light");
const settingsVisible = ref(false);
const settingsPanel = ref("mediaChannel");

function openSettings(panel: string) { settingsPanel.value = panel; settingsVisible.value = true; }
</script>

<style scoped lang="scss">
.libraryShell {
  --homeBg: #101111; --homeSurface: #202120; --homeRaised: #292b29; --homeText: #f1f1ec; --homeMuted: #aaada6; --homeLine: #373a36; --homeAccent: #b6dec9;
  --el-bg-color: var(--homeSurface); --el-bg-color-overlay: var(--homeRaised); --el-fill-color-blank: var(--homeSurface); --el-fill-color-light: var(--homeRaised); --el-text-color-primary: var(--homeText); --el-text-color-regular: var(--homeMuted); --el-text-color-placeholder: var(--homeMuted); --el-border-color: var(--homeLine); --el-border-color-light: var(--homeLine); --el-color-primary: var(--homeAccent);
  height: 100vh; height: 100dvh; min-width: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--homeBg); color: var(--homeText); color-scheme: dark;
  &.lightLibrary { --homeBg: #f4f5f0; --homeSurface: #fff; --homeRaised: #e7eae3; --homeText: #202820; --homeMuted: #54604f; --homeLine: #ccd2c7; --homeAccent: #23644d; color-scheme: light; }
  :deep(button), :deep(input), :deep(select) { font: inherit; }
  :deep(button) { cursor: pointer; }
  :deep(button:disabled) { cursor: not-allowed; opacity: .5; }
  :deep(button:focus-visible), :deep(a:focus-visible), :deep(input:focus-visible), :deep(select:focus-visible) { outline: 2px solid var(--homeAccent); outline-offset: 3px; }
  :deep(::selection) { background: var(--homeAccent); color: var(--homeBg); }
  :deep(input) { caret-color: var(--homeAccent); }
  :deep(.el-input__inner:focus-visible) { outline: none; }
  :deep(.el-input__wrapper.is-focus) { outline: 2px solid var(--homeAccent); outline-offset: 2px; box-shadow: none; }
  :deep(*) { scrollbar-width: thin; scrollbar-color: var(--homeLine) transparent; }
  .libraryContent { box-sizing:border-box; width:100%; max-width:1440px; flex:1; min-height:0; min-width:0; margin:0 auto; padding:24px clamp(16px,3vw,40px); display:flex; flex-direction:column; overflow:auto; }
  :deep(.pageHeading) { flex-shrink:0; margin-bottom:20px; h1 { font-size:30px; font-weight:600; letter-spacing:-.025em; margin:0 0 12px; } p { margin:0; color:var(--homeMuted); font-size:14px; line-height:1.7; } }
  @media(max-width:600px) { .libraryContent { padding:16px 18px; } :deep(.pageHeading) { margin-bottom:16px; h1 { font-size:26px; } } }
  @media(max-height:700px) { .libraryContent { padding-block:16px; } :deep(.pageHeading) { margin-bottom:12px; h1 { font-size:24px; margin-bottom:8px; } } }
}
</style>
