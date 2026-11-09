// Scheduled jobs: shipping updates, stuck orders, agent follow-ups, weekly summary.
import { ensureSchema, updateOrder, logEvent, now, BRAND } from './util.js';
import { getPrintOrder } from './prodigi.js';
import { sendMail, shippedEmail } from './mail.js';
import { startOrderWorkflow } from './orders.js';
import { pollEtsy, etsyMarkShipped } from './etsy.js';
import { reconcileStripe } from './stripe-orders.js';
import { systemsCheck } from './check.js';
import { PREPAID_USD } from './claude.js';
import { kvGet, kvSet } from './util.js';

export async function runScheduled(event, env) {
  await ensureSchema(env);
  const d = new Date(event.scheduledTime || Date.now());
  const jobs = [checkShipping(env), retryStuck(env), pollEtsy(env), reconcileStripe(env), creditWatch(env)];
  if (d.getUTCHours() === 9 && d.getUTCMinutes() < 30) jobs.push(agentFollowUps(env));
  if (d.getUTCDay() === 1 && d.getUTCHours() === 8 && d.getUTCMinutes() < 30) jobs.push(weeklySummary(env));
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === 'rejected') await logEvent(env, null, 'cron_error', String(r.reason?.message || r.reason));
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
        const to = o.source === 'agent-sample' ? (JSON.parse(o.ship_json || '{}').agent_email || o.email) : o.email;
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

async function agentFollowUps(env) {
  const today = new Date().toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(`SELECT * FROM prospects WHERE status = 'emailed' AND followup_due IS NOT NULL AND followup_due <= ?`).bind(today).all();
  for (const p of results) {
    const agency = p.agency || 'your';
    await sendMail(env, {
      to: p.email, fromName: 'Reece Egan-Sheath | House Almanac',
      subject: `Re: A completion gift for ${agency} buyers`,
      text: `Hi ${agency} team,

Just bringing this back to the top of your inbox. The free sample offer stands for any buyer completing with you before Christmas. Reply with their new address and I'll send you a proof within 2 working days.

Example and prices: https://housealmanac.co.uk/agents

Reece
House Almanac · hello@housealmanac.co.uk

If this isn't for you, reply "no thanks" and I won't email again.`,
    });
    await env.DB.prepare(`UPDATE prospects SET status = 'followed_up', last_contact = ? WHERE email = ?`).bind(now(), p.email).run();
  }
}

export async function weeklySummary(env) {
  const since = new Date(Date.now() - 7 * 86400e3).toISOString();
  const orders = await env.DB.prepare(`SELECT status, count(*) n, sum(amount_pence) p FROM orders WHERE created_at >= ? GROUP BY status`).bind(since).all();
  const attention = await env.DB.prepare(`SELECT id, address, notes FROM orders WHERE status = 'needs_attention'`).all();
  const prospects = await env.DB.prepare(`SELECT status, count(*) n FROM prospects GROUP BY status`).all();
  const sys = await systemsCheck(env);
  const promoUsd = Number(await kvGet(env, 'claude_usd_promo') || 0), paidUsd = Number(await kvGet(env, 'claude_usd_paid') || 0);
  const sysLine = ['prodigi', 'stripe', 'claude'].map((k) => `${k} ${sys[k].ok ? 'OK' : 'FAILING: ' + sys[k].error}`).join(' · ') + ` · etsy ${sys.etsy?.connected ? 'connected' : 'not connected'}`;
  const total = orders.results.reduce((a, r) => a + (r.p || 0), 0);
  const count = orders.results.reduce((a, r) => a + r.n, 0);
  const text = `House Almanac: last 7 days

Orders: ${count} (£${(total / 100).toFixed(2)})
${orders.results.map(r => `- ${r.status}: ${r.n}`).join('\n') || '- none'}

Estate agents:
${prospects.results.map(r => `- ${r.status}: ${r.n}`).join('\n') || '- none'}

Systems: ${sysLine}
Claude API (estimate): $${promoUsd.toFixed(2)} on free credit, $${paidUsd.toFixed(2)} of $${PREPAID_USD} prepaid used

Needs attention: ${attention.results.length ? '\n' + attention.results.map(a => `- ${a.id} ${a.address}: ${a.notes || ''}`).join('\n') : 'nothing'}

(Automatic weekly summary. No action needed unless something is listed above.)`;
  await sendMail(env, { to: BRAND.from, bcc: false, subject: `House Almanac weekly summary${sys.ok ? '' : ' (ACTION NEEDED: a service is failing)'}`, text });
}
