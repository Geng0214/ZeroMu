<template>
  <section class="filmPanel" aria-label="成片编辑">
    <div class="filmHeader"><div><h3>成片</h3><p>排列已采用视频，裁切片段并设置声音。预览与 MP4 使用同一份保存的剪辑决定。</p></div><span class="saveState" role="status">{{ loading ? '正在载入剪辑' : error && !draft ? '剪辑暂未载入' : dirty ? '有未保存修改' : context?.edit ? '剪辑已保存' : '尚未建立剪辑' }}</span></div>
    <label>制作单元<select :value="sequenceId" :disabled="loading || saving || rendering" @change="changeSequence(($event.target as HTMLSelectElement).value, $event.target as HTMLSelectElement)"><option value="">选择制作单元</option><option v-for="sequence in sequences" :key="sequence.sequenceId" :value="sequence.sequenceId">{{ sequence.name }}</option></select></label>
    <p v-if="error" class="filmError" role="alert">{{ error }}</p>
    <el-button v-if="error && !draft" :loading="loading" @click="load">重新读取剪辑</el-button>
    <p v-if="loading" role="status">正在读取固定视频与实际时长…</p>
    <template v-if="context && draft">
      <div class="filmToolbar"><el-button :disabled="loading || saving || rendering" @click="loadAdopted">从当前采用载入片段</el-button><el-button type="primary" :loading="saving" :disabled="!draft.clips.length || rendering" @click="save">保存剪辑</el-button><el-button :loading="starting" :disabled="dirty || !draft.clips.length || saving || rendering" @click="start">生成预览与 MP4</el-button></div>
      <p v-if="context.warnings.length" class="filmHint">{{ context.warnings.join('；') }}</p>
      <p v-if="!draft.clips.length" class="filmHint">先在分镜中采用视频，再载入片段。图片候选不会自动转换为视频。</p>
      <ol class="filmClips" aria-label="成片片段顺序"><li v-for="(clip, index) in draft.clips" :key="`${clip.candidateId}:${index}`"><div class="clipHeader"><strong>{{ index + 1 }} · {{ clipTitle(clip.candidateId) }}</strong><span>{{ sourceDuration(clip.candidateId) }} 秒素材</span><div><el-button :disabled="index === 0 || saving || rendering" :aria-label="`上移片段 ${index + 1}`" @click="moveClip(index, -1)">上移</el-button><el-button :disabled="index === draft.clips.length - 1 || saving || rendering" :aria-label="`下移片段 ${index + 1}`" @click="moveClip(index, 1)">下移</el-button><el-button :disabled="saving || rendering" :aria-label="`移除片段 ${index + 1}`" @click="draft.clips.splice(index, 1)">移除</el-button></div></div>
        <div class="clipFields"><label>入点（秒）<input v-model.number="clip.inSeconds" type="number" min="0" step="0.01" :aria-label="`片段 ${index + 1} 入点`" :disabled="saving || rendering" /></label><label>出点（秒）<input v-model.number="clip.outSeconds" type="number" min="0" step="0.01" :aria-label="`片段 ${index + 1} 出点`" :disabled="saving || rendering" /></label><label>原声音量<input v-model.number="clip.originalVolume" type="number" min="0" max="4" step="0.05" :aria-label="`片段 ${index + 1} 原声音量`" :disabled="saving || rendering" /></label><label class="originalToggle"><input type="checkbox" :checked="(clip.originalVolume ?? 1) > 0" :aria-label="`片段 ${index + 1} 原声`" :disabled="saving || rendering" @change="clip.originalVolume = ($event.target as HTMLInputElement).checked ? 1 : 0" />保留原声</label></div>
      </li></ol>
      <div class="filmSectionHeader"><h4>旁白与背景音乐</h4><el-button :disabled="!context.audio.length || saving || rendering || draft.audio.length >= 16" @click="addAudio">添加音轨</el-button></div><p v-if="!context.audio.length" class="filmHint">在素材版本中登记音频后，可以作为旁白或背景音乐。</p>
      <div v-for="(audio, index) in draft.audio" :key="index" class="audioRow"><label>固定音频<select :value="`${audio.versionId}:${audio.fileIndex || 0}`" :aria-label="`音轨 ${index + 1} 素材`" :disabled="saving || rendering" @change="changeAudio(audio, ($event.target as HTMLSelectElement).value)"><option v-for="file in context.audio" :key="`${file.versionId}:${file.fileIndex}`" :value="`${file.versionId}:${file.fileIndex}`">{{ file.name }} · {{ file.versionId.slice(0, 8) }}</option></select></label><label>用途<select v-model="audio.role" :aria-label="`音轨 ${index + 1} 用途`" :disabled="saving || rendering"><option value="narration">旁白</option><option value="music">背景音乐</option></select></label><label>开始（秒）<input v-model.number="audio.offsetSeconds" type="number" min="0" step="0.01" :aria-label="`音轨 ${index + 1} 开始时间`" :disabled="saving || rendering" /></label><label>音量<input v-model.number="audio.volume" type="number" min="0" max="4" step="0.05" :aria-label="`音轨 ${index + 1} 音量`" :disabled="saving || rendering" /></label><el-button :disabled="saving || rendering" :aria-label="`移除音轨 ${index + 1}`" @click="draft.audio.splice(index, 1)">移除</el-button></div>
      <h4>输出画面</h4><div class="outputFields"><label>画幅<select v-model="aspect" :disabled="saving || rendering" @change="applyAspect"><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option></select></label><label>宽（像素）<input v-model.number="draft.output.width" type="number" min="64" max="8192" step="2" :disabled="saving || rendering" /></label><label>高（像素）<input v-model.number="draft.output.height" type="number" min="64" max="8192" step="2" :disabled="saving || rendering" /></label><label>帧率<input v-model.number="draft.output.frameRate" type="number" min="1" max="120" step="1" :disabled="saving || rendering" /></label></div><p class="filmHint">{{ totalFrames }} 帧 · {{ (totalFrames / (draft.output.frameRate || 1)).toFixed(3) }} 秒。入点与出点按所选帧率量化，保持素材比例，空白区域填黑。</p>
      <h4>确认字幕</h4><p class="filmHint">导入 SRT 或 JSON 时间与文本。确认后保存；成片带字幕轨，并附 SRT 与 VTT 文件。</p><input ref="subtitleInput" type="file" accept=".srt,.json" aria-label="导入字幕文件" :disabled="saving || rendering" @change="importSubtitles" /><label>字幕清单（JSON）<textarea v-model="subtitleDraft" rows="5" :disabled="saving || rendering" @input="subtitlesConfirmed = false" /></label><label class="subtitleConfirmation"><input v-model="subtitlesConfirmed" type="checkbox" :disabled="saving || rendering" />我已确认字幕文本与时间范围</label>
      <div class="filmBottomActions"><el-button type="primary" :loading="saving" :disabled="!draft.clips.length || rendering" @click="save">保存剪辑</el-button><el-button :disabled="dirty || !draft.clips.length || saving || rendering" :loading="starting" @click="start">生成预览与 MP4</el-button></div>
    </template>
    <section v-if="exports.length" class="filmExports" aria-label="成片导出记录"><h4 ref="exportHeading" tabindex="-1">成片记录</h4><article v-for="record in exports.filter(record => record.edit.sequenceId === sequenceId).toReversed()" :key="record.exportId"><div class="exportHeader"><strong>{{ new Date(record.createdAt).toLocaleString() }}</strong><span>{{ record.status === 'pending' ? `${record.phase} · ${record.progress}%` : record.status === 'completed' ? `${record.totalFrames || '—'} 帧 · ${record.actualDuration?.toFixed(3)} 秒` : '导出未完成' }}</span><el-button v-if="record.status === 'pending'" @click="cancel(record.exportId)">停止导出</el-button></div><p v-if="record.error" class="filmError">{{ record.error }}</p><p class="filmHint">此成片使用导出时的固定采用版本与设置。后续剪辑修改需要另建导出。</p><template v-if="record.status === 'completed'"><div class="exportActions"><el-button @click="preview(record)">查看成片预览</el-button><el-button @click="download(record.path!, '成片.mp4')">下载 MP4</el-button><el-button @click="download(record.manifestPath!.replace('editManifest', 'outputManifest'), '采用素材与导出设置.json')">下载素材索引</el-button><el-button @click="download(record.manifestPath!.replace('editManifest.json', 'subtitles.srt'), '字幕.srt')">下载字幕</el-button></div><video v-if="previewId === record.exportId && previewUrl" :key="record.exportId" controls preload="metadata" :src="previewUrl" aria-label="成片预览"><track v-if="subtitleUrl && record.edit.subtitles.length" kind="subtitles" :src="subtitleUrl" srclang="zh" label="确认字幕" default /></video></template></article></section>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from "vue";
