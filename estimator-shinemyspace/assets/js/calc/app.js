/**
 * app.js — the entry point that wires everything together.
 *
 * Boot order:
 *   1. If a valid (non-expired) access marker exists → open the app with no
 *      network at all (works offline for up to 7 days after first sign-in).
 *      No Google token is needed to open the app.
 *   2. Otherwise show the Google Sign-In button. On sign-in we verify the
 *      account with the server, store the 7-day access marker, then open.
 *
 * The Google token itself is held in memory only and fetched on demand for
 * backend calls (see auth.js) — never persisted with the access marker.
 *
 * The app shell is cached by a service worker (sw.js) so it also loads with
 * no network after the browser/phone has been fully closed and reopened.
 */

import * as state from "./state.js";
import * as ui from "./ui.js";
import { getAccess, verifyAndUnlock, onCredential, purgeLegacySession } from "./auth.js";
import { printQuote } from "./quote.js";

const $ = (id) => document.getElementById(id);

// Global callback invoked by Google Sign-In whenever a credential arrives:
//   - from the login gate button (first sign-in / re-unlock),
//   - from auto-select on load, or a prompt() we triggered while open.
window.handleCredentialResponse = async function (response) {
  const jwt = response.credential;

  // App already open → a token just arrived (silent re-auth or menu sign-in).
  // Store it, refresh the auth UI, and opportunistically refresh live prices.
  if (!$("app").hidden) {
    onCredential(jwt);
    ui.refreshAuthUI();
    ui.refreshItems();
    return;
  }

  // At the gate → verify with the server, then unlock and enter.
  const errorEl = $("login-error");
  if (errorEl) errorEl.textContent = "";
  try {
    await verifyAndUnlock(jwt);
    enterApp();
  } catch (err) {
    if (errorEl) {
      const offline = !navigator.onLine;
      errorEl.textContent = offline
        ? "You're offline. The first sign-in requires an internet connection."
        : err.message || "Sign-in failed. Please try again.";
    }
  }
};

let gateWarmTimer = null;

function enterApp() {
  clearInterval(gateWarmTimer); // stop the gate warm-up; ui.init takes over
  $("login-gate").hidden = true;
  $("app").hidden = false;
  startApp();
}

function startApp() {
  // Load any auto-saved estimate, then render the UI.
  state.load();
  ui.init();

  // Print action.
  $("print").addEventListener("click", printQuote);

  // If we already hold a fresh token (e.g. straight after gate sign-in), pull
  // live prices in the background. Otherwise the cached/bundled catalogue is used.
  ui.refreshItems();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  // Skip the offline cache during local development — the service worker
  // would otherwise serve stale files and hide your latest code edits.
  const isLocal =
    location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (isLocal) {
    // Also tear down any service worker left over from earlier testing.
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((reg) => reg.unregister());
    });
    return;
  }

  navigator.serviceWorker.register("sw.js").catch(() => {
    /* offline shell just won't be available; app still works online */
  });
}

/**
 * Explicitly (re)initialize Google Identity Services once its script has loaded,
 * passing OUR callback. This removes a load-order race: the HTML g_id_onload
 * auto-init can run before this module defines window.handleCredentialResponse,
 * making GIS log "callback is not a function" and silently drop credentials.
 * Retries briefly until the async GIS script is available.
 */
function setupGoogleSignIn(attempt = 0) {
  const gid = window.google?.accounts?.id;
  if (!gid) {
    if (attempt < 40) setTimeout(() => setupGoogleSignIn(attempt + 1), 150);
    return;
  }
  const cfg = $("g_id_onload");
  if (!cfg) return;
  gid.initialize({
    client_id: cfg.dataset.client_id,
    callback: window.handleCredentialResponse,
    auto_select: cfg.dataset.auto_select === "true",
    itp_support: cfg.dataset.itp_support === "true",
  });
  // Re-render the gate button with this (correct-callback) init.
  const gateBtn = document.querySelector("#login-gate .g_id_signin");
  if (gateBtn) {
    gateBtn.innerHTML = "";
    gid.renderButton(gateBtn, { theme: "filled_blue", size: "large", text: "signin_with", shape: "pill" });
  }
}

function boot() {
  registerServiceWorker();
  purgeLegacySession(); // remove any token-bearing session from the old design
  setupGoogleSignIn(); // register our callback reliably (independent of load order)

  // Valid access marker → straight in, no network needed.
  if (getAccess()) {
    enterApp();
    return;
  }

  // No/expired access → show the Google Sign-In gate. Pre-warm the backend now
  // (and every 3 min while they linger on the gate) so it's awake by the time
  // they sign in — the sign-in call hits the server, and Render may be cold.
  $("login-gate").hidden = false;
  $("app").hidden = true;
  ui.warmServer();
  gateWarmTimer = setInterval(() => ui.warmServer(), 180_000);
}

boot();
