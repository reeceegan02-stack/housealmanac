// AI agents that run the business from inside Cloudflare (no laptop, no chat session needed):
//  - Daily operations agent (07:00 UTC): reads the status snapshot, restarts stuck orders, pauses/resumes or
//    re-paces outreach, and emails Reece only when something needs him.
//  - Weekly growth agent (Mondays 09:00 UTC): reviews the week, adjusts outreach volume, and finds press,
//    gift-guide and partner contacts, writing pitches into the outbox queue (sent gradually by outbox.js).
// Both use a small set of tightly bounded tools. Code changes are out of scope for them (a Claude Code session
// does those via GitHub).
import { WorkflowEntrypoint } from 'cloudflare:workers';
import { claude, MODELS, webSearchTool } from './claude.js';
import { kvGet, kvSet, logEvent, ensureSchema, BRAND } from './util.js';
import { buildStatus } from './status.js';
import { sendMail } from './mail.js';
import { startOrderWorkflow } from './orders.js';
import { KB } from './kb.js';

const today = () => new Date().toISOString().slice(0, 10);

import { outreachPaused, outreachPerDayOverride } from './controls.js';

// ---------- tools ----------
const TOOLS = {
  restart_order: {
    def: { name: 'restart_order', description: 'Restart the processing of a stuck or needs_attention order (re-runs research/render/check; reuses saved research).',
      input_schema: { type: 'object', properties: { order_id: { type: 'string' }, reason: { type: 'string' } }, required: ['order_id', 'reason'] } },
    async run(env, { order_id, reason }) {
      const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order_id).first();
      if (!o) return 'No such order.';
      if (!['needs_attention', 'new', 'researching', 'revising'].includes(o.status)) return `Not restartable (status ${o.status}).`;
      const tries = (await env.DB.prepare(`SELECT count(*) n FROM events WHERE order_id = ? AND kind = 'workflow_started'`).bind(order_id).first()).n;
      if (tries >= 6) return 'Already restarted too many times; tell Reece instead.';
      const id = await startOrderWorkflow(env, order_id, o.status === 'revising' ? 'revise' : 'new', o.revision || 0, Date.now() % 100000);
      await logEvent(env, order_id, 'agent_restart', { reason: String(reason).slice(0, 200) });
      return `Restarted (${id}).`;
    },
  },
  set_outreach: {
    def: { name: 'set_outreach', description: 'Pause or resume estate-agent outreach and the outbox, and/or set new agencies emailed per weekday (0-40).',
      input_schema: { type: 'object', properties: { paused: { type: 'boolean' }, per_day: { type: 'integer' }, reason: { type: 'string' } }, required: ['reason'] } },
    async run(env, { paused, per_day, reason }) {
      if (typeof paused === 'boolean') await kvSet(env, 'agent_outreach_paused', String(paused));
      if (Number.isFinite(per_day)) await kvSet(env, 'agent_outreach_per_day', String(Math.max(0, Math.min(40, per_day))));
      await logEvent(env, null, 'agent_outreach_set', { paused, per_day, reason: String(reason).slice(0, 200) });
      return `Outreach now paused=${await outreachPaused(env)}, per_day=${(await outreachPerDayOverride(env)) ?? 'default'}.`;
    },
  },
  email_owner: {
    def: { name: 'email_owner', description: "Email Reece (the owner) at hello@ - ONLY when he must act or decide (a card charge, an account, a real problem you can't fix). At most once per run.",
      input_schema: { type: 'object', properties: { subject: { type: 'string' }, text: { type: 'string' } }, required: ['subject', 'text'] } },
    async run(env, { subject, text }, ctx) {
      if (ctx.emailed) return 'Already emailed Reece this run.';
      ctx.emailed = true;
      await sendMail(env, { to: BRAND.from, bcc: false, subject: `House Almanac agent: ${String(subject).slice(0, 120)}`, text: String(text).slice(0, 4000) });
      return 'Sent.';
    },
  },
  queue_pitch: {
    def: { name: 'queue_pitch', description: 'Queue a pitch email to a press, gift-guide, blogger or partner contact. Only an address the recipient publishes for business or press enquiries. Sent gradually on weekdays; never to the same address twice.',
      input_schema: { type: 'object', properties: {
        to: { type: 'string' }, name_or_outlet: { type: 'string' }, kind: { type: 'string', enum: ['press', 'gift_guide', 'blogger', 'partner'] },
        subject: { type: 'string' }, text: { type: 'string', description: 'Plain text, signed Reece, House Almanac, hello@housealmanac.co.uk. No opt-out line needed (added automatically).' },
        source_url: { type: 'string', description: 'Page where you found the address' } }, required: ['to', 'name_or_outlet', 'kind', 'subject', 'text', 'source_url'] } },
    async run(env, a, ctx) {
      if ((ctx.queued = (ctx.queued || 0) + 1) > 15) return 'Limit of 15 pitches per run reached.';
      const to = String(a.to).trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(to) || /@(gmail|hotmail|outlook|yahoo|icloud)\./.test(to)) return 'Rejected: not a published business address.';
      if (await env.DB.prepare('SELECT 1 FROM outbox_queue WHERE to_email = ?').bind(to).first()) return 'Already contacted before; skipped.';
      if (await env.DB.prepare('SELECT 1 FROM prospects WHERE email = ? OR domain = ?').bind(to, to.split('@')[1]).first()) return 'This is an estate-agent prospect (handled by outreach); skipped.';
      const id = `${today()}-${to}`;
      await env.DB.prepare(`INSERT INTO outbox_queue (id, created_at, to_email, outlet, kind, subject, text, source_url, status) VALUES (?,?,?,?,?,?,?,?, 'queued')`)
        .bind(id, new Date().toISOString(), to, String(a.name_or_outlet).slice(0, 120), a.kind, String(a.subject).slice(0, 160), String(a.text).slice(0, 3000), String(a.source_url).slice(0, 300)).run();
      return 'Queued.';
    },
  },
};

