<template>
  <el-dialog v-model="visible" title="拆分图片" width="min(880px, calc(100vw - 24px))" alignCenter appendToBody :closeOnClickModal="false" :closeOnPressEscape="!saving" :showClose="!saving" @closed="emit('close')">
    <section class="imageSplit" aria-label="图片拆分" @keydown.stop @pointerdown.stop @dblclick.stop>
      <p class="splitHint">按从左到右、从上到下的顺序生成独立 PNG 节点。原图保留，可整批撤销。</p>
      <p v-if="loading" role="status">正在读取原图…</p>
      <div v-if="previewUrl" class="splitPreview" :style="{ aspectRatio: `${width} / ${height}` }">
        <img :src="previewUrl" alt="待拆分原图" />
        <span v-for="(tile, index) in tiles" :key="index" class="tileOutline" :style="{ left: `${tile.x / width * 100}%`, top: `${tile.y / height * 100}%`, width: `${tile.width / width * 100}%`, height: `${tile.height / height * 100}%` }" aria-hidden="true"><b>{{ index + 1 }}</b></span>
      </div>
      <fieldset :disabled="loading || saving || !previewUrl">
        <legend>拆分设置</legend>
        <div class="splitPresets"><el-button v-for="preset in presets" :key="preset.label" @click="rows = preset.rows; columns = preset.columns">{{ preset.label }}</el-button></div>
        <div class="splitFields">
          <label>行数<input v-model.number="rows" type="number" min="1" max="8" step="1" aria-label="拆分行数" /></label>
          <label>列数<input v-model.number="columns" type="number" min="1" max="8" step="1" aria-label="拆分列数" /></label>
          <label>每格每边裁去（像素）<input v-model.number="inset" type="number" min="0" max="256" step="1" aria-label="每格每边裁去像素" /></label>
        </div>
      </fieldset>
      <p v-if="validation" class="splitError" role="alert">{{ validation }}</p>
      <p v-else-if="tiles.length" class="splitHint" aria-live="polite">原图 {{ width }} × {{ height }} · 共 {{ tiles.length }} 张 · 首张 {{ tiles[0]!.width }} × {{ tiles[0]!.height }} 像素</p>
      <p class="splitHint">本地处理，不调用模型。可裁去每格周围的分镜边框；多帧图片使用首帧。</p>
      <p v-if="saving" role="status">正在保存 {{ savedCount }} / {{ tiles.length }} 张…</p>
      <div v-if="error" class="splitError" role="alert"><p>{{ error }}</p><el-button v-if="!previewUrl" :disabled="loading || saving" @click="prepare">重新读取</el-button></div>
    </section>
    <template #footer><el-button :disabled="saving" @click="visible = false">取消</el-button><el-button type="primary" :loading="saving" :disabled="loading || !previewUrl || !!validation" @click="save">拆分并添加到画布</el-button></template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, ref } from "vue";
import { getTransformForBounds, useVueFlow, type Node } from "@vue-flow/core";
import { ElButton, ElDialog } from "element-plus";
import { uploadNodeFile } from "@toonflow/nodes-scaffold/workspaceFiles";
import { isNodeOutput } from "@toonflow/nodes-scaffold/values";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { productionError } from "@/stores/production";
import { imageTiles } from "../imageSplit";

const props = defineProps<{
  nodeId: string;
  directory: string;
  nodeType: string;
  signal: AbortSignal;
  loadNodes: (types: string[]) => Promise<void>;
  batchHistory: (action: () => Promise<void>) => Promise<void>;
}>();
const emit = defineEmits<{ close: [] }>();
const flow = useVueFlow();
const sourceNode = flow.findNode(props.nodeId);
const sourceOutput = sourceNode?.data.outputs?.image;
const source = isNodeOutput(sourceOutput) && sourceOutput.dataType === "IMAGE" ? { ...sourceOutput.value } : undefined;
const files = useWorkspaceFiles(props.directory);
const controller = new AbortController();
const signal = AbortSignal.any([props.signal, controller.signal]);
const visible = ref(true);
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const previewUrl = ref("");
const width = ref(0);
const height = ref(0);
const rows = ref(2);
const columns = ref(2);
const inset = ref(0);
const savedCount = ref(0);
const presets = [{ label: "四宫格", rows: 2, columns: 2 }, { label: "九宫格", rows: 3, columns: 3 }, { label: "横向三格", rows: 1, columns: 3 }, { label: "纵向三格", rows: 3, columns: 1 }];
let bitmap: ImageBitmap | undefined;
const grid = computed(() => {
  if (!width.value || !height.value) return { tiles: [], error: "" };
  try { return { tiles: imageTiles(width.value, height.value, rows.value, columns.value, inset.value), error: "" }; }
  catch (cause) { return { tiles: [], error: cause instanceof Error ? cause.message : "拆分参数无效" }; }
});
const tiles = computed(() => grid.value.tiles);
const validation = computed(() => grid.value.error);

function ensureSource() {
  signal.throwIfAborted();
  const current = flow.findNode(props.nodeId);
  const output = current?.data.outputs?.image;
  if (!source || !sourceNode || current !== sourceNode || !isNodeOutput(output) || output.dataType !== "IMAGE" || output.value.url !== source.url || output.value.mimeType !== source.mimeType) {
    throw new Error("来源图片已变化，请关闭后重新选择图片");
  }
}

