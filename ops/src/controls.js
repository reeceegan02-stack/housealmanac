// Settings the agents may change at runtime (bounded), on top of the wrangler.jsonc vars.
import { kvGet } from './util.js';

export async function outreachPaused(env) {
  return env.OUTREACH_PAUSED === 'true' || (await kvGet(env, 'agent_outreach_paused')) === 'true';
}
export async function outreachPerDayOverride(env) {
  const v = await kvGet(env, 'agent_outreach_per_day');
  return v ? Math.max(0, Math.min(40, Number(v))) : null;
}
