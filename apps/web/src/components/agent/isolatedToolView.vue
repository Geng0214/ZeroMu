<template>
  <div class="isolatedToolView" :aria-busy="loading">
    <iframe v-if="!error" ref="frame" :srcdoc="documentSource" :title="frameTitle" sandbox="allow-scripts" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; fullscreen 'none'" referrerpolicy="no-referrer" :style="{ height: height + 'px' }" @load="connect"></iframe>
    <span v-if="loading && !error" role="status">正在加载工具界面…</span>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>

<script lang="ts">
import payload from "virtual:toolFrame";
const bytes = new TextEncoder().encode(payload.code);
let binary = "";
for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
// 插件代码只进入不具同源权限的页面；该页面允许脚本，应用页面不执行插件脚本。
const policy = "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const documentSource = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><style>${payload.css.replace(/<\/style/gi, "<\\/style")}body{margin:0;padding:2px;color:var(--el-text-color-primary);background:transparent;font-family:var(--el-font-family);font-size:var(--el-font-size-base);overflow-wrap:anywhere}*{box-sizing:border-box}#toolView{min-width:0}</style></head><body><div id="toolView"></div><script src="data:text/javascript;base64,${btoa(binary)}"><\/script></body></html>`;
</script>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watchEffect } from "vue";
import axios from "axios";
import { getToolNodeSummaries, type ToolView } from "@toonflow/tools-scaffold/client";
import type { CanvasContext, ToolCall } from "@toonflow/tools-scaffold/runtime";
import { useWorkspaceStore } from "@/stores/workspace";
import { uiSettings } from "@/stores/settings";
import type { ToolFrameRequest, ToolFrameState } from "@/lib/toolFrameProtocol";
import { locale } from "@toonflow/i18n/vue";
import { elementLocales } from "@toonflow/i18n/elementPlus";

const props = defineProps<{ view: ToolView; tool: ToolCall; directory?: string }>();
const frameTitle = computed(() => `${props.tool.name} 工具界面`);
const emit = defineEmits<{ copy: [content: string] }>();
const workspace = useWorkspaceStore();
const getCanvas = inject<() => CanvasContext | undefined>("canvas");
const activateCanvasPanel = inject<() => Promise<boolean>>("activateCanvasPanel");
const frame = ref<HTMLIFrameElement>();
const height = ref(48);
const loading = ref(true);
const error = ref("");
const directory = props.directory;
const toolId = props.tool.id;
const controller = new AbortController();
let port: MessagePort | undefined;
let alive = true;
let connected = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let appearanceObserver: MutationObserver | undefined;
let requestWindow = performance.now();
let requestCount = 0;
const requests = new Set<number>();
const connectionRevision = ref(0);

function assertScope() {
  if (!alive || controller.signal.aborted || props.directory !== directory || props.tool.id !== toolId) throw new Error("工具界面上下文已结束");
}

function currentCanvas() {
  assertScope();
  const canvas = getCanvas?.();
  if (!directory || workspace.project?.directory !== directory || !canvas) throw new Error("画布尚未就绪或项目已切换，请回到原项目后重试");
  return canvas;
}

function snapshot(): ToolFrameState {
  assertScope();
  const serialized = JSON.stringify(props.tool);
  if (serialized.length > 4 * 1024 * 1024) throw new Error("工具界面记录过大，请查看文本结果");
  const style = getComputedStyle(document.documentElement);
  const variables: Record<string, string> = {};
  for (const name of style) if (/^--(?:el|ui)-[a-zA-Z0-9-]+$/.test(name)) variables[name] = style.getPropertyValue(name);
  let canvas: ToolFrameState["canvas"];
  try {
    const context = currentCanvas();
    canvas = { id: context.id, labels: Object.fromEntries(getToolNodeSummaries(props.tool).slice(0, 1000).map(item => [item.nodeId, context.getNodeLabel?.(item.nodeId) || item.label])) };
  } catch { /* 未打开原画布时仍能阅读工具结果或回答原问题。 */ }
  return { tool: JSON.parse(serialized), directory, canvas, appearance: { dark: document.documentElement.classList.contains("dark"), fontSize: style.fontSize, variables, locale: elementLocales[locale.value] } };
}

function fail(message: string) {
  if (!alive) return;
  error.value = message.slice(0, 300); loading.value = false;
  if (timer) clearTimeout(timer);
  controller.abort(); port?.close(); port = undefined;
}

function sendState() {
  if (!port || error.value) return;
  try { port.postMessage({ type: "state", state: snapshot() }); }
  catch { fail("工具界面状态不可用，请停止后重新打开"); }
}

