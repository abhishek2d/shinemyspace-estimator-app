/**
 * library.js — saving and reusing customer estimates.
 *
 * Two ways to keep an estimate for later, both handled here:
 *   1. "Save on this phone"  — named estimates kept in the browser, listed so
 *                              you can reload and edit them later.
 *   2. "Export / Import file" — download an estimate as a .json file you can
 *                               back up or move to another device, and read
 *                               it back in.
 *
 * No DOM rendering here — it returns data and lets ui.js show it.
 */

import { LIBRARY_KEY, SCHEMA_VERSION } from "./config.js";
import * as state from "./state.js";

/* ----- saved-on-this-phone library -------------------------------- */
// Stored as: { "Customer name": { savedAt: "2026-06-27T...", data: {...} }, ... }

function readLibrary() {
  try {
    return JSON.parse(localStorage.getItem(LIBRARY_KEY)) || {};
  } catch (_) {
    return {};
  }
}

function writeLibrary(lib) {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib));
}

/** List saved estimates, newest first: [{ name, savedAt }]. */
export function listSaved() {
  const lib = readLibrary();
  return Object.keys(lib)
    .map((name) => ({ name, savedAt: lib[name].savedAt }))
    .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

/** Save the current estimate under a name (overwrites if the name exists). */
export function saveCurrent(name, nowIso) {
  const lib = readLibrary();
  lib[name] = { savedAt: nowIso, data: state.snapshot() };
  writeLibrary(lib);
}

/** Save an arbitrary estimate object (e.g. an imported one) under a name. */
export function saveData(name, data, nowIso) {
  const lib = readLibrary();
  lib[name] = { savedAt: nowIso, data: JSON.parse(JSON.stringify(data)) };
  writeLibrary(lib);
}

/** Load a saved estimate into the live state. Returns true on success. */
export function loadSaved(name) {
  const lib = readLibrary();
  const entry = lib[name];
  if (!entry) return false;
  return state.setState(entry.data);
}

/** Delete a saved estimate. */
export function deleteSaved(name) {
  const lib = readLibrary();
  delete lib[name];
  writeLibrary(lib);
}

/* ----- export / import a file ------------------------------------- */

/** Download the current estimate as a .json file. */
export function exportCurrent(suggestedName) {
  const data = state.snapshot();
  const safe = (suggestedName || "estimate").replace(/[^\w\-]+/g, "_");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safe}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Read and validate an estimate from a chosen file. Resolves with the parsed
 * estimate object (it does NOT change the current work); rejects with a
 * message the UI can show. The caller decides what to do with the data.
 */
export function importFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data || data.schemaVersion !== SCHEMA_VERSION || !Array.isArray(data.rooms)) {
          reject(new Error("This file is not a valid estimate."));
        } else {
          resolve(data);
        }
      } catch (_) {
        reject(new Error("Could not read the file."));
      }
    };
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsText(file);
  });
}
