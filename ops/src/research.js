// Street research and copywriting with the Claude API (web search enabled).
import { claude, MODELS, webSearchTool } from './claude.js';
import { extractJson } from './util.js';

const SCHEMA = `{
  "title": "house number + street, e.g. \\"78 Bentgate Street\\" (or house name, or street name if no number). Max 26 characters.",
  "subtitle": "short italic line under the title, max 48 chars. Use 'formerly <old name>' if the street was renamed, or '<area> · home of <first names>' if the customer's message names them, else '<area> · <town>'.",
  "header_right": "'<area> · <town> · <postcode district>', max 40 chars",
  "hero_note": "one line about the historic map, max 110 chars, e.g. 'The street as the Ordnance Survey drew it at 25 inches to the mile, around 1900.'",
  "hero_caption": "max 220 chars. Start with '<Street> is highlighted.' then name 1-2 things visible on the c.1900 map near the street that your sources confirm (mills, chapels, railway, fields).",
  "story": ["paragraph 1", "paragraph 2", "paragraph 3"],
  "today_caption": "max 160 chars, starts with 'The same streets today.'",
  "timeline": [{"year": "1882", "text": "max 46 chars", "key": false}],
  "message_label": "'<Street> · Home since <move-in year>' or '<Street> · <town>' if no year, max 40 chars",
  "sources": "semicolon-separated list of the named sources you used (publication or site names), max 320 chars",
  "confidence": "high | medium | low",
  "notes": "anything uncertain or worth a human check, else empty"
}`;

const SYSTEM = `You research and write the text for House Almanac, a personalised A3 print about the history of a customer's home and street in England or Wales.

Rules:
- Use web search. Every factual claim must come from a source you found: council or heritage pages, Historic England, British History Online, Grace's Guide, local history societies, newspapers, Wikipedia. Never invent dates, names or numbers. If you can't confirm something, leave it out.
- Focus on the street and its immediate neighbourhood: what stood there before, who built it and when, what people worked at, how it changed, what survives today.
- If the home or street is modern, tell the story of the land before it was built on.
- Privacy: don't name private individuals who lived at the address or on the street (unless they are publicly notable historic figures). Never mention the customer's purchase price.
- British English. Warm, specific and factual; no clichés ("nestled", "rich tapestry", "hidden gem"), no exclamation marks.
- story: exactly 3 paragraphs, 150 to 190 words in total, each paragraph 40 to 75 words.
- timeline: 6 to 8 items in ascending year order. The last one or two items are about this home and have "key": true (for example the year the street or house was built, and "<names> make it home" in the move-in year if given). Use the move-in year only as given by the customer.
- Output ONLY one JSON object matching the schema, no commentary.`;

export async function researchStreet(env, ctx) {
  const salesSummary = summariseSales(ctx.sales);
  const prompt = `Research this home and write the print text.

Address: ${ctx.address}
Street: ${ctx.street || 'unknown'}
House number/name: ${ctx.houseNumber || ctx.houseName || 'not given'}
Area: ${ctx.suburb || ''}; Town: ${ctx.town || ''}; Local authority: ${ctx.district || ''}; County/region: ${ctx.county || ctx.region || ''}
Postcode district: ${ctx.outcode || ''}
Coordinates: ${ctx.lat.toFixed(5)}, ${ctx.lon.toFixed(5)}
Historic map on the print: Ordnance Survey 25-inch, surveyed/revised roughly 1890-1914 (National Library of Scotland).
Customer's move-in year: ${ctx.moveIn || 'not given'}
Customer's message (for context only, it is printed separately): ${ctx.message || 'none'}
Land Registry sales on the street (other houses): ${salesSummary}
${ctx.purpose === 'office' ? `
This print is for an estate agency's own office at this address (${ctx.agency || 'the agency'}), not a family home. Write about the street, the building and the neighbourhood. There is no move-in year: make the final key timeline item about the street or area today. Subtitle: '<area> · <town>'. message_label: '<Street> · <town>'.
` : ''}
Schema:
${SCHEMA}`;
  const { text } = await claude(env, {
    model: MODELS.research,
    system: SYSTEM,
    maxTokens: 6000,
    tools: [webSearchTool(ctx.searches || 10)],
    messages: [{ role: 'user', content: prompt }],
  });
  return validate(extractJson(text));
}

export async function reviseContent(env, prev, request, ctx) {
  const prompt = `Here is the current text for a customer's House Almanac print (JSON), followed by the customer's change request.
Apply the requested changes. Keep everything else the same. Facts you add must be either stated by the customer about their own home/family or confirmed by web search. Keep the same length limits.

Current JSON:
${JSON.stringify(prev, null, 2)}

Address: ${ctx.address}
Customer's change request:
"""${request}"""

Return ONLY the full updated JSON object, plus a field "change_summary" (one sentence describing what you changed) and "message" (the customer's personal message for the print, updated only if they asked to change it, else repeat it exactly: ${JSON.stringify(ctx.message || '')}).`;
  const { text } = await claude(env, {
    model: MODELS.research,
    system: SYSTEM,
    maxTokens: 6000,
    tools: [webSearchTool(4)],
    messages: [{ role: 'user', content: prompt }],
  });
  return validate(extractJson(text));
}

function validate(d) {
  const need = ['title', 'subtitle', 'header_right', 'hero_caption', 'story', 'today_caption', 'timeline', 'message_label', 'sources'];
  for (const k of need) if (!d[k]) throw new Error('Research JSON missing ' + k);
  if (!Array.isArray(d.story) || d.story.length < 2) throw new Error('story must be paragraphs');
  d.story = d.story.slice(0, 3);
  d.timeline = (d.timeline || []).filter(t => t && t.year && t.text).slice(0, 8);
  if (d.timeline.length < 4) throw new Error('timeline too short');
  return d;
}

export function summariseSales(sales) {
  if (!sales || !sales.length) return 'none recorded';
  const first = sales[0].year | 0, last = sales[sales.length - 1].year | 0;
  return `${sales.length} sales from ${first} to ${last}`;
}
