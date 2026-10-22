<template>
  <section class="storyboardPanel" @keydown.esc="cancelDragKey">
    <div class="panelTools"><label>制作单元<select v-model="sequenceId"><option v-for="item in sequences" :key="item.sequenceId" :value="item.sequenceId">{{ item.name }}</option></select></label><el-button :disabled="store.busy" @click="addSequence">新建单元</el-button><el-button type="primary" :disabled="!sequence || store.busy" @click="editShot()">新增镜头</el-button></div>
    <p v-if="sequence" class="panelHint">{{ shots.length }} 个镜头 · 预计 {{ totalDuration }} 秒 · {{ sequence.output.width }} × {{ sequence.output.height }} / {{ sequence.output.frameRate }} fps</p>
    <p v-if="shots.length > 1" class="panelHint">拖动把手调整顺序，插入线表示落点；也可使用上移、下移按钮。</p>
    <p v-if="orderNotice" class="panelHint" role="status">{{ orderNotice }}</p>
    <p v-if="store.taskError" class="panelError" role="alert">任务状态暂无法完整读取：{{ store.taskError }}</p>
    <p v-if="!shots.length" class="emptyState">先添加镜头，填写剧情和声音，再选择角色、场景的固定版本。</p>
    <ol ref="shotListElement" class="shotList" aria-label="分镜顺序">
      <li v-for="(shot, index) in shots" :key="shot.shotId" class="shotItem" :data-shot-id="shot.shotId" :class="{ selectedShot: selectedShotId === shot.shotId, draggingShot: draggingShotId === shot.shotId, dropBefore: dropTarget?.shotId === shot.shotId && !dropTarget.after, dropAfter: dropTarget?.shotId === shot.shotId && dropTarget.after }">
        <header><button class="shotDragHandle" type="button" :disabled="store.busy || shots.length < 2" :aria-label="`调整镜头顺序 ${shot.title}`" aria-keyshortcuts="ArrowUp ArrowDown" title="拖动调整顺序；聚焦后按方向键上下移动" @pointerdown.stop="beginDrag($event, shot.shotId)" @pointermove="moveDrag" @pointerup="finishDrag" @pointercancel="clearDrag" @lostpointercapture="clearDrag" @keydown.up.stop.prevent="moveShot(index, -1, $event)" @keydown.down.stop.prevent="moveShot(index, 1, $event)"><icon-grip-vertical :size="16" aria-hidden="true" /></button><span class="shotNumber">{{ String(index + 1).padStart(2, '0') }}</span><button class="shotTitle" @click="revealCandidates(shot.shotId)">{{ shot.title }}</button><span class="shotStatus">{{ shot.adoptedCandidateId ? '已采用' : shot.candidateIds.length ? `${shot.candidateIds.length} 个候选` : '待制作' }}</span><span>{{ shot.expectedDuration }} 秒</span></header>
        <p v-if="shot.story" class="shotStory">{{ shot.story }}</p><p v-if="shot.dialogue" class="shotDialogue">声音：{{ shot.dialogue }}</p>
        <div class="shotReferences"><button v-for="(reference, referenceIndex) in shot.references" :key="referenceIndex" class="referenceLink" @click="showAsset(reference.assetId)">{{ referenceName(reference) }}</button><span v-if="!shot.references.length" class="panelHint">未绑定参考版本</span></div>
        <p v-if="adoptedReferenceChanged(shot)" class="referenceChanged">镜头参考已更新，已采用结果仍保留旧依据。</p>
        <div class="shotActions"><el-button size="small" :disabled="store.busy" @click="editShot(shot)">编辑</el-button><el-button size="small" :disabled="store.busy" @click="revealCandidates(shot.shotId)">查看候选</el-button><el-button v-if="shot.canvasId" size="small" @click="locate(shot)">定位画布</el-button><el-button size="small" :disabled="!index || store.busy" :aria-label="`上移镜头 ${shot.title}`" @click="moveShot(index, -1, $event)">上移</el-button><el-button size="small" :disabled="index === shots.length - 1 || store.busy" :aria-label="`下移镜头 ${shot.title}`" @click="moveShot(index, 1, $event)">下移</el-button><el-button size="small" text :disabled="store.busy" @click="archiveShot(shot)">归档</el-button></div>
        <p v-if="shotTask(shot.shotId)" class="shotTask"><button @click="center.open({directory: store.directory, id: shotTask(shot.shotId)!.id})">最近任务：{{ taskLabels[shotTask(shot.shotId)!.status] }}</button><span v-if="shotTask(shot.shotId)!.error">{{ shotTask(shot.shotId)!.error }}</span></p>
      </li>
    </ol>
    <candidatePanel v-if="selectedShot" :key="selectedShot.shotId" ref="candidatesRef" :shot="selectedShot" />
    <section v-if="drafts.length" class="drafts"><h3>待审分镜草案</h3><details v-for="draft in drafts" :key="draft.draftId"><summary>{{ draft.name }} · {{ draft.shots.length }} 个镜头 · {{ draft.source === 'agent' ? 'Agent 提议' : '手动草案' }}</summary><ol><li v-for="(shot, index) in draft.shots" :key="index"><strong>{{ shot.title }} · {{ shot.expectedDuration }} 秒</strong><p>{{ shot.story }}</p><p v-if="shot.dialogue">声音：{{ shot.dialogue }}</p><p v-for="reference in shot.references" :key="reference.versionId">{{ referenceName(reference) }}</p></li></ol><el-button type="primary" :disabled="store.busy" @click="acceptDraft(draft.draftId)">采用为新制作单元</el-button></details></section>
    <el-dialog v-model="editing" :title="editingShotId ? '编辑镜头' : '新增镜头'" width="min(600px, 94vw)" appendToBody :closeOnClickModal="false" :closeOnPressEscape="false" :showClose="!saving" :beforeClose="closeEditor">
      <form class="shotForm" @submit.prevent="saveShot">
        <label>镜头标题<input v-model="draft.title" required maxlength="200" /></label><label>剧情<textarea v-model="draft.story" rows="3" maxlength="100000" /></label><label>对白或声音<textarea v-model="draft.dialogue" rows="2" maxlength="100000" /></label><label>预计时长（秒）<input v-model.number="draft.expectedDuration" type="number" min="0.1" max="3600" step="0.1" required /></label>
        <fieldset><legend>固定参考版本</legend><div v-for="(reference, index) in draft.references" :key="index" class="referenceRow"><label>素材<select :value="reference.assetId" @change="changeReference(index, ($event.target as HTMLSelectElement).value)"><option v-for="asset in assets" :key="asset.assetId" :value="asset.assetId">{{ asset.name }}</option></select></label><label>版本<select v-model="reference.versionId"><option v-for="version in assetVersions(reference.assetId)" :key="version.versionId" :value="version.versionId">{{ versionLabel(version.versionId) }}</option></select></label><label>用途<input v-model="reference.role" maxlength="200" placeholder="主角、环境等" /></label><el-button text :aria-label="`移除参考 ${index + 1}`" @click="draft.references.splice(index, 1)">移除</el-button></div><el-button size="small" :disabled="!assets.some(asset => asset.versionIds.length)" @click="addReference">添加参考</el-button></fieldset>
        <fieldset><legend>画布位置</legend><p class="panelHint">在画布选中一个节点，再点击绑定；同一节点只对应一个活动镜头。</p><p v-if="draft.canvasId">{{ draft.canvasId }} · {{ draft.nodeId }}</p><el-button size="small" @click="bindSelection">绑定选中节点</el-button><el-button v-if="draft.canvasId" size="small" text @click="draft.canvasId = undefined; draft.nodeId = undefined">解除绑定</el-button></fieldset>
        <p v-if="formError" class="panelError" role="alert">{{ formError }}</p><div class="formActions"><el-button :disabled="saving" @click="closeEditor(() => editing = false)">取消</el-button><el-button type="primary" nativeType="submit" :loading="saving" :disabled="store.busy">保存镜头</el-button></div>
      </form>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onScopeDispose, reactive, ref, shallowRef, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import type { AssetVersion, ProductionOperation, ShotRecord } from "@toonflow/server/production";
