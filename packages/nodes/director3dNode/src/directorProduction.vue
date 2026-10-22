<template>
  <section class="directorProduction" aria-label="机位与制作镜头">
    <header><h3>镜头制作</h3><el-button size="small" :loading="loading" :disabled="busy" @click="load">重新读取</el-button></header>
    <p v-if="context && !context.projectId">先在工作区分镜面板建立制作记录和镜头，再选择对应机位。</p>
    <template v-else-if="context">
      <label>机位<select v-model="anchorId" aria-label="制作机位" :disabled="busy"><option value="">选择已保存机位</option><option v-for="anchor in anchors" :key="anchor.id" :value="anchor.id">{{ anchor.name || '机位' }}</option></select></label>
      <label>对应镜头<select v-model="shotId" aria-label="机位对应镜头" :disabled="busy || !anchorId"><option value="">未绑定</option><option v-for="shot in context.shots" :key="shot.shotId" :value="shot.shotId">{{ shot.title }}</option></select></label>
      <el-button :disabled="busy || !anchorId" @click="bind">{{ shotId ? '保存镜头绑定' : '解除镜头绑定' }}</el-button>
      <div class="captureActions"><el-button type="primary" :disabled="busy || !bindingSaved || !state" @click="capture('image')">生成机位截图参考</el-button><el-button :disabled="busy || !bindingSaved || !state || !hasPlan" @click="capture('video')">生成动画视频参考</el-button></div>
      <p v-if="shotId !== (boundShot || '')" class="productionHint">对应镜头已更改，请先保存镜头绑定。</p>
      <p class="productionHint">参考保存为固定版本。动画视频使用所选方案的镜头轨道；准备生成节点后，在节点中选择实际模型能力并提交。</p>
      <p v-if="busy" role="status">正在保存或生成参考…</p>
      <ul class="referenceRecords"><li v-for="item in references" :key="item.directorShotId"><strong>{{ item.name }} · {{ item.mediaType === 'video' ? '动画' : '截图' }}</strong><span>{{ context.shots.find(shot => shot.shotId === item.shotId)?.title || '原镜头' }} · {{ item.status === 'pending' ? '待完成' : item.stale ? '当前场景或机位已变化' : '参考一致' }}</span><div v-if="item.status === 'completed'"><el-button v-if="item.mediaType === 'image'" size="small" :disabled="busy" @click="prepare(item.directorShotId, 'image')">准备图片生成节点</el-button><el-button size="small" :disabled="busy" @click="prepare(item.directorShotId, 'video')">准备视频生成节点</el-button></div><el-button v-else size="small" :disabled="busy" @click="resume(item.directorShotId)">继续保存原参考</el-button></li></ul>
      <p v-if="pendingJobs.length && !references.some(item => item.status === 'pending')" class="productionHint">有 {{ pendingJobs.length }} 条本机未完成记录，可继续原参考。</p><el-button v-for="job in pendingJobs.filter(job => !references.some(item => item.directorShotId === job.captureId))" :key="job.captureId" size="small" :disabled="busy" @click="resume(job.captureId)">继续未完成{{ job.mediaType === 'video' ? '视频' : '截图' }}</el-button>
    </template>
    <p v-if="error" class="productionError" role="alert">{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, onScopeDispose, ref, watch } from "vue";
