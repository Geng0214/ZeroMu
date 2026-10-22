<template>
  <el-dialog v-model="visible" title="Agent 设置" width="500px" :style="{ maxWidth: 'calc(100vw - 32px)' }" alignCenter appendToBody :closeOnClickModal="!saving" :closeOnPressEscape="!saving" :showClose="!saving" @open="resetDraft">
    <div class="agentPreferences">
      <section class="protocolSetting">
        <label id="agentProtocolLabel">文本接口</label>
        <p>跟随渠道，或为 OpenAI 兼容模型单独选择接口。</p>
        <el-radio-group v-model="draft.textProtocol" aria-labelledby="agentProtocolLabel" :disabled="saving">
          <el-radio-button value="provider">跟随渠道</el-radio-button>
          <el-radio-button value="openai-completions">Chat</el-radio-button>
          <el-radio-button value="openai-responses">Responses</el-radio-button>
        </el-radio-group>
      </section>
      <section class="settingRow">
        <div><label id="agentStreamLabel">流式显示</label><p>边生成边显示回复；关闭后整段显示。</p></div>
        <el-switch v-model="draft.streamResponses" ariaLabel="流式显示" :disabled="saving" />
      </section>
      <section class="settingRow">
        <div><label id="agentMediaLabel">自动生成图片 / 视频 / 音频</label><p>开启后直接执行生成；关闭后先在对话中确认。</p></div>
        <el-switch v-model="draft.autoGenerateMedia" ariaLabel="自动生成图片、视频和音频" :disabled="saving" />
      </section>
      <p class="settingsNote">用于后续回复与生成操作，已在进行的任务继续执行。</p>
    </div>
    <template #footer><el-button :disabled="saving" @click="visible = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存设置</el-button></template>
  </el-dialog>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { agentPreferences, saveSettings } from "@/stores/settings";

const visible = defineModel<boolean>({ default: false });
const draft = reactive({ ...agentPreferences.value });
const saving = ref(false);
function resetDraft() { Object.assign(draft, agentPreferences.value); }
async function save() {
  if (saving.value) return;
  saving.value = true;
  try {
    await saveSettings(() => ({ agentPreferences: { ...draft } }));
    visible.value = false;
    ElMessage.success("Agent 设置已保存");
  } catch { ElMessage.error("Agent 设置保存失败，请重试"); }
  finally { saving.value = false; }
}
</script>

<style scoped lang="scss">
.agentPreferences {
  padding: 2px 4px;
  label { color: var(--el-text-color-primary); font-size: 14px; font-weight: 600; }
  p { margin: 7px 0 0; color: var(--el-text-color-regular); font-size: 12px; line-height: 1.7; }
  .protocolSetting { padding-bottom: 20px; .el-radio-group { margin-top: 14px; } }
  .settingRow { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 18px 0; border-top: 1px solid var(--el-border-color-lighter); .el-switch { flex-shrink: 0; } }
  .settingsNote { margin-top: 8px; font-size: 12px; }
}
</style>
