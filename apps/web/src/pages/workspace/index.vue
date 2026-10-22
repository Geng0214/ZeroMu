<template>
  <main class="workspacePage" :style="{ '--agentWidth': `${agentVisible ? agentWidth : 0}px` }">
    <canvasPanel
      :key="workspaceStore.project?.directory"
      ref="canvasPanelRef"
      class="canvasPanel"
      :active="true"
      :settingsVisible="settingsVisible" />
    <el-button v-if="!agentVisible" class="agentButton canvasTopButton" text :loading="agentLoading" aria-label="打开 AI 对话" title="展开右侧 AI 对话栏" :aria-expanded="false" @click="openAgent"><agentIcon :size="18" :strokeWidth="1.75" /><span>{{ agentLoading ? '正在打开…' : '创作 Agent' }}</span></el-button>
    <component :is="floatingAgent" v-if="floatingAgent" v-model="agentVisible" @resize="agentWidth = $event" />
    <settings v-model="settingsVisible" />
    <taskButton class="workspaceTasks" />
    <nav class="productionButtons" aria-label="项目制作"><el-button @click="production.open('storyboard')">分镜</el-button><el-button @click="production.open('assets')">素材版本</el-button><el-button @click="production.open('edit')">成片</el-button><el-button @click="production.open('packages')">项目包</el-button></nav>
    <productionPanel />
  </main>
</template>

<script setup lang="ts">
import agentIcon from "@/components/agent/agentIcon.vue";
import { markRaw, onScopeDispose, provide, ref, shallowRef, watch } from "vue";
import { onBeforeRouteLeave, useRouter } from "vue-router";
import axios from "axios";
import { ElMessage, ElMessageBox } from "element-plus";
import settings from "@/components/settings/index.vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { registerWorkspaceControl, waitForControlValue } from "@/lib/mcpControl";
import canvasPanel from "./panels/canvas/canvasHost.vue";
import taskButton from "@/components/taskButton.vue";
import { useTaskCenterStore } from "@/stores/taskCenter";
import { useProductionStore, productionError } from "@/stores/production";
import productionPanel from "./components/productionPanel.vue";

const workspaceStore = useWorkspaceStore();
const taskCenter = useTaskCenterStore();
const production = useProductionStore();
const router = useRouter();
provide("openProductionProject", async (path: string) => { await flushSave(); await workspaceStore.openProject(path); await router.replace({ path: "/workspace", query: {} }); });
provide("flushProductionProject", flushSave);
const agentVisible = ref(false);
const agentLoading = ref(false);
const floatingAgent = shallowRef<typeof import("./components/floatingAgent.vue")["default"]>();
const agentWidth = ref(0);
const settingsVisible = ref(false);
const canvasPanelRef = ref<InstanceType<typeof canvasPanel>>();
provide("canvas", () => canvasPanelRef.value?.getCanvasContext());
provide("mentionCanvas", () => canvasPanelRef.value?.mentionSource);
provide("activateCanvasPanel", () => Promise.resolve(true));
const controlLifetime = new AbortController();
const projectionJobs = new Map<string, Promise<void>>();
const projectionAttempts = new Set<string>();
provide("applyProductionSelection", applyProductionSelection);
provide("openDirectorSource", async (captureId: string) => { await canvasPanelRef.value?.openDirectorSource(captureId); production.visible = false; });
function applyProductionSelection(shotId: string, path: string) {
  const key = JSON.stringify([path, shotId]);
  const prior = projectionJobs.get(key); if (prior) return prior;
  const job = Promise.resolve().then(async () => {
    let release: (() => void) | undefined;
    try { release = production.startProjection(path);
      const panel = await waitForControlValue(() => canvasPanelRef.value, controlLifetime.signal); const selection = await panel.applyProductionSelection(shotId, path); projectionAttempts.delete(JSON.stringify([path, selection.canvasId, selection.nodeId, selection.candidateId])); if (production.directory === path) delete production.projectionErrors[shotId]; }
    catch (cause) { if (production.directory === path) production.projectionErrors[shotId] = productionError(cause); throw cause; }
    finally { release?.(); projectionJobs.delete(key); }
  });
  projectionJobs.set(key, job); return job;
}
watch(() => [production.project?.revision, canvasPanelRef.value?.canvasId, canvasPanelRef.value?.canvasReady], async () => {
  const panel = canvasPanelRef.value; const path = production.directory; const canvasId = panel?.canvasId;
  if (!panel?.canvasReady || !canvasId || production.busy) return;
  for (const shot of production.project?.shots || []) {
    if (shot.archived || shot.canvasId !== canvasId || !shot.nodeId || !shot.adoptedCandidateId || panel.hasProductionSelection(canvasId, shot.nodeId, shot.adoptedCandidateId)) continue;
    const key = JSON.stringify([path, canvasId, shot.nodeId, shot.adoptedCandidateId]); if (projectionAttempts.has(key)) continue;
    projectionAttempts.add(key);
    await applyProductionSelection(shot.shotId, path).catch(() => {});
    if (production.directory !== path || panel.canvasId !== canvasId) break;
  }
}, { flush: "post" });
onScopeDispose(() => { controlLifetime.abort(new Error("工作区已关闭")); production.visible = false; });
watch(() => taskCenter.location, async location => {
  if (!location || location.directory !== workspaceStore.project?.directory) return;
  try {
    const panel = await waitForControlValue(() => canvasPanelRef.value, controlLifetime.signal);
    await panel.locateTask(location.canvasId, location.nodeId);
    if (taskCenter.location === location) taskCenter.location = undefined;
  } catch (cause) { ElMessage.error(cause instanceof Error ? cause.message : "任务原位置无法打开，请在画布仓库重新选择"); }
}, { flush: "post", immediate: true });

