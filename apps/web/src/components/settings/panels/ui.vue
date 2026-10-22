<template>
  <div class="ui">
    <section class="settingSection" aria-labelledby="appearanceTitle">
      <div class="settingRow">
        <h3 id="appearanceTitle">外观模式</h3>
        <el-radio-group :modelValue="uiSettings.theme" :disabled="themeSaving" aria-label="外观模式" @change="changeTheme">
          <el-radio-button value="light">浅色</el-radio-button>
          <el-radio-button value="dark">深色</el-radio-button>
        </el-radio-group>
      </div>
    </section>
    <section class="settingSection" aria-labelledby="languageTitle">
      <h3 id="languageTitle"><icon-language :size="18" />语言</h3>
      <languageSelect class="languageCards" />
    </section>

    <section class="settingSection" aria-labelledby="colorTitle">
      <div class="settingHeader">
        <h3 id="colorTitle">
          <icon-palette :size="18" />
          主题颜色
        </h3>
        <span class="settingValue">{{ primaryColor.toUpperCase() }}</span>
      </div>
      <div class="colorOptions">
        <el-button
          v-for="color in colors"
          :key="color.value"
          class="colorSwatch"
          circle
          :style="{ '--swatchColor': color.value }"
          :aria-label="color.label"
          :aria-pressed="uiSettings.primaryColor.toLowerCase() === color.value"
          :title="color.label"
          @click="updateUiSettings({ primaryColor: color.value })">
          <icon-check v-if="uiSettings.primaryColor.toLowerCase() === color.value" :size="18" />
        </el-button>
        <el-color-picker
          :modelValue="uiSettings.primaryColor"
          colorFormat="hex"
          aria-label="自定义主题颜色"
          @activeChange="(value) => primaryColor = value || uiSettings.primaryColor"
          @change="changeColor" />
        <span class="description">自定义</span>
      </div>
    </section>

    <section class="settingSection" aria-labelledby="fontTitle">
      <div class="settingHeader">
        <h3 id="fontTitle">
          <icon-text-size :size="18" />
          字体大小
        </h3>
        <span class="settingValue">{{ fontScale }}%</span>
      </div>
      <el-slider
        v-model="fontScale"
        class="settingSlider"
        :min="85"
        :max="150"
        :step="5"
        :marks="{ 85: '较小', 100: '默认', 125: '较大', 150: '最大' }"
        aria-label="字体大小"
        @change="(value) => typeof value === 'number' && updateUiSettings({ fontScale: value })" />
    </section>

    <section class="settingSection" aria-labelledby="radiusTitle">
      <div class="settingHeader">
        <h3 id="radiusTitle">
          <icon-border-radius :size="18" />
          界面圆角
        </h3>
        <span class="settingValue">{{ radius }} px</span>
      </div>
      <el-slider
        v-model="radius"
        class="settingSlider"
        :min="0"
        :max="16"
        :step="2"
        :marks="{ 0: '直角', 8: '默认', 16: '圆润' }"
        aria-label="界面圆角"
        @change="(value) => typeof value === 'number' && updateUiSettings({ radius: value })" />
    </section>

    <el-card class="appearancePreview" :style="previewStyle" shadow="never">
      <div class="previewIcon"><icon-sparkles :size="20" /></div>
      <div class="previewText">
        <strong>零幕 · 从零开始，创造第一幕</strong>
        <p>这是当前颜色、字体与圆角的实际效果。</p>
      </div>
      <el-tag type="primary" effect="light">预览</el-tag>
    </el-card>

    <div class="settingsFooter">
      <el-button :icon="IconRestore" @click="updateUiSettings({ primaryColor: defaultUiSettings.primaryColor, fontScale: defaultUiSettings.fontScale, radius: defaultUiSettings.radius })">重置颜色、字号与圆角</el-button>
    </div>
    <section class="settingSection startupSection" aria-labelledby="startupTitle">
      <div class="settingRow">
        <div>
          <h3 id="startupTitle">启动动画</h3>
          <p class="description">启动时播放品牌动画，下次启动生效。</p>
        </div>
        <el-switch :modelValue="uiSettings.startupAnimation" aria-label="启动动画" @change="(value) => updateUiSettings({ startupAnimation: value === true })" />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import {
  IconPalette,
  IconSparkles,
  IconCheck,
  IconRestore,
} from "@tabler/icons-vue";
import { defaultUiSettings, saveSettings, uiSettings, updateUiSettings } from "@/stores/settings";
import languageSelect from "@/components/languageSelect.vue";

