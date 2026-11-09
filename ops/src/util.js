// Shared helpers: database schema, event log, ids, escaping.

export const BRAND = {
  name: 'House Almanac',
  from: 'hello@housealmanac.co.uk',
  site: 'https://housealmanac.co.uk',
  owner: 'Reece Egan-Sheath',
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source TEXT NOT NULL,
    external_ref TEXT UNIQUE,
    email TEXT,
    name TEXT,
    product TEXT,
    amount_pence INTEGER,
    address TEXT,
    message TEXT,
    move_in TEXT,
    style TEXT,
    ship_json TEXT,
    status TEXT NOT NULL,
    revision INTEGER DEFAULT 0,
    change_notes TEXT,
    data_json TEXT,
    file_key TEXT,
    proof_key TEXT,
    prodigi_id TEXT,
    tracking TEXT,
    notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    order_id TEXT,
    kind TEXT NOT NULL,
    detail TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS prospects (
    email TEXT PRIMARY KEY,
    agency TEXT,
    company TEXT,
    area TEXT,
    status TEXT,
    last_contact TEXT,
    followup_due TEXT,
    samples_used INTEGER DEFAULT 0,
    notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`,
];

// Additive changes to existing tables (each runs once; "duplicate column" errors are ignored).
const MIGRATIONS = [
  `ALTER TABLE prospects ADD COLUMN domain TEXT`,
  `ALTER TABLE prospects ADD COLUMN website TEXT`,
  `ALTER TABLE prospects ADD COLUMN created_at TEXT`,
  `ALTER TABLE prospects ADD COLUMN office_json TEXT`,
  `UPDATE prospects SET domain = lower(substr(email, instr(email, '@') + 1)) WHERE domain IS NULL`,
  `CREATE INDEX IF NOT EXISTS prospects_status ON prospects (status)`,
  // Agencies emailed before office previews (9 Nov 2026) were offered a free framed print for a buyer; keep that promise.
  `UPDATE prospects SET office_json = json_set(coalesce(office_json, '{}'), '$.offer', 'buyer_sample') WHERE last_contact IS NOT NULL AND last_contact < '2026-11-09T16:00:00Z' AND json_extract(coalesce(office_json, '{}'), '$.offer') IS NULL`,
  `CREATE INDEX IF NOT EXISTS prospects_domain ON prospects (domain)`,
];

let schemaReady = false;
export async function ensureSchema(env) {
  if (schemaReady) return;
  for (const s of SCHEMA) await env.DB.prepare(s).run();
  for (const m of MIGRATIONS) { try { await env.DB.prepare(m).run(); } catch (e) { /* already applied */ } }
  schemaReady = true;
}

export const now = () => new Date().toISOString();

export function newId(prefix = 'HA') {
  const a = new Uint8Array(4);
  crypto.getRandomValues(a);
  return prefix + '-' + [...a].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 6).toUpperCase();
}

export function randomKey(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function logEvent(env, orderId, kind, detail) {
  try {
    await env.DB.prepare('INSERT INTO events (at, order_id, kind, detail) VALUES (?,?,?,?)')
      .bind(now(), orderId || null, kind, typeof detail === 'string' ? detail.slice(0, 4000) : JSON.stringify(detail).slice(0, 4000))
      .run();
  } catch (e) {
    console.error('logEvent failed', e);
  }
}

export async function getOrder(env, id) {
  return env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
}

export async function updateOrder(env, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sql = `UPDATE orders SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
  await env.DB.prepare(sql).bind(...keys.map(k => fields[k]), now(), id).run();
}

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const CODE_VERSION = '2026-11-09.14';
export function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'content-type': 'application/json', 'x-ha-version': CODE_VERSION } });
}

export function bytesToBase64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(s);
}

export async function kvGet(env, k) {
  const r = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first();
  return r ? r.v : null;
}
export async function kvSet(env, k, v) {
  await env.DB.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, v).run();
}

// Pull the first JSON object out of a model reply (handles ```json fences).
export function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('No JSON in model reply');
  const raw = body.slice(start, end + 1);
  try { return JSON.parse(raw); } catch (e) {
    return JSON.parse(escapeControlCharsInStrings(raw));
  }
}

// Models sometimes put raw line breaks or tabs inside JSON strings; escape them.
function escapeControlCharsInStrings(s) {
  let out = '', inStr = false, esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === '\\') { out += ch; esc = true; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      const c = ch.charCodeAt(0);
      if (c < 0x20) { out += ch === '\n' ? '\\n' : ch === '\t' ? '\\t' : ch === '\r' ? '' : ' '; continue; }
      out += ch;
    } else {
      if (ch === '"') inStr = true;
      out += ch;
    }
  }
  return out;
}

export function fileUrl(env, key) {
  return `${env.PUBLIC_BASE}/f/${key}`;
}
