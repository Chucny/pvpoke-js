// tools/compile-gamemaster.mjs
//
// Assembles data/gamemaster.json (and .min.json) from the individual chunks in
// src/data/gamemaster/. This replaces src/data/compile.php.
//
// The chunks are split up so the gamemaster can be edited in manageable pieces;
// nothing loads them individually at runtime, so they have to be merged here.
//
// It also writes src/data/gamemaster/cups/manifest.json, a plain list of the cup
// filenames. A static file server cannot list a directory, so the developer
// panel's browser-side "Compile gamemaster" button reads that manifest to know
// which cups to fetch.
//
// Note the old compile.php also emitted src/data/formats.php. Nothing loads that
// any more (the formats live in the compiled JSON and are read from there), so
// it is deliberately not written.
//
// Usage: node tools/compile-gamemaster.mjs

import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GM_DIR = path.join(ROOT, "src", "data", "gamemaster");
const CUPS_DIR = path.join(GM_DIR, "cups");

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

// DirectoryIterator in the PHP version picked up top-level .json files only, so
// skip the archive/ subdirectory here rather than folding it in.
//
// manifest.json is written into this same directory and must be excluded, or it
// would be merged in as if it were a cup.
const MANIFEST = "manifest.json";

async function cupFiles() {
  const entries = await readdir(CUPS_DIR, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== MANIFEST)
    .map((entry) => entry.name)
    .sort();
}

async function main() {
  const base = await readJson(path.join(GM_DIR, "base.json"));
  const pokemon = await readJson(path.join(GM_DIR, "pokemon.json"));
  const moves = await readJson(path.join(GM_DIR, "moves.json"));
  const formats = await readJson(path.join(GM_DIR, "formats.json"));

  base.timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");
  base.pokemon = pokemon;
  base.moves = moves;
  base.formats = formats;

  const files = await cupFiles();
  const missing = [];

  base.cups = [];

  for (const file of files) {
    // One bad cup should be reported rather than aborting the whole compile,
    // matching how the PHP version collected errors and carried on.
    try {
      base.cups.push(await readJson(path.join(CUPS_DIR, file)));
    } catch (error) {
      missing.push(file);
    }
  }

  if (missing.length) {
    console.error(`  invalid cup file(s): ${missing.join(", ")}`);
    process.exit(1);
  }

  // JSON.stringify emits no insignificant whitespace, which is exactly what the
  // PHP version's json_encode() produced, so both files come out compact. The
  // committed gamemaster.json was pretty-printed afterwards by some external
  // formatter; that is presentation for a generated artifact nobody edits, and
  // the app loads the minified copy regardless.
  const json = JSON.stringify(base);

  await writeFile(path.join(ROOT, "src", "data", "gamemaster.json"), json, "utf8");
  await writeFile(path.join(ROOT, "src", "data", "gamemaster.min.json"), json, "utf8");

  // Lets the browser-side compile enumerate cups on a static server, which
  // cannot list a directory.
  await writeFile(
    path.join(CUPS_DIR, MANIFEST),
    JSON.stringify(files, null, "\t"),
    "utf8"
  );

  console.log(`  gamemaster compiled: ${base.pokemon.length} Pokemon, ${base.moves.length} moves, ${base.cups.length} cups`);
}

await main();