#!/usr/bin/env python3
"""All-5 contact sheet from three-quarter renders, labelled zh / module id / tris (PIL)."""
import json, os, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUTROOT = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'out-pavilion-kit')
ART = '/home/baibai/outbox/pawborough-w1-pavilion-kit-20260922/artifacts/pavilion-kit'
SITE = json.load(open(os.path.join(HERE, 'site-inputs.json'), encoding='utf-8'))

TILE_W, TILE_H = 600, 450
PAD, LABEL_H = 12, 34
cols = 3
rows = (len(SITE['pavilions']) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (TILE_W + PAD) + PAD, rows * (TILE_H + LABEL_H + PAD) + PAD), (24, 24, 26))
d = ImageDraw.Draw(sheet)

for i, P in enumerate(SITE['pavilions']):
    bid = P['id']
    mod = 'pavilion-' + bid
    img = Image.open(os.path.join(OUTROOT, mod, 'renders', 'three-quarter.png')).resize((TILE_W, TILE_H))
    x = PAD + (i % cols) * (TILE_W + PAD)
    y = PAD + (i // cols) * (TILE_H + LABEL_H + PAD)
    sheet.paste(img, (x, y))
    rep = json.load(open(os.path.join(OUTROOT, mod, 'build-report.json')))
    tris = rep['measured']['triangles']['total']
    kb = rep['measured']['glbBytes'] // 1024
    d.text((x + 4, y + TILE_H + 6), f"{P['zh']}  {mod}  tris={tris}  {kb}KB", fill=(240, 238, 230))
    d.rectangle([x - 1, y - 1, x + TILE_W, y + TILE_H], outline=(70, 70, 74))

out1 = os.path.join(OUTROOT, 'contact-sheet.png')
sheet.save(out1)
os.makedirs(os.path.join(ART), exist_ok=True)
# keep a <=400KB copy for the branch (records/review)
small = sheet.resize((sheet.width * 2 // 3, sheet.height * 2 // 3))
p2 = os.path.join(HERE, 'review', 'contact-sheet.png')
small.save(p2, quality=88)
print(out1, os.path.getsize(out1), 'bytes;', p2, os.path.getsize(p2), 'bytes')
