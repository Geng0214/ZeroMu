<template>
  <libraryShell>
    <section class="canvasLibrary" aria-labelledby="canvasLibraryTitle">
      <header class="canvasLibraryHeader">
        <div class="headingCopy"><h1 id="canvasLibraryTitle">无限画布</h1><span v-if="!loading">{{ canvases.length }} 张画布</span></div>
        <div class="libraryActions"><button :disabled="busy || loading" @click="openProject"><icon-folder-open :size="16" />打开项目</button><button :disabled="busy || loading" @click="beginImport"><icon-file-import :size="16" />导入画布</button><button class="primaryAction" :disabled="busy || loading" @click="createCanvas"><icon-plus :size="17" />新建画布</button></div>
      </header>
      <div v-if="canvases.length" class="libraryToolbar">
        <el-input v-model="query" aria-label="搜索画布" placeholder="搜索画布名称" :prefixIcon="IconSearch" clearable />
        <div class="selectionActions"><button :disabled="busy || !visibleCanvases.length" @click="toggleSelection">{{ allVisibleSelected ? '取消当前选择' : '选择当前结果' }}</button><button v-if="selected.length" :disabled="busy" @click="deleteCanvases(canvases.filter(item => selected.includes(item.key)))"><icon-trash :size="16" />删除所选 ({{ selected.length }})</button></div>
      </div>
      <p v-if="loading" class="libraryStatus" role="status">正在读取画布…</p>
      <div v-if="loadError" class="libraryStatus" role="alert"><p>{{ loadError }}</p><button @click="loadCanvases">重新读取</button></div>
      <div v-if="!loading && !loadError && !canvases.length" class="emptyLibrary"><icon-layout-grid :size="32" :strokeWidth="1.5" /><h2>从一张空白画布开始</h2><p>新建画布，或打开已有项目继续创作。</p><button class="primaryAction" :disabled="busy" @click="createCanvas"><icon-plus :size="16" />新建画布</button></div>
      <p v-if="!loading && canvases.length && !visibleCanvases.length" class="libraryStatus" role="status">没有找到“{{ query }}”，试试其他画布名称。</p>
      <div v-if="visibleCanvases.length" class="canvasGrid">
        <article v-for="item in visibleCanvases" :key="item.key" class="canvasCard" :class="{ selected: selected.includes(item.key) }">
          <input v-model="selected" class="cardCheckbox" type="checkbox" :value="item.key" :aria-label="`选择画布 ${item.name}`" :disabled="busy" />
          <div v-if="editingCanvas?.key === item.key" class="canvasEntry canvasNameEditor">
            <input ref="renameInputs" v-model="renameValue" class="canvasNameInput" aria-label="画布名称" :aria-invalid="!!renameError" aria-describedby="canvasRenameFeedback" :readonly="busy" maxlength="120" @input="renameError = ''" @keydown="handleRenameKeydown" @blur="saveRename" />
            <p>{{ item.nodes }} 个节点 · {{ item.edges }} 条连线</p>
            <p id="canvasRenameFeedback" class="renameFeedback" :class="{ renameInvalid: renameError }" :role="renameError ? 'alert' : 'status'">{{ renameError || (busy ? '正在保存…' : '回车保存 · Esc 取消') }}</p>
          </div>
          <button v-else class="canvasEntry" :aria-label="`打开画布 ${item.name}`" :disabled="busy" @click="openCanvas(item)"><h2 :title="item.name">{{ item.name }}</h2><p>{{ item.nodes }} 个节点 · {{ item.edges }} 条连线</p></button>
          <div class="cardFooter"><time v-if="item.modifiedAt" :datetime="item.modifiedAt" :title="new Date(item.modifiedAt).toLocaleString()">更新于 {{ formatTime(item.modifiedAt) }}</time><span v-else>已保存</span><div class="cardActions">
            <template v-if="editingCanvas?.key === item.key">
              <button :disabled="busy" aria-label="保存画布名称" title="保存名称" @pointerdown.prevent @click="saveRename"><icon-check :size="17" /></button>
              <button :disabled="busy" aria-label="取消重命名" title="取消重命名" @pointerdown.prevent @click="finishRename(true)"><icon-x :size="17" /></button>
            </template>
            <template v-else>
              <button :disabled="busy" :aria-label="`导出画布 ${item.name}`" title="导出画布（包含本地素材）" @click="downloadCanvas(item)"><icon-download :size="17" /></button>
              <button ref="renameButtons" :data-canvas-key="item.key" :disabled="busy" :aria-label="`重命名画布 ${item.name}`" title="重命名" @click="renameCanvas(item)"><icon-pencil :size="17" /></button>
              <button :disabled="busy" :aria-label="`删除画布 ${item.name}`" title="删除画布" @click="deleteCanvases([item])"><icon-trash :size="17" /></button>
            </template>
          </div></div>
        </article>
      </div>
      <p v-if="busy" class="operationStatus" role="status">正在处理，请稍候…</p>
    </section>
    <input ref="importInput" class="importInput" type="file" accept=".json,application/json" aria-label="导入画布文件" @change="importFile" />
    <workspacePicker ref="projectPicker" hideTrigger />
  </libraryShell>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import axios from 'axios';
