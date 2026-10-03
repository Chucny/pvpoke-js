// tools/smoke.mjs
//
// Loads each generated page in headless Chrome and fails on any uncaught error.
//
// A static conversion can 200 every file and still be broken: the page's own JS
// runs at load time, so a bad path or a missing global only shows up in the
// browser console. This catches that without a full test runner.
//
// It drives Chrome directly rather than Puppeteer, since the repo has no
// dependencies and adding one just for this would be out of proportion.
//
// Usage: node tools/smoke.mjs [url ...]

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Console noise that is not ours: GPU probing, sandbox refusals, and the
// Windows registry lookup Chrome does at startup.
const NOISE = /GPU|gpu|dbus|DevTools|voice|Fontconfig|registry_loader|HKLM|Attempt to fetch|net::ERR_ABORTED/i;

// The app is chatty on purpose (it console.logs its data loads), so only
// genuine failures count. An uncaught throw is the signal worth failing on.
const REAL_ERROR = /Uncaught|SyntaxError|TypeError|ReferenceError|RangeError|\bError:|is not a function|is not defined|Failed to load resource|404/;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/c/Program Files/Google/Chrome/Application/chrome.exe",
  "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  path.join(os.homedir(), "AppData/Local/Google/Chrome/Application/chrome.exe"),
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

function findChrome() {
  return CHROME_CANDIDATES.find((candidate) => existsSync(candidate)) || null;
}

function loadPage(chrome, url, profileDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(chrome, [
      "--headless",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-sandbox",
      "--no-first-run",
      "--user-data-dir=" + profileDir,
      // Long enough for the gamemaster JSON and the first rankings fetch to
      // land, short enough to keep the suite quick. Override with SMOKE_BUDGET.
      "--virtual-time-budget=" + (process.env.SMOKE_BUDGET || 8000),
      "--enable-logging=stderr",
      "--dump-dom",
      url,
    ]);

    let stderr = "";
    // --dump-dom writes the whole serialized page to stdout. That can exceed
    // the pipe buffer, and an unread pipe blocks Chrome from ever exiting, so
    // drain it even though the DOM itself is not what we assert on.
    child.stdout.on("data", () => {});
    child.stdout.on("error", () => {});

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);

    child.on("close", () => {
      const errors = [];

      for (const line of stderr.split("\n")) {
        if (!line.includes("CONSOLE:")) continue;
        if (NOISE.test(line)) continue;
        if (!REAL_ERROR.test(line)) continue;

        errors.push(line.replace(/^.*CONSOLE:\d+\]\s*/, "").trim());
      }

      resolve(errors);
    });
  });
}

const chrome = findChrome();

if (! chrome) {
  console.error("Could not find Chrome. Set CHROME_PATH to your browser binary.");
  process.exit(1);
}

const BASE = process.env.SMOKE_BASE || "http://localhost:8765";
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

const PAGES = process.argv.slice(2).length
  ? process.argv.slice(2).map(normalizePage)
  : [
      "/index.html",
      "/battle.html",
      "/rankings.html",
      "/team-builder.html",
      "/moves.html",
      "/custom-rankings.html",
      "/pokedex.html",
      "/attack-cmp-chart.html",
      "/settings.html",
      "/articles/index.html",
      "/train/index.html",
      "/train/analysis.html",
      "/tera/index.html",
    ];

const profileDir = await mkdtemp(path.join(os.tmpdir(), "pvpoke-smoke-"));

// Accept "battle.html", "/battle.html", or a full URL.
//
// Git Bash rewrites a leading-slash argument into an absolute Windows path
// before Node ever sees it ("/train/index.html" arrives as
// "C:/Program Files/Git/train/index.html"), so a mangled argument has to be
// mapped back to the page it meant. Rather than guessing which prefix was
// prepended, try successively shorter suffixes and keep the longest one that is
// a real page under src/.
function normalizePage(page) {
  if (/^https?:\/\//.test(page)) return page;

  const slashed = page.replace(/\\/g, "/");

  if (! /^[A-Za-z]:\//.test(slashed) && ! slashed.includes(" ")) {
    return slashed.startsWith("/") ? slashed : "/" + slashed;
  }

  const segments = slashed.split("/").filter(Boolean);

  for (let start = 0; start < segments.length; start++) {
    const candidate = "/" + segments.slice(start).join("/");

    if (existsSync(path.join(OUT_DIR, candidate))) return candidate;
  }

  // Nothing matched; fall back to the filename so the failure is visible.
  return "/" + segments[segments.length - 1];
}

let failures = 0;

try {
  for (const page of PAGES) {
    const errors = await loadPage(chrome, BASE + page, profileDir);

    if (errors.length) {
      failures++;
      console.error(`FAIL ${page}`);

      for (const error of errors.slice(0, 5)) {
        console.error(`     ${error.slice(0, 200)}`);
      }
    } else {
      console.log(`ok   ${page}`);
    }
  }
} finally {
  await rm(profileDir, { recursive: true, force: true });
}

console.log(`\n${PAGES.length - failures}/${PAGES.length} page(s) loaded without uncaught errors.`);

process.exit(failures ? 1 : 0);