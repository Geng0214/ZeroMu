export type MediaChannelKind = "image" | "video" | "audio";

export const kindLabels = { image: "生图", video: "视频", audio: "音频" } as const satisfies Record<MediaChannelKind, string>;

export type MediaChannelModel = { id: string; label?: string };

/** 一行渠道的编辑状态；路径与密钥都是输入框直接绑定的字符串。 */
export type MediaChannelRow = {
  id: string;
  label: string;
  kind: MediaChannelKind;
  apiUrl: string;
  apiKey: string;
  returnBase64: boolean;
  submitPath: string;
  pollPath: string;
  contentPath: string;
  models: MediaChannelModel[];
  fileName: string;
  revision: string;
  loadError: string;
};

export type MediaChannel = Omit<MediaChannelRow, "fileName" | "revision" | "loadError" | "submitPath" | "pollPath" | "contentPath"> & {
  submitPath?: string;
  pollPath?: string;
  contentPath?: string;
};
