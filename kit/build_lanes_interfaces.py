"""Lanes-v2 street interfaces builder (W stage) — two lane mouths plus the
lane A street-to-portal corridor, in WORLD coordinates (identity placement).

Everything here replaces geometry removed from the v5 assembly copy (the 45
placeholder triangles) and finishes the joins the DESIGN_SPEC lists: door
reveal depth at the mouths, threshold/pavement joins, drain depth, brick-base
continuity. Frozen buildings are not touched; the v4 visual-vs-collider
offsets of N05/N06 are recorded as knownDeviation in placement/DELIVERY.

Ground contract: floor faces are named lanes-v2__paving-frontage /
lanes-v2__worn-stone (added to GROUND_NODE_RE for v5), so the new paving is
real walkable ground, never decoration.

Run: blender -b --factory-startup -t 4 -P kit/build_lanes_interfaces.py -- --out kit/out/lanes-v2/interfaces
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

argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--out', type=Path, required=True)
a = p.parse_args(argv)

L.reset_scene()
L.build_materials()
L.GROUP = 'lanes-v2'

FLOOR_Y = 0.09


def quad(name, pts_xz, m, uv=None, y=FLOOR_Y):
    """Horizontal quad from (x, z) points at a fixed height y."""
    verts = [(pt[0], y, pt[1]) for pt in pts_xz]
    uvs = uv or [(0, 0), (1, 0), (1, 1), (0, 1)]
    return L.mesh(name, verts, [(0, 1, 2, 3)], m, uvs)


def rot(pt, center, yaw):
    """Rotate GLB xz about center by yaw (right-handed about +Y)."""
    c, s = math.cos(yaw), math.sin(yaw)
    dx, dz = pt[0] - center[0], pt[2] - center[2]
    return [center[0] + c * dx + s * dz, pt[1], center[2] - s * dx + c * dz]


# ================================================================ mouth A
# corridor floor: street frontage (visual faces of N05/N06) to the module
# portal plane; replaces the removed placeholder paving
A_PTS = [   # winding: matches the proven mb_lib floor order (see laneb/lane-a)
    (39.86, -16.40),   # N05 east face at the portal latitude
    (42.445, -16.439), # portal NW (module floor edge)
    (44.645, -16.313), # portal NE (module floor edge)
    (43.69, -14.03),   # N06 north-west corner
    (43.02, -10.07),   # N06 visual west face at the street line
    (40.30, -10.75),   # N05 visual east face at the street line
]
verts = [(x, FLOOR_Y, z) for (x, z) in A_PTS]
uvs = [((x) / 2.4, (z) / 2.4) for (x, z) in A_PTS]
L.mesh('a-floor', verts, [(0, 1, 2, 3), (0, 3, 4, 5)], 'paving', uvs)

# edge drain along the walkable west side (recessed 0.02 below the floor)
quad('a-drain', [(42.45, -16.40), (42.62, -16.40), (42.62, -10.45), (42.45, -10.45)],
     'stone', uv=[(0, 0), (0.13, 0), (0.13, 5.0), (0, 5.0)], y=FLOOR_Y - 0.02)

# street threshold strip across the mouth (pavement join)
quad('a-threshold', [(40.30, -10.40), (44.15, -10.40), (44.15, -9.95), (40.30, -9.95)],
     'stone', uv=[(0, 0), (3.2, 0), (3.2, 0.4), (0, 0.4)], y=FLOOR_Y + 0.025)

# door-reveal corner piers at the two street-mouth corners (reveal depth)
L.box('a-jamb-west', (40.30, 1.7, -10.75), (0.34, 3.2, 0.55), 'plaster', 0.008, True)
L.box('a-jamb-west-base', (40.30, 0.39, -10.75), (0.40, 0.6, 0.61), 'brick', 0.006)
L.box('a-jamb-west-cap', (40.30, 3.32, -10.75), (0.40, 0.1, 0.61), 'stone', 0.006)
L.box('a-jamb-east', (43.02, 1.7, -10.07), (0.34, 3.2, 0.55), 'plaster', 0.008, True)
L.box('a-jamb-east-base', (43.02, 0.39, -10.07), (0.40, 0.6, 0.61), 'brick', 0.006)
L.box('a-jamb-east-cap', (43.02, 3.32, -10.07), (0.40, 0.1, 0.61), 'stone', 0.006)

# ================================================================ mouth B
# lane B portal anchor (frozen N5 values)
BC = [57.418, FLOOR_Y, 14.2485]
B_YAW = -0.4818
B_RIGHT = (math.cos(B_YAW), math.sin(B_YAW))       # local +X -> world (cos, sin)
B_IN = (-math.sin(B_YAW), math.cos(B_YAW))         # local +Z -> world


def bpt(right_off, s):
    return [BC[0] + B_RIGHT[0] * right_off + B_IN[0] * s, FLOOR_Y,
            BC[2] + B_RIGHT[1] * right_off + B_IN[1] * s]


# stone apron from the street paving to the portal threshold
apron = [bpt(-1.5, -1.30), bpt(1.5, -1.30), bpt(1.5, -0.02), bpt(-1.5, -0.02)]
quad('b-apron', apron, 'paving',
     uv=[(0, 0), (3.0 / 2.4, 0), (3.0 / 2.4, 1.3 / 2.4), (0, 1.3 / 2.4)], y=FLOOR_Y - 0.015)

# drain outlet channel carrying the portal drain out to the street gutter
outlet = [bpt(-0.36, -0.65), bpt(0.36, -0.65), bpt(0.36, -0.02), bpt(-0.36, -0.02)]
quad('b-drain-outlet', outlet, 'stone',
     uv=[(0, 0), (0.72, 0), (0.72, 0.63), (0, 0.63)], y=FLOOR_Y - 0.035)

# brick base wraps continuing the pier bases down to the pavement (砖基转角连续)
for sgn, nm in ((-1, 'w'), (+1, 'e')):
    c = bpt(sgn * 0.925, -0.20)
    L.box(f'b-pier-base-{nm}', (c[0], 0.30, c[2]), (0.44, 0.6, 0.18), 'brick', 0.006, True)

# ---------------------------------------------------------------- finalize
design = {
    'family': 'lanes-v2-interfaces',
    'sampleId': 'lanes-v2-interfaces',
    'basedOn': 'lanes-v2 DESIGN_SPEC.targets.interfaces; anchors measured from real geometry (artifacts/lanes-construction/placement.json)',
    'localFrame': 'WORLD coordinates (identity placement), GLB Y-up, floor top y=0.09',
    'pieces': [
        'mouth A: corridor floor street->portal (replaces removed placeholder paving)',
        'mouth A: west edge drain + street threshold strip + two reveal corner piers',
        'mouth B: street apron to threshold + drain outlet channel + two pier base wraps',
    ],
    'groundNodeNames': ['lanes-v2__paving-frontage', 'lanes-v2__worn-stone'],
    'newTextures': 0,
    'knownDeviation': 'N05/N06 visual faces sit 1-2.3m west of their frozen colliders (v4 adopted state); interface floor follows the visual faces, walkability still bounded by the frozen colliders',
    'budgetTris': 20000,
}
a.out.mkdir(parents=True, exist_ok=True)
tris, bytes_ = L.finalize('lanes-v2-interfaces', a.out, design)
print(f'INTERFACES_READY tris={tris} bytes={bytes_}')
assert tris <= 20000, f'interfaces {tris} > 20000 budget'
print('BUDGET_OK')
