// tools/check-scripts.mjs
//
// Audits the generated pages' <script> lists for two classes of bug that are
// invisible in the HTML but fatal at runtime:
//
//   1. Duplicate loads. Loading the same file twice re-runs a top-level
//      `class` or `const` declaration, which throws.
//   2. Load-order violations, where one script needs another's global to
//      already exist as its own body runs.
//   3. <script src> pointing at a file that is not in the build.
//
// All were introduced by hand-editing script lists, which is easy to get wrong
// and impossible to eyeball on a 40-line list.
//
// Usage: node tools/check-scripts.mjs

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "src");

const SCRIPT = /<script\s+src\s*=\s*"([^"]+)"/g;

// Partials load these once for every page. Repeats of these are the include
// working as intended, not a bug.
const SHARED = new Set([
  "/js/libs/jquery-3.3.1.min.js",
  "/js/Router.js",
  "/js/Boot.js",
  "/js/interface/RSSReader.js",
  "/js/BootPost.js",
  "/js/BootFooter.js",
]);

// Files that reference another global while their top-level body runs, so the
// dependency has to already be defined by the time they load.
//
// Note these are *load-time* dependencies only. Pokemon.js and Battle.js also
// use DamageCalculator inside methods, but that is a runtime call: a page that
// never runs a simulation never reaches it. The original PHP pages rely on that
// distinction too (article pages load Battle.js without DamageCalculator), so
// flagging a missing runtime dep here would be a false positive.
const LOAD_TIME_REQUIRES = new Map([
  ["/js/battle/timeline/TimelineAction.js", ["/js/battle/timeline/TimelineEvent.js"]],
]);

// A top-level `class`/`const`/`let` is what makes a second <script> tag throw
// ("Identifier 'X' has already been declared"). A plain function declaration is
// fine to re-execute, so only flag reloads that would actually blow up.
//
// Checked by inspecting each file once, rather than hardcoding a list that
// would silently go stale as scripts are added or refactored.
const RELOAD_UNSAFE = /^(?:class|const|let)\s/m;

async function reloadUnsafe(src) {
  if (! src.startsWith("/")) return false;

  const file = path.join(OUT_DIR, src);

  if (! existsSync(file)) return false;

  const body = await readFile(file, "utf8");

  // Only column-zero declarations count; an indented `let` is inside a function.
  return body.split("\n").some((line) => RELOAD_UNSAFE.test(line));
}

async function walk(dir) {
  const found = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      found.push(...(await walk(full)));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      found.push(full);
    }
  }

  return found;
}

async function main() {
  const files = await walk(OUT_DIR);
  const problems = [];

  for (const file of files) {
    const html = await readFile(file, "utf8");
    const rel = path.relative(ROOT, file).split(path.sep).join("/");

    const scripts = [...html.matchAll(SCRIPT)].map((match) => match[1].split("?")[0]);

    // 1. Duplicates

    const seen = new Map();

    for (const [index, src] of scripts.entries()) {
      if (! seen.has(src)) {
        seen.set(src, index);
        continue;
      }

      // The header partial legitimately loads its shared set once.
      if (SHARED.has(src)) continue;

      // Re-running a script that only declares functions is harmless, so only
      // report the duplicate if it would actually throw.
      if (await reloadUnsafe(src)) {
        problems.push(`${rel}: ${src} loaded twice (lines ${seen.get(src) + 1} and ${index + 1}); re-declaring its top-level class/const`);
      }
    }

    // 2. Load order

    for (const src of scripts) {
      const needs = LOAD_TIME_REQUIRES.get(src);

      if (! needs) continue;

      for (const need of needs) {
        const depIndex = seen.get(need);
        const selfIndex = seen.get(src);

        // Only complain when the dependency is loaded at all but too late.
        if (depIndex === undefined) {
          problems.push(`${rel}: ${src} needs ${need}, which is never loaded`);
        } else if (depIndex > selfIndex) {
          problems.push(`${rel}: ${src} loads before ${need}, but uses it at load time`);
        }
      }
    }

    // 3. Referenced scripts must exist.

    for (const src of scripts) {
      if (! src.startsWith("/")) continue;
      if (! existsSync(path.join(OUT_DIR, src))) {
        problems.push(`${rel}: missing script ${src}`);
      }
    }
  }

  for (const problem of problems) console.error(`  ${problem}`);

  console.log(`\nChecked ${files.length} page(s); ${problems.length} script problem(s).`);

  process.exit(problems.length ? 1 : 0);
}

await main();