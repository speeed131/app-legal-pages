import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "_site") continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(target)));
    else files.push(target);
  }
  return files;
}

function localTarget(fromFile, href) {
  const withoutFragment = href.split("#", 1)[0].split("?", 1)[0];
  if (!withoutFragment) return fromFile;
  if (withoutFragment.startsWith("/app-legal-pages/")) {
    return path.join(root, withoutFragment.slice("/app-legal-pages/".length));
  }
  if (withoutFragment.startsWith("/")) return null;
  return path.resolve(path.dirname(fromFile), withoutFragment);
}

function htmlTarget(target) {
  if (!target) return null;
  if (path.extname(target)) return target;
  return path.join(target, "index.html");
}

function requireText(file, source, text, reason = "required text") {
  if (!source.includes(text)) {
    failures.push(`${path.relative(root, file)}: ${reason} missing: ${text}`);
  }
}

// 他アプリ名・価格など、混入検出には必要だが公開リポジトリへ置きたくない語の読み込み。
//
// 本リポジトリは GitHub Pages のため public。app.json に平文で並べると、禁止語リストが
// そのままプロダクト一覧と価格表になる。ハッシュ化も検討したが「600円」「英検」のように
// 2-5文字と短く総当たりが容易なため秘匿にならない。よって値自体をリポジトリから外す。
//
// 優先順: 環境変数 (CI は GitHub Secrets から注入) → ローカルの untracked ファイル。
// 形式はどちらも { "<app-slug>": ["語", ...] }。
const FORBIDDEN_GROUP_ENV = {
  "cross-app": "LEGAL_FORBIDDEN_CROSS_APP",
};

async function loadForbiddenGroup(group) {
  const raw = process.env[FORBIDDEN_GROUP_ENV[group] ?? ""];
  if (raw?.trim()) {
    try {
      return { source: "env", data: JSON.parse(raw) };
    } catch (error) {
      failures.push(
        `${FORBIDDEN_GROUP_ENV[group]}: JSON として解釈できない (${error.message})`,
      );
      return { source: "env", data: {} };
    }
  }
  const file = path.join(root, "config", `forbidden-${group}.json`);
  try {
    return { source: "file", data: JSON.parse(await readFile(file, "utf8")) };
  } catch {
    return { source: null, data: {} };
  }
}

const forbiddenGroups = new Map();
for (const group of Object.keys(FORBIDDEN_GROUP_ENV)) {
  const { source, data } = await loadForbiddenGroup(group);
  forbiddenGroups.set(group, data);
  if (source) continue;
  // 黙って検査が弱くなるのを防ぐ。CI では失敗させ、ローカルでは警告に留める。
  const message =
    `禁止語グループ "${group}" を読み込めない。` +
    `${FORBIDDEN_GROUP_ENV[group]} を設定するか config/forbidden-${group}.json を置く`;
  if (process.env.CI) failures.push(message);
  else console.warn(`警告: ${message} (この群の検査をスキップした)`);
}

const allFiles = await walk(root);
const htmlFiles = allFiles.filter((file) => file.endsWith(".html"));

// 言語はディレクトリで決める: `.../en/...` 配下だけ英語、それ以外は日本語。
// 2026-09-04 nap-pile（全世界配信・ASC 主言語 en-US）で英語版を追加したため。
function languageOf(file) {
  const segments = path.relative(root, file).split(path.sep);
  return segments.includes("en") ? "en" : "ja";
}

