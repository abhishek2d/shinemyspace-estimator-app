/**
 * rateLimit.js — tiny in-memory fixed-window rate limiter (no dependencies).
 *
 * Caps how many requests one client (by IP) may make per window. Enough for a
 * single-instance Railway deployment. If you ever scale to multiple instances,
 * swap this for a shared store (Redis) — in-memory counts are per-process.
 *
 * Returns 429 with a Retry-After header when the limit is exceeded.
 */

export function rateLimit({ windowMs = 60_000, max = 60, message = 'Too many requests, please slow down.' } = {}) {
  const hits = new Map(); // ip -> { count, resetAt }

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const key = req.ip;

    let rec = hits.get(key);
    if (!rec || now > rec.resetAt) {
      rec = { count: 0, resetAt: now + windowMs };
      hits.set(key, rec);
    }
    rec.count += 1;

    // Opportunistic cleanup so the Map doesn't grow unbounded with stale IPs.
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
    }

    if (rec.count > max) {
      res.set('Retry-After', String(Math.ceil((rec.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}
