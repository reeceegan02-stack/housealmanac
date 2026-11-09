import sys, os
from playwright.sync_api import sync_playwright
files = sys.argv[1:]
with sync_playwright() as p:
    b = p.chromium.launch()
    for f in files:
        pg = b.new_page(viewport={'width':1123,'height':1587}, device_scale_factor=2)
        pg.goto('file://' + os.path.abspath(f)); pg.wait_for_timeout(600)
        base = f[:-5]
        pg.screenshot(path=base + '.png')
        pg.pdf(path=base + '.pdf', width='297mm', height='420mm', print_background=True, prefer_css_page_size=True)
        pg.close(); print('ok', base)
    b.close()
