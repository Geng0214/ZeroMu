import { resolve } from "node:path";

export default async function buildToolRuntime() {
  const projectDirectory = resolve(import.meta.dirname, "../../..");
  const result = await Bun.build({
    entrypoints: [
      ...["toolConfigWorker", "toolRuntimeWorker", "toolSyncClient", "toolSyncRelay"].map(name => resolve(projectDirectory, `apps/server/src/utils/plugins/${name}.ts`)),
      resolve(projectDirectory, "apps/server/src/utils/media/providerWorker.ts"),
    ],
    outdir: resolve(projectDirectory, "build/server"),
    naming: "[name].[ext]",
    target: "bun",
    minify: true,
  });
  if (!result.success) throw new AggregateError(result.logs, "工具工作进程构建失败");
}
