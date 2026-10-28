<template>
  <el-dialog :modelValue="modelValue" title="从全局素材库带入工作空间" width="min(660px, 94vw)" appendToBody :closeOnClickModal="false" :closeOnPressEscape="!busy" :showClose="!busy" :beforeClose="close" @update:modelValue="emit('update:modelValue', $event)">
    <section class="libraryImport" :aria-busy="busy">
      <p>带入后保存为项目独立的固定版本，已有镜头继续使用原版本。</p>
      <fieldset :disabled="busy || !!applied">
        <label>目标工作空间<workspacePicker v-model="directory" :disabled="busy || !!applied" /></label>
        <p class="filePath">{{ directory || '请选择目标项目目录' }}</p>
        <el-button v-if="directory && !project && !loading" @click="createProject">在此目录建立制作记录</el-button>
        <template v-if="project">
          <label>全局素材<select v-model="path" aria-label="带入的全局素材" :disabled="resuming"><option value="">选择素材</option><option v-for="item in assets" :key="item.path" :value="item.path">{{ item.title }} · {{ item.path }}</option></select></label>
          <template v-if="!resuming">
            <label>带入方式<select v-model="mode" aria-label="带入方式"><option value="new">建立独立素材</option><option value="version">作为现有素材的新版本</option></select></label>
            <template v-if="mode === 'new'"><label>素材名称<input v-model="name" maxlength="200" /></label><label>类别<select v-model="kind" aria-label="素材类别"><option v-for="(label, key) in kindLabels" :key="key" :value="key">{{ label }}</option></select></label></template>
            <template v-else><label>目标素材<select v-model="assetId" aria-label="目标素材"><option value="">选择素材</option><option v-for="asset in project.assets.filter(item => !item.archived)" :key="asset.assetId" :value="asset.assetId">{{ asset.name }}</option></select></label><label>基于版本<select v-model="parentVersionId" aria-label="基于版本"><option value="">无父版本</option><option v-for="version in project.assetVersions.filter(item => item.assetId === assetId)" :key="version.versionId" :value="version.versionId">{{ version.description || new Date(version.createdAt).toLocaleString() }}</option></select></label></template>
          </template>
          <p v-if="resuming" role="status">正在继续原带入输入，保留原名称、类别和父版本。{{ path }}</p>
          <div class="actions"><el-button :disabled="!path" @click="prepare">{{ resuming ? '重新核对原带入' : '核对带入内容' }}</el-button><el-button @click="loadProject">刷新制作记录</el-button></div>
          <details v-if="pending.length"><summary>待完成的带入（{{ pending.length }}）</summary><button v-for="item in pending" :key="item.importId" @click="resume(item)">{{ targetLabel(item) }} · {{ item.source.metadata.title || item.source.path }} · {{ item.importId.slice(0, 8) }} · 继续原输入</button></details>
        </template>
      </fieldset>
      <section v-if="preview" class="importPreview">
        <h4>本次带入核对</h4><p>{{ preview.operation.source.metadata.title || preview.operation.source.path }} · {{ preview.operation.source.bytes.toLocaleString() }} 字节</p>
        <p>{{ targetLabel(preview.operation) }}</p><p>{{ preview.frozen ? '使用中断时已保存的原副本' : '确认时将再次核对全局原件' }}</p>
        <p v-if="preview.operation.source.metadata.description">{{ preview.operation.source.metadata.description }}</p>
        <p v-if="preview.warning">{{ preview.warning }}</p>
        <details><summary>来源和内容摘要</summary><p class="filePath">{{ preview.operation.source.path }}<br />{{ preview.operation.source.hash }}</p><p>{{ preview.operation.source.metadata.source || '本地全局素材' }}</p><p>{{ preview.operation.source.metadata.category }} {{ preview.operation.source.metadata.tags.join('、') }}</p></details>
        <el-button v-if="!applied" type="primary" :disabled="busy" @click="apply">确认带入固定版本</el-button>
      </section>
      <p v-if="applied" role="status">已保存为项目独立固定版本。全局原件后续改动不会改变这个版本。</p>
      <p v-if="warning" class="hint">{{ warning }}</p><p v-if="error" class="importError" role="alert">{{ error }}</p>
      <footer><el-button :disabled="busy" @click="close(() => emit('update:modelValue', false))">关闭</el-button><el-button v-if="applied" type="primary" :disabled="busy" @click="openProject">打开我的素材</el-button></footer>
    </section>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter, onBeforeRouteLeave } from "vue-router";
