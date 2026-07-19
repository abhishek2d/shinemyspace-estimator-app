/**
 * server.js — Express entry point for the ShineMySpace estimator backend.
 *
 * Mounts the three routes the frontend uses (auth verify, items, quotes) plus
 * a /health check. CORS is locked to the estimator origin in production and
 * left open in development. dotenv loads .env locally; Railway injects vars.
 */

// Load .env FIRST — before any import that might read process.env at load time.
import 'dotenv/config';

import express from 'express';
import cors from 'cors';

import authRouter from './routes/auth.js';
import itemsRouter from './routes/items.js';
import quotesRouter from './routes/quotes.js';
import { rateLimit } from './middleware/rateLimit.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Behind Railway's proxy, use the forwarded client IP (so rate limiting keys on
// the real caller, not the proxy). Trust exactly one proxy hop.
app.set('trust proxy', 1);

// Baseline security response headers (cheap; belt-and-suspenders for a JSON API).
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

// In production the browser origin is locked to the frontend site (CORS_ORIGIN);
// in development it's open so localhost testing works.
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://estimator.shinemyspace.com';
app.use(
  cors({
    origin: process.env.NODE_ENV === 'production' ? CORS_ORIGIN : '*',
    credentials: true,
  })
);
app.use(express.json());

// Rate limiting: a general cap across the API, plus a tighter cap on the two
// endpoints that do real work (creating estimates / verifying sign-ins).
app.use('/api', rateLimit({ windowMs: 60_000, max: 120 }));

// Routes
app.use('/api/auth', rateLimit({ windowMs: 60_000, max: 30 }), authRouter);
app.use('/api/items', itemsRouter);
app.use('/api/quotes', rateLimit({ windowMs: 60_000, max: 20 }), quotesRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});
