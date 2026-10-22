<template>
  <el-dialog :modelValue="modelValue" :title="editingId ? '编辑个人提示词' : '新增个人提示词'" width="min(740px, 94vw)" appendToBody :closeOnClickModal="false" :closeOnPressEscape="false" :showClose="!saving" :beforeClose="closeEditor" @update:modelValue="emit('update:modelValue', $event)">
    <form ref="form" class="promptEditor" @submit.prevent="save">
      <div v-if="error" ref="errorBox" class="editorError" role="alert" tabindex="-1"><strong>{{ error }}</strong><button v-for="field in invalidFields" :key="field" type="button" @click="focusField(field)">检查{{ fieldNames[field] }}</button><el-button v-if="conflict" size="small" :disabled="saving || store.loading" @click="refresh">刷新并核对最新内容</el-button><el-button v-if="conflict && editingId && !latestDefinition" size="small" :disabled="saving" @click="saveCopy">草稿另存副本</el-button></div>
      <p v-if="status" class="editorHint" role="status">{{ status }}</p>
      <section v-if="latestDefinition" class="latestContent"><h3>最新保存内容</h3><p>{{ latestDefinition.title }}</p><p>分类：{{ latestDefinition.kind }} · 使用位置：{{ modeLabels[latestDefinition.mode] }}</p><p v-if="latestDefinition.tags.length">标签：{{ latestDefinition.tags.join('、') }}</p><pre>{{ latestDefinition.text }}</pre><details v-if="latestDefinition.variables.length"><summary>变量说明与默认值 · {{ latestDefinition.variables.length }} 项</summary><ul><li v-for="variable in latestDefinition.variables" :key="variable.key">{{ variable.label }}（{{ variable.key }}） · {{ variable.required ? '必填' : '可留空' }}<pre>{{ variable.defaultValue || '（空）' }}</pre></li></ul></details><p class="editorHint">载入会替换当前草稿。也可以将当前草稿另存为独立提示词。</p><el-button :disabled="saving" @click="loadLatest">载入最新内容，替换草稿</el-button><el-button :disabled="saving" @click="saveCopy">草稿另存副本</el-button></section>
      <fieldset :disabled="saving"><div class="editorGrid"><label>标题<input v-model="draft.title" data-field="title" aria-label="标题" :aria-describedby="issues.title ? fieldId + 'titleError' : undefined" maxlength="200" :aria-invalid="!!issues.title" /><span v-if="issues.title" :id="fieldId + 'titleError'" class="editorError">{{ issues.title }}</span></label><label>使用位置<select v-model="draft.mode" aria-label="使用位置"><option value="image">生图创作</option><option value="video">视频创作</option><option value="audio">音频创作</option><option value="home">画布构思</option></select></label><label>分类名称<input v-model="draft.kind" data-field="kind" aria-label="分类名称" :aria-describedby="issues.kind ? fieldId + 'kindError' : undefined" maxlength="80" :aria-invalid="!!issues.kind" /><span v-if="issues.kind" :id="fieldId + 'kindError'" class="editorError">{{ issues.kind }}</span></label><label>标签，以逗号分隔<input v-model="tagText" data-field="tags" aria-label="标签，以逗号分隔" :aria-describedby="issues.tags ? fieldId + 'tagsError' : undefined" :aria-invalid="!!issues.tags" /><span v-if="issues.tags" :id="fieldId + 'tagsError'" class="editorError">{{ issues.tags }}</span></label></div>
        <label>提示词内容<textarea v-model="draft.text" data-field="text" aria-label="提示词内容" :aria-describedby="issues.text ? fieldId + 'textError' : undefined" rows="7" maxlength="100000" :aria-invalid="!!issues.text" /><span v-if="issues.text" :id="fieldId + 'textError'" class="editorError">{{ issues.text }}</span></label><p class="editorHint">使用双花括号添加变量，例如 <code v-pre>{{product}}</code>。名称以英文字母开头，只含字母和数字；下面可以填写中文显示名称。</p>
        <fieldset v-if="variableNames.length" class="variableFields"><legend>变量说明与默认值</legend><div v-for="key in variableNames" :key="key" class="variableRow"><strong>{{ key }}</strong><label>显示名称<input v-model="variableFor(key).label" :aria-label="key + '显示名称'" data-field="variables" maxlength="100" /></label><label class="requiredToggle"><input v-model="variableFor(key).required" :aria-label="(variableFor(key).label || key) + '必填'" type="checkbox" />必填</label><label class="variableDefault">默认值<textarea v-model="variableFor(key).defaultValue" :aria-label="(variableFor(key).label || key) + '默认值'" rows="2" maxlength="10000" /></label></div><p class="editorHint">默认值随个人提示词保存在本机；导出时默认清空。</p></fieldset><p v-if="issues.variables" class="editorError">{{ issues.variables }}</p>
      </fieldset>
      <div class="editorActions"><el-button :disabled="saving" @click="closeEditor(() => emit('update:modelValue', false))">取消</el-button><el-button type="primary" nativeType="submit" :loading="saving" :disabled="!store.loaded || store.busy || !!latestDefinition">保存提示词</el-button></div>
    </form>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, useId, watch } from "vue";
