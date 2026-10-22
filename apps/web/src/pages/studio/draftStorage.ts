import axios from "axios";
import { registerApiLanguage } from "@/lib/i18n";
import type { StudioDraftData } from "@toonflow/server/studioDrafts";

export type StudioDraft = {
  fields: Record<string, unknown>;
  references: (Omit<StudioDraftData["references"][number], "fileHash" | "mimeType" | "size"> & { file: Blob })[];
  savedAt: number;
};
const client = axios.create({ baseURL: "/api/studioDrafts", headers: { "x-toonflow-workspace": "1" }, timeout: 30000 });
registerApiLanguage(client);
const revisions = new Map<string, string>();
const fileCache = new WeakMap<Blob, { hash: Promise<string>; scopes: Set<string> }>();
const hashBlob = async (value: Blob) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", await value.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, "0")).join("");

export function studioDraftKey(directory: string, kind: string) {
  const path = directory.replaceAll("\\", "/").replace(/\/+$/, "");
  return JSON.stringify([/^[a-z]:/i.test(path) ? path.toLocaleLowerCase() : path, kind]);
}

function draftScope(key: string) {
  const value = JSON.parse(key) as unknown;
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string" || !["image", "video", "audio"].includes(value[1])) throw new Error("草稿范围无效");
  return { directory: value[0], kind: value[1] as string };
}

async function writeDraft(key: string, value: StudioDraft) {
  if (!revisions.has(key)) throw new Error("草稿尚未读取，请保持页面并重试");
  const scope = draftScope(key);
  const references: StudioDraftData["references"] = [];
  for (const reference of value.references) {
    if (!(reference.file instanceof Blob)) throw new Error("草稿参考无法读取，原缓存已保留，请保持页面并重新添加该参考");
    let cached = fileCache.get(reference.file);
    if (!cached) { cached = { hash: hashBlob(reference.file), scopes: new Set() }; fileCache.set(reference.file, cached); }
    const fileHash = await cached.hash;
    if (!cached.scopes.has(key)) {
      await client.put("/writeFile", reference.file, { params: { ...scope, fileHash }, headers: { "Content-Type": "application/octet-stream" }, timeout: 120000 });
      cached.scopes.add(key);
    }
    references.push({ id: reference.id, kind: reference.kind, name: reference.name, fileHash, mimeType: reference.file.type,
      size: reference.file.size, ...(reference.paths ? { paths: reference.paths } : {}),
    });
  }
  const fields = Object.fromEntries(Object.entries(value.fields).map(([name, item]) => [name, item === undefined ? null : item])) as StudioDraftData["fields"];
  const { data } = await client.put<{ data: { revision: string } }>("/save", { ...scope, revision: revisions.get(key), value: { fields, references, savedAt: value.savedAt } });
  revisions.set(key, data.data.revision);
}

export async function accessDraft(key: string, value?: StudioDraft, signal?: AbortSignal): Promise<StudioDraft | undefined> {
  try {
    if (value !== undefined) { await writeDraft(key, value); return value; }
    const scope = draftScope(key);
    const { data } = await client.get<{ data: { revision: string; value: StudioDraftData | null } }>("/get", { params: scope, signal });
    if (!data.data || typeof data.data.revision !== "string") throw new Error("服务未返回有效草稿，请确认服务已更新");
    revisions.set(key, data.data.revision);
    if (!data.data.value) {
      // 仅在当前来源有旧缓存且服务端没有草稿时迁移；保留旧 IndexedDB，不静默覆盖新记录。
      const legacy = await readLegacyDraft(key);
      signal?.throwIfAborted();
      if (legacy) await writeDraft(key, legacy);
      return legacy;
    }
    const stored = data.data.value;
    const references: StudioDraft["references"] = [];
    const downloaded = new Map<string, Blob>();
    for (const reference of stored.references) {
      let bytes = downloaded.get(reference.fileHash);
      if (!bytes) {
        const response = await client.get<Blob>("/readFile", { params: { ...scope, fileHash: reference.fileHash }, responseType: "blob", signal, timeout: 120000 });
        bytes = response.data;
        if (bytes.size !== reference.size || await hashBlob(bytes) !== reference.fileHash) throw new Error(`草稿参考“${reference.name}”内容与摘要不符，原文件已保留，请先备份后处理`);
        downloaded.set(reference.fileHash, bytes);
      }
      const file = new Blob([bytes], { type: reference.mimeType });
      fileCache.set(file, { hash: Promise.resolve(reference.fileHash), scopes: new Set([key]) });
      references.push({ id: reference.id, kind: reference.kind, name: reference.name, file, ...(reference.paths ? { paths: reference.paths } : {}) });
    }
    return { fields: Object.fromEntries(Object.entries(stored.fields).map(([name, item]) => [name, item === null ? undefined : item])), references, savedAt: stored.savedAt };
  } catch (cause) {
    if (signal?.aborted) throw cause;
    let response = axios.isAxiosError(cause) ? cause.response?.data : undefined;
    if (response instanceof Blob) { try { response = JSON.parse(await response.text()); } catch { response = undefined; } }
    throw new Error(typeof response?.message === "string" ? response.message : cause instanceof Error ? cause.message : "本地草稿存储不可用", { cause });
  }
}

async function readLegacyDraft(key: string): Promise<StudioDraft | undefined> {
  return new Promise<StudioDraft | undefined>((resolve, reject) => {
    let database: IDBDatabase | undefined;
    let transaction: IDBTransaction | undefined;
    let settled = false;
    function finish(error?: unknown, result?: StudioDraft) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      database?.close();
      if (error) reject(error); else resolve(result);
    }
    const timer = setTimeout(() => {
      try { transaction?.abort(); } catch { /* 事务刚完成时无需再次中断。 */ }
      finish(new Error("浏览器草稿存储响应超时，请重试"));
    }, 10000);
    const request = indexedDB.open("toonflow.studioDrafts", 1);
    request.onblocked = () => finish(new Error("草稿存储被其他窗口占用，请关闭旧窗口后重试"));
    request.onerror = () => finish(request.error);
    request.onupgradeneeded = () => {
      if (settled) { request.transaction?.abort(); return; }
      request.result.createObjectStore("drafts");
    };
    request.onsuccess = () => {
      database = request.result;
      if (settled) { database.close(); return; }
      database.onversionchange = () => database?.close();
      database.onclose = () => finish(new Error("草稿存储连接已关闭，请重试"));
      try {
        transaction = database.transaction("drafts", "readonly");
        const store = transaction.objectStore("drafts");
        const operation = store.get(key);
        transaction.oncomplete = () => finish(undefined, operation.result);
        transaction.onabort = () => finish(transaction?.error ?? new Error("草稿保存失败"));
      } catch (error) { finish(error); }
    };
  });
}
