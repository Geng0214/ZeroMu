import { isDeepStrictEqual } from "node:util";
import { createVersion, readProjectFile, stableId, verifyVersion } from "./index";
import type { ProjectRecord } from "./schema";
import { applicationInput, applicationHash, prepareTemplate, freezeTemplateInputs, writeFrozenFile, templateFolder, templateDigest, templateFailure } from "../productionTemplates/plan";
import type { ApplyTemplateOperation } from "../productionTemplates/schema";

export async function existingTemplateApplication(directory: string, project: ProjectRecord, operation: ApplyTemplateOperation) {
  const prior = project.templateApplications?.find(item => item.applicationId === operation.applicationId);
  if (!prior) return undefined;
  const { type: _type, previewFingerprint: _fingerprint, ...raw } = operation;
  if (prior.inputHash !== applicationHash(applicationInput(raw))) templateFailure("此模板应用编号已用于不同内容，请保留项目并创建新的独立应用");
  for (const id of prior.versionIds) {
    const version = project.assetVersions.find(item => item.versionId === id);
    if (!version) templateFailure("已应用模板的固定版本缺失，请保留项目并恢复备份", 422);
    await verifyVersion(directory, version);
  }
  return prior;
}
export async function applyTemplate(directory: string, project: ProjectRecord, operation: ApplyTemplateOperation) {
  const { type: _type, previewFingerprint: _fingerprint, ...raw } = operation;
  const plan = await prepareTemplate(directory, project, applicationInput(raw));
  if (plan.preview.previewFingerprint !== operation.previewFingerprint) templateFailure("模型配置或参考文件已改变，请保留输入并重新预览");
  await freezeTemplateInputs(directory, plan);
  const { input, rendered, preview } = plan;
  const idFor = (key: string) => stableId(`${input.applicationId}:${key}`);
  const assetId = (key: string) => idFor(`asset:${key}`);
  const versionId = (assetKey: string, key: string) => idFor(`version:${assetKey}:${key}`);
  const sequenceId = idFor("sequence");
  const nodes: { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }[] = [];
  const edges: { id: string; source: string; target: string; sourceHandle: string; targetHandle: string }[] = [];
  const referenceNodes = new Map<string, { id: string; handle: string }[]>();
  const newVersions: ProjectRecord["assetVersions"] = [];
  let referenceIndex = 0;
  for (const asset of rendered.example.assets) {
    for (const version of asset.versions) {
      const text = version.text || version.description || "参考资料待补充";
      const stagedText = `${templateFolder(input.applicationId)}/text${asset.key}.${version.key}.md`;
      await writeFrozenFile(directory, stagedText, text);
      const media = rendered.mediaInputs.filter(item => item.assetKey === asset.key && item.versionKey === version.key).flatMap(item => preview.media.filter(file => file.key === item.key));
      const created = await createVersion(directory, { type: "createAssetVersion", assetId: assetId(asset.key), parentVersionId: version.parentKey ? versionId(asset.key, version.parentKey) : undefined, files: [{ path: stagedText, mimeType: "text/markdown", view: "文字资料" }, ...media.map(file => ({ path: file.stagedPath, mimeType: file.mimeType }))], text: version.text, description: version.description, details: {}, source: "import" }, { versionId: versionId(asset.key, version.key), createdAt: input.createdAt });
      if (created.files[0]?.hash !== templateDigest(text) || media.some((item, index) => created.files[index + 1]?.hash !== item.hash)) templateFailure("固定参考副本与预览内容不一致，请保留目录检查");
      await verifyVersion(directory, created); newVersions.push(created);
      const linked = [{ id: idFor(`text:${asset.key}:${version.key}`), handle: "text" }];
      const textPath = `assets/${linked[0]!.id}/content.md`;
      await writeFrozenFile(directory, textPath, text);
      nodes.push({ id: linked[0]!.id, type: "remote-textNode", position: { x: 0, y: referenceIndex++ * 320 }, data: { label: `${asset.name} · ${version.key}`, textPath, outputs: { text: { dataType: "STRING", value: text } } } });
      for (const [index, item] of media.entries()) {
        const type = rendered.mediaInputs.find(input => input.key === item.key)!.mediaType;
        const id = idFor(`media:${item.key}`); linked.push({ id, handle: type });
        nodes.push({ id, type: `remote-${type}Node`, position: { x: 350, y: (referenceIndex++ - 1) * 320 }, data: { label: `${asset.name} · ${type}参考`, outputs: { [type]: { dataType: type.toUpperCase(), value: { url: created.files[index + 1]!.path, mimeType: item.mimeType } } } } });
      }
      referenceNodes.set(`${asset.key}:${version.key}`, linked);
    }
  }
  for (const [index, node] of [...rendered.example.shots, ...rendered.example.generationNodes].entries()) {
    const slot = rendered.modelSlots.find(slot => slot.key === node.modelSlotKey)!;
    const mapping = input.mappings.find(item => item.slotKey === slot.key)!;
    const id = idFor(`node:${node.key}`);
    nodes.push({ id, type: `remote-${slot.mediaType}Node`, position: { x: 850, y: index * 450 }, data: { label: node.title, prompt: node.prompt, promptModel: [[{ type: "Write", text: node.prompt }]], model: mapping.deferred ? "" : JSON.stringify([mapping.providerId, mapping.modelId]), outputs: {}, ...(slot.mediaType === "image" ? { n: 1 } : {}) } });
    const seen = new Set<string>();
    for (const reference of node.references) for (const source of referenceNodes.get(`${reference.assetKey}:${reference.versionKey}`) ?? []) {
      if (seen.has(source.id)) continue;
      seen.add(source.id); edges.push({ id: idFor(`edge:${source.id}:${id}`), source: source.id, target: id, sourceHandle: source.handle, targetHandle: "in" });
    }
  }
  const canvas = { toonflowCanvas: true, nodes, edges, viewport: { x: 40, y: 40, zoom: 0.7 } };
  const canvasText = JSON.stringify(canvas, null, 2);
  await writeFrozenFile(directory, preview.canvasId, canvasText);
  // 原子制作记录是提交点；中断副本只接受相同应用编号与相同内容，未覆盖既有画布。
  if (!isDeepStrictEqual(JSON.parse((await readProjectFile(directory, preview.canvasId)).toString("utf8")), canvas)) templateFailure("待完成模板的画布已改变，请保留画布并核对原草稿");
  const fresh = await prepareTemplate(directory, project, input);
  if (fresh.preview.previewFingerprint !== preview.previewFingerprint) templateFailure("应用期间模型配置或参考文件已改变，请重新预览后继续");
  project.assets.push(...rendered.example.assets.map(asset => ({ assetId: assetId(asset.key), name: asset.name, kind: asset.kind, versionIds: asset.versions.map(version => versionId(asset.key, version.key)), activeVersionId: versionId(asset.key, asset.versions.at(-1)!.key) })));
  project.assetVersions.push(...newVersions);
  project.canvases.push({ canvasId: preview.canvasId, name: rendered.example.name });
  const shotIds = rendered.example.shots.map(shot => idFor(`shot:${shot.key}`));
  project.sequences.push({ sequenceId, name: rendered.example.name, shotIds, output: rendered.example.output });
  project.shots.push(...rendered.example.shots.map(shot => ({ shotId: idFor(`shot:${shot.key}`), sequenceId, title: shot.title, story: shot.story, dialogue: shot.dialogue, expectedDuration: shot.expectedDuration, canvasId: preview.canvasId, nodeId: idFor(`node:${shot.key}`), references: shot.references.map(reference => ({ assetId: assetId(reference.assetKey), versionId: versionId(reference.assetKey, reference.versionKey), role: reference.role })), candidateIds: [] })));
  project.templateApplications ??= [];
  project.templateApplications.push({ applicationId: input.applicationId, inputHash: preview.inputHash, previewFingerprint: preview.previewFingerprint, title: rendered.title, createdAt: input.createdAt, sequenceId, canvasId: preview.canvasId, versionIds: newVersions.map(version => version.versionId), mappings: input.mappings });
  return sequenceId;
}
