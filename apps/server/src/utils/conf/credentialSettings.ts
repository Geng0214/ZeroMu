import { isProtectedCredential } from "./credentialStorage";

type CredentialRevision = (value: unknown) => string;
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function isValidApiUrl(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash &&
      (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  } catch { return false; }
}

export function assertApiUrl(value: unknown) {
  if (!isValidApiUrl(value)) throw Object.assign(new Error("API 地址须使用 HTTPS，且不能包含账号、查询参数或锚点；仅本机服务允许 HTTP"), { status: 400 });
}

function normalizedUrl(value: unknown) {
  try { return new URL(String(value)).href.replace(/\/+$/, ""); } catch { return value; }
}

/** 普通配置接口永不回传密钥；版本标记用于阻止多窗口覆盖凭据。 */
export function publicCredentialSettings(value: unknown, revision: CredentialRevision): unknown {
  if (Array.isArray(value)) return value.map(item => publicCredentialSettings(item, revision));
  if (!value || typeof value !== "object") return value;
  const source = record(value);
  const result = Object.fromEntries(Object.entries(source).filter(([key]) => !["apiKey", "pluginMarketApiKey"].includes(key)).map(([key, item]) => [key, publicCredentialSettings(item, revision)]));
  if (Object.hasOwn(source, "pluginMarketApiKey")) result.pluginMarketCredential = publicCredentialSettings({ apiKey: source.pluginMarketApiKey }, revision);
  if (Object.hasOwn(source, "apiKey")) {
    result.hasApiKey = !!source.apiKey;
    result.apiKeyUnavailable = isProtectedCredential(source.apiKey);
    result.apiKeyRevision = revision(source.apiKey);
  }
  return result;
}

/** 缺省表示保留，空字符串表示清除，非空字符串表示替换。只信任服务端现有密钥。 */
export function restoreCredentialSettings(next: unknown, current: unknown, base: unknown, revision: CredentialRevision): unknown {
  if (Array.isArray(next)) {
    const previous = Array.isArray(current) ? current : [];
    const original = Array.isArray(base) ? base : [];
    return next.map((item, index) => {
      const id = record(item).id;
      return restoreCredentialSettings(item, id ? previous.find(value => record(value).id === id) : previous[index], id ? original.find(value => record(value).id === id) : original[index], revision);
    });
  }
  if (!next || typeof next !== "object") return next;
  const source = record(next);
  const previous = record(current);
  const original = record(base);
  const result = Object.fromEntries(Object.entries(source).filter(([key]) => !["apiKey", "hasApiKey", "apiKeyUnavailable", "apiKeyRevision", "pluginMarketApiKey", "pluginMarketCredential"].includes(key))
    .map(([key, value]) => [key, restoreCredentialSettings(value, previous[key], original[key], revision)]));
  if (Object.hasOwn(source, "pluginMarketApiKey") || Object.hasOwn(previous, "pluginMarketApiKey")) {
    const restored = record(restoreCredentialSettings(
      Object.hasOwn(source, "pluginMarketApiKey") ? { apiKey: source.pluginMarketApiKey } : {},
      { apiKey: previous.pluginMarketApiKey }, record(original.pluginMarketCredential), revision
    ));
    if (restored.apiKey !== undefined) result.pluginMarketApiKey = restored.apiKey;
  }
  const changingKey = Object.hasOwn(source, "apiKey");
  const changingTarget = normalizedUrl(source.apiUrl) !== normalizedUrl(previous.apiUrl) || source.protocol !== previous.protocol;
  if (changingKey) {
    if (typeof source.apiKey !== "string" || source.apiKey.length > 8192) throw Object.assign(new Error("API 密钥格式无效"), { status: 400 });
    if ((original.apiKeyRevision ?? "") !== revision(previous.apiKey)) throw Object.assign(new Error("密钥已在其他窗口修改，请刷新后重试"), { status: 409 });
    if (source.apiKey.trim() && source.apiUrl) assertApiUrl(source.apiUrl);
    result.apiKey = source.apiKey.trim().replace(/^Bearer\s+/i, "");
  } else if (Object.hasOwn(previous, "apiKey")) {
    if (previous.apiKey && changingTarget) throw Object.assign(new Error("API 地址或协议已改变，请重新输入密钥后保存"), { status: 400 });
    result.apiKey = previous.apiKey;
  }
  if (source.apiUrl && normalizedUrl(source.apiUrl) !== normalizedUrl(previous.apiUrl)) assertApiUrl(source.apiUrl);
  return result;
}
