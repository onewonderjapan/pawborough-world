#!/usr/bin/env python3
"""corridor-kit 渲染守卫 + 接触表（系统 python3 + PIL）。
守卫：任一帧亮度 std < 2/255 或单色占比 > 95% = 空白 = 非零退出。
接触表：4 行（廊）x 3 机位，标注 zh / id / tris。
运行：python3 review_tools.py <renders_dir> <catalog.json> <out_sheet.jpg>
"""
import json, os, sys
from PIL import Image, ImageDraw

renders, catalog, sheet_out = sys.argv[1], sys.argv[2], sys.argv[3]
cat = json.load(open(catalog, encoding='utf-8'))

SHOTS = [('along', '沿廊'), ('out34', '外侧3/4'), ('aerial', '俯视')]
fail = []
imgs = {}
for oid, m in cat['modules'].items():
    row = []
    for tag, _zh in SHOTS:
        p = os.path.join(renders, f'{oid}-{tag}.png')
        if not os.path.exists(p):
            fail.append(f'missing {p}')
            continue
        im = Image.open(p).convert('L')
        hist = im.histogram()
        n = sum(hist)
        mean = sum(i * c for i, c in enumerate(hist)) / n
        std = (sum((i - mean) ** 2 * c for i, c in enumerate(hist)) / n) ** 0.5
        dom = max(hist) / n
        status = 'ok'
        if std < 2.0 / 255 * 255 or dom > 0.95:
            status = f'BLANK std={std:.2f} dom={dom:.2%}'
            fail.append(f'{os.path.basename(p)}: {status}')
        row.append((p, status, std, dom))
    imgs[oid] = row

if fail:
    print('GUARD FAIL')
    for f in fail:
        print(' ', f)
    sys.exit(1)
print('GUARD PASS: all frames non-blank')
for oid, row in imgs.items():
    for p, s, std, dom in row:
        print(f'  {os.path.basename(p)} std={std:.1f} dom={dom:.1%}')

# 接触表
TW, TH, PAD, LABEL = 480, 270, 8, 26
cols = len(SHOTS)
rows = len(cat['modules'])
W = cols * TW + (cols + 1) * PAD
H = rows * (TH + LABEL) + (rows + 1) * PAD
sheet = Image.new('RGB', (W, H), (24, 24, 26))
d = ImageDraw.Draw(sheet)
for r, (oid, m) in enumerate(cat['modules'].items()):
    y = PAD + r * (TH + LABEL + PAD)
    for c, (p, _s, _st, _dm) in enumerate(imgs[oid]):
        x = PAD + c * (TW + PAD)
        im = Image.open(p).convert('RGB').resize((TW, TH), Image.LANCZOS)
        sheet.paste(im, (x, y))
    d.text((PAD, y + TH + 5), f"{m['zh']}  {oid}  {m['triangles']} tris  {m['bytes']//1024}KB", fill=(230, 230, 230))
sheet.save(sheet_out, 'JPEG', quality=88)
print('sheet', sheet_out, os.path.getsize(sheet_out), 'bytes')
