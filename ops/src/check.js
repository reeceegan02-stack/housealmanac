// Systems check: is every outside service reachable with the keys we hold?
import { prodigiCheck } from './prodigi.js';
import { stripeGet } from './stripe.js';
import { claude, MODELS } from './claude.js';
import { kvGet } from './util.js';

export async function systemsCheck(env) {
  const out = {};
  const run = async (name, fn) => {
    try { out[name] = { ok: true, ...(await fn()) }; } catch (e) { out[name] = { ok: false, error: String(e.message).slice(0, 300) }; }
  };
  await Promise.all([
    run('prodigi', async () => { const r = await prodigiCheck(env); return { attributes: r.attributes }; }),
    run('stripe', async () => { await stripeGet(env, '/checkout/sessions?limit=1'); return {}; }),
    run('claude', async () => { await claude(env, { model: MODELS.fast, maxTokens: 5, messages: [{ role: 'user', content: 'Reply OK' }] }); return {}; }),
    run('etsy', async () => ({ connected: !!(env.ETSY_KEYSTRING && await kvGet(env, 'etsy_tokens')) })),
  ]);
  out.ok = ['prodigi', 'stripe', 'claude'].every((k) => out[k].ok);
  return out;
}
