// tools/check-sim.mjs
//
// End-to-end check that the battle simulator actually computes results.
//
// The other checks prove pages load and render their data. This one exercises
// the core feature: it drives a real battle in the browser and asserts the
// result looks like a real result (both sides have a Battle Rating, the
// timeline drew actions, and the Pokemon got selected).
//
// It injects a script into the page rather than clicking, because the interface
// binds jQuery handlers on load and reproducing a real click sequence through
// --dump-dom is not possible. The script uses the same public entry points the
// UI does.
//
// Usage: node tools/check-sim.mjs

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const BASE = process.env.SMOKE_BASE || "http://localhost:8765";
const BUDGET = process.env.SMOKE_BUDGET || 12000;

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

// Appended to the page so it runs after the app's own scripts. Writes its
// verdict into the DOM so --dump-dom can read it back.
//
// The gamemaster arrives over XHR, and Pokemon() needs it to already be indexed
// (Pokemon.js reads GameMaster's pokemonMap). So poll for loadedData rather than
// running immediately, or the probe would fail on a page that is working fine.
const PROBE = `
<script>
(function(){
	var deadline = Date.now() + 8000;

	function ready(){
		var gm = GameMaster.getInstance();
		return gm.loadedData > 0 && gm.data.pokemon && gm.data.pokemon.length > 0;
	}

	function report(el){
		document.body.appendChild(el);
	}

	function run(){
		var div = document.createElement("div");
		div.id = "sim-probe";

		try {
			var b = new Battle();
			b.setCP(1500);
			b.setCup("all");

			var p1 = new Pokemon("gible", 0, b);
			var p2 = new Pokemon("lucario", 1, b);

			p1.initialize(1500, "gamemaster");
			p2.initialize(1500, "gamemaster");

			b.setNewPokemon(p1, 0, false);
			b.setNewPokemon(p2, 1, false);

			// Recommended movesets, the same path the "auto select" button uses.
			p1.selectRecommendedMoveset("overall");
			p2.selectRecommendedMoveset("overall");

			// This is the same call sequence Interface.js uses to run a battle.
			b.simulate();

			var ratings = b.getBattleRatings();

			div.setAttribute("data-r1", String(ratings[0]));
			div.setAttribute("data-r2", String(ratings[1]));
			div.setAttribute("data-actions", String(b.getTurns()));
			div.setAttribute("data-p1", p1.speciesName + " / " + p1.generateMovesetStr());
			div.setAttribute("data-p2", p2.speciesName + " / " + p2.generateMovesetStr());
		} catch(e) {
			div.setAttribute("data-error", e.message);
		}

		report(div);
	}

	function poll(){
		if(ready()){
			run();
		} else if(Date.now() < deadline){
			setTimeout(poll, 100);
		} else{
			var div = document.createElement("div");
			div.id = "sim-probe";
			div.setAttribute("data-error", "gamemaster never finished loading");
			report(div);
		}
	}

	poll();
})();
</script>
`;

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

function attr(dom, name) {
  const match = dom.match(new RegExp(`${name}="([^"]*)"`));
  return match ? match[1] : null;
}

// The battle page is generated from pages/battle.html, so probe that file
// directly: append the probe to a scratch copy and serve it from src/.
const probeFile = path.join(OUT_DIR, "sim-probe.html");

const profileDir = await mkdtemp(path.join(os.tmpdir(), "pvpoke-sim-"));

try {
  const page = await readFile(path.join(OUT_DIR, "battle.html"), "utf8");
  await writeFile(probeFile, page.replace("</body>", PROBE + "\n</body>"), "utf8");

  const dom = await dumpDom(BASE + "/sim-probe.html", profileDir);

  const error = attr(dom, "data-error");

  if (error) {
    console.error(`FAIL battle simulation threw: ${error}`);
    process.exit(1);
  }

  const r1 = Number(attr(dom, "data-r1"));
  const r2 = Number(attr(dom, "data-r2"));
  const actions = Number(attr(dom, "data-actions"));
  const p1 = attr(dom, "data-p1");
  const p2 = attr(dom, "data-p2");

  console.log(`  ${p1} vs ${p2}`);
  console.log(`  Battle Ratings: ${r1} / ${r2}, timeline actions: ${actions}`);

  const problems = [];

  if (! Number.isFinite(r1) || ! Number.isFinite(r2)) {
    problems.push("Battle Rating was not a number");
  }

  // A Battle Rating is 0-1000 by definition, with 500 the break-even line.
  if (r1 < 0 || r1 > 1000) problems.push(`p1 Battle Rating ${r1} outside 0-1000`);
  if (r2 < 0 || r2 > 1000) problems.push(`p2 Battle Rating ${r2} outside 0-1000`);

  // Ratings are complementary: one Pokemon's damage share is the other's HP share.
  if (Math.abs(r1 + r2 - 1000) > 1) {
    problems.push(`Battle Ratings should sum to 1000, got ${r1 + r2}`);
  }

  if (! actions || actions < 1) problems.push("no timeline actions were produced");

  if (problems.length) {
    for (const problem of problems) console.error(`FAIL ${problem}`);
    process.exit(1);
  }

  console.log("\nok   battle simulation produced a valid result");
} finally {
  await rm(profileDir, { recursive: true, force: true });
  await rm(probeFile, { force: true });
}