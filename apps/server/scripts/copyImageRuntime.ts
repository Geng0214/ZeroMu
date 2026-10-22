import { cp, lstat, mkdir, readFile, realpath, rm, writeAtomic } from "@toonflow/file";
import { file } from "@toonflow/file/bun";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export default async function copyImageRuntime(outputDirectory: string) {
  const projectDirectory = resolve(import.meta.dirname, "../../..");
  const buildDirectory = await realpath(join(projectDirectory, "build"));
  const require = createRequire(import.meta.url);
  const runtimeDirectory = dirname(require.resolve("onnxruntime-node/package.json"));
  const runtimeRequire = createRequire(join(runtimeDirectory, "package.json"));
  const commonDirectory = dirname(runtimeRequire.resolve("onnxruntime-common/package.json"));
  for (const [name, source] of [["onnxruntime-node", runtimeDirectory], ["onnxruntime-common", commonDirectory]]) {
    const manifest = await file(join(source!, "package.json")).json();
    if (manifest.name !== name || manifest.version !== "1.30.0") throw new Error("本机图片运行环境版本与固定模型不匹配");
    const target = resolve(outputDirectory, "node_modules", name!);
    await mkdir(dirname(target), { recursive: true });
    const offset = relative(buildDirectory, await realpath(dirname(target)));
    if (isAbsolute(offset) || offset === ".." || offset.startsWith("..\\") || offset.startsWith("../")) throw new Error("拒绝更新构建目录以外的图片运行环境");
    const prior = await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
    if (prior?.isSymbolicLink()) throw new Error("构建图片运行环境目录不能是链接");
    await rm(target, { recursive: true, force: true });
    await mkdir(target);
    await cp(join(source!, "package.json"), join(target, "package.json"));
    await cp(join(source!, "dist"), join(target, "dist"), { recursive: true });
    if (name === "onnxruntime-node") {
      const binaryPath = join("bin", "napi-v6", process.platform, process.arch);
      await cp(join(source!, binaryPath), join(target, binaryPath), { recursive: true });
    }
    for (const [asset, output] of [["onnxRuntimeLicense.txt", "license.txt"], ["onnxRuntimeNotices.txt", "thirdPartyNotices.txt"]]) {
      await writeAtomic(join(target, output!), await readFile(join(projectDirectory, "packages/assets", asset!)));
    }
  }
}
