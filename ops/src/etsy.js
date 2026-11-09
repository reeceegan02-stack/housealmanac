// Etsy Open API v3: OAuth (PKCE), new paid receipts -> orders, tracking back to Etsy.
import { kvGet, kvSet, randomKey, logEvent, now } from './util.js';
import { createOrder } from './orders.js';

const API = 'https://openapi.etsy.com/v3/application';
const SCOPES = 'transactions_r transactions_w shops_r listings_r';

function apiKeyHeader(env) {
  return env.ETSY_SHARED_SECRET ? `${env.ETSY_KEYSTRING}:${env.ETSY_SHARED_SECRET}` : env.ETSY_KEYSTRING;
}
const redirectUri = (env) => `${env.PUBLIC_BASE}/etsy/callback`;

async function sha256b64url(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return btoa(String.fromCharCode(...new Uint8Array(d))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function etsyConnect(env) {
  if (!env.ETSY_KEYSTRING) return new Response('Etsy app key not set yet (ETSY_KEYSTRING).', { status: 400 });
  const verifier = randomKey(32), state = randomKey(12);
  await kvSet(env, 'etsy_pkce_' + state, verifier);
  const u = new URL('https://www.etsy.com/oauth/connect');
  u.search = new URLSearchParams({
    response_type: 'code', redirect_uri: redirectUri(env), scope: SCOPES, client_id: env.ETSY_KEYSTRING,
    state, code_challenge: await sha256b64url(verifier), code_challenge_method: 'S256',
  }).toString();
  return Response.redirect(u.toString(), 302);
}

export async function etsyCallback(env, url) {
  const state = url.searchParams.get('state'), code = url.searchParams.get('code');
  const verifier = state && await kvGet(env, 'etsy_pkce_' + state);
  if (!code || !verifier) return new Response('Invalid or expired Etsy sign-in. Try the connect link again.', { status: 400 });
  const tok = await tokenRequest(env, { grant_type: 'authorization_code', client_id: env.ETSY_KEYSTRING, redirect_uri: redirectUri(env), code, code_verifier: verifier });
  const userId = tok.access_token.split('.')[0];
  const shops = await etsyFetch(env, `/users/${userId}/shops`, {}, tok.access_token);
  const shop = shops.shop_id ? shops : (shops.results || [])[0];
  if (!shop || String(shop.shop_name).toLowerCase() !== String(env.ETSY_SHOP_NAME || 'HouseAlmanac').toLowerCase()) {
    return new Response('This Etsy account does not own the House Almanac shop.', { status: 403 });
  }
  await saveTokens(env, tok);
  await kvSet(env, 'etsy_shop_id', String(shop.shop_id));
  await logEvent(env, null, 'etsy_connected', { shop: shop.shop_name, shop_id: shop.shop_id });
  return new Response(`<p style="font:16px sans-serif">Etsy shop <b>${shop.shop_name}</b> is connected to House Almanac. You can close this tab.</p>`, { headers: { 'content-type': 'text/html' } });
}

async function tokenRequest(env, form) {
  const r = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(),
  });
  if (!r.ok) throw new Error('Etsy token error ' + r.status + ' ' + (await r.text()).slice(0, 300));
  return r.json();
}

async function saveTokens(env, tok) {
  await kvSet(env, 'etsy_tokens', JSON.stringify({ access: tok.access_token, refresh: tok.refresh_token, exp: Date.now() + (tok.expires_in - 120) * 1000 }));
}

async function accessToken(env) {
  const raw = await kvGet(env, 'etsy_tokens');
  if (!raw) return null;
  const t = JSON.parse(raw);
  if (Date.now() < t.exp) return t.access;
  const tok = await tokenRequest(env, { grant_type: 'refresh_token', client_id: env.ETSY_KEYSTRING, refresh_token: t.refresh });
  await saveTokens(env, tok);
  return tok.access_token;
}

async function etsyFetch(env, path, init = {}, token) {
  const tk = token || await accessToken(env);
  const r = await fetch(API + path, { ...init, headers: { 'x-api-key': apiKeyHeader(env), authorization: `Bearer ${tk}`, 'content-type': 'application/json', ...(init.headers || {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`Etsy ${path} ${r.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

// Pull new paid, unshipped receipts and turn them into orders.
export async function pollEtsy(env) {
  if (!env.ETSY_KEYSTRING || !(await kvGet(env, 'etsy_tokens'))) return { skipped: 'not connected' };
  const shopId = await kvGet(env, 'etsy_shop_id');
  const d = await etsyFetch(env, `/shops/${shopId}/receipts?was_paid=true&was_shipped=false&limit=25`);
  let created = 0;
  for (const rc of d.results || []) {
    const ref = 'etsy-' + rc.receipt_id;
    const exists = await env.DB.prepare('SELECT id FROM orders WHERE external_ref = ?').bind(ref).first();
    if (exists) continue;
    const tx = (rc.transactions || [])[0] || {};
    const vars = (tx.variations || []).map(v => ({ name: (v.formatted_name || '').toLowerCase(), value: v.formatted_value || '' }));
    const pick = (re) => vars.find(v => re.test(v.name))?.value || '';
    const personal = vars.filter(v => /personal/.test(v.name)).map(v => v.value).join('\n');
    const framing = pick(/framing|format/) || (tx.title || '');
    const address = pick(/address|postcode/) || matchLine(personal, /address|postcode/) || [rc.first_line, rc.second_line, rc.city, rc.zip].filter(Boolean).join(', ');
    const message = pick(/message/) || matchLine(personal, /message/) || '';
    const style = pick(/style|colour|color/) || 'heritage';
    await createOrder(env, {
      source: 'etsy', external_ref: ref, email: rc.buyer_email || null, name: rc.name,
      product: /unframed/i.test(framing) ? 'unframed' : 'framed',
      amount_pence: Math.round((rc.grandtotal?.amount || 0) * 100 / (rc.grandtotal?.divisor || 100)),
      address, message, move_in: (message.match(/\b(19|20)\d{2}\b/) || [''])[0], style,
      ship_json: JSON.stringify({ name: rc.name, line1: rc.first_line, line2: rc.second_line, city: rc.city, county: rc.state, postcode: rc.zip, country: rc.country_iso, etsy_receipt: rc.receipt_id }),
    });
    created++;
  }
  return { created };
}

function matchLine(text, re) {
  const line = String(text).split('\n').find(l => re.test(l.toLowerCase()));
  return line ? line.replace(/^[^:]*:\s*/, '') : '';
}

export async function etsyMarkShipped(env, order, tracking) {
  const ship = JSON.parse(order.ship_json || '{}');
  if (!ship.etsy_receipt) return;
  const shopId = await kvGet(env, 'etsy_shop_id');
  await etsyFetch(env, `/shops/${shopId}/receipts/${ship.etsy_receipt}/tracking`, {
    method: 'POST',
    body: JSON.stringify({ tracking_code: tracking.number || '', carrier_name: tracking.carrier || 'other', send_bcc: false }),
  });
  await logEvent(env, order.id, 'etsy_marked_shipped', tracking);
}