async function operate(action: string, data: any) {
  assertScope();
  if (action === "copy") {
    if (typeof data !== "string" || data.length > 1_000_000) throw new Error("复制内容无效或过大");
    emit("copy", data); return;
  }
  if (action === "http") {
    const question = props.tool.question;
    const body = data?.data;
    if (data?.method !== "post" || data?.url !== "/api/agent/answer" || !body || typeof body !== "object" || Array.isArray(body)
      || !directory || props.tool.status !== "running" || !question?.callId || body.directory !== directory || body.callId !== question.callId
      || (props.tool.name !== "askUser" && question.options?.includes("确认生成")) || JSON.stringify(body).length > 200_000) throw new Error("工具界面没有本次操作权限");
    const { answer, values, skipped, cancelled } = body;
    const response = await axios.post("/api/agent/answer", { directory, callId: question.callId, answer, values, skipped, cancelled }, { headers: { "x-toonflow-workspace": "1" }, signal: controller.signal });
    return response.data;
  }
  if (action === "activateCanvas") {
    if (!directory || workspace.project?.directory !== directory) throw new Error("原项目当前不可用");
    const activated = await activateCanvasPanel?.();
    if (activated === false) return false;
    currentCanvas();
    return true;
  }
  if (action === "canvas") {
    const canvas = currentCanvas();
    const ids = data?.args?.nodeIds;
    const allowed = new Set(getToolNodeSummaries(props.tool).slice(0, 1000).map(item => item.nodeId));
    if (!["fitCanvas", "selectNodes"].includes(data?.name) || !Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => typeof id !== "string" || !allowed.has(id))) throw new Error("工具界面只能定位当前记录中的节点");
    return canvas.call({ name: data.name, args: { nodeIds: ids } }, controller.signal);
  }
  throw new Error("工具界面没有本次操作权限");
}

function connect() {
  if (!alive || error.value) return;
  if (connected) { fail("工具界面已离开原页面，请停止后重新打开"); return; }
  connected = true;
  const channel = new MessageChannel(); port = channel.port1;
  port.onmessage = async event => {
    const message = event.data;
    if (!alive || error.value || !message || typeof message !== "object") return;
    if (message.type === "ready") { loading.value = false; if (timer) clearTimeout(timer); return; }
    if (message.type === "height") { if (Number.isFinite(message.height)) height.value = Math.max(32, Math.min(1600, Math.ceil(message.height))); return; }
    if (message.type === "error") { fail("工具界面运行失败，请停止后重新打开"); return; }
    if (message.type !== "request" || !Number.isSafeInteger(message.id) || message.id <= 0 || typeof message.action !== "string" || requests.has(message.id)) return;
    if (performance.now() - requestWindow > 1000) { requestWindow = performance.now(); requestCount = 0; }
    if (++requestCount > 60 || requests.size >= 16) { fail("工具界面请求过多，已停止本次界面"); return; }
    const request = message as ToolFrameRequest;
    requests.add(request.id);
    try {
      const data = await operate(request.action, request.data);
      if (alive && port) port.postMessage({ type: "response", id: request.id, data: data === undefined ? undefined : JSON.parse(JSON.stringify(data)) });
    } catch (error) {
      if (alive && port) port.postMessage({ type: "response", id: request.id, error: error instanceof Error ? error.message : "操作失败" });
    } finally { requests.delete(request.id); }
  };
  try { frame.value?.contentWindow?.postMessage({ type: "toolViewStart", name: props.view.name, code: props.view.code, state: snapshot() }, "*", [channel.port2]); }
  catch { channel.port2.close(); fail("工具界面加载失败，请停止后重新打开"); }
  connectionRevision.value++;
}

watchEffect(() => {
  void connectionRevision.value; void uiSettings.value.fontScale;
  if (error.value) return;
  try {
    const state = snapshot();
    port?.postMessage({ type: "state", state });
  } catch { fail("工具界面状态不可用，请停止后重新打开"); }
});
onMounted(() => {
  timer = setTimeout(() => fail("工具界面加载超时，请停止后重新打开"), 10_000);
  appearanceObserver = new MutationObserver(sendState);
  appearanceObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
});
onBeforeUnmount(() => {
  alive = false; if (timer) clearTimeout(timer);
  appearanceObserver?.disconnect(); controller.abort(); port?.close(); requests.clear();
});
</script>

<style scoped lang="scss">
.isolatedToolView {
  min-width: 0;
  iframe { display: block; width: 100%; border: 0; }
  span, p { color: var(--el-text-color-secondary); font-size: 12px; }
  p { color: var(--el-color-danger); white-space: pre-wrap; }
}
</style>
