"""Build one baseline-derived shop unit (cloth / pharmacy) in its own local frame.

Derived from the accepted 檐下三间 shop() builder; unit front-wall center bottom at GLB origin.
Run: blender -b --factory-startup -t 4 -P build_legacy_unit.py -- cloth|pharmacy
"""
import sys
from pathlib import Path
import math

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
import mb_lib as L
kind = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'cloth'
assert kind in ('cloth', 'pharmacy')

L.reset_scene()
L.build_materials()

if kind == 'cloth':
    W, D, EAVE, RIDGE = 7.6, 6.7, 7.7, 9.2
else:
    W, D, EAVE, RIDGE = 7.8, 7.0, 8.0, 9.6

x, z = 0.0, 0.0 if kind == 'cloth' else .15
L.GROUP = kind + '-shop'

# perimeter shell + floors (open front bays at ground level)
L.box('left-side', (x - W / 2 + .14, EAVE / 2, z - D / 2), (.28, EAVE, D), 'plaster', 0, True)
L.box('right-side', (x + W / 2 - .14, EAVE / 2, z - D / 2), (.28, EAVE, D), 'plaster', 0, True)
L.box('back-wall', (x, EAVE / 2, z - D + .14), (W - .55, EAVE, .28), 'plaster', 0, True)
L.box('shop-floor', (x, .07, z - D / 2), (W, .14, D), 'stone', .005, True)
L.box('upper-floor', (x, 3.6, z - D / 2), (W - .56, .22, D - .55), 'wood', 0, True)
L.box('rear-interior', (x, 1.65, z - 3.65), (W - .5, 3.15, .20), 'inner', 0, True)
L.box('upper-sill-wall', (x, 4.31, z - .13), (W - .5, 1.02, .26), 'plaster', 0)
L.box('upper-header-wall', (x, (7.02 + EAVE) / 2, z - .13), (W - .5, EAVE - 7.02, .26), 'plaster', 0)

# upper facade piers between windows
openings = sorted([(xx - W * .225 / 2 - .04, xx + W * .225 / 2 + .04) for xx in (x - W * .28, x, x + W * .28)])
start = x - W / 2 + .2
for lo, hi in openings + [(x + W / 2 - .2, x + W / 2 - .2)]:
    if lo > start:
        L.box('upper-window-pier', ((start + lo) / 2, 5.92, z - .13), (lo - start, 2.22, .26), 'plaster', 0)
    start = hi

# street posts + long beams
for xx in (x - W / 2 + .16, x - W / 6, x + W / 6, x + W / 2 - .16):
    L.box('facade-post', (xx, 3.8, z + .09), (.20, 7.6, .24), 'wood', .012, True)
    L.box('stone-post-foot', (xx, .35, z + .09), (.34, .7, .35), 'stone', .016, True)
for yy in (3.48, 4.23, EAVE - .2):
    L.box('front-long-beam', (x, yy, z + .10), (W, .20, .28), 'wood', .012)

# upper windows
for xx in (x - W * .28, x, x + W * .28):
    L.window(xx, 5.91, z + .05, W * .225, 2.20, kind == 'cloth')

# folded shutters at both jambs
for xx in (x - W / 2 + .7, x + W / 2 - .7):
    for i in range(3):
        L.box('folded-shop-shutter', (xx + (i - 1) * .17, 1.6, z - .08 + (i % 2) * .11), (.16, 2.8, .08), 'wood', .007)
    L.box('shutter-hinge', (xx, 1.2, z + .12), (.035, .23, .045), 'iron', .002)

L.box('threshold', (x, .12, z + .22), (W - .35, .24, .55), 'stone', .015, True)
L.sign(x, 3.86, z + .31, W * .62, .55, 0 if kind == 'cloth' else 1)
L.sign(x, 2.95, z - .25, W * .50, .23, 2 if kind == 'cloth' else 3)
L.roof(x, W, D, EAVE, RIDGE, z, True)
for xx in (x - W / 2 - .01, x + W / 2 + .01):
    L.box('brick-base', (xx, .52, z - D / 2), (.31, 1.04, D), 'brick', 0)
