// Public, privacy-safe status snapshot for the maintenance agents (no names, emails, addresses or amounts per
// customer). Rebuilt by the cron every 30 minutes and served from cache at /status.json, so the endpoint can't
// be used to run up costs. A GitHub Action copies it into the "Ops status" issue, where the agents read it.
import { kvGet, kvSet, CODE_VERSION } from './util.js';
import { systemsCheck } from './check.js';
import { samplesStatus } from './outreach.js';

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi;
const STREETISH = /\b\d+[A-Za-z]?\s+[A-Z][a-z]+(\s+[A-Z][a-z]+)*\s+(Street|St|Road|Rd|Lane|Ln|Avenue|Ave|Close|Drive|Dr|Way|Grove|Place|Terrace|Crescent|Court|Gardens|Square|Hill|Row|Walk|Mews)\b/g;
export const scrub = (s, n = 180) => String(s ?? '').replace(EMAIL, '[email]').replace(POSTCODE, '[postcode]').replace(STREETISH, '[address]').slice(0, n);

export async function buildStatus(env) {
  const since7 = new Date(Date.now() - 7 * 86400e3).toISOString();
  const since30 = new Date(Date.now() - 30 * 86400e3).toISOString();
  const q = async (sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results;
  const one = async (sql, ...b) => env.DB.prepare(sql).bind(...b).first();

  const sys = await systemsCheck(env).catch(e => ({ ok: false, error: e.message }));
  const status = {
    generated_at: new Date().toISOString(),
    version: CODE_VERSION,
    systems: { ok: sys.ok, prodigi: sys.prodigi?.ok, stripe: sys.stripe?.ok, claude: sys.claude?.ok, etsy_connected: !!sys.etsy?.connected,
      errors: ['prodigi', 'stripe', 'claude'].filter(k => sys[k] && !sys[k].ok).map(k => `${k}: ${scrub(sys[k].error, 140)}`) },
    orders: {
      by_status_30d: await q(`SELECT source, status, count(*) n FROM orders WHERE created_at >= ? GROUP BY source, status`, since30),
      paid_last_7d: (await one(`SELECT count(*) n FROM orders WHERE amount_pence > 0 AND created_at >= ?`, since7)).n,
      paid_all_time: (await one(`SELECT count(*) n FROM orders WHERE amount_pence > 0`)).n,
      needs_attention: (await q(`SELECT id, source, status, notes, updated_at FROM orders WHERE status = 'needs_attention' ORDER BY updated_at DESC LIMIT 15`))
        .map(o => ({ ...o, notes: scrub(o.notes) })),
      stuck_over_3h: (await q(`SELECT id, source, status, updated_at FROM orders WHERE status IN ('new','researching','revising') AND updated_at < ?`,
        new Date(Date.now() - 3 * 3600e3).toISOString())),
    },
    problems_7d: (await q(`SELECT at, order_id, kind, detail FROM events WHERE at >= ? AND (kind LIKE '%error%' OR kind LIKE '%fail%' OR kind IN ('alert','escalated','bounce','email_skipped_duplicate','stripe_reconciled','voucher_pdf_failed','voucher_flow_error','voucher_redeem_error','voucher_emailed_by_cron')) ORDER BY id DESC LIMIT 40`, since7))
      .map(e => ({ at: e.at, order: e.order_id, kind: e.kind, detail: scrub(e.detail) })),
    qa_7d: (await q(`SELECT at, order_id, detail FROM events WHERE kind = 'qa' AND at >= ? ORDER BY id DESC LIMIT 20`, since7)).map(e => {
      let d = {}; try { d = JSON.parse(e.detail); } catch {}
      return { at: e.at, order: e.order_id, ok: d.qa?.ok, blocking: (d.qa?.blocking || []).map(x => scrub(x, 140)), broken_tiles: d.rendered?.images?.broken };
    }),
    outreach: {
      prospects_by_status: await q(`SELECT status, count(*) n FROM prospects GROUP BY status`),
      days: (await q(`SELECT at, detail FROM events WHERE kind = 'outreach_day' ORDER BY id DESC LIMIT 7`)).map(e => ({ at: e.at, detail: scrub(e.detail, 300) })),
      agent_replies_7d: await q(`SELECT json_extract(detail, '$.intent') intent, count(*) n FROM events WHERE kind = 'agent_mail' AND at >= ? GROUP BY intent`, since7),
      bounces_7d: (await one(`SELECT count(*) n FROM events WHERE kind = 'bounce' AND at >= ?`, since7)).n,
      emails_sent_7d: (await one(`SELECT count(*) n FROM events WHERE kind = 'email_sent' AND at >= ?`, since7)).n,
      samples: await samplesStatus(env),
    },
    inbox_7d: await q(`SELECT kind, count(*) n FROM events WHERE at >= ? AND (kind LIKE 'inbox%' OR kind IN ('general_mail','agent_mail','etsy_forward','owner_reply_sent')) GROUP BY kind`, since7),
    outbox: { sent: Number(await kvGet(env, 'outbox_sent_count') || 0),
      queue: await q(`SELECT kind, status, count(*) n FROM outbox_queue GROUP BY kind, status`).catch(() => []) },
    agents: (await q(`SELECT at, kind, detail FROM events WHERE kind IN ('agent_ops','agent_growth') ORDER BY id DESC LIMIT 6`))
      .map(e => { let d = {}; try { d = JSON.parse(e.detail); } catch {} return { at: e.at, agent: e.kind, note: scrub(d.final, 400), actions: (d.actions || []).map(a => a.tool) }; }),
    vouchers: await q(`SELECT product, status, count(*) n FROM vouchers WHERE session_id NOT LIKE 'test-%' GROUP BY product, status`).catch(() => []),
    controls: { outreach_paused_by_agent: (await kvGet(env, 'agent_outreach_paused')) === 'true', outreach_per_day_override: await kvGet(env, 'agent_outreach_per_day') },
    claude_usd: { promo: Number(await kvGet(env, 'claude_usd_promo') || 0).toFixed(2), paid: Number(await kvGet(env, 'claude_usd_paid') || 0).toFixed(2) },
  };
  await kvSet(env, 'status_json', JSON.stringify(status));
  return status;
}

export async function cachedStatus(env) {
  const raw = await kvGet(env, 'status_json');
  return raw ? JSON.parse(raw) : buildStatus(env);
}
