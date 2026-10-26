import { defineStore } from "pinia";
import { ref } from "vue";
import axios from "axios";
import type { AgentAttachment } from "@/components/agent/types";
import { usePromptLibraryStore } from "./promptLibrary";
import { useProductionTemplateLibraryStore } from "./productionTemplates";
import { useTaskCenterStore } from "./taskCenter";

export type Project = { directory: string; name: string; lastOpenedAt: number; projectId?: string; layout?: "organized" | "legacy"; canvasCount?: number; updatedAt?: number };
type WorkspaceRoot = { directory: string; name: string; workspaceId: string };
type WorkspaceState = { workspace: WorkspaceRoot | null; projects: Project[]; project: Project | null; recoverableProjects?: Project[]; issues: string[] };
export type TrashEntry = { name: string; projectName: string; directory: string; deletedAt: number };
type TrashState = { directory: string; entries: TrashEntry[] };
const headers = { "x-toonflow-workspace": "1" };

export const useWorkspaceStore = defineStore("workspace", () => {
  const workspaceRoot = ref<WorkspaceRoot | null>(null);
  const project = ref<Project | null>(null);
  const projectList = ref<Project[]>([]);
  const legacyProjects = ref<Project[]>([]);
  const recoverableProjects = ref<Project[]>([]);
  const issues = ref<string[]>([]);
  const startupError = ref("");
  const lastCanvas = ref<{ directory: string; canvasId: string }>();
  const trashEntries = ref<TrashEntry[]>([]);
  const trashDirectory = ref("");
  const pendingAgentMessage = ref<{ directory: string; prompt: string; attachments?: AgentAttachment[]; model: string; reasoningEffort: string } | null>(null);
  let initializing: Promise<void> | undefined;

  function applyState(state: WorkspaceState) {
    if (workspaceRoot.value?.directory !== state.workspace?.directory || workspaceRoot.value?.workspaceId !== state.workspace?.workspaceId) { usePromptLibraryStore().reset(); useProductionTemplateLibraryStore().reset(); }
    workspaceRoot.value = state.workspace;
    projectList.value = state.projects;
    legacyProjects.value = [];
    recoverableProjects.value = state.recoverableProjects ?? [];
    project.value = state.project;
    issues.value = state.issues;
    startupError.value = "";
    pendingAgentMessage.value = null;
    useTaskCenterStore().studioDirectory = state.project?.directory ?? "";
  }
  async function refresh() {
    const { data } = await axios.get<{ data: WorkspaceState }>("/api/workspace/state", { headers });
    applyState(data.data);
  }
  function initialize() {
    if (!initializing) initializing = (async () => {
      // 旧版本记录过的项目目录仍可直接作为独立项目打开。
      legacyProjects.value = [...new Map([...legacyProjects.value, ...projectList.value.filter(item => !item.projectId)].map(item => [item.directory, item])).values()];
      try { await refresh(); }
      catch (cause) {
        workspaceRoot.value = null; project.value = null; projectList.value = [];
        startupError.value = axios.isAxiosError(cause) ? cause.response?.data?.message || cause.message : String(cause);
      }
    })();
    return initializing;
  }
  async function selectWorkspace(directory: string) {
    const { data } = await axios.post<{ data: WorkspaceState }>("/api/workspace/select", { directory }, { headers });
    applyState(data.data);
    initializing = Promise.resolve();
  }
  async function openProject(path: string, previousDirectory = path, signal?: AbortSignal) {
    await initialize();
    const { data } = await axios.post<{ data: Project }>("/api/workspace/openProject", { directory: path }, { headers, signal });
    signal?.throwIfAborted();
    const previous = projectList.value.find(item => item.directory === previousDirectory);
    const opened = previous ? { ...data.data, name: previous.name } : data.data;
    project.value = opened;
    projectList.value = [opened, ...projectList.value.filter(item => item.directory !== previousDirectory && item.directory !== data.data.directory)];
    pendingAgentMessage.value = null;
    useTaskCenterStore().studioDirectory = opened.directory;
    return opened;
  }
  async function createProject(directory: string) {
    await initialize();
    const { data } = await axios.post<{ data: Project }>("/api/workspace/createProject", { directory }, { headers });
    project.value = data.data;
    projectList.value = [data.data, ...projectList.value.filter(item => item.directory !== data.data.directory)];
    pendingAgentMessage.value = null;
    useTaskCenterStore().studioDirectory = data.data.directory;
    return data.data;
  }
  async function importProject(directory: string) {
    return openProject(directory);
  }
  async function renameProject(path: string, name: string) {
    const target = projectList.value.find(item => item.directory === path) ?? recoverableProjects.value.find(item => item.directory === path);
    if (!target) throw new Error("项目已不在列表中，请刷新后重试");
    if (target.projectId) {
      const { data } = await axios.post<{ data: WorkspaceState }>("/api/workspace/renameProject", { directory: path, projectId: target.projectId, name: name.trim() }, { headers });
      const renamed = data.data.projects.find(item => item.projectId === target.projectId)
        ?? data.data.recoverableProjects?.find(item => item.projectId === target.projectId);
      if (renamed && lastCanvas.value?.directory === target.directory) lastCanvas.value = { ...lastCanvas.value, directory: renamed.directory };
      applyState(data.data);
      return;
    }
    const renamed = { ...target, name: name.trim() };
    projectList.value = [renamed, ...projectList.value.filter(item => item.directory !== path)];
    recoverableProjects.value = recoverableProjects.value.filter(item => item.directory !== path);
    if (project.value?.directory === path) project.value = renamed;
  }
  async function deleteProject(path: string, projectId?: string) {
    const { data } = await axios.post<{ data: WorkspaceState }>("/api/workspace/deleteProject", { directory: path, ...(projectId ? { projectId } : {}) }, { headers });
    const lastCanvasDeleted = lastCanvas.value?.directory === path;
    applyState(data.data);
    if (lastCanvasDeleted) lastCanvas.value = undefined;
    await refreshTrash().catch(() => undefined);
  }
  // 删除项目会移入工作空间内的回收目录，这里提供列表、还原与彻底删除。
  async function refreshTrash() {
    const { data } = await axios.get<{ data: TrashState }>("/api/workspace/trash", { headers });
    trashDirectory.value = data.data.directory;
    trashEntries.value = data.data.entries;
  }
  async function restoreTrash(name: string) {
    const { data } = await axios.post<{ data: WorkspaceState }>("/api/workspace/restoreTrash", { name }, { headers });
    applyState(data.data);
    await refreshTrash();
  }
  async function removeTrash(name: string) {
    const { data } = await axios.post<{ data: TrashState }>("/api/workspace/removeTrash", { name }, { headers });
    trashEntries.value = data.data.entries;
  }
  return { workspaceRoot, project, projectList, legacyProjects, recoverableProjects, issues, startupError, lastCanvas, pendingAgentMessage, trashEntries, trashDirectory, initialize, refresh, selectWorkspace, openProject, createProject, importProject, renameProject, deleteProject, refreshTrash, restoreTrash, removeTrash };
}, { persist: { key: "toonflow.projectList", pick: ["project", "projectList", "legacyProjects", "lastCanvas"] } });
