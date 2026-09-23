#!/usr/bin/env python3
"""R1 packaging: copy after-renders to the R1 package, blank-guard before+after renders,
build a before/after comparison sheet. Run after run_all.py.
  python3 package_r1.py <r1-artifacts-dir>
"""
import json, os, sys
from PIL import Image
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUTROOT = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'out-pavilion-kit')
SITE = json.load(open(os.path.join(HERE, 'site-inputs.json'), encoding='utf-8'))
R1 = sys.argv[1] if len(sys.argv) > 1 else '/home/baibai/outbox/pawborough-w1-pavilion-kit-r1-20260923/artifacts/pavilion-kit'
VIEWS = ('front', 'three-quarter', 'top', 'under-eave')


def blank_guard(path):
    im = Image.open(path)
    g = np.asarray(im.convert('L'), dtype=np.float32)
    std = float(g.std())
    q = (g.astype(np.uint8) // 32).flatten()
    dom = float(np.bincount(q, minlength=8).max() / q.size)
    colors = len(set(im.convert('RGB').resize((160, 120)).getdata()))
    return {'luminanceStd': round(std, 2), 'dominantFraction': round(dom, 4),
            'quantizedColors': colors, 'blank': bool(std < 2.0 or dom > 0.95 or colors < 16)}


os.makedirs(os.path.join(R1, 'renders', 'after'), exist_ok=True)
guard = {}
for P in SITE['pavilions']:
    bid = P['id']
    for v in VIEWS:
        src = os.path.join(OUTROOT, 'pavilion-' + bid, 'renders', v + '.png')
        dst = os.path.join(R1, 'renders', 'after', f'{bid}-{v}.png')
        Image.open(src).save(dst)
        guard[f'after/{bid}-{v}'] = blank_guard(dst)
        bp = os.path.join(R1, 'renders', 'before', f'{bid}-{v}.png')
        if os.path.exists(bp):
            guard[f'before/{bid}-{v}'] = blank_guard(bp)

bad = {k: g for k, g in guard.items() if g['blank']}
json.dump(guard, open(os.path.join(R1, 'renders', 'blank-guard.json'), 'w'), indent=1)
print('blank guard:', len(guard), 'frames,', len(bad), 'blank')
if bad:
    print(json.dumps(bad, indent=1))
    sys.exit(3)

# before/after comparison sheet (three-quarter, same camera)
TILE_W, TILE_H, PAD, LABEL_H = 560, 420, 10, 26
rows = 2 * len(SITE['pavilions'])
sheet = Image.new('RGB', (2 * (TILE_W + PAD) + PAD, (TILE_H + LABEL_H + PAD) + PAD), (24, 24, 26))
d = ImageDraw = None
from PIL import ImageDraw
d = ImageDraw.Draw(sheet)
half = (len(SITE['pavilions']) + 2) // 3
for row, (tag, sub) in enumerate((('before', 'renders/before'), ('after', 'renders/after'))):
    for i, P in enumerate(SITE['pavilions']):
        bid = P['id']
        img = Image.open(os.path.join(R1, sub, f'{bid}-three-quarter.png')).resize((TILE_W, TILE_H))
        col = i % 3
        rrow = i // 3
        x = PAD + col * (TILE_W + PAD)
        y = PAD + rrow * (TILE_H + LABEL_H + PAD) + row * ((TILE_H + LABEL_H + PAD) * half + 14)
        sheet.paste(img, (x, y))
        d.text((x + 4, y + TILE_H + 5), f'{tag.upper()}  {P["zh"]}  {bid}', fill=(240, 238, 230))
        d.rectangle([x - 1, y - 1, x + TILE_W, y + TILE_H], outline=(70, 70, 74))
out = os.path.join(R1, 'renders', 'before-after-sheet.png')
sheet.save(out)
print('sheet:', out, os.path.getsize(out), 'bytes')
