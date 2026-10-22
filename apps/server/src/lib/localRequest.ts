import type { Request, Response, NextFunction } from "express";
import { error } from "@/lib/responseFormat";

const loopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

// 桌面文件和插件接口没有公网账号体系，必须在解析请求体和加载路由前保护本机边界。
export default function localRequest(req: Request, res: Response, next: NextFunction) {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "base-uri 'self'; object-src 'none'; frame-ancestors 'self'",
  });
  if (req.path === "/api" || req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
  const reject = () => res.status(403).json(error("仅允许本机零幕页面访问，请从客户端或本机地址打开。", null, 403));
  if (!loopbackAddresses.has(req.socket.remoteAddress ?? "") || req.get("x-toonflow-local-client") === "0") return reject();

  let target: URL;
  try { target = new URL(`${req.protocol}://${req.get("host")}`); }
  catch { return reject(); }
  if (!loopbackHosts.has(target.hostname) || target.username || target.password) return reject();

  // Host 白名单阻止 DNS 重绑定；来源校验还须阻止普通表单、图片和跨端口的本机网页请求。
  const source = req.get("origin") ?? req.get("referer");
  if (source !== undefined) {
    try { if (new URL(source).origin !== target.origin) return reject(); }
    catch { return reject(); }
  }
  const fetchSite = req.get("sec-fetch-site");
  if (fetchSite === "cross-site" || fetchSite === "same-site") return reject();
  const appMutation = (req.path === "/api" || req.path.startsWith("/api/")) && !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (appMutation && source === undefined && fetchSite !== "same-origin") return reject();
  next();
}
