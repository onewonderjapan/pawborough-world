#!/usr/bin/env python3
"""tint-texture.py — bake the stone tint into the source color map (system python3 + PIL).

Run: python3 tint-texture.py --src <sourcekit color jpg> --tint 7d8288 --dst <out jpg>
sRGB-space multiply (image-editor 'multiply' blend); input is read-only source-kit.
"""
import argparse

from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('--src', required=True)
ap.add_argument('--tint', required=True)
ap.add_argument('--dst', required=True)
a = ap.parse_args()

img = Image.open(a.src).convert('RGB')
tint = tuple(int(a.tint.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4))
px = img.load()
w, h = img.size
for y in range(h):
    for x in range(w):
        r, g, b = px[x, y]
        px[x, y] = (r * tint[0] // 255, g * tint[1] // 255, b * tint[2] // 255)
img.save(a.dst, 'JPEG', quality=90)
print(f'TINT_DONE {a.dst} {w}x{h} tint={a.tint}')
