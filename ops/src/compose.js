// Builds the A3 print as an HTML page (297 x 420 mm) ready for headless-browser rendering.
import qrcode from 'qrcode-generator';
import { esc, BRAND } from './util.js';
import { project, metersPerPixel, haversine, nlsTileUrl } from './geo.js';

export const MM = 96 / 25.4; // CSS px per mm

export const THEMES = {
  heritage: {
    name: 'Heritage',
    css: ``,
    histFilter: 'grayscale(1) sepia(0.55) contrast(1.08) brightness(1.02)',
    todayFilter: 'grayscale(1) sepia(0.45) contrast(0.95) brightness(1.04)',
  },
  modern: {
    name: 'Modern',
    css: `:root{--paper:#fbfaf7;--ink:#141414;--soft:#62625e;--rule:#d9d8d3;--brick:#2346b5;--frame:#fbfaf7}
      body{font-family:'Inter',sans-serif}
      h1{font-family:'Inter',sans-serif;font-weight:800;letter-spacing:-0.035em}
      .sub{font-family:'Inter',sans-serif;font-style:normal;font-weight:400;font-size:13pt}
      .eyebrow{color:var(--ink);letter-spacing:0.28em}
      p.body{font-family:'Inter',sans-serif;font-size:9.4pt;line-height:1.5}
      p.body:first-of-type::first-letter{float:none;font:inherit;color:inherit;padding:0}
      .tl .item::before{border-radius:0;width:2.2mm;height:2.2mm;top:-1.3mm;background:var(--ink);border:none}
      .tl .item.key::before{background:var(--brick)}
      .tl .yr{font-family:'Inter',sans-serif;font-weight:700}
      .tl .what{font-family:'Inter',sans-serif;font-size:7.8pt}
      .msgbox{border:none !important;background:#efeeea}
      .msg{font-family:'Inter',sans-serif;font-style:normal;font-weight:300}
      .map{border:none}`,
    histFilter: 'grayscale(1) contrast(1.2) brightness(1.05)',
    todayFilter: 'grayscale(1) contrast(1.05) brightness(1.03)',
  },
  midnight: {
    name: 'Midnight',
    css: `:root{--paper:#141f37;--ink:#efe6d2;--soft:#b3ad9f;--rule:#34415e;--brick:#d4a94f;--frame:#17233d}
      h1{text-transform:uppercase;letter-spacing:0.06em;font-size:40pt}
      .sub{color:#cfc6b3}
      .map{border:0.3mm solid #8d8571}
      .msgbox{border-color:#8d8571 !important}
      .ring{fill-opacity:.16}`,
    histFilter: 'grayscale(1) invert(1) sepia(0.35) hue-rotate(180deg) saturate(1.4) brightness(0.9) contrast(1.05)',
    todayFilter: 'grayscale(1) invert(1) sepia(0.3) hue-rotate(180deg) saturate(1.3) brightness(0.85)',
  },
  sage: {
    name: 'Sage',
    css: `:root{--paper:#e7ebdf;--ink:#24302a;--soft:#56625a;--rule:#b8c1b0;--brick:#b0553a;--frame:#eef1e7}
      h1{font-style:italic}
      .sub{font-style:normal;font-family:'Inter',sans-serif;font-size:11pt;letter-spacing:0.14em;text-transform:uppercase}
      .map{border:0.3mm solid var(--ink)}`,
    histFilter: 'grayscale(1) sepia(0.35) hue-rotate(45deg) saturate(0.7) contrast(1.05) brightness(1.03)',
    todayFilter: 'grayscale(1) sepia(0.3) hue-rotate(45deg) saturate(0.6) brightness(1.04)',
  },
};

export function normaliseStyle(s) {
  const k = String(s || '').toLowerCase();
  for (const key of Object.keys(THEMES)) if (k.includes(key)) return key;
  return 'heritage';
}

