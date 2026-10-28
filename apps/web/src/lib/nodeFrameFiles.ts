import type { NodeFrameScope, NodeFrameState } from "./nodeFrameProtocol";
import { sameNodeFrameScope } from "./nodeFrameProtocol";
import useWorkspaceFiles from "./workspaceFiles";

export type NodeFrameWorkspaceFiles = ReturnType<typeof useWorkspaceFiles>;

type FileRequest = { path?: unknown; target?: unknown; content?: unknown; data?: unknown; exclusive?: unknown; recursive?: unknown; start?: unknown; length?: unknown; etag?: unknown };
const rootMkdirs = new Map<string, Promise<unknown>>();

function isBusy(error: unknown) {
  return (error as { response?: { data?: { data?: { code?: unknown } } } })?.response?.data?.data?.code === "EBUSY";
}

async function retryBusy<T>(action: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try { return await action(); }
    catch (error) {
      if (!isBusy(error) || attempt >= 5) throw error;
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 20 * 2 ** attempt);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
    }
  }
}

function relativePath(value: unknown) {
  if (typeof value !== "string" || value.length > 1000 || !value || value.includes("\\") || value.includes(":") || value.includes("\0")) throw new Error("节点文件路径无效");
  const parts = value.split("/");
  if (parts.some(part => !part || part === "." || part === "..")) throw new Error("节点文件路径无效");
  return value;
}

function fileRequest(value: unknown): FileRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("节点文件请求无效");
  return value as FileRequest;
}

// 只从宿主初始快照中的明确媒体输入、输出与旧文本引用授予额外读取。
function readablePaths(state: NodeFrameState) {
  const paths = new Set<string>();
  const textPath = (state.node.data as { textPath?: unknown }).textPath;
  if (typeof textPath === "string" && (textPath === `references/nodes/${state.scope.nodeId}/content.md` || /^(?:assets\/production|references\/versions)\/[a-f0-9-]{36}\/reference\d+\.md$/i.test(textPath))) paths.add(textPath);
  const outputs = Object.values(state.node.data.outputs ?? {});
  const inputs = Object.values(state.inputs).flat();
  for (const item of [...inputs, ...outputs]) {
    if (item?.value && typeof item.value === "object" && "url" in item.value && typeof item.value.url === "string") {
      try { paths.add(relativePath(item.value.url)); } catch { /* 非工作区来源不授予读取。 */ }
    }
  }
  const selectedPath = state.node.data.productionSelection?.file.path;
  if (typeof selectedPath === "string") try { paths.add(relativePath(selectedPath)); } catch { /* 非工作区来源不授予读取。 */ }
  return paths;
}

export function createNodeFrameFileOperations(
  state: NodeFrameState,
  currentScope: () => NodeFrameScope | undefined,
  files: NodeFrameWorkspaceFiles = useWorkspaceFiles(state.scope.directory),
) {
  const { scope } = state;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(scope.nodeId)) throw new Error("节点 ID 无效");
  const ownDirectory = `assets/${scope.nodeId}`;
  const readGrants = readablePaths(state);
  const ensureCurrent = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (!sameNodeFrameScope(currentScope(), scope)) throw new Error("节点所属工作空间或画布已切换");
  };
  const own = (path: unknown) => {
    const value = relativePath(path);
    if (value !== ownDirectory && !value.startsWith(`${ownDirectory}/`)) throw new Error("节点文件操作超出自身目录");
    return value;
  };
  const readable = (path: unknown) => {
    const value = relativePath(path);
    if (value !== ownDirectory && !value.startsWith(`${ownDirectory}/`) && !readGrants.has(value)) throw new Error("节点文件读取未经授权");
    return value;
  };
  const readSmallText = async (path: unknown, signal: AbortSignal) => {
    const value = await files.readText(readable(path), 1_000_001, signal);
    ensureCurrent(signal);
    if (new TextEncoder().encode(value).byteLength > 1_000_000) throw new Error("节点文本读取过大");
    return value;
  };

  return async (action: string, input: unknown, signal: AbortSignal): Promise<unknown> => {
    ensureCurrent(signal);
    const request = fileRequest(input);
    switch (action) {
      case "files.list": {
        if (request.path === undefined || request.path === "") return { directory: scope.directory, empty: true, entries: [] };
        const result = await files.list(own(request.path), signal);
        ensureCurrent(signal);
        if (result.entries.length > 1000) throw new Error("节点目录条目过多");
        return result;
      }
      case "files.read": {
        const content = await files.read(readable(request.path), signal);
        ensureCurrent(signal);
        if (content.byteLength > 32_000_000) throw new Error("节点文件读取过大");
        return content;
      }
      case "files.readChunk": {
        const path = readable(request.path);
        if (!Number.isSafeInteger(request.start) || !Number.isSafeInteger(request.length)
          || (request.start as number) < 0 || (request.start as number) >= 100 * 1024 * 1024
          || (request.length as number) < 1 || (request.length as number) > 4 * 1024 * 1024
          || request.etag !== undefined && (typeof request.etag !== "string" || request.etag.length > 200)) throw new Error("媒体分段范围无效");
        const result = await files.readRange(path, request.start as number, request.length as number, signal);
        ensureCurrent(signal);
        if (request.etag !== undefined && request.etag !== result.etag) throw new Error("媒体文件在读取期间已改变");
        return result;
      }
      case "files.readText": return readSmallText(request.path, signal);
      case "files.readJson": return JSON.parse(await readSmallText(request.path, signal));
      case "files.write": {
        const path = own(request.path);
        if (typeof request.content !== "string" && !(request.content instanceof Blob) && !(request.content instanceof ArrayBuffer)) throw new Error("节点文件内容无效");
        if (typeof request.content !== "string" && (request.content instanceof Blob ? request.content.size : request.content.byteLength) > 100 * 1024 * 1024) throw new Error("节点媒体文件超过 100 MB");
        if (request.exclusive !== undefined && typeof request.exclusive !== "boolean") throw new Error("节点文件写入选项无效");
        return request.exclusive === true
          ? retryBusy(() => files.write(path, request.content as string | Blob | ArrayBuffer, true, signal), signal)
          : files.write(path, request.content, false, signal);
      }
      case "files.writeJson": {
        const path = own(request.path);
        if (request.exclusive !== undefined && typeof request.exclusive !== "boolean") throw new Error("节点文件写入选项无效");
        return request.exclusive === true
          ? retryBusy(() => files.writeJson(path, request.data, true, signal), signal)
          : files.writeJson(path, request.data, false, signal);
      }
      case "files.rename": return files.rename(own(request.path), own(request.target), signal);
      case "files.remove": {
        if (request.recursive !== undefined && typeof request.recursive !== "boolean") throw new Error("节点文件删除选项无效");
        return files.remove(own(request.path), request.recursive === true, signal);
      }
      case "files.mkdir": {
        if (request.path === "assets") {
          let pending = rootMkdirs.get(scope.directory);
          if (!pending) {
            // Shared initialization must survive one frame being evicted while peers still load.
            const sharedSignal = new AbortController().signal;
            pending = retryBusy(() => files.mkdir("assets", sharedSignal), sharedSignal);
            rootMkdirs.set(scope.directory, pending);
            void pending.finally(() => { if (rootMkdirs.get(scope.directory) === pending) rootMkdirs.delete(scope.directory); }).catch(() => {});
          }
          return pending.then(result => { ensureCurrent(signal); return result; });
        }
        return retryBusy(() => files.mkdir(own(request.path), signal), signal);
      }
      default: throw new Error("节点界面操作未授权");
    }
  };
}
