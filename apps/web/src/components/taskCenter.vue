<template>
  <el-drawer v-model="center.visible" title="任务中心" size="min(660px, 100vw)" :modal="false" :lockScroll="false" appendToBody class="taskCenter">
    <div class="taskFilters">
      <label>项目<select v-model="directory" :disabled="!!resuming"><option value="">选择项目</option><option v-for="item in projects" :key="item.directory" :value="item.directory">{{ item.name }}</option></select></label>
      <label>媒体<select v-model="mediaType"><option value="">全部媒体</option><option value="image">图片</option><option value="video">视频</option><option value="audio">音频</option></select></label>
      <el-button :loading="loading" :disabled="!directory" @click="loadTasks">刷新</el-button>
      <el-button :aria-expanded="costOpen" @click="costOpen = !costOpen">费用与预算</el-button>
    </div>
    <mediaCostPanel v-show="costOpen" ref="costPanel" :directory="directory" :active="center.visible && costOpen" />
    <p class="taskHint">停止等待后，已提交任务仍可能继续生成和计费。状态未知时请先到渠道核对原任务。</p>
    <p v-if="error" class="taskError" role="alert">{{ error }}</p>
    <p v-for="warning in warnings" :key="warning" class="taskError" role="alert">{{ warning }}</p>
    <p v-if="!directory" class="emptyTasks">打开本地项目后，可查看工作站、节点和 Agent 的生成记录。</p>
    <p v-else-if="!loading && !tasks.length && !error" class="emptyTasks">此项目暂无{{ mediaType ? mediaLabels[mediaType] : '媒体' }}任务。生成后会在这里保存状态和结果。</p>
    <section class="taskList" :aria-busy="loading" aria-label="生成任务">
      <article v-for="task in tasks" :key="task.id" class="taskItem" :class="{ focusedTask: center.focusTask?.id === task.id }">
        <header><strong>{{ mediaLabels[task.mediaType] }} · {{ sourceLabels[task.source.kind] }}</strong><span class="taskStatus" :class="{ attention: needsAttention(task) }">{{ statusLabels[task.status] }}</span></header>
        <p class="taskPrompt">{{ task.request.prompt }}</p>
        <p class="taskMeta">{{ task.request.providerId }} / {{ task.request.modelId }} · {{ new Date(task.createdAt).toLocaleString() }}</p>
        <p v-if="task.archived" class="taskMeta">项目包中的历史任务，仅查看当时依据与已保存结果；不会继续原渠道提交。</p>
        <p v-if="task.error" class="taskError">{{ task.error }}</p>
        <p v-if="task.collectionPending" class="taskMeta" role="status">结果已保存，正在登记镜头候选…</p><p v-if="task.collectionError" class="taskError" role="alert">候选待登记：{{ task.collectionError }}</p>
        <p v-if="task.providerTaskId" class="taskMeta">渠道任务：{{ task.providerTaskId }}</p>
        <mediaTaskCost :task="task" @changed="refreshCosts" />
        <div class="taskActions">
          <el-button v-if="task.canCancel" size="small" :loading="resuming === task.id" :disabled="!!resuming" @click="cancelQueued(task)">取消排队</el-button>
          <el-button v-if="task.canResume && !isActive(task)" size="small" :loading="resuming === task.id" :disabled="!!resuming" @click="resume(task)">{{ task.canCancel ? '继续排队' : task.results.length ? '取回剩余结果' : '继续查询原任务' }}</el-button>
          <el-button v-if="task.source.canvasId || task.source.shotId || task.source.kind === 'studio'" size="small" :disabled="!!locating" @click="locate(task)">{{ locating === task.id ? '正在定位…' : task.source.shotId && !task.source.canvasId ? '返回镜头' : '返回原位置' }}</el-button>
          <el-button v-if="(task.source.directorShotId || task.source.imageEdit || task.source.kind === 'batch') && task.results.length && task.collectionError" size="small" :loading="resuming === task.id" :disabled="!!resuming || task.collectionPending || isActive(task)" @click="collectCandidates(task)">登记已保存的镜头候选</el-button>
          <span v-if="task.results.length" class="taskMeta">已保存 {{ task.results.length }} 个结果</span>
        </div>
        <div v-if="task.results.length" class="taskResults">
          <el-button v-for="(item, index) in task.results" :key="item.path" size="small" text :loading="previewLoading === item.path" @click="viewResult(task, item)">查看结果 {{ index + 1 }}</el-button>
        </div>
        <section v-if="preview?.taskId === task.id" class="taskPreview" aria-label="任务结果预览">
          <header><strong>已保存结果</strong><el-button text aria-label="关闭结果预览" @click="preview = undefined">关闭</el-button></header>
          <img v-if="preview.mediaType === 'image'" :src="preview.url" alt="生成图片" @error="previewError = '图片无法读取，请重新打开结果或检查项目文件'" />
          <video v-else-if="preview.mediaType === 'video'" :key="preview.url" :src="preview.url" controls preload="metadata" @error="previewError = '视频无法读取，请重新打开结果或检查项目文件'" />
          <audio v-else :key="preview.url" :src="preview.url" controls preload="metadata" @error="previewError = '音频无法读取，请重新打开结果或检查项目文件'" />
          <p class="taskMeta">{{ preview.path }}</p><p v-if="previewError" class="taskError" role="alert">{{ previewError }}</p>
        </section>
        <details><summary>生成依据</summary><dl><dt>任务编号</dt><dd>{{ task.id }}</dd><dt>当前阶段</dt><dd>{{ phaseLabels[task.phase] }}</dd><dt v-if="task.source.canvasId">画布</dt><dd v-if="task.source.canvasId">{{ task.source.canvasId }}{{ task.source.nodeId ? ` · 节点 ${task.source.nodeId}` : '' }}</dd><dt>输入快照</dt><dd><pre>{{ JSON.stringify(task.request, null, 2) }}</pre></dd></dl></details>
      </article>
    </section>
    <nav v-if="total > pageSize" class="taskPagination" aria-label="任务分页"><el-button :disabled="page === 1 || loading" @click="page--">上一页</el-button><span>{{ page }} / {{ pageCount }} · 共 {{ total }} 项</span><el-button :disabled="page >= pageCount || loading" @click="page++">下一页</el-button></nav>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import axios from "axios";
