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
      const rate = num(surface.costPerSqft);
      // Per-unit surfaces have no square footage — they add cost but not area.
      const qty = isUnit ? num(surface.qty) : 0;
      const area = isUnit ? 0 : num(surface.dim1) * num(surface.dim2);
      const cost = isUnit ? qty * rate : area * rate;

      roomArea += isSubtract ? -area : area;
      roomCost += isSubtract ? -cost : cost;
      roomQty += isSubtract ? -qty : qty;

      return { ...surface, label: surfaceLabel(surface), area, cost, qty, isUnit, isSubtract };
    });

    totalArea += roomArea;
    totalCost += roomCost;
    totalQty += roomQty;

    return {
      id: room.id,
      displayName: room.name && room.name.trim() ? room.name.trim() : `Room ${index + 1}`,
      surfaces,
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
