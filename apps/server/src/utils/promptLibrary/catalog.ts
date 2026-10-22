export const planningPrompts = [
  { id: "builtinPlanning0", title: "山河入梦", kind: "场景设计", mode: "image", text: "创作一幅东方奇幻山水场景：层叠青山、云海与临水村落，黄昏暖光，电影感构图。先帮我完善画面提示词。" },
  { id: "builtinPlanning1", title: "雨夜的来信", kind: "电影分镜", mode: "video", text: "策划一支 30 秒短片：雨夜城市，一位旅人收到一封迟来的信。请拆解为连贯分镜，写出景别、运镜和情绪变化。" },
  { id: "builtinPlanning2", title: "为故事配一段声音", kind: "音乐构思", mode: "audio", text: "为一段清晨山间旅行短片设计音乐：温暖、安静、有希望，以钢琴和弦乐为主，时长 30 秒。先整理音乐生成提示词。" },
  { id: "builtinPlanning3", title: "建立角色档案", kind: "角色设计", mode: "image", text: "帮我设计一位东方奇幻故事的旅行者，整理年龄、外观、服饰、性格与标志物，并生成保持角色一致性的提示词。" },
  { id: "builtinPlanning4", title: "从产品到短片", kind: "广告策划", mode: "video", text: "帮我策划一支产品短片。请先询问产品、目标受众和时长，再输出创意方向、分镜与生成提示词。" },
  { id: "builtinPlanning5", title: "把灵感展开", kind: "故事创作", mode: "home", text: "我想从一个灵感开始创作故事。请先引导我确定主角、目标和冲突，再帮我在画布上组织角色、场景和分镜。" },
] as const;

export const creationPrompts = [
  { id: "builtinCreation0", title: "电影感场景", text: "东方山水之间的临水村落，黄昏暖光穿过云层，远处青山层叠，前景旅人站在石桥上，电影感构图，细腻材质，真实光影。", mode: "image" },
  { id: "builtinCreation1", title: "角色概念设计", text: "设计一位东方奇幻故事中的年轻旅人，朴素布衣与皮革行囊，全身正面立绘，背景干净，服装层次清晰，统一柔和光线。", mode: "image" },
  { id: "builtinCreation2", title: "旁白文本", text: "清晨，第一缕阳光越过山脊。新的旅程，从这一刻开始。", mode: "audio" },
  { id: "builtinCreation3", title: "音乐提示词（需音乐模型）", text: "温暖安静的钢琴与弦乐，缓慢展开的旋律，为清晨山间旅行短片配乐，无人声。", mode: "audio" },
  { id: "builtinCreation4", title: "雨夜城市", text: "雨夜城市街道，镜头缓慢向前推进，一位旅人撑伞走过暖色橱窗，雨水反射灯光，远景到中景，动作自然连贯，电影质感。", mode: "video" },
  { id: "builtinCreation5", title: "山间晨光", text: "清晨山间薄雾，镜头从树叶间缓慢升起，展现群山与河流，阳光逐渐照亮村庄，平稳运镜，宁静温暖的情绪。", mode: "video" },
] as const;
