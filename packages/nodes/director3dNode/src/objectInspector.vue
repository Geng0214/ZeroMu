<template>
  <section class="objectInspector" aria-label="对象属性">
    <template v-if="draft">
      <div class="inspectorHeading"><strong>{{ draft.objType === 'mannequin' ? '人物属性' : '模型属性' }}</strong><span>{{ draft.visible === false ? '已隐藏' : '可见' }}</span></div>
      <label class="fieldLabel">名称<input :value="draft.name || draft.objType" maxlength="100" :disabled="disabled" aria-label="对象名称" @change="rename" @blur="rename" /></label>
      <label class="colorField">颜色<input type="color" :value="draft.material.color" :disabled="disabled" aria-label="对象颜色" @change="setColor" /><span>{{ draft.material.color }}</span></label>
      <fieldset v-for="field in transformFields" :key="field.key" :disabled="disabled">
        <legend>{{ field.label }}</legend>
        <div class="vectorFields">
          <label v-for="axis in axes" :key="axis">{{ axis.toUpperCase() }}<input type="number" :value="readTransform(field.key, axis)" :min="field.key === 'scale' ? 0.01 : -10000" :max="field.key === 'scale' ? 100 : 10000" :step="field.key === 'rotation' ? 5 : 0.1" :aria-label="field.label + ' ' + axis.toUpperCase()" @change="setTransform(field.key, axis, $event)" @blur="setTransform(field.key, axis, $event)" /></label>
        </div>
      </fieldset>
      <template v-if="draft.objType === 'mannequin'">
        <div class="poseHeading">人物姿态</div>
        <div class="posePresets"><button v-for="pose in posePresets" :key="pose" type="button" :disabled="disabled" @click="setPose(pose)">{{ pose }}</button></div>
        <label class="fieldLabel">关节<select v-model="joint" :disabled="disabled" aria-label="人物关节"><option v-for="item in jointOptions" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
        <fieldset :disabled="disabled"><legend>关节角度 · °</legend><div class="vectorFields"><label v-for="axis in axes" :key="axis">{{ axis.toUpperCase() }}<input type="number" :value="Math.round((draft.pose?.[joint]?.[axis] ?? 0) * 180 / Math.PI)" min="-180" max="180" step="5" :aria-label="'关节角度 ' + axis.toUpperCase()" @change="setJoint(axis, $event)" @blur="setJoint(axis, $event)" /></label></div></fieldset>
      </template>
      <div class="objectActions"><button type="button" :disabled="disabled" @click="emit('duplicate')"><icon-copy :size="15" />复制对象</button><button type="button" :disabled="disabled" @click="emit('remove')"><icon-trash :size="15" />删除对象</button></div>
    </template>
    <div v-else class="emptyInspector"><icon-adjustments :size="24" stroke="1.4" /><p>选择场景中的对象</p><span>编辑站位、颜色和人物姿态</span></div>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { IconAdjustments, IconCopy, IconTrash } from "@tabler/icons-vue";
