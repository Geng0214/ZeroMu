<template>
  <section class="productionAssets">
    <div class="assetTools"><label>类别<select v-model="kind"><option value="">全部素材</option><option v-for="(label, value) in kindLabels" :key="value" :value="value">{{ label }}</option></select></label><el-button type="primary" :disabled="store.busy" @click="createAsset">新建素材</el-button><el-button :disabled="store.busy" @click="libraryVisible = true">从全局素材库带入</el-button></div>
    <p v-if="!assets.length" class="assetHint">建立角色、场景、道具或媒体资料，每次修改保存为独立版本。</p>
    <nav class="assetChoices" aria-label="项目素材"><button v-for="asset in assets" :key="asset.assetId" :class="{ activeAsset: asset.assetId === selectedAssetId }" :disabled="store.busy" @click="selectedAssetId = asset.assetId">{{ asset.name }}<span>{{ kindLabels[asset.kind] }} · {{ asset.versionIds.length }} 版</span></button></nav>
    <section v-if="asset" class="assetDetail">
      <header><h3>{{ asset.name }}</h3><el-button size="small" :disabled="store.busy" @click="renameAsset">改名</el-button><el-button size="small" text :disabled="store.busy" @click="archiveAsset">归档</el-button></header>
      <div class="versionTools"><label>查看固定版本<select v-model="versionId" :disabled="store.busy"><option v-for="(item, index) in versions" :key="item.versionId" :value="item.versionId">v{{ index + 1 }} · {{ item.description || new Date(item.createdAt).toLocaleString() }}</option></select></label><el-button :disabled="store.busy" @click="editVersion">新增版本</el-button><el-button :disabled="store.busy" @click="importTask">从任务结果登记</el-button></div>
      <p class="assetHint">新增版本后，已有镜头继续引用原版本。需要替换时，在下方选择更新范围。</p>
      <template v-if="version"><versionFileRecovery :directory="store.directory" :versionId="version.versionId" @restored="previewToken++" /><versionPreview :key="`${version.versionId}:${previewToken}`" :directory="store.directory" :version="version" :label="asset.name" :active="store.visible && store.panel === 'assets'" /><p v-if="version.description">{{ version.description }}</p><dl class="versionDetails"><template v-for="(value, key) in displayedDetails" :key="key"><dt>{{ detailLabel(String(key)) }}</dt><dd>{{ typeof value === 'string' ? value : JSON.stringify(value) }}</dd></template></dl><section v-if="librarySource" class="libraryOrigin"><h4>全局素材来源</h4><p>{{ librarySource.metadata.title || librarySource.path }}</p><p class="assetHint">{{ librarySource.path }} · {{ librarySource.metadata.source || '本地全局素材' }}</p><p class="assetHint">{{ librarySource.metadata.category }} {{ librarySource.metadata.tags.join('、') }}</p><p class="assetHint">此版本保存在项目中，全局原件后续变化不会改动它。</p></section><details><summary>版本依据</summary><p class="assetHint">{{ version.versionId }} · {{ sourceLabels[version.source] }}<br />{{ version.contentHash }}</p><p v-for="file in version.files" :key="file.path" class="assetHint">{{ file.view || '参考' }} · {{ file.path }}</p></details></template>
      <referenceUpdatePanel :key="asset.assetId" :directory="store.directory" :assetId="asset.assetId" :versionId="versionId" :impact="impact" :loading="impactLoading" @refresh="loadImpact" @locate="showShot" /><p v-if="impactError" class="assetError" role="alert">{{ impactError }}</p>
    </section>
    <el-dialog v-model="editing" :title="`新增${asset ? kindLabels[asset.kind] : '素材'}版本`" width="min(600px, 94vw)" appendToBody :closeOnClickModal="false" :closeOnPressEscape="false" :showClose="!saving" :beforeClose="closeEditor">
      <form class="versionForm" @submit.prevent="saveVersion"><label>版本说明<input v-model="draft.description" maxlength="10000" placeholder="例如：雨天外套、傍晚布景" /></label><label>文字设定<textarea v-model="draft.text" rows="3" maxlength="100000" /></label><div class="detailFields"><label v-for="field in detailFields" :key="field.key">{{ field.label }}<input v-model="draft.details[field.key]" maxlength="2000" /></label></div>
        <label v-if="!taskMode">添加参考文件<input type="file" multiple accept="image/*,video/*,audio/*,.txt,.json" @change="selectFiles" /></label>
        <label v-if="!taskMode && version?.files.length" class="keepFiles"><input v-model="keepFiles" type="checkbox" />复制当前版本的参考文件到新版</label>
        <div v-for="(item, index) in uploads" :key="index" class="uploadRow"><span>{{ item.file.name }}</span><label>视图<input v-model="item.view" maxlength="100" placeholder="正面、侧面、造型等" /></label></div>
        <template v-if="taskMode"><label>已保存任务<select v-model="selectedTaskId"><option value="">选择任务</option><option v-for="task in tasks" :key="task.id" :value="task.id">{{ mediaLabels[task.mediaType] }} · {{ task.request.prompt.slice(0, 60) }} · {{ task.id.slice(0, 8) }}</option></select></label><label v-for="result in selectedTask?.results" :key="result.path" class="taskResult"><input v-model="taskPaths" type="checkbox" :value="result.path" />{{ result.path }}</label><p v-if="!tasks.length" class="assetHint">此项目最近 100 个任务中还没有已保存结果。</p></template>
        <p class="assetHint">文件会保存为新的固定版本；每个上传文件最多 100 MB。</p><p v-if="formError" class="assetError" role="alert">{{ formError }}</p><div class="formActions"><el-button :disabled="saving" @click="closeEditor(() => editing = false)">取消</el-button><el-button type="primary" nativeType="submit" :loading="saving" :disabled="store.busy">保存新版本</el-button></div>
      </form>
    </el-dialog>
    <libraryImportDialog v-model="libraryVisible" :initialDirectory="store.directory" @imported="selectImported" />
    <el-dialog v-model="creating" title="新建项目素材" width="min(430px, 94vw)" appendToBody :closeOnClickModal="false"><form class="versionForm" @submit.prevent="saveAsset"><label>类别<select v-model="newKind"><option v-for="(label, value) in kindLabels" :key="value" :value="value">{{ label }}</option></select></label><label>名称<input v-model="newName" required maxlength="200" /></label><p v-if="formError" class="assetError" role="alert">{{ formError }}</p><div class="formActions"><el-button type="primary" nativeType="submit" :loading="store.busy">建立素材</el-button></div></form></el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, reactive, ref, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import axios from "axios";
