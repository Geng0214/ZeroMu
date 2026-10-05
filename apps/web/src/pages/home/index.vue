<template>
<main class="studioHome" :class="{ lightHome }">
  <button class="skipLink" @click="selectMode(currentMode)">跳到创作输入框</button>
  <header class="studioHeader"><div class="headerInner">
    <button class="brandButton" aria-label="零幕创作首页" @click="navigate('home')"><img :src="logoUrl" alt="" /><strong>零幕</strong></button>
    <nav class="studioNav" aria-label="主导航">
      <button :class="{ selected: activeNav === 'home' }" @click="navigate('home')"><icon-layout-grid :size="16" />无限画布</button>
      <button :class="{ selected: activeNav === 'projects' }" @click="navigate('projects')"><icon-folder :size="16" />我的项目</button>
      <button v-for="mode in modes.slice(1)" :key="mode.id" :class="{ selected: activeNav === mode.id }" @click="navigate(mode.id)"><component :is="mode.icon" :size="16" />{{ mode.label }}</button>
      <button :class="{ selected: activeNav === 'prompts' }" @click="navigate('prompts')"><icon-book :size="16" />提示词库</button>
      <button :class="{ selected: activeNav === 'assets' }" @click="navigate('assets')"><icon-photo :size="16" />我的素材</button>
    </nav>
    <div class="headerTools"><button class="iconButton" aria-label="模型渠道设置" @click="openSettings('mediaChannel')"><icon-settings :size="18" /></button><button class="iconButton" :aria-label="lightHome ? '切换深色首页' : '切换浅色首页'" @click="toggleHomeTheme"><icon-moon v-if="lightHome" :size="18" /><icon-sun v-else :size="18" /></button><el-badge isDot :hidden="!hasDesktopUpdate"><button class="iconButton" aria-label="关于零幕" @click="openSettings('about')"><icon-info-circle :size="18" /></button></el-badge></div>
  </div></header>
  <div class="homeContent">
    <section class="showcase" aria-label="创作灵感推荐" aria-roledescription="轮播图">
      <div class="slideStage"><article v-for="(slide, index) in slides" :key="slide.title" class="featureSlide" :class="slidePosition(index)" :aria-hidden="index !== activeSlide">
        <img v-if="slide.image" class="sceneImage" :src="slide.image" alt="" :fetchpriority="index === 0 ? 'high' : 'auto'" />
        <div v-else class="storyFrames" aria-hidden="true"><span>构思</span><i></i><span>分镜</span><i></i><span>成片</span></div>
        <div class="slideShade"></div><div class="slideCopy"><h1 v-if="index === 0">{{ slide.title }}</h1><h2 v-else>{{ slide.title }}</h2><p>{{ slide.detail }}</p><button :tabindex="index === activeSlide ? 0 : -1" @click="selectMode(slide.mode)">{{ slide.action }}<icon-arrow-right :size="17" /></button></div>
      </article><button class="carouselArrow previous" aria-label="上一条推荐" @click="changeSlide(-1)"><icon-chevron-left :size="22" /></button><button class="carouselArrow next" aria-label="下一条推荐" @click="changeSlide(1)"><icon-chevron-right :size="22" /></button></div>
      <div class="slideDots" aria-label="选择推荐"><button v-for="(slide, index) in slides" :key="slide.title" :class="{ active: index === activeSlide }" :aria-label="slide.title" :aria-pressed="index === activeSlide" @click="activeSlide = index"></button></div>
    </section>
    <section id="creationComposer" ref="composerSection" class="creationComposer" aria-label="创作输入框">
      <div class="composerModes" aria-label="创作类型"><button v-for="mode in modes" :key="mode.id" :class="{ active: currentMode === mode.id }" :aria-pressed="currentMode === mode.id" @click="selectMode(mode.id)">{{ mode.id === 'home' ? '自由创作' : mode.label }}</button></div>
      <div class="promptCard"><attachmentList v-if="promptAttachments.length" :attachments="promptAttachments" removable restorable :disabled="creating || opening" @remove="promptAttachments.splice($event, 1)" @restore="restoreAttachment" /><el-input ref="promptInput" v-model="prompt" type="textarea" :rows="3" resize="none" :disabled="creating || opening" :placeholder="promptPlaceholder" aria-label="创作描述" @paste.capture="pasteText" /><div class="composerFooter"><workspacePicker ref="promptWorkspacePicker" v-model="workspaceDirectory" :disabled="creating || opening" /><div class="sendActions"><modelPopover v-model="selectedModel" v-model:reasoningEffort="reasoningEffort" :disabled="creating || opening" /><el-button class="sendButton" type="primary" circle :icon="IconArrowUp" :loading="creating" :disabled="creating || opening" :aria-label="workspaceDirectory ? '开始创作' : '选择工作目录'" @click="workspaceDirectory ? createProject() : promptWorkspacePicker?.chooseDirectory()" /></div></div></div>
      <p class="composerHint">{{ workspaceDirectory ? '灵感将在所选项目中展开，由 AI 助手协助完成。' : '选择一个空文件夹，保存这次创作的画布与素材。' }}<button @click="openSettings('languageModel')">配置模型<icon-arrow-right :size="13" /></button></p>
    </section>
    <section ref="promptSection" class="promptShelf" aria-labelledby="promptShelfTitle"><div class="shelfHeading"><div><h2 id="promptShelfTitle">每一个好故事，都有一个起点</h2><p>选一个方向，把灵感变成你的下一次创作。</p></div><button class="textAction" @click="showAllPrompts = !showAllPrompts">{{ showAllPrompts ? '收起提示词' : '浏览提示词库' }}<icon-arrow-right :size="16" /></button></div><div class="promptGrid"><button v-for="item in visiblePrompts" :key="item.title" class="promptSuggestion" @click="useTemplate(item)"><span class="promptKind">{{ item.kind }}</span><strong>{{ item.title }}</strong><span class="promptExcerpt">{{ item.text }}</span><icon-arrow-up :size="17" class="templateArrow" /></button></div></section>
    <section ref="projectSection" class="projectList" aria-labelledby="projectListTitle"><div class="sectionHeader"><div><h2 id="projectListTitle">我的项目<span>{{ projectList.length }}</span></h2><p>接着上次的灵感，继续创作。</p></div><div class="projectToolbar"><el-input v-model="projectQuery" class="projectSearch" :prefixIcon="IconSearch" placeholder="搜索项目" aria-label="搜索项目" clearable /><el-button :icon="iconFolderOpen" :disabled="creating || opening" @click="openProject()">导入</el-button><el-button :icon="IconFolderPlus" :disabled="creating || opening" @click="createProject(false)">新建项目</el-button><el-button circle :icon="sortDescending ? IconSortDescending : IconSortAscending" :aria-label="sortDescending ? '按时间降序' : '按时间升序'" @click="sortDescending = !sortDescending" /><el-button circle :icon="viewMode === 'grid' ? IconList : IconLayoutGrid" :aria-label="viewMode === 'grid' ? '切换列表视图' : '切换网格视图'" @click="viewMode = viewMode === 'grid' ? 'list' : 'grid'" /></div></div>
      <div v-if="!sortedProjects.length" class="emptyProjects"><icon-folder :size="30" /><h3>{{ projectQuery ? '没有找到匹配的项目' : '你的第一部作品，从这里开始' }}</h3><p>{{ projectQuery ? '试试其他名称或文件夹路径。' : '新建画布，或导入已有项目。你的文件保存在本地。' }}</p><button v-if="!projectQuery" class="textAction" :disabled="creating || opening" @click="createProject(false)">创建第一个项目<icon-arrow-right :size="16" /></button></div>
      <div v-else class="projectItems" :class="{ listView: viewMode === 'list' }"><article v-for="item in sortedProjects" :key="item.directory" class="projectCard"><button class="projectEntry" :disabled="creating || opening" :aria-label="'打开项目 ' + item.name" @click="openProject(item)"><icon-folder class="projectIcon" :size="28" /><span class="projectInfo"><strong class="projectName" :title="item.name">{{ item.name }}</strong><span class="projectPath" :title="item.directory">{{ item.directory }}</span><span class="projectTime">最近打开 {{ new Date(item.lastOpenedAt).toLocaleString(locale, { hour12: false }) }}</span></span></button><div class="projectActions"><el-button text :icon="IconEdit" :disabled="creating || opening" :aria-label="'重命名项目 ' + item.name" @click="renameProject(item)" /><el-button text :icon="IconTrash" :disabled="creating || opening" :aria-label="'移除项目 ' + item.name" title="从列表移除，不删除文件" @click="workspaceStore.removeProject(item.directory)" /></div></article></div>
    </section>
    <footer class="homeFooter"><span>零幕 ZEROMU · 从零开始，创造第一幕。</span><button @click="openSettings('about')">关于零幕</button></footer>
  </div>
  <settings v-model="settingsVisible" :initialPanel="settingsPanel" /><el-dialog v-model="assetsVisible" title="我的素材" width="min(820px, 94vw)" appendToBody><assetLibrary v-if="assetsVisible" v-model="assetsVisible" class="homeAssets" /></el-dialog><workspacePicker ref="relocationPicker" hideTrigger />
