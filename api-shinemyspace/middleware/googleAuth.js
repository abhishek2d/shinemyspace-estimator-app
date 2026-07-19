/**
 * googleAuth.js — verifies the Google ID token on every protected request.
 *
 * The frontend sends the Google Sign-In ID token as `Authorization: Bearer
 * <token>`. We verify its signature against Google (never trust a browser
 * token unverified) and confirm the email is on the server-side allowlist.
 * On success `req.user = { email, name }` is available to the route.
 *
 *   Missing / malformed / invalid token  → 401
 *   Valid token but email not allowed     → 403
 *
 * Local testing: set DISABLE_AUTH=1 to bypass verification (never in prod).
 */

import { OAuth2Client } from 'google-auth-library';

// Lazily built on first use so process.env.GOOGLE_CLIENT_ID is read AFTER
// dotenv has loaded (ES-module imports run before dotenv.config()).
let googleClient = null;
function getGoogleClient() {
  if (!googleClient) googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  return googleClient;
}

export async function verifyGoogleToken(req, res, next) {
  // Local-only escape hatch so the Zoho routes can be smoke-tested without a
  // real Google token. Guarded so it can never be enabled in production.
  if (process.env.DISABLE_AUTH === '1' && process.env.NODE_ENV !== 'production') {
    req.user = { email: 'dev@localhost', name: 'Dev Bypass' };
    return next();
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.slice(7); // Remove "Bearer "

    const ticket = await getGoogleClient().verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = payload.email;

    const allowedEmails = (process.env.ALLOWED_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    if (!allowedEmails.includes(String(email).toLowerCase())) {
      return res.status(403).json({ error: 'Access denied: email not in allowed list' });
    }

    req.user = { email, name: payload.name || '' };
    next();
  } catch (error) {
    console.error('Token verification failed:', error.message);
    res.status(401).json({ error: 'Invalid token' });
  }
}
