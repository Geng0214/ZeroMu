import { readdir, readFile, writeAtomic, stat } from "@toonflow/file";
import { join, resolve } from "node:path";
import { pairs } from "./workspaceWording.ts";

const root = resolve(import.meta.dirname);
const mode = process.argv[2] === "locales" ? "locales" : "source";
const skipDirectories = ["node_modules", ".git", "dist", "build"];

async function* walk(directory: string): AsyncGenerator<string> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirectories.includes(entry.name)) yield* walk(path);
    } else if (mode === "source" ? /\.(ts|vue)$/.test(entry.name) : entry.name.endsWith(".json")) {
      yield path;
    }
  }
}

const known = new Set<string>();
if (mode === "locales") {
  const sources = JSON.parse(await readFile(resolve(root, "packages/i18n/src/messageSources.json"), "utf8")) as Record<string, string[]>;
  for (const key of Object.keys(sources)) known.add(key);
}

let touched = 0, total = 0;
const targets: string[] = [];
if (mode === "source") {
  for (const base of ["apps", "packages"]) for await (const path of walk(join(root, base))) {
    const normalized = path.replaceAll("\\", "/");
    if (normalized.includes("packages/i18n/src/locales") || normalized.endsWith("messageSources.json")) continue;
    targets.push(path);
  }
} else {
  for await (const path of walk(join(root, "packages/i18n/src/locales"))) if (!path.endsWith("zhCn.json")) targets.push(path);
}

for (const path of targets) {
  if (mode === "source") {
    const before = await readFile(path, "utf8").catch(() => null);
    if (before === null) continue;
    let after = before, hits = 0;
    for (const [from, to] of pairs) {
      if (!after.includes(from)) continue;
      const count = after.split(from).length - 1;
      after = after.replaceAll(from, to);
      hits += count;
    }
    if (hits) {
      await writeAtomic(path, after);
      touched++; total += hits;
      console.log(`${path.replace(root + "/", "")}: ${hits}`);
    }
    continue;
  }
  // 语言包：只改键名，且必须确认新键真的在消息索引里，避免造出无源键。
  const locale = JSON.parse(await readFile(path, "utf8")) as Record<string, string>;
  const map = new Map(pairs);
  const next: Record<string, string> = {};
  let renamed = 0;
  for (const [key, value] of Object.entries(locale)) {
    const candidate = map.get(key);
    if (candidate && known.has(candidate) && !(candidate in locale)) {
      next[candidate] = value;
      renamed++;
      continue;
    }
    next[key] = value;
  }
  if (renamed) {
    await writeAtomic(path, JSON.stringify(next, null, 2) + "\n");
    touched++; total += renamed;
  }
  console.log(`${path.split("/").pop()}: 改名 ${renamed}`);
}
console.log(`\n[${mode}] 共处理 ${touched} 个文件，${total} 处`);