import { ElMessage, ElMessageBox } from 'element-plus';
import { IconPlus, IconFileImport, IconFolderOpen, IconDownload, IconPencil, IconTrash, IconLayoutGrid, IconSearch, IconCheck, IconX } from '@tabler/icons-vue';
import libraryShell from '@/components/libraryShell.vue';
import { canvasDirectories, ensureCanvasDirectory } from '@/lib/canvasStorage';
import { useWorkspaceStore } from '@/stores/workspace';
import useWorkspaceFiles from '@/lib/workspaceFiles';
import { isCanvasFile } from '@/pages/workspace/canvasFile';
import createNumberedCanvas from '@/pages/workspace/createCanvas';
import workspacePicker from '@/pages/home/workspacePicker.vue';
import { exportCanvas, importCanvasAssets, validateCanvas, validCanvasName, type CanvasDocument } from './canvasTransfer';

type CanvasItem = { key: string; directory: string; path: string; name: string; nodes: number; edges: number; modifiedAt?: string };
const router = useRouter();
const workspace = useWorkspaceStore();
const directory = ref('');
const canvases = ref<CanvasItem[]>([]);
const selected = ref<string[]>([]);
const query = ref('');
const editingCanvas = ref<CanvasItem | null>(null);
const renameValue = ref('');
const renameError = ref('');
const renameInputs = ref<HTMLInputElement[]>([]);
const renameButtons = ref<HTMLButtonElement[]>([]);
const visibleCanvases = computed(() => canvases.value.filter(item => item.key === editingCanvas.value?.key || item.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())));
const allVisibleSelected = computed(() => visibleCanvases.value.length > 0 && visibleCanvases.value.every(item => selected.value.includes(item.key)));
function toggleSelection() {
  const visibleKeys = new Set(visibleCanvases.value.map(item => item.key));
  selected.value = allVisibleSelected.value ? selected.value.filter(key => !visibleKeys.has(key)) : [...new Set([...selected.value, ...visibleKeys])];
}
const loading = ref(false);
const busy = ref(false);
const loadError = ref('');
const importInput = ref<HTMLInputElement>();
const projectPicker = ref<InstanceType<typeof workspacePicker>>();
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
    const result: CanvasItem[] = [];
    const failures: string[] = [];
    for (const path of canvasDirectories()) {
      if (version !== loadVersion) return;
      try {
        const files = useWorkspaceFiles(path);
        const entries = (await files.list('', signal)).entries.filter(item => item.type === 'file' && /\.json$/i.test(item.name));
        for (const item of entries) {
          if (version !== loadVersion) return;
          try {
          if (!await isCanvasFile(files, item.path, signal)) continue;
          const { data, modifiedAt } = await files.readJsonInfo<CanvasDocument>(item.path, signal);
          validateCanvas(data);
          result.push({ key: JSON.stringify([path, item.path]), directory: path, path: item.path, name: item.name.slice(0, -5), nodes: data.nodes.length, edges: data.edges.length, modifiedAt });
          } catch (error) { if (signal.aborted) throw error; failures.push(`${path}/${item.name}：${errorText(error)}`); }
        }
      } catch (error) { if (signal.aborted) throw error; failures.push(`${path}：${errorText(error)}`); }
    }
    if (version === loadVersion && failures.length) loadError.value = `部分画布未能读取：${failures.join('；')}`;
    if (version === loadVersion) canvases.value = result.sort((a, b) => Date.parse(b.modifiedAt ?? '') - Date.parse(a.modifiedAt ?? '') || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  } catch (error) { if (version === loadVersion) loadError.value = errorText(error); }
  finally { if (version === loadVersion) loading.value = false; }
}
onMounted(loadCanvases);
async function ensureDirectory() { directory.value = await ensureCanvasDirectory(); return directory.value; }
async function openProject() {
  if (busy.value || loading.value) return;
  busy.value = true;
  try {
    const path = await projectPicker.value?.chooseDirectory();
    if (!path) return;
    await workspace.openProject(path);
    await router.push({ path: '/workspace', query: {} });
  } catch (error) { ElMessage.error(errorText(error)); }
  finally { busy.value = false; }
}
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
  busy.value = true;
  try {
    const path = await ensureDirectory();
    await workspace.openProject(path);
    const canvas = await createNumberedCanvas(workspace.project!.directory);
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
    await useWorkspaceFiles(item.directory).rename(item.path, `${name}.json`);
    const previousKey = item.key;
    item.name = name;
    item.path = `${name}.json`;
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
async function beginImport() {
  if (busy.value) return;
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
    if ((await files.list()).entries.some(item => item.name.toLowerCase() === `${name}.json`.toLowerCase())) throw new Error('已存在同名文件，请更换画布名称后重新导入');
    await importCanvasAssets(path, data, `${name}.json`);
    await loadCanvases();
    ElMessage.success('画布已导入');
  } catch (error) { ElMessage.error(errorText(error)); }
  finally { busy.value = false; }
}
</script>

