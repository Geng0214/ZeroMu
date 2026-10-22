<template>
  <el-dialog
    class="directorDialog"
    title="3D 导演台"
    :modelValue="visible"
    width="min(1680px, calc(100vw - 24px))"
    alignCenter
    appendToBody
    :closeOnClickModal="false"
    :closeOnPressEscape="false"
    :beforeClose="closeEditor"
    @opened="loadScene"
    @closed="emit('close')">
    <template #header>
      <div class="directorHeader">
        <icon-cube3d-sphere :size="20" />
        <span>{{ readOnlyReference ? '机位快照 · 只读' : '3D 导演台' }}</span>
        <small v-if="result">{{ result.name }}</small>
        <div class="headerActions">
          <el-button text :icon="IconArrowBackUp" :disabled="editDisabled || !canUndo" aria-label="撤销场景编辑" title="撤销 Ctrl+Z" @click="restoreHistory('undo')" />
          <el-button text :icon="IconArrowForwardUp" :disabled="editDisabled || !canRedo" aria-label="重做场景编辑" title="重做 Ctrl+Shift+Z" @click="restoreHistory('redo')" />
          <el-button text :icon="IconHelp" aria-label="操作指南" @click="tour?.openGuide()" />
        </div>
      </div>
    </template>
    <div class="mobilePanels" aria-label="导演台面板">
      <button v-for="panel in [{ id: 'objects', name: '场景' }, { id: 'properties', name: '属性' }, { id: 'ai', name: 'AI 方案' }, ...!readOnlyReference ? [{ id: 'production', name: '镜头制作' }] : []]" :key="panel.id" type="button" :aria-pressed="mobilePanel === panel.id" @click="mobilePanel = panel.id; inspectorTab = ['ai', 'production'].includes(panel.id) ? panel.id : 'properties'">{{ panel.name }}</button>
    </div>
    <div ref="workspace" class="directorWorkspace" :class="'mobile' + mobilePanel" @keydown="handleWorkspaceKey">
      <sceneObjects :objects="scene.objectList" :selectedId="selectedObjectId" :disabled="editDisabled" :saving="sceneSaving || committing" :readOnly="readOnlyReference" @select="selectObject" @toggle="toggleObject" @add="addObject" />
      <section class="stagePanel" aria-label="场景与镜头">
        <div class="stageToolbar">
          <div class="viewModes"><button type="button" :aria-pressed="viewMode === 'director'" :disabled="!ready || readOnlyReference" @click="setViewMode('director')">导演视角</button><button type="button" :aria-pressed="viewMode === 'camera'" :disabled="!ready || readOnlyReference" @click="setViewMode('camera')">第一人称取景</button></div>
          <div class="transformTools"><button v-for="tool in transformTools" :key="tool.mode" type="button" :disabled="editDisabled || !selectedObject" :aria-pressed="transformMode === tool.mode" :aria-label="tool.label" :title="tool.label + ' · ' + tool.key" @click="setTransformMode(tool.mode)"><component :is="tool.icon" :size="16" /></button></div>
          <select aria-label="标准视角" :disabled="!ready || readOnlyReference" :value="''" @change="selectView"><option value="" disabled>标准视角</option><option value="front">正面</option><option value="side">侧面</option><option value="top">俯视</option><option value="fit">适配场景</option></select>
        </div>
        <div class="viewport" :style="{ '--sceneAspect': sceneAspect }">
          <canvas
            :key="canvasKey"
            ref="canvas"
            class="sceneCanvas"
            :class="{ playing }"
            tabindex="0"
            aria-label="导演台场景"
            @pointerdown="rememberPointer"
            @pointermove="moveCameraLook"
            @pointerup="endCameraLook"
            @pointercancel="endCameraLook"
            @click.left="handleCanvasClick"
            @mousedown.right="controlling && addAnchor()"
            @contextmenu.prevent
            @keydown="handleKeyDown"
            @keyup="handleKeyUp"
            @blur="exitControl"
            @wheel.prevent.stop="onStageWheel" />
          <div v-if="guidesVisible" class="compositionGuides" :style="{ '--sceneAspect': sceneAspect }" aria-hidden="true"><i /><i /><i /><i /></div>
          <div v-if="captureFlash" :key="captureFlash" class="captureFlash" aria-hidden="true" @animationend="captureFlash = 0" />
          <div class="viewportInfo">
            <span>{{ playing ? "播放中" : controlling ? "" : viewMode === "camera" ? "点击画面进入取景" : "拖动环绕 · 滚轮缩放" }}</span>
            <span>{{ focalLength.toFixed(0) }} mm</span>
          </div>
          <div v-if="!ready" class="stageLoading">
            <template v-if="loadError"><strong>场景载入失败</strong><span>{{ loadError }}</span><el-button @click="loadScene">重试载入</el-button></template>
            <template v-else><icon-loader-2 class="loadingIcon" :size="24" /><span>正在载入场景</span></template>
          </div>
        </div>
        <div class="playbackBar">
          <el-popover trigger="click" placement="top-start" :width="180">
            <template #reference>
              <el-button :icon="IconSettings" :disabled="!ready || readOnlyReference" aria-label="场景设置">设置</el-button>
            </template>
            <div class="sceneSettingsPanel">
              <div class="settingRow">
                <span>网格</span>
                <el-switch :modelValue="sceneSettings.gridVisible" aria-label="显示网格" @change="sceneSettings = { ...sceneSettings, gridVisible: $event === true }" />
              </div>
              <div class="settingRow">
                <span>天空盒</span>
                <el-switch :modelValue="sceneSettings.skyVisible" aria-label="显示天空盒" @change="sceneSettings = { ...sceneSettings, skyVisible: $event === true }" />
              </div>
              <div class="settingRow"><span>构图辅助线</span><el-switch v-model="guidesVisible" aria-label="构图辅助线" /></div>
            </div>
          </el-popover>
          <div v-if="result" class="timelineControls">
          <el-button
            class="iconButton"
            :icon="playing ? IconPlayerPause : IconPlayerPlay"
            :disabled="!ready || !result"
            text
            :aria-label="playing ? '暂停影片' : '播放影片'"
            @click="togglePlayback" />
          <el-slider
            :modelValue="currentTime"
            :max="result?.duration || 1"
            :step="0.01"
            :showTooltip="false"
            :disabled="!ready || !result"
            aria-label="影片播放进度"
            @pointerdown.capture="pausePlayback"
            @update:modelValue="seekTime" />
          <span class="timeLabel">{{ formatTime(currentTime) }} / {{ formatTime(result?.duration ?? 0) }}</span>
          </div>
          <label class="lensControl">焦距 <input type="number" :value="Math.round(focalLength)" min="6" max="110" step="1" :disabled="!ready || readOnlyReference" aria-label="镜头焦距" @change="setLens" @keydown.enter.stop.prevent="setLens" /> <span>mm</span></label>
          <el-select v-model="aspectRatio" class="aspectSelect" aria-label="画面比例" :disabled="!ready || readOnlyReference">
            <el-option v-for="ratio in ['16:9', '9:16', '4:3', '1:1']" :key="ratio" :label="ratio" :value="ratio" />
          </el-select>
          <el-popover trigger="click" placement="top" :width="340" @beforeEnter="captureLightingReference">
            <template #reference>
              <el-button :icon="IconSun" :disabled="!ready || readOnlyReference" aria-label="光照设置">光照</el-button>
            </template>
            <div class="lightingPanel">
              <div class="lightingRow">
                <span>全局光照 <small>无阴影</small></span>
                <div class="lightingInputs">
                  <el-switch :modelValue="lighting.globalEnabled" aria-label="全局光照" @change="updateLighting({ globalEnabled: $event === true })" />
                  <el-input-number :modelValue="lighting.globalIntensity" :min="0" :max="100" :step="0.1" :precision="2" controlsPosition="right" aria-label="全局光照强度" @update:modelValue="$event != null && updateLighting({ globalIntensity: $event })" />
                </div>
              </div>
              <div class="lightingRow">
                <span>太阳光 <small>有阴影</small></span>
                <el-switch :modelValue="lighting.sunEnabled" aria-label="太阳光" @change="updateLighting({ sunEnabled: $event === true })" />
              </div>
              <template v-if="lighting.sunEnabled">
                <lightDirection v-model:azimuth="lightingDraft.azimuth" v-model:elevation="lightingDraft.elevation" :referenceAzimuth="lightingReference" @change="updateLighting" />
                <div class="lightingRow">
                  <div class="lightingInputs">
                    <span>颜色</span>
                    <el-color-picker :modelValue="lighting.color" :teleported="false" colorFormat="hex" aria-label="太阳光颜色" @change="$event && updateLighting({ color: $event })" />
                  </div>
                  <div class="lightingInputs">
                    <span>强度</span>
                    <el-input-number :modelValue="lighting.intensity" :min="0" :max="100" :step="0.1" :precision="2" controlsPosition="right" aria-label="太阳光强度" @update:modelValue="$event != null && updateLighting({ intensity: $event })" />
                  </div>
                </div>
              </template>
            </div>
          </el-popover>
          <el-button :icon="IconPlus" :disabled="!ready || readOnlyReference" aria-label="保存机位" @click="addAnchor">保存机位</el-button>
          <el-button v-if="anchors.some(anchor => anchor.id === selectedAnchorId) && !readOnlyReference" :disabled="editDisabled" :title="`更新机位：${anchors.find(anchor => anchor.id === selectedAnchorId)?.name || '机位'}`" @click="updateAnchor">更新所选机位</el-button>
          <el-button class="captureButton" type="primary" :icon="IconPhotoPlus" :disabled="!ready || !!exportingImage || editDisabled" :loading="exportingImage === 'currentView'" @click="sendCurrentView">截图到画布</el-button>
          <el-button v-if="result" :icon="IconMovie" :disabled="!ready || exportingVideo || sceneSaving || committing" :loading="exportingVideo" aria-label="导出视频节点" @click="emit('exportVideo', sceneAspect)">
            {{ exportingVideo ? `导出视频 ${exportProgress ?? 0}%` : '导出视频节点' }}
          </el-button>
        </div>
        <div class="controlHint">{{ viewMode === 'director' ? '左键拖动环绕 · 右键拖动平移 · 滚轮缩放 · V / R / S 变换 · F 适配场景' : '拖动转向 / 点击锁定 · WASD 移动 · 空格 / Shift 升降 · 滚轮调焦 · Esc 退出' }}</div>
        <div class="referenceHeader">
          <span>
            机位
            <small>{{ anchors.length }}</small>
          </span>
          <small>{{ anchors.length ? '点击回看 · 拖动手柄排序' : '保存当前构图作为机位' }}</small>
        </div>
        <vue-draggable v-model="anchors" class="referenceList" direction="horizontal" handle=".shotDragHandle" :disabled="!ready || readOnlyReference" :animation="0">
          <div v-for="(anchor, index) in anchors" :key="anchor.id" class="referenceItem" :class="{ selected: activeAnchorId === anchor.id }">
            <button class="referenceImage" type="button" :disabled="!ready || readOnlyReference" :aria-pressed="activeAnchorId === anchor.id" :aria-label="'查看关键帧 ' + (index + 1)" @click="restoreAnchor(anchor)">
              <img v-if="anchorPreviews[anchor.id]" :src="anchorPreviews[anchor.id]" alt="" draggable="false" />
              <icon-camera v-else :size="22" />
              <span>{{ String(index + 1).padStart(2, "0") }}</span>
            </button>
            <button class="shotDragHandle" type="button" :disabled="!ready || readOnlyReference" :aria-label="'调整机位 ' + (index + 1) + ' 顺序'" title="拖动排序，或使用左右方向键" @keydown.left.prevent.stop="moveAnchor(index, -1)" @keydown.right.prevent.stop="moveAnchor(index, 1)"><icon-grip-vertical :size="14" /></button>
            <input class="shotName" :value="anchor.name ?? '机位' + (index + 1)" :disabled="editDisabled" maxlength="80" :aria-label="'机位 ' + (index + 1) + ' 名称'" @change="renameAnchor(anchor, $event)" @blur="renameAnchor(anchor, $event)" />
            <span class="shotAspect">{{ anchor.aspect ?? aspectRatio }}</span>
            <el-button class="removeReference" :disabled="editDisabled" :icon="IconX" text circle :aria-label="'删除关键帧 ' + (index + 1)" @click="removeAnchor(anchor.id)" />
            <el-button class="exportReference" :icon="IconPhotoPlus" text circle size="small" title="导出画布" :disabled="!ready || !!exportingImage || readOnlyReference" :loading="exportingImage === anchor.id" :aria-label="'导出关键帧 ' + (index + 1) + ' 到画布'" @click="emit('exportImage', anchor, getAnchorAspect(anchor), anchor.time ?? currentTime)" />
          </div>
        </vue-draggable>
      </section>
      <aside class="inspectorPanel">
        <div class="inspectorTabs" role="tablist" aria-label="导演台属性与方案" @keydown.left.prevent="moveInspector(-1)" @keydown.right.prevent="moveInspector(1)">
          <button :id="inspectorId + 'PropertiesTab'" type="button" role="tab" :aria-selected="inspectorTab === 'properties'" :aria-controls="inspectorId + 'Properties'" :tabindex="inspectorTab === 'properties' ? 0 : -1" @click="inspectorTab = 'properties'">属性</button>
          <button :id="inspectorId + 'AiTab'" type="button" role="tab" :aria-selected="inspectorTab === 'ai'" :aria-controls="inspectorId + 'Ai'" :tabindex="inspectorTab === 'ai' ? 0 : -1" @click="inspectorTab = 'ai'">AI 方案 <span v-if="plans.length">{{ plans.length }}</span></button>
          <button v-if="!readOnlyReference" :id="inspectorId + 'ProductionTab'" type="button" role="tab" :aria-selected="inspectorTab === 'production'" :aria-controls="inspectorId + 'Production'" :tabindex="inspectorTab === 'production' ? 0 : -1" @click="inspectorTab = 'production'">镜头制作</button>
        </div>
        <objectInspector v-if="inspectorTab === 'properties'" :id="inspectorId + 'Properties'" role="tabpanel" :aria-labelledby="inspectorId + 'PropertiesTab'" :key="canvasKey + selectedObjectId" :object="selectedObject" :disabled="editDisabled" @update="updateObject" @duplicate="duplicateObject" @remove="removeObject" />
      <directorPanel v-show="inspectorTab === 'ai'" :id="inspectorId + 'Ai'" role="tabpanel" :aria-labelledby="inspectorId + 'AiTab'"
        v-model:prompt="prompt"
        v-model:model="model"
        :result="result"
        :referenceCount="anchors.length"
        :plans="plans"
        :selectedPlanId="selectedPlanId"
        :tasks="tasks"
        :initializing="readOnlyReference || sceneSaving || committing || !scene.objectList.length && tasks.some((task) => !task.error)"
        @selectPlan="selectPlan"
        :models="models"
        :modelsLoading="modelsLoading"
        @loadModels="emit('loadModels')"
        @send="emit('generate')"
        @editInstruction="emit('editInstruction', $event)">
        <template #input><slot name="input" /></template>
      </directorPanel>
      <div v-if="inspectorTab === 'production'" :id="inspectorId + 'Production'" class="productionInspector" role="tabpanel" :aria-labelledby="inspectorId + 'ProductionTab'"><slot name="production" :viewAnchor="viewProductionAnchor" :selectedAnchorId="selectedAnchorId" /></div>
      </aside>
    </div>
    <directorTour ref="tour" v-if="tourReady && visible" :root="workspace" />
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElButton, ElDialog, ElMessage, ElSlider, ElSelect, ElOption, ElPopover, ElSwitch, ElColorPicker, ElInputNumber } from "element-plus";
import { IconCube3dSphere, IconCamera, IconLoader2, IconPlayerPause, IconPlayerPlay, IconPlus, IconX, IconMovie, IconPhotoPlus, IconSun, IconSettings, IconArrowBackUp, IconArrowForwardUp, IconHelp, IconArrowsMove, IconRotate, IconResize, IconGripVertical } from "@tabler/icons-vue";
import sceneObjects from "./sceneObjects.vue";
import objectInspector from "./objectInspector.vue";
import directorPanel from "./directorPanel.vue";
import directorTour from "./directorTour.vue";
import lightDirection from "./lightDirection.vue";
import { VueDraggable } from "vue-draggable-plus";
import { Box3, Euler, Object3D, Raycaster, Vector2, Vector3 } from "three";
import { getObjectByThreeJsonId } from "threejson/core";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import type { SceneRuntime } from "threejson/core";
import type { NodeAiModel } from "@toonflow/nodes-scaffold/runtime";
import { applyLighting, applySceneSettings, captureCamera, createMannequinObject, createStage, disposeStage, syncStageObjects, type CameraView, type LightingSettings, type SceneDocument, type SceneSettings } from "./scene";
import { anchorSchema, applyCamera, prepareMotion, sampleMotion, type CameraAnchor } from "./motion";
import { prepareSceneAnimation, type DirectorPlan, type DirectorPlanItem, type DirectorGeneration } from "./sceneAnimation";

