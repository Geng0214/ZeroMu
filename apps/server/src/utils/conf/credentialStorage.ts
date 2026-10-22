import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";

type ProtectedCredential = { type: "zeromuCredential"; version: 1; keyId: string; iv: string; tag: string; data: string };
const service = "zeromu.apiCredentials";
const keyIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isProtectedCredential(value: unknown): value is ProtectedCredential {
  return record(value) && value.type === "zeromuCredential";
}

/** 密钥材料只进入系统凭据库；JSON 仅保存认证加密后的 API Key。 */
export async function createCredentialStorage(initial: unknown) {
  const keyIds = new Set<string>();
  function collect(value: unknown) {
    if (isProtectedCredential(value)) {
      if (typeof value.keyId === "string" && keyIdPattern.test(value.keyId)) keyIds.add(value.keyId);
    } else if (value && typeof value === "object") Object.values(value).forEach(collect);
  }
  collect(initial);
  if (record(initial) && typeof initial.credentialStorageKeyId === "string" && keyIdPattern.test(initial.credentialStorageKeyId)) keyIds.add(initial.credentialStorageKeyId);
  const keys = new Map<string, Buffer>();
  let storeAvailable = true;
  for (const keyId of keyIds) {
    try {
      const value = await Bun.secrets.get({ service, name: keyId });
      if (value && /^[0-9a-f]{64}$/.test(value)) keys.set(keyId, Buffer.from(value, "hex"));
    } catch { storeAvailable = false; }
  }
  if (!keys.size && storeAvailable) {
    const keyId = randomUUID();
    const value = randomBytes(32).toString("hex");
    try {
      await Bun.secrets.set({ service, name: keyId, value });
      if (await Bun.secrets.get({ service, name: keyId }) !== value) throw new Error("凭据库校验失败");
      keys.set(keyId, Buffer.from(value, "hex"));
    } catch { storeAvailable = false; }
  }
  const active = keys.entries().next().value;
  const revisionKey = active?.[1] ?? randomBytes(32);
  const encrypted = new Map<string, ProtectedCredential>();
  const decrypted = new Map<string, string>();

  function protect(value: string, path: string): ProtectedCredential {
    if (!active || !storeAvailable) throw new Error("系统凭据库不可用，API 密钥未保存；请检查 Windows 凭据管理服务后重试");
    const cached = encrypted.get(`${path}\0${value}`);
    if (cached) return cached;
    const [keyId, key] = active;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(`zeromuCredential:1:${path}`));
    const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const result: ProtectedCredential = { type: "zeromuCredential", version: 1, keyId, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
    encrypted.set(`${path}\0${value}`, result);
    return result;
  }

  function unprotect(value: ProtectedCredential, path: string): string | ProtectedCredential {
    const cacheKey = `${path}\0${JSON.stringify(value)}`;
    const cached = decrypted.get(cacheKey);
    if (cached !== undefined) return cached;
    try {
      const key = keys.get(value.keyId);
      if (!key || value.version !== 1) return value;
      const iv = Buffer.from(value.iv, "base64");
      const tag = Buffer.from(value.tag, "base64");
      if (iv.length !== 12 || tag.length !== 16) return value;
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(Buffer.from(`zeromuCredential:1:${path}`));
      decipher.setAuthTag(tag);
      const result = Buffer.concat([decipher.update(Buffer.from(value.data, "base64")), decipher.final()]).toString("utf8");
      decrypted.set(cacheKey, result);
      encrypted.set(`${path}\0${result}`, value);
      return result;
    } catch {
      // 保留无法解密的密文，让用户能在界面重新输入，不能清空配置或降级为明文。
      return value;
    }
  }

  function transform(value: unknown, encrypt: boolean, path = ""): unknown {
    if (isProtectedCredential(value)) return encrypt ? value : unprotect(value, path);
    if (Array.isArray(value)) return value.map((item, index) => transform(item, encrypt, `${path}/${index}`));
    if (!record(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([name, item]) => {
      const location = `${path}/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      return [name, encrypt && ["apiKey", "pluginMarketApiKey"].includes(name) && typeof item === "string" && item ? protect(item, location) : transform(item, encrypt, location)];
    }));
  }

  return {
    keyId: active?.[0],
    serialize: (value: unknown) => JSON.stringify(transform(value, true), null, 2),
    deserialize: (value: string) => transform(JSON.parse(value), false) as Record<string, unknown>,
    revision: (value: unknown) => value ? createHmac("sha256", revisionKey).update(JSON.stringify(value)).digest("hex") : "",
  };
}
