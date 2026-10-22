<template>
  <div class="extensions">
    <nav class="extensionTabs" aria-label="扩展分类">
      <button v-for="tab in tabs" :key="tab.id" type="button" :aria-pressed="activeTab === tab.id" @click="activeTab = tab.id">{{ tab.label }}</button>
    </nav>
    <ffmpeg v-if="activeTab === 'ffmpeg'" :visible />
    <mcp v-else-if="activeTab === 'mcp'" />
    <template v-else>
      <div class="extensionToolbar">
        <el-input v-model="searchQuery" placeholder="搜索本地扩展" aria-label="搜索本地扩展" clearable />
        <el-button :icon="IconRefresh" :loading="loading" aria-label="刷新本地扩展" @click="refreshInstalled">刷新</el-button>
        <el-button :icon="IconUpload" :loading="installing" @click="pluginFileInput?.click()">安装本地扩展</el-button>
        <input ref="pluginFileInput" type="file" accept=".umd.js,.tool.js,.zip,.md,.tar,.tar.gz,.tgz" hidden @change="installFile" />
      </div>
      <p class="extensionHint">管理本机的节点、工具与技能。扩展可执行代码，请仅安装可信来源的文件。</p>
      <div class="typeFilters" role="group" aria-label="扩展类型">
        <button type="button" :aria-pressed="selectedType === 'all'" @click="selectedType = 'all'">全部</button>
        <button v-for="(category, type) in pluginTypes" :key="type" type="button" :aria-pressed="selectedType === type" @click="selectedType = type">{{ category.label }}</button>
      </div>
      <el-alert v-for="message in visibleLoadErrors" :key="message" :title="message" type="error" :closable="false" showIcon />
      <div class="pluginList" aria-label="本地扩展列表" :aria-busy="loading">
        <article v-for="plugin in visiblePlugins" :key="plugin.key" class="pluginRow" :aria-label="plugin.displayName">
          <div class="pluginInfo">
            <h3>{{ plugin.displayName }} <el-tag size="small" type="info">{{ pluginTypes[plugin.type].label }}</el-tag></h3>
            <p v-if="plugin.description">{{ plugin.description }}</p>
            <span class="pluginMeta">{{ plugin.author }}{{ plugin.version ? ' · v' + plugin.version : '' }}</span>
            <el-text v-if="plugin.loadError" type="danger" size="small">{{ plugin.loadError }}</el-text>
          </div>
          <div class="pluginActions">
            <el-switch v-if="canEditPlugin(plugin) && plugin.type !== 'skill'" :modelValue="plugin.enabled !== false" :loading="pendingPlugins.has(plugin.key)" :disabled="loading || exportingPlugins.has(plugin.key)" :aria-label="'启用 ' + plugin.displayName" @change="updatePlugin(plugin, 'setEnabled', $event === true)" />
            <el-button v-if="canViewPlugin(plugin)" size="small" :disabled="pendingPlugins.has(plugin.key)" :aria-label="'查看 ' + plugin.displayName" @click="openPlugin(plugin)">{{ plugin.type === 'skill' ? '编辑' : '说明' }}</el-button>
            <el-badge v-if="plugin.configRules?.length && canConfigurePlugin(plugin)" isDot :hidden="!hasMissingConfig(plugin)">
              <el-button size="small" :disabled="loading || pendingPlugins.has(plugin.key)" :aria-label="'配置 ' + plugin.displayName" @click="selectedConfigPlugin = plugin; configVisible = true">配置</el-button>
            </el-badge>
            <el-button size="small" :loading="exportingPlugins.has(plugin.key)" :disabled="loading || pendingPlugins.has(plugin.key) || (plugin.type === 'tool' && !canManageTools)" :aria-label="'导出 ' + plugin.displayName" @click="exportPlugin(plugin)">导出</el-button>
            <el-popconfirm v-if="canEditPlugin(plugin)" :title="'确定卸载“' + plugin.displayName + '”及其附属文件吗？'" confirmButtonText="卸载" cancelButtonText="取消" @confirm="updatePlugin(plugin, 'uninstall')">
              <template #reference><el-button size="small" :disabled="loading || pendingPlugins.has(plugin.key) || exportingPlugins.has(plugin.key)" :aria-label="'卸载 ' + plugin.displayName">卸载</el-button></template>
            </el-popconfirm>
          </div>
        </article>
      </div>
      <p v-if="loading" class="listStatus" role="status">正在读取本地扩展…</p>
      <p v-else-if="!visiblePlugins.length && !visibleLoadErrors.length" class="listStatus">暂无符合条件的本地扩展</p>
      <pluginConfigDialog v-if="selectedConfigPlugin" v-model="configVisible" :plugin="selectedConfigPlugin" :canManage="canConfigurePlugin(selectedConfigPlugin)" />
      <skillEditorDialog v-if="selectedSkill" :key="selectedSkill.key" :skill="selectedSkill" @saved="refreshInstalled" @closed="selectedSkill = undefined" />
      <el-dialog v-if="selectedPlugin" v-model="detailsVisible" :title="selectedPlugin.displayName" width="min(800px, calc(100vw - 32px))" alignCenter appendToBody>
        <messageMarkdown :content="selectedPlugin.readme || ''" />
      </el-dialog>
    </template>
  </div>
