export default {
  id: "windowsSpeech",
  label: "Windows 系统配音",
  version: "1.0.0",
  requiresApiKey: false,
  readme: `使用当前 Windows 设备已安装并启用的系统音色，选择音色后输入文本即可生成配音，无需应用内 API Key。

支持 WAV、MP3，每次最多 4000 个字符，使用音色的正常语速与原始音量。音色列表来自当前运行设备；项目移动到另一台设备后，已生成音频仍可播放，新配音需要重新核对可用音色。

语音通过 Windows System.Speech 生成。参考：[Microsoft SpeechSynthesizer 文档](https://learn.microsoft.com/en-us/dotnet/api/system.speech.synthesis.speechsynthesizer?view=netframework-4.8.1)。`,
  rules: [],
  models: [{
    id: "systemSpeech", label: "Windows 系统语音", type: "audio", mode: ["text"],
    voices: [], audioFormats: ["mp3", "wav"], audioSpeedRange: { min: 1, max: 1 },
  }],
  async generateAudio(request: AudioRequest): Promise<MediaAsset[]> {
    function invalid(message: string): never { throw Object.assign(new Error(message), { submissionRejected: true }); }
    if (request.model !== "systemSpeech") invalid("请选择 Windows 系统语音模型");
    if (!request.text.trim() || request.text.length > 4000) invalid("系统配音每次需要 1 至 4000 个字符，请缩短文本后重试");
    if (request.audios?.length) invalid("系统配音需要文本和已安装音色");
    if (request.speed !== undefined && request.speed !== 1) invalid("系统配音当前使用正常语速，请将语速设为 1");
    if (request.volume !== undefined && request.volume !== 0) invalid("系统配音当前使用原始音量");
    const format = request.format ?? "mp3";
    if (format !== "wav" && format !== "mp3") invalid("系统配音输出格式仅支持 WAV 或 MP3");
    const synthesize = async () => {
      const speech = await this.tool.audio.synthesize({ text: request.text, voice: request.voice ?? "" });
      const audio = await this.tool.audio.convert(speech.data, { format, sampleRate: request.sampleRate });
      return { data: Buffer.from(audio.data).toString("base64"), mimeType: audio.mimeType, voice: speech.voice };
    };
    const result = this.tool.task ? await this.tool.task.run("windowsSpeechSynthesis", synthesize) : await synthesize();
    await this.tool.reportUsage?.({ key: "windowsSpeechSynthesis", values: { characters: [...request.text].length } });
    return [{ mediaType: "audio", type: "base64", data: result.data, mimeType: result.mimeType }];
  },
} satisfies ProviderDefinition;
