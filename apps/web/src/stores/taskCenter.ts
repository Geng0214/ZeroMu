import { defineStore } from "pinia";
import { ref } from "vue";

export const useTaskCenterStore = defineStore("taskCenter", () => {
  const visible = ref(false);
  const runningCount = ref(0);
  const attentionCount = ref(0);
  const summaryError = ref("");
  const studioDirectory = ref("");
  const costVisible = ref(false);
  const focusTask = ref<{ directory: string; id: string }>();
  const location = ref<{ directory: string; canvasId: string; nodeId?: string; token: string }>();
  function open(task?: { directory: string; id: string }) {
    focusTask.value = task;
    visible.value = true;
  }
  function openCosts(directory?: string) { if (directory) studioDirectory.value = directory; costVisible.value = true; open(); }
  return { visible, runningCount, attentionCount, summaryError, studioDirectory, costVisible, focusTask, location, open, openCosts };
}, { persist: { key: "toonflow.taskCenter", pick: ["studioDirectory"] } });
