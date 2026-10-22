<template>
  <el-dialog v-model="visible" class="imageEditDialog" title="编辑图片候选" width="min(1000px, 96vw)" top="4vh" appendToBody :closeOnClickModal="false" :closeOnPressEscape="!saving" :showClose="!saving" :beforeClose="closeEditor" @closed="emit('close')">
    <section class="imageEditor" aria-label="本地图片编辑">
      <p class="editHint">{{ label }} · 保存为同一镜头的新候选，原图与当前采用结果保留。先裁剪，再顺时针旋转，最后调整输出尺寸。</p>
      <p v-if="loading" role="status">正在准备固定原图与预览…</p>
      <div v-if="context" class="editPreviews"><figure><figcaption>原图与裁剪范围 · {{ context.width }} × {{ context.height }}</figcaption><canvas ref="originalCanvas" role="img" aria-label="原图及当前裁剪范围" /></figure><figure><figcaption>编辑预览 · {{ parameters.output.width }} × {{ parameters.output.height }}</figcaption><canvas ref="resultCanvas" role="img" aria-label="裁剪旋转和缩放后的预览" /></figure></div>
      <section class="backgroundEdit" aria-labelledby="backgroundEditTitle">
        <h3 id="backgroundEditTitle">本机背景移除</h3>
        <p class="editHint">基于固定原图分离主体，忽略下方裁剪参数。输出原尺寸透明 PNG，完成后自动加入同一镜头的新候选，当前采用由你选择。需先在模型配置下载并启用本机背景移除。</p>
        <el-button v-if="!backgroundSubmitted" :loading="backgroundStarting" :disabled="saving || loading || !context || store.busy || store.directory !== sourceDirectory" @click="removeBackground">移除原图背景并创建新候选</el-button>
        <el-button v-else @click="taskCenter.open({ directory: sourceDirectory, id: backgroundTaskId })">查看本次背景移除任务</el-button>
        <p v-if="backgroundSubmitted" class="editHint" role="status">任务已保存，可关闭编辑器。在任务中心查看结果、继续保存或重试候选登记；不会自动采用。</p>
      </section>
      <form @submit.prevent="save">
        <fieldset :disabled="saving || loading || !context">
          <legend>裁剪范围（原图像素，左上角为起点）</legend>
          <div class="editFields"><label>左侧 X<input v-model.number="parameters.crop.x" type="number" min="0" :max="context ? context.width - 1 : 0" step="1" required aria-label="裁剪左侧 X" /></label><label>顶部 Y<input v-model.number="parameters.crop.y" type="number" min="0" :max="context ? context.height - 1 : 0" step="1" required aria-label="裁剪顶部 Y" /></label><label>裁剪宽度<input v-model.number="parameters.crop.width" type="number" min="1" :max="context?.width || 8192" step="1" required aria-label="裁剪宽度" /></label><label>裁剪高度<input v-model.number="parameters.crop.height" type="number" min="1" :max="context?.height || 8192" step="1" required aria-label="裁剪高度" /></label></div>
          <div class="editFields outputFields"><label>顺时针旋转<select v-model.number="parameters.rotation" aria-label="顺时针旋转"><option :value="0">不旋转</option><option :value="90">90°</option><option :value="180">180°</option><option :value="270">270°</option></select></label><label>输出宽度<input v-model.number="parameters.output.width" type="number" min="1" max="8192" step="1" required aria-label="图片输出宽度" @input="resizeOutput('width')" /></label><label>输出高度<input v-model.number="parameters.output.height" type="number" min="1" max="8192" step="1" required aria-label="图片输出高度" @input="resizeOutput('height')" /></label><label class="ratioToggle"><input v-model="keepRatio" type="checkbox" />保持裁剪后比例</label></div>
          <p class="editValidation" aria-live="polite">{{ validation || ' ' }}</p>
          <div class="editActions"><el-button :disabled="!context" @click="reset">恢复原图参数</el-button><el-button :disabled="saving" @click="closeEditor(() => visible = false)">取消</el-button><el-button type="primary" nativeType="submit" :loading="saving" :disabled="!context || !!validation || store.busy || store.directory !== sourceDirectory">保存为新候选</el-button></div>
        </fieldset>
      </form>
      <div v-if="error" ref="errorBox" class="editError" role="alert" tabindex="-1"><p>{{ error }}</p><el-button v-if="!saving" size="small" :loading="loading" @click="prepare">{{ context ? '刷新来源并保留参数' : '重新准备图片' }}</el-button></div>
      <p v-if="store.directory !== sourceDirectory" class="editError" role="alert">项目已切换，请返回来源项目后再保存。</p>
      <p class="editHint">输出为静态 PNG，多帧图片取首帧。预览按窗口缩小显示，保存使用原图像素。蒙版局部重绘与扩图尚未接入；复杂边缘与半透明物体的背景移除结果请预览后再采用。</p>
    </section>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onScopeDispose, reactive, ref, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { ElMessageBox } from "element-plus";
