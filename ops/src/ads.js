// Google Ads monitoring and upkeep, with no API keys or developer token.
// A Google Ads Script inside the account (Tools → Bulk actions → Scripts, "House Almanac monitor", runs hourly) is a
// two-line loader that fetches GET /ads/script.js and runs it. That code reads the account's stats, posts them to
// POST /ads/report, and applies pending commands from GET /ads/commands (negative keywords, pause/enable).
// Reports carry no secret, so they are advisory only: the worst a forged report can do is suggest negatives, and the
// negative-keyword guard below never lets one block our own keywords. Spend is capped inside Google (campaign
// total budget), so nothing here can raise it. Commands can only be written by our own code (ops agent, admin key).
import { kvGet, kvSet, logEvent, json } from './util.js';

export const ADS_CUSTOMER_ID = '4981555331';
export const ADS_CAP_GBP = 280; // campaign total budget set in Google Ads (Reece agreed max £300)
export const ADS_START = '2026-11-18';
// Our positive keywords: a negative must never block these.
export const OUR_KEYWORDS = ['house history print', 'history of my house', 'history of your house', 'old map of my street',
  'personalised house print', 'personalised street map', 'then and now map', 'old ordnance survey map print', 'new home gift',
  'first home gift', 'housewarming gift', 'housewarming present', 'unique new home gift', 'moving house gift'];

