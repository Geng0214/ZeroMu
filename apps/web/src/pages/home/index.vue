<template>
  <libraryShell :settingsHandler="openSettings">
    <div class="studioHome">
      <button class="skipLink" @click="selectMode(currentMode)">跳到创作输入框</button>
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
          <div class="composerModes" aria-label="创作类型"><button v-for="mode in modes" :key="mode.id" :class="{ active: currentMode === mode.id }" :aria-pressed="currentMode === mode.id" :disabled="creating || opening" @click="selectMode(mode.id)">{{ mode.id === 'home' ? '自由创作' : mode.label }}</button></div>
          <div class="promptCard"><attachmentList v-if="promptAttachments.length" :attachments="promptAttachments" removable restorable :disabled="creating || opening" @remove="promptAttachments.splice($event, 1)" @restore="restoreAttachment" /><el-input ref="promptInput" v-model="prompt" type="textarea" :rows="3" resize="none" :disabled="creating || opening" :placeholder="promptPlaceholder" aria-label="创作描述" @paste.capture="pasteText" /><div class="composerFooter"><router-link class="openCanvases" to="/canvas"><icon-layout-grid :size="16" />打开已有画布</router-link><div class="sendActions"><modelPopover v-model="selectedModel" v-model:reasoningEffort="reasoningEffort" :disabled="creating || opening" /><el-button class="sendButton" type="primary" circle :icon="IconArrowUp" :loading="creating" :disabled="creating || opening" aria-label="开始创作" @click="createCanvasFromPrompt" /></div></div></div>
        </section>
        <footer class="homeFooter">
          <p class="footerSignature"><span>零幕 ZEROMU</span><small>从零开始，创造第一幕。</small></p>
          <div class="footerLinks"><el-badge isDot :hidden="!hasDesktopUpdate"><button @click="openSettings('about')"><icon-info-circle :size="18" />关于零幕</button></el-badge></div>
        </footer>
      </div>
      <settings v-model="settingsVisible" :initialPanel="settingsPanel" />
    </div>
  </libraryShell>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, type InputInstance } from "element-plus";
import {
  IconPhoto, IconVideo, IconMusic, IconArrowRight, IconChevronLeft, IconChevronRight,
  IconArrowUp, IconLayoutGrid, IconInfoCircle,
} from "@tabler/icons-vue";
import modelPopover from "@/components/modelPopover.vue";
import attachmentList from "@/components/agent/attachmentList.vue";
import { createPastedTextFile, readTextAttachment } from "@/components/agent/textAttachments";
import type { AgentAttachment } from "@/components/agent/types";
import libraryShell from "@/components/libraryShell.vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { hasDesktopUpdate } from "@/stores/desktopUpdate";
import { ensureCanvasDirectory } from "@/lib/canvasStorage";
import createNumberedCanvas from "@/pages/workspace/createCanvas";
import settings from "@/components/settings/index.vue";
import mountainScene from "./assets/mountainScene.png";
import cityScene from "./assets/cityScene.png";

