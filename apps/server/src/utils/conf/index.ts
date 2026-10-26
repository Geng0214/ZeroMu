import conf from "conf";
import { mkdirSync, realpathSync, readFileSync, existsSync } from "@toonflow/file";
import { resolve } from "node:path";
import type { RemoteTeam } from "@/utils/teams";
import type { A2aSettings } from "@/agent/a2a/settings";
import type { desktopUpdateAttempt } from "@/types/desktop";
import { createCredentialStorage } from "./credentialStorage";
import { publicCredentialSettings, restoreCredentialSettings } from "./credentialSettings";

const dataDirectory = process.env.TOONFLOW_DATA_DIR ?? resolve(import.meta.dirname, "../../../../../data");
mkdirSync(dataDirectory, { recursive: true });
const configDirectory = realpathSync(dataDirectory);
process.env.TOONFLOW_DATA_DIR = configDirectory;
const configPath = resolve(configDirectory, "settings.json");
const initialText = existsSync(configPath) ? readFileSync(configPath, "utf8") : "{}";
const credentialStorage = await createCredentialStorage(JSON.parse(initialText));

type configuration = { workspaceDirectory: string; credentialStorageKeyId: string; settings: Record<string, unknown>; toolConfigs: Record<string, Record<string, unknown>>; nodeConfigs: Record<string, Record<string, unknown>>; remoteConnections: Record<string, RemoteTeam>; a2a: A2aSettings; desktopUpdateAttempt: desktopUpdateAttempt };
const config = new conf<configuration>({
  cwd: configDirectory,
  configName: "settings",
  configFileMode: 0o600,
  watch: true,
  serialize: credentialStorage.serialize,
  deserialize: value => credentialStorage.deserialize(value) as configuration,
});

// Conf 原子写入同一个配置快照，迁移不生成明文备份，也不分两次提交密钥和设置。
if (credentialStorage.keyId) config.set("credentialStorageKeyId", credentialStorage.keyId);
if (credentialStorage.serialize(config.store) !== initialText) config.store = config.store;

export function publicSettings(value = config.get("settings", {})) {
  return publicCredentialSettings(value, credentialStorage.revision) as Record<string, unknown>;
}

export function restoreSettingsCredentials(next: Record<string, unknown>, current: Record<string, unknown>, base: Record<string, unknown>) {
  return restoreCredentialSettings(next, current, base, credentialStorage.revision) as Record<string, unknown>;
}

export function removeLegacySettings(settings: Record<string, unknown>) {
  let changed = false;
  // ACT: 只清理已废弃字段，保留其他设置和插件配置。
  for (const [record, key] of [[settings, "agentSystemPrompt"], [settings, "developerConfirmed"], [settings.general, "systemPrompt"], [settings.stores, "toonflow.developer"]] as const) {
    if (record && typeof record === "object" && !Array.isArray(record) && Object.hasOwn(record, key)) {
      Reflect.deleteProperty(record, key);
      changed = true;
    }
  }
  return changed;
}

const settings = config.get("settings", {});
if (removeLegacySettings(settings)) config.set("settings", settings);

// ACT: 仅初始化尚未配置的文本供应商；已有列表（包括用户清空的列表）保持原样。
if (!config.has("settings.customProviders")) {
  config.set("settings.customProviders", []);
}

export default config;
