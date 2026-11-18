// Stripe webhook verification and Checkout Session lookup.

export async function verifyStripe(env, payload, header) {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  const parts = Object.fromEntries(header.split(',').map(kv => kv.split('=')));
  const t = parts.t;
  const sigs = header.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  return sigs.some(s => s.length === hex.length && timingSafeEq(s, hex));
}

function timingSafeEq(a, b) {
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function stripeGet(env, path) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');
  const r = await fetch('https://api.stripe.com/v1' + path, { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  if (!r.ok) throw new Error(`Stripe ${path} ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return r.json();
}

export async function stripePost(env, path, form) {
  const r = await fetch('https://api.stripe.com/v1' + path, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  if (!r.ok) throw new Error(`Stripe ${path} ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return r.json();
}

// Turn a completed Checkout Session into our order fields.
export function sessionToOrder(s) {
  const fields = {};
  for (const f of s.custom_fields || []) {
    const label = (f.label?.custom || f.key || '').toLowerCase();
    const value = f.text?.value ?? f.dropdown?.value ?? f.numeric?.value ?? '';
    if (/address|house|property|street/.test(label)) fields.address = value;
    else if (/year|moved|move/.test(label)) fields.move_in = value;
    else if (/message|note|dedicat/.test(label)) fields.message = value;
    else if (/style|colour|color|theme/.test(label)) fields.style = value;
    else fields[f.key] = value;
  }
  const sd = s.collected_information?.shipping_details || s.shipping_details || {};
  const addr = sd.address || s.customer_details?.address || {};
  const ship = {
    name: sd.name || s.customer_details?.name,
    line1: addr.line1, line2: addr.line2, city: addr.city, county: addr.state, postcode: addr.postal_code, country: addr.country,
  };
  const amount = s.amount_total || 0;
  return {
    external_ref: s.id,
    email: s.customer_details?.email,
    name: s.customer_details?.name || ship.name,
    product: amount >= 6000 ? 'framed' : 'unframed',
    amount_pence: amount,
    address: fields.address || [ship.line1, ship.line2, ship.city, ship.postcode].filter(Boolean).join(', '),
    message: fields.message || '',
    move_in: fields.move_in || '',
    style: fields.style || 'heritage',
    ship_json: JSON.stringify(ship),
  };
}

// Point the consumer payment links at housealmanac.co.uk/thanks, which fires the Google Ads purchase conversion.
const THANKS_LINKS = { 'https://buy.stripe.com/4gM14p7UJfBSffW9512wU00': 'framed', 'https://buy.stripe.com/00waEZ1wlblC5Fm3KH2wU01': 'unframed',
  'https://buy.stripe.com/28EcN74IxdtKebS2GD2wU03': 'voucher-framed', 'https://buy.stripe.com/6oUdRb0shfBSffW1Cz2wU04': 'voucher-unframed' };
const hideKey = (m) => String(m).replace(/[rs]k_\w+/g, '[key]');
export async function setLinkRedirects(env, { dry = false } = {}) {
  let links;
  try { links = await stripeGet(env, '/payment_links?limit=50'); } catch (e) { return { ok: false, error: hideKey(e.message) }; }
  const out = [];
  for (const l of links.data || []) {
    const kind = THANKS_LINKS[l.url];
    if (!kind) continue;
    const target = `https://housealmanac.co.uk/thanks?p=${kind}&sid={CHECKOUT_SESSION_ID}`;
    if (dry || (l.after_completion?.type === 'redirect' && l.after_completion.redirect?.url === target)) { out.push({ kind, type: l.after_completion?.type, done: l.after_completion?.redirect?.url === target }); continue; }
    try {
      const r = await stripePost(env, `/payment_links/${l.id}`, { 'after_completion[type]': 'redirect', 'after_completion[redirect][url]': target });
      out.push({ kind, type: r.after_completion?.type, done: r.after_completion?.redirect?.url === target });
    } catch (e) { out.push({ kind, error: hideKey(e.message).slice(0, 200) }); }
  }
  return { ok: out.length === 4 && out.every(x => x.done), links: out };
}
