// Handles mail to hello@housealmanac.co.uk: keeps a copy in Gmail, then answers or acts on it.
import PostalMime from 'postal-mime';
import { BRAND, ensureSchema, getOrder, updateOrder, logEvent, extractJson, now, fileUrl } from './util.js';
import { claude, MODELS } from './claude.js';
import { KB } from './kb.js';
import { sendMail, approvedEmail, firstName } from './mail.js';
import { createPrintOrder } from './prodigi.js';
import { stripeGet, stripePost } from './stripe.js';
import { startOrderWorkflow } from './orders.js';

const IGNORE_FROM = /(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?@|bounce|@stripe\.com|@prodigi\.com|@cloudflare\.com|@etsy\.com|@google\.com|@github\.com)/i;

export async function handleInbound(message, env, ctx) {
  await ensureSchema(env);
  const raw = await new Response(message.raw).arrayBuffer();
  // Keep Reece's copy of everything.
  if (env.FORWARD_TO) {
    try { await message.forward(env.FORWARD_TO); } catch (e) { console.error('forward failed', e); }
  }
  const mail = await PostalMime.parse(raw);
  const from = (mail.from?.address || message.from || '').toLowerCase();
  const subject = mail.subject || '';
  const body = stripQuoted(mail.text || htmlToText(mail.html || '')).slice(0, 6000);
  const autoSubmitted = (message.headers.get('auto-submitted') || '').toLowerCase();
  const precedence = (message.headers.get('precedence') || '').toLowerCase();

  if (from === BRAND.from || from.endsWith('@housealmanac.co.uk')) return; // our own copies
  if (IGNORE_FROM.test(from) || (autoSubmitted && autoSubmitted !== 'no') || /bulk|list|junk/.test(precedence)) {
    await logEvent(env, null, 'inbox_ignored', { from, subject });
    return;
  }

  await logEvent(env, null, 'inbox', { from, subject, chars: body.length });

  // 1. Customer order?
  const idMatch = subject.match(/\b(HA-[A-Z0-9]{6})\b/) || body.match(/\b(HA-[A-Z0-9]{6})\b/);
  let order = idMatch ? await getOrder(env, idMatch[1]) : null;
  if (!order) {
    order = await env.DB.prepare(`SELECT * FROM orders WHERE lower(email) = ? AND status NOT IN ('cancelled','delivered') ORDER BY created_at DESC LIMIT 1`).bind(from).first();
  }
  if (!order) {
    order = await env.DB.prepare(`SELECT * FROM orders WHERE source = 'agent-sample' AND lower(json_extract(ship_json,'$.agent_email')) = ? AND status NOT IN ('cancelled','delivered') ORDER BY created_at DESC LIMIT 1`).bind(from).first();
  }
  if (order) return handleOrderMail(env, order, { from, subject, body, attachments: mail.attachments || [] });

  // 2. Estate agent prospect?
  const domain = from.split('@')[1] || '';
  const prospect = await env.DB.prepare(`SELECT * FROM prospects WHERE lower(email) = ? OR (? != '' AND lower(email) LIKE ?)`).bind(from, domain, '%@' + domain).first();
  if (prospect) return handleAgentMail(env, prospect, { from, subject, body });

  // 3. General enquiry.
  return handleGeneral(env, { from, subject, body, name: mail.from?.name });
}