const props = defineProps<{
  scene: SceneDocument;
  result?: DirectorPlan;
  plans: DirectorPlanItem[];
  selectedPlanId: string;
  tasks: DirectorGeneration[];
  models: NodeAiModel[];
  modelsLoading: boolean;
  sceneSaving: boolean;
  saveScene: (scene: SceneDocument) => Promise<void>;
  restoreScene: (direction: "undo" | "redo") => Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
  exportingVideo: boolean;
  exportingImage: string;
  exportProgress?: number;
  readOnlyReference?: boolean;
  referenceMediaType?: "image" | "video";
}>();
const emit = defineEmits<{ editInstruction: [value: string]; selectPlan: [id: string]; generate: []; loadModels: []; close: []; exportVideo: [aspect: number]; exportImage: [anchor: CameraAnchor, aspect: number, time: number] }>();
const anchors = defineModel<CameraAnchor[]>("anchors", { default: () => [] });
const lighting = defineModel<LightingSettings>("lighting", { required: true });
const sceneSettings = defineModel<SceneSettings>("sceneSettings", { required: true });
const lightingDraft = ref({ ...lighting.value });
const lightingReference = ref(0);
const prompt = defineModel<string>("prompt", { default: "" });
const model = defineModel<string>("model", { default: "" });
const anchorPreviews = ref<Record<string, string>>({});
const workspace = ref<HTMLElement>();
const canvas = ref<HTMLCanvasElement>();
const canvasKey = ref(0);
const ready = ref(false);
const visible = ref(true);
const manualCamera = ref(true);
const controlling = ref(false);
const playing = ref(false);
const aspectRatio = defineModel<string>("aspectRatio", { default: "16:9" });
const lastView = defineModel<CameraView | undefined>("lastView");
const sceneAspect = computed(() => {
  const [width, height] = aspectRatio.value.split(":").map(Number);
  return width! / height!;
});
const currentTime = ref(0);
const focalLength = ref(0);
const activeAnchorId = ref("");
const selectedAnchorId = ref("");
const captureFlash = ref(0);
const loadError = ref("");
const tour = ref<InstanceType<typeof directorTour>>();
const tourReady = ref(false);
watch(ready, value => { if (value) tourReady.value = true; });
const guidesVisible = ref(false);
const selectedObjectId = ref("");
const selectedObject = computed(() => props.scene.objectList.find(object => object.threeJsonId === selectedObjectId.value));
const inspectorTab = ref("properties");
const inspectorId = `director${crypto.randomUUID()}`;
const mobilePanel = ref("objects");
const viewMode = ref<"director" | "camera">("director");
const transformMode = ref<"translate" | "rotate" | "scale">("translate");
const transformTools = [{ mode: "translate", label: "移动", key: "V", icon: IconArrowsMove }, { mode: "rotate", label: "旋转", key: "R", icon: IconRotate }, { mode: "scale", label: "缩放", key: "S", icon: IconResize }] as const;
const committing = ref(false);
const editDisabled = computed(() => props.readOnlyReference || !ready.value || committing.value || props.sceneSaving || props.exportingVideo || !!props.exportingImage || props.tasks.some(task => !task.error));
let orbit: OrbitControls | undefined;
let gizmo: TransformControls | undefined;
let dragOrigin: { position: Vector3; rotation: Vector3; scale: Vector3 } | undefined;
let fitOnLoad = false;
const pointerStart = new Vector2();
let cameraLook: { id: number; yaw: number; pitch: number } | undefined;
let pointerType = "mouse";
const pressedKeys = new Set<string>();
const moveKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft", "ShiftRight"]);
const focalSteps = [...Array.from({ length: 30 }, (_, index) => index + 6), 40, 45, 50, 55, 60, 65, 70, 80, 90, 100, 110];
const movement = new Vector3();
let runtime: SceneRuntime | undefined;
let loadedScene: SceneDocument | undefined;
let controls: PointerLockControls | undefined;
let scenePlayer: ReturnType<typeof prepareSceneAnimation> | undefined;
let cameraFrames: ReturnType<typeof prepareMotion> | undefined;
let previousFrame = 0;
let loadVersion = 0;
let disposed = false;
let previewPlanId = "";
let pendingProductionAnchor = "";
let thumbnailFrame = 0;

