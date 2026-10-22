<template>
  <div class="chatItem" :class="{ user: role === 'user' }" :aria-busy="textLoading">
    <div class="chatContent"><div class="chatDetail">
      <div v-if="textLoading" class="chatLoading" role="status" aria-label="正在生成"><icon-loader-2 :size="18" /></div>
      <slot name="content" />
    </div></div>
  </div>
</template>

<script setup lang="ts">
import { IconLoader2 } from "@tabler/icons-vue";
defineProps<{ role: string; textLoading?: boolean }>();
</script>

<style scoped lang="scss">
.chatItem {
  display: flex;
  width: 100%;
  .chatContent { display: flex; width: 100%; min-width: 0; }
  .chatDetail { min-width: 0; box-sizing: border-box; }
  &.user .chatContent { justify-content: flex-end; }
  .chatLoading { display: flex; align-items: center; min-height: 24px; color: var(--agentMuted); svg { animation: chatLoadingSpin 1s linear infinite; } }
}
@keyframes chatLoadingSpin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .chatItem .chatLoading svg { animation: none; } }
</style>
