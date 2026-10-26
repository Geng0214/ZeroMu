import * as vueRuntime from "vue";
import * as vueFlowRuntime from "@vue-flow/core";
import * as elementPlusRuntime from "element-plus";
import { useNodeEvent } from "@toonflow/nodes-scaffold/nodeEvent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { NodeFrameInvoke, NodeFrameInvokeResult, NodeFrameResponse, NodeFrameState, NodeFrameUpdate } from "./nodeFrameProtocol";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";

// 此入口只供无同源权限的节点子页面打包，不能导入应用页面、路由或设置。
let port: MessagePort | undefined;
let nextId = 0;
let applyUpdate: ((update: NodeFrameUpdate) => void) | undefined;
let invokeNode: ((action: NodeFrameInvoke["action"], reason?: "reload") => Promise<unknown>) | undefined;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

function request(action: string, data?: unknown): Promise<any> {
  if (!port || pending.size >= 16) return Promise.reject(new Error("节点界面请求不可用"));
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("节点界面请求超时")); }, 60_000);
    pending.set(id, { resolve, reject, timer });
    try { port!.postMessage({ type: "request", id, action, data }); }
    catch { clearTimeout(timer); pending.delete(id); reject(new Error("节点界面请求无法传输")); }
  });
}

function acquireFileUrl(path: string, mimeType: string) {
  let size: number | undefined;
  let objectUrl = "";
  let released = false;
  const url = (async () => {
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let offset = 0;
    let total: number | undefined;
    let etag: string | undefined;
    do {
      if (released) throw new Error("媒体预览已关闭");
      const result = await request("files.readChunk", { path, start: offset, length: 4 * 1024 * 1024, etag }) as { chunk?: unknown; total?: unknown; etag?: unknown };
      if (!(result.chunk instanceof ArrayBuffer) || !result.chunk.byteLength || result.chunk.byteLength > 4 * 1024 * 1024
        || !Number.isSafeInteger(result.total) || (result.total as number) > 100 * 1024 * 1024
        || offset + result.chunk.byteLength > (result.total as number) || total !== undefined && total !== result.total
        || typeof result.etag !== "string" || !result.etag || etag !== undefined && etag !== result.etag) throw new Error("媒体分段响应无效");
      total = result.total as number;
      etag = result.etag;
      chunks.push(new Uint8Array(result.chunk));
      offset += result.chunk.byteLength;
    } while (offset < total);
    if (released) throw new Error("媒体预览已关闭");
    size = total;
    objectUrl = URL.createObjectURL(new Blob(chunks, { type: mimeType }));
    return objectUrl;
  })();
  return {
    url,
    get size() { return size; },
    release() { released = true; if (objectUrl) URL.revokeObjectURL(objectUrl); },
  };
}

