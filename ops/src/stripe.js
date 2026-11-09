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