async function prepare() {
  if (loading.value || saving.value) return;
  loading.value = true;
  error.value = "";
  try {
    ensureSource();
    const content = await files.read(source!.url, signal);
    ensureSource();
    if (!content.byteLength || content.byteLength > 100 * 1024 * 1024) throw new Error("原图不能为空或超过 100 MB");
    const decoded = await createImageBitmap(new Blob([content], { type: source!.mimeType }));
    try {
      ensureSource();
      imageTiles(decoded.width, decoded.height, Math.min(2, decoded.height), Math.min(2, decoded.width), 0);
    } catch (cause) { decoded.close(); throw cause; }
    bitmap?.close();
    bitmap = decoded;
    width.value = decoded.width;
    height.value = decoded.height;
    rows.value = Math.min(rows.value, decoded.height);
    columns.value = Math.min(columns.value, decoded.width);
    const preview = document.createElement("canvas");
    const scale = Math.min(1, 720 / decoded.width, 360 / decoded.height);
    preview.width = Math.max(1, Math.round(decoded.width * scale));
    preview.height = Math.max(1, Math.round(decoded.height * scale));
    const context = preview.getContext("2d");
    if (!context) throw new Error("当前环境无法处理图片");
    context.drawImage(decoded, 0, 0, preview.width, preview.height);
    previewUrl.value = preview.toDataURL("image/png");
  } catch (cause) { if (!signal.aborted) error.value = productionError(cause); }
  finally { loading.value = false; }
}

async function save() {
  if (saving.value || loading.value || !bitmap || !tiles.value.length || validation.value) return;
  saving.value = true;
  savedCount.value = 0;
  error.value = "";
  const paths: string[] = [];
  const nodes: Node[] = [];
  let inserted = false;
  const canvas = document.createElement("canvas");
  try {
    ensureSource();
    await props.loadNodes([props.nodeType]);
    ensureSource();
    const rightEdge = flow.getNodes.value.reduce((right, node) => node.hidden ? right : Math.max(right, node.computedPosition.x + node.dimensions.width), sourceNode!.computedPosition.x + sourceNode!.dimensions.width);
    const origin = { x: rightEdge + 80, y: sourceNode!.computedPosition.y };
    const label = String(sourceNode!.data.label || "图片");
    // ACT: 最多 8×8 格，逐张编码和保存；不同时持有所有切片的像素缓冲。
    for (const [index, tile] of tiles.value.entries()) {
      ensureSource();
      canvas.width = tile.width;
      canvas.height = tile.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("当前环境无法处理图片");
      context.drawImage(bitmap, tile.x, tile.y, tile.width, tile.height, 0, 0, tile.width, tile.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("图片编码失败")), "image/png"));
      ensureSource();
      const id = crypto.randomUUID();
      const path = await uploadNodeFile(files, id, new File([blob], `frame${index + 1}.png`, { type: "image/png" }));
      paths.push(path);
      ensureSource();
      nodes.push({ id, type: props.nodeType, position: { x: origin.x + tile.column * 360, y: origin.y + tile.row * 320 }, data: {
        label: `${label} · 分镜 ${index + 1}`,
        outputs: { image: { dataType: "IMAGE", value: { url: path, mimeType: "image/png" } } },
        imageSplit: { sourceNodeId: props.nodeId, sourcePath: source!.url, ...tile },
      } });
      savedCount.value++;
    }
    await props.batchHistory(async () => {
      ensureSource();
      flow.removeSelectedElements();
      flow.nodesSelectionActive.value = false;
      flow.addNodes(nodes);
      inserted = true;
      await nextTick();
    });
    // 新节点尚未完成尺寸测量，直接按预留的网格边界定位，避免 fitView 忽略屏外节点。
    if (!signal.aborted) await flow.setViewport(getTransformForBounds(
      { ...origin, width: columns.value * 360, height: rows.value * 320 },
      flow.dimensions.value.width, flow.dimensions.value.height, flow.minZoom.value, 1, 0.2,
    ));
    visible.value = false;
  } catch (cause) {
    if (!inserted) {
      const cleanup = await Promise.allSettled(paths.map(path => files.remove(path)));
      const remaining = paths.filter((_path, index) => cleanup[index]?.status === "rejected");
      const message = productionError(cause);
      error.value = remaining.length ? `${message}；以下文件未能清理：${remaining.join("、")}` : message;
      if (signal.aborted && remaining.length) console.error(error.value);
    } else error.value = cause instanceof Error ? cause.message : "画布保存失败，请保留当前画布后重试保存";
  } finally {
    canvas.width = canvas.height = 1;
    saving.value = false;
  }
}

onMounted(prepare);
onScopeDispose(() => { controller.abort(); bitmap?.close(); });
</script>

<style scoped lang="scss">
.imageSplit {
  .splitHint { color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.7; }
  .splitPreview {
    position: relative; width: fit-content; max-width: 100%; margin: 16px auto; background: var(--el-fill-color-light);
    img { display: block; max-width: 100%; max-height: 360px; }
    .tileOutline {
      position: absolute; box-sizing: border-box; border: 1px solid var(--el-color-primary); box-shadow: inset 0 0 0 1px var(--el-bg-color);
      b { position: absolute; top: 2px; left: 2px; padding: 1px 5px; border-radius: 3px; color: var(--el-color-primary); background: var(--el-bg-color); font-size: 12px; }
    }
  }
  fieldset {
    min-width: 0; margin: 0; padding: 0; border: 0;
    legend { font-weight: 600; margin-bottom: 12px; }
    .splitPresets { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; .el-button { margin: 0; } }
    .splitFields {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(min(160px, 100%), 1fr)); gap: 12px;
      label { display: grid; gap: 6px; font-size: 13px; }
      input { box-sizing: border-box; min-width: 0; width: 100%; min-height: 40px; padding: 8px; color: var(--el-text-color-primary); background: var(--el-bg-color); border: 1px solid var(--el-border-color); border-radius: var(--ui-radius, 6px); font: inherit; }
    }
  }
  .splitError { color: var(--el-color-danger); overflow-wrap: anywhere; font-size: 13px; }
  :focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
}
</style>
