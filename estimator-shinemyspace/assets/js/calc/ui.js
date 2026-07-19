/**
 * ui.js — turns the state into on-screen elements and handles interaction.
 *
 * Layout: two tabs — "Edit" (the input form) and "Summary" (the cost
 * breakdown). Tapping a tab switches views, which is how you go back to edit
 * after viewing the result (important on mobile). A sticky total bar stays
 * visible in both views.
 *
 * Rendering:
 *   - renderForm()    rebuilds rooms/surfaces. Called when the structure
 *                     changes (add/remove, load, reset) — not while typing.
 *   - renderResults() rebuilds the breakdown + totals. Called on every change,
 *                     including typing, so it never disturbs the inputs.
 *   - renderSaved()   rebuilds the "saved on this phone" list.
 *
 * All input is handled with event delegation — no inline handlers, no globals.
 */

import * as state from "./state.js";
import * as library from "./library.js";
import * as items from "./items.js";
import { computeEstimate, formatMoney, formatArea, formatLength, toFeet, pricingBasis, KINDS } from "./calculator.js";
import { API_URL } from "./config.js";
import { hasFreshToken, getToken, getUser, awaitCredential, cancelPending, signOutGoogle, clearAccess } from "./auth.js";

const $ = (id) => document.getElementById(id);
let el = {}; // cached elements

// Pending custom-dialog state (see showDialog / resolveDialog).
let dialogResolve = null;
let dialogButtons = [];

/* Inline SVG icon — identical on every device (no emoji / icon font). */
const ICON = {
  trash:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
  search:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  signout:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  signin:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>',
  lock:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  // Publish → upload-to-cloud; Save-as-PDF → download. Both inherit the button
  // text colour via currentColor (see index.html buttons).
  publish:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/></svg>',
  pdf:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  save:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
};

export function init() {
  el = {
    tabs: $("tabs"),
    viewEdit: $("view-edit"),
    viewSummary: $("view-summary"),
    customer: $("customer"),
    rooms: $("rooms"),
    result: $("result"),
    totalBar: $("total-bar"),
    savedList: $("saved-list"),
    addRoom: $("add-room"),
    newEstimate: $("new-estimate"),
    save: $("save"),
    exportBtn: $("export"),
    importBtn: $("import"),
    importFile: $("import-file"),
    toast: $("toast"),
    itemModal: $("item-modal"),
    itemSearch: $("item-search"),
    itemResults: $("item-results"),
    signinModal: $("signin-modal"),
    signinBtn: $("signin-btn"),
    itemsListModal: $("items-list-modal"),
    itemsListSearch: $("items-list-search"),
    itemsListResults: $("items-list-results"),
    itemsListFilters: $("items-list-filters"),
    publishBtn: $("publish-zoho"),
    publishHint: $("publish-hint"),
    menuBtn: $("menu-btn"),
    menuPanel: $("menu-panel"),
    authItem: document.querySelector('#menu-panel [data-action="auth"]'),
    authDotLg: $("auth-dot-lg"),
    menuUserName: $("menu-user-name"),
    menuUserEmail: $("menu-user-email"),
    serverStatus: $("server-status"),
    serverLabel: document.querySelector("#server-status .server-label"),
    dialogModal: $("dialog-modal"),
    dialogTitle: $("dialog-title"),
    dialogMessage: $("dialog-message"),
    dialogInput: $("dialog-input"),
    dialogActions: $("dialog-actions"),
    busy: $("busy"),
    busyText: $("busy-text"),
    printBtn: $("print"),
  };
  // Themed inline-SVG icons on the Save / Publish / Save-as-PDF buttons (single
  // source of truth = ICON). currentColor makes them match each button's colour.
  el.save.innerHTML = `${ICON.save} Save on this device`;
  el.publishBtn.innerHTML = `${ICON.publish} Publish to Zoho`;
  el.printBtn.innerHTML = `${ICON.pdf} Save as PDF`;
  wireEvents();
  setView("edit");
  renderAll();
  updateAuthUI();

  // Re-evaluate Publish periodically so it greys out on its own when the Google
  // token expires (~50 min). This is a purely local check — no network.
  setInterval(updateAuthUI, 60_000);

  // Check backend status now (pre-warms it) and every 3 min while the app is open
  // — enough to keep the indicator fresh and the server warm during active use.
  checkServer();
  setInterval(checkServer, 180_000);
  window.addEventListener("online", checkServer);
  window.addEventListener("offline", () => setServerStatus("offline"));

  // Load the Zoho item catalogue for the surface search modal. Async — the
  // form is usable immediately; the modal shows items once it's ready.
  items.loadItems();
}

export function renderAll() {
  el.customer.value = state.getState().customer || "";
  renderForm();
  renderResults();
  renderSaved();
}

/* ------------------------------------------------------------------ *
 *  Tabs / views
 * ------------------------------------------------------------------ */
