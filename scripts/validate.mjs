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

const allFiles = await walk(root);
const htmlFiles = allFiles.filter((file) => file.endsWith(".html"));

for (const file of htmlFiles) {
  const source = await readFile(file, "utf8");
  requireText(file, source.toLowerCase(), "<!doctype html>", "doctype");
  requireText(file, source, '<html lang="ja">', "language");
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
    for (const phrase of [
      manifest.displayName,
      manifest.supportEmail,
      manifest.effectiveDate,
      ...manifest.requiredPhrases,
      ...(documentRequiredPhrases[document] ?? []),
    ]) {
      requireText(file, source, phrase);
    }
    for (const phrase of manifest.forbiddenPhrases) {
      if (source.includes(phrase)) {
        failures.push(
          `${path.relative(root, file)}: forbidden phrase found: ${phrase}`,
        );
      }
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