async function selectPlan(id: string) {
  previewPlanId = id;
  emit("selectPlan", id);
  await nextTick();
  previewSelectedPlan();
}

function previewSelectedPlan() {
  if (disposed || !ready.value || !props.result || previewPlanId !== props.selectedPlanId) return;
  previewPlanId = "";
  currentTime.value = 0;
  pausePlayback();
  togglePlayback();
}

async function loadScene() {
  if (!canvas.value) return;
  const previousView = ready.value && runtime ? captureView() : lastView.value;
  const previousTime = currentTime.value;
  const version = ++loadVersion;
  const scene = props.scene;
  loadError.value = "";
  ready.value = false;
  playing.value = false;
  activeAnchorId.value = "";
  exitControl();
  releaseStage();
  canvasKey.value = version;
  try {
    await nextTick();
    if (disposed || version !== loadVersion || !canvas.value) return;
    const next = await createStage(canvas.value, scene, updateFrame, sceneAspect.value, lighting.value, sceneSettings.value);
    if (disposed || version !== loadVersion) return disposeStage(next);
    runtime = next;
    loadedScene = scene;
    updateAspect();
    orbit = new OrbitControls(runtime.camera, canvas.value);
    orbit.target.set(scene.sceneConfig.controls.target.x, scene.sceneConfig.controls.target.y, scene.sceneConfig.controls.target.z);
    orbit.minDistance = .2;
    orbit.maxDistance = 500;
    orbit.addEventListener("start", () => {
      if (!manualCamera.value && runtime && orbit) {
        orbit.target.copy(runtime.camera.getWorldDirection(new Vector3()).multiplyScalar(Math.max(1, runtime.camera.position.distanceTo(orbit.target))).add(runtime.camera.position));
      }
      pausePlayback(); manualCamera.value = true; activeAnchorId.value = "";
    });
    orbit.addEventListener("change", () => runtime?.invalidate());
    gizmo = new TransformControls(runtime.camera, canvas.value);
    runtime.scene.add(gizmo.getHelper());
    gizmo.addEventListener("change", () => runtime?.invalidate());
    gizmo.addEventListener("mouseDown", () => {
      pausePlayback(); manualCamera.value = true;
      const object = gizmo?.object;
      if (object) dragOrigin = { position: object.position.clone(), rotation: new Vector3(object.rotation.x, object.rotation.y, object.rotation.z), scale: object.scale.clone() };
      if (orbit) orbit.enabled = false;
    });
    gizmo.addEventListener("mouseUp", () => { void commitTransform(); });
    controls = new PointerLockControls(runtime.camera, canvas.value);
    controls.addEventListener("change", () => runtime?.invalidate());
    controls.addEventListener("lock", () => {
      controlling.value = true;
      activeAnchorId.value = "";
    });
    controls.addEventListener("unlock", () => {
      controlling.value = false;
      pressedKeys.clear();
    });
    setAnimation();
    applyLighting(runtime, lighting.value);
    refreshThumbnails();
    sampleTime();
    runtime.start();
    if (previousView) {
      currentTime.value = Math.min(props.result?.duration ?? 0, previousTime);
      scenePlayer?.setTime(currentTime.value);
      applyCamera(runtime.camera, previousView);
      orbit.target.set(previousView.controls.target.x, previousView.controls.target.y, previousView.controls.target.z);
    }
    orbit.update();
    manualCamera.value = true;
    ready.value = true;
    if (props.readOnlyReference && props.referenceMediaType !== "video" && anchors.value[0]) restoreAnchor(anchors.value[0]);
    if (props.readOnlyReference && props.referenceMediaType === "video" && props.result) { currentTime.value = 0; scenePlayer?.setTime(0); const view = props.result.cameraFrames[0]!.view; applyCamera(runtime.camera, view); orbit.target.set(view.controls.target.x, view.controls.target.y, view.controls.target.z); orbit.update(); }
    focalLength.value = runtime.camera.getFocalLength();
    if (pendingProductionAnchor) viewProductionAnchor(pendingProductionAnchor);
    if (fitOnLoad) { fitOnLoad = false; fitScene(); }
    updateNavigation();
    attachGizmo();
    previewSelectedPlan();
  } catch (error) {
    if (!disposed && version === loadVersion) {
      releaseStage();
      loadError.value = error instanceof Error ? error.message : "场景载入失败，请重试";
    }
  }
}

