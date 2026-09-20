"""Lane B v2 module builder (lanes-v2 batch) — the N5 frozen 5.5 m lane-b
design extended to 10 m with a rear pocket, derived from kit/build_lane_b.py.

Local frame (unchanged from the frozen module): origin = portal centre on the
old seal wall's inner face at floor y=0.09; +X right (0.8863, 0, 0.4631);
+Z inward (-0.4631, 0, 0.8863). World placement: portalCenterGlb
[57.418, 0.09, 14.2485], rotationYRad -0.4818.

What stays (frozen N5 components): portal piers/lintel/reveals, threshold +
inset drain, clothesline + 2 cloth pieces, conduit + clips, downpipe +
clamps + shoe, 1.5 m clear portal.
What changes (per kit/lanes-v2.config.json): depth 5.5 -> 10, back facade
moved to s=10.06, side facade extended with a second high window, corner caps
+ plinth junctions from the shared lanes-v2 component set, rear service door
on the east side (s=7.3, closed).

kit/out/lane-b (the N5 output) stays byte-frozen; this writes kit/out/lanes-v2/lane-b-v2.

Run: blender -b --factory-startup -t 4 -P kit/build_lane_b_v2.py -- --out kit/out/lanes-v2/lane-b-v2
"""
import argparse
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import bpy  # noqa: E402
import mb_lib as L  # noqa: E402
import mathutils  # noqa: E402
from lanes_v2_components import rear_service_door, corner_cap  # noqa: E402


def quad(name, pts, m, uv=None):
    """Flat quad from 4 points (order: CCW seen from the front)."""
    verts = [tuple(pt) for pt in pts]
    uvs = uv or [(0, 0), (1, 0), (1, 1), (0, 1)]
    return L.mesh(name, verts, [(0, 1, 2, 3)], m, uvs)

argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--out', type=Path, required=True)
a = p.parse_args(argv)

L.reset_scene()
L.build_materials()
L.GROUP = 'lanes-v2'

RIGHT_YAW = -0.4818
DEPTH = 10.0
POCKET_W = 3.6

def box6(name, c, s, m, bevel=.008, collision=False):
    return L.box(name, c, s, m, bevel, collision)


# ---------------------------------------------------------------- floor
# funnel: s=0 w1.62 -> s=2.5 w2.4 -> s=4.0 w3.6 -> s=10 w3.6 (pocket extends to the new back)
profile = [(0.0, 1.62), (2.5, 2.4), (4.0, 3.6), (10.0, 3.6)]
verts, faces, uvs = [], [], []
for i, (s, w) in enumerate(profile):
    verts += [(-w / 2, 0.0, s), (w / 2, 0.0, s)]
    uvs += [(x / 2.4, s / 2.4) for x in (-w / 2, w / 2)]
for i in range(len(profile) - 1):
    a0 = i * 2
    faces.append((a0, a0 + 1, a0 + 3, a0 + 2))
fl = L.mesh('floor', verts, faces, 'paving', uvs)
fl.name = 'floor'

# ---------------------------------------------------------------- portal wall (frozen N5 assembly, unchanged)
box6('portal-pier-left', (-0.925, 2.65 / 2, -0.06), (0.35, 2.65, 0.12), 'plaster', 0.006, True)
box6('portal-pier-right', (0.925, 2.65 / 2, -0.06), (0.35, 2.65, 0.12), 'plaster', 0.006, True)
box6('portal-lintel', (0.0, (2.3 + 2.65) / 2, -0.06), (1.5, 0.35, 0.12), 'plaster', 0.006)
box6('portal-lintel-timber', (0.0, 2.37, -0.05), (1.66, 0.14, 0.2), 'wood', 0.006)
for sx in (-0.75, 0.75):
    box6('portal-reveal', (sx, 1.15, -0.06), (0.05, 2.3, 0.13), 'plaster', 0.004)
box6('portal-threshold', (0.0, 0.03, -0.05), (1.5, 0.06, 0.16), 'stone', 0.006)
for nm, c, s in [
    ('drain-frame-rail-n', (0.0, 0.008, 0.315), (0.72, 0.035, 0.05)),
    ('drain-frame-rail-s', (0.0, 0.008, 0.525), (0.72, 0.035, 0.05)),
    ('drain-frame-rail-w', (-0.335, 0.008, 0.42), (0.05, 0.035, 0.16)),
    ('drain-frame-rail-e', (0.335, 0.008, 0.42), (0.05, 0.035, 0.16)),
]:
    box6(nm, c, s, 'stone', 0.004)