</main>
</template>

<script setup lang="ts">
import { locale, translate } from "@toonflow/i18n/vue";
import axios from "axios";
import { storeToRefs } from "pinia";
import { computed, defineAsyncComponent, nextTick, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox, type InputInstance } from "element-plus";
import {
  IconSettings, IconPhoto, IconVideo, IconMusic, IconBook, IconArrowRight, IconChevronLeft, IconChevronRight, IconSun, IconMoon, IconInfoCircle, IconSearch,
  IconArrowUp, IconLayoutGrid,
  IconList, IconSortDescending,
  IconSortAscending, IconFolder, IconEdit,
  IconTrash, IconFolderPlus, IconFolderOpen as iconFolderOpen,
} from "@tabler/icons-vue";
import modelPopover from "@/components/modelPopover.vue";
import attachmentList from "@/components/agent/attachmentList.vue";
import { createPastedTextFile, readTextAttachment } from "@/components/agent/textAttachments";
import type { AgentAttachment } from "@/components/agent/types";
import logoUrl from "@toonflow/assets/zeromuIcon.png";
import { useWorkspaceStore, type Project } from "@/stores/workspace";
import { hasDesktopUpdate } from "@/stores/desktopUpdate";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import settings from "@/components/settings/index.vue";
import { settings as appSettings, saveSettings } from "@/stores/settings";
import mountainScene from "./assets/mountainScene.png";
import cityScene from "./assets/cityScene.png";
import workspacePicker from "./workspacePicker.vue";

