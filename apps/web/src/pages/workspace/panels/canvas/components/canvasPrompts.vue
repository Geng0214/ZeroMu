<template>
  <div class="canvasPrompts" @keydown.stop>
    <el-input v-model="query" :prefixIcon="IconSearch" placeholder="搜索提示词" aria-label="搜索画布提示词" clearable size="small" />
    <div class="promptLibraryActions"><label><input v-model="favoritesOnly" type="checkbox" />只看收藏</label><router-link to="/prompts">管理个人提示词</router-link></div><p v-if="store.error" class="promptError" role="alert">{{ store.error }}<button @click="reload">重新读取</button></p><p v-if="store.loading" class="emptyList" role="status">正在读取提示词…</p>
    <div class="promptList">
      <article v-for="item in filteredPrompts" :key="item.id">
        <strong>{{ item.definition.title }}</strong>
        <p>{{ item.definition.text }}</p><span class="promptMeta">{{ item.origin === 'personal' ? '我的' : '内置' }}{{ item.favorite ? ' · 已收藏' : '' }}{{ item.definition.tags.length ? ' · ' + item.definition.tags.join('、') : '' }}</span>
        <button type="button" :disabled="disabled" @click="useEntry(item)"><icon-plus :size="14" />{{ item.definition.variables.length ? '填入变量并添加' : '添加为文本节点' }}</button>
      </article>
      <p v-if="!filteredPrompts.length" class="emptyList">没有匹配的提示词</p>
    </div>
    <el-dialog v-model="filling" :title="selected?.definition.title || '填入变量'" width="min(700px, 94vw)" appendToBody :closeOnClickModal="false"><p v-if="contextChanged" class="promptError" role="alert">画布已切换，请关闭后重新打开提示词，再核对添加位置。</p><promptComposer v-if="selected" :key="selected.id" :definition="selected.definition" actionLabel="添加为文本节点" :disabled="disabled || contextChanged" @usePrompt="addFilledPrompt" /></el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { IconSearch, IconPlus } from "@tabler/icons-vue";
import promptComposer from "@/components/promptComposer.vue";
import { usePromptLibraryStore } from "@/stores/promptLibrary";
import type { PromptLibraryEntry } from "@toonflow/server/promptLibrary";

const props = defineProps<{ disabled?: boolean; contextKey: string }>();
const emit = defineEmits<{ usePrompt: [text: string] }>();
const store = usePromptLibraryStore(); const query = ref(""); const favoritesOnly = ref(false); const filling = ref(false); const selected = ref<PromptLibraryEntry>(); let selectedContext = "";
const contextChanged = computed(() => filling.value && selectedContext !== props.contextKey);
const filteredPrompts = computed(() => store.entries.filter(item => !item.archived && (!favoritesOnly.value || item.favorite) && `${item.definition.title} ${item.definition.text} ${item.definition.tags.join(" ")}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())));
async function reload() { try { await store.load(); } catch { /* 错误在个人库状态中显示，仍保留已读内容。 */ } }
onMounted(() => { void reload(); });
function useEntry(entry: PromptLibraryEntry) { if (props.disabled) return; if (!entry.definition.variables.length) { emit("usePrompt", entry.definition.text); return; } selected.value = entry; selectedContext = props.contextKey; filling.value = true; }
function addFilledPrompt(text: string) { if (props.disabled || contextChanged.value) return; filling.value = false; emit("usePrompt", text); }
</script>

<style scoped lang="scss">
.canvasPrompts {
  display: flex; flex-direction: column; gap: 12px;
  .promptLibraryActions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; font-size: 12px; label { display: flex; align-items: center; gap: 6px; } a { color: var(--el-color-primary); } }
  .promptError { color: var(--el-color-danger); font-size: 12px; line-height: 1.7; button { color: inherit; border: 0; background: transparent; text-decoration: underline; cursor: pointer; } }
  .promptMeta { color: var(--el-text-color-secondary); font-size: 11px; }
  @media(max-width:720px) { .promptLibraryActions label, .promptLibraryActions a, .promptList button { min-height: 44px; } .promptLibraryActions a { display: inline-flex; align-items: center; } }
  .promptList {
    max-height: min(400px, 45dvh); overflow: auto; scrollbar-width: thin; scrollbar-color: var(--el-border-color) transparent;
    article {
      padding: 12px 2px; border-bottom: 1px solid var(--el-border-color-light);
      &:first-child { padding-top: 0; }
      &:last-child { padding-bottom: 0; border-bottom: 0; }
      strong { font-size: 13px; font-weight: 600; color: var(--el-text-color-primary); }
      p { margin: 8px 0; color: var(--el-text-color-regular); font-size: 12px; line-height: 1.7; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
      button {
        display: flex; align-items: center; gap: 4px; padding: 6px 0; border: 0; border-radius: 4px; background: transparent; color: var(--el-text-color-primary); font: inherit; font-size: 12px; cursor: pointer;
        &:hover { color: var(--el-color-primary); }
        &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
        &:disabled { opacity: .5; cursor: not-allowed; }
      }
    }
    .emptyList { margin: 0; padding: 24px 0; color: var(--el-text-color-regular); font-size: 12px; text-align: center; }
  }
}
</style>
