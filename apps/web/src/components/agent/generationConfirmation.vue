<template>
  <section class="generationConfirmation" aria-live="polite">
    <strong>{{ tool.question?.title }}</strong>
    <p>{{ tool.question?.question }}</p>
    <div v-if="tool.status === 'running' && !answer" class="confirmationActions">
      <el-button type="primary" size="small" :loading="submitting" :disabled="!directory" @click="submit('确认生成')">确认生成</el-button>
      <el-button size="small" :disabled="submitting || !directory" @click="submit('取消生成')">取消生成</el-button>
    </div>
    <span v-else class="confirmationStatus">{{ answer || (tool.status === 'interrupted' ? '已停止' : '本次确认已结束') }}</span>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import axios from "axios";
import type { AgentToolCall } from "@toonflow/server/agent/types";
const props = defineProps<{ tool: AgentToolCall; directory?: string }>();
const submitting = ref(false);
const answer = ref("");
const error = ref("");
watch(() => props.tool.question?.callId, () => { answer.value = ""; error.value = ""; });
async function submit(value: string) {
  if (submitting.value || !props.directory || !props.tool.question?.callId) return;
  submitting.value = true;
  error.value = "";
  try {
    const { data } = await axios.post("/api/agent/answer", { directory: props.directory, callId: props.tool.question.callId, answer: value }, { headers: { "x-toonflow-workspace": "1" } });
    if (data.code !== 200) throw new Error(data.message || "确认失败，请重试");
    answer.value = value === "确认生成" ? "已确认，开始生成" : "已取消生成";
  } catch { error.value = "提交失败，请重试"; }
  finally { submitting.value = false; }
}
</script>

<style scoped lang="scss">
.generationConfirmation {
  padding: 14px; margin-bottom: 12px; border: 1px solid var(--el-border-color-light); border-radius: var(--ui-radius-large, 12px);
  strong { color: var(--el-text-color-primary); font-size: 13px; }
  p { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.7; color: var(--el-text-color-regular); }
  .confirmationActions { display: flex; gap: 8px; .el-button { margin: 0; } }
  .confirmationStatus { color: var(--el-text-color-regular); font-size: 12px; }
  [role='alert'] { color: var(--el-color-danger); }
}
</style>