function setView(view) {
  el.viewEdit.hidden = view !== "edit";
  el.viewSummary.hidden = view !== "summary";
  el.tabs.querySelectorAll("[data-view]").forEach((b) =>
    b.classList.toggle("tab--active", b.dataset.view === view)
  );
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------------ *
 *  Form (rooms + surfaces)
 * ------------------------------------------------------------------ */
function renderForm() {
  const { rooms } = state.getState();
  el.rooms.innerHTML = rooms.map((room, index) => roomCard(room, index)).join("");
}

function roomCard(room, index) {
  const surfaces = room.surfaces.map(surfaceRow).join("");
  return `
    <section class="room" data-room-id="${room.id}">
      <header class="room__head">
        <label class="room__title" title="Tap to rename room">
          <input class="room__name" type="text" data-action="rename" size="${sizeFor(room.name, `Room ${index + 1}`)}"
                 value="${attr(room.name)}" placeholder="Room ${index + 1}" aria-label="Room name">
        </label>
        <button class="icon-btn icon-btn--delete" data-action="remove-room" type="button" title="Delete this room" aria-label="Delete this room">${ICON.trash}<span class="icon-btn__text">Room</span></button>
      </header>

      <div class="surfaces">${surfaces}</div>

      <div class="room__actions">
        <button class="chip" data-action="add-ceiling" type="button">+ Ceiling</button>
        <button class="chip" data-action="add-wall" type="button">+ Wall</button>
        <button class="chip chip--minus" data-action="add-subtract" type="button">− Deduct</button>
      </div>
    </section>`;
}

function surfaceRow(surface) {
  const k = KINDS[surface.kind];
  const isSub = surface.kind === "subtract";
  // Mode is derived from the picked item's unit — there's no manual toggle.
  //   unit   → Qty; linear → a single Length (RFT); otherwise Area (L×W).
  // A surface with no item yet stays in Area (dimension) mode.
  const isUnit = surface.mode === "unit";
  const isLinear = surface.mode === "linear";
  const unit = surface.dimUnit === "in" ? "in" : "ft";
  const itemName = (surface.itemName || "").trim();

  // Area: Length × Width (ft/in) × rate/sqft. Qty: Qty × rate. Linear: a single
  // Length (ft/in) × rate/RFT.
  const fields = isUnit
    ? `${field("Quantity", "qty", surface.qty)}
       ${field("Cost/unit", "costPerSqft", surface.costPerSqft)}`
    : isLinear
    ? `${dimField("Length", "dim1", surface.dim1, unit)}
       ${field("Cost/RFT", "costPerSqft", surface.costPerSqft)}`
    : `${dimField(k.dim1, "dim1", surface.dim1, unit)}
       ${dimField(k.dim2, "dim2", surface.dim2, unit)}
       ${field("Cost/sqft", "costPerSqft", surface.costPerSqft)}`;

  // Area and Linear modes measure a length, so offer the ft/in switch. Qty mode
  // has no dimension, so no switch is shown.
  const unitToggle = isUnit
    ? ""
    : `<div class="mode-toggle" role="group" aria-label="Measurement unit" title="Units your measurements are in">
        <button class="mode-toggle__opt ${unit === "ft" ? "is-active" : ""}" data-action="dimunit" data-unit="ft" type="button">ft</button>
        <button class="mode-toggle__opt ${unit === "in" ? "is-active" : ""}" data-action="dimunit" data-unit="in" type="button">in</button>
      </div>`;

  const itemRow = itemName
    ? `<div class="surface__item">
        <span class="surface__item-text">${esc(itemName)}</span>
        <button class="surface__item-btn" data-action="pick-item" type="button" title="Change item" aria-label="Change item">${ICON.search}</button>
        <button class="surface__item-btn surface__item-btn--clear" data-action="clear-item" type="button" title="Remove item" aria-label="Remove item">✕</button>
      </div>`
    : `<div class="surface__item">
        <button class="surface__pick" data-action="pick-item" type="button">${ICON.search}<span>Search item</span></button>
      </div>`;
  return `
    <div class="surface ${isSub ? "surface--subtract" : ""}" data-surface-id="${surface.id}">
      <div class="surface__top">
        <label class="surface__title" title="Tap to rename">
          <input class="surface__name" type="text" data-field="label" size="${sizeFor(surface.label, k.title)}"
                 value="${attr(surface.label)}" placeholder="${attr(k.title)}" aria-label="Surface name">
        </label>
        ${unitToggle}
        <button class="icon-btn icon-btn--delete" data-action="remove-surface" type="button" title="Delete this item" aria-label="Delete this item">${ICON.trash}</button>
      </div>
      <div class="surface__fields">
        ${fields}
      </div>
      ${itemRow}
    </div>`;
}

function field(label, name, value) {
  return `
    <label class="field">
      <input class="field__input" type="number" inputmode="decimal" min="0" step="any"
             data-field="${name}" value="${attr(value)}" placeholder="${attr(label)}" aria-label="${attr(label)}">
    </label>`;
}

/**
 * A dimension input that knows its unit. When measuring in inches it shows a
 * live "= N ft" equivalent above the field (updated on input by the rooms
 * handler, keyed by data-conv), so it's clear what feeds the sqft calculation.
 */
function dimField(label, name, value, unit) {
  const inInches = unit === "in";
  return `
    <label class="field field--dim">
      <span class="field__conv" data-conv="${name}"${inInches ? "" : " hidden"}>${inInches ? convHint(value) : ""}</span>
      <input class="field__input" type="number" inputmode="decimal" min="0" step="any"
             data-field="${name}" value="${attr(value)}" placeholder="${attr(label)} (${unit})"
             aria-label="${attr(label)} in ${inInches ? "inches" : "feet"}">
    </label>`;
}

/** The "= N ft" helper text shown under an inch-mode dimension input. */
function convHint(inchValue) {
  const ft = toFeet(inchValue, "in");
  return `= ${ft.toLocaleString("en-IN", { maximumFractionDigits: 3 })} ft`;
}

/* ------------------------------------------------------------------ *
 *  Results (breakdown + totals)
 * ------------------------------------------------------------------ */
function renderResults() {
  const model = computeEstimate(state.getState());
  const date = formatDate(model.date);

  // Header tiles: Area, plus Length (RFT) and/or Quantity when the estimate has
  // any linear- or unit-mode items. Area shows by default when nothing else does.
  const hasQty = model.totalQty > 0;
  const hasLength = model.totalLength > 0;
  const hasArea = model.totalArea > 0 || (!hasQty && !hasLength);
  const metrics = [];
  if (hasArea) metrics.push({ label: "Area", value: formatArea(model.totalArea) });
  if (hasLength) metrics.push({ label: "Length", value: formatLength(model.totalLength) });
  if (hasQty) metrics.push({ label: "Quantity", value: `${model.totalQty.toLocaleString("en-IN")} qty` });
  const metricsHtml = metrics
    .map(
      (m) =>
        `<div class="metric"><span class="metric__label">${m.label}</span><span class="metric__val">${m.value}</span></div>`
    )
    .join("");

  const summary = `
    <div class="quote-summary">
      <div class="quote-summary__row">
        <div class="quote-summary__who">
          <span class="quote-summary__label">Estimate</span>
          <span class="quote-summary__name">${model.customer ? esc(model.customer) : "Untitled"}</span>
        </div>
        <span class="quote-summary__date">${date}</span>
      </div>
      <div class="quote-summary__stats">
        <div class="stat stat--measures">${metricsHtml}</div>
        <div class="stat stat--cost">
          <span class="stat__label">Total cost</span>
          <span class="stat__value">${formatMoney(model.totalCost)}</span>
        </div>
      </div>
    </div>`;

  const rooms = model.rooms
    .map((room) => {
      const rows = room.surfaces.map(resultRow).join("");
      return `
        <div class="quote-room">
          <div class="quote-room__head">
            <span class="quote-room__name">${esc(room.displayName)}</span>
          </div>
          <table class="quote-table">
            <tbody>${rows}</tbody>
            <tfoot>
              ${kindSubtotalRows(room)}
              <tr class="quote-total-row">
                <td>Total <span class="quote-foot__area">· ${measures(room.area, room.qty, room.length)}</span></td>
                <td class="num">${formatMoney(room.cost)}</td>
              </tr>
            </tfoot>
          </table>
        </div>`;
    })
    .join("");

  el.result.innerHTML = summary + rooms;

  el.totalBar.innerHTML = `
    <span class="totalbar__area">${measures(model.totalArea, model.totalQty, model.totalLength)}</span>
    <span class="totalbar__cost">${formatMoney(model.totalCost)}</span>`;
}

function resultRow(surface) {
  const k = KINDS[surface.kind];
  const sign = surface.isSubtract ? "−" : "";
  const itemName = (surface.itemName || "").trim();
  const rate = n(surface.costPerSqft).toLocaleString("en-IN");
  const u = surface.dimUnit === "in" ? "in" : "ft";
  const detail = surface.isUnit
    ? `<div class="quote-item__dims">Qty ${n(surface.qty)}</div>
        <div class="quote-item__calc">@ ₹${rate}/unit</div>`
    : surface.isLinear
    ? `<div class="quote-item__dims">Length ${n(surface.dim1)} ${u}</div>
        <div class="quote-item__calc">${formatLength(surface.length)} · @ ₹${rate}/RFT</div>`
    : `<div class="quote-item__dims">${k.dim1} ${n(surface.dim1)} × ${k.dim2} ${n(surface.dim2)} ${u}</div>
        <div class="quote-item__calc">${formatArea(surface.area)} · @ ₹${rate}/sqft</div>`;
  const warn = surface.overDeduct
    ? `<div class="quote-item__warn">Deduction is larger than this item's area in the room</div>`
    : "";
  return `
    <tr class="${surface.isSubtract ? "quote-row--sub" : ""} ${surface.overDeduct ? "quote-row--over" : ""}">
      <td>
        <div class="quote-item__name">${esc(surface.label)}</div>
        ${itemName ? `<div class="quote-item__item">${esc(itemName)}</div>` : ""}
        ${detail}
        ${warn}
      </td>
      <td class="num">${sign}${formatMoney(surface.cost)}</td>
    </tr>`;
}

/* ------------------------------------------------------------------ *
 *  Saved-on-this-phone list
 * ------------------------------------------------------------------ */
function renderSaved() {
  const items = library.listSaved();
  if (!items.length) {
    el.savedList.innerHTML = `<p class="muted">No saved estimates yet. Enter an estimate name above and tap Save.</p>`;
    return;
  }
  el.savedList.innerHTML = items
    .map(
      (it) => `
      <div class="saved-row">
        <div class="saved-row__info">
          <span class="saved-row__name">${esc(it.name)}</span>
          <span class="saved-row__date">${formatDate(it.savedAt)}</span>
        </div>
        <div class="saved-row__actions">
          <button class="btn btn--ghost btn--sm" data-action="load-saved" data-name="${attr(it.name)}" type="button">Open</button>
          <button class="icon-btn" data-action="delete-saved" data-name="${attr(it.name)}" type="button" title="Delete" aria-label="Delete">${ICON.trash}</button>
        </div>
      </div>`
    )
    .join("");
}

/* ------------------------------------------------------------------ *
 *  Events (delegation)
 * ------------------------------------------------------------------ */
function wireEvents() {
  // Any toast can be tapped (message or ✕) to dismiss it.
  el.toast.addEventListener("click", hideToast);

  // Tabs
  el.tabs.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (btn) setView(btn.dataset.view);
  });

  // Customer name
  el.customer.addEventListener("input", () => {
    state.setCustomer(el.customer.value);
    renderResults();
  });

  // Typing inside rooms (number fields, item label, room name)
  el.rooms.addEventListener("input", (e) => {
    const fieldInput = e.target.closest("[data-field]");
    if (fieldInput) {
      const { roomId, surfaceId } = ids(fieldInput);
      const fieldName = fieldInput.dataset.field;
      state.updateSurface(roomId, surfaceId, fieldName, fieldInput.value);
      if (fieldName === "label") autosize(fieldInput);
      // Live "= N ft" under an inch-mode dimension, without a full re-render.
      if (fieldName === "dim1" || fieldName === "dim2") {
        const conv = fieldInput.closest(".field")?.querySelector(`[data-conv="${fieldName}"]`);
        if (conv && !conv.hidden) conv.textContent = convHint(fieldInput.value);
      }
      renderResults();
      return;
    }
    const nameInput = e.target.closest('[data-action="rename"]');
    if (nameInput) {
      state.renameRoom(ids(nameInput).roomId, nameInput.value);
      autosize(nameInput);
      renderResults();
    }
  });

  // Buttons inside rooms (add/remove)
  el.rooms.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const { roomId, surfaceId } = ids(btn);
    if (btn.dataset.action === "pick-item") {
      openItemModal(roomId, surfaceId);
      return;
    }
    if (btn.dataset.action === "dimunit") {
      state.updateSurface(roomId, surfaceId, "dimUnit", btn.dataset.unit);
      renderForm();
      renderResults();
      return;
    }
    const actions = {
      "add-ceiling": () => state.addSurface(roomId, "ceiling"),
      "add-wall": () => state.addSurface(roomId, "wall"),
      "add-subtract": () => state.addSurface(roomId, "subtract"),
      "remove-surface": () => state.removeSurface(roomId, surfaceId),
      "clear-item": () => {
        state.updateSurface(roomId, surfaceId, "item_id", null);
        state.updateSurface(roomId, surfaceId, "itemName", "");
      },
      "remove-room": async () => {
        if (!(await confirmDialog("Delete this room? This cannot be undone.", { title: "Delete room", confirmLabel: "Delete", danger: true }))) return;
        state.removeRoom(roomId);
      },
    };
    if (actions[btn.dataset.action]) {
      await actions[btn.dataset.action]();
      renderForm();
      renderResults();
    }
  });

  // Top-level edit actions
  el.addRoom.addEventListener("click", () => {
    state.addRoom();
    renderForm();
    renderResults();
  });

  el.newEstimate.addEventListener("click", async () => {
    if (await confirmDialog("Start a new, empty estimate? The current one will be cleared (saved estimates are kept).", { title: "New estimate", confirmLabel: "Start new" })) {
      state.reset();
      renderAll();
      setView("edit");
      toast("Started a new estimate");
    }
  });

  // Save on this device (Edit tab).
  el.save.addEventListener("click", saveEstimate);

  // Publish to Zoho Books — saves a local copy first, then publishes.
  el.publishBtn.addEventListener("click", publishToZoho);

  // Publishing needs a connection, so refresh its state on network changes.
  window.addEventListener("online", updateAuthUI);
  window.addEventListener("offline", updateAuthUI);

  // Topbar menu (hamburger): open/close and route its items.
  el.menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu();
  });
  el.menuPanel.addEventListener("click", (e) => {
    const item = e.target.closest("[data-action]");
    if (!item) return;
    closeMenu();
    if (item.dataset.action === "auth") handleAuthToggle();
    else if (item.dataset.action === "view-items") viewItems();
    else if (item.dataset.action === "sync-items") syncItems();
    else if (item.dataset.action === "lock") lockApp();
  });
  document.addEventListener("click", (e) => {
    if (!el.menuPanel.hidden && !e.target.closest(".menu")) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.menuPanel.hidden) closeMenu();
  });

  // Export to a file
  el.exportBtn.addEventListener("click", () => {
    library.exportCurrent(el.customer.value.trim() || "estimate");
    toast("Estimate exported");
  });

  // Import from a file — adds it to Saved estimates (does NOT replace the
  // estimate you're currently working on).
  el.importBtn.addEventListener("click", () => el.importFile.click());
  el.importFile.addEventListener("change", () => {
    const file = el.importFile.files[0];
    if (!file) return;
    library
      .importFile(file)
      .then((data) => {
        const base =
          (data.customer && data.customer.trim()) ||
          file.name.replace(/\.json$/i, "") ||
          "Imported estimate";
        const name = uniqueSavedName(base);
        library.saveData(name, data, new Date().toISOString());
        renderSaved();
        toast(`Imported and saved as "${name}".`);
      })
      .catch((err) => toast(err.message))
      .finally(() => {
        el.importFile.value = ""; // allow re-importing the same file
      });
  });

  // Saved list (open / delete)
  el.savedList.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const name = btn.dataset.name;
    if (btn.dataset.action === "load-saved") {
      if (!(await confirmDialog(`Open "${name}"? This will replace the estimate you are currently editing.`, { title: "Open estimate", confirmLabel: "Open" }))) return;
      if (library.loadSaved(name)) {
        renderAll();
        setView("edit");
        toast(`Opened "${name}"`);
      }
    } else if (btn.dataset.action === "delete-saved") {
      if (await confirmDialog(`Delete saved estimate "${name}"?`, { title: "Delete estimate", confirmLabel: "Delete", danger: true })) {
        library.deleteSaved(name);
        renderSaved();
        toast(`Deleted "${name}"`);
      }
    }
  });

  // Item search modal: filter as you type, pick a result, close.
  el.itemSearch.addEventListener("input", () => renderItemResults(el.itemSearch.value));
  el.itemResults.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-item-id]");
    if (btn) selectItem(btn.dataset.itemId);
  });
  el.itemModal.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) closeItemModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.itemModal.hidden) closeItemModal();
  });

  // All-items reference list: filter as you type, filter chips, close on backdrop/✕.
  el.itemsListSearch.addEventListener("input", () => renderItemsList(el.itemsListSearch.value));
  el.itemsListFilters.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (btn) setItemsFilter(btn.dataset.filter);
  });
  el.itemsListModal.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) el.itemsListModal.hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.itemsListModal.hidden) el.itemsListModal.hidden = true;
  });

  // Sign-in dialog: closing it cancels the pending token request.
  el.signinModal.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) {
      cancelPending();
      el.signinModal.hidden = true;
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.signinModal.hidden) {
      cancelPending();
      el.signinModal.hidden = true;
    }
  });

  // Custom confirm/prompt dialog: a button click resolves with its value; the
  // backdrop/✕ and Escape resolve as a dismiss; Enter fires the primary button.
  el.dialogModal.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) return resolveDialog(null);
    const btn = e.target.closest("[data-dialog-action]");
    if (btn) resolveDialog(dialogButtons[Number(btn.dataset.dialogAction)]);
  });
  el.dialogInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const primary = dialogButtons.find((b) => b.variant === "primary");
      if (primary) resolveDialog(primary);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.dialogModal.hidden) resolveDialog(null);
  });

  // Tuck the fixed total bar away while typing on touch devices — the on-screen
  // keyboard otherwise floats it right over the field being edited. focusout is
  // deferred so moving field-to-field doesn't flicker the bar.
  const coarse = window.matchMedia("(pointer: coarse)");
  const isTypingField = (t) =>
    !!t && typeof t.matches === "function" &&
    t.matches("input:not([type=button]):not([type=checkbox]):not([type=radio]), textarea, select");
  document.addEventListener("focusin", (e) => {
    if (coarse.matches && isTypingField(e.target)) el.totalBar.classList.add("totalbar--tucked");
  });
  document.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!isTypingField(document.activeElement)) el.totalBar.classList.remove("totalbar--tucked");
    }, 0);
  });

  // Freeze the background while any modal is open. Modals toggle their `hidden`
  // attribute in many places, so rather than touch each site we watch them all
  // and flip `body.modal-open` whenever at least one is visible. This stops a
  // touch-scroll in the item list from moving the form behind the sheet.
  const modals = document.querySelectorAll(".modal");
  const syncModalOpen = () => {
    const anyOpen = Array.from(modals).some((m) => !m.hidden);
    document.body.classList.toggle("modal-open", anyOpen);
  };
  const modalObserver = new MutationObserver(syncModalOpen);
  modals.forEach((m) =>
    modalObserver.observe(m, { attributes: true, attributeFilter: ["hidden"] })
  );
  syncModalOpen();
}

