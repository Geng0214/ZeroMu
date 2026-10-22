import { computed, ref } from "vue";
import { defineStore } from "pinia";
import axios from "axios";
import { builtinPrompts, type PromptLibraryView, type PromptMutation } from "@toonflow/server/promptLibrary";

export const promptLibraryError = (cause: unknown) => axios.isAxiosError<{ message?: string }>(cause) ? cause.response?.data?.message || cause.message : cause instanceof Error ? cause.message : "提示词操作失败";
export const usePromptLibraryStore = defineStore("promptLibrary", () => {
  const library = ref<PromptLibraryView>({ revision: 0, entries: builtinPrompts.map(entry => ({ ...entry, origin: "builtin", favorite: false, archived: false })) });
  const loaded = ref(false); const loading = ref(false); const busy = ref(false); const error = ref("");
  let pending: Promise<PromptLibraryView> | undefined;
  const entries = computed(() => library.value.entries);
  function load() {
    if (pending) return pending;
    loading.value = true; error.value = "";
    pending = axios.get<{ data: PromptLibraryView }>("/api/promptLibrary/get").then(({ data }) => {
      if (!loaded.value || data.data.revision >= library.value.revision) library.value = data.data;
      loaded.value = true; return library.value;
    }).catch(cause => { error.value = promptLibraryError(cause); throw cause; }).finally(() => { pending = undefined; loading.value = false; });
    return pending;
  }
  async function update(operation: PromptMutation, expectedRevision = library.value.revision) {
    if (!loaded.value) throw new Error("个人提示词库尚未读取，先刷新后再保存");
    if (busy.value) throw new Error("提示词正在保存，请稍后操作");
    busy.value = true;
    try {
      const { data } = await axios.post<{ data: { library: PromptLibraryView; entryId: string } }>("/api/promptLibrary/update", { operation, expectedRevision });
      if (data.data.library.revision >= library.value.revision) library.value = data.data.library;
      return data.data;
    } finally { busy.value = false; }
  }
  return { library, entries, loaded, loading, busy, error, load, update };
});