const settingsVisible = ref(false);
const router = useRouter();
const route = useRoute();
const creating = ref(false);
const opening = ref(false);
const prompt = ref("");
const promptInput = ref<InputInstance>();
const promptAttachments = ref<AgentAttachment[]>([]);
const workspaceStore = useWorkspaceStore();
const settingsPanel = ref("ui");
const activeSlide = ref(0);
const composerSection = ref<HTMLElement>();
const modes = [
  { id: "home", label: "无限画布", icon: IconLayoutGrid, placeholder: "描述创作目标，让零幕陪你完成第一幕…" },
  { id: "director", label: "导演台", icon: IconVideo, placeholder: "描述故事、题材、目标受众或已有剧本，让导演助手规划创作方向…" },
  { id: "image", label: "生图创作", icon: IconPhoto, placeholder: "描述画面主体、风格与光线，让想象成为画面…" },
  { id: "video", label: "视频创作", icon: IconVideo, placeholder: "描述镜头、动作与节奏，开始你的短片创作…" },
  { id: "audio", label: "音频创作", icon: IconMusic, placeholder: "输入旁白或对白，为故事生成声音…" },
];
const currentMode = ref("home");
const promptPlaceholder = computed(() => modes.find(mode => mode.id === currentMode.value)?.placeholder ?? modes[0]!.placeholder);
const slides = [
  { title: "让想象，成为第一幕", detail: "从一句灵感出发，在画布里串联故事、镜头与声音。", image: mountainScene, mode: "home", action: "开始创作" },
  { title: "把光影写进故事", detail: "定下场景与角色，探索属于你的电影感画面。", image: cityScene, mode: "image", action: "构思画面" },
  { title: "你的故事，自由生长", detail: "画布 · 分镜 · AI 助手，连接每一次创作。", image: "", mode: "video", action: "规划短片" },
];
function openSettings(panel = "ui") { settingsPanel.value = panel; settingsVisible.value = true; }
function scrollTo(section?: HTMLElement) { section?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" }); }
function selectMode(mode: string) {
  if (mode === "image" || mode === "video" || mode === "audio") {
    void router.push({ path: `/studio/${mode}`, query: prompt.value.trim() ? { prompt: prompt.value } : {} });
    return;
  }
  currentMode.value = mode; scrollTo(composerSection.value); void nextTick(() => promptInput.value?.focus());
}
watch(() => route.query.prompt, value => { if (typeof value === "string") prompt.value = value; }, { immediate: true });
function slidePosition(index: number) { const offset = (index - activeSlide.value + slides.length) % slides.length; return offset === 0 ? "centerSlide" : offset === 1 ? "rightSlide" : "leftSlide"; }
function changeSlide(step: number) { activeSlide.value = (activeSlide.value + step + slides.length) % slides.length; }

const selectedModel = ref("");
const reasoningEffort = ref("");
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

async function createCanvasFromPrompt() {
  if (creating.value || opening.value) return;
  if (!workspaceStore.project) { await router.push({ path: "/projects", query: { next: "/home" } }); return; }
  if ((prompt.value.trim() || promptAttachments.value.length) && !selectedModel.value) {
    openSettings("mediaChannel");
    return ElMessage.warning("请先添加一个文本模型，用于驱动创作助手");
  }
  creating.value = true;
  try {
    const directory = await ensureCanvasDirectory();
    await workspaceStore.openProject(directory);
    const canvas = await createNumberedCanvas(workspaceStore.project!.directory);
    if ((prompt.value.trim() || promptAttachments.value.length)) {
      const agentPrompt = currentMode.value === "director"
        ? `请以 AI 导演身份，根据我的目标协助构思、编写或改编剧本、规划分镜并优化镜头提示词；先提供可审阅的方案，再按我的指示组织画布制作。\n创作要求：\n${prompt.value}`
        : currentMode.value === "home" ? prompt.value : `创作方向：${modes.find(mode => mode.id === currentMode.value)?.label}。\n${prompt.value}`;
      workspaceStore.pendingAgentMessage = { directory: workspaceStore.project!.directory, prompt: agentPrompt, attachments: [...promptAttachments.value], model: selectedModel.value, reasoningEffort: reasoningEffort.value };
    }
    await router.push({ path: "/workspace", query: { canvas: canvas.id } });
  } catch (err) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(err)
      ? err.response?.data.message || "创建画布失败，请重试"
      : err instanceof Error ? err.message : "创建画布失败，请重试");
  } finally {
    creating.value = false;
  }
}
</script>

