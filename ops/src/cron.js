// Scheduled jobs: shipping updates, stuck orders, agent follow-ups, weekly summary.
import { ensureSchema, updateOrder, logEvent, now, BRAND } from './util.js';
import { getPrintOrder } from './prodigi.js';
import { sendMail, shippedEmail } from './mail.js';
import { startOrderWorkflow } from './orders.js';
import { pollEtsy, etsyMarkShipped, etsyApprovalWatch } from './etsy.js';
import { reconcileStripe } from './stripe-orders.js';
import { sendOutbox } from './outbox.js';
import { buildStatus } from './status.js';
import { startAgent } from './agent.js';
import { systemsCheck } from './check.js';
import { PREPAID_USD } from './claude.js';
import { kvGet, kvSet } from './util.js';
import { startDailyOutreach, samplesStatus } from './outreach.js';
import { voucherSafetyNet } from './voucher.js';

export async function runScheduled(event, env) {
  await ensureSchema(env);
  const d = new Date(event.scheduledTime || Date.now());
  const jobs = [checkShipping(env), retryStuck(env), pollEtsy(env), reconcileStripe(env), creditWatch(env), etsyApprovalWatch(env), sendOutbox(env), voucherSafetyNet(env)];
  if (d.getUTCHours() === 10 && d.getUTCMinutes() < 30) jobs.push(startDailyOutreach(env, d));
  if (d.getUTCDay() === 1 && d.getUTCHours() === 9 && d.getUTCMinutes() < 30) jobs.push(weeklySummary(env)); // after the growth agent, so its plan is included
  if (d.getUTCHours() === 7 && d.getUTCMinutes() < 30) jobs.push(startAgent(env, 'ops', d.toISOString().slice(0, 10)));
  if (d.getUTCDay() === 1 && d.getUTCHours() === 7 && d.getUTCMinutes() < 30) jobs.push(startAgent(env, 'growth', d.toISOString().slice(0, 10)));
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === 'rejected') await logEvent(env, null, 'cron_error', String(r.reason?.message || r.reason));
  try { await buildStatus(env); } catch (e) { await logEvent(env, null, 'cron_error', 'status: ' + e.message); }
}

async function checkShipping(env) {
  const { results } = await env.DB.prepare(`SELECT * FROM orders WHERE status = 'printing' AND prodigi_id IS NOT NULL`).all();
  for (const o of results) {
    try {
      const po = await getPrintOrder(env, o.prodigi_id);
      const ship = (po.shipments || []).find(s => s.tracking && (s.tracking.url || s.tracking.number));
      if (ship) {
        const tracking = { url: ship.tracking.url, number: ship.tracking.number, carrier: ship.carrier?.name };
        await updateOrder(env, o.id, { status: 'shipped', tracking: JSON.stringify(tracking) });
        const to = o.source.startsWith('agent-') ? (JSON.parse(o.ship_json || '{}').agent_email || o.email) : o.email;
        const t = shippedEmail(o, tracking);
        if (o.source === 'etsy') await etsyMarkShipped(env, o, tracking);
        if (to) await sendMail(env, { to, subject: t.subject, text: t.text, orderId: o.id });
      } else if (po.status?.stage === 'Cancelled') {
        await updateOrder(env, o.id, { status: 'needs_attention', notes: 'Prodigi cancelled the order' });
      }
    } catch (e) {
      await logEvent(env, o.id, 'shipping_check_error', e.message);
    }
  }
  // mark delivered 10 days after shipping (for print-file clean-up timing)
  await env.DB.prepare(`UPDATE orders SET status = 'delivered' WHERE status = 'shipped' AND updated_at < datetime('now', '-10 days')`).run();
}

async function retryStuck(env) {
  const { results } = await env.DB.prepare(`SELECT * FROM orders WHERE status IN ('new','researching','revising') AND updated_at < ?`)
    .bind(new Date(Date.now() - 3 * 3600e3).toISOString()).all();
  for (const o of results) {
    const tries = await env.DB.prepare(`SELECT count(*) n FROM events WHERE order_id = ? AND kind = 'workflow_started'`).bind(o.id).first();
    if (tries.n >= 3) {
      await updateOrder(env, o.id, { status: 'needs_attention', notes: 'Workflow failed 3 times' });
      await sendMail(env, { to: BRAND.from, bcc: false, subject: `ACTION NEEDED: order ${o.id} is stuck`, text: `Order ${o.id} (${o.address}) failed to produce a proof after 3 attempts. Check the events log via /admin/order/${o.id}.` });
      continue;
    }
    await updateOrder(env, o.id, { status: o.status });
    await startOrderWorkflow(env, o.id, o.status === 'revising' ? 'revise' : 'new', o.revision || 0, tries.n);
  }
}

// Warn once when the prepaid Claude credit is estimated to be under $5.
async function creditWatch(env) {
  const used = Number(await kvGet(env, 'claude_usd_paid') || 0);
  if (PREPAID_USD - used > 5 || await kvGet(env, 'claude_credit_warned')) return;
  await kvSet(env, 'claude_credit_warned', new Date().toISOString());
  await sendMail(env, {
    to: BRAND.from, bcc: false, subject: 'ACTION NEEDED: Claude API credit is nearly used up',
    text: `By our estimate about $${used.toFixed(2)} of the $${PREPAID_USD} prepaid Claude API credit has been used. When it runs out, new orders stop at the research step.\n\nTop up at platform.claude.com → Billing & payments → Buy credits (or turn on auto-reload).`,
  });
}

