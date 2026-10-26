import type { NodeData } from "@toonflow/nodes-scaffold/connection";
import type { NodeInputValue } from "@toonflow/nodes-scaffold/values";

export type NodeFrameScope = {
  directory: string;
  canvasId: string;
  nodeId: string;
  nodeType: string;
  sessionId: string;
};

export type NodeFrameState = {
  scope: NodeFrameScope;
  node: { id: string; type: string; data: NodeData; selected: boolean };
  inputs: Record<string, NodeInputValue[]>;
  config: Record<string, unknown>;
  appearance: { dark: boolean; fontSize: string; variables: Record<string, string> };
};

export type NodeFrameRequest = { type: "request"; id: number; action: string; data?: unknown };
export type NodeFrameResponse = { type: "response"; id: number; data?: unknown; error?: string; errorCode?: string };
export type NodeFrameEvent = { type: "ready" } | { type: "error"; message?: string } | { type: "status"; canUnload: boolean };
export type NodeFrameUpdate = { type: "update"; selected: boolean; inputs: NodeFrameState["inputs"]; config: NodeFrameState["config"]; appearance: NodeFrameState["appearance"] };
export type NodeFrameInvoke = { type: "invoke"; id: number; action: "save" | "copy" | "delete"; reason?: "reload" };
export type NodeFrameInvokeResult = { type: "invoked"; id: number; data?: unknown; error?: string };

export function sameNodeFrameScope(left: NodeFrameScope | undefined, right: NodeFrameScope) {
  return left?.directory === right.directory && left.canvasId === right.canvasId && left.nodeId === right.nodeId
    && left.nodeType === right.nodeType && left.sessionId === right.sessionId;
}

function requestBytes(value: unknown, limit = 1_000_000, seen = new Set<object>(), depth = 0): number {
  if (depth > 20) throw new Error("节点界面请求层级过深");
  if (value == null || typeof value === "boolean" || typeof value === "number") return 8;
  if (typeof value === "string") return value.length * 4;
  if (typeof value !== "object" || seen.has(value)) throw new Error("节点界面请求格式无效");
  if (value instanceof Blob) return value.size;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error("节点界面请求格式无效");
  seen.add(value);
  const entries = Array.isArray(value) ? value.map(item => ["", item] as const) : Object.entries(value);
  if (entries.length > 10_000) throw new Error("节点界面请求字段过多");
  let size = 0;
  for (const [key, item] of entries) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") throw new Error("节点界面请求字段无效");
    size += key.length * 4 + requestBytes(item, limit, seen, depth + 1);
    if (size > limit) break;
  }
  seen.delete(value);
  return size;
}

