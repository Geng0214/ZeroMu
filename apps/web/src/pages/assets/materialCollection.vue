<template>
  <section class="materials" aria-label="素材管理">
    <header class="materialHeading">
      <div class="headingCopy"><h1>仓库</h1><span v-if="!loading">{{ files.length }} 项素材</span></div>
      <div class="materialActions">
        <button :disabled="saving || !filtered.length" title="导出当前筛选结果，包含素材文件" @click="exportAssets">导出素材</button>
        <button type="button" :class="{ active: managing }" :aria-pressed="managing" :disabled="saving" @click="toggleManagement"><icon-adjustments-horizontal :size="16" />{{ managing ? '完成管理' : '资产管理' }}</button>
        <button type="button" class="addMaterial" :disabled="saving" title="上传文件，支持批量选择和导入素材包" @click="importInput?.click()"><icon-plus :size="16" />添加素材</button>
      </div>
    </header>
    <div class="materialToolbar">
      <form class="materialSearch" role="search" @submit.prevent="page = 1"><icon-search :size="18" /><input v-model="query" :disabled="saving" aria-label="搜索素材" placeholder="搜索素材、内容、分类、标签或来源" /><button type="submit" :disabled="saving" aria-label="搜索"><icon-search :size="18" /></button></form>
      <div class="materialView" role="group" aria-label="素材视图"><button :aria-pressed="view === 'grid'" aria-label="网格视图" title="网格视图" @click="view = 'grid'"><icon-layout-grid :size="17" /></button><button :aria-pressed="view === 'list'" aria-label="列表视图" title="列表视图" @click="view = 'list'"><icon-list :size="17" /></button></div>
    </div>
    <div class="filterToolbar">
      <div class="filterRows">
        <div class="filterRow"><nav aria-label="素材类型"><button v-for="item in kinds" :key="item.id" :disabled="saving" :class="{ active: kind === item.id }" :aria-pressed="kind === item.id" @click="kind = item.id">{{ item.label }}</button></nav></div>
        <div v-if="categories.length" class="filterRow"><span>分类</span><nav aria-label="素材分类"><button :disabled="saving" :class="{ active: !category }" :aria-pressed="!category" @click="category = ''">全部</button><button v-for="value in categories" :key="value" :disabled="saving" :class="{ active: category === value }" :aria-pressed="category === value" @click="category = value">{{ value }}</button></nav></div>
        <div v-if="tags.length" class="filterRow"><span>标签</span><nav aria-label="素材标签"><button :disabled="saving" :class="{ active: !tag }" :aria-pressed="!tag" @click="tag = ''">全部</button><button v-for="value in tags" :key="value" :disabled="saving" :class="{ active: tag === value }" :aria-pressed="tag === value" @click="tag = value">{{ value }}</button></nav></div>
      </div>
    </div>
    <div v-if="managing" class="managementPanel" aria-label="资产管理">
      <div class="selectionToolbar">
        <el-checkbox :modelValue="allSelected" :indeterminate="selectedPaths.length > 0 && !allSelected" :disabled="saving || loading || !filtered.length" @change="toggleAll">全选当前结果</el-checkbox>
        <span class="selectionCount" role="status">已选 {{ selectedPaths.length }} 项</span>
        <div class="selectionActions">
          <button :disabled="saving || !selectedPaths.length" :aria-expanded="organizing === 'category'" @click="openOrganizer('category')"><icon-folder :size="16" />设置分类</button>
          <button :disabled="saving || !selectedPaths.length" :aria-expanded="organizing === 'tags'" @click="openOrganizer('tags')"><icon-tag :size="16" />管理标签</button>
        </div>
      </div>
      <form v-if="organizing" class="organizeForm" :aria-label="organizing === 'category' ? '批量设置分类' : '批量管理标签'" @submit.prevent="saveOrganization">
        <div class="organizeFields">
          <template v-if="organizing === 'category'">
            <label for="assetCategory">分类</label>
            <el-autocomplete id="assetCategory" v-model="organizeCategory" :fetchSuggestions="suggestCategories" clearable :maxlength="100" :disabled="saving" :teleported="false" placeholder="选择或输入分类" aria-label="批量分类" />
            <p>留空可清除所选素材的分类。</p>
          </template>
          <template v-else>
            <label for="assetTags">标签</label>
            <el-radio-group v-model="tagMode" :disabled="saving" aria-label="标签操作"><el-radio-button value="add">添加标签</el-radio-button><el-radio-button value="remove">移除标签</el-radio-button></el-radio-group>
            <el-select id="assetTags" v-model="organizeTags" multiple filterable allowCreate defaultFirstOption :disabled="saving" :teleported="false" placeholder="选择或输入标签，按回车确认" aria-label="批量标签">
              <el-option v-for="value in tags" :key="value" :label="value" :value="value" />
            </el-select>
            <p>仅{{ tagMode === 'add' ? '添加' : '移除' }}选定标签，其他标签保留。</p>
          </template>
        </div>
        <div class="organizeActions"><el-button :disabled="saving" @click="organizing = ''">取消</el-button><el-button type="primary" nativeType="submit" :loading="saving" :disabled="!selectedPaths.length || organizing === 'tags' && !organizeTags.length">{{ organizing === 'category' && !organizeCategory.trim() ? `清除 ${selectedPaths.length} 项分类` : `应用到 ${selectedPaths.length} 项` }}</el-button></div>
        <p v-if="organizeError" class="organizeError" role="alert">{{ organizeError }}</p>
      </form>
    </div>
    <p v-if="loading" class="materialState" role="status">正在读取素材…</p>
    <div v-else-if="loadError" class="materialState" role="alert"><p>{{ loadError }}</p><button @click="loadAssets">重新加载</button></div>
    <div v-else-if="!filtered.length" class="materialState" :class="{ uploadState: !files.length, dragging }" @dragover.prevent @dragenter.prevent="dragging = !files.length && !saving" @dragleave.self="dragging = false" @drop.prevent="dropAssets"><icon-photo v-if="files.length" :size="30" :strokeWidth="1.5" /><icon-upload v-else :size="30" :strokeWidth="1.5" /><h2>{{ files.length ? '没有找到匹配的素材' : '拖入文件，或添加素材' }}</h2><p>{{ files.length ? '试试其他关键词，或清除筛选。' : '收集文字、图片、视频与音频，留给下一次创作。' }}</p><button v-if="files.length" @click="query = ''; kind = 'all'; category = ''; tag = ''">清除筛选</button><button v-else :disabled="saving" @click="importInput?.click()"><icon-plus :size="16" />添加素材</button></div>
    <div v-else class="materialGrid" :class="{ listView: view === 'list' }">
      <article v-for="entry in paged" :key="entry.path" class="materialCard" :class="{ selected: managing && selectedPaths.includes(entry.path) }">
        <label v-if="managing" class="materialSelection"><input type="checkbox" :checked="selectedPaths.includes(entry.path)" :disabled="saving" :aria-label="`选择 ${titleOf(entry)}`" @change="toggleSelection(entry.path)" /><span>选择素材</span></label>
        <button class="materialPreview" :aria-label="`查看 ${titleOf(entry)}`" @click="openPreview(entry)">
          <el-image v-if="mediaKind(entry) === 'image'" :src="assetUrl(entry.path)" fit="contain" loading="lazy" @load="readImageSize($event, entry.path)"><template #error><icon-photo :size="38" /></template></el-image>
          <video v-else-if="mediaKind(entry) === 'video'" :src="assetUrl(entry.path)" muted playsinline preload="metadata" @loadedmetadata="readVideoSize($event, entry.path)" />
          <pre v-else-if="mediaKind(entry) === 'text' && entry.content">{{ entry.content.slice(0, 600) }}</pre>
          <icon-music v-else-if="mediaKind(entry) === 'audio'" :size="42" :strokeWidth="1.5" /><icon-file-text v-else :size="42" :strokeWidth="1.5" />
        </button>
        <div class="materialInfo"><div class="materialTitle"><h2 :title="titleOf(entry)">{{ titleOf(entry) }}</h2><span>{{ kindLabel(entry) }}</span></div><p class="materialSource" :title="entry.metadata?.source || entry.path">{{ entry.metadata?.source || '本地素材' }}</p><p class="materialFacts">{{ dimensions[entry.path] ? dimensions[entry.path] + ' · ' : '' }}{{ formatSize(entry.size) }} · {{ extension(entry) }}</p><div v-if="categoryOf(entry) || entry.metadata?.tags?.length" class="materialTags"><span v-if="categoryOf(entry)">{{ categoryOf(entry) }}</span><span v-for="value in entry.metadata?.tags" :key="value">{{ value }}</span></div><div class="cardActions"><button :disabled="saving" @click="libraryPath = entry.path; libraryVisible = true">带入项目</button><button :disabled="saving" @click="openEditor(entry)"><icon-pencil :size="14" />编辑</button><button class="iconAction" :disabled="saving" :aria-label="'下载 ' + titleOf(entry)" title="下载素材" @click="download(entry)"><icon-download :size="16" /></button><el-dropdown trigger="click" placement="bottom-end"><button class="iconAction" :aria-label="'更多操作 ' + titleOf(entry)" title="更多操作"><icon-dots :size="16" /></button><template #dropdown><el-dropdown-menu><el-dropdown-item @click="openPreview(entry)">查看素材</el-dropdown-item><el-dropdown-item :disabled="saving" @click="removeAsset(entry)">删除素材</el-dropdown-item></el-dropdown-menu></template></el-dropdown></div></div>
      </article>
    </div>
    <div v-if="filtered.length" class="materialPagination"><el-pagination v-model:currentPage="page" v-model:pageSize="pageSize" :total="filtered.length" :pageSizes="[12, 24, 48]" layout="prev, pager, next, sizes" :pagerCount="5" /></div>
    <p v-if="saving" class="operationStatus" role="status">{{ progress || '正在保存…' }}</p>
    <input ref="importInput" class="hiddenInput" type="file" aria-label="上传素材文件" multiple @change="importAssets" />
    <el-dialog v-model="editorVisible" title="编辑素材" width="min(620px, 94vw)" appendToBody :closeOnClickModal="false" :closeOnPressEscape="!saving" :showClose="!saving">
      <el-form labelPosition="top" class="assetEditor" :disabled="saving" @submit.prevent="saveEditor">
        <el-form-item label="标题" required><el-input v-model="draft.title" aria-label="素材标题" :maxlength="200" placeholder="为素材起个容易找到的名字" /></el-form-item>
        <el-form-item v-if="editingText" label="文本内容" required><el-input v-model="draft.content" type="textarea" :rows="5" :maxlength="262144" aria-label="素材文本内容" /></el-form-item>
        <div class="editorColumns"><el-form-item label="分类"><el-input v-model="draft.category" aria-label="素材分类" :maxlength="100" placeholder="例如：角色、场景" /></el-form-item><el-form-item label="标签"><el-input v-model="draft.tags" aria-label="素材标签" :maxlength="1500" placeholder="用逗号分隔多个标签" /></el-form-item></div>
        <el-form-item label="来源"><el-input v-model="draft.source" aria-label="素材来源" :maxlength="1000" placeholder="例如：画布、拍摄、网址" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="draft.description" type="textarea" :rows="2" aria-label="素材描述" :maxlength="4000" placeholder="补充用途或内容，方便搜索" /></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="saving" @click="editorVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveEditor">保存素材</el-button></template>
    </el-dialog>
    <el-dialog :modelValue="!!preview" :title="preview ? titleOf(preview) : ''" width="min(900px, 94vw)" appendToBody destroyOnClose @update:modelValue="preview = undefined">
      <div v-if="preview" class="mediaDetail"><img v-if="mediaKind(preview) === 'image'" :src="assetUrl(preview.path)" :alt="titleOf(preview)" /><video v-else-if="mediaKind(preview) === 'video'" :src="assetUrl(preview.path)" controls playsinline /><audio v-else-if="mediaKind(preview) === 'audio'" :src="assetUrl(preview.path)" controls /><pre v-else-if="mediaKind(preview) === 'text'">{{ preview.content ?? '此文本较大，请下载查看。' }}</pre><p v-else>此文件可以下载后打开。</p><p v-if="preview.metadata?.description">{{ preview.metadata.description }}</p><el-button @click="download(preview)">下载素材</el-button></div>
    </el-dialog>
    <libraryImportDialog v-model="libraryVisible" :sourcePath="libraryPath" />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import axios from 'axios';
