// Renders the print HTML to a 300 dpi A3 JPEG (and a small proof) with Cloudflare Browser Rendering.
import puppeteer from '@cloudflare/puppeteer';
import { frameMap, tilesNeeded, MM } from './compose.js';
import { bytesToBase64 } from './util.js';

const UA = 'HouseAlmanac/1.0 (+https://housealmanac.co.uk; hello@housealmanac.co.uk)';
const W = 1123, H = 1588; // CSS px for 297 x 420 mm

// Fetch today's-map tiles server-side (with a proper User-Agent, per the OSM tile policy) and inline them.
export async function todayTiles(geo, lines) {
  const box = { w: 128 * MM, h: 85.3 * MM };
  const frame = frameMap({ lat: geo.lat, lon: geo.lon, lines, boxW: box.w, boxH: box.h, devicePx: 3508 / 1123, maxZoom: 18, minSpan: 820 });
  const need = tilesNeeded({ ...frame, boxW: box.w, boxH: box.h });
  const src = {};
  let failed = 0;
  await Promise.all(need.map(async ([z, x, y]) => {
    try {
      const r = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, { headers: { 'user-agent': UA, referer: 'https://housealmanac.co.uk/' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) { failed++; return; }
      src[`${z}/${x}/${y}`] = 'data:image/png;base64,' + bytesToBase64(new Uint8Array(await r.arrayBuffer()));
    } catch (e) { failed++; }
  }));
  return { frame, src, failed, count: need.length };
}

export async function renderPrint(env, html) {
  // keep_alive: the default 60s idle limit closes the browser while ~100 map tiles load.
  const browser = await puppeteer.launch(env.BROWSER, { keep_alive: 600000 });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 3508 / W });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 120000 });
    await page.evaluate(() => document.fonts.ready);
    const fit = await page.evaluate(() => window.__fit());
    const images = await page.evaluate(() => {
      const imgs = [...document.images];
      return { total: imgs.length, broken: imgs.filter(i => !i.complete || i.naturalWidth === 0).length };
    });
    const full = await page.screenshot({ type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: W, height: H - 0.4 } });
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.textContent = 'PROOF';
      d.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-30deg);font:700 160px Inter,sans-serif;color:rgba(156,63,42,.10);letter-spacing:.2em;pointer-events:none;z-index:99';
      document.body.appendChild(d);
    });
    const proof = await page.screenshot({ type: 'jpeg', quality: 82, clip: { x: 0, y: 0, width: W, height: H } });
    return { full: new Uint8Array(full), proof: new Uint8Array(proof), fit, images };
  } finally {
    await browser.close();
  }
}