window.addEventListener("message", function initialize(event: MessageEvent) {
  if (port || event.source !== window.parent || event.data?.type !== "nodeFrameStart" || event.ports.length !== 1) return;
  window.removeEventListener("message", initialize);
  port = event.ports[0]!;
  port.onmessage = async messageEvent => {
    const message = messageEvent.data as NodeFrameResponse | NodeFrameUpdate | NodeFrameInvoke | undefined;
    if (message?.type === "update") { applyUpdate?.(message); return; }
    if (message?.type === "invoke") {
      if (!Number.isSafeInteger(message.id) || message.id <= 0 || !["save", "copy", "delete"].includes(message.action)) return;
      let result: NodeFrameInvokeResult;
      try {
        if (!invokeNode) throw new Error("节点尚未加载");
        result = { type: "invoked", id: message.id, data: await invokeNode(message.action, message.reason) };
      }
      catch (error) { result = { type: "invoked", id: message.id, error: error instanceof Error ? error.message.slice(0, 300) : "节点操作失败" }; }
      port?.postMessage(result);
      return;
    }
    if (!message || message.type !== "response" || !Number.isSafeInteger(message.id)) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id); clearTimeout(waiter.timer);
    if (typeof message.error === "string") {
      const error = new Error(message.error) as Error & { response?: { data: { data: { code: string } } } };
      if (typeof message.errorCode === "string" && /^E[A-Z]{2,20}$/.test(message.errorCode)) error.response = { data: { data: { code: message.errorCode } } };
      waiter.reject(error);
    }
    else waiter.resolve(message.data);
  };
  window.addEventListener("pagehide", () => {
    port?.close(); port = undefined;
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error("节点界面已关闭")); }
    pending.clear();
  }, { once: true });

  try {
    const state = event.data.state as NodeFrameState;
    if (!state || state.node?.id !== state.scope?.nodeId || state.node?.type !== state.scope?.nodeType
      || !/^[a-z][a-zA-Z0-9]*$/.test(state.scope.nodeType.replace(/^remote-/, "")) || typeof event.data.code !== "string") {
      throw new Error("节点界面初始状态无效");
    }
    let appliedAppearanceVariables = new Set<string>();
    const applyAppearance = (appearance: NodeFrameState["appearance"]) => {
      const root = document.documentElement;
      root.classList.toggle("dark", appearance.dark);
      root.style.colorScheme = appearance.dark ? "dark" : "light";
      root.style.fontSize = appearance.fontSize;
      const next = new Set<string>();
      for (const [name, value] of Object.entries(appearance.variables)) {
        if (/^--(?:el|ui)-[a-zA-Z0-9-]+$/.test(name) && typeof value === "string" && value.length <= 2000) {
          root.style.setProperty(name, value);
          next.add(name);
        }
      }
      for (const name of appliedAppearanceVariables) if (!next.has(name)) root.style.removeProperty(name);
      appliedAppearanceVariables = next;
    };
    applyAppearance(state.appearance);
    const nodeWindow = window as typeof window & {
      toonflowNodeHost?: unknown;
      toonflowNodes?: Record<string, vueRuntime.Component>;
    };
    nodeWindow.toonflowNodeHost = {
      vue: vueRuntime, vueFlow: vueFlowRuntime, elementPlus: elementPlusRuntime,
      nodeAiBridge: {
        canGenerate: false,
        getModels: () => request("ai.models"),
        getMediaModels: () => request("ai.mediaModels"),
      },
      ai: {
        runAgentLoop: () => Promise.reject(new Error("节点生成能力尚未接入隔离通道")),
        createAssistantMessageEventStream,
      },
    };
    const script = document.createElement("script");
    script.textContent = event.data.code;
    document.head.append(script); script.remove();
    const name = state.scope.nodeType.replace(/^remote-/, "");
    const component = Object.hasOwn(nodeWindow.toonflowNodes ?? {}, name) ? nodeWindow.toonflowNodes?.[name] : undefined;
    if (!component || (typeof component !== "object" && typeof component !== "function")) throw new Error("节点脚本未导出对应组件");
    const node = vueRuntime.reactive({ ...state.node, position: { x: 0, y: 0 }, draggable: false });
    let frameFlow: ReturnType<typeof vueFlowRuntime.useVueFlow> | undefined;
    const nodeEvents = vueRuntime.shallowRef<ReturnType<typeof useNodeEvent>>();
    const inputSnapshot = vueRuntime.reactive({ ...state.inputs });
    const nodeConfig = vueRuntime.reactive({ ...state.config });
    applyUpdate = update => {
      node.selected = update.selected;
      const mountedNode = frameFlow?.findNode(state.scope.nodeId);
      if (mountedNode) mountedNode.selected = update.selected;
      for (const key of Object.keys(inputSnapshot)) if (!(key in update.inputs)) delete inputSnapshot[key];
      Object.assign(inputSnapshot, update.inputs);
      for (const key of Object.keys(nodeConfig)) if (!(key in update.config)) delete nodeConfig[key];
      Object.assign(nodeConfig, update.config);
      applyAppearance(update.appearance);
    };
    let lastData = "";
    let dataTimer: ReturnType<typeof setTimeout> | undefined;
    let sendingData: Promise<void> | undefined;
    const dataPending = vueRuntime.ref(false);
    function snapshotData() {
      const data = vueRuntime.toRaw(node.data);
      const outputs = data.outputs ? { ...vueRuntime.toRaw(data.outputs) } : undefined;
      return JSON.parse(JSON.stringify({ ...data, ...(outputs ? { outputs } : {}) }));
    }
    lastData = JSON.stringify(snapshotData());
    async function sendData() {
      if (sendingData) return sendingData;
      sendingData = (async () => {
        while (true) {
          const data = snapshotData();
          const serialized = JSON.stringify(data);
          if (serialized === lastData) { dataPending.value = false; return; }
          dataPending.value = true;
          await request("node.data", { data });
          lastData = serialized;
        }
      })();
      try { await sendingData; }
      finally { sendingData = undefined; }
    }
    vueRuntime.watch(() => node.data, () => {
      dataPending.value = true;
      if (dataTimer) clearTimeout(dataTimer);
      dataTimer = setTimeout(() => void sendData().catch(() => port?.postMessage({ type: "error", message: "节点状态同步失败" })), 100);
    }, { deep: true, flush: "sync" });
    window.addEventListener("pagehide", () => { if (dataTimer) clearTimeout(dataTimer); }, { once: true });
    const app = vueRuntime.createApp({
      setup() {
        frameFlow = vueFlowRuntime.useVueFlow();
        return () => vueRuntime.h(vueFlowRuntime.VueFlow, {
        nodes: [node], edges: [], nodeTypes: { [state.scope.nodeType]: vueRuntime.markRaw(component) },
        nodesDraggable: false, nodesConnectable: false, panOnDrag: false, zoomOnScroll: false,
        zoomOnPinch: false, zoomOnDoubleClick: false, minZoom: 1, maxZoom: 1,
        });
      },
    });
    app.provide("nodeConfig", () => nodeConfig);
    app.provide("nodeFrameLifecycle", (nodeId: string, events: ReturnType<typeof useNodeEvent>) => {
      if (nodeId === state.scope.nodeId) nodeEvents.value = events;
    });
    app.provide("nodeInputSnapshot", (nodeId: string, handleId: string) => nodeId === state.scope.nodeId ? inputSnapshot[handleId] ?? [] : undefined);
    app.provide("nodeRemoveReference", (handleId: string, source: string, sourceHandle: string) => request("node.disconnect", { handleId, source, sourceHandle }));
    app.provide("canvas", () => ({ id: state.scope.canvasId }));
    app.provide("workspaceDirectory", () => state.scope.directory);
    app.provide("retainNodeFiles", true);
    app.provide("nodeDraftStore", {
      get: () => request("draft.get"),
      set: (value: string) => request("draft.set", { value }),
      remove: () => request("draft.remove"),
    });
    app.provide("nodeAiBridge", {
      canGenerate: false,
      getModels: () => request("ai.models"),
      getMediaModels: () => request("ai.mediaModels"),
    });
    app.provide("workspaceFiles", () => ({
      getDirectory: () => state.scope.directory,
      list: (path?: string) => request("files.list", { path }),
      read: (path: string) => request("files.read", { path }),
      acquireUrl: acquireFileUrl,
      readText: (path: string) => request("files.readText", { path }),
      readJson: (path: string) => request("files.readJson", { path }),
      write: (path: string, content: string | Blob | ArrayBuffer, exclusive?: boolean) => request("files.write", { path, content, exclusive }),
      writeJson: (path: string, data: unknown, exclusive?: boolean) => request("files.writeJson", { path, data, exclusive }),
      rename: (path: string, target: string) => request("files.rename", { path, target }),
      remove: (path: string, recursive?: boolean) => request("files.remove", { path, recursive }),
      mkdir: (path: string) => request("files.mkdir", { path }),
    }));
    app.config.errorHandler = () => port?.postMessage({ type: "error", message: "节点界面运行失败" });
    app.mount("#nodeFrame");
    const stopStatus = vueRuntime.watchEffect(() => {
      port?.postMessage({ type: "status", canUnload: !dataPending.value && nodeEvents.value?.emit("canUnload") === true });
    });
    window.addEventListener("pagehide", stopStatus, { once: true });
    invokeNode = async (action, reason) => {
      const events = nodeEvents.value;
      if (!events) throw new Error("节点生命周期尚未注册");
      const result = action === "save" ? await events.emit("save", reason)
        : action === "copy" ? await events.emit("copy") : await events.emit("delete");
      await vueRuntime.nextTick();
      if (dataTimer) clearTimeout(dataTimer);
      await sendData();
      return result;
    };
    const observer = new ResizeObserver(() => {
      const height = document.querySelector<HTMLElement>(".vue-flow__node")?.getBoundingClientRect().height;
      if (height && Number.isFinite(height)) void request("node.size", { height: Math.min(2000, Math.max(80, height + 4)) }).catch(() => {});
    });
    void vueRuntime.nextTick().then(() => observer.observe(document.querySelector<HTMLElement>(".vue-flow__node") ?? document.getElementById("nodeFrame")!));
    window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
    port.postMessage({ type: "ready" });
  } catch (error) {
    port.postMessage({ type: "error", message: error instanceof Error ? error.message.slice(0, 300) : "节点界面加载失败" });
  }
});
