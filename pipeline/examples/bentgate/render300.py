import sys, os
from playwright.sync_api import sync_playwright
src, out = sys.argv[1], sys.argv[2]
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width':1123,'height':1588}, device_scale_factor=3508/1123)
    pg.goto('file://' + os.path.abspath(src)); pg.wait_for_timeout(800)
    pg.screenshot(path=out, type='jpeg', quality=95, clip={'x':0,'y':0,'width':1123,'height':1587.5})
    b.close()
