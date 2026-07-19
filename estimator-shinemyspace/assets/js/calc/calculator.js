/**
 * calculator.js — pure cost maths. No DOM, no storage.
 *
 * Give it the state and it returns a tidy computed model that the UI and
 * the printed quote both render from.
 *
 * Rules:
 *   - area mode: area = dim1 * dim2,  cost = area * rate
 *   - unit mode: no area (0 sqft),    cost = qty  * rate
 *   - "subtract" surfaces remove their area and cost from the room total.
 */

import { CURRENCY } from "./config.js";

/**
 * The kinds of surface. Each defines its default name, the labels for its two
 * dimensions, and whether it subtracts from (instead of adds to) the total.
 */
export const KINDS = {
  ceiling: { title: "Ceiling", dim1: "Length", dim2: "Width", subtract: false },
  wall: { title: "Wall", dim1: "Height", dim2: "Width", subtract: false },
  subtract: { title: "Deduct", dim1: "Height", dim2: "Width", subtract: true },
};

/** The name to show for a surface: its custom label, or the kind's default. */
export function surfaceLabel(surface) {
  const custom = (surface.label || "").trim();
  return custom || KINDS[surface.kind].title;
}

/** Parse a possibly-empty input string into a number (0 if blank/invalid). */
function num(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/* ----- units & pricing integrity ---------------------------------- *
 * A surface's dimensions can be typed in feet or inches, but area (and so the
 * priced quantity for per-sqft items) is ALWAYS computed in feet/sqft. Keep a
 * single conversion table so adding another input unit later (cm, m, …) is one
 * line and every calculation stays consistent. */
const LENGTH_TO_FEET = { ft: 1, in: 1 / 12 };

/** Convert a length input to feet. Unknown units fall back to feet (1:1). */
export function toFeet(value, unit) {
  const factor = LENGTH_TO_FEET[unit] ?? LENGTH_TO_FEET.ft;
  return num(value) * factor;
}

/** The dimension input unit for a surface: "in" only when explicitly set. */
export function dimUnitOf(surface) {
  return surface.dimUnit === "in" ? "in" : "ft";
}

/**
 * How a Zoho item's selling unit must be billed, so the quantity we send always
 * matches what was measured:
 *   "area"   — per square unit (sqft): quantity = area in sqft.
 *   "count"  — per piece (pcs, nos, set, box, …): quantity = qty.
 *   "linear" — per running length (ft, inch, metre, rft, …): needs a single
 *              length, which this app can't yet measure → publishing is blocked
 *              rather than billing a wrong number.
 * A blank/legacy unit is treated as "count" (the historic non-sqft default).
 */
const LINEAR_UNITS = new Set([
  "ft", "feet", "foot", "rft", "rmt", "rm", "runningft", "runningfeet",
  "in", "inch", "inches", "m", "mtr", "meter", "metre", "cm", "mm", "yd", "yard", "yards",
]);
export function pricingBasis(unit) {
  const u = String(unit || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!u) return "count";
  if (u.startsWith("sq") || u.startsWith("square") || u === "sft" || u === "sqft") return "area";
  if (LINEAR_UNITS.has(u)) return "linear";
  return "count";
}

/**
 * Compute everything from the current state.
 * Returns:
 *   {
 *     customer,
 *     rooms: [{ id, displayName, surfaces: [{...surface, label, area, cost, isSubtract}], area, cost }],
 *     totalArea,
 *     totalCost
 *   }
 */
export function computeEstimate(state) {
  let totalArea = 0;
  let totalCost = 0;
  let totalQty = 0;

  const rooms = state.rooms.map((room, index) => {
    let roomArea = 0;
    let roomCost = 0;
    let roomQty = 0;

    const surfaces = room.surfaces.map((surface) => {
      const isSubtract = KINDS[surface.kind].subtract;
      const isUnit = surface.mode === "unit";
      const dimUnit = dimUnitOf(surface);
      const rate = num(surface.costPerSqft);
      // Per-unit surfaces have no square footage — they add cost but not area.
      // Area mode converts each dimension to feet first, so inches price the
      // same sqft the customer measured.
      const qty = isUnit ? num(surface.qty) : 0;
      const area = isUnit ? 0 : toFeet(surface.dim1, dimUnit) * toFeet(surface.dim2, dimUnit);
      const cost = isUnit ? qty * rate : area * rate;

      // pricedQty is the exact magnitude billed to Zoho for this surface, from
      // the same numbers shown on screen — the single source of truth so the
      // quote, the totals and the published quantity can never disagree.
      const pricedQty = isUnit ? qty : area;

      // Integrity: when an item's selling unit is known, it must match how this
      // surface is measured. pricingOk=false means we can't bill it safely and
      // publishing must refuse it (see publishToZoho). If the unit is unknown
      // (older saved estimates predate itemUnit), we trust the stored mode and
      // don't block — the unit is only re-validated when we actually have it.
      const knownUnit = surface.item_id && String(surface.itemUnit || "").trim() !== "";
      const basis = knownUnit ? pricingBasis(surface.itemUnit) : null;
      let pricingOk = true;
      if (basis === "area" && isUnit) pricingOk = false; // per-sqft item on a Qty surface
      else if (basis === "count" && !isUnit) pricingOk = false; // per-piece item on an Area surface
      else if (basis === "linear") pricingOk = false; // per-length pricing not supported yet

      roomArea += isSubtract ? -area : area;
      roomCost += isSubtract ? -cost : cost;
      roomQty += isSubtract ? -qty : qty;

      return {
        ...surface,
        label: surfaceLabel(surface),
        area, cost, qty, dimUnit, pricedQty, pricingBasis: basis, pricingOk,
        isUnit, isSubtract,
      };
    });

    totalArea += roomArea;
    totalCost += roomCost;
    totalQty += roomQty;

    // Per-surface-type subtotals for the room footer (Ceiling / Walls / Deducts).
    // Signed so subtract kinds are negative and the parts sum to the room total.
    const byKind = {};
    surfaces.forEach((s) => {
      const k = byKind[s.kind] || (byKind[s.kind] = { area: 0, qty: 0, cost: 0 });
      const sign = s.isSubtract ? -1 : 1;
      k.area += sign * s.area;
      k.qty += sign * s.qty;
      k.cost += sign * s.cost;
    });

    // Deduct validation: within a room, the total deducted for an item must not
    // exceed that item's positive area/qty (a deduct can't be bigger than its
    // parent). Flag any deduct whose item is over-deducted so the UI can warn
    // and publishing can be blocked.
    const itemPos = {}; // item_id -> positive magnitude on ceilings/walls
    const itemDed = {}; // item_id -> deducted magnitude
    surfaces.forEach((s) => {
      if (!s.item_id) return;
      if (s.isSubtract) itemDed[s.item_id] = (itemDed[s.item_id] || 0) + s.pricedQty;
      else itemPos[s.item_id] = (itemPos[s.item_id] || 0) + s.pricedQty;
    });
    surfaces.forEach((s) => {
      s.overDeduct =
        s.isSubtract && !!s.item_id &&
        (itemDed[s.item_id] || 0) > (itemPos[s.item_id] || 0) + 1e-9;
    });

    return {
      id: room.id,
      displayName: room.name && room.name.trim() ? room.name.trim() : `Room ${index + 1}`,
      surfaces,
      byKind,
      area: roomArea,
      cost: roomCost,
      qty: roomQty,
    };
  });

  return { customer: state.customer || "", date: state.date || "", rooms, totalArea, totalCost, totalQty };
}

/** Format a number as Indian Rupees, e.g. 12500 -> "₹12,500". */
export function formatMoney(value) {
  return "₹" + Math.round(value).toLocaleString(CURRENCY);
}

/** Format an area value, e.g. 120 -> "120 sq. ft." */
export function formatArea(value) {
  return value.toLocaleString(CURRENCY) + " sq. ft.";
}
