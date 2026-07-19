# ShineMySpace Estimator

A cost-estimator web app for the ShineMySpace sales team. Salespeople build room-by-room
painting/finishing estimates from a live **Zoho Books** item catalogue and publish them as
**estimates in Zoho Books**. Sign-in is via **Google** (no Zoho logins for the team).

- **Frontend:** static vanilla JS (HTML/CSS/ES modules, no build step) → **Hostinger** (`estimator.shinemyspace.com`)
- **Backend:** Node/Express → **Render** (`api-shinemyspace.onrender.com`)
- **Data:** Zoho Books API (India data center) — items + estimates

---

## Repo layout (monorepo)

```
.
├── api-shinemyspace/            # Backend (deploys to Render)
│   ├── server.js                # Express entry; CORS, security headers, rate limiting
│   ├── routes/                  # auth.js, items.js, quotes.js
│   ├── middleware/              # googleAuth.js (token verify), rateLimit.js
│   ├── lib/zohoAuth.js          # Zoho OAuth token refresh
│   ├── scripts/                 # get-refresh-token.js + README (Zoho token regen)
│   └── .env.example             # env var template (real .env is gitignored)
│
├── estimator-shinemyspace/      # Frontend SOURCE (edit here)
│   ├── index.html               # entry (CSP + Google Sign-In)
│   ├── .htaccess                # prod headers (COOP for Sign-In) + blocks dev files
│   ├── sw.js                    # service worker (offline app shell)
│   ├── assets/js/calc/*.js      # app logic (see below)
│   ├── assets/data/items.json   # bundled item fallback (offline)
│   └── dev-server.js            # LOCAL dev server (adds COOP header) — not for prod
│
├── make-frontend-upload.sh      # regenerates the clean prod upload folder
└── estimator-shinemyspace upload/  # GENERATED (gitignored) — what you upload to Hostinger
```

---

## How it works

### Auth
- Google Identity Services provides an **ID token** in the browser.
- On first sign-in the frontend calls `POST /api/auth/verify`; the backend verifies the token
  **signature + audience** and checks the email against **`ALLOWED_EMAILS`** (server-side allowlist).
- A **7-day access marker** (localStorage, **no token**) then lets the app open offline. The short-lived
  Google token (~1 hr) is kept only to talk to the backend and is re-fetched on demand.

### Estimates → Zoho
- Items shown are **active + sellable only** (inactive / purchase-only items are filtered out).
- Picking an item **locks** the surface to its pricing type (sqft → Area, pcs/nos → Qty).
- On publish, surfaces are **aggregated into one line per item** (quantities summed); **deducts**
  are sent as negative quantities and **net out** of the matching item's line.
- Every estimate is created against a fixed **system contact** (`ZOHO_SYSTEM_CONTACT_ID`); the
  creator's email is recorded in the internal **salesperson** field.

### API endpoints
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Health check (also used by the frontend's server-status indicator) |
| POST | `/api/auth/verify` | Verify Google token + allowlist → `{ email, name }` |
| GET | `/api/items` | Active + sellable items. `?all=1` = all statuses (View items); `?fresh=1` = bypass 1h cache |
| POST | `/api/quotes` | Create a Zoho estimate (aggregates by item, deducts net out) |

All except `/health` require `Authorization: Bearer <google-id-token>`.

---

## Local development

**Backend** (`api-shinemyspace/`):
```bash
cp .env.example .env      # fill in real values
npm install
npm run dev               # http://localhost:3000/health
# For Postman without a Google token (local only):
DISABLE_AUTH=1 npm run dev
```

**Frontend** (`estimator-shinemyspace/`):
```bash
npm start                 # serves http://localhost:5500 with the COOP header Google needs
```
Open **http://localhost:5500** (use `localhost`, not `127.0.0.1` — Google Sign-In needs it).
`config.js` `API_URL` points at the Render backend; change it to `http://localhost:3000`
to develop against a local backend.

---

## Deployment

### Backend → Render (Web Service, free tier)
- **Root Directory:** `api-shinemyspace`
- **Build:** `npm install` · **Start:** `npm start`
- **Environment variables:** set everything from `.env.example` with production values —
  especially `NODE_ENV=production` and `CORS_ORIGIN=https://estimator.shinemyspace.com`
  (never set `DISABLE_AUTH`).
- Free tier **sleeps after ~15 min idle**; the first request cold-starts (~30–50 s). The app shows a
  🟡 "Waking…" indicator and pre-warms the server on load, so this is largely invisible in use.

### Frontend → Hostinger (manual upload)
```bash
./make-frontend-upload.sh                 # builds "estimator-shinemyspace upload/"
```
Upload the **contents** of that folder to the `estimator` subdomain's document root.
**Include the hidden `.htaccess`** — it sets the COOP header Google Sign-In needs in production
(without it, sign-in silently fails). Then set Render's `CORS_ORIGIN` to the live frontend origin.

---

## Security notes
- Secrets live only in `.env` (gitignored); the repo has none.
- Server verifies the Google token (signature + audience + allowlist) on every request — CORS is
  hygiene, not the security boundary.
- Frontend escapes all user input and ships a strict CSP (no inline scripts); `.htaccess` adds
  COOP/HSTS/nosniff/frame-deny and blocks dev files from being served.
- Zoho uses a **Self Client** with minimal scopes: `ZohoBooks.items.READ,ZohoBooks.estimates.CREATE`.
  To regenerate the refresh token, see `api-shinemyspace/scripts/README.md`.
