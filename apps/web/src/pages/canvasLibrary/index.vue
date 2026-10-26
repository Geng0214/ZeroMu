<template>
  <libraryShell>
    <section class="canvasLibrary" aria-labelledby="canvasLibraryTitle">
      <div class="projectContext">
        <router-link to="/projects" class="projectIdentity" :title="selectedProject?.directory || workspace.workspaceRoot?.directory"><icon-folder-open :size="17" aria-hidden="true" /><span>{{ selectedProject ? '所属项目' : '工作空间' }}</span><strong>{{ selectedProject?.name || workspace.workspaceRoot?.name || '选择项目' }}</strong></router-link>
        <span v-if="selectedProject || workspace.workspaceRoot" class="projectPath" :title="selectedProject?.directory || workspace.workspaceRoot?.directory">{{ selectedProject?.directory || workspace.workspaceRoot?.directory }}</span>
      </div>
      <header class="canvasLibraryHeader">
        <div class="headingCopy"><h1 id="canvasLibraryTitle">画布</h1><span v-if="!loading">{{ canvases.length }} 个画布</span></div>
        <div class="libraryActions"><button :disabled="busy || loading || !!editingCanvas" :aria-pressed="managementMode" @click="toggleManagement"><icon-adjustments :size="16" aria-hidden="true" />{{ managementMode ? '完成管理' : '管理' }}</button><button :disabled="busy || loading" @click="openProject"><icon-folder-open :size="16" />打开项目</button><button :disabled="busy || loading" @click="beginImport"><icon-file-import :size="16" />导入画布</button><button class="primaryAction" :disabled="busy || loading" @click="createCanvas"><icon-plus :size="17" />新建画布</button><div class="viewSwitch" role="group" aria-label="画布视图"><button :aria-pressed="view === 'grid'" aria-label="网格视图" title="网格视图" @click="view = 'grid'"><icon-layout-grid :size="18" /></button><button :aria-pressed="view === 'list'" aria-label="列表视图" title="列表视图" @click="view = 'list'"><icon-list :size="18" /></button></div></div>
      </header>
      <div v-if="projects.length" class="projectToolbar">
        <div class="projectTabs" role="group" aria-label="按所属项目筛选画布">
          <button :aria-pressed="activeProject === 'all'" :disabled="busy || loading || !!editingCanvas" @click="selectProject('all')">全部 <span>{{ canvases.length }}</span></button>
          <button v-for="project in projects" :key="project.directory" :aria-pressed="activeProject === project.directory" :disabled="busy || loading || !!editingCanvas" @click="selectProject(project.directory)">{{ project.name }} <span>{{ projectCounts[project.directory] || 0 }}</span></button>
        </div>
        <button :disabled="busy || loading || !!editingCanvas" aria-label="刷新画布" title="刷新画布" @click="loadCanvases"><icon-refresh :size="16" aria-hidden="true" /></button>
      </div>
      <div class="libraryToolbar">
        <el-input v-model="query" aria-label="搜索画布" placeholder="查找画布" :prefixIcon="IconSearch" clearable />
        <select v-model="sortOrder" aria-label="画布排序"><option value="modified">最近修改</option><option value="name">名称顺序</option></select>
      </div>
      <div v-if="managementMode" class="managementToolbar" aria-label="批量管理画布">
        <span role="status">已选择 {{ selectedItems.length }} 张画布</span>
        <button class="deleteAction" :disabled="busy || !selectedItems.length || !!editingCanvas" @click="deleteCanvases(selectedItems)"><icon-trash :size="16" aria-hidden="true" />删除所选</button>
        <button :disabled="busy || !selected.length" @click="selected = []">清空选择</button>
      </div>
      <div class="canvasColumns" :class="{ gridColumns: view === 'grid' }"><input type="checkbox" :checked="allVisibleSelected" :indeterminate="selected.length > 0 && !allVisibleSelected" :disabled="busy || !visibleCanvases.length" aria-label="选择当前画布列表" @change="toggleSelection" /><span>{{ view === 'grid' ? '全选' : '名称' }}</span><template v-if="view === 'list'"><span>修改时间</span><span class="actionsLabel">操作</span></template></div>
      <p v-if="loading" class="libraryStatus" role="status">正在读取画布…</p>
      <div v-if="loadError" class="libraryStatus" role="alert"><p>{{ loadError }}</p><button @click="loadCanvases">重新读取</button></div>
      <div v-if="!loading && !loadError && !canvases.length" class="emptyLibrary"><icon-layout-grid :size="32" :strokeWidth="1.5" /><h2>创建你的第一张画布</h2><p>在画布里组织想法、素材和创作流程。</p><button :disabled="busy" @click="createCanvas"><icon-plus :size="16" />新建画布</button></div>
      <div v-if="!loading && canvases.length && !visibleCanvases.length" class="libraryStatus" role="status"><p>{{ query ? '没有找到“' + query + '”' : '当前项目下还没有画布' }}</p><button @click="query = ''; selectProject('all')">显示全部画布</button></div>
      <div v-if="visibleCanvases.length" class="canvasGrid" :class="{ cardView: view === 'grid' }">
        <article v-for="item in visibleCanvases" :key="item.key" class="canvasCard" :class="{ selected: selected.includes(item.key) }">
          <input v-model="selected" class="cardCheckbox" type="checkbox" :value="item.key" :aria-label="`选择画布 ${item.name}`" :disabled="busy" @change="managementMode = true" />
          <div v-if="editingCanvas?.key === item.key" class="canvasEntry canvasNameEditor">
            <input ref="renameInputs" v-model="renameValue" class="canvasNameInput" aria-label="画布名称" :aria-invalid="!!renameError" aria-describedby="canvasRenameFeedback" :readonly="busy" maxlength="120" @input="renameError = ''" @keydown="handleRenameKeydown" @blur="saveRename" />
            <p>{{ item.nodes }} 个节点 · {{ item.edges }} 条连线</p>
            <p id="canvasRenameFeedback" class="renameFeedback" :class="{ renameInvalid: renameError }" :role="renameError ? 'alert' : 'status'">{{ renameError || (busy ? '正在保存…' : '回车保存 · Esc 取消') }}</p>
          </div>
          <button v-else class="canvasEntry" :aria-label="`打开画布 ${item.name}，所属项目 ${item.projectName}`" :disabled="busy" @click="openCanvas(item)"><h2 :title="item.name">{{ item.name }}</h2><p>{{ item.nodes }} 个节点 · {{ item.edges }} 条连线</p><span class="projectBadge" :title="item.directory">所属项目 {{ item.projectName }}</span></button>
          <div class="cardFooter"><time v-if="item.modifiedAt" :datetime="item.modifiedAt" :title="new Date(item.modifiedAt).toLocaleString()">更新于 {{ formatTime(item.modifiedAt) }}</time><span v-else>已保存</span><div class="cardActions">
            <template v-if="editingCanvas?.key === item.key">
              <button :disabled="busy" aria-label="保存画布名称" title="保存名称" @pointerdown.prevent @click="saveRename"><icon-check :size="17" /></button>
              <button :disabled="busy" aria-label="取消重命名" title="取消重命名" @pointerdown.prevent @click="finishRename(true)"><icon-x :size="17" /></button>
            </template>
            <template v-else>
              <button :disabled="busy" :aria-label="`预览画布 ${item.name}`" title="预览流程" @click="previewFlow(item)"><icon-eye :size="17" /></button>
              <button :disabled="busy" :aria-label="`复制画布 ${item.name}`" title="复制画布（包含本地素材）" @click="copyCanvas(item)"><icon-copy :size="17" /></button>
              <button :disabled="busy" :aria-label="`导出画布 ${item.name}`" title="导出画布（包含本地素材）" @click="downloadCanvas(item)"><icon-download :size="17" /></button>
              <button ref="renameButtons" :data-canvas-key="item.key" :disabled="busy" :aria-label="`重命名画布 ${item.name}`" title="重命名" @click="renameCanvas(item)"><icon-pencil :size="17" /></button>
              <button :disabled="busy" :aria-label="`删除画布 ${item.name}`" title="删除画布" @click="deleteCanvases([item])"><icon-trash :size="17" /></button>
            </template>
          </div></div>
        </article>
      </div>
      <p v-if="busy" class="operationStatus" role="status">正在处理，请稍候…</p>
    </section>
    <el-dialog v-model="previewVisible" width="min(1100px, 94vw)" appendToBody @closed="previewCanvas = null">
      <template #header><div class="previewHeading"><strong>{{ previewCanvas?.name }}</strong><span>{{ previewCanvas?.document.nodes.length ?? 0 }} 个节点 · {{ previewCanvas?.document.edges.length ?? 0 }} 条连线</span></div></template>
      <canvasPreview v-if="previewCanvas" :canvasDocument="previewCanvas.document" />
    </el-dialog>
    <input ref="importInput" class="importInput" type="file" accept=".json,application/json" aria-label="导入画布文件" @change="importFile" />
  </libraryShell>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import axios from 'axios';