box6('drain-grate', (0.0, -0.004, 0.42), (0.6, 0.02, 0.16), 'iron', 0.002)

# ---------------------------------------------------------------- east side facade (extended, s 2.5..10)
box6('side-facade', (1.86, 2.4, 6.25), (0.12, 4.8, 7.5), 'plaster', 0.006, True)
box6('side-plinth', (1.8, 0.3, 6.25), (0.05, 0.6, 7.54), 'brick', 0.004)
box6('side-facade-coping', (1.9, 4.8 + 0.06, 6.25), (0.26, 0.12, 7.6), 'roof', 0.006)


def shutter_window_x(x, y, z, w=1.4, h=1.9, name='shutter-window'):
    """mb_lib.shutter_window rebuilt facing -X (wall on +X side), axis-swapped."""
    box6(f'{name}-recess', (x + .15, y, z), (.14, h + .2, w + .2), 'inner', 0)
    box6(f'{name}-glass', (x + .055, y, z), (.025, h - .18, w - .18), 'glass', 0)
    for zz in (z - w / 2, z + w / 2):
        box6(f'{name}-stile', (x + .01, y, zz), (.13, h + .14, .075), 'wood', .005)
    for yy in (y - h / 2, y + h / 2):
        box6(f'{name}-rail', (x + .02, yy, z), (.13, .075, w + .12), 'wood', .004)
    for dz in (z - w * .22, z + w * .16):
        box6(f'{name}-panel', (x - .02, y, dz), (.045, h * .92, w * .38), 'wood', .006)
    box6(f'{name}-sill', (x + .04, y - h / 2 - .09, z), (.28, .14, w + .3), 'stone', .012)


shutter_window_x(1.74, 2.6, 4.6, 1.0, 1.4, name='shutter-window')
# second window at a different station/rhythm from lane A (3.7 m further in, smaller)
shutter_window_x(1.74, 3.1, 8.3, 0.8, 1.1, name='shutter-window-b')
box6('side-door', (1.78, 1.025, 3.1), (0.09, 2.05, 1.0), 'dark', 0.006, True)
box6('side-door-frame', (1.76, 1.06, 3.1), (0.14, 2.15, 1.12), 'wood', 0.005)
# pent slope over the side facade (extended run)
quad('side-roof', [(1.92, 4.8, 2.4), (1.92, 4.8, 10.1), (2.34, 5.15, 10.1), (2.34, 5.15, 2.4)],
     'roof', uv=[(0, 0), (3.2, 0), (3.2, 0.4), (0, 0.4)])

# closed rear service door in the east side facade at s=7.3 (reusable module)
rear_service_door(L, +1, 1.80, 7.3, w=1.0, h=2.05, recess=0.25, bay_len=1.7, wall_h=4.8)

# ---------------------------------------------------------------- west pocket wall (extended, s 3.5..10)
box6('pocket-wall-left', (-1.86, 1.8, 6.75), (0.12, 3.6, 6.5), 'plaster', 0.006, True)
box6('pocket-wall-left-plinth', (-1.8, 0.3, 6.75), (0.05, 0.6, 6.54), 'brick', 0.004)
box6('pocket-wall-left-coping', (-1.9, 3.6 + 0.06, 6.75), (0.26, 0.12, 6.6), 'roof', 0.006)
# coping end cap where the pocket wall meets the back facade
corner_cap(L, -1.80, 10.0, -1, wall_h=3.6, depth_sign=+1, name='corner-w')

# ---------------------------------------------------------------- back facade (moved to s=10.06)
box6('back-facade', (0.0, 3.1, 10.06), (3.6, 6.2, 0.12), 'plaster', 0.006, True)
box6('back-plinth', (0.0, 0.3, 9.98), (3.64, 0.6, 0.05), 'brick', 0.004)
L.shutter_window(-0.9, 3.6, 9.94, 1.1, 1.5)
L.shutter_window(0.9, 5.3, 9.94, 0.9, 1.2)
quad('back-roof', [(-1.95, 6.2, 10.16), (1.95, 6.2, 10.16), (1.95, 6.75, 11.0), (-1.95, 6.75, 11.0)],
     'roof', uv=[(0, 0), (1.6, 0), (1.6, 0.7), (0, 0.7)])
quad('back-roof-soffit', [(-1.95, 6.19, 10.16), (1.95, 6.19, 10.16), (1.95, 6.19, 9.8), (-1.95, 6.19, 9.8)],
     'wood', uv=[(0, 0), (1.6, 0), (1.6, 0.3), (0, 0.3)])
