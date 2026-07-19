/**
 * items.js — GET /api/items
 *
 * Returns the full Zoho Books item catalogue with current pricing. Items are
 * cached in memory for 1 hour so we don't hit Zoho on every request. The
 * pagination loop is lifted from the tested POC script (scripts/get-items.js):
 * 200 per page, follow page_context.has_more_page, success when data.code === 0.
 *
 * The frontend (items.js loadItems) only needs { item_id, name, rate, unit }
 * but we return the full Zoho item objects so future UI can use more fields.
 */

import express from 'express';
import { verifyGoogleToken } from '../middleware/googleAuth.js';
import { getAccessToken } from '../lib/zohoAuth.js';

const router = express.Router();

let itemsCache = null;
let cacheTime = null;
// How long the item list is cached in memory before re-pulling from Zoho.
const CACHE_MINUTES = Number(process.env.ITEMS_CACHE_MINUTES) || 60;
const CACHE_DURATION = CACHE_MINUTES * 60 * 1000;

async function fetchItemsFromZoho(force = false) {
  if (!force && itemsCache && cacheTime && Date.now() - cacheTime < CACHE_DURATION) {
    console.log('[Items] Using cached items');
    return itemsCache;
  }
  if (force) console.log('[Items] Force refresh — bypassing cache');

  console.log('[Items] Fetching fresh items from Zoho...');

  const accessToken = await getAccessToken();
  const ORG_ID = process.env.ZOHO_ORG_ID;
  const API_URL = process.env.ZOHO_API_URL || 'https://www.zohoapis.in/books/v3';

  const items = [];
  let page = 1;
  const perPage = 200;
  let hasMore = true;

  while (hasMore) {
    const url = new URL(`${API_URL}/items`);
    url.searchParams.append('organization_id', ORG_ID);
    url.searchParams.append('page', page);
    url.searchParams.append('per_page', perPage);
    // Fetch ALL statuses (incl. inactive) so the "View items" screen can show
    // and explain them; the picker filtering happens per-request below.
    url.searchParams.append('filter_by', 'Status.All');

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });

    const data = await response.json();

    if (!response.ok || data.code !== 0) {
      throw new Error(`Zoho API error: ${data.message || 'Failed to fetch items'}`);
    }

    if (!data.items || data.items.length === 0) break;

    items.push(...data.items);
    hasMore = data.page_context?.has_more_page ?? false;
    page += 1;
  }

  itemsCache = items;
  cacheTime = Date.now();
  console.log(`[Items] Cached ${items.length} items (all statuses)`);

  return items;
}

/**
 * Quotable = can go on a sales estimate: active AND sellable. Purchase-only
 * items (can_be_sold === false) and inactive items are excluded from the picker.
 */
function isQuotable(it) {
  return (it.status || 'active') === 'active' && it.can_be_sold === true;
}

/**
 * Look up one Zoho item (the full object, incl. its `description` / process
 * text) by id, using the shared in-memory cache and fetching once if it's cold.
 * Used by the quotes route to enrich each estimate line. Returns null if the
 * item can't be found or Zoho is unreachable.
 */
export async function getItemById(itemId) {
  if (!itemId) return null;
  try {
    const all = await fetchItemsFromZoho(false);
    return all.find((it) => String(it.item_id) === String(itemId)) || null;
  } catch (err) {
    console.warn('[Items] getItemById lookup failed:', err.message);
    return null;
  }
}

router.get('/', verifyGoogleToken, async (req, res) => {
  try {
    // ?fresh=1 forces a re-pull from Zoho (used by the "Refresh items" action
    // so a just-added Zoho item shows up immediately, not after the 1h cache).
    const force = req.query.fresh === '1' || req.query.refresh === 'true';
    // ?all=1 returns every item (incl. inactive / purchase-only) for the
    // "View items" reference screen; default returns only quotable items.
    const includeAll = req.query.all === '1';

    const all = await fetchItemsFromZoho(force);
    const items = includeAll ? all : all.filter(isQuotable);
    res.json({ items, total: items.length, cached_at: new Date(cacheTime).toISOString() });
  } catch (error) {
    console.error('Error fetching items:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
