import { nextTick } from "vue";

let activeTransition: ViewTransition | undefined;

export default async function transitionTheme(apply: () => void | Promise<void>, point?: { x: number; y: number }) {
  const commit = async () => {
    await apply();
    await nextTick();
  };
  activeTransition?.skipTransition();
  const fade = async () => {
    const animation = document.documentElement.animate([{ opacity: 0.65 }, { opacity: 1 }], { duration: 280, easing: "ease-in-out" });
    await animation.finished.catch(() => {});
  };
  if (!document.startViewTransition) {
    await commit();
    await fade();
    return;
  }
  const root = document.documentElement;
  const x = Math.min(innerWidth, Math.max(0, point?.x ?? innerWidth / 2));
  const y = Math.min(innerHeight, Math.max(0, point?.y ?? innerHeight / 2));
  root.style.setProperty("--themeX", `${x}px`);
  root.style.setProperty("--themeY", `${y}px`);
  root.style.setProperty("--themeR", `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`);
  const transition = document.startViewTransition(commit);
  activeTransition = transition;
  // ACT: 原生快照不可用时用淡入过渡，减少动态效果时由 CSS 改用短淡入。
  const ready = transition.ready.then(() => true, () => false);
  const finished = transition.finished.catch(() => {});
  try {
    await transition.updateCallbackDone;
    if (!await ready) await fade();
    await finished;
  } finally {
    if (activeTransition === transition) activeTransition = undefined;
  }
}
