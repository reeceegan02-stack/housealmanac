from PIL import Image, ImageOps, ImageEnhance
import os, shutil
S = 'sample'; O = 'styles'

def gray(fn):
    g = Image.open(os.path.join(S, fn)).convert('L')
    return ImageOps.autocontrast(g, cutoff=0.5)

def tint(fn, out, black, white, mid=None, invert=False, contrast=1.0):
    g = gray(fn)
    if invert: g = ImageOps.invert(g)
    if contrast != 1.0: g = ImageEnhance.Contrast(g).enhance(contrast)
    kw = dict(black=black, white=white)
    if mid: kw['mid'] = mid
    ImageOps.colorize(g, **kw).save(os.path.join(O, out), quality=93)

THEMES = {
 'heritage': dict(name='Heritage', blurb='Warm paper, sepia maps, classic serif.',
   hero='hero.jpg', today='today.jpg', css=''),
 'modern': dict(name='Modern', blurb='Crisp white, black-line maps, one bold colour.',
   maps=dict(black='#151515', white='#fbfaf7', mid='#8a8a86', contrast=1.15),
   css='''
  :root { --paper:#fbfaf7; --ink:#141414; --soft:#62625e; --rule:#d9d8d3; --brick:#2346b5; --frame:#fbfaf7; }
  body { font-family:'Inter', sans-serif; }
  h1 { font-family:'Inter Display','Inter',sans-serif; font-weight:800; font-size:52pt; letter-spacing:-0.035em; }
  .sub { font-family:'Inter',sans-serif; font-style:normal; font-weight:400; font-size:13pt; letter-spacing:0.01em; }
  .eyebrow { color: var(--ink); letter-spacing:0.28em; }
  .rule { border-top-width:0.35mm; }
  .map { border:none; }
  p.body { font-size:9.4pt; line-height:1.5; hyphens:manual; }
  p.body:first-of-type::first-letter { float:none; font:inherit; color:inherit; padding:0; }
  .tl .item { border-top-width:0.35mm; }
  .tl .item::before { border-radius:0; width:2.2mm; height:2.2mm; top:-1.3mm; background:var(--ink); border:none; }
  .tl .item.key::before { background:var(--brick); }
  .tl .yr { font-family:'Inter Display','Inter',sans-serif; font-weight:700; font-size:12pt; letter-spacing:-0.01em; }
  .tl .what { font-family:'Inter',sans-serif; font-size:7.8pt; }
  .msgbox { border:none !important; background:#efeeea; }
  .msg { font-family:'Inter Display','Inter',sans-serif; font-style:normal; font-weight:300; font-size:13.5pt; }
  .ring { fill-opacity:.10; }
'''),
 'midnight': dict(name='Midnight', blurb='Deep navy, cream line maps, brass details.',
   maps=dict(black='#17233d', white='#ece2cb', mid='#56627a', invert=True, contrast=1.05),
   css='''
  :root { --paper:#141f37; --ink:#efe6d2; --soft:#b3ad9f; --rule:#34415e; --brick:#d4a94f; --frame:#17233d; }
  h1 { font-family:'TeX Gyre Pagella',serif; font-weight:700; text-transform:uppercase; letter-spacing:0.07em; font-size:44pt; }
  .sub { color:#cfc6b3; }
  .eyebrow { letter-spacing:0.36em; }
  .map { border:0.3mm solid #8d8571; }
  .ring { fill-opacity:.16; }
  .msgbox { border-color:#8d8571 !important; }
  .qr { background:#fff; padding:0.8mm; }
'''),
 'sage': dict(name='Sage', blurb='Soft green paper, muted maps, terracotta accent.',
   maps=dict(black='#25322b', white='#eef1e7', mid='#9eaa98', contrast=1.0),
   css='''
  :root { --paper:#e7ebdf; --ink:#24302a; --soft:#56625a; --rule:#b8c1b0; --brick:#b0553a; --frame:#eef1e7; }
  h1 { font-family:'Lora',serif; font-weight:700; font-style:italic; letter-spacing:-0.005em; }
  .sub { font-style:normal; font-family:'Inter',sans-serif; font-size:11.5pt; letter-spacing:0.14em; text-transform:uppercase; color:var(--soft); }
  .map { border:0.3mm solid var(--ink); }
'''),
}

def build(tpl_path, data, out_dir, prefix):
    tpl = open(tpl_path).read()
    outs = []
    for key, t in THEMES.items():
        if 'maps' in t:
            m = dict(t['maps']); inv = m.pop('invert', False); c = m.pop('contrast', 1.0)
            tint(data['hero'], f'{prefix}hero_{key}.jpg', invert=inv, contrast=c, **m)
            tint(data['today'], f'{prefix}today_{key}.jpg', invert=inv, contrast=c, **m)
            hero, today = f'{prefix}hero_{key}.jpg', f'{prefix}today_{key}.jpg'
        else:
            shutil.copy(os.path.join(S, data['hero']), os.path.join(O, f'{prefix}hero_{key}.jpg'))
            shutil.copy(os.path.join(S, data['today']), os.path.join(O, f'{prefix}today_{key}.jpg'))
            hero, today = f'{prefix}hero_{key}.jpg', f'{prefix}today_{key}.jpg'
        html = tpl.replace('{{hero}}', hero).replace('{{today}}', today)\
                  .replace('{{theme_css}}', t['css']).replace('{{title}}', data['title'] + ' — ' + t['name'])
        p = os.path.join(out_dir, f'{prefix}{key}.html')
        open(p, 'w').write(html); outs.append((key, p))
    return outs

if __name__ == '__main__':
    shutil.copy('sample/qr.png', 'styles/qr.png')
    for k, p in build('styles/almanac_tpl.html', dict(hero='hero.jpg', today='today.jpg', title='Anita Street'), O, 'anita_'):
        print(k, p)
