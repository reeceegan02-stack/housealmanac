// Outbound email from hello@housealmanac.co.uk (Cloudflare Email Service) and message templates.
import { BRAND, esc, bytesToBase64, logEvent } from './util.js';

export async function sendMail(env, { to, subject, text, html, attachments, orderId, fromName = 'House Almanac', bcc = true }) {
  const msg = {
    to,
    from: { email: BRAND.from, name: fromName },
    replyTo: BRAND.from,
    subject,
    text,
    html: html || textToHtml(text),
  };
  if (bcc && to !== BRAND.from) msg.bcc = BRAND.from; // keep a copy in the inbox
  if (attachments && attachments.length) msg.attachments = attachments;
  const res = await env.EMAIL.send(msg);
  await logEvent(env, orderId, 'email_sent', { to, subject, id: res?.messageId });
  return res;
}

export function textToHtml(text) {
  const paras = String(text).split(/\n{2,}/).map(p => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#9c3f2a">$1</a>')}</p>`);
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#2a241e;max-width:600px">${paras.join('')}</div>`;
}

export const jpegAttachment = (bytes, filename) => ({ content: bytesToBase64(bytes), filename, type: 'image/jpeg', disposition: 'attachment' });

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

${revision ? 'Here is the updated proof with your changes.' : `Here is the proof of your House Almanac print for ${data.title}.`} It's attached as a low-resolution image; the printed version is full A3 at 300 dpi, without the "PROOF" mark.

Please check:
- the spelling of names and your message
- the house number and street
- anything in the story or timeline you know to be different

If it's right, just reply "approved" and we'll print and dispatch it. If you'd like changes, reply and tell us what to change.

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