// 一个端口只属于一次节点挂载；业务动作仍由调用方逐项检查和执行。
export function createNodeFrameSession(
  port: MessagePort,
  scope: NodeFrameScope,
  currentScope: () => NodeFrameScope | undefined,
  operate: (action: string, data: unknown, signal: AbortSignal) => Promise<unknown>,
  onFailure: (message: string) => void,
  onReady?: () => void,
  onStatus?: (canUnload: boolean) => void,
) {
  const controller = new AbortController();
  const requests = new Set<number>();
  const invokes = new Map<number, { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let invokeId = 0;
  let requestWindow = performance.now();
  let requestCount = 0;
  let largeUploads = 0;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    controller.abort(new Error("节点界面已关闭"));
    requests.clear();
    for (const waiter of invokes.values()) { clearTimeout(waiter.timer); waiter.reject(new Error("节点界面已关闭")); }
    invokes.clear();
    port.onmessage = null;
    port.close();
  };
  const fail = (message: string) => { close(); onFailure(message); };

  port.onmessage = async event => {
    if (closed) return;
    const message = event.data as NodeFrameRequest | NodeFrameEvent | NodeFrameInvokeResult | undefined;
    if (message?.type === "invoked") {
      if (!sameNodeFrameScope(currentScope(), scope)) { fail("节点所属项目或画布已切换"); return; }
      const waiter = invokes.get(message.id);
      if (!waiter) return;
      try { if (requestBytes(message.data) > 1_000_000) throw new Error("节点复制结果过大"); }
      catch { fail("节点生命周期结果格式无效"); return; }
      invokes.delete(message.id); clearTimeout(waiter.timer);
      if (typeof message.error === "string") waiter.reject(new Error(message.error));
      else waiter.resolve(message.data);
      return;
    }
    if (message?.type === "ready") {
      if (!sameNodeFrameScope(currentScope(), scope)) { fail("节点所属项目或画布已切换"); return; }
      onReady?.(); return;
    }
    if (message?.type === "status") {
      if (!sameNodeFrameScope(currentScope(), scope)) { fail("节点所属项目或画布已切换"); return; }
      if (typeof message.canUnload === "boolean") onStatus?.(message.canUnload);
      return;
    }
    if (message?.type === "error") { fail("节点界面运行失败"); return; }
    if (!message || message.type !== "request" || !Number.isSafeInteger(message.id) || message.id <= 0
      || typeof message.action !== "string" || !/^[a-z][a-zA-Z0-9.]{0,63}$/.test(message.action)
      || requests.has(message.id)) return;
    if (!sameNodeFrameScope(currentScope(), scope)) { fail("节点所属项目或画布已切换"); return; }
    if (performance.now() - requestWindow > 1000) { requestWindow = performance.now(); requestCount = 0; }
    if (++requestCount > 60 || requests.size >= 16) { fail("节点界面请求过多"); return; }
    const content = (message.data as { content?: unknown } | null)?.content;
    const largeUpload = message.action === "files.write" && (content instanceof Blob || content instanceof ArrayBuffer);
    const limit = largeUpload ? 100 * 1024 * 1024 + 4096 : message.action === "draft.set" ? 4_000_000 + 4096 : 1_000_000;
    if (largeUpload && largeUploads) { fail("节点媒体上传并发过多"); return; }
    let size = 0;
    try { size = requestBytes(message.data, limit); }
    catch { fail("节点界面请求格式无效"); return; }
    if (size > limit) { fail("节点界面请求过大"); return; }
    if (largeUpload) largeUploads++;
    requests.add(message.id);
    try {
      const data = await operate(message.action, message.data, controller.signal);
      if (!closed && sameNodeFrameScope(currentScope(), scope)) {
        const response: NodeFrameResponse = { type: "response", id: message.id, data };
        const chunk = message.action === "files.readChunk" && data && typeof data === "object" && "chunk" in data ? data.chunk : undefined;
        port.postMessage(response, chunk instanceof ArrayBuffer ? [chunk] : []);
      }
    } catch (error) {
      if (!closed && sameNodeFrameScope(currentScope(), scope)) {
        const code = (error as { response?: { data?: { data?: { code?: unknown } } } })?.response?.data?.data?.code;
        const response: NodeFrameResponse = { type: "response", id: message.id, error: error instanceof Error ? error.message.slice(0, 300) : "节点操作失败",
          ...(typeof code === "string" && /^E[A-Z]{2,20}$/.test(code) ? { errorCode: code } : {}) };
        port.postMessage(response);
      }
    } finally { requests.delete(message.id); if (largeUpload) largeUploads--; }
  };
  const update = (state: NodeFrameState) => {
    if (closed || !sameNodeFrameScope(currentScope(), scope)) return;
    const message: NodeFrameUpdate = { type: "update", selected: state.node.selected, inputs: state.inputs, config: state.config, appearance: state.appearance };
    const serialized = JSON.stringify(message);
    if (serialized.length > 1_000_000) { fail("节点状态更新过大"); return; }
    try { port.postMessage(JSON.parse(serialized)); }
    catch { fail("节点状态更新无法传输"); }
  };
  const invoke = (action: NodeFrameInvoke["action"], reason?: "reload") => {
    if (closed || !sameNodeFrameScope(currentScope(), scope)) return Promise.reject(new Error("节点界面已关闭或画布已切换"));
    if (invokes.size >= 4) return Promise.reject(new Error("节点界面正在处理其他操作"));
    const id = ++invokeId;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { invokes.delete(id); reject(new Error("节点界面操作超时")); }, 30_000);
      invokes.set(id, { resolve, reject, timer });
      const message: NodeFrameInvoke = { type: "invoke", id, action, ...(reason ? { reason } : {}) };
      try { port.postMessage(message); }
      catch { clearTimeout(timer); invokes.delete(id); reject(new Error("节点界面操作无法传输")); }
    });
  };
  return { close, update, invoke, signal: controller.signal };
}
