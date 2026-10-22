import axios from "axios";
import type { ToolCall } from "./runtime";

export type ToolView = { name: string; url: string; code: string };
type ToolRenderer = { name: string; tools: string[]; url: string };
let rendererRequest: Promise<ToolRenderer[]> | undefined;
const sourceLoads = new Map<string, Promise<string>>();

/** 仅取得源码，工具界面由宿主在独立页面执行。 */
export async function loadToolView(toolName: string): Promise<ToolView | undefined> {
  // ACT: 只合并并发查询；新卡片重新查询安装状态，组件按内容版本复用。
  rendererRequest ??= axios.get<{ code: number; data: ToolRenderer[]; message?: string }>("/api/tools/renderers")
    .then(({ data }) => {
      if (data.code !== 200 || !Array.isArray(data.data)) throw new Error(data.message || "工具界面列表无效");
      return data.data;
    }).finally(() => { rendererRequest = undefined; });
  const matches = (await rendererRequest).filter(item => Array.isArray(item?.tools) && item.tools.includes(toolName));
  if (matches.length > 1) throw new Error(`工具界面名称重复：${toolName}`);
  const renderer = matches[0];
  if (!renderer) return;
  if (!/^[a-z][a-zA-Z0-9]*$/.test(renderer.name) ||
    !new RegExp(`^/api/tools/client\\?name=${renderer.name}&version=[a-f0-9]{64}$`).test(renderer.url)) {
    throw new Error("工具界面地址无效");
  }
  let source = sourceLoads.get(renderer.url);
  if (!source) {
    source = axios.get<string>(renderer.url, { responseType: "text" }).then(({ data }) => {
      if (typeof data !== "string" || !data || data.length > 16 * 1024 * 1024) throw new Error("工具界面脚本无效或过大");
      return data;
    }).catch(error => { sourceLoads.delete(renderer.url); throw error; });
    // ACT: 按内容版本合并请求，仅保留最近 32 份源码，不长期积累旧插件版本。
    if (sourceLoads.size >= 32) sourceLoads.delete(sourceLoads.keys().next().value!);
    sourceLoads.set(renderer.url, source);
  }
  return { name: renderer.name, url: renderer.url, code: await source };
}

/** 界面与宿主用同一份结果解释节点范围，定位能力不能扩展到其他节点。 */
export function getToolNodeSummaries(tool: ToolCall): { nodeId: string; label: string }[] {
  const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const args = tool.args ?? {};
  if (tool.name === "nodeTools") return typeof args.nodeId === "string" && args.nodeId ? [{ nodeId: args.nodeId, label: args.nodeId }] : [];
  if (tool.status !== "success") return [];
  let result: Record<string, any> = {};
  try { result = record(JSON.parse(tool.result ?? "{}")); } catch {}
  const summaries = new Map<string, { nodeId: string; label: string }>();
  for (const node of [result.node, ...(Array.isArray(result.nodes) ? result.nodes.map(entry => record(entry).node) : [])]) {
    const { id, data } = record(node);
    if (typeof id === "string" && id) summaries.set(id, { nodeId: id, label: typeof data?.label === "string" && data.label.trim() ? data.label : id });
  }
  const ids = [result.nodeIds, result.selectedNodeIds, result.arrangedNodeIds, args.nodeIds].flatMap(value => Array.isArray(value) ? value : []);
  for (const values of [args.moves, args.renames]) if (Array.isArray(values)) ids.push(...values.map(entry => record(entry).nodeId));
  if (Array.isArray(args.connections)) ids.push(...args.connections.flatMap(entry => [record(entry).source, record(entry).target]));
  for (const id of ids) if (typeof id === "string" && id && !summaries.has(id)) summaries.set(id, { nodeId: id, label: id });
  return [...summaries.values()];
}