// ---------- the code that runs inside Google Ads (ES5-ish, no backticks or template placeholders) ----------
const SCRIPT = String.raw`(function () {
  var BASE = '__BASE__';
  var START = '__START__';
  var acct = AdsApp.currentAccount();
  var today = Utilities.formatDate(new Date(), acct.getTimeZone(), 'yyyy-MM-dd');
  var out = { customer_id: String(acct.getCustomerId()).replace(/-/g, ''), at: new Date().toISOString(), today: today,
    preview: AdsApp.getExecutionInfo().isPreview(), errors: [], applied: [] };
  var range = "segments.date BETWEEN '" + START + "' AND '" + today + "'";
  var money = function (x) { return Math.round(Number(x || 0) / 10000) / 100; };
  var num = function (x) { return Number(x || 0); };
  function q(name, gaql, map) {
    try { var rows = [], it = AdsApp.search(gaql); while (it.hasNext() && rows.length < 400) rows.push(map(it.next())); out[name] = rows; }
    catch (e) { out.errors.push(name + ': ' + String(e).slice(0, 300)); }
  }
  q('days', "SELECT segments.date, campaign.id, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE " + range,
    function (r) { return { date: r.segments.date, campaign: String(r.campaign.id), impressions: num(r.metrics.impressions), clicks: num(r.metrics.clicks),
      cost: money(r.metrics.costMicros), conversions: num(r.metrics.conversions), value: num(r.metrics.conversionsValue) }; });
  q('campaigns', "SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status, campaign.primary_status, campaign.primary_status_reasons FROM campaign WHERE campaign.status != 'REMOVED'",
    function (r) { return { id: String(r.campaign.id), name: r.campaign.name, status: r.campaign.status, serving: r.campaign.servingStatus,
      primary: r.campaign.primaryStatus, reasons: r.campaign.primaryStatusReasons || [] }; });
  q('budgets', "SELECT campaign.id, campaign_budget.amount_micros, campaign_budget.total_amount_micros FROM campaign WHERE campaign.status != 'REMOVED'",
    function (r) { var b = r.campaignBudget || {}; return { campaign: String(r.campaign.id), daily: money(b.amountMicros), total: money(b.totalAmountMicros) }; });
  q('ads', "SELECT ad_group_ad.ad.id, ad_group_ad.status, ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'",
    function (r) { var p = r.adGroupAd.policySummary || {}; return { id: String(r.adGroupAd.ad.id), status: r.adGroupAd.status, approval: p.approvalStatus, review: p.reviewStatus }; });
  q('keywords', "SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.quality_info.quality_score, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM keyword_view WHERE " + range,
    function (r) { var c = r.adGroupCriterion; return { text: c.keyword.text, match: c.keyword.matchType, status: c.status, qs: c.qualityInfo ? c.qualityInfo.qualityScore : null,
      impressions: num(r.metrics.impressions), clicks: num(r.metrics.clicks), cost: money(r.metrics.costMicros), conversions: num(r.metrics.conversions) }; });
  q('search_terms', "SELECT search_term_view.search_term, search_term_view.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM search_term_view WHERE " + range + " ORDER BY metrics.impressions DESC LIMIT 300",
    function (r) { return { term: r.searchTermView.searchTerm, status: r.searchTermView.status, impressions: num(r.metrics.impressions), clicks: num(r.metrics.clicks),
      cost: money(r.metrics.costMicros), conversions: num(r.metrics.conversions) }; });
  q('negatives', "SELECT campaign.id, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type FROM campaign_criterion WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type = 'KEYWORD'",
    function (r) { return { campaign: String(r.campaign.id), text: r.campaignCriterion.keyword.text, match: r.campaignCriterion.keyword.matchType }; });

  // Pending commands from House Almanac's ops worker.
  try {
    var cmd = JSON.parse(UrlFetchApp.fetch(BASE + '/ads/commands', { muteHttpExceptions: true }).getContentText() || '{}');
    var have = {};
    (out.negatives || []).forEach(function (n) { have[n.campaign + '|' + n.match + '|' + String(n.text).toLowerCase()] = 1; });
    var camps = {}, it = AdsApp.campaigns().get();
    while (it.hasNext()) { var c = it.next(); camps[String(c.getId())] = c; }
    (cmd.negatives || []).slice(0, 60).forEach(function (n) {
      Object.keys(camps).forEach(function (id) {
        if (have[id + '|' + n.match + '|' + String(n.text).toLowerCase()]) return;
        var t = n.match === 'EXACT' ? '[' + n.text + ']' : n.match === 'PHRASE' ? '"' + n.text + '"' : n.text;
        try { camps[id].createNegativeKeyword(t); out.applied.push({ campaign: id, negative: t }); }
        catch (e) { out.errors.push('negative ' + t + ': ' + String(e).slice(0, 200)); }
      });
    });
    // Sales from ad clicks: upload as offline conversions (the conversion action must be "Import: conversions from clicks").
    out.uploaded = [];
    if ((cmd.conversions || []).length && cmd.conversion_name) {
      try {
        var up = AdsApp.bulkUploads().newCsvUpload(['Google Click ID', 'Conversion Name', 'Conversion Time', 'Conversion Value', 'Conversion Currency'],
          { moneyInMicros: false, timeZone: 'Europe/London' });
        up.forOfflineConversions();
        up.setFileName('House Almanac sales ' + today);
        cmd.conversions.forEach(function (cv) {
          up.append({ 'Google Click ID': cv.gclid, 'Conversion Name': cmd.conversion_name,
            'Conversion Time': Utilities.formatDate(new Date(cv.at), 'Europe/London', 'yyyyMMdd HHmmss'),
            'Conversion Value': cv.value, 'Conversion Currency': 'GBP' });
        });
        if (out.preview) up.preview(); else up.apply();
        cmd.conversions.forEach(function (cv) { out.uploaded.push(cv.id); });
      } catch (e) { out.errors.push('conversions: ' + String(e).slice(0, 300)); }
    }
    (cmd.pause || []).forEach(function (id) { if (camps[id] && camps[id].isEnabled()) { camps[id].pause(); out.applied.push({ campaign: id, paused: true }); } });
    (cmd.enable || []).forEach(function (id) { if (camps[id] && camps[id].isPaused()) { camps[id].enable(); out.applied.push({ campaign: id, enabled: true }); } });
  } catch (e) { out.errors.push('commands: ' + String(e).slice(0, 300)); }

  var res = UrlFetchApp.fetch(BASE + '/ads/report', { method: 'post', contentType: 'application/json', payload: JSON.stringify(out), muteHttpExceptions: true });
  Logger.log('House Almanac report: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
  Logger.log('Errors: ' + JSON.stringify(out.errors));
})();
`;