/**
 * Ensure we hold a fresh Google token, returning it. If we already have one,
 * resolves instantly (silent). Otherwise shows the sign-in dialog with a real
 * rendered Google button — reliable, unlike One Tap — and resolves once the
 * user signs in (their credential arrives via the global callback → onCredential).
 * Rejects with "Sign-in cancelled" if they close the dialog.
 */
async function ensureToken() {
  const existing = getToken();
  if (existing) return existing;

  const gid = window.google?.accounts?.id;
  if (!gid) throw new Error("Google Sign-In is unavailable. Please check your internet connection.");

  // Show the dialog first so the button renders at full width, then render it.
  el.signinBtn.innerHTML = "";
  el.signinModal.hidden = false;
  gid.renderButton(el.signinBtn, {
    theme: "filled_blue",
    size: "large",
    text: "signin_with",
    shape: "pill",
  });
  try {
    gid.prompt(); // best-effort silent One Tap; the button is the reliable path
  } catch (_) {}

  try {
    return await awaitCredential();
  } finally {
    el.signinModal.hidden = true;
  }
}

/* ------------------------------------------------------------------ *
 *  Item search modal
 * ------------------------------------------------------------------ */
let pickTarget = { roomId: null, surfaceId: null };

function openItemModal(roomId, surfaceId) {
  pickTarget = { roomId, surfaceId };
  el.itemSearch.value = "";
  renderItemResults("");
  el.itemModal.hidden = false;
  el.itemSearch.focus();
}

