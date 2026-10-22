<template>
  <section class="referenceUpdatePanel" aria-label="素材引用影响">
    <header><h4>使用位置与更新范围</h4><el-button size="small" text :loading="loading" :disabled="saving || store.busy" @click="refresh">刷新范围</el-button></header>
    <template v-if="preview">
      <p class="referenceHint">选择把当前查看的 {{ targetLabel }} 用于哪些镜头。会更新所选镜头中此素材的全部参考项，保留用途与顺序；画布连接和生成输入需在下次执行前重新核对。旧候选、采用、已确认批次和任务保持原依据，重生成另行核对范围与预算。</p>
      <p v-if="stale" class="referenceError" role="status">制作记录已更新，勾选仍按原范围保留。请刷新范围，核对后再提交。</p>
      <form @submit.prevent="save">
        <fieldset :disabled="saving || store.busy || loading">
          <legend>当前镜头参考</legend>
          <p v-if="!preview.referenceShots.length" class="referenceHint">当前镜头未直接引用此素材；历史使用位置仍可查看。</p>
          <div class="selectionTools"><span role="status">已选 {{ selected.length }} 个 · {{ eligible.length }} 个可更新</span><el-button size="small" text :disabled="!eligible.length || stale" @click="selected = eligible.map(shot => shot.shotId)">全选可更新镜头</el-button><el-button size="small" text :disabled="!selected.length" @click="selected = []">清空选择</el-button></div>
          <ul class="referenceShots"><li v-for="shot in preview.referenceShots" :key="shot.shotId"><label><input v-model="selected" type="checkbox" :value="shot.shotId" :disabled="stale || !eligible.some(item => item.shotId === shot.shotId)" :aria-label="`选择更新镜头 ${shot.title}`" /><span>{{ shot.title }}{{ shot.archived ? ' · 已归档' : '' }}</span></label><button type="button" class="locationLink" @click="emit('locate', shot.shotId)">查看镜头</button><p><span v-for="(reference, index) in shot.references" :key="index">{{ reference.role || '参考' }}：v{{ versionNumber(reference.versionId) }}{{ index < shot.references.length - 1 ? '；' : '' }}</span> → {{ targetLabel }}</p><p v-if="shot.adoptedCandidateId" class="referenceHint">已有采用保留{{ shot.adoptedReferenceState === 'changed' ? ' · 候选参考记录与当前镜头不同，需核对' : shot.adoptedReferenceState === 'unknown' ? ' · 旧候选未记录镜头参考快照' : '' }}</p></li></ul>
          <el-button type="primary" nativeType="submit" :loading="saving" :disabled="!selected.length || !targetVersion || stale">更新 {{ selected.length }} 个镜头参考</el-button>
        </fieldset>
      </form>
      <details class="historicalUses"><summary>保留的历史使用 · {{ preview.candidateUses.length }} 个候选、{{ preview.draftIds.length }} 份草案、{{ preview.exportIds.length }} 次导出</summary><ul><li v-for="candidate in preview.candidateUses" :key="candidate.candidateId"><button type="button" class="locationLink" @click="emit('locate', candidate.shotId)">{{ candidate.title }}</button> · 候选 {{ candidateNumber(candidate.shotId, candidate.candidateId) }}{{ candidate.adopted ? ' · 已采用' : '' }}</li></ul><p class="referenceHint">更新当前参考不会改写这些历史依据或自动重做。归档镜头继续保留，不能在此更新。</p></details>
      <ul v-if="otherShots.length" class="referenceHint"><li v-for="shot in otherShots" :key="shot.shotId"><button type="button" class="locationLink" @click="emit('locate', shot.shotId)">{{ shot.title }}</button> · 机位或历史使用{{ shot.archived ? ' · 已归档' : '' }}</li></ul>
    </template>
    <p v-else class="referenceHint">正在读取素材使用位置…</p>
    <p v-if="error" ref="errorBox" class="referenceError" role="alert" tabindex="-1">{{ error }}</p>
    <p v-if="saved" class="referenceHint" role="status">{{ saved }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { AssetImpact } from "@toonflow/server/production/references";
import { productionError, useProductionStore } from "@/stores/production";
const props = defineProps<{ directory: string; assetId: string; versionId: string; impact?: AssetImpact; loading: boolean }>();
const emit = defineEmits<{ refresh: []; locate: [shotId: string] }>();
const store = useProductionStore();
const preview = ref<AssetImpact>(); const selected = ref<string[]>([]); const saving = ref(false); const error = ref(""); const saved = ref(""); const errorBox = ref<HTMLElement>();
let refreshRequested = false;
const targetVersion = computed(() => store.project?.assetVersions.find(version => version.versionId === props.versionId && version.assetId === props.assetId));
const targetLabel = computed(() => `v${versionNumber(props.versionId)}${targetVersion.value?.description ? ` · ${targetVersion.value.description}` : ''}`);
const stale = computed(() => !!preview.value && (preview.value.revision !== props.impact?.revision || preview.value.revision !== store.project?.revision));
const eligible = computed(() => preview.value?.referenceShots.filter(shot => !shot.archived && shot.references.some(reference => reference.versionId !== props.versionId)) ?? []);
const otherShots = computed(() => preview.value?.shots.filter(shot => !preview.value?.referenceShots.some(item => item.shotId === shot.shotId)) ?? []);
function versionNumber(id: string) { const asset = store.project?.assets.find(asset => asset.assetId === props.assetId); return (asset?.versionIds.indexOf(id) ?? -1) + 1 || "未知"; }
function candidateNumber(shotId: string, id: string) { return (store.project?.shots.find(shot => shot.shotId === shotId)?.candidateIds.indexOf(id) ?? -1) + 1 || "未知"; }
function refresh() { refreshRequested = true; error.value = ""; saved.value = ""; emit("refresh"); }
watch([() => props.impact, () => selected.value.length], ([value]) => {
  if (!value || value.asset.assetId !== props.assetId) return;
  if (!preview.value || !selected.value.length || refreshRequested) {
    preview.value = value; selected.value = selected.value.filter(id => eligible.value.some(shot => shot.shotId === id)); refreshRequested = false;
  }
}, { immediate: true });
watch(() => props.versionId, () => { selected.value = selected.value.filter(id => eligible.value.some(shot => shot.shotId === id)); error.value = ""; saved.value = ""; });
async function save() {
  if (!preview.value || !selected.value.length || !targetVersion.value || saving.value || stale.value) return;
  const directory = props.directory; const operation = { type: "replaceShotReferences" as const, assetId: props.assetId, versionId: props.versionId, shotIds: [...selected.value] }; const revision = preview.value.revision;
  saving.value = true; error.value = ""; saved.value = "";
  try {
    await store.update(operation, directory, revision);
    if (directory === props.directory) { selected.value = []; saved.value = `已更新 ${operation.shotIds.length} 个镜头参考；原候选和采用保持。`; refreshRequested = true; emit("refresh"); }
  } catch (cause) { if (directory === props.directory) { error.value = productionError(cause); await nextTick(); errorBox.value?.focus(); } }
  finally { saving.value = false; }
}
</script>

<style scoped lang="scss">
.referenceUpdatePanel {
  margin-top: 20px; padding-top: 12px; border-top: 1px solid var(--el-border-color-light);
  > header { display: flex; align-items: center; gap: 8px; h4 { flex: 1; font-size: 14px; margin: 0; } }
  .referenceHint { color: var(--el-text-color-regular); font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
  .referenceError { color: var(--el-color-danger); font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
  fieldset { border: 0; padding: 0; margin: 16px 0; min-width: 0; legend { font-size: 13px; margin-bottom: 8px; } }
  .selectionTools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; .el-button { margin-left: 0; } }
  .referenceShots { list-style: none; padding: 0; li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; border-bottom: 1px solid var(--el-border-color-lighter); padding: 12px 0; font-size: 12px; label { display: flex; align-items: center; gap: 8px; min-width: 0; span { overflow-wrap: anywhere; } input { accent-color: var(--el-color-primary); } } > p { grid-column: 1 / -1; margin: 2px 0; line-height: 1.7; overflow-wrap: anywhere; } } }
  .locationLink { border: 0; padding: 0; color: var(--el-color-primary); background: none; cursor: pointer; font: inherit; text-align: left; }
  .historicalUses { margin-top: 16px; font-size: 12px; summary { cursor: pointer; line-height: 1.7; } ul { padding-left: 18px; li { margin: 8px 0; overflow-wrap: anywhere; } } }
  :focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; }
}
</style>
