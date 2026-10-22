import axios from "axios";
import { detectLocale, normalizeLocale } from "@toonflow/i18n";
import { computed, nextTick, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { invalidateNodeModels } from "@toonflow/nodes-scaffold/modelCache";
import { debounce } from "lodash-es";
import { canvasShortcutFields, defaultCanvasShortcuts, getShortcutBindings, isShortcutAllowed, normalizeShortcut, type CanvasShortcuts } from "@/lib/canvasShortcuts";
import "element-plus/es/components/message/style/css";

export const settings = ref<Record<string, unknown>>({});
export const agentPreferences = computed(() => {
  const raw = settings.value.agentPreferences;
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return {
    textProtocol: value.textProtocol === "openai-completions" || value.textProtocol === "openai-responses" ? value.textProtocol : "provider",
    streamResponses: value.streamResponses !== false,
    autoGenerateMedia: value.autoGenerateMedia !== false,
  };
});
// ACT: 页面在 loadSettings 完成后才挂载，加载标记仅保留在设置初始化与自动保存内部。
let settingsReady = false;
let saveQueue = Promise.resolve();
let applyingSettings = false;
let savedSettings: Record<string, unknown> = {};
const cloneSettings = (value: Record<string, unknown>) => JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
function requireSettings(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("服务未返回有效设置，请确认服务已更新后重试");
  return value as Record<string, unknown>;
}
async function readSettings() {
  const { data } = await axios.get("/api/settings/get", { headers: { "Cache-Control": "no-cache", "x-toonflow-workspace": "1" } });
  if (data.code !== 200) throw new Error("读取设置失败");
  return requireSettings(data.data);
}
// 保留请求发出后继续输入的字段，其他字段采用服务端合并后的值。
function retainChanges(base: unknown, local: unknown, remote: unknown): unknown {
  if (JSON.stringify(base) === JSON.stringify(local)) return remote;
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  if (!object(base) || !object(local) || !object(remote)) return local;
  const result = { ...remote };
  for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
    const value = retainChanges(base[key], local[key], remote[key]);
    if (value === undefined) delete result[key]; else result[key] = value;
  }
  return result;
}

export const settingsStorage = {
  getItem(key: string) {
    const stores = settings.value.stores as Record<string, unknown> | undefined;
    if (stores && Object.hasOwn(stores, key)) return JSON.stringify(stores[key]);
    // ACT: 只迁移当前来源可读取的旧缓存，保留原值；不同端口的 localStorage 不能互读。
    const value = localStorage.getItem(key);
    if (value !== null) settingsStorage.setItem(key, value);
    return value;
  },
  setItem(key: string, value: string) {
    settings.value.stores = { ...(settings.value.stores as Record<string, unknown> | undefined), [key]: JSON.parse(value) };
  },
};

export const uiLanguages = [
  { code: "zh-CN", name: "简体中文" },
  { code: "zh-TW", name: "繁體中文" },
  { code: "en", name: "English" },
] as const;
export const defaultUiSettings = { theme: "light", language: "zh-CN", primaryColor: "#409eff", fontScale: 100, radius: 8, startupAnimation: true };
export const uiSettings = computed(() => {
  const raw = settings.value.ui;
  const ui = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const language = ui.language === "system" ? detectLocale(navigator.languages) : normalizeLocale(ui.language);
  return {
    language: uiLanguages.find(item => item.code === language)?.code ?? "zh-CN",
    // ACT: 顶部外观入口统一控制页面和弹窗，沿用页面未配置时的深色默认值。
    theme: settings.value.homeTheme === "light" ? "light" : "dark",
    primaryColor: typeof ui.primaryColor === "string" && /^#[\da-f]{6}$/i.test(ui.primaryColor) ? ui.primaryColor : defaultUiSettings.primaryColor,
    fontScale: typeof ui.fontScale === "number" && Number.isFinite(ui.fontScale) ? Math.min(150, Math.max(85, ui.fontScale)) : defaultUiSettings.fontScale,
    radius: typeof ui.radius === "number" && Number.isFinite(ui.radius) ? Math.min(16, Math.max(0, ui.radius)) : defaultUiSettings.radius,
    startupAnimation: ui.startupAnimation !== false,
  };
});

export function updateUiSettings(patch: Partial<typeof defaultUiSettings>) {
  const current = settings.value.ui;
  settings.value = { ...settings.value, ui: { ...(current && typeof current === "object" && !Array.isArray(current) ? current : {}), ...patch } };
}

export const canvasAppearance = computed(() => {
  const raw = settings.value.canvasAppearance;
  const appearance = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return {
    grid: appearance.grid === "dots" || appearance.grid === "blank" ? appearance.grid : "lines" as const,
    imageInfo: appearance.imageInfo !== false,
  };
});

export const generalSettings = computed(() => {
  const raw = settings.value.general;
  const general = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const shortcuts = general.canvasShortcuts && typeof general.canvasShortcuts === "object" && !Array.isArray(general.canvasShortcuts)
    ? general.canvasShortcuts as Record<string, unknown> : {};
  const savedBindings = new Map(canvasShortcutFields.flatMap(field => {
    const value = shortcuts[field.id];
    const binding = typeof value === "string" ? normalizeShortcut(value) : undefined;
    return binding !== undefined && isShortcutAllowed(field, binding) ? [[field.id, binding] as const] : [];
  }));
  return {
    canvasCompositingEnabled: general.canvasCompositingEnabled === true,
    canvasShortcuts: Object.fromEntries(canvasShortcutFields.map(field => {
      if (savedBindings.has(field.id)) return [field.id, savedBindings.get(field.id)];
      const binding = defaultCanvasShortcuts[field.id];
      const conflicts = canvasShortcutFields.some(other => other.gesture === field.gesture
        && getShortcutBindings(savedBindings.get(other.id) ?? "").some(value => getShortcutBindings(binding).includes(value)));
      return [field.id, conflicts ? "" : binding];
    })) as CanvasShortcuts,
  };
});

