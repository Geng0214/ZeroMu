<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="strokeWidth" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <rect x="5" y="8" width="14" height="11" rx="2" />
    <path d="M12 5v3M3 12h2m14 0h2M9 12v3m6-3v3" />
    <circle cx="12" cy="4" r="1" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ size?: number; strokeWidth?: number }>(), { size: 16, strokeWidth: 1.6 });
</script>