export function adsScript(env) {
  return new Response(SCRIPT.replace('__BASE__', env.PUBLIC_BASE).replace('__START__', ADS_START),
    { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

// ---------- offline conversions (sales reported back to Google with the ad click id) ----------
export const ADS_CONVERSION_NAME = 'Stripe purchase (import)';
// site/ads.js adds ?client_reference_id=g-<gclid> to Stripe links when the visitor came from an ad.
export async function recordAdClick(env, s) {
  const ref = String(s.client_reference_id || '');
  if (!ref.startsWith('g-')) return;
  const gclid = ref.slice(2).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 190);
  if (gclid.length < 10) return;
  await env.DB.prepare('INSERT OR IGNORE INTO ad_conversions (session_id, gclid, at, value_pence, kind) VALUES (?,?,?,?,?)')
    .bind(s.id, gclid, new Date((s.created || Date.now() / 1000) * 1000).toISOString(), s.amount_total || 0, s.payment_link || '').run();
}
export async function pendingConversions(env) {
  const { results } = await env.DB.prepare(`SELECT session_id, gclid, at, value_pence FROM ad_conversions WHERE uploaded_at IS NULL AND at >= ? ORDER BY at LIMIT 100`)
    .bind(new Date(Date.now() - 60 * 86400e3).toISOString()).all();
  return results;
}

// ---------- commands ----------
async function getCommands(env) {
  try { return JSON.parse(await kvGet(env, 'ads_commands') || '{}'); } catch { return {}; }
}
async function setCommands(env, c) {
  await kvSet(env, 'ads_commands', JSON.stringify({ negatives: (c.negatives || []).slice(-300), pause: c.pause || [], enable: c.enable || [] }));
}
export async function adsCommands(env) {
  const c = await getCommands(env);
  // Uploads only once the "Stripe purchase (import)" conversion action exists in Google Ads (kv ads_offline_enabled=true).
  const conv = (await kvGet(env, 'ads_offline_enabled')) === 'true' ? await pendingConversions(env).catch(() => []) : [];
  return json({ negatives: (c.negatives || []).map(n => ({ text: n.text, match: n.match })), pause: c.pause || [], enable: c.enable || [],
    conversion_name: ADS_CONVERSION_NAME,
    conversions: conv.map(x => ({ id: x.session_id.slice(-12), gclid: x.gclid, at: x.at, value: x.value_pence / 100 })) });
}

const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9&' ]+/g, ' ').split(/\s+/).filter(Boolean);
// Returns a reason string if the negative would block one of our keywords (or is malformed), else null.
export function negativeProblem(text, match) {
  const t = String(text || '').toLowerCase().trim().replace(/\s+/g, ' ');
  if (!['BROAD', 'PHRASE', 'EXACT'].includes(match)) return 'match must be BROAD, PHRASE or EXACT';
  if (!t || t.length > 60 || !/^[a-z0-9&' -]+$/.test(t) || t.split(' ').length > 6) return 'use 1-6 plain words';
  const nw = words(t);
  for (const k of OUR_KEYWORDS) {
    const kw = words(k);
    if (match === 'EXACT' && t === k) return `would block our keyword "${k}"`;
    if (match === 'BROAD' && nw.every(w => kw.includes(w))) return `would block our keyword "${k}"`;
    if (match === 'PHRASE' && kw.join(' ').includes(nw.join(' '))) return `would block our keyword "${k}"`;
  }
  return null;
}

export async function queueNegatives(env, list, reason, by = 'agent') {
  const c = await getCommands(env);
  c.negatives = c.negatives || [];
  const done = [], rejected = [];
  for (const n of list || []) {
    const text = String(n.text || '').toLowerCase().trim().replace(/\s+/g, ' ');
    const match = String(n.match || 'BROAD').toUpperCase();
    const bad = negativeProblem(text, match);
    if (bad) { rejected.push(`${text}: ${bad}`); continue; }
    if (c.negatives.some(x => x.text === text && x.match === match)) continue;
    c.negatives.push({ text, match, at: new Date().toISOString(), by, reason: String(reason || '').slice(0, 160) });
    done.push(`${match.toLowerCase()} "${text}"`);
  }
  await setCommands(env, c);
  if (done.length) await logEvent(env, null, 'ads_negatives_queued', { by, done, reason: String(reason || '').slice(0, 200) });
  return { queued: done, rejected };
}

export async function adsAdminCommand(env, body) {
  const c = await getCommands(env);
  if (Array.isArray(body.pause)) c.pause = [...new Set([...(c.pause || []), ...body.pause.map(String)])];
  if (Array.isArray(body.enable)) c.enable = [...new Set([...(c.enable || []), ...body.enable.map(String)])];
  await setCommands(env, c);
  const r = body.negatives ? await queueNegatives(env, body.negatives, body.reason || 'admin', 'admin') : {};
  return { ...r, commands: await getCommands(env) };
}

// ---------- reports ----------
const S = (v, n = 120) => String(v ?? '').slice(0, n);
const N = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
function clean(r) {
  const arr = (a, n, f) => (Array.isArray(a) ? a.slice(0, n).map(f) : []);
  return {
    at: S(r.at, 40), today: S(r.today, 10), preview: !!r.preview,
    errors: arr(r.errors, 20, x => S(x, 300)),
    uploaded: arr(r.uploaded, 100, x => S(x, 20)),
    applied: arr(r.applied, 80, x => ({ campaign: S(x.campaign, 20), negative: x.negative ? S(x.negative, 80) : undefined, paused: !!x.paused || undefined, enabled: !!x.enabled || undefined })),
    days: arr(r.days, 400, d => ({ date: S(d.date, 10), campaign: S(d.campaign, 20), impressions: N(d.impressions), clicks: N(d.clicks), cost: N(d.cost), conversions: N(d.conversions), value: N(d.value) })),
    campaigns: arr(r.campaigns, 20, c => ({ id: S(c.id, 20), name: S(c.name, 80), status: S(c.status, 20), serving: S(c.serving, 30), primary: S(c.primary, 30), reasons: arr(c.reasons, 10, x => S(x, 50)) })),
    budgets: arr(r.budgets, 20, b => ({ campaign: S(b.campaign, 20), daily: N(b.daily), total: N(b.total) })),
    ads: arr(r.ads, 50, a => ({ id: S(a.id, 20), status: S(a.status, 20), approval: S(a.approval, 30), review: S(a.review, 30) })),
    keywords: arr(r.keywords, 200, k => ({ text: S(k.text, 80), match: S(k.match, 10), status: S(k.status, 20), qs: k.qs == null ? null : N(k.qs), impressions: N(k.impressions), clicks: N(k.clicks), cost: N(k.cost), conversions: N(k.conversions) })),
    search_terms: arr(r.search_terms, 300, t => ({ term: S(t.term, 100), status: S(t.status, 20), impressions: N(t.impressions), clicks: N(t.clicks), cost: N(t.cost), conversions: N(t.conversions) })),
    negatives: arr(r.negatives, 400, n => ({ campaign: S(n.campaign, 20), text: S(n.text, 80), match: S(n.match, 10) })),
  };
}

export async function adsReport(req, env) {
  const raw = await req.text();
  if (raw.length > 500000) return json({ error: 'too large' }, 413);
  let r; try { r = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400); }
  if (String(r.customer_id || '') !== ADS_CUSTOMER_ID) return json({ error: 'unknown account' }, 403);
  const last = Number(await kvGet(env, 'ads_report_last') || 0);
  if (Date.now() - last < 90e3) return json({ ok: true, skipped: 'too soon' });
  await kvSet(env, 'ads_report_last', String(Date.now()));
  const c = clean(r);
  await kvSet(env, 'ads_report', JSON.stringify(c));
  if (!c.preview) {
    for (const id of c.uploaded) {
      await env.DB.prepare(`UPDATE ad_conversions SET uploaded_at = ? WHERE substr(session_id, -12) = ? AND uploaded_at IS NULL`).bind(new Date().toISOString(), id).run();
    }
    if (c.uploaded.length) await logEvent(env, null, 'ads_conversions_uploaded', { n: c.uploaded.length });
    if (c.applied.length) await logEvent(env, null, 'ads_applied', c.applied.slice(0, 40));
    // Pause/enable commands are one-shot: clear the ones that took effect.
    const cmd = await getCommands(env);
    const paused = c.applied.filter(a => a.paused).map(a => a.campaign), enabled = c.applied.filter(a => a.enabled).map(a => a.campaign);
    if (paused.length || enabled.length) {
      cmd.pause = (cmd.pause || []).filter(id => !paused.includes(id));
      cmd.enable = (cmd.enable || []).filter(id => !enabled.includes(id));
      await setCommands(env, cmd);
    }
  }
  const errKey = JSON.stringify(c.errors);
  if (c.errors.length && errKey !== await kvGet(env, 'ads_errors_last')) await logEvent(env, null, 'ads_script_error', c.errors.slice(0, 8));
  await kvSet(env, 'ads_errors_last', errKey);
  return json({ ok: true, stored: c.at, days: c.days.length, search_terms: c.search_terms.length, errors: c.errors.length });
}

const round2 = (x) => Math.round(x * 100) / 100;
const dayMinus = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') - n * 86400e3).toISOString().slice(0, 10);

// Aggregates only (safe for the public status snapshot): no search terms.
export async function adsSummary(env) {
  const raw = await kvGet(env, 'ads_report');
  if (!raw) return { connected: false, cap_gbp: ADS_CAP_GBP };
  const r = JSON.parse(raw);
  const days = r.days || [];
  const sum = (a, k) => round2(a.reduce((t, d) => t + (Number(d[k]) || 0), 0));
  const d7 = days.filter(d => d.date > dayMinus(r.today, 7));
  const dt = days.filter(d => d.date === r.today);
  const ageH = (Date.now() - Date.parse(r.at)) / 3600e3;
  return {
    connected: true, last_report_at: r.at, report_age_hours: round2(ageH), stale: ageH > 3, preview_only: r.preview,
    cap_gbp: ADS_CAP_GBP,
    total: { spend: sum(days, 'cost'), impressions: sum(days, 'impressions'), clicks: sum(days, 'clicks'), conversions: sum(days, 'conversions'), value: sum(days, 'value') },
    last_7d: { spend: sum(d7, 'cost'), impressions: sum(d7, 'impressions'), clicks: sum(d7, 'clicks'), conversions: sum(d7, 'conversions') },
    today: { spend: sum(dt, 'cost'), impressions: sum(dt, 'impressions'), clicks: sum(dt, 'clicks') },
    campaigns: (r.campaigns || []).map(c => ({ name: c.name, status: c.status, serving: c.serving, primary: c.primary, reasons: c.reasons })),
    budgets: r.budgets || [],
    ads: (r.ads || []).map(a => ({ status: a.status, approval: a.approval, review: a.review })),
    keywords_with_impressions: (r.keywords || []).filter(k => k.impressions > 0).length,
    negatives: (r.negatives || []).length,
    pending_negatives: ((await getCommands(env)).negatives || []).length,
    script_errors: (r.errors || []).slice(0, 5),
    ad_sales: await env.DB.prepare(`SELECT count(*) n, sum(uploaded_at IS NOT NULL) uploaded, coalesce(sum(value_pence), 0) value_pence FROM ad_conversions`).first().catch(() => null),
  };
}

// Detail for the (private) ops agent prompt: search terms and keyword performance.
export async function adsDetailForAgent(env, scrub) {
  const raw = await kvGet(env, 'ads_report');
  if (!raw) return null;
  const r = JSON.parse(raw);
  const have = new Set((r.negatives || []).map(n => `${n.match}|${n.text.toLowerCase()}`));
  const pending = ((await getCommands(env)).negatives || []).map(n => `${n.match.toLowerCase()} "${n.text}"`);
  return {
    search_terms: (r.search_terms || []).filter(t => t.status !== 'EXCLUDED').slice(0, 120).map(t => ({ ...t, term: scrub(t.term, 100) })),
    keywords: (r.keywords || []).map(k => ({ text: k.text, match: k.match, impressions: k.impressions, clicks: k.clicks, cost: k.cost, conversions: k.conversions, qs: k.qs })),
    existing_negatives: [...have].slice(0, 200),
    pending_negatives: pending.slice(-100),
  };
}