export function updateGeneralSettings(patch: Partial<typeof generalSettings.value>) {
  const current = settings.value.general;
  settings.value = { ...settings.value, general: { ...(current && typeof current === "object" && !Array.isArray(current) ? current : {}), ...patch } };
}

export type CustomProviderModel = { id: string; label: string; contextWindow?: number; maxOutputTokens?: number };
export type CustomProvider = { id: string; label: string; version?: string; apiUrl: string; apiKey?: string; hasApiKey?: boolean; apiKeyUnavailable?: boolean; apiKeyRevision?: string; protocol: string; models: CustomProviderModel[] };
export const customProviders = computed<CustomProvider[]>(() => Array.isArray(settings.value.customProviders)
  ? settings.value.customProviders.filter((item): item is CustomProvider => !!item && typeof item.id === "string" && typeof item.label === "string" && Array.isArray(item.models)
    && item.models.every((model: CustomProviderModel) => !!model && typeof model.id === "string" && typeof model.label === "string"))
  : []);

export const modelChoices = computed(() => {
  const selected = (settings.value.mediaChannelDefaults as { text?: { providerId?: string; modelId?: string } } | undefined)?.text;
  const choices = customProviders.value.filter(provider => provider.hasApiKey && !provider.apiKeyUnavailable).flatMap(provider => provider.models.map(model => ({
  value: JSON.stringify([provider.id, model.id]), providerId: provider.id, modelId: model.id, label: model.label, contextWindow: model.contextWindow,
})));
  return choices.sort((left, right) => Number(right.providerId === selected?.providerId && right.modelId === selected?.modelId) - Number(left.providerId === selected?.providerId && left.modelId === selected?.modelId));
});

export async function loadSettings() {
  if (settingsReady) return;
  const next = await readSettings();
  if (settingsReady) return;
  settings.value = next;
  savedSettings = cloneSettings(next);
  // 等初始化引发的监听执行完，再允许自动保存。
  await nextTick();
  settingsReady = true;
}

export function saveSettings(update?: (current: Record<string, unknown>) => Record<string, unknown> | undefined) {
  scheduleSettingsSave.cancel();
  // ACT: 队列内读取最新配置再计算变更，确认成功后发布；仅协调当前页面的保存。
  const saving = saveQueue.then(async () => {
    const patch = update?.(settings.value);
    if (update && !patch) return false;
    const before = cloneSettings(settings.value);
    const sent = cloneSettings({ ...before, ...patch });
    if (JSON.stringify(sent) === JSON.stringify(savedSettings)) return true;
    let response;
    try { response = await axios.put("/api/settings/save", { settings: sent, base: savedSettings }, { headers: { "x-toonflow-workspace": "1" } }); }
    catch (cause) {
      if (axios.isAxiosError(cause) && cause.response?.status === 409) ElMessage.error(cause.response.data.message);
      throw cause;
    }
    const { data } = response;
    if (data.code !== 200) throw new Error("保存设置失败");
    // 旧服务保存成功只返回 null；重新读取，不能把空响应写进响应式设置。
    const next = data.data == null ? await readSettings() : requireSettings(data.data);
    savedSettings = cloneSettings(next);
    applyingSettings = true;
    try { settings.value = retainChanges(before, settings.value, next) as Record<string, unknown>; }
    finally { applyingSettings = false; }
    invalidateChangedModels(before, next);
    return true;
  });
  saveQueue = saving.then(() => {}, () => {});
  return saving;
}

/** 渠道事务和普通设置共用保存队列，服务端确认后再替换本地快照。 */
export function syncSettings(action: () => Promise<Record<string, unknown>>) {
  const saving = saveQueue.then(async () => {
    const before = cloneSettings(settings.value);
    const next = requireSettings(await action());
    savedSettings = cloneSettings(next);
    applyingSettings = true;
    try { settings.value = retainChanges(before, settings.value, next) as Record<string, unknown>; }
    finally { applyingSettings = false; }
    invalidateChangedModels(before, next);
  });
  saveQueue = saving.then(() => {}, () => {});
  return saving;
}

function invalidateChangedModels(before: Record<string, unknown>, next: Record<string, unknown>) {
  const changed = (key: string) => JSON.stringify(before[key]) !== JSON.stringify(next[key]);
  if (changed("customProviders") || changed("mediaChannelDefaults")) invalidateNodeModels("language");
  if (changed("mediaProviderConfigs") || changed("mediaChannelDefaults")) invalidateNodeModels("media");
}

const scheduleSettingsSave = debounce(() => {
  void saveSettings().catch(() => { ElMessage.error("设置保存失败，请稍后重试"); });
}, 300, { maxWait: 1500 });

export function registerSettingsProtection() {
  function protectSettings(event: BeforeUnloadEvent) {
    if (!settingsReady || JSON.stringify(settings.value) === JSON.stringify(savedSettings)) return;
    scheduleSettingsSave.flush();
    event.preventDefault(); event.returnValue = "";
  }
  window.addEventListener("beforeunload", protectSettings);
  return () => window.removeEventListener("beforeunload", protectSettings);
}

watch(settings, () => {
  if (!settingsReady || applyingSettings) return;
  scheduleSettingsSave();
}, { deep: true, flush: "sync" });
