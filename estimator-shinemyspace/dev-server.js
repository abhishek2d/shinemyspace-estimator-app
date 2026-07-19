/**
 * dev-server.js — LOCAL testing only (not used in production).
 *
 * A zero-dependency static file server for the estimator frontend. It exists
 * for one reason the usual static servers don't handle: it sets
 *   Cross-Origin-Opener-Policy: same-origin-allow-popups
 * which Google Identity Services needs so its sign-in popup can post the
 * credential back to the page. Also sends no-store so edits show on refresh.
 *
 * Run with:  npm start   (serves http://localhost:5500)
 *
 * In production the frontend is plain static files on Hostinger — this file is
 * ignored there (don't upload it, or just leave it; it's never executed).
 */

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 5500;
const HOST = "127.0.0.1"; // localhost also resolves here

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

const server = http.createServer(async (req, res) => {
  // Resolve the request path safely under ROOT (block ../ traversal).
  let urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = normalize(join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(filePath)] || "application/octet-stream",
      // The header that makes Google Sign-In's popup work locally:
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Frontend on http://localhost:${PORT}  (COOP: same-origin-allow-popups)`);
});
