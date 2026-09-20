"""Lane B module builder v3 (lane-b-polish batch) — the repair + close-range
polish candidate, replacing the lanes-v2 lane-b-v2 asset in a NEW dataset
directory (world/lane-b-polish/lane-b); the v5/v6 asset stays untouched.

Local frame and world placement are IDENTICAL to v2 (origin = portal centre at
floor y=0.09 world; +Z inward; holder T=[57.418,0.09,14.2485] yaw -0.4818),
so the runtime production transform (src/world/collisionAdapter.js) carries
over unchanged.

What changed vs v2 (SPEC control/SPEC.md task 1 + 2, frozen 2026-09-20):
  1. funnel closure: the v2 floor funnel (mouth 1.62 -> pocket 3.6) had NO
     walls along its splaying edges for s 0..2.5 (east) / 0..3.5 (west) — the
     S05/S07 neighbour walls stop at the portal line, so the widening zone
     was an open fallable void.  v3 adds two plaster funnel walls hugging the
     floor edge from the portal piers to the side-facade / pocket-wall starts
     (brick plinth + tile cap, same language), and the floor polygon now
     runs out to the wall faces (mouth 1.62 preserved, pocket 3.6 preserved).
  2. windows are REAL recesses: east facade and back facade walls are
     partitioned around each opening (reveal faces are the segments' own
     faces), closed glass sits at the back of the recess, timber ring frame
     + stone sill stay proud at the face; the v2 solid dark boxes buried in
     the wall are gone.  Positions/sizes/shutter pairs unchanged.
  3. side door (s=3.1): the v2 solid paste-box is rebuilt as a ring door
     surround — wall partition around the opening, 0.07 m recess (0.05 back
     kept), closed panel at the back, timber ring at the mouth, stone
     threshold, brick return at the foot.
  4. rear service door (s=7.3): ring-built niche kept verbatim (only the
     mouth foot gets a brick return); window-b recess starts at the niche
     pier face where the wall is deep.
  5. thresholds / drain rails capped at floor + 0.02 (v2 portal threshold
     top was floor + 0.06 — a real bump); surface-step contract <= 0.02 m.
  6. clothesline raised +0.18 m (2.55/2.50 -> 2.73/2.68): the cloth bottoms
     measured 2.12 m, intruding the 2.2 m clearance; now 2.21 m minimum.
  7. plaster material instance normal strength 0.65 -> 0.35 (this module
     only); no wall-scale micro-bevels; bevels kept on sills/thresholds/
     jambs only.  Target <= 4500 placed triangles (v2 was 8044).

Frozen (SPEC): depth 10 m, pocket 3.6 m, portal clear 1.5 m x 2.3 m, two
shutter windows east (s 4.6 / 8.3), two back windows (lx -0.9 / +0.9), side
door s 3.1 closed, rear service door s 7.3 closed, clothesline + 2 cloths,
conduit + clips, downpipe + clamps + shoe, corner caps, pent roof east,
coping profile.  Zero new textures.

Run: blender -b --factory-startup -t 4 -P kit/build_lane_b_v3.py -- --out world/lane-b-polish/lane-b
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

argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--out', type=Path, required=True)
a = p.parse_args(argv)

L.reset_scene()
L.build_materials()
L.GROUP = 'lanes-v2'

# plaster normal strength: calmer large planes on this module's own instance
for nd in L.M['plaster'].node_tree.nodes:
    if nd.type == 'NORMAL_MAP':
        nd.inputs['Strength'].default_value = 0.35

# ---- frozen dimensions --------------------------------------------------------
DEPTH = 10.0            # module depth (portal wall inner face s=0 .. back)
POCKET_W = 3.6          # clear pocket width
MOUTH_HW = 0.81         # floor mouth half-width at s=0 (funnel 1.62)
WALL_E_X = 1.80         # east facade inner face (side-facade from s=2.5)
WALL_W_X = -1.80        # west pocket wall inner face (from s=3.5)
WALL_T = 0.12           # thin wall thickness (facade + funnel + back)
E_S0, E_S1 = 2.5, 10.0  # east facade run
W_S0, W_S1 = 3.5, 10.0  # west pocket wall run
E_H, W_H = 4.8, 3.6     # east facade / west pocket wall heights
F_H, B_H = 3.3, 3.6     # funnel wall heights (east meets facade step, west matches pocket)
BACK_S = 10.0           # back facade inner face
BACK_H = 6.2
PORTAL_H, PORTAL_TOP = 2.3, 2.65
TH_TOP = 0.02           # threshold/rail cap: floor + 0.02 (surface contract)
REC = 0.07              # window/door recess depth in 0.12 walls (0.05 back kept)
YAW, T0 = -0.4818, [57.418, 0.09, 14.2485]

# openings (positions frozen from v2)
WIN_E1 = dict(s=4.6, w=1.0, y0=1.9, y1=3.3)      # east facade shutter window
WIN_E2 = dict(s=8.3, w=0.8, y0=2.55, y1=3.65)    # east facade small window
DOOR_E = dict(s=3.1, w=1.0, h=2.05)              # east side door (closed)
SVC = dict(s=7.3, w=1.0, h=2.05, bay=1.7)        # rear service door niche
WIN_B1 = dict(x=-0.9, w=1.1, y0=2.85, y1=4.35)   # back facade windows
WIN_B2 = dict(x=0.9, w=0.9, y0=4.7, y1=5.9)


def box(name, c, s, m='wood', bevel=.008, collision=False):
    return L.box(name, c, s, m, bevel, collision)


def quad(name, pts, m, uv=None):
    verts = [tuple(pt) for pt in pts]
    uvs = uv or [(0, 0), (1, 0), (1, 1), (0, 1)]
    return L.mesh(name, verts, [(0, 1, 2, 3)], m, uvs)


def prism(name, p0, p1, n, t, y0, y1, m):
    """Wall slab between face line p0->p1 ((lx, ls) pairs), thickness t toward
    normal n (unit, pointing OUT of the lane); local x = p0->p1, y = up."""
    dx, dz = p1[0] + n[0] * t - p0[0], p1[1] + n[1] * t - p0[1]
    v = [(p0[0], y0, p0[1]), (p1[0], y0, p1[1]), (p1[0], y1, p1[1]), (p0[0], y1, p0[1]),
         (p0[0] + n[0] * t, y0, p0[1] + n[1] * t), (p1[0] + n[0] * t, y0, p1[1] + n[1] * t),
         (p1[0] + n[0] * t, y1, p1[1] + n[1] * t), (p0[0] + n[0] * t, y1, p0[1] + n[1] * t)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 4, 7, 3), (1, 2, 6, 5), (0, 1, 5, 4), (3, 7, 6, 2)]
    return L.mesh(name, v, faces, m)


def partition(a0, a1, y_top, openings):
    """Split the (a, y) wall plane into kept rectangles around openings
    [(a_lo, a_hi, y_lo, y_hi)]; greedy horizontal + vertical merge. Same
    method as the proven lane-a v2 builder."""
    cuts = {a0, a1}
    for lo, hi, _, _ in openings:
        cuts.update((lo, hi))
    a_cuts = sorted(c for c in cuts if a0 - 1e-9 <= c <= a1 + 1e-9)
    y_cuts = sorted({0.0, y_top} | {y for o in openings for y in (o[2], o[3])})
    bands = list(zip(a_cuts[:-1], a_cuts[1:]))
    rows = list(zip(y_cuts[:-1], y_cuts[1:]))
    kept = {}
    for ri, (ylo, yhi) in enumerate(rows):
        run = None
        for clo, chi in bands:
            open_here = any(lo - 1e-9 <= clo and chi <= hi + 1e-9 and
                            ylo >= ylo_o - 1e-9 and yhi <= yhi_o + 1e-9
                            for lo, hi, ylo_o, yhi_o in openings)
            if open_here:
                if run:
                    kept.setdefault(ri, []).append(run)
                    run = None
                continue
            if run and abs(run[1] - clo) < 1e-9 and run[3] == ri:
                run = (run[0], chi, ylo, yhi)
            else:
                if run:
                    kept.setdefault(ri, []).append(run)
                run = (clo, chi, ylo, yhi)
        if run:
            kept.setdefault(ri, []).append(run)
    rects = []
    for ri in sorted(kept):
        for r in kept[ri]:
            for g in rects:
                if abs(g[0] - r[0]) < 1e-9 and abs(g[1] - r[1]) < 1e-9 and abs(g[3] - r[2]) < 1e-9:
                    g[3] = r[3]
                    r = None
                    break
            if r:
                rects.append(list(r))
    return [tuple(r) for r in rects]


# ---------------------------------------------------------------- floor (envelope to the wall faces)
# east edge: 0.81 @0 -> 1.80 @2.5 (funnel wall face) -> 1.80 @10 (facade face)
# west edge: -0.81 @0 -> -1.80 @3.5 (funnel wall face) -> -1.80 @10 (pocket wall)
FLOOR_V = [(MOUTH_HW, 0.0), (WALL_E_X, 2.5), (WALL_E_X, DEPTH),
           (WALL_W_X, DEPTH), (WALL_W_X, 3.5), (-MOUTH_HW, 0.0)]
ftri = [(5, 0, 1), (5, 1, 4), (4, 1, 2), (4, 2, 3)]
fuv = [((v[0]) / 2.4, v[1] / 2.4) for v in FLOOR_V]
L.mesh('floor', [(x, 0.0, s) for (x, s) in FLOOR_V], ftri, 'paving', fuv)

# ---------------------------------------------------------------- portal wall (frozen N5 assembly, threshold fixed)
box('portal-pier-left', (-0.925, 2.65 / 2, -0.06), (0.35, 2.65, 0.12), 'plaster', 0.006, True)
box('portal-pier-right', (0.925, 2.65 / 2, -0.06), (0.35, 2.65, 0.12), 'plaster', 0.006, True)
box('portal-lintel', (0.0, (PORTAL_H + PORTAL_TOP) / 2, -0.06), (1.5, PORTAL_TOP - PORTAL_H, 0.12), 'plaster', 0.006)
box('portal-lintel-timber', (0.0, PORTAL_H + 0.07, -0.05), (1.66, 0.14, 0.2), 'wood', 0.006)
# jamb reveals flush with the pier inner faces (portal clear stays 1.5 x 2.3)
for sx in (-0.775, 0.775):
    box('portal-reveal', (sx, PORTAL_H / 2, -0.06), (0.05, PORTAL_H, 0.13), 'plaster', 0)
# threshold top capped at floor + 0.018 (v2 was +0.06 — a real walk bump; the
# 0.018 keeps both seams (apron 0.088 -> threshold -> floor 0.09) <= 0.02)
box('portal-threshold', (0.0, 0.018 / 2, -0.05), (1.5, 0.018, 0.16), 'stone', 0.006)
for nm, c, s in [
    ('drain-frame-rail-n', (0.0, 0.005, 0.315), (0.72, 0.03, 0.05)),
    ('drain-frame-rail-s', (0.0, 0.005, 0.525), (0.72, 0.03, 0.05)),
    ('drain-frame-rail-w', (-0.335, 0.005, 0.42), (0.05, 0.03, 0.16)),
    ('drain-frame-rail-e', (0.335, 0.005, 0.42), (0.05, 0.03, 0.16)),
]:
    box(nm, c, s, 'stone', 0)
box('drain-grate', (0.0, -0.004, 0.42), (0.6, 0.02, 0.16), 'iron', 0)

# ---------------------------------------------------------------- funnel walls (closure of the widening zone)
# east: face (0.81, 0) -> (1.80, 2.5), body outboard (+lx), h 3.3 -> meets facade
fe_d = (1.80 - 0.81, 2.5 - 0.0)
fe_len = math.hypot(*fe_d)
fe_u = (fe_d[0] / fe_len, fe_d[1] / fe_len)
fe_n = (fe_u[1], -fe_u[0])          # perpendicular with +lx component (outboard)
assert fe_n[0] > 0
prism('funnel-e', (0.81, 0.0), (1.80, 2.5), fe_n, WALL_T, 0.0, F_H, 'plaster')
prism('funnel-e-plinth', (0.81, 0.0), (1.80, 2.5), fe_n, WALL_T + 0.05, 0.0, 0.6, 'brick')
prism('funnel-e-cap', (0.81 - 0.03 * fe_u[0], -0.03 * fe_u[1]), (1.80 + 0.03 * fe_u[0], 2.5 + 0.03 * fe_u[1]),
      fe_n, WALL_T + 0.06, F_H, F_H + 0.10, 'roof')
# west: face (-0.81, 0) -> (-1.80, 3.5), body outboard (-lx), h 3.6 matches pocket wall
fw_d = (-1.80 + 0.81, 3.5 - 0.0)
fw_len = math.hypot(*fw_d)
fw_u = (fw_d[0] / fw_len, fw_d[1] / fw_len)
fw_n = (-fw_u[1], fw_u[0])          # perpendicular with -lx component (outboard)
assert fw_n[0] < 0
prism('funnel-w', (-0.81, 0.0), (-1.80, 3.5), fw_n, WALL_T, 0.0, W_H, 'plaster')
prism('funnel-w-plinth', (-0.81, 0.0), (-1.80, 3.5), fw_n, WALL_T + 0.05, 0.0, 0.6, 'brick')
prism('funnel-w-cap', (-0.81 - 0.03 * fw_u[0], -0.03 * fw_u[1]), (-1.80 + 0.03 * fw_u[0], 3.5 + 0.03 * fw_u[1]),
      fw_n, WALL_T + 0.06, W_H, W_H + 0.10, 'roof')
# foot returns into the portal piers (wall-foot junction closes)
box('funnel-e-return', (0.90, 0.3, -0.02), (0.20, 0.6, 0.10), 'brick', 0)
box('funnel-w-return', (-0.90, 0.3, -0.02), (0.20, 0.6, 0.10), 'brick', 0)

# ---------------------------------------------------------------- east facade (real openings, s 2.5..10, h 4.8)
# the rear-service-door niche bay (s 6.45..8.15) is covered by the component;
# facade segments partition the rest around the side door + two windows
op_e1 = [
    (DOOR_E['s'] - DOOR_E['w'] / 2, DOOR_E['s'] + DOOR_E['w'] / 2, 0.0, DOOR_E['h']),
    (WIN_E1['s'] - WIN_E1['w'] / 2, WIN_E1['s'] + WIN_E1['w'] / 2, WIN_E1['y0'], WIN_E1['y1']),
]
for (slo, shi, ylo, yhi) in partition(E_S0, SVC['s'] - SVC['bay'] / 2, E_H, op_e1):
    box('facade-e', (WALL_E_X + WALL_T / 2, (ylo + yhi) / 2, (slo + shi) / 2),
        (WALL_T, yhi - ylo, shi - slo), 'plaster', 0)
op_e2 = [(WIN_E2['s'] - WIN_E2['w'] / 2, WIN_E2['s'] + WIN_E2['w'] / 2, WIN_E2['y0'], WIN_E2['y1'])]
for (slo, shi, ylo, yhi) in partition(SVC['s'] + SVC['bay'] / 2, E_S1, E_H, op_e2):
    box('facade-e', (WALL_E_X + WALL_T / 2, (ylo + yhi) / 2, (slo + shi) / 2),
        (WALL_T, yhi - ylo, shi - slo), 'plaster', 0)


def recessed_window(name, face_x, side, s, y0, y1, w, s_lo_clip=None):
    """Real recess in a 0.12 wall: rear-set closed glass, timber ring frame
    proud at the face, stone sill, folded shutter pair (closed). Reveal faces
    come from the wall segments. side=+1 wall occupies x>face (east facade),
    -1 wall occupies x<face (back facade, recess along +s handled by caller)."""
    s_hi = s + w / 2
    s_lo = max(s - w / 2, s_lo_clip) if s_lo_clip is not None else s - w / 2
    x_back = face_x + side * REC          # recess back plane
    x_glass = face_x + side * (REC - 0.012)
    box(f'{name}-back', ((x_back + face_x + side * WALL_T) / 2, (y0 + y1) / 2, (s_lo + s_hi) / 2),
        (WALL_T - REC, y1 - y0, s_hi - s_lo), 'inner', 0)
    box(f'{name}-glass', (x_glass, (y0 + y1) / 2, (s_lo + s_hi) / 2),
        (0.024, y1 - y0 - 0.14, (s_hi - s_lo) - 0.14), 'glass', 0)
    for ds in (s_lo + 0.01, s_hi - 0.01):
        box(f'{name}-stile', (face_x + side * 0.012, (y0 + y1) / 2, ds), (0.11, y1 - y0 + 0.12, 0.07), 'wood', 0)
    for dy in (y0, y1):
        box(f'{name}-rail', (face_x + side * 0.018, dy, (s_lo + s_hi) / 2), (0.11, 0.07, (s_hi - s_lo) + 0.06), 'wood', 0)
    box(f'{name}-sill', (face_x - side * 0.07, y0 - 0.07, (s_lo + s_hi) / 2), (0.24, 0.1, (s_hi - s_lo) + 0.22), 'stone', 0.008)
    for ds in (s - w * 0.22, s + w * 0.16):
        box(f'{name}-shutter', (face_x - side * 0.022, (y0 + y1) / 2, ds),
            (0.045, (y1 - y0) * 0.92, w * 0.38), 'wood', 0)


recessed_window('win-e1', WALL_E_X, +1, WIN_E1['s'], WIN_E1['y0'], WIN_E1['y1'], WIN_E1['w'])
# window-b: its south quarter opens against the service-door niche pier (deep
# wall), so the recess/glass run from the pier face north; frame + shutters
# keep the full original width at the face plane
PIER_N = SVC['s'] + SVC['bay'] / 2                       # niche north pier face 8.15
E2_HI = WIN_E2['s'] + WIN_E2['w'] / 2                    # window north edge 8.7
recessed_window('win-e2', WALL_E_X, +1, (PIER_N + E2_HI) / 2, WIN_E2['y0'], WIN_E2['y1'],
                E2_HI - PIER_N, s_lo_clip=PIER_N)

# side door (s=3.1): ring door surround — recess + rear-set closed panel
D_LO, D_HI = DOOR_E['s'] - DOOR_E['w'] / 2, DOOR_E['s'] + DOOR_E['w'] / 2
box('side-door-back', (WALL_E_X + REC + (WALL_T - REC) / 2, DOOR_E['h'] / 2, DOOR_E['s']),
    (WALL_T - REC, DOOR_E['h'], DOOR_E['w']), 'inner', 0)
box('side-door-panel', (WALL_E_X + REC - 0.0275, DOOR_E['h'] / 2, DOOR_E['s']),
    (0.055, DOOR_E['h'], DOOR_E['w']), 'dark', 0)
for sgn in (-1, 1):
    box('side-door-jamb', (WALL_E_X + 0.012, DOOR_E['h'] / 2, DOOR_E['s'] + sgn * (DOOR_E['w'] / 2 + 0.045)),
        (0.08, DOOR_E['h'] + 0.08, 0.07), 'wood', 0)
box('side-door-lintel', (WALL_E_X + 0.012, DOOR_E['h'] + 0.04, DOOR_E['s']),
    (0.08, 0.08, DOOR_E['w'] + 0.18), 'wood', 0)
box('side-door-threshold', (WALL_E_X - 0.03, TH_TOP / 2, DOOR_E['s']),
    (0.16, TH_TOP, DOOR_E['w'] + 0.16), 'stone', 0.008)
for sgn in (-1, 1):   # wall-foot brick returns into the reveals
    box('side-door-brick-return', (WALL_E_X + REC / 2 + 0.02, 0.28, DOOR_E['s'] + sgn * (DOOR_E['w'] / 2 + 0.025)),
        (REC + 0.04, 0.56, 0.05), 'brick', 0)

# rear service door niche (ring-built component, verbatim) + foot return
rear_service_door(L, +1, WALL_E_X, SVC['s'], w=SVC['w'], h=SVC['h'], recess=0.25, bay_len=SVC['bay'], wall_h=E_H)
for sgn in (-1, 1):
    box('svc-door-brick-return', (WALL_E_X + 0.02, 0.28, SVC['s'] + sgn * (SVC['w'] / 2 + 0.025)),
        (0.05, 0.56, 0.05), 'brick', 0)

# facade plinth + coping (continuous over segments and the niche bay)
box('facade-e-plinth', (WALL_E_X + WALL_T / 2 + 0.025, 0.3, (E_S0 + E_S1) / 2), (0.05, 0.6, E_S1 - E_S0), 'brick', 0)
box('facade-e-coping', (WALL_E_X + WALL_T / 2 + 0.02, E_H + 0.06, (E_S0 + E_S1) / 2), (0.26, 0.12, E_S1 - E_S0 + 0.1), 'roof', 0)
# pent roof over the east facade (frozen v2 slope) + eaves closure
quad('side-roof', [(1.92, 4.8, 2.4), (1.92, 4.8, 10.1), (2.34, 5.15, 10.1), (2.34, 5.15, 2.4)],
     'roof', uv=[(0, 0), (3.2, 0), (3.2, 0.4), (0, 0.4)])
box('side-roof-fascia', (1.94, 4.8 - 0.095, (2.4 + 10.1) / 2), (0.05, 0.19, 7.7), 'dark', 0)
# end closures under the roof start/finish (eaves close, no open wedge)
box('side-roof-end-close-n', (2.13, (4.8 + 5.15) / 2 - 0.09, 2.42), (0.44, 0.36, 0.04), 'dark', 0)
box('side-roof-end-close-s', (2.13, (4.8 + 5.15) / 2 - 0.09, 10.08), (0.44, 0.36, 0.04), 'dark', 0)
# local eave-height end cap where the funnel wall (h 3.3) meets the facade (h 4.8)
box('facade-e-endcap', (WALL_E_X + WALL_T / 2, F_H + 0.05, E_S0 - 0.02), (0.30, 0.10, 0.10), 'roof', 0)
box('funnel-e-cap-end', (WALL_E_X + 0.06, F_H + 0.06, E_S0 + 0.02), (0.3, 0.12, 0.08), 'roof', 0)

# ---------------------------------------------------------------- west pocket wall (s 3.5..10, h 3.6)
box('pocket-wall-left', (WALL_W_X - WALL_T / 2, W_H / 2, (W_S0 + W_S1) / 2), (WALL_T, W_H, W_S1 - W_S0), 'plaster', 0, True)
box('pocket-wall-left-plinth', (WALL_W_X - WALL_T / 2 - 0.025, 0.3, (W_S0 + W_S1) / 2), (0.05, 0.6, W_S1 - W_S0 + 0.04), 'brick', 0)
box('pocket-wall-left-coping', (WALL_W_X - WALL_T / 2 - 0.02, W_H + 0.06, (W_S0 + W_S1) / 2), (0.26, 0.12, W_S1 - W_S0 + 0.1), 'roof', 0)
# coping cap closes the funnel-wall / pocket-wall joint (same tile language)
box('funnel-w-joint-cap', (WALL_W_X - WALL_T / 2 - 0.02, W_H + 0.06, W_S0), (0.30, 0.12, 0.16), 'roof', 0)

# ---------------------------------------------------------------- back facade (s=10.0, w 3.6, h 6.2, real recesses)
op_b = [
    (WIN_B1['x'] - WIN_B1['w'] / 2, WIN_B1['x'] + WIN_B1['w'] / 2, WIN_B1['y0'], WIN_B1['y1']),
    (WIN_B2['x'] - WIN_B2['w'] / 2, WIN_B2['x'] + WIN_B2['w'] / 2, WIN_B2['y0'], WIN_B2['y1']),
]
for (xlo, xhi, ylo, yhi) in partition(-POCKET_W / 2, POCKET_W / 2, BACK_H, op_b):
    box('back-facade', ((xlo + xhi) / 2, (ylo + yhi) / 2, BACK_S + WALL_T / 2),
        (xhi - xlo, yhi - ylo, WALL_T), 'plaster', 0)
for nm, win in (('win-b1', WIN_B1), ('win-b2', WIN_B2)):
    box(f'{nm}-back', (win['x'], (win['y0'] + win['y1']) / 2, BACK_S + REC + (WALL_T - REC) / 2),
        (win['w'], win['y1'] - win['y0'], WALL_T - REC), 'inner', 0)
    box(f'{nm}-glass', (win['x'], (win['y0'] + win['y1']) / 2, BACK_S + REC - 0.012),
        (win['w'] - 0.14, win['y1'] - win['y0'] - 0.14, 0.024), 'glass', 0)
    for dx in (win['x'] - win['w'] / 2 + 0.01, win['x'] + win['w'] / 2 - 0.01):
        box(f'{nm}-stile', (dx, (win['y0'] + win['y1']) / 2, BACK_S - 0.012), (0.07, win['y1'] - win['y0'] + 0.12, 0.11), 'wood', 0)
    for dy in (win['y0'], win['y1']):
        box(f'{nm}-rail', (win['x'], dy, BACK_S - 0.018), (win['w'] + 0.06, 0.07, 0.11), 'wood', 0)
    box(f'{nm}-sill', (win['x'], win['y0'] - 0.07, BACK_S - 0.07), (win['w'] + 0.22, 0.1, 0.24), 'stone', 0.008)
    for dx in (win['x'] - win['w'] * 0.22, win['x'] + win['w'] * 0.16):
        box(f'{nm}-shutter', (dx, (win['y0'] + win['y1']) / 2, BACK_S - 0.022),
            (win['w'] * 0.38, (win['y1'] - win['y0']) * 0.92, 0.045), 'wood', 0)
box('back-plinth', (0.0, 0.3, BACK_S - 0.02), (POCKET_W + 0.04, 0.6, 0.05), 'brick', 0)
quad('back-roof', [(-1.95, 6.2, 10.16), (1.95, 6.2, 10.16), (1.95, 6.75, 11.0), (-1.95, 6.75, 11.0)],
     'roof', uv=[(0, 0), (1.6, 0), (1.6, 0.7), (0, 0.7)])
quad('back-roof-soffit', [(-1.95, 6.19, 10.16), (1.95, 6.19, 10.16), (1.95, 6.19, 9.8), (-1.95, 6.19, 9.8)],
     'wood', uv=[(0, 0), (1.6, 0), (1.6, 0.3), (0, 0.3)])
# corner caps at the pocket rear (frozen component)
corner_cap(L, WALL_W_X, 10.0, -1, wall_h=W_H, depth_sign=+1, name='corner-w')
corner_cap(L, WALL_E_X, 10.0, +1, wall_h=E_H, depth_sign=+1, name='corner-e')

# ---------------------------------------------------------------- detail groups (frozen N5 set)
# 1) wall-fixed downpipe with clamps + drain shoe (back facade, left corner)
px, pz = -1.66, 9.94
L.cyl('downpipe', (px, 0.06, pz), (px, 4.62, pz), 0.045, 'iron', 8)
for hy in (0.9, 2.4, 3.9):
    box('downpipe-clamp', (px, hy, pz - 0.055), (0.05, 0.06, 0.11), 'iron', 0)
L.cyl('downpipe-shoe', (px, 0.28, pz - 0.1), (px, 0.06, pz - 0.02), 0.05, 'iron', 8)

# 2) two restrained cloth pieces on a supported line; raised +0.18 m so the
#    cloth bottoms clear 2.2 m (v2 measured 2.12 m — intruding headroom)
line_a = mathutils.Vector((1.8, 2.73, 3.0))   # bracket on side facade
line_b = mathutils.Vector((0.86, 2.68, -0.02))  # hook on portal right pier
L.rod('clothesline', tuple(line_a), tuple(line_b), 0.012, 'iron')
box('line-bracket', (1.86, 2.73, 3.0), (0.1, 0.05, 0.05), 'iron', 0)
box('line-hook', (0.9, 2.68, -0.02), (0.05, 0.05, 0.06), 'iron', 0)
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

# 3) wall conduit run with clips (left pocket wall)
L.rod('conduit', (-1.79, 2.45, 3.6), (-1.79, 2.45, 9.6), 0.02, 'iron')
for cz in (3.8, 4.3, 4.8, 5.3, 7.6, 8.6, 9.4):
    box('conduit-clip', (-1.8, 2.45, cz), (0.03, 0.06, 0.03), 'iron', 0)

# ---------------------------------------------------------------- collision sidecar (world-space obb)
c_, s_ = math.cos(YAW), math.sin(YAW)


def to_world(cx, cyy, cz):
    return [T0[0] + c_ * cx + s_ * cz, T0[1] + cyy, T0[2] - s_ * cx + c_ * cz]


def aabb(center, size, theta=0.0):
    """World AABB of a module-local box, optionally rotated by theta (in the
    module frame) before the module placement transform."""
    ct, st = math.cos(theta), math.sin(theta)
    corners = []
    for dx in (-size[0] / 2, size[0] / 2):
        for dy in (-size[1] / 2, size[1] / 2):
            for dz in (-size[2] / 2, size[2] / 2):
                rx = center[0] + ct * dx + st * dz
                rz = center[2] - st * dx + ct * dz
                corners.append(to_world(rx, center[1] + dy, rz))
    mn = [min(pt[i] for pt in corners) for i in range(3)]
    mx = [max(pt[i] for pt in corners) for i in range(3)]
    return mn, mx


# module-local obb records; theta is IN ADDITION to the module yaw
local_records = [
    ('lane-b:portal-pier-left', (-0.925, 2.65 / 2, -0.06), (0.35, 2.65, 0.12), 0.0),
    ('lane-b:portal-pier-right', (0.925, 2.65 / 2, -0.06), (0.35, 2.65, 0.12), 0.0),
    ('lane-b:facade-east', (WALL_E_X + WALL_T / 2, E_H / 2, (E_S0 + E_S1) / 2), (WALL_T, E_H, E_S1 - E_S0), 0.0),
    ('lane-b:pocket-wall-west', (WALL_W_X - WALL_T / 2, W_H / 2, (W_S0 + W_S1) / 2), (WALL_T, W_H, W_S1 - W_S0), 0.0),
    ('lane-b:back-facade', (0.0, BACK_H / 2, BACK_S + WALL_T / 2), (POCKET_W, BACK_H, WALL_T), 0.0),
    # funnel walls: obb long axis along the wall run (module-local angle)
    ('lane-b:funnel-east', ((0.81 + 1.80) / 2 + fe_n[0] * WALL_T / 2, F_H / 2, (0.0 + 2.5) / 2 + fe_n[1] * WALL_T / 2),
     (WALL_T, F_H, fe_len), math.atan2(fe_d[0], fe_d[1])),
    ('lane-b:funnel-west', ((-0.81 - 1.80) / 2 + fw_n[0] * WALL_T / 2, W_H / 2, (0.0 + 3.5) / 2 + fw_n[1] * WALL_T / 2),
     (WALL_T, W_H, fw_len), math.atan2(fw_d[0], fw_d[1])),
]
colliders = []
for name, cen, size, th in local_records:
    mn, mx = aabb(cen, size, th)
    # obbToWorld applies ONE rotation by theta to the center: for a slanted
    # wall (th != 0) the module-local center must first be rotated by -th so
    # the box lands at the wall position while its axes stay wall-aligned
    if th != 0.0:
        ct, st = math.cos(-th), math.sin(-th)
        obb_center = [ct * cen[0] + st * cen[2], cen[1], -st * cen[0] + ct * cen[2]]
    else:
        obb_center = list(cen)
    colliders.append({'name': name, 'module': 'lane-b', 'type': 'box', 'min': mn, 'max': mx,
                      'obb': {'pos': list(T0), 'theta': YAW + th, 'center': obb_center, 'size': list(size)}})

# ---------------------------------------------------------------- finalize
design = {
    'family': 'lane-b-module-polish',
    'sampleId': 'lane-b-v3',
    'basedOn': 'kit/build_lane_b_v2.py geometry contract + lane-b-polish work order (SPEC 2026-09-20); mouth lines verified by tools/lane_b_polish_measure.py',
    'localFrame': 'origin=portal centre on the old seal wall inner face at floor y=0.09; +Z inward; +X right (production obbToWorld places it)',
    'worldPlacement': {'portalCenterGlb': list(T0), 'rotationYRad': YAW},
    'portalClearWidthM': 1.5, 'portalClearHeightM': 2.3, 'portalOverallHeightM': 2.65,
    'depthM': DEPTH, 'pocketWidthM': POCKET_W,
    'facadeHeightsM': [BACK_H, E_H],
    'changesVsV2': [
        'funnel walls close the widening zone to the side-facade / pocket-wall starts; floor runs to the wall faces (mouth 1.62 kept)',
        'windows/doors rebuilt as real recesses: wall partitioned around openings, rear-set closed glass/panel, ring frames, sills (no buried solid boxes)',
        'side door s=3.1 ring door surround; rear service door niche kept, foot brick returns added',
        'portal threshold + inset drain rails capped at floor+0.02 (v2 threshold was +0.06)',
        'clothesline raised +0.18 m: cloth bottoms 2.21/2.28 m >= 2.2 m clearance (v2 measured 2.12 m)',
        'plaster normal strength 0.65 -> 0.35 (this module instance); no wall-scale bevels',
        'eaves closure: pent-roof fascia + end closures; local eave-height end caps at the funnel/facade and funnel/pocket joints',
    ],
    'reusedComponents': ['portal assembly', 'threshold + inset drain', 'clothesline + cloth', 'conduit + clips',
                         'downpipe + clamps + shoe', 'rear-service-door-panel', 'corner-cap-plinth'],
    'groundNodeNames': ['lanes-v2__paving-frontage', 'lanes-v2__worn-stone'],
    'newTextures': 0,
    'budgetTris': 4500,
}
a.out.mkdir(parents=True, exist_ok=True)
tris, bytes_ = L.finalize('lane-b-v3', a.out, design)
print(f'LANE_B_V3_READY tris={tris} bytes={bytes_}')
assert tris <= 4500, f'lane-b-v3 {tris} > 4500 budget'
(a.out / 'collision.json').write_text(json.dumps({
    'axis': 'glTF Y-up; world-space obb records (obb.pos = asset portal origin), consumed by blockViews.makeAssets',
    'assetId': 'lane-b',
    'origin': list(T0),
    'yawRad': YAW,
    'colliders': colliders,
    'doors': 'portal open (clear 1.5x2.3); east side door s=3.1 closed (ring surround, solid); rear service door s=7.3 closed (niche ring solid)',
    'notIntegratedOrWalkingTested': True,
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'COLLISION_READY records={len(colliders)}')
print('BUDGET_OK')
