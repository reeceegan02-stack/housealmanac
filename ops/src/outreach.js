// Estate-agent growth engine: finds agencies, emails them, follows up. Runs every weekday in a
// Workflow (long-running), started by the cron at 10:00 UK.
// PECR: only limited companies / LLPs, at an email address they publish themselves, sender
// identified, and an opt-out in every email. Every address is checked on the agency's own
// website before we email it (no guessed addresses, fewer bounces).
import { WorkflowEntrypoint } from 'cloudflare:workers';
import { claude, MODELS, webSearchTool } from './claude.js';
import { kvGet, kvSet, now, logEvent, extractJson, ensureSchema, BRAND } from './util.js';
import { sendMail } from './mail.js';

// Worked through in order; each run moves on to the next area when the pool runs low.
export const AREAS = [
  'Didsbury, Manchester', 'Chorlton, Manchester', 'Manchester city centre', 'Sale, Trafford', 'Altrincham and Hale', 'Stockport', 'Bramhall',
  'Cheadle and Cheadle Hulme', 'Heaton Moor and Heaton Chapel', 'Marple', 'Prestwich and Whitefield', 'Bury', 'Ramsbottom', 'Bolton', 'Horwich',
  'Wigan', 'Leigh', 'Salford', 'Worsley and Walkden', 'Eccles', 'Urmston', 'Stretford', 'Swinton', 'Oldham', 'Saddleworth', 'Rochdale',
  'Littleborough', 'Middleton', 'Ashton-under-Lyne', 'Stalybridge', 'Hyde', 'Denton', 'Glossop', 'Wilmslow', 'Knutsford', 'Macclesfield',
  'Northwich', 'Warrington', 'Chester', 'Crewe and Nantwich', 'Preston', 'Chorley', 'Blackburn', 'Burnley', 'Clitheroe', 'Lancaster',
  'Lytham St Annes', 'Southport', 'Ormskirk', 'Liverpool', 'Crosby and Formby', 'Wirral', 'St Helens', 'Huddersfield', 'Holmfirth',
  'Halifax', 'Leeds', 'Harrogate', 'Ilkley', 'Skipton', 'York', 'Wakefield', 'Sheffield', 'Chesterfield', 'Buxton', 'Derby',
  'Nottingham', 'Leicester', 'Birmingham', 'Solihull', 'Sutton Coldfield', 'Stratford-upon-Avon', 'Cheltenham', 'Bath', 'Bristol',
  'Oxford', 'Cambridge', 'Norwich', 'Reading', 'Guildford', 'Brighton', 'Cardiff', 'Newcastle upon Tyne', 'Durham',
];

const FREE_MAIL = /@(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|aol|btinternet|sky|virginmedia|talktalk)\./i;
const CHAINS = /(purplebricks|connells|your ?move|reeds ?rains|countrywide|bairstow|haart|foxtons|savills|knight ?frank|strutt|hamptons|chestertons|winkworth|leaders|yopa|ewemove|doorsteps|emoov|zoopla|rightmove|onthemarket)/i;

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);
const domainOf = (email) => String(email || '').toLowerCase().split('@')[1] || '';
const beforeChristmas = () => new Date() < new Date(new Date().getFullYear() + '-12-19T00:00:00Z');

// ---------- free framed samples ----------
// Reece's rule: 5 free framed samples, plus one more for every agency that becomes a paying customer.
export async function samplesStatus(env) {
  const base = Number(env.FREE_SAMPLES_CAP || 5);
  const used = (await env.DB.prepare(`SELECT count(*) n FROM orders WHERE source = 'agent-sample' AND status != 'cancelled'`).first()).n;
  const paying = (await env.DB.prepare(`SELECT count(DISTINCT p.domain) n FROM orders o JOIN prospects p
      ON p.domain = lower(substr(o.email, instr(o.email, '@') + 1))
      WHERE o.amount_pence > 0 AND o.status NOT IN ('cancelled') AND o.email IS NOT NULL`).first()).n;
  const cap = base + paying;
  return { cap, used, paying, left: Math.max(0, cap - used) };
}

// ---------- templates ----------
export function firstEmail(p, offerSample) {
  const offer = offerSample
    ? `If it's useful, I'll make one free for a buyer completing with you${beforeChristmas() ? ' before Christmas' : ' this month'}, so you can see it in person before deciding anything. Just reply with their new address.`
    : `If it's useful, reply with the new address of a buyer completing with you and I'll email you a free proof of their print within 2 working days, so you can see exactly what they'd get before ordering anything.`;
  return {
    subject: `A completion gift for ${p.agency} buyers`,
    text: `Hi ${p.agency} team,

I run House Almanac, a Manchester business that makes framed A3 prints of a home's history: the street on an 1890s Ordnance Survey map, the same spot today, a short history and timeline, and a message from you.

For agents, each print carries your logo and a QR code to your review page, and arrives framed at your branch ready for key handover. It's £75 a print, or £65 each if you order 10 or more a quarter, with no contract.

There's an example and the details here: https://housealmanac.co.uk/agents

${offer}

Best wishes,
Reece Egan-Sheath
House Almanac · hello@housealmanac.co.uk · housealmanac.co.uk

If this isn't for you, reply "no thanks" and I won't email again.`,
  };
}