async function runAgent(env, { system, prompt, tools, serverTools = [], maxTurns = 10 }) {
  const ctx = {};
  const messages = [{ role: 'user', content: prompt }];
  const toolDefs = [...serverTools, ...tools.map(t => TOOLS[t].def)];
  const log = [];
  for (let turn = 0; turn < maxTurns; turn++) {
    const { text, data } = await claude(env, { model: MODELS.research, maxTokens: 4000, system, messages, tools: toolDefs });
    messages.push({ role: 'assistant', content: data.content });
    const calls = (data.content || []).filter(c => c.type === 'tool_use');
    if (!calls.length) return { final: text, log };
    const results = [];
    for (const c of calls) {
      let out;
      try { out = TOOLS[c.name] ? await TOOLS[c.name].run(env, c.input || {}, ctx) : 'Unknown tool.'; } catch (e) { out = 'Error: ' + e.message; }
      log.push({ tool: c.name, input: c.name === 'queue_pitch' ? { outlet: c.input?.name_or_outlet, kind: c.input?.kind } : c.input, out: String(out).slice(0, 200) });
      results.push({ type: 'tool_result', tool_use_id: c.id, content: String(out) });
    }
    messages.push({ role: 'user', content: results });
  }
  return { final: '(stopped after max turns)', log };
}

const RULES = `Rules: you act for House Almanac (personalised A3 house-history prints, Manchester; owner Reece Egan-Sheath, who has given full control within a £2,000 all-in budget and does not want to be asked about day-to-day matters). Never spend money or promise discounts beyond the published prices; never mislead; never invent facts, reviews or results; be brief.
Business facts:
${KB}`;

