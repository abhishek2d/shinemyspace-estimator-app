# Backend scripts

## Regenerate the Zoho refresh token

Only needed if `ZOHO_REFRESH_TOKEN` in `.env` (and Railway) ever expires or is
revoked. The current token does **not** expire on a fixed schedule, so this is
rare — but keep this the safety net.

1. Go to **https://api-console.zoho.in/** → your **Self Client** → **Generate Code**.
2. Scope (minimal — this app only reads items and creates estimates): `ZohoBooks.items.READ,ZohoBooks.estimates.CREATE`
3. Pick a short validity (e.g. 10 min), generate, and copy the **grant code**.
4. From the `api-shinemyspace/` folder, run:

   ```bash
   node scripts/get-refresh-token.js <grant_code>
   ```

5. Paste the printed `ZOHO_REFRESH_TOKEN=...` into:
   - `.env` (local), and
   - Railway → your service → **Variables**.

Requires `ZOHO_CLIENT_ID` and `ZOHO_CLIENT_SECRET` already present in `.env`
(India data center: `accounts.zoho.in`).