import { ElMessage, ElMessageBox } from 'element-plus';
import { IconPlus, IconFileImport, IconFolderOpen, IconEye, IconCopy, IconDownload, IconPencil, IconTrash, IconLayoutGrid, IconList, IconSearch, IconCheck, IconX, IconAdjustments, IconRefresh } from '@tabler/icons-vue';
import libraryShell from '@/components/libraryShell.vue';
import canvasPreview from './canvasPreview.vue';
import { canvasProjects, canvasFolder, ensureCanvasDirectory } from '@/lib/canvasStorage';
import { useWorkspaceStore } from '@/stores/workspace';
import { settings } from '@/stores/settings';
import useWorkspaceFiles from '@/lib/workspaceFiles';
import { isCanvasFile } from '@/pages/workspace/canvasFile';
import createNumberedCanvas from '@/pages/workspace/createCanvas';
import { copyCanvasFile, exportCanvas, importCanvasAssets, validateCanvas, validCanvasName, type CanvasDocument } from './canvasTransfer';

type CanvasItem = { key: string; directory: string; projectName: string; path: string; name: string; nodes: number; edges: number; modifiedAt?: string };
const router = useRouter();
const workspace = useWorkspaceStore();
const directory = ref('');
const canvases = ref<CanvasItem[]>([]);
const selected = ref<string[]>([]);
const query = ref('');
const sortOrder = ref('modified');
const view = computed<'grid' | 'list'>({ get: () => settings.value.canvasLibraryView === 'grid' ? 'grid' : 'list', set: value => { settings.value.canvasLibraryView = value; } });
const editingCanvas = ref<CanvasItem | null>(null);
const renameValue = ref('');
const renameError = ref('');
const renameInputs = ref<HTMLInputElement[]>([]);
const renameButtons = ref<HTMLButtonElement[]>([]);
const managementMode = ref(false);
const activeProject = ref('all');
const projects = computed(canvasProjects);
const selectedProject = computed(() => projects.value.find(project => project.directory === activeProject.value));
const selectedItems = computed(() => canvases.value.filter(item => selected.value.includes(item.key)));
const projectCounts = computed(() => {
  const counts: Record<string, number> = {};
  for (const item of canvases.value) {
    counts[item.directory] = (counts[item.directory] ?? 0) + 1;
  }
  return counts;
});
const visibleCanvases = computed(() => canvases.value.filter(item => item.key === editingCanvas.value?.key
  || (activeProject.value === 'all' || item.directory === activeProject.value)
    && (item.name + ' ' + item.projectName).toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())).sort((a, b) => (sortOrder.value === 'modified' ? (Date.parse(b.modifiedAt ?? '') || 0) - (Date.parse(a.modifiedAt ?? '') || 0) : 0) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true })));