import { ElMessageBox } from "element-plus";
import type { AssetVersion, ProjectRecord } from "@toonflow/server/production";
import type { MediaTaskRecord } from "@toonflow/tools-scaffold/runtime";
import { useProductionStore, productionError } from "@/stores/production";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import versionPreview from "./versionPreview.vue";
import versionFileRecovery from "./versionFileRecovery.vue";
import referenceUpdatePanel from "./referenceUpdatePanel.vue";
import libraryImportDialog from "@/components/libraryImportDialog.vue";
import { librarySourceSchema } from "@toonflow/server/production";
const libraryVisible = ref(false);
function selectImported(assetId: string, id: string) { kind.value = ""; selectedAssetId.value = assetId; versionId.value = id; }
import type { AssetImpact } from "@toonflow/server/production/references";
const props = defineProps<{ focusId: string; focusToken: string }>();
const store = useProductionStore();
const focusShot = inject<(id: string) => void>("focusProductionShot");
type AssetKind = ProjectRecord["assets"][number]["kind"];
const kindLabels: Record<AssetKind, string> = { character: "角色", scene: "场景", prop: "道具", image: "图片", video: "视频", audio: "音频", text: "文本" };
const sourceLabels = { import: "导入", generation: "任务生成", edit: "编辑版本", director: "导演台" };
const mediaLabels = { image: "图片", video: "视频", audio: "音频" };
const fields: Record<string, { key: string; label: string }[]> = {
  character: [{ key: "age", label: "年龄" }, { key: "height", label: "身高" }, { key: "appearance", label: "外貌与体型" }, { key: "costume", label: "服装与造型" }, { key: "temperament", label: "气质" }, { key: "voice", label: "声音设定" }],
  scene: [{ key: "space", label: "空间与尺度" }, { key: "style", label: "风格" }, { key: "lighting", label: "光线与时间" }, { key: "layout", label: "布局" }],
  prop: [{ key: "material", label: "材质" }, { key: "size", label: "尺寸" }, { key: "appearance", label: "外观" }, { key: "purpose", label: "用途" }],
};
const kind = ref("");
const assets = computed(() => store.project?.assets.filter(item => !item.archived && (!kind.value || item.kind === kind.value)) || []);
const selectedAssetId = ref("");
const asset = computed(() => assets.value.find(item => item.assetId === selectedAssetId.value));
const versions = computed(() => store.project?.assetVersions.filter(item => item.assetId === asset.value?.assetId) || []);
const versionId = ref("");
const previewToken = ref(0);
const version = computed(() => versions.value.find(item => item.versionId === versionId.value));
const displayedDetails = computed(() => Object.fromEntries(Object.entries(version.value?.details || {}).filter(([key, value]) => key !== "librarySource" && value !== "" && value !== null)));
const librarySource = computed(() => { const checked = librarySourceSchema.safeParse(version.value?.details.librarySource); return checked.success ? checked.data : undefined; });
const detailFields = computed(() => fields[asset.value?.kind || ""] || []);
const creating = ref(false); const newKind = ref<AssetKind>("character"); const newName = ref("");
const editing = ref(false); const saving = ref(false); const formError = ref("");
const draft = reactive({ description: "", text: "", details: {} as Record<string, string> });
const uploads = ref<{ file: File; view: string }[]>([]); const keepFiles = ref(true);
const taskMode = ref(false); const tasks = ref<MediaTaskRecord[]>([]); const selectedTaskId = ref(""); const taskPaths = ref<string[]>([]);
const selectedTask = computed(() => tasks.value.find(item => item.id === selectedTaskId.value));
const impact = ref<AssetImpact>(); const impactLoading = ref(false); const impactError = ref("");
let editDirectory = ""; let editAssetId = ""; let parentVersion: AssetVersion | undefined; let initialDraft = ""; let impactEpoch = 0;
watch(assets, value => { if (!value.some(item => item.assetId === selectedAssetId.value)) selectedAssetId.value = value[0]?.assetId || ""; }, { immediate: true });
watch([() => props.focusId, () => props.focusToken], ([id]) => { if (id) { kind.value = ""; selectedAssetId.value = id; } }, { immediate: true });
watch(asset, value => { if (!value?.versionIds.includes(versionId.value)) versionId.value = value?.activeVersionId || value?.versionIds.at(-1) || ""; void loadImpact(); }, { immediate: true });
watch(selectedTaskId, () => { taskPaths.value = selectedTask.value?.results.map(item => item.path) || []; });
watch(() => store.directory, () => { ++impactEpoch; impact.value = undefined; selectedAssetId.value = ""; editing.value = false; creating.value = false; });
function detailLabel(key: string) { return detailFields.value.find(field => field.key === key)?.label || key; }
function showShot(id: string) { focusShot?.(id); }
function createAsset() { editDirectory = store.directory; newName.value = ""; newKind.value = (kind.value || "character") as AssetKind; formError.value = ""; creating.value = true; }
async function saveAsset() { const path = editDirectory; try { const result = await store.update({ type: "createAsset", name: newName.value, kind: newKind.value }, path); if (path === store.directory) { kind.value = ""; selectedAssetId.value = result.resultId || ""; creating.value = false; editVersion(); } } catch (cause) { if (path === store.directory) formError.value = productionError(cause); } }
function draftFingerprint() { return JSON.stringify([draft, uploads.value.map(item => [item.file.name, item.file.size, item.view]), keepFiles.value, selectedTaskId.value, taskPaths.value]); }
function editVersion() { if (!asset.value) return; editDirectory = store.directory; editAssetId = asset.value.assetId; parentVersion = version.value; draft.description = ""; draft.text = version.value?.text || ""; draft.details = Object.fromEntries(detailFields.value.map(field => [field.key, String(version.value?.details[field.key] || "")])); uploads.value = []; keepFiles.value = true; taskMode.value = false; selectedTaskId.value = ""; taskPaths.value = []; formError.value = ""; initialDraft = draftFingerprint(); editing.value = true; }
async function closeEditor(done: () => void) { if (saving.value) return; if (initialDraft !== draftFingerprint()) { const leave = await ElMessageBox.confirm("新版本尚未保存，关闭后将丢弃这些修改。", "未保存的版本", { confirmButtonText: "丢弃修改", cancelButtonText: "继续编辑" }).then(() => true, () => false); if (!leave) return; } done(); }
function selectFiles(event: Event) { const selected = Array.from((event.target as HTMLInputElement).files || []); if (selected.some(file => file.size > 100 * 1024 * 1024)) { formError.value = "单个参考文件不能超过 100 MB"; return; } uploads.value = selected.map(file => ({ file, view: "" })); formError.value = ""; }
async function importTask() { editVersion(); const path = editDirectory; taskMode.value = true; keepFiles.value = false; tasks.value = []; try { const { data } = await axios.get<{ data: { tasks: MediaTaskRecord[] } }>("/api/ai/media/tasks/list", { params: { directory: path, limit: 100 }, headers: { "x-toonflow-workspace": "1" } }); if (store.directory !== path || !editing.value) return; tasks.value = data.data.tasks.filter(task => task.results.length); } catch (cause) { if (store.directory === path) formError.value = productionError(cause); } if (store.directory === path) initialDraft = draftFingerprint(); }
async function saveVersion() {
  if (saving.value) return;
  saving.value = true; formError.value = "";
  const path = editDirectory; const localFiles = useWorkspaceFiles(path);
  // 点击保存时固定整个输入，后续上传与切换项目不能改变这次版本的内容。
  const uploadSnapshot = uploads.value.map(item => ({ file: item.file, view: item.view }));
  const versionInput = { assetId: editAssetId, parentVersionId: parentVersion?.versionId, text: draft.text, description: draft.description, details: JSON.parse(JSON.stringify({ ...parentVersion?.details, ...draft.details })), source: taskMode.value ? "generation" as const : parentVersion ? "edit" as const : "import" as const, taskId: taskMode.value ? selectedTask.value?.id : undefined };
  const inputFiles: { path: string; mimeType: string; view?: string }[] = taskMode.value ? selectedTask.value?.results.filter(result => taskPaths.value.includes(result.path)).map(result => ({ path: result.path, mimeType: result.mimeType })) || [] : keepFiles.value ? parentVersion?.files.map(({ path, mimeType, view }) => ({ path, mimeType, view })) || [] : [];
  try {
    store.requireDirectory(path);
    if (uploadSnapshot.length) {
      const entries = await localFiles.list();
      if (!entries.entries.some(item => item.path === "productionImports")) await localFiles.mkdir("productionImports").catch(cause => { if (!axios.isAxiosError(cause) || cause.response?.status !== 409) throw cause; });
      const folder = `productionImports/${crypto.randomUUID()}`; await localFiles.mkdir(folder);
      for (const [index, item] of uploadSnapshot.entries()) { store.requireDirectory(path); const extension = item.file.name.match(/\.[a-z0-9]{1,10}$/i)?.[0] || ".bin"; const filePath = `${folder}/reference${index + 1}${extension}`; await localFiles.write(filePath, item.file, true); inputFiles.push({ path: filePath, mimeType: item.file.type || "application/octet-stream", view: item.view || undefined }); }
    }
    if (!inputFiles.length && !versionInput.text.trim()) throw new Error("请填写文字设定或添加参考文件");
    const result = await store.update({ type: "createAssetVersion", ...versionInput, files: inputFiles }, path);
    if (path === store.directory) { editing.value = false; versionId.value = result.resultId || ""; }
  } catch (cause) { if (path === store.directory) formError.value = productionError(cause); }
  finally { saving.value = false; }
}
async function renameAsset() { if (!asset.value) return; const id = asset.value.assetId; const path = store.directory; const answer = await ElMessageBox.prompt("素材编号和旧版本保持不变", "修改素材名称", { inputValue: asset.value.name, inputValidator: value => !!value?.trim() && value.length <= 200 }).catch(() => null); if (answer) try { await store.update({ type: "renameAsset", assetId: id, name: answer.value }, path); } catch (cause) { impactError.value = productionError(cause); } }
async function archiveAsset() { if (!asset.value) return; const id = asset.value.assetId; const path = store.directory; const okay = await ElMessageBox.confirm("有关联镜头、候选、草案或导出时无法归档；文件与历史版本会保留。", `归档「${asset.value.name}」`, { confirmButtonText: "归档素材", cancelButtonText: "保留" }).then(() => true, () => false); if (okay) try { await store.update({ type: "deleteAsset", assetId: id }, path); } catch (cause) { impactError.value = productionError(cause); } }
async function loadImpact() { const request = ++impactEpoch; if (impact.value?.asset.assetId !== asset.value?.assetId) impact.value = undefined; impactError.value = ""; if (!asset.value) { impactLoading.value = false; return; } impactLoading.value = true; const path = store.directory; try { const { data } = await axios.get<{ data: AssetImpact }>("/api/production/impact", { params: { directory: path, assetId: asset.value.assetId }, headers: { "x-toonflow-workspace": "1" } }); if (request === impactEpoch && path === store.directory) impact.value = data.data; } catch (cause) { if (request === impactEpoch) impactError.value = productionError(cause); } finally { if (request === impactEpoch) impactLoading.value = false; } }
onBeforeRouteLeave(async () => { if (saving.value || store.busy) return false; if (!editing.value && !creating.value) return true; if (creating.value && newName.value.trim()) { const leave = await ElMessageBox.confirm("素材名称尚未保存，关闭后将丢弃。", "未保存的素材", { confirmButtonText: "丢弃修改", cancelButtonText: "继续编辑" }).then(() => true, () => false); if (!leave) return false; } if (!editing.value) return true; let leave = false; await closeEditor(() => { leave = true; editing.value = false; }); return leave; });
</script>

