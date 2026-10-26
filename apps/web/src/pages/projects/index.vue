<template>
  <libraryShell>
    <section class="projectsPage">
      <header class="projectsHeader">
        <div><h1>工作空间</h1><p>每个项目保存在自己的文件夹中，画布和素材都跟随项目保存。</p></div>
        <div class="headerActions"><button :disabled="busy" @click="importFolder()"><icon-folder-plus :size="16" />添加已有项目</button><button class="primaryAction" :disabled="busy" @click="startCreate"><icon-plus :size="17" />新建项目</button></div>
      </header>

      <div v-if="error || workspace.startupError" class="feedback" role="alert"><span>{{ error || workspace.startupError }}</span><button :disabled="busy" @click="reload">重试</button></div>
      <div v-for="issue in workspace.issues" :key="issue" class="feedback" role="alert">{{ issue }}</div>

      <div class="projectToolbar">
        <div class="projectCount">项目 <span>{{ loading && !allProjects.length ? '读取中…' : allProjects.length }}</span></div>
        <div class="searchTools"><label class="projectSearch"><icon-search :size="16" /><input v-model="query" placeholder="搜索项目或文件夹路径" aria-label="搜索项目或文件夹路径" /><button v-if="query" class="clearSearch" aria-label="清空搜索" @click="query = ''"><icon-x :size="14" /></button></label><button class="refreshAction" :disabled="busy" aria-label="刷新项目" title="刷新项目" @click="reload"><icon-refresh :size="17" /></button></div>
      </div>

      <div v-if="loading && !allProjects.length" class="loadingProjects" role="status" aria-label="正在读取项目"><div v-for="index in 3" :key="index" class="loadingRow" aria-hidden="true"><span></span><i></i></div></div>
      <div v-else-if="visibleProjects.length" class="projectList">
        <div class="listColumns" aria-hidden="true"><span>项目文件夹</span><span>画布</span><span>最近更新</span><span class="actionsColumn">操作</span></div>
        <article v-for="item in visibleProjects" :key="item.directory" class="projectRow" :class="{ currentRow: workspace.project?.directory === item.directory }">
          <button class="projectOpen" :disabled="busy" :aria-label="'打开项目 ' + item.name" @click="open(item.directory)">
            <span class="projectIcon"><icon-folder :size="26" :strokeWidth="1.4" /></span>
            <span class="projectIdentity"><span class="projectTitle"><strong>{{ item.name }}</strong><span v-if="workspace.project?.directory === item.directory" class="projectBadge">当前项目</span></span><span class="projectPath" :title="item.directory">{{ item.directory }}</span></span>
          </button>
          <span class="canvasCount">{{ item.canvasCount ?? '—' }}<small> 张画布</small></span>
          <time class="projectDate" :datetime="item.updatedAt ? new Date(item.updatedAt).toISOString() : undefined">{{ formatDate(item.updatedAt) }}</time>
          <div class="projectActions">
            <button :disabled="busy" :aria-label="'重命名项目 ' + item.name" @click="rename(item)"><icon-pencil :size="15" />重命名</button>
            <button class="deleteAction" :disabled="busy" :aria-label="'删除项目 ' + item.name" @click="deleteProject(item)"><icon-trash :size="15" />删除项目</button>
          </div>
        </article>
      </div>
      <div v-else-if="query && allProjects.length" class="emptyProjects"><icon-search :size="30" :strokeWidth="1.4" /><h2>没有找到相关项目</h2><button @click="query = ''">清空搜索</button></div>
      <div v-else-if="!error && !workspace.startupError && !workspace.issues.length" class="emptyProjects"><icon-folder :size="36" :strokeWidth="1.2" /><h2>从你的第一个项目开始</h2><p>选择工作空间创建项目，或添加已有项目文件夹。</p><button class="primaryAction" :disabled="busy" @click="startCreate"><icon-plus :size="16" />新建项目</button></div>
      <p v-if="busy && !loading" class="operationStatus" role="status">{{ operation }}</p>
    </section>
    <workspacePicker ref="picker" hideTrigger />
  </libraryShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { IconFolder, IconFolderPlus, IconPlus, IconPencil, IconTrash, IconSearch, IconRefresh, IconX } from "@tabler/icons-vue";
import axios from "axios";
import libraryShell from "@/components/libraryShell.vue";
import workspacePicker from "@/pages/home/workspacePicker.vue";
import { useWorkspaceStore, type Project } from "@/stores/workspace";

