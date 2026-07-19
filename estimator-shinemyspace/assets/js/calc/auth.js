/**
 * auth.js — two separate concerns, deliberately decoupled:
 *
 *  1. APP ACCESS (7-day, offline, NO secret)
 *     A tiny marker { email, name, unlockedAt } in localStorage. It only gates
 *     the UI so the calculator/print/save work offline for ACCESS_MAX_AGE_DAYS
 *     after the first sign-in. It carries no token — losing it leaks nothing.
 *
 *  2. GOOGLE TOKEN (in-memory only, ~1hr, fetched on demand)
 *     The real Google ID token is needed ONLY to call the backend (live items /
 *     publish to Zoho). It is never written to disk. We obtain a fresh one when
 *     needed via Google Identity Services — silently if the user still has an
 *     active Google session (the usual case), otherwise with a quick prompt.
 *
 * Security: the sensitive token's lifetime on the device drops from 7 days to
 * ~1 hour in memory, and the backend re-verifies it (signature + allowlist) on
 * every call regardless. App entry was never the security boundary — the API is.
 */

import { API_URL, ACCESS_KEY, LEGACY_SESSION_KEY, ACCESS_MAX_AGE_DAYS, TOKEN_KEY } from "./config.js";

const MAX_AGE_MS = ACCESS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
// Treat an in-memory token as usable for 50 min (Google ID tokens live ~1hr;
// leave a margin so we never send one that expires mid-request).
const TOKEN_TTL_MS = 50 * 60 * 1000;

/* ------------------------------------------------------------------ *
 *  1. App access marker (7-day, no token)
 * ------------------------------------------------------------------ */

/** One-time cleanup: drop the old design's token-bearing session from storage. */
export function purgeLegacySession() {
  try {
    localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch (_) {}
}

/** The valid (non-expired) access marker, or null. Local only — works offline. */
export function getAccess() {
  let raw;
  try {
    raw = localStorage.getItem(ACCESS_KEY);
  } catch (_) {
    return null;
  }
  if (!raw) return null;

  let access;
  try {
    access = JSON.parse(raw);
  } catch (_) {
    return null;
  }

  if (!access || !access.email || !access.unlockedAt) return null;
  if (Date.now() - access.unlockedAt > MAX_AGE_MS) {
    clearAccess();
    return null;
  }
  return access;
}

function saveAccess(email, name) {
  try {
    localStorage.setItem(
      ACCESS_KEY,
      JSON.stringify({ email, name: name || "", unlockedAt: Date.now() })
    );
  } catch (_) {
    /* if storage is blocked the user just re-signs in next open */
  }
}

export function clearAccess() {
  try {
    localStorage.removeItem(ACCESS_KEY);
  } catch (_) {}
}

/** The signed-in identity (from the access marker), or null. */
export function getUser() {
  const access = getAccess();
  return access ? { email: access.email, name: access.name } : null;
}

/* ------------------------------------------------------------------ *
 *  2. Google token (in memory only, on demand)
 * ------------------------------------------------------------------ */

let token = null; // the Google ID token (JWT string)
let tokenAt = 0; // when it was obtained (ms)
let pending = null; // { resolve, reject } for an in-flight sign-in

// Rehydrate the token on load so the session survives page refreshes AND
// closing/reopening the tab or browser. It's kept in localStorage but is still
// treated as expired after ~1hr (TOKEN_TTL_MS) — far shorter than the old
// design that persisted a token for 7 days. After it expires we re-auth
// (silently via Google auto-select when possible, else the sign-in dialog).
(function hydrateToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved && saved.jwt && saved.tokenAt) {
      token = saved.jwt;
      tokenAt = saved.tokenAt;
    }
  } catch (_) {}
})();

/** True when we currently hold a fresh, usable token. */
export function hasFreshToken() {
  if (token && Date.now() - tokenAt < TOKEN_TTL_MS) return true;
  // Expired: drop it so a stale token never lingers in sessionStorage.
  if (token) forgetToken();
  return false;
}

/** The current token if fresh, else null (never triggers a prompt). */
export function getToken() {
  return hasFreshToken() ? token : null;
}

/** Store a token that just arrived from Google (persists ~1hr across reopens). */
export function setToken(jwt) {
  token = jwt;
  tokenAt = Date.now();
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ jwt, tokenAt }));
  } catch (_) {
    /* if storage is blocked the token still works in memory this page-view */
  }
}

/** Clear the token from memory + storage (internal helper). */
function forgetToken() {
  token = null;
  tokenAt = 0;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch (_) {}
}

/** Forget the Google token (app stays unlocked). Stops silent re-selection. */
export function signOutGoogle() {
  forgetToken();
  try {
    window.google?.accounts?.id?.disableAutoSelect();
  } catch (_) {}
}

/**
 * First sign-in at the gate: verify the account with the backend (which owns
 * the allowlist), then unlock the app for ACCESS_MAX_AGE_DAYS and keep the
 * fresh token in memory for immediate use. Throws a friendly message on 403 /
 * network failure. Needs internet.
 */
export async function verifyAndUnlock(jwt) {
  const res = await fetch(`${API_URL}/api/auth/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
  });

  if (res.status === 403) {
    throw new Error("This Google account is not authorised to use this application.");
  }
  if (!res.ok) {
    throw new Error("Unable to verify your sign-in. Please try again.");
  }

  const data = await res.json();
  saveAccess(data.email, data.name);
  setToken(jwt);
  return data;
}

/**
 * Wait for a fresh Google token. Resolves immediately if we already hold one;
 * otherwise returns a promise that resolves when the next credential arrives
 * in onCredential(). The UI (ui.js) is responsible for presenting a reliable
 * Google sign-in button that produces that credential — One Tap prompt() is
 * too unreliable to depend on (it often silently refuses to display).
 */
export function awaitCredential() {
  if (hasFreshToken()) return Promise.resolve(token);
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
  });
}

/** Cancel a pending awaitCredential() (e.g. the user closed the sign-in dialog). */
export function cancelPending() {
  if (pending) {
    pending.reject(new Error("Sign-in cancelled"));
    pending = null;
  }
}

/**
 * Called by the global Google callback whenever a credential arrives (gate
 * button, auto-select on load, or a prompt() we triggered). Stores the token
 * and resolves any pending awaitCredential() request.
 */
export function onCredential(jwt) {
  setToken(jwt);
  if (pending) {
    pending.resolve(jwt);
    pending = null;
  }
}
