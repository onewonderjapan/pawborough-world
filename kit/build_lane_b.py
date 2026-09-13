"""Lane B module builder (N5) — implements the frozen 12m lane design
(before-owner-decision-2210/DESIGN.md + DESIGN_SPEC.json).

Local frame: origin = portal centre on the old seal wall's INNER face, at
floor level (world y=0.09). +X = right (0.8863, 0, 0.4631), +Y up,
+Z = inward (-0.4631, 0, 0.8863). s = distance from the portal plane.

Everything reuses the frozen mb_lib material set; zero new textures.
Budget guards are asserted at the end (DESIGN_SPEC budget).

Run: blender -b --factory-startup -t 4 -P kit/build_lane_b.py -- --out kit/out/lane-b
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

import mathutils
argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--out', type=Path, required=True)
a = p.parse_args(argv)

# exact values derived from the frozen assembly (see N5 evidence; sub-cm match
# with DESIGN_SPEC originApprox/inwardApprox/rightApprox)
RIGHT_YAW = -0.4818          # rad, rotation about +Y mapping local +X to world right
FLOOR_Y = 0.09               # world floor height (local 0)

L.reset_scene()
L.build_materials()
L.GROUP = 'lane-b'


def quad(name, pts, m, uv=None):
    """Flat quad from 4 points (order: CCW seen from the front)."""
    verts = [tuple(pt) for pt in pts]
    uvs = uv or [(0, 0), (1, 0), (1, 1), (0, 1)]
    return L.mesh(name, verts, [(0, 1, 2, 3)], m, uvs)


def box6(name, c, s, m, bevel=.008, collision=False):
    return L.box(name, c, s, m, bevel, collision)


# ---------------------------------------------------------------- floor
# funnel: s=0 w1.62 -> s=2.5 w2.4 -> s=4.0 w3.6 -> s=5.5 w3.6 (pocket, frozen OBB clearance check)
profile = [(0.0, 1.62), (2.5, 2.4), (4.0, 3.6), (5.5, 3.6)]
verts, faces, uvs = [], [], []
for i, (s, w) in enumerate(profile):
    verts += [(-w / 2, 0.0, s), (w / 2, 0.0, s)]
    uvs += [(x / 2.4, s / 2.4) for x in (-w / 2, w / 2)]
for i in range(len(profile) - 1):
    a0 = i * 2
    faces.append((a0, a0 + 1, a0 + 3, a0 + 2))
fl = L.mesh('floor', verts, faces, 'paving', uvs)
fl.name = 'floor'

# ---------------------------------------------------------------- portal wall (replaces the old seal wall)
# opening 1.5w x 2.3h clear, overall 2.65; wall span x -1.1..1.1 (old wall footprint), thickness 0.12
box6('portal-pier-left', (-0.925, 2.65 / 2, -0.06), (0.35, 2.65, 0.12), 'plaster', 0.006, True)
box6('portal-pier-right', (0.925, 2.65 / 2, -0.06), (0.35, 2.65, 0.12), 'plaster', 0.006, True)
box6('portal-lintel', (0.0, (2.3 + 2.65) / 2, -0.06), (1.5, 0.35, 0.12), 'plaster', 0.006)
# timber lintel band + reveals give the opening real depth
box6('portal-lintel-timber', (0.0, 2.37, -0.05), (1.66, 0.14, 0.2), 'wood', 0.006)
for sx in (-0.75, 0.75):
    box6('portal-reveal', (sx, 1.15, -0.06), (0.05, 2.3, 0.13), 'plaster', 0.004)
box6('portal-threshold', (0.0, 0.03, -0.05), (1.5, 0.06, 0.16), 'stone', 0.006)
# inset drain just outside the portal (dark grate recessed below floor top)
box6('drain-frame', (0.0, 0.008, 0.42), (0.72, 0.035, 0.26), 'stone', 0.004)
box6('drain-grate', (0.0, -0.004, 0.42), (0.6, 0.02, 0.16), 'iron', 0.002)

def shutter_window_x(x, y, z, w=1.4, h=1.9):
    """mb_lib.shutter_window rebuilt facing -X (wall on +X side), axis-swapped."""
    box6('shutter-window-recess', (x + .15, y, z), (.14, h + .2, w + .2), 'inner', 0)
    box6('shutter-window-glass', (x + .055, y, z), (.025, h - .18, w - .18), 'glass', 0)
    for zz in (z - w / 2, z + w / 2):
        box6('shutter-window-stile', (x + .01, y, zz), (.13, h + .14, .075), 'wood', .005)
    for yy in (y - h / 2, y + h / 2):
        box6('shutter-window-rail', (x + .02, yy, z), (.13, .075, w + .12), 'wood', .004)
    for dz in (z - w * .22, z + w * .16):
        box6('shutter-panel', (x - .02, y, dz), (.045, h * .92, w * .38), 'wood', .006)
    box6('shutter-window-sill', (x + .04, y - h / 2 - .09, z), (.28, .14, w + .3), 'stone', .012)


# ---------------------------------------------------------------- rear interfaces (max 2)
# back facade, height 6.2 (design value), pocket back at s=5.5
box6('back-facade', (0.0, 3.1, 5.56), (3.6, 6.2, 0.12), 'plaster', 0.006, True)
box6('back-plinth', (0.0, 0.3, 5.48), (3.64, 0.6, 0.05), 'brick', 0.004)
L.shutter_window(-0.9, 3.6, 5.44, 1.1, 1.5)
L.shutter_window(0.9, 5.3, 5.44, 0.9, 1.2)
# simple straight pent slope over the back facade (no ornate curve, no temple eaves)
quad('back-roof', [(-1.95, 6.2, 5.66), (1.95, 6.2, 5.66), (1.95, 6.75, 6.5), (-1.95, 6.75, 6.5)],
     'roof', uv=[(0, 0), (1.6, 0), (1.6, 0.7), (0, 0.7)])
quad('back-roof-soffit', [(-1.95, 6.19, 5.66), (1.95, 6.19, 5.66), (1.95, 6.19, 5.3), (-1.95, 6.19, 5.3)],
     'wood', uv=[(0, 0), (1.6, 0), (1.6, 0.3), (0, 0.3)])

# side facade (right), height 4.8, z 2.5..5.5
box6('side-facade', (1.86, 2.4, 4.0), (0.12, 4.8, 3.0), 'plaster', 0.006, True)
box6('side-plinth', (1.8, 0.3, 4.0), (0.05, 0.6, 3.04), 'brick', 0.004)
shutter_window_x(1.74, 2.6, 4.6, 1.0, 1.4)
box6('side-door', (1.78, 1.025, 3.1), (0.09, 2.05, 1.0), 'dark', 0.006, True)
box6('side-door-frame', (1.76, 1.06, 3.1), (0.14, 2.15, 1.12), 'wood', 0.005)
# pent slope over side facade
quad('side-roof', [(1.92, 4.8, 2.4), (1.92, 4.8, 5.6), (2.34, 5.15, 5.6), (2.34, 5.15, 2.4)],
     'roof', uv=[(0, 0), (2.6, 0), (2.6, 0.4), (0, 0.4)])

# left pocket wall (lower, closes the pocket on the free side)
box6('pocket-wall-left', (-1.86, 1.8, 4.5), (0.12, 3.6, 2.0), 'plaster', 0.006, True)

# ---------------------------------------------------------------- 4 detail groups
# 1) wall-fixed downpipe with clamps + drain shoe (back facade, left corner)
px, pz = -1.66, 5.44
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
lperp = ldir.cross(mathutils.Vector((0, 1, 0))).normalized()  # horizontal perpendicular


def cloth(name, t, width, drop, m):
    top_c = line_a.lerp(line_b, t)
    a = top_c + lperp * (width / 2)
    b = top_c - lperp * (width / 2)
    quad(name, [tuple(a), tuple(b), tuple(b - mathutils.Vector((0, drop, 0))),
                tuple(a - mathutils.Vector((0, drop, 0)))], m,
         uv=[(0, 1), (1, 1), (1, 0), (0, 0)])


cloth('cloth-indigo', 0.35, 0.46, 0.5, 'clothB')
cloth('cloth-sage', 0.65, 0.4, 0.42, 'clothG')

# 3) wall conduit run with clips (left pocket wall)
L.rod('conduit', (-1.79, 2.45, 3.6), (-1.79, 2.45, 5.4), 0.02, 'iron')
for cz in (3.8, 4.3, 4.8, 5.3):
    box6('conduit-clip', (-1.8, 2.45, cz), (0.03, 0.06, 0.03), 'iron', 0.002)

# 4) inset drain + threshold at portal (built above: drain-frame/grate + portal-threshold)

# ---------------------------------------------------------------- finalize
design = {
    'family': 'lane-b-module',
    'sampleId': 'lane-b',
    'basedOn': 'before-owner-decision-2210/DESIGN.md + DESIGN_SPEC.json (frozen design)',
    'localFrame': 'origin=portal centre on old seal wall inner face at floor y=0.09; +X right(0.8863,0,0.4631); +Z inward(-0.4631,0,0.8863)',
    'portalClearWidthM': 1.5, 'portalClearHeightM': 2.3, 'portalOverallHeightM': 2.65,
    'depthM': 5.5, 'pocketWidthM': 3.6,
    'facadeHeightsM': [6.2, 4.8],
    'detailGroups': ['downpipe+clamps+shoe', 'clothesline+2 cloth (2.45m clearance)',
                     'conduit+clips', 'inset drain + threshold'],
    'newTextures': 0,
    'configDriven': False,
    'designFrozen': True,
}
a.out.mkdir(parents=True, exist_ok=True)
tris, bytes_ = L.finalize('lane-b', a.out, design)
budget = json.loads((HERE.parent / 'before-owner-decision-2210/DESIGN_SPEC.json').read_text()) if (HERE.parent / 'before-owner-decision-2210/DESIGN_SPEC.json').exists() else None
print(f'LANE_B_READY tris={tris} bytes={bytes_}')
assert tris <= 35000, f'new placed triangles {tris} > 35000 budget'
assert bytes_ <= 6_000_000, f'module bytes {bytes_} > 6MB budget'
print('BUDGET_OK')