<style lang="scss" scoped>
.studioHome {
  width: 100%; max-width: 1400px; min-width: 0; flex: 1 0 auto; display: flex; flex-direction: column; margin: 0 auto;
  button { font: inherit; cursor: pointer; } button:disabled { cursor: not-allowed; opacity: .5; } button:focus-visible, a:focus-visible { outline: 2px solid var(--homeAccent); outline-offset: 5px; }
  h1, h2, h3, p { margin: 0; }
  .skipLink { position: absolute; top: -80px; left: 20px; z-index: 10; padding: 12px; background: var(--homeSurface); color: var(--homeText); &:focus { top: 12px; } }
  .homeContent { box-sizing: border-box; width: 100%; max-width: 1400px; flex: 1; min-height: 0; min-width: 0; margin: 0 auto; padding: clamp(4px,1dvh,12px) 0 0; display: grid; grid-template-rows: auto auto minmax(min-content,1fr); gap: clamp(12px,2dvh,20px); }
  .showcase { min-width: 0; display: flex; flex-direction: column; justify-content: center; }
  .slideStage { --slideWidth: min(100%, clamp(560px, 62%, 760px)); flex: 0 0 auto; height: clamp(200px,36dvh,340px); min-height: min-content; position: relative; display: grid; }
  .featureSlide {
    grid-area: 1 / 1; position: relative; width: var(--slideWidth); min-width: 0; min-height: 240px; left: calc((100% - var(--slideWidth)) / 2); display: flex; align-items: flex-end; overflow: hidden; border-radius: 16px; background: #192b24;
    transition: left .45s ease-out, transform .45s ease-out, filter .45s ease-out;
    .sceneImage { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; }
    &.centerSlide { z-index: 2; transform: scale(1); filter: brightness(1); }
    &.leftSlide { left: 0; transform: scale(.88); transform-origin: left center; filter: brightness(.5); z-index: 1; }
    &.rightSlide { left: calc(100% - var(--slideWidth)); transform: scale(.88); transform-origin: right center; filter: brightness(.5); z-index: 1; }
  }
  .slideShade { position: absolute; inset: 0; background: linear-gradient(transparent 20%,rgba(4,12,8,.84)); pointer-events: none; }
  .slideCopy { position: relative; width: 100%; min-width: 0; box-sizing: border-box; padding: 28px 32px; color: #fff; h1,h2 { font-size: clamp(24px,2.3vw,34px); font-weight: 650; line-height: 1.3; letter-spacing: -.025em; text-wrap: balance; } p { font-size: 13px; line-height: 1.7; margin-top: 10px; color: #e0e7df; text-wrap: pretty; } button { display: inline-flex; align-items: center; gap: 10px; min-height: 40px; margin-top: 18px; background: #e2f1e8; color: #183d2c; border: 0; padding: 9px 14px; border-radius: calc(var(--ui-radius, 8px) * 0.875); font-size: 12px; font-weight: 600; } }
  .storyFrames { position: absolute; inset: 28px 28px auto; display: flex; align-items: center; justify-content: center; height: 90px; span { padding: 20px; border: 1px solid #799b89; color: #b6dec9; border-radius: var(--ui-radius, 8px); } i { width: 28px; height: 1px; background: #799b89; } }
  .carouselArrow { position: absolute; top: 44%; z-index: 3; width: 36px; height: 42px; display: grid; place-items: center; border: 0; border-radius: var(--ui-radius, 8px); background: #101111bb; color: #fff; &.previous { left: 0; } &.next { right: 0; } &:hover { background: #29382f; } }
  .slideDots { display: flex; justify-content: center; gap: 8px; padding-top: 8px; flex-shrink: 0; button { padding: 8px 0; width: 8px; background: none; border: 0; &::after { content: ''; display: block; height: 5px; border-radius: 4px; background: var(--homeMuted); opacity: .45; } &.active { width: 24px; &::after { opacity: 1; background: var(--homeText); } } } }
  .creationComposer { width: 100%; max-width: 800px; min-width: 0; margin: 0 auto; scroll-margin-top: 24px; }
  .composerModes { display: flex; flex-wrap: wrap; gap: 6px 22px; margin: 0 6px 12px; button { padding: 4px 0; background: none; border: 0; color: var(--homeMuted); font-size: 12px; white-space: nowrap; &.active { color: var(--homeAccent); } } }
  .promptCard { border: 1px solid var(--homeLine); border-radius: 16px; background: var(--homeSurface); padding: 18px; &:focus-within { border-color: var(--homeAccent); } :deep(.el-textarea__inner) { background: transparent; color: var(--homeText); box-shadow: none; padding: 0; height: clamp(48px,10dvh,88px); min-height: 48px !important; font-size: 14px; line-height: 1.8; caret-color: var(--homeAccent); &::placeholder { color: var(--homeMuted); } } }
  .composerFooter { display: flex; gap: 12px; align-items: center; justify-content: space-between; margin-top: 12px; min-width: 0; }
  .openCanvases { display: inline-flex; align-items: center; gap: 7px; min-height: 36px; color: var(--homeMuted); font-size: 12px; text-decoration: none; white-space: nowrap; &:hover { color: var(--homeAccent); } }
  .sendActions { display: flex; min-width: 0; align-items: center; gap: 12px; justify-content: flex-end; :deep(.modelPopover) { max-width: 240px; } .sendButton { background: var(--homeAccent); border-color: var(--homeAccent); color: var(--homeBg); flex-shrink: 0; width: 36px; height: 36px; } }
  .homeFooter { width: 100%; align-self: end; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding: 12px 0 2px; border-top: 1px solid var(--homeLine);
    button { background: none; border: 0; color: var(--homeMuted); &:hover { color: var(--homeText); } }
    .footerSignature { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; min-width: 0; font-size: 12px; color: var(--homeMuted); small { font-size: inherit; line-height: 1.5; } }
    .footerLinks { display: flex; align-items: center; gap: 14px; flex-shrink: 0; button { min-height: 36px; padding: 6px 0; font-size: 12px; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; } :deep(.el-badge__content.is-fixed) { right: -2px; top: 7px; } }
  }
  @media (max-height: 700px) {
    .featureSlide { min-height: 200px; }
    .slideCopy { padding: 20px 24px; h1,h2 { font-size: 24px; } p { margin-top: 6px; } button { margin-top: 10px; } }
    .storyFrames { inset: 12px 20px auto; height: 54px; span { padding: 10px; } }
    .promptCard { padding: 12px 16px; }
    .composerFooter { margin-top: 6px; }
  }
  @media (max-width: 760px) {
    .slideStage { --slideWidth: 100%; }
    .featureSlide { &.leftSlide,&.rightSlide { visibility: hidden; transform: none; } }
    .slideCopy { padding: 24px 32px; h1,h2 { font-size: 24px; } }
    .carouselArrow { top: auto; bottom: -44px; width: 44px; height: 44px; background: transparent; color: var(--homeMuted); &.previous { left: 0; } &.next { right: 0; } &:hover { background: var(--homeRaised); color: var(--homeText); } }
    .slideDots { height: 44px; padding-top: 0; align-items: center; gap: 0; button { width: 32px; height: 44px; &::after { width: 8px; margin-inline: auto; } &.active { width: 40px; &::after { width: 24px; } } } }
  }
  @media (max-width: 640px) {
    .composerModes { justify-content: space-between; gap: 8px; margin-bottom: 8px; button { min-height: 32px; } }
    .promptCard { padding: 12px; }
    .composerFooter { flex-wrap: wrap; :deep(.workspaceButton) { max-width: 100%; } }
    .sendActions { width: 100%; justify-content: space-between; .sendButton { width: 44px; height: 44px; } }
    .homeFooter { gap: 12px; padding-top: 12px; .footerSignature { flex-direction: column; gap: 4px; font-size: 11px; small { font-size: 10px; } } .footerLinks { gap: 10px; button { min-height: 44px; font-size: 11px; } } }
  }
  @media (prefers-reduced-motion: reduce) { .featureSlide { transition: none; } }
}
</style>
