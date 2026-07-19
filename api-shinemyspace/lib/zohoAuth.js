/**
 * zohoAuth.js — Zoho Books OAuth token management (India data center).
 *
 * Ported from the POC (`test zoho books items/lib/zohoAuth.js`). The POC read
 * credentials from a `.env` file on disk via fs.readFileSync, which crashes on
 * Railway (no .env file — vars are injected into the environment). Here we read
 * straight from process.env: dotenv loads .env locally, Railway supplies the
 * vars in production. getAccessToken() is unchanged (refresh-token flow, cached
 * until ~5 min before expiry).
 */

let cachedAccessToken = null;
let tokenExpiresAt = null;

export async function getAccessToken() {
  // Read credentials at call time (not module-load time): with ES modules the
  // imports are hoisted and run before dotenv.config(), so reading these into
  // top-level consts would capture `undefined` and cause `invalid_client`.
  const ZOHO_ACCOUNTS_URL = process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in';
  const CLIENT_ID = process.env.ZOHO_CLIENT_ID;
  const CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
  const REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;

  // Check if cached token is still valid (expires in 1 hour, refresh at 55 min)
  if (cachedAccessToken && tokenExpiresAt > Date.now() + 5 * 60 * 1000) {
    console.log('[Auth] Using cached access token');
    return cachedAccessToken;
  }

  console.log('[Auth] Fetching new access token...');

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
  });

  const response = await fetch(`${ZOHO_ACCOUNTS_URL}/oauth/v2/token`, {
    method: 'POST',
    body: params,
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    console.error('[Auth] Response:', JSON.stringify(data, null, 2));
    throw new Error(`Failed to get access token: ${data.error || data.error_description || JSON.stringify(data)}`);
  }

  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;

  console.log(`[Auth] Token obtained, expires in ${data.expires_in}s`);
  return cachedAccessToken;
}
