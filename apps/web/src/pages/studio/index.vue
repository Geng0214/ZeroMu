<template>
  <libraryShell :settingsHandler="openSettings">
  <main class="studioPage" :class="{ audioStudio: kind === 'audio' }">
    <h1 class="studioHeading">创作中心</h1>
    <nav class="creationModes" aria-label="创作类型">
      <router-link v-for="item in mediaModes" :key="item.id" :to="'/studio/' + item.id" :class="{ active: kind === item.id }" :aria-current="kind === item.id ? 'page' : undefined"><component :is="item.icon" :size="24" :strokeWidth="1.6" aria-hidden="true" /><span>{{ item.label }}</span></router-link>
    </nav>
    <div class="studioBody">
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
            <el-popover v-if="kind !== 'audio'" v-model:visible="referenceMenuVisible" trigger="click" placement="top-start" :width="244" :disabled="locked" role="dialog" popperClass="studioReferencePopover">
              <template #reference><button aria-label="添加参考素材" :disabled="locked" :aria-expanded="referenceMenuVisible"><icon-plus :size="16" />参考素材<span v-if="references.length">{{ references.length }}</span></button></template>
              <div class="composerReferenceMenu">
                <template v-if="referenceGroups.length">
                  <div v-if="kind === 'video'" class="referenceType"><label for="studioReferenceKind">素材类型</label><el-select id="studioReferenceKind" v-model="referenceKind" class="studioSelect" aria-label="参考素材类型" popperClass="studioSelectPopper" :teleported="false" :disabled="locked"><el-option v-for="group in referenceGroups" :key="group.kind" :label="group.title" :value="group.kind" /></el-select></div>
                  <label class="referenceUpload"><icon-plus :size="16" />从电脑上传<input type="file" :aria-label="'快捷上传' + activeReferenceGroup.title" :accept="referenceKind + '/*'" :disabled="locked" multiple @change="onUpload($event, referenceKind); referenceMenuVisible = false" /></label>
                  <button :disabled="locked" aria-label="粘贴参考素材" @click="readClipboard(referenceKind); referenceMenuVisible = false"><icon-clipboard :size="16" />从剪贴板粘贴</button>
                  <button :disabled="locked" aria-label="打开素材库" @click="openAssets(referenceKind); referenceMenuVisible = false"><icon-folder-plus :size="16" />从素材库选择</button>
                  <p>{{ referenceLimitHint }}</p>
                </template>
                <template v-else>
                  <p>{{ kind === 'video' && videoMode === '&quot;text&quot;' ? '文生视频模式不使用参考素材。' : '当前模型不支持参考素材。' }}</p>
                  <button v-if="referenceVideoMode" @click="videoMode = JSON.stringify(referenceVideoMode)">切换为参考模式</button>
                  <button v-else @click="referenceMenuVisible = false; openSettings('mediaChannel')">模型配置<icon-arrow-right :size="16" /></button>
                </template>
              </div>
            </el-popover>
            <button aria-label="打开提示词库" @click="promptLibraryVisible = true"><icon-book :size="16" />提示词库</button>
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
        </fieldset>
        <div class="composerControls">
        <div class="composerSettings">
        <fieldset :disabled="locked">
          <div class="composerFields" :class="{ imageFields: kind === 'image' }">
            <div class="composerModel">
              <div class="modelHeading"><label for="studioModel">模型</label><div class="modelTools"><button :disabled="loadingModels" aria-label="刷新模型" title="刷新模型" @click="loadModels(true)"><icon-refresh :size="14" /></button><button aria-label="模型渠道" title="管理模型渠道" @click="openSettings('mediaChannel')"><icon-adjustments-horizontal :size="14" /></button></div></div>
              <div class="modelControl">
                <el-select id="studioModel" v-model="selectedModel" class="studioSelect" aria-label="生成模型" popperClass="studioModelPopper studioSelectPopper" filterable :loading="loadingModels" :disabled="locked || loadingModels || !availableModels.length" :placeholder="loadingModels ? '读取中…' : !availableModels.length ? '尚未配置模型' : '选择模型'" noMatchText="没有匹配的模型">
                  <template #prefix><icon-cpu :size="16" /></template>
                  <el-option label="选择模型" value="" />
                  <el-option v-for="item in availableModels" :key="modelKey(item)" :label="item.label" :value="modelKey(item)" />
                </el-select>
              </div>
            </div>
            <template v-if="kind === 'image'">
              <div class="parameterField"><label for="studioImageSize">尺寸</label><el-select id="studioImageSize" :modelValue="imagePreset" class="studioSelect" aria-label="图片尺寸" popperClass="studioSelectPopper" :disabled="locked || (!sizes.length && !model?.imageSizeRange)" title="只显示模型已声明的尺寸；其他情况使用渠道默认" @update:modelValue="applyImagePreset"><el-option v-for="preset in imagePresets" :key="preset.value" :label="preset.label" :value="preset.value" /></el-select></div>
              <div class="parameterField"><label for="studioImageRatio">宽高比</label><el-select id="studioImageRatio" v-model="ratio" class="studioSelect" aria-label="图片宽高比" popperClass="studioSelectPopper" :emptyValues="[null, undefined]" :disabled="locked || !ratios.length" title="只显示模型已声明的宽高比"><el-option label="渠道默认" value="" /><el-option v-for="value in ratios" :key="value" :label="value" :value="value" /></el-select></div>
              <div class="parameterField"><label for="studioImageQuality">质量</label><el-select id="studioImageQuality" v-model="quality" class="studioSelect" aria-label="图片质量" popperClass="studioSelectPopper" :emptyValues="[null, undefined]" :disabled="locked || !model?.imageQualities?.length"><el-option v-for="item in qualities" :key="item.value" :label="item.label" :value="item.value" /></el-select></div>
              <label>数量<input v-model.number="quantity" aria-label="生成张数" type="number" min="1" :max="model?.maxImageCount ?? 1" /></label>
            </template>
            <template v-else-if="kind === 'video'">
              <div class="parameterField"><label for="studioVideoRatio">宽高比</label><el-select id="studioVideoRatio" v-model="ratio" class="studioSelect" aria-label="视频宽高比" popperClass="studioSelectPopper" :emptyValues="[null, undefined]" :disabled="locked || !ratios.length"><el-option label="渠道默认" value="" /><el-option v-for="value in ratios" :key="value" :label="value" :value="value" /></el-select></div>
              <div class="parameterField"><label for="studioVideoDuration">时长（秒）</label><el-select id="studioVideoDuration" :modelValue="duration ?? ''" class="studioSelect" aria-label="视频时长" popperClass="studioSelectPopper" :emptyValues="[null, undefined]" :disabled="locked || !durationOptions.length" :title="durationOptions.length ? undefined : '渠道未声明可调整时长，使用默认值'" @update:modelValue="value => duration = typeof value === 'number' ? value : undefined"><el-option label="渠道默认" value="" /><el-option v-for="value in durationOptions" :key="value" :label="`${value} 秒`" :value="value" /></el-select></div>
              <div class="parameterField"><label for="studioVideoResolution">分辨率</label><el-select id="studioVideoResolution" v-model="resolution" class="studioSelect" aria-label="视频分辨率" popperClass="studioSelectPopper" :emptyValues="[null, undefined]" :disabled="locked || !resolutionOptions.length" :title="resolutionOptions.length ? undefined : '渠道未声明可调整分辨率，使用默认值'"><el-option label="渠道默认" value="" /><el-option v-for="value in resolutionOptions" :key="value" :label="value" :value="value" /></el-select></div>
              <div class="parameterField"><label for="studioVideoMode">生成模式</label><el-select id="studioVideoMode" v-model="videoMode" class="studioSelect" aria-label="视频生成模式" popperClass="studioSelectPopper" :emptyValues="[null, undefined]" :disabled="locked || !videoModes.length"><el-option label="模型默认" value="" /><el-option v-for="mode in videoModes" :key="JSON.stringify(mode)" :label="modeLabel(mode)" :value="JSON.stringify(mode)" /></el-select></div>
            </template>
            <template v-else>
              <div class="parameterField"><label for="studioVoice">音色</label><el-select id="studioVoice" v-model="voice" class="studioSelect" aria-label="音色" popperClass="studioSelectPopper" filterable :emptyValues="[null, undefined]" :disabled="locked || !model?.voices?.length"><el-option :label="model?.voices?.length ? '请选择音色' : '渠道默认'" value="" /><el-option v-for="item in model?.voices ?? []" :key="item.voice" :label="item.title" :value="item.voice" /></el-select></div>
              <div class="parameterField"><label for="studioAudioFormat">格式</label><el-select id="studioAudioFormat" v-model="format" class="studioSelect" aria-label="音频格式" popperClass="studioSelectPopper" :emptyValues="[null, undefined]" :disabled="locked || !audioFormats.length"><el-option label="渠道默认" value="" /><el-option v-for="value in audioFormats" :key="value" :label="value.toUpperCase()" :value="value" /></el-select></div>
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
        </fieldset>
        <div class="workspaceRow"><span>保存到</span><button type="button" :title="directory || '选择工作空间'" :disabled="directoryLocked" @click="selectProject">{{ workspace.workspaceRoot?.name || '选择工作空间' }}</button><p class="draftStatus" :class="{ draftFailed: draftError }" :role="draftError ? 'alert' : 'status'" :title="directory ? '草稿和参考文件保存在当前工作空间' : '未选保存位置的草稿保存在应用数据中'">{{ restoringDraft ? '恢复草稿中…' : draftError || (draftDirty ? '保存草稿中…' : '草稿已保存') }}<button v-if="draftError" @click="retryDraft().catch(() => {})">重试</button></p></div>
        </div>
        <div class="composerFooter">
          <p v-if="inputError" class="generationIssue" role="alert">{{ inputError }}</p>
          <button v-if="busy" class="composerCancel" @click="cancel"><icon-player-stop :size="16" />取消等待</button>
          <button v-else class="composerGenerate" :disabled="primaryActionDisabled" :title="inputError || (model && directory && !prompt.trim() ? '填写提示词后即可生成' : undefined)" @click="runPrimaryAction"><icon-sparkles :size="17" />{{ primaryActionLabel }}<icon-arrow-right :size="16" /></button>
          <button v-if="directory" class="budgetButton" :disabled="locked" @click="openCostPanel">费用与预算</button>
        </div>
        </div>
      </section>
      <section class="resultPanel" aria-label="生成结果">
        <div class="resultHeading"><h2>生成记录 <span class="countBadge">{{ results.length }}</span></h2><div class="resultTools"><div class="segmented"><button :aria-pressed="!grouped" @click="grouped = false">全部展示</button><button :aria-pressed="grouped" @click="grouped = true">按日期分组</button></div><button :disabled="locked" @click="newCreation"><icon-plus :size="14" />新建</button><button v-if="results.length" :disabled="locked" @click="selected = selected.length === results.length ? [] : results.map(item => item.id)"><icon-checkbox :size="14" />{{ selected.length && selected.length === results.length ? '取消全选' : '全选' }}</button><button v-if="results.length" :disabled="!selected.length || locked" title="移除记录，保留原文件" @click="removeSelected"><icon-trash :size="14" />移除{{ selected.length ? ` (${selected.length})` : '' }}</button></div></div>
        <div v-if="modelError" class="statusMessage errorMessage" role="alert">{{ modelError }}<button @click="loadModels(true)">重试</button></div>
        <div v-if="error" class="statusMessage errorMessage" role="alert">{{ error }}</div>
        <div v-if="taskError" class="statusMessage errorMessage" role="alert">{{ taskError }}<button @click="loadTasks">刷新任务</button></div>
        <div v-for="warning in taskWarnings" :key="warning" class="statusMessage" role="status">{{ warning }}</div>
        <div v-if="directory && (references.length || results.length)" class="referenceMaintenance"><button :disabled="locked" @click="cleanupReferences">清理未引用参考缓存</button></div>
        <div v-if="taskPageCount > 1" class="statusMessage" aria-label="任务分页"><button :disabled="locked || taskPage <= 1" @click="taskPage--">较新任务</button><span>{{ taskPage }} / {{ taskPageCount }} · 共 {{ taskTotal }} 个任务</span><button :disabled="locked || taskPage >= taskPageCount" @click="taskPage++">较早任务</button></div>
        <div v-for="task in tasks.filter(task => task.status !== 'completed')" :key="task.id" class="statusMessage" :class="{ taskRecord: !isActiveTask(task) }" role="status">
          <span>{{ isActiveTask(task) ? '任务进行中，刷新或离开后仍可查看' : taskRecordLabel(task) + (task.error ? ' · ' + task.error : '') }} · {{ task.request.prompt.slice(0, 36) }}{{ task.providerTaskId ? ' · 渠道任务 ' + task.providerTaskId : '' }}</span>
          <button v-if="!isActiveTask(task)" @click="taskCenter.open({ directory: task.directory, id: task.id })">查看此任务</button>
          <button v-if="task.canResume && !isActiveTask(task)" :disabled="locked" @click="resumeTask(task)">{{ task.canCancel ? '继续排队' : task.results.length ? '仅重试未完成结果' : '继续查询／下载' }}</button>
        </div>
        <div v-if="historyError" class="statusMessage errorMessage" role="alert">{{ historyError }}<button :disabled="loadingHistory" @click="loadHistory">重试读取</button></div>
        <div v-if="busy" class="statusMessage" role="status"><span class="loadingDot"></span>{{ progress }}<span>结果返回后会自动保存在当前工作空间</span></div>
        <div v-if="loadingHistory" class="emptyResults" role="status"><icon-refresh :size="32" /><p>正在读取项目结果…</p></div>
        <div v-else-if="!results.length && !busy" class="emptyResults"><component :is="kind === 'image' ? IconPhotoPlus : kind === 'video' ? IconVideo : IconMusic" :size="26" :strokeWidth="1.5" /><p>生成结果会保存在这里</p></div>
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
  </libraryShell>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { IconCpu, IconPhoto, IconPhotoPlus, IconVideo, IconMusic, IconBook, IconAdjustmentsHorizontal, IconClipboard, IconTrash, IconFolderPlus, IconX, IconRefresh, IconArrowRight, IconSparkles, IconPlayerStop, IconPlus, IconCheckbox, IconDownload, IconChevronDown, IconDots } from "@tabler/icons-vue";