const allVisibleSelected = computed(() => visibleCanvases.value.length > 0 && visibleCanvases.value.every(item => selected.value.includes(item.key)));
function toggleSelection() {
  managementMode.value = true;
  const visibleKeys = new Set(visibleCanvases.value.map(item => item.key));
  selected.value = allVisibleSelected.value ? selected.value.filter(key => !visibleKeys.has(key)) : [...new Set([...selected.value, ...visibleKeys])];
}
const loading = ref(false);
const busy = ref(false);
const loadError = ref('');
const importInput = ref<HTMLInputElement>();
const previewVisible = ref(false);
const previewCanvas = ref<{ name: string; document: CanvasDocument } | null>(null);
let loadVersion = 0;
let loadController: AbortController | undefined;
onBeforeUnmount(() => { loadVersion++; loadController?.abort(); });

function errorText(error: unknown) { return axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : '操作失败，请重试'; }
function formatTime(value: string) { return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); }
async function loadCanvases() {
  const version = ++loadVersion;
  loadController?.abort();
  loadController = new AbortController();
  const signal = loadController.signal;
  selected.value = [];
  canvases.value = [];
  loadError.value = '';
  loading.value = true;
  try {
    await workspace.initialize();
    if (version !== loadVersion) return;
    const result: CanvasItem[] = [];
    const failures: string[] = [];
    for (const project of canvasProjects()) {
      if (version !== loadVersion) return;
      const path = project.directory;
      try {
        const files = useWorkspaceFiles(path);
        const entries = (await files.list(await canvasFolder(path), signal)).entries.filter(item => item.type === 'file' && /\.json$/i.test(item.name));
        for (const item of entries) {
          if (version !== loadVersion) return;
          try {
          if (!await isCanvasFile(files, item.path, signal)) continue;
          const { data, modifiedAt } = await files.readJsonInfo<CanvasDocument>(item.path, signal);
          validateCanvas(data);
          result.push({ key: JSON.stringify([path, item.path]), directory: path, projectName: project.name, path: item.path, name: item.name.slice(0, -5), nodes: data.nodes.length, edges: data.edges.length, modifiedAt });
          } catch (error) { if (signal.aborted) throw error; failures.push(`${path}/${item.name}：${errorText(error)}`); }
        }
      } catch (error) { if (signal.aborted) throw error; failures.push(`${path}：${errorText(error)}`); }
    }
    if (version === loadVersion && failures.length) loadError.value = `部分画布未能读取：${failures.join('；')}`;
    if (version === loadVersion) canvases.value = result.sort((a, b) => Date.parse(b.modifiedAt ?? '') - Date.parse(a.modifiedAt ?? '') || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  } catch (error) { if (version === loadVersion) loadError.value = errorText(error); }
  finally { if (version === loadVersion) loading.value = false; }
}
watch(() => projects.value.map(project => [project.directory, project.name]), () => {
  if (activeProject.value !== 'all' && !projects.value.some(project => project.directory === activeProject.value)) activeProject.value = 'all';
  managementMode.value = false;
  editingCanvas.value = null;
  void loadCanvases();
}, { immediate: true });

function toggleManagement() {
  managementMode.value = !managementMode.value;
  if (!managementMode.value) selected.value = [];
}
function selectProject(path: string) {
  if (busy.value || editingCanvas.value) return;
  activeProject.value = path;
  selected.value = [];
}
async function ensureDirectory() { directory.value = selectedProject.value?.directory ?? await ensureCanvasDirectory(); return directory.value; }
async function openProject() { await router.push({ path: '/projects', query: { next: '/canvas' } }); }
async function openCanvas(item: CanvasItem) {
  if (busy.value) return;
  const path = item.directory;
  busy.value = true;
  try { await workspace.openProject(path); await router.push({ path: '/workspace', query: { canvas: item.path } }); }
  catch (error) { ElMessage.error(errorText(error)); }
  finally { busy.value = false; }
}
async function requestName(title: string, name: string) {
  return ElMessageBox.prompt('请输入画布名称', title, { inputValue: name, confirmButtonText: '保存', cancelButtonText: '取消', inputValidator: value => validCanvasName(value ?? '') || '请输入有效名称，不能包含 /、\\ 等文件名特殊字符' }).then(result => result.value.trim(), () => null);
}
async function createCanvas() {
  if (busy.value) return;
  if (!selectedProject.value && !workspace.project) return openProject();
  busy.value = true;
  try {
    const path = await ensureDirectory();
    await workspace.openProject(path);
    const canvas = await createNumberedCanvas(path);
    await router.push({ path: '/workspace', query: { canvas: canvas.id } });
  } catch (error) { ElMessage.error(errorText(error)); await loadCanvases(); }
  finally { busy.value = false; }
}
async function renameCanvas(item: CanvasItem) {
  if (busy.value) return;
  if (editingCanvas.value && editingCanvas.value.key !== item.key) {
    await saveRename();
    if (editingCanvas.value) return;
  }
  editingCanvas.value = item;
  renameValue.value = item.name;
  renameError.value = '';
  await nextTick();
  renameInputs.value[0]?.focus();
  renameInputs.value[0]?.select();
}
async function finishRename(restoreFocus = false) {
  const key = editingCanvas.value?.key;
  editingCanvas.value = null;
  renameError.value = '';
  if (restoreFocus) {
    await nextTick();
    renameButtons.value.find(button => button.dataset.canvasKey === key)?.focus();
  }
}
function handleRenameKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229 || busy.value) return;
  if (event.key === 'Enter' || event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Enter') void saveRename();
    else void finishRename(true);
  }
}
async function saveRename() {
  const item = editingCanvas.value;
  if (busy.value || !item) return;
  const restoreFocus = renameInputs.value.some(input => input === document.activeElement);
  const name = renameValue.value.trim();
  if (name === item.name) return finishRename(restoreFocus);
  if (!validCanvasName(name)) {
    renameError.value = '请输入有效名称，不能包含 /、\\ 等文件名特殊字符';
    return;
  }
  busy.value = true;
  renameError.value = '';
  try {
    const target = item.path.replace(/[^/]+$/, `${name}.json`);
    await useWorkspaceFiles(item.directory).rename(item.path, target);
    const previousKey = item.key;
    item.name = name;
    item.path = target;
    item.key = JSON.stringify([item.directory, item.path]);
    selected.value = selected.value.map(key => key === previousKey ? item.key : key);
    // 清除编辑状态前更新卡片，避免重新加载整页打断焦点和选择。
    busy.value = false;
    await finishRename(restoreFocus);
    ElMessage.success('画布已重命名');
  } catch (error) { renameError.value = errorText(error); }
  finally { busy.value = false; }
}
async function deleteCanvases(items: CanvasItem[]) {
  if (busy.value || !items.length) return;
  busy.value = true;
  try {
    const confirmed = await ElMessageBox.confirm(`将删除${items.length === 1 ? `“${items[0]!.name}”` : `这 ${items.length} 张画布`}的画布文件。素材文件会保留。此操作不可撤销。`, '删除画布', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', closeOnClickModal: false }).then(() => true, () => false);
    if (!confirmed) return;
    for (const item of items) {
      const files = useWorkspaceFiles(item.directory);
      if (!await isCanvasFile(files, item.path)) throw new Error(`${item.name} 已变更，请刷新后重试`);
      await files.remove(item.path);
    }
    ElMessage.success('画布已删除');
  } catch (error) { ElMessage.error(errorText(error)); }
  finally { await loadCanvases(); busy.value = false; }
}
async function downloadCanvas(item: CanvasItem) {
  if (busy.value) return;
  busy.value = true;
  try { await exportCanvas(item.directory, item.path); }
  catch (error) { ElMessage.error(errorText(error)); }
  finally { busy.value = false; }
}
async function previewFlow(item: CanvasItem) {
  if (busy.value) return;
  busy.value = true;
  try {
    const document = await useWorkspaceFiles(item.directory).readJson<CanvasDocument>(item.path);
    validateCanvas(document);
    previewCanvas.value = { name: item.name, document };
    previewVisible.value = true;
  } catch (error) { ElMessage.error(errorText(error)); }
  finally { busy.value = false; }
}
async function copyCanvas(item: CanvasItem) {
  if (busy.value) return;
  busy.value = true;
  try {
    const name = await requestName("复制画布", `${item.name} 副本`);
    if (!name) return;
    const files = useWorkspaceFiles(item.directory);
    const folder = await canvasFolder(item.directory);
    const target = `${folder ? `${folder}/` : ""}${name}.json`;
    if ((await files.list(folder)).entries.some(entry => entry.type === "file" && entry.name.toLocaleLowerCase() === `${name}.json`.toLocaleLowerCase())) {
      throw new Error("已存在同名画布，请更换名称后重试");
    }
    await copyCanvasFile(item.directory, item.path, target);
    await loadCanvases();
    ElMessage.success("画布已复制，素材已独立保存");
  } catch (error) { ElMessage.error(errorText(error)); }
  finally { busy.value = false; }
}
async function beginImport() {
  if (busy.value) return;
  if (!selectedProject.value && !workspace.project) return openProject();
  busy.value = true;
  try { await ensureDirectory(); importInput.value?.click(); }
  catch (error) { ElMessage.error(errorText(error)); }
  finally { busy.value = false; }
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || busy.value) return;
  const path = directory.value;
  busy.value = true;
  try {
    const data: unknown = JSON.parse(await file.text());
    validateCanvas(data);
    const name = await requestName('导入画布', file.name.replace(/\.json$/i, ''));
    if (!name) return;
    const files = useWorkspaceFiles(path);
    const folder = await canvasFolder(path);
    if ((await files.list(folder)).entries.some(item => item.name.toLowerCase() === `${name}.json`.toLowerCase())) throw new Error('已存在同名文件，请更换画布名称后重新导入');
    await importCanvasAssets(path, data, `${folder ? folder + '/' : ''}${name}.json`);
    await loadCanvases();
    ElMessage.success('画布已导入');
  } catch (error) { ElMessage.error(errorText(error)); }
  finally { busy.value = false; }
}
</script>

