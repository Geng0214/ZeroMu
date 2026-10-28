import { createRouter, createWebHashHistory } from "vue-router";
import { useWorkspaceStore } from "@/stores/workspace";
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/projects", redirect: "/home" },
    {
      path: "/",
      redirect: "/home",
    },
    {
      path: "/hello",
      redirect: "/home",
    },
    {
      path: "/home",
      component: () => import("@/pages/home/index.vue"),
      beforeEnter: to => to.query.section === "projects" ? "/canvas" : to.query.section === "assets" ? { path: "/assets", query: { tab: "materials" } } : to.query.section === "prompts" ? "/prompts" : true,
    },
    {
      path: "/studio/:kind(image|video|audio)",
      component: () => import("@/pages/studio/index.vue"),
    },
    { path: "/prompts", component: () => import("@/pages/prompts/index.vue") },
    { path: "/assets", component: () => import("@/pages/assets/index.vue") },
    {
      path: "/canvas",
      component: () => import("@/pages/canvasLibrary/index.vue"),
    },
    {
      path: "/workspace",
      component: () => import("@/pages/workspace/index.vue"),
    },
  ],
});
router.beforeEach(async to => {
  const workspace = useWorkspaceStore();
  await workspace.initialize();
  const needsProject = to.path === "/workspace";
  if (needsProject && !workspace.project) return { path: "/home", query: { next: to.fullPath } };
  return true;
});
export default router;