import type { CanvasContext } from "@toonflow/tool-canvas/runtime";
import { useProductionStore, productionError } from "@/stores/production";
import { useTaskCenterStore } from "@/stores/taskCenter";
import candidatePanel from "./candidatePanel.vue";
import { candidateReferenceState } from "@toonflow/server/production/references";
import { IconGripVertical } from "@tabler/icons-vue";
const store = useProductionStore();
const props = defineProps<{ focusId: string; focusToken: string }>();
const center = useTaskCenterStore();
const candidatesRef = ref<InstanceType<typeof candidatePanel>>();
const taskLabels = { queued: "排队中", submitting: "提交中", running: "生成中", downloading: "保存中", completed: "已完成", partial: "部分完成", failed: "失败", interrupted: "可恢复", unknown: "待核对", cancelled: "已取消排队" };
function shotTask(id: string) { return store.shotTasks.find(task => task.shotId === id); }
async function revealCandidates(id: string) { selectedShotId.value = id; await nextTick(); candidatesRef.value?.$el.scrollIntoView({ block: "start" }); }
const getCanvas = inject<() => CanvasContext | undefined>("canvas");
const focusAsset = inject<(id: string) => void>("focusProductionAsset");
const sequences = computed(() => store.project?.sequences.filter(item => !item.archived) || []);
const assets = computed(() => store.project?.assets.filter(item => !item.archived) || []);
const sequenceId = ref("");
const sequence = computed(() => sequences.value.find(item => item.sequenceId === sequenceId.value));
const shots = computed(() => sequence.value?.shotIds.flatMap(id => store.project?.shots.find(item => item.shotId === id) || []) || []);
const totalDuration = computed(() => Math.round(shots.value.reduce((sum, shot) => sum + shot.expectedDuration, 0) * 10) / 10);
const drafts = computed(() => store.project?.storyboardDrafts.filter(item => !item.acceptedSequenceId) || []);
const selectedShotId = ref("");
const selectedShot = computed(() => shots.value.find(item => item.shotId === selectedShotId.value));
const editing = ref(false);
const editingShotId = ref("");
const saving = ref(false);
const formError = ref("");
type ShotInput = Extract<ProductionOperation, { type: "saveShot" }>["shot"];
const blankShot = (): ShotInput => ({ title: "", story: "", dialogue: "", expectedDuration: 5, references: [] });
const draft = reactive<ShotInput>(blankShot());
let editDirectory = "";
let initialDraft = "";
const shotListElement = ref<HTMLOListElement>();
const draggingShotId = ref("");
const dropTarget = shallowRef<{ shotId: string; after: boolean }>();
const orderNotice = ref("");
type OrderContext = { directory: string; sequenceId: string; revision: number };
const drag = shallowRef<OrderContext & { shotId: string; pointerId: number; element: HTMLElement; scrollParent: HTMLElement | null; startX: number; startY: number; x: number; y: number }>();
let scrollFrame = 0;
let scrollTime = 0;
watch([() => store.directory, sequenceId], () => { clearDrag(); orderNotice.value = ""; });
watch([() => store.busy, () => store.visible, () => store.panel], () => clearDrag());
window.addEventListener("blur", clearDrag);
window.addEventListener("resize", clearDrag);
onScopeDispose(() => { clearDrag(); window.removeEventListener("blur", clearDrag); window.removeEventListener("resize", clearDrag); });
watch(sequences, value => { if (!value.some(item => item.sequenceId === sequenceId.value)) sequenceId.value = value[0]?.sequenceId || ""; }, { immediate: true });
watch(() => store.directory, () => { editing.value = false; selectedShotId.value = ""; sequenceId.value = ""; });
watch(() => [props.focusId, props.focusToken], ([id]) => { const shot = store.project?.shots.find(item => item.shotId === id && !item.archived); if (shot) { sequenceId.value = shot.sequenceId; void revealCandidates(shot.shotId); } }, { immediate: true });

