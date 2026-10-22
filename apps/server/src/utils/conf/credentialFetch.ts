/** 所有带鉴权的模型请求限制为安全传输，并禁止自动跟随重定向。 */
export function credentialFetch(apiUrl?: string, apiKey = "", request = fetch): typeof fetch {
  return Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const address = input instanceof Request ? input.url : String(input);
    const url = new URL(address);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const authenticated = ["authorization", "x-api-key", "api-key"].some(name => headers.has(name)) ||
      (!!apiKey && [...headers.values()].some(value => value.includes(apiKey)));
    if (authenticated) {
      if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
        throw new Error("带密钥的请求须使用 HTTPS；仅本机服务允许 HTTP");
      }
      if (apiUrl && url.origin !== new URL(apiUrl).origin) throw new Error("请求目标与密钥绑定的 API 地址不同，已阻止发送");
    }
    if (apiKey && (url.search.includes(apiKey) || url.username.includes(apiKey) || url.password.includes(apiKey))) throw new Error("不能在 URL 中传递 API 密钥");
    let response: Response;
    try { response = await request(input, { ...init, ...(authenticated ? { redirect: "error" } : {}) }); }
    catch {
      (init?.signal ?? (input instanceof Request ? input.signal : undefined))?.throwIfAborted();
      throw new Error(`无法连接 API ${url.host}，请检查网络与地址；鉴权请求不允许重定向`);
    }
    // SDK 可能把上游错误原文存入会话；在统一传输入口先剔除当前密钥。
    if (!response.ok && apiKey) {
      let body = "";
      const reader = response.body?.getReader();
      if (reader) {
        let incomplete = false;
        const timeout = setTimeout(() => { incomplete = true; void reader.cancel().catch(() => {}); }, 5000);
        const decoder = new TextDecoder();
        try {
          let size = 0;
          while (size < 65536) {
            const chunk = await reader.read();
            if (chunk.done) break;
            const bytes = chunk.value.subarray(0, 65536 - size);
            size += bytes.length;
            body += decoder.decode(bytes, { stream: true });
          }
          body = incomplete || size >= 65536 ? `上游错误响应未完整读取（HTTP ${response.status}）` : body + decoder.decode();
        } finally { clearTimeout(timeout); void reader.cancel().catch(() => {}); }
      }
      body = body.replaceAll(apiKey, "[已隐藏密钥]").replaceAll(encodeURIComponent(apiKey), "[已隐藏密钥]");
      const safeHeaders = new Headers(response.headers);
      safeHeaders.delete("content-length");
      safeHeaders.delete("content-encoding");
      return new Response(body, { status: response.status, statusText: response.statusText, headers: safeHeaders });
    }
    return response;
  }, { preconnect: request.preconnect }) as typeof fetch;
}