// Work out map centre, zoom and scale for a box so that the street (or ~700 m) fits.
export function frameMap({ lat, lon, lines, boxW, boxH, devicePx, maxZoom, minSpan = 650, maxSpan = 1600 }) {
  let cLat = lat, cLon = lon, span = minSpan;
  const pts = (lines || []).flat();
  if (pts.length > 1) {
    const lats = pts.map(p => p[0]), lons = pts.map(p => p[1]);
    const bb = [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)];
    const diag = haversine([bb[0], bb[1]], [bb[2], bb[3]]);
    if (diag < maxSpan) {
      // centre between the house and the street's middle so both are well inside the frame
      cLat = (lat + (bb[0] + bb[2]) / 2) / 2;
      cLon = (lon + (bb[1] + bb[3]) / 2) / 2;
    }
    span = Math.max(minSpan, Math.min(maxSpan, diag * 1.45));
  }
  // choose zoom so 1 tile pixel ~ 1.0-1.5 device pixels
  let best = null;
  for (let z = maxZoom; z >= 14; z--) {
    const tilePxAcross = span / metersPerPixel(cLat, z);
    const ratio = (boxW * devicePx) / tilePxAcross;
    const cand = { z, ratio, scale: boxW / tilePxAcross };
    if (!best || Math.abs(Math.log(ratio / 1.25)) < Math.abs(Math.log(best.ratio / 1.25))) best = cand;
  }
  return { lat: cLat, lon: cLon, span, ...best };
}

// HTML for a tile mosaic covering a box. urlFor(z,x,y) -> src.
// A tile that fails (e.g. at a county-sheet boundary) tries the alternative layers in turn, then hides.
// Alternatives may be a parent tile at a lower zoom, shown cropped to the right quarter via "#vb=<object-view-box>".
const TILE_ONERROR = "var a=(this.dataset.alts||'').split('|').filter(Boolean);if(a.length){var n=a[0].split('#vb=');this.dataset.alts=a.slice(1).join('|');this.style.objectViewBox=n[1]||'';this.src=n[0];}else{this.onerror=null;this.style.visibility='hidden';}";

// Fallbacks for one historic tile: the same tile from the other county layers, then the matching part of
// the parent tile one and two zoom levels out (coverage has gaps at full detail in places, e.g. Didsbury).
export function histTileAlts(layers, primary, z, x, y) {
  const ordered = [primary, ...layers.filter(l => l !== primary)];
  const alts = ordered.slice(1).map(l => nlsTileUrl(l, z, x, y));
  for (const dz of [1, 2, 3]) {
    const n = 2 ** dz, qx = x % n, qy = y % n, pct = 100 / n;
    const vb = `inset(${(qy * pct).toFixed(2)}% ${((n - 1 - qx) * pct).toFixed(2)}% ${((n - 1 - qy) * pct).toFixed(2)}% ${(qx * pct).toFixed(2)}%)`;
    for (const l of ordered) alts.push(`${nlsTileUrl(l, z - dz, Math.floor(x / n), Math.floor(y / n))}#vb=${vb}`);
  }
  return alts;
}

export function tileLayer({ lat, lon, z, scale, boxW, boxH, urlFor, filter, altUrls }) {
  const [cx, cy] = project(lat, lon, z);
  const halfW = boxW / 2 / scale, halfH = boxH / 2 / scale;
  const x0 = Math.floor((cx - halfW) / 256), x1 = Math.floor((cx + halfW) / 256);
  const y0 = Math.floor((cy - halfH) / 256), y1 = Math.floor((cy + halfH) / 256);
  const size = 256 * scale;
  const imgs = [];
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      const left = (tx * 256 - cx) * scale + boxW / 2;
      const top = (ty * 256 - cy) * scale + boxH / 2;
      const alts = altUrls ? altUrls(z, tx, ty).join('|') : '';
      imgs.push(`<img src="${urlFor(z, tx, ty)}"${alts ? ` data-alts="${alts}" onerror="${TILE_ONERROR}"` : ''} style="position:absolute;left:${left.toFixed(2)}px;top:${top.toFixed(2)}px;width:${(size + 0.6).toFixed(2)}px;height:${(size + 0.6).toFixed(2)}px" alt="">`);
    }
  }
  return `<div class="tiles" style="position:absolute;inset:0;filter:${filter}">${imgs.join('')}</div>`;
}

