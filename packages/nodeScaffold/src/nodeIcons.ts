import { defineComponent, h, type Component } from "vue";

// 四种节点共用 24px 画布与圆头描边，标题、菜单和工具栏按尺寸缩放。
function createNodeIcon(name: string, paths: { d: string; fill?: string; stroke?: string }[]) {
  return defineComponent({
    name,
    props: {
      size: { type: [Number, String], default: 24 },
      stroke: { type: [Number, String], default: 1.75 },
    },
    setup: props => () => h("svg", {
      xmlns: "http://www.w3.org/2000/svg",
      width: props.size,
      height: props.size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": props.stroke,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      focusable: "false",
      style: { flexShrink: 0, verticalAlign: "middle" },
    }, paths.map(path => h("path", path))),
  });
}

const upperSpark = { d: "M19 2l1.1 2.9L23 6l-2.9 1.1L19 10l-1.1-2.9L15 6l2.9-1.1Z", fill: "currentColor", stroke: "none" };

export const textNodeIcon = createNodeIcon("textNodeIcon", [
  { d: "M5 4h14a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z" },
  { d: "M8 10h8M8 14h5" },
]);
export const imageNodeIcon = createNodeIcon("imageNodeIcon", [
  { d: "M12 3H5a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-5" },
  { d: "m2 16 4.3-4.3a1 1 0 0 1 1.4 0l5.3 5.3 2.3-2.3a1 1 0 0 1 1.4 0L20 18" },
  upperSpark,
]);
export const videoNodeIcon = createNodeIcon("videoNodeIcon", [
  { d: "M12 3H5a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-5" },
  { d: "m9 8 6 4-6 4Z", fill: "currentColor", stroke: "none" },
  upperSpark,
]);
export const audioNodeIcon = createNodeIcon("audioNodeIcon", [
  { d: "M3 10v4M7 5v14M11 2v20M15 6v7M19 9v3" },
  { d: "m19 14 1.1 2.9L23 18l-2.9 1.1L19 22l-1.1-2.9L15 18l2.9-1.1Z", fill: "currentColor", stroke: "none" },
]);

const nodeIcons: Record<string, Component> = {
  "remote-textNode": textNodeIcon,
  "remote-imageNode": imageNodeIcon,
  "remote-imageGenerationNode": imageNodeIcon,
  "remote-videoNode": videoNodeIcon,
  "remote-videoGenerationNode": videoNodeIcon,
  "remote-audioNode": audioNodeIcon,
  "remote-audioGenerationNode": audioNodeIcon,
};

export function getNodeIcon(type: string) {
  return nodeIcons[type];
}
