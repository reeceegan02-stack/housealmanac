// Durable order pipeline: locate -> research -> render -> check -> email proof.
import { WorkflowEntrypoint } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { ensureSchema, getOrder, updateOrder, logEvent, randomKey, bytesToBase64, extractJson, BRAND } from './util.js';
import { geocode, streetGeometry, pickNlsLayer, streetSales } from './geo.js';
import { researchStreet, reviseContent } from './research.js';
import { composeHtml } from './compose.js';
import { todayTiles, renderPrint } from './render.js';
import { sendMail, proofEmail, jpegAttachment } from './mail.js';
import { claude, MODELS } from './claude.js';
import { createPrintOrder } from './prodigi.js';

const R = (limit, delay = '30 seconds') => ({ retries: { limit, delay, backoff: 'exponential' } });

export class OrderWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const env = this.env;
    const { orderId, mode = 'new' } = event.payload;

    const order = await step.do('load order', async () => {
      await ensureSchema(env);
      const o = await getOrder(env, orderId);
      if (!o) throw new NonRetryableError('Order not found ' + orderId);
      await updateOrder(env, orderId, { status: mode === 'revise' ? 'revising' : 'researching' });
      return o;
    });
    const rev = order.revision || 0;

    const geo = await step.do('geocode', R(4), () => geocode(order.address));
    const lines = await step.do('street geometry', R(3), () => streetGeometry(geo.lat, geo.lon, geo.street, geo.town));
    const nls = await step.do('historic map layer', R(2), () => pickNlsLayer(geo));
    const sales = await step.do('land registry sales', R(2), async () => {
      try { return await streetSales(geo); } catch (e) { return []; }
    });

    let data;
    if (mode === 'revise' && order.data_json) {
      data = await step.do(`revise v${rev}`, { ...R(2, '1 minute'), timeout: '15 minutes' }, () =>
        reviseContent(env, JSON.parse(order.data_json), order.change_notes || '', { address: order.address, message: order.message }));
    } else if (order.data_json) {
      // A previous attempt already researched this order (e.g. it failed later, at rendering): reuse it.
      data = JSON.parse(order.data_json);
    } else {
      data = await step.do('research', { ...R(2, '1 minute'), timeout: '20 minutes' }, async () => {
        const d = await researchStreet(env, { ...geo, address: order.address, moveIn: order.move_in, message: order.message, sales });
        await updateOrder(env, order.id, { data_json: JSON.stringify(d) });
        return d;
      });
    }
    const message = (mode === 'revise' && typeof data.message === 'string') ? data.message : order.message;

    const rendered = await step.do(`render v${rev}`, { ...R(2, '1 minute'), timeout: '10 minutes' }, async () => {
      const today = await todayTiles(geo, lines);
      const html = composeHtml({ data, geo, lines, histLayer: nls.layer, todayTiles: today, sales, style: order.style, message });
      const r = await renderPrint(env, html);
      const fileKey = `print-${order.id}-v${rev}-${randomKey(10)}.jpg`;
      const proofKey = `proof-${order.id}-v${rev}-${randomKey(10)}.jpg`;
      await env.FILES.put(fileKey, r.full, { metadata: { type: 'image/jpeg' } });
      await env.FILES.put(proofKey, r.proof, { metadata: { type: 'image/jpeg' } });
      await env.FILES.put(`html-${order.id}-v${rev}`, html.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, ''), { metadata: { type: 'text/html' } });
      return { fileKey, proofKey, fit: r.fit, images: r.images, osmFailed: today.failed, osmCount: today.count, fullBytes: r.full.length };
    });

    const qa = await step.do(`check v${rev}`, R(2), async () => {
      const proof = await env.FILES.get(rendered.proofKey, 'arrayBuffer');
      return checkProof(env, new Uint8Array(proof), data, message, rendered);
    });
    await logEvent(env, order.id, 'qa', { qa, rendered: { ...rendered, fileKey: undefined, proofKey: undefined }, layer: nls.layer });

    if (!qa.ok) {
      await step.do(`flag v${rev}`, async () => {
        await updateOrder(env, order.id, { status: 'needs_attention', data_json: JSON.stringify(data), file_key: rendered.fileKey, proof_key: rendered.proofKey, notes: 'QA: ' + qa.blocking.join('; ') });
        await sendMail(env, {
          to: BRAND.from, orderId: order.id, bcc: false,
          subject: `ACTION NEEDED: proof check failed for ${order.id}`,
          text: `The automatic check found problems with the proof for ${order.id} (${order.address}):\n\n- ${qa.blocking.join('\n- ')}\n\nProof: ${env.PUBLIC_BASE}/f/${rendered.proofKey}\nThe customer has not been sent anything yet.`,
        });
      });
      return { status: 'needs_attention', qa };
    }

    if (order.source === 'etsy' && rev === 0) {
      // Etsy buyers can't be emailed a proof, so print straight after the automatic check.
      await step.do('print etsy order', R(3, '2 minutes'), async () => {
        await updateOrder(env, order.id, { data_json: JSON.stringify(data), message, file_key: rendered.fileKey, proof_key: rendered.proofKey, status: 'approved' });
        const po = await createPrintOrder(env, { ...order, revision: rev }, `${env.PUBLIC_BASE}/f/${rendered.fileKey}`);
        await updateOrder(env, order.id, { status: 'printing', prodigi_id: po.id });
        await logEvent(env, order.id, 'prodigi_order', { id: po.id, auto: 'etsy' });
      });
      return { status: 'printing', qa };
    }

    await step.do(`email proof v${rev}`, async () => {
      const proof = new Uint8Array(await env.FILES.get(rendered.proofKey, 'arrayBuffer'));
      const t = proofEmail(order, data, rev);
      const to = order.source === 'agent-sample' ? (JSON.parse(order.ship_json || '{}').agent_email || order.email) : order.email;
      await sendMail(env, { to, subject: t.subject, text: t.text, orderId: order.id, attachments: [jpegAttachment(proof, `House-Almanac-proof-${order.id}.jpg`)] });
      await updateOrder(env, order.id, {
        status: 'proof_sent', data_json: JSON.stringify(data), message,
        file_key: rendered.fileKey, proof_key: rendered.proofKey,
      });
    });
    return { status: 'proof_sent', qa };
  }
}

