export type DirectorReference = {
  directorShotId: string; shotId: string; sceneVersionId: string; createdAt: number;
  canvasId?: string; nodeId?: string; anchorId?: string; name?: string; stateHash?: string;
  mediaType?: "image" | "video"; referenceVersionId?: string; status?: "pending" | "completed"; stale?: boolean;
};
export type DirectorProductionContext = {
  projectId: string | null; revision?: number;
  shots: { shotId: string; title: string; story: string; dialogue: string }[];
  bindings: { anchorId: string; shotId: string }[];
  states: { anchorId: string; stateHash: string }[];
  references: DirectorReference[];
};
export type DirectorCapture = DirectorReference & {
  projectId: string; snapshot: unknown;
  file?: { path: string; mimeType: string; hash: string };
  referenceNodeId: string; imageNodeId: string; videoNodeId: string; previewNodeId: string;
};
export type DirectorCaptureJob = { captureId: string; createdAt: number; anchorId: string; shotId: string; stateHash: string; mediaType: "image" | "video"; mediaPath?: string; mediaHash?: string };
export type DirectorProductionBridge = {
  context(nodeId: string): Promise<DirectorProductionContext>;
  bind(nodeId: string, anchorId: string, shotId?: string): Promise<void>;
  reserve(nodeId: string, job: DirectorCaptureJob): Promise<DirectorCapture>;
  capture(captureId: string): Promise<DirectorCapture>;
  finish(captureId: string, mediaPath: string, mediaHash: string): Promise<DirectorCapture>;
  prepare(captureId: string, mediaType: "image" | "video"): Promise<void>;
  flush(): Promise<void>;
};
