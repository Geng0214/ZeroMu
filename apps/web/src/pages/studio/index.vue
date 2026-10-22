<template>
  <main class="studioPage" :class="{ lightStudio, audioStudio: kind === 'audio' }">
    <appHeader :light="lightStudio" @settings="openSettings" />

    <div ref="studioBody" class="studioBody" :class="{ resizing: !!resizeState }" :style="{ '--sidebarWidth': sidebarWidth + 'px' }">
      <section id="studioComposer" class="studioComposer" :aria-label="title + '参数'">
        <fieldset :disabled="locked">
          <div class="composerHeading">
            <label for="studioPrompt">{{ promptLabel }}</label>
            <div class="promptUtilities">
              <button aria-label="粘贴提示词" title="粘贴文字" @click="readClipboard()"><icon-clipboard :size="16" /></button>
              <button aria-label="清空提示词" title="清空提示词" :disabled="!prompt" @click="prompt = ''"><icon-trash :size="16" /></button>
            </div>
          </div>
          <div class="composerPrompt"><textarea id="studioPrompt" ref="promptInput" v-model="prompt" aria-label="创作提示词" :placeholder="promptPlaceholder" maxlength="100000" /></div>
          <div class="composerTools">
            <el-popover v-model:visible="referenceMenuVisible" trigger="click" placement="top-start" :width="244" :disabled="locked" role="dialog" popperClass="studioReferencePopover">
              <template #reference><button aria-label="添加参考素材" :disabled="!referenceGroups.length" :title="referenceGroups.length ? undefined : '当前模型或模式未声明参考能力'" :aria-expanded="referenceMenuVisible"><icon-plus :size="16" />参考素材<span v-if="references.length">{{ references.length }}</span></button></template>
              <div class="composerReferenceMenu">
                <label v-if="kind === 'video'" class="referenceType">素材类型<select v-model="referenceKind" aria-label="参考素材类型"><option v-for="group in referenceGroups" :key="group.kind" :value="group.kind">{{ group.title }}</option></select></label>
                <label class="referenceUpload"><icon-plus :size="16" />从电脑上传<input type="file" :aria-label="'快捷上传' + activeReferenceGroup.title" :accept="referenceKind + '/*'" :disabled="locked" multiple @change="onUpload($event, referenceKind); referenceMenuVisible = false" /></label>
                <button :disabled="locked" aria-label="粘贴参考素材" @click="readClipboard(referenceKind); referenceMenuVisible = false"><icon-clipboard :size="16" />从剪贴板粘贴</button>
                <button :disabled="locked" aria-label="打开素材库" @click="openAssets(referenceKind); referenceMenuVisible = false"><icon-folder-plus :size="16" />从素材库选择</button>
                <p>{{ referenceLimitHint }}</p>
              </div>
            </el-popover>
            <button aria-label="打开提示词库" @click="promptLibraryVisible = true"><icon-book :size="16" />提示词库</button>
            <button v-if="kind === 'audio'" class="canvasContinue" :disabled="!prompt.trim()" title="新建画布，带入朗读文本与声音参数" @click="sendToCanvas()"><icon-layout-grid :size="16" />在画布中继续</button>
          </div>
          <p v-if="references.length" class="referenceHint">{{ referenceLimitHint }}</p>
          <div v-if="references.length" class="composerReferences" aria-label="已添加的参考素材">
            <div v-for="(item, index) in references" :key="item.id" class="referenceItem">
              <img v-if="item.kind === 'image'" :src="item.url" :alt="item.name" />
              <video v-else-if="item.kind === 'video'" :src="item.url" controls preload="metadata" />
              <audio v-else :src="item.url" controls preload="metadata" />
              <div><span :title="item.name">{{ index + 1 }}. {{ item.name }}</span><button :aria-label="'移除 ' + item.name" @click="removeReference(item.id)"><icon-x :size="14" /></button></div>
            </div>
          </div>
          <div class="composerFields" :class="{ imageFields: kind === 'image' }">
            <div class="composerModel">
              <div class="modelHeading"><label for="studioModel">模型</label><div class="modelTools"><button :disabled="loadingModels" aria-label="刷新模型" title="刷新模型" @click="loadModels(true)"><icon-refresh :size="14" /></button><button aria-label="模型渠道" title="管理模型渠道" @click="openSettings('mediaChannel')"><icon-adjustments-horizontal :size="14" /></button></div></div>
              <div class="modelControl"><icon-cpu :size="16" /><select id="studioModel" v-model="selectedModel" aria-label="生成模型" :disabled="loadingModels || !availableModels.length"><option value="">{{ loadingModels ? '读取中…' : !availableModels.length ? '尚未配置模型' : '选择模型' }}</option><option v-for="item in availableModels" :key="modelKey(item)" :value="modelKey(item)">{{ item.label }}</option></select></div>
            </div>
            <template v-if="kind === 'image'">
              <label>尺寸<select :value="imagePreset" aria-label="图片尺寸" :disabled="!sizes.length && !model?.imageSizeRange" title="只显示模型已声明的尺寸；其他情况使用渠道默认" @change="applyImagePreset(($event.target as HTMLSelectElement).value)"><option v-for="preset in imagePresets" :key="preset.value" :value="preset.value">{{ preset.label }}</option></select></label>
              <label>宽高比<select v-model="ratio" aria-label="图片宽高比" :disabled="!ratios.length" title="只显示模型已声明的宽高比"><option value="">渠道默认</option><option v-for="value in ratios" :key="value" :value="value">{{ value }}</option></select></label>
              <label>质量<select v-model="quality" aria-label="图片质量" :disabled="!model?.imageQualities?.length"><option v-for="item in qualities" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
              <label>数量<input v-model.number="quantity" aria-label="生成张数" type="number" min="1" :max="model?.maxImageCount ?? 1" /></label>
            </template>
            <template v-else-if="kind === 'video'">
              <label>宽高比<select v-model="ratio" aria-label="视频宽高比" :disabled="!ratios.length"><option value="">渠道默认</option><option v-for="value in ratios" :key="value" :value="value">{{ value }}</option></select></label>
              <label>时长（秒）<select v-model="duration" aria-label="视频时长" :disabled="!durationOptions.length" :title="durationOptions.length ? undefined : '渠道未声明可调整时长，使用默认值'"><option :value="undefined">渠道默认</option><option v-for="value in durationOptions" :key="value" :value="value">{{ value }} 秒</option></select></label>
              <label>分辨率<select v-model="resolution" aria-label="视频分辨率" :disabled="!resolutionOptions.length" :title="resolutionOptions.length ? undefined : '渠道未声明可调整分辨率，使用默认值'"><option value="">渠道默认</option><option v-for="value in resolutionOptions" :key="value" :value="value">{{ value }}</option></select></label>
              <label>生成模式<select v-model="videoMode" aria-label="视频生成模式" :disabled="!videoModes.length"><option value="">模型默认</option><option v-for="mode in videoModes" :key="JSON.stringify(mode)" :value="JSON.stringify(mode)">{{ modeLabel(mode) }}</option></select></label>
            </template>
            <template v-else>
              <label>音色<select v-model="voice" aria-label="音色" :disabled="!model?.voices?.length"><option value="">{{ model?.voices?.length ? '请选择音色' : '渠道默认' }}</option><option v-for="item in model?.voices ?? []" :key="item.voice" :value="item.voice">{{ item.title }}</option></select></label>
              <label>格式<select v-model="format" aria-label="音频格式" :disabled="!audioFormats.length"><option value="">渠道默认</option><option v-for="value in audioFormats" :key="value" :value="value">{{ value.toUpperCase() }}</option></select></label>
              <label>语速<input v-if="model?.audioSpeedRange" v-model.number="speed" aria-label="语速" type="number" :min="model.audioSpeedRange.min" :max="model.audioSpeedRange.max" step="0.05" /><input v-else aria-label="语速" value="渠道默认" disabled /></label>
            </template>
            <button v-if="hasExtraFields" class="moreParameters" :aria-label="extraFieldsVisible ? '收起参数' : '更多参数'" :aria-expanded="extraFieldsVisible" aria-controls="studioExtraFields" @click="extraFieldsVisible = !extraFieldsVisible">{{ extraFieldsVisible ? '收起参数' : '更多参数' }}<span v-if="kind === 'image' && !imagePreset" class="customSizeSummary">{{ imageSize || width + ' × ' + height }}</span><icon-chevron-down :size="14" :class="{ expanded: extraFieldsVisible }" /></button>
          </div>
          <div v-if="hasExtraFields && extraFieldsVisible" id="studioExtraFields" class="extraFields" role="group" aria-label="更多生成参数">
            <template v-if="kind === 'image'">
              <template v-if="model?.imageSizeRange">
                <p class="referenceHint">自定义宽高须为 {{ model.imageSizeRange.min }}–{{ model.imageSizeRange.max }} 像素，且为 {{ model.imageSizeRange.step }} 的倍数。在尺寸中选择“自定义宽高”后调整。</p>
                <label>宽度（px）<input v-model.number="width" type="number" :min="model.imageSizeRange.min" :max="model.imageSizeRange.max" :step="model.imageSizeRange.step" aria-label="图片宽度" :disabled="imagePreset !== 'custom'" /></label>
                <label>高度（px）<input v-model.number="height" type="number" :min="model.imageSizeRange.min" :max="model.imageSizeRange.max" :step="model.imageSizeRange.step" aria-label="图片高度" :disabled="imagePreset !== 'custom'" /></label>
              </template>
            </template>
            <template v-else-if="kind === 'video'">
              <label v-if="model?.audio === 'optional'" class="inlineCheck"><input v-model="generateAudio" type="checkbox" />同时生成声音</label>
            </template>
          </div>
          <p v-if="kind === 'video' && videoMode && !videoMode.startsWith('[') && videoMode !== '&quot;text&quot;'" class="referenceHint">{{ videoMode === '&quot;singleImage&quot;' ? '单图模式需要一张图片参考。' : videoMode === '&quot;startFrameOptional&quot;' ? '仅一张图片时用作尾帧；两张图片按顺序用作首帧、尾帧。' : '图片按顺序用作首帧、尾帧；请按所选模式添加参考。' }}</p>
          <p v-if="model" class="referenceHint">可调整项来自模型能力声明，未声明项使用渠道默认。保存配置或获取列表不代表已完成真实生成。</p>

        </fieldset>
        <div class="composerFooter">
          <div class="workspaceRow"><span>保存到</span><workspacePicker ref="saveLocationPicker" v-model="directory" :disabled="directoryLocked" /><el-button size="small" text :disabled="!directory || locked" @click="openCostPanel">费用与预算</el-button></div>
          <p class="draftStatus" :class="{ draftFailed: draftError }" :role="draftError ? 'alert' : 'status'" :title="directory ? '草稿和参考文件保存在当前项目' : '未选保存位置的草稿保存在应用数据中'">{{ restoringDraft ? '恢复草稿中…' : draftError || (draftDirty ? '保存草稿中…' : '草稿已保存') }}<button v-if="draftError" @click="retryDraft().catch(() => {})">重试</button></p>
          <p v-if="inputError" class="generationIssue" role="alert">{{ inputError }}</p>
          <button v-if="busy" class="composerCancel" @click="cancel"><icon-player-stop :size="16" />取消等待</button>
          <button v-else class="composerGenerate" :disabled="primaryActionDisabled" :title="inputError || (model && directory && !prompt.trim() ? '填写提示词后即可生成' : undefined)" @click="runPrimaryAction"><icon-sparkles :size="17" />{{ primaryActionLabel }}<icon-arrow-right :size="16" /></button>
        </div>
      </section>
      <div class="studioDivider" role="separator" aria-label="调整创作栏宽度" aria-orientation="vertical" aria-controls="studioComposer" :aria-valuemin="280" :aria-valuemax="maxSidebarWidth" :aria-valuenow="sidebarWidth" :aria-valuetext="sidebarWidth + ' 像素'" tabindex="0" title="拖动调整宽度，双击恢复默认"
        @pointerdown="startResize" @pointermove="moveResize" @pointerup="stopResize" @pointercancel="stopResize" @lostpointercapture="stopResize" @keydown="resizeWithKeyboard" @dblclick="resetSidebarWidth"><span></span></div>
      <section class="resultPanel" aria-label="生成结果">
        <div class="resultHeading"><h2><icon-history :size="18" />全部结果 <span class="countBadge">{{ results.length }}</span></h2><div class="resultTools"><div class="segmented"><button :aria-pressed="!grouped" @click="grouped = false">全部展示</button><button :aria-pressed="grouped" @click="grouped = true">按日期分组</button></div><button :disabled="locked" @click="newCreation"><icon-plus :size="14" />新建</button><button v-if="results.length" :disabled="locked" @click="selected = selected.length === results.length ? [] : results.map(item => item.id)"><icon-checkbox :size="14" />{{ selected.length && selected.length === results.length ? '取消全选' : '全选' }}</button><button v-if="results.length" :disabled="!selected.length || locked" title="移除记录，保留原文件" @click="removeSelected"><icon-trash :size="14" />移除{{ selected.length ? ` (${selected.length})` : '' }}</button></div></div>
        <div v-if="modelError" class="statusMessage errorMessage" role="alert">{{ modelError }}<button @click="loadModels(true)">重试</button></div>
        <div v-if="error" class="statusMessage errorMessage" role="alert">{{ error }}</div>
        <div v-if="taskError" class="statusMessage errorMessage" role="alert">{{ taskError }}<button @click="loadTasks">刷新任务</button></div>
        <div v-for="warning in taskWarnings" :key="warning" class="statusMessage" role="status">{{ warning }}</div>
        <div v-if="directory" class="statusMessage"><button :disabled="locked" @click="cleanupReferences">清理未引用参考缓存</button></div>
        <div v-if="taskPageCount > 1" class="statusMessage" aria-label="任务分页"><button :disabled="locked || taskPage <= 1" @click="taskPage--">较新任务</button><span>{{ taskPage }} / {{ taskPageCount }} · 共 {{ taskTotal }} 个任务</span><button :disabled="locked || taskPage >= taskPageCount" @click="taskPage++">较早任务</button></div>
        <div v-for="task in tasks.filter(task => task.status !== 'completed')" :key="task.id" class="statusMessage" :class="{ taskRecord: !isActiveTask(task) }" role="status">
          <span>{{ isActiveTask(task) ? '任务进行中，刷新或离开后仍可查看' : taskRecordLabel(task) + (task.error ? ' · ' + task.error : '') }} · {{ task.request.prompt.slice(0, 36) }}{{ task.providerTaskId ? ' · 渠道任务 ' + task.providerTaskId : '' }}</span>
          <button v-if="!isActiveTask(task)" @click="taskCenter.open({ directory: task.directory, id: task.id })">查看此任务</button>
          <button v-if="task.canResume && !isActiveTask(task)" :disabled="locked" @click="resumeTask(task)">{{ task.canCancel ? '继续排队' : task.results.length ? '仅重试未完成结果' : '继续查询／下载' }}</button>
        </div>
        <div v-if="historyError" class="statusMessage errorMessage" role="alert">{{ historyError }}<button :disabled="loadingHistory" @click="loadHistory">重试读取</button></div>
        <div v-if="busy" class="statusMessage" role="status"><span class="loadingDot"></span>{{ progress }}<span>结果返回后会自动保存在当前项目</span></div>
        <div v-if="loadingHistory" class="emptyResults" role="status"><icon-refresh :size="32" /><p>正在读取项目结果…</p></div>
        <div v-else-if="!results.length && !busy" class="emptyResults"><component :is="kind === 'image' ? IconPhotoPlus : kind === 'video' ? IconVideo : IconMusic" :size="36" stroke="1.5" /><p>还没有生成{{ mediaLabel }}</p><span>{{ kind === 'audio' ? '写下旁白或对白，选择音色，开始语音创作。' : '写下你的想法，选择模型，生成的作品会显示在这里。' }}</span></div>
        <div v-else class="resultScroll">
          <section v-for="group in resultGroups" :key="group.label" class="resultGroup"><h3 v-if="grouped">{{ group.label }}</h3><div class="resultGrid" :class="{ audioResults: kind === 'audio' }"><article v-for="item in group.items" :key="item.id" class="resultCard" :class="{ selectedResult: selected.includes(item.id) }">
            <div class="resultMedia"><p v-if="previewErrors[item.id]" class="mediaError">文件不可用或无法预览</p><template v-else-if="urls[item.id]"><button v-if="kind === 'image'" class="imagePreview" :aria-label="'预览 ' + item.prompt" @click="previewUrl = urls[item.id]"><img loading="lazy" :src="urls[item.id]" :alt="item.prompt" @error="previewErrors[item.id] = true" /></button><video v-else-if="kind === 'video'" :src="urls[item.id]" controls playsinline preload="none" @error="previewErrors[item.id] = true" /><div v-else class="audioPreview"><icon-music :size="24" stroke="1.5" /><audio :src="urls[item.id]" controls preload="none" @error="previewErrors[item.id] = true" /></div></template><span v-else>正在加载预览…</span><label class="resultSelection"><input v-model="selected" type="checkbox" :value="item.id" :disabled="locked" :aria-label="'选择结果 ' + item.prompt" /></label></div>
            <div class="resultInfo">
              <p :title="item.prompt">{{ item.prompt }}</p>
              <div class="resultMeta"><span :title="item.model">{{ item.model }}</span><time>{{ new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</time></div>
              <div class="resultActions"><button :disabled="locked" @click="reusePrompt(item.prompt)">复用提示词</button><button class="iconAction" :aria-label="'下载 ' + item.path.split('/').at(-1)" title="下载" @click="download(item)"><icon-download :size="16" /></button>
                <el-dropdown trigger="click" placement="bottom-end"><button class="iconAction" aria-label="更多结果操作" title="更多操作"><icon-dots :size="16" /></button><template #dropdown><el-dropdown-menu><el-dropdown-item :disabled="locked" @click="sendToCanvas(item)">发送到画布</el-dropdown-item><el-dropdown-item :disabled="locked" @click="collectResult(item)">收藏到素材库</el-dropdown-item></el-dropdown-menu></template></el-dropdown>
              </div>
            </div>
          </article></div></section>
          <nav v-if="pageCount > 1" class="resultPagination" aria-label="结果分页"><button :disabled="page === 1" @click="page--">上一页</button><span>{{ page }} / {{ pageCount }}</span><button :disabled="page >= pageCount" @click="page++">下一页</button></nav>
        </div>
      </section>
    </div>
    <settings v-model="settingsVisible" :initialPanel="settingsPanel" />
    <transferDialog v-model="transferVisible" :directory="transferDirectory" :source="transferSource" :openTarget="openTransferTarget" @busyChange="saving = $event" />
    <el-image-viewer v-if="previewUrl" :urlList="[previewUrl]" teleported @close="previewUrl = ''" />
    <el-dialog v-model="promptLibraryVisible" title="提示词库" width="min(620px, 94vw)" appendToBody><div class="studioPromptLibrary"><button v-for="item in templates" :key="item.title" @click="usePrompt(item.text)"><strong>{{ item.title }}</strong><span>{{ item.text }}</span></button></div></el-dialog>
    <el-dialog v-model="assetsVisible" :title="'选择' + referenceGroups.find(item => item.kind === assetKind)?.title" width="min(780px, 94vw)" appendToBody><el-input v-model="assetQuery" aria-label="搜索素材名称或标签" placeholder="搜索素材名称或标签" clearable /><div class="studioAssetPicker"><p v-if="loadingAssets">正在读取素材…</p><p v-else-if="assetError" role="alert">{{ assetError }}<el-button @click="loadAssets">重试</el-button></p><p v-else-if="!filteredAssets.length">素材库中暂无此类媒体，可以从电脑上传。</p><button v-for="asset in filteredAssets" :key="asset.path" :disabled="adding" @click="addAsset(asset, assetKind)"><img v-if="assetKind === 'image'" :src="'/api/assets/read?path=' + encodeURIComponent(asset.path)" alt="" /><icon-video v-else-if="assetKind === 'video'" :size="30" /><icon-music v-else :size="30" /><span>{{ asset.metadata?.title || asset.name }}</span><small>添加为参考</small></button></div></el-dialog>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useRoute } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { IconCpu, IconLayoutGrid, IconPhotoPlus, IconVideo, IconMusic, IconBook, IconAdjustmentsHorizontal, IconClipboard, IconTrash, IconFolderPlus, IconX, IconRefresh, IconArrowRight, IconSparkles, IconPlayerStop, IconHistory, IconPlus, IconCheckbox, IconDownload, IconChevronDown, IconDots } from "@tabler/icons-vue";
import { creationPrompts } from "@/lib/promptTemplates";
import appHeader from "@/components/appHeader.vue";
import settings from "@/components/settings/index.vue";
import workspacePicker from "@/pages/home/workspacePicker.vue";
import transferDialog from "./transferDialog.vue";
import { settings as appSettings } from "@/stores/settings";
import useStudio, { type ReferenceKind, type StudioKind } from "./useStudio";
import type { MediaTaskRecord } from "@toonflow/tools-scaffold/runtime";
import { useTaskCenterStore } from "@/stores/taskCenter";

const route = useRoute();
const taskCenter = useTaskCenterStore();
function isActiveTask(task: MediaTaskRecord) { return ["queued", "submitting", "running", "downloading"].includes(task.status); }
function taskRecordLabel(task: MediaTaskRecord) {
  const labels: Partial<Record<MediaTaskRecord["status"], string>> = { failed: "失败", partial: "部分完成", cancelled: "已取消", unknown: "提交结果待核对", interrupted: "已中断" };
  return `任务记录 · ${labels[task.status] || "待恢复"} · 创建于 ${new Date(task.createdAt).toLocaleString("zh-CN", { hour12: false })}`;
}
const kind = computed<StudioKind>(() => route.params.kind === "video" ? "video" : route.params.kind === "audio" ? "audio" : "image");
const title = computed(() => ({ image: "生图创作", video: "视频创作", audio: "音频创作" }[kind.value]));
const mediaLabel = computed(() => ({ image: "图片", video: "视频", audio: "音频" }[kind.value]));
const promptLabel = computed(() => ({ image: "画面描述", video: "镜头描述", audio: "朗读文本" }[kind.value]));
const promptPlaceholder = computed(() => ({ image: "描述主体、场景与画面风格…", video: "描述镜头运动、主体动作与场景氛围…", audio: "输入要朗读的旁白或对白…" }[kind.value]));
const audioFormats = computed(() => model.value?.audioFormats ?? []);
const { openCostPanel, inputError, referenceLimits, transferVisible, transferDirectory, transferSource, openTransferTarget, saving, directory, prompt, model, selectedModel, modelKey, availableModels, loadingModels, modelError, loadModels, references, removeReference, addFiles, readClipboard, assets, loadingAssets, assetError, loadAssets, addAsset, results, selected, urls, previewErrors, loadingHistory, historyError, loadHistory, busy, locked, directoryLocked, adding, error, progress, quantity, voice, speed, format, imagePreset, imagePresets, applyImagePreset, quality, width, height, alignSize, imageSize, ratio, sizes, ratios, duration, resolution, durationOptions, resolutionOptions, generateAudio, videoMode, videoModes, generate, cancel, removeSelected, download, resetDraft, sendToCanvas, collectResult, cleanupReferences, taskWarnings, taskPage, taskPageCount, taskTotal, tasks, taskError, loadTasks, resumeTask, visibleResults, page, pageCount, draftDirty, draftError, restoringDraft, saveDraft, retryDraft } = useStudio(kind);
const studioBody = ref<HTMLElement>();
const availableWidth = ref(window.innerWidth);
const preferredWidth = ref(360);
try {
  const saved = Number(localStorage.getItem("zeromu.studioSidebarWidth"));
  if (Number.isFinite(saved) && saved >= 280) preferredWidth.value = saved;
} catch { /* 浏览器禁止存储时，仍可在当前页面调整宽度。 */ }
const maxSidebarWidth = computed(() => Math.max(280, Math.min(720, availableWidth.value - 332)));
const sidebarWidth = computed(() => Math.max(280, Math.min(preferredWidth.value, maxSidebarWidth.value)));
const resizeState = shallowRef<{ element: HTMLElement; pointerId: number; x: number; width: number }>();
const bodyObserver = new ResizeObserver(entries => { availableWidth.value = entries[0]!.contentRect.width; });
onMounted(() => {
  if (studioBody.value) { availableWidth.value = studioBody.value.clientWidth; bodyObserver.observe(studioBody.value); }
});
onBeforeUnmount(() => { stopResize(); bodyObserver.disconnect(); });
function setSidebarWidth(value: number) {
  preferredWidth.value = Math.round(Math.max(280, Math.min(value, maxSidebarWidth.value)));
}
function rememberSidebarWidth() {
  try { localStorage.setItem("zeromu.studioSidebarWidth", String(preferredWidth.value)); } catch { /* 保留当前页面宽度。 */ }
}
function startResize(event: PointerEvent) {
  if (event.button !== 0 || resizeState.value) return;
  event.preventDefault();
  const element = event.currentTarget as HTMLElement;
  element.setPointerCapture(event.pointerId);
  resizeState.value = { element, pointerId: event.pointerId, x: event.clientX, width: sidebarWidth.value };
}
function moveResize(event: PointerEvent) {
  const current = resizeState.value;
  if (current?.pointerId === event.pointerId) setSidebarWidth(current.width + event.clientX - current.x);
}
function stopResize(event?: PointerEvent) {
  const current = resizeState.value;
  if (!current || event && current.pointerId !== event.pointerId) return;
  resizeState.value = undefined;
  if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
  rememberSidebarWidth();
}
function resizeWithKeyboard(event: KeyboardEvent) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  setSidebarWidth(event.key === "Home" ? 280 : event.key === "End" ? maxSidebarWidth.value : sidebarWidth.value + (event.key === "ArrowLeft" ? -16 : 16));
  rememberSidebarWidth();
}
function resetSidebarWidth() { setSidebarWidth(360); rememberSidebarWidth(); }
const referenceMenuVisible = ref(false);
const extraFieldsVisible = ref(false);
const hasExtraFields = computed(() => kind.value === "image" ? !!model.value?.imageSizeRange : kind.value === "video" && model.value?.audio === "optional");
watch(imagePreset, value => { if (value === "custom") extraFieldsVisible.value = true; });
const primaryActionLabel = computed(() => tasks.value.some(task => ["queued", "submitting", "running", "downloading"].includes(task.status)) ? "任务生成中…" : loadingModels.value ? "读取模型中…" : !directory.value ? "选择保存位置" : !availableModels.value.length ? "配置 API" : !model.value ? "请选择模型" : `生成${mediaLabel.value}`);
const primaryActionDisabled = computed(() => tasks.value.some(task => ["queued", "submitting", "running", "downloading"].includes(task.status)) || !!taskError.value || locked.value || loadingModels.value || (!!directory.value && !!availableModels.value.length && !model.value) || (!!model.value && !!directory.value && (!prompt.value.trim() || !!historyError.value || !!inputError.value)));
function runPrimaryAction() {
  if (!directory.value) void saveLocationPicker.value?.chooseDirectory();
  else if (!availableModels.value.length) openSettings("mediaChannel");
  else void generate();
}
const saveLocationPicker = ref<InstanceType<typeof workspacePicker>>();
const promptInput = ref<HTMLTextAreaElement>();
const grouped = ref(false);
const settingsVisible = ref(false);
const settingsPanel = ref("mediaChannel");
const promptLibraryVisible = ref(false);
const assetsVisible = ref(false);
const assetKind = ref<ReferenceKind>("image");
const previewUrl = ref("");
const lightStudio = computed(() => appSettings.value.homeTheme === "light");
const qualities = computed(() => [{ label: "渠道默认", value: "" }, ...(model.value?.imageQualities ?? []).map(value => ({ value, label: ({ high: "高", medium: "中", low: "低" })[value] }))]);
const referenceGroups = computed<{ kind: ReferenceKind; title: string; limit: number | undefined }[]>(() => ([{ kind: "image", title: "参考图", limit: referenceLimits.value.image }, { kind: "video", title: "参考视频", limit: referenceLimits.value.video }, { kind: "audio", title: "参考音频", limit: referenceLimits.value.audio }] as const).filter(group => group.limit !== 0));
const referenceKind = ref<ReferenceKind>(kind.value === "audio" ? "audio" : "image");
const activeReferenceGroup = computed(() => referenceGroups.value.find(group => group.kind === referenceKind.value) ?? { kind: referenceKind.value, title: "参考素材", limit: 0 });
const referenceLimitHint = computed(() => !referenceGroups.value.length ? "当前模型或模式未声明参考能力；已有素材保留，生成前请更换模式或移除不兼容参考。" : activeReferenceGroup.value.limit === undefined ? "模型声明允许此类参考，未提供数量上限；应用单次每类最多 64 个。" : '本次最多添加 ' + Math.min(activeReferenceGroup.value.limit, 64) + ' 个' + activeReferenceGroup.value.title + (referenceKind.value === "audio" ? "，单个 15 MB 内。" : "。"));
watch(referenceGroups, groups => { if (!groups.some(group => group.kind === referenceKind.value)) referenceKind.value = groups[0]?.kind ?? (kind.value === "audio" ? "audio" : "image"); }, { immediate: true });
watch(kind, value => { referenceKind.value = value === "audio" ? "audio" : "image"; referenceMenuVisible.value = false; extraFieldsVisible.value = false; });
watch(locked, value => { if (value) referenceMenuVisible.value = false; });
const assetQuery = ref("");
const filteredAssets = computed(() => assets.value.filter(item => [item.name, item.metadata?.title, item.metadata?.category, ...(item.metadata?.tags ?? [])].join(" ").toLocaleLowerCase().includes(assetQuery.value.trim().toLocaleLowerCase()) && ({ image: /\.(png|jpe?g|webp|gif|avif|bmp)$/i, video: /\.(mp4|webm|mov|ogv)$/i, audio: /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i }[assetKind.value]).test(item.name)));
const templates = computed(() => creationPrompts.filter(item => item.mode === kind.value));
const resultGroups = computed(() => {
  if (!grouped.value) return [{ label: "全部", items: visibleResults.value }];
  const groups = new Map<string, typeof results.value>();
  for (const item of visibleResults.value) { const date = new Date(item.createdAt).toLocaleDateString("zh-CN"); groups.set(date, [...(groups.get(date) ?? []), item]); }
  return [...groups].map(([label, items]) => ({ label, items }));
});
function openSettings(panel: string) { settingsPanel.value = panel; settingsVisible.value = true; }
function onUpload(event: Event, referenceKind: ReferenceKind) { const input = event.target as HTMLInputElement; addFiles(Array.from(input.files ?? []).map(file => ({ name: file.name, blob: file })), referenceKind); input.value = ""; }
function openAssets(referenceKind: ReferenceKind) { if (locked.value) return; assetKind.value = referenceKind; assetsVisible.value = true; void loadAssets(); }
function modeLabel(value: unknown) { return Array.isArray(value) ? "多模态参考" : ({ text: "文生视频", singleImage: "单图生视频", startEndRequired: "首尾帧", endFrameOptional: "首帧（尾帧可选）", startFrameOptional: "尾帧（首帧可选）" }[String(value)] ?? String(value)); }
async function reusePrompt(text: string) {
  if (locked.value) return;
  if (prompt.value.trim() && prompt.value !== text && !await ElMessageBox.confirm("替换当前提示词草稿？", "使用提示词", { confirmButtonText: "替换", cancelButtonText: "保留" }).then(() => true, () => false)) return;
  prompt.value = text; await nextTick(); promptInput.value?.focus();
}
async function usePrompt(text: string) { await reusePrompt(text); promptLibraryVisible.value = false; }
async function newCreation() {
  if ((prompt.value.trim() || references.value.length) && !await ElMessageBox.confirm("清空当前提示词和参考素材，开始新的创作？已生成结果会保留。", "新建创作", { confirmButtonText: "新建", cancelButtonText: "取消" }).then(() => true, () => false)) return;
  resetDraft(); promptInput.value?.focus();
}
watch(settingsVisible, visible => { if (!visible) void loadModels(); });
watch(() => route.query.prompt, value => { if (typeof value === "string") prompt.value = value; }, { immediate: true });
</script>

