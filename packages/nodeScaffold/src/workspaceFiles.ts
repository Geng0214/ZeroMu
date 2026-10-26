import { computed, inject, ref, toValue, watch, type MaybeRefOrGetter } from "vue";
import type { NodeMediaValue } from "./values";
import { useNodePreviewReady } from "./useNodePreviewReady";

export type NodeMediaPreview = { originalUrl: string; thumbnailUrl: string; width: number; height: number; bytes: number; duration: number; mimeType: string; message: string };

export interface WorkspaceFiles {
  getDirectory?(): string;
  list(path?: string): Promise<{ directory: string; entries: { name: string; path: string; type: "file" | "directory" }[] }>;
  read(path: string): Promise<ArrayBuffer>;
  acquireUrl?(path: string, mimeType: string): { url: Promise<string>; readonly size?: number; release(): void };
  previewUrl?(path: string, mimeType?: string): Promise<string>;
  mediaPreview?(path: string, mimeType?: string): Promise<NodeMediaPreview>;
  readText(path: string): Promise<string>;
  readJson<T = unknown>(path: string): Promise<T>;
  write(path: string, content: string | Blob | ArrayBuffer, exclusive?: boolean): Promise<void>;
  writeJson(path: string, data: unknown, exclusive?: boolean): Promise<void>;
  rename(path: string, target: string): Promise<void>;
  remove(path: string, recursive?: boolean): Promise<void>;
  mkdir(path: string): Promise<void>;
}

function getNodeDirectory(nodeId: string) {
  if (!nodeId || /[\\/]/.test(nodeId) || nodeId === "." || nodeId === "..") throw new Error("节点 ID 不能作为文件夹名称");
  return `assets/${nodeId}`;
}

export async function nodeFileDirectory(files: Partial<Pick<WorkspaceFiles, "list">>, nodeId: string) {
  const legacy = getNodeDirectory(nodeId);
  const entries = files.list ? (await files.list()).entries : [];
  if (entries.some(item => item.type === "directory" && item.name === "assets")) {
    const assets = await files.list?.("assets");
    if (assets?.entries.some(item => item.type === "directory" && item.name === nodeId)) return legacy;
  }
  const references = entries.some(item => item.type === "directory" && item.name === "references")
    ? await files.list?.("references/nodes")
    : undefined;
  return references?.entries.some(item => item.type === "directory" && item.name === nodeId) ? `references/nodes/${nodeId}` : legacy;
}

export async function uploadNodeFile(files: Pick<WorkspaceFiles, "mkdir" | "write"> & Partial<Pick<WorkspaceFiles, "list">>, nodeId: string, file: File) {
  const directory = await nodeFileDirectory(files, nodeId);
  const parts = directory.split("/");
  for (const path of parts.map((_part, index) => parts.slice(0, index + 1).join("/"))) {
    await files.mkdir(path).catch((error: { response?: { data?: { data?: { code?: string } } } }) => {
      if (error.response?.data?.data?.code !== "EEXIST") throw error;
    });
  }
  const extension = file.name.match(/\.[a-zA-Z0-9]{1,10}$/)?.[0].toLowerCase() ?? "";
  const path = `${directory}/${crypto.randomUUID()}${extension}`;
  await files.write(path, file, true);
  return path;
}

export function useNodeFiles() {
  const createFiles = inject<(() => WorkspaceFiles) | undefined>("workspaceFiles", undefined);
  const retainNodeFiles = inject("retainNodeFiles", false);

  function getWorkspaceFiles() {
    if (!createFiles) throw new Error("当前画布未提供工作区文件能力");
    return createFiles();
  }

  function uploadFile(nodeId: string, file: File) {
    // ACT: 多步上传共用开始时的工作区，避免切换项目后写入另一目录。
    return uploadNodeFile(getWorkspaceFiles(), nodeId, file);
  }

  async function removeNodeFiles(nodeId: string) {
    // ACT: 支持撤销的画布保留节点素材，不随节点删除物理文件。
    if (retainNodeFiles) return;
    const files = getWorkspaceFiles();
    const directory = await nodeFileDirectory(files, nodeId);
    await files.remove(directory, true).catch((error: { response?: { data?: { data?: { code?: string } } } }) => {
      if (error.response?.data?.data?.code !== "ENOENT") throw error;
    });
  }

  function useFileUrl(file: MaybeRefOrGetter<NodeMediaValue | undefined>, onError: (error: unknown) => void, onLoaded?: (size?: number) => void) {
    const fileUrl = ref("");
    const previewReady = useNodePreviewReady();
    watch([() => toValue(file), previewReady], async ([value, ready], _previous, onCleanup) => {
      let cancelled = false;
      let url = "";
      let shared: ReturnType<NonNullable<WorkspaceFiles["acquireUrl"]>> | undefined;
      onCleanup(() => {
        cancelled = true;
        shared?.release();
        if (url) URL.revokeObjectURL(url);
      });
      fileUrl.value = "";
      onLoaded?.();
      if (!value || !ready) return;
      try {
        const files = getWorkspaceFiles();
        if (files.previewUrl && /^(video|audio)\//.test(value.mimeType)) {
          const preview = await files.previewUrl(value.url, value.mimeType);
          if (!cancelled) fileUrl.value = preview;
          return;
        }
        shared = files.acquireUrl?.(value.url, value.mimeType);
        if (shared) {
          const sharedUrl = await shared.url;
          if (!cancelled) {
            onLoaded?.(shared.size);
            fileUrl.value = sharedUrl;
          }
          return;
        }
        const content = await files.read(value.url);
        if (cancelled) return;
        onLoaded?.(content.byteLength);
        fileUrl.value = url = URL.createObjectURL(new Blob([content], { type: value.mimeType }));
      } catch (error) {
        if (!cancelled) onError(error);
      }
    }, { immediate: true });
    return fileUrl;
  }

  function useMediaPreview(file: MaybeRefOrGetter<NodeMediaValue | undefined>) {
    const info = ref<NodeMediaPreview>();
    const ready = useNodePreviewReady();
    const legacyFile = computed(() => { const value = toValue(file); return value && !getWorkspaceFiles().mediaPreview ? value : undefined; });
    const legacyBytes = ref(0);
    const legacyUrl = useFileUrl(legacyFile, () => {}, size => { legacyBytes.value = size ?? 0; });
    watch([() => toValue(file), ready], async ([value, visible], _previous, onCleanup) => {
      let cancelled = false; onCleanup(() => { cancelled = true; }); info.value = undefined;
      if (!value || !visible) return;
      const files = getWorkspaceFiles(); if (!files.mediaPreview) return;
      try { const preview = await files.mediaPreview(value.url, value.mimeType); if (!cancelled) info.value = preview; }
      catch {
        const originalUrl = await files.previewUrl?.(value.url, value.mimeType).catch(() => "") || "";
        if (!cancelled) info.value = { originalUrl, thumbnailUrl: "", width: 0, height: 0, bytes: 0, duration: 0, mimeType: value.mimeType, message: "缩略图暂不可用，请检查原件或重新打开预览" };
      }
    }, { immediate: true });
    return computed(() => info.value || (legacyUrl.value ? { originalUrl: legacyUrl.value, thumbnailUrl: toValue(file)?.mimeType.startsWith("image/") ? legacyUrl.value : "", width: 0, height: 0, bytes: legacyBytes.value, duration: 0, mimeType: toValue(file)?.mimeType || "", message: "" } : undefined));
  }

  return { getWorkspaceFiles, uploadFile, removeNodeFiles, useFileUrl, useMediaPreview };
}
