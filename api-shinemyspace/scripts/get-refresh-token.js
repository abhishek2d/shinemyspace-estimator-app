/**
 * get-refresh-token.js — regenerate the Zoho Books refresh token (India DC).
 *
 * Run this only if the ZOHO_REFRESH_TOKEN in .env ever expires or is revoked.
 * It is self-contained: it reads ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET from the
 * backend's ../.env and exchanges a one-time grant code for a refresh token.
 *
 * Steps:
 *   1. https://api-console.zoho.in/  →  your Self Client  →  Generate Code
 *      Scope (minimal — this app only reads items and creates estimates):
 *             ZohoBooks.items.READ,ZohoBooks.estimates.CREATE
 *   2. Copy the grant code, then run:  node scripts/get-refresh-token.js <code>
 *   3. Paste the printed ZOHO_REFRESH_TOKEN into .env (local) AND Railway vars.
 */
import fs from 'fs';

const ZOHO_ACCOUNTS_URL = 'https://accounts.zoho.in';

// Read credentials from the backend's .env file (one level up from scripts/).
function loadEnv() {
  const envPath = new URL('../.env', import.meta.url);
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const env = {};
  envContent.split('\n').forEach((line) => {
    if (line.trim() && !line.startsWith('#')) {
      const [key, value] = line.split('=');
      env[key.trim()] = value.trim();
    }
  });
  return env;
}

async function getRefreshToken(grantCode) {
  const env = loadEnv();
  const clientId = env.ZOHO_CLIENT_ID;
  const clientSecret = env.ZOHO_CLIENT_SECRET;

  if (!clientId) throw new Error('ZOHO_CLIENT_ID not set in .env');
  if (!clientSecret) throw new Error('ZOHO_CLIENT_SECRET not set in .env');

  console.log('[Step 1] Exchanging grant code for refresh token...');

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code: grantCode,
  });

  const response = await fetch(`${ZOHO_ACCOUNTS_URL}/oauth/v2/token`, {
    method: 'POST',
    body: params,
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    console.error('❌ Error:', data.error_description || data.error || 'Unknown error');
    process.exit(1);
  }

  console.log('✅ Success!');
  console.log('\n📋 Copy the refresh token below and paste it into .env (and Railway):\n');
  console.log(`ZOHO_REFRESH_TOKEN=${data.refresh_token}\n`);
}

const grantCode = process.argv[2];
if (!grantCode) {
  console.error('Usage: node scripts/get-refresh-token.js <grant_code>');
  console.error('\nGrant code: generated in the Zoho API Console after creating a Self Client.');
  process.exit(1);
}

getRefreshToken(grantCode).catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
