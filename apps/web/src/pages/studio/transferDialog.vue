<template>
  <el-dialog v-model="visible" title="把结果加入制作" width="min(600px, 94vw)" appendToBody :closeOnClickModal="false" :closeOnPressEscape="!busy" :showClose="!busy" :beforeClose="closeDialog">
    <form class="transferForm" @submit.prevent="transfer">
      <p class="transferSource">{{ source?.prompt || '已保存结果' }}</p><p class="transferHint">项目：{{ directory.split(/[\\/]/).filter(Boolean).at(-1) }}。登记已有结果不会发起生成，也不会自动采用为作品。</p>
      <p v-if="loading" role="status">正在读取目标…</p>
      <fieldset :disabled="busy || loading"><legend>结果去向</legend><label><input v-model="targetMode" type="radio" value="current" :disabled="!currentCanvas" />追加到当前画布 <span v-if="currentCanvas">{{ currentCanvas.slice(0, -5) }}</span><span v-else>当前工作空间暂无打开的画布</span></label><label><input v-model="targetMode" type="radio" value="existing" :disabled="!canvases.length" />选择已有画布</label><label><input v-model="targetMode" type="radio" value="new" />新建画布</label><label><input v-model="targetMode" type="radio" value="shot" :disabled="!shots.length" />登记为镜头候选</label>
        <label v-if="targetMode === 'existing'" class="targetSelect">目标画布<select v-model="canvasId" aria-label="目标画布"><option value="">选择画布</option><option v-for="canvas in canvases" :key="canvas" :value="canvas">{{ canvas.slice(0, -5) }}</option></select></label>
        <label v-if="targetMode === 'shot'" class="targetSelect">目标镜头<select v-model="shotId" aria-label="目标镜头"><option value="">选择镜头</option><optgroup v-for="sequence in sequences" :key="sequence.sequenceId" :label="sequence.name"><option v-for="shot in shots.filter(item => item.sequenceId === sequence.sequenceId)" :key="shot.shotId" :value="shot.shotId">{{ shot.title }}</option></optgroup></select></label>
      </fieldset>
      <p v-if="receipt" class="transferSaved" role="status">结果已保存{{ receipt.canvasId ? `到 ${receipt.canvasId}` : '为镜头候选' }}。再次打开会使用原位置。</p>
      <p v-if="error" class="transferError" role="alert">{{ error }}</p><p v-if="loadError" class="transferError" role="alert">{{ loadError }} <el-button text :disabled="busy" @click="loadTargets">重新读取</el-button></p>
      <div class="transferActions"><el-button :disabled="busy" @click="visible = false">关闭</el-button><el-button type="primary" nativeType="submit" :loading="busy" :disabled="loading || !!loadError || !targetValid">{{ receipt ? '打开已保存的位置' : targetMode === 'shot' ? '登记候选并打开' : '加入画布并打开' }}</el-button></div>
    </form>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import axios from "axios";
import type { ProjectRecord, ProductionTransferReceipt, ProductionTransferSource, ProductionTransferTarget } from "@toonflow/server/production";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { isCanvasFile } from "@/pages/workspace/canvasFile";
import { useWorkspaceStore } from "@/stores/workspace";
import { productionError } from "@/stores/production";
const visible = defineModel<boolean>({ default: false });
const props = defineProps<{ directory: string; source?: ProductionTransferSource; openTarget: (receipt: ProductionTransferReceipt) => Promise<void> }>();
const emit = defineEmits<{ busyChange: [value: boolean] }>();
const workspace = useWorkspaceStore();
const busy = ref(false); const loading = ref(false); const error = ref(""); const loadError = ref("");
const canvases = ref<string[]>([]); const project = ref<ProjectRecord | null>(null);
const sequences = computed(() => project.value?.sequences.filter(item => !item.archived) || []);
const shots = computed(() => project.value?.shots.filter(item => !item.archived && sequences.value.some(sequence => sequence.sequenceId === item.sequenceId)) || []);
const currentCanvas = computed(() => workspace.lastCanvas?.directory === props.directory && canvases.value.includes(workspace.lastCanvas.canvasId) ? workspace.lastCanvas.canvasId : "");
const targetMode = ref<"current" | "existing" | "new" | "shot">("new"); const canvasId = ref(""); const shotId = ref("");
const receipt = ref<ProductionTransferReceipt>();
const targetValid = computed(() => targetMode.value === "new" || targetMode.value === "current" && !!currentCanvas.value || targetMode.value === "existing" && !!canvasId.value || targetMode.value === "shot" && !!shotId.value);
let epoch = 0; let controller: AbortController | undefined;
watch([targetMode, canvasId, shotId], () => { receipt.value = undefined; error.value = ""; });
watch(visible, value => { if (value) { receipt.value = undefined; error.value = ""; canvasId.value = ""; shotId.value = ""; void loadTargets(); } else { ++epoch; controller?.abort(); } });

