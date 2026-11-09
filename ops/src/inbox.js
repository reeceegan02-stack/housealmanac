// Handles mail to hello@housealmanac.co.uk: keeps a copy in Gmail, then answers or acts on it.
import PostalMime from 'postal-mime';
import { BRAND, ensureSchema, getOrder, updateOrder, logEvent, extractJson, now, fileUrl, kvGet, kvSet } from './util.js';
import { claude, MODELS, parseJson } from './claude.js';
import { KB } from './kb.js';
import { sendMail, approvedEmail, firstName } from './mail.js';
import { createPrintOrder } from './prodigi.js';
import { stripeGet, stripePost } from './stripe.js';
import { startOrderWorkflow } from './orders.js';
import { agentPayLink } from './agents.js';

const FRAMED_LINK = 'https://buy.stripe.com/4gM14p7UJfBSffW9512wU00';
const IGNORE_FROM = /(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?@|bounce|@stripe\.com|@prodigi\.com|@cloudflare\.com|@etsy\.com|@google\.com|@github\.com)/i;

export async function handleInbound(message, env, ctx) {
  await ensureSchema(env);
  const raw = await new Response(message.raw).arrayBuffer();
  // Keep Reece's copy of everything.
  let forwarded = false;
  if (env.FORWARD_TO) {
    try { await message.forward(env.FORWARD_TO); forwarded = true; } catch (e) { console.error('forward failed', e); }
  }
  const mail = await PostalMime.parse(raw);
  const from = (mail.from?.address || message.from || '').toLowerCase();
  const subject = mail.subject || '';
  const body = stripQuoted(mail.text || htmlToText(mail.html || '')).slice(0, 6000);
  const autoSubmitted = (message.headers.get('auto-submitted') || '').toLowerCase();
  const precedence = (message.headers.get('precedence') || '').toLowerCase();

  if (from === BRAND.from || from.endsWith('@housealmanac.co.uk')) { // our own copies
    await logEvent(env, null, 'inbox_own', { subject, forwarded });
    return;
  }
  if (/mailer-daemon|postmaster/i.test(from) || /undeliver|delivery status notification|returned mail|delivery failure/i.test(subject)) {
    await handleBounce(env, (mail.text || htmlToText(mail.html || '')).toLowerCase(), subject);
    return;
  }
  if (IGNORE_FROM.test(from) || (autoSubmitted && autoSubmitted !== 'no') || /bulk|list|junk/.test(precedence)) {
    await logEvent(env, null, 'inbox_ignored', { from, subject });
    return;
  }

  await logEvent(env, null, 'inbox', { from, subject, chars: body.length, forwarded });

  // 0a. Reece replying to an ACTION NEEDED email: his reply goes to the customer from hello@.
  if (env.FORWARD_TO && from === env.FORWARD_TO.toLowerCase() && /ACTION NEEDED: reply to/i.test(subject)) {
    if (await relayOwnerReply(env, subject, body)) return;
  }

  // 0. Reece forwarding an Etsy "You made a sale" email (stopgap until the Etsy API is connected).
  const fullText = (mail.text || htmlToText(mail.html || '')).slice(0, 20000);
  if (env.FORWARD_TO && from === env.FORWARD_TO.toLowerCase() && /etsy/i.test(fullText) && /(made a sale|order number|order #|receipt|transaction)/i.test(fullText)) {
    return handleEtsyForward(env, fullText, subject);
  }

  // 1. Customer order?
  const idMatch = subject.match(/\b(HA-[A-Z0-9]{6})\b/) || body.match(/\b(HA-[A-Z0-9]{6})\b/);
  let order = idMatch ? await getOrder(env, idMatch[1]) : null;
  if (order && order.source === 'agent-preview') order = null; // office previews are handled with the agency's mail
  if (!order) {
    order = await env.DB.prepare(`SELECT * FROM orders WHERE lower(email) = ? AND source != 'agent-preview' AND status NOT IN ('cancelled','delivered') ORDER BY created_at DESC LIMIT 1`).bind(from).first();
  }
  if (!order) {
    order = await env.DB.prepare(`SELECT * FROM orders WHERE source LIKE 'agent-%' AND source != 'agent-preview' AND lower(json_extract(ship_json,'$.agent_email')) = ? AND status NOT IN ('cancelled','delivered') ORDER BY created_at DESC LIMIT 1`).bind(from).first();
  }
  if (order) return handleOrderMail(env, order, { from, subject, body, attachments: mail.attachments || [] });

  // 2. Estate agent prospect?
  const domain = from.split('@')[1] || '';
  const prospect = await env.DB.prepare(`SELECT * FROM prospects WHERE lower(email) = ? OR (? != '' AND lower(email) LIKE ?)`).bind(from, domain, '%@' + domain).first();
  if (prospect) return handleAgentMail(env, prospect, { from, subject, body, images: (mail.attachments || []).filter(a => /^image\/(png|jpe?g|gif|webp|svg)/.test(a.mimeType || '')) });

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
{"intent": "approve" | "changes" | "cancel" | "damaged" | "question" | "needs_decision" | "thanks" | "other",
 "suggested_answer": "for needs_decision: what you'd suggest Reece replies",
 "change_request": "if intent is changes: the exact changes requested, else empty",
 "reply": "the reply to send (empty if intent is approve, changes or thanks, since those get standard replies)"}
"approve" only if they clearly approve the proof as it is. If they approve but also ask for any change, that's "changes".
"needs_decision" = anything the policies don't cover or that needs the owner (refund or compensation after approval, complaints, cancellation after printing, legal or data requests, anything you're unsure of).` }],
  });
  const c = await parseJson(env, text);
  await logEvent(env, order.id, 'inbox_classified', c);

  // Agent sent their logo (explicitly, i.e. replying to a proof) or a reviews link: add them and re-render once.
  if (order.source.startsWith('agent-') && ['proof_sent', 'needs_attention'].includes(order.status) && c.intent !== 'changes') {
    const ship = JSON.parse(order.ship_json || '{}');
    const domain = String(ship.agent_domain || m.from.split('@')[1] || '').toLowerCase();
    const imgs = m.attachments.filter(a => /^image\//.test(a.mimeType || '') && !/inline/i.test(a.disposition || ''));
    const wantsLogo = /logo/i.test(m.body) && imgs.length;
    const review = (m.body.match(REVIEW_RE) || [])[0];
    const prevReview = await kvGet(env, 'review-' + domain);
    let branded = false;
    if (wantsLogo && await saveAgentLogo(env, domain, imgs, true)) branded = true;
    if (review && review !== prevReview) { await kvSet(env, 'review-' + domain, review); branded = true; }
    if (branded) {
      const rev = (order.revision || 0) + 1;
      await updateOrder(env, order.id, { revision: rev, status: 'revising', change_notes: '' });
      await startOrderWorkflow(env, order.id, 'rerender', rev);
      await sendMail(env, { to: m.from, orderId: order.id, subject: m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`, fromName: 'Reece Egan-Sheath | House Almanac',
        text: `Hi,\n\nThank you. We're adding ${wantsLogo ? 'your logo' : ''}${wantsLogo && review ? ' and ' : ''}${review ? 'the QR code to your reviews' : ''} now and will send you the updated proof shortly.\n\nBest wishes,\nReece\nHouse Almanac` });
      return;
    }
  }

  if (c.intent === 'approve' && order.source === 'partner-proof' && ['proof_sent', 'needs_attention'].includes(order.status) && order.file_key) {
    // Free digital print for a press contact or partner: if they'd like it framed, send the £89 link; payment prints it.
    const u = new URL(FRAMED_LINK);
    u.searchParams.set('client_reference_id', order.id);
    u.searchParams.set('prefilled_email', m.from);
    await updateOrder(env, order.id, { status: 'awaiting_payment' });
    await sendMail(env, {
      to: m.from, orderId: order.id, subject: m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`, fromName: 'Reece Egan-Sheath | House Almanac',
      text: `Hi,\n\nGreat. Framed (black frame, ready to hang) and delivered it's £89, here:\n${u}\n\nYou can skip the address box at checkout; we already have it. As soon as it's paid it goes to print and arrives in 3 to 5 working days.\n\nBest wishes,\nReece\nHouse Almanac`,
    });
    return;
  }
  if (c.intent === 'approve' && order.source === 'agent-proof' && ['proof_sent', 'needs_attention'].includes(order.status) && order.file_key) {
    // Free digital proof for an agent: approval means "we'd like it", so send the £75 payment link.
    const link = await agentPayLink(env, order.id, m.from);
    await updateOrder(env, order.id, { status: 'awaiting_payment' });
    await sendMail(env, {
      to: m.from, orderId: order.id, subject: m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`, fromName: 'Reece Egan-Sheath | House Almanac',
      text: `Hi,

Great, thank you. To have it printed, framed and delivered to your branch, it's ${link.includes('prefilled_promo_code') ? '£65 with your agency discount' : '£75'} here (card, Apple Pay or Google Pay):
${link}

As soon as it's paid we send it to print, and it's dispatched within 2 to 4 working days with tracking. Your receipt comes from Stripe.

Best wishes,
Reece
House Almanac`,
    });
    return;
  }
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
  if (c.intent === 'needs_decision') return escalate(env, m, order, c.suggested_answer);
  if (c.reply) await sendMail(env, { to: m.from, orderId: order.id, subject: m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`, text: c.reply });
}

async function handleAgentMail(env, prospect, m) {
  const { samplesStatus } = await import('./outreach.js');
  const samples = await samplesStatus(env);
  const domain0 = (prospect.domain || prospect.email.split('@')[1] || '').toLowerCase();
  const preview = await env.DB.prepare(`SELECT * FROM orders WHERE source = 'agent-preview' AND lower(json_extract(ship_json,'$.agent_domain')) = ? AND status IN ('proof_sent','awaiting_payment','revising','needs_attention') ORDER BY created_at DESC LIMIT 1`).bind(domain0).first();
  const legacy = !preview && JSON.parse(prospect.office_json || '{}').offer === 'buyer_sample'; // emailed before office previews: offered a free framed print for a buyer
  const offer = preview
    ? `Our first email attached a free digital House Almanac print of their own office street (${preview.address}). ${samples.left > 0 ? 'We offered to frame it and send it to their branch free of charge.' : 'Framed for their branch it is £75 delivered.'} For their buyers: they send a buyer's new address, we email a free proof, and the framed print is £75 delivered to their branch.`
    : legacy && samples.left > 0
      ? `We offered this agency one free framed print for a buyer completing with them (${samples.left} free framed samples left in total).`
      : `For their buyers we offer a free digital proof; the framed print is then £75 delivered to their branch. Don't offer a free framed print.`;
  const { text } = await claude(env, {
    model: MODELS.research, maxTokens: 1500,
    system: `You handle email from estate agents for House Almanac, replying as Reece. Business facts:\n${KB}\n\n${offer} Be warm, brief, professional, British English, plain text. Never offer prices below £65 per print.`,
    messages: [{ role: 'user', content: `Agency: ${prospect.agency} (${prospect.email}), status ${prospect.status}.
Email from ${m.from}, subject "${m.subject}", ${m.images.length} image attachment(s):
"""${m.body}"""

JSON only:
{"intent": "office_print_yes" | "office_print_changes" | "sample_with_details" | "interested" | "question" | "not_interested" | "other",
 "change_request": "for office_print_changes: the exact changes they want to their office print",
 "sample": {"buyer_new_address": "", "completion_date": "", "message_on_print": "", "branch_name": "", "branch_line1": "", "branch_line2": "", "branch_city": "", "branch_postcode": "", "review_url": ""},
 "reply": "reply to send; if they want the sample/proof but details are missing, ask for: buyer's new address, completion date, the message for the print (e.g. 'Welcome home, Sam & Alex, from everyone at <agency>'), the branch delivery address, and optionally their logo (attached) and a link to their Google reviews page for the QR code. Empty if not_interested."}
"office_print_yes" = they want the framed print of their office (e.g. "yes", "yes please", "we'd love it"). "office_print_changes" = they want changes to the office print first.
"sample_with_details" = they sent a buyer's new address with postcode and the branch postcode.` }],
  });
  const c = await parseJson(env, text);
  await logEvent(env, null, 'agent_mail', { agency: prospect.agency, intent: c.intent });

  if (c.intent === 'free_print_request' && /[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i.test(c.address || '')) {
    const recent = (await env.DB.prepare(`SELECT count(*) n FROM orders WHERE source = 'partner-proof' AND created_at >= ?`).bind(new Date(Date.now() - 7 * 86400e3).toISOString()).first()).n;
    if (recent >= 10) return escalate(env, m, null, 'Free digital print request over the weekly limit of 10; make it anyway if worthwhile.');
    const { createOrder } = await import('./orders.js');
    const order = await createOrder(env, { source: 'partner-proof', email: m.from, name: m.name || '', product: 'framed', amount_pence: 0, address: c.address, message: '', style: 'heritage', ship_json: '{}', external_ref: null });
    await sendMail(env, { to: m.from, orderId: order.id, subject: reSubject, fromName: 'Reece Egan-Sheath | House Almanac',
      text: `Hi${m.name ? ' ' + m.name.split(' ')[0] : ''},\n\nLovely, thank you. I'm researching ${c.address.split(',').slice(0, 2).join(',')} now and will email you the print within 2 working days.\n\nBest wishes,\nReece\nHouse Almanac` });
    return;
  }
  if (c.intent === 'not_interested') {
    await env.DB.prepare(`UPDATE prospects SET status = 'opted_out', last_contact = ?, followup_due = NULL WHERE email = ?`).bind(now(), prospect.email).run();
    return;
  }
  const s = c.sample || {};
  const domain = prospect.domain || (prospect.email.split('@')[1] || '').toLowerCase();
  await saveAgentLogo(env, domain, m.images);
  if (s.review_url) await kvSet(env, 'review-' + domain, s.review_url);

  const reSubject = m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`;
  if (c.intent === 'office_print_yes' && preview && preview.file_key && ['proof_sent', 'needs_attention'].includes(preview.status)) {
    if (samples.left > 0) {
      await updateOrder(env, preview.id, { source: 'agent-sample', status: 'approved' });
      try {
        const po = await createPrintOrder(env, { ...preview, source: 'agent-sample' }, fileUrl(env, preview.file_key));
        await updateOrder(env, preview.id, { status: 'printing', prodigi_id: po.id });
        await logEvent(env, preview.id, 'prodigi_order', { id: po.id, office_sample: true });
      } catch (e) {
        await updateOrder(env, preview.id, { status: 'needs_attention', notes: 'Prodigi order failed: ' + e.message });
        await alert(env, `Prodigi order failed for ${preview.id}`, e.message);
      }
      await env.DB.prepare(`UPDATE prospects SET status = 'sample_in_progress', samples_used = samples_used + 1, last_contact = ?, followup_due = NULL WHERE email = ?`).bind(now(), prospect.email).run();
      await sendMail(env, { to: m.from, subject: reSubject, fromName: 'Reece Egan-Sheath | House Almanac', orderId: preview.id,
        text: `Hi,\n\nLovely, it's gone to print. It will arrive at your branch framed and ready to hang in 3 to 5 working days, and I'll email you the tracking when it ships.\n\nWhen you have a buyer completing, just send me their new address and the message you'd like on it, and I'll email you a free proof of theirs.\n\nBest wishes,\nReece\nHouse Almanac` });
    } else {
      const link = await agentPayLink(env, preview.id, m.from);
      await updateOrder(env, preview.id, { status: 'awaiting_payment' });
      await env.DB.prepare(`UPDATE prospects SET status = 'interested', last_contact = ?, followup_due = NULL WHERE email = ?`).bind(now(), prospect.email).run();
      await sendMail(env, { to: m.from, subject: reSubject, fromName: 'Reece Egan-Sheath | House Almanac', orderId: preview.id,
        text: `Hi,\n\nGreat. Framed and delivered to your branch it's £75, here (card, Apple Pay or Google Pay):\n${link}\n\nAs soon as it's paid it goes to print and arrives in 3 to 5 working days.\n\nBest wishes,\nReece\nHouse Almanac` });
      await overCapAlert(env, prospect.agency);
    }
    return;
  }
  if (c.intent === 'office_print_changes' && preview && c.change_request) {
    const rev = (preview.revision || 0) + 1;
    await updateOrder(env, preview.id, { revision: rev, change_notes: c.change_request, status: 'revising', ship_json: JSON.stringify({ ...JSON.parse(preview.ship_json || '{}'), agent_email: m.from }) });
    await startOrderWorkflow(env, preview.id, 'revise', rev);
    await sendMail(env, { to: m.from, subject: reSubject, fromName: 'Reece Egan-Sheath | House Almanac', text: `Hi,\n\nOf course. I'm making those changes now and will send you the updated version shortly.\n\nBest wishes,\nReece\nHouse Almanac` });
    return;
  }

  if (c.intent === 'sample_with_details' && s.buyer_new_address && s.branch_postcode) {
    const free = legacy && samples.left > 0;
    const { createOrder } = await import('./orders.js');
    const order = await createOrder(env, {
      source: free ? 'agent-sample' : 'agent-proof', email: m.from, name: prospect.agency, product: 'framed', amount_pence: 0,
      address: s.buyer_new_address, message: s.message_on_print || `Welcome home, from everyone at ${prospect.agency}`,
      move_in: (s.completion_date || '').match(/\d{4}/)?.[0] || String(new Date().getFullYear()), style: 'heritage',
      ship_json: JSON.stringify({ name: s.branch_name || prospect.agency, line1: s.branch_line1, line2: s.branch_line2, city: s.branch_city, postcode: s.branch_postcode, agent_email: m.from, agent_domain: domain, review_url: s.review_url || undefined }),
      external_ref: null,
    });
    await env.DB.prepare(`UPDATE prospects SET status = ?, samples_used = samples_used + ?, last_contact = ?, followup_due = NULL WHERE email = ?`)
      .bind(free ? 'sample_in_progress' : 'proof_in_progress', free ? 1 : 0, now(), prospect.email).run();
    const street = s.buyer_new_address.split(',').slice(0, 2).join(',');
    await sendMail(env, {
      to: m.from, subject: m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`, fromName: 'Reece Egan-Sheath | House Almanac',
      text: free
        ? `Hi,\n\nThank you, that's everything we need. We're researching ${street} now and will email you a proof within 2 working days (reference ${order.id}). Once you approve it, the framed print will be delivered to your branch, free of charge.\n\nBest wishes,\nReece\nHouse Almanac`
        : `Hi,\n\nThank you. We're researching ${street} now and will email you a free proof within 2 working days (reference ${order.id}). If you'd like it printed and framed for your buyer, it's £75 delivered to your branch, and you can approve and pay in one step when the proof arrives.\n\nBest wishes,\nReece\nHouse Almanac`,
    });
    if (!free) await overCapAlert(env, prospect.agency);
    return;
  }
  await env.DB.prepare(`UPDATE prospects SET status = ?, last_contact = ?, followup_due = NULL WHERE email = ?`).bind(c.intent === 'interested' || c.intent === 'sample_with_details' ? 'interested' : 'replied', now(), prospect.email).run();
  if (c.reply) await sendMail(env, { to: m.from, subject: m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`, text: c.reply, fromName: 'Reece Egan-Sheath | House Almanac' });
}

// Keep the agency's logo (the largest image they sent) for their prints.
async function saveAgentLogo(env, domain, images, replace = false) {
  if (!domain || !images?.length) return false;
  const size = (a) => a.content?.byteLength || a.content?.length || 0;
  const best = images.filter(a => size(a) > 2000 && size(a) < 3e6).sort((a, b) => size(b) - size(a))[0];
  if (!best) return false;
  if (!replace && await env.FILES.get('logo-' + domain, 'stream').then(r => { if (r) r.cancel(); return !!r; })) return false;
  const bytes = best.content instanceof ArrayBuffer ? new Uint8Array(best.content) : best.content;
  await env.FILES.put('logo-' + domain, bytes, { metadata: { type: best.mimeType || 'image/png' } });
  await logEvent(env, null, 'agent_logo_saved', { domain, type: best.mimeType, bytes: bytes.length });
  return true;
}

const REVIEW_RE = /https?:\/\/[^\s<>"')]*(g\.page|google\.[a-z.]+\/maps|search\.google\.com\/local|maps\.app\.goo\.gl|g\.co\/kgs|trustpilot\.com|allagents\.co\.uk|reviews\.co\.uk|feefo)[^\s<>"')]*/i;

// Tell Reece when agencies keep asking for free framed samples after they've run out.
async function overCapAlert(env, agency) {
  const n = Number(await kvGet(env, 'over_cap_requests') || 0) + 1;
  await kvSet(env, 'over_cap_requests', String(n));
  if (n % 3 !== 0) return;
  await sendMail(env, {
    to: BRAND.from, bcc: false, subject: `Decision: ${n} agencies wanted samples after the free ones ran out`,
    text: `The latest was ${agency}. Since the free framed samples ran out, ${n} agencies have asked for one; each got a free digital proof and the option to buy the framed print at £75.\n\nEach extra free framed sample costs £51.30. If you'd like to fund more, tell Claude how many (e.g. "approve 5 more samples").`,
  });
}

// A bounced outreach email: stop emailing that address.
async function handleBounce(env, text, subject) {
  const { results } = await env.DB.prepare(`SELECT email FROM prospects WHERE status IN ('emailed','followed_up') AND last_contact >= ?`).bind(new Date(Date.now() - 10 * 86400e3).toISOString()).all();
  const hit = results.filter(r => text.includes(r.email));
  for (const r of hit) await env.DB.prepare(`UPDATE prospects SET status = 'bounced', followup_due = NULL WHERE email = ?`).bind(r.email).run();
  await logEvent(env, null, 'bounce', { subject, prospects: hit.map(r => r.email) });
}

async function handleGeneral(env, m) {
  const { text } = await claude(env, {
    model: MODELS.research, maxTokens: 1000,
    system: `You handle the inbox for House Almanac, replying as Reece. Business facts:\n${KB}\n\nWarm, brief, British English, plain text.`,
    messages: [{ role: 'user', content: `Email from ${m.name || ''} <${m.from}>, subject "${m.subject}":
"""${m.body}"""

JSON only: {"intent": "enquiry" | "free_print_request" | "needs_decision" | "not_interested" | "supplier_or_sales_pitch" | "spam" | "other", "address": "for free_print_request: the full address (with postcode) they want the print made for, if given", "reply": "reply to send for genuine customer or trade enquiries, else empty", "suggested_answer": "for needs_decision: what you would suggest Reece replies, else empty"}
"free_print_request" = a press contact, blogger, group or business partner replying to our pitch and taking up our offer of a free digital print of a street of their choice (if they gave no address, the reply should ask for it).
"needs_decision" = anything the business facts and policies don't cover or that needs the owner: complaints asking for money or compensation, requests outside the policies, press or media, partnerships, wholesale or bulk deals, legal or data-protection requests, anything you're unsure of.` }],
  });
  const c = await parseJson(env, text);
  await logEvent(env, null, 'general_mail', { from: m.from, intent: c.intent });
  const reSubject = m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`;
  if (c.intent === 'not_interested') { await kvSet(env, 'suppress_' + m.from.toLowerCase(), new Date().toISOString()); return; } // e.g. "no thanks" to a press pitch
  if (c.intent === 'needs_decision') return escalate(env, m, null, c.suggested_answer);
  if (c.intent === 'enquiry' && c.reply) await sendMail(env, { to: m.from, subject: reSubject, text: c.reply });
}

// Outside policy: send a holding reply and ask Reece (via hello@ -> Gmail) for a decision.
async function escalate(env, m, order, suggestion) {
  const name = (m.name || order?.name || '').split(' ')[0];
  await sendMail(env, {
    to: m.from, orderId: order?.id, subject: m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`,
    text: `Hi${name ? ' ' + name : ''},\n\nThank you for your email. I want to give you a proper answer on this, so I'll come back to you within one working day.\n\nBest wishes,\nReece\nHouse Almanac`,
  });
  await sendMail(env, {
    to: BRAND.from, bcc: false, orderId: order?.id,
    subject: `ACTION NEEDED: reply to ${m.from}${order ? ` (order ${order.id})` : ''}: ${m.subject}`.slice(0, 180),
    text: `This email needs a decision, so they've had a holding reply ("I'll come back to you within one working day").\n\nFrom: ${m.from}\nSubject: ${m.subject}\n\n---\n${String(m.body).slice(0, 3000)}\n---\n\nSuggested answer:\n${suggestion || '(none)'}\n\nTo answer: just reply to this email with what you'd like to say. Your reply is sent to them from hello@ (with your sign-off added if you leave it off).`,
  });
  await logEvent(env, order?.id || null, 'escalated', { from: m.from, subject: m.subject });
}

