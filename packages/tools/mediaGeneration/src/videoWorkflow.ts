import type { MediaModel } from "@toonflow/tools-scaffold/runtime";

/** 制作方法路由不声明模型能力；执行参数仍取实际渠道返回值。 */
export function videoWorkflowFor(model: MediaModel) {
  const match = /(?:^|[\/_-])seedance[-_.]2[._-](0|5)(?=$|[-_./])/i.exec(model.modelId);
  const selection = { providerId: model.providerId, modelId: model.modelId };
  if (match) return {
    selection, model, workflow: { family: "seedance" as const, version: match[1] === "0" ? "2.0" as const : "2.5" as const, skillName: "workflow", path: "SKILL.md", section: "Seedance 提示词生成的内嵌执行核心" },
    note: "仅选择内置专项规则；时长、分辨率、参考与声音以此渠道实际能力为准。专项规则与能力冲突时停止受影响的生成，不替换模型。",
  };
  return {
    selection, model, workflow: { family: "generalVideo" as const, skillName: "workflow", path: "references/generalVideo.md" },
    note: "所选模型 ID 未匹配内置 Seedance 2.0/2.5 专项，使用通用视频分支。渠道别名不能仅凭显示名称认作 Seedance；不得由此猜测任何生成能力。",
  };
}
