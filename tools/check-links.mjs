// tools/check-links.mjs
//
// Verifies that the generated site has no dangling internal references.
//
// The conversion rewrote a lot of `<?php echo $WEB_ROOT; ?>battle/` links into
// `/battle.html`. A typo there is silent: the page still loads, it just 404s on
// click. This walks every generated page, pulls out root-relative href/src
// attributes, and checks that each one resolves to a real file under src/.
//
// Query strings and hash fragments are stripped before the check. Absolute URLs
// (http/https), protocol-relative URLs, mailto:, data:, javascript:, and bare
// anchors are all out of scope.
//
// Usage: node tools/check-links.mjs

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "src");

// Only references rooted at the site root are ours to check. Relative and
// protocol-relative URLs are left alone.
const ATTR = /\b(?:href|src)\s*=\s*"([^"]+)"/g;

const SKIP_SCHEME = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

// Article artwork lives under src/articles/article-assets and src/assets, which
// .gitignore keeps out of the repo (it is binary and large). Those references
// are correct as written; the files just are not in the checkout, so a
// reference check cannot confirm them either way.
const IGNORED_PREFIXES = [
  "/articles/article-assets/",
  "/assets/articles/",
];

function checkRefs(html, rel) {
  const bad = [];

  for (const match of html.matchAll(ATTR)) {
    const value = match[1];

    if(! value.startsWith("/")) continue;
    if(SKIP_SCHEME.test(value)) continue;
    if(IGNORED_PREFIXES.some((prefix) => value.startsWith(prefix))) continue;

    // Drop ?query and #hash; only the path has to exist.
    const target = value.split(/[?#]/)[0];

    if(! target) continue;

    const dest = path.join(OUT_DIR, decodeURIComponent(target));

    if(! existsSync(dest)) {
      bad.push({ rel, value, target });
    }
  }

  return bad;
}

async function walk(dir) {
  const found = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if(entry.isDirectory()) {
      found.push(...(await walk(full)));
    } else if(entry.isFile() && entry.name.endsWith(".html")) {
      found.push(full);
    }
  }

  return found;
}

async function main() {
  if(! existsSync(OUT_DIR)) {
    console.error("No src/ found. Run `node tools/build.mjs` first.");
    process.exit(1);
  }

  const files = await walk(OUT_DIR);
  const problems = [];

  for (const file of files) {
    const html = await readFile(file, "utf8");
    const rel = path.relative(ROOT, file).split(path.sep).join("/");

    problems.push(...checkRefs(html, rel));
  }

  // Collapse duplicates so one broken header link doesn't print 80 times.
  const seen = new Map();

  for (const problem of problems) {
    const key = `${problem.rel} -> ${problem.value}`;

    if(! seen.has(key)) seen.set(key, problem);
  }

  for (const problem of seen.values()) {
    console.error(`  ${problem.rel} -> ${problem.value}`);
  }

  console.log(`\nChecked ${files.length} page(s); ${seen.size} broken internal reference(s).`);

  if(seen.size) process.exit(1);
}

await main();