function closeItemModal() {
  el.itemModal.hidden = true;
  pickTarget = { roomId: null, surfaceId: null };
}

/** The surface the item picker is currently open for, with its room id. */
function currentPickSurface() {
  const { roomId, surfaceId } = pickTarget;
  if (!roomId || !surfaceId) return null;
  const room = state.getState().rooms.find((r) => r.id === roomId);
  const surface = room?.surfaces.find((s) => s.id === surfaceId);
  return surface ? { roomId, surface } : null;
}

/** Item ids used by the ceilings/walls of a room — the items a deduct may net against. */
function roomParentItemIds(roomId) {
  const room = state.getState().rooms.find((r) => r.id === roomId);
  const set = new Set();
  room?.surfaces.forEach((s) => {
    if (s.kind !== "subtract" && s.item_id) set.add(s.item_id);
  });
  return set;
}

function renderItemResults(query) {
  let list = items.search(query);
  // A deduct can only net against an item already used by a ceiling/wall in the
  // same room, so restrict its picker to those items (and guide the user if the
  // room has none yet).
  const target = currentPickSurface();
  if (target && target.surface.kind === "subtract") {
    const allowed = roomParentItemIds(target.roomId);
    if (!allowed.size) {
      el.itemResults.innerHTML =
        `<li class="item-row item-row--empty">Add a ceiling or wall with an item first, then deduct from it.</li>`;
      return;
    }
    list = list.filter((it) => allowed.has(it.item_id));
  }
  if (!list.length) {
    el.itemResults.innerHTML = `<li class="item-row item-row--empty">No items found</li>`;
    return;
  }
  el.itemResults.innerHTML = list
    .map(
      (it) => `
      <li>
        <button class="item-row" type="button" data-item-id="${attr(it.item_id)}">
          <span class="item-row__name">${esc(it.name)}</span>
          <span class="item-row__rate">${formatMoney(it.rate)}${it.unit ? ` / ${esc(it.unit)}` : ""}</span>
        </button>
      </li>`
    )
    .join("");
}