// Reece answering an ACTION NEEDED email: send his words to the customer from hello@.
// Only to someone we escalated in the last 14 days, so this can't be used to email anyone else.
async function relayOwnerReply(env, subject, body) {
  const m = subject.match(/reply to ([^\s:()]+@[^\s:()]+)(?: \(order (HA-[A-Z0-9]{6})\))?: (.*)$/i);
  if (!m) return false;
  const [, to, orderId, origSubject] = m;
  const ok = await env.DB.prepare(`SELECT 1 FROM events WHERE kind = 'escalated' AND lower(json_extract(detail, '$.from')) = lower(?) AND at >= ? LIMIT 1`)
    .bind(to, new Date(Date.now() - 14 * 86400e3).toISOString()).first();
  if (!ok || !body.trim()) return false;
  const text = /best wishes|kind regards|thanks,|cheers/i.test(body.slice(-120)) ? body.trim() : `${body.trim()}\n\nBest wishes,\nReece\nHouse Almanac`;
  await sendMail(env, { to, orderId: orderId || null, subject: origSubject.startsWith('Re:') ? origSubject : `Re: ${origSubject}`, text, fromName: 'Reece Egan-Sheath | House Almanac' });
  await logEvent(env, orderId || null, 'owner_reply_sent', { to });
  return true;
}

