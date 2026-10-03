// tools/build.mjs
//
// Assembles the static site.
//
// Pages are authored in pages/ as plain HTML with two marker comments:
//
//     <!--#include header-->
//     ...page content...
//     <!--#include footer-->
//
// This script expands those markers against partials/header.html and
// partials/footer.html, substitutes a handful of tokens, and writes the result
// into src/ as ordinary .html files. The generated files are committed, so
// serving src/ with any static file server requires no build step. Re-run this
// only after editing a page or a partial.
//
// Usage:  node tools/build.mjs
//         node tools/build.mjs --watch

import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGES_DIR = path.join(ROOT, "pages");
const PARTIALS_DIR = path.join(ROOT, "partials");
const OUT_DIR = path.join(ROOT, "src");

// Bumping this busts the ?v= cache keys on every script and stylesheet.
const VERSION = "1.40.2.3";

// Web root for generated markup. "/" assumes you serve src/ as the document
// root, which is what `python -m http.server` does when run from inside src/.
const WEB_ROOT = "/";

const DEFAULT_TITLE = "PvPoke | Open-Source Battle Simulator, Rankings & Team Building for Pokemon GO PvP";
const DEFAULT_DESCRIPTION =
  "Looking for an edge in Pokemon GO Trainer Battles? Become a master with our open-source Pokemon battle simulator, explore the top Pokemon rankings, and get your team rated for PvP battles.";

// Extra <link>/<script> tags some pages need, keyed by the page's `css:` directive.
const EXTRA_ASSETS = {
  "train.css": '<link rel="stylesheet" type="text/css" href="{{ROOT}}css/train.css?v=22">',
  "article-extras.css": '<link rel="stylesheet" type="text/css" href="{{ROOT}}css/article-extras.css?v=23">',
};

// ---------------------------------------------------------------------------
// Token substitution
// ---------------------------------------------------------------------------

// Substitute `{{TOKEN}}` placeholders.
//
// This iterates to a fixed point rather than doing a single pass. Some values
// are themselves templates: EXTRA_HEAD expands to a list of <link> tags whose
// hrefs still contain {{ROOT}}. A single pass would leave that inner token
// behind, and the leftover check below would then fail the build. Unknown
// tokens are left alone so the check can report them by name.
function substitute(text, values) {
  const token = /\{\{(\w+)\}\}/g;

  let out = text;
  let previous;

  do {
    previous = out;

    out = out.replace(token, (match, key) =>
      Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
    );
  } while (out !== previous);

  return out;
}

// The header marks the active top-level nav item with {{SEL_*}} tokens. On a
// static server there is no REQUEST_URI to inspect, so each page declares which
// sections it belongs to.
const SELECTORS = {
  SEL_BATTLE: "battle",
  SEL_RANKINGS: "rankings",
  SEL_TEAM: "team-builder",
  SEL_TRAIN: "train",
};

function selectionValues(page) {
  const out = {};

  for (const [token, section] of Object.entries(SELECTORS)) {
    out[token] = page.sel.includes(section) ? ' class-active' : "";
  }

  return out;
}

// ---------------------------------------------------------------------------
// Page front matter
// ---------------------------------------------------------------------------

// Reads `<!-- key: value -->` directives from the top of a page source.
function parseDirectives(source) {
  const page = { title: null, description: null, canonical: null, sel: [], css: [] };

  const directive = /<!--\s*([a-z]+)\s*:\s*(.*?)\s*-->/gi;
  let match;

  while ((match = directive.exec(source)) !== null) {
    const key = match[1].toLowerCase();
    const value = match[2];

    if (key === "sel") {
      page.sel = value.split(/[\s,]+/).filter(Boolean);
    } else if (key === "css") {
      page.css = value.split(/[\s,]+/).filter(Boolean);
    } else if (key in page) {
      page[key] = value;
    }
  }

  return page;
}

// ---------------------------------------------------------------------------
// Walk
// ---------------------------------------------------------------------------

async function collect(dir) {
  const found = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      found.push(...(await collect(full)));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      found.push(full);
    }
  }

  return found;
}

async function buildPage(file, header, footer) {
  const source = await readFile(file, "utf8");
  const page = parseDirectives(source);

  const title = page.title ?? DEFAULT_TITLE;
  const rel = path.relative(PAGES_DIR, file).split(path.sep).join("/");
  const canonical = page.canonical ?? `https://pvpoke.com/${rel.replace(/index\.html$/, "")}`;

  const extraHead = page.css
    .map((name) => EXTRA_ASSETS[name])
    .filter(Boolean)
    .join("\n");

  const values = {
    ROOT: WEB_ROOT,
    VERSION,
    TITLE: title,
    DESCRIPTION: page.description ?? DEFAULT_DESCRIPTION,
    CANONICAL: canonical,
    EXTRA_HEAD: extraHead,
    ...selectionValues(page),
  };

  let out = source
    .replace(/<!--\s*#include\s+header\s*-->/gi, () => substitute(header, values))
    .replace(/<!--\s*#include\s+footer\s*-->/gi, () => substitute(footer, values));

  // Any token left over means a page asked for something the header does not
  // define. Fail loudly rather than shipping a literal "{{TITLE}}".
  const leftover = out.match(/\{\{\w+\}\}/g);

  if (leftover) {
    throw new Error(`${rel}: unresolved template token(s): ${[...new Set(leftover)].join(", ")}`);
  }

  // Strip the directive comments now that they have been consumed.
  out = out.replace(/[ \t]*<!--\s*(title|description|canonical|sel|css)\s*:.*?-->\r?\n?/gi, "");

  const dest = path.join(OUT_DIR, rel);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, out, "utf8");

  return { rel, bytes: Buffer.byteLength(out) };
}

async function buildAll() {
  const header = await readFile(path.join(PARTIALS_DIR, "header.html"), "utf8");
  const footer = await readFile(path.join(PARTIALS_DIR, "footer.html"), "utf8");

  const files = await collect(PAGES_DIR);

  if (files.length === 0) {
    throw new Error(`No pages found in ${PAGES_DIR}`);
  }

  files.sort();

  let total = 0;

  for (const file of files) {
    const { rel, bytes } = await buildPage(file, header, footer);
    total += bytes;
    console.log(`  ${rel.padEnd(48)} ${(bytes / 1024).toFixed(1)} KB`);
  }

  console.log(`\nBuilt ${files.length} pages (${(total / 1024).toFixed(1)} KB) into src/`);
}

async function main() {
  if (!existsSync(PAGES_DIR)) {
    console.error(`Missing ${PAGES_DIR}`);
    process.exit(1);
  }

  console.log(`Building static pages (v${VERSION}, web root "${WEB_ROOT}")\n`);

  try {
    await buildAll();
  } catch (error) {
    console.error(`\nBuild failed: ${error.message}`);
    process.exit(1);
  }

  if (process.argv.includes("--watch")) {
    console.log("\nWatching pages/ and partials/ for changes...\n");

    for (const dir of [PAGES_DIR, PARTIALS_DIR]) {
      watch(dir, { recursive: true }, async () => {
        try {
          await buildAll();
        } catch (error) {
          console.error(`\nBuild failed: ${error.message}`);
        }
      });
    }
  }
}

main();