/**
 * Apply the chosen item to the target surface: name, rate, unit, id, and the
 * measurement mode its pricing implies — area units → Area (L×W), per-length
 * units (RFT/ft/…) → Linear (a single length), everything else → Qty. Keeps the
 * billed quantity matched to what the item actually sells by.
 */
function selectItem(itemId) {
  const item = items.findById(itemId);
  const { roomId, surfaceId } = pickTarget;
  if (!item || !surfaceId) {
    closeItemModal();
    return;
  }

  const basis = pricingBasis(item.unit); // "area" | "count" | "linear"
  const mode = basis === "area" ? "area" : basis === "linear" ? "linear" : "unit";

  state.updateSurface(roomId, surfaceId, "item_id", item.item_id);
  state.updateSurface(roomId, surfaceId, "itemName", item.name);
  state.updateSurface(roomId, surfaceId, "itemUnit", item.unit || "");
  state.updateSurface(roomId, surfaceId, "costPerSqft", item.rate);
  state.updateSurface(roomId, surfaceId, "mode", mode);
  closeItemModal();
  renderForm();
  renderResults();
}

/* ------------------------------------------------------------------ *
 *  Save & publish
 * ------------------------------------------------------------------ */
/**
 * Reflect the Google state in the topbar and Publish button.
 *   - "Connected" now means we hold a fresh in-memory token (this reflects the
 *     ephemeral token, so after a reload it reads "Sign in" until the next
 *     silent/explicit auth — that's expected and honest).
 *   - Publish is enabled whenever online; the fresh token is fetched on click
 *     (silently if the Google session is alive, else a quick prompt).
 * The 7-day app access is independent of all this, so the app never locks here.
 */
function updateAuthUI() {
  const connected = hasFreshToken();
  el.authItem.innerHTML =
    (connected ? ICON.signout : ICON.signin) +
    `<span>${connected ? "Sign out" : "Sign in"}</span>`;

  // Status dot inside the menu (next to the name): green when signed in.
  el.authDotLg.classList.toggle("is-active", connected);

  // Signed-in identity (from the 7-day access marker — persists across reopen).
  const user = getUser();
  el.menuUserName.textContent = user ? user.name || "Signed in" : "Not signed in";
  el.menuUserEmail.textContent = user ? user.email : "";

  // Publish requires an ACTIVE Google session (a fresh token) AND internet.
  // Otherwise it's greyed out with a hint on how to enable it.
  const online = navigator.onLine;
  const canPublish = connected && online;
  el.publishBtn.disabled = !canPublish;
  el.publishBtn.title = canPublish
    ? ""
    : !online
    ? "You're offline — please reconnect to publish"
    : "Please sign in to publish to Zoho Books";

  el.publishHint.hidden = canPublish;
  if (!canPublish) {
    el.publishHint.textContent = !online
      ? "You're offline. Please reconnect to the internet to publish to Zoho Books."
      : "Please sign in to publish to Zoho Books — use the menu at the top-right.";
  }
}

/** Let app.js refresh this after a token arrives while the app is open. */
export function refreshAuthUI() {
  updateAuthUI();
}

/**
 * Pull live prices from the backend if we currently hold a fresh token (never
 * forces a prompt). Called after sign-in and on token arrival. Re-renders the
 * item modal if it happens to be open.
 */
export function refreshItems() {
  items.refreshLive(getToken()).then((updated) => {
    if (updated && !el.itemModal.hidden) renderItemResults(el.itemSearch.value);
  });
}

/* ------------------------------------------------------------------ *
 *  Backend server status (awake / waking / offline). Pinging /health also
 *  pre-warms the server (Render free sleeps after ~15 min idle) so that by
 *  the time someone publishes, it's already awake.
 * ------------------------------------------------------------------ */
let serverStatus = null; // "checking" | "waking" | "ready" | "offline"

function setServerStatus(s) {
  if (s === serverStatus) return; // no change — don't re-render/announce
  serverStatus = s;
  el.serverStatus.classList.toggle("is-ready", s === "ready");
  el.serverStatus.classList.toggle("is-waking", s === "waking");
  el.serverStatus.classList.toggle("is-offline", s === "offline");
  el.serverLabel.textContent =
    s === "ready" ? "Online" : s === "waking" ? "Waking…" : s === "offline" ? "Offline" : "…";
}

/**
 * Fire-and-forget /health ping to pre-warm the backend. Used from the locked
 * login gate (where the status indicator isn't shown) so the server is already
 * waking while the user signs in — the sign-in call itself hits the backend.
 */
export function warmServer() {
  if (!navigator.onLine) return;
  fetch(`${API_URL}/health`, { cache: "no-store" }).catch(() => {});
}

async function checkServer() {
  if (!navigator.onLine) {
    setServerStatus("offline");
    return;
  }
  if (serverStatus === null) setServerStatus("checking");
  // If the request is slow (a cold start), show "Waking…" — unless we already
  // know it's ready. Allow up to 60s for a Render wake-up before calling it dead.
  const wakeTimer = setTimeout(() => {
    if (serverStatus !== "ready") setServerStatus("waking");
  }, 2500);
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 60000);
    const res = await fetch(`${API_URL}/health`, { cache: "no-store", signal: ctrl.signal });
    clearTimeout(to);
    setServerStatus(res.ok ? "ready" : "offline");
  } catch (_) {
    setServerStatus("offline");
  } finally {
    clearTimeout(wakeTimer);
  }
}

/* ----- topbar menu ------------------------------------------------ */
function openMenu() {
  el.menuPanel.hidden = false;
  el.menuBtn.setAttribute("aria-expanded", "true");
}
function closeMenu() {
  el.menuPanel.hidden = true;
  el.menuBtn.setAttribute("aria-expanded", "false");
}
function toggleMenu() {
  el.menuPanel.hidden ? openMenu() : closeMenu();
}