import axios from "axios";
import type { ImageEditContext, ImageEditParameters } from "@toonflow/server/production";
import type { MediaModel, MediaTaskRecord } from "@toonflow/tools-scaffold/runtime";
import { productionError, useProductionStore } from "@/stores/production";
import { useTaskCenterStore } from "@/stores/taskCenter";

const props = defineProps<{ directory: string; candidateId: string; label: string }>();
const emit = defineEmits<{ close: []; saved: [candidateId: string] }>();
const store = useProductionStore();
const taskCenter = useTaskCenterStore();
const sourceDirectory = props.directory; const sourceCandidateId = props.candidateId;
const visible = ref(true); const loading = ref(false); const saving = ref(false); const error = ref("");
const backgroundTaskId = crypto.randomUUID(); const backgroundStarting = ref(false); const backgroundSubmitted = ref(false);
const errorBox = ref<HTMLElement>(); const originalCanvas = ref<HTMLCanvasElement>(); const resultCanvas = ref<HTMLCanvasElement>();
const context = ref<ImageEditContext>(); const contextId = crypto.randomUUID(); const keepRatio = ref(true);
const parameters = reactive<ImageEditParameters>({ crop: { x: 0, y: 0, width: 1, height: 1 }, rotation: 0, output: { width: 1, height: 1 } });
const initialSignature = ref(""); const signature = computed(() => JSON.stringify(parameters));
const dirty = computed(() => !!initialSignature.value && signature.value !== initialSignature.value);
let editId = crypto.randomUUID(); let image: HTMLImageElement | undefined; let reader: AbortController | undefined;
const rotatedSize = computed(() => parameters.rotation % 180 ? { width: parameters.crop.height, height: parameters.crop.width } : { width: parameters.crop.width, height: parameters.crop.height });
const validation = computed(() => {
  if (!context.value) return "";
  const { crop, output } = parameters;
  if (![crop.x, crop.y, crop.width, crop.height, output.width, output.height].every(Number.isInteger)) return "请输入完整的整数像素值";
  if (crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1 || crop.x + crop.width > context.value.width || crop.y + crop.height > context.value.height) return "裁剪范围超出原图，请缩小宽高或调整起点";
  if (output.width < 1 || output.height < 1 || output.width > 8192 || output.height > 8192 || output.width * output.height > 16777216) return "输出边长须为 1–8192 像素，总像素不超过 1677 万";
  return "";
});
function reset() { if (!context.value) return; Object.assign(parameters, { crop: { x: 0, y: 0, width: context.value.width, height: context.value.height }, rotation: 0, output: { width: context.value.width, height: context.value.height } }); }
function resizeOutput(side: "width" | "height") { if (!keepRatio.value || !rotatedSize.value.width || !rotatedSize.value.height) return; if (side === "width") parameters.output.height = Math.max(1, Math.round(parameters.output.width * rotatedSize.value.height / rotatedSize.value.width)); else parameters.output.width = Math.max(1, Math.round(parameters.output.height * rotatedSize.value.width / rotatedSize.value.height)); }
function renderPreviews() {
  if (!image || !context.value || !originalCanvas.value || !resultCanvas.value) return;
  const original = originalCanvas.value; original.width = image.naturalWidth; original.height = image.naturalHeight;
  const source = original.getContext("2d"); if (!source) return;
  source.drawImage(image, 0, 0);
  const result = resultCanvas.value; result.width = 1; result.height = 1;
  if (validation.value) return;
  const { crop, output, rotation } = parameters; const scaleX = original.width / context.value.width; const scaleY = original.height / context.value.height;
  source.strokeStyle = getComputedStyle(original).getPropertyValue("--el-color-primary").trim() || "CanvasText"; source.lineWidth = 3; source.strokeRect(crop.x * scaleX, crop.y * scaleY, crop.width * scaleX, crop.height * scaleY);
  const previewScale = Math.min(1, 600 / output.width, 600 / output.height); result.width = Math.max(1, Math.round(output.width * previewScale)); result.height = Math.max(1, Math.round(output.height * previewScale));
  const target = result.getContext("2d"); if (!target) return;
  target.translate(result.width / 2, result.height / 2); target.rotate(rotation * Math.PI / 180);
  const width = rotation % 180 ? result.height : result.width; const height = rotation % 180 ? result.width : result.height;
  target.drawImage(image, crop.x * scaleX, crop.y * scaleY, crop.width * scaleX, crop.height * scaleY, -width / 2, -height / 2, width, height);
}
async function prepare() {
  if (loading.value || saving.value) return;
  reader?.abort(); const current = reader = new AbortController(); loading.value = true; error.value = "";
  try {
    const { data } = await axios.post<{ data: ImageEditContext }>("/api/production/images/prepare", { directory: sourceDirectory, contextId, candidateId: sourceCandidateId }, { headers: { "x-toonflow-workspace": "1" }, signal: current.signal });
    if (current.signal.aborted) return;
    const value = data.data; const nextImage = new Image(); nextImage.src = value.preview; await nextImage.decode();
    if (current.signal.aborted) return;
    image = nextImage; context.value = value;
    if (!initialSignature.value) { reset(); initialSignature.value = signature.value; }
    await nextTick(); renderPreviews();
  } catch (cause) { if (!current.signal.aborted) { error.value = productionError(cause); await nextTick(); errorBox.value?.focus(); } }
  finally { if (reader === current) loading.value = false; }
}
async function save() {
  if (!context.value || validation.value || saving.value || loading.value) return;
  saving.value = true; error.value = "";
  try { const result = await store.update({ type: "editImageCandidate", contextId, editId, parameters: structuredClone({ ...parameters, crop: { ...parameters.crop }, output: { ...parameters.output } }) }, sourceDirectory, context.value.revision); emit("saved", result.resultId!); }
  catch (cause) { error.value = productionError(cause); await nextTick(); errorBox.value?.focus(); }
  finally { saving.value = false; }
}
async function removeBackground() {
  if (!context.value || saving.value || loading.value || backgroundSubmitted.value || store.directory !== sourceDirectory) return;
  saving.value = true; backgroundStarting.value = true; error.value = "";
  try {
    const models = await axios.get<{ data: MediaModel[] }>("/api/ai/media/models");
    if (!models.data.data.some(model => model.providerId === "biRefNet" && model.modelId === "biRefNetTiny" && model.type === "image")) throw new Error("请先在「模型配置」下载并启用本机背景移除，再返回此编辑器提交。原图与裁剪参数保持完整。");
    const { data } = await axios.post<{ data: MediaTaskRecord }>("/api/ai/media/tasks/start", {
      id: backgroundTaskId, directory: sourceDirectory, mediaType: "image",
      request: { providerId: "biRefNet", modelId: "biRefNetTiny", prompt: "移除背景，保留原图主体", n: 1, images: [{ path: `productionImageEdits/${contextId}/source.png`, mimeType: "image/png" }] },
      source: { kind: "studio", imageEdit: { contextId, sourceCandidateId } },
    }, { headers: { "x-toonflow-workspace": "1" } });
    backgroundSubmitted.value = true;
    if (data.data.error) error.value = data.data.error;
  } catch (cause) { error.value = productionError(cause); await nextTick(); errorBox.value?.focus(); }
  finally { saving.value = false; backgroundStarting.value = false; }
}
async function canClose() { if (saving.value) return false; if (!dirty.value) return true; try { await ElMessageBox.confirm("尚未保存的图片参数将丢弃，原图保持完整。", "关闭图片编辑", { confirmButtonText: "丢弃参数并关闭", cancelButtonText: "继续编辑", type: "warning" }); return true; } catch { return false; } }
async function closeEditor(done: () => void) { if (await canClose()) done(); }
watch(signature, () => { editId = crypto.randomUUID(); void nextTick().then(renderPreviews); });
watch(() => [parameters.crop.width, parameters.crop.height, parameters.rotation], () => { parameters.output = { ...rotatedSize.value }; });
onBeforeRouteLeave(canClose);
onScopeDispose(() => { reader?.abort(); image = undefined; });
void prepare();
</script>

