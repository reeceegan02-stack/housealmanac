// Minimal Anthropic Messages API client.

const API = 'https://api.anthropic.com/v1/messages';

export const MODELS = {
  research: 'claude-sonnet-5-5',
  fast: 'claude-haiku-5-5',
};

export async function claude(env, { model = MODELS.research, system, messages, maxTokens = 4000, tools, temperature }) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const body = { model, max_tokens: maxTokens, messages };
  if (system) body.system = system;
  if (tools) body.tools = tools;
  if (temperature !== undefined) body.temperature = temperature;
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
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
      const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
      return { text, data };
    }
    lastErr = `${r.status} ${await r.text()}`;
    if (r.status === 429 || r.status >= 500) {
      await new Promise(res => setTimeout(res, 2000 * (attempt + 1)));
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
