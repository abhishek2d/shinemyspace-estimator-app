/**
 * sw.js — offline app shell.
 *
 * Caches the app's own files so the calculator opens with no internet, even
 * after the browser/phone has been fully closed and reopened. Live pricing
 * and quote submission still need internet — this only covers the app shell
 * and the offline features (calculator, print, save/library).
 *
 * When you deploy a new version, bump CACHE_VERSION so users get fresh files
 * instead of a stale cached copy.
 */

const CACHE_VERSION = "v6";
const CACHE_NAME = `sms-estimator-${CACHE_VERSION}`;

// The files that make up the app shell. Paths are relative to this file,
// which sits at the site root next to index.html.
const APP_SHELL = [
  "index.html",
  "assets/css/estimator.css",
  "assets/js/splash-failsafe.js",
  "assets/js/calc/app.js",
  "assets/js/calc/auth.js",
  "assets/js/calc/config.js",
  "assets/js/calc/calculator.js",
  "assets/js/calc/library.js",
  "assets/js/calc/quote.js",
  "assets/js/calc/state.js",
  "assets/js/calc/ui.js",
  "assets/js/calc/items.js",
  "assets/data/items.json",
  "assets/images/shine-my-space-logo.png",
  "assets/images/favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  // Activate this new service worker immediately instead of waiting.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Remove caches from older versions so stale files don't linger.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("sms-estimator-") && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET requests from our own origin. Everything else (the
  // Google Sign-In script, the backend API) goes straight to the network.
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Navigations (opening the page) → serve the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("index.html"))
    );
    return;
  }

  // Static assets → cache-first (fast, works offline), fall back to network.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
