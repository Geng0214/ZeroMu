<template>
  <el-drawer v-model="store.visible" title="制作记录" :size="store.fullScreenEdit ? '100vw' : 'min(760px, 100vw)'" :withHeader="!store.fullScreenEdit" :modal="store.fullScreenEdit" :lockScroll="store.fullScreenEdit" appendToBody class="productionPanel" :class="{ smartEditFullscreen: store.fullScreenEdit }" @focusin="revealFocus">
    <header v-if="store.fullScreenEdit" class="smartEditHeader"><strong>智能剪辑</strong><div><el-button type="primary" :loading="filmEditor?.exporting" :disabled="!filmEditor?.canExport" @click="filmEditor?.startExport()">导出 MP4</el-button><el-button aria-label="关闭智能剪辑" @click="store.visible = false">关闭</el-button></div></header>
    <div v-if="!store.fullScreenEdit" ref="navigation" class="productionNavigation"><div class="productionHeader"><div><strong>{{ store.project?.name || workspace.project?.name }}</strong><p>{{ store.project ? `制作记录 · 修订 ${store.project.revision}` : '尚未建立制作记录' }}</p></div><el-button :disabled="store.busy || switching" @click="selectProject">选择工作空间</el-button><el-button :loading="store.loading" :disabled="store.busy" @click="store.load">刷新</el-button></div>
    <workspacePicker ref="projectPicker" v-model="targetDirectory" hideTrigger :disabled="switching || store.busy" />
    <nav class="productionTabs" aria-label="制作面板"><button v-for="(label, value) in panels" :key="value" :aria-pressed="store.panel === value" @click="store.panel = value">{{ label }}</button></nav></div>
    <p v-if="store.error" class="productionError" role="alert">{{ store.error }}</p>
    <section v-if="!store.project && !store.loading && !store.error" class="productionEmpty"><h3>开始剪辑</h3><p>先建立制作记录，再载入已采用的视频片段，即可使用剪辑器。</p><el-button type="primary" :loading="store.busy" :disabled="!store.directory" @click="create">建立制作记录</el-button></section>
    <div v-if="store.project" :class="{ fullScreenEditContent: store.fullScreenEdit }" :aria-busy="store.busy"><filmPanel ref="filmEditor" v-show="store.panel === 'edit'" />
      <shotBatchPanel v-show="store.panel === 'batches'" :active="store.visible && store.panel === 'batches'" />
      <section v-show="store.panel === 'snapshots'" class="snapshots"><div class="snapshotHeader"><div><h3>制作记录快照</h3><p>保存镜头顺序、固定参考和采用关系。恢复时保留之后新增的媒体版本及历史；画布布局暂不随此快照恢复。</p></div><el-button type="primary" :disabled="store.busy" @click="saveSnapshot">保存快照</el-button></div><p v-if="!store.project.snapshots.length" class="snapshotHint">在替换参考或调整镜头前，可以保存一份快照。</p><ol><li v-for="snapshot in store.project.snapshots.toReversed()" :key="snapshot.snapshotId"><div><strong>{{ snapshot.name }}</strong><p>修订 {{ snapshot.revision }} · {{ new Date(snapshot.createdAt).toLocaleString() }}</p></div><el-button :disabled="store.busy" @click="restore(snapshot.snapshotId)">恢复制作关系</el-button></li></ol><section v-if="store.recoverableVersions.length" class="recoverable"><h3>未登记版本</h3><p>中断保存时留下的完整版本，可以校验文件后继续登记。</p><article v-for="item in store.recoverableVersions" :key="item.versionId"><span>{{ item.versionId }} · {{ item.status === 'ready' ? '清单完整' : '资料不完整，保留待检查' }}</span><el-button v-if="item.status === 'ready'" :disabled="store.busy" @click="recover(item.versionId)">校验并登记</el-button></article></section></section>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { inject, onScopeDispose, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useProductionStore, productionError } from "@/stores/production";
