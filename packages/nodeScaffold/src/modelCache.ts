// ACT: 模型缓存由宿主和独立 UMD 共用；失效操作不加载生成 SDK。
const modelCacheKey = Symbol.for("toonflow.nodeModels");
const modelCacheHost = globalThis as typeof globalThis & { [modelCacheKey]?: Map<string, Promise<unknown[]>> };
export const modelCache = modelCacheHost[modelCacheKey] ??= new Map<string, Promise<unknown[]>>();

export function invalidateNodeModels(type: "language" | "media") {
  modelCache.delete(type === "language" ? "/api/ai/models" : "/api/ai/media/models");
}