const workspace = useWorkspaceStore();
const router = useRouter();
const route = useRoute();
const picker = ref<InstanceType<typeof workspacePicker>>();
const query = ref(""), busy = ref(false), loading = ref(false), error = ref(""), operation = ref("");
const allProjects = computed(() => [...workspace.projectList, ...workspace.recoverableProjects].sort((a, b) => Number(b.directory === workspace.project?.directory) - Number(a.directory === workspace.project?.directory) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.name.localeCompare(b.name, "zh-CN")));
const visibleProjects = computed(() => allProjects.value.filter(item => (item.name + " " + item.directory).toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())));
function formatDate(value?: number) { return value ? new Date(value).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }) : "—"; }
function errorText(cause: unknown) { return axios.isAxiosError(cause) ? cause.response?.data?.message || cause.message : cause instanceof Error ? cause.message : "操作失败"; }
async function run(label: string, action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true; error.value = ""; operation.value = label;
  try { await action(); } catch (cause) { error.value = errorText(cause); } finally { busy.value = false; }
}
async function continueToProject() {
  const next = typeof route.query.next === "string" && /^\/(canvas|workspace|studio\/|home|assets|prompts)/.test(route.query.next) ? route.query.next : "/canvas";
  await router.replace(next);
}
async function startCreate() {
  await run("正在创建项目…", async () => {
    await workspace.initialize();
    let directory = workspace.workspaceRoot?.directory;
    if (!directory) {
      directory = await picker.value?.chooseDirectory() || undefined;
      if (!directory) return;
      await workspace.selectWorkspace(directory);
      directory = workspace.workspaceRoot?.directory;
    }
    if (!directory) throw new Error("请先选择工作空间");
    await workspace.createProject(directory);
    query.value = "";
    if (route.query.next) await continueToProject();
    else await router.push({ path: "/workspace", query: { canvas: "无限画布1.json" } });
  });
}
async function open(directory: string) { await run("正在打开项目…", async () => { await workspace.openProject(directory); await continueToProject(); }); }
async function reload() { loading.value = true; try { await run("正在读取项目…", workspace.refresh); } finally { loading.value = false; } }
async function rename(item: Project) {
  await run("正在重命名项目…", async () => {
    const result = await ElMessageBox.prompt("输入新的项目名称", "重命名项目", { inputValue: item.name, inputValidator: value => !!value?.trim() && value.trim().length <= 100 || "请输入 1–100 字的项目名称", confirmButtonText: "保存", cancelButtonText: "取消" }).catch(() => null);
    if (!result) return;
    const name = result.value.trim();
    const folderName = item.directory.split(/[\\/]/).filter(Boolean).at(-1);
    if (name === item.name && name === folderName) return;
    await workspace.renameProject(item.directory, name);
    ElMessage.success("项目已重命名");
  });
}
async function deleteProject(item: Project) {
  await run("正在删除项目…", async () => {
    const confirmed = await ElMessageBox.confirm(`确定永久删除项目“${item.name}”？这会删除整个项目文件夹及其中的画布、素材和备份：\n${item.directory}\n此操作无法撤销。`, "删除项目", { confirmButtonText: "永久删除", cancelButtonText: "保留项目", type: "warning", closeOnClickModal: false }).then(() => true, () => false);
    if (!confirmed) return;
    await workspace.deleteProject(item.directory, item.projectId);
    ElMessage.success("项目文件夹及其中内容已删除");
  });
}
async function importFolder() {
  await run("正在添加项目…", async () => {
    const directory = await picker.value?.chooseDirectory();
    if (!directory) return;
    await workspace.importProject(directory); query.value = "";
    if (route.query.next) await continueToProject();
    else ElMessage.success("项目已添加");
  });
}
onMounted(reload);
</script>

