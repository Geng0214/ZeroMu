import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative } from "node:path";
import { constants, copyFile, lstat, mkdir, open, readFile, realpath, unlink, writeAtomic } from "@toonflow/file";
import conf from "@/utils/conf";
import { getStatus } from "@/utils/ffmpeg";
import worker from "./backgroundRemovalWorker";
import licenseText from "./biRefNetLicense";

export const backgroundRemovalModel = {
  id: "biRefNetTiny", label: "BiRefNet 本机背景移除", bytes: 224005088,
  sha256: "5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333",
  url: "https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx",
  homepage: "https://github.com/ZhengPeng7/BiRefNet", license: "MIT", runtimeVersion: "1.30.0",
} as const;
type DownloadState = { phase: "idle" | "downloading" | "ready" | "cancelled" | "failed"; received: number; error?: string };
let download: DownloadState = { phase: "idle", received: 0 };
let downloadController: AbortController | undefined;
let verified: { path: string; mtimeMs: number; size: number } | undefined;
let processing = false;
const require = createRequire(import.meta.url);
const modelDirectory = () => join(dirname(conf.path), "localModels", backgroundRemovalModel.id);
const modelPath = () => join(modelDirectory(), "model.onnx");
function invalid(message: string, status = 400): never { throw Object.assign(new Error(message), { status, submissionRejected: true }); }

async function modelReady() {
  const path = modelPath();
  const metadata = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
  if (!metadata) return false;
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== backgroundRemovalModel.bytes) invalid("本机背景模型文件不完整，请重新下载；现有普通文件会保留副本", 409);
  if (verified?.path === path && verified.mtimeMs === metadata.mtimeMs && verified.size === metadata.size) return true;
  if (createHash("sha256").update(await readFile(path)).digest("hex") !== backgroundRemovalModel.sha256) invalid("本机背景模型摘要与固定版本不符，请重新下载；现有文件会保留副本", 409);
  verified = { path, mtimeMs: metadata.mtimeMs, size: metadata.size };
  return true;
}

export async function getBackgroundRemovalStatus() {
  if (!downloadController) {
    try {
      if (await modelReady()) download = { phase: "ready", received: backgroundRemovalModel.bytes };
      else if (download.phase === "ready") { download = { phase: "idle", received: 0 }; verified = undefined; }
    }
    catch (error) { download = { phase: "failed", received: 0, error: error instanceof Error ? error.message : "本机背景模型无法读取" }; }
  }
  return { ...download, model: backgroundRemovalModel, processing };
}

