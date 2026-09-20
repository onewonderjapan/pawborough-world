"""Lane A module builder v2 (lane-a-polish batch) — the polish candidate for
the 8 m service lane, replacing kit/build_lane_a.py output in a NEW dataset
directory (world/lane-a-polish/lane-a); the v5 asset stays untouched.

Local frame and placement are IDENTICAL to the v5 module (origin = portal
centre at floor y=0.09 world, +Z inward, +X west side; holder
T=[43.545,0.09,-16.375] yaw 3.1165), so collision semantics carry over.

What changed vs v5 (lead-frozen construct work order 2026-09-20):
  1. high windows are REAL recesses: the wall is partitioned into segments
     around each opening (the reveal faces are the segments' own faces), the
     closed glass sits at the BACK of the recess, timber frame + stone sill
     stay proud at the face.  The v5 solid dark box buried inside the wall is
     gone.  West wall (t=0.10) recess depth 0.08 never pierces the back face;
     east wall (t=0.24) depth 0.14 as before.
  2. rear service door keeps the ring-built niche (piers/head/backwall are
     now part of the same wall partition); refined: timber lintel at the
     mouth, stone threshold, brick base returns into the niche reveals.
  3. end wall blind niche reads as a real 0.13 m recess: four-side lining +
     back wall + closed timber frame ring; the v5 solid fill box is gone.
     Original size intent kept (0.7x1.0 m, centre y1.7).
  4. eaves: original grey-tile coping profile kept; a timber fascia band now
     closes under the eave line on both lane walls and the end wall.
  5. weathered-lime-plaster material instance for THIS module only: normal
     map strength 0.65 -> 0.35 (clearer large planes; shared assets untouched).
  6. no per-edge micro-bevels on wall-scale boxes (invisible); bevels kept
     only on close-range trim (sills, thresholds, jambs).  Target <= 4000
     placed triangles (v5 was 7290).

Zero new textures. Run:
  blender -b --factory-startup -t 4 -P kit/build_lane_a_v2.py -- --out world/lane-a-polish/lane-a
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

# plaster normal strength: calmer large planes on this module's own instance
for nd in L.M['plaster'].node_tree.nodes:
    if nd.type == 'NORMAL_MAP':
        nd.inputs['Strength'].default_value = 0.35

# ---- dimensions (unchanged design values) ------------------------------------
CLEAR_W = 2.2
W_X, E_X = 1.10, -1.10
W_T, E_T = 0.10, 0.24
DEPTH = 8.0
WALL_H = 3.3
END_H = 3.5
PORTAL_H = 2.3
PORTAL_TOP = 2.65
S0 = 0.06
SPAN_C, SPAN_W = (W_X + W_T + E_X - E_T) / 2, W_T + CLEAR_W + E_T
EW_T = 0.18
NICH_W, NICH_H, NICH_Y = 0.7, 1.0, 1.7
DOOR_S, BAY_LEN = 4.9, 1.7
DOOR_W, DOOR_H = 1.0, 2.05
BAY_S0, BAY_S1 = DOOR_S - BAY_LEN / 2, DOOR_S + BAY_LEN / 2      # 4.05 .. 5.75
BAY_X0, BAY_X1 = W_X, W_X + 0.37                                  # thickened wall
NICHE_BACK = W_X + 0.25                                           # door recess back plane
HIW_W_Y = (2.5, 3.1)                                              # west window band
HIW_E_Y = (2.35, 3.05)                                            # east window band
WIN_RECESS_W = min(0.14, W_T - 0.02)                              # 0.08
WIN_RECESS_E = min(0.14, E_T - 0.02)                              # 0.14
YAW, T0 = 3.1165, [43.545, 0.09, -16.375]


def quad(name, pts, m, uv=None):
    verts = [tuple(pt) for pt in pts]
    uvs = uv or [(0, 0), (1, 0), (1, 1), (0, 1)]
    return L.mesh(name, verts, [(0, 1, 2, 3)], m, uvs)


def box(name, c, s, m='wood', bevel=.008, collision=False):
    return L.box(name, c, s, m, bevel, collision)


# ---- wall partition: rectangles around real openings -------------------------
def partition(s0, s1, y_top, openings, bay=None):
    """Split the (s, y) wall plane into kept rectangles around openings
    [(s_lo, s_hi, y_lo, y_hi)].  Extra s-cuts (bay bounds) split thickness
    zones.  Returns kept rects; greedy merge keeps the box count low."""
    cuts = {s0, s1}
    for lo, hi, _, _ in openings:
        cuts.update((lo, hi))
    if bay:
        cuts.update(bay)
    s_cuts = sorted(c for c in cuts if s0 - 1e-9 <= c <= s1 + 1e-9)
    y_cuts = sorted({0.0, y_top} | {y for o in openings for y in (o[2], o[3])})
    bands = list(zip(s_cuts[:-1], s_cuts[1:]))
    rows = list(zip(y_cuts[:-1], y_cuts[1:]))
    kept = {}
    for ri, (ylo, yhi) in enumerate(rows):
        run = None
        for ci, (clo, chi) in enumerate(bands):
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
    # vertical merge: identical s-span across consecutive rows
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


def in_bay(s_mid):
    return BAY_S0 - 1e-9 <= s_mid <= BAY_S1 + 1e-9


# ---------------------------------------------------------------- floor (unchanged)
L.mesh('floor', [
    (E_X, 0.0, S0), (W_X, 0.0, S0), (W_X, 0.0, DEPTH), (E_X, 0.0, DEPTH),
], [(0, 1, 2, 3)], 'paving', [(0, 0), (2.2 / 2.4, 0), (2.2 / 2.4, DEPTH / 2.4), (0, DEPTH / 2.4)])
for nm, xf, sd in (('w', W_X, 1), ('e', E_X, -1)):
    L.mesh(f'drain-{nm}', [
        (xf - sd * 0.005, -0.02, S0), (xf - sd * 0.16, -0.02, S0),
        (xf - sd * 0.16, -0.02, DEPTH), (xf - sd * 0.005, -0.02, DEPTH),
    ], [(0, 1, 2, 3)], 'stone',
        [(0, 0), (0.16 / 1.2, 0), (0.16 / 1.2, DEPTH / 1.2), (0, DEPTH / 1.2)])

# ---------------------------------------------------------------- portal frame (unchanged positions)
box('portal-lintel', (SPAN_C, (PORTAL_H + PORTAL_TOP) / 2, 0.0), (SPAN_W, PORTAL_TOP - PORTAL_H, 0.3), 'plaster', 0)
box('portal-lintel-timber', (0.0, PORTAL_H + 0.07, -0.02), (CLEAR_W + 0.12, 0.14, 0.2), 'wood', 0)
box('portal-top-band', (SPAN_C, (PORTAL_TOP + WALL_H) / 2, 0.0), (SPAN_W, WALL_H - PORTAL_TOP, 0.12), 'plaster', 0)
# lead fix 2026-09-20: threshold top capped at floor+0.02 (was +0.04); the
# full-width stone outline stays, surface profile regression covers the seam
box('portal-threshold', (0.0, -0.005, 0.02), (CLEAR_W, 0.05, 0.22), 'stone', 0)
for xj in (W_X, E_X):
    sd = 1 if xj > 0 else -1
    box('portal-jamb-post', (xj - sd * 0.03, PORTAL_H / 2, -0.02), (0.14, PORTAL_H, 0.14), 'wood', 0)

# ---------------------------------------------------------------- west wall (real openings)
win_w = [  # (centre, width) — rhythm two, positions frozen from v5
    (1.4, 0.6), (2.73, 0.6), (4.07, 0.6), (5.4, 0.6),
]
openings_w = [(sc - w / 2, sc + w / 2, *HIW_W_Y) for sc, w in win_w]
openings_w.append((DOOR_S - DOOR_W / 2, DOOR_S + DOOR_W / 2, 0.0, DOOR_H))  # door void
rects_w = partition(S0, DEPTH, WALL_H, openings_w, bay=(BAY_S0, BAY_S1))
for (slo, shi, ylo, yhi) in rects_w:
    sm = (slo + shi) / 2
    x_out = BAY_X1 if in_bay((slo + shi) / 2) else W_X + W_T
    box('wall-w', (W_X + (x_out - W_X) / 2, (ylo + yhi) / 2, sm),
        (x_out - W_X, yhi - ylo, shi - slo), 'plaster', 0)
# door niche backwall (ring-built bay: back plane behind the recess only)
box('rear-door-backwall', ((NICHE_BACK + BAY_X1) / 2, DOOR_H / 2, DOOR_S),
    (BAY_X1 - NICHE_BACK, DOOR_H, DOOR_W), 'plaster', 0)
# window recess back-fill keeps the shell watertight behind the glass
for sc, w in win_w:
    x_out = BAY_X1 if in_bay(sc) else W_X + W_T
    box('win-w-back', (W_X + WIN_RECESS_W + (x_out - W_X - WIN_RECESS_W) / 2, (HIW_W_Y[0] + HIW_W_Y[1]) / 2, sc),
        (x_out - W_X - WIN_RECESS_W, HIW_W_Y[1] - HIW_W_Y[0], w), 'plaster', 0)

# ---------------------------------------------------------------- east wall (real openings)
win_e = [(1.8, 0.9), (3.8, 0.9), (5.8, 0.9)]  # rhythm one, positions frozen
openings_e = [(sc - w / 2, sc + w / 2, *HIW_E_Y) for sc, w in win_e]
for (slo, shi, ylo, yhi) in partition(S0, DEPTH, WALL_H, openings_e):
    box('wall-e', (E_X - E_T + E_T / 2, (ylo + yhi) / 2, (slo + shi) / 2),
        (E_T, yhi - ylo, shi - slo), 'plaster', 0)
for sc, w in win_e:
    box('win-e-back', (E_X - WIN_RECESS_E - (E_T - WIN_RECESS_E) / 2, (HIW_E_Y[0] + HIW_E_Y[1]) / 2, sc),
        (E_T - WIN_RECESS_E, HIW_E_Y[1] - HIW_E_Y[0], w), 'plaster', 0)


# ---------------------------------------------------------------- high windows (four-side reveal + rear-set glass)
def high_window_recessed(side, x_face, s, y0, y1, w, d, wall_t):
    """Real recess: reveal faces come from the wall segments; closed glass at
    the back of the recess; timber frame + stone sill proud at the face."""
    xg = x_face + side * (d - 0.012)          # glass plane, fully inside the recess
    L.box(f'hiwin-glass', (xg, (y0 + y1) / 2, s), (0.024, y1 - y0 - 0.14, w - 0.14), 'glass', 0)
    for ds in (-w / 2, w / 2):
        L.box(f'hiwin-stile', (x_face + side * 0.012, (y0 + y1) / 2, s + ds),
              (0.11, y1 - y0 + 0.12, 0.07), 'wood', 0)
    for dy in (y0, y1):
        L.box(f'hiwin-rail', (x_face + side * 0.018, dy, s), (0.11, 0.07, w + 0.1), 'wood', 0)
    L.box(f'hiwin-sill', (x_face - side * 0.07, y0 - 0.07, s), (0.24, 0.1, w + 0.22), 'stone', 0.008)


for sc, w in win_w:
    high_window_recessed(+1, W_X, sc, *HIW_W_Y, w, WIN_RECESS_W, W_T)
for sc, w in win_e:
    high_window_recessed(-1, E_X, sc, *HIW_E_Y, w, WIN_RECESS_E, E_T)

# ---------------------------------------------------------------- rear service door (ring-built niche, refined)
x_mouth = W_X
box('rear-door-panel', (NICHE_BACK - 0.028, DOOR_H / 2, DOOR_S), (0.055, DOOR_H, DOOR_W), 'dark', 0)
for sgn in (-1, 1):
    box('rear-door-jamb', (x_mouth - 0.02, DOOR_H / 2, DOOR_S + sgn * (DOOR_W / 2 + 0.045)),
        (0.08, DOOR_H + 0.08, 0.07), 'wood', 0.006)
box('rear-door-lintel', (x_mouth - 0.02, DOOR_H + 0.04, DOOR_S), (0.08, 0.08, DOOR_W + 0.18), 'wood', 0.006)
box('rear-door-threshold', (x_mouth - 0.03, 0.02, DOOR_S), (0.16, 0.06, DOOR_W + 0.16), 'stone', 0.008)
# brick base returns into the niche reveals (wall-foot junction closes)
for sgn in (-1, 1):
    box('rear-door-brick-return', ((W_X + NICHE_BACK) / 2, 0.3, DOOR_S + sgn * (DOOR_W / 2 + 0.025)),
        (NICHE_BACK - W_X, 0.6, 0.05), 'brick', 0)

# ---------------------------------------------------------------- brick plinths + waist bands (unchanged pattern)
for (s0, s1) in ((S0, BAY_S0), (BAY_S1, DEPTH)):
    box(f'plinth-west', (W_X - 0.02, 0.3, (s0 + s1) / 2), (0.05, 0.6, s1 - s0), 'brick', 0)
    box(f'waist-west', (W_X - 0.015, 0.855, (s0 + s1) / 2), (0.04, 0.15, s1 - s0), 'wood', 0)
box('plinth-east', (E_X + 0.02, 0.3, (S0 + DEPTH) / 2), (0.05, 0.6, DEPTH - S0), 'brick', 0)
box('waist-east', (E_X + 0.015, 0.855, (S0 + DEPTH) / 2), (0.04, 0.15, DEPTH - S0), 'wood', 0)

# ---------------------------------------------------------------- coping (原灰瓦轮廓不变) + fascia
for nm, xf, t, sd in (('west', W_X, W_T, 1), ('east', E_X, E_T, -1)):
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
    # timber fascia closing under the eave line (封檐板, ~0.19 m, no clearance impact)
    box(f'fascia-{nm}', (xf - sd * 0.02, WALL_H - 0.095, (S0 + DEPTH) / 2),
        (0.07, 0.19, DEPTH - S0), 'wood', 0)
box('fascia-end', (SPAN_C, END_H - 0.095, DEPTH - 0.015), (SPAN_W, 0.19, 0.06), 'wood', 0)

# ---------------------------------------------------------------- end wall (real blind-niche recess)
side_w = (SPAN_W - NICH_W) / 2
for sgn in (-1, 1):
    box(f'end-band-{sgn}', (SPAN_C + sgn * (NICH_W / 2 + side_w / 2), END_H / 2, DEPTH + EW_T / 2),
        (side_w, END_H, EW_T), 'plaster', 0)
box('end-band-below', (SPAN_C, (NICH_Y - NICH_H / 2) / 2, DEPTH + EW_T / 2),
    (NICH_W, NICH_Y - NICH_H / 2, EW_T), 'plaster', 0)
box('end-band-above', (SPAN_C, (NICH_Y + NICH_H / 2 + END_H) / 2, DEPTH + EW_T / 2),
    (NICH_W, END_H - (NICH_Y + NICH_H / 2), EW_T), 'plaster', 0)
# niche: 0.13 m recess = four-side lining + back wall (v5 solid fill removed)
REC = 0.13
s_back0, s_back1 = DEPTH + REC, DEPTH + EW_T
L.box('end-niche-back', (SPAN_C, NICH_Y, (s_back0 + s_back1) / 2), (NICH_W + 0.04, NICH_H + 0.04, s_back1 - s_back0), 'inner', 0)
for sgn in (-1, 1):
    L.box('end-niche-lining-side', (SPAN_C + sgn * (NICH_W / 2 + 0.01), NICH_Y, DEPTH + REC / 2),
          (0.02, NICH_H, REC + 0.01), 'inner', 0)
L.box('end-niche-lining-top', (SPAN_C, NICH_Y + NICH_H / 2 + 0.01, DEPTH + REC / 2), (NICH_W + 0.04, 0.02, REC + 0.01), 'inner', 0)
L.box('end-niche-lining-bottom', (SPAN_C, NICH_Y - NICH_H / 2 - 0.01, DEPTH + REC / 2), (NICH_W + 0.04, 0.02, REC + 0.01), 'inner', 0)
# closed timber frame ring at the niche mouth (边框闭合)
for sgn in (-1, 1):
    box('end-niche-frame-side', (SPAN_C + sgn * (NICH_W / 2 - 0.02), NICH_Y, DEPTH - 0.015),
        (0.07, NICH_H + 0.14, 0.06), 'wood', 0.006)
for sgn in (-1, 1):
    box('end-niche-frame-rail', (SPAN_C, NICH_Y + sgn * (NICH_H / 2 + 0.015), DEPTH - 0.015),
        (NICH_W + 0.14, 0.07, 0.06), 'wood', 0.006)
box('end-plinth', (SPAN_C, 0.3, DEPTH - 0.02), (SPAN_W - 0.1, 0.6, 0.05), 'brick', 0)
quad('end-coping-a', [
    (SPAN_C + SPAN_W / 2, END_H + 0.02, DEPTH + 0.18), (SPAN_C, END_H + 0.14, DEPTH + 0.18),
    (SPAN_C, END_H + 0.14, DEPTH), (SPAN_C + SPAN_W / 2, END_H + 0.02, DEPTH),
], 'roof', uv=[(0, 0), (1.4, 0), (1.4, 0.14 / 1.44), (0, 0.14 / 1.44)])
quad('end-coping-b', [
    (SPAN_C, END_H + 0.14, DEPTH + 0.18), (SPAN_C - SPAN_W / 2, END_H + 0.02, DEPTH + 0.18),
    (SPAN_C - SPAN_W / 2, END_H + 0.02, DEPTH), (SPAN_C, END_H + 0.14, DEPTH),
], 'roof', uv=[(0, 0), (1.4, 0), (1.4, 0.14 / 1.44), (0, 0.14 / 1.44)])
# corner caps (reusable module 3, unchanged)
for nm, xf, sd in (('corner-w', W_X, 1), ('corner-e', E_X, -1)):
    box(f'{nm}-post', (xf + sd * 0.09, WALL_H / 2, DEPTH + 0.09), (0.18, WALL_H, 0.18), 'wood', 0)
    box(f'{nm}-plinth-return', (xf + sd * 0.015, 0.3, DEPTH + 0.09), (0.05, 0.6, 0.26), 'brick', 0)
    box(f'{nm}-coping-cap', (xf + sd * 0.06, WALL_H + 0.06, DEPTH + 0.02), (0.3, 0.12, 0.08), 'roof', 0)

# ---------------------------------------------------------------- collision (same names/coverage as v5 sidecar)
CY, CW = 0.09 + WALL_H / 2, WALL_H
local_records = [
    ('lane-a:wall-west-s1', (W_X + W_T / 2, CY, (S0 + BAY_S0) / 2), (W_T, CW, BAY_S0 - S0)),
    ('lane-a:wall-west-s2', (W_X + W_T / 2, CY, (BAY_S1 + DEPTH) / 2), (W_T, CW, DEPTH - BAY_S1)),
    ('lane-a:wall-east', (E_X - E_T / 2, CY, (S0 + DEPTH) / 2), (E_T, CW, DEPTH - S0)),
    ('lane-a:rear-door-backwall', ((NICHE_BACK + BAY_X1) / 2, CY, DOOR_S), (BAY_X1 - NICHE_BACK, CW, BAY_LEN)),
    ('lane-a:rear-door-head', (W_X + 0.125, (DOOR_H + WALL_H) / 2, DOOR_S), (0.25, WALL_H - DOOR_H, BAY_LEN)),
    ('lane-a:rear-door-pier', ((W_X + BAY_X1) / 2, CY, (BAY_S0 + DOOR_S - DOOR_W / 2) / 2), (0.37, CW, DOOR_S - DOOR_W / 2 - BAY_S0)),
    ('lane-a:rear-door-pier', ((W_X + BAY_X1) / 2, CY, (DOOR_S + DOOR_W / 2 + BAY_S1) / 2), (0.37, CW, BAY_S1 - (DOOR_S + DOOR_W / 2))),
    ('lane-a:end-band--1', (SPAN_C - (NICH_W / 2 + side_w / 2), 0.09 + END_H / 2, DEPTH + EW_T / 2), (side_w, END_H, EW_T)),
    ('lane-a:end-band-1', (SPAN_C + (NICH_W / 2 + side_w / 2), 0.09 + END_H / 2, DEPTH + EW_T / 2), (side_w, END_H, EW_T)),
    ('lane-a:end-band-below', (SPAN_C, 0.09 + (NICH_Y - NICH_H / 2) / 2, DEPTH + EW_T / 2), (NICH_W, NICH_Y - NICH_H / 2, EW_T)),
    ('lane-a:end-band-above', (SPAN_C, 0.09 + (NICH_Y + NICH_H / 2 + END_H) / 2, DEPTH + EW_T / 2), (NICH_W, END_H - (NICH_Y + NICH_H / 2), EW_T)),
]
cy, sy = math.cos(YAW), math.sin(YAW)


def to_world(cx, cyy, cz):
    return [T0[0] + cy * cx + sy * cz, T0[1] + cyy, T0[2] - sy * cx + cy * cz]


colliders = []
for name, c, s in local_records:
    corners = []
    for dx in (-s[0] / 2, s[0] / 2):
        for dy in (-s[1] / 2, s[1] / 2):
            for dz in (-s[2] / 2, s[2] / 2):
                corners.append(to_world(c[0] + dx, c[1] + dy, c[2] + dz))
    mn = [min(pt[i] for pt in corners) for i in range(3)]
    mx = [max(pt[i] for pt in corners) for i in range(3)]
    colliders.append({'name': name, 'module': 'lane-a', 'type': 'box', 'min': mn, 'max': mx,
                      'obb': {'pos': list(T0), 'theta': YAW, 'center': list(c), 'size': list(s)}})

# ---------------------------------------------------------------- finalize
design = {
    'family': 'lane-a-module-polish',
    'sampleId': 'lane-a-v2',
    'basedOn': 'kit/build_lane_a.py geometry contract + lane-a-polish construct work order (lead-frozen 2026-09-20); wall lines verified by artifacts/lane-a-polish/survey',
    'localFrame': 'origin=portal centre on removed seal wall mid-plane at floor y=0.09; +Z inward; +X west side',
    'worldPlacement': {'portalCenterGlb': list(T0), 'rotationYRad': YAW},
    'changesVsV5': [
        'high windows: wall partitioned around openings, four-side reveals, rear-set closed glass (no buried solid box)',
        'west window recess 0.08 keeps 0.02 behind (t=0.10); east recess 0.14 (t=0.24)',
        'rear door ring-built niche kept; lintel/threshold refined, brick returns into reveals',
        'end niche 0.13 m real recess: lining + back + frame ring (solid fill box removed)',
        'timber fascia under the eaves on both lane walls + end wall; coping profile unchanged',
        'plaster material instance normal strength 0.65 -> 0.35 (this module only)',
        'no wall-scale micro-bevels; bevels kept on sills/threshold only',
    ],
    'groundNodeNames': ['lanes-v2__paving-frontage', 'lanes-v2__worn-stone'],
    'newTextures': 0,
    'budgetTris': 4000,
}
a.out.mkdir(parents=True, exist_ok=True)
tris, bytes_ = L.finalize('lane-a-v2', a.out, design)
print(f'LANE_A_V2_READY tris={tris} bytes={bytes_}')
assert tris <= 4000, f'lane-a-v2 {tris} > 4000 budget'
# world-space collision sidecar (same schema as the v5 asset sidecar)
(a.out / 'collision.json').write_text(json.dumps({
    'axis': 'glTF Y-up; world-space obb records (obb.pos = asset portal origin), consumed by blockViews.makeAssets',
    'assetId': 'lane-a',
    'origin': list(T0),
    'yawRad': YAW,
    'colliders': colliders,
    'doors': 'portal open; west rear service door closed (niche ring solid); end niche blind (solid bands)',
    'notIntegratedOrWalkingTested': True,
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'COLLISION_READY records={len(colliders)}')
print('BUDGET_OK')
