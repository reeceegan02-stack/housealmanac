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
  const attributes = {};
  if (attrsAvail.color) attributes.color = attrsAvail.color.includes('black') ? 'black' : attrsAvail.color[0];
  if (attrsAvail.colour) attributes.colour = attrsAvail.colour.includes('black') ? 'black' : attrsAvail.colour[0];
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