export function tilesNeeded({ lat, lon, z, scale, boxW, boxH }) {
  const [cx, cy] = project(lat, lon, z);
  const halfW = boxW / 2 / scale, halfH = boxH / 2 / scale;
  const out = [];
  for (let tx = Math.floor((cx - halfW) / 256); tx <= Math.floor((cx + halfW) / 256); tx++)
    for (let ty = Math.floor((cy - halfH) / 256); ty <= Math.floor((cy + halfH) / 256); ty++) out.push([z, tx, ty]);
  return out;
}

export function streetSvg({ lines, lat, lon, z, scale, boxW, boxH, width }) {
  if (!lines || !lines.length) return '';
  const [cx, cy] = project(lat, lon, z);
  const polys = lines.map(line => line.map(([la, lo]) => {
    const [x, y] = project(la, lo, z);
    return `${((x - cx) * scale + boxW / 2).toFixed(1)},${((y - cy) * scale + boxH / 2).toFixed(1)}`;
  }).join(' '));
  return `<svg viewBox="0 0 ${boxW.toFixed(1)} ${boxH.toFixed(1)}" style="position:absolute;inset:0;width:100%;height:100%" aria-hidden="true">${polys.map(p => `<polyline points="${p}" class="hl" fill="none" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
}

export function homeMarker({ homeLat, homeLon, lat, lon, z, scale, boxW, boxH, r }) {
  const [cx, cy] = project(lat, lon, z);
  const [x, y] = project(homeLat, homeLon, z);
  const px = (x - cx) * scale + boxW / 2, py = (y - cy) * scale + boxH / 2;
  return `<svg viewBox="0 0 ${boxW.toFixed(1)} ${boxH.toFixed(1)}" style="position:absolute;inset:0;width:100%;height:100%" aria-hidden="true"><circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r}" class="ring" stroke-width="1.6"/></svg>`;
}

export function salesStrip(sales, nowYear = new Date().getFullYear()) {
  if (!sales || sales.length < 3) {
    return { svg: '', caption: 'Few sales have been recorded on this street since 1995.', n: sales ? sales.length : 0 };
  }
  const prices = sales.map(s => s.price).sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)];
  const clean = sales.filter(s => s.price > median * 0.2 && s.price < median * 5);
  const y0 = Math.min(1995, Math.floor(clean[0].year)), y1 = nowYear + 1;
  const X = (yr) => 30 + (yr - y0) / (y1 - y0) * 600;
  const lp = clean.map(s => Math.log(s.price));
  const lmin = Math.min(...lp), lmax = Math.max(...lp);
  const Y = (p) => 90 - (Math.log(p) - lmin) / Math.max(0.01, lmax - lmin) * 58;
  const ticks = [];
  for (let t = Math.ceil(y0 / 10) * 10; t <= y1; t += 10) ticks.push(t);
  const med = (arr) => { const a = arr.map(s => s.price).sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; };
  const early = clean.filter(s => s.year < clean[0].year + 5);
  const late = clean.filter(s => s.year > clean[clean.length - 1].year - 5);
  const fmt = (p) => '£' + (Math.round(p / 1000) * 1000).toLocaleString('en-GB');
  const eY0 = Math.floor(early[0].year), eY1 = Math.floor(early[early.length - 1].year);
  const lY0 = Math.floor(late[0].year), lY1 = Math.floor(late[late.length - 1].year);
  // Labels sit in their own row above the dots so they never collide with them.
  const svg = `<svg viewBox="0 0 640 116" style="width:128mm;height:23.2mm" aria-label="Recorded sale prices on the street">
    <line x1="30" y1="98" x2="630" y2="98" class="axis" stroke-width="1.6"/>
    <g font-family="Inter, sans-serif" font-size="13" class="softf">${ticks.map(t => `<text x="${X(t).toFixed(1)}" y="114" text-anchor="middle">${t}</text>`).join('')}</g>
    <g class="dots">${clean.map(s => `<circle cx="${X(s.year).toFixed(1)}" cy="${Y(s.price).toFixed(1)}" r="4.4"/>`).join('')}</g>
    <g font-family="Inter, sans-serif" font-size="13" class="inkf" font-weight="600">
      <text x="30" y="14">Typical sale ${eY0}${eY1 > eY0 ? '–' + eY1 : ''}: ${fmt(med(early))}</text>
      <text x="630" y="14" text-anchor="end">Typical sale ${lY0}${lY1 > lY0 ? '–' + lY1 : ''}: ${fmt(med(late))}</text>
    </g></svg>`;
  return { svg, caption: `${clean.length} recorded sales. House numbers and this home's own sales are left off.`, n: clean.length, from: y0 };
}

