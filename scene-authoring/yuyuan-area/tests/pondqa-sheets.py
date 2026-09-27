#!/usr/bin/env python3
"""wave10-pondqa 联系表（图片只写工单包 artifacts/，不进仓库）。
单组：python3 tests/pondqa-sheets.py --renders <dir> --shots <shots.json> --out <dir> --tag before
前后对照：python3 tests/pondqa-sheets.py --renders <before-dir> --after <after-dir> --shots <shots.json> --out <dir> --tag before --tag-after after [--only re]
"""
import argparse, json, os, re
from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument('--renders', required=True)
ap.add_argument('--after')
ap.add_argument('--shots', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--tag', default='before')
ap.add_argument('--tag-after', default='after')
ap.add_argument('--only', default='')
ap.add_argument('--prefix', default='')
ap.add_argument('--thumb', type=int, default=480)
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
FONT = None
for f in ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
          '/usr/share/fonts/opentype/noto/NotoSansCJKjp-Regular.otf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
    if os.path.exists(f):
        FONT = ImageFont.truetype(f, 15); break
FONT = FONT or ImageFont.load_default()
shots = json.load(open(a.shots, encoding='utf-8'))['shots']
pat = re.compile(a.only) if a.only else None
W = a.thumb; H = int(W * 0.625); LAB = 22

def base(name):
    return re.sub(r'-(%s)$' % re.escape(a.tag), '', name)

def tile(path, label):
    im = Image.new('RGB', (W, H + LAB), 'white')
    if path and os.path.exists(path):
        im.paste(Image.open(path).convert('RGB').resize((W, H)), (0, LAB))
    else:
        ImageDraw.Draw(im).text((8, LAB + H // 2), 'missing', fill='red', font=FONT)
    ImageDraw.Draw(im).text((6, 2), label, fill='black', font=FONT)
    return im

groups = {}
for s in shots:
    b = base(s['name'])
    if pat and not pat.search(b):
        continue
    groups.setdefault(s['group'], []).append(b)
made = []
for g, names in groups.items():
    if a.after:
        cols, rows = 2, len(names)
        sheet = Image.new('RGB', (W * 2, (H + LAB) * rows), 'white')
        for i, b in enumerate(names):
            sheet.paste(tile(os.path.join(a.renders, f'{a.prefix}{b}-{a.tag}.png'), f'{b}  {a.tag}'), (0, i * (H + LAB)))
            sheet.paste(tile(os.path.join(a.after, f'{a.prefix}{b}-{a.tag_after}.png'), f'{b}  {a.tag_after}'), (W, i * (H + LAB)))
        out = os.path.join(a.out, f'{a.prefix}{g}-{a.tag}-{a.tag_after}.png')
    else:
        cols = 2 if len(names) > 1 else 1
        rows = (len(names) + cols - 1) // cols
        sheet = Image.new('RGB', (W * cols, (H + LAB) * rows), 'white')
        for i, b in enumerate(names):
            sheet.paste(tile(os.path.join(a.renders, f'{a.prefix}{b}-{a.tag}.png'), b), ((i % cols) * W, (i // cols) * (H + LAB)))
        out = os.path.join(a.out, f'{a.prefix}{g}-{a.tag}.png')
    sheet.save(out)
    made.append(out)
print('\n'.join(made))
