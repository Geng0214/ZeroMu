<template>
  <el-dialog v-model="visible" title="模型能力" width="min(800px, 94vw)" appendToBody destroyOnClose :closeOnClickModal="false" :closeOnPressEscape="!saving" :showClose="!saving" class="capabilityDialog">
    <div class="capabilityEditor">
      <p>按渠道文档或实际验收填写能力。未声明的项目使用渠道默认值；保存声明不代表真实生成已验证。</p>
      <label>模型<select v-model="selectedId" aria-label="配置能力的模型" :disabled="saving"><option v-for="model in channel.models" :key="model.id" :value="model.id">{{ model.label || model.id }} · {{ model.id }}</option></select></label>
      <p v-if="selected?.type === 'text'">文本模型在此保留媒体能力为空；对话参数仍由文本模型设置管理。</p>
      <label>能力声明（JSON）<textarea v-model="draft" aria-label="模型能力声明" rows="13" spellcheck="false" maxlength="1048576" :disabled="saving || !selected" @input="error = ''" /></label>
      <details><summary>可填写的能力字段</summary><dl><dt>mode</dt><dd>text、singleImage、multiReference，或视频的首尾帧模式与 imageReference:数量 / videoReference:数量 / audioReference:数量 组合。</dd><dt>imageSizes / imageRatios / videoRatios</dt><dd>渠道明确支持的尺寸档位及宽高比数组。</dd><dt>imageSizeRange</dt><dd>自定义图片宽高范围：min、max、step，单位像素；仅在渠道支持任意对齐尺寸时填写。</dd><dt>maxImageCount / imageReferenceLimit / imageQualities</dt><dd>图片生成数量上限、参考图片数量上限、low / medium / high 中实际支持的画质数组。</dd><dt>durationResolutionMap / audio</dt><dd>每组 duration 秒数数组与 resolution 档位数组；视频声音为 true、false 或 optional。</dd><dt>voices / audioFormats / audioSpeedRange</dt><dd>音色数组中的每项为 title 与 voice；支持的格式数组；语速范围为 min 与 max。</dd></dl></details>
      <p v-if="error || saveError" class="capabilityError" role="alert">{{ error || saveError }}</p>
    </div>
    <template #footer><el-button :disabled="saving" @click="visible = false">取消</el-button><el-button type="primary" :loading="saving" :disabled="!selected" @click="save">保存模型能力</el-button></template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { mediaCapabilityFields } from "@toonflow/providers/mediaCapabilities";
import type { MediaChannelModel, MediaChannelRow } from "./types";
const props = defineProps<{ channel: MediaChannelRow; saving?: boolean; saveError?: string }>();
const emit = defineEmits<{ save: [models: MediaChannelModel[]] }>();
const visible = defineModel<boolean>({ default: false });
const selectedId = ref(""); const draft = ref(""); const error = ref(""); const drafts = new Map<string, string>();
const selected = computed(() => props.channel.models.find(model => model.id === selectedId.value));
function loadDraft() { const record = selected.value as Record<string, unknown> | undefined; draft.value = drafts.get(selectedId.value) ?? JSON.stringify(Object.fromEntries(mediaCapabilityFields.filter(field => record?.[field] !== undefined).map(field => [field, record![field]])), null, 2); error.value = ""; }
watch(visible, value => { if (value) { selectedId.value = ""; drafts.clear(); selectedId.value = props.channel.models[0]?.id ?? ""; loadDraft(); } }, { immediate: true });
watch(selectedId, (_id, previous) => { if (previous) drafts.set(previous, draft.value); loadDraft(); }, { flush: "sync" });
function save() {
  if (!selected.value || props.saving) return;
  try {
    drafts.set(selectedId.value, draft.value);
    const models = props.channel.models.map(model => {
      if (!drafts.has(model.id)) return model;
      let parsed: unknown; try { parsed = JSON.parse(drafts.get(model.id)!); } catch { throw new Error(`${model.id}：能力声明无法解析，请检查 JSON`); }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${model.id}：能力声明须为 JSON 对象；没有声明时填写空对象`);
      const unknown = Object.keys(parsed).filter(field => !(mediaCapabilityFields as readonly string[]).includes(field));
      if (unknown.length) throw new Error(`${model.id}：无法识别的能力字段 ${unknown.join("、")}`);
      const next: Record<string, unknown> = { ...model }; for (const field of mediaCapabilityFields) delete next[field]; return { ...next, ...parsed } as MediaChannelModel;
    });
    emit("save", models);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "能力声明无法解析"; }
}
</script>

<style scoped lang="scss">
.capabilityEditor { max-height: 65vh; overflow: auto; p, dd { font-size: 13px; line-height: 1.7; color: var(--el-text-color-secondary); } > p { margin: 0 0 20px; max-width: 68ch; } label { display: grid; gap: 8px; margin-bottom: 20px; font-size: 13px; } select, textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; background: var(--el-fill-color-blank); border: 1px solid var(--el-border-color); border-radius: var(--el-border-radius-base); color: var(--el-text-color-primary); font: inherit; &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; } } textarea { resize: vertical; min-height: 160px; font-family: var(--font-mono, monospace); line-height: 1.6; } details { margin: 16px 0; font-size: 13px; summary { cursor: pointer; } dt { margin-top: 18px; font-weight: 600; overflow-wrap: anywhere; } dd { margin: 6px 0 0; overflow-wrap: anywhere; } } .capabilityError { color: var(--el-color-danger); overflow-wrap: anywhere; } }
</style>
