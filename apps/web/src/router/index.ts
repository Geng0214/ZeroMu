import { createRouter, createWebHashHistory } from "vue-router";
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
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
export default router;
