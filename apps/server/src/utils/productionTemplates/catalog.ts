import type { ProductionTemplate } from "./schema";

const input = (key: string, label: string, defaultValue: string) => ({ key, label, defaultValue, required: true });
const reference = (assetKey: string, role: string) => ({ assetKey, versionKey: "base", role });
const asset = (key: string, name: string, kind: "character" | "scene" | "prop", text: string) => ({ key, name, kind, versions: [{ key: "base", text, description: "先核对身份、外观与空间，再补充参考文件" }] });
const media = (key: string, label: string, assetKey: string) => ({ key, label, description: "可选择目标项目中的图片，应用时复制为独立固定版本", mediaType: "image" as const, assetKey, versionKey: "base", required: false });
const workflow = [
  { title: "确认输入与参考", description: "填写故事或商品信息，核对人物、场景和参考版本。此范例只提供制作结构，未包含生成成品。" },
  { title: "选择实际模型", description: "把模型位置映射到本机已配置渠道，或明确选择稍后配置。目录不代表连接、价格或质量已验收。" },
  { title: "逐镜头创作与比较", description: "先核对节点的生成模式、参考能力、时长、声音与费用；生成候选并比较后明确采用。" },
  { title: "检查成片", description: "核对镜头衔接、对白、音乐与字幕，再进入剪辑导出。" },
];
const videoSlot = { key: "video", label: "镜头视频", mediaType: "video" as const, purpose: "根据已确认的镜头描述创作视频；生成时长与模式须按实际模型配置" };
const imageSlot = { key: "image", label: "分镜图片", mediaType: "image" as const, purpose: "按角色、场景和镜头要求创作图片，先确认参考图数量与尺寸能力" };

const dialogue: ProductionTemplate = {
  title: "双人对话", description: "以八个镜头组织建立空间、正反打与收束。结构范例，无生成成品。", tags: ["对话", "正反打"],
  inputs: [input("nameA", "人物甲", "林岚"), input("nameB", "人物乙", "陈牧"), input("scene", "对话地点", "雨后的街角咖啡馆"), input("topic", "对话主题", "是否一起修复旧书店")],
  mediaInputs: [media("portraitA", "人物甲参考图", "personA"), media("portraitB", "人物乙参考图", "personB"), media("sceneImage", "空间参考图", "location")], workflow, modelSlots: [videoSlot],
  example: { name: "{{nameA}}与{{nameB}}的对话", output: { width: 1280, height: 720, frameRate: 24 },
    assets: [asset("personA", "{{nameA}}", "character", "人物甲：{{nameA}}。补充并确认外观、服装和性格。"), asset("personB", "{{nameB}}", "character", "人物乙：{{nameB}}。补充并确认外观、服装和性格。"), asset("location", "{{scene}}", "scene", "对话发生在{{scene}}。确认座位关系、视线与光线方向。")],
    shots: ["空间建立", "甲先开口", "乙的反应", "甲提出分歧", "乙解释原因", "两人寻找共识", "甲作出回应", "对话收束"].map((title, index) => ({ key: `shot${index + 1}`, title, modelSlotKey: "video", expectedDuration: 4,
      prompt: `在{{scene}}拍摄${title}。{{nameA}}和{{nameB}}围绕{{topic}}交谈。保持人物身份、服装、空间方向与视线连续。先确认此镜头具体动作和对白。`, story: `${title}：推进{{topic}}。`, dialogue: "待填写并核对本镜头对白", references: [reference("personA", "人物甲"), reference("personB", "人物乙"), reference("location", "空间")] })), generationNodes: [],
  },
};
const productAd: ProductionTemplate = {
  title: "商品广告", description: "两张关键图片与四段视频组织产品识别、卖点、使用和收束。结构范例，无生成成品。", tags: ["商品", "广告"],
  inputs: [input("product", "商品名称", "便携咖啡杯"), input("audience", "目标人群", "日常通勤者"), input("style", "画面风格", "自然光与简洁构图"), input("claim", "已核实的商品特点", "便于随身携带")],
  mediaInputs: [media("productImage", "商品实拍参考", "product"), media("sceneImage", "使用场景参考", "location")], workflow, modelSlots: [imageSlot, videoSlot],
  example: { name: "{{product}}商品广告", output: { width: 1080, height: 1920, frameRate: 24 },
    assets: [asset("product", "{{product}}", "prop", "商品：{{product}}。特点：{{claim}}。以实拍资料确认轮廓、材质、标识和比例。"), asset("location", "商品使用场景", "scene", "面向{{audience}}，采用{{style}}。先确认具体空间和光线。")],
    shots: ["产品轮廓关键图", "材质细节关键图", "产品登场", "特点展示", "使用情境", "产品收束"].map((title, index) => ({ key: `shot${index + 1}`, title, modelSlotKey: index < 2 ? "image" : "video", expectedDuration: 3,
      prompt: `为{{product}}创作${title}，面向{{audience}}，风格：{{style}}。仅使用已核实特点：{{claim}}。保持轮廓、材质、比例与标识一致；先核对画幅和镜头动作。`, story: `${title}，服务于{{product}}的清晰识别。`, dialogue: "", references: [reference("product", "商品身份"), reference("location", "场景与光线")] })), generationNodes: [],
  },
};
const shortComic: ProductionTemplate = {
  title: "短篇漫剧", description: "八张分镜图片与独立旁白节点组织一个短故事。结构范例，无生成成品。", tags: ["漫剧", "分镜", "旁白"],
  inputs: [input("hero", "主角名称", "小禾"), input("setting", "故事环境", "靠海的小镇"), input("story", "故事梗概", "主角找到一封没有寄出的信，并把它送到收信人手中"), input("narration", "旁白文稿", "海风吹开旧信封，一个迟到的约定重新启程。")],
  mediaInputs: [media("heroImage", "主角外观参考", "hero"), media("settingImage", "场景参考", "location")], workflow,
  modelSlots: [imageSlot, { key: "narration", label: "旁白音频", mediaType: "audio", purpose: "朗读已确认的旁白文稿；生成前选择实际可用音色、格式与速度" }],
  example: { name: "{{hero}}的短篇故事", output: { width: 1280, height: 720, frameRate: 24 },
    assets: [asset("hero", "{{hero}}", "character", "主角：{{hero}}。补充并确认五官、服装、身形和画风。"), asset("location", "{{setting}}", "scene", "故事环境：{{setting}}。保持主要空间、光线与美术风格连续。")],
    shots: ["环境与人物", "意外发现", "目标出现", "第一次尝试", "遭遇困难", "作出选择", "解决问题", "结尾余韵"].map((title, index) => ({ key: `shot${index + 1}`, title, modelSlotKey: "image", expectedDuration: 3,
      prompt: `绘制{{hero}}在{{setting}}的${title}分镜。故事：{{story}}。保持人物和画风一致，先明确本格动作、景别和构图。`, story: `${title}：结合{{story}}补全本镜头事件。`, dialogue: "", references: [reference("hero", "主角"), reference("location", "场景")] })),
    generationNodes: [{ key: "voice", title: "故事旁白", modelSlotKey: "narration", prompt: "{{narration}}", references: [] }],
  },
};
export const builtinProductionTemplates = [
  { id: "builtinDialogue", definition: dialogue },
  { id: "builtinProductAd", definition: productAd },
  { id: "builtinShortComic", definition: shortComic },
];
