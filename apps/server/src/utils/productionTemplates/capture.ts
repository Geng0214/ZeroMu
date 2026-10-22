import { z } from "zod";
import { readProject } from "@/utils/production/format";
import { productionTemplateSchema, type ProductionTemplate } from "./schema";
import { templateFailure } from "./plan";

export const captureOptionsSchema = z.strictObject({ includeNames: z.boolean(), includeStory: z.boolean(), includePrompts: z.boolean(), includeAssetText: z.boolean(), includeModelHints: z.boolean(), fallbackMediaType: z.enum(["image", "video", "audio"]) });
export async function captureTemplate(directory: string, sequenceId: string, expectedRevision: number, rawOptions: unknown) {
  const options = captureOptionsSchema.parse(rawOptions);
  const project = await readProject(directory);
  if (!project) templateFailure("请先建立项目制作记录", 404);
  if (project.revision !== expectedRevision) templateFailure("制作记录已更新，请刷新后重新提取");
  const sequence = project.sequences.find(item => item.sequenceId === sequenceId && !item.archived);
  if (!sequence) templateFailure("制作单元不存在或已归档", 404);
  const shots = sequence.shotIds.map(id => project.shots.find(shot => shot.shotId === id && !shot.archived)!);
  if (!shots.length || shots.length > 200) templateFailure("请选择包含 1 至 200 个活动镜头的制作单元", 400);
  const usedAssets = [...new Set(shots.flatMap(shot => shot.references.map(reference => reference.assetId)))];
  const assetKeys = new Map(usedAssets.map((id, index) => [id, `asset${index + 1}`]));
  const versionKeys = new Map<string, string>();
  for (const assetId of usedAssets) [...new Set(shots.flatMap(shot => shot.references.filter(reference => reference.assetId === assetId).map(reference => reference.versionId)))].forEach((id, index) => versionKeys.set(id, `version${index + 1}`));
  const assets: ProductionTemplate["example"]["assets"] = usedAssets.map((assetId, index) => {
    const asset = project.assets.find(item => item.assetId === assetId)!;
    return { key: assetKeys.get(assetId)!, name: options.includeNames ? asset.name : `参考素材${index + 1}`, kind: asset.kind, versions: project.assetVersions.filter(version => version.assetId === assetId && versionKeys.has(version.versionId)).map(version => ({ key: versionKeys.get(version.versionId)!, ...(version.parentVersionId && versionKeys.has(version.parentVersionId) ? { parentKey: versionKeys.get(version.parentVersionId) } : {}), text: options.includeAssetText ? version.text : "", description: options.includeAssetText ? version.description : "补充本次创作的参考资料" })) };
  });
  const mediaInputs: ProductionTemplate["mediaInputs"] = [];
  for (const version of project.assetVersions.filter(version => versionKeys.has(version.versionId))) {
    const types = [...new Set(version.files.map(file => file.mimeType.split("/")[0]).filter((type): type is "image" | "video" | "audio" => type === "image" || type === "video" || type === "audio"))];
    for (const type of types) mediaInputs.push({ key: `media${mediaInputs.length + 1}`, label: `${assets.find(asset => asset.key === assetKeys.get(version.assetId))!.name} · ${type}参考`, description: "请选择新项目中的文件；原项目媒体、路径与凭据不会复制到模板文件", mediaType: type, assetKey: assetKeys.get(version.assetId)!, versionKey: versionKeys.get(version.versionId)!, required: false });
  }
  const modelSlots: ProductionTemplate["modelSlots"] = [];
  const warnings: string[] = [];
  const templateShots: ProductionTemplate["example"]["shots"] = shots.map((shot, index) => {
    const candidate = project.candidates.find(item => item.candidateId === shot.adoptedCandidateId) ?? project.candidates.findLast(item => item.shotId === shot.shotId);
    const version = project.assetVersions.find(item => item.versionId === candidate?.versionId);
    const file = candidate?.fileIndex !== undefined ? version?.files[candidate.fileIndex] : version?.files.find(file => /^(image|video|audio)\//.test(file.mimeType));
    const category = file?.mimeType.split("/")[0];
    const type = category === "image" || category === "video" || category === "audio" ? category : options.fallbackMediaType;
    if (!file) warnings.push(`镜头${index + 1}没有可判断媒体类型的候选，采用本次指定的${type}类型，请核对`);
    const hint = options.includeModelHints ? candidate?.basis.request?.modelId : undefined;
    let slot = modelSlots.find(item => item.mediaType === type && item.suggestedModelId === hint);
    if (!slot) { slot = { key: `model${modelSlots.length + 1}`, label: `${{ image: "图片", video: "视频", audio: "音频" }[type]}创作${modelSlots.length + 1}`, mediaType: type, purpose: "应用时重新映射到实际可用渠道；历史模型只作为可选提示", ...(hint ? { suggestedModelId: hint } : {}) }; modelSlots.push(slot); }
    return { key: `shot${index + 1}`, title: options.includeNames ? shot.title : `镜头${index + 1}`, prompt: options.includePrompts && candidate?.basis.request?.prompt ? candidate.basis.request.prompt : `创作要求：{{brief}}。请补全并核对镜头${index + 1}的具体动作、景别与参考。`, modelSlotKey: slot.key, expectedDuration: shot.expectedDuration, story: options.includeStory ? shot.story : "待填写本镜头剧情", dialogue: options.includeStory ? shot.dialogue : "", references: shot.references.map(reference => ({ assetKey: assetKeys.get(reference.assetId)!, versionKey: versionKeys.get(reference.versionId)!, role: options.includeNames ? reference.role ?? "参考" : "参考" })) };
  });
  const definition = productionTemplateSchema.parse({ title: options.includeNames ? sequence.name : "从制作单元提取的模板", description: "保留镜头结构与参考版本关系。输入和模型须在新项目中重新确认；不包含生成成品。", tags: [], inputs: [{ key: "brief", label: "本次创作要求", defaultValue: "", required: true }], mediaInputs,
    workflow: [{ title: "确认本次输入", description: "补充创作要求、人物与场景资料，并核对各镜头。" }, { title: "重新映射模型", description: "选择目标渠道的实际模型；核对模式、参考能力、时长、声音与费用后再生成。" }, { title: "比较与交付", description: "逐镜头比较候选并明确采用，再进入剪辑与导出。" }], modelSlots, example: { name: options.includeNames ? sequence.name : "独立制作单元", output: sequence.output, assets, shots: templateShots, generationNodes: [] } });
  return { definition, sourceSummary: { shotCount: shots.length, adoptedCount: shots.filter(shot => shot.adoptedCandidateId).length, completedExportCount: project.exports.filter(record => record.edit.sequenceId === sequenceId && record.status === "completed").length }, warnings };
}
