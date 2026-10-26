import { projectPath } from "@/utils/workspace/projectLayout";
import { mkdir, unlink, withFileAccess, writeAtomic } from "@toonflow/file";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { createFfmpeg } from "@toonflow/ffmpeg";
import type { FfmpegCommand, FfprobeData } from "@toonflow/ffmpeg/types";
import { getStatus } from "@/utils/ffmpeg";
import { lockWorkspaceFiles, resolveWorkspacePath } from "@/utils/workspace/files";
import { createVersion, readProjectFile, stableId, verifyVersion } from "./index";
import { readProject } from "./format";
import { imageEditParametersSchema, type ImageEditContext, type ProductionOperation, type ProjectRecord } from "./schema";

const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const contextSchema = z.strictObject({ schemaVersion: z.literal(1), contextId: z.uuid(), projectId: z.uuid(), revision: z.number().int().nonnegative(), sourceCandidateId: z.uuid(), sourceVersionId: z.uuid(), sourceFileIndex: z.number().int().nonnegative().max(63), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), width: z.number().int().positive().max(8192), height: z.number().int().positive().max(8192), normalizedHash: z.string().regex(/^[a-f0-9]{64}$/), previewHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.number().finite().nonnegative() });
type ImageEditOperation = Extract<ProductionOperation, { type: "editImageCandidate" }>;
function fail(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }
const folderFor = (directory: string, id: string) => projectPath(directory, `productionImageEdits/${z.uuid().parse(id)}`);
function pngSize(bytes: Buffer) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString("ascii", 12, 16) !== "IHDR") fail("图片处理未产生有效 PNG", 422);
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16777216) fail("本地图片编辑支持边长不超过 8192、总像素不超过 1677 万的图片", 400);
  return { width, height };
}
async function factory(directory: string, output: string) {
  const { tools } = await getStatus();
  if (!tools.ffmpeg.path || tools.ffmpeg.error || !tools.ffprobe.path || tools.ffprobe.error) fail("本地图片编辑需要 FFmpeg 和 ffprobe，未检测到可用版本", 424);
  const target = (await resolveWorkspacePath(directory, output, true)).path;
  const ffmpeg = createFfmpeg(directory, { validateOutput(path) { if (path !== target) fail("图片处理只能写入本次的新文件", 403); } });
  ffmpeg.setFfmpegPath(tools.ffmpeg.path); ffmpeg.setFfprobePath(tools.ffprobe.path);
  return ffmpeg;
}
async function render(command: FfmpegCommand) {
  await new Promise<void>((yes, no) => {
    let expired = false;
    const timer = setTimeout(() => { expired = true; command.kill("SIGKILL"); }, 60000);
    command.on("error", () => { clearTimeout(timer); no(new Error(expired ? "图片处理超时，原图保持完整，请缩小范围后重试" : "图片处理失败，原图保持完整；请检查输入图片与 FFmpeg")); }).on("end", () => { clearTimeout(timer); yes(); }).run();
  });
}
export async function readImageEditContext(directory: string, id: string) {
  const folder = folderFor(directory, id); const bytes = await readProjectFile(directory, `${folder}/context.json`);
  let saved: unknown;
  try { saved = JSON.parse(bytes.toString("utf8")); } catch { fail("图片编辑依据无法解析，请保留目录并重新打开编辑器", 422); }
  const checked = contextSchema.safeParse(saved); if (!checked.success) fail("图片编辑依据损坏或格式不受支持，请保留目录并重新打开编辑器", 422);
  const value = checked.data;
  if (value.contextId !== id) fail("图片编辑依据标识不匹配");
  return value;
}
export function imageCandidateSource(project: ProjectRecord, candidateId: string) {
  const candidate = project.candidates.find(item => item.candidateId === candidateId);
  const shot = project.shots.find(item => item.shotId === candidate?.shotId && !item.archived);
  const version = project.assetVersions.find(item => item.versionId === candidate?.versionId);
  const fileIndex = candidate?.fileIndex ?? version?.files.findIndex(file => /^(image|video|audio)\//.test(file.mimeType)) ?? -1;
  const file = version?.files[fileIndex];
  if (!candidate || !shot || !version || !file || !/^image\/(png|jpeg|webp)$/.test(file.mimeType)) fail("请选择活动镜头中的 PNG、JPEG 或 WebP 图片候选", 400);
  if (project.assets.find(item => item.assetId === version.assetId)?.archived) fail("来源素材已归档，请先选择活动素材");
  return { candidate, shot, version, file, fileIndex };
}
export async function prepareImageEdit(directory: string, id: string, candidateId: string): Promise<ImageEditContext> {
  const folder = folderFor(directory, id);
  return withFileAccess([`${join(directory, folder)}.prepare`], "write", async () => {
    const release = lockWorkspaceFiles([join(directory, folder)]);
    try {
      const project = await readProject(directory); if (!project) fail("请先建立项目制作记录", 404);
      const source = imageCandidateSource(project, candidateId); await verifyVersion(directory, source.version);
      let context = await readImageEditContext(directory, id).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return undefined; });
      if (context && (context.projectId !== project.projectId || context.sourceCandidateId !== candidateId || context.sourceHash !== source.file.hash)) fail("编辑标识已用于其他来源");
      if (!context) {
        await resolveWorkspacePath(directory, folder, true); await mkdir(join(directory, folder), { recursive: true });
        const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[source.file.mimeType];
        const rawPath = `${folder}/input${crypto.randomUUID()}.${extension}`; const bytes = await readProjectFile(directory, source.file.path);
        if (!(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 || bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP")) fail("来源文件不是受支持的栅格图片", 400);
        if (digest(bytes) !== source.file.hash) fail("来源图片已改变，请恢复固定版本");
        await writeAtomic(join(directory, rawPath), bytes, { exclusive: true });
        const normalPath = `${folder}/source.png`; const previewPath = `${folder}/preview.png`;
        const ffmpeg = await factory(directory, normalPath);
        const info = await new Promise<FfprobeData>((yes, no) => ffmpeg.ffprobe(rawPath, (error, value) => error ? no(new Error("无法读取来源图片，请检查文件")) : yes(value)));
        const stream = info.streams.find(item => item.codec_type === "video");
        if (!stream?.width || !stream.height || stream.width > 8192 || stream.height > 8192 || stream.width * stream.height > 16777216) fail("本地图片编辑支持边长不超过 8192、总像素不超过 1677 万的图片", 400);
        await render(ffmpeg(rawPath).inputOptions("-protocol_whitelist file,pipe").outputOptions(["-frames:v 1", "-pix_fmt rgba", "-threads 1", "-update 1"]).output(normalPath));
        const normal = await readProjectFile(directory, normalPath); const size = pngSize(normal);
        const previewFactory = await factory(directory, previewPath);
        await render(previewFactory(normalPath).videoFilters("scale=w=min(1024\\,iw):h=min(1024\\,ih):force_original_aspect_ratio=decrease").outputOptions(["-frames:v 1", "-pix_fmt rgba", "-threads 1", "-update 1"]).output(previewPath));
        const preview = await readProjectFile(directory, previewPath); pngSize(preview);
        context = { schemaVersion: 1, contextId: id, projectId: project.projectId, revision: project.revision, sourceCandidateId: candidateId, sourceVersionId: source.version.versionId, sourceFileIndex: source.fileIndex, sourceHash: source.file.hash, ...size, normalizedHash: digest(normal), previewHash: digest(preview), createdAt: Date.now() };
        await writeAtomic(join(directory, folder, "context.json"), JSON.stringify(context, null, 2), { exclusive: true });
        await unlink(join(directory, rawPath));
      }
      const normal = await readProjectFile(directory, `${folder}/source.png`); const preview = await readProjectFile(directory, `${folder}/preview.png`);
      if (digest(normal) !== context.normalizedHash || digest(preview) !== context.previewHash) fail("编辑预览或固定输入已改变，请保留目录并重新打开编辑器");
      return { contextId: id, projectId: project.projectId, revision: project.revision, sourceCandidateId: candidateId, sourceVersionId: source.version.versionId, width: context.width, height: context.height, preview: `data:image/png;base64,${preview.toString("base64")}` };
    } finally { release(); }
  });
}
export function existingImageEdit(project: ProjectRecord, operation: ImageEditOperation) {
  const prior = project.candidates.find(item => item.candidateId === operation.editId); if (!prior) return undefined;
  const version = project.assetVersions.find(item => item.versionId === prior.versionId);
  const details = version?.details.imageEdit as { contextId?: string; parameters?: unknown } | undefined;
  if (!details || details.contextId !== operation.contextId || JSON.stringify(details.parameters) !== JSON.stringify(operation.parameters)) fail("编辑标识已用于不同参数，请保留旧结果并重新创建编辑");
  return version;
}
export async function applyImageEdit(directory: string, project: ProjectRecord, operation: ImageEditOperation) {
  const parameters = imageEditParametersSchema.parse(operation.parameters);
  const context = await readImageEditContext(directory, operation.contextId).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") fail("编辑预览尚未准备完成或已移除，请重新打开编辑器", 404); throw error; });
  const source = imageCandidateSource(project, context.sourceCandidateId);
  if (project.projectId !== context.projectId || source.version.versionId !== context.sourceVersionId || source.fileIndex !== context.sourceFileIndex || source.file.hash !== context.sourceHash) fail("来源候选与固定编辑依据不一致，请重新打开编辑器");
  await verifyVersion(directory, source.version);
  const { crop, rotation, output } = parameters;
  if (crop.x + crop.width > context.width || crop.y + crop.height > context.height) fail("裁剪范围超出原图，请核对像素坐标", 400);
  const folder = folderFor(directory, operation.contextId); const sourcePath = `${folder}/source.png`;
  if (digest(await readProjectFile(directory, sourcePath)) !== context.normalizedHash) fail("编辑固定输入已改变，请重新打开编辑器");
  const outputPath = `${folder}/result${operation.editId}.png`;
  const ffmpeg = await factory(directory, outputPath);
  const filters = [`crop=w=${crop.width}:h=${crop.height}:x=${crop.x}:y=${crop.y}:exact=1`, ...(rotation === 90 ? ["transpose=1"] : rotation === 180 ? ["hflip", "vflip"] : rotation === 270 ? ["transpose=2"] : []), `scale=${output.width}:${output.height}:flags=lanczos`, "setsar=1"];
  await render(ffmpeg(sourcePath).videoFilters(filters).outputOptions(["-frames:v 1", "-pix_fmt rgba", "-threads 1", "-update 1"]).output(outputPath));
  const rendered = await readProjectFile(directory, outputPath); const size = pngSize(rendered);
  if (size.width !== output.width || size.height !== output.height) fail("输出尺寸与确认参数不一致，未登记候选", 422);
  const version = await createVersion(directory, { type: "createAssetVersion", assetId: source.version.assetId, parentVersionId: source.version.versionId, files: [{ path: outputPath, mimeType: "image/png", view: "本地编辑" }], text: source.version.text, description: `裁剪 ${crop.width}×${crop.height} · 顺时针 ${rotation}° · ${output.width}×${output.height}`, details: { ...source.version.details, imageEdit: { schemaVersion: 1, editId: operation.editId, contextId: context.contextId, sourceCandidateId: source.candidate.candidateId, sourceVersionId: source.version.versionId, sourceFileIndex: source.fileIndex, sourceHash: source.file.hash, sourceDimensions: { width: context.width, height: context.height }, parameters } }, source: "edit" }, { versionId: stableId(`${operation.editId}:imageVersion`), createdAt: context.createdAt, fileHash: digest(rendered) });
  const asset = project.assets.find(item => item.assetId === version.assetId)!;
  project.assetVersions.push(version); asset.versionIds.push(version.versionId); asset.activeVersionId = version.versionId;
  project.candidates.push({ candidateId: operation.editId, shotId: source.shot.shotId, versionId: version.versionId, fileIndex: 0, parentCandidateId: source.candidate.candidateId, createdAt: Date.now(), basis: structuredClone(source.candidate.basis) });
  source.shot.candidateIds.push(operation.editId);
  return operation.editId;
}
