// Gift vouchers: bought through two Stripe Payment Links (framed £89, unframed £39), emailed to the buyer as a
// printable PDF, and redeemed by the recipient at housealmanac.co.uk/redeem, which creates a normal order
// (source 'voucher', nothing to pay) that goes through research -> proof -> approval -> print as usual.
import { WorkflowEntrypoint } from 'cloudflare:workers';
import puppeteer from '@cloudflare/puppeteer';
import { ensureSchema, now, logEvent, kvGet, kvSet, BRAND, randomKey, bytesToBase64, json } from './util.js';
import { sendMail, firstName } from './mail.js';
import { createOrder } from './orders.js';
import { voucherHtml, longDate } from './voucher-html.js';

// Payment Link ids -> product. Labels are a fallback (every voucher custom field mentions "voucher").
const LINKS = { plink_1UZwRBQ3Oix9a2PAYoaP42v5: 'framed', plink_1UZwW0Q3Oix9a2PAqCG0yR3N: 'unframed' };
export const VOUCHER_LINKS = { framed: 'https://buy.stripe.com/28EcN74IxdtKebS2GD2wU03', unframed: 'https://buy.stripe.com/6oUdRb0shfBSffW1Cz2wU04' };
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const VALID_DAYS = 365;

export function newVoucherCode() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  const c = [...a].map(b => ALPHABET[b % ALPHABET.length]).join('');
  return `GIFT-${c.slice(0, 4)}-${c.slice(4)}`;
}

export function normalizeCode(s) {
  let c = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.startsWith('GIFT')) c = c.slice(4);
  return c.length === 8 ? `GIFT-${c.slice(0, 4)}-${c.slice(4)}` : null;
}

export function isVoucherSession(s) {
  return !!LINKS[s.payment_link] || (s.custom_fields || []).some(f => /voucher/i.test(f.label?.custom || ''));
}


export async function createVoucherFromSession(env, s) {
  await ensureSchema(env);
  const existing = await env.DB.prepare('SELECT code FROM vouchers WHERE session_id = ?').bind(s.id).first();
  if (existing) return { voucher: existing.code, isNew: false };
  const f = { recipient: '', from_name: '', message: '' };
  for (const cf of s.custom_fields || []) {
    const label = (cf.label?.custom || '').toLowerCase();
    const v = String(cf.text?.value ?? cf.dropdown?.value ?? '').trim().slice(0, 160);
    if (/message/.test(label)) f.message = v;
    else if (/^from/.test(label)) f.from_name = v;
    else if (/who|for\b/.test(label)) f.recipient = v;
  }
  const amount = s.amount_total || 0;
  const product = LINKS[s.payment_link] || (amount >= 6000 ? 'framed' : 'unframed');
  const created = now();
  const expires = new Date(Date.now() + VALID_DAYS * 86400e3).toISOString().slice(0, 10) + 'T23:59:59Z';
  let code;
  for (let i = 0; i < 5; i++) {
    code = newVoucherCode();
    try {
      await env.DB.prepare(`INSERT INTO vouchers (code, created_at, session_id, product, amount_pence, buyer_email, buyer_name, recipient, from_name, message, status, expires_at)
        VALUES (?,?,?,?,?,?,?,?,?,?, 'active', ?)`)
        .bind(code, created, s.id, product, amount, s.customer_details?.email || '', s.customer_details?.name || '', f.recipient, f.from_name, f.message, expires).run();
      break;
    } catch (e) {
      if (/session_id/.test(e.message)) return { voucher: (await env.DB.prepare('SELECT code FROM vouchers WHERE session_id = ?').bind(s.id).first())?.code, isNew: false };
      if (i === 4) throw e; // code collision 5 times running: something else is wrong
    }
  }
  await logEvent(env, null, 'voucher_sold', { code, product, amount });
  try { await env.VOUCHER_FLOW.create({ id: `voucher-${code}`, params: { code } }); }
  catch (e) { await logEvent(env, null, 'voucher_flow_error', { code, error: e.message }); } // the cron sends it instead
  return { voucher: code, isNew: true };
}

