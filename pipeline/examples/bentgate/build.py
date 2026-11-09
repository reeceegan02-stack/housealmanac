import sys, os
sys.path.insert(0, '../styles')
os.chdir(os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageOps
import themes
themes.S = '.'; themes.O = '.'
# heritage (sepia) base maps, same recipe as the Anita sample
for src, out in [('map_1890s.jpg','hero.jpg'), ('map_today_raw.jpg','today.jpg')]:
    g = ImageOps.autocontrast(Image.open(src).convert('L'), cutoff=0.3)
    ImageOps.colorize(g, black='#2b2620', white='#f3ecdd', mid='#a89a84').save(out, quality=93)
import shutil; shutil.copy('../styles/qr.png', 'qr.png')
outs = themes.build('bentgate_tpl.html', dict(hero='hero.jpg', today='today.jpg', title='78 Bentgate Street'), '.', 'bentgate_')
print(outs)
