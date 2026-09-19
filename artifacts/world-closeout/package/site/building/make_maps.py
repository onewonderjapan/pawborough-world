"""Regenerate the typeset sign atlas for the 90m segment (16 rows) plus roof relief.
Derived from the baseline make_maps.py method; no reference photo is edited.
Sign names are generic design values, not verified historical shop signs.
Rows 0/1 keep the baseline 協大祥 / 童涵春 lettering already accepted in the pilot.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import numpy as np
import json

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'textures'
N = 1024

# --- roof relief (same analytic method as baseline) ---
y, x = np.mgrid[0:N, 0:N] / N
rng = np.random.default_rng(1999)
u = (x * 6) % 1
v = (y * 4) % 1
h = .5 * np.sqrt(np.clip(1 - (2 * u - 1) ** 2, 0, 1)) + .12 * np.exp(-((v - .035) / .03) ** 2)
du = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 4
dv = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 4
n = np.stack([-du, dv, np.ones_like(h)], axis=2)
n /= np.linalg.norm(n, axis=2, keepdims=True)
Image.fromarray(np.uint8(np.clip(n * .5 + .5, 0, 1) * 255)).save(OUT / 'roof-normal.png')
cells = rng.uniform(-7, 7, (4, 6))[(y * 4).astype(int), (x * 6).astype(int)]
c = 75 + cells + rng.normal(0, 1.5, (N, N)) - (v < .024) * 14 - (u < .027) * 8
rgb = np.stack([c * .94, c, c * 1.01], axis=2)
Image.fromarray(np.uint8(np.clip(rgb, 0, 255))).save(OUT / 'roof-color.jpg', quality=91)

# --- sign atlas: 16 rows of 128px on 1024x2048 ---
ROWS = 16
atlas = Image.new('RGB', (1024, ROWS * 128), (35, 29, 24))
d = ImageDraw.Draw(atlas)
fontpath = '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc'
font = ImageFont.truetype(fontpath, 104, index=2)
small = ImageFont.truetype(fontpath, 58, index=2)
# [text, style]  style: 'big3' three spaced glyphs, 'wide' one long line, 'small' long line smaller
labels = [
    ('協 大 祥', 'big3'),      # 0 cloth shop (baseline)
    ('童 涵 春', 'big3'),      # 1 pharmacy (baseline)
    ('綢 緞 布 匹', 'wide'),    # 2 cloth sub-sign
    ('参 茸 · 藥 材', 'wide'),  # 3 pharmacy sub-sign
    ('方浜中路', 'wide'),       # 4 street plaque (cat wall)
    ('南 北 雜 貨', 'wide'),    # 5 dry goods
    ('光 藝 照 相', 'big3'),    # 6 photo shop variant
    ('聚 仙 樓', 'big3'),       # 7 restaurant main
    ('酒 · 菜 · 面', 'wide'),   # 8 restaurant sub
    ('寶 聚 銀 樓', 'big3'),    # 9 curio/silver main
    ('金銀 首 飾', 'wide'),     # 10 curio sub
    ('天 香 齋', 'big3'),       # 11 plain-A shop name
    ('烟 紙 香 燭', 'wide'),    # 12 plain sub
    ('翰 墨 字 畫', 'wide'),    # 13 plain sub
    ('五 金 交 電', 'wide'),    # 14 plain sub
    ('恒 昌 雜 貨', 'big3'),    # 15 plain-B shop name
]
for i, (t, style) in enumerate(labels):
    yy = i * 128
    d.rectangle((7, yy + 7, 1016, yy + 120), outline=(138, 107, 64), width=3)
    if style == 'big3':
        for j, ch in enumerate(t.replace(' ', '')):
            cb = d.textbbox((0, 0), ch, font=font)
            d.text((245 + j * 267 - (cb[2] - cb[0]) / 2, yy + (128 - (cb[3] - cb[1])) / 2 - cb[1]), ch, font=font, fill=(211, 181, 123))
    else:
        f = font if len(t) <= 6 else small
        bb = d.textbbox((0, 0), t, font=f)
        d.text(((1024 - (bb[2] - bb[0])) / 2, yy + (128 - (bb[3] - bb[1])) / 2 - bb[1]), t, font=f, fill=(211, 181, 123))
atlas.save(OUT / 'sign-atlas.png')

(ROOT / 'map-authoring.json').write_text(json.dumps({
    'roof': 'analytic repeatable roof relief, same method as baseline slice',
    'roofTileMeters': [1.44, 1.36],
    'signs': 'typeset lettering, generic design names, not copied historical calligraphy',
    'font': fontpath,
    'atlasSize': [1024, ROWS * 128],
    'labels': [l[0] for l in labels],
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('Authored roof maps and 16-row sign atlas')
