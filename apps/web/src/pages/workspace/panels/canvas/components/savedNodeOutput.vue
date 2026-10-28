<template>
  <div class="savedNodeOutput nodrag nopan" @pointerdown.stop @mousedown.stop>
    <p v-if="media.length || text || inlineText">已保存的成果可以继续查看。恢复编辑需安装并启用原节点插件。</p>
    <div v-for="item in media" :key="item.path"><img v-if="item.kind === 'image' && urls[item.path]" :src="urls[item.path]" loading="lazy" :alt="label || '已保存图片'" @error="error = '已保存图片无法读取，请检查工作空间媒体'" /><video v-else-if="item.kind === 'video' && urls[item.path]" :src="urls[item.path]" controls preload="none" aria-label="已保存视频" /><audio v-else-if="item.kind === 'audio' && urls[item.path]" :src="urls[item.path]" controls preload="none" aria-label="已保存音频" /></div><pre v-if="text || inlineText">{{ text || inlineText }}</pre><p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>
<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { useWorkspaceStore } from "@/stores/workspace";
const props = defineProps<{ outputs?: Record<string, unknown>; textPath?: string; label?: string }>(); const workspace = useWorkspaceStore(); const urls = ref<Record<string, string>>({}); const text = ref(""); const error = ref(""); let epoch = 0;
const media = computed(() => Object.values(props.outputs ?? {}).flatMap(output => { if (!output || typeof output !== "object") return []; const item = output as { dataType?: string; value?: { url?: string } }; const kind = ({ IMAGE: "image", VIDEO: "video", AUDIO: "audio" } as Record<string, string>)[item.dataType || ""]; return kind && item.value && typeof item.value.url === "string" ? [{ kind, path: item.value.url }] : []; }));
const inlineText = computed(() => Object.values(props.outputs ?? {}).flatMap(output => { const item = output as { dataType?: string; value?: unknown } | null; return item?.dataType === "STRING" && typeof item.value === "string" ? [item.value.slice(0, 65536)] : []; }).join("\n"));
watch([media, () => props.textPath, () => workspace.project?.directory], async () => { const token = ++epoch; const directory = workspace.project?.directory; urls.value = {}; text.value = ""; error.value = ""; if (!directory) return; const files = useWorkspaceFiles(directory); try { const entries = await Promise.all(media.value.map(async item => [item.path, /^data:(?:image|video|audio)\//i.test(item.path) ? item.path : await files.previewUrl(item.path)] as const)); const content = props.textPath ? await files.readText(props.textPath, 65536) : ""; if (token === epoch && directory === workspace.project?.directory) { urls.value = Object.fromEntries(entries); text.value = content; } } catch (cause) { if (token === epoch) error.value = cause instanceof Error ? cause.message : "已保存媒体无法读取"; } }, { immediate: true });
onScopeDispose(() => { ++epoch; });
</script>
<style scoped lang="scss">
.savedNodeOutput { img, video { display: block; width: 100%; max-height: 260px; object-fit: contain; margin-top: 12px; background: #000; } audio { width: 100%; margin-top: 12px; } p { font-size: 12px; line-height: 1.6; margin: 12px 0; } pre { max-height: 220px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: 12px; } }
</style>
