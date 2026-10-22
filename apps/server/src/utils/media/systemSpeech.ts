import { execFile } from "node:child_process";
import { join } from "node:path";
import { existsSync } from "@toonflow/file";
import { z } from "zod";

const speechScript = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$synthesizer = $null
$memory = $null
$failureCode = 'engineUnavailable'
try {
  Add-Type -AssemblyName System.Speech
  $speechRequest = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $installed = @($synthesizer.GetInstalledVoices() | Where-Object Enabled | ForEach-Object {
    @{ name = $_.VoiceInfo.Name; culture = $_.VoiceInfo.Culture.Name }
  })
  if ($speechRequest.action -eq 'voices') {
    $result = @{ voices = $installed }
  } elseif ($speechRequest.action -eq 'synthesize') {
    $failureCode = 'voiceUnavailable'
    if (-not ($installed | Where-Object { $_.name -ceq $speechRequest.voice })) { throw 'voiceUnavailable' }
    $synthesizer.SelectVoice([string]$speechRequest.voice)
    $synthesizer.Rate = 0
    $synthesizer.Volume = 100
    $memory = New-Object IO.MemoryStream
    $synthesizer.SetOutputToWaveStream($memory)
    $failureCode = 'synthesisFailed'
    $synthesizer.Speak([string]$speechRequest.text)
    $synthesizer.SetOutputToNull()
    $result = @{ data = [Convert]::ToBase64String($memory.ToArray()); voice = $synthesizer.Voice.Name }
  } else { throw 'unsupportedAction' }
  [Console]::Out.Write(($result | ConvertTo-Json -Compress -Depth 4))
} catch {
  [Console]::Out.Write((@{ error = $failureCode } | ConvertTo-Json -Compress))
  exit 1
} finally {
  if ($synthesizer) { $synthesizer.Dispose() }
  if ($memory) { $memory.Dispose() }
}
`;
const encodedScript = Buffer.from(speechScript, "utf16le").toString("base64");
const voiceSchema = z.object({ name: z.string().min(1).max(256), culture: z.string().max(64) });
const voicesSchema = z.object({ voices: z.array(voiceSchema).max(1000) });
const speechRequestSchema = z.strictObject({ text: z.string().max(4000).refine(value => !!value.trim()), voice: z.string().min(1).max(256) });
type SystemVoice = z.infer<typeof voiceSchema>;
let voiceCache: { expiresAt: number; voices: SystemVoice[] } | undefined;
let pendingVoices: Promise<SystemVoice[]> | undefined;

function speechError(message: string) {
  return Object.assign(new Error(message), { status: 422, submissionRejected: true });
}

function runSpeech(input: { action: "voices" } | { action: "synthesize"; text: string; voice: string }, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  if (process.platform !== "win32") throw speechError("系统配音仅支持 Windows，请选择当前设备可用的音频渠道");
  const windowsDirectory = process.env.SystemRoot ?? process.env.windir ?? process.env.WINDIR;
  const executable = windowsDirectory && join(windowsDirectory, "System32/WindowsPowerShell/v1.0/powershell.exe");
  if (!executable || !existsSync(executable)) throw speechError("未找到 Windows 系统语音运行环境");
  return new Promise((resolve, reject) => {
    // 提示词和音色仅通过 JSON 标准输入传递；命令及脚本固定，不插入用户代码，不写临时脚本或音频。
    const child = execFile(executable, ["-NoProfile", "-NoLogo", "-NonInteractive", "-Sta", "-EncodedCommand", encodedScript], {
      windowsHide: true, encoding: "utf8", timeout: input.action === "voices" ? 15000 : 120000,
      maxBuffer: input.action === "voices" ? 1024 * 1024 : 64 * 1024 * 1024, signal,
    }, (error, stdout) => {
      if (signal?.aborted) { reject(signal.reason); return; }
      let result: unknown;
      try { result = JSON.parse(stdout.replace(/^\uFEFF/, "")); } catch { /* 运行环境异常统一报告，避免回显输入。 */ }
      const code = result && typeof result === "object" && "error" in result ? result.error : undefined;
      if (error || code) {
        voiceCache = undefined;
        reject(speechError(code === "voiceUnavailable" ? "所选 Windows 音色已不可用，请刷新模型并重新选择"
          : code === "synthesisFailed" ? "Windows 系统配音失败，原有音频未修改，请缩短文本或换一个已安装音色重试"
          : "Windows 系统语音不可用，请确认系统已安装并启用语音音色"));
        return;
      }
      resolve(result);
    });
    // 提前退出可能先关闭输入管道；最终结果统一由 execFile 回调处理。
    child.stdin?.on("error", () => {});
    child.stdin?.end(JSON.stringify(input), "utf8");
  });
}

export async function getSystemSpeechVoices(): Promise<SystemVoice[]> {
  if (voiceCache && voiceCache.expiresAt > Date.now()) return voiceCache.voices;
  pendingVoices ??= runSpeech({ action: "voices" }).then(value => {
    const result = voicesSchema.safeParse(value);
    if (!result.success || !result.data.voices.length) throw speechError("当前设备没有可用的 Windows 系统音色");
    voiceCache = { voices: result.data.voices, expiresAt: Date.now() + 30000 };
    return voiceCache.voices;
  }).finally(() => { pendingVoices = undefined; });
  return pendingVoices;
}

export async function synthesizeSystemSpeech(value: { text: string; voice: string }, signal?: AbortSignal) {
  const checked = speechRequestSchema.safeParse(value);
  if (!checked.success) throw speechError("请选择已安装的 Windows 音色，并输入 1 至 4000 个字符的配音文本");
  const result = await runSpeech({ action: "synthesize", ...checked.data }, signal);
  const parsed = z.object({ data: z.string().min(1), voice: z.string().min(1).max(256) }).safeParse(result);
  if (!parsed.success) throw speechError("Windows 系统语音未返回有效音频");
  const data = Buffer.from(parsed.data.data, "base64");
  if (data.length < 44 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WAVE") {
    throw speechError("Windows 系统语音返回的 WAV 数据无效");
  }
  return { data, voice: parsed.data.voice };
}
