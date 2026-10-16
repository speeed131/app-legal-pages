import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "_site");
const entries = [
  ".nojekyll",
  "404.html",
  "apps",
  "assets",
  "index.html",
  "robots.txt",
  "sitemap.xml",
  "tools",
];
// apps/ はアプリ、tools/ はアプリ以外の道具（トップのアプリ一覧には載せない）。
// どちらも各ディレクトリに app.json（検証用の manifest）を持ち、公開物からは外す。
const manifestBases = ["apps", "tools"];

if (path.basename(output) !== "_site" || path.dirname(output) !== root) {
  throw new Error(`Unsafe output path: ${output}`);
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const entry of entries) {
  await cp(path.join(root, entry), path.join(output, entry), {
    recursive: true,
  });
}

for (const base of manifestBases) {
  const appDirectories = await readdir(path.join(output, base), {
    withFileTypes: true,
  });

  for (const appDirectory of appDirectories) {
    if (!appDirectory.isDirectory()) {
      continue;
    }

    await rm(path.join(output, base, appDirectory.name, "app.json"), {
      force: true,
    });
  }
}

console.log(`Built ${entries.length} entries into ${output}`);
