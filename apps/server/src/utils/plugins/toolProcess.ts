import { existsSync } from "@toonflow/file";
import { dirname, resolve } from "node:path";

let configuredWorkerPath: string | undefined;

export function setToolConfigWorkerPath(path?: string) {
  configuredWorkerPath = path ? resolve(path) : undefined;
}

export function getToolRuntimeDirectory() {
  return configuredWorkerPath ? dirname(configuredWorkerPath) : import.meta.dirname;
}

export async function validateToolInProcess(source: string, config: Record<string, unknown>): Promise<Record<string, unknown>> {
  // 桌面端使用 SDK 给出的资源路径；独立服务的工作进程与入口同级。
  const worker = (configuredWorkerPath ? [configuredWorkerPath] : ["toolConfigWorker.ts", "toolConfigWorker.js"])
    .map(path => resolve(import.meta.dirname, path)).find(existsSync);
  if (!worker) throw Object.assign(new Error("工具校验工作进程缺失，请重新安装应用"), { status: 503, code: "TOOL_WORKER_MISSING" });

  // ACT: 配置校验不继承模型凭据、应用数据目录等环境；不是操作系统权限沙箱。
  const allowedEnvironment = new Set(["path", "systemroot", "windir", "temp", "tmp", "tmpdir", "lang", "lc_all"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && allowedEnvironment.has(key.toLowerCase()))) as Record<string, string>;
  const response = Promise.withResolvers<Record<string, unknown>>();
  // child.send 也可能同步失败；始终观察拒绝，避免清理时产生未处理的 Promise。
  void response.promise.catch(() => {});
  let settled = false;
  const reject = (error: Error) => {
    if (settled) return;
    settled = true;
    response.reject(error);
  };
  const child = Bun.spawn([process.execPath, worker], {
    env, cwd: import.meta.dirname, stdin: "ignore", stdout: "ignore", stderr: "ignore", windowsHide: true,
    serialization: "advanced",
    ipc(message: unknown) {
      if (settled) return;
      if (!message || typeof message !== "object" || !("type" in message)) {
        reject(Object.assign(new Error("工具校验工作进程响应无效"), { status: 502, code: "TOOL_WORKER_PROTOCOL" }));
        return;
      }
      if (message.type === "error" && "message" in message && typeof message.message === "string") {
        reject(Object.assign(new Error(message.message.slice(0, 4000)), { status: 400 }));
        return;
      }
      if (message.type !== "result" || !("json" in message) || typeof message.json !== "string" || Buffer.byteLength(message.json) > 8 * 1024 * 1024) {
        reject(Object.assign(new Error("工具校验工作进程响应无效"), { status: 502, code: "TOOL_WORKER_PROTOCOL" }));
        return;
      }
      try {
        const parsed: unknown = JSON.parse(message.json);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("工具配置结果必须是对象");
        settled = true;
        response.resolve(parsed as Record<string, unknown>);
      } catch {
        reject(Object.assign(new Error("工具校验工作进程响应无效"), { status: 502, code: "TOOL_WORKER_PROTOCOL" }));
      }
    },
    onDisconnect() {
      reject(Object.assign(new Error("工具校验工作进程已断开，配置未保存"), { status: 502, code: "TOOL_WORKER_EXIT" }));
    },
  });
  const timeout = setTimeout(() => reject(Object.assign(new Error("工具配置初始化或校验超过 5 秒，已停止本次操作"), { status: 504, code: "TOOL_WORKER_TIMEOUT" })), 5000);
  void child.exited.then(() => reject(Object.assign(new Error("工具校验工作进程已退出，配置未保存"), { status: 502, code: "TOOL_WORKER_EXIT" })));
  try {
    child.send({ source, config });
    return await response.promise;
  } finally {
    clearTimeout(timeout);
    child.kill("SIGKILL");
    await child.exited;
  }
}