export async function weeklySummary(env, { dry = false } = {}) {
  // Reece's one regular email: what happened this week, in numbers, and anything that needs him.
  const since = new Date(Date.now() - 7 * 86400e3).toISOString();
  const one = async (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
  const all = async (sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results;
  const paid = await one(`SELECT count(*) n, coalesce(sum(amount_pence), 0) p FROM orders WHERE created_at >= ? AND amount_pence > 0 AND source != 'test'`, since);
  const paidAll = await one(`SELECT count(*) n, coalesce(sum(amount_pence), 0) p FROM orders WHERE amount_pence > 0 AND source != 'test'`);
  const vouchers = await one(`SELECT count(*) n, coalesce(sum(amount_pence), 0) p FROM vouchers WHERE created_at >= ? AND session_id NOT LIKE 'test-%'`, since);
  const printed = await all(`SELECT o.product, count(*) n FROM events e JOIN orders o ON o.id = e.order_id WHERE e.kind = 'prodigi_order' AND e.at >= ? GROUP BY o.product`, since);
  const printCost = printed.reduce((a, r) => a + r.n * (r.product === 'framed' ? 51.30 : 15.48), 0);
  const attention = await all(`SELECT id, notes FROM orders WHERE status = 'needs_attention'`);
  const newAgencies = (await one(`SELECT count(*) n FROM events WHERE kind = 'email_sent' AND at >= ? AND (detail LIKE '%"subject":"The history of %' OR detail LIKE '%"subject":"A completion gift%')`, since)).n;
  const followUps = (await one(`SELECT count(*) n FROM events WHERE kind = 'email_sent' AND at >= ? AND detail LIKE '%"subject":"Re: %' AND (detail LIKE '%The history of%' OR detail LIKE '%completion gift%')`, since)).n;
  const prospects = await all(`SELECT status, count(*) n FROM prospects GROUP BY status`);
  const total = prospects.filter(r => r.status !== 'unverified').reduce((a, r) => a + r.n, 0);
  const st = Object.fromEntries(prospects.map(r => [r.status, r.n]));
  const replies = await all(`SELECT json_extract(detail, '$.intent') intent, count(*) n FROM events WHERE kind = 'agent_mail' AND at >= ? GROUP BY intent`, since);
  const samples = await samplesStatus(env);
  const pitches = (await one(`SELECT count(*) n FROM outbox_queue WHERE status = 'sent' AND sent_at >= ?`, since).catch(() => ({ n: 0 }))).n;
  const pitchReplies = (await one(`SELECT count(*) n FROM events WHERE kind = 'general_mail' AND at >= ? AND coalesce(json_extract(detail, '$.intent'), '') NOT IN ('supplier_or_sales_pitch', 'spam')`, since)).n;
  const growth = await one(`SELECT detail FROM events WHERE kind = 'agent_growth' ORDER BY id DESC LIMIT 1`);
  let growthNote = ''; try { growthNote = JSON.parse(growth?.detail || '{}').final || ''; } catch {}
  const sys = await systemsCheck(env);
  const promoUsd = Number(await kvGet(env, 'claude_usd_promo') || 0), paidUsd = Number(await kvGet(env, 'claude_usd_paid') || 0);
  const failing = ['prodigi', 'stripe', 'claude'].filter(k => !sys[k]?.ok);
  const needs = [
    ...failing.map(k => `${k} is failing: ${sys[k].error}`),
    ...attention.map(a => `order ${a.id} needs attention: ${a.notes || ''}`),
    ...(PREPAID_USD - paidUsd < 8 && new Date().toISOString().slice(0, 10) >= '2026-11-20' ? [`Claude credit: about $${Math.max(0, PREPAID_USD - paidUsd).toFixed(0)} left; a top-up needs your yes`] : []),
  ];
  const gbp = (p) => `£${(p / 100).toFixed(0)}`;
  const text = `Hi Reece,

Here's the week at House Almanac.

Sales: ${paid.n} paid order${paid.n === 1 ? '' : 's'} (${gbp(paid.p)})${vouchers.n ? ` and ${vouchers.n} gift voucher${vouchers.n === 1 ? '' : 's'} (${gbp(vouchers.p)})` : ''}. All time: ${paidAll.n} (${gbp(paidAll.p)}).
Prints sent to the printer: ${printed.reduce((a, r) => a + r.n, 0)} (about £${printCost.toFixed(0)}).

Estate agents: ${newAgencies} new agencies emailed and ${followUps} follow-ups this week; ${total} contacted in total.
Replies this week: ${replies.map(r => `${r.n} ${String(r.intent || 'other').replace(/_/g, ' ')}`).join(', ') || 'none'}.
Interested so far: ${st.interested || 0}. Free framed samples sent: ${samples.used} of ${samples.cap}. Paying agencies: ${samples.paying}.

Press, gift guides and partners: ${pitches} pitches sent this week, ${pitchReplies} repl${pitchReplies === 1 ? 'y' : 'ies'}.

${growthNote ? `Plan for this week:\n${growthNote.replace(/\*\*/g, '').slice(0, 1200)}\n\n` : ''}Running costs: Claude API about $${(promoUsd + paidUsd).toFixed(0)} used ($${promoUsd.toFixed(0)} of the free $100 until 24 Nov, then $${paidUsd.toFixed(0)} of $${PREPAID_USD} prepaid).

${needs.length ? `Needs you:\n${needs.map(n => `- ${n}`).join('\n')}` : 'Nothing needs you this week.'}

Claude
(running House Almanac for you)`;
  if (dry) return { subject: `House Almanac weekly update${needs.length ? ' (needs you)' : ''}`, text };
  await sendMail(env, { to: BRAND.from, bcc: false, subject: `House Almanac weekly update${needs.length ? ' (needs you)' : ''}`, text });
}
