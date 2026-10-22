<template>
  <markdownContent v-bind="props" />
</template>

<script setup lang="ts">
import { defineAsyncComponent, defineComponent, h } from "vue";
import type { CodeOptions } from "vue-stream-markdown";

const props = defineProps<{ content: string; streaming?: boolean; codeOptions?: CodeOptions; directory?: string }>();
// 首次展示正文才加载 Markdown、公式、图表和着色库；加载中仍显示实际文本。
const plainContent = defineComponent({
  props: { content: { type: String, default: "" } },
  setup: value => () => h("div", { class: "messageMarkdown", style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, value.content),
});
const markdownContent = defineAsyncComponent({
  loader: () => import("./markdownContent.vue"), loadingComponent: plainContent, errorComponent: plainContent, delay: 0, timeout: 15000,
});
</script>