async function openAgent() {
  if (agentLoading.value) return;
  agentLoading.value = true;
  try {
    // 首次打开才下载对话界面；关闭后保留实例，让进行中的对话继续运行。
    floatingAgent.value ??= markRaw((await import("./components/floatingAgent.vue")).default);
    if (!controlLifetime.signal.aborted) agentVisible.value = true;
  } catch {
    if (!controlLifetime.signal.aborted) ElMessage.error("AI 对话加载失败，请重新打开");
  } finally {
    agentLoading.value = false;
  }
}
watch(() => workspaceStore.pendingAgentMessage, message => {
  if (message && message.directory === workspaceStore.project?.directory) void openAgent();
}, { immediate: true });
registerWorkspaceControl({
  getState: () => ({
    directory: workspaceStore.project?.directory ?? null,
    canvasId: canvasPanelRef.value?.canvasId || null,
    panel: "canvas",
    tools: canvasPanelRef.value?.canvasReady ? canvasPanelRef.value.getCanvasContext()?.tools ?? [] : [],

  }),
  flushSave,
  async call(request, signal) {
    const directory = workspaceStore.project?.directory;
    if (!directory) throw new Error("请先打开工作区");
    const callSignal = AbortSignal.any([signal, controlLifetime.signal]);
    const checkDirectory = () => {
      callSignal.throwIfAborted();
      if (directory !== workspaceStore.project?.directory) throw new Error("工作区已切换，本次调用已停止");
    };
    checkDirectory();
    if (request.name === "switchPanel") {
      if (request.args.panel !== "canvas") throw new Error("当前工作区仅支持画布");
      return { panel: "canvas" };
    }
    if (["getDocument", "openDocument", "writeDocument"].includes(request.name)) {
      throw new Error("文档栏目已移除，请使用工作区文件接口访问文档");
    }
    const context = await waitForControlValue(
      () => (canvasPanelRef.value?.canvasReady ? canvasPanelRef.value.getCanvasContext() : undefined),
      callSignal
    );
    checkDirectory();
    return context.call({ name: request.name, args: request.args }, callSignal);
  },
});

async function flushSave() {

  await canvasPanelRef.value?.flushSave();
}

onBeforeRouteLeave(async () => {
  if (production.projectionCounts.get(production.directory)) { ElMessage.warning("采用结果正在同步到画布，请稍后退出"); return false; }
  if (canvasPanelRef.value?.saveBusy) {
    ElMessage.warning("画布操作尚未完成，请稍后退出");
    return false;
  }
  try {
    await flushSave();
    return true;
  } catch (error) {
    const message = axios.isAxiosError<{ message?: string }>(error)
      ? error.response?.data?.message || error.message
      : error instanceof Error
      ? error.message
      : "项目保存失败";
    const leave = await ElMessageBox.confirm(`无法保存项目：${message}。文件或目录可能已被移动或删除。仍然退出将丢弃尚未保存的修改。`, "项目未保存", {
      type: "warning",
      confirmButtonText: "仍然退出",
      cancelButtonText: "留在项目",
      closeOnClickModal: false,
    }).then(
      () => true,
      () => false
    );
    if (leave) {

      canvasPanelRef.value?.cancelSave();
    }
    return leave;
  }
});

</script>

<style scoped lang="scss">
.workspacePage {
  --canvasTopButtonSize: 36px;
  position: relative;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background-color: var(--el-bg-color);

  .canvasPanel {
    position: absolute;
    inset: 0;
    width: calc(100% - var(--agentWidth, 0px));
  }
  .workspaceTasks { position: absolute; bottom: 18px; right: calc(var(--agentWidth, 0px) + 18px); z-index: 5; }
  .productionButtons { position: absolute; right: calc(var(--agentWidth, 0px) + 15px); top: 64px; display: flex; gap: 8px; z-index: 5; .el-button { margin-left: 0; background: var(--el-bg-color-overlay); } }

  .agentButton.canvasTopButton {
    position: absolute;
    top: 15px;
    right: 15px;
    z-index: 5;
    width: auto;
    padding: 0 12px;
    gap: 7px;
    background: var(--el-bg-color-overlay);
    border-color: var(--el-border-color-light);
    font-size: 12px;
    font-weight: 600;
    :deep(> span) { gap: 7px; }
  }

  :deep(.canvasTopButton) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--canvasTopButtonSize);
    height: var(--canvasTopButtonSize);
    padding: 0;
    margin: 0;
    border: 1px solid transparent;
    border-radius: var(--ui-radius, 8px);
    background: transparent;
    color: var(--el-text-color-regular);
    transition: background-color .15s ease, color .15s ease, border-color .15s ease;
    &:hover { background: var(--el-fill-color); color: var(--el-text-color-primary); }
    &:active { background: var(--el-fill-color-dark); }
    &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
    &[aria-expanded='true']:not(.sidebarToggle) { background: var(--el-fill-color-light); border-color: var(--el-border-color-light); }
    .el-badge { display: inline-flex; }
    svg { flex-shrink: 0; }
  }

  @media (pointer: coarse) {
    --canvasTopButtonSize: 44px;
  }

  @media (prefers-reduced-motion: reduce) { :deep(.canvasTopButton) { transition: none; } }

  @media (max-width: 640px) {
    .canvasPanel { width: 100%; }
    .agentButton.canvasTopButton { right: 12px; width: var(--canvasTopButtonSize); padding: 0; :deep(> span > span) { display: none; } }
  }
}
</style>