function setAnimation() {
  if (!runtime) return;
  pausePlayback();
  exitControl();
  activeAnchorId.value = "";
  scenePlayer?.dispose();
  scenePlayer = undefined;
  cameraFrames = undefined;
  if (props.result) {
    scenePlayer = prepareSceneAnimation(runtime, props.result);
    cameraFrames = prepareMotion(props.result.cameraFrames);
  }
  currentTime.value = 0;
  previousFrame = performance.now();
  manualCamera.value = false;
  sampleTime();
}

function updateFrame() {
  if (playing.value || controlling.value || pressedKeys.size) runtime?.invalidate();
  const now = performance.now();
  const elapsed = Math.max(0, (now - previousFrame) / 1000);
  previousFrame = now;
  if (playing.value && props.result) {
    currentTime.value = Math.min(props.result.duration, currentTime.value + elapsed);
    sampleTime();
    if (currentTime.value >= props.result.duration) playing.value = false;
  }
  if (!runtime || !controls || viewMode.value !== "camera" || !pressedKeys.size) return;
  movement
    .set(
      Number(pressedKeys.has("KeyD")) - Number(pressedKeys.has("KeyA")),
      Number(pressedKeys.has("Space")) - Number(pressedKeys.has("ShiftLeft") || pressedKeys.has("ShiftRight")),
      Number(pressedKeys.has("KeyW")) - Number(pressedKeys.has("KeyS"))
    )
    .normalize()
    .multiplyScalar(Math.min(elapsed, 0.05) * 8);
  runtime.camera.updateMatrixWorld();
  controls.moveForward(movement.z);
  controls.moveRight(movement.x);
  runtime.camera.position.y += movement.y;
}

function sampleTime() {
  runtime?.invalidate();
  scenePlayer?.setTime(currentTime.value);
  if (runtime && !manualCamera.value && cameraFrames) sampleMotion(runtime.camera, cameraFrames, currentTime.value);
  if (runtime) focalLength.value = runtime.camera.getFocalLength();
}

