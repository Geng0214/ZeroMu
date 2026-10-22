import { dlopen, ptr } from "bun:ffi";
import { parentPort, workerData } from "node:worker_threads";
import { extname } from "node:path";

if (!parentPort) throw new Error("保存对话框必须在工作线程中运行");
const port = parentPort;
const commonDialog = dlopen("comdlg32.dll", {
  GetSaveFileNameW: { args: ["ptr"], returns: "i32" },
  CommDlgExtendedError: { args: [], returns: "u32" },
});
const user32 = dlopen("user32.dll", {
  IsWindow: { args: ["u64"], returns: "i32" },
  GetWindowThreadProcessId: { args: ["u64", "ptr"], returns: "u32" },
});
const ole32 = dlopen("ole32.dll", {
  CoInitializeEx: { args: ["ptr", "u32"], returns: "i32" },
  CoUninitialize: { args: [], returns: "void" },
});
let apartmentReady = false;
try {
  const { fileName, owner, title } = workerData as { fileName: string; owner: number; title: string };
  if (process.platform !== "win32" || process.arch !== "x64" || typeof fileName !== "string" || fileName.length > 240
    || !fileName.trim() || /[<>:"/\\|?*\u0000-\u001f]/.test(fileName) || !Number.isSafeInteger(owner) || owner <= 0
    || typeof title !== "string" || !user32.symbols.IsWindow(BigInt(owner))) throw new Error("保存窗口参数无效");
  const ownerProcess = Buffer.alloc(4);
  user32.symbols.GetWindowThreadProcessId(BigInt(owner), ptr(ownerProcess));
  if (ownerProcess.readUInt32LE() !== process.pid) throw new Error("保存对话框必须属于当前应用窗口");
  if (ole32.symbols.CoInitializeEx(null, 2) < 0) throw new Error("无法初始化 Windows 保存窗口");
  apartmentReady = true;
  const file = Buffer.alloc(32768 * 2);
  file.write(`${fileName}\0`, "utf16le");
  const labels = {
    filter: Buffer.from("所有文件 (*.*)\0*.*\0\0", "utf16le"),
    title: Buffer.from(`${title}\0`, "utf16le"),
    extension: Buffer.from(`${extname(fileName).slice(1)}\0`, "utf16le"),
  };
  // Windows x64 OPENFILENAMEW 的 SDK 布局；不启用其他平台的条件字段。
  const options = Buffer.alloc(152);
  options.writeUInt32LE(options.length, 0);
  options.writeBigUInt64LE(BigInt(owner), 8);
  options.writeBigUInt64LE(BigInt(ptr(labels.filter)), 24);
  options.writeUInt32LE(1, 44);
  options.writeBigUInt64LE(BigInt(ptr(file)), 48);
  options.writeUInt32LE(file.length / 2, 56);
  options.writeBigUInt64LE(BigInt(ptr(labels.title)), 88);
  // 覆盖确认、目录必须存在、不改进程工作目录、Explorer 样式及可调整大小。
  options.writeUInt32LE(0x2 | 0x8 | 0x800 | 0x80000 | 0x800000, 96);
  options.writeBigUInt64LE(BigInt(ptr(labels.extension)), 104);
  const accepted = commonDialog.symbols.GetSaveFileNameW(ptr(options));
  const errorCode = accepted ? 0 : commonDialog.symbols.CommDlgExtendedError();
  if (errorCode) throw new Error(`Windows 保存窗口失败（0x${errorCode.toString(16)}）`);
  // 缓冲区在原生调用返回后仍可达，避免其指针在模态窗口存活期间失效。
  if (!labels.title.length || !labels.filter.length || !labels.extension.length) throw new Error("保存窗口缓冲区无效");
  port.postMessage({ path: accepted ? file.toString("utf16le").split("\0", 1)[0] : null });
} catch (error) {
  port.postMessage({ error: error instanceof Error ? error.message : "Windows 保存窗口失败" });
} finally {
  if (apartmentReady) ole32.symbols.CoUninitialize();
  commonDialog.close(); user32.close(); ole32.close();
  port.close();
}