function assetVersions(id: string) { return store.project?.assetVersions.filter(item => item.assetId === id) || []; }
function versionLabel(id: string) { const version = store.project?.assetVersions.find(item => item.versionId === id); return version ? `v${assetVersions(version.assetId).findIndex(item => item.versionId === id) + 1} · ${version.description || new Date(version.createdAt).toLocaleString()}` : "版本缺失"; }
const candidateIndex = computed(() => new Map(store.project?.candidates.map(candidate => [candidate.candidateId, candidate]) ?? []));
function adoptedReferenceChanged(shot: ShotRecord) { const candidate = candidateIndex.value.get(shot.adoptedCandidateId ?? ""); return !!candidate && candidateReferenceState(shot, candidate) === "changed"; }
function referenceName(reference: ShotInput["references"][number]) { return `${store.project?.assets.find(item => item.assetId === reference.assetId)?.name || '素材'} / ${versionLabel(reference.versionId)}`; }
function showAsset(id: string) { focusAsset?.(id); }
async function mutate(operation: ProductionOperation, path = store.directory, revision = store.project?.revision) { try { return await store.update(operation, path, revision); } catch (cause) { ElMessage.error(productionError(cause)); } }
async function addSequence() { const path = store.directory; const answer = await ElMessageBox.prompt("为这组镜头命名", "新建制作单元", { inputValidator: value => !!value?.trim() && value.length <= 200, inputErrorMessage: "请输入 1–200 字的名称" }).catch(() => null); if (answer) { const result = await mutate({ type: "addSequence", name: answer.value }, path); if (result?.resultId && store.directory === path) sequenceId.value = result.resultId; } }
function editShot(shot?: ShotRecord) { editingShotId.value = shot?.shotId || ""; Object.assign(draft, blankShot(), { canvasId: undefined, nodeId: undefined }, shot ? { title: shot.title, story: shot.story, dialogue: shot.dialogue, expectedDuration: shot.expectedDuration, canvasId: shot.canvasId, nodeId: shot.nodeId, references: JSON.parse(JSON.stringify(shot.references)) } : {}); editDirectory = store.directory; initialDraft = JSON.stringify(draft); formError.value = ""; editing.value = true; }
async function closeEditor(done: () => void) { if (saving.value) return; if (initialDraft !== JSON.stringify(draft)) { const leave = await ElMessageBox.confirm("镜头修改尚未保存，关闭后将丢弃这些修改。", "未保存的镜头", { confirmButtonText: "丢弃修改", cancelButtonText: "继续编辑" }).then(() => true, () => false); if (!leave) return; } done(); }
async function saveShot() { if (!sequence.value) return; const path = editDirectory; saving.value = true; formError.value = ""; try { const result = await store.update({ type: "saveShot", sequenceId: sequence.value.sequenceId, shotId: editingShotId.value || undefined, shot: JSON.parse(JSON.stringify(draft)) }, path); if (store.directory === path) { editing.value = false; selectedShotId.value = result.resultId || ""; } } catch (cause) { if (store.directory === path) formError.value = productionError(cause); } finally { saving.value = false; } }
function addReference() { const asset = assets.value.find(item => item.versionIds.length); if (asset) draft.references.push({ assetId: asset.assetId, versionId: asset.activeVersionId || asset.versionIds.at(-1)!, role: "" }); }
function changeReference(index: number, id: string) { const asset = assets.value.find(item => item.assetId === id); if (asset) draft.references[index] = { assetId: id, versionId: asset.activeVersionId || asset.versionIds.at(-1) || "", role: draft.references[index]?.role }; }
async function bindSelection() { const path = editDirectory; try { store.requireDirectory(path); const canvas = getCanvas?.(); if (!canvas) throw new Error("请先打开画布并选中节点"); const canvasId = canvas.id; const result = await canvas.call({ name: "findCanvasNodes", args: { selectedOnly: true, limit: 2 } }) as { nodes: { id: string }[]; hasMore: boolean }; store.requireDirectory(path); if (canvas.id !== canvasId) throw new Error("画布已切换，请重新选择节点"); if (result.nodes.length !== 1 || result.hasMore) throw new Error("请只选中一个节点后绑定"); draft.canvasId = canvasId; draft.nodeId = result.nodes[0]!.id; } catch (cause) { if (store.directory === path) formError.value = productionError(cause); } }
function locate(shot: ShotRecord) { if (shot.canvasId) { center.location = { directory: store.directory, canvasId: shot.canvasId, nodeId: shot.nodeId, token: crypto.randomUUID() }; store.visible = false; } }
async function saveOrder(order: string[], shotId: string, context: OrderContext, focus?: HTMLElement) {
  if (!sequence.value || store.busy || context.directory !== store.directory || context.sequenceId !== sequenceId.value) return;
  if (store.project?.revision !== context.revision) return void ElMessage.warning("制作记录已更新，请重新调整顺序");
  if (order.every((id, index) => id === sequence.value!.shotIds[index])) return;
  orderNotice.value = "";
  const result = await mutate({ type: "reorderShots", sequenceId: context.sequenceId, shotIds: order }, context.directory, context.revision);
  if (!result || context.directory !== store.directory || context.sequenceId !== sequenceId.value) return;
  orderNotice.value = `${store.project?.shots.find(shot => shot.shotId === shotId)?.title || "镜头"}已移至第 ${order.indexOf(shotId) + 1} 位，共 ${order.length} 个镜头`;
  await nextTick();
  if (focus?.isConnected && document.activeElement === document.body) {
    const target = focus instanceof HTMLButtonElement && focus.disabled ? focus.closest(".shotItem")?.querySelector<HTMLElement>(".shotDragHandle") : focus;
    target?.focus({ preventScroll: true });
  }
}
async function moveShot(index: number, delta: number, event?: Event) {
  if (!sequence.value || !store.project || store.busy || index + delta < 0 || index + delta >= shots.value.length) return;
  const order = [...sequence.value.shotIds]; const id = order[index]!;
  [order[index], order[index + delta]] = [order[index + delta]!, id];
  await saveOrder(order, id, { directory: store.directory, sequenceId: sequenceId.value, revision: store.project.revision }, event?.currentTarget as HTMLElement | undefined);
}
function clearDrag(event?: Event) {
  const current = drag.value;
  if (event instanceof PointerEvent && current?.pointerId !== event.pointerId) return;
  drag.value = undefined; draggingShotId.value = ""; dropTarget.value = undefined;
  cancelAnimationFrame(scrollFrame); scrollFrame = 0; scrollTime = 0;
  if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
}
function cancelDragKey(event: KeyboardEvent) {
  if (!drag.value) return;
  event.preventDefault(); event.stopPropagation(); clearDrag();
}
function beginDrag(event: PointerEvent, shotId: string) {
  if (event.button !== 0 || !event.isPrimary || drag.value || store.busy || !sequence.value || !store.project || shots.value.length < 2) return;
  const element = event.currentTarget as HTMLElement;
  element.focus({ preventScroll: true }); element.setPointerCapture(event.pointerId);
  drag.value = { shotId, pointerId: event.pointerId, element, scrollParent: element.closest<HTMLElement>(".el-drawer__body"), startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, directory: store.directory, sequenceId: sequenceId.value, revision: store.project.revision };
}
function updateDropTarget() {
  const current = drag.value; if (!current || !draggingShotId.value) return;
  const card = document.elementFromPoint(current.x, current.y)?.closest<HTMLElement>(".shotItem");
  const id = card?.dataset.shotId;
  const list = shotListElement.value;
  if (!card || !list?.contains(card) || !id) {
    dropTarget.value = undefined;
    if (!list || !current.scrollParent) return;
    const bounds = list.getBoundingClientRect(); const parent = current.scrollParent.getBoundingClientRect();
    if (current.x < bounds.left || current.x > bounds.right || current.y < parent.top || current.y > parent.bottom) return;
    const after = current.y >= bounds.bottom && current.y <= bounds.bottom + 32;
    const before = current.y <= bounds.top && current.y >= bounds.top - 24;
    const shotId = after ? shots.value.at(-1)?.shotId : before ? shots.value[0]?.shotId : undefined;
    if (shotId && shotId !== current.shotId) dropTarget.value = { shotId, after };
    return;
  }
  if (id === current.shotId) { dropTarget.value = undefined; return; }
  const bounds = card.getBoundingClientRect();
  dropTarget.value = { shotId: id, after: current.y >= bounds.top + bounds.height / 2 };
}
function scrollDrag(time: number) {
  const current = drag.value; if (!current || !draggingShotId.value) return;
  const parent = current.scrollParent;
  if (parent) {
    const bounds = parent.getBoundingClientRect();
    const top = Math.max(bounds.top, parent.querySelector(".productionNavigation")?.getBoundingClientRect().bottom || bounds.top);
    const inside = current.x >= bounds.left && current.x <= bounds.right && current.y >= top && current.y <= bounds.bottom;
    const speed = inside ? current.y < top + 48 ? -Math.min(1, (top + 48 - current.y) / 48) : current.y > bounds.bottom - 48 ? Math.min(1, (current.y - bounds.bottom + 48) / 48) : 0 : 0;
    if (speed) { parent.scrollTop += speed * 600 * Math.min(32, scrollTime ? time - scrollTime : 16) / 1000; updateDropTarget(); }
  }
  scrollTime = time; scrollFrame = requestAnimationFrame(scrollDrag);
}
function moveDrag(event: PointerEvent) {
  const current = drag.value; if (!current || current.pointerId !== event.pointerId) return;
  current.x = event.clientX; current.y = event.clientY;
  if (!draggingShotId.value && Math.hypot(current.x - current.startX, current.y - current.startY) < 5) return;
  draggingShotId.value = current.shotId; updateDropTarget();
  if (!scrollFrame) scrollFrame = requestAnimationFrame(scrollDrag);
}
async function finishDrag(event: PointerEvent) {
  const current = drag.value; if (!current || current.pointerId !== event.pointerId) return;
  moveDrag(event); const target = dropTarget.value; clearDrag(event);
  if (!target || !sequence.value || !sequence.value.shotIds.includes(current.shotId)) return;
  const order = sequence.value.shotIds.filter(id => id !== current.shotId); const index = order.indexOf(target.shotId);
  if (index < 0) return;
  order.splice(index + Number(target.after), 0, current.shotId);
  await saveOrder(order, current.shotId, current, current.element);
}
async function archiveShot(shot: ShotRecord) { const path = store.directory; const okay = await ElMessageBox.confirm(`此镜头有 ${shot.references.length} 个参考和 ${shot.candidateIds.length} 个候选。归档会从当前顺序和剪辑中移除镜头，保留媒体与采用历史。`, `归档「${shot.title}」`, { confirmButtonText: "归档镜头", cancelButtonText: "保留", type: "warning" }).then(() => true, () => false); if (okay && path === store.directory) await mutate({ type: "deleteShot", shotId: shot.shotId, confirmReferences: true }); }
async function acceptDraft(id: string) { const path = store.directory; const result = await mutate({ type: "acceptStoryboard", draftId: id }, path); if (result?.resultId && store.directory === path) sequenceId.value = result.resultId; }
onBeforeRouteLeave(async () => { if (saving.value) { ElMessage.warning("镜头正在保存，请稍后退出"); return false; } if (!editing.value) return true; let leave = false; await closeEditor(() => { leave = true; editing.value = false; }); return leave; });
</script>

