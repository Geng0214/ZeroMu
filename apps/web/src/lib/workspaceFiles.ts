import axios from "axios";
import { toValue, type MaybeRefOrGetter } from "vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { registerApiLanguage } from "@/lib/i18n";
import type { NodeMediaPreview } from "@toonflow/nodes-scaffold/workspaceFiles";

type WorkspaceEntry = { name: string; path: string; type: "file" | "directory" };
const client = axios.create({ baseURL: "/api/workspaces/files", headers: { "x-toonflow-workspace": "1" } });
registerApiLanguage(client);
const fileUrls = new Map<string, { directory: string; path: string; url: Promise<string>; users: number; size?: number }>();

function cachePath(path: string) {
  return path.replaceAll("\\", "/").split("/").filter(part => part && part !== ".").join("/").toLowerCase();
}

function invalidateUrls(directory: string, path: string) {
  // ACT: 仅失效时保守合并路径写法；实际读取仍交服务端校验，区分大小写的文件最多多读一次。
  directory = cachePath(directory);
  path = cachePath(path);
  for (const [key, entry] of fileUrls) {
    const entryPath = cachePath(entry.path);
    if (cachePath(entry.directory) === directory && (entryPath === path || entryPath.startsWith(`${path}/`))) fileUrls.delete(key);
  }
}

export default function useWorkspaceFiles(directory?: MaybeRefOrGetter<string | undefined>) {
  const workspace = directory === undefined ? useWorkspaceStore() : undefined;
  function getDirectory() {
    const path = directory === undefined ? workspace?.project?.directory : toValue(directory);
    if (!path) throw new Error("请先选择工作目录");
    return path;
  }

  async function list(path = "", signal?: AbortSignal) {
    const { data } = await client.get<{ data: { directory: string; empty: boolean; entries: WorkspaceEntry[] } }>("/list", { params: { directory: getDirectory(), path }, signal, timeout: 15000 });
    return data.data;
  }

  async function read(path: string) {
    const { data } = await client.get<ArrayBuffer>("/read", { params: { directory: getDirectory(), path }, responseType: "arraybuffer" });
    return data;
  }

  async function previewUrl(path: string, mimeType?: string) {
    const { data } = await client.post<{ data: { url: string } }>("/previewToken", { directory: getDirectory(), path, mimeType });
    return data.data.url;
  }

  async function mediaPreview(path: string, mimeType?: string) {
    const { data } = await client.post<{ data: NodeMediaPreview }>("/mediaPreview", { directory: getDirectory(), path, mimeType });
    return data.data;
  }

  function acquireUrl(path: string, mimeType?: string) {
    const directory = getDirectory();
    const key = JSON.stringify([directory, path, mimeType]);
    let entry = fileUrls.get(key);
    if (!entry) {
      const url = client.get<Blob>("/read", { params: { directory, path }, responseType: "blob" })
        .then(({ data }) => {
          current.size = data.size;
          return URL.createObjectURL(mimeType ? new Blob([data], { type: mimeType }) : data);
        });
      entry = { directory, path, url, users: 0 };
      fileUrls.set(key, entry);
      const current = entry;
      void url.catch(() => { if (fileUrls.get(key) === current) fileUrls.delete(key); });
    }
    const current = entry;
    current.users++;
    let released = false;
    return {
      url: current.url,
      get size() { return current.size; },
      release() {
        if (released) return;
        released = true;
        if (--current.users) return;
        if (fileUrls.get(key) === current) fileUrls.delete(key);
        // 等待中的读取也要在最后一个使用者离开后释放，不撤销其他节点仍使用的 URL。
        void current.url.then(url => URL.revokeObjectURL(url), () => {});
      },
    };
  }

  async function readText(path: string, maxBytes?: number, signal?: AbortSignal) {
    if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1)) throw new Error("读取字节数必须为正整数");
    try {
      const { data } = await client.get<string>("/read", {
        params: { directory: getDirectory(), path }, responseType: "text", transformResponse: [], signal, timeout: 15000,
        headers: maxBytes === undefined ? undefined : { Range: `bytes=0-${maxBytes - 1}` },
      });
      return data;
    } catch (error) {
      if (maxBytes !== undefined && axios.isAxiosError(error) && error.response?.status === 416 && error.response.headers["content-range"] === "bytes */0") return "";
      throw error;
    }
  }

  async function readJson<T = unknown>(path: string, signal?: AbortSignal): Promise<T> {
    return JSON.parse(await readText(path, undefined, signal));
  }

  async function readJsonInfo<T = unknown>(path: string, signal?: AbortSignal) {
    const response = await client.get<string>("/read", { params: { directory: getDirectory(), path }, responseType: "text", transformResponse: [], signal, timeout: 15000 });
    return { data: JSON.parse(response.data) as T, modifiedAt: response.headers["last-modified"] as string | undefined };
  }

  async function write(path: string, content: string | Blob | ArrayBuffer, exclusive = false, signal?: AbortSignal) {
    const directory = getDirectory();
    await client.put("/write", content, { params: { directory, path, exclusive }, signal, headers: { "Content-Type": "application/octet-stream" } });
    invalidateUrls(directory, path);
  }

  function writeJson(path: string, data: unknown, exclusive = false) {
    return write(path, `${JSON.stringify(data, null, 2)}\n`, exclusive);
  }

  async function rename(path: string, target: string) {
    const directory = getDirectory();
    await client.post("/rename", { directory, path, target });
    invalidateUrls(directory, path);
    invalidateUrls(directory, target);
  }

  async function remove(path: string, recursive = false) {
    const directory = getDirectory();
    await client.delete("/remove", { data: { directory, path, recursive } });
    invalidateUrls(directory, path);
  }

  async function mkdir(path: string) {
    await client.post("/mkdir", { directory: getDirectory(), path });
  }

  // ACT: 当前目录逐次读取；跨 await 或防抖的操作传入目录字符串，固定本次目标。
  return { getDirectory, list, read, acquireUrl, previewUrl, mediaPreview, readText, readJson, readJsonInfo, write, writeJson, rename, remove, mkdir };
}
