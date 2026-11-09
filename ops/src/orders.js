// Creating orders and starting their workflow.
import { ensureSchema, newId, now, logEvent } from './util.js';

export async function createOrder(env, o) {
  await ensureSchema(env);
  if (o.external_ref) {
    const existing = await env.DB.prepare('SELECT * FROM orders WHERE external_ref = ?').bind(o.external_ref).first();
    if (existing) return existing;
  }
  const id = newId();
  const t = now();
  await env.DB.prepare(`INSERT INTO orders (id, created_at, updated_at, source, external_ref, email, name, product, amount_pence, address, message, move_in, style, ship_json, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'new')`)
    .bind(id, t, t, o.source, o.external_ref || null, o.email || null, o.name || null, o.product || 'framed', o.amount_pence || 0,
      o.address || '', o.message || '', o.move_in || '', o.style || 'heritage', o.ship_json || '{}')
    .run();
  await logEvent(env, id, 'order_created', { source: o.source, product: o.product, amount: o.amount_pence });
  await startOrderWorkflow(env, id, 'new', 0);
  return { id, ...o, status: 'new' };
}

export async function startOrderWorkflow(env, orderId, mode = 'new', revision = 0, attempt = 0) {
  const instanceId = `${orderId}-${mode}-${revision}${attempt ? '-' + attempt : ''}`;
  await env.ORDER_FLOW.create({ id: instanceId, params: { orderId, mode } });
  await logEvent(env, orderId, 'workflow_started', instanceId);
  return instanceId;
}
