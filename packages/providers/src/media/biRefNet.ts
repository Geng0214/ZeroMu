export default {
  id: "biRefNet", label: "本机背景移除", version: "1.0.0", requiresApiKey: false,
  readme: `使用 BiRefNet 轻量模型在本机移除图片背景，不上传素材，无需渠道地址或 API Key。首次使用需要下载约 224 MB 模型并配置 FFmpeg。

选择一张 PNG、JPEG 或 WebP，输出保留原图像素尺寸的透明 PNG。此模型只执行背景移除，提示词不会改变处理方式；不支持蒙版重绘、扩图或多图。当前使用 CPU，每次处理一张图片，复杂边缘和半透明物体需人工核对后再采用。

模型作者标注 MIT 授权：[BiRefNet](https://github.com/ZhengPeng7/BiRefNet)。应用核对固定模型摘要，下载目录保留完整授权说明。`,
  rules: [],
  models: [{ id: "biRefNetTiny", label: "BiRefNet 背景移除 · 本机", type: "image", mode: ["singleImage"], maxImageCount: 1, imageReferenceLimit: 1 }],
  async generateImage(request: ImageRequest): Promise<MediaAsset[]> {
    function invalid(message: string): never { throw Object.assign(new Error(message), { submissionRejected: true }); }
    if (request.model !== "biRefNetTiny") invalid("请选择 BiRefNet 本机背景移除模型");
    if (request.images?.length !== 1 || request.mask || (request.n !== undefined && request.n !== 1)) invalid("本机背景移除每次需要一张图片，不支持蒙版或批量输出");
    if (request.size && request.size !== "auto" || request.ratio && request.ratio !== "auto" || request.quality || request.outputFormat && request.outputFormat !== "png") invalid("本机背景移除保持原图尺寸，输出透明 PNG，请使用模型默认参数");
    const image = request.images![0]!;
    if (image.type === "url") invalid("本机背景移除请选择本地图片文件");
    const bytes = image.type === "base64" ? Buffer.from(image.data, "base64") : image.data;
    if (!bytes.length || bytes.length > 32 * 1024 ** 2) invalid("输入图片不能超过 32 MB");
    const processImage = async () => {
      const { data, ...details } = await this.tool.imageProcessing.removeBackground(bytes);
      return { ...details, data: Buffer.from(data).toString("base64") };
    };
    const result = this.tool.task ? await this.tool.task.run("biRefNetBackgroundRemoval", processImage) : await processImage();
    await this.tool.reportUsage?.({ key: "biRefNetBackgroundRemoval", values: { images: 1, pixels: result.width * result.height } });
    return [{ mediaType: "image", type: "base64", data: result.data, mimeType: result.mimeType }];
  },
} satisfies ProviderDefinition;
