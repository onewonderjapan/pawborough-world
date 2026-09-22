#!/usr/bin/env python3
"""Contact sheets: one per class (pinch/grip/carry/beans) + one all-items sheet.
Each tile labelled zh / id / LOD0 tris. System python3 with PIL."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

WS = Path(__file__).resolve().parent.parent
PKG = WS.parent
SPEC = json.loads((PKG / 'DESIGN_SPEC.json').read_text(encoding='utf-8'))
FONT = '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc'
OUT = PKG / 'artifacts/snacks-handheld/contact-sheets'
OUT.mkdir(parents=True, exist_ok=True)

TILE = 320
LABEL_H = 44
COLS = 6


def load_catalog():
    cat = {}
    for it in SPEC['items']:
        f = WS / 'props/catalog' / (it['id'] + '.json')
        if f.exists():
            c = json.loads(f.read_text(encoding='utf-8'))
            cat[it['id']] = c.get('triangles', {}).get('lod0', 0) or 0
    return cat


def sheet(id_list, title, out_name, tris):
    ids = [i for i in id_list if (WS / 'renders' / i / (i + '-three-quarter.jpg')).exists()]
    if not ids:
        print('sheet %s: no tiles, skipped' % out_name)
        return
    cols = min(COLS, len(ids))
    rows = (len(ids) + cols - 1) / cols
    W = cols * TILE
    H = rows * (TILE + LABEL_H) + 56
    img = Image.new('RGB', (W, int(H)), (24, 22, 20))
    d = ImageDraw.Draw(img)
    f_title = ImageFont.truetype(FONT, 26, index=2)
    f_lab = ImageFont.truetype(FONT, 15, index=2)
    d.text((10, 12), title, font=f_title, fill=(235, 225, 205))
    for k, id_ in enumerate(ids):
        col, row = k % cols, k // cols
        x0, y0 = col * TILE, 56 + row * (TILE + LABEL_H)
        tile = Image.open(WS / 'renders' / id_ / (id_ + '-three-quarter.jpg')).resize((TILE, TILE))
        img.paste(tile, (x0, y0))
        zh = next(i['zh'] for i in SPEC['items'] if i['id'] == id_)
        label = '%s  %s' % (zh, id_)
        tr = tris.get(id_)
        lab2 = 'LOD0 %s tris' % (tr if tr is not None else 'n/a')
        d.rectangle((x0, y0 + TILE, x0 + TILE, y0 + TILE + LABEL_H), fill=(38, 34, 30))
        d.text((x0 + 8, y0 + TILE + 3), label, font=f_lab, fill=(240, 230, 210))
        d.text((x0 + 8, y0 + TILE + 22), lab2, font=f_lab, fill=(190, 180, 160))
    img.save(OUT / out_name, quality=92)
    print('wrote', out_name, len(ids), 'tiles')


def main():
    tris = load_catalog()
    classes = {'pinch': [], 'grip': [], 'carry': [], 'beans': []}
    for it in SPEC['items']:
        if it['id'].startswith('bean-'):
            classes['beans'].append(it['id'])
        else:
            classes[it['class']].append(it['id'])
    zhmap = {'pinch': '手持捏取类 pinch', 'grip': '手握类 grip', 'carry': '捧取器皿类 carry',
             'beans': '五香豆逐粒 beans'}
    for cls, ids in classes.items():
        sheet(ids, zhmap[cls], 'sheet-%s.jpg' % cls, tris)
    all_ids = [i['id'] for i in SPEC['items']]
    sheet(all_ids, '全部 27 件 — 手持小吃道具（LOD+插座）· 逐粒五香豆', 'sheet-all.jpg', tris)


if __name__ == '__main__':
    main()
