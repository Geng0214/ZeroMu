import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { resolveWorkspacePath } from "@/utils/workspace/files";
export { prepareMediaPreview } from "./mediaPreview";

const secret = randomBytes(32);
export function createPreviewToken(directory: string, path: string, mimeType?: string) {
  const payload = Buffer.from(JSON.stringify({ directory, path, ...(mimeType ? { mimeType } : {}), expires: Date.now() + 24 * 3600_000 })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
export async function resolvePreviewToken(token: string) {
  const [payload, signature, extra] = token.split(".");
  const expected = createHmac("sha256", secret).update(payload ?? "").digest();
  const supplied = Buffer.from(signature ?? "", "base64url");
  if (extra || supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) throw Object.assign(new Error("预览链接无效，请刷新结果"), { status: 403 });
  const data = JSON.parse(Buffer.from(payload!, "base64url").toString());
  if (data.expires < Date.now()) throw Object.assign(new Error("预览链接已过期，请刷新结果"), { status: 403 });
  return { ...await resolveWorkspacePath(data.directory, data.path), mimeType: typeof data.mimeType === "string" && /^(image|video|audio)\/[a-z0-9.+-]+$/i.test(data.mimeType) ? data.mimeType : undefined };
}