const settingsVisible = ref(false);
const router = useRouter();
const creating = ref(false);
const opening = ref(false);
const promptWorkspacePicker = ref<InstanceType<typeof workspacePicker>>();
const relocationPicker = ref<InstanceType<typeof workspacePicker>>();
const prompt = ref("");
const promptInput = ref<InputInstance>();
const promptAttachments = ref<AgentAttachment[]>([]);
const workspaceStore = useWorkspaceStore();
const { project, projectList } = storeToRefs(workspaceStore);
const workspaceDirectory = ref(project.value?.directory ?? "");
const settingsPanel = ref("ui");
const lightHome = ref(appSettings.value.homeTheme === "light");
const assetsVisible = ref(false);
const assetLibrary = defineAsyncComponent(() => import("@/pages/workspace/panels/canvas/components/assetLibrary.vue"));
const activeNav = ref("home");
const activeSlide = ref(0);
const projectQuery = ref("");
const showAllPrompts = ref(false);
const promptSection = ref<HTMLElement>();
const projectSection = ref<HTMLElement>();
const composerSection = ref<HTMLElement>();
const modes = [
  { id: "home", label: "无限画布", icon: IconLayoutGrid, placeholder: "描述创作目标，让零幕陪你完成第一幕…" },
  { id: "image", label: "生图创作", icon: IconPhoto, placeholder: "描述画面主体、风格与光线，让想象成为画面…" },
  { id: "video", label: "视频创作", icon: IconVideo, placeholder: "描述镜头、动作与节奏，开始你的短片创作…" },
  { id: "audio", label: "音乐创作", icon: IconMusic, placeholder: "描述音乐风格、情绪与时长，为故事配上声音…" },
];
const currentMode = ref("home");
const promptPlaceholder = computed(() => modes.find(mode => mode.id === currentMode.value)?.placeholder ?? modes[0]!.placeholder);
const slides = [
  { title: "让想象，成为第一幕", detail: "从一句灵感出发，在画布里串联故事、镜头与声音。", image: mountainScene, mode: "home", action: "开始创作" },
  { title: "把光影写进故事", detail: "定下场景与角色，探索属于你的电影感画面。", image: cityScene, mode: "image", action: "构思画面" },
  { title: "你的故事，自由生长", detail: "画布 · 分镜 · AI 助手，连接每一次创作。", image: "", mode: "video", action: "规划短片" },
];
const promptTemplates = [
  { title: "山河入梦", kind: "场景设计", mode: "image", text: "创作一幅东方奇幻山水场景：层叠青山、云海与临水村落，黄昏暖光，电影感构图。先帮我完善画面提示词。" },
  { title: "雨夜的来信", kind: "电影分镜", mode: "video", text: "策划一支 30 秒短片：雨夜城市，一位旅人收到一封迟来的信。请拆解为连贯分镜，写出景别、运镜和情绪变化。" },
  { title: "为故事配一段声音", kind: "音乐构思", mode: "audio", text: "为一段清晨山间旅行短片设计音乐：温暖、安静、有希望，以钢琴和弦乐为主，时长 30 秒。先整理音乐生成提示词。" },
  { title: "建立角色档案", kind: "角色设计", mode: "image", text: "帮我设计一位东方奇幻故事的旅行者，整理年龄、外观、服饰、性格与标志物，并生成保持角色一致性的提示词。" },
  { title: "从产品到短片", kind: "广告策划", mode: "video", text: "帮我策划一支产品短片。请先询问产品、目标受众和时长，再输出创意方向、分镜与生成提示词。" },
  { title: "把灵感展开", kind: "故事创作", mode: "home", text: "我想从一个灵感开始创作故事。请先引导我确定主角、目标和冲突，再帮我在画布上组织角色、场景和分镜。" },
];
const visiblePrompts = computed(() => showAllPrompts.value ? promptTemplates : promptTemplates.slice(0, 3));
function openSettings(panel = "ui") { settingsPanel.value = panel; settingsVisible.value = true; }
function scrollTo(section?: HTMLElement) { section?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" }); }
function selectMode(mode: string) { currentMode.value = mode; activeNav.value = mode; scrollTo(composerSection.value); void nextTick(() => promptInput.value?.focus()); }
function navigate(section: string) {
  activeNav.value = section;
  if (section === "projects") scrollTo(projectSection.value);
  else if (section === "prompts") { showAllPrompts.value = true; scrollTo(promptSection.value); }
  else if (section === "assets") assetsVisible.value = true;
  else if (section === "home") { currentMode.value = "home"; window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); }
  else selectMode(section);
}
async function useTemplate(item: typeof promptTemplates[number]) {
  if (prompt.value.trim() && prompt.value !== item.text) {
    const confirmed = await ElMessageBox.confirm("使用此提示词会替换输入框中的草稿，是否继续？", "替换创作描述", { confirmButtonText: "使用提示词", cancelButtonText: "保留草稿" }).then(() => true, () => false);
    if (!confirmed) return;
  }
  prompt.value = item.text; selectMode(item.mode);
}
async function toggleHomeTheme() {
  const next = !lightHome.value;
  try { await saveSettings(() => ({ homeTheme: next ? "light" : "dark" })); lightHome.value = next; }
  catch { ElMessage.error("外观保存失败，请重试"); }
}
function slidePosition(index: number) { const offset = (index - activeSlide.value + slides.length) % slides.length; return offset === 0 ? "centerSlide" : offset === 1 ? "rightSlide" : "leftSlide"; }
function changeSlide(step: number) { activeSlide.value = (activeSlide.value + step + slides.length) % slides.length; }

