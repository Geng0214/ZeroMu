import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, readdirSync } from "@toonflow/file";
import { build, defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import { appVersion } from "../../appVersion";
import postcssConfig from "../../postcss.config.ts";
import { i18nPlugin } from "@toonflow/i18n/vite";

const elementPlusDirectory = dirname(createRequire(import.meta.url).resolve("element-plus/package.json"));
const elementPlusStyles = readdirSync(join(elementPlusDirectory, "es/components"))
  .filter(name => existsSync(join(elementPlusDirectory, "es/components", name, "style/css.mjs")))
  .map(name => `element-plus/es/components/${name}/style/css`);

let toolFrameBuild: Promise<{ code: string; css: string }> | undefined;
let nodeFrameBuild: Promise<{ code: string; css: string }> | undefined;
function buildToolFrame() {
  return toolFrameBuild ??= build({
    configFile: false,
    root: fileURLToPath(new URL(".", import.meta.url)),
    css: { postcss: postcssConfig },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      write: false,
      cssCodeSplit: false,
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      lib: { entry: fileURLToPath(new URL("./src/lib/toolFrame.ts", import.meta.url)), name: "zeromuToolFrame", formats: ["iife"] },
    },
  }).then(result => {
    const output = Array.isArray(result) ? result.flatMap(item => item.output) : "output" in result ? result.output : [];
    const chunks = output.filter(item => item.type === "chunk");
    if (chunks.length !== 1 || output.some(item => item.type === "asset" && !item.fileName.endsWith(".css"))) throw new Error("工具界面运行时必须为独立单文件");
    return { code: chunks[0]!.code, css: output.filter(item => item.type === "asset").map(item => typeof item.source === "string" ? item.source : new TextDecoder().decode(item.source)).join("\n") };
  });
}

function buildNodeFrame() {
  return nodeFrameBuild ??= build({
    configFile: false,
    root: fileURLToPath(new URL(".", import.meta.url)),
    css: { postcss: postcssConfig },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      write: false,
      cssCodeSplit: false,
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      lib: { entry: fileURLToPath(new URL("./src/lib/nodeFrame.ts", import.meta.url)), name: "zeromuNodeFrame", formats: ["iife"] },
    },
  }).then(result => {
    const output = Array.isArray(result) ? result.flatMap(item => item.output) : "output" in result ? result.output : [];
    const chunks = output.filter(item => item.type === "chunk");
    if (chunks.length !== 1 || output.some(item => item.type === "asset" && !item.fileName.endsWith(".css"))) throw new Error("节点界面运行时必须为独立单文件");
    return { code: chunks[0]!.code, css: output.filter(item => item.type === "asset").map(item => typeof item.source === "string" ? item.source : new TextDecoder().decode(item.source)).join("\n") };
  });
}

export default defineConfig({
  css: { postcss: postcssConfig },
  define: {
    "import.meta.env.appVersion": JSON.stringify(appVersion),
  },
  optimizeDeps: {
    // 自动导入的样式入口不会出现在初始扫描中；提前打包，避免切换面板时重建共享 Vue 依赖。
    include: ["vue", "element-plus/es", ...elementPlusStyles],
  },
  server: {
    proxy: {
      "/mcp": { target: "http://127.0.0.1:3000", changeOrigin: false },
      "/a2a": { target: "http://127.0.0.1:3000", changeOrigin: false },
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: false,
        configure(proxy) {
          proxy.on("proxyReq", (request, incoming) => {
            request.setHeader("x-toonflow-local-client", ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(incoming.socket.remoteAddress ?? "") ? "1" : "0");
          });
        },
      },
    },
  },
  resolve: {
    dedupe: ["vue"],
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      { find: /^shiki$/, replacement: fileURLToPath(new URL("./src/lib/shiki.ts", import.meta.url)) },
    ],
  },
  build: {
    outDir: "../../build/web",
    emptyOutDir: true,
  },
  plugins: [
    {
      name: "isolatedToolFrame",
      resolveId(id) { if (id === "virtual:toolFrame") return "\0toolFrame"; },
      async load(id) { if (id === "\0toolFrame") return `export default ${JSON.stringify(await buildToolFrame())};`; },
      handleHotUpdate(context) {
        if (!context.file.replaceAll("\\", "/").endsWith("/src/lib/toolFrame.ts")) return;
        toolFrameBuild = undefined;
        const module = context.server.moduleGraph.getModuleById("\0toolFrame");
        if (module) return [module];
      },
    },
    {
      name: "isolatedNodeFrame",
      resolveId(id) { if (id === "virtual:nodeFrame") return "\0nodeFrame"; },
      async load(id) { if (id === "\0nodeFrame") return `export default ${JSON.stringify(await buildNodeFrame())};`; },
      handleHotUpdate(context) {
        if (!context.file.replaceAll("\\", "/").endsWith("/src/lib/nodeFrame.ts")) return;
        nodeFrameBuild = undefined;
        const module = context.server.moduleGraph.getModuleById("\0nodeFrame");
        if (module) return [module];
      },
    },
    i18nPlugin(),
    vue(),
    components({
      syncMode: "overwrite",
      globsExclude: ["src/components/settings/panels/**/*Dialog.vue"],
      dts: "src/types/components.d.ts",
      resolvers: [
        ElementPlusResolver(),
        (name) => {
          if (name.startsWith("Icon")) return { name, from: "@tabler/icons-vue" };
        },
      ],
    }),
  ],
});
