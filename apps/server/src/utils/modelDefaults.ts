import conf from "@/utils/conf";

export type DefaultModelKind = "image" | "video" | "audio" | "text";
type ModelRef = { providerId: string; modelId: string };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function defaultOf(kind: DefaultModelKind): ModelRef | null {
  const ref = record(record(conf.get("settings", {}).mediaChannelDefaults)[kind]);
  return typeof ref.providerId === "string" && typeof ref.modelId === "string" ? { providerId: ref.providerId, modelId: ref.modelId } : null;
}

/**
 * 把每种能力的默认模型排到列表最前，其余顺序不变。
 * 节点只为空配置取第一项，因此这里排序等价于设置新建默认值，不会覆盖已有选择。
 */
export function orderByDefaultModel<T>(items: T[], kindOf: (item: T) => DefaultModelKind, refOf: (item: T) => ModelRef) {
  const defaults = new Map<DefaultModelKind, ModelRef | null>();
  return [...items].sort((left, right) => {
    const rank = (item: T) => {
      const kind = kindOf(item);
      if (!defaults.has(kind)) defaults.set(kind, defaultOf(kind));
      const selected = defaults.get(kind);
      const ref = refOf(item);
      return selected && selected.providerId === ref.providerId && selected.modelId === ref.modelId ? 0 : 1;
    };
    return rank(left) - rank(right);
  });
}
