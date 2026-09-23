#!/usr/bin/env python3
"""contact-sheet.py — 2x4 per-cluster sheet: after (top) vs procedural before (bottom).

Run: python3 contact-sheet.py --out <out-rockery> --module <modules/rockery> [--copy-to <dir>]
Labels: zh name / cluster id / view / tris / mode. Blank-frame guard re-checked here.
"""
import argparse
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont, ImageStat

FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'

CLUSTERS = {
    'rockery-yulinglong': ('玉玲珑（示意）', 'rockery-yulinglong'),
    'rockery-dajiashan': ('大假山（示意）', 'rockery-dajiashan'),
}
VIEWS = ('A', 'B', 'C', 'close')
MODES = ('after', 'before')
MODE_ZH = {'after': 'after (new)', 'before': 'before (procedural)'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--module', required=True)
    ap.add_argument('--copy-to', default=None)
    args = ap.parse_args()

    renders = os.path.join(args.out, 'renders')
    tri = {}
    for cid in CLUSTERS:
        ch = json.load(open(os.path.join(args.out, f'check-{cid}.json')))
        tri[cid] = ch['triCount']

    for cid, (zh, _id) in CLUSTERS.items():
        tiles = []
        for mode in MODES:
            for v in VIEWS:
                p = os.path.join(renders, f'{cid}-{mode}-{v}.png')
                img = Image.open(p).convert('RGB')
                # blank-frame guard
                std = ImageStat.Stat(img.convert('L')).stddev[0]
                cols = img.getcolors(maxcolors=256 * 256)
                dom = (max(c for c, _ in cols) / (img.size[0] * img.size[1])) if cols else 0.0
                if std < 2.0 or dom > 0.95:
                    print(f'BLANK_FAIL {p} std={std:.2f} dom={dom:.3f}')
                    sys.exit(9)
                img = img.resize((480, 270))
                d = ImageDraw.Draw(img)
                d.rectangle([0, 0, 480, 30], fill=(0, 0, 0))
                try:
                    font = ImageFont.truetype(FONT, 15)
                except OSError:
                    font = None
                d.text((6, 7), f'{zh} · {cid} · {v} · {MODE_ZH[mode]} · {tri[cid]} tris',
                       fill=(255, 255, 255), font=font)
                tiles.append(img)
        sheet = Image.new('RGB', (480 * 4 + 50, 270 * 2 + 30), (24, 24, 24))
        for i, t in enumerate(tiles):
            x = (i % 4) * (480 + 10) + 5
            y = (i // 4) * (270 + 10) + 10
            sheet.paste(t, (x, y))
        sp = os.path.join(args.out, 'renders', f'contact-{cid}.jpg')
        sheet.save(sp, 'JPEG', quality=88)
        print('SHEET', sp, os.path.getsize(sp), 'bytes')
        if args.copy_to:
            os.makedirs(args.copy_to, exist_ok=True)
            sheet.save(os.path.join(args.copy_to, f'contact-{cid}.jpg'), 'JPEG', quality=88)
    print('SHEETS_DONE')


main()
