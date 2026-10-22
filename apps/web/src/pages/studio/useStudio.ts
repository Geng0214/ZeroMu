import axios from "axios";
import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import type { GeneratedMedia, MediaGenerationRequest, MediaModel, MediaTaskRecord } from "@toonflow/tools-scaffold/runtime";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { debounce } from "lodash-es";
import { accessDraft, studioDraftKey, type StudioDraft } from "./draftStorage";
import saveFile from "@/lib/saveFile";
import { useWorkspaceStore } from "@/stores/workspace";
import { creationPreferences } from "@/lib/creationPreferences";
import { settings } from "@/stores/settings";
import type { ProductionTransferReceipt, ProductionTransferSource } from "@toonflow/server/production";
import { useTaskCenterStore } from "@/stores/taskCenter";
import { useProductionStore } from "@/stores/production";
import { invalidateNodeModels, useNodeAi } from "@toonflow/nodes-scaffold/nodeAi";
import { getMediaCapabilityError, getMediaReferenceLimits } from "@toonflow/providers/mediaCapabilities";

export type StudioKind = "image" | "video" | "audio";
export type ReferenceKind = StudioKind | "audio";
export type StudioReference = { id: string; kind: ReferenceKind; name: string; file: Blob; url: string; paths?: Record<string, string> };
export type SpeechConfig = { providerId: string; modelId: string; voice: string; speed: number; format: string };
export type StudioResult = GeneratedMedia & { id: string; prompt: string; model: string; createdAt: number; audioConfig?: SpeechConfig; generationConfig?: MediaGenerationRequest; taskId?: string };
type StudioTask = MediaTaskRecord;
type AssetEntry = { name: string; path: string; type: "file" | "directory"; children?: AssetEntry[]; metadata?: { title?: string; tags?: string[]; category?: string; description?: string } };

