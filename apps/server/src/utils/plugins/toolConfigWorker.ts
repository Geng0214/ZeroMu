import * as zod from "zod";
import type { ToolPlugin } from "@toonflow/tools-scaffold/runtime";

// ACT: 与工具原有打包约定相同；虚拟依赖只在工作进程注册，不借用宿主模块实例。
Bun.plugin({
  name: "toolHost",
  setup(build) {
    build.module("toonflow:tool-zod", () => ({ exports: zod, loader: "object" }));
  },
});

let received = false;
process.on("message", async (input: unknown) => {
  if (received) return;
  received = true;
  let moduleUrl: string | undefined;
  try {
    const { source, config } = zod.z.strictObject({
      source: zod.z.string().max(20 * 1024 * 1024),
      config: zod.z.record(zod.z.string(), zod.z.json()),
    }).parse(input);
    // 工具是自包含的构建产物。使用收到的源码快照，避免读取期间被安装更新替换。
    // Bun 1.3 的 Windows 解析器会把较长 data URL 当作超长包名；Blob URL 不含源码。
    moduleUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const { default: plugin } = await import(moduleUrl) as { default: ToolPlugin };
    if (typeof plugin?.createTools !== "function" || typeof plugin.validateConfig !== "function") {
      throw new Error("未导出有效的工具插件");
    }
    const parsed = zod.z.record(zod.z.string(), zod.z.json()).parse(await plugin.validateConfig(config));
    const json = JSON.stringify(parsed);
    if (Buffer.byteLength(json) > 8 * 1024 * 1024) throw new Error("工具配置结果不能超过 8 MB");
    process.send?.({ type: "result", json });
  } catch (error) {
    process.send?.({ type: "error", message: (error instanceof Error ? error.message : "工具配置无效").slice(0, 4000) });
  } finally {
    if (moduleUrl) URL.revokeObjectURL(moduleUrl);
  }
});

// 正常结果、超时和异常均由父进程结束本次工作进程，插件定时器不能使校验常驻。
process.on("disconnect", () => process.exit(0));
