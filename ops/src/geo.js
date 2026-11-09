// Address lookup, street geometry, historic map layer choice and Land Registry sales.

const UA = 'HouseAlmanac/1.0 (+https://housealmanac.co.uk; hello@housealmanac.co.uk)';
// Every outside lookup gets a time limit so one slow service can't stall an order.
const T = (ms) => ({ signal: AbortSignal.timeout(ms) });

const POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

export function parseAddress(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  const pc = text.match(POSTCODE_RE);
  const postcode = pc ? `${pc[1]} ${pc[2]}`.toUpperCase() : null;
  const firstPart = text.split(',')[0].trim();
  // "Flat 2, 14 Anita Street" / "14a Anita Street" / "Rose Cottage, Anita Street"
  const parts = text.split(',').map(s => s.trim()).filter(Boolean);
  let houseNumber = null, street = null, saon = null;
  for (const p of parts) {
    const m = p.match(/^(\d+[A-Za-z]?(?:-\d+[A-Za-z]?)?)\s+(.+)$/);
    if (m && /\b(street|st|road|rd|lane|ln|avenue|ave|close|drive|dr|way|grove|terrace|place|crescent|court|gardens|row|walk|hill|square|mews|view|rise|park|green|parade|fold|brow|bank|croft|meadow|meadows|wynd|gate)\b/i.test(m[2])) {
      houseNumber = m[1]; street = m[2]; break;
    }
  }
  if (!street) {
    const m = firstPart.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
    if (m) { houseNumber = m[1]; street = m[2]; }
  }
  if (!street) {
    const named = parts.find(p => /\b(street|road|lane|avenue|close|drive|way|grove|terrace|place|crescent|court|gardens|row|walk|hill|square|mews|view|rise|park|green|parade|fold|brow|bank|croft|meadows?|wynd|gate)\b/i.test(p) && !/^\d/.test(p));
    if (named) street = named;
  }
  const flat = text.match(/\b(flat|apartment|apt)\s*([\w-]+)/i);
  if (flat) saon = `${flat[1]} ${flat[2]}`.toUpperCase();
  if (street) street = street.replace(POSTCODE_RE, '').replace(/,.*$/, '').trim();
  return { text, postcode, houseNumber, street, saon, houseName: !houseNumber ? firstPart : null };
}

export async function postcodeInfo(postcode) {
  if (!postcode) return null;
  const r = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`, { headers: { 'user-agent': UA }, ...T(15000) });
  if (!r.ok) return null;
  const d = (await r.json()).result;
  return d && {
    lat: d.latitude, lon: d.longitude,
    district: d.admin_district, county: d.admin_county, region: d.region,
    ward: d.admin_ward, parish: d.parish, outcode: d.outcode, country: d.country,
  };
}

export async function nominatim(query) {
  const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=gb&limit=1&q=${encodeURIComponent(query)}`;
  const r = await fetch(u, { headers: { 'user-agent': UA, 'accept-language': 'en-GB' }, ...T(15000) });
  if (!r.ok) return null;
  const d = await r.json();
  if (!d.length) return null;
  const a = d[0].address || {};
  return {
    lat: +d[0].lat, lon: +d[0].lon, road: a.road, suburb: a.suburb || a.neighbourhood || a.village || a.hamlet,
    town: a.town || a.city || a.village, county: a.county || a.state_district, postcode: a.postcode,
  };
}

export async function geocode(rawAddress) {
  const p = parseAddress(rawAddress);
  const pcInfo = await postcodeInfo(p.postcode);
  let nom = await nominatim(p.text);
  if (!nom && p.street && p.postcode) nom = await nominatim(`${p.street}, ${p.postcode}`);
  if (!nom && p.street && pcInfo) nom = await nominatim(`${p.street}, ${pcInfo.district}`);
  const lat = nom?.lat ?? pcInfo?.lat;
  const lon = nom?.lon ?? pcInfo?.lon;
  if (lat == null) throw new Error('Could not locate address: ' + p.text);
  return {
    ...p,
    street: nom?.road || p.street,
    lat, lon,
    suburb: nom?.suburb || pcInfo?.ward || null,
    town: nom?.town || pcInfo?.district || null,
    county: nom?.county || pcInfo?.county || pcInfo?.region || null,
    district: pcInfo?.district || null,
    region: pcInfo?.region || null,
    country: pcInfo?.country || 'England',
    outcode: pcInfo?.outcode || (p.postcode ? p.postcode.split(' ')[0] : null),
  };
}

