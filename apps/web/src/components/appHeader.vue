<template>
  <header class="appHeader" :class="{ lightHeader: light, compactHeader: compact }">
    <router-link class="headerBrand" to="/home" aria-label="零幕首页" :aria-current="route.path === '/home' ? 'page' : undefined">
      <span class="brandMark" aria-hidden="true"><span :style="{ maskImage: `url(${logoUrl})` }"></span></span>
      <strong>零幕</strong>
    </router-link>
    <nav v-if="!compact" class="headerNavigation" aria-label="主导航">
      <router-link v-for="item in navigation" :key="item.path" :to="destination(item.path)" :class="{ active: route.path === item.path }" :aria-current="route.path === item.path ? 'page' : undefined">
        <component :is="item.icon" :size="17" :strokeWidth="1.7" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </router-link>
    </nav>
    <router-link v-if="compact" class="projectLocation" to="/home" :title="workspace.workspaceRoot?.directory || '选择工作空间'"><icon-folders :size="15" /><span>{{ workspace.workspaceRoot?.name || '选择工作空间' }}</span></router-link>
    <div class="headerActions">
      <taskButton />
      <button v-if="!compact" type="button" aria-label="模型配置" title="模型配置" @click="emit('settings', 'mediaChannel')"><icon-adjustments-horizontal :size="18" :strokeWidth="1.7" /></button>
      <button type="button" aria-label="设置" title="设置" @click="emit('settings', 'ui')"><icon-settings :size="18" :strokeWidth="1.7" /></button>
      <button type="button" :disabled="themeChanging" :aria-label="light ? '切换深色' : '切换浅色'" :title="light ? '切换深色' : '切换浅色'" @click="toggleTheme"><icon-moon v-if="light" :size="18" :strokeWidth="1.7" /><icon-sun v-else :size="18" :strokeWidth="1.7" /></button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useWorkspaceStore } from '@/stores/workspace';
import { ElMessage } from 'element-plus';
import { useRoute } from 'vue-router';
import { IconLayoutGrid, IconFolders, IconPhoto, IconVideo, IconMusic, IconBook, IconAdjustmentsHorizontal, IconSettings, IconMoon, IconSun } from '@tabler/icons-vue';
import logoUrl from '@toonflow/assets/zeromuIcon.png';
import { saveSettings } from '@/stores/settings';
import transitionTheme from '@/lib/themeTransition';
import taskButton from '@/components/taskButton.vue';

