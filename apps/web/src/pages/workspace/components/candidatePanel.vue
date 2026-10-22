<template>
  <section class="candidatePanel" aria-label="镜头候选">
    <header><h3>{{ shot.title }} · 候选</h3><span>最多同时比较 2 个</span></header>
    <div class="candidateImport"><label>登记已有媒体版本<select v-model="versionId"><option value="">选择图片、视频或音频版本</option><optgroup v-for="asset in mediaAssets" :key="asset.assetId" :label="asset.name"><option v-for="version in asset.versions" :key="version.versionId" :value="version.versionId">v{{ asset.versionIds.indexOf(version.versionId) + 1 }} · {{ version.description || new Date(version.createdAt).toLocaleString() }}</option></optgroup></select></label><label v-if="mediaFiles.length > 1">采用文件<select v-model.number="fileIndex" aria-label="候选媒体文件"><option v-for="file in mediaFiles" :key="file.index" :value="file.index">{{ file.label }}</option></select></label><el-button :disabled="!versionId || store.busy" @click="addCandidate">添加候选</el-button></div>
    <p v-if="!candidates.length" class="candidateHint">先在素材版本中导入媒体，或登记已保存的任务结果，再添加到此镜头。添加候选后可继续比较。</p>
    <div class="candidateChoices"><label v-for="(candidate, index) in candidates" :key="candidate.candidateId"><input type="checkbox" :checked="comparison.includes(candidate.candidateId)" :disabled="comparison.length === 2 && !comparison.includes(candidate.candidateId)" @change="toggleCandidate(candidate.candidateId)" />候选 {{ index + 1 }}{{ shot.adoptedCandidateId === candidate.candidateId ? ' · 已采用' : '' }}</label></div>
    <div v-if="hasImages" class="comparisonTools"><label>图片缩放<input v-model.number="imageZoom" type="range" aria-label="候选图片缩放" min="0.5" max="4" step="0.25" /><output>{{ Math.round(imageZoom * 100) }}%</output></label><el-button size="small" @click="imageZoom = 1">重置缩放</el-button></div>
    <div v-if="videos.length === 2" class="comparisonTools"><label>视频对齐位置<input :value="comparisonTime" type="range" aria-label="候选视频对齐时间" min="0" :max="maximumDuration" step="0.01" :disabled="!videosReady" @input="alignTime(Number(($event.target as HTMLInputElement).value))" /><output>{{ comparisonTime.toFixed(2) }} / {{ maximumDuration.toFixed(2) }} 秒</output></label><el-button size="small" :disabled="!videosReady" @click="comparisonPlaying ? pauseComparison() : playComparison()">{{ comparisonPlaying ? '暂停比较' : '对齐播放（静音）' }}</el-button><p class="candidateHint">共同范围 {{ minimumDuration.toFixed(2) }} 秒；较短片段到达结尾后停止。独立播放器可试听声音。</p></div>
    <div class="candidateComparison">
      <article v-for="candidate in compared" :key="candidate.candidateId">
        <h4>候选 {{ candidates.findIndex(item => item.candidateId === candidate.candidateId) + 1 }} <span v-if="shot.adoptedCandidateId === candidate.candidateId">已采用</span></h4>
        <versionPreview v-if="getVersion(candidate.versionId)" :ref="value => setPreview(candidate.candidateId, value)" :directory="store.directory" :version="getVersion(candidate.versionId)!" :fileIndex="candidateFileIndex(candidate)" :imageZoom="imageZoom" :label="`${shot.title}候选 ${candidates.indexOf(candidate) + 1}`" :active="store.visible && store.panel === 'storyboard'" @duration="durations[candidate.candidateId] = $event" @playing="onPlaying(candidate.candidateId)" @mediaState="onMediaState(candidate.candidateId, $event)" />
        <p v-if="durations[candidate.candidateId]" class="candidateHint">实际 {{ durations[candidate.candidateId]!.toFixed(2) }} 秒 · 与预计相差 {{ (durations[candidate.candidateId]! - shot.expectedDuration).toFixed(2) }} 秒</p>
        <p v-if="comparisonTime > (durations[candidate.candidateId] || Infinity) && mediaType(candidate) === 'video'" class="candidateHint" role="status">此候选已到结尾，不覆盖当前对齐位置。</p>
        <el-button type="primary" :disabled="store.busy || shot.adoptedCandidateId === candidate.candidateId" @click="adopt(candidate.candidateId)">{{ shot.adoptedCandidateId === candidate.candidateId ? '当前采用' : '采用此候选' }}</el-button>
        <el-button v-if="candidate.basis.directorShotId" :disabled="store.busy" @click="viewDirector(candidate.basis.directorShotId)">查看所用机位快照</el-button>
        <el-button v-if="editableImage(candidate)" :disabled="store.busy" @click="editingCandidateId = candidate.candidateId">编辑图片</el-button>
        <p v-if="candidate.parentCandidateId" class="candidateHint">由候选 {{ candidates.findIndex(item => item.candidateId === candidate.parentCandidateId) + 1 }} 编辑而来；当前采用仍由你选择。</p>
        <p v-if="candidateReferenceState(shot, candidate) === 'changed'" class="referenceChanged" role="status">镜头参考已变更，此候选保留原记录。采用前请核对差异。</p>
        <p v-else-if="candidateReferenceState(shot, candidate) === 'unknown'" class="candidateHint">未记录镜头参考快照，无法直接对照当前参考。</p>
        <details v-if="candidate.basis.shotReferences"><summary>镜头参考记录 · {{ candidateReferenceState(shot, candidate) === 'same' ? '与当前一致' : '与当前不同' }}</summary><p>记录时：</p><ol><li v-for="(reference, index) in candidate.basis.shotReferences" :key="index">{{ reference.role || '参考' }} · {{ referenceLabel(reference.assetId, reference.versionId) }}</li></ol><p v-if="!candidate.basis.shotReferences.length">无镜头参考</p><template v-if="candidateReferenceState(shot, candidate) === 'changed'"><p>当前镜头：</p><ol><li v-for="(reference, index) in shot.references" :key="index">{{ reference.role || '参考' }} · {{ referenceLabel(reference.assetId, reference.versionId) }}</li></ol><p v-if="!shot.references.length">无镜头参考</p><p class="candidateHint">参考资料的变化需要核对，不代表原文件被修改或必须重做。新生成需另行确认范围与预算。</p></template></details>
        <details v-if="getVersion(candidate.versionId)?.details.imageEdit"><summary>本地编辑依据</summary><p>{{ getVersion(candidate.versionId)?.description }}</p><p class="candidateHint">来源固定版本：{{ getVersion(candidate.versionId)?.parentVersionId }}</p></details>
        <details v-if="getVersion(candidate.versionId)?.details.backgroundRemoval"><summary>背景移除依据</summary><p>{{ getVersion(candidate.versionId)?.description }}</p><p class="candidateHint">来源固定版本：{{ getVersion(candidate.versionId)?.parentVersionId }}</p><pre>{{ JSON.stringify(getVersion(candidate.versionId)?.details.backgroundRemoval, null, 2) }}</pre></details>
        <details><summary>{{ getVersion(candidate.versionId)?.details.imageEdit ? '上游生成依据' : '生成依据' }}</summary><p v-if="candidate.basis.unknown" class="candidateHint">手动导入，生成参数不完整。</p><p v-if="candidate.taskId">任务：{{ candidate.taskId }}</p><p v-for="(reference, index) in candidate.basis.references" :key="index">{{ referenceLabel(reference.assetId, reference.versionId) }}</p><pre v-if="candidate.basis.request">{{ JSON.stringify(candidate.basis.request, null, 2) }}</pre><p class="candidateHint">媒体版本：{{ candidate.versionId }}</p></details>
      </article>
    </div>
    <details v-if="compared.length === 2" class="basisDiff"><summary>候选依据差异 · {{ differences.length }} 项</summary><p v-if="!differences.length" class="candidateHint">已记录的生成与编辑依据相同；未记录的参数仍为未知。</p><div v-for="difference in differences" :key="difference.label"><strong>{{ difference.label }}</strong><p v-for="(value, index) in difference.values" :key="index">候选 {{ candidates.indexOf(compared[index]!) + 1 }}：{{ value }}</p></div></details>
    <div v-if="undoAdoptionId" class="adoptionUndo"><el-button :disabled="store.busy || !canUndo" @click="undoAdoption">撤销本次采用</el-button><span v-if="!canUndo" class="candidateHint">采用状态已变化，可查看历史或恢复制作快照。</span></div>
    <details v-if="history.length" class="adoptionHistory"><summary>采用历史 · {{ history.length }} 次</summary><ol><li v-for="item in history" :key="item.adoptionId">{{ new Date(item.createdAt).toLocaleString() }} · {{ item.undoOfAdoptionId ? '撤销采用 · ' : '' }}{{ item.candidateId ? `采用候选 ${candidates.findIndex(candidate => candidate.candidateId === item.candidateId) + 1}` : '未采用' }}<span v-if="item.previousCandidateId">（原候选 {{ candidates.findIndex(candidate => candidate.candidateId === item.previousCandidateId) + 1 }}）</span></li></ol></details>
    <p v-if="error" class="candidateError" role="alert">{{ error }}</p>
    <div v-if="shot.adoptedCandidateId && shot.canvasId" class="projectionState"><p v-if="store.projectionErrors[shot.shotId]" class="candidateError" role="alert">采用记录已保存，画布待同步：{{ store.projectionErrors[shot.shotId] }}</p><el-button :disabled="store.busy" @click="syncAdopted">同步采用结果到画布</el-button></div>
    <imageCandidateEditor v-if="editingCandidateId" :key="editingCandidateId" :directory="store.directory" :candidateId="editingCandidateId" :label="`${shot.title} · 候选 ${candidates.findIndex(item => item.candidateId === editingCandidateId) + 1}`" @close="editingCandidateId = ''" @saved="onImageEdited" />
  </section>
