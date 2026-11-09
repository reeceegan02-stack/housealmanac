import sys
from PIL import Image, ImageDraw, ImageFont
prefix, out = sys.argv[1], sys.argv[2]
keys=[('heritage','Heritage'),('modern','Modern'),('midnight','Midnight'),('sage','Sage')]
W=560; ims=[Image.open(f'{prefix}{k}.png').convert('RGB') for k,_ in keys]
h=int(ims[0].height*W/ims[0].width)
gap=40; top=30; lab=70
sheet=Image.new('RGB',(gap+len(ims)*(W+gap), top+h+lab),'#e9e6df')
d=ImageDraw.Draw(sheet)
f=ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-SemiBold.otf',28)
for i,(im,(k,n)) in enumerate(zip(ims,keys)):
    x=gap+i*(W+gap); sheet.paste(im.resize((W,h),Image.LANCZOS),(x,top))
    d.rectangle([x-1,top-1,x+W,top+h],outline='#b9b4aa')
    d.text((x+W/2, top+h+22), n, fill='#222', font=f, anchor='ma')
sheet.save(out,quality=90); print(sheet.size)