<style scoped lang="scss">
.productionAssets {
  .assetTools, .versionTools { display: flex; align-items: end; flex-wrap: wrap; gap: 8px; label { flex: 1; min-width: 160px; } .el-button { margin-left: 0; } }
  .assetChoices { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin: 16px 0; button { border: 1px solid var(--el-border-color-light); border-radius: 6px; background: transparent; padding: 12px; color: var(--el-text-color-primary); text-align: left; font: inherit; cursor: pointer; &.activeAsset { border-color: var(--el-color-primary); } span { display: block; margin-top: 5px; color: var(--el-text-color-secondary); font-size: 12px; } } }
  .assetDetail { > header, .assetImpact header { display: flex; align-items: center; gap: 8px; h3, h4 { flex: 1; font-size: 15px; } } .versionDetails { display: grid; grid-template-columns: 100px 1fr; font-size: 13px; gap: 8px; dt { color: var(--el-text-color-secondary); } dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; } } details { summary { cursor: pointer; } } .assetImpact { margin-top: 20px; border-top: 1px solid var(--el-border-color-light); ul { padding: 0; list-style: none; } li { display: flex; gap: 10px; margin: 10px 0; font-size: 12px; button { font: inherit; color: var(--el-color-primary); background: none; border: 0; padding: 0; cursor: pointer; } } } }
  .assetHint { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
  .assetError { color: var(--el-color-danger); }
}
.versionForm { display: grid; gap: 14px; .detailFields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; } .uploadRow { display: grid; grid-template-columns: 1fr 1fr; align-items: center; gap: 8px; span { overflow-wrap: anywhere; } } .keepFiles, .taskResult { display: flex; align-items: center; gap: 8px; overflow-wrap: anywhere; } .assetHint { color: var(--el-text-color-secondary); font-size: 12px; } .assetError { color: var(--el-color-danger); } .formActions { display: flex; gap: 8px; justify-content: end; } }
</style>
