/**
 * state.js — the single source of truth for the estimate.
 *
 * Holds the data (customer + rooms + their surfaces), exposes small helpers
 * to change it, and automatically saves to the browser after every change.
 * Nothing here touches the DOM — it is pure data.
 *
 * Data shape (schema v2):
 *   {
 *     schemaVersion: 2,
 *     customer: "Mr. Sharma",          // customer name / estimate title ("" allowed)
 *     rooms: [
 *       {
 *         id: "r1",
 *         name: "Living Room",          // "" means "use Room N"
 *         surfaces: [
 *           // kind: "ceiling" | "wall" | "other" | "subtract"
 *           // label: custom name ("" means use the kind's default, e.g. "Ceiling")
 *           // item_id / itemName: linked Zoho item when one was picked, else null / ""
 *           { id: "s1", kind: "ceiling", label: "", dim1: 10, dim2: 12, costPerSqft: 25, item_id: null, itemName: "" }
 *         ]
 *       }
 *     ]
 *   }
 */

import { STORAGE_KEY, SCHEMA_VERSION } from "./config.js";

/* ----- unique ids (stable, never reused) -------------------------- */
let idCounter = 0;
function nextId(prefix) {
  idCounter += 1;
  return prefix + idCounter;
}

/* ----- the live state --------------------------------------------- */
let state = freshState();

/** A brand-new estimate: one room containing one ceiling. */
export function freshState() {
  const room = makeRoom();
  room.surfaces.push(makeSurface("ceiling"));
  return { schemaVersion: SCHEMA_VERSION, customer: "", date: todayISO(), rooms: [room] };
}

function todayISO() {
  return new Date().toISOString();
}

function makeRoom() {
  return { id: nextId("r"), name: "", surfaces: [] };
}

function makeSurface(kind) {
  // label   = the editable surface name (defaults to the kind, e.g. "Ceiling").
  // mode    = "area" (Length × Width × rate/sqft) or "unit" (Qty × rate/unit).
  // qty     = the quantity used in "unit" mode.
  // item_id + itemName link this surface to a Zoho item when one is picked
  // (null / "" = a plain manual entry). These are additive, optional fields,
  // so estimates saved before they existed still load fine (missing mode reads
  // as "area", missing qty as "").
  return {
    id: nextId("s"),
    kind,
    label: "",
    mode: "area",
    dim1: "",
    dim2: "",
    qty: "",
    costPerSqft: "",
    item_id: null,
    itemName: "",
  };
}

/* ----- read access ------------------------------------------------ */
export function getState() {
  return state;
}

/** A deep, independent copy of the current estimate (for saving/exporting). */
export function snapshot() {
  return JSON.parse(JSON.stringify(state));
}

/* ----- persistence ------------------------------------------------ */
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("Could not save estimate:", err);
  }
}

/** Load the auto-saved estimate from the browser. Returns true if restored. */
export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    return applyData(JSON.parse(raw));
  } catch (err) {
    console.warn("Could not load saved estimate:", err);
    return false;
  }
}

/**
 * Replace the whole estimate with the given data (from a saved customer or an
 * imported file), validating its shape first. Returns true on success.
 */
export function setState(data) {
  const ok = applyData(data);
  if (ok) save();
  return ok;
}

/** Validate + adopt a data object as the live state. */
function applyData(data) {
  if (!data || data.schemaVersion !== SCHEMA_VERSION || !Array.isArray(data.rooms)) {
    return false;
  }
  if (typeof data.customer !== "string") data.customer = "";
  if (typeof data.date !== "string") data.date = todayISO();
  state = data;
  syncIdCounter(state);
  return true;
}

function syncIdCounter(s) {
  let max = 0;
  const consider = (id) => {
    const n = parseInt(String(id).replace(/^\D+/, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  };
  s.rooms.forEach((room) => {
    consider(room.id);
    room.surfaces.forEach((surface) => consider(surface.id));
  });
  idCounter = max;
}

/** Wipe everything and start a fresh estimate. */
export function reset() {
  state = freshState();
  save();
}

/* ----- mutations (every one saves) -------------------------------- */

export function setCustomer(name) {
  state.customer = name;
  save();
}

export function addRoom() {
  const room = makeRoom();
  room.surfaces.push(makeSurface("ceiling"));
  state.rooms.push(room);
  save();
  return room;
}

export function removeRoom(roomId) {
  state.rooms = state.rooms.filter((room) => room.id !== roomId);
  save();
}

export function renameRoom(roomId, name) {
  const room = findRoom(roomId);
  if (room) {
    room.name = name;
    save();
  }
}

export function addSurface(roomId, kind) {
  const room = findRoom(roomId);
  if (!room) return null;
  const surface = makeSurface(kind);
  room.surfaces.push(surface);
  save();
  return surface;
}

export function removeSurface(roomId, surfaceId) {
  const room = findRoom(roomId);
  if (!room) return;
  room.surfaces = room.surfaces.filter((surface) => surface.id !== surfaceId);
  save();
}

/** Update a field of a surface: "label", "dim1", "dim2" or "costPerSqft". */
export function updateSurface(roomId, surfaceId, field, value) {
  const room = findRoom(roomId);
  if (!room) return;
  const surface = room.surfaces.find((s) => s.id === surfaceId);
  if (!surface) return;
  surface[field] = value;
  save();
}

/* ----- internal helpers ------------------------------------------- */
function findRoom(roomId) {
  return state.rooms.find((room) => room.id === roomId) || null;
}
