import { computed, onScopeDispose, ref, watch } from "vue";
import { defineStore } from "pinia";
import axios from "axios";
import type { ProjectRecord, ProductionOperation } from "@toonflow/server/production";
import { useWorkspaceStore } from "./workspace";

export const productionError = (cause: unknown) => axios.isAxiosError<{ message?: string }>(cause)
  ? cause.response?.data?.message || cause.message : cause instanceof Error ? cause.message : "制作记录操作失败";

type RecoverableVersion = { versionId: string; assetId?: string; status: "ready" | "incomplete" };
const headers = { "x-toonflow-workspace": "1" };

export const useProductionStore = defineStore("production", () => {
  const workspace = useWorkspaceStore();
  const directory = computed(() => workspace.project?.directory || "");
  const project = ref<ProjectRecord | null>(null);
  const recoverableVersions = ref<RecoverableVersion[]>([]);
  const visible = ref(false);
  const fullScreenEdit = ref(false);
  const panel = ref<"edit" | "batches" | "snapshots">("edit");
  const loading = ref(false);
  const error = ref("");
  const batchDrafts = new Map<string, string>();
  const pendingDirectories = ref(new Set<string>());
  const projectionCounts = ref(new Map<string, number>());
  const projectionErrors = ref<Record<string, string>>({});
  const busy = computed(() => pendingDirectories.value.has(directory.value) || !!projectionCounts.value.get(directory.value));
  let epoch = 0;
  let reader: AbortController | undefined;

  function requireDirectory(path = directory.value) {
    if (!path || path !== directory.value) throw new Error("项目已切换，请重新打开制作面板");
    return path;
  }

  async function load() {
    if (busy.value) return;
    reader?.abort();
    const path = directory.value;
    if (!path) return;
    const current = reader = new AbortController();
    const requestEpoch = ++epoch;
    loading.value = true;
    try {
      const { data } = await axios.get<{ data: { project: ProjectRecord | null; recoverableVersions: RecoverableVersion[] } }>("/api/production/get", { params: { directory: path }, headers, signal: current.signal });
      if (current.signal.aborted || requestEpoch !== epoch || directory.value !== path) return;
      project.value = data.data.project;
      recoverableVersions.value = data.data.recoverableVersions;
      error.value = "";
    } catch (cause) {
      if (!current.signal.aborted && requestEpoch === epoch) error.value = productionError(cause);
    } finally { if (requestEpoch === epoch) loading.value = false; }
  }

  async function write(path: string, endpoint: "create" | "update", body: Record<string, unknown>) {
    requireDirectory(path);
    if (pendingDirectories.value.has(path)) throw new Error("制作记录正在保存，请稍后重试");
    pendingDirectories.value.add(path);
    reader?.abort();
    const requestEpoch = ++epoch;
    loading.value = false;
    try {
      const { data } = await axios.post<{ data: ProjectRecord | { project: ProjectRecord; resultId?: string } }>(`/api/production/${endpoint}`, { directory: path, ...body }, { headers });
      const result = "project" in data.data ? data.data : { project: data.data };
      if (requestEpoch === epoch && directory.value === path) { project.value = result.project; error.value = ""; }
      return result;
    } catch (cause) {
      if (requestEpoch === epoch && directory.value === path) error.value = productionError(cause);
      throw cause;
    } finally { pendingDirectories.value.delete(path); }
  }

  function create() { return write(requireDirectory(), "create", { name: workspace.project?.name }); }
  function update(operation: ProductionOperation, path = directory.value, expectedRevision = project.value?.revision) {
    requireDirectory(path);
    if (!project.value) throw new Error("请先建立制作记录");
    return write(path, "update", { expectedRevision, operation });
  }
  function open(value: typeof panel.value) { fullScreenEdit.value = false; panel.value = value; visible.value = true; void load(); }
  function openSmartEdit() { panel.value = "edit"; fullScreenEdit.value = true; visible.value = true; void load(); }
  function startProjection(path: string) {
    requireDirectory(path);
    projectionCounts.value.set(path, (projectionCounts.value.get(path) || 0) + 1);
    let released = false;
    return () => { if (released) return; released = true; const count = (projectionCounts.value.get(path) || 1) - 1; if (count) projectionCounts.value.set(path, count); else projectionCounts.value.delete(path); };
  }

  watch(visible, value => { if (!value) fullScreenEdit.value = false; });
  onScopeDispose(() => reader?.abort());

  watch(directory, () => {
    ++epoch;
    reader?.abort();
    project.value = null;
    projectionErrors.value = {};
    recoverableVersions.value = [];
    error.value = "";
    loading.value = false;
    void load();
  }, { immediate: true });
  return { directory, project, recoverableVersions, visible, fullScreenEdit, panel, loading, error, busy, projectionCounts, projectionErrors, startProjection, batchDrafts, load, create, update, open, openSmartEdit, requireDirectory };
});
