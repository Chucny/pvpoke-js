// tools/patch-settings.mjs
//
// Removes the last PHP endpoints from the client code.
//
// `data/settingsCookie.php` existed only to call setcookie() on the server.
// Settings now live in localStorage, written by saveSettings() in Boot.js, so
// these AJAX POSTs become local writes.
//
// Dev-time only; output is committed.
//
// Note the ordering this depends on: patch-links.mjs runs first and rewrites the
// bare `host +` concatenation, which wraps these url values as
// `url('data/settingsCookie.php')`. So the closing paren is present here and the
// pattern has to allow for it.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = [
  "src/js/interface/Settings.js",
  "src/js/interface/Pokebox.js",
  "src/js/devtools/gm-editor/GMEditorInterface.js",
];

// Matches an $.ajax({ ... }) block whose url is settingsCookie.php.
//
// The `(?:(?!\$\.ajax\()[\s\S])*?` parts are tempered greedy tokens: they match
// any text that does *not* start another $.ajax call. Without that guard the
// pattern happily begins at an unrelated $.ajax({ earlier in the file and spans
// all the way down to the settingsCookie one, deleting everything between.
//
// - `[ \t]*` because the gm-editor indents with spaces while everything else
//   uses tabs; matching only tabs silently skipped those two blocks.
// - `\)?,` because patch-links.mjs has already wrapped the path in url(...).
const ajaxBlock = /[ \t]*\$\.ajax\(\{(?:(?!\$\.ajax\()[\s\S])*?url\s*:\s*[^,\n]*'data\/settingsCookie\.php'\)?,(?:(?!\$\.ajax\()[\s\S])*?\}\);[ \t]*\r?\n/g;

// Each site posted the settings for a different reason and did different work in
// its success handler. That work is inlined here so the behavior survives the
// endpoint going away, so the replacement is chosen from what the block itself
// contained rather than from which file it is in.
function replacementFor(match, indent, unit) {
  const pad = (depth) => indent + unit.repeat(depth);

  // Settings.js rebuilds the object from the form controls, so persist exactly
  // what the user just changed rather than the possibly-stale global.
  if (/data\s*:\s*\{[\s\S]*'defaultIVs'\s*:\s*defaultIVs/.test(match)) {
    return [
      `${indent}var updated = {`,
      `${pad(1)}'defaultIVs' : defaultIVs,`,
      `${pad(1)}'animateTimeline' : animateTimeline,`,
      `${pad(1)}'matrixDirection': settings.matrixDirection || "row",`,
      `${pad(1)}'theme': theme,`,
      `${pad(1)}'gamemaster': gamemaster,`,
      `${pad(1)}'pokeboxId': pokeboxId,`,
      `${pad(1)}'pokeboxLastDateTime': settings.pokeboxLastDateTime,`,
      `${pad(1)}'ads': ads,`,
      `${pad(1)}'xls': xls,`,
      `${pad(1)}'rankingDetails': rankingDetails,`,
      `${pad(1)}'hardMovesetLinks': hardMovesetLinks,`,
      `${pad(1)}'colorblindMode': colorblindMode,`,
      `${pad(1)}'performanceMode': performanceMode`,
      `${indent}};`,
      "",
      `${indent}// Keep the in-memory copy in sync for anything that reads`,
      `${indent}// \`settings\` later on this page.`,
      `${indent}for(var key in updated){`,
      `${pad(1)}if(updated.hasOwnProperty(key)){`,
      `${pad(2)}settings[key] = updated[key];`,
      `${pad(1)}}`,
      `${indent}}`,
      "",
      `${indent}window.saveSettings(updated);`,
      "",
      `${indent}modalWindow("Settings Saved", $("<p>Your settings have been updated. (Refresh the page if you've updated the site appearance.)</p>"))`,
    ].join("\n") + "\n";
  }

  // Entering a Pokebox ID stores it, swaps the modal panel, and reloads the box.
  if (/pokebox-off/.test(match)) {
    return [
      `${indent}settings.pokeboxId = pokeboxId;`,
      "",
      `${indent}window.saveSettings(settings);`,
      "",
      `${indent}$(".modal .pokebox-off").hide();`,
      `${indent}$(".modal .pokebox-on").show();`,
      "",
      `${indent}self.loadPokebox(true);`,
    ].join("\n") + "\n";
  }

  // Saving a new gamemaster hands off to the edit page for that gamemaster.
  if (/save-new-btn/.test(match)) {
    return [
      `${indent}window.saveSettings(settings);`,
      "",
      `${indent}// Navigate to edit page`,
      `${indent}window.location.href = $("a#save-new-btn").attr("href");`,
    ].join("\n") + "\n";
  }

  // Switching the active gamemaster only needs the write and a log line.
  if (/Settings updated/.test(match)) {
    return [
      `${indent}window.saveSettings(settings);`,
      "",
      `${indent}console.log("Settings updated");`,
    ].join("\n") + "\n";
  }

  // Recording the last-seen Pokebox timestamp.
  if (/Datetime/.test(match)) {
    return [
      `${indent}window.saveSettings(settings);`,
      "",
      `${indent}console.log("Datetime " + settings.pokeboxLastDateTime + " saved");`,
    ].join("\n") + "\n";
  }

  // Anything unrecognized just persists, rather than silently dropping the save.
  return `${indent}window.saveSettings(settings);\n`;
}

let changed = 0;

for (const rel of TARGETS) {
  const file = path.join(ROOT, rel);
  const before = await readFile(file, "utf8");

  let count = 0;

  const after = before.replace(ajaxBlock, (match) => {
    count++;

    // Match the file's own indentation rather than assuming tabs, so the result
    // stays readable in files that indent with spaces.
    const line = match.split("\n")[0];
    const indent = (line.match(/^[ \t]*/) || [""])[0];
    const unit = indent.includes("\t") ? "\t" : "    ";

    return replacementFor(match, indent, unit);
  });

  if (after !== before) {
    await writeFile(file, after, "utf8");
    console.log(`  ${rel}: replaced ${count} settingsCookie.php call(s)`);
    changed += count;
  } else {
    console.log(`  ${rel}: no settingsCookie.php calls found`);
  }
}

console.log(`\nReplaced ${changed} PHP settings endpoints.`);

if (! changed) {
  console.error("\nExpected to replace 5 calls but replaced none; the pattern no longer matches.");
  process.exit(1);
}