// Estate-agency pricing (Reece, 9 Nov 2026): always paid up front, £75 a print; after an agency's first paid
// order we email them code AGENCY10 (£10 off, only valid on the £75 agent product), so it's £65 from then on.
import { kvGet, kvSet, logEvent } from './util.js';
import { sendMail } from './mail.js';

export const AGENCY_CODE = 'AGENCY10';
const domainOf = (email) => String(email || '').toLowerCase().split('@')[1] || '';

// Has this agency (by email domain) already paid for an order?
export async function isReturningAgency(env, email) {
  const d = domainOf(email);
  if (!d || /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|aol|btinternet)\./.test(d)) return false;
  const r = await env.DB.prepare(`SELECT 1 FROM orders WHERE amount_pence > 0 AND status != 'cancelled' AND lower(substr(email, instr(email, '@') + 1)) = ? LIMIT 1`).bind(d).first();
  return !!r;
}

// The £75 agent payment link, with the £10 code already applied for returning agencies.
export async function agentPayLink(env, orderId, email) {
  const u = new URL(env.AGENT_LINK);
  if (orderId) u.searchParams.set('client_reference_id', orderId);
  if (email) u.searchParams.set('prefilled_email', email);
  if (await isReturningAgency(env, email)) u.searchParams.set('prefilled_promo_code', AGENCY_CODE);
  return u.toString();
}

// After an agency's first paid order: email them the code, once per agency.
export async function maybeSendAgencyCode(env, email, orderId) {
  const d = domainOf(email);
  if (!d || /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|aol|btinternet)\./.test(d)) return;
  const isAgency = await env.DB.prepare('SELECT 1 FROM prospects WHERE domain = ? LIMIT 1').bind(d).first();
  if (!isAgency || await kvGet(env, 'agency_code_' + d)) return;
  await kvSet(env, 'agency_code_' + d, new Date().toISOString());
  await sendMail(env, {
    to: email, orderId, fromName: 'Reece Egan-Sheath | House Almanac',
    subject: 'Thank you for your first order: £10 off every print from now on',
    text: `Hi,

Thank you for your first order with House Almanac. From now on every framed print for your buyers is £65 instead of £75: use code ${AGENCY_CODE} at checkout (we'll also apply it for you on any payment link we send).

To order, just email the buyer's new address and your message to hello@housealmanac.co.uk. We'll send a free proof first, and you pay when you approve it.

Best wishes,
Reece
House Almanac · hello@housealmanac.co.uk`,
  });
  await logEvent(env, orderId, 'agency_code_sent', { domain: d });
}