export function followUpEmail(p, offerSample) {
  const offer = offerSample
    ? `The offer of a free framed print for one of your buyers still stands. Reply with their new address and I'll send you a proof within 2 working days.`
    : `Reply with the new address of any buyer completing with you and I'll send you a free proof of their print within 2 working days.`;
  return {
    subject: `Re: A completion gift for ${p.agency} buyers`,
    text: `Hi ${p.agency} team,

Just bringing this back to the top of your inbox. ${offer}

Example and prices: https://housealmanac.co.uk/agents

Reece
House Almanac · hello@housealmanac.co.uk

If this isn't for you, reply "no thanks" and I won't email again.`,
  };
}

// ---------- finding agencies ----------
export async function findProspects(env, area) {
  const known = (await env.DB.prepare(`SELECT domain FROM prospects WHERE domain IS NOT NULL`).all()).results.map(r => r.domain);
  const { text } = await claude(env, {
    model: MODELS.research, maxTokens: 5000, tools: [webSearchTool(15)],
    system: 'You research UK estate agents for business-to-business email outreach. Only report facts you found in search results. Never guess or construct an email address.',
    messages: [{ role: 'user', content: `Find up to 12 independent or small-chain residential sales estate agents with a branch in ${area}, UK.
For each one find, from their own website or its search snippets:
- the general office email address they publish (info@, sales@, the branch address, etc.; avoid a named person's address if a general one exists)
- evidence that the business is a limited company or LLP (e.g. "Ltd"/"Limited"/"LLP" with a company number in the website footer or terms, or its Companies House listing)
Skip national corporate chains and their branches (e.g. Purplebricks, Connells, Your Move, Reeds Rains, Countrywide brands, haart, Foxtons, Savills, Knight Frank), lettings-only agents, and any agency where you can't find BOTH a published email and limited-company evidence.
Skip these websites, we already know them: ${known.slice(-300).join(', ') || 'none'}.

JSON only: {"agents": [{"agency": "the short trading name customers know, without branch, location or legal suffix (e.g. \"Julian Wadden\", not \"Julian Wadden & Co Limited (Didsbury)\")", "company": "registered name incl. Ltd/Limited/LLP", "company_no": "", "email": "", "website": "https://...", "evidence": "where you found the email and the company status"}]}` }],
  });
  let list = [];
  try { list = extractJson(text).agents || []; } catch (e) { list = []; }
  let added = 0, rejected = 0;
  for (const a of list) {
    a.agency = cleanAgency(a.agency);
    const email = String(a.email || '').trim().toLowerCase();
    const ok = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email) && !FREE_MAIL.test(email) && !CHAINS.test(`${a.agency} ${a.company} ${email}`)
      && /\b(ltd|limited|llp)\b/i.test(a.company || '');
    if (!ok || known.includes(domainOf(email))) { rejected++; continue; }
    const verified = await verifyOnWebsite(a.website, email);
    const status = verified ? 'new' : 'unverified';
    const r = await env.DB.prepare(`INSERT INTO prospects (email, agency, company, area, status, domain, website, created_at, notes)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(email) DO NOTHING`)
      .bind(email, a.agency, `${a.company}${a.company_no ? ` (${a.company_no})` : ''}`, area, status, domainOf(email), a.website || null, now(), String(a.evidence || '').slice(0, 300)).run();
    if (r.meta?.changes) { known.push(domainOf(email)); if (verified) added++; else rejected++; }
  }
  await logEvent(env, null, 'prospects_found', { area, found: list.length, added, rejected });
  return { area, found: list.length, added, rejected };
}

// "Julian Wadden (Didsbury)" -> "Julian Wadden"; "Smith & Co Estate Agents Ltd" -> "Smith & Co"
export function cleanAgency(name) {
  return String(name || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s*[-–|,].*$/, '')
    .replace(/\b(estate agents?|estate agency|ltd|limited|llp|sales (&|and) lettings)\b\.?/gi, '').replace(/\s{2,}/g, ' ').trim() || String(name || '').trim();
}

