// Outbound email from hello@housealmanac.co.uk (Cloudflare Email Service) and message templates.
import { AGENT_UNFRAMED } from './pricing.js';
import { BRAND, esc, base64ToBytes, logEvent } from './util.js';

// inlineImage: { bytes, filename, url } shows the picture in the email body (cid) and adds a "view it online" link,
// so it can be seen even where attachments are stripped or blocked.
export async function sendMail(env, { to, subject, text, html, attachments, inlineImage, orderId, fromName = 'House Almanac', bcc = true, dedupeDays = 0 }) {
  // Outreach guard: never send the same email to the same address twice within dedupeDays (e.g. on a retry).
  if (dedupeDays) {
    const dup = await env.DB.prepare(`SELECT 1 FROM events WHERE kind = 'email_sent' AND lower(json_extract(detail, '$.to')) = lower(?) AND json_extract(detail, '$.subject') = ? AND at >= ? LIMIT 1`)
      .bind(to, subject, new Date(Date.now() - dedupeDays * 86400e3).toISOString()).first();
    if (dup) { await logEvent(env, orderId, 'email_skipped_duplicate', { to, subject }); return { skipped: 'duplicate' }; }
  }
  const msg = {
    to,
    from: { email: BRAND.from, name: fromName },
    replyTo: BRAND.from,
    subject,
    text: inlineImage?.url ? `${text}\n\n(If the picture doesn't show, view it here: ${inlineImage.url})` : text,
    html: html || textToHtml(text) + (inlineImage ? `<p style="margin:18px 0 6px"><img src="cid:print" alt="${esc(inlineImage.filename)}" width="460" style="max-width:100%;height:auto;border:1px solid #ddd2bf"></p>${inlineImage.url ? `<p style="font-family:Arial,sans-serif;font-size:13px;color:#62584c">Can't see the picture? <a href="${esc(inlineImage.url)}" style="color:#9c3f2a">View it here</a>.</p>` : ''}` : ''),
  };
  if (bcc && to !== BRAND.from) msg.bcc = BRAND.from; // keep a copy in the inbox
  // Attachments go to the Email Service as raw bytes: base64 strings arrived as empty files (found 10 Nov 2026).
  const atts = [...(attachments || [])];
  if (inlineImage) atts.push({ content: inlineImage.bytes, filename: inlineImage.filename, type: inlineImage.type || 'image/jpeg', disposition: 'inline', contentId: 'print' });
  if (atts.length) msg.attachments = atts.map(a => ({ ...a, content: typeof a.content === 'string' ? base64ToBytes(a.content) : a.content }));
  const res = await env.EMAIL.send(msg);
  await logEvent(env, orderId, 'email_sent', { to, subject, id: res?.messageId });
  return res;
}

const paraHtml = (p, style = 'margin:0 0 14px') => `<p style="${style}">${esc(p).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+?)([).,;:!?]*)(?=\s|<|$)/g, '<a href="$1" style="color:#9c3f2a">$1</a>$2')}</p>`;

// The sign-off in every template ("Best wishes,\nReece\nHouse Almanac · ...") becomes a designed signature in the
// HTML part; the plain-text part keeps the simple version. Anything after it (e.g. the opt-out line) is set small.
const SIG_RE = /\n\n((?:Best wishes|Kind regards|Many thanks|Thanks|Best|Cheers|Warm regards|Regards),?)[ \t]*\n(Reece[^\n]*)((?:\n(?:House Almanac|hello@|(?:https?:\/\/)?(?:www\.)?housealmanac\.co\.uk)[^\n]*)*)(?=\n\n|\s*$)/i;

export function signatureHtml(signoff = 'Best wishes,', nameLine = 'Reece', when = new Date()) {
  const name = nameLine.replace(/[,|].*$/, '').trim() || 'Reece';
  const xmas = when < new Date('2026-12-25T00:00:00Z')
    ? `<div style="margin-top:6px;font:12px/1.4 Arial,Helvetica,sans-serif;color:#9c3f2a">${when < new Date('2026-12-10T00:00:00Z') ? 'Christmas: order by 9 December, or ' : 'Too late for Christmas delivery? '}<a href="https://housealmanac.co.uk/gift" style="color:#9c3f2a">give a gift voucher</a></div>` : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 10px;border-collapse:collapse">
<tr><td style="padding:0 0 14px;font:15px/1.55 Arial,Helvetica,sans-serif;color:#2a241e">${esc(signoff)}<br>${esc(name)}</td></tr>
<tr><td style="border-top:2px solid #9c3f2a;padding:14px 0 0">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
<td style="padding:0 14px 0 0;vertical-align:top"><a href="https://housealmanac.co.uk"><img src="https://housealmanac.co.uk/email-mark.png" width="48" height="48" alt="House Almanac" style="display:block;border:0;border-radius:9px"></a></td>
<td style="vertical-align:top;font:13px/1.5 Arial,Helvetica,sans-serif;color:#62584c">
<div style="font:bold 16px/1.3 Georgia,'Times New Roman',serif;color:#2a241e">House Almanac</div>
<div style="font:italic 13px/1.4 Georgia,'Times New Roman',serif;color:#62584c;margin-bottom:3px">The story of your home, framed.</div>
<div><a href="https://housealmanac.co.uk" style="color:#2a241e;text-decoration:none">housealmanac.co.uk</a> &nbsp;·&nbsp; <a href="mailto:hello@housealmanac.co.uk" style="color:#2a241e;text-decoration:none">hello@housealmanac.co.uk</a> &nbsp;·&nbsp; Manchester</div>
${xmas}</td></tr></table></td></tr></table>`;
}

export function textToHtml(text) {
  let t = String(text), sig = '', after = '';
  const m = t.match(SIG_RE);
  if (m) {
    sig = signatureHtml(m[1], m[2]);
    after = t.slice(m.index + m[0].length).trim();
    t = t.slice(0, m.index);
  }
  const paras = t.split(/\n{2,}/).filter(p => p.trim()).map(p => paraHtml(p));
  const tail = after ? after.split(/\n{2,}/).map(p => paraHtml(p, 'margin:10px 0 0;font-size:12px;color:#8a8073')).join('') : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#2a241e;max-width:600px">${paras.join('')}${sig}${tail}</div>`;
}

export const jpegAttachment = (bytes, filename) => ({ content: bytes, filename, type: 'image/jpeg', disposition: 'attachment' });

const sig = `Best wishes,
Reece
House Almanac · ${BRAND.site.replace('https://', '')}`;

export function orderReceivedEmail(order) {
  return {
    subject: `Your House Almanac order ${order.id}`,
    text: `Hi ${firstName(order.name)},

Thank you for your order. We've started researching ${order.address.split(',').slice(0, 2).join(',')}.

You'll get a proof by email within 2 working days. Check it carefully, then reply "approved" or tell us what to change. Nothing is printed until you approve it.

Order: ${order.id}
Print: ${order.product === 'framed' ? 'Framed A3, black frame' : 'Unframed A3 print'}
Style: ${cap(order.style || 'Heritage')}

${sig}`,
  };
}

export function proofEmail(order, data, revision) {
  return {
    subject: `Your proof is ready [${order.id}]${revision ? ` (version ${revision + 1})` : ''}`,
    text: `Hi ${firstName(order.name)},

${revision ? 'Here is the updated proof with your changes.' : `Here is the proof of your House Almanac print for ${data.title}.`} It's below (and attached) as a low-resolution image; the printed version is full A3 at 300 dpi, without the "PROOF" mark.

Please check:
- the spelling of names and your message
- the house number and street
- anything in the story or timeline you know to be different

${order.source === 'partner-proof'
  ? `It's yours to keep and share as a digital file. If you'd like it printed and framed (black frame, ready to hang, £89 delivered), just reply "yes" and I'll send a link. If you'd like anything changed, tell me what.`
  : order.source === 'agent-preview'
  ? `If you're happy with it, just reply "yes" and we'll frame it for your branch. If you'd like anything else changed, reply and tell us what.`
  : order.source === 'agent-proof'
  ? `If it's right and you'd like it printed for your buyer (£75 framed${AGENT_UNFRAMED ? ', or £39 as an unframed A3 print' : ''}, delivered to your branch), just reply "approved" and we'll send you the payment link. If you'd like changes, reply and tell us what to change.`
  : `If it's right, just reply "approved" and we'll print and dispatch it${order.source === 'agent-sample' ? ' to your branch' : ''}. If you'd like changes, reply and tell us what to change.`}${order.source && order.source.startsWith('agent-') ? `

Tip: reply with your logo attached and a link to your Google reviews page, and we'll add them to the print with a QR code.` : ''}

${sig}`,
  };
}

export function approvedEmail(order) {
  return {
    subject: `Approved, now printing [${order.id}]`,
    text: `Hi ${firstName(order.name)},

Thanks for approving your proof. Your print is now with our print studio and should be dispatched within 2 to 4 working days. We'll email you the tracking details as soon as it ships.

${sig}`,
  };
}

export function shippedEmail(order, tracking) {
  return {
    subject: `Your print is on its way [${order.id}]`,
    text: `Hi ${firstName(order.name)},

Your House Almanac print has been dispatched${tracking?.carrier ? ` with ${tracking.carrier}` : ''}.
${tracking?.url ? `\nTrack it here: ${tracking.url}\n` : tracking?.number ? `\nTracking number: ${tracking.number}\n` : ''}
We hope it looks wonderful on the wall. If anything arrives damaged, reply to this email with a photo and we'll send a replacement.

${sig}`,
  };
}

export function firstName(n) {
  const f = String(n || '').trim().split(/\s+/)[0];
  return f ? f[0].toUpperCase() + f.slice(1).toLowerCase() : 'there';
}
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
