#!/usr/bin/env python3
# Contact sheet: 3 stall types + bench + awning strip + mock row, zh/id/tris labels.
# System python3 + PIL. Fails non-zero if any source render is missing.
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

OUT = '/home/baibai/outbox/pawborough-w1-bazaar-stalls-20260922/workspace/scene-authoring/yuyuan-area/out-bazaar-stalls'
RD = os.path.join(OUT, 'renders')
man = json.load(open(os.path.join(OUT, 'manifest.json'), encoding='utf-8'))
awp = json.load(open(os.path.join(OUT, 'awning-placements.json'), encoding='utf-8'))

FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
font = ImageFont.truetype(FONT, 22)
font_s = ImageFont.truetype(FONT, 17)

rep = json.load(open(os.path.join(RD, 'render-report.json'), encoding='utf-8'))
strip = next(e for e in awp['edges'] if e['module'].endswith('awning-bld-389702030-1.glb'))
tiles = [
    ('stall-steam.png', '蒸煮/点心摊 steam', f"stall-steam.glb · {man['files']['stall-steam.glb']['tris']} tris"),
    ('stall-grill.png', '烤制摊 grill', f"stall-grill.glb · {man['files']['stall-grill.glb']['tris']} tris"),
    ('stall-drink.png', '饮品摊 drink', f"stall-drink.glb · {man['files']['stall-drink.glb']['tris']} tris"),
    ('bench.png', '长凳 bench', f"bench.glb · {man['files']['bench.glb']['tris']} tris"),
    ('awning-strip.png', '街块檐棚条 awning strip',
     f"{strip['blockId']} · L={strip['lenM']}m · {strip['tris']} tris · {strip['trisPerMetre']} tris/m"),
    ('mock-row-cluster1.png', 'mock row：cluster 1 六摊 + 长凳（冻结布局位姿）',
     '43 摊 + 8 凳 + 16 檐棚中的样例行 · socket 世界坐标核对 4/4'),
]
CELL_W, CELL_H, BAR = 800, 560, 58
sheet = Image.new('RGB', (CELL_W * 2, (CELL_H + BAR) * 3), (24, 24, 26))
draw = ImageDraw.Draw(sheet)
for i, (fn, zh, sub) in enumerate(tiles):
    cx, cy = (i % 2) * CELL_W, (i // 2) * (CELL_H + BAR)
    img = Image.open(os.path.join(RD, fn))
    img.thumbnail((CELL_W - 8, CELL_H - 8))
    sheet.paste(img, (cx + (CELL_W - img.width) // 2, cy + (CELL_H - img.height) // 2))
    draw.rectangle([cx, cy + CELL_H, cx + CELL_W, cy + CELL_H + BAR], fill=(12, 12, 14))
    draw.text((cx + 12, cy + CELL_H + 4), zh, fill=(240, 240, 235), font=font)
    draw.text((cx + 12, cy + CELL_H + 32), sub, fill=(170, 178, 185), font=font_s)
dest = os.path.join(RD, 'contact-sheet.png')
sheet.save(dest)
print('contact sheet:', dest, sheet.size)