<style scoped lang="scss">
.canvasLibrary {
  width: 100%; margin: 0 auto;
  button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 8px 14px; border: 1px solid var(--homeLine); border-radius: calc(var(--ui-radius, 8px) * 0.75); background: transparent; color: var(--homeText); font-size: 13px; cursor: pointer; &:hover:not(:disabled) { background: var(--homeRaised); } &:disabled { cursor: default; opacity: .45; } &:focus-visible { outline: 2px solid var(--homeAccent); outline-offset: 2px; } }
  .projectContext { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 24px; padding-bottom: 18px; margin-bottom: 24px; border-bottom: 1px solid var(--homeLine);
    .projectIdentity { display: inline-flex; align-items: center; gap: 9px; min-width: 0; max-width: 100%; color: var(--homeText); text-decoration: none; span { flex-shrink: 0; color: var(--homeMuted); font-size: 12px; } strong { overflow-wrap: anywhere; font-size: 15px; font-weight: 600; } &:focus-visible { outline: 2px solid var(--homeAccent); outline-offset: 4px; } }
    .projectPath { min-width: 0; flex: 1 1 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--homeMuted); font-size: 12px; }
  }
  .projectToolbar { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 12px; margin-bottom: 20px;
    .projectTabs { display: flex; flex: 1 1 240px; flex-wrap: wrap; gap: 8px; button { min-height: 36px; max-width: 100%; overflow-wrap: anywhere; text-align: left; &[aria-pressed=true] { border-color: var(--homeText); background: var(--homeRaised); font-weight: 600; } span { color: var(--homeMuted); font-size: 12px; font-variant-numeric: tabular-nums; } } }
  }
  .managementToolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 12px 14px; margin-bottom: 16px; border: 1px solid var(--homeLine); border-radius: 5px; background: var(--homeSurface); > span { flex: 1 1 160px; font-size: 13px; color: var(--homeText); } .deleteAction { color: var(--el-color-danger); } }
  .primaryAction { background: var(--homeText); color: var(--homeBg); border-color: transparent; &:hover:not(:disabled) { background: var(--homeAccent); } }
  .canvasLibraryHeader { display: flex; justify-content: space-between; align-items: center; gap: 24px; margin-bottom: 28px; .headingCopy { display: flex; align-items: baseline; flex-wrap: wrap; gap: 16px; } h1 { margin: 0; font-size: 28px; font-weight: 600; letter-spacing: -.025em; } span { font-size: 12px; color: var(--homeMuted); font-variant-numeric: tabular-nums; } }
  .libraryActions { display: flex; gap: 8px; flex-wrap: wrap; }
  .viewSwitch { display: inline-flex; flex-shrink: 0; border: 1px solid var(--homeLine); border-radius: 4px; overflow: hidden;
    button { width: 36px; min-height: 34px; padding: 0; border: 0; border-radius: 0; color: var(--homeMuted); &:first-child { border-right: 1px solid var(--homeLine); } &[aria-pressed=true] { background: var(--homeText); color: var(--homeBg); } &:focus-visible { outline-offset: -3px; } }
  }
  .libraryToolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; :deep(.el-input) { flex: 1 1 200px; width: auto; } select { min-height: 36px; padding: 6px 12px; border: 1px solid var(--homeLine); border-radius: 4px; background: transparent; color: var(--homeText); } }
  .canvasColumns, .canvasCard { display: grid; grid-template-columns: 24px minmax(0, 1fr) 152px 176px; align-items: center; gap: 16px; }
  .canvasColumns { padding: 12px 8px; border-bottom: 1px solid var(--homeLine); color: var(--homeMuted); font-size: 12px; input { width: 15px; height: 15px; margin: 0; accent-color: var(--homeAccent); } .actionsLabel { text-align: center; } &.gridColumns { grid-template-columns: 24px minmax(0, 1fr); } }
  .canvasGrid { display: grid; }
  .canvasCard { position: relative; min-width: 0; min-height: 84px; padding: 16px 8px; border-bottom: 1px solid var(--homeLine); &:hover, &:focus-within, &.selected { background: var(--homeSurface); } }
  .cardCheckbox { width: 15px; height: 15px; accent-color: var(--homeAccent); cursor: pointer; margin: 0; }
  .canvasEntry { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 0; width: 100%; min-width: 0; padding: 0; border: 0; text-align: left; border-radius: 0; &:hover:not(:disabled) { background: transparent; } h2 { max-width: 100%; margin: 0 0 6px; font-size: 15px; line-height: 24px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } p { margin: 0; color: var(--homeMuted); font-size: 12px; } }
  .canvasEntry { .projectBadge { max-width: 100%; box-sizing: border-box; padding: 3px 7px; margin-top: 9px; border: 1px solid var(--homeLine); border-radius: 4px; color: var(--homeMuted); font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; } }
  .canvasNameEditor {
    .canvasNameInput { box-sizing: border-box; width: 100%; min-width: 0; height: 24px; margin: 0 0 12px; padding: 0; border: 0; border-radius: calc(var(--ui-radius, 8px) * 0.25); background: transparent; color: var(--homeText); font: inherit; font-size: 17px; font-weight: 600; line-height: 24px; caret-color: var(--homeAccent); outline: 2px solid var(--homeAccent); outline-offset: 4px; &[aria-invalid="true"] { outline-color: var(--el-color-danger); } &[readonly] { opacity: .65; } }
    .renameFeedback { margin-top: 8px; font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; &.renameInvalid { color: var(--el-color-danger); } }
  }
  .cardFooter { display: contents; color: var(--homeMuted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .cardActions { display: flex; gap: 2px; flex-shrink: 0; button { width: 32px; height: 32px; border: 0; padding: 0; color: var(--homeMuted); } }
  .canvasGrid.cardView { grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr)); gap: 16px; margin-top: 16px;
    .canvasCard { grid-template-columns: 20px minmax(0, 1fr); align-content: space-between; align-items: start; gap: 16px 12px; min-height: 180px; padding: 16px; border: 1px solid var(--homeLine); border-radius: 6px; }
    .cardCheckbox { margin-top: 4px; }
    .canvasEntry { min-height: 52px; }
    .cardFooter { display: flex; grid-column: 1 / -1; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
  }
  .libraryStatus, .emptyLibrary { text-align: center; padding: 72px 16px; color: var(--homeMuted); h2 { font-size: 18px; font-weight: 600; color: var(--homeText); margin: 20px 0 10px; } p { font-size: 14px; margin-bottom: 24px; } }
  .operationStatus { font-size: 12px; color: var(--homeMuted); margin-top: 18px; }
  @media(max-width: 1000px) { .canvasColumns, .canvasCard { grid-template-columns: 20px minmax(0, 1fr) 112px 176px; gap: 8px; } }
  @media(max-width: 720px) { .canvasLibraryHeader { align-items: flex-start; flex-direction: column; gap: 16px; margin-bottom: 20px; } .canvasColumns { grid-template-columns: 20px minmax(0, 1fr); .actionsLabel { display: none; } >span:nth-of-type(2) { display: none; } } .canvasCard { grid-template-columns: 20px minmax(0, 1fr); .cardFooter { display: flex; grid-column: 2; flex-wrap: wrap; align-items: center; gap: 8px; } } .libraryActions { gap: 6px; button { padding-inline: 10px; } .viewSwitch button { min-width: 44px; min-height: 44px; padding: 0; } } }
}
.previewHeading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 10px; strong { font-size: 16px; } span { color: var(--el-text-color-secondary); font-size: 12px; } }
.importInput { display: none; }
</style>
