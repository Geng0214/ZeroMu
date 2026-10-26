import { projectPath } from "@/utils/workspace/projectLayout";
import { createReadStream, mkdir, rename, statfs, writeAtomic } from "@toonflow/file";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { createFfmpeg } from "@toonflow/ffmpeg";
import type { FfmpegCommand, FfprobeData } from "@toonflow/ffmpeg/types";
import { getStatus } from "@/utils/ffmpeg";
import { lockWorkspaceFiles, resolveWorkspacePath } from "@/utils/workspace/files";
import { assertProductionPath, projectFileName, readProject } from "./format";
import { verifyVersion, writeProjectRevision } from "./index";
import { editSchema, type EditRecord, type ExportRecord, type ProjectRecord } from "./schema";

type MediaInfo = { duration: number; hasVideo: boolean; hasAudio: boolean; width?: number; height?: number; videoDuration?: number; audioDuration?: number; frames?: number };
type InputFile = { versionId: string; versionHash: string; assetId: string; assetName: string; fileIndex: number; path: string; hash: string; mimeType: string; info: MediaInfo };
type EditManifest = { format: 1; projectId: string; exportId: string; createdAt: number; edit: EditRecord; totalFrames: number; duration: number; clips: (InputFile & { shotId: string; candidateId: string; title: string; taskId?: string; basis: ProjectRecord["candidates"][number]["basis"]; startFrame: number; frameCount: number; originalVolume: number })[]; audio: (InputFile & { offsetSeconds: number; volume: number; role?: string })[] };
type ExportJob = { directory: string; controller: AbortController; command?: FfmpegCommand; progress: number; phase: string };
const jobs = new Map<string, ExportJob>();
export function hasRunningExport(directory: string) { return [...jobs.values()].some(job => job.directory === directory); }
function invalid(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
const jobKey = (directory: string, id: string) => JSON.stringify([resolve(directory), id]);
async function fileHash(path: string) { const hash = createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest("hex"); }
async function factory(directory: string, outputPaths: string[] = []) {
  const { tools } = await getStatus();
  if (!tools.ffmpeg.path || tools.ffmpeg.error || !tools.ffprobe.path || tools.ffprobe.error) invalid("成片需要 FFmpeg 和 ffprobe，未检测到可用版本", 424);
  const ffmpeg = createFfmpeg(directory, { validateOutput(path) { if (!outputPaths.includes(path)) assertProductionPath(directory, [path]); } });
  ffmpeg.setFfmpegPath(tools.ffmpeg.path); ffmpeg.setFfprobePath(tools.ffprobe.path);
  return ffmpeg;
}
async function probe(ffmpeg: Awaited<ReturnType<typeof factory>>, path: string): Promise<MediaInfo> {
  const data = await new Promise<FfprobeData>((yes, no) => ffmpeg.ffprobe(path, (error, result) => error ? no(error) : yes(result)));
  const video = data.streams.find(stream => stream.codec_type === "video" && !stream.disposition?.attached_pic);
  const audio = data.streams.find(stream => stream.codec_type === "audio");
  const duration = Number(data.format.duration ?? video?.duration ?? audio?.duration);
  if (!Number.isFinite(duration) || duration <= 0) invalid("媒体缺少有效时长，不能用于成片");
  if (audio && (!audio.sample_rate || !audio.channels)) invalid("媒体音轨信息异常，请重新编码后导入");
  return { duration, hasVideo: !!video, hasAudio: !!audio, width: video?.width, height: video?.height, videoDuration: Number(video?.duration) || undefined, audioDuration: Number(audio?.duration) || undefined, frames: Number(video?.nb_frames) || undefined };
}
async function inputFile(directory: string, project: ProjectRecord, versionId: string, fileIndex: number, ffmpeg: Awaited<ReturnType<typeof factory>>) {
  const version = project.assetVersions.find(version => version.versionId === versionId);
  const file = version?.files[fileIndex];
  if (!version || !file) invalid("剪辑引用的固定版本或文件不存在", 404);
  await verifyVersion(directory, version);
  const target = await resolveWorkspacePath(directory, file.path);
  return { versionId, versionHash: version.contentHash, assetId: version.assetId, assetName: project.assets.find(asset => asset.assetId === version.assetId)?.name || version.assetId, fileIndex, ...file, info: await probe(ffmpeg, target.path) };
}
export async function validateEdit(directory: string, project: ProjectRecord, value: unknown): Promise<Omit<EditManifest, "exportId" | "createdAt">> {
  const edit = editSchema.parse(value);
  const sequence = project.sequences.find(item => item.sequenceId === edit.sequenceId && !item.archived);
  if (!sequence) invalid("制作单元不存在或已归档", 404);
  // ACT: 首期单进程滤镜图最多 64 个片段、16 条混音轨；更长作品后续改为分段合成。
  if (!edit.clips.length || edit.clips.length > 64 || edit.audio.length > 16) invalid("成片需要 1–64 个视频片段，附加音轨最多 16 条");
  if (edit.output.width % 2 || edit.output.height % 2) invalid("H.264 成片的宽高须为偶数");
  const ffmpeg = await factory(directory);
  const clips: EditManifest["clips"] = []; const audio: EditManifest["audio"] = [];
  for (const clip of edit.clips) {
    const shot = project.shots.find(item => item.shotId === clip.shotId && item.sequenceId === edit.sequenceId);
    const candidate = project.candidates.find(item => item.candidateId === clip.candidateId && item.shotId === clip.shotId);
    const version = project.assetVersions.find(item => item.versionId === candidate?.versionId);
    if (!shot || !candidate || !version) invalid("剪辑片段与镜头或候选归属不一致");
    const fileIndex = candidate.fileIndex ?? version.files.findIndex(file => /^(image|video|audio)\//.test(file.mimeType));
    const input = await inputFile(directory, project, version.versionId, fileIndex, ffmpeg);
    if (!input.mimeType.startsWith("video/") || !input.info.hasVideo) invalid(`“${shot.title}”采用的文件不是有效视频`);
    const startFrame = Math.round(clip.inSeconds * edit.output.frameRate); const endFrame = Math.round(clip.outSeconds * edit.output.frameRate);
    if (clip.outSeconds <= clip.inSeconds || clip.outSeconds > input.info.duration + 0.002 || endFrame <= startFrame) invalid(`“${shot.title}”裁切范围超出媒体时长或不足一帧`);
    clips.push({ ...input, shotId: shot.shotId, candidateId: candidate.candidateId, title: shot.title, taskId: candidate.taskId, basis: structuredClone(candidate.basis), startFrame, frameCount: endFrame - startFrame, originalVolume: clip.originalVolume ?? 1 });
  }
  const totalFrames = clips.reduce((sum, clip) => sum + clip.frameCount, 0); const duration = totalFrames / edit.output.frameRate;
  for (const track of edit.audio) {
    const input = await inputFile(directory, project, track.versionId, track.fileIndex ?? 0, ffmpeg);
    if (!input.mimeType.startsWith("audio/") || !input.info.hasAudio || track.offsetSeconds >= duration) invalid("附加音轨无效，或开始时间已超出成片");
    audio.push({ ...input, ...track });
  }
  for (const subtitle of edit.subtitles) if (!subtitle.text.trim() || subtitle.endSeconds <= subtitle.startSeconds || subtitle.endSeconds > duration + 0.002) invalid("字幕文本为空或时间范围超出成片");
  return { format: 1, projectId: project.projectId, edit, totalFrames, duration, clips, audio };
}

export async function editContext(directory: string, sequenceId: string) {
  const project = await readProject(directory); if (!project) invalid("请先建立制作记录", 404);
  const sequence = project.sequences.find(item => item.sequenceId === sequenceId && !item.archived); if (!sequence) invalid("制作单元不存在", 404);
  const ffmpeg = await factory(directory); const clips = []; const audio = []; const warnings: string[] = [];
  for (const shotId of sequence.shotIds) {
    const shot = project.shots.find(item => item.shotId === shotId)!;
    const candidate = project.candidates.find(item => item.candidateId === shot.adoptedCandidateId);
    const version = project.assetVersions.find(item => item.versionId === candidate?.versionId);
    if (!candidate || !version) { warnings.push(`“${shot.title}”尚未采用视频`); continue; }
    const index = candidate.fileIndex ?? version.files.findIndex(file => /^(image|video|audio)\//.test(file.mimeType));
    if (!version.files[index]?.mimeType.startsWith("video/")) { warnings.push(`“${shot.title}”采用的不是视频`); continue; }
    try { const input = await inputFile(directory, project, version.versionId, index, ffmpeg); clips.push({ ...input, shotId, candidateId: candidate.candidateId, title: shot.title }); }
    catch (cause) { warnings.push(`“${shot.title}”：${cause instanceof Error ? cause.message : String(cause)}`); }
  }
  for (const clip of project.edits.find(item => item.sequenceId === sequenceId)?.clips ?? []) if (!clips.some(item => item.candidateId === clip.candidateId)) {
    const candidate = project.candidates.find(item => item.candidateId === clip.candidateId); const version = project.assetVersions.find(item => item.versionId === candidate?.versionId);
    if (candidate && version) try { const fileIndex = candidate.fileIndex ?? version.files.findIndex(file => /^(image|video|audio)\//.test(file.mimeType)); clips.push({ ...await inputFile(directory, project, version.versionId, fileIndex, ffmpeg), shotId: clip.shotId, candidateId: clip.candidateId, title: project.shots.find(item => item.shotId === clip.shotId)?.title || "历史镜头" }); } catch (cause) { warnings.push(`已保存剪辑的素材不可读取：${cause instanceof Error ? cause.message : String(cause)}`); }
  }
  for (const version of project.assetVersions) for (const [fileIndex, file] of version.files.entries()) if (file.mimeType.startsWith("audio/")) audio.push({ versionId: version.versionId, fileIndex, name: project.assets.find(item => item.assetId === version.assetId)?.name || version.versionId, ...file });
  return { revision: project.revision, sequence, edit: project.edits.find(item => item.sequenceId === sequenceId) ?? null, clips, audio, warnings };
}
async function changeExport(directory: string, id: string, patch: Partial<ExportRecord>) {
  const release = lockWorkspaceFiles([join(directory, projectFileName)]);
  try { const project = await readProject(directory); if (!project) invalid("制作记录不存在", 404); const original = structuredClone(project); const record = project.exports.find(item => item.exportId === id); if (!record) invalid("导出记录不存在", 404); Object.assign(record, patch); return (await writeProjectRevision(directory, original, project)).exports.find(item => item.exportId === id)!; }
  finally { release(); }
}
export async function listExports(directory: string) {
  const project = await readProject(directory); if (!project) return [];
  const result = [];
  for (const record of project.exports) {
    const job = jobs.get(jobKey(directory, record.exportId));
    const saved = record.status === "pending" && !job ? await changeExport(directory, record.exportId, { status: "failed", error: "服务已重启，导出中断；部分文件已保留，请创建新的导出" }) : record;
    result.push({ ...saved, progress: job?.progress ?? (saved.status === "completed" ? 100 : 0), phase: job?.phase ?? saved.status });
  }
  return result;
}
export function cancelExport(directory: string, id: string) { const job = jobs.get(jobKey(directory, id)); if (!job) invalid("此导出已结束或不在当前服务运行", 409); if (job.phase === "保存成片") invalid("成片正在保存，请等待完成后下载", 409); job.controller.abort(); job.command?.kill("SIGKILL"); return { exportId: id }; }

function subtitleText(edit: EditRecord, format: "srt" | "vtt") {
  const time = (seconds: number) => { const ms = Math.round(seconds * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${format === 'srt' ? ',' : '.'}${String(ms % 1000).padStart(3, '0')}`; };
  return (format === "vtt" ? "WEBVTT\n\n" : "") + edit.subtitles.map((cue, index) => `${index + 1}\n${time(cue.startSeconds)} --> ${time(cue.endSeconds)}\n${cue.text.replaceAll("-->", "→")}\n`).join("\n");
}
export async function startExport(directory: string, sequenceId: string, expectedRevision: number, exportId: string) {
  const key = jobKey(directory, exportId); const release = lockWorkspaceFiles([join(directory, projectFileName)]);
  const job: ExportJob = { directory, controller: new AbortController(), progress: 0, phase: "校验固定素材" };
  let manifest: EditManifest; let folder: string;
  try {
    const project = await readProject(directory); if (!project) invalid("制作记录不存在", 404);
    const existing = project.exports.find(item => item.exportId === exportId);
    if (existing) { if (existing.edit.sequenceId !== sequenceId) invalid("导出标识属于另一个制作单元", 409); return existing; }
    if (project.revision !== expectedRevision) invalid("制作记录已更新，请刷新后重新导出", 409);
    if ([...jobs.values()].some(item => item.directory === directory)) invalid("当前项目已有成片正在导出", 409);
    const edit = project.edits.find(item => item.sequenceId === sequenceId); if (!edit) invalid("请先保存剪辑决定", 409);
    const compiled = await validateEdit(directory, project, edit);
    // 无法预先精确预测压缩率；按高码率视频和 PCM 工作量估算，并保留 256 MB 余量。
    const disk = await statfs(directory); const required = compiled.duration * 12 * 1024 * 1024 + 256 * 1024 * 1024;
    if (disk.bavail * disk.bsize < required) invalid("磁盘可用空间不足，请释放空间或缩短成片", 507);
    const createdAt = Date.now(); manifest = { ...compiled, exportId, createdAt };
    const relativeFolder = projectPath(directory, `productionExports/${exportId}`); folder = (await resolveWorkspacePath(directory, relativeFolder, true)).path;
    await mkdir(folder, { recursive: true });
    await writeAtomic(join(folder, "editManifest.json"), JSON.stringify(manifest, null, 2), { exclusive: true });
    await writeAtomic(join(folder, "subtitles.srt"), subtitleText(edit, "srt"), { exclusive: true });
    await writeAtomic(join(folder, "subtitles.vtt"), subtitleText(edit, "vtt"), { exclusive: true });
    const original = structuredClone(project); const record: ExportRecord = { exportId, edit: structuredClone(edit), status: "pending", createdAt, manifestPath: `${relativeFolder}/editManifest.json`, partialPath: `${relativeFolder}/partial.mp4`, totalFrames: manifest.totalFrames };
    project.exports.push(record); jobs.set(key, job);
    await writeProjectRevision(directory, original, project);
  } catch (cause) { jobs.delete(key); throw cause; } finally { release(); }
  void render(directory, folder!, manifest!, job).finally(() => jobs.delete(key));
  return { exportId, status: "pending" as const };
}

async function render(directory: string, folder: string, manifest: EditManifest, job: ExportJob) {
  try {
    const partial = join(folder, "partial.mp4"); const final = join(folder, "movie.mp4");
    const ffmpeg = await factory(directory, [partial]); const command = ffmpeg(); job.command = command;
    const filters: string[] = []; const { width, height, frameRate } = manifest.edit.output;
    // 输入固定版本再次核对；清单不能因用户之后更换采用而改变。
    for (const input of [...manifest.clips, ...manifest.audio]) { const path = (await resolveWorkspacePath(directory, input.path)).path; if (await fileHash(path) !== input.hash) invalid("导出固定输入摘要变化，请恢复原文件", 409); command.input(path); }
    for (const [index, clip] of manifest.clips.entries()) {
      const duration = clip.frameCount / frameRate; const start = clip.startFrame / frameRate;
      filters.push(`[${index}:v]fps=${frameRate},trim=start_frame=${clip.startFrame}:end_frame=${clip.startFrame + clip.frameCount},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${clip.frameCount},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v${index}]`);
      filters.push(clip.info.hasAudio && clip.originalVolume > 0 ? `[${index}:a]atrim=start=${start}:duration=${duration},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${clip.originalVolume},apad,atrim=duration=${duration}[a${index}]` : `anullsrc=r=48000:cl=stereo,atrim=duration=${duration}[a${index}]`);
    }
    filters.push(`${manifest.clips.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${manifest.clips.length}:v=1:a=1[video][original]`);
    for (const [index, audio] of manifest.audio.entries()) filters.push(`[${manifest.clips.length + index}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${audio.volume},adelay=${Math.round(audio.offsetSeconds * 1000)}:all=1,apad,atrim=duration=${manifest.duration}[extra${index}]`);
    // concat 裁切边界产生不同长度的音频帧；统一样本帧并连续计时，避免 amix 在主音轨尾部丢弃尚未混合的样本。
    filters.push("[original]asetpts=N/SR/TB,asetnsamples=n=1024:p=0[originalClock]");
    filters.push(`[originalClock]${manifest.audio.map((_, i) => `[extra${i}]`).join("")}amix=inputs=${manifest.audio.length + 1}:duration=first:normalize=0,alimiter=limit=0.95:latency=1,atrim=duration=${manifest.duration}[audio]`);
    const subtitleIndex = manifest.clips.length + manifest.audio.length;
    if (manifest.edit.subtitles.length) command.input(join(folder, "subtitles.srt"));
    const filterPath = join(folder, "filterGraph.txt");
    await writeAtomic(filterPath, filters.join(";"), { exclusive: true });
    // 单独传入参数保留含空格的目录名；滤镜文件避免 Windows 命令行长度限制。
    command.outputOptions("-filter_complex_script", filterPath).outputOptions(["-map [video]", "-map [audio]", ...(manifest.edit.subtitles.length ? [`-map ${subtitleIndex}:s:0`, "-c:s mov_text", "-metadata:s:s:0 language=zho"] : []), "-c:v libx264", "-preset veryfast", "-crf 18", "-c:a aac", "-b:a 192k", "-ar 48000", `-t ${manifest.duration}`, `-r ${frameRate}`, "-fps_mode cfr", "-movflags +faststart", "-threads 2", "-filter_complex_threads 1"]).output(partial);
    job.phase = "正在合成";
    const timer = setTimeout(() => { job.controller.abort(); command.kill("SIGKILL"); }, 60 * 60 * 1000);
    try {
      job.controller.signal.throwIfAborted();
      await new Promise<void>((yes, no) => { command.on("start", () => { if (job.controller.signal.aborted) command.kill("SIGKILL"); }); command.on("progress", progress => { if (progress.frames) job.progress = Math.min(98, Math.round(progress.frames / manifest.totalFrames * 100)); }); command.on("error", no).on("end", () => yes()).run(); });
      job.controller.signal.throwIfAborted();
    } finally { clearTimeout(timer); job.command = undefined; }
    job.phase = "核对成片"; const info = await probe(ffmpeg, partial);
    if (info.frames !== manifest.totalFrames || info.width !== width || info.height !== height || Math.abs((info.videoDuration ?? info.duration) - manifest.duration) > 1 / frameRate + 0.001 || !info.hasAudio || !info.audioDuration || Math.abs(info.audioDuration - manifest.duration) > 1024 / 48000 + 0.002) invalid("成片帧数、时长、画幅或音轨校验失败，部分文件已保留");
    const outputHash = await fileHash(partial);
    job.controller.signal.throwIfAborted(); job.phase = "保存成片";
    await rename(partial, final);
    await writeAtomic(join(folder, "outputManifest.json"), JSON.stringify({ ...manifest, output: { path: projectPath(directory, `productionExports/${manifest.exportId}/movie.mp4`), hash: outputHash, ...info } }, null, 2), { exclusive: true });
    await changeExport(directory, manifest.exportId, { status: "completed", path: projectPath(directory, `productionExports/${manifest.exportId}/movie.mp4`), actualDuration: info.videoDuration ?? info.duration, outputHash });
    job.progress = 100;
  } catch (cause) {
    const error = job.controller.signal.aborted ? "导出已停止；部分文件保留，原素材不受影响" : cause instanceof Error ? cause.message : String(cause);
    try { await changeExport(directory, manifest.exportId, { status: "failed", error: error.slice(0, 10000) }); }
    catch (failure) { console.error("保存导出状态失败，清单与部分文件保留", failure); }
  }
}