<style scoped lang="scss">
.storyboardPanel {
  .panelTools { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; label { flex: 1; min-width: 160px; } .el-button { margin-left: 0; } }
  .panelHint, .emptyState { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.7; }
  .referenceChanged { color: var(--el-color-warning); font-size: 12px; line-height: 1.7; }
  .panelError { color: var(--el-color-danger); font-size: 12px; }
  .shotList { list-style: none; padding: 0; display: grid; gap: 10px;
    .shotItem { position: relative; padding: 14px; border: 1px solid var(--el-border-color-light); border-radius: 8px; &.selectedShot { border-color: var(--el-color-primary); } &.draggingShot { opacity: .55; } &.dropBefore::before, &.dropAfter::after { content: ""; position: absolute; left: 0; right: 0; height: 2px; background: var(--el-color-primary); pointer-events: none; } &.dropBefore::before { top: -6px; } &.dropAfter::after { bottom: -6px; } header { display: flex; align-items: center; gap: 10px; font-size: 12px; .shotDragHandle { display: inline-flex; flex-shrink: 0; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--el-text-color-secondary); cursor: grab; touch-action: none; &:hover { background: var(--el-fill-color-light); color: var(--el-text-color-primary); } &:active { cursor: grabbing; } &:disabled { opacity: .45; cursor: default; } } .shotNumber { color: var(--el-text-color-secondary); font-variant-numeric: tabular-nums; } .shotTitle { min-width: 0; overflow-wrap: anywhere; padding: 0; border: 0; background: none; color: var(--el-text-color-primary); text-align: left; font: inherit; font-size: 14px; font-weight: 600; flex: 1; cursor: pointer; } .shotStatus { color: var(--el-color-primary); white-space: nowrap; } }
      .shotStory, .shotDialogue { line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; } .shotDialogue { color: var(--el-text-color-secondary); }
      .shotReferences, .shotActions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; .el-button { margin-left: 0; } .referenceLink { border: 0; border-radius: 4px; padding: 4px 8px; color: var(--el-text-color-regular); background: var(--el-fill-color-light); font: inherit; font-size: 12px; text-align: left; cursor: pointer; } }
      .shotTask { margin: 10px 0 0; font-size: 12px; display: grid; gap: 6px; button { color: var(--el-color-primary); background: none; border: 0; padding: 0; text-align: left; font: inherit; cursor: pointer; } span { color: var(--el-color-danger); overflow-wrap: anywhere; } }
    }
  }
  .drafts { margin-top: 24px; h3 { font-size: 14px; } details { padding: 12px 0; border-top: 1px solid var(--el-border-color-light); summary { cursor: pointer; } li { margin-bottom: 14px; p { white-space: pre-wrap; } } } }
}
.shotForm { display: grid; gap: 14px; fieldset { border: 1px solid var(--el-border-color-light); border-radius: 6px; padding: 12px; legend { color: var(--el-text-color-secondary); } .referenceRow { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; } } .formActions { display: flex; justify-content: end; gap: 8px; } .panelHint { color: var(--el-text-color-secondary); font-size: 12px; } .panelError { color: var(--el-color-danger); } }
</style>
