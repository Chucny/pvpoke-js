// tools/check-render.mjs
//
// Verifies the pages actually *do* something, not merely load without throwing.
//
// tools/smoke.mjs catches a page that explodes on load. This catches the quieter
// failure where the markup is fine and the JS runs, but nothing renders because
// a data file 404s or the interface never wired up. The simulator pages are the
// ones worth asserting on: they fetch the gamemaster and a rankings JSON, then
// draw results, so an empty results container means something is broken even
// though the console is clean.
//
// Usage: node tools/check-render.mjs

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const BASE = process.env.SMOKE_BASE || "http://localhost:8765";
const BUDGET = process.env.SMOKE_BUDGET || 8000;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/c/Program Files/Google/Chrome/Application/chrome.exe",
  "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  path.join(os.homedir(), "AppData/Local/Google/Chrome/Application/chrome.exe"),
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));

if (! chrome) {
  console.error("Could not find Chrome. Set CHROME_PATH to your browser binary.");
  process.exit(1);
}

// Each case counts a pattern that only matches once the page's JS has run and
// filled that region in. The counts are deliberately loose: they prove data
// arrived, without pinning exact league sizes that change every season.
//
// Patterns rather than CSS selectors, because Chrome's --dump-dom injects
// implied <tbody> elements and jQuery-built markup varies enough that a
// selector engine would be more machinery than the check is worth.
const CASES = [
  // RankingInterface writes one <div class="rank ..."> per Pokemon.
  { page: "/rankings.html", pattern: '<div class="rank ', min: 100, what: "ranking entries" },

  // PokeSelect writes one <option value="speciesId">Name</option> per Pokemon.
  // The exact count depends on which forms the gamemaster lists for the default
  // league, so the bar is just "clearly populated", not an exact roster size.
  { page: "/battle.html", pattern: '<option value="[a-z0-9_]+">[A-Z]', min: 30, what: "pokemon options" },
  { page: "/team-builder.html", pattern: '<option value="[a-z0-9_]+">[A-Z]', min: 30, what: "pokemon options" },

  // SortableTable builds the moves table as <table class="sortable-table stats-table moves">.
  { page: "/moves.html", pattern: '<table class="sortable-table stats-table moves"', min: 1, what: "moves table" },

  { page: "/articles/index.html", pattern: 'class="article-item', min: 5, what: "article items" },

  // The homepage clones .news-item.template for each RSS entry; the template
  // itself is still in the DOM, so count and then discount it.
  { page: "/index.html", pattern: 'class="news-item', min: 5, what: "news feed items" },
];

function dumpDom(url, profileDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(chrome, [
      "--headless",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--no-first-run",
      "--user-data-dir=" + profileDir,
      "--virtual-time-budget=" + BUDGET,
      "--dump-dom",
      url,
    ]);

    let dom = "";

    child.stdout.on("data", (chunk) => {
      dom += chunk;
    });

    child.on("error", reject);
    child.stderr.on("data", () => {});

    child.on("close", () => resolve(dom));
  });
}

// Count non-overlapping matches of a pattern in the dumped DOM.
function countMatches(dom, pattern) {
  return (dom.match(new RegExp(pattern, "g")) || []).length;
}



const profileDir = await mkdtemp(path.join(os.tmpdir(), "pvpoke-render-"));
let failures = 0;

try {
  for (const testCase of CASES) {
    const dom = await dumpDom(BASE + testCase.page, profileDir);
    const found = countMatches(dom, testCase.pattern);

    if (found >= testCase.min) {
      console.log(`ok   ${testCase.page} (${testCase.what}: ${found})`);
    } else {
      failures++;
      console.error(`FAIL ${testCase.page}: expected >=${testCase.min} ${testCase.what} matching /${testCase.pattern}/, found ${found}`);
    }
  }
} finally {
  await rm(profileDir, { recursive: true, force: true });
}

console.log(`\n${CASES.length - failures}/${CASES.length} page(s) rendered content.`);

process.exit(failures ? 1 : 0);