import { ElMessage, ElMessageBox } from 'element-plus';
import { IconSearch, IconPhoto, IconMusic, IconFileText, IconPencil, IconDownload, IconDots, IconPlus, IconAdjustmentsHorizontal, IconFolder, IconTag, IconUpload, IconLayoutGrid, IconList } from '@tabler/icons-vue';
import saveFile from '@/lib/saveFile';
import libraryImportDialog from '@/components/libraryImportDialog.vue';
const libraryVisible = ref(false); const libraryPath = ref('');

type Metadata = { title: string; category: string; tags: string[]; source: string; description: string };
type AssetEntry = { name: string; path: string; type: 'file' | 'directory'; children?: AssetEntry[]; size?: number; metadata?: Metadata; content?: string; modifiedAt?: string };
const entries = ref<AssetEntry[]>([]);
const query = ref(''); const kind = ref('all'); const category = ref(''); const tag = ref('');
const page = ref(1); const pageSize = ref(12);
const view = ref('grid'); const dragging = ref(false);
const loading = ref(false); const saving = ref(false); const loadError = ref(''); const progress = ref('');
const importInput = ref<HTMLInputElement>(); const preview = ref<AssetEntry>();
const editorVisible = ref(false); const editing = ref<AssetEntry>();
const editingText = computed(() => editing.value && mediaKind(editing.value) === 'text' && editing.value.content !== undefined);
const draft = reactive({ title: '', category: '', tags: '', source: '', description: '', content: '' });
const managing = ref(false); const selectedPaths = ref<string[]>([]);
const organizing = ref<'' | 'category' | 'tags'>('');
const organizeCategory = ref(''); const organizeTags = ref<string[]>([]);
const tagMode = ref<'add' | 'remove'>('add'); const organizeError = ref('');
const dimensions = reactive<Record<string, string>>({});
let controller: AbortController | undefined;
const kinds = [{ id: 'all', label: '全部' }, { id: 'text', label: '文本' }, { id: 'image', label: '图片' }, { id: 'video', label: '视频' }, { id: 'audio', label: '音频' }, { id: 'file', label: '其他' }];
function flatten(items: AssetEntry[]): AssetEntry[] { return items.flatMap(item => item.type === 'directory' ? flatten(item.children ?? []) : [item]); }
const files = computed(() => flatten(entries.value));
const titleOf = (entry: AssetEntry) => entry.metadata?.title || entry.name;
const categoryOf = (entry: AssetEntry) => entry.metadata?.category ?? entry.path.split('/').slice(0, -1).join('/');
const categories = computed(() => [...new Set(files.value.map(categoryOf).filter(Boolean))].sort());
const tags = computed(() => [...new Set(files.value.flatMap(entry => entry.metadata?.tags ?? []))].sort());
const filtered = computed(() => files.value.filter(entry => (kind.value === 'all' || mediaKind(entry) === kind.value) && (!category.value || categoryOf(entry) === category.value) && (!tag.value || entry.metadata?.tags.includes(tag.value)) && [titleOf(entry), entry.content, entry.metadata?.description, categoryOf(entry), ...(entry.metadata?.tags ?? []), entry.metadata?.source, entry.name].join(' ').toLowerCase().includes(query.value.trim().toLowerCase())));
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));
const allSelected = computed(() => filtered.value.length > 0 && selectedPaths.value.length === filtered.value.length);
watch([query, kind, category, tag], () => { selectedPaths.value = []; organizing.value = ''; });
watch(filtered, items => { const visible = new Set(items.map(item => item.path)); selectedPaths.value = selectedPaths.value.filter(path => visible.has(path)); });
watch([query, kind, category, tag, pageSize], () => { page.value = 1; });
watch(() => filtered.value.length, count => { page.value = Math.max(1, Math.min(page.value, Math.ceil(count / pageSize.value))); });
function assetUrl(path: string) { return `/api/assets/read?path=${encodeURIComponent(path)}`; }
function extension(entry: AssetEntry) { return entry.name.split('.').at(-1)?.toUpperCase() || '文件'; }
function mediaKind(entry: AssetEntry) {
  if (/\.(avif|apng|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(entry.name)) return 'image';
  if (/\.(mp4|m4v|webm|mov|mkv|avi|ogv)$/i.test(entry.name)) return 'video';
  if (/\.(mp3|wav|ogg|opus|flac|m4a|aac)$/i.test(entry.name)) return 'audio';
  if (/\.(txt|md|markdown|csv|json)$/i.test(entry.name)) return 'text';
  return 'file';
}
function kindLabel(entry: AssetEntry) { return kinds.find(item => item.id === mediaKind(entry))!.label; }
function formatSize(size?: number) { return size === undefined ? '大小未知' : size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB`; }
function readImageSize(event: Event, path: string) { const image = event.target as HTMLImageElement; if (image.naturalWidth) dimensions[path] = `${image.naturalWidth} × ${image.naturalHeight}`; }
function readVideoSize(event: Event, path: string) { const video = event.target as HTMLVideoElement; if (video.videoWidth) dimensions[path] = `${video.videoWidth} × ${video.videoHeight}`; }
function errorText(error: unknown) { return axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : '操作失败，请重试'; }
async function loadAssets() {
  controller?.abort(); const current = controller = new AbortController(); loading.value = true; loadError.value = '';
  try { const { data } = await axios.get<{ data: { entries: AssetEntry[] } }>('/api/assets/list', { signal: current.signal }); entries.value = data.data.entries; }
  catch (error) { if (!current.signal.aborted) loadError.value = errorText(error); }
  finally { if (!current.signal.aborted) loading.value = false; }
}
function openPreview(entry: AssetEntry) { preview.value = entry; }
function openEditor(entry: AssetEntry) {
  editing.value = entry;
  Object.assign(draft, { title: titleOf(entry), category: categoryOf(entry), tags: entry.metadata?.tags?.join(', ') ?? '', source: entry.metadata?.source ?? '', description: entry.metadata?.description ?? '', content: entry.content ?? '' });
  editorVisible.value = true;
}
function toggleManagement() {
  managing.value = !managing.value; selectedPaths.value = []; organizing.value = '';
}
function toggleSelection(path: string) {
  if (selectedPaths.value.includes(path)) selectedPaths.value = selectedPaths.value.filter(value => value !== path);
  else if (selectedPaths.value.length < 500) selectedPaths.value.push(path);
  else ElMessage.warning('单次最多管理 500 项，请分批选择');
}
function toggleAll() {
  if (allSelected.value) selectedPaths.value = [];
  else if (filtered.value.length <= 500) selectedPaths.value = filtered.value.map(entry => entry.path);
  else ElMessage.warning('单次最多管理 500 项，请先筛选素材或分批选择');
}
function openOrganizer(mode: 'category' | 'tags') {
  organizing.value = organizing.value === mode ? '' : mode;
  const currentCategories = [...new Set(files.value.filter(entry => selectedPaths.value.includes(entry.path)).map(categoryOf))];
  organizeCategory.value = currentCategories.length === 1 ? currentCategories[0]! : '';
  organizeTags.value = []; tagMode.value = 'add'; organizeError.value = '';
}
function suggestCategories(query: string, callback: (items: { value: string }[]) => void) {
  callback(categories.value.filter(value => value.toLowerCase().includes(query.trim().toLowerCase())).map(value => ({ value })));
}
async function saveOrganization() {
  if (saving.value || !selectedPaths.value.length || !organizing.value) return;
  organizeError.value = '';
  const paths = [...selectedPaths.value];
  const mode = organizing.value;
  try {
    const categoryValue = organizeCategory.value.trim();
    const tagValues = [...new Set(organizeTags.value.map(value => value.trim()).filter(Boolean))];
    if (mode === 'category' && categoryValue.length > 100) throw new Error('分类名称不能超过 100 字');
    if (mode === 'tags' && (!tagValues.length || tagValues.length > 30 || tagValues.some(value => value.length > 50))) throw new Error('请选择 1–30 个标签，每个标签不超过 50 字');
    saving.value = true;
    await axios.post('/api/assets/organize', { paths, ...(mode === 'category' ? { category: categoryValue } : { tags: tagValues, tagMode: tagMode.value }) });
    organizing.value = ''; ElMessage.success(`已更新 ${paths.length} 项素材的${mode === 'category' ? '分类' : '标签'}`);
    await loadAssets();
  } catch (error) { organizeError.value = errorText(error); }
  finally { saving.value = false; }
}
function normalizedTags(value: string) { const result = [...new Set(value.split(/[,，]/).map(value => value.trim()).filter(Boolean))]; if (result.length > 30 || result.some(value => value.length > 50)) throw new Error('最多添加 30 个标签，每个标签不超过 50 字'); return result; }
async function upload(blob: Blob, name: string, metadata: Metadata) {
  const ext = name.match(/\.[a-z0-9]{1,12}$/i)?.[0] ?? '';
  const path = `material${crypto.randomUUID().replaceAll('-', '')}${ext}`;
  await axios.put('/api/assets/save', blob, { params: { path }, headers: { 'Content-Type': 'application/octet-stream' } });
  try { await axios.post('/api/assets/metadata', { path, ...metadata }); }
  catch (error) { throw new Error(`文件已保存，但标题和标签保存失败：${errorText(error)}。请在列表中编辑补全。`); }
}
async function saveEditor() {
  if (saving.value || !editing.value) return;
  if (!draft.title.trim()) return ElMessage.warning('请输入素材标题');
  if (editingText.value && !draft.content.trim()) return ElMessage.warning('请输入文本内容');
  saving.value = true;
  try {
    const metadata = { title: draft.title.trim(), category: draft.category.trim(), tags: normalizedTags(draft.tags), source: draft.source.trim(), description: draft.description };
    await axios.post('/api/assets/metadata', { path: editing.value.path, ...metadata, ...(editingText.value ? { content: draft.content } : {}) });
    editorVisible.value = false; ElMessage.success('素材已保存');
  } catch (error) { ElMessage.error(errorText(error)); }
  finally { saving.value = false; await loadAssets(); }
}
async function download(entry: AssetEntry) {
  try {
    const suffix = entry.name.match(/\.[a-z0-9]{1,12}$/i)?.[0] ?? '';
    let name = titleOf(entry).replace(/[<>:"/\\|?*]/g, '_');
    if (suffix && !name.toLowerCase().endsWith(suffix.toLowerCase())) name += suffix;
    await saveFile(() => axios.get<Blob>(assetUrl(entry.path), { responseType: 'blob' }).then(result => result.data), name);
  } catch (error) { ElMessage.error(errorText(error)); }
}
async function removeAsset(entry: AssetEntry) {
  if (saving.value) return;
  const confirmed = await ElMessageBox.confirm(`确定删除“${titleOf(entry)}”？素材文件将被删除，此操作不可撤销。`, '删除素材', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }).then(() => true, () => false);
  if (!confirmed) return;
  saving.value = true;
  try { await axios.delete('/api/assets/remove', { data: { path: entry.path } }); await loadAssets(); }
  catch (error) { ElMessage.error(errorText(error)); }
  finally { saving.value = false; }
}
async function exportAssets() {
  if (saving.value) return;
  saving.value = true;
  const selected = [...filtered.value];
  try {
    const items = [];
    for (const [index, entry] of selected.entries()) {
      progress.value = `正在导出 ${index + 1} / ${selected.length}`;
      const { data } = await axios.get<ArrayBuffer>(assetUrl(entry.path), { responseType: 'arraybuffer' });
      const bytes = new Uint8Array(data); let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      items.push({ name: entry.name, metadata: { title: titleOf(entry), category: categoryOf(entry), tags: [], source: '', description: '', ...entry.metadata }, base64: btoa(binary) });
    }
    await saveFile(new Blob([JSON.stringify({ zeromuAssets: 1, items })], { type: 'application/json' }), '零幕素材库.json');
  } catch (error) { ElMessage.error(errorText(error)); }
  finally { saving.value = false; progress.value = ''; }
}
function validMetadata(value: unknown): value is Metadata {
  if (!value || typeof value !== 'object') return false;
  const data = value as Metadata;
  return typeof data.title === 'string' && !!data.title.trim() && data.title.length <= 200
    && typeof data.description === 'string' && data.description.length <= 4000
    && typeof data.category === 'string' && data.category.length <= 100
    && typeof data.source === 'string' && data.source.length <= 1000
    && Array.isArray(data.tags) && data.tags.length <= 30 && data.tags.every(tag => typeof tag === 'string' && tag.length > 0 && tag.length <= 50);
}
async function importAssets(event: Event) {
  const input = event.target as HTMLInputElement; const selected = Array.from(input.files ?? []); input.value = '';
  await importSelected(selected);
}
async function dropAssets(event: DragEvent) {
  dragging.value = false;
  if (files.value.length) return;
  await importSelected(Array.from(event.dataTransfer?.files ?? []));
}
async function importSelected(selected: File[]) {
  if (!selected.length || saving.value) return;
  saving.value = true; let imported = 0; const failures: string[] = [];
  for (const file of selected) {
    try {
      progress.value = `正在导入 ${file.name}`;
      let bundle: unknown;
      if (/\.json$/i.test(file.name)) { try { bundle = JSON.parse(await file.text()); } catch { failures.push(`${file.name}：JSON 解析失败，未按普通素材导入`); continue; } }
      if (bundle && typeof bundle === 'object' && 'zeromuAssets' in bundle) {
        const data = bundle as { zeromuAssets: number; items: { name: string; metadata: Metadata; base64: string }[] };
        if (data.zeromuAssets !== 1 || !Array.isArray(data.items) || data.items.some(item => !item || typeof item.name !== 'string' || typeof item.base64 !== 'string' || !validMetadata(item.metadata) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.base64))) throw new Error('素材包格式无效');
        for (const item of data.items) {
          const binary = atob(item.base64); const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
          await upload(new Blob([bytes]), item.name, item.metadata); imported++;
        }
      } else { await upload(file, file.name, { title: file.name, category: '', tags: [], source: '本地导入', description: '' }); imported++; }
    } catch (error) { failures.push(`${file.name}：${errorText(error)}`); }
  }
  saving.value = false; progress.value = ''; await loadAssets();
  if (imported) ElMessage.success(`已导入 ${imported} 个素材`);
  if (failures.length) ElMessage.error({ message: failures.join('；'), duration: 8000 });
}
onMounted(loadAssets); onBeforeUnmount(() => controller?.abort());
</script>

<style scoped lang="scss">
.materials { width: 100%; min-width: 0; margin: 0 auto; color: var(--homeText); }
.materials button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 36px; color: inherit; background: none; border: 1px solid var(--homeLine); border-radius: var(--ui-radius, 8px); padding: 8px 12px; font-size: 12px; &:hover:not(:disabled) { background: var(--homeRaised); } }
.materialHeading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-bottom: 28px; .headingCopy { display: flex; align-items: baseline; gap: 16px; h1 { margin: 0; font-size: 28px; font-weight: 600; letter-spacing: -.025em; } span { color: var(--homeMuted); font-size: 12px; font-variant-numeric: tabular-nums; } } }
.materialToolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.materialView { display: flex; flex-shrink: 0; border: 1px solid var(--homeLine); border-radius: 4px; overflow: hidden; button { width: 40px; border: 0; border-radius: 0; &[aria-pressed=true] { background: var(--homeText); color: var(--homeBg); } } }
.materialSearch { display: flex; align-items: center; flex: 1; min-width: 0; height: 38px; border: 1px solid var(--homeLine); background: transparent; border-radius: 4px; padding-left: 12px; color: var(--homeMuted); &:focus-within { border-color: var(--homeAccent); outline: 2px solid var(--homeAccent); outline-offset: 2px; } >svg { flex-shrink: 0; } input { flex: 1; min-width: 0; height: 100%; padding: 0 8px; border: 0; outline: none; background: none; color: var(--homeText); font-size: 13px; &::placeholder { color: var(--homeMuted); } &:focus-visible { outline: none; } } button { height: 100%; width: 40px; border: 0; border-radius: 0; } }
.filterToolbar { padding-bottom: 20px; margin-bottom: 24px; border-bottom: 1px solid var(--homeLine); }
.filterRows { display: grid; gap: 8px; min-width: 0; }
.filterRow { display: flex; gap: 20px; align-items: baseline; font-size: 12px; >span { flex-shrink: 0; color: var(--homeMuted); padding-block: 8px; } nav { display: flex; flex-wrap: wrap; gap: 24px; } button { position: relative; border: 0; border-radius: 0; padding: 6px 0 12px; min-height: 36px; color: var(--homeMuted); &.active { color: var(--homeText); font-weight: 600; &::after { position: absolute; inset: auto 0 0; height: 2px; background: currentColor; content: ""; } } } }
.materialActions { display: flex; flex-wrap: wrap; flex-shrink: 0; max-width: 100%; gap: 8px; button { white-space: nowrap; &.active { color: var(--homeAccent); border-color: var(--homeAccent); } } .addMaterial { background: var(--homeAccent); color: var(--homeBg); border-color: transparent; font-weight: 550; &:hover:not(:disabled) { background: var(--homeAccent); filter: brightness(.94); } } }
.managementPanel { margin-bottom: 24px;
  .selectionToolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; min-height: 40px; :deep(.el-checkbox) { margin-right: 0; color: var(--homeText); } }
  .selectionCount { color: var(--homeMuted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .selectionActions { display: flex; gap: 8px; margin-left: auto; }
  .organizeForm { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 16px; padding: 20px; margin-top: 12px; border: 1px solid var(--homeLine); border-radius: var(--ui-radius, 8px); background: var(--homeSurface);
    .organizeFields { flex: 1 1 280px; min-width: 0; display: grid; gap: 10px; label { font-size: 13px; font-weight: 550; } p { margin: 0; color: var(--homeMuted); font-size: 12px; } :deep(.el-select), :deep(.el-autocomplete) { width: 100%; } }
    .organizeActions { display: flex; flex-wrap: wrap; gap: 8px; :deep(.el-button) { margin-left: 0; } :deep(.el-button--primary) { color: var(--homeBg); background: var(--homeAccent); border-color: transparent; &:hover:not(:disabled) { background: var(--homeAccent); filter: brightness(.94); } } }
    .organizeError { flex-basis: 100%; margin: 0; color: var(--el-color-danger); font-size: 13px; overflow-wrap: anywhere; }
  }
}
.materialGrid { display: grid; grid-template-columns: repeat(auto-fill,minmax(min(256px,100%),1fr)); gap: 20px; align-items: start; }
.materialGrid.listView { grid-template-columns: minmax(0, 1fr); gap: 0; .materialCard { display: grid; grid-template-columns: 160px minmax(0, 1fr); border: 0; border-bottom: 1px solid var(--homeLine); border-radius: 0; background: transparent; padding-block: 16px; .materialPreview { align-self: start; border-radius: 4px; } .materialInfo { padding: 0 0 0 24px; } .materialFacts, .materialSource { margin-block: 4px; } .cardActions { margin-top: 12px; padding-top: 8px; } &.selected { background: var(--homeSurface); } } }
.materialCard { position: relative; min-width: 0; overflow: hidden; background: var(--homeSurface); border: 1px solid var(--homeLine); border-radius: var(--ui-radius-large, 12px); &:hover { border-color: var(--homeMuted); } &.selected { border-color: var(--homeAccent); }
  .materialSelection { position: absolute; top: 8px; left: 8px; z-index: 1; display: flex; align-items: center; gap: 6px; min-height: 36px; padding: 6px 10px; background: var(--homeSurface); border: 1px solid var(--homeLine); border-radius: var(--ui-radius-small, 4px); cursor: pointer; font-size: 12px; input { width: 16px; height: 16px; margin: 0; accent-color: var(--homeAccent); } }
  .materialPreview { display: flex; align-items: center; justify-content: center; width: 100%; aspect-ratio: 16 / 10; border: 0; padding: 0; border-radius: 0; color: var(--homeMuted); background: var(--homeBg); overflow: hidden; position: relative;
    :deep(.el-image),video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
    pre { position: absolute; inset: 0; white-space: pre-wrap; overflow-wrap: anywhere; text-align: left; margin: 0; padding: 20px; font: inherit; font-size: 13px; line-height: 1.8; overflow: hidden; }
  }
  .materialInfo { padding: 16px; }
  .materialTitle { display: flex; align-items: center; gap: 8px; h2 { flex: 1; min-width: 0; margin: 0; font-size: 14px; font-weight: 550; line-height: 1.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } >span { flex-shrink: 0; font-size: 11px; color: var(--homeMuted); } }
  .materialSource,.materialFacts { font-size: 11px; line-height: 1.5; color: var(--homeMuted); margin: 8px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .materialFacts { font-variant-numeric: tabular-nums; }
  .materialTags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; span { font-size: 11px; padding: 4px 6px; border-radius: var(--ui-radius-small, 4px); background: var(--homeRaised); color: var(--homeMuted); max-width: 100%; overflow-wrap: anywhere; } }
  .cardActions { display: flex; align-items: center; gap: 4px; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--homeLine); button { border: 0; color: var(--homeMuted); padding: 6px; &:hover { color: var(--homeText); } } >button:first-child { margin-right: auto; padding-left: 0; } .iconAction { width: 36px; } }
}
.materialPagination { display: flex; justify-content: center; padding: 24px 0 12px; :deep(.el-pagination) { --el-pagination-bg-color: var(--homeBg); --el-pagination-text-color: var(--homeText); --el-pagination-button-disabled-bg-color: transparent; flex-wrap: wrap; gap: 6px; } }
.materialState { text-align: center; padding: 64px 16px; color: var(--homeMuted); h2 { font-size: 18px; font-weight: 600; color: var(--homeText); margin: 20px 0 10px; } p { font-size: 14px; line-height: 1.8; margin: 0 0 24px; } &.uploadState { border: 1px dashed var(--homeLine); border-radius: 4px; padding-block: 56px; &.dragging { background: var(--homeSurface); border-color: var(--homeText); } } }
.operationStatus { font-size: 12px; color: var(--homeMuted); text-align: center; }
.hiddenInput { display: none; }
.assetEditor .editorColumns { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.mediaDetail { display: grid; gap: 20px; img, video { width: 100%; max-height: 60dvh; object-fit: contain; } audio { width: 100%; } pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 60dvh; overflow: auto; font: inherit; line-height: 1.8; } .el-button { justify-self: start; } }
@media(max-width:720px) { .materialActions { width: 100%; } .filterRow { gap: 12px; nav { gap: 18px; } button { min-height: 40px; } } .materials .cardActions button { min-height: 44px; } .materialGrid.listView .materialCard { grid-template-columns: 96px minmax(0, 1fr); .materialInfo { padding-left: 12px; } } }
@media(max-width:540px) { .materialGrid { grid-template-columns: minmax(0,1fr); } .assetEditor .editorColumns { grid-template-columns: 1fr; gap: 0; } .managementPanel { .selectionActions { margin-left: 0; flex-basis: 100%; } .organizeForm { padding: 16px; .organizeActions { width: 100%; justify-content: flex-end; } } } .materialCard .materialSelection { min-height: 44px; } }
</style>