async function toggleControl() {
  if (!ready.value || !canvas.value || editDisabled.value) return;
  if (controlling.value) return exitControl();
  pausePlayback();
  manualCamera.value = true;
  canvas.value.focus({ preventScroll: true });
  if (!document.hasFocus()) return void ElMessage.info("当前窗口未获得焦点，可拖动画面转向，WASD 移动");
  try {
    await canvas.value.requestPointerLock();
  } catch (error) {
    if (!disposed) ElMessage.info("当前窗口无法锁定鼠标，可拖动画面转向，WASD 移动");
  }
}
function exitControl() {
  pressedKeys.clear();
  cameraLook = undefined;
  controlling.value = false;
  if (document.pointerLockElement === canvas.value) document.exitPointerLock();
}
function handleKeyDown(event: KeyboardEvent) {
  if (event.code === "Escape") {
    event.preventDefault();
    return exitControl();
  }
  if (viewMode.value !== "camera" || editDisabled.value || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || !moveKeys.has(event.code)) return;
  event.preventDefault();
  event.stopPropagation();
  pressedKeys.add(event.code);
  runtime?.invalidate();
}
function handleKeyUp(event: KeyboardEvent) {
  if (moveKeys.has(event.code)) {
    event.preventDefault();
    pressedKeys.delete(event.code);
  }
}
function changeFocalLength(event: WheelEvent) {
  if (!runtime || !event.deltaY) return;
  pausePlayback();
  manualCamera.value = true;
  const current = runtime.camera.getFocalLength();
  const next =
    event.deltaY < 0
      ? focalSteps.find((value) => value > current + 0.000001) ?? focalSteps.at(-1)!
      : focalSteps.findLast((value) => value < current - 0.000001) ?? focalSteps[0]!;
  runtime.camera.setFocalLength(next);
  focalLength.value = runtime.camera.getFocalLength();
  activeAnchorId.value = "";
  runtime.invalidate();
}
function setLens(event: Event) {
  if (!runtime || !ready.value) return;
  const input = event.target as HTMLInputElement;
  if (!input.value || !input.checkValidity() || !Number.isFinite(input.valueAsNumber)) { input.value = String(Math.round(focalLength.value)); return; }
  pausePlayback();
  manualCamera.value = true;
  runtime.camera.setFocalLength(input.valueAsNumber);
  focalLength.value = runtime.camera.getFocalLength();
  activeAnchorId.value = "";
  runtime.invalidate();
}
function pausePlayback() {
  playing.value = false;
}
function togglePlayback() {
  exitControl();
  if (!ready.value || !props.result) return;
  if (playing.value) return pausePlayback();
  exitControl();
  manualCamera.value = false;
  if (currentTime.value >= props.result.duration) currentTime.value = 0;
  activeAnchorId.value = "";
  sampleTime();
  previousFrame = performance.now();
  playing.value = true;
}
function seekTime(value: number | number[]) {
  pausePlayback();
  exitControl();
  manualCamera.value = false;
  activeAnchorId.value = "";
  currentTime.value = Math.max(0, Math.min(props.result?.duration ?? 0, Array.isArray(value) ? value[0]! : value));
  sampleTime();
}
function formatTime(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

function updateAspect() {
  if (!runtime) return;
  setRenderAspect(sceneAspect.value);
  focalLength.value = runtime.camera.getFocalLength();
}
function setRenderAspect(aspect: number) {
  if (!runtime) return;
  runtime.renderer.setSize(Math.round(960 * Math.min(1, aspect)), Math.round(960 / Math.max(1, aspect)), false);
  runtime.camera.aspect = aspect;
  runtime.camera.updateProjectionMatrix();
  focalLength.value = runtime.camera.getFocalLength();
}
watch(sceneAspect, updateAspect);

function captureThumbnail() {
  if (!runtime) return "";
  const helper = gizmo?.getHelper();
  const helperVisible = helper?.visible;
  if (helper) helper.visible = false;
  const thumbnail = document.createElement("canvas");
  thumbnail.width = 192;
  thumbnail.height = Math.round(192 / runtime.camera.aspect);
  const size = runtime.renderer.getSize(new Vector2());
  try {
    runtime.renderer.setSize(thumbnail.width, thumbnail.height, false);
    runtime.renderer.render(runtime.scene, runtime.camera);
    thumbnail.getContext("2d")!.drawImage(runtime.renderer.domElement, 0, 0, thumbnail.width, thumbnail.height);
    return thumbnail.toDataURL("image/jpeg", 0.75);
  } finally {
    runtime.renderer.setSize(size.x, size.y, false);
    if (helper && helperVisible != null) helper.visible = helperVisible;
    runtime.invalidate();
  }
}
function refreshThumbnails() {
  cancelAnimationFrame(thumbnailFrame);
  const pending = [...anchors.value];
  // 每帧只刷新一个小图；保留旧图直到替换，输入和主画面无需等待整组机位截图。
  function refreshNext() {
    if (!runtime || disposed || !pending.length) { thumbnailFrame = 0; return; }
    if (!playing.value && !controlling.value && !gizmo?.dragging) {
      const anchor = pending.shift()!;
      if (anchors.value.some(item => item.id === anchor.id)) {
        const view = captureCamera(runtime);
        try {
          scenePlayer?.setTime(anchor.time ?? 0);
          applyCamera(runtime.camera, anchor);
          runtime.camera.aspect = getAnchorAspect(anchor);
          runtime.camera.updateProjectionMatrix();
          anchorPreviews.value[anchor.id] = captureThumbnail();
        } finally {
          scenePlayer?.setTime(currentTime.value);
          runtime.camera.aspect = sceneAspect.value;
          applyCamera(runtime.camera, view);
          runtime.invalidate();
        }
      }
    }
    thumbnailFrame = pending.length ? requestAnimationFrame(refreshNext) : 0;
  }
  thumbnailFrame = requestAnimationFrame(refreshNext);
}
function captureLightingReference() {
  pausePlayback();
  exitControl();
  if (!runtime) return;
  const forward = runtime.camera.getWorldDirection(new Vector3());
  // 俯拍或仰拍时从镜头右方向取水平朝向，避免正前方投影接近零。
  const right = new Vector3(1, 0, 0).applyQuaternion(runtime.camera.quaternion);
  const angle = Math.hypot(forward.x, forward.z) > 0.0001 ? Math.atan2(-forward.x, -forward.z) : Math.atan2(-right.z, right.x);
  lightingReference.value = (angle * 180 / Math.PI + 360) % 360;
}
function updateLighting(value: Partial<LightingSettings>) {
  lighting.value = { ...lighting.value, ...value };
}
watch(lighting, value => {
  lightingDraft.value = { ...value };
  if (!runtime) return;
  applyLighting(runtime, value);
  refreshThumbnails();
});
watch(sceneSettings, value => {
  if (!runtime) return;
  applySceneSettings(runtime, value);
  refreshThumbnails();
});
// 拖动时只更新灯光，松手后再保存参数并重新生成缩略图。
watch(() => [lightingDraft.value.azimuth, lightingDraft.value.elevation], ([azimuth, elevation]) => {
  if (runtime) applyLighting(runtime, { ...lighting.value, azimuth: azimuth!, elevation: elevation! });
});
function addAnchor() {
  if (!ready.value || !runtime || props.readOnlyReference) return;
  if (anchors.value.length >= 100) return void ElMessage.warning("最多记录 100 个关键帧");
  pausePlayback();
  const anchor = anchorSchema.parse({ ...captureView(), time: currentTime.value, name: `机位${nextShotNumber()}`, aspect: aspectRatio.value });
  anchorPreviews.value[anchor.id] = captureThumbnail();
  anchors.value = [...anchors.value, anchor];
  activeAnchorId.value = anchor.id;
  selectedAnchorId.value = anchor.id;
  captureFlash.value++;
}
function restoreAnchor(anchor: CameraAnchor) {
  if (!runtime || !ready.value) return;
  pausePlayback();
  selectedAnchorId.value = anchor.id;
  exitControl();
  manualCamera.value = true;
  if (anchor.aspect) aspectRatio.value = anchor.aspect;
  if (anchor.time !== undefined) { currentTime.value = Math.min(props.result?.duration ?? 0, anchor.time); scenePlayer?.setTime(currentTime.value); }
  applyCamera(runtime.camera, anchor);
  orbit?.target.set(anchor.controls.target.x, anchor.controls.target.y, anchor.controls.target.z);
  orbit?.update();
  runtime.invalidate();
  focalLength.value = runtime.camera.getFocalLength();
  activeAnchorId.value = anchor.id;
  if (!anchorPreviews.value[anchor.id]) anchorPreviews.value[anchor.id] = captureThumbnail();
}
function viewProductionAnchor(id: string) { if (!ready.value) { pendingProductionAnchor = id; return; } pendingProductionAnchor = ""; const anchor = anchors.value.find(anchor => anchor.id === id); if (anchor) restoreAnchor(anchor); }
function removeAnchor(id: string) {
  delete anchorPreviews.value[id];
  anchors.value = anchors.value.filter((anchor) => anchor.id !== id);
  if (activeAnchorId.value === id) activeAnchorId.value = "";
}
function moveAnchor(index: number, offset: number) {
  const target = index + offset;
  if (!ready.value || target < 0 || target >= anchors.value.length) return;
  const reordered = [...anchors.value];
  const [anchor] = reordered.splice(index, 1);
  reordered.splice(target, 0, anchor!);
  anchors.value = reordered;
}

function getAnchorAspect(anchor: CameraAnchor) {
  const [width, height] = (anchor.aspect ?? aspectRatio.value).split(":").map(Number);
  return width! / height!;
}
function captureView() {
  const view = captureCamera(runtime!);
  if (orbit && viewMode.value === "director") {
    const { x, y, z } = orbit.target;
    view.controls.target = { x, y, z };
  }
  return view;
}
function moveInspector(step: number) { const tabs = props.readOnlyReference ? ["properties", "ai"] as const : ["properties", "ai", "production"] as const; void switchInspector(tabs[(tabs.indexOf(inspectorTab.value as "properties" | "ai") + step + tabs.length) % tabs.length]!); }
async function switchInspector(tab: "properties" | "ai" | "production") {
  inspectorTab.value = tab;
  await nextTick();
  workspace.value?.querySelector<HTMLButtonElement>(`.inspectorTabs [aria-selected="true"]`)?.focus();
}
function nextShotNumber() {
  return Math.max(0, ...anchors.value.map((anchor, index) => Number(/^机位(\d+)$/.exec(anchor.name ?? "")?.[1] ?? index + 1))) + 1;
}
function updateAnchor() { if (editDisabled.value || !runtime || !selectedAnchorId.value) return; const id = selectedAnchorId.value; const view = captureView(); anchors.value = anchors.value.map(anchor => anchor.id === id ? anchorSchema.parse({ ...anchor, ...view, aspect: aspectRatio.value, time: currentTime.value }) : anchor); activeAnchorId.value = id; anchorPreviews.value[id] = captureThumbnail(); }
function renameAnchor(anchor: CameraAnchor, event: Event) {
  const name = (event.target as HTMLInputElement).value.trim().slice(0, 80) || "未命名机位";
  if (name === (anchor.name ?? "")) return;
  anchors.value = anchors.value.map(item => item.id === anchor.id ? { ...item, name } : item);
}
function sendCurrentView() {
  if (!ready.value || !runtime || editDisabled.value) return;
  pausePlayback();
  exitControl();
  const anchor = anchorSchema.parse({ ...captureView(), id: "currentView", name: "当前取景", aspect: aspectRatio.value, time: currentTime.value });
  emit("exportImage", anchor, sceneAspect.value, currentTime.value);
  captureFlash.value++;
}
function updateNavigation() {
  if (orbit) orbit.enabled = ready.value && viewMode.value === "director" && !playing.value && !gizmo?.dragging;
  if (gizmo) gizmo.enabled = !editDisabled.value && !playing.value && viewMode.value === "director";
}
function attachGizmo() {
  if (!runtime || !gizmo) return;
  const object = selectedObject.value?.visible !== false && selectedObjectId.value ? getObjectByThreeJsonId(selectedObjectId.value, runtime.scene) : undefined;
  if (!object || editDisabled.value || playing.value || viewMode.value !== "director") gizmo.detach();
  else { gizmo.attach(object); gizmo.setMode(transformMode.value); }
  runtime.invalidate();
}
function selectObject(id: string) {
  if (editDisabled.value) return;
  pausePlayback();
  selectedObjectId.value = id;
  inspectorTab.value = "properties";
  mobilePanel.value = "properties";
  attachGizmo();
}
function rememberPointer(event: PointerEvent) {
  pointerStart.set(event.clientX, event.clientY);
  pointerType = event.pointerType;
  if (!runtime || !canvas.value || viewMode.value !== "camera" || controlling.value || editDisabled.value || event.button !== 0) return;
  pausePlayback(); manualCamera.value = true;
  canvas.value.focus({ preventScroll: true });
  const rotation = new Euler().setFromQuaternion(runtime.camera.quaternion, "YXZ");
  cameraLook = { id: event.pointerId, yaw: rotation.y, pitch: rotation.x };
  canvas.value.setPointerCapture(event.pointerId);
}
function moveCameraLook(event: PointerEvent) {
  if (!runtime || !cameraLook || cameraLook.id !== event.pointerId || controlling.value) return;
  const yaw = cameraLook.yaw - (event.clientX - pointerStart.x) * .004;
  const pitch = Math.max(-Math.PI / 2 + .01, Math.min(Math.PI / 2 - .01, cameraLook.pitch - (event.clientY - pointerStart.y) * .004));
  runtime.camera.quaternion.setFromEuler(new Euler(pitch, yaw, 0, "YXZ"));
  activeAnchorId.value = "";
  runtime.invalidate();
}
function endCameraLook(event: PointerEvent) {
  if (canvas.value?.hasPointerCapture(event.pointerId)) canvas.value.releasePointerCapture(event.pointerId);
  cameraLook = undefined;
}
function handleCanvasClick(event: MouseEvent) {
  if (viewMode.value === "camera") {
    if (pointerType === "touch" || pointerStart.distanceTo(new Vector2(event.clientX, event.clientY)) > 5) return;
    return void toggleControl();
  }
  if (!runtime || !canvas.value || editDisabled.value || gizmo?.axis || pointerStart.distanceTo(new Vector2(event.clientX, event.clientY)) > 5) return;
  const rect = canvas.value.getBoundingClientRect();
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), runtime.camera);
  const roots = props.scene.objectList.filter(object => object.visible !== false).flatMap(object => {
    const model = getObjectByThreeJsonId(object.threeJsonId, runtime!.scene);
    return model ? [model] : [];
  });
  let object: Object3D | null | undefined = raycaster.intersectObjects(roots, true)[0]?.object;
  while (object && !roots.includes(object)) object = object.parent;
  const id = props.scene.objectList.find(item => getObjectByThreeJsonId(item.threeJsonId, runtime!.scene) === object)?.threeJsonId;
  selectObject(id ?? "");
}
function setViewMode(mode: "director" | "camera") {
  pausePlayback(); exitControl(); manualCamera.value = true; viewMode.value = mode;
  if (runtime && orbit) {
    const target = runtime.camera.getWorldDirection(new Vector3()).multiplyScalar(Math.max(1, runtime.camera.position.distanceTo(orbit.target))).add(runtime.camera.position);
    orbit.target.copy(target); orbit.update();
  }
  updateNavigation(); attachGizmo();
}
function onStageWheel(event: WheelEvent) {
  if (viewMode.value === "camera") changeFocalLength(event);
}
function setTransformMode(mode: "translate" | "rotate" | "scale") { transformMode.value = mode; gizmo?.setMode(mode); }
function selectView(event: Event) {
  const select = event.target as HTMLSelectElement;
  fitScene(select.value);
  select.value = "";
}
function fitScene(view = "fit") {
  if (!runtime || !orbit) return;
  pausePlayback(); exitControl(); manualCamera.value = true;
  const bounds = new Box3();
  for (const object of props.scene.objectList) {
    const model = getObjectByThreeJsonId(object.threeJsonId, runtime.scene);
    if (model && object.visible !== false) bounds.expandByObject(model);
  }
  const center = bounds.isEmpty() ? new Vector3(0, .9, 0) : bounds.getCenter(new Vector3());
  const size = bounds.isEmpty() ? 2 : Math.max(1, bounds.getSize(new Vector3()).length());
  const distance = size / (2 * Math.tan(runtime.camera.fov * Math.PI / 360)) * Math.max(1, 1 / sceneAspect.value) * 1.2;
  const direction = view === "front" ? new Vector3(0, 0, 1) : view === "side" ? new Vector3(1, 0, 0) : view === "top" ? new Vector3(0, 1, .001) : new Vector3(1, .65, 1.4).normalize();
  runtime.camera.position.copy(center).addScaledVector(direction, distance);
  orbit.target.copy(center); orbit.update();
  focalLength.value = runtime.camera.getFocalLength(); activeAnchorId.value = "";
  runtime.invalidate();
}
async function commitScene(next: SceneDocument) {
  if (editDisabled.value) return;
  committing.value = true;
  pausePlayback(); exitControl();
  try { await props.saveScene(next); }
  catch (error) {
    ElMessage.error(`场景未保存：${error instanceof Error ? error.message : "请重试"}`);
    await loadScene();
  } finally { committing.value = false; updateNavigation(); attachGizmo(); }
}
async function updateObject(object: SceneDocument["objectList"][number]) {
  await commitScene({ ...props.scene, objectList: props.scene.objectList.map(item => item.threeJsonId === object.threeJsonId ? object : item) });
}
function addObject(type: string) {
  if (editDisabled.value) return;
  const count = type === "crowd" ? 9 : 1;
  if (props.scene.objectList.length + count > 200) return void ElMessage.warning("场景最多包含 200 个对象");
  const names: Record<string, string> = { box: "立方体", sphere: "球体", cylinder: "圆柱", plane: "平面", mannequin: "关节人偶", crowd: "群众" };
  const added = Array.from({ length: count }, (_, index) => {
    const object = createMannequinObject(crypto.randomUUID());
    const name = names[type];
    if (!name) throw new Error("不支持的模型类型");
    object.name = name + (props.scene.objectList.filter(item => (item.name ?? "").startsWith(name)).length + index + 1);
    if (type === "crowd") object.position = { x: (index % 3 - 1) * 1.6, y: 0, z: Math.floor(index / 3) * 1.6 };
    else if (type !== "mannequin") {
      object.objType = type as "box" | "sphere" | "cylinder" | "plane";
      object.geometry = type === "box" ? { width: 1, height: 1, depth: 1 } : type === "sphere" ? { radius: .5, widthSegments: 24, heightSegments: 16 } : type === "cylinder" ? { radiusTop: .5, radiusBottom: .5, height: 1, radialSegments: 24 } : { width: 8, height: 8 };
      object.position.y = type === "plane" ? -.02 : .5;
      if (type === "plane") object.rotation = { rotationX: -Math.PI / 2, rotationY: 0, rotationZ: 0 };
      object.material.color = "#909096";
    }
    return object;
  });
  fitOnLoad = !props.scene.objectList.length;
  selectedObjectId.value = added[0]!.threeJsonId;
  void commitScene({ ...props.scene, objectList: [...props.scene.objectList, ...added] });
}
function toggleObject(id: string) {
  const object = props.scene.objectList.find(item => item.threeJsonId === id);
  if (object) void updateObject({ ...object, visible: object.visible === false });
}
function duplicateObject() {
  if (!selectedObject.value || editDisabled.value) return;
  if (props.scene.objectList.length >= 200) return void ElMessage.warning("场景最多包含 200 个对象");
  const object = JSON.parse(JSON.stringify(selectedObject.value)) as SceneDocument["objectList"][number];
  object.threeJsonId = crypto.randomUUID(); object.name = `${object.name || object.objType} 副本`.slice(0, 100); object.position.x += 1;
  selectedObjectId.value = object.threeJsonId;
  void commitScene({ ...props.scene, objectList: [...props.scene.objectList, object] });
}
function removeObject() {
  if (!selectedObject.value || editDisabled.value) return;
  void commitScene({ ...props.scene, objectList: props.scene.objectList.filter(item => item.threeJsonId !== selectedObjectId.value) });
}
async function restoreHistory(direction: "undo" | "redo") {
  if (editDisabled.value || (direction === "undo" ? !props.canUndo : !props.canRedo)) return;
  committing.value = true;
  pausePlayback(); exitControl();
  try { await props.restoreScene(direction); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : "场景恢复失败"); }
  finally { committing.value = false; }
}
async function commitTransform() {
  const origin = dragOrigin; dragOrigin = undefined;
  const object = gizmo?.object;
  const source = selectedObject.value;
  if (!object || !source || !origin) return;
  const position = { x: source.position.x + object.position.x - origin.position.x, y: source.position.y + object.position.y - origin.position.y, z: source.position.z + object.position.z - origin.position.z };
  const rotation = { rotationX: (source.rotation?.rotationX ?? 0) + object.rotation.x - origin.rotation.x, rotationY: (source.rotation?.rotationY ?? 0) + object.rotation.y - origin.rotation.y, rotationZ: (source.rotation?.rotationZ ?? 0) + object.rotation.z - origin.rotation.z };
  const scale = { scaleX: Math.max(.01, (source.scale?.scaleX ?? 1) * object.scale.x / (origin.scale.x || 1)), scaleY: Math.max(.01, (source.scale?.scaleY ?? 1) * object.scale.y / (origin.scale.y || 1)), scaleZ: Math.max(.01, (source.scale?.scaleZ ?? 1) * object.scale.z / (origin.scale.z || 1)) };
  if (object.position.distanceTo(origin.position) < .00001 && new Vector3(object.rotation.x, object.rotation.y, object.rotation.z).distanceTo(origin.rotation) < .00001 && object.scale.distanceTo(origin.scale) < .00001) return updateNavigation();
  await updateObject({ ...source, position, rotation, scale });
}
function handleWorkspaceKey(event: KeyboardEvent) {
  const target = event.target as HTMLElement;
  if (target.closest("input, textarea, select, [contenteditable='true']") || event.isComposing || controlling.value) return;
  if ((event.ctrlKey || event.metaKey) && event.code === "KeyZ") {
    event.preventDefault(); event.stopPropagation(); void restoreHistory(event.shiftKey ? "redo" : "undo"); return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.code;
  if (!["KeyV", "KeyR", "KeyS", "KeyF", "KeyT", "KeyY", "Delete"].includes(key)) return;
  event.preventDefault(); event.stopPropagation();
  if (key === "KeyF") fitScene();
  else if (key === "KeyT") fitScene("top");
  else if (key === "KeyY") fitScene("front");
  else if (key === "Delete") removeObject();
  else setTransformMode(key === "KeyV" ? "translate" : key === "KeyR" ? "rotate" : "scale");
}

function closeEditor() {
  if (committing.value || props.sceneSaving) return void ElMessage.info("场景正在保存，请稍候");
  if (props.exportingVideo || props.exportingImage) return void ElMessage.info("参考或媒体正在导出，请完成后再关闭");
  pausePlayback();
  exitControl();
  if (runtime && ready.value) lastView.value = captureView();
  visible.value = false;
}
function releaseStage() {
  cancelAnimationFrame(thumbnailFrame);
  thumbnailFrame = 0;
  orbit?.dispose(); orbit = undefined;
  if (gizmo) { gizmo.detach(); runtime?.scene.remove(gizmo.getHelper()); gizmo.dispose(); gizmo = undefined; }
  controls?.dispose();
  controls = undefined;
  scenePlayer?.dispose();
  scenePlayer = undefined;
  cameraFrames = undefined;
  if (runtime) disposeStage(runtime);
  runtime = undefined;
}
function blurEditor() {
  pausePlayback();
  exitControl();
}
watch([currentTime, playing, controlling, sceneAspect, focalLength, activeAnchorId], () => runtime?.invalidate());
watch([playing, viewMode, editDisabled, selectedObjectId], () => { updateNavigation(); attachGizmo(); });
watch(
  () => [props.scene, props.result],
  () => {
    if (!ready.value || !runtime || !loadedScene) return void loadScene();
    try {
      if (props.scene !== loadedScene) {
        const view = captureView();
        const time = currentTime.value;
        pausePlayback();
        gizmo?.detach();
        scenePlayer?.dispose();
        scenePlayer = undefined;
        if (!syncStageObjects(runtime, loadedScene, props.scene)) return void loadScene();
        loadedScene = props.scene;
        setAnimation();
        currentTime.value = Math.min(props.result?.duration ?? 0, time);
        sampleTime();
        applyCamera(runtime.camera, view);
        orbit?.target.set(view.controls.target.x, view.controls.target.y, view.controls.target.z);
        manualCamera.value = true;
        if (!selectedObject.value) selectedObjectId.value = "";
        if (fitOnLoad) { fitOnLoad = false; fitScene(); }
        attachGizmo();
        refreshThumbnails();
        return;
      }
      setAnimation();
      refreshThumbnails();
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "动画载入失败");
      void loadScene();
    }
  },
  { flush: "post" }
);
onMounted(() => {
  if (!["16:9", "9:16", "4:3", "1:1"].includes(aspectRatio.value)) aspectRatio.value = "16:9";
  anchors.value = anchors.value.map((anchor) => anchorSchema.parse(anchor));
  emit("loadModels");
  window.addEventListener("blur", blurEditor);
  document.addEventListener("visibilitychange", blurEditor);
});
onBeforeUnmount(() => {
  disposed = true;
  ++loadVersion;
  blurEditor();
  releaseStage();
  window.removeEventListener("blur", blurEditor);
  document.removeEventListener("visibilitychange", blurEditor);
});
</script>

