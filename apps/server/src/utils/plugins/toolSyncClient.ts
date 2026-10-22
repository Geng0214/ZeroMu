import { deserialize, serialize } from "node:v8";

// 同步能力调用只阻塞插件进程；结果中的长期 Promise 由原 IPC 通道继续传递。
const input = deserialize(Buffer.from(await new Response(Bun.stdin.stream()).arrayBuffer()));
const url = new URL(input.url);
if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password) throw new Error("插件回调地址无效");
const response = await fetch(url, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(3000),
  headers: { authorization: `Bearer ${input.token}`, "content-type": "application/octet-stream" },
  body: serialize(input.message),
});
if (!response.ok) throw new Error(`插件同步回调失败：${response.status}`);
process.stdout.write(Buffer.from(await response.arrayBuffer()));
