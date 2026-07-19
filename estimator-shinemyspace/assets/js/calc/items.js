/**
 * items.js — the Zoho Books item catalogue used by the surface pickers.
 *
 * Sources, in order of freshness:
 *   1. Locally cached live catalogue (localStorage) — last successful backend
 *      fetch. Available offline, no Google session needed.
 *   2. Bundled snapshot (assets/data/items.json) — shipped fallback for a first
 *      run before any live fetch has happened.
 *
 * refreshLive(token) pulls the current catalogue from the backend when we have
 * a fresh Google token + internet, and updates both the in-memory list and the
 * cache. Only { item_id, name, rate, unit } is kept — the fields the UI needs.
 */

import { API_URL, ITEMS_CACHE_KEY } from "./config.js";

let items = [];

function normalize(raw) {
  return raw
    .map((it) => ({
      item_id: it.item_id,
      name: it.name || it.item_name || "",
      rate: Number(it.rate) || 0,
      unit: it.unit || "",
    }))
    .filter((it) => it.name);
}

function readCache() {
  try {
    const raw = localStorage.getItem(ITEMS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.items) ? parsed.items : null;
  } catch (_) {
    return null;
  }
}

function writeCache(list) {
  try {
    localStorage.setItem(
      ITEMS_CACHE_KEY,
      JSON.stringify({ items: list, fetchedAt: Date.now() })
    );
  } catch (_) {
    /* cache is best-effort; the in-memory list still works this session */
  }
}

/**
 * Populate the catalogue for immediate (offline) use: cached live snapshot if
 * present, else the bundled fallback. Safe to call once at startup.
 */
export async function loadItems() {
  const cached = readCache();
  if (cached && cached.length) {
    items = cached;
    return;
  }
  try {
    const res = await fetch("assets/data/items.json");
    if (!res.ok) return;
    items = normalize(await res.json());
  } catch (_) {
    /* If nothing loads, the search modal just shows no items. */
  }
}

/**
 * Refresh from the backend using a fresh Google token. Returns the item count
 * on success, or false when offline / without a token / on error. Pass
 * { force: true } to bypass the backend's 1-hour cache (?fresh=1) so a
 * just-added Zoho item appears immediately.
 */
export async function refreshLive(token, { force = false } = {}) {
  if (!token || !navigator.onLine) return false;
  try {
    const url = `${API_URL}/api/items${force ? "?fresh=1" : ""}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const data = await res.json();
    const list = normalize(data.items || []);
    if (list.length) {
      items = list;
      writeCache(list);
      return list.length;
    }
  } catch (_) {
    /* keep whatever we already had */
  }
  return false;
}

/**
 * Fetch the FULL catalogue (including inactive and purchase-only items, with
 * their status fields) for the "View items" reference screen. Returns the raw
 * item objects, or null on failure. Does not touch the picker's cache.
 */
export async function fetchAll(token, { force = false } = {}) {
  if (!token || !navigator.onLine) return null;
  try {
    const qs = new URLSearchParams({ all: "1" });
    if (force) qs.set("fresh", "1");
    const res = await fetch(`${API_URL}/api/items?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : null;
  } catch (_) {
    return null;
  }
}

/** Items whose name contains the query (case-insensitive), capped for speed. */
export function search(query, limit = 50) {
  const q = String(query || "").trim().toLowerCase();
  const list = q ? items.filter((it) => it.name.toLowerCase().includes(q)) : items;
  return list.slice(0, limit);
}

/** The item with the given id, or null. */
export function findById(id) {
  return items.find((it) => it.item_id === id) || null;
}