</template>

<script setup lang="ts">
import { translate } from "@toonflow/i18n/vue";
import axios from "axios";
import { computed, defineAsyncComponent, markRaw, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { IconRefresh, IconUpload } from "@tabler/icons-vue";
import { ElMessage } from "element-plus";
import saveFile from "@/lib/saveFile";
import pluginConfigDialog from "./pluginConfigDialog.vue";
import skillEditorDialog from "./skillEditorDialog.vue";
import ffmpeg from "./ffmpeg.vue";
import mcp from "../mcp/index.vue";
import type { Plugin, PluginType } from "./types";
import { installPluginFile } from "../../installPluginFile";
const { visible = true } = defineProps<{ visible?: boolean }>();
const pluginTypes = { node: {label: "节点", path: "nodes"}, skill: {label: "技能", path: "skills"}, tool: {label: "工具", path: "tools"} };
const tabs = [{ id: "installed", label: "本地扩展" }, { id: "ffmpeg", label: "媒体组件" }, { id: "mcp", label: "外部连接" }];
const activeTab = ref("installed");
const selectedType = ref<PluginType | "all">("all");
const searchQuery = ref("");
const installedPlugins = ref<Plugin[]>([]);
const loading = ref(false);
const loadErrors = ref<Partial<Record<PluginType, string>>>({});
const canManageTools = ref(false);
const pendingPlugins = ref(new Set<string>());
const exportingPlugins = ref(new Set<string>());
const pluginFileInput = ref<HTMLInputElement>();
const installing = ref(false);
const refreshKey = ref(0);
const refreshInstalled = () => { refreshKey.value++; };
onMounted(() => window.addEventListener("toonflow:plugin-installed", refreshInstalled));
onBeforeUnmount(() => window.removeEventListener("toonflow:plugin-installed", refreshInstalled));
const selectedConfigPlugin = ref<Plugin>();
const configVisible = ref(false);
const selectedPlugin = ref<Plugin>();
const selectedSkill = ref<Plugin>();
const detailsVisible = ref(false);
const messageMarkdown = defineAsyncComponent(() => import("@/components/messageMarkdown.vue"));
const requestHeaders = { "x-toonflow-workspace": "1" };
const visibleLoadErrors = computed(() => Object.entries(loadErrors.value).filter(([type]) => selectedType.value === "all" || type === selectedType.value).map(([, message]) => message));
const visiblePlugins = computed(() => installedPlugins.value.filter(plugin => (selectedType.value === "all" || plugin.type === selectedType.value) && [plugin.name, plugin.displayName, plugin.author, plugin.description].some(value => value?.toLowerCase().includes(searchQuery.value.trim().toLowerCase()))));
function canViewPlugin(plugin: Plugin) { return plugin.type === "skill" || !!plugin.readme?.trim(); }
function openPlugin(plugin: Plugin) {
  if (loading.value || pendingPlugins.value.has(plugin.key)) return;
  if (plugin.type === "skill") { selectedSkill.value = plugin; return; }
  selectedPlugin.value = plugin;
  detailsVisible.value = true;
}
function canConfigurePlugin(plugin: Plugin) { return plugin.type === "node" ? plugin.canConfigure === true : plugin.type === "tool" && canManageTools.value; }
function hasMissingConfig(plugin: Plugin) {
  if (!canConfigurePlugin(plugin)) return false;
  return (plugin.configRules ?? []).some((rule) => {
    const required = rule.required === true || (Array.isArray(rule.validate) && rule.validate.some((validation) =>
      validation && typeof validation === "object" && "required" in validation && validation.required === true));
    if (!required || typeof rule.field !== "string") return false;
    const config = plugin.config ?? {};
    const value = Object.hasOwn(config, rule.field) ? config[rule.field] : rule.value;
    return value == null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && !value.length);
  });
}