export default function useStudio(kind: Ref<StudioKind>) {
  const workspace = useWorkspaceStore();
  const router = useRouter();
  const nodeAi = useNodeAi();
  const taskCenter = useTaskCenterStore();
  const production = useProductionStore();
  const transferVisible = ref(false);
  const transferDirectory = ref("");
  const transferSource = ref<ProductionTransferSource>();
  let handingOff = false;
  const directory = ref(taskCenter.studioDirectory || workspace.project?.directory || "");
  const prompt = ref("");
  const models = ref<MediaModel[]>([]);
  const selectedModel = ref("");
  const loadingModels = ref(false);
  const modelError = ref("");
  const references = ref<StudioReference[]>([]);
  const results = ref<StudioResult[]>([]);
  const tasks = ref<StudioTask[]>([]);
  const taskError = ref("");
  const taskWarnings = ref<string[]>([]);
  const taskPage = ref(1);
  const taskTotal = ref(0);
  const taskPageSize = 20;
  const taskPageCount = computed(() => Math.max(1, Math.ceil(taskTotal.value / taskPageSize)));
  const hasRunningTasks = ref(false);
  let historyQueue = Promise.resolve();
  function updateHistory(action: () => Promise<void>) {
    const operation = historyQueue.catch(() => {}).then(action);
    historyQueue = operation.then(() => {}, () => {});
    return operation;
  }
  const page = ref(1);
  const pageSize = 12;
  const visibleResults = computed(() => results.value.slice((page.value - 1) * pageSize, page.value * pageSize));
  const pageCount = computed(() => Math.max(1, Math.ceil(results.value.length / pageSize)));
  const hiddenResults = ref<string[]>([]);
  let taskTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const selected = ref<string[]>([]);
  const urls = ref<Record<string, string>>({});
  const previewErrors = ref<Record<string, boolean>>({});
  const loadingHistory = ref(false);
  const historyError = ref("");
  const error = ref("");
  const busy = ref(false);
  const saving = ref(false);
  const adding = ref(false);
  const progress = ref("");
  const quality = ref("");
  const quantity = ref(creationPreferences.value.imageCount);
  const voice = ref(creationPreferences.value.voice);
  const speed = ref(creationPreferences.value.speed);
  const format = ref(creationPreferences.value.format);
  const imagePreset = ref("auto");
  const width = ref(1024);
  const height = ref(1024);
  const alignSize = ref(true);
  const imageSize = ref("");
  const ratio = ref("");
  const duration = ref<number>();
  const resolution = ref("");
  const generateAudio = ref(false);
  const videoMode = ref("");
  const restoringDraft = ref(true);
  const draftError = ref("");
  const draftDirty = ref(false);
  const draftReadFailed = ref(false);
  const draftFields = { prompt, selectedModel, quality, quantity, voice, speed, format, imagePreset, width, height, alignSize, imageSize, ratio, duration, resolution, generateAudio, videoMode };
  const initialFields = Object.fromEntries(Object.entries(draftFields).map(([key, value]) => [key, value.value]));
  let draftKey = "";
  let draftQueue = Promise.resolve();
  let draftVersion = 0;
  let queuedDraftVersion = -1;
  function draftSnapshot(): StudioDraft {
    return { fields: Object.fromEntries(Object.entries(draftFields).map(([key, value]) => [key, value.value])),
      references: references.value.map(({ url, paths, ...item }) => ({ ...item, ...(paths ? { paths: { ...paths } } : {}) })), savedAt: Date.now() };
  }
  function saveDraft() {
    if (!draftKey || restoringDraft.value || draftReadFailed.value || disposed || !draftDirty.value) return draftQueue;
    // 同一版草稿只入队一次；导航只等待尚未完成的保存，不重复复制参考文件。
    if (queuedDraftVersion === draftVersion && !draftError.value) return draftQueue;
    const key = draftKey; const snapshot = draftSnapshot(); const version = draftVersion;
    queuedDraftVersion = version;
    draftQueue = draftQueue.catch(() => {}).then(async () => {
      await accessDraft(key, snapshot);
      if (version === draftVersion) { draftDirty.value = false; draftError.value = ""; }
    }).catch(cause => { draftError.value = `草稿保存失败：${message(cause, "本地存储不可用")}，请保持页面开启`; throw cause; });
    void draftQueue.catch(() => {});
    return draftQueue;
  }
  const scheduleDraft = debounce(() => void saveDraft(), 250);
  watch([...Object.values(draftFields), references], () => {
    if (restoringDraft.value || draftReadFailed.value || disposed) return;
    draftVersion++; draftDirty.value = true; scheduleDraft();
  }, { deep: true, flush: "sync" });
  let draftLoad = 0;
  let draftController: AbortController | undefined;
  async function loadDraft() {
    const request = ++draftLoad;
    draftController?.abort();
    const controller = new AbortController(); draftController = controller;
    const previousScope = draftKey ? JSON.parse(draftKey) as [string, StudioKind] : undefined;
    const unboundDraft = previousScope && !previousScope[0] && previousScope[1] === kind.value ? draftSnapshot() : undefined;
    scheduleDraft.cancel();
    const savingPrevious = saveDraft();
    restoringDraft.value = true;
    const key = studioDraftKey(directory.value, kind.value);
    try { await savingPrevious; }
    catch { restoringDraft.value = false; if (draftKey) directory.value = JSON.parse(draftKey)[0]; return; }
    let loaded = false;
    try {
      if (request !== draftLoad || disposed) return;
      const storedDraft = await accessDraft(key, undefined, controller.signal);
      const draft = storedDraft ?? unboundDraft;
      if (request !== draftLoad || disposed) return;
      clearReferences();
      const fields = draft?.fields ?? { ...initialFields, selectedModel: availableModels.value[0] ? modelKey(availableModels.value[0]) : "", ratio: kind.value === "video" ? "16:9" : "1:1" };
      for (const [name, field] of Object.entries(draftFields)) if (name in fields) (field as Ref<unknown>).value = fields[name];
      if (!loadingModels.value && !model.value) selectedModel.value = availableModels.value[0] ? modelKey(availableModels.value[0]) : "";
      const queryPrompt = router.currentRoute.value.query.prompt;
      if (typeof queryPrompt === "string") prompt.value = queryPrompt;
      references.value = (draft?.references ?? []).filter(item => item.file instanceof Blob).map(item => ({ ...item, url: URL.createObjectURL(item.file) }));
      draftVersion++; queuedDraftVersion = -1;
      draftDirty.value = (!storedDraft && !!unboundDraft) || (typeof queryPrompt === "string" && queryPrompt !== storedDraft?.fields.prompt);
      draftError.value = "";
      draftReadFailed.value = false; loaded = true;
      await nextTick();
    } catch (cause) {
      if (request !== draftLoad || disposed || controller.signal.aborted) return;
      draftReadFailed.value = true;
      draftError.value = `草稿读取失败：${message(cause, "本地存储不可用")}。输入暂未切换，请重试读取后继续`;
    }
    finally {
      if (request === draftLoad && !disposed) {
        if (loaded) draftKey = key;
        restoringDraft.value = false;
        if (draftDirty.value && !draftReadFailed.value) scheduleDraft();
      }
    }
  }
  async function retryDraft() {
    if (draftReadFailed.value) await loadDraft(); else await saveDraft();
  }
  const assets = ref<AssetEntry[]>([]);
  const loadingAssets = ref(false);
  const assetError = ref("");
  let controller: AbortController | undefined;
  let historyRequest = 0;
  let historyController: AbortController | undefined;
  let taskController: AbortController | undefined;
  let modelRequest = 0;
  let modelRefreshPending = false;
  watch(() => [settings.value.mediaProviderConfigs, settings.value.mediaChannelDefaults], () => {
    if (busy.value) modelRefreshPending = true;
    else void loadModels();
  });
  watch(busy, value => { if (!value && modelRefreshPending) { modelRefreshPending = false; void loadModels(); } });
  const modelKey = (model: MediaModel) => JSON.stringify([model.providerId, model.modelId]);
  const availableModels = computed(() => models.value.filter(model => model.type === kind.value));
  const model = computed(() => availableModels.value.find(item => modelKey(item) === selectedModel.value));
  const directoryLocked = computed(() => busy.value || saving.value || adding.value || loadingHistory.value || restoringDraft.value);
  const locked = computed(() => directoryLocked.value || draftReadFailed.value);
  const sizes = computed(() => model.value?.imageSizes ?? []);
  const ratios = computed(() => (kind.value === "video" ? model.value?.videoRatios : model.value?.imageRatios) ?? []);
  const imagePresets = computed(() => [
    { value: "auto", label: "渠道默认", size: "" },
    ...sizes.value.map(size => ({ value: `size:${size}`, label: size, size })),
    ...(model.value?.imageSizeRange ? [{ value: "custom", label: "自定义宽高", size: "" }] : []),
  ]);
  function applyImagePreset(value: string) {
    const preset = imagePresets.value.find(item => item.value === value);
    if (!preset) return;
    imagePreset.value = value; imageSize.value = preset.size;
    const range = model.value?.imageSizeRange;
    if (value === "custom" && range) { const aligned = (edge: number) => Math.max(Math.ceil(range.min / range.step), Math.min(Math.floor(range.max / range.step), Math.round(edge / range.step))) * range.step; width.value = aligned(width.value); height.value = aligned(height.value); }
  }
  const durationOptions = computed(() => [...new Set(model.value?.durationResolutionMap?.flatMap(item => item.duration) ?? [])]);
  const resolutionOptions = computed(() => [...new Set(model.value?.durationResolutionMap?.filter(item => !duration.value || item.duration.includes(duration.value)).flatMap(item => item.resolution) ?? [])]);
  const videoModes = computed(() => Array.isArray(model.value?.mode) ? model.value.mode.filter(item =>
    typeof item === "string" ? ["text", "singleImage", "startEndRequired", "endFrameOptional", "startFrameOptional"].includes(item)
      : Array.isArray(item) && item.every(value => typeof value === "string" && /^(image|video|audio)Reference:\d+$/.test(value))) : []);
  const referenceLimits = computed(() => { try { return model.value ? getMediaReferenceLimits(model.value, kind.value, kind.value === "video" && videoMode.value ? JSON.parse(videoMode.value) : undefined) : { image: 0, video: 0, audio: 0 }; } catch { return { image: 0, video: 0, audio: 0 }; } });
  function requestFor(choice: MediaModel, type: StudioKind, text: string, uploaded: Record<ReferenceKind, { path: string; mimeType: string }[]>): MediaGenerationRequest {
    const payload: MediaGenerationRequest = { providerId: choice.providerId, modelId: choice.modelId, prompt: text };
    if (type === "image") { payload.images = uploaded.image; if (uploaded.video.length) payload.videos = uploaded.video; if (uploaded.audio.length) payload.audios = uploaded.audio; payload.n = quantity.value; if (imageSize.value) payload.size = imageSize.value; else if (imagePreset.value === "custom") payload.size = `${width.value}x${height.value}`; if (ratio.value) payload.ratio = ratio.value; if (quality.value) payload.quality = quality.value; }
    else if (type === "audio") { payload.audios = uploaded.audio; if (uploaded.image.length) payload.images = uploaded.image; if (uploaded.video.length) payload.videos = uploaded.video; if (choice.audioSpeedRange) payload.speed = speed.value; if (voice.value.trim()) payload.voice = voice.value.trim(); if (format.value) payload.format = format.value; }
    else { const mode = videoMode.value ? JSON.parse(videoMode.value) as MediaGenerationRequest["mode"] : undefined; payload.images = uploaded.image; payload.videos = uploaded.video; payload.audios = uploaded.audio; payload.mode = mode; if (ratio.value) payload.ratio = ratio.value; if (duration.value !== undefined) payload.duration = duration.value; if (resolution.value) payload.resolution = resolution.value; if (choice.audio !== undefined) payload.generateAudio = choice.audio === "optional" ? generateAudio.value : choice.audio; if (mode && !Array.isArray(mode) && !["text", "singleImage"].includes(mode)) { payload.firstFrame = mode === "startFrameOptional" && uploaded.image.length === 1 ? undefined : uploaded.image[0]; payload.lastFrame = uploaded.image[mode === "startFrameOptional" && uploaded.image.length === 1 ? 0 : 1]; payload.images = undefined; } }
    return payload;
  }
  const inputError = computed(() => {
    if (!model.value) return "";
    const uploaded = Object.fromEntries((["image", "video", "audio"] as const).map(type => [type, references.value.filter(item => item.kind === type).map(item => ({ path: "", mimeType: item.file.type }))])) as Record<ReferenceKind, { path: string; mimeType: string }[]>;
    try { return getMediaCapabilityError(model.value, kind.value, requestFor(model.value, kind.value, prompt.value, uploaded)) ?? ""; } catch { return "生成模式无效，请重新选择模型已声明的模式"; }
  });

  function message(cause: unknown, fallback: string) {
    return axios.isAxiosError(cause) ? cause.response?.data?.message || cause.message : cause instanceof Error ? cause.message : fallback;
  }
  async function loadModels(refresh = false) {
    const request = ++modelRequest;
    if (refresh) invalidateNodeModels("media");
    loadingModels.value = true;
    modelError.value = "";
    try {
      const data = await nodeAi.getMediaModels();
      if (request !== modelRequest) return;
      models.value = data;
      if (!restoringDraft.value && !draftReadFailed.value && !model.value) selectedModel.value = availableModels.value[0] ? modelKey(availableModels.value[0]) : "";
    } catch (cause) { if (request === modelRequest) modelError.value = message(cause, "读取模型失败"); }
    finally { if (request === modelRequest) loadingModels.value = false; }
  }
  function clearReferences() {
    references.value.forEach(item => URL.revokeObjectURL(item.url));
    references.value = [];
  }
  function removeReference(id: string) {
    const item = references.value.find(item => item.id === id);
    if (item) URL.revokeObjectURL(item.url);
    references.value = references.value.filter(item => item.id !== id);
  }
  function addFiles(files: { name: string; blob: Blob }[], referenceKind: ReferenceKind) {
    const limit = Math.min(referenceLimits.value[referenceKind] ?? 64, 64);
    if (!limit) { ElMessage.warning("当前模型或模式未声明此类参考能力；已有参考可保留，生成前请更换模式或移除不兼容参考"); return; }
    for (const file of files) {
      if (!file.blob.type.startsWith(`${referenceKind}/`)) { ElMessage.warning(`“${file.name}”不是有效的${{ image: "图片", video: "视频", audio: "音频" }[referenceKind]}`); continue; }
      if (!file.blob.size || file.blob.size > (referenceKind === "audio" ? 15 : 100) * 1024 * 1024) { ElMessage.warning(`“${file.name}”为空或超过大小限制`); continue; }
      if (references.value.filter(item => item.kind === referenceKind).length >= limit) { ElMessage.warning(`最多添加 ${limit} 个同类参考素材`); break; }
      references.value.push({ id: crypto.randomUUID(), kind: referenceKind, name: file.name, file: file.blob, url: URL.createObjectURL(file.blob) });
    }
  }
  async function readClipboard(referenceKind?: ReferenceKind) {
    if (locked.value) return;
    adding.value = true;
    try {
      if (!referenceKind) { const text = await navigator.clipboard.readText(); if (text) prompt.value += `${prompt.value ? "\n" : ""}${text}`; else ElMessage.info("剪贴板中没有文字"); return; }
      const entries = await navigator.clipboard.read();
      const files: { name: string; blob: Blob }[] = [];
      for (const entry of entries) {
        const type = entry.types.find(type => type.startsWith(`${referenceKind}/`));
        if (type) files.push({ name: `剪贴板${files.length + 1}`, blob: await entry.getType(type) });
      }
      if (!files.length) ElMessage.info("剪贴板没有此类媒体，请使用上传");
      addFiles(files, referenceKind);
    } catch { ElMessage.warning("无法读取剪贴板，请允许浏览器权限，或直接粘贴／上传"); }
    finally { adding.value = false; }
  }
  async function loadAssets() {
    loadingAssets.value = true; assetError.value = "";
    try {
      const { data } = await axios.get<{ data: { entries: AssetEntry[] } }>("/api/assets/list");
      const flatten = (items: AssetEntry[]): AssetEntry[] => items.flatMap(item => item.type === "file" ? [item] : flatten(item.children ?? []));
      assets.value = flatten(data.data.entries);
    } catch (cause) { assetError.value = message(cause, "读取素材失败"); }
    finally { loadingAssets.value = false; }
  }
  async function addAsset(asset: AssetEntry, referenceKind: ReferenceKind) {
    adding.value = true;
    try {
      const { data } = await axios.get<Blob>("/api/assets/read", { params: { path: asset.path }, responseType: "blob" });
      addFiles([{ name: asset.metadata?.title || asset.name, blob: data }], referenceKind);
    } catch (cause) { ElMessage.error(message(cause, "读取素材失败")); }
    finally { adding.value = false; }
  }
  const historyPath = (type: StudioKind) => ({ image: "studioImageHistory.json", video: "studioVideoHistory.json", audio: "studioAudioHistory.json" }[type]);
  function releasePreviews() { urls.value = {}; previewErrors.value = {}; }
  async function loadPreviews(items: StudioResult[], path: string, request: number) {
    await Promise.all(items.map(async item => {
      try { const url = await useWorkspaceFiles(path).previewUrl(item.path); if (request === historyRequest) urls.value[item.id] = url; }
      catch { if (request === historyRequest) previewErrors.value[item.id] = true; }
    }));
  }
  async function loadHistory() {
    const request = ++historyRequest;
    historyController?.abort();
    historyController = new AbortController();
    const signal = AbortSignal.any([historyController.signal, AbortSignal.timeout(15000)]);
    const path = directory.value;
    const type = kind.value;
    releasePreviews(); results.value = []; selected.value = []; hiddenResults.value = []; page.value = 1; historyError.value = "";
    if (!path) { loadingHistory.value = false; return; }
    loadingHistory.value = true;
    try {
      const content = await useWorkspaceFiles(path).readJson<{ version: number; items: StudioResult[]; hiddenResults?: string[] }>(historyPath(type), signal);
      if (request !== historyRequest) return;
      if (content?.version !== 1 || !Array.isArray(content.items) || !content.items.every(item => item && typeof item.id === "string" && typeof item.path === "string" && item.mediaType === type && typeof item.mimeType === "string" && typeof item.prompt === "string" && typeof item.model === "string" && Number.isFinite(item.createdAt))) throw new Error("结果记录格式无效，请先备份并检查记录文件");
      hiddenResults.value = (content.hiddenResults ?? []).filter(item => typeof item === "string");
      results.value = content.items;
    } catch (cause) {
      if (request === historyRequest && !(axios.isAxiosError(cause) && cause.response?.status === 404)) historyError.value = message(cause, "读取历史结果失败");
    } finally { if (request === historyRequest) loadingHistory.value = false; }
  }
  async function persist(items: StudioResult[], path = directory.value, type = kind.value) {
    await useWorkspaceFiles(path).writeJson(historyPath(type), { version: 1, items, hiddenResults: hiddenResults.value });
  }
  async function loadTasks() {
    clearTimeout(taskTimer);
    taskController?.abort();
    const current = taskController = new AbortController();
    const path = directory.value; const type = kind.value;
    if (!path || loadingHistory.value || historyError.value || disposed) return;
    try {
      const { data } = await axios.get<{ data: { tasks: StudioTask[]; total: number; runningCount: number; warnings: string[] } }>("/api/ai/media/tasks/list", { params: { directory: path, mediaType: type, offset: (taskPage.value - 1) * taskPageSize, limit: taskPageSize }, headers: { "x-toonflow-workspace": "1" }, signal: current.signal, timeout: 15000 });
      if (current.signal.aborted || disposed || path !== directory.value || type !== kind.value) return;
      tasks.value = data.data.tasks; taskTotal.value = data.data.total; hasRunningTasks.value = data.data.runningCount > 0; taskError.value = "";
      taskWarnings.value = data.data.warnings;
      await updateHistory(async () => {
        if (current.signal.aborted || disposed || path !== directory.value || type !== kind.value) return;
        const added = data.data.tasks.flatMap(task => task.results.map((item): StudioResult => ({ ...item, id: `${task.id}:${item.path}`, taskId: task.id, prompt: task.request.prompt, model: `${task.request.providerId} / ${task.request.modelId}`, createdAt: task.createdAt, generationConfig: task.request,
          ...(type === "audio" ? { audioConfig: { providerId: task.request.providerId, modelId: task.request.modelId, voice: task.request.voice ?? "", speed: task.request.speed ?? 1, format: task.request.format ?? "mp3" } } : {}) })))
          .filter(item => !hiddenResults.value.includes(item.id) && !results.value.some(existing => existing.path === item.path));
        if (added.length) {
          const next = [...added, ...results.value].sort((a, b) => b.createdAt - a.createdAt);
          await persist(next, path, type);
          if (path === directory.value && type === kind.value) results.value = next;
        }
      });
    } catch (cause) { if (!current.signal.aborted && path === directory.value && type === kind.value) taskError.value = message(cause, "读取任务失败；请刷新任务，勿重复提交"); }
    finally { if (!current.signal.aborted && !disposed && path === directory.value && type === kind.value) taskTimer = setTimeout(() => void loadTasks(), taskError.value || hasRunningTasks.value ? 5000 : 30000); }
  }
  async function resumeTask(task: StudioTask) {
    try {
      await axios.post("/api/ai/media/tasks/resume", { id: task.id, directory: directory.value }, { headers: { "x-toonflow-workspace": "1" } });
      await loadTasks();
    } catch (cause) { ElMessage.error(message(cause, "恢复任务失败")); }
  }
  watch(visibleResults, items => { releasePreviews(); if (directory.value) void loadPreviews(items, directory.value, historyRequest); });
  async function removeSelected() {
    if (!selected.value.length || locked.value) return;
    saving.value = true;
    try {
      const confirmed = await ElMessageBox.confirm("从结果列表移除所选记录？已生成的原文件会保留在项目目录。", "移除结果", { confirmButtonText: "移除", cancelButtonText: "取消" }).then(() => true, () => false);
      if (!confirmed) return;
      await updateHistory(async () => {
        const next = results.value.filter(item => !selected.value.includes(item.id));
        const previousHidden = hiddenResults.value;
        hiddenResults.value = [...new Set([...hiddenResults.value, ...selected.value])];
        try { await persist(next); } catch (cause) { hiddenResults.value = previousHidden; throw cause; }
        results.value = next; selected.value = []; page.value = Math.min(page.value, pageCount.value);
      });
    } catch (cause) { ElMessage.error(message(cause, "保存结果列表失败")); }
    finally { saving.value = false; }
  }
  async function download(item: StudioResult) {
    try { await saveFile(async () => new Blob([await useWorkspaceFiles(directory.value).read(item.path)], { type: item.mimeType }), item.path.split("/").at(-1)!); }
    catch (cause) { ElMessage.error(message(cause, "下载失败")); }
  }
  function applyRatio(value: string, edge = 1024) {
    ratio.value = value;
    const [w, h] = value.split(":").map(Number);
    width.value = w >= h ? edge : Math.round(edge * w / h / 16) * 16;
    height.value = h >= w ? edge : Math.round(edge * h / w / 16) * 16;
  }
  async function generate() {
    if (locked.value || !prompt.value.trim() || !model.value || !directory.value || historyError.value) return;
    if (inputError.value) { error.value = inputError.value; return; }
    if (taskError.value) { ElMessage.warning("请先刷新任务并确认已有任务状态，再开始新的生成"); return; }
    if (hasRunningTasks.value) { ElMessage.info("当前任务仍在生成，请等待结果或查看任务状态"); return; }
    const path = directory.value;
    const type = kind.value;
    const chosen = model.value;
    const text = prompt.value.trim();
    const pendingUploads: string[] = [];
    let submissionAttempted = false;
    controller = new AbortController();
    const signal = controller.signal;
    busy.value = true; error.value = ""; progress.value = "准备参考素材…";
    try {
      if (type === "image" && imagePreset.value === "custom" && [width.value, height.value].some(value => !Number.isFinite(value) || value < 1 || value > 8192)) throw new Error("图片宽高须在模型声明的范围内");
      if (type === "video" && duration.value !== undefined && String(duration.value) !== "" && (!Number.isFinite(duration.value) || duration.value <= 0 || duration.value > 3600)) throw new Error("视频时长须为 1 到 3600 秒之间的数值");
      if (type === "image" && (!Number.isInteger(quantity.value) || quantity.value < 1 || quantity.value > 10)) throw new Error("生成张数须为 1 到 10 的整数");
      await workspace.openProject(path, path, signal);
      const files = useWorkspaceFiles(path);
      const uploaded: Record<ReferenceKind, { path: string; mimeType: string }[]> = { image: [], video: [], audio: [] };
      const mode = videoMode.value ? JSON.parse(videoMode.value) as MediaGenerationRequest["mode"] : undefined;
      if (type === "video" && mode === "text" && references.value.length) throw new Error("当前为文生视频模式，请移除参考素材或切换生成模式");
      if (type === "video" && Array.isArray(mode)) {
        for (const referenceKind of ["image", "video", "audio"] as const) {
          const limit = Number(mode.find(item => item.startsWith(`${referenceKind}Reference:`))?.split(":")[1] ?? 0);
          if (references.value.filter(item => item.kind === referenceKind).length > limit) throw new Error(`当前模式最多支持 ${limit} 个${{ image: "图片", video: "视频", audio: "音频" }[referenceKind]}参考`);
        }
      }
      if (type === "video" && mode && !Array.isArray(mode) && mode !== "text") {
        const count = references.value.filter(item => item.kind === "image").length;
        if (references.value.some(item => item.kind !== "image")) throw new Error("首尾帧模式仅接受图片参考");
        if (count > (mode === "singleImage" ? 1 : 2)) throw new Error("当前模式最多支持两张首尾帧参考图，单图模式只支持一张");
        if (mode === "startFrameOptional" && count < 1) throw new Error("请添加尾帧参考图；两张图片按顺序作为首帧、尾帧");
        if ((mode === "startEndRequired" && count !== 2) || (["singleImage", "endFrameOptional"].includes(mode) && count < 1)) throw new Error("请添加当前模式所需的首帧／尾帧参考图");
      }
      if (references.value.length) {
        try { await files.mkdir("studioReferences"); } catch (cause) { if (!(axios.isAxiosError(cause) && cause.response?.status === 409 && cause.response.data?.data?.code === "EEXIST")) throw cause; }
        const names = new Set((await files.list("studioReferences")).entries.filter(item => item.type === "file").map(item => item.name));
        for (const reference of references.value) {
          let target = reference.paths?.[path];
          if (!target || !/^studioReferences\/[a-f0-9-]{36}$/i.test(target) || !names.has(target.slice("studioReferences/".length))) {
            target = `studioReferences/${crypto.randomUUID()}`;
            pendingUploads.push(target);
            await files.write(target, reference.file, true, signal);
            (reference.paths ??= {})[path] = target;
          }
          uploaded[reference.kind].push({ path: target, mimeType: reference.file.type });
        }
      }
      const payload = requestFor(chosen, type, text, uploaded);
      signal.throwIfAborted(); progress.value = "生成中，正在等待模型返回…";
      const id = crypto.randomUUID();
      submissionAttempted = true;
      try { await axios.post("/api/ai/media/tasks/start", { id, directory: path, mediaType: type, request: payload }, { headers: { "x-toonflow-workspace": "1" }, timeout: 30000 }); }
      catch (cause) { await loadTasks(); throw new Error(`提交响应未确认：${message(cause, "连接中断")}。请先刷新任务确认状态，勿重复生成。`); }
      ElMessage.success("任务已提交，离开或刷新页面后可继续查看结果");
      taskPage.value = 1;
      await loadTasks();
    } catch (cause) { error.value = signal.aborted ? "已停止准备素材；已提交的任务可在任务列表中继续查看。" : message(cause, "生成失败，请检查渠道设置后重试"); }
    finally {
      if (!submissionAttempted) for (const target of pendingUploads) {
        try {
          await useWorkspaceFiles(path).remove(target);
          for (const reference of references.value) if (reference.paths?.[path] === target) delete reference.paths[path];
        } catch (cause) { if (!(axios.isAxiosError(cause) && cause.response?.status === 404)) console.warn("参考缓存暂未清理", cause); }
      }
      busy.value = false; controller = undefined; progress.value = "";
    }
  }
  async function cleanupReferences() {
    if (locked.value || !directory.value || hasRunningTasks.value) return;
    saving.value = true;
    const path = directory.value;
    try {
      const confirmed = await ElMessageBox.confirm("仅清理超过 24 小时、且未被项目文档、对话或任务记录引用的参考缓存。已生成作品会保留。", "清理参考缓存", { confirmButtonText: "清理", cancelButtonText: "取消" }).then(() => true, () => false);
      if (!confirmed) return;
      const { data } = await axios.post<{ data: { removed: number } }>("/api/ai/media/tasks/cleanupReferences", { directory: path }, { headers: { "x-toonflow-workspace": "1" } });
      ElMessage.success(`已清理 ${data.data.removed} 个未引用缓存`);
    } catch (cause) { ElMessage.error(message(cause, "缓存清理失败，文件已保留")); }
    finally { saving.value = false; }
  }
  function resetDraft() {
    prompt.value = ""; error.value = ""; clearReferences();
    quantity.value = creationPreferences.value.imageCount;
    voice.value = creationPreferences.value.voice;
    speed.value = creationPreferences.value.speed;
    format.value = creationPreferences.value.format;
    if (model.value?.voices?.length && !model.value.voices.some(item => item.voice === voice.value)) voice.value = model.value.voices[0].voice;
  }
  async function sendToCanvas(item?: StudioResult) {
    if (locked.value) return;
    if (!directory.value) { ElMessage.warning("请先选择保存位置，再发送到画布"); return; }
    if (item) {
      transferDirectory.value = directory.value;
      transferSource.value = JSON.parse(JSON.stringify({ resultId: item.id, taskId: item.taskId, path: item.path, mimeType: item.mimeType, mediaType: item.mediaType, prompt: item.prompt, request: item.generationConfig ?? (item.audioConfig ? { ...item.audioConfig, prompt: item.prompt } : undefined), contentHash: item.contentHash, modelLabel: item.model.slice(0, 1000) })) as ProductionTransferSource;
      transferVisible.value = true;
      return;
    }
    if (references.value.length) { ElMessage.warning("语音节点支持文字朗读；请先移除参考音频，或生成后发送音频结果"); return; }
    const text = prompt.value;
    if (!text.trim()) { ElMessage.warning("请先输入朗读文本"); return; }
    const path = directory.value;
    const config = { providerId: model.value?.providerId ?? "", modelId: model.value?.modelId ?? "", voice: voice.value, speed: speed.value, format: format.value || "mp3" };
    if (!Number.isFinite(config.speed) || config.speed < 0.25 || config.speed > 4 || !["mp3", "wav", "flac", "aac", "opus"].includes(config.format)) { ElMessage.error("音频参数无效，请检查音色、语速和格式"); return; }
    saving.value = true;
    let canvasFile = "";
    try {
      await workspace.openProject(path);
      const id = crypto.randomUUID();
      canvasFile = `studioCanvas${Date.now()}${id.slice(0, 8)}.json`;
      await useWorkspaceFiles(path).writeJson(canvasFile, { toonflowCanvas: true, nodes: [{ id, type: "remote-audioNode", position: { x: 200, y: 160 }, selected: true, data: { label: "音频", prompt: text, model: config.providerId && config.modelId ? JSON.stringify([config.providerId, config.modelId]) : "", voice: config.voice, speed: config.speed, format: config.format } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, true);
      await saveDraft();
      handingOff = true;
      const failure = await router.push({ path: "/workspace", query: { canvas: canvasFile } });
      if (failure) throw new Error("未能打开画布，请在项目中打开已保存的创作画布");
      ElMessage.success("朗读文本与参数已带入语音节点");
    } catch (cause) { ElMessage.error(`${message(cause, "发送到画布失败")}${canvasFile ? `（已保存：${canvasFile}）` : ""}`); }
    finally { handingOff = false; saving.value = false; }
  }
  async function openTransferTarget(receipt: ProductionTransferReceipt) {
    const path = transferDirectory.value;
    await saveDraft();
    await workspace.openProject(path);
    const checkedDirectory = workspace.project!.directory;
    handingOff = true;
    try {
      const failure = await router.push({ path: "/workspace", query: receipt.canvasId ? { canvas: receipt.canvasId } : {} });
      if (failure) throw new Error("目标未能打开，原结果和传递记录已经保存，请重试打开");
      await nextTick();
      if (receipt.canvasId && receipt.nodeId) taskCenter.location = { directory: checkedDirectory, canvasId: receipt.canvasId, nodeId: receipt.nodeId, token: crypto.randomUUID() };
      if (receipt.target.kind === "shot") { await production.load(); production.openShot(receipt.target.shotId); }
    } finally { handingOff = false; }
  }
  async function collectResult(item: StudioResult) {
    if (locked.value) return;
    const answer = await ElMessageBox.prompt("为素材起一个方便查找的名称", "收藏到素材库", { inputValue: item.prompt.slice(0, 80), inputValidator: value => !!value?.trim() && value.trim().length <= 200 || "请输入 1–200 字的名称", confirmButtonText: "收藏", cancelButtonText: "取消" }).catch(() => undefined);
    if (!answer) return;
    const directorySnapshot = directory.value;
    saving.value = true;
    const target = `material${crypto.randomUUID()}${item.path.match(/\.[a-z0-9]+$/i)?.[0] ?? ""}`;
    let uploaded = false;
    try {
      const bytes = await useWorkspaceFiles(directorySnapshot).read(item.path);
      await axios.put("/api/assets/save", bytes, { params: { path: target }, headers: { "Content-Type": "application/octet-stream" } });
      uploaded = true;
      await axios.post("/api/assets/metadata", { path: target, title: answer.value.trim(), description: item.prompt.slice(0, 4000), category: { image: "图片", video: "视频", audio: "音频" }[item.mediaType], tags: ["生成作品"], source: item.model.slice(0, 1000) });
      ElMessage.success("已收藏，可在素材库按名称搜索和复用");
    } catch (cause) { ElMessage.error(`${message(cause, "收藏失败")}${uploaded ? `；原文件已收藏为 ${target}，可在素材库补充名称` : ""}`); }
    finally { saving.value = false; }
  }
  async function canLeave() {
    if (handingOff) return true;
    if (busy.value || saving.value || adding.value) { ElMessage.warning("请先等待当前保存或提交完成"); return false; }
    try {
      await historyQueue;
      do { scheduleDraft.cancel(); await saveDraft(); }
      while (draftDirty.value && !restoringDraft.value && !draftReadFailed.value && !disposed);
      return true;
    }
    catch { ElMessage.error("草稿未保存成功，请保留此页面并重试"); return false; }
  }
  onBeforeRouteLeave(canLeave); onBeforeRouteUpdate(canLeave);
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (draftDirty.value || draftError.value || busy.value || saving.value) { scheduleDraft.flush(); event.preventDefault(); event.returnValue = ""; }
  };
  window.addEventListener("beforeunload", beforeUnload);
  watch(selectedModel, () => { if (restoringDraft.value || draftReadFailed.value || loadingModels.value || !model.value) return; imageSize.value = ""; imagePreset.value = "auto"; quality.value = ""; ratio.value = ""; videoMode.value = ""; duration.value = undefined; resolution.value = ""; generateAudio.value = model.value.audio === true; }, { flush: "sync" });
  watch([model, restoringDraft], ([choice, restoring]) => {
    if (!choice || restoring || draftReadFailed.value) return;
    if (imageSize.value && !sizes.value.includes(imageSize.value)) imageSize.value = "";
    if (!imagePresets.value.some(item => item.value === imagePreset.value)) imagePreset.value = imageSize.value ? 'size:' + imageSize.value : "auto";
    if (ratio.value && !ratios.value.includes(ratio.value)) ratio.value = "";
    if (quality.value && !choice.imageQualities?.includes(quality.value as "low" | "medium" | "high")) quality.value = "";
    if (quantity.value > (choice.maxImageCount ?? 1) || quantity.value < 1) quantity.value = 1;
    if (voice.value && !choice.voices?.some(item => item.voice === voice.value)) voice.value = "";
    if (format.value && !choice.audioFormats?.includes(format.value)) format.value = "";
    if (choice.audioSpeedRange && (speed.value < choice.audioSpeedRange.min || speed.value > choice.audioSpeedRange.max)) speed.value = Math.min(choice.audioSpeedRange.max, Math.max(choice.audioSpeedRange.min, 1));
    if (videoMode.value && !videoModes.value.some(item => JSON.stringify(item) === videoMode.value)) videoMode.value = "";
    if (duration.value !== undefined && !durationOptions.value.includes(duration.value)) duration.value = undefined;
    if (resolution.value && !resolutionOptions.value.includes(resolution.value)) resolution.value = "";
    if (choice.audio !== "optional") generateAudio.value = choice.audio === true;
  }, { flush: "sync" });
  watch(duration, () => { if (!restoringDraft.value && !draftReadFailed.value && !resolutionOptions.value.includes(resolution.value)) resolution.value = ""; });
  watch([directory, kind], () => {
    taskCenter.studioDirectory = directory.value;
    tasks.value = []; taskError.value = ""; taskWarnings.value = []; taskPage.value = 1; taskTotal.value = 0; hasRunningTasks.value = false; clearTimeout(taskTimer); taskController?.abort();
    void loadDraft(); void loadModels();
    const history = loadHistory(); const request = historyRequest;
    void history.then(() => { if (!disposed && request === historyRequest) return loadTasks(); });
  }, { immediate: true });
  watch(taskPage, () => void loadTasks());
  onBeforeUnmount(() => { scheduleDraft.cancel(); disposed = true; draftLoad++; historyRequest++; modelRequest++; clearTimeout(taskTimer); controller?.abort(); draftController?.abort(); historyController?.abort(); taskController?.abort(); releasePreviews(); clearReferences(); window.removeEventListener("beforeunload", beforeUnload); });
  return { openCostPanel: () => taskCenter.openCosts(directory.value), inputError, referenceLimits, transferVisible, transferDirectory, transferSource, openTransferTarget, cleanupReferences, taskWarnings, taskPage, taskPageCount, taskTotal, tasks, taskError, loadTasks, resumeTask, visibleResults, page, pageCount, draftDirty, draftError, restoringDraft, saveDraft, retryDraft, directory, prompt, model, selectedModel, modelKey, availableModels, loadingModels, modelError, loadModels, references, removeReference, addFiles, readClipboard, assets, loadingAssets, assetError, loadAssets, addAsset, results, selected, urls, previewErrors, loadingHistory, historyError, loadHistory, busy, locked, directoryLocked, saving, adding, error, progress, quantity, voice, speed, format, imagePreset, imagePresets, applyImagePreset, quality, width, height, alignSize, imageSize, ratio, sizes, ratios, duration, resolution, durationOptions, resolutionOptions, generateAudio, videoMode, videoModes, applyRatio, generate, cancel: () => controller?.abort(), removeSelected, download, resetDraft, sendToCanvas, collectResult };
}