</template>

<script setup lang="ts">
import { computed, inject, onScopeDispose, reactive, ref, watch, type ComponentPublicInstance } from "vue";
import type { ProjectRecord, ShotRecord } from "@toonflow/server/production";
import { useProductionStore, productionError } from "@/stores/production";
import versionPreview from "./versionPreview.vue";
import imageCandidateEditor from "./imageCandidateEditor.vue";
import { ElMessageBox } from "element-plus";
import { candidateReferenceState } from "@toonflow/server/production/references";
const props = defineProps<{ shot: ShotRecord }>();
const store = useProductionStore();
const applySelection = inject<(shotId: string, directory: string) => Promise<void>>("applyProductionSelection");
const openDirectorSource = inject<(captureId: string) => Promise<void>>("openDirectorSource");
const versionId = ref("");
const editingCandidateId = ref("");
const fileIndex = ref(0);
const mediaFiles = computed(() => getVersion(versionId.value)?.files.flatMap((file, index) => /^(image|video|audio)\//.test(file.mimeType) ? [{ index, label: file.view || `文件 ${index + 1} · ${file.mimeType.split('/')[0]}` }] : []) || []);
watch(versionId, () => { fileIndex.value = mediaFiles.value[0]?.index || 0; });
const error = ref("");
const comparison = ref<string[]>([]);
const durations = reactive<Record<string, number>>({});
const imageZoom = ref(1);
const comparisonTime = ref(0);
const comparisonPlaying = ref(false);
const undoAdoptionId = ref("");
const previews = new Map<string, InstanceType<typeof versionPreview>>();
let playbackEpoch = 0;
const candidates = computed(() => props.shot.candidateIds.flatMap(id => store.project?.candidates.find(item => item.candidateId === id) || []));
const compared = computed(() => candidates.value.filter(item => comparison.value.includes(item.candidateId)));
const history = computed(() => store.project?.adoptionHistory.filter(item => item.shotId === props.shot.shotId).toReversed() || []);
const canUndo = computed(() => history.value[0]?.adoptionId === undoAdoptionId.value && history.value[0]?.candidateId === props.shot.adoptedCandidateId);
const videos = computed(() => compared.value.filter(candidate => mediaType(candidate) === "video"));
const videosReady = computed(() => videos.value.length === 2 && videos.value.every(candidate => durations[candidate.candidateId] > 0));
const maximumDuration = computed(() => Math.max(0, ...videos.value.map(candidate => durations[candidate.candidateId] || 0)));
const minimumDuration = computed(() => videosReady.value ? Math.min(...videos.value.map(candidate => durations[candidate.candidateId]!)) : 0);
const masterVideo = computed(() => videos.value.find(candidate => durations[candidate.candidateId] === maximumDuration.value)?.candidateId);
const hasImages = computed(() => compared.value.some(candidate => mediaType(candidate) === "image"));
const differences = computed(() => {
  if (compared.value.length !== 2) return [];
  const values = compared.value.map(candidate => {
    const request = candidate.basis.request;
    const imageEdit = getVersion(candidate.versionId)?.details.imageEdit;
    const editParameters = imageEdit && typeof imageEdit === "object" && !Array.isArray(imageEdit) ? imageEdit.parameters : undefined;
    const parameters = request && Object.fromEntries(Object.entries(request).filter(([key]) => !["prompt", "providerId", "modelId", "outputDirectory"].includes(key)).sort(([a], [b]) => a.localeCompare(b)));
    return { "模型": request ? `${request.providerId} / ${request.modelId}` : String(getVersion(candidate.versionId)?.details.modelLabel || "未知"), "提示词": request?.prompt ?? "未知", "参数": parameters ? JSON.stringify(parameters, null, 2) : "未知", "参考版本": candidate.basis.references.map(reference => referenceLabel(reference.assetId, reference.versionId)).join("\n") || (candidate.basis.unknown ? "未记录" : "无"), "本地编辑参数": editParameters ? JSON.stringify(editParameters, null, 2) : "无" };
  });
  return Object.keys(values[0]!).flatMap(label => { const key = label as keyof typeof values[number]; const pair = values.map(value => value[key]); return pair[0] === pair[1] ? [] : [{ label, values: pair }]; });
});
const mediaAssets = computed(() => store.project?.assets.filter(item => !item.archived).map(asset => ({ ...asset, versions: store.project!.assetVersions.filter(version => version.assetId === asset.assetId && version.files.some(file => /^(image|video|audio)\//.test(file.mimeType))) })).filter(asset => asset.versions.length) || []);
watch(candidates, value => { comparison.value = comparison.value.filter(id => value.some(candidate => candidate.candidateId === id)); if (!comparison.value.length) comparison.value = [props.shot.adoptedCandidateId || value.at(-1)?.candidateId || ""].filter(Boolean); }, { immediate: true });
function getVersion(id: string) { return store.project?.assetVersions.find(item => item.versionId === id); }
function candidateFileIndex(candidate: ProjectRecord["candidates"][number]) { return candidate.fileIndex ?? Math.max(0, getVersion(candidate.versionId)?.files.findIndex(file => /^(image|video|audio)\//.test(file.mimeType)) ?? 0); }
function mediaType(candidate: ProjectRecord["candidates"][number]) { return getVersion(candidate.versionId)?.files[candidateFileIndex(candidate)]?.mimeType.split("/")[0]; }
function editableImage(candidate: ProjectRecord["candidates"][number]) { return /^image\/(png|jpeg|webp)$/.test(getVersion(candidate.versionId)?.files[candidateFileIndex(candidate)]?.mimeType || ""); }
function onImageEdited(id: string) { comparison.value = [editingCandidateId.value, id]; editingCandidateId.value = ""; }
function setPreview(id: string, value: Element | ComponentPublicInstance | null) { if (value) previews.set(id, value as InstanceType<typeof versionPreview>); else previews.delete(id); }
function pauseComparison() { ++playbackEpoch; comparisonPlaying.value = false; previews.forEach(preview => preview.pause()); }
function alignTime(seconds: number) { pauseComparison(); comparisonTime.value = seconds; videos.value.forEach(candidate => previews.get(candidate.candidateId)?.seek(seconds)); }
async function playComparison() {
  if (!videosReady.value) return;
  alignTime(comparisonTime.value >= maximumDuration.value ? 0 : comparisonTime.value);
  const current = ++playbackEpoch;
  comparisonPlaying.value = true; error.value = "";
  const results = await Promise.allSettled(videos.value.map(candidate => previews.get(candidate.candidateId)?.play(true)));
  if (current !== playbackEpoch) return;
  const failed = results.find(item => item.status === "rejected");
  if (failed?.status === "rejected") { pauseComparison(); error.value = productionError(failed.reason); }
}
function onPlaying(id: string) {
  const candidate = candidates.value.find(item => item.candidateId === id);
  if (comparisonPlaying.value && candidate && mediaType(candidate) === "video") return;
  ++playbackEpoch; comparisonPlaying.value = false;
  previews.forEach((preview, key) => { if (key !== id) preview.pause(); });
}
function onMediaState(id: string, value: { currentTime: number; paused: boolean }) {
  if (!comparisonPlaying.value || id !== masterVideo.value) return;
  comparisonTime.value = value.currentTime;
  if (value.paused) pauseComparison();
}
watch(() => compared.value.map(candidate => candidate.candidateId).join(), () => { pauseComparison(); comparisonTime.value = 0; });
watch(() => store.visible && store.panel === "storyboard", active => { if (!active) pauseComparison(); });
watch([() => props.shot.shotId, () => store.directory], () => { pauseComparison(); comparisonTime.value = 0; imageZoom.value = 1; undoAdoptionId.value = ""; error.value = ""; });
onScopeDispose(pauseComparison);
function referenceLabel(assetId: string, versionId: string) { const asset = store.project?.assets.find(item => item.assetId === assetId); const version = getVersion(versionId); return `${asset?.name || '素材'} · v${(asset?.versionIds.indexOf(versionId) ?? -1) + 1}${version?.description ? ` · ${version.description.slice(0, 120)}` : ''}`; }
function toggleCandidate(id: string) { comparison.value = comparison.value.includes(id) ? comparison.value.filter(item => item !== id) : comparison.value.length < 2 ? [...comparison.value, id] : comparison.value; }
async function addCandidate() { error.value = ""; try { const version = getVersion(versionId.value); if (!version) throw new Error("请选择有效媒体版本"); const result = await store.update({ type: "addCandidate", shotId: props.shot.shotId, versionId: version.versionId, fileIndex: fileIndex.value, taskId: version.taskId, basis: { references: props.shot.references, unknown: !version.taskId } }); if (result.resultId) comparison.value = [...comparison.value.slice(-1), result.resultId]; } catch (cause) { error.value = productionError(cause); } }
async function confirmOldReferences(candidate: ProjectRecord["candidates"][number], action: "采用" | "恢复" = "采用") {
  const recorded = candidate.basis.shotReferences?.map(reference => `${reference.role ? `${reference.role} · ` : ""}${referenceLabel(reference.assetId, reference.versionId)}`).join("；") || "无镜头参考";
  const current = props.shot.references.map(reference => `${reference.role ? `${reference.role} · ` : ""}${referenceLabel(reference.assetId, reference.versionId)}`).join("；") || "无镜头参考";
  return ElMessageBox.confirm(`候选记录：${recorded}。当前镜头：${current}。${action}这个固定旧结果会保留其依据，不会修改当前参考或自动重新生成。`, "候选参考与当前镜头不同", { confirmButtonText: `保留旧依据并${action}`, cancelButtonText: "返回核对", type: "warning" }).then(() => true, () => false);
}
async function adopt(id: string) {
  const path = store.directory; const shotId = props.shot.shotId; const revision = store.project?.revision; error.value = "";
  try {
    const candidate = candidates.value.find(candidate => candidate.candidateId === id); if (!candidate) throw new Error("候选已变化，请刷新后重试");
    const changed = candidateReferenceState(props.shot, candidate) === "changed";
    if (changed && !await confirmOldReferences(candidate)) return;
    const result = await store.update({ type: "adoptCandidate", shotId, candidateId: id, confirmReferenceChanges: changed }, path, revision);
    if (store.directory === path && props.shot.shotId === shotId) undoAdoptionId.value = result.project.adoptionHistory.findLast(item => item.shotId === shotId)?.adoptionId || "";
    await applySelection?.(shotId, path);
  } catch (cause) { if (store.directory === path) error.value = productionError(cause); }
}
async function undoAdoption() {
  const path = store.directory; const shotId = props.shot.shotId; const revision = store.project?.revision; const adoptionId = undoAdoptionId.value; error.value = "";
  try {
    const prior = candidates.value.find(candidate => candidate.candidateId === history.value[0]?.previousCandidateId);
    const changed = !!prior && candidateReferenceState(props.shot, prior) === "changed";
    if (changed && !await confirmOldReferences(prior!, "恢复")) return;
    const result = await store.update({ type: "undoAdoption", shotId, adoptionId, confirmReferenceChanges: changed }, path, revision);
    undoAdoptionId.value = ""; if (result.project.shots.find(shot => shot.shotId === shotId)?.adoptedCandidateId) await applySelection?.(shotId, path);
  } catch (cause) { if (store.directory === path) error.value = productionError(cause); }
}
async function syncAdopted() { error.value = ""; try { await applySelection?.(props.shot.shotId, store.directory); } catch (cause) { error.value = productionError(cause); } }
async function viewDirector(captureId: string) { error.value = ""; try { await openDirectorSource?.(captureId); } catch (cause) { error.value = productionError(cause); } }
</script>

<style scoped lang="scss">
.candidatePanel {
  scroll-margin-top: 135px;
  margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--el-border-color-light);
  > header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; h3 { font-size: 15px; margin: 0 0 12px; } span { color: var(--el-text-color-secondary); font-size: 12px; } }
  .candidateImport { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; label { flex: 1; min-width: 180px; } }
  .candidateChoices { display: flex; gap: 10px; flex-wrap: wrap; margin: 16px 0; label { display: flex; gap: 6px; align-items: center; font-size: 12px; } }
  .comparisonTools { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 12px 0; label { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; flex: 1; font-size: 12px; input { min-width: 100px; flex: 1; } output { font-variant-numeric: tabular-nums; } } > p { flex-basis: 100%; margin: 0; } }
  .candidateHint { font-size: 12px; line-height: 1.6; color: var(--el-text-color-secondary); overflow-wrap: anywhere; }
  .candidateComparison { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: 12px;
    article { min-width: 0; border: 1px solid var(--el-border-color-light); border-radius: 6px; padding: 12px; h4 { font-size: 13px; margin: 0 0 12px; span { color: var(--el-color-primary); } } .el-button { margin-top: 12px; } details { margin-top: 12px; font-size: 12px; summary { cursor: pointer; } p, pre { overflow-wrap: anywhere; white-space: pre-wrap; } pre { max-height: 220px; overflow: auto; } } }
  }
  .adoptionHistory { margin: 16px 0; font-size: 12px; summary { cursor: pointer; } li { line-height: 1.8; } }
  .basisDiff { margin: 16px 0; font-size: 12px; summary { cursor: pointer; } > div { padding: 10px 0; border-bottom: 1px solid var(--el-border-color-light); p { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 160px; overflow: auto; } } }
  .adoptionUndo { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 12px 0; }
  input:focus-visible, summary:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
  .candidateError { color: var(--el-color-danger); }
  .referenceChanged { color: var(--el-color-warning); line-height: 1.7; font-size: 12px; }
}
</style>
