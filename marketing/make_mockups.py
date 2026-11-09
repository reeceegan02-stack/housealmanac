"""Product mockups of the (fictional) Anita Street sample print."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
S='/tmp/claude-0/-home-claude/f53446ec-d38b-555b-9f62-36350c96cafa/scratchpad/styles/'
OUT='mockups/'
rng=np.random.default_rng(3)

def wall(w,h,base=(233,228,218),light=(1.04,0.93)):
    y=np.linspace(0,1,h)[:,None]; x=np.linspace(0,1,w)[None,:]
    g=light[0]-(light[0]-light[1])*(0.6*y+0.4*np.abs(x-0.35))
    a=np.stack([np.clip(c*g + rng.normal(0,2.2,(h,w)),0,255) for c in base],-1)
    return Image.fromarray(a.astype('uint8'))

def frame(print_img, ph, moulding=0.055, colour=(28,26,24), glass=True):
    pw=int(ph*print_img.width/print_img.height)
    p=print_img.resize((pw,ph),Image.LANCZOS)
    m=int(ph*moulding)
    W,H=pw+2*m,ph+2*m
    f=Image.new('RGB',(W,H),colour)
    d=ImageDraw.Draw(f)
    # bevel: lighter top/left edge, darker bottom
    hi=tuple(min(255,c+38) for c in colour); lo=tuple(max(0,c-12) for c in colour)
    d.polygon([(0,0),(W,0),(W-m,m),(m,m)],fill=hi)
    d.polygon([(0,0),(m,m),(m,H-m),(0,H)],fill=tuple(min(255,c+20) for c in colour))
    d.polygon([(0,H),(m,H-m),(W-m,H-m),(W,H)],fill=lo)
    f.paste(p,(m,m))
    # inner shadow from moulding onto print
    sh=Image.new('L',(pw,ph),0); sd=ImageDraw.Draw(sh)
    for i in range(14):
        sd.rectangle([i,i,pw-1-i//3,ph-1-i//3],outline=int(70*(1-i/14)))
    region=f.crop((m,m,m+pw,m+ph))
    f.paste(Image.composite(Image.new('RGB',(pw,ph),(0,0,0)),region,sh.filter(ImageFilter.GaussianBlur(3))),(m,m))
    if glass:
        gl=Image.new('L',(W,H),0); gd=ImageDraw.Draw(gl)
        gd.polygon([(int(W*0.55),m),(int(W*0.78),m),(int(W*0.32),H-m),(int(W*0.09),H-m)],fill=16)
        f=Image.composite(Image.new('RGB',(W,H),(255,255,255)),f,gl.filter(ImageFilter.GaussianBlur(30)))
    return f

def drop_shadow(canvas,obj,xy,off=(14,26),blur=28,alpha=110):
    x,y=xy; w,h=obj.size
    sh=Image.new('L',canvas.size,0); ImageDraw.Draw(sh).rectangle([x+off[0],y+off[1],x+w+off[0],y+h+off[1]],fill=alpha)
    sh=sh.filter(ImageFilter.GaussianBlur(blur))
    canvas.paste(Image.new('RGB',canvas.size,(40,32,24)),(0,0),sh)
    canvas.paste(obj,xy)

src=Image.open(S+'anita_web.png').convert('RGB')

# 1. Hero: framed on wall above sideboard, 2000x2000
W=H=2000
c=wall(W,H)
d=ImageDraw.Draw(c)
# sideboard
top=1620
d.rectangle([0,top,W,H],fill=(176,134,92))
d.rectangle([0,top,W,top+14],fill=(205,166,121))
for k in range(0,W,6):
    shade=int(rng.normal(0,6)); d.line([(k,top+16),(k,H)],fill=(176+shade,134+shade,92+shade))
d.rectangle([0,top+14,W,top+40],fill=(150,110,74))
fr=frame(src,1180)
x=(W-fr.width)//2; y=top-fr.height-150
drop_shadow(c,fr,(x,y))
# small vase + book stack for scale
d=ImageDraw.Draw(c)
d.rectangle([1500,top-120,1700,top-82],fill=(64,74,66)); d.rectangle([1510,top-82,1690,top-40],fill=(186,170,140)); d.rectangle([1495,top-40,1705,top],fill=(120,58,44))
vx=380; d.ellipse([vx-80,top-200,vx+80,top-10],fill=(214,206,192)); d.rectangle([vx-40,top-240,vx+40,top-150],fill=(214,206,192))
for a,b,col in [(-30,-520,(96,112,80)),(25,-480,(108,124,88)),(0,-560,(84,100,70))]:
    d.line([(vx,top-230),(vx+a*3,top+b)],fill=(90,80,60),width=5); d.ellipse([vx+a*3-38,top+b-26,vx+a*3+38,top+b+26],fill=col)
c=c.filter(ImageFilter.GaussianBlur(0.4))
c.save(OUT+'01_framed_on_wall.jpg',quality=90)

# 2. Detail close-up (crop of the print at full res, slight perspective-free)
crop=src.crop((int(src.width*0.03),int(src.height*0.47),int(src.width*0.97),int(src.height*0.97)))
crop=crop.resize((2000,int(2000*crop.height/crop.width)),Image.LANCZOS)
cc=wall(2000,2000,(225,219,207))
cc.paste(crop,(0,(2000-crop.height)//2))
cc.save(OUT+'02_detail_story_timeline.jpg',quality=90)
crop2=src.crop((int(src.width*0.03),int(src.height*0.02),int(src.width*0.97),int(src.height*0.50)))
crop2.resize((2000,int(2000*crop2.height/crop2.width)),Image.LANCZOS).save(OUT+'03_detail_historic_map.jpg',quality=90)

# 4. Flat-lay unframed on wooden table, 2000x2000
t=Image.new('RGB',(2000,2000),(160,118,80)); td=ImageDraw.Draw(t)
for k in range(0,2000,3):
    s=int(8*np.sin(k/37)+rng.normal(0,5)); td.line([(0,k),(2000,k)],fill=(160+s,118+s,80+s))
p=src.resize((1150,int(1150*src.height/src.width)),Image.LANCZOS).rotate(-4,expand=True,fillcolor=(0,0,0))
mask=Image.new('L',src.size,255).resize((1150,int(1150*src.height/src.width))).rotate(-4,expand=True)
sh=Image.new('L',t.size,0); sh.paste(mask,(440+18,190+30)); sh=sh.filter(ImageFilter.GaussianBlur(22)).point(lambda v:v*0.45)
t.paste(Image.new('RGB',t.size,(40,28,18)),(0,0),sh); t.paste(p,(440,190),mask)
t=t.crop((150,0,2150,2000)) if t.width>2000 else t
t.save(OUT+'04_unframed_flatlay.jpg',quality=90)

# 5. 4:5 portrait version of the hero for Instagram/ads
c.crop((200,0,1800,2000)).resize((1600,2000)).save(OUT+'05_framed_portrait_4x5.jpg',quality=90)
print('ok')