<style scoped lang="scss">
.canvasLibrary {
  width: 100%; max-width: 1104px; margin: 12px auto 0;
  button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 8px 14px; border: 1px solid var(--homeLine); border-radius: calc(var(--ui-radius, 8px) * 0.75); background: transparent; color: var(--homeText); font-size: 13px; &:hover:not(:disabled) { background: var(--homeRaised); } }
  .primaryAction { background: var(--homeText); color: var(--homeBg); border-color: transparent; &:hover:not(:disabled) { background: var(--homeAccent); } }
  .canvasLibraryHeader { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 8px 0 24px; border-bottom: 1px solid var(--homeLine); margin-bottom: 24px; .headingCopy { display: flex; align-items: baseline; flex-wrap: wrap; gap: 12px; } h1 { margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -.025em; } span { font-size: 12px; color: var(--homeMuted); font-variant-numeric: tabular-nums; } }
  .libraryActions { display: flex; gap: 8px; flex-wrap: wrap; }
  .libraryToolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; :deep(.el-input) { width: min(100%, 300px); } .selectionActions { display: flex; gap: 8px; flex-wrap: wrap; button { font-size: 12px; } } }
  .canvasGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
  .canvasCard { position: relative; min-width: 0; min-height: 160px; border-radius: var(--ui-radius-large, 12px); background: var(--homeSurface); padding: 20px; display: flex; flex-direction: column; border: 1px solid var(--homeLine); &:hover, &:focus-within, &.selected { border-color: var(--homeAccent); } }
  .cardCheckbox { position: absolute; left: 19px; top: 23px; width: 15px; height: 15px; accent-color: var(--homeAccent); cursor: pointer; margin: 0; }
  .canvasEntry { flex: 1; display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-start; gap: 0; width: 100%; min-width: 0; padding: 0 0 20px 27px; border: 0; text-align: left; border-radius: 0; &:hover:not(:disabled) { background: transparent; } h2 { max-width: 100%; margin: 0 0 12px; font-size: 17px; line-height: 24px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } p { margin: 0; color: var(--homeMuted); font-size: 12px; } }
  .canvasNameEditor {
    .canvasNameInput { box-sizing: border-box; width: 100%; min-width: 0; height: 24px; margin: 0 0 12px; padding: 0; border: 0; border-radius: calc(var(--ui-radius, 8px) * 0.25); background: transparent; color: var(--homeText); font: inherit; font-size: 17px; font-weight: 600; line-height: 24px; caret-color: var(--homeAccent); outline: 2px solid var(--homeAccent); outline-offset: 4px; &[aria-invalid="true"] { outline-color: var(--el-color-danger); } &[readonly] { opacity: .65; } }
    .renameFeedback { margin-top: 8px; font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; &.renameInvalid { color: var(--el-color-danger); } }
  }
  .cardFooter { display: flex; align-items: center; justify-content: space-between; gap: 6px; color: var(--homeMuted); font-size: 11px; font-variant-numeric: tabular-nums; }
  .cardActions { display: flex; gap: 2px; flex-shrink: 0; button { width: 32px; height: 32px; border: 0; padding: 0; color: var(--homeMuted); } }
  .libraryStatus, .emptyLibrary { text-align: center; padding: 60px 16px; color: var(--homeMuted); h2 { font-size: 20px; color: var(--homeText); margin: 20px 0 10px; } p { font-size: 13px; margin-bottom: 24px; } }
  .operationStatus { font-size: 12px; color: var(--homeMuted); margin-top: 18px; }
  @media(max-width: 1000px) { .canvasGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media(max-width: 650px) { margin-top: 0; .canvasLibraryHeader { align-items: flex-start; flex-direction: column; gap: 20px; margin-bottom: 20px; } .canvasGrid { grid-template-columns: 1fr; } .libraryActions { gap: 6px; button { padding-inline: 10px; } } }
}
.importInput { display: none; }
</style>
