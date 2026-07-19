# CLAUDE.md — project context (auto-loaded)

ShineMySpace **Estimator + Zoho Books** integration. **Read `README.md` for the full picture.**
Monorepo, one git repo:
- `estimator-shinemyspace/` — static frontend (vanilla JS, **no build step**). Deploys to Hostinger
  `estimator.shinemyspace.com` by **manual upload** (run `make-frontend-upload.sh`, upload the
  generated `estimator-shinemyspace upload/`). Entry `index.html`; logic in `assets/js/calc/*.js`.
- `api-shinemyspace/` — Node/Express backend, **live on Render** at `api-shinemyspace.onrender.com`.

## State: built, deployed, working
Frontend and backend are complete and integrated. Google Sign-In works; items load live from Zoho;
publishing creates real Zoho estimates. Both are deployed (Render backend, Hostinger frontend).

## Conventions
- Frontend is plain HTML/CSS/ES modules — **no bundler/framework**. Match the existing style.
- Auth: Google Sign-In → backend verifies the ID token (signature + audience + `ALLOWED_EMAILS`,
  server-side only). A **7-day access marker** (localStorage, no token) opens the app offline; the
  ~1 hr Google token is fetched on demand for `/api/items` + `/api/quotes`.
- Backend config is via **env vars** (see `api-shinemyspace/.env.example`); nothing environment-specific
  is hardcoded. `config.js` `API_URL` points the frontend at the Render backend.
- Data model is **additive** (surface has `mode`, `qty`, `item_id`, `itemName`) — don't bump
  `SCHEMA_VERSION` for additive fields; old saved estimates must keep loading.

## Zoho rules (in `routes/quotes.js` / `routes/items.js`)
- Items are filtered to **active + sellable** (`can_be_sold === true`); inactive/purchase-only never reach the picker.
- Picking an item locks the Area/Qty mode to the item's unit; lines are **aggregated by item**;
  **deducts** are negative quantities that net out; every surface must have an item to publish.
- Estimates use a fixed `ZOHO_SYSTEM_CONTACT_ID`; creator email → `salesperson_name`.
- Zoho **Self Client**, minimal scopes `ZohoBooks.items.READ,ZohoBooks.estimates.CREATE`.

## Gotchas
- **`.htaccess` (frontend) is essential in prod** — it sets `Cross-Origin-Opener-Policy:
  same-origin-allow-popups`, without which Google Sign-In silently fails. COOP can't be a `<meta>` tag.
- Use **`localhost`** (not `127.0.0.1`) for local Google Sign-In. Local dev server: `npm start` in
  the frontend (adds the COOP header); backend `npm run dev`, or `DISABLE_AUTH=1` for Postman
  (guarded — never active when `NODE_ENV=production`).
- Render free tier **sleeps when idle**; the server-status indicator + on-load ping handle the cold start.
- Secrets live only in `.env` (gitignored). Never commit real credentials.

## Run locally
Backend: `cd api-shinemyspace && npm install && npm run dev` → `localhost:3000`.
Frontend: `cd estimator-shinemyspace && npm start` → open `http://localhost:5500`.
