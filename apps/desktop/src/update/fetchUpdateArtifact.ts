// 更新清单和安装包都必须校验每一跳，避免 HTTPS 地址被重定向到明文传输。
export default async function fetchUpdateArtifact(input: URL, signal: AbortSignal): Promise<Response> {
  let url = input;
  let secure = url.protocol === "https:";
  for (let redirects = 0; redirects <= 5; redirects++) {
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || !(url.protocol === "https:" || !secure && url.protocol === "http:" && local)) {
      throw new Error("更新下载仅允许 HTTPS；本机测试允许 HTTP，且不允许从 HTTPS 降级。");
    }
    secure ||= url.protocol === "https:";
    const response = await fetch(url, { signal, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (!location || redirects === 5) throw new Error("更新源重定向无效或次数过多，请检查更新地址。");
    url = new URL(location, url);
  }
  throw new Error("更新源重定向次数过多。");
}
