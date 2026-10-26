<template>
  <libraryShell aria-label="创作模板库">
    <header class="promptPageHeader">
      <div class="promptPageTitle"><h1>提示词库</h1><nav class="libraryViews" aria-label="创作方法类型"><button :aria-pressed="route.query.view !== 'production'" @click="router.replace({ path: '/prompts' })">文字提示词</button><button :aria-pressed="route.query.view === 'production'" @click="router.replace({ path: '/prompts', query: { view: 'production' } })">制作模板</button></nav></div>
      <div v-if="route.query.view !== 'production'" class="libraryActions"><el-button type="primary" :disabled="!store.loaded || store.busy || store.loading" @click="openEditor()"><icon-plus :size="16" />新增提示词</el-button><el-button :disabled="store.busy" @click="importInput?.click()">导入</el-button><el-button :loading="store.loading" :disabled="store.busy" aria-label="刷新提示词库" title="刷新提示词库" @click="reload"><icon-refresh :size="16" /></el-button><input ref="importInput" class="fileInput" type="file" accept=".json,application/json" aria-label="导入提示词文件" @change="importFile" /></div>
    </header>
    <productionTemplateLibrary v-if="route.query.view === 'production'" />
    <template v-else>
    <div v-if="store.error || actionError" ref="errorBox" class="libraryError" role="alert" tabindex="-1">{{ actionError || store.error }}<span v-if="!store.loaded"> · 个人库读取成功后才能保存。</span></div><p v-if="store.loading" class="libraryStatus" role="status">正在读取个人提示词…</p><p v-if="status" class="libraryStatus" role="status">{{ status }}</p>
    <div class="promptToolbar">
      <div class="promptFilters"><el-input v-model="query" class="promptSearch" :prefixIcon="IconSearch" clearable placeholder="搜索标题、内容或标签" aria-label="搜索提示词" /><select v-model="scope" aria-label="提示词范围"><option v-for="item in scopes" :key="item.id" :value="item.id">{{ item.label }}</option></select><select v-if="tags.length" v-model="tag" aria-label="标签筛选"><option value="">全部标签</option><option v-for="item in tags" :key="item" :value="item">{{ item }}</option></select></div>
      <nav aria-label="提示词分类"><button v-for="item in categories" :key="item.id" :class="{ active: category === item.id }" :aria-pressed="category === item.id" @click="category = item.id">{{ item.label }}</button></nav>
    </div>
    <div v-if="!filtered.length" class="promptColumns" aria-hidden="true"><span>标题</span><span>分类</span><span>标签</span></div>
    <div v-if="filtered.length" class="promptWorkspace">
      <section class="promptList" aria-label="提示词列表"><p class="listCount">{{ filtered.length }} 条提示词</p><button v-for="item in filtered" :key="item.id" :class="{ selected: current?.id === item.id }" :aria-pressed="current?.id === item.id" @click="selectedId = item.id"><strong>{{ item.definition.title }}</strong><span class="promptExcerpt">{{ item.definition.text }}</span><span class="promptLabel">{{ item.origin === 'builtin' ? '内置' : '我的' }} · {{ item.definition.kind }}{{ item.favorite ? ' · 已收藏' : '' }}</span><icon-chevron-right :size="16" /></button></section>
      <section v-if="current" class="promptDetail" aria-label="提示词详情"><h2>{{ current.definition.title }}</h2><div class="detailHeading"><span>{{ current.definition.kind }} · {{ labels[current.definition.mode] }}</span><span>{{ current.origin === 'builtin' ? '内置提示词，另存后可编辑' : current.archived ? '已归档，原内容仍保留' : '个人提示词 · 保存在本机' }}</span></div><div class="detailButtons"><el-button :disabled="!store.loaded || store.busy || current.archived" :aria-pressed="current.favorite" @click="favorite">{{ current.favorite ? '取消收藏' : '收藏' }}</el-button><el-button v-if="!current.archived" :disabled="!store.loaded || store.busy" @click="openEditor(current)">{{ current.origin === 'builtin' ? '存为我的提示词' : '编辑' }}</el-button><el-button @click="openExport(current)">导出提示词</el-button><el-button v-if="current.origin === 'personal'" :disabled="!store.loaded || store.busy" @click="archive">{{ current.archived ? '恢复' : '归档' }}</el-button></div><div v-if="current.definition.tags.length" class="detailTags"><button v-for="item in current.definition.tags" :key="item" :aria-pressed="tag === item" @click="tag = tag === item ? '' : item">{{ item }}</button></div><div class="detailContent"><promptComposer :key="current.id" :definition="current.definition" :disabled="current.archived" :actionLabel="current.definition.mode === 'home' ? '在画布中构思' : '用于' + labels[current.definition.mode]" @usePrompt="usePrompt" /></div></section>
    </div>
    <div v-else class="emptyPrompts"><icon-file-text :size="30" :strokeWidth="1.5" /><h2>{{ !store.entries.length ? '还没有提示词' : '没有找到匹配的提示词' }}</h2><p>{{ !store.entries.length ? '添加你自己的创作方法，留给下一次使用。' : '换一个关键词，或查看全部分类。' }}</p><button v-if="!store.entries.length" :disabled="!store.loaded || store.busy || store.loading" @click="openEditor()"><icon-plus :size="16" />新增提示词</button><button v-else @click="resetFilters">查看全部</button></div>
    <promptEditor v-model="editing" :entryId="editingId" :seed="editingSeed" @saved="saved" />
    <el-dialog v-model="exporting" title="检查导出内容" width="min(680px, 94vw)" appendToBody><div v-if="exportEntry" class="promptExport"><p>导出标题、分类、标签、正文与变量说明。默认清空变量默认值；请检查正文中的私人信息。</p><h3>{{ exportEntry.definition.title }}</h3><p>{{ exportEntry.definition.kind }} · {{ labels[exportEntry.definition.mode] }}</p><p v-if="exportEntry.definition.tags.length">标签：{{ exportEntry.definition.tags.join('、') }}</p><pre>{{ exportEntry.definition.text }}</pre><label v-if="exportEntry.definition.variables.length"><input v-model="includeDefaults" type="checkbox" />包含变量默认值</label><ul><li v-for="variable in exportEntry.definition.variables" :key="variable.key">{{ variable.label }}（{{ variable.key }}） · {{ variable.required ? '必填' : '可留空' }} · 默认值{{ includeDefaults ? '：' + (variable.defaultValue || '（空）') : '不导出' }}</li></ul><p>不会导出应用渠道配置、凭据、项目路径、收藏或记录编号。重新导入会创建独立副本。</p><el-button type="primary" @click="downloadPrompt">下载提示词文件</el-button></div></el-dialog>
    </template>
  </libraryShell>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import productionTemplateLibrary from "@/components/productionTemplateLibrary.vue";
