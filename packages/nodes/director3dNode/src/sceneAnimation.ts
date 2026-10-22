import { z } from "@toonflow/nodes-scaffold/runtime";
import { AnimationClip, AnimationMixer, Euler, LoopOnce, Quaternion, QuaternionKeyframeTrack, VectorKeyframeTrack } from "three";
import { getObjectByThreeJsonId, type SceneRuntime } from "threejson/core";
import { sceneSchema, updateSunShadow, type SceneDocument } from "./scene";
import { cameraFramesSchema } from "./motion";
import { mannequinJoints } from "./mannequin";

const vector = sceneSchema.shape.objectList.element.shape.position;
export const directorPlanSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  duration: z.number().min(0.2).max(300),
  tracks: z.array(z.strictObject({
    objectId: z.string().trim().min(1).max(100),
    joint: z.enum(mannequinJoints).describe("仅人偶关节动画填写；不填时控制整个物体").optional(),
    frames: z.array(z.strictObject({
      time: z.number().min(0).max(300),
      position: vector.optional(),
      rotation: vector.describe("XYZ 欧拉角，单位为弧度"),
      scale: vector.optional(),
    })).min(2).max(120),
  })).max(200),
  cameraFrames: cameraFramesSchema,
}).superRefine((value, context) => {
  // 最后一个镜头保持到结束，无需重复添加结束帧；单帧表示固定镜头。
  if (value.cameraFrames[0]?.time !== 0 || value.cameraFrames.some(frame => frame.time > value.duration)) {
    context.addIssue({ code: "custom", path: ["cameraFrames"], message: "镜头时间必须从 0 开始，且不超过方案时长" });
  }
  const trackIds = new Set<string>();
  let frameCount = 0;
  value.tracks.forEach((track, index) => {
    const key = JSON.stringify([track.objectId, track.joint]);
    if (trackIds.has(key)) {
      context.addIssue({ code: "custom", path: ["tracks", index, "objectId"], message: "同一物体或关节只能有一条轨道" });
    }
    trackIds.add(key);
    if (track.joint && track.frames.some(frame => frame.position || frame.scale)) {
      context.addIssue({ code: "custom", path: ["tracks", index, "frames"], message: "关节动画仅填写 rotation，位置和缩放由骨架固定" });
    }
    frameCount += track.frames.length;
    if (track.frames[0]?.time !== 0 || track.frames.some((frame, frameIndex) => frame.time > value.duration || (frameIndex > 0 && frame.time <= track.frames[frameIndex - 1]!.time))) {
      context.addIssue({ code: "custom", path: ["tracks", index, "frames"], message: "关键帧时间必须从 0 开始、严格递增，且不超过场景时长" });
    }
  });
  if (frameCount > 2000) context.addIssue({ code: "custom", path: ["tracks"], message: "场景动画最多包含 2000 个关键帧" });
});
export type DirectorPlan = z.infer<typeof directorPlanSchema>;
export type DirectorPlanItem = DirectorPlan & { id: string; instruction?: string };
export type DirectorGeneration = { id: string; instruction: string; error?: string };

// 手动改变布景基准时，保留动画的相对位移、转角与缩放，撤销快照同时包含这些轨道。
export function rebaseScenePlans(plans: DirectorPlanItem[], previous: SceneDocument, next: SceneDocument): DirectorPlanItem[] {
  return plans.map(plan => ({ ...plan, tracks: plan.tracks.flatMap(track => {
    const before = previous.objectList.find(object => object.threeJsonId === track.objectId);
    const after = next.objectList.find(object => object.threeJsonId === track.objectId);
    if (!after) return [];
    if (!before) return [track];
    const axes = ["x", "y", "z"] as const;
    const oldRotation = track.joint ? before.pose?.[track.joint] : { x: before.rotation?.rotationX ?? 0, y: before.rotation?.rotationY ?? 0, z: before.rotation?.rotationZ ?? 0 };
    const newRotation = track.joint ? after.pose?.[track.joint] : { x: after.rotation?.rotationX ?? 0, y: after.rotation?.rotationY ?? 0, z: after.rotation?.rotationZ ?? 0 };
    return [{ ...track, frames: track.frames.map(frame => {
      const rotation = { ...frame.rotation };
      for (const axis of axes) rotation[axis] += (newRotation?.[axis] ?? 0) - (oldRotation?.[axis] ?? 0);
      if (track.joint) return { ...frame, rotation };
      const position = frame.position && { ...frame.position };
      const scale = frame.scale && { ...frame.scale };
      for (const axis of axes) {
        if (position) position[axis] += after.position[axis] - before.position[axis];
        const field = `scale${axis.toUpperCase()}` as "scaleX" | "scaleY" | "scaleZ";
        if (scale) scale[axis] *= (after.scale?.[field] ?? 1) / (before.scale?.[field] || 1);
      }
      return { ...frame, rotation, ...(position && { position }), ...(scale && { scale }) };
    }) }];
  }) }));
}

export function prepareSceneAnimation(runtime: SceneRuntime, value: DirectorPlan) {
  const { name, duration, tracks: sourceTracks, cameraFrames } = value;
  const animation = directorPlanSchema.parse({ name, duration, tracks: sourceTracks, cameraFrames });
  const tracks = animation.tracks.flatMap(track => {
    const root = getObjectByThreeJsonId(track.objectId, runtime.scene);
    if (!root) throw new Error(`场景中找不到动画物体：${track.objectId}`);
    if (track.joint && root.userData.objJson?.objType !== "mannequin") throw new Error(`只有人偶支持关节动画：${track.objectId}`);
    const object = track.joint ? root.getObjectByName(track.joint) : root;
    if (!object) throw new Error(`场景中找不到人偶关节：${track.joint}`);
    const times = track.frames.map(frame => frame.time);
    return [
      new QuaternionKeyframeTrack(`${object.uuid}.quaternion`, times, track.frames.flatMap(frame => new Quaternion().setFromEuler(new Euler(frame.rotation.x, frame.rotation.y, frame.rotation.z)).toArray())),
      ...(["position", "scale"] as const).filter(property => track.frames.some(frame => frame[property])).map(property =>
        new VectorKeyframeTrack(`${object.uuid}.${property}`, times, track.frames.flatMap(frame => {
          const value = frame[property] ?? object[property];
          return [value.x, value.y, value.z];
        })),
      ),
    ];
  });
  const mixer = new AnimationMixer(runtime.scene);
  const clip = new AnimationClip(animation.name, animation.duration, tracks);
  const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  return {
    setTime(time: number) {
      if (!Number.isFinite(time)) throw new Error("场景动画时间无效");
      // LoopOnce 到终点会自动暂停；再次定位到任意时间前恢复采样。
      action.paused = false;
      mixer.setTime(Math.min(animation.duration, Math.max(0, time)));
      updateSunShadow(runtime);
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(runtime.scene);
    },
  };
}