export async function opsAgent(env) {
  const status = await buildStatus(env);
  return runAgent(env, {
    system: `You are the daily operations agent. ${RULES}`,
    prompt: `Today's status snapshot (JSON, privacy-scrubbed):
${JSON.stringify(status).slice(0, 14000)}

Review it and act:
- Restart orders stuck over 3 hours or needing attention when a retry could plausibly help (map tiles, timeouts, transient API errors). Do not restart ones whose notes show a content problem a retry won't fix.
- Outreach: if bounces exceed about 8% of emails sent in 7 days, or there are signs of complaints, pause outreach. If it is paused by you and the cause is gone, resume. Otherwise leave volume alone (the weekly growth agent sets volume).
- Email Reece ONLY if he must do something himself (approve a card charge such as a Claude credit top-up when the prepaid $20 is nearly used, create an account, a system that keeps failing, or anything that needs a decision). Do not send routine summaries.
Finish with a 1-3 line note of what you did.`,
    tools: ['restart_order', 'set_outreach', 'email_owner'],
    maxTurns: 8,
  });
}

export async function growthAgent(env) {
  const status = await buildStatus(env);
  const recent = (await env.DB.prepare(`SELECT outlet, kind, status, created_at FROM outbox_queue ORDER BY created_at DESC LIMIT 40`).all()).results;
  return runAgent(env, {
    system: `You are the weekly growth agent. ${RULES}`,
    prompt: `Status snapshot (JSON, privacy-scrubbed):
${JSON.stringify(status).slice(0, 12000)}

Pitches queued or sent recently (do not repeat outlets): ${JSON.stringify(recent)}

Your job this week:
1. Estate-agent outreach volume: if bounces are under 3% and there are no complaint signs, you may raise new agencies per weekday by up to 10 (max 40); if replies are poor or bounces high, lower it or pause. Use set_outreach once at most, with a reason.
2. Consumer reach: use web search to find 8-15 NEW relevant contacts with an email address they publish for press, editorial, gift-guide or business enquiries: Manchester and North West lifestyle and property editors, Christmas gift guides (before mid-December), interiors and home bloggers, local history societies, and partners who meet people moving home (independent removal firms, conveyancers, new-build developers' customer teams). Skip big national outlets unless there's a named gift-guide editor with a published address.
3. For each, write a short, personal, honest pitch (under 150 words) as Reece: what House Almanac is (their street on an 1890s Ordnance Survey map, the same spot today, a researched history and timeline, framed A3 from £89, unframed £39, free UK delivery, order by 9 December for Christmas), why it suits their readers or customers, and one clear ask (feature in a gift guide, a partnership, a referral arrangement). You may offer to make them a free digital print of a street of their choice (they reply with the address; the inbox makes it automatically). Sign as "Reece, House Almanac"; don't describe him as a sole trader. Link https://housealmanac.co.uk. Queue each with queue_pitch, including the page where you found the address.
4. Email Reece only if he must act.
Finish with a short note: what you changed and how many pitches you queued, by kind.`,
    tools: ['set_outreach', 'queue_pitch', 'email_owner'],
    serverTools: [webSearchTool(20)],
    maxTurns: 14,
  });
}

// Durable runner (agents can take several minutes).
export class AgentWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const env = this.env;
    const which = event.payload?.agent;
    const res = await step.do(`run ${which}`, { retries: { limit: 1, delay: '5 minutes' }, timeout: '20 minutes' }, async () => {
      await ensureSchema(env);
      const r = which === 'growth' ? await growthAgent(env) : await opsAgent(env);
      await logEvent(env, null, `agent_${which}`, { final: String(r.final).slice(0, 1500), actions: r.log.slice(0, 30) });
      return { final: String(r.final).slice(0, 1500), actions: r.log.length };
    });
    return res;
  }
}

export async function startAgent(env, which, key) {
  try {
    await env.AGENT_FLOW.create({ id: `${which}-${key}`, params: { agent: which } });
    return { started: `${which}-${key}` };
  } catch (e) {
    return { skipped: 'already ran' };
  }
}