const fontScale = ref(uiSettings.value.fontScale);
const radius = ref(uiSettings.value.radius);
const primaryColor = ref(uiSettings.value.primaryColor);
const themeSaving = ref(false);
async function changeTheme(value: string | number | boolean | undefined) {
  if (value !== "light" && value !== "dark") return;
  themeSaving.value = true;
  try { await saveSettings(() => ({ homeTheme: value })); }
  catch { ElMessage.error("外观保存失败，请重试"); }
  finally { themeSaving.value = false; }
}
watch(() => uiSettings.value.fontScale, value => { fontScale.value = value; });
watch(() => uiSettings.value.radius, value => { radius.value = value; });
watch(() => uiSettings.value.primaryColor, value => { primaryColor.value = value; });

// 拖动期间仅更新预览，松手后沿用 change 保存；像素值避免全局字号提交后重复缩放。
const previewStyle = computed(() => {
  const background = uiSettings.value.theme === "dark" ? "#141414" : "#fff";
  return {
    "--previewColor": primaryColor.value,
    "--previewTint": `color-mix(in srgb, ${primaryColor.value} 10%, ${background})`,
    "--previewBorder": `color-mix(in srgb, ${primaryColor.value} 20%, ${background})`,
    "--previewTitleSize": `${15 * fontScale.value / 100}px`,
    "--previewBodySize": `${12 * fontScale.value / 100}px`,
    "--previewRadius": `${radius.value}px`,
  };
});

const colors = [
  { value: "#409eff", label: "天空蓝" },
  { value: "#6366f1", label: "鸢尾紫" },
  { value: "#a855f7", label: "薰衣紫" },
  { value: "#e34b83", label: "蔷薇粉" },
  { value: "#e89524", label: "琥珀橙" },
  { value: "#18a17c", label: "松石绿" },
];
function changeColor(value: string | null) {
  if (value) updateUiSettings({ primaryColor: value });
}

</script>

<style lang="scss" scoped>
.ui {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 0 4px 8px;

  .description {
    margin: 0;
    color: var(--el-text-color-secondary);
    font-size: 13px;
    line-height: 1.6;
  }

  .settingSection {
    min-width: 0;

    .settingRow {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      h3 { margin-bottom: 0; }
      .description { margin-top: 6px; }
      > .el-switch, > .el-radio-group { flex-shrink: 0; }
    }

    h3 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 12px;
      color: var(--el-text-color-primary);
      font-size: 14px;
      font-weight: 600;
    }

    .settingHeader {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;

      h3 {
        margin-bottom: 6px;
      }
      .settingValue {
        color: var(--el-text-color-secondary);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }
    }

    .languageCards { margin-top: 14px; }

    .colorOptions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 14px;

      .colorSwatch {
        width: 30px;
        height: 30px;
        margin: 0;
        border: 0;
        color: #fff;
        background: var(--swatchColor);

        &[aria-pressed="true"] {
          outline: 2px solid var(--swatchColor);
          outline-offset: 3px;
        }
        &:focus-visible {
          outline: 2px solid var(--el-text-color-primary);
          outline-offset: 3px;
        }
      }
    }

    .settingSlider {
      width: calc(100% - 48px);
      margin: 10px 24px 20px;

      :deep(.el-slider__stop) {
        background-color: var(--el-text-color-secondary);
        box-shadow: 0 0 0 1px var(--el-bg-color-overlay);
      }
    }
  }

  .appearancePreview {
    background: var(--el-fill-color-extra-light);
    border-radius: calc(var(--previewRadius) * 1.5);
    transition: none;

    :deep(.el-card__body) {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 18px;
    }
    .previewIcon {
      display: grid;
      place-items: center;
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      border-radius: var(--previewRadius);
      background: var(--previewTint);
      color: var(--previewColor);
    }
    .previewText {
      flex: 1;
      min-width: 0;
      strong {
        font-size: var(--previewTitleSize);
        font-weight: 500;
        color: var(--el-text-color-primary);
      }
      p {
        margin: 6px 0 0;
        color: var(--el-text-color-secondary);
        font-size: var(--previewBodySize);
        line-height: 1.6;
      }
    }
    :deep(.el-tag) {
      color: var(--previewColor);
      background: var(--previewTint);
      border-color: var(--previewBorder);
      border-radius: calc(var(--previewRadius) * 0.5);
      font-size: var(--previewBodySize);
    }
  }

  .settingsFooter {
    display: flex;
    justify-content: flex-end;
  }
  .startupSection { padding-top: 20px; border-top: 1px solid var(--el-border-color-lighter); }

  @media (max-width: 700px) {
    .appearancePreview {
      :deep(.el-card__body) {
        display: grid;
        grid-template-columns: 40px minmax(0, 1fr);
        align-items: start;
        padding: 12px;
      }
      :deep(.el-tag) { grid-column: 2; justify-self: start; }
    }
  }
}
</style>
