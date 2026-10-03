// tools/serve.mjs
//
// Serves the generated site from src/ over plain HTTP, which is the whole point
// of the conversion: no PHP, no rewrite rules, no build step at request time.
//
// This exists because `python -m http.server` is not available everywhere, and
// because this one serves src/ as the document root, matching how WEB_ROOT is
// set to "/" in build.mjs and Boot.js.
//
// Usage: node tools/serve.mjs [port]

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "src");
const PORT = Number(process.argv[2]) || 8000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function resolve(urlPath) {
  // Strip the query string; the site encodes state in query params that the
  // client-side Router reads, so the server has nothing to do with them.
  const clean = decodeURIComponent(urlPath.split("?")[0]);

  // Refuse to escape the document root.
  const target = path.join(OUT_DIR, path.normalize(clean));
  let resolved = path.resolve(target);

  if (resolved !== OUT_DIR && !resolved.startsWith(OUT_DIR + path.sep)) return null;

  let info = await stat(resolved).catch(() => null);

  // Mirror the old pretty URLs: /battle/ serves battle.html, and a directory
  // serves its index.html. A static host cannot rewrite, so do it here to keep
  // old bookmarks working during development.
  if (info?.isDirectory()) {
    resolved = path.join(resolved, "index.html");
    info = await stat(resolved).catch(() => null);
  }

  if (! info?.isFile()) {
    const withHtml = `${resolved}.html`;
    info = await stat(withHtml).catch(() => null);

    if (info?.isFile()) return withHtml;
    return null;
  }

  return resolved;
}

createServer(async (request, response) => {
  const file = await resolve(request.url);

  if (! file) {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("404 Not Found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-cache",
  });

  createReadStream(file).pipe(response);
}).listen(PORT, () => {
  console.log(`Serving src/ at http://localhost:${PORT}/`);
});