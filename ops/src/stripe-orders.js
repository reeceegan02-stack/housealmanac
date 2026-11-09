// Turning paid Stripe Checkout Sessions into orders: used by the webhook and by the
// 30-minute reconciliation, so a missed or failed webhook never loses a paid order.
import { stripeGet, sessionToOrder } from './stripe.js';
import { createOrder } from './orders.js';
import { sendMail, orderReceivedEmail } from './mail.js';
import { logEvent, BRAND, getOrder, updateOrder, fileUrl } from './util.js';
import { createPrintOrder } from './prodigi.js';
import { approvedEmail } from './mail.js';
import { maybeSendAgencyCode } from './agents.js';

export async function ingestStripeSession(env, sessionId) {
  const s = await stripeGet(env, `/checkout/sessions/${sessionId}`);
  if (s.payment_status !== 'paid') return { skipped: 'not paid' };
  // Agent paying for a proof we already made (link carries ?client_reference_id=HA-XXXXXX).
  if (s.client_reference_id) {
    const o = await getOrder(env, s.client_reference_id);
    if (o && !o.external_ref && o.file_key && ['awaiting_payment', 'proof_sent', 'needs_attention'].includes(o.status)) return payForProof(env, o, s);
  }
  const fields = sessionToOrder(s);
  const order = await createOrder(env, { source: 'stripe', ...fields });
  if (fields.email && order.isNew) {
    const t = orderReceivedEmail({ ...fields, id: order.id });
    await sendMail(env, { to: fields.email, subject: t.subject, text: t.text, orderId: order.id });
    await maybeSendAgencyCode(env, fields.email, order.id);
  }
  return { order: order.id, isNew: order.isNew };
}

// Paid sessions from the last 3 days that have no order yet (older than 10 minutes, to leave
// the webhook time to do it first).
export async function reconcileStripe(env) {
  if (!env.STRIPE_SECRET_KEY) return { skipped: 'no key' };
  const nowS = Math.floor(Date.now() / 1000);
  const q = new URLSearchParams({ 'created[gte]': String(nowS - 3 * 86400), 'created[lte]': String(nowS - 600), status: 'complete', limit: '100' });
  const list = await stripeGet(env, `/checkout/sessions?${q}`);
  const missed = [];
  for (const s of list.data || []) {
    if (s.payment_status !== 'paid') continue;
    const exists = await env.DB.prepare('SELECT id FROM orders WHERE external_ref = ?').bind(s.id).first();
    if (exists) continue;
    const r = await ingestStripeSession(env, s.id);
    missed.push(r.order);
    await logEvent(env, r.order, 'stripe_reconciled', { session: s.id });
  }
  if (missed.length) {
    await sendMail(env, {
      to: BRAND.from, bcc: false,
      subject: `Check the Stripe webhook: ${missed.length} paid order(s) picked up by the backup check`,
      text: `These paid orders didn't arrive through the Stripe webhook, so the 30-minute check created them instead: ${missed.join(', ')}.\n\nThey are being processed normally. If this keeps happening, check Stripe → Developers → Webhooks for delivery errors.`,
    });
  }
  return { missed };
}

async function payForProof(env, o, s) {
  const paidSource = o.source === 'partner-proof' ? 'partner-paid' : 'agent-paid';
  const ship = JSON.parse(o.ship_json || '{}');
  const sd = s.collected_information?.shipping_details || s.shipping_details;
  const a = sd?.address;
  const newShip = a?.postal_code ? { ...ship, name: sd.name || ship.name, line1: a.line1, line2: a.line2, city: a.city, county: a.state, postcode: a.postal_code } : ship;
  await updateOrder(env, o.id, { external_ref: s.id, amount_pence: s.amount_total || 0, source: paidSource, status: 'approved', ship_json: JSON.stringify(newShip) });
  const order = { ...o, ship_json: JSON.stringify(newShip), source: paidSource };
  try {
    const po = await createPrintOrder(env, order, fileUrl(env, o.file_key));
    await updateOrder(env, o.id, { status: 'printing', prodigi_id: po.id });
    await logEvent(env, o.id, 'prodigi_order', { id: po.id, paid: s.amount_total });
    const t = approvedEmail(order);
    await sendMail(env, { to: ship.agent_email || o.email, subject: t.subject, text: t.text, orderId: o.id });
    await maybeSendAgencyCode(env, ship.agent_email || o.email, o.id);
  } catch (e) {
    await updateOrder(env, o.id, { status: 'needs_attention', notes: 'Prodigi order failed after payment: ' + e.message });
    await sendMail(env, { to: BRAND.from, bcc: false, subject: `ACTION NEEDED: paid agent order ${o.id} didn't reach Prodigi`, text: e.message });
  }
  return { order: o.id, isNew: false, paidProof: true };
}
