// The printable gift voucher (A5 landscape). Kept free of Worker-only imports so it can be rendered locally too.
import { esc, BRAND } from './util.js';

export const longDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });

export function voucherHtml(v, { printImg = `${BRAND.site}/sample.webp`, fontCss = '' } = {}) {
  const framed = v.product !== 'unframed';
  const what = framed
    ? 'A framed A3 House Almanac print: your street on a historic Ordnance Survey map and today, its history, a timeline and a message of your choice. Delivered free in the UK, ready to hang.'
    : 'An unframed A3 House Almanac print on 200gsm fine art paper: your street on a historic Ordnance Survey map and today, its history, a timeline and a message of your choice. Delivered free in the UK.';
  return `<!doctype html><html><head><meta charset="utf-8">
${fontCss ? `<style>${fontCss}</style>` : '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lora:ital,wght@0,500;0,700;1,500&display=swap" rel="stylesheet">'}
<style>
@page{size:210mm 148mm;margin:0}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{width:210mm;height:148mm;background:#f6f1e7;color:#2a241e;font-family:Inter,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.v{position:relative;width:210mm;height:148mm;display:grid;grid-template-columns:1.18fr .82fr;overflow:hidden}
.v:before{content:"";position:absolute;inset:5mm;border:0.35mm solid #2a241e;pointer-events:none;z-index:3}
.v:after{content:"";position:absolute;inset:6.2mm;border:0.15mm solid #9c3f2a;pointer-events:none;z-index:3}
.l{padding:13mm 8mm 12mm 14mm;display:flex;flex-direction:column}
.eb{font:600 2.55mm Inter,sans-serif;letter-spacing:.3em;text-transform:uppercase;color:#9c3f2a}
h1{font:700 10.4mm/1 Lora,Georgia,serif;letter-spacing:-.01em;margin:3mm 0 2.6mm}
.what{font-size:2.9mm;line-height:1.5;color:#5b5145;margin:0 0 4mm;max-width:92mm}
.row{display:flex;gap:3mm;align-items:baseline;font:500 4.6mm/1.25 Lora,Georgia,serif;margin:0 0 1.6mm}
.row span{font:600 2.3mm Inter,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#9c3f2a;min-width:10mm}
.msg{font:italic 500 3.9mm/1.35 Lora,Georgia,serif;border-left:0.6mm solid #9c3f2a;padding:0.5mm 0 0.5mm 3mm;margin:1.4mm 0 2.6mm;max-width:95mm}
.code{margin-top:auto;display:flex;align-items:center;gap:4mm}
.code b{font:700 6mm Inter,sans-serif;letter-spacing:.12em;border:0.4mm dashed #2a241e;padding:1.8mm 3.5mm;background:#fffdf8}
.code span{font:600 2.3mm Inter,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#9c3f2a;line-height:1.5}
.how{font-size:2.65mm;color:#5b5145;margin-top:2.6mm;line-height:1.45}
.how b{color:#2a241e}
.r{background:#ebe3d4;position:relative;display:flex;align-items:center;justify-content:center;margin:6.6mm 6.6mm 6.6mm 0}
.blank{display:inline-block;width:62mm;border-bottom:0.3mm dotted #5b5145;height:4.6mm}
.r .frame{transform:rotate(2.2deg);padding:${framed ? '2.4mm' : '0'};background:${framed ? '#1d1a17' : '#fff'};box-shadow:0 3mm 7mm rgba(42,36,30,.26),0 .4mm 1mm rgba(42,36,30,.15)}
.r img{width:${framed ? '54mm' : '58mm'};height:auto;display:block;background:#fff;padding:2.2mm}
</style></head><body><div class="v">
<div class="l">
  <div class="eb">House Almanac &middot; Gift voucher</div>
  <h1>The story of<br>your home</h1>
  <p class="what">${what}</p>
  ${v.recipient || v.from_name || v.message ? `
  ${v.recipient ? `<div class="row"><span>For</span>${esc(v.recipient)}</div>` : ''}
  ${v.message ? `<div class="msg">${esc(v.message)}</div>` : ''}
  ${v.from_name ? `<div class="row"><span>From</span>${esc(v.from_name)}</div>` : ''}` : `
  <div class="row" style="margin-top:2mm"><span>For</span><i class="blank"></i></div>
  <div class="row" style="margin-top:4mm"><span>From</span><i class="blank"></i></div>`}
  <div class="code"><b>${esc(v.code)}</b><span>Your<br>voucher code</span></div>
  <div class="how">Redeem at <b>housealmanac.co.uk/redeem</b>: enter the code and your address, approve your proof, and we'll do the rest. Valid until ${longDate(v.expires_at)}.</div>
</div>
<div class="r"><div class="frame"><img src="${printImg}" alt=""></div></div>
</div></body></html>`;
}

