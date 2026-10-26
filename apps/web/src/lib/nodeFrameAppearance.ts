import { onBeforeUnmount, onMounted, shallowRef } from "vue";
import type { NodeFrameState } from "./nodeFrameProtocol";

const appearance = shallowRef<NodeFrameState["appearance"]>({ dark: false, fontSize: "16px", variables: {} });
let subscribers = 0;
let observer: MutationObserver | undefined;

function readAppearance(): NodeFrameState["appearance"] {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const variables: Record<string, string> = {};
  for (const name of style) {
    if (!/^--(?:el|ui)-[a-zA-Z0-9-]+$/.test(name)) continue;
    const value = style.getPropertyValue(name).trim();
    if (value && value.length <= 2000) variables[name] = value;
  }
  return { dark: root.classList.contains("dark"), fontSize: style.fontSize, variables };
}

function refreshAppearance() {
  const next = readAppearance();
  if (JSON.stringify(next) !== JSON.stringify(appearance.value)) appearance.value = next;
}

export function useNodeFrameAppearance() {
  let subscribed = false;
  onMounted(() => {
    subscribed = true;
    subscribers++;
    if (subscribers === 1) {
      refreshAppearance();
      observer = new MutationObserver(refreshAppearance);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    }
  });
  onBeforeUnmount(() => {
    if (!subscribed) return;
    subscribers--;
    if (!subscribers) {
      observer?.disconnect();
      observer = undefined;
    }
  });
  return appearance;
}