const selectedModel = ref("");
const reasoningEffort = ref("");
const sortDescending = ref(true);
const viewMode = ref("grid");
const sortedProjects = computed(() => projectList.value.filter(item => `${item.name} ${item.directory}`.toLowerCase().includes(projectQuery.value.toLowerCase().trim())).sort((left, right) =>
  sortDescending.value ? right.lastOpenedAt - left.lastOpenedAt : left.lastOpenedAt - right.lastOpenedAt
));

function pasteText(event: ClipboardEvent) {
  if (creating.value || opening.value) return;
  try {
    const file = createPastedTextFile(event.clipboardData?.getData("text/plain") ?? "");
    if (!file) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (promptAttachments.value.length >= 20) return ElMessage.warning("每条消息最多添加 20 个附件");
    promptAttachments.value.push({ name: file.name, path: "", mimeType: file.type, file });
  } catch (error) {
    event.preventDefault();
    event.stopImmediatePropagation();
    ElMessage.error(error instanceof Error ? error.message : "添加文本附件失败，请重试");
  }
}

async function restoreAttachment(index: number) {
  const attachment = promptAttachments.value[index];
  if (!attachment || creating.value || opening.value) return;
  try {
    const text = await readTextAttachment(attachment);
    const currentIndex = promptAttachments.value.indexOf(attachment);
    if (currentIndex < 0 || creating.value || opening.value) return;
    prompt.value += `${prompt.value ? "\n" : ""}${text}`;
    promptAttachments.value.splice(currentIndex, 1);
    await nextTick();
    promptInput.value?.focus();
    promptInput.value?.textarea?.setSelectionRange(prompt.value.length, prompt.value.length);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "取回文本失败，请重试");
  }
}

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
    await router.push("/workspace");
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
  if (result) workspaceStore.renameProject(project.directory, result.value);
}

