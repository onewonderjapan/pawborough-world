"""Build the cat-mural corner block as a standalone unit (baseline cat-corner derived).

The mural wall faces +Z (street). Lane/street geometry is NOT part of this module.
Run: blender -b --factory-startup -t 4 -P build_catwall.py
"""
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
import mb_lib as L
L.reset_scene()
L.build_materials()
L.GROUP = 'cat-corner'

W, D, E = 7.2, 5.8, 6.5
x = 0.0
L.box('mural-front-wall', (x, E / 2, -.15), (W, E, .3), 'plaster', 0, True)
L.box('mural-side-left', (x - W / 2 + .15, E / 2, -D / 2), (.3, E, D), 'plaster', 0, True)
L.box('mural-side-right', (x + W / 2 - .15, E / 2, -D / 2), (.3, E, D), 'plaster', 0, True)
L.box('mural-back-wall', (x, E / 2, -D + .15), (W, E, .3), 'plaster', 0, True)
L.box('mural-brick-plinth', (x, .26, .045), (W, .52, .10), 'brick', 0)
u0 = (1 - W / 5.5) / 2; u1 = 1 - u0
v0 = (.52 - .47) / 5.76; v1 = (E - .47) / 5.76
L.mesh('reference-cat-wall',
       [(x - W / 2, .52, .019), (x + W / 2, .52, .019), (x + W / 2, E, .019), (x - W / 2, E, .019)],
       [(0, 1, 2, 3)], 'cat', [(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
L.roof(x, W, D, 6.5, 7.75, 0, False)
L.cyl('wall-drainpipe', (x - 2.94, .12, .13), (x - 2.94, 6.25, .13), .046, 'iron', 10)
for yy in (1, 3, 5):
    L.rod('wall-pipe-clamp', (x - 2.94, yy, 0), (x - 2.94, yy, .17), .02, 'iron')
L.sign(x + 2.6, .92, .095, .75, .14, 4)

design = {
    'family': 'cat-corner',
    'source': 'derived from inputs/baseline cat-corner block; mural texture reused unchanged',
    'frontageM': W, 'depthM': D, 'eaveM': E, 'ridgeM': 7.75,
    'eaveMarginM': 0.4, 'frontProtrusionM': 0.15,
    'doors': 'closed memorial wall block; no public door',
    'eraNote': 'mural artwork is the owner-designated 2023 feature kept inside a 1990s street',
}
L.finalize('cat-corner', HERE / 'cat_corner', design)
