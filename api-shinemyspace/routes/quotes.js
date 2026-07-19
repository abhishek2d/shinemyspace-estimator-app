/**
 * quotes.js — POST /api/quotes  ("Publish to Zoho Books")
 *
 * The frontend (ui.js publishToZoho) sends:
 *   { customerName, lineItems: [ { item_id?, name?, quantity, rate } ] }
 * with the Google token in the Authorization header. Every estimate is created
 * against the single predefined system contact (ZOHO_SYSTEM_CONTACT_ID); the
 * salesperson's email is logged for audit only.
 *
 * The Zoho estimate payload + success check (response.ok && data.code === 0)
 * mirror the tested POC script scripts/create-quote-custom.js.
 */

import express from 'express';
import { verifyGoogleToken } from '../middleware/googleAuth.js';
import { getAccessToken } from '../lib/zohoAuth.js';
import { getItemById } from './items.js';

const router = express.Router();

/**
 * Combine the surfaces the frontend sends into one estimate line per
 * (room, item): group by room + item_id (or name for ad-hoc) + rate and SUM the
 * (signed) quantities. So each room keeps its own lines, same-item surfaces
 * within a room merge (two walls 180+180 → 360), and deducts (NEGATIVE
 * quantities) net into the matching item's line in that room (wall 450 − door 21
 * − window 25 → 404) rather than becoming separate rows. Different rates for the
 * same item stay separate (merging would misprice). Lines that net to
 * zero-or-less (fully deducted) are dropped.
 */
export function aggregateLineItems(lineItems) {
  const SEP = ''; // key delimiter that can't appear in a room/item name
  const groups = new Map();
  for (const li of lineItems) {
    const id = li.item_id || null;
    const name = (li.name || '').trim() || 'Item';
    const room = (li.room || '').trim();
    const rate = Number(li.rate) || 0;
    const qty = Number(li.quantity) || 0; // signed; negative for deducts
    const key = `${room}${SEP}${id ? 'id:' + id : 'adhoc:' + name.toLowerCase()}${SEP}${rate}`;
    let g = groups.get(key);
    if (!g) {
      g = { item_id: id, name, room, rate, quantity: 0 };
      groups.set(key, g);
    }
    g.quantity += qty;
  }
  return [...groups.values()]
    .map((g) => ({ ...g, quantity: Math.round(g.quantity * 100) / 100 }))
    .filter((g) => g.quantity > 0);
}

/**
 * Build a Zoho line description: the room name, a blank line, then the item's
 * own process text from the Zoho master (re-added because supplying a
 * description replaces the master's default on the line). No per-surface
 * dimension breakdown — the Qty column already carries the quantity. Any
 * missing piece is simply omitted.
 */
export function buildDescription(group, masterDesc) {
  const parts = [];
  if (group.room) parts.push(group.room);
  const master = (masterDesc || '').trim();
  if (master) parts.push(master);
  return parts.join('\n\n'); // blank line between the room name and the process text
}

router.post('/', verifyGoogleToken, async (req, res) => {
  try {
    const { lineItems } = req.body || {};
    const { email } = req.user;

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return res.status(400).json({ error: 'No line items provided' });
    }

    const CONTACT_ID = process.env.ZOHO_SYSTEM_CONTACT_ID;
    if (!CONTACT_ID) {
      return res.status(500).json({ error: 'Server misconfigured: ZOHO_SYSTEM_CONTACT_ID not set' });
    }

    const ORG_ID = process.env.ZOHO_ORG_ID;
    const API_URL = process.env.ZOHO_API_URL || 'https://www.zohoapis.in/books/v3';
    const BOOKS_URL = process.env.ZOHO_BOOKS_URL || 'https://books.zoho.in';
    // Blank by default → no reference number. Set ESTIMATE_REF_PREFIX (e.g. EST)
    // to enable a "PREFIX-<timestamp>" reference.
    const REF_PREFIX = process.env.ESTIMATE_REF_PREFIX || '';

    // Combine surfaces into one line per item (summed quantities; deducts net out).
    const merged = aggregateLineItems(lineItems);

    if (merged.length === 0) {
      return res.status(400).json({ error: 'Nothing to publish after applying deductions.' });
    }

    console.log(`[Quotes] Creating estimate for ${email} (${lineItems.length} surfaces → ${merged.length} items)...`);

    const accessToken = await getAccessToken();

    const estimateData = {
      customer_id: CONTACT_ID,
      estimate_date: new Date().toISOString().split('T')[0],
      // Who created the quote — internal salesperson field (not the notes, which
      // print on the customer's copy). Uses the unique email (no Zoho lookup).
      salesperson_name: email,
      // One line per (room, item). Description = room + dimension breakdown +
      // the item's master process text (looked up from the items cache, since
      // supplying a description replaces Zoho's default).
      line_items: await Promise.all(
        merged.map(async (item) => {
          const line = {
            name: item.name,
            quantity: item.quantity,
            rate: item.rate,
            unit: 'sqft', // Zoho overrides this from the item master for item_id lines
          };
          let masterDesc = '';
          // Only attach item_id when an item was picked; otherwise Zoho treats
          // the line as an ad-hoc entry keyed by name.
          if (item.item_id) {
            line.item_id = item.item_id;
            const master = await getItemById(item.item_id);
            masterDesc = master?.description || '';
          }
          const description = buildDescription(item, masterDesc);
          if (description) line.description = description;
          return line;
        })
      ),
    };

    // Optional reference number — blank by default; set ESTIMATE_REF_PREFIX to enable.
    if (REF_PREFIX) estimateData.reference_number = `${REF_PREFIX}-${Date.now()}`;

    const response = await fetch(`${API_URL}/estimates?organization_id=${ORG_ID}`, {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(estimateData),
    });

    const data = await response.json();

    if (!response.ok || data.code !== 0) {
      throw new Error(`Zoho API error: ${data.message || 'Failed to create estimate'}`);
    }

    const estimateId = data.estimate.estimate_id;
    console.log(`[Quotes] Created estimate ${estimateId} by ${email} at ${new Date().toISOString()}`);

    res.json({
      success: true,
      estimate_id: estimateId,
      zoho_url: `${BOOKS_URL}/app/estimates/${estimateId}`,
      total: data.estimate.total,
    });
  } catch (error) {
    console.error('Error creating quote:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