/** Menu → Sign out of / Sign in to Google. Never ends the local app access. */
async function handleAuthToggle() {
  if (hasFreshToken()) {
    if (!(await confirmDialog("The app stays available offline — sign in again only when you want to publish.", { title: "Sign out?", confirmLabel: "Sign out" }))) return;
    signOutGoogle();
    updateAuthUI();
    toast("Signed out");
  } else {
    try {
      await ensureToken(); // silent if a token is held, else the sign-in dialog
      updateAuthUI();
      refreshItems();
      toast("Signed in");
    } catch (err) {
      if (err.message !== "Sign-in cancelled") {
        toast(err.message || "Unable to sign in. Please check your internet connection.", { error: true });
      }
    }
  }
}

/**
 * Menu → Refresh items: force a fresh pull from the backend (bypassing both the
 * frontend cache and the backend's 1-hour cache via ?fresh=1), so a just-added
 * Zoho item shows up immediately. Needs a Google session + internet.
 */
async function syncItems() {
  if (!navigator.onLine) {
    toast("You're offline. Please connect to the internet to refresh items.", { error: true });
    return;
  }
  let token;
  try {
    token = await ensureToken();
  } catch (err) {
    if (err.message !== "Sign-in cancelled") toast(err.message || "Please sign in to refresh items.", { error: true });
    return;
  }
  showBusy("Refreshing items…");
  let count;
  try {
    count = await items.refreshLive(token, { force: true });
  } finally {
    hideBusy();
  }
  if (count) {
    toast(`Items updated — ${count} items.`);
    if (!el.itemModal.hidden) renderItemResults(el.itemSearch.value);
  } else {
    toast("Unable to refresh items. Please try again.", { error: true });
  }
}

/* ------------------------------------------------------------------ *
 *  View items (menu): full catalogue with status, so the team can see
 *  why an item isn't in the picker (inactive / purchase-only).
 * ------------------------------------------------------------------ */
let allItemsCache = [];
let itemsFilter = "all"; // all | available | purchase | inactive

async function viewItems() {
  if (!navigator.onLine) {
    toast("You're offline. Please connect to the internet to view items.", { error: true });
    return;
  }
  let token;
  try {
    token = await ensureToken();
  } catch (err) {
    if (err.message !== "Sign-in cancelled") toast(err.message || "Please sign in to view items.", { error: true });
    return;
  }
  setItemsFilter("all");
  el.itemsListSearch.value = "";
  el.itemsListResults.innerHTML = `<li class="item-row item-row--empty">Loading…</li>`;
  el.itemsListModal.hidden = false;
  const all = await items.fetchAll(token);
  if (!all) {
    el.itemsListResults.innerHTML = `<li class="item-row item-row--empty">Couldn't load items — try again</li>`;
    return;
  }
  // Sort: available first, then purchase-only, then inactive; alpha within each.
  allItemsCache = all.slice().sort((a, b) => statusRank(a) - statusRank(b) || nameOf(a).localeCompare(nameOf(b)));
  renderItemsList("");
}

function nameOf(it) {
  return (it.name || it.item_name || "").toString();
}

/** 0 = available, 1 = purchase-only, 2 = inactive (used for sorting). */
function statusRank(it) {
  if ((it.status || "active") !== "active") return 2;
  if (it.can_be_sold !== true) return 1;
  return 0;
}

/** Set the active status filter and re-render (updates chip highlight). */
function setItemsFilter(filter) {
  itemsFilter = filter;
  el.itemsListFilters.querySelectorAll("[data-filter]").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.filter === filter)
  );
  renderItemsList(el.itemsListSearch.value);
}

function passesFilter(it) {
  if (itemsFilter === "all") return true;
  const rank = statusRank(it); // 0 available, 1 purchase-only, 2 inactive
  return (
    (itemsFilter === "available" && rank === 0) ||
    (itemsFilter === "purchase" && rank === 1) ||
    (itemsFilter === "inactive" && rank === 2)
  );
}

function renderItemsList(query) {
  const q = String(query || "").trim().toLowerCase();
  const list = allItemsCache.filter(
    (it) => passesFilter(it) && (!q || nameOf(it).toLowerCase().includes(q))
  );
  if (!list.length) {
    el.itemsListResults.innerHTML = `<li class="item-row item-row--empty">No items found</li>`;
    return;
  }
  el.itemsListResults.innerHTML = list.map(itemsListRow).join("");
}

function itemsListRow(it) {
  const rank = statusRank(it);
  const badge =
    rank === 2
      ? `<span class="badge badge--bad">Inactive</span>`
      : rank === 1
      ? `<span class="badge badge--warn">Purchase only</span>`
      : `<span class="badge badge--ok">Available</span>`;
  const rowClass = rank === 2 ? "items-list__row--bad" : rank === 1 ? "items-list__row--warn" : "";
  const rate = formatMoney(Number(it.rate) || 0);
  const unit = it.unit ? ` / ${esc(it.unit)}` : "";
  return `
    <li class="items-list__row ${rowClass}">
      <div class="items-list__main">
        <span class="items-list__name">${esc(nameOf(it))}</span>
        <span class="items-list__meta">${rate}${unit}</span>
      </div>
      ${badge}
    </li>`;
}

/** Menu → Lock app: clears app access + token, returns to the login screen. */
async function lockApp() {
  if (!(await confirmDialog("You'll need to sign in with Google again to unlock (requires an internet connection).", { title: "Lock the app?", confirmLabel: "Lock" }))) return;
  clearAccess();
  signOutGoogle();
  window.location.reload();
}

/**
 * Custom modal dialog — replaces native confirm()/prompt() so popups match the
 * app and behave on mobile. Resolves with the chosen button object (which may
 * carry a `.value` read from the input when present), or null if dismissed.
 *
 *   showDialog({
 *     title, message,
 *     input: { value, placeholder },              // omit for a plain confirm
 *     buttons: [{ label, value, variant }],       // variant: primary|secondary|ghost
 *   })
 */
function showDialog({ title = "", message = "", input = null, buttons = [] }) {
  return new Promise((resolve) => {
    resolveDialog(null); // clear any dialog already open
    dialogResolve = resolve;
    dialogButtons = buttons;

    el.dialogTitle.textContent = title;
    el.dialogMessage.textContent = message;

    if (input) {
      el.dialogInput.hidden = false;
      el.dialogInput.value = input.value || "";
      el.dialogInput.placeholder = input.placeholder || "";
    } else {
      el.dialogInput.hidden = true;
      el.dialogInput.value = "";
    }

    el.dialogActions.innerHTML = buttons
      .map(
        (b, i) =>
          `<button type="button" class="btn btn--${b.variant || "secondary"}" data-dialog-action="${i}">${esc(b.label)}</button>`
      )
      .join("");

    el.dialogModal.hidden = false;
    if (input) {
      el.dialogInput.focus();
      el.dialogInput.select();
    } else {
      el.dialogActions.querySelector("[data-dialog-action]")?.focus();
    }
  });
}

/**
 * Yes/no confirmation using the custom dialog. Resolves true only if the user
 * taps the confirm button. `danger` styles it as a destructive (red) action.
 */
