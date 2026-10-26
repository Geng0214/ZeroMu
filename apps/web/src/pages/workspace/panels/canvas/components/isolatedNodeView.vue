<template>
  <div ref="container" class="isolatedNodeView" :aria-busy="active && loading" :data-can-unload="canUnload" :style="active ? undefined : { minHeight: `${frameHeight}px` }">
    <iframe v-if="active && !error" ref="frame" :srcdoc="documentSource" :title="`${state.node.data.label || state.scope.nodeType} 节点界面`" :style="{ height: `${frameHeight}px` }" sandbox="allow-scripts" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; fullscreen 'none'" referrerpolicy="no-referrer" @load="connect"></iframe>
    <span v-if="active && loading && !error" role="status">正在加载节点界面…</span>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>

<script lang="ts">
import payload from "virtual:nodeFrame";
const bytes = new TextEncoder().encode(payload.code);
let binary = "";
for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
const policy = "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const documentSource = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><style>${payload.css.replace(/<\/style/gi, "<\\/style")}html,body,#nodeFrame{margin:0;width:100%;height:100%;overflow:hidden}*{box-sizing:border-box}.vue-flow__handle{visibility:hidden!important}.nodeSkeleton{display:flex!important;flex-direction:column;width:320px!important}.nodeSkeleton>.titleBar{display:none!important}.nodeSkeleton>.topSlot,.nodeSkeleton>.bottomSlot{position:static!important;left:auto!important;top:auto!important;bottom:auto!important;width:100%!important;transform:none!important}.nodeSkeleton>.topSlot{order:1}.nodeSkeleton>.cardContainer{order:2}.nodeSkeleton>.bottomSlot{order:3}</style></head><body><div id="nodeFrame"></div><script src="data:text/javascript;base64,${btoa(binary)}"><\/script></body></html>`;
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from "vue";
import { createNodeFrameSession, sameNodeFrameScope, type NodeFrameScope, type NodeFrameState } from "@/lib/nodeFrameProtocol";
import { createNodeFrameFileOperations } from "@/lib/nodeFrameFiles";

const props = defineProps<{
  code: string;
  state: NodeFrameState;
  currentScope: () => NodeFrameScope | undefined;
  operate?: (action: string, data: unknown, signal: AbortSignal) => Promise<unknown>;
}>();
const container = ref<HTMLDivElement>();
const frame = ref<HTMLIFrameElement>();
const frameHeight = ref(240);
const active = ref(false);
const loading = ref(true);
const ready = ref(false);
const frameCanUnload = ref(false);
const canUnload = computed(() => !active.value || frameCanUnload.value);
const error = ref("");
const scope = props.state.scope;
let connected = false;
let alive = true;
let timer: ReturnType<typeof setTimeout> | undefined;
let evictTimer: ReturnType<typeof setTimeout> | undefined;
let observer: IntersectionObserver | undefined;
let session: ReturnType<typeof createNodeFrameSession> | undefined;
let inView = false;
let pendingInvocations = 0;
const waiters = new Set<{ resolve: () => void; reject: (error: Error) => void }>();
function settleWaiters(message?: string) {
  for (const waiter of waiters) message ? waiter.reject(new Error(message)) : waiter.resolve();
  waiters.clear();
}
const fileOperations = createNodeFrameFileOperations(props.state, props.currentScope);
const operate = (action: string, data: unknown, signal: AbortSignal) => action.startsWith("files.")
  ? fileOperations(action, data, signal)
  : action === "node.size" ? resize(data)
  : props.operate ? props.operate(action, data, signal) : Promise.reject(new Error("节点界面操作未授权"));

function resize(data: unknown) {
  const height = (data as { height?: unknown } | null)?.height;
  if (typeof height !== "number" || !Number.isFinite(height) || height < 80 || height > 2000) throw new Error("节点界面尺寸无效");
  frameHeight.value = Math.ceil(height);
  return Promise.resolve();
}

function fail(message: string) {
  if (!alive || error.value) return;
  error.value = message.slice(0, 300);
  loading.value = false;
  ready.value = false;
  frameCanUnload.value = false;
  if (timer) clearTimeout(timer);
  settleWaiters(error.value);
  session?.close(); session = undefined;
}

function scheduleEviction() {
  if (evictTimer) clearTimeout(evictTimer);
  if (inView || !active.value || pendingInvocations || error.value) return;
  evictTimer = setTimeout(() => {
    evictTimer = undefined;
    if (inView || pendingInvocations || (ready.value && !frameCanUnload.value)) return;
    session?.close(); session = undefined;
    if (timer) clearTimeout(timer);
    connected = false;
    ready.value = false;
    loading.value = true;
    frameCanUnload.value = false;
    active.value = false;
  }, 500);
}

function connect() {
  if (!alive || error.value) return;
  if (connected) { fail("节点界面已离开原页面"); return; }
  if (frame.value?.contentDocument) { fail("节点界面未获得独立来源"); return; }
  connected = true;
  const serialized = JSON.stringify(props.state);
  if (props.code.length > 5_000_000 || serialized.length > 4_000_000) { fail("节点界面资源过大"); return; }
  const channel = new MessageChannel();
  session = createNodeFrameSession(channel.port1, scope, props.currentScope, operate, fail, () => {
    loading.value = false;
    ready.value = true;
    if (timer) clearTimeout(timer);
    settleWaiters();
    scheduleEviction();
  }, value => { frameCanUnload.value = value; scheduleEviction(); });
  try { frame.value?.contentWindow?.postMessage({ type: "nodeFrameStart", code: props.code, state: JSON.parse(serialized) }, "*", [channel.port2]); }
  catch { channel.port2.close(); fail("节点界面连接失败"); }
}

onMounted(() => {
  if (typeof IntersectionObserver === "undefined") { active.value = true; return; }
  observer = new IntersectionObserver(entries => {
    const entry = entries.at(-1);
    if (!entry) return;
    inView = entry.isIntersecting;
    if (inView) active.value = true;
    else scheduleEviction();
  }, { rootMargin: "240px" });
  if (container.value) observer.observe(container.value);
});
watch(active, value => { if (value) timer = setTimeout(() => fail("节点界面加载超时"), 10_000); });
watchEffect(() => {
  const current = props.currentScope();
  if (connected && !sameNodeFrameScope(current, scope)) fail("节点所属项目或画布已切换");
});
watch(() => [props.state.node.selected, props.state.inputs, props.state.config, props.state.appearance], () => session?.update(props.state), { deep: true });
onBeforeUnmount(() => {
  alive = false;
  observer?.disconnect();
  if (timer) clearTimeout(timer);
  if (evictTimer) clearTimeout(evictTimer);
  settleWaiters("节点界面已关闭");
  session?.close();
});
async function invoke(action: "save" | "copy" | "delete", reason?: "reload") {
  pendingInvocations++;
  try {
    if (!active.value) {
      if (action === "save") return;
      active.value = true;
    }
    if (error.value) throw new Error(error.value);
    if (!ready.value) await new Promise<void>((resolve, reject) => { waiters.add({ resolve, reject }); });
    if (!session) throw new Error("节点界面尚未就绪");
    return session.invoke(action, reason);
  } finally {
    pendingInvocations--;
    scheduleEviction();
  }
}
defineExpose({ invoke, ready, canUnload });
</script>

<style scoped lang="scss">
.isolatedNodeView {
  min-width: 0;
  iframe { display: block; width: 100%; border: 0; }
  span, p { color: var(--el-text-color-secondary); font-size: 12px; }
  p { color: var(--el-color-danger); white-space: pre-wrap; }
}
</style>
