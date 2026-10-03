// tools/inline-modules.mjs
//
// One-time codemod: inlines converted module bodies into the pages that
// `require`d them.
//
// The PHP sources pulled in shared markup with `require 'modules/pokeselect.php'`
// and so on. Each of those was converted separately into pages/modules/<name>.html
// so that it could be reviewed on its own. This script copies those bodies into
// the pages that referenced them, replacing the `<!--#module NAME-->` marker, and
// then removes the marker. Afterwards no marker survives, so pages/ is the single
// source of truth for each page and the site still needs no build step.
//
// It is idempotent: running it again after the markers are gone is a no-op.
//
// Usage: node tools/inline-modules.mjs

import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGES_DIR = path.join(ROOT, "pages");
const MODULES_DIR = path.join(PAGES_DIR, "modules");

// <!--#module pokeselect-->  (tolerates extra spaces, and a repeated marker may
// pass a count, e.g. <!--#module pokeselect 2--> to inline it twice.)
const MARKER = /[ \t]*<!--\s*#module\s+([\w-]+)(?:\s+(\d+))?\s*-->[ \t]*\r?\n?/g;

const moduleCache = new Map();

async function loadModule(name) {
  if (moduleCache.has(name)) return moduleCache.get(name);

  const file = path.join(MODULES_DIR, `${name}.html`);

  if (!existsSync(file)) {
    throw new Error(`no such module: pages/modules/${name}.html`);
  }

  const body = await readFile(file, "utf8");

  // A module body is dropped in as-is, so a marker inside one would recurse.
  if (MARKER.test(body)) {
    MARKER.lastIndex = 0;
    throw new Error(`pages/modules/${name}.html still contains a #module marker`);
  }

  MARKER.lastIndex = 0;
  moduleCache.set(name, body);

  return body;
}

async function walk(dir) {
  const found = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (full === MODULES_DIR) continue;
      found.push(...(await walk(full)));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      found.push(full);
    }
  }

  return found;
}

async function inlineFile(file) {
  const before = await readFile(file, "utf8");

  if (!before.includes("#module")) return null;

  // The module bodies are read asynchronously but String.replace cannot await a
  // callback, so resolve each marker first and then substitute the collected
  // bodies in a second, synchronous pass.
  const bodies = [];

  for (const match of before.matchAll(MARKER)) {
    bodies.push(await loadModule(match[1]).then((body) => body.repeat(match[2] ? Number(match[2]) : 1)));
  }

  let index = 0;
  let total = 0;

  const after = before.replace(MARKER, () => {
    total++;
    return bodies[index++].replace(/\s*$/, "\n");
  });

  if (after === before) return null;

  await writeFile(file, after, "utf8");

  return { rel: path.relative(ROOT, file), total };
}

async function main() {
  let changed = 0;
  let total = 0;

  for (const file of await walk(PAGES_DIR)) {
    try {
      const result = await inlineFile(file);

      if (result) {
        changed++;
        total += result.total;
        console.log(`  ${result.rel}: inlined ${result.total} module include(s)`);
      }
    } catch (error) {
      console.error(`  ${path.relative(ROOT, file)}: ${error.message}`);
      process.exit(1);
    }
  }

  if (changed) {
    console.log(`\nInlined ${total} module include(s) across ${changed} page(s).`);
  } else {
    console.log("No #module markers left; nothing to inline.");
  }
}

await main();