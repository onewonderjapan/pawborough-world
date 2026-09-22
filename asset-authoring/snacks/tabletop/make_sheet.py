"""Assemble per-prop tiles into one labelled contact sheet (system python + PIL)."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json
ROOT=Path(__file__).resolve().parent;cat=json.load(open(ROOT/'catalog.json',encoding='utf-8'))
names=cat['layoutOrder'];cols=6;T=480;L=40;rows=(len(names)+cols-1)//cols
sheet=Image.new('RGB',(cols*T,rows*(T+L)),(40,36,32));d=ImageDraw.Draw(sheet)
font=ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc',22,index=2)
zh={'tangyuan-bowl':'寧波湯糰','jiuniang-yuanzi-bowl':'酒釀圓子','soymilk-bowl':'豆漿','youtiao-pair-plate':'油條','xiekehuang-tray':'蟹殼黃','dabing-stack':'大餅','congyoubing-plate':'蔥油餅','cifangao-plate':'粢飯糕','youdunzi-rack':'油墩子','paigu-niangao-plate':'排骨年糕','chunjuan-plate':'春卷','babaofan-plate':'八寶飯','wuxiangdou-jar':'五香豆罐','wuxiangdou-packet':'五香豆紙包','ligaotang-box':'梨膏糖','chopstick-cup':'筷筒','vinegar-dish':'醋碟','teapot-cups':'茶壺茶盞'}
for i,n in enumerate(names):
 x=(i%cols)*T;y=(i//cols)*(T+L);sheet.paste(Image.open(ROOT/'shots'/'tiles'/f'{n}.jpg'),(x,y))
 d.text((x+10,y+T+8),f"{zh.get(n,'')}  {n}  {cat['props'][n]['triangles']} tris",font=font,fill=(230,220,200))
sheet.save(ROOT/'shots'/'snacks-batch-sheet.jpg',quality=88);print('sheet',sheet.size)