import axios from "axios";
import { ElMessage, ElMessageBox } from "element-plus";
import type { EditRecord, ExportRecord } from "@toonflow/server/production";
import { productionError, useProductionStore } from "@/stores/production";
import useWorkspaceFiles from "@/lib/workspaceFiles";
type ClipSource = { shotId: string; candidateId: string; title: string; info: { duration: number } };
type EditContext = { revision: number; sequence: { output: EditRecord["output"] }; edit: EditRecord | null; clips: ClipSource[]; audio: { versionId: string; fileIndex: number; name: string }[]; warnings: string[] };
const store = useProductionStore(); const headers = { "x-toonflow-workspace": "1" };
const sequences = computed(() => store.project?.sequences.filter(sequence => !sequence.archived) || []);
const sequenceId = ref(""); const context = ref<EditContext>(); const draft = ref<EditRecord>(); const saved = ref(""); const subtitleDraft = ref("[]"); const subtitlesConfirmed = ref(false); const aspect = ref("16:9");
const loading = ref(false); const saving = ref(false); const starting = ref(false); const error = ref("");
const exports = ref<(ExportRecord & { progress: number; phase: string })[]>([]);
const exportHeading = ref<HTMLElement>();
const previewId = ref(""); const previewUrl = ref(""); const subtitleUrl = ref(""); const subtitleInput = ref<HTMLInputElement>();
let timer: ReturnType<typeof setTimeout> | undefined; let epoch = 0; let reader: AbortController | undefined;
const active = computed(() => store.visible && store.panel === "edit");
const rendering = computed(() => exports.value.some(record => record.status === "pending"));
const dirty = computed(() => !!draft.value && (!subtitlesConfirmed.value || JSON.stringify(draft.value) !== saved.value || subtitleDraft.value !== JSON.stringify(draft.value.subtitles, null, 2)));
const totalFrames = computed(() => draft.value?.clips.reduce((sum, clip) => sum + Math.max(0, Math.round(clip.outSeconds * draft.value!.output.frameRate) - Math.round(clip.inSeconds * draft.value!.output.frameRate)), 0) || 0);
function clipTitle(id: string) { return context.value?.clips.find(item => item.candidateId === id)?.title || "固定候选不可读取"; }
function sourceDuration(id: string) { return context.value?.clips.find(item => item.candidateId === id)?.info.duration.toFixed(3) || "未知"; }
function resetPreview() { previewId.value = ""; previewUrl.value = ""; subtitleUrl.value = ""; }
async function load() {
  reader?.abort(); const current = reader = new AbortController(); const token = ++epoch; const directory = store.directory; const id = sequenceId.value;
  context.value = undefined; draft.value = undefined; resetPreview(); error.value = ""; loading.value = false;
  if (!active.value || !directory || !id) return; loading.value = true;
  try { const { data } = await axios.get<{ data: EditContext }>("/api/production/edit/context", { params: { directory, sequenceId: id }, headers, signal: current.signal }); if (token !== epoch || directory !== store.directory) return; context.value = data.data; draft.value = structuredClone(data.data.edit ?? { sequenceId: id, clips: [], audio: [], subtitles: [], output: data.data.sequence.output }); draft.value.clips.forEach(clip => clip.originalVolume ??= 1); draft.value.audio.forEach(audio => { audio.fileIndex ??= 0; audio.role ??= "narration"; }); saved.value = JSON.stringify(draft.value); subtitleDraft.value = JSON.stringify(draft.value.subtitles, null, 2); subtitlesConfirmed.value = true; aspect.value = draft.value.output.width === draft.value.output.height ? "1:1" : draft.value.output.width > draft.value.output.height ? "16:9" : "9:16"; }
  catch (cause) { if (!current.signal.aborted && token === epoch) error.value = productionError(cause); }
  finally { if (token === epoch) { loading.value = false; if (directory === store.directory && active.value) void poll(); } }
}
async function changeSequence(value: string, select: HTMLSelectElement) { if (dirty.value && !await ElMessageBox.confirm("当前剪辑有未保存修改。切换单元前可取消并保存。", "切换制作单元", { confirmButtonText: "放弃修改并切换", cancelButtonText: "返回保存" }).then(() => true, () => false)) { select.value = sequenceId.value; return; } sequenceId.value = value; }
async function loadAdopted() {
  if (!context.value || !draft.value) return;
  if (draft.value.clips.length && !await ElMessageBox.confirm("片段列表将替换为当前采用的视频，原剪辑在保存前保持不变。", "重新载入片段", { confirmButtonText: "载入", cancelButtonText: "取消" }).then(() => true, () => false)) return;
  const directory = store.directory; const id = sequenceId.value; loading.value = true; error.value = "";
  try { await store.load(); const { data } = await axios.get<{ data: EditContext }>("/api/production/edit/context", { params: { directory, sequenceId: id }, headers }); if (directory !== store.directory || id !== sequenceId.value || !draft.value) return; context.value = data.data; const project = store.project; draft.value.clips = data.data.clips.filter(item => project?.shots.find(shot => shot.shotId === item.shotId)?.adoptedCandidateId === item.candidateId).map(item => ({ shotId: item.shotId, candidateId: item.candidateId, inSeconds: 0, outSeconds: item.info.duration, originalVolume: 1 })); }
  catch (cause) { if (directory === store.directory) error.value = productionError(cause); } finally { loading.value = false; }
}
function moveClip(index: number, direction: number) { const clips = draft.value!.clips; const [clip] = clips.splice(index, 1); clips.splice(index + direction, 0, clip!); }
function addAudio() { const file = context.value?.audio[0]; if (file) draft.value?.audio.push({ versionId: file.versionId, fileIndex: file.fileIndex, offsetSeconds: 0, volume: 1, role: "narration" }); }
function changeAudio(audio: EditRecord["audio"][number], value: string) { const [id, index] = value.split(":"); audio.versionId = id!; audio.fileIndex = Number(index); }
function applyAspect() { const output = draft.value!.output; const short = Math.min(output.width, output.height); output.width = aspect.value === "9:16" || aspect.value === "1:1" ? short : Math.round(short * 16 / 9 / 2) * 2; output.height = aspect.value === "16:9" || aspect.value === "1:1" ? short : Math.round(short * 16 / 9 / 2) * 2; }
function parseSubtitles(value: string): EditRecord["subtitles"] { const parsed = JSON.parse(value); if (!Array.isArray(parsed) || parsed.length > 10000 || parsed.some(cue => !cue || typeof cue.text !== "string" || !Number.isFinite(cue.startSeconds) || !Number.isFinite(cue.endSeconds))) throw new Error("字幕需为包含 text、startSeconds、endSeconds 的 JSON 数组"); return parsed.map(cue => ({ text: cue.text, startSeconds: cue.startSeconds, endSeconds: cue.endSeconds })); }
async function importSubtitles(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
  try { if (file.size > 1024 * 1024) throw new Error("字幕文件不能超过 1 MB"); const text = (await file.text()).replace(/^\uFEFF/, ""); let cues: EditRecord["subtitles"];
    if (file.name.toLowerCase().endsWith(".srt")) { const seconds = (value: string) => { const [h, m, s] = value.replace(",", ".").split(":").map(Number); return h! * 3600 + m! * 60 + s!; }; cues = text.trim().split(/\r?\n\s*\r?\n/).filter(Boolean).map(block => { const match = block.match(/(?:^|\n)(\d{2}:\d{2}:\d{2}[,.]\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}[,.]\d{3})[^\n]*\n([\s\S]+)/); if (!match) throw new Error("SRT 时间或文本无法读取"); return { text: match[3]!.trim(), startSeconds: seconds(match[1]!), endSeconds: seconds(match[2]!) }; }); }
    else cues = parseSubtitles(text);
    subtitleDraft.value = JSON.stringify(cues, null, 2); subtitlesConfirmed.value = false;
  } catch (cause) { error.value = productionError(cause); } finally { if (subtitleInput.value) subtitleInput.value.value = ""; }
}
async function restoreKeyboardFocus(trigger: HTMLElement | undefined, directory: string, showExport = false) {
  await nextTick();
  if (!trigger?.isConnected || !active.value || directory !== store.directory || document.activeElement !== document.body) return;
  const target = showExport ? exportHeading.value ?? trigger : trigger;
  target.focus({ preventScroll: target === trigger });
}
async function save(event?: MouseEvent) {
  const trigger = event?.detail === 0 && event.currentTarget instanceof HTMLElement && document.activeElement === event.currentTarget ? event.currentTarget : undefined;
  if (!draft.value || saving.value) return; const directory = store.directory; saving.value = true; error.value = "";
    try { if (!subtitlesConfirmed.value) throw new Error("请先确认字幕文本与时间范围"); const edit = JSON.parse(JSON.stringify(draft.value)) as EditRecord; edit.subtitles = parseSubtitles(subtitleDraft.value); await store.update({ type: "saveEdit", edit }, directory); if (directory !== store.directory) return; draft.value = edit; if (context.value) context.value.edit = edit; saved.value = JSON.stringify(edit); subtitleDraft.value = JSON.stringify(edit.subtitles, null, 2); ElMessage.success("剪辑已保存"); }
  catch (cause) { if (directory === store.directory) error.value = productionError(cause); }
  finally {
    saving.value = false;
    await restoreKeyboardFocus(trigger, directory);
  }
}
async function start(event?: MouseEvent) {
  const trigger = event?.detail === 0 && event.currentTarget instanceof HTMLElement && document.activeElement === event.currentTarget ? event.currentTarget : undefined;
  if (dirty.value || !draft.value || !store.project) return; const directory = store.directory; starting.value = true; error.value = "";
  try { await axios.post("/api/production/exports/start", { directory, sequenceId: draft.value.sequenceId, expectedRevision: store.project.revision, exportId: crypto.randomUUID() }, { headers }); if (directory === store.directory) { await store.load(); await poll(); } }
  catch (cause) { if (directory === store.directory) error.value = productionError(cause); }
  finally { starting.value = false; await restoreKeyboardFocus(trigger, directory, !error.value); }
}
async function poll() {
  clearTimeout(timer); const directory = store.directory; if (!active.value || !directory) return;
  try { const { data } = await axios.get<{ data: typeof exports.value }>("/api/production/exports/list", { params: { directory }, headers }); if (directory !== store.directory || !active.value) return; const changed = JSON.stringify(exports.value.map(record => [record.exportId, record.status])) !== JSON.stringify(data.data.map(record => [record.exportId, record.status])); exports.value = data.data; if (changed) await store.load(); }
  catch (cause) { if (directory === store.directory && active.value) error.value = productionError(cause); }
  finally { if (directory === store.directory && active.value) timer = setTimeout(poll, 2000); }
}
async function cancel(exportId: string) { try { await axios.post("/api/production/exports/cancel", { directory: store.directory, exportId }, { headers }); await poll(); } catch (cause) { error.value = productionError(cause); } }
async function preview(record: ExportRecord) { const directory = store.directory; try { const files = useWorkspaceFiles(directory); const urls = await Promise.all([files.previewUrl(record.path!), record.edit.subtitles.length && record.manifestPath ? files.previewUrl(record.manifestPath.replace("editManifest.json", "subtitles.vtt")) : Promise.resolve("")]); if (directory !== store.directory || !active.value) return; previewId.value = record.exportId; previewUrl.value = urls[0]!; subtitleUrl.value = urls[1]!; } catch (cause) { error.value = productionError(cause); } }
async function download(path: string, name: string) { const files = useWorkspaceFiles(store.directory); const source = /\.(json|srt|vtt)$/i.test(path) ? files.acquireUrl(path) : undefined; try { const url = source ? await source.url : await files.previewUrl(path); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); } catch (cause) { error.value = productionError(cause); } finally { if (source) setTimeout(source.release, 1000); } }
watch([() => store.directory, sequenceId], () => { exports.value = []; void load(); });
watch(active, value => { if (value) { if (!sequences.value.some(sequence => sequence.sequenceId === sequenceId.value)) sequenceId.value = sequences.value[0]?.sequenceId || ""; else if (!context.value) void load(); else void poll(); } else { clearTimeout(timer); resetPreview(); } });
watch(sequences, () => { if (active.value && !sequenceId.value) sequenceId.value = sequences.value[0]?.sequenceId || ""; });
onScopeDispose(() => { ++epoch; reader?.abort(); clearTimeout(timer); resetPreview(); });
</script>

