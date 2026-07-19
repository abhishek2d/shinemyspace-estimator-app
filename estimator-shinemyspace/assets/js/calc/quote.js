/**
 * quote.js — builds the printable / shareable quotation and prints it.
 *
 * Layout is built for the customer to scan, not study:
 *   1. Company header + date
 *   2. "Prepared for" customer block
 *   3. SUMMARY table — one row per room (area + amount) and a grand total.
 *      This is the at-a-glance figure the customer refers to.
 *   4. Detailed breakdown — itemised per room, in lighter text for reference.
 *
 * Output: rendered into a hidden #print-area in the MAIN page, then
 * window.print() is called inside the user's tap (CSS @media print shows only
 * #print-area). This uses the browser's built-in print / Save-as-PDF, which
 * is fully offline — no external service. On iOS, Safari shows a one-time
 * "allow printing" prompt (an Apple behavior we can't remove).
 */

import { COMPANY } from "./config.js";
import * as state from "./state.js";
import { computeEstimate, formatMoney, formatArea, KINDS } from "./calculator.js";

export function printQuote() {
  const model = computeEstimate(state.getState());
  const area = document.getElementById("print-area");
  area.innerHTML = buildContent(model);
  const prevTitle = document.title;
  const name = (model.customer || "").trim();
  document.title = name ? `Quote - ShineMySpace - ${name}` : "Quote - ShineMySpace";
  // Must be synchronous within the click gesture.
  window.print();
  document.title = prevTitle;
}

function buildContent(model) {
  const date = formatLongDate(model.date);
  const preparedFor = model.customer
    ? `<div class="q-to">
         <span class="q-to__label">Prepared for</span>
         <span class="q-to__name">${esc(model.customer)}</span>
       </div>`
    : "";

  return `
    <div class="q">
      <header class="q-head">
        <img src="assets/images/shine-my-space-logo.png" class="q-logo" alt="${esc(COMPANY.name)}">
        <div class="q-co">
          <div class="q-co__name">${esc(COMPANY.name)}</div>
          ${COMPANY.addressLines.map((l) => `<div class="q-co__line">${esc(l)}</div>`).join("")}
          <div class="q-co__line">Mobile: ${esc(COMPANY.phone)}</div>
          <div class="q-co__line">Email: ${esc(COMPANY.email)}</div>
        </div>
      </header>

      <div class="q-titlerow">
        <h1 class="q-title">QUOTATION</h1>
        <div class="q-meta"><span class="q-meta__label">Date</span> ${date}</div>
      </div>

      ${preparedFor}

      ${summaryTable(model)}

      <div class="q-section">Detailed breakdown</div>
      ${model.rooms.map(roomDetail).join("")}

      <div class="q-foot">
        Thank you for choosing ${esc(COMPANY.name)}. This quotation is an estimate based on the measurements provided.
        &nbsp;·&nbsp; ${esc(COMPANY.website)}
      </div>
    </div>`;
}

/* At-a-glance: one row per room plus the grand total. */
function summaryTable(model) {
  const rows = model.rooms
    .map(
      (room) => `
        <tr>
          <td>${esc(room.displayName)}</td>
          <td class="num">${formatArea(room.area)}</td>
          <td class="num">${formatMoney(room.cost)}</td>
        </tr>`
    )
    .join("");

  return `
    <table class="q-table q-summary">
      <thead><tr><th>Room</th><th class="num">Area</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td>Grand Total</td>
          <td class="num">${formatArea(model.totalArea)}</td>
          <td class="num">${formatMoney(model.totalCost)}</td>
        </tr>
      </tfoot>
    </table>`;
}

/* Itemised detail for one room (kept together on a page where possible). */
function roomDetail(room) {
  const rows = room.surfaces
    .map((surface) => {
      const k = KINDS[surface.kind];
      const sign = surface.isSubtract ? "−" : "";
      const u = surface.dimUnit === "in" ? "in" : "ft";
      const measure = surface.isUnit
        ? `Qty ${n(surface.qty)}`
        : surface.isLinear
        ? `Length ${n(surface.dim1)} ${u} &nbsp;·&nbsp; ${surface.length.toFixed(2)} RFT`
        : `${k.dim1} ${n(surface.dim1)} ${u} × ${k.dim2} ${n(surface.dim2)} ${u} &nbsp;·&nbsp; ${surface.area.toFixed(2)} sq.ft.`;
      return `
        <tr class="${surface.isSubtract ? "q-row--sub" : ""}">
          <td>${esc(surface.label)}</td>
          <td>${measure}</td>
          <td class="num">${sign}${formatMoney(surface.cost)}</td>
        </tr>`;
    })
    .join("");

  return `
    <div class="q-roomdetail">
      <div class="q-roomtitle">${esc(room.displayName)} &nbsp;·&nbsp; ${formatMoney(room.cost)}</div>
      <table class="q-table q-detail">
        <thead><tr><th>Item</th><th>Details</th><th class="num">Amount</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function formatLongDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  } catch (_) {
    return "";
  }
}

function n(value) {
  const x = parseFloat(value);
  return Number.isFinite(x) ? x : 0;
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
