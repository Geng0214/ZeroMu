<template>
  <el-dialog
    v-model="visible"
    :title="`选择${kindLabels[channel.kind]}模型`"
    width="min(640px, 94vw)"
    alignCenter
    appendToBody
    destroyOnClose>
    <el-text class="dialogHint" type="info" size="small">
      {{ channel.label || "未命名渠道" }} · {{ channel.apiUrl || "未填写 API 地址" }}
    </el-text>
    <div class="modelToolbar">
      <el-button :icon="IconRefresh" :loading="pulling" @click="pullModels">拉取模型</el-button>
      <el-input v-model="newModelId" class="modelInput" placeholder="手动填写模型 ID" clearable spellcheck="false" @keyup.enter="addModel">
        <template #append><el-button :icon="IconPlus" :disabled="!newModelId.trim()" @click="addModel">添加</el-button></template>
      </el-input>
    </div>
    <div class="selectedBox">
      <el-text size="small" type="info">已选 {{ draft.length }} 个</el-text>
      <div class="selectedTags">
        <el-tag v-for="model in draft" :key="model.id" closable :title="model.label || model.id" @close="removeModel(model.id)">{{ model.id }}</el-tag>
        <el-text v-if="!draft.length" type="info" size="small">尚未选择模型，可拉取后勾选，或手动添加模型 ID。</el-text>
      </div>
    </div>
    <div v-if="candidates.length" class="candidateBox">
      <div class="candidateHeader">
        <el-text size="small" type="info">拉取结果 {{ picked.length }}/{{ candidates.length }}</el-text>
        <el-space>
          <el-button text size="small" @click="toggleAll">{{ picked.length === candidates.length ? "取消全选" : "全选" }}</el-button>
          <el-button text size="small" type="primary" :disabled="!picked.length" @click="addPicked">加入已选</el-button>
        </el-space>
      </div>
      <el-checkbox-group v-model="picked" class="candidateList">
        <el-scrollbar maxHeight="220px">
          <el-checkbox v-for="model in candidates" :key="model.id" :value="model.id" :title="model.label">{{ model.id }}</el-checkbox>
        </el-scrollbar>
      </el-checkbox-group>
    </div>
    <el-alert v-if="error" class="dialogError" :title="error" type="error" :closable="false" showIcon />
    <template #footer>
      <el-space>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :disabled="!draft.length" @click="confirm">确定</el-button>
      </el-space>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import axios from "axios";
import { ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { IconPlus, IconRefresh } from "@tabler/icons-vue";
import { kindLabels, type MediaChannelModel, type MediaChannelRow } from "./types";

const props = defineProps<{ channel: MediaChannelRow }>();
const emit = defineEmits<{ picked: [MediaChannelModel[]] }>();
const visible = defineModel<boolean>({ default: false });

const draft = ref<MediaChannelModel[]>([]);
const candidates = ref<MediaChannelModel[]>([]);
const picked = ref<string[]>([]);
const newModelId = ref("");
const pulling = ref(false);
const error = ref("");

watch(visible, value => {
  if (!value) return;
  draft.value = props.channel.models.map(model => ({ ...model }));
  candidates.value = [];
  picked.value = [];
  newModelId.value = "";
  error.value = "";
}, { immediate: true });

function isValidUrl(value: string) {
  if (!/^https?:\/\/\S+$/i.test(value)) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password;
  } catch { return false; }
}

function addModel() {
  const id = newModelId.value.trim();
  if (!id) return;
  if (draft.value.some(model => model.id === id)) {
    ElMessage.warning("该模型已在列表中");
    return;
  }
  draft.value = [...draft.value, { id, label: id }];
  newModelId.value = "";
}

function removeModel(id: string) {
  draft.value = draft.value.filter(model => model.id !== id);
}

function toggleAll() {
  picked.value = picked.value.length === candidates.value.length ? [] : candidates.value.map(model => model.id);
}

function addPicked() {
  const taken = new Set(draft.value.map(model => model.id));
  let added = 0;
  for (const id of picked.value) {
    const found = candidates.value.find(model => model.id === id);
    if (!found || taken.has(found.id)) continue;
    taken.add(found.id);
    draft.value = [...draft.value, { id: found.id, label: found.label ?? found.id }];
    added++;
  }
  if (added) ElMessage.success(`已加入 ${added} 个模型`);
}

async function pullModels() {
  if (pulling.value) return;
  if (!isValidUrl(props.channel.apiUrl.trim())) {
    error.value = "请先在渠道行里填写正确的 API 地址（http/https）";
    return;
  }
  error.value = "";
  pulling.value = true;
  try {
    const { data } = await axios.post<{ code: number; data: MediaChannelModel[]; message: string }>("/api/mediaChannel/models",
      { id: props.channel.id, apiUrl: props.channel.apiUrl.trim(), apiKey: props.channel.apiKey.trim() }, { timeout: 35000 });
    if (data.code !== 200 || !Array.isArray(data.data)) throw new Error(data.message || "获取模型列表失败");
    if (!data.data.length) throw new Error("该地址未返回模型列表，请手动添加模型 ID");
    candidates.value = data.data.map(model => ({ id: model.id, label: model.label }));
    picked.value = data.data.filter(model => draft.value.some(item => item.id === model.id)).map(model => model.id);
    ElMessage.success(`获取到 ${data.data.length} 个模型`);
  } catch (err) {
    error.value = axios.isAxiosError(err) ? err.response?.data?.message || err.message : err instanceof Error ? err.message : "获取模型列表失败，请重试";
  } finally { pulling.value = false; }
}

function confirm() {
  emit("picked", draft.value.map(model => ({ ...model })));
  visible.value = false;
}
</script>

<style lang="scss" scoped>
.dialogHint {
  display: block;
  margin-bottom: 12px;
  overflow-wrap: anywhere;
}

.modelToolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;

  .modelInput {
    flex: 1;
    min-width: 220px;
  }
}

.selectedBox {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;

  .selectedTags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
}

.candidateBox {
  padding: 8px 12px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);

  .candidateHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 4px;
  }

  .candidateList {
    display: flex;
    flex-direction: column;
    width: 100%;
  }
}

.dialogError {
  margin-top: 12px;
}
</style>
