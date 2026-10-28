<template>
  <main class="libraryShell" :class="{ lightLibrary }">
    <appHeader :light="lightLibrary" compact @settings="openSettings" />
    <div class="libraryBody">
      <aside class="libraryIndex">
        <nav aria-label="主导航">
          <router-link v-for="item in navigation" :key="item.path" :to="item.path" :class="{ active: isCurrent(item.path) }" :aria-current="isCurrent(item.path) ? 'page' : undefined"><span class="indexNumber" aria-hidden="true">{{ item.number }}</span><span>{{ item.label }}</span></router-link>
        </nav>
        <span class="indexSignature" aria-hidden="true">ZEROMU</span>
      </aside>
      <div class="libraryContent"><slot /></div>
    </div>
    <settings v-if="!settingsHandler" v-model="settingsVisible" :initialPanel="settingsPanel" />
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import appHeader from "@/components/appHeader.vue";
import settings from "@/components/settings/index.vue";
import { settings as appSettings } from "@/stores/settings";

const props = defineProps<{ settingsHandler?: (panel: string) => void }>();
const lightLibrary = computed(() => appSettings.value.homeTheme === "light");
const settingsVisible = ref(false);
const settingsPanel = ref("mediaChannel");
const route = useRoute();
const navigation = [
  { number: "00", label: "创作首页", path: "/home" },
  { number: "01", label: "无限画布", path: "/canvas" },
  { number: "02", label: "创作中心", path: "/studio/image" },
  { number: "03", label: "提示词库", path: "/prompts" },
  { number: "04", label: "我的素材", path: "/assets" },
];
function isCurrent(path: string) { return path.startsWith("/studio/") ? route.path.startsWith("/studio/") : route.path === path; }
onMounted(() => document.documentElement.classList.add("indexInterface"));
onBeforeUnmount(() => document.documentElement.classList.remove("indexInterface"));

function openSettings(panel: string) { if (props.settingsHandler) return props.settingsHandler(panel); settingsPanel.value = panel; settingsVisible.value = true; }
</script>

<style scoped lang="scss">
.libraryShell {
  --homeBg: var(--indexBg); --homeSurface: var(--indexSurface); --homeRaised: var(--indexRaised); --homeText: var(--indexText); --homeMuted: var(--indexMuted); --homeLine: var(--indexLine); --homeAccent: var(--indexText);
  --ui-radius: 4px; --ui-radius-small: 3px; --ui-radius-large: 6px;
  --el-bg-color: var(--homeSurface); --el-bg-color-overlay: var(--homeRaised); --el-fill-color-blank: var(--homeSurface); --el-fill-color-light: var(--homeRaised); --el-text-color-primary: var(--homeText); --el-text-color-regular: var(--homeMuted); --el-text-color-placeholder: var(--homeMuted); --el-border-color: var(--homeLine); --el-border-color-light: var(--homeLine); --el-color-primary: var(--homeAccent);
  height: 100vh; height: 100dvh; min-width: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--homeBg); color: var(--homeText); color-scheme: dark;
  &.lightLibrary { color-scheme: light; }
  :deep(button), :deep(input), :deep(select) { font: inherit; }
  :deep(button) { cursor: pointer; }
  :deep(button:disabled) { cursor: not-allowed; opacity: .5; }
  :deep(button:focus-visible), :deep(a:focus-visible), :deep(input:focus-visible), :deep(select:focus-visible) { outline: 2px solid var(--homeAccent); outline-offset: 3px; }
  :deep(::selection) { background: var(--homeAccent); color: var(--homeBg); }
  :deep(input) { caret-color: var(--homeAccent); }
  :deep(.el-input__inner:focus-visible) { outline: none; }
  :deep(.el-input__wrapper.is-focus) { outline: 2px solid var(--homeAccent); outline-offset: 2px; box-shadow: none; }
  :deep(*) { scrollbar-width: thin; scrollbar-color: var(--homeLine) transparent; }
  .libraryBody { flex: 1; min-height: 0; min-width: 0; display: grid; grid-template-columns: 176px minmax(0, 1fr); }
  .libraryIndex {
    display: flex; flex-direction: column; justify-content: space-between; min-width: 0; border-right: 1px solid var(--homeLine); padding: 20px 0;
    nav { display: grid; gap: 8px; }
    a { position: relative; display: flex; align-items: center; gap: 18px; min-height: 48px; padding: 10px 28px; color: var(--homeMuted); text-decoration: none; font-size: 15px; white-space: nowrap;
      > span:last-child { min-width: 0; white-space: normal; overflow-wrap: anywhere; text-wrap: balance; }
      &::before { position: absolute; inset: 10px auto 10px 12px; width: 2px; background: transparent; content: ""; }
      &:hover { color: var(--homeText); background: var(--homeSurface); }
      &.active { color: var(--homeText); font-weight: 600; &::before { background: currentColor; } }
    }
    .indexNumber { flex-shrink: 0; font-size: 12px; font-weight: 400; font-variant-numeric: tabular-nums; }
    .indexSignature { margin: 32px 28px 0; color: var(--homeMuted); font-size: 11px; letter-spacing: .06em; }
  }
  .libraryContent { width: 100%; min-height: 0; min-width: 0; padding: 28px clamp(24px, 3vw, 48px); display: flex; flex-direction: column; overflow: auto; scrollbar-gutter: stable; }
  :deep(.pageHeading) { flex-shrink:0; margin-bottom:20px; h1 { font-size:30px; font-weight:600; letter-spacing:-.025em; margin:0 0 12px; } p { margin:0; color:var(--homeMuted); font-size:14px; line-height:1.7; } }
  @media(max-width:900px) { .libraryBody { grid-template-columns: 140px minmax(0, 1fr); } .libraryIndex a { gap: 12px; padding-inline: 24px; } .libraryContent { padding: 24px; } }
  @media(max-width:600px) {
    .libraryBody { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
    .libraryIndex { border-right: 0; border-bottom: 1px solid var(--homeLine); padding: 0 8px; nav { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 0; } a { justify-content: center; gap: 6px; min-height: 48px; padding: 8px 4px; font-size: 13px; &::before { inset: auto 12px 0; width: auto; height: 2px; } } .indexNumber { font-size: 10px; } .indexSignature { display: none; } }
    .libraryContent { padding: 20px 16px; } :deep(.pageHeading) { margin-bottom:16px; h1 { font-size:26px; } }
  }
  @media(max-width:420px) { .libraryIndex { a { padding-inline: 0; } .indexNumber { display: none; } } }
  @media(max-height:700px) { .libraryContent { padding-block:16px; } :deep(.pageHeading) { margin-bottom:12px; h1 { font-size:24px; margin-bottom:8px; } } }
}
</style>
