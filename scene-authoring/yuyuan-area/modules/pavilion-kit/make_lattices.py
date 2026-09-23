#!/usr/bin/env python3
"""Two analytic see-through lattice alpha maps (512^2, RGBA) for the 挂落 hanglo panels.
Pattern A: 万-character (fret) lattice. Pattern B: 直棂 vertical slats with double binder.
Timber-red bars on transparent background; periodic so the plane can REPEAT with u=width/0.6.
design_inference: patterns alternate per bay per spec ('2 patterns alternate'); motif choice analytic.
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
S = 512
CELL = S // 4                      # 4x4 lattice cells per tile
BAR = 22                           # bar thickness px (~0.026 m at 0.6 m cell)
TIMBER = (0x5c, 0x2a, 0x20, 255)   # dark red timber, matches 挂落 paint

def canvas():
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)

def fret_cell(d, x0, y0, w):
    """One 万字 fret cell: interlocking T-steps drawn with bars."""
    b = BAR
    d.rectangle([x0, y0 + w // 2 - b // 2, x0 + w, y0 + w // 2 + b // 2], fill=TIMBER)          # mid horizontal
    d.rectangle([x0 + w // 2 - b // 2, y0, x0 + w // 2 + b // 2, y0 + w // 2 + b // 2], fill=TIMBER)  # center vertical up
    for k in (0, 1):
        cx = x0 + w // 2 + (1 if k else -1) * w // 4
        d.rectangle([cx - b // 2, y0 + w // 2 + b // 2 - (b if k else 0),
                     cx + b // 2, y0 + w], fill=TIMBER)                                          # down legs
        d.rectangle([cx - (w // 4), y0 + w - b, cx + w // 4 + b // 2, y0 + w], fill=TIMBER)      # feet
    d.rectangle([x0, y0, x0 + b, y0 + w], fill=TIMBER)                                           # left rail
    d.rectangle([x0 + w - b, y0, x0 + w, y0 + w], fill=TIMBER)                                   # right rail

def lattice_a():
    im, d = canvas()
    w = S // 4
    for i in range(4):
        for j in range(4):
            fret_cell(d, i * w, j * w, w)
    # top & bottom binder bars frame (drawn inside the tile, periodic left/right)
    d.rectangle([0, 0, S, BAR], fill=TIMBER)
    d.rectangle([0, S - BAR, S, S], fill=TIMBER)
    return im

def lattice_b():
    im, d = canvas()
    step = S // 8
    for x in range(0, S, step):
        d.rectangle([x, 0, x + BAR - 4, S], fill=TIMBER)          # vertical slats
    for y in (S // 2 - BAR // 2, S - 2 * BAR, S - BAR):
        d.rectangle([0, y, S, y + BAR], fill=TIMBER)              # binders
    d.rectangle([0, 0, S, BAR], fill=TIMBER)
    return im

out = os.path.join(HERE, 'textures')
os.makedirs(out, exist_ok=True)
lattice_a().save(os.path.join(out, 'lattice-fret.png'))
lattice_b().save(os.path.join(out, 'lattice-slat.png'))
for f in ('lattice-fret.png', 'lattice-slat.png'):
    p = os.path.join(out, f)
    print(f, os.path.getsize(p), 'bytes')