import { ElMessageBox } from "element-plus";
import { promptDefinitionSchema, promptVariableNames, type PromptDefinition } from "@toonflow/server/promptLibrary";
import { promptLibraryError, usePromptLibraryStore } from "@/stores/promptLibrary";
const props = defineProps<{ modelValue: boolean; entryId?: string; seed?: PromptDefinition }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean]; saved: [id: string] }>();
const fieldId = useId(); const modeLabels = { image: "生图创作", video: "视频创作", audio: "音频创作", home: "画布构思" }; const store = usePromptLibraryStore(); const form = ref<HTMLFormElement>(); const errorBox = ref<HTMLElement>();
const draft = reactive<PromptDefinition>({ title: "", mode: "image", kind: "个人创作", text: "", tags: [], variables: [] });
const tagText = ref(""); const editingId = ref<string>(); const saving = ref(false); const error = ref(""); const status = ref(""); const conflict = ref(false); const latestDefinition = ref<PromptDefinition | null>(null);
const issues = ref<Record<string, string>>({}); const fieldNames: Record<string, string> = { title: "标题", kind: "分类", text: "提示词内容", tags: "标签", variables: "变量说明" };
const invalidFields = computed(() => Object.keys(issues.value).filter(field => fieldNames[field]));
const variableNames = computed(() => promptVariableNames(draft.text));
watch(variableNames, names => { for (const key of names) if (!draft.variables.some(variable => variable.key === key)) draft.variables.push({ key, label: key, defaultValue: "", required: true }); }, { flush: "sync" });
function variableFor(key: string) { return draft.variables.find(variable => variable.key === key)!; }
const definition = computed<PromptDefinition>(() => ({ ...draft, tags: [...new Set(tagText.value.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean))], variables: variableNames.value.map(key => variableFor(key)) }));
let revision = 0; let baseline = "";
function setDraft(value?: PromptDefinition) { Object.assign(draft, JSON.parse(JSON.stringify(value ?? { title: "", mode: "image", kind: "个人创作", text: "", tags: [], variables: [] }))); tagText.value = draft.tags.join(", "); baseline = JSON.stringify(definition.value); }
watch(() => props.modelValue, open => { if (!open) return; editingId.value = props.entryId; setDraft(props.seed); revision = store.library.revision; error.value = ""; status.value = ""; conflict.value = false; latestDefinition.value = null; issues.value = {}; }, { immediate: true });
async function showError(message: string) { error.value = message; await nextTick(); errorBox.value?.focus(); }
function focusField(field: string) { form.value?.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus(); }
async function save() {
  if (saving.value) return;
  if (latestDefinition.value && editingId.value) { await showError("请先载入最新内容，或将当前草稿另存副本"); return; }
  const parsed = promptDefinitionSchema.safeParse(definition.value); issues.value = {}; error.value = "";
  if (!parsed.success) { for (const issue of parsed.error.issues) { const key = String(issue.path[0] ?? "text"); issues.value[key] ??= issue.message; } await showError("提示词尚未保存，请检查以下内容"); return; }
  saving.value = true;
  try { const result = await store.update(editingId.value ? { type: "update", id: editingId.value, definition: parsed.data } : { type: "create", definition: parsed.data }, revision); baseline = JSON.stringify(definition.value); emit("saved", result.entryId); emit("update:modelValue", false); }
  catch (cause) { conflict.value = true; await showError(promptLibraryError(cause)); }
  finally { saving.value = false; }
}
async function refresh() {
  error.value = ""; status.value = "";
  try {
    await store.load(); const entry = store.entries.find(entry => entry.id === editingId.value);
    if (editingId.value && (!entry || entry.archived)) throw new Error("这条提示词已归档或不存在。草稿仍保留，可以另存副本");
    revision = store.library.revision;
    if (entry && JSON.stringify(entry.definition) !== baseline) { latestDefinition.value = JSON.parse(JSON.stringify(entry.definition)); await showError("已读取最新内容。请核对后载入，或将当前草稿另存副本"); }
    else { conflict.value = false; status.value = "已刷新库版本，当前草稿保留。可以继续保存。"; }
  } catch (cause) { await showError(promptLibraryError(cause)); }
}
function loadLatest() { if (!latestDefinition.value) return; setDraft(latestDefinition.value); latestDefinition.value = null; issues.value = {}; error.value = ""; conflict.value = false; status.value = "已载入最新保存内容，可以继续编辑"; }
async function saveCopy() { editingId.value = undefined; revision = store.library.revision; latestDefinition.value = null; await save(); }
async function closeEditor(done: () => void) {
  if (saving.value) return;
  if (JSON.stringify(definition.value) !== baseline) { const close = await ElMessageBox.confirm("当前提示词修改尚未保存。放弃后不会更改原记录。", "保留提示词草稿", { confirmButtonText: "继续编辑", cancelButtonText: "放弃草稿", distinguishCancelAndClose: true }).then(() => false, action => action === "cancel"); if (!close) return; }
  done();
}
</script>