async function handleOrderMail(env, order, m) {
  const { text } = await claude(env, {
    model: MODELS.research, maxTokens: 1200,
    system: `You handle customer email for House Almanac. Business facts:\n${KB}\n\nWrite replies as Reece, warm and brief, British English, plain text, no markdown. Never promise anything outside the policies. If asked whether you are an AI, say replies are drafted with AI help and checked against our policies.`,
    messages: [{ role: 'user', content: `Order ${order.id}: status "${order.status}", product ${order.product}, address "${order.address}", customer ${order.name}.
Email from ${m.from}, subject "${m.subject}", ${m.attachments.length} attachment(s):
"""${m.body}"""

Classify the email and draft a reply. JSON only:
{"intent": "approve" | "changes" | "cancel" | "damaged" | "question" | "thanks" | "other",
 "change_request": "if intent is changes: the exact changes requested, else empty",
 "reply": "the reply to send (empty if intent is approve, changes or thanks, since those get standard replies)"}
"approve" only if they clearly approve the proof as it is. If they approve but also ask for any change, that's "changes".` }],
  });
  const c = extractJson(text);
  await logEvent(env, order.id, 'inbox_classified', c);

  if (c.intent === 'approve' && ['proof_sent', 'needs_attention'].includes(order.status) && order.file_key) {
    await updateOrder(env, order.id, { status: 'approved' });
    try {
      const po = await createPrintOrder(env, order, fileUrl(env, order.file_key));
      await updateOrder(env, order.id, { status: 'printing', prodigi_id: po.id });
      await logEvent(env, order.id, 'prodigi_order', { id: po.id, status: po.status?.stage });
      const t = approvedEmail(order);
      await sendMail(env, { to: m.from, subject: t.subject, text: t.text, orderId: order.id });
    } catch (e) {
      await updateOrder(env, order.id, { status: 'needs_attention', notes: 'Prodigi order failed: ' + e.message });
      await alert(env, `Prodigi order failed for ${order.id}`, e.message);
      await sendMail(env, { to: m.from, orderId: order.id, subject: `Re: ${m.subject}`, text: `Hi ${firstName(order.name)},\n\nThank you, approved. We're sending it to print now and will email tracking as soon as it ships.\n\nBest wishes,\nReece\nHouse Almanac` });
    }
    return;
  }
  if (c.intent === 'changes' && ['proof_sent', 'needs_attention', 'revising'].includes(order.status)) {
    const rev = (order.revision || 0) + 1;
    await updateOrder(env, order.id, { revision: rev, change_notes: c.change_request, status: 'revising' });
    await startOrderWorkflow(env, order.id, 'revise', rev);
    await sendMail(env, { to: m.from, orderId: order.id, subject: `Re: ${m.subject}`, text: `Hi ${firstName(order.name)},\n\nThanks, we're making those changes now and will send you an updated proof shortly.\n\nBest wishes,\nReece\nHouse Almanac` });
    return;
  }
  if (c.intent === 'cancel' && ['new', 'researching', 'revising', 'proof_sent', 'needs_attention'].includes(order.status) && order.source === 'stripe') {
    try {
      const s = await stripeGet(env, `/checkout/sessions/${order.external_ref}`);
      if (s.payment_intent) await stripePost(env, '/refunds', { payment_intent: s.payment_intent });
      await updateOrder(env, order.id, { status: 'cancelled' });
      await sendMail(env, { to: m.from, orderId: order.id, subject: `Re: ${m.subject}`, text: `Hi ${firstName(order.name)},\n\nNo problem, your order ${order.id} is cancelled and we've refunded you in full. It usually shows on your statement within 5 to 10 days.\n\nBest wishes,\nReece\nHouse Almanac` });
    } catch (e) {
      await alert(env, `Refund failed for ${order.id}`, e.message);
    }
    return;
  }
  if (c.intent === 'damaged' && ['printing', 'shipped', 'delivered'].includes(order.status)) {
    const hasPhoto = m.attachments.some(a => /image\//.test(a.mimeType || ''));
    const already = await env.DB.prepare(`SELECT count(*) n FROM events WHERE order_id = ? AND kind = 'replacement'`).bind(order.id).first();
    if (hasPhoto && !already.n && order.file_key) {
      try {
        const po = await createPrintOrder(env, { ...order, id: order.id + '-R', revision: 99 }, fileUrl(env, order.file_key));
        await logEvent(env, order.id, 'replacement', { prodigi: po.id });
        await sendMail(env, { to: m.from, orderId: order.id, subject: `Re: ${m.subject}`, text: `Hi ${firstName(order.name)},\n\nI'm so sorry it arrived damaged. Thank you for the photo. We've sent a replacement to print today and will email you the tracking when it ships. There's no need to send the damaged one back.\n\nBest wishes,\nReece\nHouse Almanac` });
        return;
      } catch (e) { await alert(env, `Replacement failed for ${order.id}`, e.message); }
    }
  }
  if (c.intent === 'thanks') return;
  if (c.reply) await sendMail(env, { to: m.from, orderId: order.id, subject: m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`, text: c.reply });
}

async function handleAgentMail(env, prospect, m) {
  const samplesLeft = Math.max(0, Number(env.FREE_SAMPLES_CAP || 5) - (await totalSamples(env)));
  const { text } = await claude(env, {
    model: MODELS.research, maxTokens: 1400,
    system: `You handle email from estate agents for House Almanac, replying as Reece. Business facts:\n${KB}\n\nWe emailed this agency offering one free framed sample print for a buyer completing with them (${samplesLeft} free samples left in total). Be warm, brief, professional, British English, plain text. Never offer prices below £65 per print.`,
    messages: [{ role: 'user', content: `Agency: ${prospect.agency} (${prospect.email}), status ${prospect.status}.
Email from ${m.from}, subject "${m.subject}":
"""${m.body}"""

JSON only:
{"intent": "sample_with_details" | "interested" | "question" | "not_interested" | "other",
 "sample": {"buyer_new_address": "", "completion_date": "", "message_on_print": "", "branch_name": "", "branch_line1": "", "branch_line2": "", "branch_city": "", "branch_postcode": ""},
 "reply": "reply to send; if they want the free sample but details are missing, ask for: buyer's new address, completion date, the message for the print (e.g. 'Welcome home, Sam & Alex, from everyone at <agency>'), and the branch delivery address. Empty if not_interested."}` }],
  });
  const c = extractJson(text);
  await logEvent(env, null, 'agent_mail', { agency: prospect.agency, intent: c.intent });

  if (c.intent === 'not_interested') {
    await env.DB.prepare(`UPDATE prospects SET status = 'opted_out', last_contact = ? WHERE email = ?`).bind(now(), prospect.email).run();
    return;
  }
  const s = c.sample || {};
  if (c.intent === 'sample_with_details' && s.buyer_new_address && s.branch_postcode && samplesLeft > 0) {
    const { createOrder } = await import('./orders.js');
    const order = await createOrder(env, {
      source: 'agent-sample', email: m.from, name: prospect.agency, product: 'framed', amount_pence: 0,
      address: s.buyer_new_address, message: s.message_on_print || `Welcome home, from everyone at ${prospect.agency}`,
      move_in: (s.completion_date || '').match(/\d{4}/)?.[0] || String(new Date().getFullYear()), style: 'heritage',
      ship_json: JSON.stringify({ name: s.branch_name || prospect.agency, line1: s.branch_line1, line2: s.branch_line2, city: s.branch_city, postcode: s.branch_postcode, agent_email: m.from }),
      external_ref: null,
    });
    await env.DB.prepare(`UPDATE prospects SET status = 'sample_in_progress', samples_used = samples_used + 1, last_contact = ? WHERE email = ?`).bind(now(), prospect.email).run();
    await sendMail(env, { to: m.from, subject: `Re: ${m.subject}`, text: `Hi,\n\nThank you, that's everything we need. We're researching ${s.buyer_new_address.split(',').slice(0, 2).join(',')} now and will email you a proof within 2 working days (reference ${order.id}). Once you approve it, the framed print will be delivered to your branch.\n\nBest wishes,\nReece\nHouse Almanac` });
    return;
  }
  await env.DB.prepare(`UPDATE prospects SET status = ?, last_contact = ? WHERE email = ?`).bind(c.intent === 'interested' || c.intent === 'sample_with_details' ? 'interested' : 'replied', now(), prospect.email).run();
  if (c.reply) await sendMail(env, { to: m.from, subject: m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`, text: c.reply, fromName: 'Reece Egan-Sheath | House Almanac' });
}

async function handleGeneral(env, m) {
  const { text } = await claude(env, {
    model: MODELS.research, maxTokens: 1000,
    system: `You handle the inbox for House Almanac, replying as Reece. Business facts:\n${KB}\n\nWarm, brief, British English, plain text.`,
    messages: [{ role: 'user', content: `Email from ${m.name || ''} <${m.from}>, subject "${m.subject}":
"""${m.body}"""

JSON only: {"intent": "enquiry" | "supplier_or_sales_pitch" | "spam" | "other", "reply": "reply to send for genuine customer or trade enquiries, else empty"}` }],
  });
  const c = extractJson(text);
  await logEvent(env, null, 'general_mail', { from: m.from, intent: c.intent });
  if (c.intent === 'enquiry' && c.reply) await sendMail(env, { to: m.from, subject: m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`, text: c.reply });
}

async function totalSamples(env) {
  const r = await env.DB.prepare(`SELECT count(*) n FROM orders WHERE source = 'agent-sample' AND status != 'cancelled'`).first();
  return r?.n || 0;
}

export async function alert(env, subject, detail) {
  await logEvent(env, null, 'alert', { subject, detail });
  await sendMail(env, { to: BRAND.from, bcc: false, subject: 'ACTION NEEDED: ' + subject, text: String(detail) });
}

function stripQuoted(t) {
  const lines = String(t).split(/\r?\n/);
  const out = [];
  for (const l of lines) {
    if (/^On .+wrote:$/.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l) || /^From: /.test(l)) break;
    if (l.startsWith('>')) continue;
    out.push(l);
  }
  return out.join('\n').trim();
}
function htmlToText(h) {
  return String(h).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