watch(
  () => [visible, activeTab.value, refreshKey.value],
  async (_value, _previous, onCleanup) => {
    if (!visible || activeTab.value !== "installed") return;
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    loading.value = true;
    loadErrors.value = {};
    canManageTools.value = false;
    installedPlugins.value = [];
    const results = await Promise.all(
      (Object.keys(pluginTypes) as PluginType[]).map(async (type) => {
        const category = pluginTypes[type];
        if (!category.path) return [];
        try {
          const { data } = await axios.get(`/api/${category.path}/get`, {
            signal: controller.signal,
            headers: { ...requestHeaders, "Cache-Control": "no-cache" },
          });
          const items = type === "tool" ? data.data?.tools : data.data;
          if (data.code !== 200 || !Array.isArray(items) || items.some((item) => !item || typeof item.name !== "string"))
            throw new Error(`${category.label}列表格式错误`);
          if (controller.signal.aborted) return [];
          if (type === "tool") canManageTools.value = data.data.canManage === true;
          return items.map((item) => ({
            ...item,
            type,
            key: `${type}:${item.name}`,
            displayName: item.displayName || item.name,
            configRules: markRaw(item.configRules ?? []),
          } as Plugin));
        } catch (error) {
          if (!controller.signal.aborted) loadErrors.value[type] = errorMessage(error, `加载${category.label}失败，请重新打开列表重试`);
          return [];
        }
      })
    );
    if (controller.signal.aborted) return;
    installedPlugins.value = results.flat();
    loading.value = false;
  },
  { immediate: true }
);

function errorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) return typeof error.response?.data?.message === "string" ? error.response.data.message : fallback;
  return error instanceof Error ? error.message : fallback;
}

function canEditPlugin(plugin: Plugin) { return plugin.author !== "Toonflow" && (plugin.type !== "tool" || canManageTools.value); }
async function installFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || installing.value) return;
  installing.value = true;
  try {
    if (/\.agent\.zip$/i.test(file.name)) throw new Error("当前版本不支持 Agent 扩展");
    const type = /\.umd\.js$/i.test(file.name) ? "node" : /\.tool\.js$/i.test(file.name) ? "tool" : /\.(zip|md|tar|tar\.gz|tgz)$/i.test(file.name) ? "skill" : undefined;
    if (!type) throw new Error("请选择节点、工具或技能文件");
    await installPluginFile(type, file);
    ElMessage.success("本地扩展已安装");
  } catch (error) { ElMessage.error(errorMessage(error, "安装失败，请重试")); }
  finally { installing.value = false; }
}
async function exportPlugin(plugin: Plugin) {
  if (
    activeTab.value !== "installed" ||
    exportingPlugins.value.has(plugin.key) ||
    pendingPlugins.value.has(plugin.key) ||
    loading.value ||
    (plugin.type === "tool" && !canManageTools.value)
  )
    return;
  exportingPlugins.value.add(plugin.key);
  try {
    const fileName = `${plugin.name}.${plugin.type === "node" ? "umd.js" : plugin.type === "tool" ? "tool.js" : "zip"}`;
    await saveFile(
      () =>
        axios
          .get<Blob>("/api/plugins/export", { params: { type: plugin.type, name: plugin.name }, responseType: "blob", headers: requestHeaders })
          .then(({ data }) => data),
      fileName
    );
  } catch (error) {
    let message = errorMessage(error, "导出插件失败，请重试");
    if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
      const data = await error.response.data
        .text()
        .then(JSON.parse)
        .catch(() => null);
      if (typeof data?.message === "string") message = data.message;
    }
    ElMessage.error(message);
  } finally {
    exportingPlugins.value.delete(plugin.key);
  }
}

