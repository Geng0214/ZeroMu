<template>
    <section class="projectList" aria-labelledby="projectListTitle"><div class="sectionHeader"><div><h2 id="projectListTitle">项目 <span>{{ projectList.length }}</span></h2><p>画布与创作文件，按项目整理。</p></div><div class="projectToolbar"><el-input v-model="projectQuery" class="projectSearch" :prefixIcon="IconSearch" placeholder="搜索项目" aria-label="搜索项目" clearable /><el-button :icon="iconFolderOpen" :disabled="creating || opening" @click="openProject()">导入</el-button><el-button :icon="IconFolderPlus" :disabled="creating || opening" @click="createProject()">新建项目</el-button><el-button circle :icon="sortDescending ? IconSortDescending : IconSortAscending" :aria-label="sortDescending ? '按时间降序' : '按时间升序'" @click="sortDescending = !sortDescending" /><el-button circle :icon="viewMode === 'grid' ? IconList : IconLayoutGrid" :aria-label="viewMode === 'grid' ? '切换列表视图' : '切换网格视图'" @click="viewMode = viewMode === 'grid' ? 'list' : 'grid'" /></div></div>
      <div v-if="!sortedProjects.length" class="emptyProjects"><icon-folder :size="30" /><h3>{{ projectQuery ? '没有找到匹配的项目' : '你的第一部作品，从这里开始' }}</h3><p>{{ projectQuery ? '试试其他名称或文件夹路径。' : '新建画布，或导入已有项目。你的文件保存在本地。' }}</p><button v-if="!projectQuery" class="textAction" :disabled="creating || opening" @click="createProject()">创建第一个项目<icon-arrow-right :size="16" /></button></div>
      <div v-else class="projectItems" :class="{ listView: viewMode === 'list' }"><article v-for="item in sortedProjects" :key="item.directory" class="projectCard"><button class="projectEntry" :disabled="creating || opening" :aria-label="'打开项目 ' + item.name" @click="openProject(item)"><icon-folder class="projectIcon" :size="28" /><span class="projectInfo"><strong class="projectName" :title="item.name">{{ item.name }}</strong><span class="projectPath" :title="item.directory">{{ item.directory }}</span><span class="projectTime">最近打开 {{ new Date(item.lastOpenedAt).toLocaleString(locale, { hour12: false }) }}</span></span></button><div class="projectActions"><el-button text :icon="IconEdit" :disabled="creating || opening" :aria-label="'重命名项目 ' + item.name" @click="renameProject(item)" /><el-button text :icon="IconTrash" :disabled="creating || opening" :aria-label="'删除项目 ' + item.name" title="移入工作空间的 zeromuTrash 目录，可在项目页的回收目录还原" @click="deleteProject(item)" /></div></article></div>
    </section>
<workspacePicker ref="relocationPicker" hideTrigger />
</template>
<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import axios from "axios";
import { ElMessage, ElMessageBox } from "element-plus";
import { IconSearch, IconFolder, IconFolderPlus, IconFolderOpen as iconFolderOpen, IconSortDescending, IconSortAscending, IconList, IconLayoutGrid, IconEdit, IconTrash, IconArrowRight } from "@tabler/icons-vue";
import { locale } from "@toonflow/i18n/vue";
import { useWorkspaceStore, type Project } from "@/stores/workspace";
import workspacePicker from "@/pages/home/workspacePicker.vue";
const router = useRouter();
const workspaceStore = useWorkspaceStore();
const { projectList } = storeToRefs(workspaceStore);
const relocationPicker = ref<InstanceType<typeof workspacePicker>>();
const creating = ref(false);
const opening = ref(false);
const projectQuery = ref("");
const sortDescending = ref(true);
const viewMode = ref("grid");
const sortedProjects = computed(() => projectList.value.filter(item => `${item.name} ${item.directory}`.toLowerCase().includes(projectQuery.value.trim().toLowerCase())).sort((a, b) => sortDescending.value ? b.lastOpenedAt - a.lastOpenedAt : a.lastOpenedAt - b.lastOpenedAt));
async function openProject(project?: Project) {
  if (creating.value || opening.value) return;
  opening.value = true;
  try {
    const directory = project?.directory ?? await relocationPicker.value?.chooseDirectory();
    if (!directory) return;
    try { await workspaceStore.openProject(directory); }
    catch (err) {
      if (!project || !axios.isAxiosError(err) || err.response?.status !== 404) throw err;
      const reselect = await ElMessageBox.confirm(`项目“${project.name}”的文件夹不存在，是否重新选择文件夹？`, "工作目录不存在", {
        confirmButtonText: "重新选择", cancelButtonText: "取消", type: "warning",
      }).then(() => true, () => false);
      if (!reselect) return;
      const directory = await relocationPicker.value?.chooseDirectory();
      if (!directory) return;
      await workspaceStore.openProject(directory, project.directory);
    }
    await router.push("/canvas");
  } catch (err) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(err)
      ? err.response?.data.message || "无法打开项目，请重试"
      : err instanceof Error ? err.message : "无法打开项目，请重试");
  } finally { opening.value = false; }
}

