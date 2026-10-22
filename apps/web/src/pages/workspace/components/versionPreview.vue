<template>
  <section class="versionPreview" :aria-busy="loading">
    <label v-if="fileIndex === undefined && version.files.length > 1">视图<select v-model="selected"><option v-for="(file, index) in version.files" :key="file.path" :value="index">{{ file.view || `文件 ${index + 1}` }}</option></select></label><p v-else-if="file?.view" class="previewHint">{{ file.view }}</p>
    <p v-if="loading" class="previewHint">正在读取预览…</p>
    <p v-else-if="error" class="previewError" role="alert">{{ error }}</p>
    <div v-else-if="url && file?.mimeType.startsWith('image/')" class="imageViewport" :tabindex="imageZoom > 1 ? 0 : undefined" :aria-label="`${label}图片预览，可滚动查看放大区域`"><img :src="url" :alt="label" :style="{ width: `${imageZoom * 100}%`, maxHeight: imageZoom <= 1 ? '260px' : 'none' }" @error="error = '图片无法读取，请检查版本文件'" /></div>
    <video v-else-if="url && file?.mimeType.startsWith('video/')" ref="media" :key="url" :src="url" controls preload="metadata" @loadedmetadata="readDuration" @timeupdate="readMediaState" @play="emit('playing'); readMediaState()" @pause="readMediaState" @ended="readMediaState" @error="error = '视频无法读取，请检查版本文件'" />
    <audio v-else-if="url && file?.mimeType.startsWith('audio/')" ref="media" :key="url" :src="url" controls preload="metadata" @loadedmetadata="readDuration" @timeupdate="readMediaState" @play="emit('playing'); readMediaState()" @pause="readMediaState" @ended="readMediaState" @error="error = '音频无法读取，请检查版本文件'" />
    <p v-else-if="!file" class="previewHint">此版本仅含文字设定</p>
    <p v-else class="previewHint">此文件暂不支持内嵌预览</p>
    <p v-if="version.text" class="versionText">{{ version.text }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import type { AssetVersion } from "@toonflow/server/production";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { productionError } from "@/stores/production";
const props = withDefaults(defineProps<{ directory: string; version: AssetVersion; label: string; active?: boolean; fileIndex?: number; imageZoom?: number }>(), { active: true, imageZoom: 1 });
const emit = defineEmits<{ duration: [seconds: number]; playing: []; mediaState: [value: { currentTime: number; paused: boolean }] }>();
const media = ref<HTMLMediaElement>();
function readMediaState() { if (media.value) emit("mediaState", { currentTime: media.value.currentTime, paused: media.value.paused }); }
function readDuration(event: Event) { const seconds = (event.target as HTMLMediaElement).duration; if (Number.isFinite(seconds)) emit("duration", seconds); readMediaState(); }
function pause() { media.value?.pause(); }
function seek(seconds: number) { if (media.value && Number.isFinite(media.value.duration)) media.value.currentTime = Math.min(Math.max(0, seconds), media.value.duration); }
async function play(muted: boolean) { if (!media.value || !Number.isFinite(media.value.duration)) throw new Error("媒体尚未就绪，请等待加载完成"); media.value.muted = muted; if (media.value.currentTime < media.value.duration) await media.value.play(); }
defineExpose({ pause, seek, play });
const selected = ref(0);
const file = computed(() => props.version.files[props.fileIndex ?? selected.value]);
const url = ref("");
const loading = ref(false);
const error = ref("");
let epoch = 0;
let release: (() => void) | undefined;
watch(() => props.version.versionId, () => { selected.value = 0; });
watch([() => props.directory, file, () => props.active], async () => {
  pause();
  release?.(); release = undefined;
  const request = ++epoch;
  url.value = ""; error.value = ""; loading.value = false;
  if (!props.active || !props.directory || !file.value || !/^(image|video|audio)\//.test(file.value.mimeType)) return;
  loading.value = true;
  const files = useWorkspaceFiles(props.directory);
  const acquired = file.value.mimeType.startsWith("image/") ? files.acquireUrl(file.value.path, file.value.mimeType) : undefined;
  release = acquired?.release;
  // 视频和音频使用可分段读取的预览地址；不把整个片段下载到浏览器内存。
  try { const value = await (acquired?.url ?? files.previewUrl(file.value.path)); if (request === epoch) url.value = value; }
  catch (cause) { if (request === epoch) error.value = productionError(cause); }
  finally { if (request === epoch) loading.value = false; }
}, { immediate: true });
onScopeDispose(() => { pause(); ++epoch; release?.(); });
</script>

<style scoped lang="scss">
.versionPreview {
  min-width: 0;
  label { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; select { flex: 1; min-width: 0; } }
  .imageViewport { max-height: 320px; overflow: auto; border-radius: 6px; background: var(--el-fill-color-light); img { display: block; max-width: none; object-fit: contain; } &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; } }
  video { display: block; width: 100%; max-height: 260px; object-fit: contain; background: var(--el-fill-color-light); border-radius: 6px; }
  audio { width: 100%; }
  .previewHint, .versionText { color: var(--el-text-color-secondary); white-space: pre-wrap; overflow-wrap: anywhere; }
  .versionText { max-height: 180px; overflow: auto; }
  .previewError { color: var(--el-color-danger); }
}
</style>
