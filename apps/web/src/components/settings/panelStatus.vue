<template>
  <div class="panelStatus" :role="error ? 'alert' : 'status'" :aria-busy="!error">
    <template v-if="error">
      <p class="statusTitle">设置内容未能加载</p>
      <p>页面资源可能已更新，或连接暂时中断。请保存其他未完成的编辑，再刷新页面。</p>
      <el-button type="primary" @click="reloadPage">刷新页面</el-button>
    </template>
    <template v-else>
      <p>正在加载设置…</p>
      <el-skeleton :rows="4" />
    </template>
  </div>
</template>

<script setup lang="ts">
defineProps<{ error?: Error }>();
function reloadPage() { window.location.reload(); }
</script>

<style scoped lang="scss">
.panelStatus {
  padding: 12px 4px;
  color: var(--el-text-color-secondary);
  font-size: 14px;
  line-height: 1.7;
  p { margin: 0 0 16px; }
  .statusTitle { color: var(--el-text-color-primary); font-weight: 600; }
}
</style>
