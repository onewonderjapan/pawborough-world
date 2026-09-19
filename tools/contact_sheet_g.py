#!/usr/bin/env python3
"""G0 — 9-view before/after contact sheets (2 columns, labeled, no scoring).

before = kit/out/before/ (scene-v1 @ 8fa1bcc, corrected temple transforms,
unified light rig)   after = artifacts/corridor-video/stills/ (scene-v2, v3
variants + trees + props, same rig).

Run: python3 tools/contact_sheet_g.py
"""
from PIL import Image, ImageDraw
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BEFORE = ROOT / 'kit/out/before'
AFTER = ROOT / 'artifacts/corridor-video/stills'
OUT = ROOT / 'artifacts/corridor-video/contact-sheets'
OUT.mkdir(parents=True, exist_ok=True)

VIEWS = [
    ('bridge:junction-west', 'bridge__junction-west'),
    ('bridge:placeholder-band', 'bridge__placeholder-band'),
    ('bridge:shanmen-from-road', 'bridge__shanmen-from-road'),
    ('bridge:forecourt-oblique', 'bridge__forecourt-oblique'),
    ('bridge:aerial-overview', 'bridge__aerial-overview'),
    ('temple:court2-pair', 'temple__court2-pair'),
    ('temple:stage-from-court', 'temple__stage-from-court'),
    ('temple:houdian-front', 'temple__houdian-front'),
    ('temple:axis-aerial', 'temple__axis-aerial'),
]

W = 800
LABEL_H = 46
HEADER_H = 54


def load_scaled(p):
    img = Image.open(p).convert('RGB')
    h = int(img.height * W / img.width)
    return img.resize((W, h))


rows = []
missing = []
for cid, stem in VIEWS:
    b = BEFORE / f'scene-v1--{stem}-cpu.png'
    a = AFTER / f'still--{stem}-cpu.png'
    if not b.exists():
        missing.append(str(b))
    if not a.exists():
        missing.append(str(a))
    rows.append((cid, b, a))
if missing:
    print('MISSING:', *missing, sep='\n  ')
    raise SystemExit(2)

for half in (0, 1):           # two sheets of ~5 rows for readability
    part = rows[:5] if half == 0 else rows[5:]
    H = HEADER_H + len(part) * (LABEL_H + W * 9 // 16 + 8)
    sheet = Image.new('RGB', (W * 2 + 24, H + 8), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    d.text((12, 10), 'Pawborough world v1.0 candidate — corridor batch BEFORE/AFTER (design reconstruction, not a historical record)',
           fill=(240, 240, 240))
    d.text((12, 30), f'BEFORE left: scene-v1 @ 8fa1bcc   AFTER right: scene-v2 (temple-axis-v3 variants + trees + props)   light: unified F0 rig   no scoring', fill=(170, 180, 170))
    y = HEADER_H
    for cid, b, a in part:
        d.text((12, y + 6), f'{cid}   —   before: 8fa1bcc / scene-v1        after: work/corridor-video-20260919 / scene-v2',
               fill=(230, 230, 230))
        y += LABEL_H
        for x, p in ((8, b), (W + 16, a)):
            img = load_scaled(p)
            sheet.paste(img, (x, y))
        y += img.height + 8
    name = f'contact-sheet-{half + 1}.png'
    sheet.save(OUT / name)
    print(f'wrote {OUT / name} rows={len(part)}')
print('CONTACT_SHEETS_DONE')
