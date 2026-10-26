import { computed, ref } from "vue";
import { defineStore } from "pinia";
import axios from "axios";
import type { ProductionTemplateLibraryView, ProductionTemplateMutation } from "@toonflow/server/productionTemplates";

export const productionTemplateError = (cause: unknown) => axios.isAxiosError<{ message?: string }>(cause) ? cause.response?.data?.message || cause.message : cause instanceof Error ? cause.message : "制作模板操作失败";
export const useProductionTemplateLibraryStore = defineStore("productionTemplates", () => {
  const library = ref<ProductionTemplateLibraryView>({ revision: 0, entries: [] });
  const loaded = ref(false); const loading = ref(false); const busy = ref(false); const error = ref("");
  let pending: Promise<ProductionTemplateLibraryView> | undefined;
  let epoch = 0;
  function reset() { epoch++; pending = undefined; library.value = { revision: 0, entries: [] }; loaded.value = false; loading.value = false; busy.value = false; error.value = ""; }
  const entries = computed(() => library.value.entries);
  function load() {
    if (pending) return pending;
    const requestEpoch = epoch;
    loading.value = true; error.value = "";
    pending = axios.get<{ data: ProductionTemplateLibraryView }>("/api/productionTemplates/get").then(({ data }) => {
      if (requestEpoch !== epoch) return library.value;
      if (!loaded.value || data.data.revision >= library.value.revision) library.value = data.data;
      loaded.value = true; return library.value;
    }).catch(cause => { if (requestEpoch === epoch) error.value = productionTemplateError(cause); throw cause; }).finally(() => { if (requestEpoch === epoch) { pending = undefined; loading.value = false; } });
    return pending;
  }
  async function update(operation: ProductionTemplateMutation, expectedRevision = library.value.revision) {
    if (!loaded.value) throw new Error("个人制作模板库尚未读取，先刷新后再保存");
    if (busy.value) throw new Error("制作模板正在保存，请稍后操作");
    const requestEpoch = epoch;
    busy.value = true;
    try {
      const { data } = await axios.post<{ data: { library: ProductionTemplateLibraryView; entryId: string } }>("/api/productionTemplates/update", { operation, expectedRevision });
      if (requestEpoch === epoch && data.data.library.revision >= library.value.revision) library.value = data.data.library;
      return data.data;
    } finally { if (requestEpoch === epoch) busy.value = false; }
  }
  return { library, entries, loaded, loading, busy, error, load, update, reset };
});