import type { SceneDocument } from "./scene";
import type { mannequinJoints } from "./mannequin";
type SceneObject = SceneDocument["objectList"][number];
type Joint = typeof mannequinJoints[number];
const props = defineProps<{ object?: SceneObject; disabled: boolean }>();
const emit = defineEmits<{ update: [object: SceneObject]; duplicate: []; remove: [] }>();
const draft = ref<SceneObject>();
watch(() => props.object, object => { draft.value = object && JSON.parse(JSON.stringify(object)); }, { immediate: true });
const axes = ["x", "y", "z"] as const;
const transformFields = [{ key: "position", label: "位置" }, { key: "rotation", label: "旋转 · °" }, { key: "scale", label: "缩放" }] as const;
const joint = ref<Joint>("rightShoulder");
const jointOptions: { id: Joint; name: string }[] = [
  { id: "hips", name: "骨盆" }, { id: "spine", name: "躯干" }, { id: "neck", name: "颈部" }, { id: "head", name: "头部" },
  { id: "leftShoulder", name: "左肩" }, { id: "leftElbow", name: "左肘" }, { id: "leftWrist", name: "左腕" }, { id: "rightShoulder", name: "右肩" }, { id: "rightElbow", name: "右肘" }, { id: "rightWrist", name: "右腕" },
  { id: "leftHip", name: "左髋" }, { id: "leftKnee", name: "左膝" }, { id: "leftAnkle", name: "左踝" }, { id: "rightHip", name: "右髋" }, { id: "rightKnee", name: "右膝" }, { id: "rightAnkle", name: "右踝" },
];
const posePresets = ["站立", "行走", "坐姿", "举手"];
function submit() { if (draft.value) emit("update", JSON.parse(JSON.stringify(draft.value))); }
function rename(event: Event) {
  if (!draft.value || props.disabled) return;
  const name = (event.target as HTMLInputElement).value.trim().slice(0, 100) || "未命名对象";
  if (name === draft.value.name) return;
  draft.value.name = name; submit();
}
function setColor(event: Event) { if (draft.value) { draft.value.material.color = (event.target as HTMLInputElement).value; submit(); } }
function readTransform(field: "position" | "rotation" | "scale", axis: "x" | "y" | "z") {
  if (!draft.value) return 0;
  if (field === "position") return Number(draft.value.position[axis].toFixed(2));
  if (field === "rotation") return Number(((draft.value.rotation?.[`rotation${axis.toUpperCase()}` as "rotationX"] ?? 0) * 180 / Math.PI).toFixed(1));
  return Number((draft.value.scale?.[`scale${axis.toUpperCase()}` as "scaleX"] ?? 1).toFixed(2));
}
function setTransform(field: "position" | "rotation" | "scale", axis: "x" | "y" | "z", event: Event) {
  if (!draft.value || props.disabled) return;
  const input = event.target as HTMLInputElement;
  if (!input.checkValidity() || !input.value || !Number.isFinite(input.valueAsNumber)) { input.value = String(readTransform(field, axis)); return; }
  const value = input.valueAsNumber;
  if (value === readTransform(field, axis)) return;
  if (field === "position") draft.value.position[axis] = value;
  if (field === "rotation") { draft.value.rotation ??= { rotationX: 0, rotationY: 0, rotationZ: 0 }; draft.value.rotation[`rotation${axis.toUpperCase()}` as "rotationX"] = value * Math.PI / 180; }
  if (field === "scale") { draft.value.scale ??= { scaleX: 1, scaleY: 1, scaleZ: 1 }; draft.value.scale[`scale${axis.toUpperCase()}` as "scaleX"] = value; }
  submit();
}
function setJoint(axis: "x" | "y" | "z", event: Event) {
  if (!draft.value || props.disabled) return;
  const input = event.target as HTMLInputElement;
  if (!input.checkValidity() || !input.value || !Number.isFinite(input.valueAsNumber)) return;
  if (Math.abs(input.valueAsNumber * Math.PI / 180 - (draft.value.pose?.[joint.value]?.[axis] ?? 0)) < .0001) return;
  draft.value.pose ??= {};
  draft.value.pose[joint.value] = { x: 0, y: 0, z: 0, ...draft.value.pose[joint.value], [axis]: input.valueAsNumber * Math.PI / 180 };
  submit();
}
function setPose(pose: string) {
  if (!draft.value) return;
  const rotation = (x = 0, y = 0, z = 0) => ({ x, y, z });
  draft.value.pose = pose === "坐姿" ? { leftHip: rotation(-Math.PI / 2), rightHip: rotation(-Math.PI / 2), leftKnee: rotation(Math.PI / 2), rightKnee: rotation(Math.PI / 2) }
    : pose === "行走" ? { leftHip: rotation(-.45), rightHip: rotation(.45), leftShoulder: rotation(.4), rightShoulder: rotation(-.4), rightKnee: rotation(.35) }
    : pose === "举手" ? { rightShoulder: rotation(0, 0, -2.8), rightElbow: rotation(-.3) } : {};
  submit();
}
</script>

<style scoped lang="scss">
.objectInspector {
  padding: 16px; overflow-y: auto; min-height: 0; flex: 1; color: var(--el-text-color-regular); font-size: 12px; scrollbar-width: thin; scrollbar-color: var(--el-border-color) transparent;
  .inspectorHeading { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 22px; span { color: var(--el-text-color-secondary); } }
  .fieldLabel { display: grid; gap: 7px; margin-bottom: 16px; }
  input, select { min-width: 0; width: 100%; box-sizing: border-box; height: 32px; padding: 0 8px; border: 1px solid var(--el-border-color); border-radius: calc(var(--ui-radius, 8px) * 0.625); background: var(--el-bg-color); color: var(--el-text-color-regular); font: inherit; }
  input[type="number"] { font-variant-numeric: tabular-nums; padding: 0 4px; }
  .colorField { display: flex; align-items: center; gap: 10px; margin-bottom: 22px; input { width: 36px; padding: 2px; cursor: pointer; } span { color: var(--el-text-color-secondary); } }
  fieldset { margin: 0 0 18px; padding: 0; border: 0; legend { margin-bottom: 9px; } }
  .vectorFields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; label { display: grid; gap: 5px; color: var(--el-text-color-secondary); font-size: 10px; } }
  .poseHeading { margin-top: 24px; margin-bottom: 9px; }
  button { border: 1px solid var(--el-border-color); border-radius: calc(var(--ui-radius, 8px) * 0.625); background: var(--el-bg-color); color: var(--el-text-color-regular); padding: 7px; font: inherit; cursor: pointer; &:hover { background: var(--el-fill-color); } }
  .posePresets { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin-bottom: 16px; }
  .objectActions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 24px; button { display: flex; align-items: center; gap: 6px; } }
  .emptyInspector { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 220px; color: var(--el-text-color-secondary); p { margin: 14px 0 8px; color: var(--el-text-color-regular); } span { font-size: 11px; } }
  :is(button, input, select):focus-visible { outline: 2px solid var(--el-text-color-primary); outline-offset: 2px; }
  :is(button, input, select):disabled { opacity: .5; cursor: not-allowed; }
}
</style>