<style scoped lang="scss">
.projectsPage {
  width: min(100%, 1140px); margin: 16px auto; color: var(--homeText);
  button, input { box-sizing: border-box; font: inherit; }
  button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 38px; padding: 8px 14px; border: 1px solid var(--homeLine); border-radius: 5px; background: transparent; color: var(--homeText); font-size: 13px; cursor: pointer; &:hover:not(:disabled) { background: var(--homeRaised); } &:disabled { cursor: default; opacity: .5; } &:focus-visible { outline: 2px solid var(--homeAccent); outline-offset: 3px; } }
  .primaryAction { background: var(--homeText); border-color: var(--homeText); color: var(--homeBg); &:hover:not(:disabled) { opacity: .85; background: var(--homeText); } }
  .projectsHeader { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 30px; h1 { margin: 0; font-size: 30px; font-weight: 600; letter-spacing: -.025em; } p { margin: 12px 0 0; font-size: 13px; color: var(--homeMuted); } }
  .headerActions { display: flex; gap: 10px; flex-shrink: 0; }
  .workspaceBar { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 14px 16px; border: 1px solid var(--homeLine); border-radius: 6px; background: var(--homeSurface); >svg { flex-shrink: 0; color: var(--homeMuted); } .workspaceIdentity { display: flex; align-items: baseline; gap: 16px; flex: 1; min-width: 0; strong { flex-shrink: 0; font-size: 13px; font-weight: 500; } span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--homeMuted); font-size: 12px; } } .textAction { padding: 4px 0 4px 12px; border: 0; flex-shrink: 0; min-height: 30px; color: var(--homeMuted); } }
  .newProjectForm { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 22px 0 6px; label { font-size: 13px; } input { flex: 1; min-width: 160px; min-height: 40px; padding: 8px 12px; border: 1px solid var(--homeLine); border-radius: 5px; background: var(--homeSurface); color: var(--homeText); font-size: 14px; &:focus-visible { outline: 2px solid var(--homeAccent); outline-offset: 2px; } } }
  .projectToolbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin: 36px 0 18px; .projectCount { display: flex; align-items: baseline; gap: 10px; font-size: 15px; font-weight: 500; span { color: var(--homeMuted); font-size: 13px; font-weight: 400; font-variant-numeric: tabular-nums; } } .searchTools { display: flex; gap: 10px; align-items: center; } .refreshAction { padding: 8px; width: 38px; } }
  .projectSearch { display: flex; align-items: center; gap: 8px; width: 256px; min-height: 38px; padding: 0 10px; border: 1px solid var(--homeLine); border-radius: 5px; background: var(--homeSurface); color: var(--homeMuted); &:focus-within { outline: 2px solid var(--homeAccent); outline-offset: 2px; } input { min-width: 0; width: 100%; padding: 8px 0; border: 0; outline: none; background: transparent; color: var(--homeText); font-size: 12px; } .clearSearch { flex-shrink: 0; min-height: 24px; width: 24px; padding: 0; border: 0; } }
  .listColumns, .projectRow { display: grid; grid-template-columns: minmax(0, 1fr) 84px 112px 184px; align-items: center; gap: 20px; }
  .listColumns { padding: 14px 16px; color: var(--homeMuted); font-size: 12px; border-bottom: 1px solid var(--homeLine); .actionsColumn { text-align: right; } }
  .projectRow { padding: 22px 16px; border-bottom: 1px solid var(--homeLine); &:hover, &:focus-within { background: var(--homeSurface); } .projectOpen { justify-content: flex-start; min-width: 0; padding: 0; border: 0; text-align: left; gap: 14px; &:hover:not(:disabled) { background: transparent; } } .projectIcon { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 48px; height: 52px; color: var(--homeMuted); background: var(--homeRaised); border-radius: 7px; } .projectIdentity { display: grid; min-width: 0; gap: 8px; } .projectTitle { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; strong { font-size: 17px; font-weight: 500; overflow-wrap: anywhere; } } .projectBadge { flex-shrink: 0; padding: 2px 6px; border: 1px solid var(--homeLine); border-radius: 4px; font-size: 10px; line-height: 16px; font-weight: 400; color: var(--homeMuted); } .projectPath { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--homeMuted); } .canvasCount { font-size: 15px; font-variant-numeric: tabular-nums; small { display: none; } } .projectDate { font-size: 12px; color: var(--homeMuted); } .projectActions { display: flex; justify-content: flex-end; gap: 8px; button { padding: 7px 10px; font-size: 12px; } .deleteAction { color: var(--el-color-danger); } .connectAction { color: var(--homeText); } } }
  .emptyProjects { display: grid; justify-items: center; padding: 86px 20px; text-align: center; >svg { color: var(--homeMuted); margin-bottom: 20px; } h2 { margin: 0; font-size: 19px; font-weight: 500; } p { margin: 14px 0 24px; color: var(--homeMuted); font-size: 13px; } button { margin-top: 18px; } }
  .feedback { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-top: 20px; padding: 12px 14px; border: 1px solid var(--el-color-danger); border-radius: 5px; color: var(--el-color-danger); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
  .operationStatus { margin-top: 22px; color: var(--homeMuted); font-size: 13px; }
  .loadingProjects { .loadingRow { display: flex; gap: 20px; align-items: center; padding: 22px 16px; border-bottom: 1px solid var(--homeLine); span { width: 48px; height: 52px; border-radius: 7px; background: var(--homeRaised); } i { width: min(40%, 280px); height: 14px; background: var(--homeRaised); border-radius: 3px; } } }
  @media (max-width: 1100px) { .listColumns, .projectRow { grid-template-columns: minmax(0, 1fr) 70px 168px; gap: 14px; } .listColumns>span:nth-child(3), .projectDate { display: none; } }
  @media (max-width: 680px) { margin-top: 8px; .projectsHeader { align-items: flex-start; flex-direction: column; gap: 22px; margin-bottom: 24px; h1 { font-size: 28px; } } .headerActions { width: 100%; button { flex: 1; min-height: 42px; } } .workspaceBar { align-items: flex-start; padding: 14px 12px; .workspaceIdentity { display: grid; gap: 6px; } .textAction { padding-left: 4px; min-height: 24px; font-size: 12px; } } .projectToolbar { margin-top: 28px; align-items: flex-start; flex-direction: column; gap: 18px; .searchTools { width: 100%; } } .projectSearch { width: auto; flex: 1; } .listColumns { display: none; } .projectRow { grid-template-columns: minmax(0, 1fr) auto; gap: 16px; padding: 22px 0; .projectOpen { grid-column: 1 / -1; } .projectTitle strong { font-size: 16px; } .projectIcon { width: 42px; height: 48px; } .canvasCount { padding-left: 56px; color: var(--homeMuted); font-size: 12px; small { display: inline; } } .projectActions { button { min-height: 40px; } } } .newProjectForm { input { flex-basis: calc(100% - 80px); } } .emptyProjects { padding: 64px 12px; } }
}
</style>