// QR code as a crisp SVG (black modules on white), sized by its container.
export function qrSvg(url) {
  const q = qrcode(0, 'M');
  q.addData(url);
  q.make();
  const n = q.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" style="width:100%;height:100%;display:block;background:#fff"><path d="${d}" fill="#111"/></svg>`;
}

// Estate-agent prints: logo (or name) and a QR code to their reviews, inside the message box.
function agentBlock(agent) {
  if (!agent) return '';
  const logo = agent.logoUrl
    ? `<img src="${esc(agent.logoUrl)}" alt="" style="max-width:30mm;max-height:12mm;object-fit:contain;display:block">`
    : `<div class="label" style="text-align:center;line-height:1.3">${esc(agent.name || '')}</div>`;
  const qr = agent.reviewUrl
    ? `<div style="display:flex;flex-direction:column;align-items:center;gap:.8mm"><div style="width:15mm;height:15mm">${qrSvg(agent.reviewUrl)}</div><div class="src" style="font-size:5.5pt;white-space:nowrap">Review us</div></div>`
    : '';
  return `<div style="display:flex;align-items:center;gap:4mm;flex:0 0 auto;margin-left:4mm;padding-left:4mm;border-left:.25mm solid currentColor;opacity:.95">
    <div style="display:flex;flex-direction:column;align-items:center;gap:1mm;max-width:32mm"><div class="src" style="font-size:5.5pt">With best wishes from</div>${logo}</div>${qr}</div>`;
}

