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
import { computeEstimate, formatMoney, formatArea, KINDS } from "./calculator.js";
import { API_URL } from "./config.js";
import { hasFreshToken, getToken, getUser, awaitCredential, cancelPending, signOutGoogle, clearAccess } from "./auth.js";

const $ = (id) => document.getElementById(id);
let el = {}; // cached elements

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
  };
  el.save.textContent = `💾 Save on this ${deviceWord()}`;
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

/** Best-effort device word for the Save button: phone / tablet / device. */
function deviceWord() {
  const ua = navigator.userAgent || "";
  if (/iPhone|iPod|Windows Phone|Android.*Mobile/i.test(ua)) return "phone";
  if (/iPad|Tablet|Android/i.test(ua)) return "tablet";
  return "device";
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
  const isUnit = surface.mode === "unit";
  const itemName = (surface.itemName || "").trim();
  // When an item is picked, its pricing type (sqft vs pcs/nos/…) fixes the mode,
  // so lock the Area/Qty toggle to strictly follow the item.
  const locked = !!surface.item_id;

  // Area mode: Length × Width × rate/sqft. Unit mode: Quantity × rate/unit.
  const fields = isUnit
    ? `${field("Quantity", "qty", surface.qty)}
       ${field("Cost/unit", "costPerSqft", surface.costPerSqft)}`
    : `${field(k.dim1, "dim1", surface.dim1)}
       ${field(k.dim2, "dim2", surface.dim2)}
       ${field("Cost/sqft", "costPerSqft", surface.costPerSqft)}`;

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
        <div class="mode-toggle ${locked ? "mode-toggle--locked" : ""}" role="group" aria-label="Measurement mode"${locked ? ' title="Set by the selected item"' : ""}>
          <button class="mode-toggle__opt ${!isUnit ? "is-active" : ""}" data-action="mode" data-mode="area" type="button"${locked ? " disabled" : ""}>Area</button>
          <button class="mode-toggle__opt ${isUnit ? "is-active" : ""}" data-action="mode" data-mode="unit" type="button"${locked ? " disabled" : ""}>Qty</button>
        </div>
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

/* ------------------------------------------------------------------ *
 *  Results (breakdown + totals)
 * ------------------------------------------------------------------ */
function renderResults() {
  const model = computeEstimate(state.getState());
  const date = formatDate(model.date);

  // Header tiles: Area, plus Quantity when the estimate has any unit-mode items.
  const hasQty = model.totalQty > 0;
  const hasArea = model.totalArea > 0 || !hasQty;
  const metrics = [];
  if (hasArea) metrics.push({ label: "Area", value: formatArea(model.totalArea) });
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
          <span class="quote-summary__label">Estimate for</span>
          <span class="quote-summary__name">${model.customer ? esc(model.customer) : "Customer"}</span>
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
              <tr class="quote-total-row">
                <td>Total <span class="quote-foot__area">· ${measures(room.area, room.qty)}</span></td>
                <td class="num">${formatMoney(room.cost)}</td>
              </tr>
            </tfoot>
          </table>
        </div>`;
    })
    .join("");

  el.result.innerHTML = summary + rooms;

  el.totalBar.innerHTML = `
    <span class="totalbar__area">${measures(model.totalArea, model.totalQty)}</span>
    <span class="totalbar__cost">${formatMoney(model.totalCost)}</span>`;
}

function resultRow(surface) {
  const k = KINDS[surface.kind];
  const sign = surface.isSubtract ? "−" : "";
  const itemName = (surface.itemName || "").trim();
  const rate = n(surface.costPerSqft).toLocaleString("en-IN");
  const detail = surface.isUnit
    ? `<div class="quote-item__dims">Qty ${n(surface.qty)}</div>
        <div class="quote-item__calc">@ ₹${rate}/unit</div>`
    : `<div class="quote-item__dims">${k.dim1} ${n(surface.dim1)} × ${k.dim2} ${n(surface.dim2)} ft</div>
        <div class="quote-item__calc">${formatArea(surface.area)} · @ ₹${rate}/sqft</div>`;
  return `
    <tr class="${surface.isSubtract ? "quote-row--sub" : ""}">
      <td>
        <div class="quote-item__name">${esc(surface.label)}</div>
        ${itemName ? `<div class="quote-item__item">${esc(itemName)}</div>` : ""}
        ${detail}
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
    el.savedList.innerHTML = `<p class="muted">No saved estimates yet. Enter a customer name above and tap Save.</p>`;
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
      state.updateSurface(roomId, surfaceId, fieldInput.dataset.field, fieldInput.value);
      if (fieldInput.dataset.field === "label") autosize(fieldInput);
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
  el.rooms.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const { roomId, surfaceId } = ids(btn);
    if (btn.dataset.action === "pick-item") {
      openItemModal(roomId, surfaceId);
      return;
    }
    if (btn.dataset.action === "mode") {
      state.updateSurface(roomId, surfaceId, "mode", btn.dataset.mode);
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
      "remove-room": () => {
        if (!confirm("Delete this room? This cannot be undone.")) return;
        state.removeRoom(roomId);
      },
    };
    if (actions[btn.dataset.action]) {
      actions[btn.dataset.action]();
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

  el.newEstimate.addEventListener("click", () => {
    if (confirm("Start a new, empty estimate? The current one will be cleared (saved estimates are kept).")) {
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
  el.savedList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const name = btn.dataset.name;
    if (btn.dataset.action === "load-saved") {
      if (!confirm(`Open "${name}"? This will replace the estimate you are currently editing.`)) return;
      if (library.loadSaved(name)) {
        renderAll();
        setView("edit");
        toast(`Opened "${name}"`);
      }
    } else if (btn.dataset.action === "delete-saved") {
      if (confirm(`Delete saved estimate "${name}"?`)) {
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

function renderItemResults(query) {
  const list = items.search(query);
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
 * The measurement mode implied by a Zoho item's unit: square-area units
 * (sqft, sq. ft., sqm, …) → "area" (Length × Width); anything else
 * (pcs, nos, set, box, …) → "unit" (Qty). Returns null for an unknown/blank
 * unit so we leave the current mode untouched.
 */
function modeForUnit(unit) {
  const u = String(unit || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!u) return null;
  return u.startsWith("sq") || u.startsWith("square") ? "area" : "unit";
}

/** Apply the chosen item to the target surface: name, rate, id, and its mode. */
function selectItem(itemId) {
  const item = items.findById(itemId);
  const { roomId, surfaceId } = pickTarget;
  if (!item || !surfaceId) {
    closeItemModal();
    return;
  }
  state.updateSurface(roomId, surfaceId, "item_id", item.item_id);
  state.updateSurface(roomId, surfaceId, "itemName", item.name);
  state.updateSurface(roomId, surfaceId, "costPerSqft", item.rate);
  // Strictly follow the item's pricing type for the Area/Qty mode.
  const mode = modeForUnit(item.unit);
  if (mode) state.updateSurface(roomId, surfaceId, "mode", mode);
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
      : "Please sign in to publish to Zoho Books — use the menu (☰) at the top-right.";
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
    if (!confirm("Sign out?\nThe app stays available offline — sign in again only when you want to publish.")) return;
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
  toast("Refreshing items…");
  const count = await items.refreshLive(token, { force: true });
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
function lockApp() {
  if (!confirm("Lock the app?\nYou'll need to sign in with Google again to unlock (requires an internet connection).")) return;
  clearAccess();
  signOutGoogle();
  window.location.reload();
}

/** Save the current estimate on this device under a name (prompts for one). */
function saveEstimate() {
  const suggested = el.customer.value.trim();
  const name = (prompt(
    'Save this estimate as:\n(Tip: add a label to keep different versions for the same customer — e.g. "Mr Singh — with false ceiling")',
    suggested
  ) || "").trim();
  if (!name) {
    // Empty or cancelled — only nag if they actually confirmed an empty name.
    return;
  }
  const exists = library.listSaved().some((it) => it.name === name);
  if (exists && !confirm(`"${name}" is already saved. Update it with the current details?`)) {
    return;
  }
  library.saveCurrent(name, new Date().toISOString());
  renderSaved();
  toast(exists ? `Updated "${name}"` : `Saved "${name}"`);
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
  model.rooms.forEach((room) => {
    room.surfaces.forEach((s) => {
      // Magnitude: qty for unit-mode, area (sqft) for area-mode. Deducts are
      // sent as a NEGATIVE quantity so the backend subtracts them from the
      // matching item's aggregated line.
      const magnitude = Number((s.isUnit ? s.qty : s.area).toFixed(2));
      if (!magnitude) return; // no size — skip
      if (!s.item_id) unlinkedCount += 1; // every surface (incl. deducts) needs an item
      lineItems.push({
        item_id: s.item_id || undefined,
        name: (s.itemName || s.label || "").trim() || undefined,
        quantity: s.isSubtract ? -magnitude : magnitude,
        rate: n(s.costPerSqft),
      });
    });
  });

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
      `Saved on this device. ${unlinkedCount} surface${unlinkedCount > 1 ? "s" : ""} ` +
        `require a selected item (🔍) before publishing to Zoho Books.`,
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
    toast("Estimate published to Zoho Books ✓");
  } catch (err) {
    toast(err.message || "Unable to reach the server. Please try again.", { error: true });
  } finally {
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
function measures(area, qty) {
  const parts = [];
  if (area > 0) parts.push(formatArea(area));
  if (qty > 0) parts.push(`${qty.toLocaleString("en-IN")} qty`);
  return parts.length ? parts.join(" / ") : formatArea(area);
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function attr(str) {
  return esc(str);
}