import { ElButton } from "element-plus";
import type { DirectorCaptureJob, DirectorProductionBridge, DirectorProductionContext } from "@toonflow/nodes-scaffold/runtime";
import type { CameraAnchor } from "./motion";
import type { SceneDocument, LightingSettings, SceneSettings } from "./scene";
const props = defineProps<{ nodeId: string; anchors: CameraAnchor[]; selectedAnchorId: string; scene: SceneDocument; lighting: LightingSettings; sceneSettings: SceneSettings; planId?: string; busy: boolean; hasPlan: boolean; pendingJobs: DirectorCaptureJob[]; captureReference: (job: DirectorCaptureJob) => Promise<void>; resumeReference: (id: string) => Promise<void>; closeForGeneration: () => void; viewAnchor: (id: string) => void }>();
const bridge = inject<DirectorProductionBridge>("directorProduction");
const context = ref<DirectorProductionContext>(); const loading = ref(false); const working = ref(false); const error = ref("");
const busy = computed(() => props.busy || working.value || loading.value);
const anchorId = ref(""); const shotId = ref("");
const boundShot = computed(() => context.value?.bindings.find(item => item.anchorId === anchorId.value)?.shotId);
const bindingSaved = computed(() => !!shotId.value && shotId.value === boundShot.value);
const state = computed(() => context.value?.states.find(item => item.anchorId === anchorId.value));
const references = computed(() => (context.value?.references || []).filter(item => item.anchorId === anchorId.value).toReversed());
let epoch = 0;
let readPending = false;
let disposed = false;
watch(anchorId, () => { shotId.value = boundShot.value || ""; if (anchorId.value) props.viewAnchor(anchorId.value); });
watch(() => props.selectedAnchorId, id => { if (props.anchors.some(anchor => anchor.id === id)) anchorId.value = id; });
watch(() => props.anchors.map(anchor => anchor.id).join(), () => { if (!props.anchors.some(anchor => anchor.id === anchorId.value)) anchorId.value = props.anchors[0]?.id || ""; });
watch([() => props.anchors, () => props.scene, () => props.lighting, () => props.sceneSettings, () => props.planId], () => { if (busy.value) readPending = true; else void load(); });
watch(busy, value => { if (!value && readPending) { readPending = false; void load(); } });
async function load() { if (disposed) return; if (!bridge) { error.value = "当前工作区尚未提供镜头制作能力，请更新应用"; return; } const current = ++epoch; loading.value = true; error.value = ""; try { const value = await bridge.context(props.nodeId); if (current !== epoch) return; context.value = value; if (!props.anchors.some(anchor => anchor.id === anchorId.value)) anchorId.value = props.selectedAnchorId || props.anchors[0]?.id || ""; shotId.value = boundShot.value || ""; } catch (cause) { if (current === epoch) error.value = cause instanceof Error ? cause.message : "制作记录读取失败"; } finally { if (current === epoch) loading.value = false; } }
async function run(action: () => Promise<void>) { if (busy.value) return; working.value = true; error.value = ""; try { await action(); await load(); } catch (cause) { error.value = cause instanceof Error ? cause.message : "参考操作失败，请重试"; } finally { working.value = false; } }
function bind() { return run(async () => { await bridge?.bind(props.nodeId, anchorId.value, shotId.value || undefined); }); }
function capture(mediaType: "image" | "video") { if (!boundShot.value || !state.value) return; const job: DirectorCaptureJob = { captureId: crypto.randomUUID(), createdAt: Date.now(), anchorId: anchorId.value, shotId: boundShot.value, stateHash: state.value.stateHash, mediaType }; return run(() => props.captureReference(job)); }
function resume(id: string) { return run(() => props.resumeReference(id)); }
function prepare(id: string, type: "image" | "video") { return run(async () => { await bridge?.prepare(id, type); props.closeForGeneration(); }); }
void load();
onScopeDispose(() => { disposed = true; ++epoch; });
</script>

<style scoped lang="scss">
.directorProduction { padding: 16px 12px; display: grid; gap: 12px; overflow: auto;
  header { display: flex; align-items: center; gap: 8px; justify-content: space-between; h3 { margin: 0; font-size: 14px; } }
  label { display: grid; gap: 6px; font-size: 12px; select { width: 100%; min-width: 0; border: 1px solid var(--el-border-color); padding: 8px; border-radius: var(--el-border-radius-base); background: var(--el-bg-color); color: var(--el-text-color-primary); font: inherit; } }
  .captureActions { display: grid; gap: 8px; .el-button { margin: 0; } }
  p { margin: 0; font-size: 12px; line-height: 1.7; }
  .productionHint { color: var(--el-text-color-secondary); }
  .productionError { color: var(--el-color-danger); overflow-wrap: anywhere; }
  .referenceRecords { list-style: none; padding: 0; margin: 0; li { display: grid; gap: 8px; border-top: 1px solid var(--el-border-color-light); padding: 12px 0; strong { font-size: 12px; } span { color: var(--el-text-color-secondary); font-size: 12px; } > div { display: flex; flex-wrap: wrap; gap: 6px; .el-button { margin: 0; } } } }
  select:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
}
</style>
