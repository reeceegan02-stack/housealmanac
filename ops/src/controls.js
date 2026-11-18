// Settings the agents may change at runtime (bounded), on top of the wrangler.jsonc vars.
import { kvGet } from './util.js';

export async function outreachPaused(env) {
  return env.OUTREACH_PAUSED === 'true' || (await kvGet(env, 'agent_outreach_paused')) === 'true' || await creditReserveHit(env);
}

// Keep the last few dollars of prepaid Claude credit for customer orders: outreach and pitches stop first.
// (After a top-up, raise PREPAID_USD in claude.js.)
export async function creditReserveHit(env) {
  const { PROMO_ENDS, PREPAID_USD } = await import('./claude.js');
  if (new Date().toISOString().slice(0, 10) < PROMO_ENDS) return false;
  return Number(await kvGet(env, 'claude_usd_paid') || 0) >= PREPAID_USD - 6;
}
export async function outreachPerDayOverride(env) {
  const v = await kvGet(env, 'agent_outreach_per_day');
  return v ? Math.max(0, Math.min(40, Number(v))) : null;
}