<style scoped lang="scss">
.imageEditor {
  max-height: 76vh; overflow: auto; padding: 0 4px 4px;
  .editHint { font-size: 12px; line-height: 1.7; color: var(--el-text-color-regular); overflow-wrap: anywhere; }
  .backgroundEdit { margin: 20px 0 24px; padding: 16px 0; border-block: 1px solid var(--el-border-color); h3 { margin: 0 0 8px; font-size: 14px; } .el-button { max-width: 100%; min-height: 40px; white-space: normal; } @media (max-width: 600px) { .el-button { min-height: 44px; } } }
  .editPreviews { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(270px, 100%), 1fr)); gap: 16px; margin: 16px 0; figure { margin: 0; min-width: 0; figcaption { font-size: 12px; line-height: 1.7; margin-bottom: 8px; } canvas { display: block; max-width: 100%; max-height: 260px; width: auto; height: auto; background: var(--el-fill-color-light); margin: 0 auto; } } }
  fieldset { border: 0; margin: 0; padding: 0; min-width: 0; legend { font-size: 13px; margin-bottom: 12px; } }
  .editFields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr)); gap: 12px; label { display: grid; gap: 6px; min-width: 0; font-size: 12px; } input:not([type="checkbox"]), select { width: 100%; min-width: 0; box-sizing: border-box; min-height: 36px; padding: 8px; border: 1px solid var(--el-border-color); border-radius: 6px; background: var(--el-fill-color-blank); color: var(--el-text-color-primary); font: inherit; } .ratioToggle { display: flex; align-items: center; gap: 8px; input { accent-color: var(--el-color-primary); } } }
  .outputFields { margin-top: 16px; }
  .editValidation { min-height: 1.7em; color: var(--el-color-danger); font-size: 12px; line-height: 1.7; }
  .editActions { display: flex; flex-wrap: wrap; justify-content: end; gap: 8px; .el-button { margin-left: 0; } }
  .editError { font-size: 13px; line-height: 1.7; color: var(--el-color-danger); overflow-wrap: anywhere; }
  :focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; }
}
</style>
