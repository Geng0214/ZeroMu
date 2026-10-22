import type { ProjectRecord, ShotRecord } from "./schema";

type References = ShotRecord["references"];
export function referenceState(recorded: References | undefined, current: References) {
  if (recorded === undefined) return "unknown" as const;
  const signature = (references: References) => JSON.stringify(references.map(reference => [reference.assetId, reference.versionId, reference.role ?? ""]));
  return signature(recorded) === signature(current) ? "same" as const : "changed" as const;
}
export function candidateReferenceState(shot: Pick<ShotRecord, "references">, candidate: ProjectRecord["candidates"][number]) {
  return referenceState(candidate.basis.shotReferences, shot.references);
}
export function assetImpact(project: ProjectRecord, assetId: string) {
  const asset = project.assets.find(item => item.assetId === assetId);
  if (!asset) throw Object.assign(new Error("素材不存在"), { status: 404 });
  const versions = new Map(project.assetVersions.map(version => [version.versionId, version]));
  const candidates = new Map(project.candidates.map(candidate => [candidate.candidateId, candidate]));
  const uses = project.candidates.filter(item => versions.get(item.versionId)?.assetId === assetId || [...item.basis.references, ...(item.basis.shotReferences ?? [])].some(reference => reference.assetId === assetId));
  const candidateIds = new Set(uses.map(item => item.candidateId));
  const directorShots = new Set(project.directorShots.filter(item => [item.sceneVersionId, item.referenceVersionId].some(id => versions.get(id ?? "")?.assetId === assetId)).map(item => item.shotId));
  const shots = new Map(project.shots.map(shot => [shot.shotId, shot]));
  return {
    revision: project.revision, asset, versions: project.assetVersions.filter(item => item.assetId === assetId),
    shots: project.shots.filter(shot => directorShots.has(shot.shotId) || shot.references.some(reference => reference.assetId === assetId) || shot.candidateIds.some(id => candidateIds.has(id))),
    referenceShots: project.shots.flatMap(shot => {
      const references = shot.references.filter(reference => reference.assetId === assetId); if (!references.length) return [];
      const adopted = candidates.get(shot.adoptedCandidateId ?? "");
      return [{ shotId: shot.shotId, sequenceId: shot.sequenceId, title: shot.title, archived: !!shot.archived, references, adoptedCandidateId: shot.adoptedCandidateId, adoptedReferenceState: adopted ? candidateReferenceState(shot, adopted) : undefined }];
    }),
    candidateUses: uses.map(candidate => ({ candidateId: candidate.candidateId, shotId: candidate.shotId, title: shots.get(candidate.shotId)?.title ?? "历史镜头", versionId: candidate.versionId, adopted: shots.get(candidate.shotId)?.adoptedCandidateId === candidate.candidateId })),
    draftIds: project.storyboardDrafts.filter(draft => draft.shots.some(shot => shot.references.some(reference => reference.assetId === assetId))).map(draft => draft.draftId),
    exportIds: project.exports.filter(item => item.edit.clips.some(clip => candidateIds.has(clip.candidateId)) || item.edit.audio.some(audio => versions.get(audio.versionId)?.assetId === assetId)).map(item => item.exportId),
  };
}
export type AssetImpact = ReturnType<typeof assetImpact>;