async function handleEtsyForward(env, text, subject) {
  const { text: out } = await claude(env, {
    model: MODELS.research, maxTokens: 1200,
    messages: [{ role: 'user', content: `This is an Etsy sale notification for our shop, forwarded by the shop owner. Extract the order.
"""${text}"""

JSON only:
{"is_etsy_sale": true|false, "receipt_id": "Etsy order/receipt number, digits only", "buyer_name": "", "buyer_email": "",
 "ship": {"name": "", "line1": "", "line2": "", "city": "", "county": "", "postcode": "", "country": "GB"},
 "print_address": "the home address the buyer wants the print made for (from the personalisation if given, else the shipping address), incl. postcode",
 "message": "the message for the print from the personalisation, else empty",
 "style": "heritage|modern|midnight|sage (default heritage)", "framed": true|false, "total_gbp": 0}` }],
  });
  const o = await parseJson(env, out);
  const receipt = String(o.receipt_id || '').replace(/\D/g, '');
  if (!o.is_etsy_sale || !receipt || !(o.ship?.postcode || o.print_address)) {
    return alert(env, 'forwarded Etsy email could not be read', `Subject: ${subject}\n\nCheck the order in Etsy and create it with /admin/test-order (source etsy) if needed.`);
  }
  const ship = o.ship || {};
  const { createOrder } = await import('./orders.js');
  const order = await createOrder(env, {
    source: 'etsy', external_ref: 'etsy-' + receipt, email: o.buyer_email || null, name: o.buyer_name || ship.name,
    product: o.framed === false ? 'unframed' : 'framed', amount_pence: Math.round((Number(o.total_gbp) || 0) * 100),
    address: o.print_address || [ship.line1, ship.line2, ship.city, ship.postcode].filter(Boolean).join(', '),
    message: o.message || '', move_in: (o.message || '').match(/\b(19|20)\d{2}\b/)?.[0] || '', style: String(o.style || 'heritage').toLowerCase(),
    ship_json: JSON.stringify({ ...ship, etsy_receipt: receipt }),
  });
  await logEvent(env, order.id, 'etsy_forward', { receipt, isNew: order.isNew });
  if (order.isNew) {
    await sendMail(env, {
      to: BRAND.from, bcc: false, subject: `Etsy order ${receipt} received (${order.id})`,
      text: `Got it. Etsy order ${receipt} for ${order.address} is now order ${order.id}. It will be researched, checked and sent to print automatically. When the "on its way" email with tracking arrives, mark the order as dispatched in Etsy (this becomes automatic once the Etsy API is connected).`,
    });
  }
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
