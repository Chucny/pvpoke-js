// FileWriter.js
//
// Replaces `data/write.php`, which saved generated JSON straight to the
// server's filesystem. There is no server now, so the author-facing tools that
// produced that JSON (the rankers, the override editor) hand the browser a file
// download instead and the result gets committed to src/data/ by hand.
//
// This only ever ran behind the developer panel, on the author's own machine,
// so a download is a faithful replacement: same JSON, same destination path,
// just delivered through the browser rather than written by PHP.
//
// Usage:
//     saveDataFile("rankings/all/overall/rankings-1500.json", json);

(function () {
	// Trigger a download for one generated file.
	//
	// `path` is the location the file belongs at under src/data/, so the author
	// knows where to drop it. Browsers flatten separators out of a download's
	// filename, so the path is flattened into the name here and the original is
	// logged alongside it.
	function saveDataFile(path, json) {
		var target = String(path).replace(/^\/+/, "");

		var filename = target.replace(/\//g, "-");

		var blob = new Blob([json], { type: "application/json" });
		var href = URL.createObjectURL(blob);

		var link = document.createElement("a");

		link.href = href;
		link.download = filename;

		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);

		// Hand the download off, then release the object URL so the blob can be
		// garbage collected. Revoking synchronously cancels the download in some
		// browsers, so let the current task finish first.
		setTimeout(function () {
			URL.revokeObjectURL(href);
		}, 0);

		console.log("Saved " + target + " as " + filename + "; place it under src/data/" + target);

		return filename;
	}

	window.saveDataFile = saveDataFile;
})();