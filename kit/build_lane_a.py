"""Lane A module builder (lanes-v2 batch) — quiet 8 m service lane north of the
old lane-A seal wall on Fangbang Middle Street.

Local frame: origin = portal centre on the removed seal wall's mid-plane, at
floor level (world y=0.09); +Z = inward (north, (0.0251, 0, -0.9997) world);
+X = right-handed horizontal (the west side of this northward lane); world
placement: portalCenterGlb [43.545, 0.09, -16.375], rotationYRad 3.1165.

Wall sides: local +X face = world WEST (thickness 0.10 — clears the N05 rear
wall by ≥0.04 m), local -X face = world EAST (thickness 0.24). Design values
are per DESIGN_SPEC, not a survey; zero new textures; budget 30k tris.

Reusable detail modules come from kit/lanes_v2_components.py.

Run: blender -b --factory-startup -t 4 -P kit/build_lane_a.py -- --out kit/out/lanes-v2/lane-a
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import bpy  # noqa: E402
import mb_lib as L  # noqa: E402
from lanes_v2_components import high_window, rear_service_door, corner_cap  # noqa: E402


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

# ---- dimensions (design values, kit/lanes-v2.config.json) ------------------
CLEAR_W = 2.2            # inner faces at x = ±1.10
W_X, E_X = 1.10, -1.10   # west (+X) / east (−X) wall inner faces
W_T, E_T = 0.10, 0.24
DEPTH = 8.0              # clear depth; end wall face at s = DEPTH
WALL_H = 3.3
END_H = 3.5
PORTAL_H = 2.3
PORTAL_TOP = 2.65
S0 = 0.06                # floor starts just behind the portal plane

# ---------------------------------------------------------------- floor
# stone slab paving with recessed edge-drain channels along both walls
fl = L.mesh('floor', [
    (E_X, 0.0, S0), (W_X, 0.0, S0), (W_X, 0.0, DEPTH), (E_X, 0.0, DEPTH),
], [(0, 1, 2, 3)], 'paving', [(0, 0), (2.2 / 2.4, 0), (2.2 / 2.4, DEPTH / 2.4), (0, DEPTH / 2.4)])
for nm, xf, sd in (('w', W_X, 1), ('e', E_X, -1)):
    L.mesh(f'drain-{nm}', [
        (xf - sd * 0.005, -0.02, S0), (xf - sd * 0.16, -0.02, S0),
        (xf - sd * 0.16, -0.02, DEPTH), (xf - sd * 0.005, -0.02, DEPTH),
    ], [(0, 1, 2, 3)], 'stone',
        [(0, 0), (0.16 / 1.2, 0), (0.16 / 1.2, DEPTH / 1.2), (0, DEPTH / 1.2)])

# ---------------------------------------------------------------- portal frame
# the opening spans the full clear width (the flanking buildings are the jambs);
# plaster lintel + timber band + top closing band replace the removed seal wall
SPAN_C, SPAN_W = (W_X + W_T + E_X - E_T) / 2, W_T + CLEAR_W + E_T   # outer envelope centre/width
L.box('portal-lintel', (SPAN_C, (PORTAL_H + PORTAL_TOP) / 2, 0.0), (SPAN_W, PORTAL_TOP - PORTAL_H, 0.3), 'plaster', 0.006)
L.box('portal-lintel-timber', (0.0, PORTAL_H + 0.07, -0.02), (CLEAR_W + 0.12, 0.14, 0.2), 'wood', 0.006)
L.box('portal-top-band', (SPAN_C, (PORTAL_TOP + WALL_H) / 2, 0.0), (SPAN_W, WALL_H - PORTAL_TOP, 0.12), 'plaster', 0.006)
L.box('portal-threshold', (0.0, 0.01, 0.02), (CLEAR_W, 0.06, 0.22), 'stone', 0.006)
# timber jamb posts frame the entry (door-reveal depth at the lane's own portal)
sd_of = lambda x: 1 if x > 0 else -1
for xj in (W_X, E_X):
    L.box('portal-jamb-post', (xj - sd_of(xj) * 0.03, PORTAL_H / 2, -0.02),
          (0.14, PORTAL_H, 0.14), 'wood', 0.006)

# ---------------------------------------------------------------- side walls
# the west wall is segmented around the rear-door bay so the niche opening is real
DOOR_S, BAY_LEN = 4.9, 1.7
L.box('wall-west-s1', (W_X + W_T / 2, WALL_H / 2, (S0 + DOOR_S - BAY_LEN / 2) / 2),
      (W_T, WALL_H, DOOR_S - BAY_LEN / 2 - S0), 'plaster', 0.006, True)
L.box('wall-west-s2', (W_X + W_T / 2, WALL_H / 2, (DOOR_S + BAY_LEN / 2 + DEPTH) / 2),
      (W_T, WALL_H, DEPTH - (DOOR_S + BAY_LEN / 2)), 'plaster', 0.006, True)
L.box('wall-east', (E_X - E_T / 2, WALL_H / 2, (S0 + DEPTH) / 2), (E_T, WALL_H, DEPTH - S0), 'plaster', 0.006, True)
# brick bases (protrude 0.05 into the lane, h 0.6) + timber waist band (0.78–0.93)
for xf, t, nm in ((W_X, W_T, 'west'), (E_X, E_T, 'east')):
    sd = 1 if xf > 0 else -1
    if nm == 'west':
        for (s0, s1) in ((S0, DOOR_S - BAY_LEN / 2), (DOOR_S + BAY_LEN / 2, DEPTH)):
            L.box(f'plinth-{nm}-{s0:.0f}', (xf - sd * 0.02, 0.3, (s0 + s1) / 2), (0.05, 0.6, s1 - s0), 'brick', 0.004)
            L.box(f'waist-{nm}-{s0:.0f}', (xf - sd * 0.015, 0.855, (s0 + s1) / 2), (0.04, 0.15, s1 - s0), 'wood', 0.004)
    else:
        L.box(f'plinth-{nm}', (xf - sd * 0.02, 0.3, (S0 + DEPTH) / 2), (0.05, 0.6, DEPTH - S0), 'brick', 0.004)
        L.box(f'waist-{nm}', (xf - sd * 0.015, 0.855, (S0 + DEPTH) / 2), (0.04, 0.15, DEPTH - S0), 'wood', 0.004)
    # grey tile coping (灰瓦压顶): two slopes meeting at a ridge over the wall
    x_out = xf + sd * t
    x_mid = xf + sd * (t / 2 + 0.04)
    quad(f'coping-{nm}-a', [
        (x_out - sd * 0.05, WALL_H + 0.02, S0 - 0.05), (x_mid, WALL_H + 0.12, S0 - 0.05),
        (x_mid, WALL_H + 0.12, DEPTH + 0.05), (x_out - sd * 0.05, WALL_H + 0.02, DEPTH + 0.05),
    ], 'roof', uv=[(0, 0), (0.22, 0), (0.22, (DEPTH + 0.1) / 1.44), (0, (DEPTH + 0.1) / 1.44)])
    quad(f'coping-{nm}-b', [
        (x_mid, WALL_H + 0.12, S0 - 0.05), (x_out + sd * 0.05, WALL_H + 0.02, S0 - 0.05),
        (x_out + sd * 0.05, WALL_H + 0.02, DEPTH + 0.05), (x_mid, WALL_H + 0.12, DEPTH + 0.05),
    ], 'roof', uv=[(0, 0), (0.22, 0), (0.22, (DEPTH + 0.1) / 1.44), (0, (DEPTH + 0.1) / 1.44)])

# ---------------------------------------------------------------- high windows (two rhythms)
# east wall: 3 windows, 2.0 m rhythm, 0.9 m wide (rhythm one)
for s in (1.8, 3.8, 5.8):
    high_window(L, -1, E_X, s, 2.35, 3.05, 0.9, wall_t=E_T, name_prefix=f'hiwin-e{s}')
# west wall: 4 windows, 1.33 m rhythm, 0.6 m wide (rhythm two)
for s in (1.4, 2.73, 4.07, 5.4):
    high_window(L, +1, W_X, s, 2.5, 3.1, 0.6, wall_t=W_T, name_prefix=f'hiwin-w{s}')

# ---------------------------------------------------------------- closed rear service door (west, s 4.9)
rear_service_door(L, +1, W_X, DOOR_S, w=1.0, h=2.05, recess=0.25, bay_len=BAY_LEN)

# ---------------------------------------------------------------- end wall (真实尽端墙)
# end wall ring: two side bands + band below/above the blind niche + niche back
EW_T = 0.18
NICH_W, NICH_H, NICH_Y = 0.7, 1.0, 1.7
side_w = (SPAN_W - NICH_W) / 2
for sgn in (-1, 1):
    L.box(f'end-band-{sgn}', (SPAN_C + sgn * (NICH_W / 2 + side_w / 2), END_H / 2, DEPTH + EW_T / 2),
          (side_w, END_H, EW_T), 'plaster', 0.006, True)
L.box('end-band-below', (SPAN_C, (NICH_Y - NICH_H / 2) / 2, DEPTH + EW_T / 2),
      (NICH_W, NICH_Y - NICH_H / 2, EW_T), 'plaster', 0.006, True)
L.box('end-band-above', (SPAN_C, (NICH_Y + NICH_H / 2 + END_H) / 2, DEPTH + EW_T / 2),
      (NICH_W, END_H - (NICH_Y + NICH_H / 2), EW_T), 'plaster', 0.006, True)
L.box('end-niche-back', (SPAN_C, NICH_Y, DEPTH + EW_T - 0.015), (NICH_W, NICH_H, 0.03), 'plaster', 0)
L.box('end-niche-interior', (SPAN_C, NICH_Y, DEPTH + (EW_T - 0.03) / 2), (NICH_W, NICH_H, EW_T - 0.03), 'inner', 0)
L.box('end-plinth', (SPAN_C, 0.3, DEPTH - 0.02), (SPAN_W - 0.1, 0.6, 0.05), 'brick', 0.004)
quad('end-coping-a', [
    (SPAN_C + SPAN_W / 2, END_H + 0.02, DEPTH + 0.18), (SPAN_C, END_H + 0.14, DEPTH + 0.18),
    (SPAN_C, END_H + 0.14, DEPTH), (SPAN_C + SPAN_W / 2, END_H + 0.02, DEPTH),
], 'roof', uv=[(0, 0), (1.4, 0), (1.4, 0.14 / 1.44), (0, 0.14 / 1.44)])
quad('end-coping-b', [
    (SPAN_C, END_H + 0.14, DEPTH + 0.18), (SPAN_C - SPAN_W / 2, END_H + 0.02, DEPTH + 0.18),
    (SPAN_C - SPAN_W / 2, END_H + 0.02, DEPTH), (SPAN_C, END_H + 0.14, DEPTH),
], 'roof', uv=[(0, 0), (1.4, 0), (1.4, 0.14 / 1.44), (0, 0.14 / 1.44)])
# corner caps at the two end-wall junctions (reusable module 3)
corner_cap(L, W_X, DEPTH, +1, wall_h=WALL_H, depth_sign=+1, name='corner-w')
corner_cap(L, E_X, DEPTH, -1, wall_h=WALL_H, depth_sign=+1, name='corner-e')

# ---------------------------------------------------------------- finalize
design = {
    'family': 'lane-a-module',
    'sampleId': 'lane-a',
    'basedOn': 'lanes-v2 batch DESIGN_SPEC.targets.laneA + placement.json (design inference, not survey)',
    'localFrame': 'origin=portal centre on removed seal wall mid-plane at floor y=0.09; +Z inward(0.0251,0,-0.9997) world north; +X west side',
    'worldPlacement': {'portalCenterGlb': [43.545, 0.09, -16.375], 'rotationYRad': 3.1165},
    'designDepthM': 8.0, 'designClearWidthM': 2.2,
    'portalClearHeightM': 2.3, 'portalOverallHeightM': 2.65,
    'wallHeightM': 3.3, 'endWallHeightM': 3.5,
    'highWindowRhythms': ['east 3x @2.0m w0.9', 'west 4x @1.33m w0.6'],
    'rearServiceDoor': 'west s=4.9, closed, recess 0.25 (reusable module)',
    'reusableModules': ['rear-service-door-panel', 'high-window-panel', 'corner-cap-plinth'],
    'newTextures': 0,
    'budgetTris': 30000,
}
a.out.mkdir(parents=True, exist_ok=True)
tris, bytes_ = L.finalize('lane-a', a.out, design)
print(f'LANE_A_READY tris={tris} bytes={bytes_}')
assert tris <= 30000, f'new placed triangles {tris} > 30000 budget'
assert bytes_ <= 6_000_000, f'module bytes {bytes_} > 6MB budget'
print('BUDGET_OK')