import { creationPrompts } from "@/lib/promptTemplates";
import libraryShell from "@/components/libraryShell.vue";
import settings from "@/components/settings/index.vue";
import { useWorkspaceStore } from "@/stores/workspace";
import transferDialog from "./transferDialog.vue";
import useStudio, { type ReferenceKind, type StudioKind } from "./useStudio";
import type { MediaTaskRecord } from "@toonflow/tools-scaffold/runtime";
import { useTaskCenterStore } from "@/stores/taskCenter";

const route = useRoute();
const router = useRouter();
const mediaModes = [{ id: "image", label: "图片创作", icon: IconPhoto }, { id: "video", label: "视频创作", icon: IconVideo }, { id: "audio", label: "音频创作", icon: IconMusic }];
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
const referenceMenuVisible = ref(false);
const extraFieldsVisible = ref(false);
const hasExtraFields = computed(() => kind.value === "image" ? !!model.value?.imageSizeRange : kind.value === "video" && model.value?.audio === "optional");
watch(imagePreset, value => { if (value === "custom") extraFieldsVisible.value = true; });
const primaryActionLabel = computed(() => tasks.value.some(task => ["queued", "submitting", "running", "downloading"].includes(task.status)) ? "任务生成中…" : loadingModels.value ? "读取模型中…" : !directory.value ? "选择工作空间" : !availableModels.value.length ? "配置 API" : !model.value ? "请选择模型" : `生成${mediaLabel.value}`);
const primaryActionDisabled = computed(() => tasks.value.some(task => ["queued", "submitting", "running", "downloading"].includes(task.status)) || !!taskError.value || locked.value || loadingModels.value || (!!directory.value && !!availableModels.value.length && !model.value) || (!!model.value && !!directory.value && (!prompt.value.trim() || !!historyError.value || !!inputError.value)));
function runPrimaryAction() {
  if (!directory.value) void selectProject();
  else if (!availableModels.value.length) openSettings("mediaChannel");
  else void generate();
}
async function selectProject() {
  try {
    await saveDraft();
    const query = { ...route.query };
    delete query.prompt; delete query.fromUnbound;
    if (!directory.value) query.fromUnbound = "1";
    const next = router.resolve({ path: route.path, query }).fullPath;
    await router.push({ path: "/home", query: { next } });
  } catch { /* 草稿保存反馈保留在原页面，避免离页丢失输入。 */ }
}
const workspace = useWorkspaceStore();
const promptInput = ref<HTMLTextAreaElement>();
const grouped = ref(false);
const settingsVisible = ref(false);
const settingsPanel = ref("mediaChannel");
const promptLibraryVisible = ref(false);
const assetsVisible = ref(false);
const assetKind = ref<ReferenceKind>("image");
const previewUrl = ref("");
const qualities = computed(() => [{ label: "渠道默认", value: "" }, ...(model.value?.imageQualities ?? []).map(value => ({ value, label: ({ high: "高", medium: "中", low: "低" })[value] }))]);
const referenceGroups = computed<{ kind: ReferenceKind; title: string; limit: number | undefined }[]>(() => ([{ kind: "image", title: "参考图", limit: referenceLimits.value.image }, { kind: "video", title: "参考视频", limit: referenceLimits.value.video }, { kind: "audio", title: "参考音频", limit: referenceLimits.value.audio }] as const).filter(group => group.limit !== 0));
const referenceVideoMode = computed(() => kind.value === "video" ? videoModes.value.find(mode => mode !== "text") : undefined);
const referenceKind = ref<ReferenceKind>(kind.value === "audio" ? "audio" : "image");
const activeReferenceGroup = computed(() => referenceGroups.value.find(group => group.kind === referenceKind.value) ?? { kind: referenceKind.value, title: "参考素材", limit: 0 });
const referenceLimitHint = computed(() => kind.value === "audio" ? "文字配音不使用参考素材，请先移除。" : !model.value ? "可先添加素材，选择模型后会检查兼容性。" : !referenceGroups.value.length ? "当前模式不支持已有参考，请更换模式或移除。" : activeReferenceGroup.value.limit === undefined ? "每类参考最多 64 个。" : '最多 ' + Math.min(activeReferenceGroup.value.limit, 64) + ' 个' + activeReferenceGroup.value.title + (referenceKind.value === "audio" ? "，单个不超过 15 MB。" : "。"));
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
</script>

