#!/usr/bin/env python3
"""wave8-smallqa 联系表：artifacts/q1/renders/*.png → 每模块一张 2×2 四视图（正/斜俯/背/眼高），
再加一张全部模块斜俯的总览网格。图片只在工单包 artifacts/ 下，不进仓库。
用法：python3 tests/smallqa-sheets.py --renders <dir> --out <dir> [--tag before]
"""
import argparse
import os
import re
from PIL import Image, ImageDraw

ap = argparse.ArgumentParser()
ap.add_argument('--renders', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--tag', default='before')
ap.add_argument('--thumb', type=int, default=470)
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)

VIEWS = ['front', 'oblique', 'back', 'eye']
VL = {'front': '正', 'oblique': '斜俯', 'back': '背', 'eye': '眼高1.6m'}

pat = re.compile(r'^(pavilion|stall|bench|awning)-(.+)-(front|oblique|back|eye)-' + re.escape(a.tag) + r'\.png$')
mods = {}
for f in sorted(os.listdir(a.renders)):
    m = pat.match(f)
    if not m:
        continue
    mods.setdefault(m.group(1) + ':' + m.group(2), {})[m.group(3)] = os.path.join(a.renders, f)

ZH = {'pavilion:bld-428179924': '听鹂亭', 'pavilion:bld-428186467': '亭 bld-428186467', 'pavilion:bld-428196085': '亭 bld-428196085',
      'pavilion:bld-428196091': '亭 bld-428196091', 'pavilion:bld-428196098': '亭 bld-428196098',
      'stall:stall-steam': '摊位·蒸煮', 'stall:stall-grill': '摊位·烧烤', 'stall:stall-drink': '摊位·茶饮', 'bench:bench': '长凳'}

sheets = []
for key in sorted(mods):
    views = mods[key]
    fam, ident = key.split(':', 1)
    if len(views) < 4:
        print('SKIP (missing views)', key, sorted(views))
        continue
    W = a.thumb
    tile = Image.new('RGB', (W * 2 + 30, W * 2 + 60), (24, 24, 28))
    d = ImageDraw.Draw(tile)
    d.text((10, 6), f'{ZH.get(key, ident)}  {ident}', fill=(240, 240, 240))
    for i, v in enumerate(VIEWS):
        img = Image.open(views[v]).resize((W, int(W * 600 / 960)))
        x = 10 + (i % 2) * (W + 10)
        y = 26 + (i // 2) * (int(W * 600 / 960) + 8)
        tile.paste(img, (x, y))
        d.text((x + 4, y + 4), VL[v], fill=(255, 220, 120))
    out = os.path.join(a.out, f'sheet-{fam}-{ident}-{a.tag}.png')
    tile.save(out)
    sheets.append((key, out))
    print('sheet', key)

# 总览：每模块斜俯缩略
thumbs = []
for key, _ in sheets:
    p = os.path.join(a.out, f'sheet-{key.replace(":", "-")}-{a.tag}.png')
    fam, ident = key.split(':', 1)
    ob = os.path.join(a.renders, f'{fam}-{ident}-oblique-{a.tag}.png')
    if os.path.exists(ob):
        thumbs.append((key, ob))
cols = 5
W = 300
rows = (len(thumbs) + cols - 1) // cols
H = int(W * 600 / 960)
grid = Image.new('RGB', (cols * (W + 10) + 10, rows * (H + 30) + 10), (24, 24, 28))
d = ImageDraw.Draw(grid)
for i, (key, p) in enumerate(thumbs):
    img = Image.open(p).resize((W, H))
    x = 10 + (i % cols) * (W + 10)
    y = 10 + (i // cols) * (H + 30)
    grid.paste(img, (x, y))
    d.text((x + 4, y + H + 4), ZH.get(key, key), fill=(240, 240, 240))
out = os.path.join(a.out, f'sheet-all-oblique-{a.tag}.png')
grid.save(out)
print('overview', out, len(thumbs), 'modules')