<style scoped lang="scss">
.promptEditor {
  display: grid; gap: 16px; min-width: 0;
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; line-height: 1.7; margin-bottom: 12px; }
  input:not([type=checkbox]), textarea, select { box-sizing: border-box; width: 100%; padding: 9px 10px; color: var(--el-text-color-primary); border: 1px solid var(--el-border-color); border-radius: 6px; background: var(--el-bg-color); font: inherit; }
  textarea { resize: vertical; min-height: 64px; }
  .editorGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
  .editorHint { margin: 0 0 10px; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
  .variableFields { padding-top: 16px; border-top: 1px solid var(--el-border-color-light); legend { font-size: 14px; } }
  .variableRow { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 14px; padding: 12px 0; border-bottom: 1px solid var(--el-border-color-lighter); > strong { grid-column: 1 / -1; overflow-wrap: anywhere; } .requiredToggle { flex-direction: row; align-items: center; align-self: center; } .variableDefault { grid-column: 1 / -1; } }
  .editorError { color: var(--el-color-danger); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; strong { display: block; } > button:not(.el-button) { display: block; background: none; border: 0; color: inherit; text-decoration: underline; font: inherit; padding: 4px 0; cursor: pointer; } }
  .latestContent { details { font-size: 12px; summary { cursor: pointer; } ul { max-height: 240px; overflow: auto; padding-left: 20px; } } padding: 12px; border: 1px solid var(--el-border-color); border-radius: 6px; h3 { margin: 0; font-size: 14px; } pre { font: inherit; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 160px; overflow: auto; } .el-button { margin: 4px 8px 4px 0; } }
  .editorActions { display: flex; justify-content: flex-end; gap: 8px; .el-button { margin-left: 0; } }
  :focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
  @media(max-width:600px) { .editorGrid { grid-template-columns: 1fr; } input:not([type=checkbox]), select, .requiredToggle, .editorActions .el-button, .latestContent .el-button, .editorError > button { min-height: 44px; } }
}
</style>
