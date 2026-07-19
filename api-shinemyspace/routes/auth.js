/**
 * auth.js — POST /api/auth/verify
 *
 * Called by the frontend on first sign-in (auth.js verifyAndStartSession).
 * The verifyGoogleToken middleware does all the work: it returns 401 for a
 * bad/missing token and 403 for an email that isn't allowed. If we reach the
 * handler the token is valid and allowed, so we just echo back the identity
 * the frontend stores for its 7-day offline session.
 */

import express from 'express';
import { verifyGoogleToken } from '../middleware/googleAuth.js';

const router = express.Router();

router.post('/verify', verifyGoogleToken, (req, res) => {
  res.json(req.user); // { email, name }
});

export default router;