import axios from "axios";
import type { LibraryImportOperation, LibraryImportPreview, ProjectRecord } from "@toonflow/server/production";
import { mentionAssetType } from "@toonflow/server/agent/mentionSources";
import workspacePicker from "@/pages/home/workspacePicker.vue";
import { productionError, useProductionStore } from "@/stores/production";
import { useWorkspaceStore } from "@/stores/workspace";
const props = defineProps<{ modelValue: boolean; sourcePath?: string; initialDirectory?: string }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean]; imported: [assetId: string, versionId: string] }>();
const store = useProductionStore(); const workspace = useWorkspaceStore(); const router = useRouter();
const headers = { "x-toonflow-workspace": "1" };
const directory = ref(""); const path = ref(""); const name = ref(""); const kind = ref<ProjectRecord["assets"][number]["kind"]>("image");
const mode = ref<"new" | "version">("new"); const assetId = ref(""); const parentVersionId = ref("");
const project = ref<ProjectRecord | null>(null); const pending = ref<LibraryImportOperation[]>([]);
const assets = ref<{ path: string; title: string }[]>([]); const preview = ref<LibraryImportPreview>();
const resuming = ref(false); const resumedInput = ref<LibraryImportOperation>(); const applied = ref<{ assetId: string; versionId: string }>();
const loading = ref(false); const saving = ref(false); const busy = computed(() => loading.value || saving.value);
const error = ref(""); const warning = ref("");
const kindLabels = { character: "角色", scene: "场景", prop: "道具", image: "图片", video: "视频", audio: "音频", text: "文本" };
let epoch = 0; let importId = ""; let createdAt = 0;
function independent() { preview.value = undefined; applied.value = undefined; resuming.value = false; resumedInput.value = undefined; importId = crypto.randomUUID(); createdAt = Date.now(); }
function close(done: () => void) { if (!busy.value) { ++epoch; done(); } }
watch(() => props.modelValue, async visible => {
  if (!visible) { ++epoch; return; } independent(); mode.value = "new"; assetId.value = ""; parentVersionId.value = ""; error.value = ""; warning.value = "";
  directory.value = props.initialDirectory || workspace.project?.directory || ""; path.value = props.sourcePath || "";
  const request = ++epoch; loading.value = true;
  try {
    type Entry = { path: string; type: string; metadata?: { title?: string }; children?: Entry[] };
    const { data } = await axios.get<{ data: { entries: Entry[] } }>("/api/assets/list");
    const flatten = (items: Entry[]): { path: string; title: string }[] => items.flatMap(item => item.type === "directory" ? flatten(item.children || []) : [{ path: item.path, title: item.metadata?.title || item.path.split("/").at(-1)! }]);
    if (request === epoch) { assets.value = flatten(data.data.entries); setSourceDefaults(); }
  } catch (cause) { if (request === epoch) error.value = productionError(cause); }
  finally { if (request === epoch) { loading.value = false; await loadProject(); } }
}, { immediate: true });
watch(directory, () => { if (!props.modelValue || loading.value) return; independent(); assetId.value = ""; parentVersionId.value = ""; void loadProject(); });
watch([path, name, kind, mode, assetId, parentVersionId], () => { if (!resuming.value) independent(); });
watch(path, () => { if (!resuming.value) setSourceDefaults(); });
watch(assetId, () => { if (!resuming.value) parentVersionId.value = project.value?.assets.find(item => item.assetId === assetId.value)?.activeVersionId || ""; });
function setSourceDefaults() { name.value = (assets.value.find(item => item.path === path.value)?.title || path.value.split("/").at(-1) || "").slice(0, 200); const type = mentionAssetType(path.value).dataType; kind.value = type === "IMAGE" ? "image" : type === "VIDEO" ? "video" : type === "AUDIO" ? "audio" : type === "STRING" ? "text" : "prop"; }
async function loadProject() {
  const request = ++epoch; const target = directory.value; project.value = null; pending.value = []; preview.value = undefined; error.value = ""; warning.value = "";
  if (!target) { loading.value = false; return; } loading.value = true;
  try { const [record, unfinished] = await Promise.all([axios.get<{ data: { project: ProjectRecord | null } }>("/api/production/get", { params: { directory: target }, headers }), axios.get<{ data: { items: LibraryImportOperation[]; warnings: string[] } }>("/api/production/library/pending", { params: { directory: target }, headers })]); if (request === epoch) { project.value = record.data.data.project; pending.value = unfinished.data.data.items; warning.value = unfinished.data.data.warnings.join("；"); } }
  catch (cause) { if (request === epoch) error.value = productionError(cause); }
  finally { if (request === epoch) loading.value = false; }
}
async function createProject() { if (busy.value) return; saving.value = true; const target = directory.value; try { await axios.post("/api/production/create", { directory: target, name: target.split(/[\\/]/).at(-1) }, { headers }); if (target === directory.value) await loadProject(); } catch (cause) { error.value = productionError(cause); } finally { saving.value = false; } }
function resume(operation: LibraryImportOperation) { resuming.value = true; resumedInput.value = JSON.parse(JSON.stringify(operation)); path.value = operation.source.path; preview.value = undefined; applied.value = undefined; error.value = ""; }
function targetLabel(operation: LibraryImportOperation) { const target = operation.target; return target.mode === "new" ? `新建${kindLabels[target.kind]}：${target.name}` : `新增版本：${project.value?.assets.find(item => item.assetId === target.assetId)?.name || '原目标素材'}`; }
async function prepare() {
  if (!project.value || busy.value) return; const request = ++epoch; saving.value = true; error.value = ""; preview.value = undefined;
  try {
    const body = { directory: directory.value, expectedRevision: project.value.revision };
    const input = { importId, createdAt, path: path.value, target: mode.value === "new" ? { mode: "new", kind: kind.value, name: name.value } : { mode: "version", assetId: assetId.value, parentVersionId: parentVersionId.value || undefined } };
    const { data } = await axios.post<{ data: LibraryImportPreview }>(resuming.value ? "/api/production/library/preview" : "/api/production/library/prepare", { ...body, ...(resuming.value ? { operation: resumedInput.value } : { input }) }, { headers });
    if (request === epoch) preview.value = data.data;
  } catch (cause) { if (request === epoch) error.value = productionError(cause); }
  finally { if (request === epoch) saving.value = false; }
}
async function apply() {
  if (!preview.value || busy.value) return; const request = ++epoch; const target = directory.value; const pinned = JSON.parse(JSON.stringify(preview.value)) as LibraryImportPreview; saving.value = true; error.value = "";
  try {
    const { data } = await axios.post<{ data: { project: ProjectRecord; resultId: string } }>("/api/production/update", { directory: target, expectedRevision: pinned.revision, operation: pinned.operation }, { headers });
    if (request === epoch) { project.value = data.data.project; const version = data.data.project.assetVersions.find(item => item.versionId === data.data.resultId)!; applied.value = { assetId: version.assetId, versionId: version.versionId }; if (store.directory === target) { await store.load(); emit("imported", version.assetId, version.versionId); } }
  } catch (cause) { if (request === epoch) error.value = productionError(cause); }
  finally { if (request === epoch) saving.value = false; }
}
async function openProject() { if (!applied.value) return; saving.value = true; try { await workspace.openProject(directory.value); saving.value = false; emit("update:modelValue", false); await router.push("/workspace"); } catch (cause) { error.value = productionError(cause); } finally { saving.value = false; } }
onBeforeRouteLeave(() => !busy.value);
</script>

<style scoped lang="scss">
.libraryImport { display: grid; gap: 14px; p { margin: 0; line-height: 1.7; } fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: 12px; min-width: 0; label { display: grid; gap: 6px; font-size: 13px; input, select { width: 100%; min-width: 0; box-sizing: border-box; padding: 8px; background: var(--el-bg-color); color: var(--el-text-color-primary); border: 1px solid var(--el-border-color); border-radius: 4px; font: inherit; } } details > button { display: block; margin-top: 8px; padding: 8px; color: var(--el-text-color-primary); background: var(--el-fill-color-light); border: 1px solid var(--el-border-color); font: inherit; cursor: pointer; max-width: 100%; overflow-wrap: anywhere; } } .filePath { font-size: 12px; color: var(--el-text-color-secondary); overflow-wrap: anywhere; } .importPreview { border: 1px solid var(--el-border-color); border-radius: 6px; padding: 14px; display: grid; gap: 10px; h4 { margin: 0; } } .actions, footer { display: flex; gap: 8px; flex-wrap: wrap; .el-button { margin-left: 0; } } footer { justify-content: end; } .hint { color: var(--el-text-color-secondary); } .importError { color: var(--el-color-danger); } }
</style>