async function confirmDialog(message, { title = "", confirmLabel = "OK", danger = false } = {}) {
  const res = await showDialog({
    title,
    message,
    buttons: [
      { label: "Cancel", value: "cancel", variant: "ghost" },
      { label: confirmLabel, value: "ok", variant: danger ? "danger" : "primary" },
    ],
  });
  return res?.action === "ok";
}

/**
 * Close the dialog and settle its promise. Resolves null if dismissed, else
 * { action, value? } where `action` is the clicked button's value and `value`
 * is the input text (only when the dialog has an input). Keeping the two apart
 * means a Cancel with a pre-filled input is never mistaken for a Save.
 */
function resolveDialog(button) {
  if (!dialogResolve) return;
  const done = dialogResolve;
  dialogResolve = null;
  el.dialogModal.hidden = true;
  if (!button) return done(null);
  const result = { action: button.value };
  if (!el.dialogInput.hidden) result.value = el.dialogInput.value.trim();
  done(result);
}

/**
 * Save the current estimate on this device. Defaults silently to the estimate
 * name — no popup when that name is free. Only when it's already saved do we
 * ask: overwrite it, or keep both by saving a new copy under an edited name
 * (pre-filled with a numbered suffix). Choosing a copy name also updates the
 * estimate-name field so the form reflects what was saved.
 */
async function saveEstimate() {
  const savedNames = () => library.listSaved().map((it) => it.name);
  const commit = (name, msg) => {
    library.saveCurrent(name, new Date().toISOString());
    renderSaved();
    toast(msg);
  };

  // Prompt for a name only when the field is empty (nothing to default to).
  let base = el.customer.value.trim();
  if (!base) {
    const res = await showDialog({
      title: "Name this estimate",
      input: { value: "", placeholder: "e.g. Abhishek Singh - 1" },
      buttons: [
        { label: "Cancel", value: "cancel", variant: "ghost" },
        { label: "Save", value: "save", variant: "primary" },
      ],
    });
    if (!res || res.action !== "save") return;
    base = (res.value || "").trim();
    if (!base) return;
    setEstimateName(base);
  }

  // Free name — save straight away, no confirmation.
  if (!savedNames().includes(base)) {
    commit(base, `Saved "${base}"`);
    return;
  }

  // Name is taken — overwrite, keep both (new copy), or cancel.
  const choice = await showDialog({
    title: "Already saved",
    message: `"${base}" already exists. Overwrite it, or keep both by saving a new copy?`,
    buttons: [
      { label: "Cancel", value: "cancel", variant: "ghost" },
      { label: "Save new copy", value: "copy", variant: "secondary" },
      { label: "Overwrite", value: "overwrite", variant: "primary" },
    ],
  });
  if (!choice || choice.action === "cancel") return;

  if (choice.action === "overwrite") {
    commit(base, `Updated "${base}"`);
    return;
  }

  // New copy — pre-fill a suffixed name (e.g. "Abhishek Singh (2)"). Strip any
  // existing "(N)" from the base first so repeated copies number flatly
  // ((2), (3), (4)) instead of nesting ("X (2) (2)").
  const root = base.replace(/\s*\(\d+\)\s*$/, "").trim() || base;
  const res = await showDialog({
    title: "Save as a new copy",
    message: "Give this copy its own name.",
    input: { value: uniqueSavedName(root), placeholder: "Estimate name" },
    buttons: [
      { label: "Cancel", value: "cancel", variant: "ghost" },
      { label: "Save copy", value: "save", variant: "primary" },
    ],
  });
  if (!res || res.action !== "save") return;
  const name = (res.value || "").trim();
  if (!name) return;

  // As soon as the copy name is set, mirror it into the estimate-name field.
  setEstimateName(name);

  if (savedNames().includes(name)) {
    const ow = await showDialog({
      title: "Already saved",
      message: `"${name}" already exists. Overwrite it?`,
      buttons: [
        { label: "Cancel", value: "cancel", variant: "ghost" },
        { label: "Overwrite", value: "overwrite", variant: "primary" },
      ],
    });
    if (!ow || ow.action !== "overwrite") return;
    commit(name, `Updated "${name}"`);
    return;
  }
  commit(name, `Saved "${name}"`);
}

/** Set the estimate-name field and keep state in sync. */
function setEstimateName(name) {
  el.customer.value = name;
  state.setCustomer(name);
}

/**
 * Publish the current estimate to Zoho Books via the backend. Each non-deduct
 * surface with a size becomes a line item (quantity = area, rate = cost/sqft).
 * Requires the backend endpoint to be live; until then this shows an error.
 */