import { ElMessageBox } from "element-plus";
import { IconSearch, IconChevronRight, IconFileText, IconPlus, IconRefresh } from "@tabler/icons-vue";
import libraryShell from "@/components/libraryShell.vue";
import promptComposer from "@/components/promptComposer.vue";
import promptEditor from "@/components/promptEditor.vue";
import { exportPrompt, promptExportSchema, type PromptDefinition, type PromptLibraryEntry } from "@toonflow/server/promptLibrary";
import { promptLibraryError, usePromptLibraryStore } from "@/stores/promptLibrary";
const store = usePromptLibraryStore(); const router = useRouter(); const route = useRoute();
const labels = { image: "生图创作", video: "视频创作", audio: "音频创作", home: "自由创作" };
const categories = [{ id: "all", label: "全部" }, { id: "image", label: "生图" }, { id: "video", label: "视频" }, { id: "audio", label: "音频" }, { id: "home", label: "故事构思" }];
const scopes = [{ id: "all", label: "全部内容" }, { id: "personal", label: "我的" }, { id: "favorites", label: "收藏" }, { id: "archived", label: "已归档" }];
const query = ref(""); const category = ref("all"); const scope = ref("all"); const tag = ref(""); const selectedId = ref(""); const actionError = ref(""); const status = ref(""); const errorBox = ref<HTMLElement>();
const editing = ref(false); const editingId = ref<string>(); const editingSeed = ref<PromptDefinition>(); const importInput = ref<HTMLInputElement>();
const exporting = ref(false); const exportEntry = ref<PromptLibraryEntry>(); const includeDefaults = ref(false);
const tags = computed(() => [...new Set(store.entries.flatMap(entry => entry.definition.tags))].sort((a, b) => a.localeCompare(b)));
const filtered = computed(() => store.entries.filter(item => (scope.value === "archived" ? item.archived : !item.archived) && (scope.value !== "personal" || item.origin === "personal") && (scope.value !== "favorites" || item.favorite) && (category.value === "all" || item.definition.mode === category.value) && (!tag.value || item.definition.tags.includes(tag.value)) && `${item.definition.title} ${item.definition.text} ${item.definition.kind} ${item.definition.tags.join(" ")}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())));
const current = computed(() => filtered.value.find(item => item.id === selectedId.value) ?? filtered.value[0]);
watch(filtered, () => { selectedId.value = current.value?.id ?? ""; });
async function failure(cause: unknown) { actionError.value = promptLibraryError(cause); await nextTick(); errorBox.value?.focus(); }
async function reload() { actionError.value = ""; try { await store.load(); } catch (cause) { await failure(cause); } }
onMounted(() => { void reload(); });
function resetFilters() { query.value = ""; category.value = "all"; scope.value = "all"; tag.value = ""; }
function openEditor(entry?: PromptLibraryEntry) { editingId.value = entry?.origin === "personal" ? entry.id : undefined; editingSeed.value = entry && JSON.parse(JSON.stringify(entry.definition)); editing.value = true; }
function saved(id: string) { resetFilters(); scope.value = "personal"; selectedId.value = id; status.value = "个人提示词已保存"; actionError.value = ""; }
async function favorite() { const entry = current.value; if (!entry) return; actionError.value = ""; try { await store.update({ type: "favorite", id: entry.id, value: !entry.favorite }); status.value = entry.favorite ? "已取消收藏" : "已收藏"; } catch (cause) { await failure(cause); } }
async function archive() {
  const entry = current.value; if (!entry || entry.origin !== "personal") return; const revision = store.library.revision;
  if (!entry.archived && !await ElMessageBox.confirm("归档后原内容和收藏仍保留，可以在「已归档」中恢复。", `归档「${entry.definition.title}」`, { confirmButtonText: "归档", cancelButtonText: "保留" }).then(() => true, () => false)) return;
  try { await store.update({ type: "archive", id: entry.id, value: !entry.archived }, revision); status.value = entry.archived ? "提示词已恢复" : "提示词已归档，可在已归档中恢复"; } catch (cause) { await failure(cause); }
}
function usePrompt(text: string) { if (current.value) void router.push({ path: current.value.definition.mode === "home" ? "/home" : `/studio/${current.value.definition.mode}`, query: { prompt: text } }); }
function openExport(entry: PromptLibraryEntry) { exportEntry.value = JSON.parse(JSON.stringify(entry)); includeDefaults.value = false; exporting.value = true; }
function downloadPrompt() {
  if (!exportEntry.value) return; const value = exportPrompt(exportEntry.value.definition, includeDefaults.value); const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `${Array.from(value.prompt.title).slice(0, 80).join("").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/[. ]+$/, "") || "prompt"}.zeromuPrompt.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); status.value = "提示词文件已准备下载，变量默认值按本次选择导出";
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ""; if (!file) return;
  try { if (file.size > 2 * 1024 * 1024) throw new Error("提示词文件不能超过 2 MB"); const parsed = promptExportSchema.safeParse(JSON.parse(await file.text())); if (!parsed.success) throw new Error("文件不是支持的零幕提示词格式，或内容校验未通过"); editingId.value = undefined; editingSeed.value = parsed.data.prompt; editing.value = true; } catch (cause) { await failure(cause instanceof SyntaxError ? new Error("提示词文件不是有效的 JSON，请保留原件并重新导出") : cause); }
}
</script>

