#!/usr/bin/env python3
"""K3 contact sheets (adoption batch): before/after, 12 views (9 corridor
views + 3 east-band views), 2 columns labeled, no scoring.

before = corridor batch stills (scene-v2 @ 8c55d6b, rig-lit)
after  = kit/out/scene-v3/ (this batch: v4 dataset + east band + trees v2 +
         compressed-default world; same rig, same cameras + 3 new east cams)

Run: python3 tools/contact_sheet_adoption.py
"""
from PIL import Image, ImageDraw
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BEFORE = Path('/home/baibai/outbox/pawborough-corridor-video-night-20260919/workspace/artifacts/corridor-video/stills')
AFTER = ROOT / 'kit/out/scene-v3'
OUT = ROOT / 'artifacts/adoption-east/contact-sheets'
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
    ('bridge:east-junction', 'eastband__east-junction'),
    ('bridge:east-road-mid', 'eastband__east-road-mid'),
    ('bridge:east-end-wall', 'eastband__east-end-wall'),
]

THUMB_W, THUMB_H = 640, 360
LABEL_H = 34
missing = []
for view, stem in VIEWS:
    a = AFTER / f'{stem}-cpu.png'
    if not a.exists():
        missing.append(str(a))
    # east-band cameras are NEW this batch — no before view exists
    if not stem.startswith('eastband__') and not (BEFORE / f'still--{stem}-cpu.png').exists():
        missing.append(str(BEFORE / f'still--{stem}-cpu.png'))
if missing:
    print('CONTACT_SHEET_MISSING')
    for m in missing:
        print('  ', m)
    raise SystemExit(2)

for view, stem in VIEWS:
    new_cam = stem.startswith('eastband__')
    sheet = Image.new('RGB', (THUMB_W * 2 + 30, THUMB_H + LABEL_H * 2 + 20), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    if new_cam:
        img = Image.open(AFTER / f'{stem}-cpu.png').convert('RGB').resize((THUMB_W * 2 + 10, THUMB_H))
        sheet.paste(img, (10, LABEL_H + 6))
        d.text((10, 8), 'NEW CAMERA (adoption batch) — no before view', fill=(240, 240, 240))
    else:
        for col, (src, label) in enumerate([
            (BEFORE / f'still--{stem}-cpu.png', 'BEFORE  corridor batch (8c55d6b)'),
            (AFTER / f'{stem}-cpu.png', 'AFTER  adoption batch (trees v2 + east band)'),
        ]):
            img = Image.open(src).convert('RGB').resize((THUMB_W, THUMB_H))
            x = 10 + col * (THUMB_W + 10)
            sheet.paste(img, (x, LABEL_H + 6))
            d.text((x, 8), label, fill=(240, 240, 240))
    d.text((10, LABEL_H + THUMB_H + 12), view, fill=(180, 220, 180))
    sheet.save(OUT / f'{stem}.png')
    print('SHEET', stem)

print(f'CONTACT_SHEETS_DONE n={len(VIEWS)} out={OUT}')
