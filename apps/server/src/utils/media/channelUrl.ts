/** 兼容主机地址和以 /v1 结尾的 OpenAI Base URL，保留代理路径前缀。 */
export function channelUrl(base: string, path: string) {
  const url = new URL(base.trim());
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("渠道 API 地址无效");
  const root = url.toString().replace(/\/+$/, "");
  return root + (/\/v1$/i.test(root) && /^\/v1(?:\/|$)/i.test(path) ? path.slice(3) : path);
}