async function updatePlugin(plugin: Plugin, action: "setEnabled" | "uninstall", enabled?: boolean) {
  if (
    !canEditPlugin(plugin) ||
    loading.value ||
    pendingPlugins.value.has(plugin.key) ||
    exportingPlugins.value.has(plugin.key) ||
    (plugin.type === "skill" && action !== "uninstall")
  )
    return;
  pendingPlugins.value.add(plugin.key);
  const actionLabel = action === "uninstall" ? translate("卸载插件") : translate("更新插件状态");
  try {
    const url = `/api/${pluginTypes[plugin.type].path}/${action}`;
    const { data } =
      action === "uninstall"
        ? await axios.delete(url, { data: { name: plugin.name }, headers: requestHeaders })
        : await axios.put(url, { name: plugin.name, enabled }, { headers: requestHeaders });
    if (data.code !== 200) throw new Error(data.message || `${actionLabel}失败`);
    if (action === "uninstall") {
      installedPlugins.value = installedPlugins.value.filter((item) => item.key !== plugin.key);
      if (selectedSkill.value?.key === plugin.key) selectedSkill.value = undefined;
      if (selectedConfigPlugin.value?.key === plugin.key) {
        configVisible.value = false;
        selectedConfigPlugin.value = undefined;
      }
      if (selectedPlugin.value?.key === plugin.key) {
        detailsVisible.value = false;
        selectedPlugin.value = undefined;
      }
      ElMessage.success("插件已卸载");
    } else plugin.enabled = enabled;
    if (plugin.type === "node")
      window.dispatchEvent(new CustomEvent("toonflow:plugin-installed", { detail: { type: plugin.type, name: plugin.name } }));
  } catch (error) {
    ElMessage.error(errorMessage(error, `${actionLabel}失败，请重试`));
  } finally {
    pendingPlugins.value.delete(plugin.key);
  }
}
</script>

<style lang="scss" scoped>
.extensions {
  min-width: 0;
  .extensionTabs, .typeFilters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px;
    button { padding: 8px 12px; border: 0; border-radius: var(--ui-radius-small); background: transparent; color: var(--el-text-color-regular); font: inherit; cursor: pointer;
      &[aria-pressed="true"] { color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
      &:hover { background: var(--el-fill-color-light); }
      &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
    }
  }
  .extensionToolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; .el-input { flex: 1 1 180px; } .el-button + .el-button { margin-left: 0; } }
  .extensionHint, .listStatus { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.7; margin: 12px 0 20px; }
  .typeFilters { gap: 4px; margin-bottom: 0; font-size: 12px; }
  .pluginRow { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 18px 0; border-bottom: 1px solid var(--el-border-color-lighter);
    .pluginInfo { min-width: 0; h3 { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; font-size: 14px; font-weight: 600; overflow-wrap: anywhere; } p { font-size: 12px; line-height: 1.7; margin: 8px 0; color: var(--el-text-color-regular); } .pluginMeta { font-size: 12px; color: var(--el-text-color-secondary); overflow-wrap: anywhere; } }
    .pluginActions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 8px; flex-shrink: 0; .el-button + .el-button { margin-left: 0; } }
  }
  @media (max-width: 760px) { .pluginRow { align-items: flex-start; flex-direction: column; .pluginActions { justify-content: flex-start; } } }
}
</style>