import { useWorkspaceStore } from "@/stores/workspace";
import filmPanel from "./filmPanel.vue";
import shotBatchPanel from "./shotBatchPanel.vue";
import workspacePicker from "@/pages/home/workspacePicker.vue";
const store = useProductionStore(); const workspace = useWorkspaceStore();
const navigation = ref<HTMLElement>(); const filmEditor = ref<InstanceType<typeof filmPanel>>();
let focusFrame = 0;
function revealFocus(event: FocusEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  cancelAnimationFrame(focusFrame);
  focusFrame = requestAnimationFrame(() => {
    const header = navigation.value;
    const body = header?.closest(".el-drawer__body");
    if (!store.visible || !header || !(body instanceof HTMLElement) || header.contains(target) || !body.contains(target) || document.activeElement !== target) return;
    const bounds = target.getBoundingClientRect();
    const top = header.getBoundingClientRect().bottom + 8;
    const bottom = body.getBoundingClientRect().bottom - 8;
    if (bounds.top < top) body.scrollTop -= top - bounds.top;
    else if (bounds.bottom > bottom) body.scrollTop += bounds.bottom - bottom;
  });
}
onScopeDispose(() => cancelAnimationFrame(focusFrame));
const panels = { edit: "成片", batches: "镜头批次", snapshots: "快照恢复" };
const projectPicker = ref<InstanceType<typeof workspacePicker>>(); const targetDirectory = ref(""); const switching = ref(false);
const openProject = inject<(path: string) => Promise<void>>("openProductionProject");
async function create() { try { await store.create(); } catch (cause) { ElMessage.error(productionError(cause)); } }
async function selectProject() { if (!openProject || switching.value) return; switching.value = true; try { const path = await projectPicker.value?.chooseDirectory(); if (path && path !== store.directory) await openProject(path); } catch (cause) { ElMessage.error(productionError(cause)); } finally { switching.value = false; } }
async function saveSnapshot() { const path = store.directory; const answer = await ElMessageBox.prompt("保存当前制作关系，便于稍后恢复", "制作记录快照", { inputValue: `制作快照 ${new Date().toLocaleString()}`, inputValidator: value => !!value?.trim() && value.length <= 200 }).catch(() => null); if (answer) try { await store.update({ type: "snapshot", name: answer.value }, path); } catch (cause) { ElMessage.error(productionError(cause)); } }
async function restore(id: string) { const path = store.directory; const okay = await ElMessageBox.confirm("镜头顺序、参考和采用结果将恢复到快照。之后新增的版本、候选和历史会保留；快照后新增的镜头会归档。画布布局保持当前状态。", "恢复制作关系", { confirmButtonText: "恢复", cancelButtonText: "取消", type: "warning" }).then(() => true, () => false); if (okay) try { await store.update({ type: "restoreSnapshot", snapshotId: id }, path); } catch (cause) { ElMessage.error(productionError(cause)); } }
async function recover(id: string) { try { await store.update({ type: "recoverAssetVersion", versionId: id }); await store.load(); } catch (cause) { ElMessage.error(productionError(cause)); } }
</script>

<style lang="scss">
.productionPanel {
  transition-property: transform;
  .el-drawer__header { margin-bottom: 12px; }
  .el-drawer__body { padding-top: 0; }
  .productionNavigation { position: sticky; top: 0; z-index: 2; padding-top: 8px; background: var(--el-bg-color); }
  .productionHeader { display: flex; justify-content: space-between; align-items: center; gap: 12px; strong { font-size: 15px; } p { font-size: 12px; color: var(--el-text-color-secondary); margin: 6px 0; } }
  .productionTabs { display: flex; flex-wrap: wrap; gap: 0 18px; margin: 12px 0 20px; border-bottom: 1px solid var(--el-border-color-light); button { border: 0; border-bottom: 2px solid transparent; padding: 10px 0; font: inherit; white-space: nowrap; background: none; color: var(--el-text-color-secondary); cursor: pointer; &[aria-pressed='true'] { border-bottom-color: var(--el-color-primary); color: var(--el-text-color-primary); font-weight: 600; } } }
  label { display: grid; gap: 6px; font-size: 12px; }
  input:not([type='checkbox']):not([type='file']), select, textarea { min-width: 0; width: 100%; box-sizing: border-box; border: 1px solid var(--el-border-color); border-radius: 5px; padding: 8px 10px; background: var(--el-bg-color); color: var(--el-text-color-primary); font: inherit; }
  button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
  .productionError { color: var(--el-color-danger); font-size: 13px; }
  .productionEmpty { padding: 30px 8px; h3 { font-size: 18px; } p { max-width: 430px; line-height: 1.8; color: var(--el-text-color-secondary); } }
  .snapshots { .snapshotHeader { display: flex; gap: 14px; align-items: start; h3 { font-size: 15px; margin-top: 0; } p { line-height: 1.7; color: var(--el-text-color-secondary); font-size: 12px; } } > ol { list-style: none; padding: 0; li { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 16px 0; border-bottom: 1px solid var(--el-border-color-light); strong { font-size: 14px; } p { color: var(--el-text-color-secondary); font-size: 12px; } } } .snapshotHint, .recoverable p { color: var(--el-text-color-secondary); font-size: 12px; } .recoverable { margin-top: 24px; h3 { font-size: 15px; } article { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; span { font-size: 12px; overflow-wrap: anywhere; flex: 1; min-width: 200px; } } } }
}
.productionPanel.smartEditFullscreen {
  .el-drawer__body { display: flex; flex-direction: column; overflow: hidden; padding: 0; }
  .smartEditHeader { display: flex; flex: 0 0 54px; align-items: center; justify-content: space-between; padding: 0 20px; border-bottom: 1px solid var(--el-border-color-light); strong { font-size: 14px; } }
  .productionError { margin: 12px 20px 0; }
  .productionEmpty { flex: 1; overflow: auto; padding: 24px; }
  .fullScreenEditContent { min-height: 0; flex: 1; overflow: auto; padding: 20px 24px; }
}
.shotForm, .versionForm { label { display: grid; gap: 6px; font-size: 12px; } input:not([type='checkbox']):not([type='file']), select, textarea { min-width: 0; width: 100%; box-sizing: border-box; border: 1px solid var(--el-border-color); border-radius: 5px; padding: 8px 10px; background: var(--el-bg-color); color: var(--el-text-color-primary); font: inherit; } button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; } }
</style>
