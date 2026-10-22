<template>
  <el-tour v-model="open" :targetAreaClickable="false" :contentStyle="{ maxWidth: 'calc(100vw - 32px)' }" @close="complete">
    <el-tour-step
      v-for="(step, index) in steps"
      :key="step.target"
      :target="() => root?.querySelector<HTMLElement>(step.target) ?? null"
      :placement="step.placement"
      :title="step.title"
      :description="step.description"
      :prevButtonProps="{ children: '上一步' }"
      :nextButtonProps="{ children: index === steps.length - 1 ? '开始使用' : '下一步' }" />
    <template #indicators="{ current, total }">{{ current + 1 }} / {{ total }}</template>
  </el-tour>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { ElTour, ElTourStep } from "element-plus";

defineProps<{ root?: HTMLElement }>();
const storageKey = "zeromu.directorStageTour.v2";
const open = ref(localStorage.getItem(storageKey) !== "true");
const steps = [
  {
    target: ".addControl",
    placement: "right",
    title: "布置场景",
    description: "从左侧添加人偶、基础几何体或群众阵列。在对象列表或画面中选择模型，右侧可以修改站位、颜色和姿态。",
  },
  {
    target: ".inspectorTabs",
    placement: "left",
    title: "属性与 AI 方案",
    description: "属性用于手动调整对象；切换到 AI 方案后，可以描述场景、人物动作和运镜生成动画。多个方案共用基础场景。",
  },
  {
    target: ".stageToolbar",
    placement: "bottom",
    title: "调整视角",
    description: "导演视角：左键拖动环绕、右键拖动平移、滚轮缩放。选择对象后使用移动、旋转、缩放工具。第一人称取景模式支持拖动转向、WASD 移动与滚轮调焦，也可点击画面锁定鼠标。",
  },
  {
    target: ".referenceHeader",
    placement: "top",
    title: "保存机位",
    description: "点击保存机位记录当前构图、画幅与时间。机位可以命名、拖动排序和回看；截图到画布可以直接生成构图参考图片。再次生成方案时，AI 会参考这些机位。",
  },
  {
    target: ".playbackBar",
    placement: "top",
    title: "播放与画面设置",
    description: "用播放按钮和进度条检查动画；在这里调整画面比例、网格、天空与光照，让预演画面更符合你的想法。",
  },
  {
    target: '[aria-label="导出视频节点"]',
    placement: "top",
    title: "导出到画布",
    description: "选中方案后，点击这里导出视频节点。关键帧缩略图上的导出按钮可以生成图片节点。视频导出期间请保持窗口可见，完成后回到画布查看结果。",
  },
] as const;

function openGuide() { open.value = true; }
defineExpose({ openGuide });

function complete() {
  localStorage.setItem(storageKey, "true");
}
</script>
