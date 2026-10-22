import axios from "axios";
import type { MediaChannelRow, MediaChannelKind } from "./types";
import { classifyChannelModel } from "@toonflow/providers/channelModels";

export type ChannelCandidate = { id: string; label?: string; type?: MediaChannelKind; unavailableReason?: string; [key: string]: unknown };

export default async function fetchChannelModels(channel: MediaChannelRow, signal?: AbortSignal): Promise<ChannelCandidate[]> {
  if (channel.protocol === "minimax") throw new Error("此格式请手动添加模型 ID");
  const { data } = await axios.post<{ code: number; data: ChannelCandidate[]; message?: string }>("/api/mediaChannel/models", {
    id: channel.id, protocol: channel.protocol, apiUrl: channel.apiUrl.trim(), apiKey: channel.apiKey.trim() || undefined,
  }, { timeout: 35000, signal, headers: { "x-toonflow-workspace": "1" } });
  if (data.code !== 200 || !Array.isArray(data.data)) throw new Error(data.message || "获取模型列表失败");
  return [...new Map(data.data.map(model => [model.id.trim(), { ...model, id: model.id.trim(), label: model.label, ...classifyChannelModel(model, channel.protocol) }])).values()];
}
