// tools/patch-links.mjs
//
// One-time codemod: rewrites the app's URL construction from the Apache-rewrite
// world to the static world.
//
// The app used to build links as `host + "battle/" + cp + "/" + poke + "/"`,
// where Apache then rewrote the resulting pretty path into a query string.
// Static servers cannot rewrite, so `src/js/Router.js` now does the rewriting in
// the browser. To use it, every `host + <expr>` becomes `url(<expr>)`.
//
// That needs the whole concatenation wrapped in a call, not just its first
// token, so this walks the expression properly instead of regexing it. It also
// syntax-checks every file afterwards, because a botched edit here breaks the
// whole app at load time.
//
// This is a development-time script; its output is committed, so the site has no
// build step. Re-running is harmless once the work is done.
//
// Usage: node tools/patch-links.mjs

import { readFile, writeFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JS_DIR = path.join(ROOT, "src", "js");

// The port's own plumbing, and vendored libraries, are never rewritten.
const SKIP_FILES = new Set(["Router.js", "Boot.js", "BootPost.js", "BootFooter.js"]);
const SKIP_DIRS = new Set(["libs"]);

// ---------------------------------------------------------------------------
// Expression walker
// ---------------------------------------------------------------------------

const isIdent = (ch) => /[A-Za-z0-9_$.]/.test(ch);
const isQuote = (ch) => ch === '"' || ch === "'" || ch === "`";

// Advance past one string literal starting at `i` (which must be the quote).
function skipString(text, i) {
  const quote = text[i];
  i++;

  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i + 1;
    i++;
  }

  return i;
}

// Advance past a balanced (), [] or {} group starting at `i`.
function skipBalanced(text, i) {
  let depth = 0;

  while (i < text.length) {
    const c = text[i];

    if (isQuote(c)) {
      i = skipString(text, i);
      continue;
    }

    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }

    i++;
  }

  return i;
}

// Advance past one term of a `+` concatenation.
//
// The head is a string literal, a balanced group, or an identifier. After the
// head, a postfix chain may continue: property access, subscripts, and calls.
// The postfix part is what makes this non-trivial — `battle.getCup().name`
// must be consumed whole, not just up to the first `)`.
function skipTerm(text, i) {
  const ch = text[i];

  if (isQuote(ch)) return skipString(text, i);

  let j;

  if (ch === "(" || ch === "[" || ch === "{") {
    j = skipBalanced(text, i);
  } else {
    j = i;
    while (j < text.length && isIdent(text[j])) j++;
  }

  if (j === i) return i;

  // Postfix chain: `.name`, `[0]`, `(args)`, `?.name`
  for (;;) {
    if (text[j] === "(" || text[j] === "[") {
      j = skipBalanced(text, j);
      continue;
    }

    if (text[j] === "." || (text[j] === "?" && text[j + 1] === ".")) {
      let k = j + (text[j] === "?" ? 2 : 1);

      // Optional chaining is postfix too: `a?.b()`
      if (text[k] === "[") {
        j = skipBalanced(text, k);
        continue;
      }

      const start = k;
      while (k < text.length && isIdent(text[k])) k++;

      if (k === start) break;

      j = k;
      continue;
    }

    break;
  }

  return j;
}

function isTermStart(ch) {
  return ch !== undefined && /[A-Za-z0-9_$("'`]/.test(ch);
}

// Given the index of the first term after a `+`, return the index just past the
// end of the whole concatenation expression.
function skipConcat(text, i) {
  i = skipTerm(text, i);

  for (;;) {
    let j = i;

    while (j < text.length && /\s/.test(text[j])) j++;

    if (text[j] !== "+") break;

    j++;
    while (j < text.length && /\s/.test(text[j])) j++;

    // A trailing unary `+` is not another term.
    if (!isTermStart(text[j])) break;

    i = skipTerm(text, j);
  }

  return i;
}

// Wrap every `host + <expr>` in a url(...) call.
function wrapHostCalls(text) {
  const pieces = [];
  let count = 0;
  let cursor = 0;

  for (;;) {
    const match = /\bhost\b/g;
    match.lastIndex = cursor;

    const found = match.exec(text);

    if (!found) {
      pieces.push(text.slice(cursor));
      break;
    }

    const hostStart = found.index;
    const hostEnd = hostStart + found[0].length;

    let i = hostEnd;
    while (i < text.length && /\s/.test(text[i])) i++;

    // Only a `+` makes this a concatenation. Anything else is an unrelated use
    // of the identifier and must be left exactly as it is.
    if (text[i] !== "+") {
      pieces.push(text.slice(cursor, hostEnd));
      cursor = hostEnd;
      continue;
    }

    i++;
    while (i < text.length && /\s/.test(text[i])) i++;

    const exprStart = i;
    const exprEnd = skipConcat(text, i);

    if (exprEnd <= exprStart) {
      pieces.push(text.slice(cursor, hostEnd));
      cursor = hostEnd;
      continue;
    }

    pieces.push(text.slice(cursor, hostStart));
    pieces.push(`url(${text.slice(exprStart, exprEnd)})`);

    cursor = exprEnd;
    count++;
  }

  return { out: pieces.join(""), count };
}

// ---------------------------------------------------------------------------
// Simple textual rewrites
// ---------------------------------------------------------------------------

function applyRewrites(text) {
  const rules = [
    // A local named `url` would shadow the helper, so route those through Router.
    [/\b(let|var|const)\s+url\s*=\s*url\(/g, (m, kw) => `${kw} url = Router.url(`],
    [/\bwebRoot\s*\+\s*"battle\/matrix\/"/g, () => `Router.url("battle/matrix/")`],
    [/\branker(sandbox)?\.php\b/g, (m, sandbox) => `ranker${sandbox || ""}.html`],
  ];

  for (const [pattern, replace] of rules) {
    text = text.replace(pattern, replace);
  }

  return text;
}

// ---------------------------------------------------------------------------

async function jsFiles(dir) {
  const out = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...(await jsFiles(full)));
    } else if (entry.name.endsWith(".js") && !SKIP_FILES.has(entry.name)) {
      out.push(full);
    }
  }

  return out;
}

function syntaxCheck(file) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    return null;
  } catch (error) {
    return error.stderr.toString();
  }
}

async function main() {
  const files = await jsFiles(JS_DIR);
  let total = 0;
  let failures = 0;

  for (const file of files) {
    const original = await readFile(file, "utf8");

    const { out, count } = wrapHostCalls(original);
    const text = applyRewrites(out);

    if (text === original) continue;

    await writeFile(file, text, "utf8");

    const error = syntaxCheck(file);
    const rel = path.relative(ROOT, file);

    if (error) {
      failures++;
      console.error(`  ${rel}: SYNTAX ERROR after patching, reverting\n${error}`);
      await writeFile(file, original, "utf8");
    } else {
      total += count;
      console.log(`  ${rel} (${count} URL call(s))`);
    }
  }

  console.log(`\nRewrote ${total} URL construction sites.`);

  if (failures) {
    console.error(`${failures} file(s) failed and were reverted.`);
    process.exit(1);
  }
}

await main();
