import re, sys
src = open('sample/almanac.html').read()
R = [
 ('<title>House Almanac — Anita Street (sample)</title>', '<title>House Almanac — {{title}}</title>'),
 ('fill="#9c3f2a" fill-opacity="0.13" stroke="#9c3f2a" stroke-width="3.2"', 'class="ring" stroke-width="3.2"'),
 ('fill="#9c3f2a" fill-opacity="0.12" stroke="#9c3f2a" stroke-width="3"', 'class="ring" stroke-width="3"'),
 ('<b style="color:#9c3f2a">', '<b class="acc">'),
 ('<b style="color:#2a241e">', '<b class="inkc">'),
 ('<div class="yr" style="color:#9c3f2a">', '<div class="yr acc">'),
 ('stroke="#2a241e" stroke-width="1.6"', 'class="axis" stroke-width="1.6"'),
 ('font-size="13" fill="#5b5145"', 'font-size="13" class="softf"'),
 ('<g fill="#2a241e" fill-opacity="0.85">', '<g class="dots">'),
 ('r="6" fill="#9c3f2a"', 'r="6" class="accf"'),
 ('font-size="13" fill="#2a241e" font-weight="600"', 'font-size="13" class="inkf" font-weight="600"'),
 ('border:0.35mm solid #2a241e;', 'border:0.35mm solid var(--ink);'),
 ('<div class="label" style="margin-top:2.4mm; color:#9c3f2a;">', '<div class="label acc" style="margin-top:2.4mm;">'),
 ('src="hero.jpg"', 'src="{{hero}}"'),
 ('src="today.jpg"', 'src="{{today}}"'),
 ('<div class="abs map" style="left:16mm; top:55mm;', '<div class="abs map hero" style="left:16mm; top:55mm;'),
 ('<div class="abs" style="left:153mm; top:372mm;', '<div class="abs msgbox" style="left:153mm; top:372mm;'),
 ('<img src="qr.png"', '<img class="qr" src="qr.png"'),
 ('</style>\n</head>', '''  .ring { fill: var(--brick); fill-opacity: .13; stroke: var(--brick); }
  .acc { color: var(--brick); } .inkc { color: var(--ink); }
  .axis { stroke: var(--ink); } .softf { fill: var(--soft); } .inkf { fill: var(--ink); }
  .dots { fill: var(--ink); fill-opacity: .85; } .accf { fill: var(--brick); }
</style>
<style>{{theme_css}}</style>
</head>'''),
]
for a, b in R:
    n = src.count(a)
    if n == 0: sys.exit('MISSING: ' + a)
    src = src.replace(a, b)
left = re.findall(r'#(?:9c3f2a|2a241e|5b5145)', src.split('</style>',1)[1])
print('hardcoded colours left in body:', left)
open('styles/almanac_tpl.html', 'w').write(src)