// Vision check of the proof before it goes to the customer.
export async function checkProof(env, proofBytes, data, message, rendered) {
  const blocking = [];
  if (rendered.images.broken > Math.max(2, rendered.images.total * 0.05)) blocking.push(`${rendered.images.broken} of ${rendered.images.total} map tiles failed to load`);
  if (rendered.osmFailed > rendered.osmCount * 0.2) blocking.push(`today's map: ${rendered.osmFailed} of ${rendered.osmCount} tiles failed`);
  if (rendered.fit && rendered.fit.story < 0.8) blocking.push('story text had to shrink a lot to fit');
  let review = { ok: true, blocking_issues: [], minor_issues: [] };
  try {
    const { text } = await claude(env, {
      model: MODELS.research, maxTokens: 800,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: bytesToBase64(proofBytes) } },
        { type: 'text', text: `This is a low-resolution proof of a personalised A3 house-history print (the diagonal "PROOF" mark is expected).
Check only for problems that would embarrass us if printed:
1. Is the large top map a historic map with visible streets and buildings (not blank, grey or missing)?
2. Is the smaller "today" map showing a street map (not blank)?
3. Is any text cut off, overlapping other elements, or running outside its box?
4. Does the title read "${data.title}" and does the message box read: "${message}"?
5. Any obvious spelling mistakes in large text?
Reply with JSON only: {"ok": true|false, "blocking_issues": ["..."], "minor_issues": ["..."]}. ok=false only for real, visible problems.` },
      ] }],
    });
    review = extractJson(text);
  } catch (e) {
    review.minor_issues = ['vision check unavailable: ' + e.message];
  }
  blocking.push(...(review.blocking_issues || []));
  return { ok: blocking.length === 0, blocking, minor: review.minor_issues || [] };
}
