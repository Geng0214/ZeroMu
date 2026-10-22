<template>
  <aside class="sceneObjects" aria-label="场景对象">
    <div class="panelHeading"><strong>场景</strong><span>{{ objects.length }} / 200</span></div>
    <label class="addControl">添加模型
      <select aria-label="添加模型" :disabled="disabled" :value="''" @change="addModel">
        <option value="" disabled>选择模型…</option>
        <option value="mannequin">关节人偶</option>
        <option value="box">立方体</option>
        <option value="sphere">球体</option>
        <option value="cylinder">圆柱</option>
        <option value="plane">平面</option>
        <option value="crowd">群众阵列 · 3 × 3</option>
      </select>
    </label>
    <input v-model="query" class="objectSearch" type="search" placeholder="搜索场景对象" aria-label="搜索场景对象" />
    <div class="objectList">
      <div v-for="object in filteredObjects" :key="object.threeJsonId" class="objectRow" :class="{ selected: selectedId === object.threeJsonId, hidden: object.visible === false }">
        <button type="button" class="selectObject" :aria-pressed="selectedId === object.threeJsonId" :disabled="disabled" @click="emit('select', object.threeJsonId)">
          <icon-user v-if="object.objType === 'mannequin'" :size="16" />
          <icon-cube v-else :size="16" />
          <span>{{ object.name || object.objType }}</span>
        </button>
        <button type="button" class="visibilityButton" :disabled="disabled" :aria-label="(object.visible === false ? '显示 ' : '隐藏 ') + (object.name || object.objType)" @click="emit('toggle', object.threeJsonId)">
          <icon-eye-off v-if="object.visible === false" :size="15" /><icon-eye v-else :size="15" />
        </button>
      </div>
      <p v-if="!objects.length" class="emptyObjects">添加人偶或几何体，开始布置你的场景。</p>
      <p v-else-if="!filteredObjects.length" class="emptyObjects">没有匹配的对象</p>
    </div>
    <p class="saveStatus" role="status">{{ readOnly ? '固定机位快照，场景只读' : saving ? '正在保存场景…' : '场景修改自动保存' }}</p>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { IconCube, IconUser, IconEye, IconEyeOff } from "@tabler/icons-vue";
import type { SceneDocument } from "./scene";

defineOptions({ inheritAttrs: false });
const props = defineProps<{ objects: SceneDocument["objectList"]; selectedId: string; disabled: boolean; saving: boolean; readOnly?: boolean }>();
const emit = defineEmits<{ select: [id: string]; toggle: [id: string]; add: [type: string] }>();
const query = ref("");
const filteredObjects = computed(() => props.objects.filter(object => `${object.name ?? ''} ${object.objType}`.toLowerCase().includes(query.value.trim().toLowerCase())));
function addModel(event: Event) {
  const select = event.target as HTMLSelectElement;
  emit("add", select.value);
  select.value = "";
}
</script>

<style scoped lang="scss">
.sceneObjects {
  display: flex; flex-direction: column; min-width: 0; min-height: 0;
  padding: 16px; border-right: 1px solid var(--el-border-color); color: var(--el-text-color-regular);
  .panelHeading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; font-size: 13px;
    span { color: var(--el-text-color-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }
  }
  .addControl { display: grid; gap: 7px; font-size: 12px; }
  select, input { min-width: 0; width: 100%; height: 34px; box-sizing: border-box; padding: 0 9px; border: 1px solid var(--el-border-color); border-radius: calc(var(--ui-radius, 8px) * 0.75); background: var(--el-bg-color); color: var(--el-text-color-regular); font: inherit; }
  .objectSearch { margin: 12px 0; font-size: 12px; }
  .objectList { flex: 1; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--el-border-color) transparent; }
  .objectRow { display: flex; border-radius: calc(var(--ui-radius, 8px) * 0.75); margin: 3px 0;
    &.selected { background: var(--el-fill-color-dark); color: var(--el-text-color-primary); }
    &.hidden .selectObject { color: var(--el-text-color-secondary); }
    button { border: 0; background: transparent; color: inherit; cursor: pointer; min-height: 36px; }
    .selectObject { display: flex; align-items: center; gap: 9px; flex: 1; min-width: 0; text-align: left; padding: 7px; font: inherit; font-size: 12px;
      svg { flex-shrink: 0; } span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    }
    .visibilityButton { padding: 7px; flex-shrink: 0; }
    &:hover { background: var(--el-fill-color); }
  }
  .emptyObjects { font-size: 12px; line-height: 1.8; color: var(--el-text-color-secondary); margin-top: 24px; }
  .saveStatus { font-size: 11px; color: var(--el-text-color-secondary); margin: 16px 0 0; }
  :is(button, input, select):focus-visible { outline: 2px solid var(--el-text-color-primary); outline-offset: 2px; }
  :is(button, select):disabled { opacity: .5; cursor: not-allowed; }
}
</style>
