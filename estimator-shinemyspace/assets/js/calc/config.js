/**
 * config.js — the one file you edit to change settings.
 *
 * Everything a non-developer might need to tweak lives here:
 * the backend address, how long sign-in lasts offline, the company
 * details printed on quotes, and a couple of internal keys to ignore.
 */

/* ------------------------------------------------------------------ *
 *  GOOGLE OAUTH
 *  The Google Client ID is set once in index.html (the
 *  data-client_id="..." attribute), because that's where Google's
 *  Sign-In button reads it from. Get it from the Google Console:
 *  create a Web application credential and add your site as an
 *  Authorized JavaScript Origin.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 *  BACKEND API
 *  Where the server lives (the Render service). Used to verify a Google
 *  sign-in the first time (which team members are allowed is decided on
 *  the SERVER, not here).
 *  For local backend development, change this to "http://localhost:3000".
 * ------------------------------------------------------------------ */
export const API_URL = "https://api-shinemyspace.onrender.com";

/* ------------------------------------------------------------------ *
 *  STAY SIGNED IN (offline)
 *  After a successful sign-in, the app keeps working WITHOUT internet
 *  or re-login for this many days. Basic calculator/print/save features
 *  work fully offline in this window; live pricing / publishing still
 *  need internet AND a fresh Google token (fetched on demand, not stored).
 * ------------------------------------------------------------------ */
export const ACCESS_MAX_AGE_DAYS = 7;

/* ------------------------------------------------------------------ *
 *  COMPANY DETAILS  (shown on the printed quotation)
 *  Edit any line below to update what appears on the printout.
 * ------------------------------------------------------------------ */
export const COMPANY = {
  name: "ShineMySpace",
  logo: "assets/images/shine-my-space-logo.png",
  addressLines: [
    "25, KC Dey Rd, Ward 10, Mahananda Para,",
    "West Bengal, Siliguri, India, 734001",
  ],
  phone: "98001 80999 / 98006 78999",
  email: "info@shinemyspace.com",
  website: "shinemyspace.com",
};

/* ------------------------------------------------------------------ *
 *  INTERNAL — you normally don't need to touch these.
 * ------------------------------------------------------------------ */

// Where the current estimate is saved in the browser. Bump SCHEMA_VERSION
// only if the saved data shape changes (old saved data is then ignored).
export const STORAGE_KEY = "sms_calc_state";
export const SCHEMA_VERSION = 2;

// Where saved customer estimates ("Save on this phone") are kept.
export const LIBRARY_KEY = "sms_calc_library";

// App-access marker: { email, name, unlockedAt } kept so the app opens
// offline for ACCESS_MAX_AGE_DAYS without re-login. Deliberately holds NO
// Google token — the token is short-lived (~1hr) and fetched on demand only
// when talking to the backend (items / publish), never persisted to disk.
export const ACCESS_KEY = "sms_calc_access";

// Legacy key from the old design (stored the token for 7 days). Removed on
// boot so no stale token lingers in storage.
export const LEGACY_SESSION_KEY = "sms_calc_session";

// Locally cached copy of the last live item catalogue fetched from the
// backend, so the picker has fresh prices offline (falls back to the bundled
// snapshot if absent). Shape: { items:[...], fetchedAt }.
export const ITEMS_CACHE_KEY = "sms_calc_items";

// Where the short-lived Google token is kept (localStorage — survives page
// refreshes and closing/reopening the tab or browser). Used only to talk to
// the backend; treated as expired after ~1hr regardless, then re-fetched.
export const TOKEN_KEY = "sms_calc_token";

// Currency formatting (Indian Rupee, Indian digit grouping).
export const CURRENCY = "en-IN";