<style scoped lang="scss">
.filmPanel { font-variant-numeric: tabular-nums; h3 { margin: 0; font-size: 18px; } h4 { margin: 28px 0 12px; font-size: 14px; } p { line-height: 1.7; } .filmHeader { display: flex; align-items: start; gap: 16px; justify-content: space-between; margin-bottom: 20px; p { max-width: 52ch; font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 0; } .saveState { flex-shrink: 0; font-size: 12px; color: var(--el-text-color-secondary); } } .filmToolbar, .filmBottomActions, .exportActions { display: flex; gap: 8px; flex-wrap: wrap; margin: 16px 0; :deep(.el-button + .el-button) { margin-left: 0; } } .filmHint { font-size: 12px; color: var(--el-text-color-secondary); } .filmError { color: var(--el-color-danger); font-size: 13px; overflow-wrap: anywhere; } .filmClips { list-style: none; padding: 0; margin: 20px 0; li { padding: 16px 0; border-bottom: 1px solid var(--el-border-color-light); } .clipHeader { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; strong { flex: 1; min-width: 100px; font-size: 14px; overflow-wrap: anywhere; } span { font-size: 12px; color: var(--el-text-color-secondary); } > div { display: flex; gap: 6px; :deep(.el-button + .el-button) { margin-left: 0; } } } .clipFields { display: grid; grid-template-columns: repeat(3, 1fr) auto; gap: 10px; align-items: end; .originalToggle { display: flex; align-items: center; padding-bottom: 9px; } } } .filmSectionHeader { display: flex; justify-content: space-between; align-items: center; margin-top: 28px; h4 { margin: 0; } } .audioRow { display: grid; grid-template-columns: minmax(140px, 2fr) 1fr 1fr 1fr auto; gap: 8px; align-items: end; margin: 12px 0; } .outputFields { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; } .subtitleConfirmation { display: flex; align-items: center; margin-top: 12px; } textarea { margin-top: 4px; resize: vertical; } input[type='file'] { max-width: 100%; margin-bottom: 12px; } .filmExports { margin-top: 32px; article { padding: 20px 0; border-top: 1px solid var(--el-border-color-light); } .exportHeader { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; strong { font-size: 13px; } span { flex: 1; font-size: 12px; color: var(--el-text-color-secondary); } } video { width: 100%; max-height: 420px; background: #000; border-radius: 5px; } } }
@media (max-width: 700px) { .filmPanel { .filmHeader { flex-wrap: wrap; } .filmClips .clipFields { grid-template-columns: repeat(2, minmax(0, 1fr)); } .audioRow { grid-template-columns: repeat(2, minmax(0, 1fr)); > label:first-child { grid-column: 1 / -1; } } .outputFields { grid-template-columns: repeat(2, minmax(0, 1fr)); } } }
</style>