for (const file of htmlFiles) {
  const source = await readFile(file, "utf8");
  requireText(file, source.toLowerCase(), "<!doctype html>", "doctype");
  requireText(file, source, `<html lang="${languageOf(file)}">`, "language");
  requireText(file, source, '<meta charset="UTF-8" />', "charset");
  requireText(file, source, 'name="viewport"', "viewport");
  requireText(file, source, "<title>", "title");
  requireText(file, source, "<main", "main landmark");
  requireText(file, source, "<h1>", "page heading");
  requireText(file, source, 'class="skip-link"', "skip link");

  if (/<script\b/i.test(source)) {
    failures.push(`${path.relative(root, file)}: scripts are not allowed`);
  }
  if (/href="http:\/\//i.test(source)) {
    failures.push(`${path.relative(root, file)}: insecure HTTP link`);
  }

  const ids = [...source.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  for (const id of new Set(duplicateIds)) {
    failures.push(`${path.relative(root, file)}: duplicate id "${id}"`);
  }

  for (const match of source.matchAll(
    /<a\b([^>]*?)href="([^"]+)"([^>]*)>/g,
  )) {
    const attributes = `${match[1]} ${match[3]}`;
    const href = match[2];
    if (
      /\btarget="_blank"/.test(attributes) &&
      !/\brel="[^"]*\bnoopener\b[^"]*\bnoreferrer\b[^"]*"/.test(attributes)
    ) {
      failures.push(
        `${path.relative(root, file)}: target="_blank" requires rel="noopener noreferrer": ${href}`,
      );
    }
    if (/^(https:|mailto:|tel:)/.test(href)) continue;
    if (href.startsWith("#")) {
      if (!source.includes(`id="${href.slice(1)}"`)) {
        failures.push(`${path.relative(root, file)}: missing fragment ${href}`);
      }
      continue;
    }
    const target = htmlTarget(localTarget(file, href));
    try {
      await access(target);
    } catch {
      failures.push(
        `${path.relative(root, file)}: missing local link ${href} -> ${target ? path.relative(root, target) : "outside site"}`,
      );
    }
  }
}

const appDirectories = (
  await readdir(path.join(root, "apps"), { withFileTypes: true })
).filter((entry) => entry.isDirectory());

for (const appDirectory of appDirectories) {
  const appRoot = path.join(root, "apps", appDirectory.name);
  const manifestPath = path.join(appRoot, "app.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  if (manifest.slug !== appDirectory.name) {
    failures.push(
      `${path.relative(root, manifestPath)}: slug must match directory name`,
    );
  }

  // 文書ごとの必須語はアプリで異なる（利用する外部SDK、商品種別、価格）。
  // ここへ特定アプリの値を直書きすると別アプリの追加時に必ず落ちるため、manifest から読む。
  const documentRequiredPhrases = manifest.documentRequiredPhrases ?? {};
  const unknownDocuments = Object.keys(documentRequiredPhrases).filter(
    (document) => !manifest.documents.includes(document),
  );
  for (const document of unknownDocuments) {
    failures.push(
      `${path.relative(root, manifestPath)}: documentRequiredPhrases has unknown document "${document}"`,
    );
  }

  for (const document of manifest.documents) {
    const file = path.join(appRoot, document, "index.html");
    const source = await readFile(file, "utf8");
    // 英語版は表示名・制定日の表記が違う。manifest.localized[lang] で上書きできる
    // （無ければ日本語の値をそのまま要求する）。
    const localized = manifest.localized?.[languageOf(file)] ?? {};
    for (const phrase of [
      localized.displayName ?? manifest.displayName,
      manifest.supportEmail,
      localized.effectiveDate ?? manifest.effectiveDate,
      ...manifest.requiredPhrases,
      ...(documentRequiredPhrases[document] ?? []),
    ]) {
      requireText(file, source, phrase);
    }
    // manifest 直書きの語 + 外部退避した群の語。後者は値をログへ出さない
    // (CI ログも公開されるため、失敗メッセージから復元できてしまう)。
    for (const phrase of manifest.forbiddenPhrases) {
      if (source.includes(phrase)) {
        failures.push(
          `${path.relative(root, file)}: forbidden phrase found: ${phrase}`,
        );
      }
    }
    for (const group of manifest.forbiddenPhraseGroups ?? []) {
      if (!forbiddenGroups.has(group)) {
        failures.push(
          `${path.relative(root, manifestPath)}: unknown forbiddenPhraseGroups entry "${group}"`,
        );
        continue;
      }
      const phrases = forbiddenGroups.get(group)[manifest.slug] ?? [];
      phrases.forEach((phrase, index) => {
        if (source.includes(phrase)) {
          failures.push(
            `${path.relative(root, file)}: forbidden phrase found: ` +
              `${group}[${index}] (値は伏せる。config/forbidden-${group}.json を参照)`,
          );
        }
      });
    }
    requireText(
      file,
      source,
      `${manifest.baseUrl}${document}/`,
      "canonical URL",
    );
  }
}

if (failures.length > 0) {
  console.error(`Validation failed with ${failures.length} problem(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Validated ${htmlFiles.length} HTML files and ${appDirectories.length} app manifest(s).`,
);
