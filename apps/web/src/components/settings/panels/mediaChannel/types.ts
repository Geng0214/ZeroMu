export type MediaChannelKind = "image" | "video" | "audio" | "text";

export const kindLabels = { image: "生图", video: "视频", audio: "音频", text: "文本" } as const satisfies Record<MediaChannelKind, string>;

export type ChannelProtocol = "openai" | "apimart" | "minimax";
export const protocolOptions = [
  { value: "openai", label: "OpenAI", disabled: false },
  { value: "gemini", label: "Gemini（未接入）", disabled: true },
  { value: "grok2api", label: "Grok2API（未接入）", disabled: true },
  { value: "minimax", label: "秘塔 MiniMax", disabled: false },
  { value: "apimart", label: "APIMart", disabled: false },
  { value: "88api", label: "88API（未接入）", disabled: true },
  { value: "runninghub", label: "RunningHub（未接入）", disabled: true },
  { value: "comfyui", label: "ComfyUI（未接入）", disabled: true },
];
export { channelProtocolKinds as protocolKinds } from "@toonflow/providers/channelModels";
export type MediaChannelModel = { id: string; label?: string; type: MediaChannelKind };

/** 一行渠道的编辑状态；路径与密钥都是输入框直接绑定的字符串。 */
export type MediaChannelRow = {
  id: string;
  label: string;
  protocol: ChannelProtocol;
  apiUrl: string;
  apiKey: string;
  hasApiKey?: boolean;
  apiKeyUnavailable?: boolean;
  apiKeyRevision?: string;
  clearApiKey?: boolean;
  returnBase64: boolean;
  maxConcurrentTasks: number;
  submitPath: string;
  pollPath: string;
  contentPath: string;
  models: MediaChannelModel[];
  fileName: string;
  revision: string;
  loadError: string;
  saveError?: string;
};

export type MediaChannel = Omit<MediaChannelRow, "fileName" | "revision" | "loadError" | "submitPath" | "pollPath" | "contentPath"> & {
  submitPath?: string;
  pollPath?: string;
  contentPath?: string;
};
