// Prodigi print-on-demand API (v4).
const SKUS = { framed: 'GLOBAL-CFP-A3', unframed: 'GLOBAL-FAP-A3' };

function base(env) { return env.PRODIGI_BASE || 'https://api.prodigi.com/v4.0'; }

async function call(env, path, init = {}) {
  if (!env.PRODIGI_API_KEY) throw new Error('PRODIGI_API_KEY is not set');
  const r = await fetch(base(env) + path, {
    ...init,
    headers: { 'x-api-key': env.PRODIGI_API_KEY, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) throw new Error(`Prodigi ${path} ${r.status}: ${text.slice(0, 600)}`);
  return data;
}

export async function productAttributes(env, sku) {
  try {
    const d = await call(env, `/products/${sku}`);
    return d.product?.attributes || {};
  } catch (e) { return {}; }
}

export async function createPrintOrder(env, order, imageUrl) {
  const ship = JSON.parse(order.ship_json || '{}');
  const sku = SKUS[order.product] || SKUS.framed;
  const attrsAvail = await productAttributes(env, sku);
  // Specify every attribute the product has: the chosen frame colour, otherwise its only/first option.
  const attributes = {};
  const want = String(ship.frame_colour || 'black').toLowerCase(); // black unless the customer asked for white or natural wood
  for (const [k, opts] of Object.entries(attrsAvail)) {
    if (!Array.isArray(opts) || !opts.length) continue;
    attributes[k] = /^colou?r$/i.test(k) ? (opts.includes(want) ? want : opts.includes('black') ? 'black' : opts[0]) : opts[0];
  }
  const body = {
    merchantReference: order.id,
    shippingMethod: 'Standard',
    idempotencyKey: `${order.id}-${order.revision || 0}`,
    recipient: {
      name: ship.name || order.name,
      email: order.email || undefined,
      address: {
        line1: ship.line1, line2: ship.line2 || undefined,
        postalOrZipCode: ship.postcode, countryCode: 'GB',
        townOrCity: ship.city, stateOrCounty: ship.county || undefined,
      },
    },
    items: [{
      merchantReference: order.id + '-1',
      sku, copies: 1, sizing: 'fillPrintArea',
      attributes,
      assets: [{ printArea: 'default', url: imageUrl }],
    }],
  };
  const d = await call(env, '/Orders', { method: 'POST', body: JSON.stringify(body) });
  return d.order;
}

export async function getPrintOrder(env, id) {
  const d = await call(env, `/Orders/${id}`);
  return d.order;
}

// For the systems check: confirms the key works and returns the framed product's attributes.
export async function prodigiCheck(env) {
  const d = await call(env, `/products/${SKUS.framed}`);
  return { ok: !!d.product, attributes: d.product?.attributes || {} };
}
