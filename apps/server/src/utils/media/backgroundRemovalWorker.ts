/** 固定的本机推理程序；单独进程运行，模型与图片均通过宿主提供，不执行模型仓库代码。 */
export default async function backgroundRemovalWorker() {
  const config = JSON.parse(process.env.TOONFLOW_BACKGROUND_WORKER ?? "{}") as { runtime: string; model: string; ffmpeg: string; ffprobe: string };
  if (Object.values(config).length !== 4 || Object.values(config).some(value => typeof value !== "string" || !value)) throw new Error("本机图片运行环境不完整");
  const inputChunks: Buffer[] = [];
  let inputBytes = 0;
  for await (const chunk of process.stdin) {
    inputBytes += chunk.length;
    if (inputBytes > 32 * 1024 ** 2) throw new Error("输入图片不能超过 32 MB");
    inputChunks.push(Buffer.from(chunk));
  }
  const source = Buffer.concat(inputChunks);
  async function run(argumentsList: string[], input: Uint8Array, limit: number) {
    const child = Bun.spawn(argumentsList, { stdin: new Blob([new Uint8Array(input)]), stdout: "pipe", stderr: "pipe", windowsHide: true });
    const timer = setTimeout(() => child.kill(), 60000);
    try {
      const output = async () => {
        const chunks: Uint8Array[] = []; let size = 0;
        for await (const chunk of child.stdout) {
          size += chunk.length;
          if (size > limit) { child.kill(); throw new Error("图片处理结果超出大小限制"); }
          chunks.push(chunk);
        }
        return Buffer.concat(chunks);
      };
      const [bytes, , code] = await Promise.all([output(), new Response(child.stderr).text(), child.exited]);
      if (code !== 0) throw new Error("本机图片解码或编码失败，请检查图片与 FFmpeg");
      return bytes;
    } finally { clearTimeout(timer); }
  }
  const probe = JSON.parse((await run([config.ffprobe, "-v", "error", "-protocol_whitelist", "pipe", "-show_entries", "stream=width,height,codec_type", "-of", "json", "pipe:0"], source, 65536)).toString("utf8"));
  const stream = probe.streams?.find((item: { codec_type?: string }) => item.codec_type === "video");
  const width = stream?.width; const height = stream?.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 16777216) throw new Error("背景移除支持边长不超过 8192、总像素不超过 1677 万的图片");
  const area = 1024 * 1024;
  const pixels = await run([config.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-protocol_whitelist", "pipe", "-max_pixels", "16777216", "-i", "pipe:0", "-frames:v", "1", "-vf", "scale=1024:1024:flags=bilinear,format=rgb24", "-f", "rawvideo", "pipe:1"], source, area * 3);
  if (pixels.length !== area * 3) throw new Error("图片像素读取不完整");
  const tensor = new Float32Array(area * 3);
  const mean = [0.485, 0.456, 0.406]; const deviation = [0.229, 0.224, 0.225];
  for (let index = 0; index < area; index++) for (let channel = 0; channel < 3; channel++) tensor[channel * area + index] = (pixels[index * 3 + channel]! / 255 - mean[channel]!) / deviation[channel]!;
  const runtime: typeof import("onnxruntime-node") = await import(config.runtime);
  // ACT: CPU 单图、两条计算线程；每次结束释放模型，避免长期占用创作进程的内存。
  const session = await runtime.InferenceSession.create(config.model, { executionProviders: ["cpu"], intraOpNumThreads: 2, interOpNumThreads: 1 });
  const started = performance.now();
  let prediction: Float32Array;
  try {
    const output = (await session.run({ input_image: new runtime.Tensor("float32", tensor, [1, 3, 1024, 1024]) })).output_image;
    if (!output || output.type !== "float32" || output.data.length !== area) throw new Error("背景模型返回了无效的蒙版");
    prediction = output.data as Float32Array;
  } finally { await session.release(); }
  const inferenceMs = Math.round(performance.now() - started);
  const mask = Buffer.alloc(area);
  for (let index = 0; index < area; index++) {
    if (!Number.isFinite(prediction[index])) throw new Error("背景模型蒙版包含无效数值");
    mask[index] = Math.floor(255 / (1 + Math.exp(-prediction[index]!)));
  }
  // 顺序编码两张同尺寸、同像素格式 PNG，原图不写入临时目录。
  const pgm = Buffer.concat([Buffer.from("P5\n1024 1024\n255\n"), mask]);
  const maskPng = await run([config.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-f", "image2pipe", "-vcodec", "pgm", "-i", "pipe:0", "-frames:v", "1", "-vf", `scale=${width}:${height}:flags=bilinear`, "-pix_fmt", "rgba", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], pgm, 32 * 1024 ** 2);
  // image2pipe 顺序读取两张 PNG；固定滤镜把第二张的灰度与第一张已有 Alpha 相乘。
  const originalPng = await run([config.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-protocol_whitelist", "pipe", "-max_pixels", "16777216", "-i", "pipe:0", "-frames:v", "1", "-pix_fmt", "rgba", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], source, 96 * 1024 ** 2);
  const filter = "split=2[s][m];[s]select='eq(n,0)',setpts=PTS-STARTPTS,format=rgba,split=2[c][a];[a]alphaextract[a0];[m]select='eq(n,1)',setpts=PTS-STARTPTS,format=gray[mask];[a0][mask]blend=all_mode=multiply:shortest=1[alpha];[c][alpha]alphamerge=shortest=1[out]";
  const result = await run([config.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-f", "image2pipe", "-vcodec", "png", "-i", "pipe:0", "-filter_complex", filter, "-map", "[out]", "-frames:v", "1", "-pix_fmt", "rgba", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], Buffer.concat([originalPng, maskPng]), 96 * 1024 ** 2);
  process.stdout.write(`${JSON.stringify({ width, height, inferenceMs, runtimeVersion: runtime.env.versions.node })}\n`);
  process.stdout.write(result);
}
