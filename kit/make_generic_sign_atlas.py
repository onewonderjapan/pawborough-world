"""Generic shop-sign atlas for the east-edge candidate buildings.

One NEW shared 1024x2048 image (16 rows of 1024x128, same row convention as
the frozen sign-atlas.png, SIGN_ROWS=16 in mb_lib). Only generic design words
live here — existing real shop-name rows in sign-atlas.png are NOT reused and
NOT modified, so no generic text can silently alias a historical brand.

Style matches the frozen atlas: dark lacquer ground, gold Song-style
lettering (Noto Serif CJK), thin gold frame. No weathering (owner: 材料只要
一致，先不考虑做旧).

Run: python3 kit/make_generic_sign_atlas.py [--out kit/textures/sign-atlas-generic.png]
"""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROWS = 16
ROW_H = 128
W = 1024
BG = (25, 21, 17, 255)          # dark lacquer, matches frozen atlas ground
GOLD = (200, 162, 92, 255)      # lettering gold
FRAME = (146, 118, 66, 255)     # thin border gold
FONT_TTC = '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc'

# row -> generic design text; recorded into the sidecar for provenance
ROWS_TEXT = {0: '小酒楼', 1: '饭馆',
             2: '布行', 3: '绸庄', 4: '绣坊', 5: '皮货'}  # street-completion batch 20260915; rows 0-1 redrawn identically (deterministic)


def sc_face_index(path):
    """Pick the Simplified Chinese face inside the Noto Serif CJK TTC."""
    for i in range(8):
        try:
            f = ImageFont.truetype(path, 32, index=i)
        except OSError:
            break
        if 'SC' in f.getname()[0]:
            return i
    raise RuntimeError('no SC face found in Noto Serif CJK TTC')


def draw_row(im, d, row, text, font):
    y0 = row * ROW_H
    d.rectangle([0, y0, W - 1, y0 + ROW_H - 1], fill=BG)
    d.rectangle([6, y0 + 6, W - 7, y0 + ROW_H - 7], outline=FRAME, width=2)
    chars = list(text)
    if len(chars) == 1:
        xs = [W / 2]
    else:
        span = W * 0.62
        xs = [W / 2 - span / 2 + span * k / (len(chars) - 1) for k in range(len(chars))]
    size = int(ROW_H * 0.52)
    for cx, ch in zip(xs, chars):
        bb = d.textbbox((0, 0), ch, font=font)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        d.text((cx - tw / 2 - bb[0], y0 + ROW_H / 2 - th / 2 - bb[1]), ch, font=font, fill=GOLD)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--out', type=Path, default=Path(__file__).parent / 'textures' / 'sign-atlas-generic.png')
    a = p.parse_args()
    idx = sc_face_index(FONT_TTC)
    font = ImageFont.truetype(FONT_TTC, int(ROW_H * 0.52), index=idx)
    im = Image.new('RGBA', (W, ROW_H * ROWS), BG)
    d = ImageDraw.Draw(im)
    for row, text in sorted(ROWS_TEXT.items()):
        draw_row(im, d, row, text, font)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    im.convert('RGB').save(a.out, 'PNG')
    meta = {
        'generator': 'kit/make_generic_sign_atlas.py',
        'size': [W, ROW_H * ROWS], 'rows': ROWS, 'rowHeightPx': ROW_H,
        'font': 'Noto Serif CJK SC Bold (system, OFL)', 'text': {str(k): v for k, v in ROWS_TEXT.items()},
        'historicalBrand': False, 'weathering': 'none',
        'note': 'generic design words only; frozen sign-atlas.png untouched',
    }
    a.out.with_suffix('.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('ATLAS_READY', a.out, im.size, 'rows', ROWS_TEXT, 'faceIndex', idx)


if __name__ == '__main__':
    main()
