import { createReadStream, createWriteStream, open, stat } from "@toonflow/file";
import { createHash } from "node:crypto";
import { Zip, ZipPassThrough } from "fflate";

export type ArchiveFile = { name: string; size: number; hash: string; path?: string; bytes?: Uint8Array };
export type ArchiveEntry = { name: string; size: number; crc: number; start: number; end: number };
export const maxArchiveBytes = 3 * 1024 ** 3;
function invalid(message: string): never { throw Object.assign(new Error(message), { status: 422 }); }
export async function hashFile(path: string, signal?: AbortSignal) { const hash = createHash("sha256"); for await (const chunk of createReadStream(path, { signal, highWaterMark: 64 * 1024 })) hash.update(chunk); return hash.digest("hex"); }
export const hashBytes = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** 使用 ZIP STORE，媒体已经压缩；每个输入块等待落盘，不把大文件或整包放入内存。 */
export async function writeArchive(path: string, files: ArchiveFile[], signal: AbortSignal, progress: (bytes: number) => void) {
  const output = createWriteStream(path, { flags: "wx", mode: 0o600 });
  let failure: unknown; let queue = Promise.resolve(); let written = 0;
  output.on("error", error => { failure = error; });
  const zip = new Zip((error, bytes) => {
    if (error) { failure = error; return; }
    // Zip 的同步回调只产生当前 64 KB 输入和少量目录数据；下一次 push 前等待此队列。
    queue = queue.then(() => new Promise<void>((yes, no) => output.write(bytes, error => error ? no(error) : yes())));
    void queue.catch(error => { failure = error; });
  });
  try {
    for (const file of files) {
      signal.throwIfAborted(); if (failure) throw failure;
      const entry = new ZipPassThrough(file.name); zip.add(entry); const hash = createHash("sha256"); let size = 0;
      const chunks = file.bytes ? [file.bytes] : createReadStream(file.path!, { signal, highWaterMark: 64 * 1024 });
      for await (const chunk of chunks) { signal.throwIfAborted(); hash.update(chunk); size += chunk.length; entry.push(chunk); await queue; if (failure) throw failure; written += chunk.length; progress(written); }
      entry.push(new Uint8Array(), true); await queue;
      if (size !== file.size || hash.digest("hex") !== file.hash) invalid("归集期间文件发生变化，项目包未提交，请保存后重新打包");
    }
    zip.end(); await queue; if (failure) throw failure;
    await new Promise<void>((yes, no) => output.end((error?: Error | null) => error ? no(error) : yes()));
  } catch (error) { zip.terminate(); output.destroy(); throw error; }
}

