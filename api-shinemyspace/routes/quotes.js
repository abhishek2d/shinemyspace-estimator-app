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

const router = express.Router();

/**
 * Combine the surfaces the frontend sends into one estimate line per item:
 * group by item_id (or by name for ad-hoc lines) and SUM the (signed)
 * quantities — every wall priced with item123 becomes one line whose quantity
 * is the total sqft/qty. Deducts arrive as NEGATIVE quantities, so they subtract
 * from the matching item's line (not a separate entry). Different rates for the
 * same item stay separate (merging would misprice), so the key includes rate.
 * Lines that net to zero-or-less (fully deducted) are dropped.
 */
function aggregateLineItems(lineItems) {
  const groups = new Map();
  for (const li of lineItems) {
    const id = li.item_id || null;
    const name = (li.name || '').trim() || 'Item';
    const rate = Number(li.rate) || 0;
    const qty = Number(li.quantity) || 0; // may be negative for deducts
    const key = `${id ? 'id:' + id : 'adhoc:' + name.toLowerCase()}|${rate}`;
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += qty;
    } else {
      groups.set(key, { item_id: id, name, rate, quantity: qty });
    }
  }
  // Round summed quantities to 2 dp (areas can be fractional) and drop any line
  // whose deductions cancelled it out (net quantity <= 0).
  return [...groups.values()]
    .map((g) => ({ ...g, quantity: Math.round(g.quantity * 100) / 100 }))
    .filter((g) => g.quantity > 0);
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
      line_items: merged.map((item) => {
        const line = {
          name: item.name,
          quantity: item.quantity,
          rate: item.rate,
          unit: 'sqft', // Zoho overrides this from the item master for item_id lines
        };
        // Only attach item_id when an item was picked; otherwise Zoho treats
        // the line as an ad-hoc entry keyed by name.
        if (item.item_id) line.item_id = item.item_id;
        return line;
      }),
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
