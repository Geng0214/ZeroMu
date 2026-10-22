import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { lstat, mkdir, readFile, readdir, unlink, writeAtomic } from "@toonflow/file";
import { z } from "zod";
import conf from "@/utils/conf";
import { getStatus } from "@/utils/ffmpeg";
import { mentionAssetType } from "@/agent/mentionSources";
import { resolveWorkspacePath } from "./files";
import { createPreviewToken } from "./preview";

const infoSchema = z.strictObject({ width: z.number().int().positive().max(32768), height: z.number().int().positive().max(32768), duration: z.number().finite().nonnegative(), bytes: z.number().int().nonnegative() });
const pending = new Map<string, Promise<z.infer<typeof infoSchema>>>();
const queue: (() => void)[] = [];
const inputFormats = "mov,matroska,avi,ogg,mpegts,mpegvideo,mpeg,h264,hevc,image2,image2pipe,jpeg_pipe,png_pipe,webp_pipe,bmp_pipe,tiff_pipe,gif,apng,avif,jpegxl_pipe,ico,flv,asf,mxf";
let running = 0; let lastTrim = 0;
const cacheDirectory = () => join(dirname(conf.path), "cache", "mediaPreviews");
function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
function identity(path: string, info: Awaited<ReturnType<typeof lstat>>) { return createHash("sha256").update(JSON.stringify([2, path, info.size, info.mtimeMs, info.ctimeMs])).digest("hex"); }
async function runTool(program: string, args: string[]) {
  const child = Bun.spawn([program, ...args], { stdout: "pipe", stderr: "pipe", windowsHide: true });
  const timeout = setTimeout(() => child.kill(), 15000);
  try { const [output, , code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); if (code) fail("缩略图暂不可用，可打开原件查看", 422); return output; }
  finally { clearTimeout(timeout); }
}
async function trimCache(root: string) {
  if (Date.now() - lastTrim < 60000) return; lastTrim = Date.now();
  const names = (await readdir(root)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
  if (names.length <= 1000) return;
  const records = await Promise.all(names.map(async name => ({ name, age: (await lstat(join(root, name))).mtimeMs })));
  for (const item of records.sort((a, b) => a.age - b.age).slice(0, names.length - 1000)) for (const name of [item.name, item.name.replace(".json", ".jpg")]) await unlink(join(root, name)).catch((cause: NodeJS.ErrnoException) => { if (cause.code !== "ENOENT") throw cause; });
}
async function thumbnail(path: string, key: string, bytes: number) {
  const root = cacheDirectory(); await mkdir(root, { recursive: true });
  try {
    const raw = await readFile(join(root, `${key}.json`), "utf8"); const file = await lstat(join(root, `${key}.jpg`));
    if (raw.length <= 4096 && file.isFile() && !file.isSymbolicLink() && file.size > 0 && file.size <= 2 * 1024 * 1024) return infoSchema.parse(JSON.parse(raw));
  } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT" && !(cause instanceof SyntaxError) && !(cause instanceof z.ZodError)) throw cause; }
  const { tools } = await getStatus();
  if (!tools.ffmpeg.path || tools.ffmpeg.error || !tools.ffprobe.path || tools.ffprobe.error) fail("缩略图需要 FFmpeg，可打开原件查看", 424);
  const result = JSON.parse(await runTool(tools.ffprobe.path, ["-v", "error", "-max_alloc", "67108864", "-protocol_whitelist", "file,pipe", "-format_whitelist", inputFormats, "-show_entries", "stream=codec_type,width,height:stream_side_data=rotation:format=duration", "-of", "json", path]));
  const stream = result.streams?.find((item: { codec_type?: string }) => item.codec_type === "video");
  let width = Number(stream?.width); let height = Number(stream?.height);
  if (Math.abs(Number(stream?.side_data_list?.find((item: { rotation?: number }) => item.rotation !== undefined)?.rotation) || 0) % 180 === 90) [width, height] = [height, width];
  const info = infoSchema.parse({ width, height, bytes, duration: Number.isFinite(Number(result.format?.duration)) ? Math.max(0, Number(result.format.duration)) : 0 });
  if (width * height > 100000000) fail("原件像素过大，请打开原件查看", 413);
  const temporary = join(root, `pending${crypto.randomUUID()}.jpg`);
  try {
    await runTool(tools.ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-nostdin", "-max_alloc", "67108864", "-protocol_whitelist", "file,pipe", "-format_whitelist", inputFormats, "-threads", "2", "-i", path, "-map", "0:v:0", "-frames:v", "1", "-vf", "scale=480:480:force_original_aspect_ratio=decrease", "-q:v", "6", "-threads", "2", temporary]);
    if (identity(path, await lstat(path)) !== key) fail("原件在生成缩略图时变化，请重新打开预览", 409);
    const image = await readFile(temporary); if (!image.length || image.length > 2 * 1024 * 1024) fail("缩略图大小超限，可打开原件查看", 413);
    await writeAtomic(join(root, `${key}.jpg`), image); await writeAtomic(join(root, `${key}.json`), JSON.stringify(info));
  } finally { await unlink(temporary).catch((cause: NodeJS.ErrnoException) => { if (cause.code !== "ENOENT") throw cause; }); }
  void trimCache(root).catch(cause => console.warn("预览缓存暂未整理", cause)); return info;
}
async function queuedThumbnail(path: string, key: string, bytes: number) {
  const existing = pending.get(key); if (existing) return existing;
  if (queue.length >= 256) fail("预览正在排队，请稍后重新打开", 429);
  const job = (async () => {
    if (running >= 2) await new Promise<void>(resolve => queue.push(resolve)); else running++;
    try { return await thumbnail(path, key, bytes); }
    finally { const next = queue.shift(); if (next) next(); else running--; }
  })();
  pending.set(key, job); try { return await job; } finally { if (pending.get(key) === job) pending.delete(key); }
}
export async function prepareMediaPreview(directory: string, path: string, hintMimeType?: string) {
  const source = await resolveWorkspacePath(directory, path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") fail("原件不存在，请重新定位文件", 404); throw cause; });
  const file = await lstat(source.path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") fail("原件不存在，请重新定位文件", 404); throw cause; });
  const mimeType = hintMimeType || mentionAssetType(path).mimeType;
  if (!file.isFile() || file.isSymbolicLink() || file.size > 100 * 1024 * 1024) fail("预览需要不超过 100 MB 的普通文件");
  if (!/^(image|video)\//.test(mimeType)) fail("此文件不支持画面缩略图", 415);
  const originalUrl = `/api/workspaces/files/preview?token=${createPreviewToken(directory, path, mimeType)}`;
  const key = identity(source.path, file);
  try {
    const info = await queuedThumbnail(source.path, key, file.size);
    return { ...info, mimeType, originalUrl, thumbnailUrl: `/api/workspaces/files/preview?token=${createPreviewToken(cacheDirectory(), `${key}.jpg`)}`, message: "" };
  } catch (cause) {
    if (![413, 422, 424, 429].includes(Number((cause as { status?: number }).status))) throw cause;
    return { width: 0, height: 0, duration: 0, bytes: file.size, mimeType, originalUrl, thumbnailUrl: "", message: (cause as Error).message };
  }
}