for j in range(3):
    L.box('upper-eave-timber', (x, EAVE - .43 + j * .11, z + .07 + j * .07), (W, .12, .25 + j * .13), 'wood', .004)

if kind == 'cloth':
    # taut fabric awning + cloth display (baseline)
    vv = []; uv = []; nx = 36
    for j in range(4):
        t = j / 3
        for i in range(nx + 1):
            xx = x - W * .35 + W * .7 * i / nx
            vv.append((xx, 2.92 - .26 * t + .018 * math.cos(i * math.pi / 2), z + .35 + 1.05 * t))
            uv.append((i / nx, t))
    L.mesh('wine-fabric-awning', vv, [(a, a + nx + 1, a + nx + 2, a + 1)
           for j in range(3) for i in range(nx) for a in [j * (nx + 1) + i]], 'clothR', uv)
    for xx in (x - W * .35, x + W * .35):
        L.rod('awning-bracket', (xx, 2.25, z + .1), (xx, 2.65, z + 1.37), .027, 'iron')
    L.box('cloth-display-table', (x, 1.03, z - .75), (4.5, .14, .75), 'wood', .014)
    for xx in (x - 1.9, x + 1.9):
        L.box('table-leg', (xx, .53, z - .75), (.10, 1, .5), 'wood', .006)
    for i in range(7):
        xx = x - 1.62 + i * .54
        material = ['clothB', 'clothC', 'clothG', 'clothR'][i % 4]
        L.cyl('cloth-roll', (xx, 1.16, z - .86), (xx, 1.16, z - .24), .14, material, 12)
        L.cyl('cloth-core', (xx, 1.16, z - .245), (xx, 1.16, z - .232), .05, 'paper', 10)
    for i, mm in enumerate(('clothB', 'clothG', 'clothC')):
        xx = x - 1.65 + i * 1.65
        vv = []
        for j in range(2):
            for k in range(9):
                vv.append((xx - .5 + k * .125, 2.62 - j * 1.35, z - 2.6 + .045 * math.sin(k * math.pi / 2)))
        L.mesh('hanging-fabric-sample', vv, [(k, k + 1, k + 10, k + 9) for k in range(8)], mm)
else:
    L.canopy(x, W * .88, 4.4, z + .08)
    L.box('medicine-cabinet', (x, 1.48, z - 2.7), (5.8, 2.7, .48), 'dark', .012)
    for yy in range(7):
        for xx in range(12):
            px = x - 2.65 + xx * .48; py = .31 + yy * .36
            L.box('apothecary-drawer', (px, py, z - 2.43), (.445, .32, .075), 'drawer', .004)
            L.box('drawer-label', (px, py + .04, z - 2.386), (.12, .047, .01), 'paper', 0)
            L.cyl('drawer-knob', (px, py - .065, z - 2.383), (px, py - .065, z - 2.352), .018, 'gold', 8)
    L.box('medicine-counter', (x, .97, z - 1.4), (5.0, 1.75, .65), 'wood', .015, True)
    L.box('counter-stone-top', (x, 1.86, z - 1.4), (5.16, .14, .78), 'dark', .012)
    L.cyl('scale-foot', (x - 1.6, 1.95, z - 1.4), (x - 1.6, 2.0, z - 1.4), .16, 'iron', 12)
    L.rod('scale-stem', (x - 1.6, 2, z - 1.4), (x - 1.6, 2.35, z - 1.4), .028, 'gold')
    L.cyl('scale-pan', (x - 1.6, 2.36, z - 1.4), (x - 1.6, 2.39, z - 1.4), .24, 'gold', 16)

L.downpipe(x + W / 2, EAVE, z)

design = {
    'family': kind + '-shop',
    'source': 'derived from inputs/baseline 檐下三间 build.py; rebuilt in unit-local frame',
    'frontageM': W, 'depthM': D, 'eaveM': EAVE, 'ridgeM': RIDGE,
    'eaveMarginM': 0.4, 'frontProtrusionM': 0.5,
    'doors': 'ground floor open bays into shallow display interior',
}
L.finalize(kind + '-shop', HERE / (kind + '_shop'), design)
