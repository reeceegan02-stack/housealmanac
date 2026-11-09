// Sends emails queued in ops/outbox.json (bundled at deploy). The weekly growth agent adds press, gift-guide and
// partner pitches there and pushes; this sends them gradually, once each, within limits and opt-outs.
import outbox from '../outbox.json';
import { kvGet, kvSet, logEvent } from './util.js';
import { sendMail } from './mail.js';

const ukHour = () => Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/London' }).format(new Date()));

export async function sendOutbox(env) {
  const day = new Date().getUTCDay();
  if (day === 0 || day === 6 || ukHour() < 9 || ukHour() >= 17 || env.OUTREACH_PAUSED === 'true') return { skipped: 'outside hours or paused' };
  const today = new Date().toISOString().slice(0, 10);
  const perDay = Number(env.OUTBOX_PER_DAY || 15);
  let sentToday = Number(await kvGet(env, 'outbox_day_' + today) || 0);
  let sent = 0;
  for (const it of outbox.items || []) {
    if (sentToday >= perDay || sent >= 4) break; // a few per cron run, spread through the day
    if (!it.id || !it.to || !it.subject || !it.text) continue;
    if (it.not_before && it.not_before > today) continue;
    if (await kvGet(env, 'outbox_sent_' + it.id)) continue;
    const to = String(it.to).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(to)) continue;
    const blocked = await env.DB.prepare(`SELECT 1 FROM prospects WHERE email = ? AND status IN ('opted_out','bounced')`).bind(to).first()
      || await kvGet(env, 'suppress_' + to);
    if (blocked) { await kvSet(env, 'outbox_sent_' + it.id, 'skipped-optout'); continue; }
    const text = /reply "no thanks"|unsubscribe/i.test(it.text) ? it.text : `${it.text}\n\nIf this isn't for you, reply "no thanks" and I won't email again.`;
    const r = await sendMail(env, { to, subject: it.subject, text, fromName: it.from_name || 'Reece Egan-Sheath | House Almanac', dedupeDays: 60 });
    await kvSet(env, 'outbox_sent_' + it.id, new Date().toISOString());
    if (!r?.skipped) {
      sent++; sentToday++;
      await kvSet(env, 'outbox_day_' + today, String(sentToday));
      await kvSet(env, 'outbox_sent_count', String(Number(await kvGet(env, 'outbox_sent_count') || 0) + 1));
      await logEvent(env, null, 'outbox_sent', { id: it.id, kind: it.kind || 'other' });
    }
  }
  return { sent };
}
