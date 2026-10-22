<template>
  <el-button :disabled="store.busy || !versionId" @click="open">检查 / 重新定位文件</el-button>
  <el-dialog v-model="visible" title="检查固定版本文件" width="min(640px, 94vw)" appendToBody :closeOnClickModal="false" :closeOnPressEscape="!busy" :showClose="!busy" :beforeClose="close">
    <section class="fileRecovery" :aria-busy="busy">
      <p>文件移动后，选择内容相同的原文件补回。版本编号、镜头引用和历史记录保持不变。</p>
      <el-button :disabled="busy" @click="inspect">重新检查</el-button>
      <p v-if="inspection && !inspection.files.length">此版本仅含文字设定，无需定位文件。</p>
      <article v-for="file in inspection?.files" :key="file.index">
        <h4>{{ file.view || `参考文件 ${file.index + 1}` }} · {{ statusLabels[file.status] }}</h4>
        <p class="filePath">{{ file.path }}</p><p>{{ file.message }}</p>
        <el-button v-if="file.status === 'missing'" :disabled="busy" @click="choose(file.index)">选择原文件补回</el-button>
      </article>
      <form v-if="selectedIndex !== undefined" @submit.prevent="prepare">
        <label>选择原文件<input :key="selectionToken" type="file" :disabled="busy" @change="selectFile" /></label>
        <p v-if="selectedFile">{{ selectedFile.name }} · {{ selectedFile.size.toLocaleString() }} 字节</p>
        <el-button nativeType="submit" :disabled="busy || !selectedFile">核对所选原文件</el-button>
      </form>
      <section v-if="prepared" class="confirmedFile">
        <h4>原文件核对通过</h4><p>{{ prepared.bytes.toLocaleString() }} 字节，内容与原固定版本完全一致。</p>
        <p>补回到上方记录的项目位置；不会创建新版本。</p>
        <el-button type="primary" :disabled="busy || store.busy" @click="restore">确认补回原文件</el-button>
      </section>
      <p v-if="message" role="status">{{ message }}</p><p v-if="error" class="fileError" role="alert">{{ error }}</p>
      <footer><el-button :disabled="busy" @click="close(() => visible = false)">关闭</el-button></footer>
    </section>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import axios from "axios";
import type { PreparedFileRecovery, VersionFileInspection } from "@toonflow/server/production";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { productionError, useProductionStore } from "@/stores/production";
const props = defineProps<{ directory: string; versionId: string }>();
const emit = defineEmits<{ restored: [] }>();
const store = useProductionStore();
const visible = ref(false); const busy = ref(false); const error = ref(""); const message = ref("");
const inspection = ref<VersionFileInspection>(); const prepared = ref<PreparedFileRecovery>();
const selectedIndex = ref<number>(); const selectedFile = ref<File>(); const selectionToken = ref(0);
const statusLabels = { available: "正常", missing: "文件缺失", changed: "内容已变化", unreadable: "无法读取" };
const headers = { "x-toonflow-workspace": "1" };
let epoch = 0; let uploadedPath = ""; let recoveryId = ""; let createdAt = 0;
function resetSelection() { selectedIndex.value = undefined; selectedFile.value = undefined; prepared.value = undefined; uploadedPath = ""; recoveryId = ""; ++selectionToken.value; }
function close(done: () => void) { if (!busy.value) { ++epoch; done(); } }
function open() { visible.value = true; message.value = ""; void inspect(); }
async function inspect() {
  const request = ++epoch; const directory = props.directory; const versionId = props.versionId;
  busy.value = true; error.value = ""; inspection.value = undefined; resetSelection();
  try { const { data } = await axios.get<{ data: VersionFileInspection }>("/api/production/files/inspect", { params: { directory, versionId }, headers }); if (request === epoch) inspection.value = data.data; }
  catch (cause) { if (request === epoch) error.value = productionError(cause); }
  finally { if (request === epoch) busy.value = false; }
}
function choose(index: number) { resetSelection(); selectedIndex.value = index; error.value = ""; message.value = ""; }
function selectFile(event: Event) { prepared.value = undefined; uploadedPath = ""; recoveryId = ""; const file = (event.target as HTMLInputElement).files?.[0]; selectedFile.value = undefined; error.value = ""; if (file && file.size > 100 * 1024 * 1024) { error.value = "原文件不能超过 100 MB"; return; } selectedFile.value = file; }
async function prepare() {
  if (busy.value || !inspection.value || !selectedFile.value || selectedIndex.value === undefined) return;
  const request = ++epoch; const directory = props.directory; const versionId = props.versionId; const fileIndex = selectedIndex.value;
  const revision = inspection.value.revision; const file = selectedFile.value; const fixedFile = inspection.value.files.find(item => item.index === fileIndex);
  if (!fixedFile) return;
  busy.value = true; error.value = ""; prepared.value = undefined;
  try {
    store.requireDirectory(directory);
    if (!uploadedPath) {
      const files = useWorkspaceFiles(directory); const list = await files.list();
      if (!list.entries.some(item => item.path === "productionImports")) await files.mkdir("productionImports").catch(cause => { if (!axios.isAxiosError(cause) || cause.response?.status !== 409) throw cause; });
      recoveryId = crypto.randomUUID(); createdAt = Date.now(); const folder = `productionImports/${recoveryId}`;
      await files.mkdir(folder); store.requireDirectory(directory);
      const extension = fixedFile.path.match(/\.[a-z0-9]{1,10}$/i)?.[0] || ".bin";
      const path = `${folder}/original${extension}`; await files.write(path, file, true);
      if (request !== epoch) return; uploadedPath = path;
    }
    store.requireDirectory(directory);
    const { data } = await axios.post<{ data: PreparedFileRecovery }>("/api/production/files/prepare", { directory, expectedRevision: revision, input: { recoveryId, versionId, fileIndex, path: uploadedPath, createdAt } }, { headers });
    if (request === epoch) prepared.value = data.data;
  } catch (cause) { if (request === epoch) error.value = productionError(cause); }
  finally { if (request === epoch) busy.value = false; }
}
async function restore() {
  if (!prepared.value || busy.value) return;
  const request = ++epoch; const directory = props.directory; const input = JSON.parse(JSON.stringify(prepared.value)) as PreparedFileRecovery;
  busy.value = true; error.value = "";
  try { await store.update(input.operation, directory, input.revision); if (request === epoch) { emit("restored"); message.value = "原文件已补回，固定版本和已有引用保持不变。"; await inspect(); } }
  catch (cause) { if (request === epoch) error.value = productionError(cause); }
  finally { if (request === epoch) busy.value = false; }
}
watch([() => props.directory, () => props.versionId], () => { ++epoch; busy.value = false; visible.value = false; inspection.value = undefined; resetSelection(); });
onBeforeRouteLeave(() => !busy.value);
</script>

<style scoped lang="scss">
.fileRecovery { display: grid; gap: 14px; p { margin: 0; line-height: 1.7; } article { border-top: 1px solid var(--el-border-color-light); padding-top: 12px; display: grid; gap: 8px; h4 { margin: 0; } } .filePath { color: var(--el-text-color-secondary); font-size: 12px; overflow-wrap: anywhere; } form { display: grid; gap: 10px; label { display: grid; gap: 8px; input { max-width: 100%; } } } .confirmedFile { border: 1px solid var(--el-color-success); border-radius: 6px; padding: 14px; display: grid; gap: 10px; h4 { margin: 0; } } .fileError { color: var(--el-color-danger); } footer { display: flex; justify-content: end; } .el-button { justify-self: start; margin-left: 0; } }
</style>
