export interface MediaMoney {
  currency: string;
  amount: string;
}

export interface MediaPriceRule {
  id: string;
  providerId: string;
  modelId: string;
  mediaType: "image" | "video" | "audio";
  currency: string;
  /** request 为应用内整项任务的总价，非 HTTP 请求单价；可用 n 等条件限定范围。 */
  unit: "request" | "image" | "second" | "thousandCharacters";
  unitPrice: string;
  source: string;
  updatedAt: number;
  conditions?: {
    size?: string; ratio?: string; quality?: string; resolution?: string; duration?: number;
    generateAudio?: boolean; mode?: string; imageReferences?: number; videoReferences?: number; audioReferences?: number;
    voice?: string; format?: string; speed?: number; sampleRate?: number; volume?: number; n?: number;
  };
}

export type MediaCostQuote = { kind: "unknown"; reason: string } | {
  kind: "estimated";
  money: MediaMoney;
  quantity: string;
  rate: MediaPriceRule;
  priceFingerprint: string;
};

/** key 标识同一份回执；轮询和恢复更新同号回执，不累加重复值。 */
export interface MediaUsageReport {
  key: string;
  values?: Record<string, number>;
  charge?: MediaMoney;
  /** 仅在供应商明确确认整项任务账单完整时设置；结果生成完成不等于结算完成。 */
  complete?: boolean;
}

export interface MediaTaskCost {
  quote: MediaCostQuote;
  revision: number;
  submittedAt?: number;
  reports: (MediaUsageReport & { reportedAt: number })[];
  statement?: MediaMoney & { note: string; recordedAt: number };
  statementHistory?: (MediaMoney & { note: string; recordedAt: number })[];
}

export interface MediaBudget {
  directory: string;
  currency: string;
  limit: string;
  startsAt: number;
}

export interface MediaCostPolicy {
  schemaVersion: 1;
  revision: number;
  prices: MediaPriceRule[];
  budgets: MediaBudget[];
}

export interface MediaCostSummary {
  currencies: { currency: string; actual: string; estimated: string; reserved: string; exposure: string }[];
  unknownCount: number;
  unsubmittedCount: number;
  budget?: MediaBudget & { exposure: string; remaining: string; unknownCount: number };
}

/** 保留供应商 usage 中的原始数字字段；不据字段名推断币种、金额或计费单位。 */
export function mediaUsageValues(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const source = value as Record<string, unknown>;
  const nested = source.data && typeof source.data === "object" && !Array.isArray(source.data) ? source.data as Record<string, unknown> : {};
  const usage = source.usage ?? nested.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return;
  const values: Record<string, number> = {};
  for (const [key, amount] of Object.entries(usage)) {
    if (!key.length || key.length > 100 || Object.keys(values).length >= 64) continue;
    if (typeof amount === "number" && Number.isFinite(amount) && amount >= 0) values[key] = amount;
    else if (amount && typeof amount === "object" && !Array.isArray(amount)) for (const [name, part] of Object.entries(amount)) {
      if (Object.keys(values).length < 64 && `${key}.${name}`.length <= 100 && typeof part === "number" && Number.isFinite(part) && part >= 0) values[`${key}.${name}`] = part;
    }
  }
  return Object.keys(values).length ? values : undefined;
}
