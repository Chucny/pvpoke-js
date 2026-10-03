// tools/verify.mjs
//
// Runs the whole conversion check suite in the order the steps depend on each
// other, and reports a single pass/fail.
//
//   build        regenerate src/ from pages/ and partials/
//   check-links  every root-relative href/src resolves to a real file
//   check-scripts  no duplicate or misordered <script src>
//   smoke        each page loads in a real browser with no uncaught errors
//   render       each page actually populates its results
//   sim          the battle simulator computes a valid result
//
// The browser steps need `node tools/serve.mjs` running, since they load the
// site over HTTP. Start it first, or set SMOKE_BASE if it is on another port.
//
// Usage: node tools/verify.mjs            (static checks only)
//        node tools/verify.mjs --browser  (include the browser checks)

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const STATIC_STEPS = [
  ["Build", "build.mjs"],
  ["Links", "check-links.mjs"],
  ["Scripts", "check-scripts.mjs"],
];

const BROWSER_STEPS = [
  ["Smoke", "smoke.mjs"],
  ["Render", "check-render.mjs"],
  ["Sim", "check-sim.mjs"],
];

const withBrowser = process.argv.includes("--browser");

const steps = [
  ...STATIC_STEPS,
  ...(withBrowser ? BROWSER_STEPS : []),
];

function run(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HERE, script)], {
      stdio: "inherit",
    });

    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

const results = [];

for (const [label, script] of steps) {
  console.log(`\n=== ${label} (${script}) ===`);

  results.push([label, await run(script)]);
}

console.log("\n=== Summary ===");

let failed = 0;

for (const [label, ok] of results) {
  if (! ok) failed++;

  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}`);
}

if (! withBrowser) {
  console.log("\n  (browser checks skipped; pass --browser to include them)");
}

console.log(`\n${results.length - failed}/${results.length} step(s) passed.`);

process.exit(failed ? 1 : 0);