<style scoped lang="scss">
.studioPage {
  --studioBg: var(--homeBg); --studioPanel: var(--homeSurface); --studioField: var(--homeSurface); --studioRaised: var(--homeRaised); --studioLine: var(--homeLine); --studioText: var(--homeText); --studioMuted: var(--homeMuted); --studioAccent: var(--homeAccent); --studioError: var(--el-color-danger);
  &.audioStudio { --studioParameterCount: 3; }
  --el-text-color-primary: var(--studioText); --el-text-color-regular: var(--studioMuted); --el-fill-color-blank: var(--studioPanel); --el-fill-color-light: var(--studioRaised); --el-border-color: var(--studioLine);
  width: 100%; min-width: 0; color: var(--studioText); display: flex; flex-direction: column; font-size: 14px;
  *,*::before,*::after { box-sizing: border-box; }
  h1,h2,h3,p { margin: 0; }
  button,input,textarea { font: inherit; }
  button,a { -webkit-tap-highlight-color: transparent; }
  button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 32px; background: transparent; color: inherit; border: 1px solid var(--studioLine); border-radius: var(--ui-radius, 8px); padding: 6px 10px; line-height: 1.3; cursor: pointer; &:hover:not(:disabled) { background: var(--studioRaised); } &:disabled { opacity: .4; cursor: not-allowed; } }
  button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible { outline: 2px solid var(--studioAccent); outline-offset: 3px; }
  ::selection { background: var(--studioAccent); color: var(--studioBg); }
  .studioHeading { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .creationModes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 28px;
    a { display: flex; align-items: center; justify-content: center; gap: 12px; min-width: 0; min-height: 72px; padding: 16px; border: 1px solid var(--studioLine); border-radius: 6px; background: var(--studioPanel); color: var(--studioMuted); font-size: 20px; font-weight: 500; text-decoration: none;
      svg { flex-shrink: 0; }
      span { min-width: 0; overflow-wrap: anywhere; text-wrap: balance; }
      &:hover { border-color: var(--studioText); color: var(--studioText); }
      &.active { border-color: var(--studioAccent); background: var(--studioAccent); color: var(--studioBg); font-weight: 600; }
    }
  }
  .studioBody { min-width: 0; display: flex; flex-direction: column; }
  .resultPanel { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--studioLine); display: flex; flex-direction: column; min-width: 0; }
  .referenceMaintenance { margin: 0 0 12px; button { border: 0; padding: 0; color: var(--studioMuted); font-size: 12px; } }
  .resultHeading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding-bottom: 20px; flex-shrink: 0; h2 { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 550; white-space: nowrap; svg { color: var(--studioMuted); } } }
  .resultTools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; button { font-size: 12px; } }
  .segmented { display: inline-flex; gap: 2px; background: var(--studioPanel); border: 1px solid var(--studioLine); border-radius: var(--ui-radius, 8px); padding: 2px; button { border: 0; min-height: 28px; padding: 4px 8px; white-space: nowrap; color: var(--studioMuted); &[aria-pressed=true] { background: var(--studioRaised); color: var(--studioText); } } }
  .countBadge { font-size: 12px; color: var(--studioMuted); font-weight: 400; font-variant-numeric: tabular-nums; }
  .emptyResults { min-height: 160px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px 16px; border: 1px solid var(--studioLine); border-radius: 4px; color: var(--studioMuted); text-align: center; >svg { width: 26px; height: 26px; } p { color: var(--studioText); font-size: 14px; } >span { font-size: 13px; line-height: 1.8; max-width: 40em; } }
  .generationIssue { margin: 0; color: var(--el-color-danger); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
  .statusMessage { padding: 12px; border: 1px solid var(--studioLine); border-radius: var(--ui-radius, 8px); margin-bottom: 12px; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; line-height: 1.7; flex-shrink: 0; overflow-wrap: anywhere; span:last-child { margin-left: auto; font-size: 12px; color: var(--studioMuted); } }
  .taskRecord { >span { flex: 1; min-width: 0; font-size: 13px; color: var(--studioText); } @media (max-width: 600px) { >span { flex-basis: 100%; } >button { min-height: 44px; } } }
  .errorMessage,.fieldError { color: var(--studioError); } .fieldError { font-size: 12px; line-height: 1.6; margin-top: 8px; }
  .loadingDot { width: 8px; height: 8px; border-radius: 50%; background: var(--studioAccent); animation: pendingPulse 1.4s ease-in-out infinite; }
  .resultScroll { padding: 2px; }
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
  input:not([type=checkbox]):not([type=file]) { width: 100%; min-width: 0; height: 40px; padding: 8px; border: 1px solid var(--studioLine); border-radius: var(--ui-radius, 8px); background: var(--studioField); color: var(--studioText); }
  input[type=checkbox] { accent-color: var(--studioAccent); }
  .studioComposer { width: 100%; min-width: 0; display: flex; flex-direction: column;
    fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
    .composerHeading { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 32px; margin-bottom: 8px; >label { font-size: 13px; font-weight: 550; } .promptUtilities { display: flex; gap: 4px; button { width: 32px; height: 32px; padding: 6px; border: 0; color: var(--studioMuted); } } }
    .composerPrompt textarea { height: 144px; min-height: 112px; resize: vertical; max-height: 440px; padding: 16px; font-size: 14px; line-height: 1.8; }
    .composerTools { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 8px; button { min-height: 36px; padding: 6px 8px; border: 0; color: var(--studioMuted); font-size: 12px; white-space: nowrap; } button:first-child { color: var(--studioText); } button span { font-variant-numeric: tabular-nums; } }
    .referenceHint { margin-top: 8px; color: var(--studioMuted); font-size: 11px; line-height: 1.6; }
    .composerReferences { display: flex; gap: 8px; overflow-x: auto; max-height: 128px; margin-top: 12px; padding-bottom: 4px; .referenceItem { flex: 0 0 128px; min-width: 0; img,video { width: 100%; height: 76px; object-fit: contain; border-radius: calc(var(--ui-radius, 8px) * 0.75); background: var(--studioField); } audio { width: 128px; height: 36px; } >div { display: flex; gap: 4px; align-items: center; span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; font-size: 11px; } button { padding: 4px; border: 0; } } } }
    .composerControls { display: grid; grid-template-columns: minmax(0, 1fr) 176px; align-items: start; gap: 24px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--studioLine); }
    .composerSettings { display: grid; gap: 12px; min-width: 0;
      .workspaceRow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; color: var(--studioMuted); font-size: 12px;
        >span { flex-shrink: 0; }
        :deep(.workspaceButton) { min-width: 0; max-width: min(240px, calc(100% - 48px)); color: var(--studioText); }
        .draftStatus { font-size: 11px; line-height: 1.6; &.draftFailed { flex-basis: 100%; color: var(--studioError); overflow-wrap: anywhere; button { margin-left: 8px; } } }
      }
    }
    .composerFields,.extraFields { display: grid; grid-template-columns: minmax(180px, 2fr) repeat(var(--studioParameterCount, 4), minmax(80px, 1fr)); gap: 16px 12px; align-items: end; >label,.parameterField { display: grid; gap: 8px; color: var(--studioMuted); font-size: 12px; min-width: 0; select,input { font-size: 13px; text-overflow: ellipsis; } } .inlineCheck { grid-column: 1/-1; display: flex; align-items: center; gap: 8px; min-height: 36px; input { width: auto; height: auto; } } }
    .extraFields { grid-template-columns: repeat(2,minmax(0,1fr)); margin-top: 8px; padding: 16px 0 4px; border-top: 1px solid var(--studioLine); }
    .moreParameters { grid-column: 1/-1; justify-self: start; min-height: 36px; border: 0; padding: 8px 0; color: var(--studioMuted); font-size: 12px; svg { transition: transform 160ms ease-out; &.expanded { transform: rotate(180deg); } } }
    .customSizeSummary { font-variant-numeric: tabular-nums; color: var(--studioText); }
    .composerModel { min-width: 0; }
    .modelHeading { min-height: 24px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; color: var(--studioMuted); font-size: 12px; .modelTools { display: flex; gap: 4px; button { width: 28px; min-height: 24px; padding: 4px; border: 0; } } }
    .modelControl { min-width: 0; :deep(.el-select__prefix) { color: var(--studioMuted); } }
    .composerFooter { display: grid; gap: 8px; min-width: 0; padding-top: 32px;
      .composerGenerate, .composerCancel { grid-row: 1; }
      .budgetButton { grid-row: 2; border: 0; color: var(--studioMuted); font-size: 12px; }
      .generationIssue { grid-row: 3; }
    }
    .composerGenerate,.composerCancel { grid-column: 1/-1; width: 100%; min-height: 44px; padding: 12px; border: 0; border-radius: var(--ui-radius, 8px); background: var(--studioAccent); color: var(--studioBg); font-weight: 600; &:hover:not(:disabled) { background: var(--studioAccent); filter: brightness(.94); } &:disabled { background: var(--studioRaised); color: var(--studioMuted); opacity: .65; } }
  }
  @media (max-width: 1200px) { .studioComposer .composerFields { grid-template-columns: repeat(3, minmax(0, 1fr)); .composerModel { grid-column: span 2; } } }
  @media (max-height: 740px) { .studioComposer .composerPrompt textarea { height: 128px; } }
  @media (max-width: 720px) {
    .creationModes { gap: 8px; margin-bottom: 24px; a { flex-direction: column; gap: 8px; min-height: 80px; padding: 12px 8px; font-size: 15px; text-align: center; } }
    .studioComposer { .composerControls { grid-template-columns: minmax(0, 1fr); gap: 12px; } .composerFooter { padding-top: 0; } .composerPrompt textarea { height: 128px; } .composerHeading .promptUtilities button { width: 44px; height: 44px; } .composerTools button,.moreParameters { min-height: 44px; } .composerFields { grid-template-columns: repeat(2, minmax(0, 1fr)); .composerModel { grid-column: 1 / -1; } } }
    .resultPanel { padding-top: 20px; }
    .resultHeading { gap: 12px; }
    .resultTools { gap: 6px; button { min-height: 36px; } }
    .resultScroll { overflow: visible; }
    .resultGrid,.audioResults { grid-template-columns: minmax(0,1fr); }
    .resultInfo .resultActions button { min-height: 44px; }
  }
  @media (prefers-reduced-motion: reduce) { .loadingDot { animation: none; } .moreParameters svg { transition: none; } }
}
@keyframes pendingPulse { 50% { opacity: .3; } }
.studioPromptLibrary { display: grid; gap: 12px; button { cursor: pointer; text-align: left; border: 1px solid var(--el-border-color); border-radius: var(--ui-radius, 8px); background: var(--el-bg-color); color: var(--el-text-color-primary); padding: 16px; display: grid; gap: 8px; strong { font-size: 15px; } span { line-height: 1.8; font-size: 13px; } } }
.studioAssetPicker { display: grid; grid-template-columns: repeat(auto-fill,minmax(145px,1fr)); gap: 12px; >p { grid-column: 1/-1; } button { display: flex; flex-direction: column; gap: 8px; align-items: center; border: 1px solid var(--el-border-color); border-radius: var(--ui-radius, 8px); background: var(--el-bg-color); color: var(--el-text-color-primary); padding: 12px; cursor: pointer; min-width: 0; img { width: 100%; height: 100px; object-fit: contain; } span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } small { color: var(--el-text-color-secondary); } } }
.studioSelect {
  width: 100%; min-width: 0;
  :deep(.el-select__wrapper) { min-height: 40px; font-size: 13px; background: var(--el-bg-color); }
  :deep(input.el-select__input:focus-visible) { outline: none; }
  :deep(.el-select__placeholder:not(.is-transparent)) { color: var(--el-text-color-primary); }
}
.composerReferenceMenu { display: grid; gap: 4px; color: var(--el-text-color-primary);
  button,.referenceUpload { position: relative; display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 10px; border: 0; border-radius: calc(var(--ui-radius, 8px) * 0.75); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; &:hover { background: var(--el-fill-color-light); } &:focus-visible,&:focus-within { outline: 2px solid var(--el-color-primary); outline-offset: -2px; } }
  .referenceUpload { overflow: hidden; input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; } }
  .referenceType { display: grid; gap: 8px; padding: 4px 8px 10px; color: var(--el-text-color-regular); font-size: 12px; }
  p { margin: 6px 8px 2px; font-size: 12px; line-height: 1.6; color: var(--el-text-color-secondary); }
}
</style>
