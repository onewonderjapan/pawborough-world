"""Analytic food/paper textures for the snack batch. Nothing traced from photos; labels typeset with a system font."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import numpy as np,json
OUT=Path(__file__).resolve().parent/'textures';OUT.mkdir(exist_ok=True)
rng=np.random.default_rng(88);N=512;yy,xx=np.mgrid[0:N,0:N]/N
def noise(scale,amp):
 small=rng.normal(0,1,(scale,scale));img=np.kron(small,np.ones((N//scale,N//scale)))
 return img*amp
def save(name,img,q=90):Image.fromarray(np.uint8(np.clip(img,0,255))).save(OUT/name,quality=q)
def flecks(img,count,rx,ry,color,margin=.1):
 for _ in range(count):
  cx,cy=rng.uniform(margin,1-margin,2);a=rng.uniform(0,np.pi)
  m=((((xx-cx)*np.cos(a)+(yy-cy)*np.sin(a))/rx)**2+(((yy-cy)*np.cos(a)-(xx-cx)*np.sin(a))/ry)**2)<1;img[m]=color
# golden crust with mottling (油墩子/粢饭糕/春卷/油条 sides), tileable-ish
base=np.stack([205,140,60],0)[:,None,None]*(1+noise(16,.08)+noise(64,.05))[None]
save('fried-crust.jpg',base.transpose(1,2,0))
# sesame flatbread top (蟹壳黄/大饼): golden + white sesame ovals
img=np.stack([214,158,84],0)[:,None,None]*(1+noise(32,.06))[None];img=img.transpose(1,2,0).copy()
rr=np.hypot(xx-.5,yy-.5);img[rr>.47]=[196,140,70]
flecks(img,160,.022,.012,[242,232,205],.12);save('sesame-top.jpg',img)
# scallion pancake top: layered golden with brown scorch patches and green flecks
img=np.stack([222,178,104],0)[:,None,None]*(1+noise(32,.07))[None];img=img.transpose(1,2,0).copy()
for _ in range(14):
 cx,cy=rng.uniform(.15,.85,2);m=np.hypot(xx-cx,yy-cy)<rng.uniform(.03,.07);img[m]=img[m]*.72
flecks(img,60,.014,.008,[92,138,58],.1);save('scallion-pancake.jpg',img)
# babaofan top: white glutinous rice, red-bean centre, coloured candied fruit ring
img=np.stack([236,232,222],0)[:,None,None]*(1+noise(64,.04))[None];img=img.transpose(1,2,0).copy()
rr=np.hypot(xx-.5,yy-.5);img[rr<.16]=[98,44,40]
cols=[[190,40,40],[230,170,40],[60,120,60],[240,220,120],[120,50,30],[220,120,150]]
for k in range(14):
 a=2*np.pi*k/14;cx,cy=.5+.30*np.cos(a),.5+.30*np.sin(a);m=np.hypot(xx-cx,yy-cy)<.035;img[m]=cols[k%6]
for k in range(8):
 a=2*np.pi*k/8+.3;cx,cy=.5+.22*np.cos(a),.5+.22*np.sin(a);m=np.hypot(xx-cx,yy-cy)<.018;img[m]=[110,40,30]
save('babaofan-top.jpg',img)
# osmanthus sweet soup surface: pale amber with tiny orange flecks
img=np.stack([232,205,150],0)[:,None,None]*(1+noise(64,.03))[None];img=img.transpose(1,2,0).copy()
flecks(img,90,.006,.004,[230,150,50],.05);save('osmanthus-soup.jpg',img)
# bean mass for the jar: dark brown lumps
img=np.stack([92,60,36],0)[:,None,None]*(1+noise(16,.10)+noise(64,.12))[None];img=img.transpose(1,2,0).copy()
for _ in range(500):
 cx,cy=rng.uniform(0,1,2);m=np.hypot(xx-cx,yy-cy)<.018;img[m]=img[m]*rng.uniform(.8,1.25)
save('bean-mass.jpg',img)
# label atlas 512x512, 4 rows (128 px): packet / box / shop mark
font='/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc'
atlas=Image.new('RGB',(512,512),(238,226,196));d=ImageDraw.Draw(atlas)
rows=[('奶油五香豆',(170,30,30),(238,226,196)),('梨膏糖',(40,60,110),(240,230,200)),('城隍廟 特產',(120,30,30),(236,220,180)),('老城隍廟',(200,160,60),(120,26,26))]
for i,(t,fg,bg) in enumerate(rows):
 y=i*128;d.rectangle((0,y,512,y+128),fill=bg);d.rectangle((8,y+8,503,y+119),outline=fg,width=4)
 f=ImageFont.truetype(font,86 if len(t)<=4 else 72,index=2);bb=d.textbbox((0,0),t,font=f)
 d.text(((512-(bb[2]-bb[0]))/2-bb[0],y+(128-(bb[3]-bb[1]))/2-bb[1]),t,font=f,fill=fg)
atlas.save(OUT/'labels-atlas.png')
(OUT.parent/'map-authoring.json').write_text(json.dumps({'textures':'analytic (numpy) food surfaces; labels typeset with Noto Serif CJK; no photo tracing','labelRows':[r[0] for r in rows]},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('snack maps authored')
