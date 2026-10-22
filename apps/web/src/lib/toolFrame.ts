import * as vueRuntime from "vue";
import * as elementPlusRuntime from "element-plus";
import axios from "axios";
import formCreate from "@form-create/element-ui";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import type { ToolFrameState } from "./toolFrameProtocol";
import type { Component } from "vue";

// 此入口只在无同源权限的工具页面运行，不导入应用、路由或设置。
let port: MessagePort | undefined;
let nextId = 0;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
const state = vueRuntime.shallowReactive<ToolFrameState>({ tool: { id: "", name: "", status: "interrupted" }, appearance: { dark: false, fontSize: "16px", variables: {} } });

function request(action: string, data?: unknown): Promise<any> {
  if (!port || pending.size >= 32) return Promise.reject(new Error("工具界面请求不可用"));
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("工具界面请求超时，请核对操作状态后继续")); }, 60_000);
    pending.set(id, { resolve, reject, timer });
    port!.postMessage({ type: "request", id, action, data });
  });
}

function update(value: ToolFrameState) {
  // 外观或画布状态变化时保留相同的工具对象，避免表单规则重复初始化。
  const tool = JSON.stringify(state.tool) === JSON.stringify(value.tool) ? state.tool : value.tool;
  Object.assign(state, value, { tool });
  document.documentElement.classList.toggle("dark", value.appearance.dark);
  document.documentElement.style.colorScheme = value.appearance.dark ? "dark" : "light";
  document.documentElement.lang = value.appearance.locale?.name || "zh-CN";
  document.documentElement.style.fontSize = value.appearance.fontSize;
  for (const [name, propertyValue] of Object.entries(value.appearance.variables)) document.documentElement.style.setProperty(name, propertyValue);
}

window.addEventListener("message", function initialize(event: MessageEvent) {
  if (port || event.source !== window.parent || event.data?.type !== "toolViewStart" || event.ports.length !== 1) return;
  window.removeEventListener("message", initialize);
  port = event.ports[0]!;
  port.onmessage = event => {
    const message = event.data;
    if (message?.type === "state") { update(message.state); return; }
    if (message?.type !== "response" || !Number.isSafeInteger(message.id)) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id); clearTimeout(waiter.timer);
    if (typeof message.error === "string") waiter.reject(new Error(message.error));
    else waiter.resolve(message.data);
  };
  window.addEventListener("error", () => port?.postMessage({ type: "error", message: "工具界面运行失败，请停止后重新打开" }));
  window.addEventListener("pagehide", () => {
    port?.close(); port = undefined;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("工具界面已关闭")); }
    pending.clear();
  }, { once: true });
  try {
    update(event.data.state);
    axios.defaults.adapter = async config => {
      const data = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
      const response = await request("http", { method: config.method, url: config.url, data });
      return { data: response, status: 200, statusText: "OK", headers: {}, config };
    };
    const toolWindow = window as typeof window & {
      toonflowToolHost?: unknown;
      toonflowToolViews?: Record<string, Record<string, Component>>;
    };
    toolWindow.toonflowToolHost = { vue: vueRuntime, elementPlus: elementPlusRuntime, axios, formCreate };
    const script = document.createElement("script");
    script.textContent = event.data.code;
    document.head.append(script); script.remove();
    const views = toolWindow.toonflowToolViews?.[event.data.name];
    const component = views && Object.hasOwn(views, state.tool.name) ? views[state.tool.name] : undefined;
    if (!component || !["object", "function"].includes(typeof component)) throw new Error("工具没有导出对应界面");
    const view = vueRuntime.markRaw(component);
    const app = vueRuntime.createApp({ render: () => vueRuntime.h(elementPlusRuntime.ElConfigProvider, { locale: state.appearance.locale }, {
      default: () => vueRuntime.h(view, { tool: state.tool, directory: state.directory, onCopy: (content: unknown) => request("copy", content).catch(() => {}) }),
    }) });
    app.provide("canvas", () => state.canvas && {
      id: state.canvas.id, tools: [],
      getNodeLabel: (id: string) => state.canvas?.labels[id],
      call: (requestValue: unknown) => request("canvas", requestValue),
    });
    app.provide("activateCanvasPanel", () => request("activateCanvas"));
    app.config.errorHandler = () => port?.postMessage({ type: "error", message: "工具界面运行失败，请停止后重新打开" });
    app.mount("#toolView");
    let frame = 0;
    let lastHeight = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const content = document.getElementById("toolView")!;
        let height = content.getBoundingClientRect().height + 6;
        for (const popup of document.querySelectorAll<HTMLElement>("body > .el-popper, body > .el-message")) {
          if (popup.getClientRects().length && getComputedStyle(popup).visibility !== "hidden") height = Math.max(height, popup.getBoundingClientRect().bottom + 6);
        }
        height = Math.max(32, Math.min(1600, Math.ceil(height)));
        if (height !== lastHeight) { lastHeight = height; port?.postMessage({ type: "height", height }); }
      });
    };
    new ResizeObserver(measure).observe(document.getElementById("toolView")!);
    new MutationObserver(measure).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class"] });
    measure();
    port.postMessage({ type: "ready" });
  } catch (error) {
    port.postMessage({ type: "error", message: error instanceof Error ? error.message : "工具界面加载失败" });
  }
});
