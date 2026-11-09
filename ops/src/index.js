// House Almanac operations worker: Stripe orders -> research -> proof -> Prodigi, plus inbox and schedules.
import { OrderWorkflow } from './workflow.js';
import { ingestStripeSession, reconcileStripe } from './stripe-orders.js';
import { systemsCheck } from './check.js';
import { OutreachWorkflow, startDailyOutreach, findProspects, samplesStatus, startPreview } from './outreach.js';
import { ensureSchema, json, getOrder, logEvent, updateOrder, now, fileUrl } from './util.js';
import { verifyStripe, stripeGet, sessionToOrder } from './stripe.js';
import { createOrder, startOrderWorkflow } from './orders.js';
import { handleInbound } from './inbox.js';
import { runScheduled, weeklySummary } from './cron.js';
import { sendMail, orderReceivedEmail, approvedEmail } from './mail.js';
import { createPrintOrder } from './prodigi.js';
import { etsyConnect, etsyCallback, pollEtsy } from './etsy.js';

export { OrderWorkflow, OutreachWorkflow };

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p === '/' || p === '/health') {
        const keys = Object.fromEntries(['ANTHROPIC_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'PRODIGI_API_KEY', 'ETSY_KEYSTRING'].map((k) => [k, !!env[k]]));
        return json({ ok: true, service: 'housealmanac-ops', time: now(), keys });
      }

      // Public print/proof files (unguessable keys) for Prodigi and email links.
      if (p.startsWith('/f/')) {
        const key = decodeURIComponent(p.slice(3));
        const obj = await env.FILES.getWithMetadata(key, 'arrayBuffer');
        if (!obj.value) return new Response('Not found', { status: 404 });
        return new Response(obj.value, { headers: { 'content-type': obj.metadata?.type || 'application/octet-stream', 'cache-control': 'private, max-age=3600' } });
      }

      if (p === '/stripe/webhook' && req.method === 'POST') return stripeWebhook(req, env, ctx);
      if (p === '/etsy/connect') { await ensureSchema(env); return etsyConnect(env); }
      if (p === '/etsy/callback') { await ensureSchema(env); return etsyCallback(env, url); }

      if (p.startsWith('/admin/')) {
        if (!env.ADMIN_KEY || req.headers.get('x-admin-key') !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
        return admin(req, env, url);
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: e.message }, 500);
    }
  },

  async email(message, env, ctx) {
    try {
      await handleInbound(message, env, ctx);
    } catch (e) {
      console.error('inbound failed', e);
      try { await logEvent(env, null, 'inbox_error', e.message); } catch {}
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(event, env));
  },
};

async function stripeWebhook(req, env, ctx) {
  const payload = await req.text();
  const ok = await verifyStripe(env, payload, req.headers.get('stripe-signature') || '');
  if (!ok) return json({ error: 'bad signature' }, 400);
  const evt = JSON.parse(payload);
  await ensureSchema(env);
  if (evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded') {
    const s0 = evt.data.object;
    if (s0.payment_status !== 'paid') return json({ received: true, skipped: 'not paid' });
    const r = await ingestStripeSession(env, s0.id);
    return json({ received: true, ...r });
  }
  return json({ received: true, ignored: evt.type });
}

async function admin(req, env, url) {
  await ensureSchema(env);
  const p = url.pathname.replace(/^\/admin/, '');
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

  if (p === '/orders') {
    const { results } = await env.DB.prepare('SELECT id, created_at, source, status, product, amount_pence, address, email, revision, prodigi_id, notes FROM orders ORDER BY created_at DESC LIMIT 100').all();
    return json(results);
  }
  let m = p.match(/^\/order\/([^/]+)$/);
  if (m) {
    const o = await getOrder(env, m[1]);
    const { results } = await env.DB.prepare('SELECT * FROM events WHERE order_id = ? ORDER BY id').bind(m[1]).all();
    return json({ order: o, proof: o?.proof_key ? fileUrl(env, o.proof_key) : null, print: o?.file_key ? fileUrl(env, o.file_key) : null, events: results });
  }
  m = p.match(/^\/order\/([^/]+)\/restart$/);
  if (m) {
    const o = await getOrder(env, m[1]);
    const id = await startOrderWorkflow(env, o.id, body.mode || 'new', o.revision || 0, Date.now() % 100000);
    return json({ started: id });
  }
  m = p.match(/^\/order\/([^/]+)\/approve$/);
  if (m) {
    const o = await getOrder(env, m[1]);
    const po = await createPrintOrder(env, o, fileUrl(env, o.file_key));
    await updateOrder(env, o.id, { status: 'printing', prodigi_id: po.id });
    if (body.notify && o.email) { const t = approvedEmail(o); await sendMail(env, { to: o.email, subject: t.subject, text: t.text, orderId: o.id }); }
    return json({ prodigi: po.id, stage: po.status?.stage });
  }
  m = p.match(/^\/order\/([^/]+)\/set$/);
  if (m) { await updateOrder(env, m[1], body); return json({ ok: true }); }
  if (p === '/test-order' && req.method === 'POST') {
    const order = await createOrder(env, {
      source: body.source || 'test', email: body.email, name: body.name || 'Test', product: body.product || 'framed', amount_pence: 0,
      address: body.address, message: body.message || '', move_in: body.move_in || '', style: body.style || 'heritage',
      ship_json: JSON.stringify(body.ship || {}), external_ref: null,
    });
    return json(order);
  }
  if (p === '/prospects' && req.method === 'POST') {
    for (const x of body.prospects || []) {
      await env.DB.prepare(`INSERT INTO prospects (email, agency, company, area, status, last_contact, followup_due, notes) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(email) DO UPDATE SET agency=excluded.agency, company=excluded.company, area=excluded.area, status=excluded.status, last_contact=excluded.last_contact, followup_due=excluded.followup_due, notes=excluded.notes`)
        .bind(x.email.toLowerCase(), x.agency, x.company || null, x.area || null, x.status || 'new', x.last_contact || null, x.followup_due || null, x.notes || null).run();
    }
    const { results } = await env.DB.prepare('SELECT * FROM prospects ORDER BY agency').all();
    return json(results);
  }
  if (p === '/prospects') return json((await env.DB.prepare('SELECT * FROM prospects ORDER BY agency').all()).results);
  if (p === '/events') return json((await env.DB.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').bind(Number(url.searchParams.get('limit') || 50)).all()).results);
  if (p === '/send' && req.method === 'POST') return json(await sendMail(env, body));
  if (p === '/summary' && req.method === 'POST') { await weeklySummary(env); return json({ ok: true }); }
  if (p === '/etsy/poll' && req.method === 'POST') return json(await pollEtsy(env));
  if (p === '/stripe/reconcile' && req.method === 'POST') return json(await reconcileStripe(env));
  if (p === '/check') return json(await systemsCheck(env));
  if (p === '/outreach/run' && req.method === 'POST') return json(await startDailyOutreach(env, new Date()));
  if (p === '/outreach/find' && req.method === 'POST') return json(await findProspects(env, body.area));
  if (p === '/samples') return json(await samplesStatus(env));
  if (p === '/outreach/preview' && req.method === 'POST') {
    const pr = await env.DB.prepare('SELECT * FROM prospects WHERE email = ?').bind(String(body.email || '').toLowerCase()).first();
    return pr ? json(await startPreview(env, pr)) : json({ error: 'no such prospect' }, 404);
  }
  return json({ error: 'unknown admin route' }, 404);
}