import type { GeneratedMedia, MediaTaskRecord } from "@toonflow/tools-scaffold/runtime";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { useWorkspaceStore } from "@/stores/workspace";
import { useTaskCenterStore } from "@/stores/taskCenter";
import { useProductionStore } from "@/stores/production";
import mediaCostPanel from "@/components/mediaCostPanel.vue";
import mediaTaskCost from "@/components/mediaTaskCost.vue";

const center = useTaskCenterStore();
const workspace = useWorkspaceStore();
const router = useRouter();
const route = useRoute();
const directory = ref("");
const mediaType = ref<"" | "image" | "video" | "audio">("");
const costOpen = computed({ get: () => center.costVisible, set: value => { center.costVisible = value; } });
const costPanel = ref<InstanceType<typeof mediaCostPanel>>();
function refreshCosts() { void loadTasks(); if (costOpen.value) void costPanel.value?.load(); }
const currentDirectory = computed(() => route.path.startsWith("/studio/") ? center.studioDirectory || workspace.project?.directory : workspace.project?.directory || center.studioDirectory);
const projects = computed(() => {
  const projects = [...workspace.projectList];
  for (const directory of [center.studioDirectory, center.focusTask?.directory]) if (directory && !projects.some(item => item.directory === directory)) projects.push({ directory, name: directory.split(/[\\/]/).filter(Boolean).at(-1) || directory, lastOpenedAt: 0 });
  return projects;
});
const tasks = ref<MediaTaskRecord[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const loading = ref(false);
const error = ref("");
const warnings = ref<string[]>([]);
const resuming = ref("");
const locating = ref("");
const previewLoading = ref("");
const preview = ref<GeneratedMedia & { url: string }>();
const previewError = ref("");
const mediaLabels = { image: "图片", video: "视频", audio: "音频" };
const sourceLabels = { studio: "工作站", node: "画布节点", agent: "Agent", legacy: "兼容入口", batch: "镜头批次" };
const statusLabels = { queued: "排队中", submitting: "正在提交", running: "生成中", downloading: "保存结果中", completed: "已完成", partial: "部分完成", failed: "失败", interrupted: "可恢复", unknown: "待核对", cancelled: "排队已取消" };
const phaseLabels = { validation: "输入校验", submission: "渠道提交", generation: "查询原任务", download: "下载与保存" };
const isActive = (task: MediaTaskRecord) => ["queued", "submitting", "running", "downloading"].includes(task.status);
const needsAttention = (task: MediaTaskRecord) => !!task.collectionError || ["unknown", "interrupted", "partial", "failed"].includes(task.status);
const message = (cause: unknown) => axios.isAxiosError<{ message?: string }>(cause) ? cause.response?.data?.message || cause.message : cause instanceof Error ? cause.message : "任务读取失败";
let controller: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let summaryTimer: ReturnType<typeof setTimeout> | undefined;
let summaryController: AbortController | undefined;
let previewRequest = 0;

async function loadTasks() {
  clearTimeout(timer);
  controller?.abort();
  if (!center.visible || !directory.value) { loading.value = false; return; }
  const current = controller = new AbortController();
  const path = directory.value;
  loading.value = true;
  try {
    const { data } = await axios.get<{ data: { tasks: MediaTaskRecord[]; total: number; warnings: string[] } }>("/api/ai/media/tasks/list", {
      params: { directory: path, mediaType: mediaType.value || undefined, offset: (page.value - 1) * pageSize, limit: pageSize }, headers: { "x-toonflow-workspace": "1" }, signal: current.signal, timeout: 15000,
    });
    if (current.signal.aborted) return;
    tasks.value = data.data.tasks; total.value = data.data.total; warnings.value = data.data.warnings; error.value = "";
    if (page.value > pageCount.value) page.value = pageCount.value;
  } catch (cause) { if (!current.signal.aborted) error.value = message(cause); }
  finally {
    if (!current.signal.aborted) { loading.value = false; timer = setTimeout(() => void loadTasks(), 5000); }
  }
}
async function loadSummary() {
  clearTimeout(summaryTimer);
  summaryController?.abort();
  const path = currentDirectory.value;
  if (!path) { center.runningCount = 0; center.attentionCount = 0; center.summaryError = ""; return; }
  const current = summaryController = new AbortController();
  try {
    const { data } = await axios.get<{ data: { runningCount: number; attentionCount: number } }>("/api/ai/media/tasks/list", {
      params: { directory: path, limit: 1 }, headers: { "x-toonflow-workspace": "1" }, signal: current.signal, timeout: 15000,
    });
    if (current.signal.aborted) return;
    center.runningCount = data.data.runningCount; center.attentionCount = data.data.attentionCount; center.summaryError = "";
  } catch (cause) { if (!current.signal.aborted) center.summaryError = message(cause); }
  finally { if (!current.signal.aborted) summaryTimer = setTimeout(() => void loadSummary(), center.runningCount || center.visible ? 5000 : 30000); }
}
async function resume(task: MediaTaskRecord) {
  if (resuming.value) return;
  resuming.value = task.id;
  try {
    await axios.post("/api/ai/media/tasks/resume", { id: task.id, directory: task.directory }, { headers: { "x-toonflow-workspace": "1" }, timeout: 15000 });
    await loadTasks(); void loadSummary();
  } catch (cause) { error.value = message(cause); }
  finally { resuming.value = ""; }
}
async function cancelQueued(task: MediaTaskRecord) {
  if (resuming.value) return;
  resuming.value = task.id;
  try {
    await axios.post("/api/ai/media/tasks/cancel", { id: task.id, directory: task.directory }, { headers: { "x-toonflow-workspace": "1" }, timeout: 15000 });
    await loadTasks(); void loadSummary();
  } catch (cause) { error.value = message(cause); }
  finally { resuming.value = ""; }
}
async function collectCandidates(task: MediaTaskRecord) { if (resuming.value) return; resuming.value = task.id; try { await axios.post("/api/production/collectTask", { id: task.id, directory: task.directory }, { headers: { "x-toonflow-workspace": "1" } }); await loadTasks(); void loadSummary(); } catch (cause) { error.value = message(cause); } finally { resuming.value = ""; } }
async function locate(task: MediaTaskRecord) {
  if (locating.value) return;
  locating.value = task.id;
  try {
    if (workspace.project?.directory !== task.directory) {
      // 先让原页面保存，再切换目录；路由取消时保持原项目。
      const failure = await router.push("/canvas");
      if (failure && route.path !== "/canvas") throw new Error("原项目尚未保存，请先完成保存再定位任务");
      await workspace.openProject(task.directory);
    }
    if (workspace.project?.directory !== task.directory) throw new Error("项目已切换，请重新定位任务");
    const target = task.source.canvasId ? { path: "/workspace", query: { canvas: task.source.canvasId } } : { path: task.source.shotId ? "/workspace" : `/studio/${task.mediaType}` };
    const failure = await router.push(target);
    if (failure && route.path !== target.path) throw new Error("页面跳转未完成，请先处理当前页面的保存状态");
    if (workspace.project?.directory !== task.directory) throw new Error("项目已切换，请重新定位任务");
    if (task.source.canvasId) center.location = { directory: task.directory, canvasId: task.source.canvasId, nodeId: task.source.nodeId, token: crypto.randomUUID() };
    else if (task.source.shotId) useProductionStore().openShot(task.source.shotId);
    center.visible = false;
  } catch (cause) { error.value = message(cause); }
  finally { locating.value = ""; }
}
async function viewResult(task: MediaTaskRecord, item: GeneratedMedia) {
  const request = ++previewRequest;
  previewLoading.value = item.path;
  previewError.value = "";
  try {
    const url = await useWorkspaceFiles(task.directory).previewUrl(item.path);
    if (request === previewRequest && task.directory === directory.value && center.visible) preview.value = { ...item, taskId: task.id, url };
  } catch (cause) { if (request === previewRequest && task.directory === directory.value) error.value = message(cause); }
  finally { if (request === previewRequest) previewLoading.value = ""; }
}
watch(currentDirectory, () => { center.runningCount = 0; center.attentionCount = 0; void loadSummary(); }, { immediate: true });
watch(() => center.visible, visible => {
  if (visible) directory.value = center.focusTask?.directory ?? currentDirectory.value ?? directory.value;
  else { controller?.abort(); clearTimeout(timer); previewRequest++; previewLoading.value = ""; preview.value = undefined; }
  if (visible) void loadTasks();
  void loadSummary();
});
watch(() => center.focusTask, task => { if (center.visible && task) directory.value = task.directory; });
watch([directory, mediaType], () => { page.value = 1; tasks.value = []; error.value = ""; warnings.value = []; previewRequest++; previewLoading.value = ""; preview.value = undefined; void loadTasks(); });
watch(page, () => void loadTasks());
onScopeDispose(() => { controller?.abort(); summaryController?.abort(); clearTimeout(timer); clearTimeout(summaryTimer); });
</script>

<style scoped lang="scss">
.taskFilters {
  display: flex; flex-wrap: wrap; align-items: end; gap: 12px;
  label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--el-text-color-secondary); &:first-child { flex: 1; min-width: 140px; } }
  select { min-width: 110px; max-width: 100%; height: 34px; border: 1px solid var(--el-border-color); border-radius: var(--ui-radius, 8px); background: var(--el-fill-color-blank); color: var(--el-text-color-primary); padding: 0 8px; font: inherit; }
}
.taskHint, .emptyTasks { color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.7; }
.taskHint { margin: 16px 0; }
.emptyTasks { padding: 24px 0; }
.taskError { color: var(--el-color-warning); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.taskList {
  .taskItem {
    padding: 18px 0; border-top: 1px solid var(--el-border-color-light); min-width: 0;
    &.focusedTask { outline: 2px solid var(--el-color-primary); outline-offset: 4px; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 12px; strong { font-size: 14px; font-weight: 600; } }
    .taskStatus { color: var(--el-color-primary); font-size: 13px; white-space: nowrap; &.attention { color: var(--el-color-warning); } }
    .taskPrompt { white-space: pre-wrap; overflow-wrap: anywhere; margin: 12px 0 8px; font-size: 14px; line-height: 1.65; max-height: 7em; overflow: auto; }
    .taskActions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 12px; .el-button { margin: 0; } }
    .taskResults { display: flex; flex-wrap: wrap; margin: 8px -8px; .el-button { margin: 0; } }
    details {
      margin-top: 12px; font-size: 12px;
      summary { color: var(--el-text-color-secondary); cursor: pointer; padding: 6px 0; }
      dl { margin: 8px 0 0; dt { color: var(--el-text-color-secondary); margin-top: 10px; } dd { margin: 4px 0 0; overflow-wrap: anywhere; } }
      pre { font-size: 12px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
    }
  }
}
.taskMeta { font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.6; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; margin: 4px 0; }
.taskPagination { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 20px; font-size: 12px; font-variant-numeric: tabular-nums; }
.taskPreview { border-top: 1px solid var(--el-border-color-light); margin-top: 20px; padding-top: 16px; header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; } img, video { display: block; width: 100%; max-height: 340px; object-fit: contain; } audio { width: 100%; } }
select:focus-visible, summary:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
</style>
