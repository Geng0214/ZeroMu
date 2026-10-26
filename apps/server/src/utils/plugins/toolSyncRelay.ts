import { workerData } from "node:worker_threads";
import type { MessagePort } from "node:worker_threads";

// 只处理受信任的传输；插件代码仍在独立进程中执行。
const { port, wake, token } = workerData as { port: MessagePort; wake: Int32Array; token: string };
const callbacks = new Map<string, ReturnType<typeof Promise.withResolvers<Uint8Array>>>();
const notify = (message: unknown) => {
  port.postMessage(message);
  Atomics.add(wake, 0, 1);
  Atomics.notify(wake, 0);
};
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0, maxRequestBodySize: 16 * 1024 * 1024,
  async fetch(request) {
    if (request.method !== "POST" || request.headers.get("origin") !== null || request.headers.get("authorization") !== `Bearer ${token}`) return new Response(null, { status: 403 });
    if (callbacks.size >= 64) return new Response(null, { status: 429 });
    const id = crypto.randomUUID();
    const pending = Promise.withResolvers<Uint8Array>();
    void pending.promise.catch(() => {});
    callbacks.set(id, pending);
    const timeout = setTimeout(() => pending.reject(new Error("插件同步回调超时")), 3000);
    try {
      notify({ type: "callback", id, data: new Uint8Array(await request.arrayBuffer()) });
      return new Response(await pending.promise, { headers: { "content-type": "application/octet-stream" } });
    } catch { return new Response(null, { status: 504 }); }
    finally { clearTimeout(timeout); callbacks.delete(id); }
  },
});

port.on("message", (message: any) => {
  if (message?.type === "callbackReply") {
    callbacks.get(message.id)?.resolve(message.data);
    return;
  }
  if (message?.type !== "request") return;
  void (async () => {
    try {
      const url = new URL(message.url);
      if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password) throw new Error("插件同步地址无效");
      const response = await fetch(url, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(1800),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" }, body: message.data,
      });
      if (!response.ok) throw new Error(`插件同步调用失败：${response.status}`);
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        if (reader) while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 16 * 1024 * 1024) throw new Error("插件同步响应过大");
          chunks.push(value);
        }
      } finally { await reader?.cancel(); }
      const data = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
      notify({ type: "reply", id: message.id, data });
    } catch (error) {
      notify({ type: "reply", id: message.id, error: error instanceof Error ? error.message : "插件同步传输失败" });
    }
  })();
});
notify({ type: "ready", url: `http://127.0.0.1:${server.port}/` });
