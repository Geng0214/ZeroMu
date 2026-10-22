import logger from "morgan";
import express from "express";
import { resolve } from "node:path";
import type { Request, Response, NextFunction } from "express";
import buildRoute from "@/core";
import { error } from "@/lib/responseFormat";
import desktopRequest from "@/lib/desktop";
import localRequest from "@/lib/localRequest";
import initializePlugins from "@/utils/plugins/initialize";
import { setToolConfigWorkerPath } from "@/utils/plugins/toolProcess";
import { languageRequest, resolveRequestLocale, runWithLocale, setLocaleFallback, translateError, translateMessage } from "@/lib/i18n";
import { detectLocale, normalizeLocale } from "@toonflow/i18n";
import { z } from "zod";


export async function createApp({
  webRoot,
  dataDirectory,
  toolsRoot,
  nodesRoot,
  skillsRoot,
  agentsRoot,
  pluginRevision,
  toolConfigWorkerPath,
}: {
  webRoot: string;
  dataDirectory?: string;
  toolsRoot?: string;
  nodesRoot?: string;
  skillsRoot?: string;
  agentsRoot?: string;
  pluginRevision?: string;
  toolConfigWorkerPath?: string;
}) {
  // conf 由下方的路由动态加载，必须先确定整个进程共用的数据目录。
  if (dataDirectory) process.env.TOONFLOW_DATA_DIR = resolve(dataDirectory);
  setToolConfigWorkerPath(toolConfigWorkerPath);
  const { default: conf } = await import("@/utils/conf");
  setLocaleFallback(() => normalizeLocale((conf.get("settings", {}).ui as { language?: unknown } | undefined)?.language)
    ?? detectLocale([Intl.DateTimeFormat().resolvedOptions().locale]));
  if (dataDirectory && toolsRoot)
    await initializePlugins(resolve(dataDirectory, "tools"), toolsRoot, /^[a-z][a-zA-Z0-9]*\.tool\.js$/, pluginRevision);
  if (dataDirectory && nodesRoot) await initializePlugins(resolve(dataDirectory, "nodes"), nodesRoot, /^[a-z][a-zA-Z0-9]*\.umd\.js$/, pluginRevision);
  // ACT: 模型供应商仅由用户配置，启动时不预装模型目录。
  if (dataDirectory && skillsRoot) await initializePlugins(resolve(dataDirectory, "skills"), skillsRoot);
  if (dataDirectory && agentsRoot) await initializePlugins(resolve(dataDirectory, "agents"), agentsRoot);
  const app = express();
  app.disable("x-powered-by");
  app.use(localRequest);

  if (process.env.NODE_ENV === "dev") {
    await buildRoute();
    // 查询参数可能包含预览令牌，不把令牌和本地路径写入访问日志。
    app.use(logger((tokens, req, res) => [tokens.method?.(req, res), req.url?.split("?")[0], tokens.status?.(req, res), tokens["response-time"]?.(req, res), "ms"].join(" ")));
  }
  app.use(languageRequest);
  app.use("/a2a", express.json({ limit: "2mb" }));
  app.use(["/api/workspaces/files/write", "/api/assets/save", "/api/studioDrafts/writeFile"], express.raw({ type: "application/octet-stream", limit: "100mb" }));
  app.use(["/api/ai", "/api/agent", "/api/providers", "/api/workspaces/files/write"], express.json({ limit: "100mb" }));
  app.use(express.json({ limit: "8mb" }));
  app.use("/api/desktop", desktopRequest);

  const router = await import("@/router");
  router.default(app);
  const [{ createMcpRouter }, { getMcpTools }, { authorizeMcp }, { skillResources }] = await Promise.all([
    import("@toonflow/mcp"),
    import("@/utils/mcp/tools"),
    import("@/utils/mcp/control"),
    import("@/utils/mcp/resources"),
  ]);
  app.use("/mcp", createMcpRouter({ getTools: getMcpTools, authorize: authorizeMcp, resources: skillResources,
    runInRequest: (request, operation) => runWithLocale(resolveRequestLocale(request.get("accept-language")), operation),
    translate: translateMessage,
    translateError,
  }));
  const { createA2aRouter } = await import("@/agent/a2a");
  app.use("/a2a", createA2aRouter());
  app.use(express.static(webRoot));
  app.use((req, res) => res.status(404).json(error("找不到此接口或文件", null, 404)));

  // 错误处理
  app.use((err: Error & { status?: number }, request: Request, response: Response, next: NextFunction) => {
    if (response.headersSent) return next(err);
    // Error 对象可能携带请求体、认证头或上游响应，只记录定位故障所需的非敏感字段。
    console.error("请求失败", { method: request.method, path: request.path, type: err.name, status: err.status, code: (err as NodeJS.ErrnoException).code });
    if (err instanceof z.ZodError) {
      return response.status(400).json(error("参数错误", err.issues.map(issue => ({ ...issue, message: translateMessage(issue.message) })), 400));
    }
    const code = (err as NodeJS.ErrnoException).code;
    const status = typeof err.status === "number" && Number.isInteger(err.status) && err.status >= 400 && err.status <= 599
      ? err.status : ({ ENOENT: 404, ENOTDIR: 404, EEXIST: 409, ENOTEMPTY: 409, EACCES: 403, EPERM: 403 }[code ?? ""] ?? 500);
    if ((err as Error & { type?: string }).type === "entity.parse.failed") return response.status(400).json(error("请求内容不是有效的 JSON", null, 400));
    if (status === 413) return response.status(413).json(error("请求内容过大，请减少附件或分批操作", null, 413));
    const message =
      {
        ENOENT: "找不到这个文件或文件夹，可能已被移动、删除，或者位置选错了。",
        ENOTDIR: "你选中的是文件，但这里需要选择文件夹。请重新选择。",
        EEXIST: "这个名称已经被占用了，请换一个名称。原来的内容不会被覆盖。",
        ENOTEMPTY: "这个文件夹里还有内容，不能直接删除。请先清空或移走里面的文件。",
        EACCES: "没有权限访问这个文件或文件夹。请检查权限，或换一个位置重试。",
        EPERM: "系统不允许这次操作。文件可能正在被其他程序使用，请关闭后重试。",
        EISDIR: "你选中的是文件夹，但这里需要的是文件。请重新选择具体文件。",
      }[code ?? ""] ?? translateError(err);
    response.status(status).json(error(message, code ? { code } : null, status));
  });

  return app;
}