<style lang="scss" scoped>
.sceneSettingsPanel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;

  .settingRow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
}
.lightingPanel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: min(440px, calc(100dvh - 80px));
  overflow-x: hidden;
  overflow-y: auto;
  font-size: 13px;
  color: var(--el-text-color-regular);

  .lightingRow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;

    .el-input-number {
      width: 100px;
    }

    .lightingInputs {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    small {
      margin-left: 4px;
      color: var(--el-text-color-secondary);
      font-size: 11px;
    }
  }
}
.directorHeader {
  display: flex; align-items: center; gap: 10px; color: var(--el-text-color-primary); font-size: 15px;
  small { font-size: 12px; font-weight: 400; color: var(--el-text-color-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .headerActions { display: flex; gap: 2px; margin-left: auto; margin-right: 36px; .el-button { margin: 0; width: 32px; padding: 7px; } }
}
.mobilePanels { display: none; }
.directorWorkspace {
  display: grid; grid-template-columns: 210px minmax(0, 1fr) 290px; gap: 0; height: min(860px, calc(100dvh - 100px)); min-height: 0; color: var(--el-text-color-regular);
  .inspectorPanel { display: flex; flex-direction: column; min-width: 0; min-height: 0; border-left: 1px solid var(--el-border-color);
    .productionInspector { min-height: 0; flex: 1; overflow: auto; }
    .inspectorTabs { display: flex; gap: 22px; padding: 0 16px; border-bottom: 1px solid var(--el-border-color);
      button { position: relative; background: transparent; border: 0; color: var(--el-text-color-secondary); font: inherit; font-size: 12px; padding: 14px 0; cursor: pointer;
        &[aria-selected="true"] { color: var(--el-text-color-primary); &::after { position: absolute; content: ""; left: 0; right: 0; bottom: 0; height: 2px; background: currentColor; } }
      }
    }
    :deep(.directorPanel) { padding: 16px; flex: 1; min-height: 0; }
  }
  .stagePanel { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 0 16px 16px;
    .stageToolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 9px 0 14px; font-size: 11px;
      button, select { border: 1px solid var(--el-border-color); border-radius: calc(var(--ui-radius, 8px) * 0.625); color: var(--el-text-color-regular); background: var(--el-bg-color); padding: 7px; font: inherit; cursor: pointer; }
      button[aria-pressed="true"] { background: var(--el-fill-color-dark); color: var(--el-text-color-primary); }
      button:disabled { opacity: .5; cursor: not-allowed; }
      .viewModes, .transformTools { display: flex; gap: 4px; }
      .transformTools { margin-left: auto; button { display: grid; place-items: center; width: 30px; height: 30px; } }
    }
    .viewport { position: relative; display: grid; place-items: center; container-type: size; flex: 1; min-height: 180px; overflow: hidden; background: #151517;
      .sceneCanvas, .captureFlash, .compositionGuides { width: min(100cqw, calc(100cqh * var(--sceneAspect))); height: min(100cqh, calc(100cqw / var(--sceneAspect))); }
      .sceneCanvas { display: block; object-fit: contain; touch-action: none; outline-offset: -2px; &.playing { outline: 2px solid var(--el-text-color-primary); } &:focus-visible { outline: 2px solid #fff; } }
      .captureFlash { position: absolute; inset: 0; margin: auto; background: #fff; opacity: 0; pointer-events: none; animation: directorCapture 280ms ease-out; }
      .compositionGuides { position: absolute; inset: 0; margin: auto; pointer-events: none;
        i { position: absolute; display: block; background: #ffffff70; &:nth-child(1) { width: 1px; height: 100%; left: 33.333%; } &:nth-child(2) { width: 1px; height: 100%; left: 66.667%; } &:nth-child(3) { height: 1px; width: 100%; top: 33.333%; } &:nth-child(4) { height: 1px; width: 100%; top: 66.667%; } }
      }
      .viewportInfo { position: absolute; top: 12px; left: 12px; right: 12px; display: flex; justify-content: space-between; gap: 10px; color: #fff; font-size: 11px; text-shadow: 0 1px 4px #000; pointer-events: none; font-variant-numeric: tabular-nums; }
      .stageLoading { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 12px; align-items: center; justify-content: center; padding: 20px; text-align: center; overflow-wrap: anywhere; background: var(--el-bg-color-overlay); color: var(--el-text-color-regular); font-size: 12px; .loadingIcon { animation: directorLoading 1s linear infinite; } }
    }
    .playbackBar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 0 8px; flex-shrink: 0;
      .timelineControls { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; }
      .lensControl { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--el-text-color-regular);
        input { width: 58px; height: 32px; box-sizing: border-box; border: 1px solid var(--el-border-color); border-radius: calc(var(--ui-radius, 8px) * 0.625); padding: 0 5px; color: var(--el-text-color-primary); background: var(--el-bg-color); font: inherit; font-variant-numeric: tabular-nums; }
        span { color: var(--el-text-color-secondary); }
      }
      .captureButton { margin-left: auto; }
      .iconButton { width: 28px; height: 28px; padding: 0; margin: 0; }
      .el-slider { flex: 1; min-width: 70px; --el-slider-height: 4px; --el-slider-button-size: 12px; }
      .timeLabel { color: var(--el-text-color-secondary); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .aspectSelect { width: 82px; flex-shrink: 0; }
      > .el-button { margin: 0; padding: 8px; font-size: 11px; }
    }
    .controlHint { color: var(--el-text-color-secondary); font-size: 11px; line-height: 1.6; }
    .referenceHeader { display: flex; justify-content: space-between; align-items: center; padding: 16px 0 10px; font-size: 12px; color: var(--el-text-color-regular); small { color: var(--el-text-color-secondary); font-size: 11px; margin-left: 4px; } }
    .referenceList { display: flex; gap: 10px; min-height: 116px; max-height: 116px; flex-shrink: 0; overflow-x: auto; padding: 3px; scrollbar-width: thin; scrollbar-color: var(--el-border-color) transparent;
      .referenceItem { position: relative; flex: 0 0 140px; height: 104px; border: 1px solid var(--el-border-color); border-radius: calc(var(--ui-radius, 8px) * 0.75); overflow: hidden;
        &.selected { border-color: var(--el-text-color-primary); }
        .referenceImage { position: relative; display: flex; align-items: center; justify-content: center; width: 140px; height: 72px; border: 0; padding: 0; background: var(--el-fill-color); color: var(--el-text-color-regular); cursor: pointer;
          img { width: 100%; height: 100%; object-fit: contain; } span { position: absolute; bottom: 5px; left: 7px; color: #fff; background: #0009; padding: 1px 4px; border-radius: calc(var(--ui-radius, 8px) * 0.375); font-size: 10px; }
        }
        .shotName { width: 100px; height: 32px; margin: 0; padding: 0 7px; box-sizing: border-box; border: 0; background: var(--el-bg-color); color: var(--el-text-color-regular); font: inherit; font-size: 12px; }
        .shotAspect { font-size: 10px; color: var(--el-text-color-secondary); }
        .shotDragHandle { position: absolute; top: 3px; left: 3px; display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: var(--ui-radius-small, 4px); background: var(--el-bg-color-overlay); color: var(--el-text-color-primary); cursor: grab; touch-action: none; &:active { cursor: grabbing; } }
        .removeReference, .exportReference { position: absolute; right: 3px; width: 24px; height: 24px; padding: 0; margin: 0; background: var(--el-bg-color-overlay); color: var(--el-text-color-primary); opacity: 1; }
        .removeReference { top: 3px; } .exportReference { top: 35px; }
      }
    }
  }
  :is(button, select, input):focus-visible { outline: 2px solid var(--el-text-color-primary); outline-offset: 2px; }
  ::selection { background: var(--el-text-color-primary); color: var(--el-bg-color); }
}
@keyframes directorCapture { from { opacity: .55; } to { opacity: 0; } }
@keyframes directorLoading { to { transform: rotate(360deg); } }
@media (max-width: 1200px) { .directorWorkspace { grid-template-columns: 180px minmax(0, 1fr) 260px; .stagePanel { padding-left: 12px; padding-right: 12px; } } }
@media (max-width: 900px) {
  .directorHeader small { display: none; }
  .mobilePanels { display: flex; gap: 20px; padding: 4px 12px 14px; button { padding: 5px 0; background: transparent; border: 0; border-bottom: 2px solid transparent; font: inherit; font-size: 12px; color: var(--el-text-color-secondary); &[aria-pressed="true"] { color: var(--el-text-color-primary); border-bottom-color: currentColor; } } }
  .directorWorkspace { grid-template-columns: 1fr; grid-template-rows: max-content max-content; height: calc(100dvh - 150px); overflow-y: auto; scrollbar-width: thin;
    > :deep(.sceneObjects), .inspectorPanel { display: none; border: 0; min-height: 270px; }
    &.mobileobjects > :deep(.sceneObjects) { display: flex; grid-row: 2; }
    &.mobileproperties .inspectorPanel, &.mobileai .inspectorPanel, &.mobileproduction .inspectorPanel { display: flex; }
    .stagePanel { grid-row: 1; min-height: 0; padding: 0 12px 12px;
      .stageToolbar { .transformTools { margin-left: 0; } }
      .viewport { flex: none; height: 220px; min-height: 200px; }
      .referenceList { min-height: 104px; }
    }
    .inspectorPanel .inspectorTabs { display: none; }
    .inspectorPanel :deep(.directorPanel) { min-height: 350px; }
  }
}
@media (prefers-reduced-motion: reduce) { .directorWorkspace .stagePanel .viewport { .stageLoading .loadingIcon { animation: none; } .captureFlash { animation: none; display: none; } } }
</style>

<style lang="scss">
.directorDialog {
  --el-color-primary: var(--el-text-color-primary);
  --el-color-primary-light-3: var(--el-text-color-regular);
  --el-color-primary-light-9: var(--el-fill-color);
  --el-color-primary-dark-2: var(--el-text-color-primary);
  padding: 0; border-radius: var(--ui-radius-large, 12px);
  .el-dialog__header { padding: 16px 20px; margin: 0; border-bottom: 1px solid var(--el-border-color); }
  .el-dialog__body { padding: 0; }
  .el-dialog__headerbtn { top: 12px; right: 12px; }
  .el-button--primary { color: var(--el-bg-color); }
  .el-switch { --el-switch-on-color: var(--el-text-color-primary); }
  @media (max-width: 900px) { margin: 12px auto; .el-dialog__header { padding: 14px 12px; } }
}
</style>
