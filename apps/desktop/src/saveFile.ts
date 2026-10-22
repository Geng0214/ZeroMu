import { t } from "@toonflow/server/i18n";
import { execFile } from "node:child_process";
import { writeAtomic } from "@toonflow/file";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import { PATHS } from "electrobun/main";

const execFileAsync = promisify(execFile);
// ACT: 同一桌面进程只显示一个保存对话框；后续若支持多窗口，可按窗口分别加锁。
let dialogOpen = false;
// 选好路径到实际写入之间用一次性 token 中转，不把绝对路径回传给前端。
const pendingSaves = new Map<string, { path: string; expiresAt: number }>();
const tokenTtlMs = 5 * 60 * 1000;

function cleanupExpiredTokens() {
  const now = Date.now();
  for (const [token, entry] of pendingSaves) if (entry.expiresAt <= now) pendingSaves.delete(token);
}

const macDialog = `
on run argv
  try
    return POSIX path of (choose file name with prompt (item 2 of argv) default name (item 1 of argv))
  on error errorMessage number errorNumber
    if errorNumber is -128 then return ""
    error errorMessage number errorNumber
  end try
end run
`;

function selectWindowsSaveFile(fileName: string, owner: number | null | undefined): Promise<string | null> {
  if (!Number.isSafeInteger(owner) || !owner || owner <= 0) throw new Error(t`未找到零幕主窗口，请重新打开另存为`);
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(PATHS.RESOURCES_FOLDER, "app/saveFileDialogWorker.js"), { workerData: { fileName, owner, title: t`另存为` } });
    let answered = false;
    worker.once("message", (message: unknown) => {
      answered = true;
      if (!message || typeof message !== "object") { reject(new Error(t`保存窗口返回了无效响应`)); return; }
      if ("error" in message && typeof message.error === "string") { reject(new Error(message.error)); return; }
      if ("path" in message && (typeof message.path === "string" || message.path === null)) resolve(message.path);
      else reject(new Error(t`保存窗口返回了无效响应`));
    });
    worker.once("error", error => { answered = true; reject(error); });
    worker.once("exit", () => { if (!answered) reject(new Error(t`保存窗口意外关闭，请重试`)); });
  });
}

export async function selectSaveFile(fileName: string, owner?: number | null): Promise<string | null> {
  if (!fileName.trim() || fileName === "." || fileName === ".." || /[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/.test(fileName)) {
    throw new Error(t`保存文件名无效，不能包含路径或控制字符`);
  }
  if (dialogOpen) throw new Error(t`已有保存窗口正在操作，请先完成或取消`);
  if (process.platform !== "win32" && process.platform !== "darwin") throw new Error(t`当前系统不支持桌面另存为`);
  dialogOpen = true;
  try {
    const selected = process.platform === "win32" ? await selectWindowsSaveFile(fileName, owner)
      : (await execFileAsync("/usr/bin/osascript", ["-e", macDialog, "--", fileName, t`另存为`], { encoding: "utf8" })).stdout.replace(/\r?\n$/, "");
    if (!selected) return null;
    if (!isAbsolute(selected) || /[\u0000-\u001f\u007f-\u009f]/.test(selected)) throw new Error(t`另存为窗口返回了无效的文件路径`);
    cleanupExpiredTokens();
    const token = crypto.randomUUID();
    pendingSaves.set(token, { path: selected, expiresAt: Date.now() + tokenTtlMs });
    return token;
  } catch (error) {
    throw new Error(t`选择保存位置失败：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  } finally {
    dialogOpen = false;
  }
}

export default async function saveFile(token: string, content: Uint8Array): Promise<boolean> {
  const entry = pendingSaves.get(token);
  pendingSaves.delete(token);
  if (!entry || entry.expiresAt <= Date.now()) throw new Error(t`保存位置已过期，请重新选择保存位置`);
  const selected = entry.path;
  try {
    await writeAtomic(selected, content);
    return true;
  } catch (error) {
    throw new Error(t`保存文件失败：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