async function createProject(fromPrompt = true) {
  if (creating.value || opening.value || (fromPrompt && !workspaceDirectory.value)) return;
  if (fromPrompt && (prompt.value.trim() || promptAttachments.value.length) && !selectedModel.value) {
    openSettings("languageModel");
    return ElMessage.warning("请先添加一个文本模型，用于驱动创作助手");
  }
  creating.value = true;
  try {
    let path = workspaceDirectory.value;
    if (!fromPrompt) {
      const confirmed = await ElMessageBox.confirm("请选择一个空文件夹作为项目目录，画布和素材将保存在其中。", "添加项目", {
        confirmButtonText: "选择空文件夹", cancelButtonText: "取消", type: "info",
      }).then(() => true, () => false);
      if (!confirmed) return;
      path = await relocationPicker.value?.chooseDirectory() ?? "";
      if (!path) return;
    }
    const { directory, empty } = await useWorkspaceFiles(path).list();
    if (!empty && !(fromPrompt && projectList.value.some(item => item.directory === directory))) return ElMessage.warning("该文件夹不为空，请重新选择空文件夹；已有项目请使用“导入项目”或点击项目列表打开。");
    if (empty) await useWorkspaceFiles(directory).writeJson("画布1.json", { toonflowCanvas: true, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, true);
    await workspaceStore.openProject(directory);
    if (fromPrompt && (prompt.value.trim() || promptAttachments.value.length)) {
      workspaceStore.pendingAgentMessage = { directory: workspaceStore.project!.directory, prompt: currentMode.value === "home" ? prompt.value : `创作方向：${modes.find(mode => mode.id === currentMode.value)?.label}。\n${prompt.value}`, attachments: [...promptAttachments.value], model: selectedModel.value, reasoningEffort: reasoningEffort.value };
    }
    await router.push("/workspace");
  } catch (err) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(err)
      ? err.response?.data.message || "创建项目失败，请重试"
      : err instanceof Error ? err.message : "创建项目失败，请重试");
  } finally {
    creating.value = false;
  }
}
</script>