# east rear corner cap where side facade meets the back facade
corner_cap(L, 1.80, 10.0, +1, wall_h=4.8, depth_sign=+1, name='corner-e')

# ---------------------------------------------------------------- 4 detail groups (frozen N5 set)
# 1) wall-fixed downpipe with clamps + drain shoe (back facade, left corner)
px, pz = -1.66, 9.94
L.cyl('downpipe', (px, 0.06, pz), (px, 4.62, pz), 0.045, 'iron', 8)
for hy in (0.9, 2.4, 3.9):
    box6('downpipe-clamp', (px, hy, pz - 0.055), (0.05, 0.06, 0.11), 'iron', 0.002)
L.cyl('downpipe-shoe', (px, 0.28, pz - 0.1), (px, 0.06, pz - 0.02), 0.05, 'iron', 8)

# 2) two restrained cloth pieces on a supported line (clearance 2.45m > 2.2m)
line_a = mathutils.Vector((1.8, 2.55, 3.0))   # bracket on side facade
line_b = mathutils.Vector((0.86, 2.5, -0.02))  # hook on portal right pier
L.rod('clothesline', tuple(line_a), tuple(line_b), 0.012, 'iron')
box6('line-bracket', (1.86, 2.55, 3.0), (0.1, 0.05, 0.05), 'iron', 0.002)
box6('line-hook', (0.9, 2.5, -0.02), (0.05, 0.05, 0.06), 'iron', 0.002)
ldir = (line_b - line_a).normalized()
lperp = ldir.cross(mathutils.Vector((0, 1, 0))).normalized()


def cloth(name, t, width, drop, m):
    top_c = line_a.lerp(line_b, t)
    aa = top_c + lperp * (width / 2)
    bb = top_c - lperp * (width / 2)
    quad(name, [tuple(aa), tuple(bb), tuple(bb - mathutils.Vector((0, drop, 0))),
                tuple(aa - mathutils.Vector((0, drop, 0)))], m,
         uv=[(0, 1), (1, 1), (1, 0), (0, 0)])


cloth('cloth-indigo', 0.35, 0.46, 0.5, 'clothB')
cloth('cloth-sage', 0.65, 0.4, 0.42, 'clothG')

# 3) wall conduit run with clips (left pocket wall, extended run)
L.rod('conduit', (-1.79, 2.45, 3.6), (-1.79, 2.45, 9.6), 0.02, 'iron')
for cz in (3.8, 4.3, 4.8, 5.3, 7.6, 8.6, 9.4):
    box6('conduit-clip', (-1.8, 2.45, cz), (0.03, 0.06, 0.03), 'iron', 0.002)

# 4) inset drain + threshold at portal (frozen, built above)

# ---------------------------------------------------------------- finalize
design = {
    'family': 'lane-b-module-v2',
    'sampleId': 'lane-b-v2',
    'basedOn': 'kit/build_lane_b.py (frozen N5 design) extended per lanes-v2 DESIGN_SPEC; design inference, not survey',
    'localFrame': 'origin=portal centre on old seal wall inner face at floor y=0.09; +X right(0.8863,0,0.4631); +Z inward(-0.4631,0,0.8863)',
    'worldPlacement': {'portalCenterGlb': [57.418, 0.09, 14.2485], 'rotationYRad': -0.4818},
    'portalClearWidthM': 1.5, 'portalClearHeightM': 2.3, 'portalOverallHeightM': 2.65,
    'depthM': 10.0, 'pocketWidthM': 3.6,
    'facadeHeightsM': [6.2, 4.8],
    'changesFromV1': ['depth 5.5->10', 'back facade s=10.06', 'side facade extended with second shutter window',
                      'rear service door east s=7.3 (closed, reusable module)', 'corner caps at pocket rear'],
    'reusedComponents': ['portal assembly', 'threshold + inset drain', 'clothesline + cloth',
                         'conduit + clips', 'downpipe + clamps + shoe', 'rear-service-door-panel', 'corner-cap-plinth'],
    'newTextures': 0,
    'budgetTris': 30000,
}
a.out.mkdir(parents=True, exist_ok=True)
tris, bytes_ = L.finalize('lane-b-v2', a.out, design)
print(f'LANE_B_V2_READY tris={tris} bytes={bytes_}')
assert tris <= 30000, f'new placed triangles {tris} > 30000 budget'
assert bytes_ <= 6_000_000, f'module bytes {bytes_} > 6MB budget'
print('BUDGET_OK')
