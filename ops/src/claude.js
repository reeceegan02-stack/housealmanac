// Minimal Anthropic Messages API client.
import { kvGet, kvSet, extractJson } from './util.js';

// Rough cost tracking so we can warn before prepaid credit runs out (the API has no balance endpoint).
// Prices are estimates per million tokens; web search is $10 per 1,000 searches.
const PRICE = { 'claude-sonnet-5-5': [3, 15], 'claude-haiku-5-5': [1, 5] };
export const PROMO_ENDS = '2026-11-24'; // free credit covers usage until then
export const PREPAID_USD = 20;          // bought 9 Nov 2026

async function trackUsage(env, model, u = {}) {
  try {
    const [pin, pout] = PRICE[model] || [3, 15];
    const usd = ((u.input_tokens || 0) + (u.cache_creation_input_tokens || 0)) * pin / 1e6 + (u.cache_read_input_tokens || 0) * pin * 0.1 / 1e6
      + (u.output_tokens || 0) * pout / 1e6 + (u.server_tool_use?.web_search_requests || 0) * 0.01;
    const key = new Date().toISOString().slice(0, 10) >= PROMO_ENDS ? 'claude_usd_paid' : 'claude_usd_promo';
    const prev = Number(await kvGet(env, key) || 0);
    await kvSet(env, key, String(prev + usd));
  } catch (e) { /* never block on tracking */ }
}

const API = 'https://api.anthropic.com/v1/messages';

export const MODELS = {
  research: 'claude-sonnet-5-5',
  fast: 'claude-haiku-5-5',
};

export async function claude(env, { model = MODELS.research, system, messages, maxTokens = 4000, tools, toolChoice, temperature, _continues = 0 }) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const body = { model, max_tokens: maxTokens, messages };
  if (system) body.system = system;
  if (tools) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;
  if (temperature !== undefined) body.temperature = temperature;
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      const data = await r.json();
      await trackUsage(env, model, data.usage);
      // Long web-search turns can pause; continue them (up to 3 times) and merge the parts, so the
      // answer (which may span the pause) is complete.
      if (data.stop_reason === 'pause_turn' && _continues < 3) {
        const cont = await claude(env, {
          model, system, maxTokens, tools, toolChoice, temperature,
          messages: [...messages, { role: 'assistant', content: data.content }],
          _continues: _continues + 1,
        });
        const merged = { ...cont.data, content: [...(data.content || []), ...(cont.data.content || [])] };
        return { text: textOf(merged.content), data: merged };
      }
      const text = textOf(data.content || []);
      return { text, data };
    }
    lastErr = `${r.status} ${await r.text()}`;
    if (r.status === 429 || r.status >= 500) {
      // Respect the rate-limit reset; outreach can run several research jobs close together.
      const wait = Math.min(60, Number(r.headers.get('retry-after')) || 15 * (attempt + 1));
      await new Promise(res => setTimeout(res, wait * 1000));
      continue;
    }
    break;
  }
  throw new Error('Claude API error: ' + lastErr);
}

export const webSearchTool = (maxUses = 8) => ({
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: maxUses,
  user_location: { type: 'approximate', country: 'GB' },
});

// Parse a model's JSON reply; if it's malformed (e.g. a stray double quote), have a fast model repair it.
export async function parseJson(env, text) {
  try { return extractJson(text); } catch (e) {
    const { text: fixed } = await claude(env, {
      model: MODELS.fast, maxTokens: 6000,
      messages: [{ role: 'user', content: `This should be one JSON object but it is not valid JSON (${e.message}). Fix only the syntax (escape or replace stray double quotes inside strings, add missing commas). Don't change any wording. Return only the JSON.\n\n${text}` }],
    });
    return extractJson(fixed);
  }
}

// With web search the answer is split into citation blocks: use the text after the last search, joined
// without separators so JSON strings aren't broken; if the JSON came before a final search, use all text.
function textOf(content) {
  let lastTool = -1;
  content.forEach((c, i) => { if (c.type !== 'text') lastTool = i; });
  const after = content.slice(lastTool + 1).filter(c => c.type === 'text').map(c => c.text).join('');
  return after.includes('{') ? after : content.filter(c => c.type === 'text').map(c => c.text).join('');
}