// Street centreline from OpenStreetMap. Returns array of polylines [[lat,lon],...].
export async function streetGeometry(lat, lon, street, town) {
  if (!street) return [];
  const name = street.replace(/["\\]/g, '');
  const q = `[out:json][timeout:25];way(around:400,${lat},${lon})["highway"]["name"="${name}"];out geom;`;
  for (const host of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
    try {
      const r = await fetch(host, { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), ...T(30000) });
      if (!r.ok) continue;
      const d = await r.json();
      const lines = (d.elements || []).filter(e => e.geometry).map(e => e.geometry.map(g => [g.lat, g.lon]));
      if (lines.length) return lines;
    } catch (e) { /* try next */ }
  }
  // Fallback: Nominatim returns the street's line geometry too.
  try {
    const u = new URL('https://nominatim.openstreetmap.org/search');
    u.search = new URLSearchParams({ format: 'jsonv2', countrycodes: 'gb', limit: '10', polygon_geojson: '1', street: name, ...(town ? { city: town } : {}) }).toString();
    const r = await fetch(u, { headers: { 'user-agent': UA, 'accept-language': 'en-GB' }, ...T(15000) });
    if (!r.ok) return [];
    const d = await r.json();
    const lines = [];
    for (const e of d) {
      if (e.category !== 'highway' || !e.geojson) continue;
      if (haversine([lat, lon], [+e.lat, +e.lon]) > 800) continue;
      const g = e.geojson;
      const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      for (const part of parts) lines.push(part.map(([x, y]) => [y, x]));
    }
    return lines;
  } catch (e) { return []; }
}

// ---------- Web Mercator ----------
export function project(lat, lon, z) {
  const n = 256 * 2 ** z;
  const x = (lon + 180) / 360 * n;
  const s = Math.sin(lat * Math.PI / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return [x, y];
}
export function metersPerPixel(lat, z) {
  return 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** z;
}
export function haversine(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------- NLS 25-inch historic map layer ----------
const NLS_BASE = 'https://mapseries-tilesets.s3.amazonaws.com/25_inch';
const COUNTY_HINTS = {
  'greater manchester': ['lancashire', 'cheshire'],
  'merseyside': ['lancashire', 'cheshire'],
  'lancashire': ['lancashire'],
  'cheshire': ['cheshire'],
  'cheshire east': ['cheshire'],
  'cheshire west and chester': ['cheshire'],
  'west yorkshire': ['yorkshire', 'west_riding'],
  'south yorkshire': ['yorkshire', 'west_riding'],
  'north yorkshire': ['yorkshire', 'north_riding'],
  'east riding of yorkshire': ['yorkshire', 'east_riding'],
  'greater london': ['london', 'middlesex', 'surrey', 'kent', 'essex'],
  'west midlands': ['warwickshire', 'staffordshire', 'worcestershire'],
  'tyne and wear': ['durham', 'northumberland'],
};

export function nlsCandidates(geo) {
  const keys = [geo.county, geo.region, geo.district].filter(Boolean).map(s => s.toLowerCase());
  const out = [];
  for (const k of keys) {
    if (COUNTY_HINTS[k]) out.push(...COUNTY_HINTS[k]);
    out.push(k.replace(/&/g, 'and').replace(/[^a-z]+/g, '_').replace(/^_|_$/g, ''));
  }
  out.push('holes_england', '25_inch_holes_england');
  return [...new Set(out)];
}

export function nlsTileUrl(layer, z, x, y) {
  return `${NLS_BASE}/${layer}/${z}/${x}/${y}.png`;
}

export async function pickNlsLayer(geo) {
  const z = 17;
  const [px, py] = project(geo.lat, geo.lon, z);
  const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
  const tried = [];
  for (const layer of nlsCandidates(geo)) {
    let total = 0, ok = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) {
      try {
        const r = await fetch(nlsTileUrl(layer, z, tx + dx, ty + dy), T(15000));
        if (!r.ok) continue;
        const size = (await r.arrayBuffer()).byteLength;
        total += size; if (size > 6000) ok++;
      } catch (e) { /* ignore */ }
    }
    tried.push({ layer, ok, total });
    if (ok >= 4) return { layer, tried };
  }
  tried.sort((a, b) => b.ok - a.ok || b.total - a.total);
  return { layer: tried[0]?.ok ? tried[0].layer : null, tried };
}

// ---------- HM Land Registry Price Paid ----------
export async function streetSales(geo) {
  if (!geo.street) return [];
  const street = geo.street.toUpperCase().replace(/"/g, '');
  const prefix = (geo.outcode || '').toUpperCase();
  const query = `PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
SELECT ?paon ?saon ?amount ?date ?pc WHERE {
  ?addr lrcommon:street "${street}" .
  ?addr lrcommon:postcode ?pc .
  ${prefix ? `FILTER(STRSTARTS(STR(?pc), "${prefix} "))` : ''}
  ?tx lrppi:propertyAddress ?addr ; lrppi:pricePaid ?amount ; lrppi:transactionDate ?date .
  OPTIONAL { ?addr lrcommon:paon ?paon }
  OPTIONAL { ?addr lrcommon:saon ?saon }
} ORDER BY ?date LIMIT 2000`;
  const r = await fetch('https://landregistry.data.gov.uk/landregistry/query', {
    method: 'POST',
    headers: { 'user-agent': UA, accept: 'application/sparql-results+json', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'query=' + encodeURIComponent(query), ...T(45000),
  });
  if (!r.ok) throw new Error('Land Registry query failed ' + r.status);
  const d = await r.json();
  const own = (geo.houseNumber || geo.houseName || '').toUpperCase();
  const ownSaon = (geo.saon || '').toUpperCase();
  const rows = [];
  for (const b of d.results.bindings) {
    const paon = (b.paon?.value || '').toUpperCase();
    const saon = (b.saon?.value || '').toUpperCase();
    if (own && paon === own && (!ownSaon || saon === ownSaon || !saon)) continue; // never show the customer's own sales
    const date = b.date.value;
    const yr = +date.slice(0, 4) + (+date.slice(5, 7) - 1) / 12;
    rows.push({ year: Math.round(yr * 100) / 100, price: +b.amount.value });
  }
  return rows;
}