async function readAt(handle: Awaited<ReturnType<typeof open>>, length: number, position: number) {
  const buffer = Buffer.alloc(length); let read = 0;
  while (read < length) { const result = await handle.read(buffer, read, length - read, position + read); if (!result.bytesRead) invalid("项目包被截断"); read += result.bytesRead; }
  return buffer;
}
/** 从中央目录读取边界，不能通过扫描媒体中的 PK 签名判断文件结束。只接受本格式的 STORE 包。 */
export async function readArchiveIndex(path: string): Promise<ArchiveEntry[]> {
  const info = await stat(path); if (!info.isFile() || info.size < 22 || info.size > maxArchiveBytes) invalid("项目包大小无效或超过 3 GB 上限");
  const handle = await open(path, "r");
  try {
    const tail = await readAt(handle, Math.min(info.size, 65557), Math.max(0, info.size - 65557)); let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { eocd = i; break; }
    if (eocd < 0) invalid("ZIP 结束记录缺失，项目包损坏");
    const count = tail.readUInt16LE(eocd + 10); const size = tail.readUInt32LE(eocd + 12); const offset = tail.readUInt32LE(eocd + 16);
    if (tail.readUInt16LE(eocd + 4) || tail.readUInt16LE(eocd + 6) || tail.readUInt16LE(eocd + 8) !== count || !count || count > 50000 || size > 20 * 1024 ** 2 || offset + size !== info.size - tail.length + eocd) invalid("不支持分卷、ZIP64 或异常中央目录");
    const central = await readAt(handle, size, offset); const entries = []; let cursor = 0;
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== 0x02014b50) invalid("ZIP 中央目录损坏");
      const flags = central.readUInt16LE(cursor + 8); const method = central.readUInt16LE(cursor + 10); const crc = central.readUInt32LE(cursor + 16); const packed = central.readUInt32LE(cursor + 20); const length = central.readUInt32LE(cursor + 24);
      const nameLength = central.readUInt16LE(cursor + 28); const extra = central.readUInt16LE(cursor + 30); const comment = central.readUInt16LE(cursor + 32); const localOffset = central.readUInt32LE(cursor + 42);
      if (method !== 0 || flags & ~0x0808 || packed !== length || length > 2 * 1024 ** 3 || cursor + 46 + nameLength + extra + comment > central.length || central.readUInt16LE(cursor + 34) || (central.readUInt32LE(cursor + 38) >>> 16 & 0xf000) === 0xa000) invalid("项目包包含加密、链接或不支持的压缩方式");
      const nameBytes = central.subarray(cursor + 46, cursor + 46 + nameLength); const name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
      if (localOffset > offset - 30) invalid("ZIP 本地文件头越界");
      const local = await readAt(handle, 30, localOffset);
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(6) !== flags || local.readUInt16LE(8) !== method || local.readUInt16LE(26) !== nameLength) invalid("ZIP 文件头与目录不一致");
      if (!(await readAt(handle, nameLength, localOffset + 30)).equals(nameBytes)) invalid("ZIP 路径记录不一致");
      const start = localOffset + 30 + nameLength + local.readUInt16LE(28); const end = start + length;
      if (end > offset) invalid("ZIP 文件内容越界");
      let next = end;
      if (flags & 8) { const descriptor = await readAt(handle, 16, end); if (descriptor.readUInt32LE(0) !== 0x08074b50 || descriptor.readUInt32LE(4) !== crc || descriptor.readUInt32LE(8) !== length || descriptor.readUInt32LE(12) !== length) invalid("ZIP 文件摘要记录不一致"); next += 16; }
      else if (local.readUInt32LE(14) !== crc || local.readUInt32LE(18) !== length || local.readUInt32LE(22) !== length) invalid("ZIP 文件长度记录不一致");
      entries.push({ name, size: length, crc, start, end, localOffset, next }); cursor += 46 + nameLength + extra + comment;
    }
    if (cursor !== size) invalid("ZIP 目录存在多余数据");
    let next = 0; for (const entry of [...entries].sort((a, b) => a.localOffset - b.localOffset)) { if (entry.localOffset !== next) invalid("ZIP 文件范围重叠或存在未登记内容"); next = entry.next; } if (next !== offset) invalid("ZIP 文件与目录范围不连续");
    return entries;
  } finally { await handle.close(); }
}
export async function readArchiveFile(path: string, entry: ArchiveEntry, limit: number) {
  if (entry.size > limit) invalid("项目包清单或 JSON 文件过大");
  const chunks: Buffer[] = [];
  if (entry.size) for await (const chunk of createReadStream(path, { start: entry.start, end: entry.end - 1, highWaterMark: 64 * 1024 })) chunks.push(chunk);
  const bytes = Buffer.concat(chunks); const checksum = new ZipPassThrough(entry.name); checksum.ondata = () => {}; checksum.push(bytes, true);
  if ((checksum.crc >>> 0) !== entry.crc) invalid("项目包清单 CRC 不匹配");
  return bytes;
}
export async function extractArchiveFile(path: string, entry: ArchiveEntry, target: string, expectedHash: string, signal: AbortSignal, progress: (bytes: number) => void) {
  const output = createWriteStream(target, { flags: "wx", mode: 0o600 }); const hash = createHash("sha256"); const checksum = new ZipPassThrough(entry.name); checksum.ondata = () => {}; let size = 0;
  let failure: unknown; output.on("error", error => { failure = error; });
  try {
    if (entry.size) for await (const chunk of createReadStream(path, { signal, start: entry.start, end: entry.end - 1, highWaterMark: 64 * 1024 })) { signal.throwIfAborted(); hash.update(chunk); checksum.push(chunk); size += chunk.length; await new Promise<void>((yes, no) => output.write(chunk, error => error ? no(error) : yes())); if (failure) throw failure; progress(chunk.length); }
    checksum.push(new Uint8Array(), true);
    if (size !== entry.size || hash.digest("hex") !== expectedHash || (checksum.crc >>> 0) !== entry.crc) invalid(`项目包文件摘要不匹配：${entry.name}`);
    await new Promise<void>((yes, no) => output.end((error?: Error | null) => error ? no(error) : yes()));
  } catch (error) { output.destroy(); throw error; }
}