async function renameProject(project: Project) {
  const result = await ElMessageBox.prompt("请输入项目名称", "重命名项目", {
    inputValue: project.name, confirmButtonText: "保存", cancelButtonText: "取消",
    inputValidator: value => !!value?.trim() || "项目名称不能为空",
  }).catch(() => null);
    if (!result) return;
    opening.value = true;
    try { await workspaceStore.renameProject(project.directory, result.value); }
    catch (cause) { ElMessage.error(axios.isAxiosError(cause) ? cause.response?.data?.message || cause.message : cause instanceof Error ? cause.message : "重命名失败"); }
    finally { opening.value = false; }
}

async function deleteProject(project: Project) {
  if (creating.value || opening.value) return;
  const confirmed = await ElMessageBox.confirm(`确定删除项目“${project.name}”？整个项目文件夹会移入工作空间的 zeromuTrash 目录，画布、素材和备份一并保留，可在「项目」页的回收目录还原，也可按目录名从磁盘取回：\n${project.directory}`, "删除项目", {
    confirmButtonText: "移入回收目录", cancelButtonText: "保留项目", type: "warning", closeOnClickModal: false,
  }).then(() => true, () => false);
  if (!confirmed) return;
  opening.value = true;
  try {
    await workspaceStore.deleteProject(project.directory, project.projectId);
    ElMessage.success("项目文件夹已移入工作空间的 zeromuTrash 目录");
  } catch (cause) {
    ElMessage.error(axios.isAxiosError(cause) ? cause.response?.data?.message || cause.message : cause instanceof Error ? cause.message : "删除项目失败");
  } finally { opening.value = false; }
}

async function createProject() {
  if (creating.value || opening.value) return;
  creating.value = true;
  try {
    await workspaceStore.initialize();
    let directory = workspaceStore.workspaceRoot?.directory;
    if (!directory) {
      directory = await relocationPicker.value?.chooseDirectory() || undefined;
      if (!directory) return;
      await workspaceStore.selectWorkspace(directory);
      directory = workspaceStore.workspaceRoot?.directory;
    }
    if (!directory) throw new Error("请先选择工作空间");
    await workspaceStore.createProject(directory);
    await router.push({ path: "/workspace", query: { canvas: "无限画布1.json" } });
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : "创建项目失败，请重试"); }
  finally { creating.value = false; }
}
</script>
<style scoped lang="scss">
.projectList { flex:1; min-height:0; display:flex; flex-direction:column; padding:20px 0 0; }
.sectionHeader { flex-shrink:0; display:flex; align-items:center; justify-content:space-between; gap:20px; h2 { margin:0; font-size:20px; } p { margin:8px 0 0; font-size:13px; color:var(--homeMuted); } }
.textAction { display:inline-flex; gap:8px; align-items:center; border:0; background:none; color:var(--homeAccent); }
  .sectionHeader h2 span { font-size: 12px; margin-left: 10px; color: var(--homeMuted); font-variant-numeric: tabular-nums; }
  .projectToolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; :deep(.el-button + .el-button) { margin-left: 0; } .projectSearch { width: 150px; } }
  .emptyProjects { overflow:auto; text-align: center; padding: 44px 20px; color: var(--homeMuted); h3 { color: var(--homeText); font-size: 16px; margin: 15px 0 10px; font-weight: 500; } p { font-size: 12px; margin-bottom: 12px; } }
  .projectItems { min-height:0; overflow:auto; align-content:start; padding:2px; display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 18px; margin-top: 24px; &.listView { grid-template-columns: 1fr; } }
  .projectCard { background: var(--homeSurface); border-radius: var(--ui-radius-large, 12px); min-width: 0; display: flex; padding: 18px; }
  .projectEntry { display: flex; align-items: center; gap: 16px; min-width: 0; flex: 1; border: 0; padding: 0; background: none; text-align: left; color: var(--homeText); .projectIcon { flex-shrink: 0; color: var(--homeAccent); } .projectInfo { display: grid; gap: 8px; min-width: 0; } .projectName { font-size: 14px; } .projectPath,.projectTime { font-size: 11px; color: var(--homeMuted); } .projectName,.projectPath { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
  .projectActions { display: flex; flex-direction: column; :deep(.el-button) { margin: 0; padding: 6px; } }

.projectItems { grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); }
.projectCard { border:1px solid var(--homeLine); }
.projectCard:hover { border-color:var(--homeAccent); }
@media(max-width:900px) { .sectionHeader { align-items:flex-start; flex-direction:column; } }
@media(max-width:600px) { .projectItems { grid-template-columns:1fr; } .projectToolbar { width:100%; .projectSearch { width:100%; } } }
</style>