async function renderVoucherPdf(env, v) {
  const browser = await puppeteer.launch(env.BROWSER, { keep_alive: 120000 });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 560 });
    await page.setContent(voucherHtml(v), { waitUntil: 'networkidle0', timeout: 45000 });
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 8000))]));
    const pdf = await page.pdf({ width: '210mm', height: '148mm', printBackground: true, pageRanges: '1' });
    return new Uint8Array(pdf);
  } finally { await browser.close(); }
}

function voucherEmail(v, link) {
  const framed = v.product !== 'unframed';
  return {
    subject: `Your House Almanac gift voucher (${v.code})`,
    text: `Hi ${firstName(v.buyer_name)},

Thank you for buying a House Almanac gift voucher${v.recipient ? ` for ${v.recipient}` : ''}. ${link ? "It's attached as a PDF, ready to print or forward." : "Here are the details to pass on."}

Voucher code: ${v.code}
For: ${framed ? 'a framed A3 House Almanac print' : 'an unframed A3 House Almanac print'}, delivered free in the UK
Valid until: ${longDate(v.expires_at)}

To redeem it, they go to ${BRAND.site.replace('https://', '')}/redeem and enter the code, the address of their home and where to deliver it (or use this link, with the code filled in: ${BRAND.site}/redeem?code=${v.code}). We research the house and street, email them a proof to approve (with any changes they'd like), then print${framed ? ', frame' : ''} and deliver it.
${link ? `\nIf the attachment doesn't open, the voucher is also here: ${link}\n` : ''}
Keep this email: if the voucher goes missing, reply and we'll resend it.

${'Best wishes,\nReece\nHouse Almanac · ' + BRAND.site.replace('https://', '')}`,
  };
}

async function emailVoucher(env, code, pdfKey) {
  const v = await env.DB.prepare('SELECT * FROM vouchers WHERE code = ?').bind(code).first();
  if (!v || v.emailed_at || !v.buyer_email) return { skipped: true };
  let attachments, link = null;
  if (pdfKey) {
    const bytes = await env.FILES.get(pdfKey, 'arrayBuffer');
    if (bytes) {
      attachments = [{ content: bytesToBase64(new Uint8Array(bytes)), filename: `House-Almanac-gift-voucher-${code}.pdf`, type: 'application/pdf', disposition: 'attachment' }];
      link = `${env.PUBLIC_BASE}/f/${pdfKey}`;
    }
  }
  const t = voucherEmail(v, link);
  await sendMail(env, { to: v.buyer_email, subject: t.subject, text: t.text, attachments });
  await env.DB.prepare('UPDATE vouchers SET emailed_at = ?, pdf_key = ? WHERE code = ?').bind(now(), pdfKey || null, code).run();
  return { sent: true, pdf: !!link };
}

export class VoucherWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const env = this.env;
    const { code } = event.payload;
    let pdfKey = null;
    try {
      pdfKey = await step.do('render pdf', { retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' }, timeout: '4 minutes' }, async () => {
        await ensureSchema(env);
        const v = await env.DB.prepare('SELECT * FROM vouchers WHERE code = ?').bind(code).first();
        const pdf = await renderVoucherPdf(env, v);
        const key = `voucher-${code}-${randomKey(8)}.pdf`;
        await env.FILES.put(key, pdf, { metadata: { type: 'application/pdf' } });
        return key;
      });
    } catch (e) {
      await step.do('log render failure', async () => logEvent(env, null, 'voucher_pdf_failed', { code, error: String(e.message || e).slice(0, 300) }));
    }
    return step.do('email buyer', { retries: { limit: 4, delay: '1 minute', backoff: 'exponential' } }, async () => emailVoucher(env, code, pdfKey));
  }
}

// Cron safety net: any voucher not emailed 20 minutes after purchase gets a plain email with the code.
export async function voucherSafetyNet(env) {
  const late = (await env.DB.prepare(`SELECT code FROM vouchers WHERE emailed_at IS NULL AND created_at < ? LIMIT 10`).bind(new Date(Date.now() - 20 * 60e3).toISOString()).all()).results;
  for (const { code } of late) {
    try { await emailVoucher(env, code, null); await logEvent(env, null, 'voucher_emailed_by_cron', { code }); }
    catch (e) { await logEvent(env, null, 'voucher_email_error', { code, error: e.message }); }
  }
  return { late: late.length };
}

// ---------- redemption (POST from housealmanac.co.uk/redeem) ----------
const PC = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i;
const NOT_EW = /^(AB|DD|DG|EH|FK|G|HS|IV|KA|KW|KY|ML|PA|PH|TD|ZE|BT|GY|JE|IM)\d/i; // Scotland, Northern Ireland, Channel Islands, Isle of Man
const STYLES = ['heritage', 'modern', 'midnight', 'sage'];

export async function redeemVoucher(req, env) {
  const origin = req.headers.get('origin') || '';
  const cors = {
    'access-control-allow-origin': /^https:\/\/(www\.)?housealmanac\.co\.uk$/.test(origin) ? origin : BRAND.site,
    'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const out = (status, body) => { const r = json(body, status); for (const [k, v] of Object.entries(cors)) r.headers.set(k, v); return r; };
  if (req.method !== 'POST') return out(405, { ok: false, error: 'Use POST.' });
  await ensureSchema(env);

  let b = {};
  try {
    const ct = req.headers.get('content-type') || '';
    b = ct.includes('json') ? await req.json() : Object.fromEntries(await req.formData());
  } catch { return out(400, { ok: false, error: 'Sorry, something went wrong reading the form. Please try again.' }); }
  const t = (k, n = 120) => String(b[k] ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

  // Throttle guessing: 8 failed codes per address per hour.
  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const rlKey = `redeem_fail_${ip}_${new Date().toISOString().slice(0, 13)}`;
  const fails = Number(await kvGet(env, rlKey) || 0);
  if (fails >= 8) return out(429, { ok: false, error: 'Too many attempts. Please try again in an hour, or email hello@housealmanac.co.uk.' });
  const fail = async (msg, field) => { await kvSet(env, rlKey, String(fails + 1)); return out(400, { ok: false, error: msg, field }); };

  const code = normalizeCode(b.code);
  const v = code ? await env.DB.prepare('SELECT * FROM vouchers WHERE code = ?').bind(code).first() : null;
  if (!v) return fail("We couldn't find that voucher code. Please check it against your voucher (it looks like GIFT-ABCD-2345).", 'code');
  if (v.status === 'redeemed' || v.status === 'redeeming') return out(400, { ok: false, field: 'code', error: 'This voucher has already been used. If that wasn\'t you, email hello@housealmanac.co.uk and we\'ll sort it out.' });
  if (v.status !== 'active') return out(400, { ok: false, field: 'code', error: 'This voucher is no longer valid. Please email hello@housealmanac.co.uk.' });
  if (v.expires_at < now()) return out(400, { ok: false, field: 'code', error: `This voucher expired on ${longDate(v.expires_at)}. Email hello@housealmanac.co.uk and we'll see what we can do.` });

  const name = t('name', 80), email = t('email', 120).toLowerCase();
  const line1 = t('line1'), line2 = t('line2'), town = t('town', 60), postcode = t('postcode', 10).toUpperCase();
  if (!name) return out(400, { ok: false, field: 'name', error: 'Please add your name.' });
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return out(400, { ok: false, field: 'email', error: 'Please check your email address: your proof is sent there.' });
  if (!line1 || !town) return out(400, { ok: false, field: 'line1', error: 'Please add the house address.' });
  const pcm = postcode.match(PC);
  if (!pcm) return out(400, { ok: false, field: 'postcode', error: 'Please check the postcode.' });
  const pc = `${pcm[1]} ${pcm[2]}`.toUpperCase();
  if (NOT_EW.test(pc)) return out(400, { ok: false, field: 'postcode', error: "At the moment we can only make prints for homes in England and Wales, sorry. Please email hello@housealmanac.co.uk and we'll refund the voucher." });

  let ship = { name, line1, line2, city: town, postcode: pc, country: 'GB' };
  if (String(b.deliver_elsewhere || '') === 'on' || b.deliver_elsewhere === true || b.deliver_elsewhere === 'true') {
    const d = { name: t('d_name', 80) || name, line1: t('d_line1'), line2: t('d_line2'), city: t('d_town', 60), postcode: t('d_postcode', 10).toUpperCase() };
    const dm = d.postcode.match(PC);
    if (!d.line1 || !d.city || !dm) return out(400, { ok: false, field: 'd_line1', error: 'Please complete the delivery address, including the postcode.' });
    if (/^(GY|JE|IM)\d/i.test(d.postcode)) return out(400, { ok: false, field: 'd_postcode', error: 'We can only deliver within the UK mainland and Northern Ireland, sorry.' });
    ship = { ...d, postcode: `${dm[1]} ${dm[2]}`.toUpperCase(), country: 'GB' };
  }
  const moveIn = t('move_in', 4);
  const style = STYLES.includes(t('style', 20).toLowerCase()) ? t('style', 20).toLowerCase() : 'heritage';

  // Claim the voucher atomically, then create the order.
  const claim = await env.DB.prepare(`UPDATE vouchers SET status = 'redeeming', redeemed_at = ? WHERE code = ? AND status = 'active'`).bind(now(), code).run();
  if (!claim.meta?.changes) return out(400, { ok: false, field: 'code', error: 'This voucher has already been used.' });
  let order;
  try {
    order = await createOrder(env, {
      source: 'voucher', external_ref: `voucher-${code}`, email, name, product: v.product, amount_pence: 0,
      address: [line1, line2, town, pc].filter(Boolean).join(', '), message: t('message', 220), move_in: /^\d{4}$/.test(moveIn) ? moveIn : '',
      style, ship_json: JSON.stringify(ship),
    });
  } catch (e) {
    await env.DB.prepare(`UPDATE vouchers SET status = 'active', redeemed_at = NULL WHERE code = ?`).bind(code).run();
    await logEvent(env, null, 'voucher_redeem_error', { code, error: e.message });
    return out(500, { ok: false, error: 'Sorry, something went wrong on our side. Please try again in a few minutes, or email hello@housealmanac.co.uk.' });
  }
  await env.DB.prepare(`UPDATE vouchers SET status = 'redeemed', order_id = ? WHERE code = ?`).bind(order.id, code).run();
  await logEvent(env, order.id, 'voucher_redeemed', { code });
  const street = [line1, town].filter(Boolean).join(', ');
  await sendMail(env, {
    to: email, orderId: order.id, subject: `Your House Almanac order ${order.id}`,
    text: `Hi ${firstName(name)},

Your gift voucher${v.from_name ? ` from ${v.from_name}` : ''} is redeemed, and we've started researching ${street}.

You'll get a proof by email within 2 working days. Check it carefully, then reply "approved" or tell us what to change. Nothing is printed until you approve it.

Order: ${order.id}
Print: ${v.product === 'framed' ? 'Framed A3, black frame (white or natural wood on request when you approve)' : 'Unframed A3 print'}

Best wishes,
Reece
House Almanac · ${BRAND.site.replace('https://', '')}`,
  });
  return out(200, { ok: true, order: order.id, street });
}

// For the inbox: a sender's vouchers, so the assistant can resend a code or refund an unused one.
export async function vouchersFor(env, email) {
  return (await env.DB.prepare(`SELECT code, product, status, created_at, expires_at, session_id, recipient FROM vouchers WHERE lower(buyer_email) = ? ORDER BY created_at DESC LIMIT 5`).bind(String(email).toLowerCase()).all()).results;
}