<style lang="scss" scoped>
.studioHome {
  --homeBg: #101111; --homeSurface: #202120; --homeRaised: #292b29; --homeText: #f1f1ec; --homeMuted: #aaada6; --homeLine: #373a36; --homeAccent: #b6dec9; --homeDot: #343732;
  --el-bg-color: var(--homeSurface); --el-bg-color-overlay: var(--homeRaised); --el-fill-color-blank: var(--homeSurface); --el-fill-color-light: var(--homeRaised); --el-fill-color: var(--homeRaised); --el-text-color-primary: var(--homeText); --el-text-color-regular: var(--homeMuted); --el-text-color-placeholder: var(--homeMuted); --el-text-color-secondary: var(--homeMuted); --el-border-color: var(--homeLine); --el-border-color-light: var(--homeLine); --el-color-primary: var(--homeAccent);
  min-height: 100dvh; background-color: var(--homeBg); background-image: radial-gradient(var(--homeDot) .75px, transparent .75px); background-size: 16px 16px; color: var(--homeText); color-scheme: dark;
  &.lightHome { --homeBg: #f4f5f0; --homeSurface: #fff; --homeRaised: #e7eae3; --homeText: #202820; --homeMuted: #54604f; --homeLine: #ccd2c7; --homeAccent: #23644d; --homeDot: #d2d7cc; color-scheme: light; }
  button { font: inherit; cursor: pointer; } button:disabled { cursor: not-allowed; opacity: .5; } button:focus-visible, a:focus-visible { outline: 2px solid var(--homeAccent); outline-offset: 5px; }
  ::selection { background: #b6dec9; color: #15271e; } h1,h2,h3,p { margin: 0; }
  .skipLink { position: absolute; top: -80px; left: 20px; z-index: 10; padding: 12px; background: var(--homeSurface); color: var(--homeText); &:focus { top: 12px; } }
  .studioHeader { background: var(--homeBg); border-bottom: 1px solid var(--homeLine); }
  .headerInner { max-width: 1420px; margin: auto; padding: 0 32px; min-height: 68px; display: flex; align-items: center; gap: 24px; }
  .brandButton { display: flex; align-items: center; gap: 9px; padding: 0; border: 0; background: none; color: var(--homeText); white-space: nowrap; img { width: 34px; height: 34px; background: #e9f6f1; border-radius: 8px; } strong { font-size: 18px; } }
  .studioNav { display: flex; align-self: stretch; align-items: stretch; flex: 1; gap: 6px; button { display: flex; align-items: center; gap: 7px; white-space: nowrap; padding: 0 11px; border: 0; background: transparent; color: var(--homeMuted); font-size: 13px; position: relative; &:hover, &.selected { color: var(--homeText); } &.selected::after { content: ''; position: absolute; bottom: 0; height: 2px; background: var(--homeAccent); left: 11px; right: 11px; } } }
  .headerTools { display: flex; align-items: center; gap: 6px; }
  .iconButton { display: grid; place-items: center; width: 34px; height: 34px; background: transparent; border: 0; border-radius: 8px; color: var(--homeMuted); &:hover { background: var(--homeRaised); color: var(--homeText); } }
  .homeContent { max-width: 1400px; margin: auto; padding: 0 40px; }
  .showcase { padding-top: 68px; }
  .slideStage { height: clamp(250px,24vw,340px); position: relative; }
  .featureSlide { position: absolute; width: 53%; height: 100%; left: 23.5%; overflow: hidden; border-radius: 16px; background: #192b24; transition: transform .45s ease-out, filter .45s ease-out; .sceneImage { width: 100%; height: 100%; object-fit: cover; } &.centerSlide { z-index: 2; transform: scale(1); filter: brightness(1); } &.leftSlide { transform: translateX(-50%) scale(.88); filter: brightness(.5); z-index: 1; } &.rightSlide { transform: translateX(50%) scale(.88); filter: brightness(.5); z-index: 1; } }
  .slideShade { position: absolute; inset: 0; background: linear-gradient(transparent 20%,rgba(4,12,8,.84)); pointer-events: none; }
  .slideCopy { position: absolute; bottom: 28px; left: 32px; right: 28px; color: #fff; h1,h2 { font-size: clamp(24px,2.3vw,34px); font-weight: 650; line-height: 1.3; letter-spacing: -.025em; } p { font-size: 13px; line-height: 1.7; margin-top: 10px; color: #e0e7df; max-width: 40ch; } button { display: inline-flex; align-items: center; gap: 10px; margin-top: 18px; background: #e2f1e8; color: #183d2c; border: 0; padding: 9px 14px; border-radius: 7px; font-size: 12px; font-weight: 600; } }
  .storyFrames { position: absolute; inset: 28px 28px auto; display: flex; align-items: center; justify-content: center; height: 90px; span { padding: 20px; border: 1px solid #799b89; color: #b6dec9; border-radius: 8px; } i { width: 28px; height: 1px; background: #799b89; } }
  .carouselArrow { position: absolute; top: 44%; z-index: 3; width: 36px; height: 42px; display: grid; place-items: center; border: 0; border-radius: 8px; background: #101111bb; color: #fff; &.previous { left: 0; } &.next { right: 0; } &:hover { background: #29382f; } }
  .slideDots { display: flex; justify-content: center; gap: 8px; padding-top: 22px; button { padding: 8px 0; width: 8px; background: none; border: 0; &::after { content: ''; display: block; height: 5px; border-radius: 4px; background: var(--homeMuted); opacity: .45; } &.active { width: 24px; &::after { opacity: 1; background: var(--homeText); } } } }
  .creationComposer { max-width: 800px; margin: 34px auto 0; scroll-margin-top: 24px; }
  .composerModes { display: flex; gap: 22px; margin: 0 6px 12px; button { padding: 4px 0; background: none; border: 0; color: var(--homeMuted); font-size: 12px; &.active { color: var(--homeAccent); } } }
  .promptCard { border: 1px solid var(--homeLine); border-radius: 16px; background: var(--homeSurface); padding: 18px; &:focus-within { border-color: var(--homeAccent); } :deep(.el-textarea__inner) { background: transparent; color: var(--homeText); box-shadow: none; padding: 0; min-height: 88px !important; font-size: 14px; line-height: 1.8; caret-color: var(--homeAccent); &::placeholder { color: var(--homeMuted); } } }
  .composerFooter { display: flex; gap: 8px; align-items: center; justify-content: space-between; margin-top: 12px; min-width: 0; :deep(.workspaceButton) { max-width: 36%; } }
  .sendActions { display: flex; min-width: 0; align-items: center; gap: 12px; justify-content: flex-end; :deep(.modelPopover) { max-width: 240px; } .sendButton { background: var(--homeAccent); border-color: var(--homeAccent); color: var(--homeBg); flex-shrink: 0; width: 36px; height: 36px; } }
  .composerHint { font-size: 11px; color: var(--homeMuted); margin: 12px 4px 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; line-height: 1.6; button { display: flex; gap: 5px; align-items: center; flex-shrink: 0; background: none; border: 0; padding: 0; color: var(--homeAccent); font-size: 11px; } }
  .promptShelf { border-top: 1px solid var(--homeLine); margin-top: 58px; padding-top: 34px; scroll-margin-top: 28px; }
  .shelfHeading,.sectionHeader { display: flex; align-items: center; justify-content: space-between; gap: 20px; h2 { font-size: 22px; font-weight: 600; letter-spacing: -.02em; } p { margin-top: 10px; font-size: 13px; color: var(--homeMuted); line-height: 1.7; } }
  .textAction { display: inline-flex; align-items: center; gap: 8px; background: none; color: var(--homeAccent); border: 0; padding: 8px 0; white-space: nowrap; font-size: 12px; }
  .promptGrid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 30px; margin-top: 28px; }
  .promptSuggestion { position: relative; display: flex; flex-direction: column; text-align: left; background: var(--homeBg); border: 0; border-top: 1px solid var(--homeLine); color: var(--homeText); padding: 20px 26px 16px 0; &:hover { border-color: var(--homeAccent); } strong { font-size: 16px; font-weight: 500; margin: 9px 0; } .promptKind { color: var(--homeAccent); font-size: 11px; } .promptExcerpt { font-size: 12px; color: var(--homeMuted); line-height: 1.8; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; } .templateArrow { position: absolute; top: 24px; right: 0; transform: rotate(45deg); color: var(--homeMuted); } }
  .projectList { margin-top: 58px; padding-top: 30px; border-top: 1px solid var(--homeLine); scroll-margin-top: 28px; }
  .sectionHeader h2 span { font-size: 12px; margin-left: 10px; color: var(--homeMuted); font-variant-numeric: tabular-nums; }
  .projectToolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; :deep(.el-button + .el-button) { margin-left: 0; } .projectSearch { width: 150px; } }
  .emptyProjects { text-align: center; padding: 44px 20px; color: var(--homeMuted); h3 { color: var(--homeText); font-size: 16px; margin: 15px 0 10px; font-weight: 500; } p { font-size: 12px; margin-bottom: 12px; } }
  .projectItems { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 18px; margin-top: 24px; &.listView { grid-template-columns: 1fr; } }
  .projectCard { background: var(--homeSurface); border-radius: 12px; min-width: 0; display: flex; padding: 18px; }
  .projectEntry { display: flex; align-items: center; gap: 16px; min-width: 0; flex: 1; border: 0; padding: 0; background: none; text-align: left; color: var(--homeText); .projectIcon { flex-shrink: 0; color: var(--homeAccent); } .projectInfo { display: grid; gap: 8px; min-width: 0; } .projectName { font-size: 14px; } .projectPath,.projectTime { font-size: 11px; color: var(--homeMuted); } .projectName,.projectPath { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
  .projectActions { display: flex; flex-direction: column; :deep(.el-button) { margin: 0; padding: 6px; } }
  .homeFooter { display: flex; justify-content: space-between; gap: 16px; padding: 32px 0 24px; margin-top: 20px; border-top: 1px solid var(--homeLine); font-size: 11px; color: var(--homeMuted); button { background: none; border: 0; color: var(--homeMuted); font-size: 11px; } }
  @media (max-width: 1150px) { .headerInner { gap: 14px; flex-wrap: wrap; padding: 12px 24px 0; } .studioNav { order: 3; flex-basis: 100%; overflow-x: auto; min-height: 44px; } .headerTools { margin-left: auto; } .showcase { padding-top: 38px; } .sectionHeader { align-items: flex-start; flex-direction: column; } .projectItems { grid-template-columns: repeat(2,minmax(0,1fr)); } }
  @media (max-width: 640px) { .homeContent { padding: 0 18px; } .headerInner { padding-inline: 18px; } .studioNav { gap: 0; button { padding-inline: 10px; font-size: 12px; } } .showcase { padding-top: 24px; } .slideStage { height: 260px; } .featureSlide { width: 100%; left: 0; &.leftSlide,&.rightSlide { visibility: hidden; transform: none; } } .slideCopy { left: 28px; right: 24px; bottom: 24px; h1,h2 { font-size: 25px; } p { font-size: 12px; } } .carouselArrow { width: 26px; &.previous { left: -12px; } &.next { right: -12px; } } .creationComposer { margin-top: 24px; } .composerModes { gap: 18px; } .promptCard { padding: 14px; } .composerFooter { flex-wrap: wrap; :deep(.workspaceButton) { max-width: 100%; } } .sendActions { width: 100%; justify-content: space-between; } .composerHint { align-items: flex-start; } .shelfHeading { align-items: flex-start; flex-direction: column; gap: 8px; h2 { font-size: 20px; } } .promptGrid { grid-template-columns: 1fr; gap: 4px; margin-top: 18px; } .promptShelf,.projectList { margin-top: 36px; } .projectItems { grid-template-columns: 1fr; } .projectToolbar { width: 100%; .projectSearch { width: 100%; } } .homeFooter { flex-direction: column; align-items: flex-start; } }
  @media (prefers-reduced-motion: reduce) { .featureSlide { transition: none; } }
}
.homeAssets { width: 100% !important; box-sizing: border-box; }
</style>