// The address must appear on the agency's own site (home, contact or about page).
async function verifyOnWebsite(website, email) {
  if (!website) return false;
  let base;
  try { base = new URL(/^https?:/.test(website) ? website : 'https://' + website); } catch { return false; }
  const paths = ['/', '/contact', '/contact-us', '/contact/', '/about', '/about-us'];
  for (const path of paths) {
    try {
      const r = await fetch(new URL(path, base.origin), { headers: { 'user-agent': 'Mozilla/5.0 (compatible; HouseAlmanac/1.0; +https://housealmanac.co.uk)' }, redirect: 'follow', signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      const html = (await r.text()).toLowerCase().replace(/&#64;|&#x40;|\[at\]|\(at\)/g, '@');
      if (html.includes(email)) return true;
    } catch (e) { /* next page */ }
  }
  return false;
}

// ---------- the daily run ----------
export async function perDay(env) {
  let first = await kvGet(env, 'outreach_first_day');
  if (!first) { first = today(); await kvSet(env, 'outreach_first_day', first); }
  const days = (Date.parse(today()) - Date.parse(first)) / 86400e3;
  return days < 7 ? Number(env.OUTREACH_WARMUP_PER_DAY || 10) : Number(env.OUTREACH_PER_DAY || 20);
}

async function poolSize(env) {
  return (await env.DB.prepare(`SELECT count(*) n FROM prospects WHERE status = 'new'`).first()).n;
}

async function nextArea(env) {
  const i = Number(await kvGet(env, 'outreach_area_idx') || 0);
  await kvSet(env, 'outreach_area_idx', String(i + 1));
  return AREAS[i % AREAS.length];
}

export async function sendFirstEmails(env, n) {
  const s = await samplesStatus(env);
  const { results } = await env.DB.prepare(`SELECT * FROM prospects WHERE status = 'new' ORDER BY created_at LIMIT ?`).bind(n).all();
  let sent = 0;
  for (const p of results) {
    const t = firstEmail(p, s.left > 0);
    try {
      await sendMail(env, { to: p.email, subject: t.subject, text: t.text, fromName: 'Reece Egan-Sheath | House Almanac' });
      await env.DB.prepare(`UPDATE prospects SET status = 'emailed', last_contact = ?, followup_due = ? WHERE email = ?`).bind(now(), addDays(today(), 7), p.email).run();
      sent++;
    } catch (e) {
      await env.DB.prepare(`UPDATE prospects SET status = 'send_failed', notes = ? WHERE email = ?`).bind(String(e.message).slice(0, 200), p.email).run();
    }
  }
  return { sent, offerSample: s.left > 0 };
}

export async function sendFollowUps(env) {
  const s = await samplesStatus(env);
  const { results } = await env.DB.prepare(`SELECT * FROM prospects WHERE status = 'emailed' AND followup_due IS NOT NULL AND followup_due <= ? LIMIT 100`).bind(today()).all();
  let sent = 0;
  for (const p of results) {
    const t = followUpEmail(p, s.left > 0);
    try {
      await sendMail(env, { to: p.email, subject: t.subject, text: t.text, fromName: 'Reece Egan-Sheath | House Almanac' });
      await env.DB.prepare(`UPDATE prospects SET status = 'followed_up', last_contact = ?, followup_due = NULL WHERE email = ?`).bind(now(), p.email).run();
      sent++;
    } catch (e) { /* try again tomorrow */ }
  }
  return { sent };
}

export class OutreachWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const env = this.env;
    const R = { retries: { limit: 2, delay: '1 minute', backoff: 'exponential' }, timeout: '15 minutes' };
    const target = await step.do('plan', async () => { await ensureSchema(env); return perDay(env); });
    for (let i = 0; i < 4; i++) {
      const pool = await step.do(`pool ${i}`, () => poolSize(env));
      if (pool >= target) break;
      await step.do(`find ${i}`, R, async () => findProspects(env, await nextArea(env)));
    }
    const first = await step.do('send first emails', () => sendFirstEmails(env, target));
    const follow = await step.do('send follow-ups', () => sendFollowUps(env));
    await step.do('log', () => logEvent(env, null, 'outreach_day', { target, first, follow }));
    return { target, first, follow };
  }
}

// Called by the cron: weekdays at 10:00 UK time, once a day.
export async function startDailyOutreach(env, d = new Date()) {
  const day = d.getUTCDay();
  if (day === 0 || day === 6 || env.OUTREACH_PAUSED === 'true') return { skipped: 'weekend or paused' };
  const id = `outreach-${d.toISOString().slice(0, 10)}`;
  try {
    await env.OUTREACH_FLOW.create({ id });
    return { started: id };
  } catch (e) {
    return { skipped: 'already ran today' };
  }
}