<style scoped lang="scss">
.studioPage {
  --studioBg: #101111; --studioPanel: #191b1a; --studioField: #121413; --studioRaised: #272b28; --studioLine: #343a36; --studioText: #efefea; --studioMuted: #a6afa8; --studioAccent: #b6dec9; --studioError: #f2b1a5;
  --el-text-color-primary: var(--studioText); --el-text-color-regular: var(--studioMuted); --el-fill-color-blank: var(--studioPanel); --el-fill-color-light: var(--studioRaised); --el-border-color: var(--studioLine);
  color: var(--studioText); background: var(--studioBg); height: 100vh; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; font-size: 13px; color-scheme: dark;
  &.lightStudio { --studioBg: #f4f5f0; --studioPanel: #fff; --studioField: #f5f6f2; --studioRaised: #e9ede6; --studioLine: #d2d8ce; --studioText: #232b24; --studioMuted: #59675a; --studioAccent: #23644d; --studioError: #9d3324; color-scheme: light; }
  *,*::before,*::after { box-sizing: border-box; }
  h1,h2,h3,p { margin: 0; }
  button,input,select,textarea { font: inherit; }
  button,a { -webkit-tap-highlight-color: transparent; }
  button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 32px; background: transparent; color: inherit; border: 1px solid var(--studioLine); border-radius: var(--ui-radius, 8px); padding: 6px 10px; line-height: 1.3; cursor: pointer; &:hover:not(:disabled) { background: var(--studioRaised); } &:disabled { opacity: .4; cursor: not-allowed; } }
  button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible { outline: 2px solid var(--studioAccent); outline-offset: 3px; }
  ::selection { background: var(--studioAccent); color: var(--studioBg); }
  .studioBody { flex: 1; min-height: 0; min-width: 0; display: grid; grid-template-columns: var(--sidebarWidth) 12px minmax(0,1fr); grid-template-rows: minmax(0,1fr); &.resizing { cursor: col-resize; user-select: none; .resultPanel { pointer-events: none; } } }
  .studioDivider { grid-column: 2; grid-row: 1; position: relative; display: grid; place-items: center; cursor: col-resize; touch-action: none; outline: none;
    &::before { content: ''; position: absolute; inset: 0 auto; width: 1px; background: var(--studioLine); }
    span { z-index: 1; width: 3px; height: 36px; border-radius: 2px; background: var(--studioMuted); opacity: .5; }
    &:hover,&:focus-visible { background: var(--studioRaised); span { background: var(--studioAccent); opacity: 1; } }
  }
  .resizing .studioDivider { background: var(--studioRaised); span { background: var(--studioAccent); opacity: 1; } }
  .resultPanel { grid-column: 3; grid-row: 1; padding: 24px; display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; }
  .resultHeading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding-bottom: 20px; flex-shrink: 0; h2 { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 550; white-space: nowrap; svg { color: var(--studioMuted); } } }
  .resultTools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; button { font-size: 12px; } }
  .segmented { display: inline-flex; gap: 2px; background: var(--studioPanel); border: 1px solid var(--studioLine); border-radius: var(--ui-radius, 8px); padding: 2px; button { border: 0; min-height: 28px; padding: 4px 8px; white-space: nowrap; color: var(--studioMuted); &[aria-pressed=true] { background: var(--studioRaised); color: var(--studioText); } } }
  .countBadge { font-size: 12px; color: var(--studioMuted); font-weight: 400; font-variant-numeric: tabular-nums; }
  .emptyResults { min-height: 0; overflow: auto; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 32px 16px; color: var(--studioMuted); text-align: center; >svg { margin-bottom: 4px; } p { color: var(--studioText); font-size: 16px; } >span { font-size: 13px; line-height: 1.8; max-width: 30em; } }
  .generationIssue { margin: 0; color: var(--el-color-danger); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
  .statusMessage { padding: 12px; border: 1px solid var(--studioLine); border-radius: var(--ui-radius, 8px); margin-bottom: 12px; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; line-height: 1.7; flex-shrink: 0; overflow-wrap: anywhere; span:last-child { margin-left: auto; font-size: 12px; color: var(--studioMuted); } }
  .taskRecord { >span { flex: 1; min-width: 0; font-size: 13px; color: var(--studioText); } @media (max-width: 600px) { >span { flex-basis: 100%; } >button { min-height: 44px; } } }
  .errorMessage,.fieldError { color: var(--studioError); } .fieldError { font-size: 12px; line-height: 1.6; margin-top: 8px; }
  .loadingDot { width: 8px; height: 8px; border-radius: 50%; background: var(--studioAccent); animation: pendingPulse 1.4s ease-in-out infinite; }
  .resultScroll { overflow: auto; min-height: 0; flex: 1; scrollbar-width: thin; scrollbar-color: var(--studioLine) transparent; padding: 2px; }
  .resultGroup h3 { color: var(--studioMuted); font-size: 12px; font-weight: 400; margin: 8px 0 16px; }
  .resultGrid { display: grid; grid-template-columns: repeat(auto-fill,minmax(min(260px,100%),1fr)); align-items: start; gap: 20px; padding-bottom: 20px; }
  .resultCard { background: var(--studioPanel); border: 1px solid var(--studioLine); border-radius: var(--ui-radius-large, 12px); overflow: hidden; min-width: 0; &:hover { border-color: var(--studioMuted); } &.selectedResult { border-color: var(--studioAccent); } }
  .resultMedia { aspect-ratio: 16 / 10; min-width: 0; position: relative; background: var(--studioField); display: grid; place-items: center; color: var(--studioMuted);
    video { width: 100%; height: 100%; position: absolute; inset: 0; }
    .imagePreview { position: absolute; inset: 0; display: block; padding: 0; border: 0; border-radius: 0; width: 100%; height: 100%; img { display: block; width: 100%; height: 100%; object-fit: contain; } }
    .resultSelection { position: absolute; top: 12px; left: 12px; background: var(--studioPanel); padding: 6px; border: 1px solid var(--studioLine); border-radius: calc(var(--ui-radius, 8px) * 0.75); display: grid; place-items: center; input { width: 16px; height: 16px; margin: 0; } }
    .mediaError { padding: 20px; text-align: center; }
  }
  .resultInfo { padding: 16px; >p { line-height: 1.7; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; min-height: 3.4em; }
    .resultMeta { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 10px; font-size: 11px; line-height: 1.5; color: var(--studioMuted); >span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } time { font-variant-numeric: tabular-nums; } }
    .resultActions { display: flex; align-items: center; gap: 4px; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--studioLine); >button:first-child { margin-right: auto; padding-inline: 0; } button { border: 0; font-size: 12px; color: var(--studioMuted); &:hover { color: var(--studioText); } } .iconAction { width: 32px; padding: 6px; } }
  }
  .audioResults { grid-template-columns: repeat(auto-fill,minmax(min(320px,100%),1fr)); .resultMedia { aspect-ratio: auto; min-height: 100px; } .audioPreview { display: flex; align-items: center; gap: 12px; padding: 44px 16px 16px; width: 100%; >svg { flex-shrink: 0; } audio { width: 100%; min-width: 0; height: 36px; } } }
  .resultPagination { display: flex; align-items: center; justify-content: center; gap: 16px; padding: 16px; }
  textarea { display: block; width: 100%; background: var(--studioField); border: 1px solid var(--studioLine); border-radius: var(--ui-radius, 8px); color: var(--studioText); caret-color: var(--studioAccent); &::placeholder { color: var(--studioMuted); } }
  select,input:not([type=checkbox]):not([type=file]) { width: 100%; min-width: 0; height: 40px; padding: 8px; border: 1px solid var(--studioLine); border-radius: var(--ui-radius, 8px); background: var(--studioField); color: var(--studioText); }
  input[type=checkbox] { accent-color: var(--studioAccent); }
  .studioComposer { grid-column: 1; grid-row: 1; width: 100%; min-width: 0; min-height: 0; display: flex; flex-direction: column; padding: 20px 16px 16px; background: var(--studioPanel); container-type: inline-size;
    fieldset { border: 0; padding: 2px 4px 20px; margin: 0; min-width: 0; min-height: 0; overflow: auto; flex: 1 1 auto; scrollbar-width: thin; scrollbar-color: var(--studioLine) transparent; }
    .composerHeading { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 32px; margin-bottom: 8px; >label { font-size: 13px; font-weight: 550; } .promptUtilities { display: flex; gap: 4px; button { width: 32px; height: 32px; padding: 6px; border: 0; color: var(--studioMuted); } } }
    .composerPrompt textarea { height: 160px; min-height: 112px; resize: vertical; max-height: 360px; padding: 12px; font-size: 14px; line-height: 1.8; }
    .composerTools { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 8px; button { min-height: 36px; padding: 6px 8px; border: 0; color: var(--studioMuted); font-size: 12px; white-space: nowrap; } button:first-child { color: var(--studioText); } button span { font-variant-numeric: tabular-nums; } }
    .referenceHint { margin-top: 8px; color: var(--studioMuted); font-size: 11px; line-height: 1.6; }
    .composerReferences { display: flex; gap: 8px; overflow-x: auto; max-height: 128px; margin-top: 12px; padding-bottom: 4px; .referenceItem { flex: 0 0 128px; min-width: 0; img,video { width: 100%; height: 76px; object-fit: contain; border-radius: calc(var(--ui-radius, 8px) * 0.75); background: var(--studioField); } audio { width: 128px; height: 36px; } >div { display: flex; gap: 4px; align-items: center; span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; font-size: 11px; } button { padding: 4px; border: 0; } } } }
    .composerFields,.extraFields { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(6rem,100%),1fr)); gap: 16px 10px; margin-top: 20px; align-items: end; >label { display: grid; gap: 8px; color: var(--studioMuted); font-size: 12px; min-width: 0; select,input { font-size: 13px; text-overflow: ellipsis; } } .inlineCheck { grid-column: 1/-1; display: flex; align-items: center; gap: 8px; min-height: 36px; input { width: auto; height: auto; } } }
    .composerFields { &.imageFields { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .extraFields { grid-template-columns: repeat(2,minmax(0,1fr)); margin-top: 8px; padding: 16px 0 4px; border-top: 1px solid var(--studioLine); }
    .moreParameters { grid-column: 1/-1; justify-self: start; min-height: 36px; border: 0; padding: 8px 0; color: var(--studioMuted); font-size: 12px; svg { transition: transform 160ms ease-out; &.expanded { transform: rotate(180deg); } } }
    .customSizeSummary { font-variant-numeric: tabular-nums; color: var(--studioText); }
    .composerModel { grid-column: 1/-1; min-width: 0; }
    .modelHeading { min-height: 24px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; color: var(--studioMuted); font-size: 12px; .modelTools { display: flex; gap: 4px; button { width: 28px; min-height: 24px; padding: 4px; border: 0; } } }
    .modelControl { position: relative; height: 40px; display: flex; align-items: center; background: var(--studioField); border: 1px solid var(--studioLine); border-radius: var(--ui-radius, 8px); >svg { position: absolute; left: 12px; pointer-events: none; color: var(--studioMuted); } select { height: 100%; padding-left: 36px; border: 0; background: transparent; text-overflow: ellipsis; &:disabled { color: var(--studioMuted); opacity: 1; } } }
    .composerFooter { flex-shrink: 0; display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 12px 8px; padding: 16px 4px 0; border-top: 1px solid var(--studioLine);
      .workspaceRow { display: flex; align-items: center; min-width: 0; gap: 4px; color: var(--studioMuted); font-size: 12px; >span { white-space: nowrap; } :deep(.workspaceButton) { min-width: 0; max-width: calc(100% - 42px); color: var(--studioText); } }
      .draftStatus { color: var(--studioMuted); font-size: 11px; line-height: 1.6; &.draftFailed { grid-column: 1/-1; color: var(--studioError); overflow-wrap: anywhere; button { margin-left: 8px; } } }
    }
    .composerGenerate,.composerCancel { grid-column: 1/-1; width: 100%; min-height: 44px; padding: 12px; border: 0; border-radius: var(--ui-radius, 8px); background: var(--studioAccent); color: var(--studioBg); font-weight: 600; &:hover:not(:disabled) { background: var(--studioAccent); filter: brightness(.94); } &:disabled { background: var(--studioRaised); color: var(--studioMuted); opacity: .65; } }
  }
  @media (max-height: 740px) and (min-width: 721px) { .resultPanel { padding: 16px 20px; } .resultHeading { padding-bottom: 16px; } .studioComposer { padding-top: 12px; .composerPrompt textarea { height: 128px; } } }
  @media (max-height: 640px) and (min-width: 721px) { .studioComposer { .composerPrompt textarea { height: 112px; } .composerHeading { margin-bottom: 4px; } .composerFields { margin-top: 12px; gap: 12px 8px; } .modelHeading { margin-bottom: 4px; } fieldset { padding-bottom: 8px; } .composerFooter { padding-top: 12px; gap: 8px; } } }
  @media (max-width: 720px) {
    .studioBody { display: flex; flex-direction: column; overflow: auto; scrollbar-width: thin; scrollbar-color: var(--studioLine) transparent; }
    .studioDivider { display: none; }
    .studioComposer { flex: 0 0 auto; padding: 16px; fieldset { overflow: visible; flex: none; padding-bottom: 16px; } .composerPrompt textarea { height: 128px; } .composerHeading .promptUtilities button { width: 44px; height: 44px; } .composerTools button,.moreParameters { min-height: 44px; } }
    .resultPanel { flex: 1 0 auto; min-height: 340px; overflow: visible; padding: 24px 16px; border-top: 1px solid var(--studioLine); }
    .resultHeading { gap: 12px; }
    .resultTools { gap: 6px; button { min-height: 36px; } }
    .resultScroll { overflow: visible; }
    .resultGrid,.audioResults { grid-template-columns: minmax(0,1fr); }
    .resultInfo .resultActions button { min-height: 44px; }
  }
  @media (prefers-reduced-motion: reduce) { .loadingDot { animation: none; } .moreParameters svg { transition: none; } }
  @container (max-width: 330px) {
    .studioComposer .composerFooter { grid-template-columns: minmax(0,1fr); gap: 8px; .draftStatus { grid-row: 2; } }
  }
}
@keyframes pendingPulse { 50% { opacity: .3; } }
.studioPromptLibrary { display: grid; gap: 12px; button { cursor: pointer; text-align: left; border: 1px solid var(--el-border-color); border-radius: var(--ui-radius, 8px); background: var(--el-bg-color); color: var(--el-text-color-primary); padding: 16px; display: grid; gap: 8px; strong { font-size: 15px; } span { line-height: 1.8; font-size: 13px; } } }
.studioAssetPicker { display: grid; grid-template-columns: repeat(auto-fill,minmax(145px,1fr)); gap: 12px; >p { grid-column: 1/-1; } button { display: flex; flex-direction: column; gap: 8px; align-items: center; border: 1px solid var(--el-border-color); border-radius: var(--ui-radius, 8px); background: var(--el-bg-color); color: var(--el-text-color-primary); padding: 12px; cursor: pointer; min-width: 0; img { width: 100%; height: 100px; object-fit: contain; } span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } small { color: var(--el-text-color-secondary); } } }
.composerReferenceMenu { display: grid; gap: 4px; color: var(--el-text-color-primary);
  button,.referenceUpload { position: relative; display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 10px; border: 0; border-radius: calc(var(--ui-radius, 8px) * 0.75); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; &:hover { background: var(--el-fill-color-light); } &:focus-visible,&:focus-within { outline: 2px solid var(--el-color-primary); outline-offset: -2px; } }
  .referenceUpload { overflow: hidden; input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; } }
  .referenceType { display: grid; gap: 8px; padding: 4px 8px 10px; color: var(--el-text-color-regular); font-size: 12px; select { width: 100%; min-height: 36px; border: 1px solid var(--el-border-color); border-radius: calc(var(--ui-radius, 8px) * 0.75); padding: 6px 8px; background: var(--el-bg-color); color: var(--el-text-color-primary); } }
  p { margin: 6px 8px 2px; font-size: 12px; line-height: 1.6; color: var(--el-text-color-secondary); }
}
</style>