async function downloadModel(signal: AbortSignal) {
  const directory = modelDirectory();
  await mkdir(directory, { recursive: true });
  const offset = relative(await realpath(dirname(conf.path)), await realpath(directory));
  if (isAbsolute(offset) || offset === ".." || offset.startsWith("..\\") || offset.startsWith("../")) invalid("模型安装目录超出应用数据范围", 403);
  try { if (await modelReady()) { download = { phase: "ready", received: backgroundRemovalModel.bytes }; return; } }
  catch (error) {
    if (!(error instanceof Error) || !("status" in error) || error.status !== 409) throw error;
    const prior = await lstat(modelPath());
    if (!prior.isFile() || prior.isSymbolicLink()) invalid("模型缓存位置不是普通文件，请检查应用数据目录后重试", 409);
    await copyFile(modelPath(), join(directory, `preserved${crypto.randomUUID().replaceAll("-", "")}.onnx`), constants.COPYFILE_EXCL);
    await unlink(modelPath()); verified = undefined;
  }
  const temporary = join(directory, `download${crypto.randomUUID().replaceAll("-", "")}.onnx`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    let address = new URL(backgroundRemovalModel.url);
    let response: Response | undefined;
    for (let redirect = 0; redirect < 5; redirect++) {
      signal.throwIfAborted();
      if (address.protocol !== "https:" || !["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(address.hostname)) invalid("模型下载发生了不受支持的跳转", 502);
      response = await fetch(address, { redirect: "manual", signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location"); await response.body?.cancel();
      if (!location || redirect === 4) invalid("模型下载跳转过多或缺少目标", 502);
      address = new URL(location, address);
    }
    if (!response?.ok || !response.body) invalid("模型下载失败，请稍后重新下载", 502);
    const hash = createHash("sha256");
    let received = 0;
    for await (const chunk of response.body) {
      signal.throwIfAborted(); received += chunk.length;
      if (received > backgroundRemovalModel.bytes) invalid("模型下载大小与固定版本不符", 502);
      let written = 0;
      while (written < chunk.length) written += (await handle.write(chunk.subarray(written))).bytesWritten;
      hash.update(chunk); download = { phase: "downloading", received };
    }
    if (received !== backgroundRemovalModel.bytes || hash.digest("hex") !== backgroundRemovalModel.sha256) invalid("模型下载校验失败，请重新下载", 502);
    await handle.sync(); await handle.close(); signal.throwIfAborted();
    await copyFile(temporary, modelPath(), constants.COPYFILE_EXCL);
    await writeAtomic(join(directory, "model.json"), JSON.stringify({ ...backgroundRemovalModel, licenseText }, null, 2));
    verified = undefined;
    if (!await modelReady()) invalid("模型安装未完成", 500);
    download = { phase: "ready", received };
  } finally {
    await handle.close().catch(() => {});
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}

export function startBackgroundRemovalDownload() {
  if (downloadController) invalid("正在下载本机背景模型，请等待或先取消", 409);
  const controller = new AbortController(); downloadController = controller;
  const timeout = setTimeout(() => controller.abort(new Error("模型下载超时，请重新下载")), 5 * 60 * 1000);
  download = { phase: "downloading", received: 0 };
  void downloadModel(controller.signal).catch(error => {
    const cancelled = controller.signal.aborted && controller.signal.reason?.name === "AbortError";
    download = { phase: cancelled ? "cancelled" : "failed", received: download.received,
      ...(cancelled ? {} : { error: controller.signal.aborted ? "模型下载超时，请重新下载" : error instanceof Error ? error.message : "模型下载失败，请重新下载" }) };
  }).finally(() => { clearTimeout(timeout); if (downloadController === controller) downloadController = undefined; });
  return { ...download, model: backgroundRemovalModel };
}

export function cancelBackgroundRemovalDownload() { downloadController?.abort(); return { ...download }; }

export async function removeBackground(input: Uint8Array, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!ArrayBuffer.isView(input) || input.BYTES_PER_ELEMENT !== 1 || !input.length || input.length > 32 * 1024 ** 2) invalid("请选择不超过 32 MB 的 PNG、JPEG 或 WebP 图片");
  const bytes = Buffer.from(input);
  if (!(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    || bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP")) invalid("背景移除仅支持 PNG、JPEG 和 WebP 图片");
  if (!await modelReady()) invalid("请先在模型配置中下载并启用本机背景移除", 424);
  const { tools } = await getStatus();
  if (!tools.ffmpeg.path || tools.ffmpeg.error || !tools.ffprobe.path || tools.ffprobe.error) throw Object.assign(new Error("本机背景移除需要 FFmpeg 和 ffprobe，请在扩展管理完成配置"), { name: "FfmpegRequiredError", code: "FFMPEG_REQUIRED", status: 424, submissionRejected: true });
  let runtime: string;
  try { runtime = require.resolve("onnxruntime-node"); } catch { invalid("当前应用缺少本机图片运行环境，请安装包含该能力的完整版本", 424); }
  signal?.throwIfAborted();
  if (processing) invalid("本机正在处理另一张背景图片，请完成或取消后再试", 409);
  processing = true;
  try {
    const child = Bun.spawn([process.execPath, "--eval", `(${worker.toString()})().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;})`], {
      env: { ...process.env, TOONFLOW_BACKGROUND_WORKER: JSON.stringify({ runtime, model: modelPath(), ffmpeg: tools.ffmpeg.path, ffprobe: tools.ffprobe.path }) },
      stdin: new Blob([bytes]), stdout: "pipe", stderr: "pipe", windowsHide: true,
    });
    const abort = () => child.kill(); signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => child.kill(), 120000);
    try {
      const read = async (stream: ReadableStream<Uint8Array>, limit: number) => {
        const chunks: Uint8Array[] = []; let size = 0;
        for await (const chunk of stream) { size += chunk.length; if (size > limit) { child.kill(); throw new Error("本机图片输出超出大小限制"); } chunks.push(chunk); }
        return Buffer.concat(chunks);
      };
      const [output, errors, code] = await Promise.all([read(child.stdout, 96 * 1024 ** 2), read(child.stderr, 65536), child.exited]);
      signal?.throwIfAborted();
      if (code !== 0) throw new Error(errors.toString("utf8").trim().slice(0, 1000) || "本机背景处理未完成，请重试");
      const headerEnd = output.indexOf(10);
      if (headerEnd < 1 || headerEnd > 4096) throw new Error("本机图片运行环境返回了无效响应");
      const metadata = JSON.parse(output.subarray(0, headerEnd).toString("utf8")) as { width: number; height: number; inferenceMs: number; runtimeVersion: string };
      const data = output.subarray(headerEnd + 1);
      if (metadata.runtimeVersion !== backgroundRemovalModel.runtimeVersion || data.length < 33 || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        || data[25] !== 6 || data.readUInt32BE(16) !== metadata.width || data.readUInt32BE(20) !== metadata.height) throw new Error("本机图片结果格式或运行环境版本不匹配");
      return { data: new Uint8Array(data), mimeType: "image/png" as const, ...metadata, modelId: backgroundRemovalModel.id, modelSha256: backgroundRemovalModel.sha256 };
    } finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); if (child.exitCode === null) child.kill(); }
  } finally { processing = false; }
}
