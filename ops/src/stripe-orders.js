// Turning paid Stripe Checkout Sessions into orders: used by the webhook and by the
// 30-minute reconciliation, so a missed or failed webhook never loses a paid order.
import { stripeGet, sessionToOrder } from './stripe.js';
import { createOrder } from './orders.js';
import { sendMail, orderReceivedEmail } from './mail.js';
import { logEvent, BRAND } from './util.js';

export async function ingestStripeSession(env, sessionId) {
  const s = await stripeGet(env, `/checkout/sessions/${sessionId}`);
  if (s.payment_status !== 'paid') return { skipped: 'not paid' };
  const fields = sessionToOrder(s);
  const order = await createOrder(env, { source: 'stripe', ...fields });
  if (fields.email && order.isNew) {
    const t = orderReceivedEmail({ ...fields, id: order.id });
    await sendMail(env, { to: fields.email, subject: t.subject, text: t.text, orderId: order.id });
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