async function loadTargets() {
  controller?.abort(); const request = ++epoch; const path = props.directory;
  if (!visible.value || !path) return;
  const current = controller = new AbortController(); loading.value = true; loadError.value = "";
  try {
    const files = useWorkspaceFiles(path);
    const [listing, production] = await Promise.all([files.list("", current.signal), axios.get<{ data: { project: ProjectRecord | null } }>("/api/production/get", { params: { directory: path }, headers: { "x-toonflow-workspace": "1" }, signal: current.signal })]);
    const candidates = listing.entries.filter(item => item.type === "file" && /\.json$/i.test(item.path));
    const valid = await Promise.all(candidates.map(async item => await isCanvasFile(files, item.path, current.signal) ? item.path : ""));
    if (request !== epoch || current.signal.aborted || path !== props.directory) return;
    canvases.value = valid.filter(Boolean); project.value = production.data.data.project;
    targetMode.value = currentCanvas.value ? "current" : canvases.value.length ? "existing" : "new";
    canvasId.value = canvases.value[0] || "";
  } catch (cause) { if (!current.signal.aborted && request === epoch) loadError.value = productionError(cause); }
  finally { if (request === epoch) loading.value = false; }
}

async function transfer() {
  if (busy.value || !targetValid.value || !props.source) return;
  const path = props.directory; const source = JSON.parse(JSON.stringify(props.source)) as ProductionTransferSource;
  const target: ProductionTransferTarget = targetMode.value === "shot" ? { kind: "shot", shotId: shotId.value } : { kind: "canvas", canvasId: targetMode.value === "new" ? undefined : targetMode.value === "current" ? currentCanvas.value : canvasId.value };
  busy.value = true; emit("busyChange", true); error.value = "";
  try {
    if (!receipt.value) {
      const { data } = await axios.post<{ data: ProductionTransferReceipt }>("/api/production/transfer", { directory: path, source, target }, { headers: { "x-toonflow-workspace": "1" } });
      if (path !== props.directory) throw new Error("保存目标已切换，结果保留在原工作空间，请重新打开");
      receipt.value = data.data;
    }
    await props.openTarget(receipt.value);
    visible.value = false;
  } catch (cause) { error.value = `${receipt.value ? '结果已保存，可重新打开。' : ''}${productionError(cause)}`; }
  finally { busy.value = false; emit("busyChange", false); }
}
function closeDialog(done: () => void) { if (!busy.value) done(); }
onScopeDispose(() => { ++epoch; controller?.abort(); });
</script>

<style scoped lang="scss">
.transferForm {
  display: grid; gap: 14px;
  .transferSource { margin: 0; font-size: 14px; max-height: 120px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
  .transferHint { margin: 0; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.7; }
  fieldset { border: 1px solid var(--el-border-color-light); border-radius: 6px; padding: 14px; display: grid; gap: 14px; legend { color: var(--el-text-color-secondary); font-size: 12px; } > label { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; span { color: var(--el-text-color-secondary); font-size: 12px; overflow-wrap: anywhere; } &.targetSelect { display: grid; } select { min-width: 0; width: 100%; border: 1px solid var(--el-border-color); border-radius: 5px; padding: 9px; background: var(--el-bg-color); color: var(--el-text-color-primary); font: inherit; } } }
  .transferSaved { color: var(--el-color-primary); font-size: 12px; overflow-wrap: anywhere; }
  .transferError { color: var(--el-color-danger); font-size: 13px; }
  .transferActions { display: flex; justify-content: end; gap: 8px; }
  input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
}
</style>