const props = withDefaults(defineProps<{ light: boolean; creationPrompt?: string; compact?: boolean }>(), { creationPrompt: '', compact: false });
const emit = defineEmits<{ settings: [panel: string] }>();
const themeChanging = ref(false);
const workspace = useWorkspaceStore();
const route = useRoute();
const navigation = [
  { path: '/canvas', label: '无限画布', icon: IconLayoutGrid },
  { path: '/studio/image', label: '生图创作', icon: IconPhoto },
  { path: '/studio/video', label: '视频创作', icon: IconVideo },
  { path: '/studio/audio', label: '音频创作', icon: IconMusic },
  { path: '/prompts', label: '提示词库', icon: IconBook },
  { path: '/assets', label: '我的资产', icon: IconFolders },
];
function destination(path: string) {
  return path.startsWith('/studio/') && props.creationPrompt.trim() ? { path, query: { prompt: props.creationPrompt } } : path;
}
async function toggleTheme(event: MouseEvent) {
  if (themeChanging.value) return;
  themeChanging.value = true;
  const next = props.light ? 'dark' : 'light';
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const point = event.detail ? { x: event.clientX, y: event.clientY } : { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  try {
    await transitionTheme(async () => {
      await saveSettings(() => ({ homeTheme: next }));
    }, point);
  } catch { ElMessage.error('外观保存失败，请重试'); }
  finally { themeChanging.value = false; }
}
</script>

<style scoped lang="scss">
.appHeader {
  --headerBg: #101111;
  --headerText: #eeede8;
  --headerMuted: #a7a7a2;
  --headerLine: #353633;
  --headerHover: #242522;
  box-sizing: border-box;
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: clamp(12px, 2vw, 24px);
  width: 100%;
  min-height: 64px;
  padding: 0 var(--app-gutter);
  border-bottom: 1px solid var(--headerLine);
  background: var(--headerBg);
  color: var(--headerText);
  &.lightHeader { --headerBg: var(--ui-lightBg); --headerText: var(--ui-lightText); --headerMuted: var(--ui-lightMuted); --headerLine: var(--ui-lightBorder); --headerHover: var(--ui-lightRaised); }
  a, button { -webkit-tap-highlight-color: transparent; }
  a:focus-visible, button:focus-visible { outline: 2px solid var(--headerText); outline-offset: -4px; }
  .headerBrand {
    justify-self: start; display: inline-flex; align-items: center; gap: 10px; height: 44px; text-decoration: none; color: var(--headerText); border-radius: calc(var(--ui-radius, 8px) * 0.75);
    .brandMark { box-sizing: border-box; display: grid; place-items: center; width: 32px; height: 32px;
      span { width: 25px; height: 25px; background: currentColor; mask-size: contain; mask-position: center; mask-repeat: no-repeat; }
    }
    strong { font-size: 18px; font-weight: 600; line-height: 1; letter-spacing: .02em; white-space: nowrap; }
  }
  .projectLocation { display: inline-flex; align-items: center; justify-self: start; gap: 8px; min-width: 0; max-width: 260px; color: var(--headerMuted); text-decoration: none; font-size: 12px; padding: 8px 10px; border-left: 1px solid var(--headerLine); span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } &:hover { color: var(--headerText); } }
  .headerNavigation {
    display: flex; align-items: stretch; align-self: stretch; justify-self: center; width: max-content; max-width: 100%; min-width: 0; gap: 6px; margin: 0; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: thin;
    &::-webkit-scrollbar { display: none; }
    a { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 7px; flex-shrink: 0; padding: 0 12px; font-size: 13px; font-weight: 400; line-height: 1; color: var(--headerMuted); text-decoration: none; white-space: nowrap;
      svg { flex-shrink: 0; }
      &::after { content: ''; position: absolute; left: 12px; right: 12px; bottom: 0; height: 2px; background: transparent; }
      &:hover, &.active { color: var(--headerText); }
      &.active::after { background: var(--headerText); }
    }
  }
  .headerActions { display: flex; align-items: center; justify-self: end; gap: 4px;
    button:not(.taskButton) { box-sizing: border-box; display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: calc(var(--ui-radius, 8px) * 0.75); background: transparent; color: var(--headerMuted); cursor: pointer;
      &:hover { background: var(--headerHover); color: var(--headerText); }
      &:disabled { cursor: wait; }
    }
  }
  @media (max-width: 1100px) {
    .headerNavigation { gap: 0; a { padding-inline: 8px; &::after { left: 8px; right: 8px; } } }
  }
  @media (max-width: 900px) {
    grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: 52px 44px; gap: 0 16px;
    .headerNavigation { grid-column: 1 / -1; grid-row: 2; justify-self: center; max-width: 100%; }
    .headerActions { grid-column: 2; grid-row: 1; }
  }
  @media (max-width: 600px) {
    .headerNavigation { justify-self: stretch; width: 100%; gap: 2px; a { padding-inline: 10px; &::after { left: 10px; right: 10px; } } }
    .headerActions button:not(.taskButton) { width: 40px; height: 44px; }
  }
  @media (pointer: coarse) { .headerActions button:not(.taskButton) { width: 44px; height: 44px; } }
  &.compactHeader {
    --headerBg: var(--indexBg); --headerText: var(--indexText); --headerMuted: var(--indexMuted); --headerLine: var(--indexLine); --headerHover: var(--indexRaised);
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-rows: auto;
    min-height: 56px;
    padding: 0 24px;
    gap: 16px;
    .headerBrand { gap: 8px; strong { font-size: 17px; } .brandMark { width: 28px; height: 28px; span { width: 23px; height: 23px; } } }
    .projectLocation { grid-column: 2; grid-row: 1; }
    .headerActions { grid-column: 3; grid-row: 1; }
    :deep(.taskButton) { border-color: transparent; background: transparent; color: var(--headerText); }
    @media (max-width: 600px) { padding-inline: 16px; }
  }
}
</style>