async function publishToZoho() {
  const model = computeEstimate(state.getState());
  const lineItems = [];
  let unlinkedCount = 0; // publishable surfaces (incl. deducts) with no catalogue item
  const blocked = []; // surfaces whose item can't be priced safely (integrity guard)
  const overDeducted = []; // deducts bigger than their item's area in the room
  try {
    model.rooms.forEach((room) => {
      room.surfaces.forEach((s) => {
        // pricedQty is computed once in calculator.js (area for area-mode, qty
        // for qty-mode) so the published quantity is exactly what's on screen.
        const magnitude = Number(n(s.pricedQty).toFixed(2));
        if (!magnitude) return; // no size — skip
        if (s.overDeduct) overDeducted.push((s.itemName || s.label || "an item").trim());
        if (!s.item_id) unlinkedCount += 1; // every surface (incl. deducts) needs an item
        // Integrity: refuse a surface whose linked item's unit we can't bill
        // against what was measured (e.g. a per-length item). Better to stop
        // than to publish a wrong quantity.
        if (s.item_id && s.pricingOk === false) {
          blocked.push((s.itemName || s.label || "an item").trim());
          return;
        }
        if (!Number.isFinite(magnitude)) throw new Error(`Bad quantity for "${s.label}"`);
        lineItems.push({
          item_id: s.item_id || undefined,
          name: (s.itemName || s.label || "").trim() || undefined,
          quantity: s.isSubtract ? -magnitude : magnitude,
          rate: n(s.costPerSqft),
          // Room so the server can group per room and label each line's
          // description (the Qty column carries the quantity; no dimensions).
          room: room.displayName,
        });
      });
    });
  } catch (err) {
    // Final catch-all: anything unexpected in building the lines stops the
    // publish rather than sending Zoho something wrong.
    console.error("[Publish] Could not build line items:", err);
    toast("Something looks off in this estimate — couldn't prepare it for Zoho. Please review and try again.", { error: true });
    return;
  }

  if (blocked.length) {
    const names = [...new Set(blocked)].join(", ");
    toast(`Can't publish: ${names} — the item's pricing unit doesn't match how it's measured. Fix the item or remove it.`, { error: true });
    return;
  }

  if (overDeducted.length) {
    const names = [...new Set(overDeducted)].join(", ");
    toast(`Can't publish: the deduction for ${names} is larger than that item's area in the room. Reduce the deduction.`, { error: true });
    return;
  }

  if (!lineItems.length) {
    toast("Please add at least one item with a size before publishing.", { error: true });
    return;
  }

  // Step 1: ALWAYS keep a local copy first — the moment Publish is pressed,
  // before any online/sign-in checks — so a copy is kept even if we're offline
  // or the sign-in is cancelled and publishing never happens.
  const saveName = el.customer.value.trim() || "Untitled estimate";
  library.saveCurrent(saveName, new Date().toISOString());
  renderSaved();

  // Every surface must use a catalogue item to publish to Zoho. If any doesn't,
  // keep the local copy (already saved above) but don't publish.
  if (unlinkedCount > 0) {
    toast(
      "Saved on this device. Please select an item for every entry before publishing to Zoho Books.",
      { error: true }
    );
    return;
  }

  if (!navigator.onLine) {
    toast("Saved on this device. You're offline — please reconnect to publish to Zoho Books.", { error: true });
    return;
  }

  // Get a fresh Google token on demand — silent if we hold one, otherwise the
  // sign-in dialog appears. The token is never stored on disk.
  let token;
  try {
    token = await ensureToken();
  } catch (err) {
    updateAuthUI();
    if (err.message !== "Sign-in cancelled") {
      toast("Saved on this device. Please sign in to also publish to Zoho Books.", { error: true });
    }
    return;
  }

  const original = el.publishBtn.innerHTML;
  el.publishBtn.disabled = true;
  el.publishBtn.textContent = "Publishing…";
  // Full-screen spinner — the backend may be cold-starting (Render), so this can
  // take a few seconds; the overlay makes the wait read as progress, not a hang.
  showBusy("Publishing to Zoho Books…");
  try {
    const res = await fetch(`${API_URL}/api/quotes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ customerName: model.customer, lineItems }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Publishing failed");
    // Stay in the app — not every user has Zoho access, so we just confirm
    // success rather than opening the Zoho estimate page.
    toast("Estimate published to Zoho Books");
  } catch (err) {
    toast(err.message || "Unable to reach the server. Please try again.", { error: true });
  } finally {
    hideBusy();
    el.publishBtn.innerHTML = original;
    updateAuthUI(); // restore the correct enabled/disabled state
  }
}

/* ------------------------------------------------------------------ *
 *  Small helpers
 * ------------------------------------------------------------------ */
/** A saved-estimate name that doesn't collide with an existing one. */
function uniqueSavedName(base) {
  const existing = new Set(library.listSaved().map((it) => it.name));
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base} (${i})`)) i += 1;
  return `${base} (${i})`;
}

/** Visible character width for a name input, so the pencil sits next to text. */
function sizeFor(text, fallback) {
  return Math.max((text || "").length, (fallback || "").length, 4) + 1;
}

/** Resize a name input to its current content as the user types. */
function autosize(input) {
  input.size = Math.max(input.value.length, (input.placeholder || "").length, 4) + 1;
}

function ids(node) {
  const roomEl = node.closest("[data-room-id]");
  const surfaceEl = node.closest("[data-surface-id]");
  return {
    roomId: roomEl ? roomEl.dataset.roomId : null,
    surfaceId: surfaceEl ? surfaceEl.dataset.surfaceId : null,
  };
}

/**
 * Blocking activity overlay for backend waits (publish, refresh items). Shows a
 * spinner + message so a slow request (e.g. Render's cold start) reads as
 * "working", not "stuck". Always pair showBusy() with hideBusy() in a finally.
 */
function showBusy(message = "Working…") {
  el.busyText.textContent = message;
  el.busy.hidden = false;
}
function hideBusy() {
  el.busy.hidden = true;
}

let toastTimer = null;
/**
 * Show a message. Info toasts auto-dismiss after ~4s; pass { error: true } for
 * errors/important messages, which stay ~8s (long enough to read) with a red
 * style. Any toast can also be tapped (message or ✕) to dismiss it early.
 */
function toast(message, opts = {}) {
  const isError = opts.error === true;
  el.toast.innerHTML =
    '<span class="toast__msg"></span><button class="toast__x" type="button" aria-label="Dismiss">✕</button>';
  el.toast.querySelector(".toast__msg").textContent = message;
  el.toast.classList.add("toast--show");
  el.toast.classList.toggle("toast--error", isError);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, opts.duration || (isError ? 8000 : 4000));
}
function hideToast() {
  clearTimeout(toastTimer);
  el.toast.classList.remove("toast--show");
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch (_) {
    return "";
  }
}

function n(value) {
  const x = parseFloat(value);
  return Number.isFinite(x) ? x : 0;
}

/**
 * A compact "measures" label combining area and quantity, e.g.
 *   "100 sq. ft. / 3 qty"  (both present)
 *   "100 sq. ft."          (area only)
 *   "3 qty"                (unit only)
 * Shows area alone when neither is present, so it's never blank.
 */
function measures(area, qty, length = 0) {
  const parts = [];
  if (area > 0) parts.push(formatArea(area));
  if (length > 0) parts.push(formatLength(length));
  if (qty > 0) parts.push(`${qty.toLocaleString("en-IN")} qty`);
  return parts.length ? parts.join(" / ") : formatArea(area);
}

// Per-surface-type subtotal rows for a room footer (Ceiling / Walls / Deducts).
// Shown only when a room mixes types, so a single-type room isn't just a
// duplicate of its Total line. Subtract kinds render negative and reconcile to
// the room Total below them.
const KIND_LABELS = { ceiling: "Ceiling", wall: "Walls", subtract: "Deducts" };
function kindSubtotalRows(room) {
  const kinds = Object.keys(KINDS).filter((k) => room.byKind[k]);
  if (kinds.length < 2) return "";
  return kinds
    .map((k) => {
      const b = room.byKind[k];
      return `<tr class="quote-subtotal-row quote-subtotal-row--${k}">
                <td>${KIND_LABELS[k] || KINDS[k].title} <span class="quote-foot__area">· ${measuresSigned(b.area, b.qty, b.length)}</span></td>
                <td class="num">${moneySigned(b.cost)}</td>
              </tr>`;
    })
    .join("");
}

/** Like measures(), but keeps a sign so deduct subtotals read as negative. */
function measuresSigned(area, qty, length = 0) {
  const parts = [];
  if (area) parts.push((area < 0 ? "−" : "") + formatArea(Math.abs(area)));
  if (length) parts.push((length < 0 ? "−" : "") + formatLength(Math.abs(length)));
  if (qty) parts.push((qty < 0 ? "−" : "") + `${Math.abs(qty).toLocaleString("en-IN")} qty`);
  return parts.length ? parts.join(" / ") : formatArea(0);
}

/** Money with an explicit minus for negatives, e.g. -1200 → "−₹1,200". */
function moneySigned(value) {
  return (value < 0 ? "−" : "") + formatMoney(Math.abs(value));
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function attr(str) {
  return esc(str);
}