export function composeHtml({ data, geo, lines, histLayer, histAlts = [], todayTiles, sales, style, message, fontScale = 1, agent = null }) {
  const theme = THEMES[normaliseStyle(style)];
  const heroBox = { w: 265 * MM, h: 178.2 * MM };
  const todayBox = { w: 128 * MM, h: 85.3 * MM };
  const dev = 3508 / 1123;

  const hero = frameMap({ lat: geo.lat, lon: geo.lon, lines, boxW: heroBox.w, boxH: heroBox.h, devicePx: dev, maxZoom: 18, minSpan: 820 });
  const today = todayTiles.frame;

  // Backing layer: OS six-inch 2nd edition (1890s-1910s, full GB coverage) under the 25-inch map, so any
  // patch the 25-inch scans don't cover shows the same-era map instead of blank paper.
  const bgZ = Math.min(hero.z, 17);
  const heroBg = tileLayer({ ...hero, z: bgZ, scale: hero.scale * 2 ** (hero.z - bgZ), boxW: heroBox.w, boxH: heroBox.h,
    urlFor: (z, x, y) => `https://mapseries-tilesets.s3.amazonaws.com/os/6inchsecond/${z}/${x}/${y}.png`, filter: theme.histFilter });
  const heroTiles = heroBg + (histLayer
    ? tileLayer({ ...hero, boxW: heroBox.w, boxH: heroBox.h, urlFor: (z, x, y) => nlsTileUrl(histLayer, z, x, y), filter: theme.histFilter,
        altUrls: (z, x, y) => histTileAlts(histAlts, histLayer, z, x, y) })
    : '');
  const todayLayer = tileLayer({ ...today, boxW: todayBox.w, boxH: todayBox.h, urlFor: (z, x, y) => todayTiles.src[`${z}/${x}/${y}`] || '', filter: theme.todayFilter });

  const heroHl = lines && lines.length
    ? streetSvg({ lines, ...hero, boxW: heroBox.w, boxH: heroBox.h, width: 13 })
    : homeMarker({ homeLat: geo.lat, homeLon: geo.lon, ...hero, boxW: heroBox.w, boxH: heroBox.h, r: 40 });
  const todayHl = lines && lines.length
    ? streetSvg({ lines, ...today, boxW: todayBox.w, boxH: todayBox.h, width: 7 })
    : homeMarker({ homeLat: geo.lat, homeLon: geo.lon, ...today, boxW: todayBox.w, boxH: todayBox.h, r: 20 });

  const strip = salesStrip(sales);
  const tl = data.timeline.map(t => `<div class="item${t.key ? ' key' : ''}"><div class="yr${t.key ? ' acc' : ''}">${esc(t.year)}</div><div class="what">${esc(t.text)}</div></div>`).join('');
  const cols = Math.max(6, data.timeline.length);
  const msg = esc(message || '').replace(/\n+/g, '<br>');
  const story = data.story.map(p => `<p class="body">${esc(p)}</p>`).join('');
  const sources = `Historic map: Ordnance Survey 25-inch, c.1890–1914, reproduced with the permission of the National Library of Scotland (CC-BY). Today's map: © OpenStreetMap contributors (ODbL). Sales: HM Land Registry Price Paid Data (OGL). ${esc(data.sources)}`;

  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>House Almanac — ${esc(data.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700;800&family=Lora:ital,wght@0,700;1,400;1,500&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=block" rel="stylesheet">
<style>
@page{size:297mm 420mm;margin:0}
:root{--paper:#f4eee2;--ink:#2a241e;--soft:#5b5145;--rule:#cbbfa9;--brick:#9c3f2a;--frame:#e9e0cf;--fs:${fontScale}}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:297mm;height:420mm;background:var(--paper)}
body{position:relative;color:var(--ink);font-family:'Source Serif 4',Georgia,serif;overflow:hidden}
.abs{position:absolute}
.eyebrow{font-family:'Inter',sans-serif;font-size:7.5pt;letter-spacing:.32em;text-transform:uppercase;color:var(--brick);font-weight:600}
.label{font-family:'Inter',sans-serif;font-size:6.6pt;letter-spacing:.18em;text-transform:uppercase;color:var(--soft);font-weight:600}
h1{font-family:'Lora',Georgia,serif;font-weight:700;font-size:46pt;line-height:1;letter-spacing:-.01em;white-space:nowrap}
.sub{font-family:'Lora',Georgia,serif;font-style:italic;font-size:14pt;color:var(--soft)}
.rule{height:0;border-top:.5mm solid var(--ink)}
.hair{height:0;border-top:.25mm solid var(--rule)}
.map{border:.35mm solid var(--ink);background:var(--frame);overflow:hidden}
p.body{font-size:calc(10.2pt * var(--fs));line-height:1.42;margin-bottom:2.6mm}
p.body:first-of-type::first-letter{font-family:'Lora',serif;font-weight:700;float:left;font-size:30pt;line-height:.9;padding:1.2mm 1.6mm 0 0;color:var(--brick)}
.cap{font-family:'Inter',sans-serif;font-size:6.4pt;color:var(--soft);line-height:1.35}
.tl{display:grid;grid-template-columns:repeat(${cols},1fr);gap:0 3mm}
.tl .item{border-top:.5mm solid var(--ink);padding-top:2mm;position:relative}
.tl .item::before{content:'';position:absolute;top:-1.6mm;left:0;width:2.6mm;height:2.6mm;border-radius:50%;background:var(--paper);border:.5mm solid var(--ink)}
.tl .item.key{border-top-color:var(--brick)}
.tl .item.key::before{background:var(--brick);border-color:var(--brick)}
.tl .yr{font-family:'Lora',serif;font-weight:700;font-size:12pt;margin-top:1mm}
.tl .what{font-size:8.4pt;line-height:1.3;margin-top:1mm}
.msg{font-family:'Lora',serif;font-style:italic;font-size:13pt;line-height:1.35}
.src{font-family:'Inter',sans-serif;font-size:5.6pt;color:var(--soft);line-height:1.45}
.ring{fill:var(--brick);fill-opacity:.13;stroke:var(--brick)}
.acc{color:var(--brick)} .inkc{color:var(--ink)}
.axis{stroke:var(--ink)} .softf{fill:var(--soft)} .inkf{fill:var(--ink)}
.dots{fill:var(--ink);fill-opacity:.85}
.hl{stroke:var(--brick);stroke-opacity:.34}
</style>
<style>${theme.css}</style>
</head><body>
<div class="abs eyebrow" style="left:16mm;top:15mm">The House Almanac</div>
<div class="abs label" style="right:16mm;top:15.4mm;text-align:right">${esc(data.header_right)}</div>
<div class="abs rule" style="left:16mm;right:16mm;top:20mm"></div>
<h1 class="abs" id="title" style="left:16mm;top:25mm">${esc(data.title)}</h1>
<div class="abs sub" style="left:16mm;top:45mm;max-width:170mm">${esc(data.subtitle)}</div>
<div class="abs cap" style="right:16mm;top:45.5mm;width:80mm;text-align:right;font-size:7pt">${esc(data.hero_note || '')}</div>

<div class="abs map" style="left:16mm;top:55mm;width:265mm;height:178.2mm">${heroTiles}${heroHl}</div>
<div class="abs cap" style="left:16mm;top:235mm;width:250mm">${esc(data.hero_caption).replace(/^([^.]*\.)/, '<b class="acc">$1</b>')}</div>

<div class="abs" id="story" style="left:16mm;top:244mm;width:128mm;height:94mm;overflow:hidden">
  <div class="label" style="margin-bottom:3mm">The story of your street</div>${story}
</div>

<div class="abs map" style="left:153mm;top:244mm;width:128mm;height:85.3mm">${todayLayer}${todayHl}</div>
<div class="abs cap" style="left:153mm;top:331mm;width:128mm">${esc(data.today_caption).replace(/^([^.]*\.)/, '<b class="inkc">$1</b>')}</div>

<div class="abs label" style="left:16mm;top:342mm">Your street through time</div>
<div class="abs tl" id="tl" style="left:16mm;top:348mm;width:265mm;height:21mm;overflow:hidden">${tl}</div>

<div class="abs" style="left:16mm;top:372mm;width:128mm">
  <div class="label" style="margin-bottom:1.6mm">Recorded sales on the street${strip.from ? `, ${strip.from}–${new Date().getFullYear()}` : ''}</div>
  ${strip.svg}
  <div class="cap" style="margin-top:1mm">${esc(strip.caption)}</div>
</div>

<div class="abs msgbox" style="left:153mm;top:372mm;width:128mm;height:30mm;border:.35mm solid var(--ink);padding:4mm 6mm;display:flex;flex-direction:row;align-items:center">
  <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center">
    <div class="msg" id="msg">${msg}</div>
    <div class="label acc" style="margin-top:2.4mm">${esc(data.message_label)}</div>
  </div>${agentBlock(agent)}
</div>

<div class="abs hair" style="left:16mm;right:16mm;top:406mm"></div>
<div class="abs src" id="src" style="left:16mm;top:407.5mm;width:265mm;max-height:10mm;overflow:hidden">${sources}</div>

<script>
// Shrink text that doesn't fit its box.
function fit(el, sel, min, prop){ const items = sel ? el.querySelectorAll(sel) : [el]; let s = 1;
  while ((el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) && s > min) { s -= 0.03; items.forEach(i => i.style[prop||'zoom'] = s); } return s; }
window.__fit = function(){
  const r = {};
  const t = document.getElementById('title'); let fs = 46; while (t.getBoundingClientRect().width > ${(265 * MM).toFixed(0)} && fs > 26) { fs -= 1; t.style.fontSize = fs + 'pt'; } r.title = fs;
  r.story = fit(document.getElementById('story'), 'p.body', 0.78);
  r.tl = fit(document.getElementById('tl'), '.what', 0.75);
  const box = document.querySelector('.msgbox'); const m = document.getElementById('msg'); let ms = 13; while (box.scrollHeight > box.clientHeight + 1 && ms > 8) { ms -= 0.5; m.style.fontSize = ms + 'pt'; } r.msg = ms;
  r.src = fit(document.getElementById('src'), null, 0.7);
  return r;
};
</script>
</body></html>`;
}