<style scoped lang="scss">
.promptPageHeader { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; margin-bottom: 28px; .promptPageTitle { display: flex; align-items: center; flex-wrap: wrap; gap: 28px; h1 { margin: 0; font-size: 28px; font-weight: 600; letter-spacing: -.025em; } } .libraryActions { display: flex; flex-wrap: wrap; gap: 8px; .el-button { margin-left: 0; gap: 6px; } } }
.libraryViews { display: flex; gap: 24px; button { position: relative; padding: 12px 0; min-height: 42px; color: var(--homeMuted); border: 0; background: transparent; font-size: 14px; &[aria-pressed=true] { color: var(--homeText); font-weight: 600; &::after { position: absolute; inset: auto 0 0; height: 2px; background: currentColor; content: ""; } } } }
.fileInput { display: none; }
.libraryError { padding: 12px 0; color: var(--el-color-danger); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.libraryStatus { margin: 0 0 12px; color: var(--homeMuted); font-size: 12px; }
.promptFilters { display: flex; gap: 12px; min-width: 0; .promptSearch { flex: 1; min-width: 140px; } select { min-width: 100px; min-height: 36px; padding: 6px 10px; background: transparent; border: 1px solid var(--homeLine); color: var(--homeText); border-radius: 4px; } }
.promptDetail { .detailButtons { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; .el-button { margin-left: 0; } } .detailTags { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; button { font-size: 12px; padding: 4px 8px; background: transparent; color: var(--homeMuted); border: 1px solid var(--homeLine); border-radius: 4px; } } .detailContent { min-height: 0; overflow: auto; flex: 1; padding: 4px; margin: -4px; } }
.promptExport { font-size: 13px; line-height: 1.8; overflow-wrap: anywhere; pre { white-space: pre-wrap; font: inherit; max-height: 240px; overflow: auto; padding: 12px; background: var(--el-fill-color-light); border-radius: 6px; } label { display: flex; align-items: center; gap: 8px; } }
.promptToolbar { flex-shrink: 0; display: grid; gap: 16px;
  nav { display: flex; gap: 24px; flex-wrap: wrap; }
  button { position: relative; min-height: 36px; font-size: 13px; border: 0; background: none; color: var(--homeMuted); padding: 8px 0 12px; &.active { color: var(--homeText); font-weight: 600; &::after { position: absolute; inset: auto 0 0; height: 2px; background: currentColor; content: ""; } } &:hover { color: var(--homeText); } }
}
.promptColumns { display: grid; grid-template-columns: minmax(0, 1fr) 160px 160px; gap: 24px; padding: 16px 8px; border-block: 1px solid var(--homeLine); color: var(--homeMuted); font-size: 12px; }
.promptWorkspace { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(240px,30%) minmax(0,1fr); gap: 24px; padding-top: 20px; }
.promptList { min-height: 0; min-width: 0; overflow: auto; padding: 0 4px 4px 0;
  .listCount { color: var(--homeMuted); font-size: 12px; margin: 0 0 12px; }
  button { position: relative; display: flex; flex-direction: column; gap: 8px; width: 100%; border: 1px solid transparent; border-radius: var(--ui-radius-large, 12px); text-align: left; padding: 16px 36px 16px 16px; background: none; color: var(--homeText); margin-bottom: 8px;
    &:hover { background: var(--homeSurface); }
    &.selected { background: var(--homeSurface); border-color: transparent; border-left-color: var(--homeText); .promptLabel,svg { color: var(--homeAccent); } }
    svg { position: absolute; top: 50%; right: 12px; color: var(--homeMuted); }
    strong { font-size: 15px; font-weight: 550; line-height: 1.5; }
    .promptLabel { color: var(--homeMuted); font-size: 11px; }
    .promptExcerpt { color: var(--homeMuted); font-size: 12px; line-height: 1.7; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  }
}
.promptDetail { min-height: 0; min-width: 0; overflow: hidden; display: flex; flex-direction: column; padding: 32px; background: var(--homeSurface); border-radius: var(--ui-radius-large, 12px);
  .detailHeading { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px 16px; font-size: 12px; color: var(--homeMuted); }
  h2 { margin: 0 0 12px; font-size: 24px; font-weight: 550; line-height: 1.4; }
  .detailHeading { margin-bottom: 24px; }
  .promptText { font-size: 16px; line-height: 2; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; max-width: 68ch; min-height: 0; flex: 1; overflow: auto; }
  .detailFooter { flex-shrink: 0; margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--homeLine); display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    button,a { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; padding: 10px 16px; border-radius: var(--ui-radius, 8px); font-size: 13px; text-decoration: none; }
    button { border: 1px solid var(--homeLine); color: var(--homeText); background: none; &:hover { background: var(--homeRaised); } }
    a { color: var(--homeBg); background: var(--homeAccent); &:hover { filter: brightness(.94); } }
  }
}
.promptDetail { display: block; overflow: auto; .detailContent { overflow: visible; } }
.promptDetail h2, .promptList strong, .detailHeading span { overflow-wrap: anywhere; }
.promptDetail .detailTags button { min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
.emptyPrompts { padding: 72px 20px; text-align: center; color: var(--homeMuted); h2 { margin: 20px 0 10px; color: var(--homeText); font-size: 18px; font-weight: 600; } p { margin: 0 0 24px; font-size: 14px; } button { display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px; border: 1px solid var(--homeLine); border-radius: 4px; color: var(--homeText); background: transparent; } }
@media(max-height:700px) { .promptDetail { padding: 24px; h2 { margin: 16px 0; font-size: 22px; } .detailFooter { margin-top: 16px; padding-top: 16px; } } }
@media(max-width:720px) {
  .promptPageHeader { .promptPageTitle { gap: 16px; } .libraryActions { width: 100%; .el-button { min-height: 40px; } } }
  .promptFilters { flex-wrap: wrap; .promptSearch { flex-basis: 100%; } select { min-height: 40px; flex: 1; } }
  .promptColumns { grid-template-columns: minmax(0, 1fr) 80px 80px; gap: 12px; }
  .promptDetail .detailContent { overflow: visible; }
  .promptDetail .detailButtons .el-button, .promptDetail .detailTags button { min-height: 44px; }
  .promptToolbar { gap: 12px; nav { gap: 18px; } button { min-height: 40px; } }
  .promptWorkspace { flex: 0 0 auto; grid-template-columns: minmax(0,1fr); grid-template-rows: minmax(140px, min(30dvh, 240px)) auto; gap: 16px; padding-top: 16px; }
  .promptList { button { padding-block: 12px; } }
  .promptDetail { padding: 20px; min-height: 280px; h2 { font-size: 20px; margin: 16px 0; } .promptText { font-size: 14px; line-height: 1.8; overflow: visible; } .detailFooter { gap: 8px; padding-top: 12px; button,a { flex: 1 1 auto; min-height: 44px; padding: 8px 12px; } } }
}
</style>
