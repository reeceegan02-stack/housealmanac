// Estate-agency pricing (Reece, 9 Nov 2026): always paid up front, £75 a print; after an agency's first paid
// order we email them code AGENCY10 (£10 off, only valid on the £75 agent product), so it's £65 from then on.
import { kvGet, kvSet, logEvent, getOrder } from './util.js';
import { stripePost } from './stripe.js';
import { AGENT_UNFRAMED, AGENT_UNFRAMED_PENCE, AGENT_PRICES, SAMPLE_FRAME_UPGRADE_PENCE, sampleIsUnframed } from './pricing.js';
export { AGENT_UNFRAMED, AGENT_UNFRAMED_PENCE, AGENT_PRICES };
import { sendMail } from './mail.js';

export const AGENCY_CODE = 'AGENCY10';
const domainOf = (email) => String(email || '').toLowerCase().split('@')[1] || '';

// Has this agency (by email domain) already paid for an order?
export async function isReturningAgency(env, email) {
  const d = domainOf(email);
  if (!d || /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|aol|btinternet)\./.test(d)) return false;
  const r = await env.DB.prepare(`SELECT 1 FROM orders WHERE amount_pence > 0 AND status != 'cancelled' AND source != 'agent-sample' AND lower(substr(email, instr(email, '@') + 1)) = ? LIMIT 1`).bind(d).first();
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

// ---------- Unframed option for agents (Reece, 20 Nov 2026: £39, same ~£23 profit as framed at £75) ----------
// Off until Stripe can create checkouts for us (restricted key: Checkout Sessions Write) and unframed packaging is sorted.
const CONSUMER_UNFRAMED_LINK = 'https://buy.stripe.com/00waEZ1wlblC5Fm3KH2wU01';

// Emails carry this stable link; clicking it creates a fresh Stripe Checkout (sessions expire, emails don't).
export function unframedPayLink(env, orderId) { return `${env.PUBLIC_BASE}/pay/${orderId}/unframed`; }

function page(title, msg, status = 200) {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — House Almanac</title><body style="margin:0;background:#f6f1e7;color:#2a241e;font:17px/1.6 system-ui,sans-serif"><main style="max-width:560px;margin:0 auto;padding:60px 20px"><p style="font:700 20px Georgia,serif">House Almanac</p><h1 style="font:700 30px Georgia,serif">${title}</h1><p>${msg}</p></main>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function payUnframed(env, id) {
  const o = await getOrder(env, id);
  const unpaid = o && (!o.external_ref || String(o.external_ref).startsWith('preview-'));
  const ok = unpaid && o.file_key && ['agent-proof', 'agent-preview'].includes(o.source) && ['proof_sent', 'awaiting_payment', 'needs_attention'].includes(o.status);
  if (!ok) return page('This link has expired', 'This print has already been paid for, or the link is no longer valid. Email <a href="mailto:hello@housealmanac.co.uk">hello@housealmanac.co.uk</a> and we\'ll sort it straight away.', 410);
  const ship = JSON.parse(o.ship_json || '{}');
  const email = ship.agent_email || o.email || '';
  const street = String(o.address || '').split(',').slice(0, 2).join(',').trim();
  try {
    const params = {
      mode: 'payment', 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'gbp',
      'line_items[0][price_data][unit_amount]': String(AGENT_UNFRAMED_PENCE),
      'line_items[0][price_data][product_data][name]': `House Almanac A3 print, unframed (${o.id})`,
      client_reference_id: o.id, 'metadata[product]': 'unframed', 'metadata[order]': o.id,
      'shipping_address_collection[allowed_countries][0]': 'GB',
      success_url: 'https://housealmanac.co.uk/thanks?p=agent&sid={CHECKOUT_SESSION_ID}', cancel_url: 'https://housealmanac.co.uk/agents',
    };
    if (street) params['line_items[0][price_data][product_data][description]'] = street.slice(0, 200);
    if (email) params.customer_email = email;
    const sess = await stripePost(env, '/checkout/sessions', params);
    await logEvent(env, o.id, 'unframed_checkout', { session: sess.id });
    return Response.redirect(sess.url, 303);
  } catch (e) {
    // Fallback: the public £39 link (asks for an address and style again, but payment still prints this proof unframed).
    await logEvent(env, o.id, 'unframed_checkout_error', { error: String(e.message).replace(/[rs]k_\w+/g, '[key]').slice(0, 200) });
    const u = new URL(CONSUMER_UNFRAMED_LINK);
    u.searchParams.set('client_reference_id', o.id);
    if (email) u.searchParams.set('prefilled_email', email);
    return Response.redirect(u.toString(), 303);
  }
}


// Office sample framed for £30 (we cover the rest). Stable link in emails → fresh Stripe Checkout. If the free samples
// have run out it falls back to the normal £75 agent link.
export function frameUpgradeLink(env, orderId) { return `${env.PUBLIC_BASE}/pay/${orderId}/framed`; }

export async function payFramedSample(env, id) {
  const o = await getOrder(env, id);
  const unpaid = o && (!o.external_ref || String(o.external_ref).startsWith('preview-'));
  const ok = unpaid && o.file_key && o.source === 'agent-preview' && ['proof_sent', 'awaiting_payment', 'needs_attention'].includes(o.status);
  if (!ok) return page('This link has expired', 'This print has already been sent or paid for, or the link is no longer valid. Email <a href="mailto:hello@housealmanac.co.uk">hello@housealmanac.co.uk</a> and we\'ll sort it straight away.', 410);
  const ship = JSON.parse(o.ship_json || '{}');
  const email = ship.agent_email || o.email || '';
  const { samplesStatus } = await import('./outreach.js');
  const left = (await samplesStatus(env)).left;
  if (!sampleIsUnframed(o) || left <= 0) return Response.redirect(await agentPayLink(env, o.id, email), 303);
  const street = String(o.address || '').split(',').slice(0, 2).join(',').trim();
  try {
    const params = {
      mode: 'payment', 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'gbp',
      'line_items[0][price_data][unit_amount]': String(SAMPLE_FRAME_UPGRADE_PENCE),
      'line_items[0][price_data][product_data][name]': `Framing for your House Almanac office print (${o.id})`,
      client_reference_id: o.id, 'metadata[product]': 'framed', 'metadata[kind]': 'sample_upgrade', 'metadata[order]': o.id,
      'shipping_address_collection[allowed_countries][0]': 'GB',
      success_url: 'https://housealmanac.co.uk/thanks?p=agent&sid={CHECKOUT_SESSION_ID}', cancel_url: 'https://housealmanac.co.uk/agents',
    };
    if (street) params['line_items[0][price_data][product_data][description]'] = `${street}: framed in black, ready to hang`.slice(0, 200);
    if (email) params.customer_email = email;
    const sess = await stripePost(env, '/checkout/sessions', params);
    await logEvent(env, o.id, 'sample_upgrade_checkout', { session: sess.id });
    return Response.redirect(sess.url, 303);
  } catch (e) {
    await logEvent(env, o.id, 'sample_upgrade_checkout_error', { error: String(e.message).replace(/[rs]k_\w+/g, '[key]').slice(0, 200) });
    return page('Sorry, that didn\'t work', 'We couldn\'t open the payment page just now. Reply to our email or write to <a href="mailto:hello@housealmanac.co.uk">hello@housealmanac.co.uk</a> and we\'ll send you a link.', 503);
  }
}
