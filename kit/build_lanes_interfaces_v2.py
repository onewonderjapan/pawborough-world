"""Lanes interfaces builder v2 (lane-a-polish batch) — mouth A rebuilt from
MEASURED wall lines; output goes to the NEW dataset dir
world/lane-a-polish/interfaces (the v5 asset stays untouched).

Measured anchors (artifacts/lane-a-polish/survey, lead-frozen 2026-09-20):
  N05 east outer face line  (42.02,-9.83) -> (42.57,-16.80)
  N06 west outer face line  (44.00,-9.67) -> (44.87,-14.79)   (NW corner)
  module east wall inner face x~44.645 @ z-16.35 (holder 43.545,0.09,-16.375
  yaw 3.1165); module floor south edge = local s=0.06 line.

What changed vs v5 for mouth A:
  1. a-floor re-closed along the REAL N05/N06/new-wall lines (explicit
     triangles, upward; lanes-v2__paving-frontage -> production ground).  The
     ~6.4 m2 east void band (players fell out of the world) is filled; the
     west edge is a deliberate 0.34 m setback so the recessed drain reads.
  2. new connecting wall: N06 NW corner -> module east wall, t=0.24 h=3.3,
     plaster + brick base + tile cap, with the world-space OBB record
     lane-a:wall-east-mouth (visual + collider close the portal corner).
  3. the two mouth piers re-anchored INTO the real wall lines (brick bases
     grounded y0..0.6); no street-spanning gatehouse added.
Mouth B is copied VERBATIM from the v5 builder (including the known
b-apron/b-drain-outlet z-collapse defect — registered as a lane-B leftover,
out of A scope by the frozen work order).

Run: blender -b --factory-startup -t 4 -P kit/build_lanes_interfaces_v2.py -- --out world/lane-a-polish/interfaces
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

for nd in L.M['plaster'].node_tree.nodes:
    if nd.type == 'NORMAL_MAP':
        nd.inputs['Strength'].default_value = 0.35

FLOOR_Y = 0.09


def quad(name, pts_xz, m, uv=None, y=FLOOR_Y):
    verts = [(pt[0], y, pt[1]) for pt in pts_xz]
    uvs = uv or [(0, 0), (1, 0), (1, 1), (0, 1)]
    return L.mesh(name, verts, [(0, 1, 2, 3)], m, uvs)


# ---- measured anchors ---------------------------------------------------------
N05_A, N05_B = (42.02, -9.83), (42.57, -16.80)      # N05 east outer face
N06_A, N06_B = (44.00, -9.67), (44.87, -14.79)      # N06 west outer face


def line_x(p0, p1, z):
    (x0, z0), (x1, z1) = p0, p1
    return x0 + (x1 - x0) * (z0 - z) / (z0 - z1)


def unit(p0, p1):
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    l = math.hypot(dx, dz)
    return (dx / l, dz / l)


def perp_east(u):
    """The perpendicular of u (XZ plane) that points east (+X)."""
    cands = ((-u[1], u[0]), (u[1], -u[0]))
    return max(cands, key=lambda v: v[0])


def off(p, u, n, along, out):
    return (p[0] + u[0] * along + n[0] * out, p[1] + u[1] * along + n[1] * out)


def intersect(p, u, q, v):
    """p + t*u == q + s*v (2D); returns (t, s)."""
    det = u[0] * v[1] - u[1] * v[0]
    dp = (q[0] - p[0], q[1] - p[1])
    return ((dp[0] * v[1] - dp[1] * v[0]) / det, (dp[0] * u[1] - dp[1] * u[0]) / det)


u05, u06 = unit(N05_A, N05_B), unit(N06_A, N06_B)
n05e, n06e = perp_east(u05), perp_east(u06)
assert n05e[0] > 0.9 and n06e[0] > 0.9, 'east normals must point +X'

# module floor south edge (world): local s=0.06, x_local ±1.10 under holder
YAW, T0 = 3.1165, [43.545, 0.09, -16.375]
cy, sy = math.cos(YAW), math.sin(YAW)


def mod_world(lx, ls):
    return (T0[0] + cy * lx + sy * ls, T0[2] - sy * lx + cy * ls)


MOD_E = mod_world(-1.10, 0.06)   # east end of the module floor edge
MOD_W = mod_world(1.10, 0.06)    # west end
u_mod = unit(MOD_W, MOD_E)       # module edge direction, west -> east

# ---- new east mouth wall: west face from the N06 corner onto the module edge
WALL_T, WALL_H = 0.24, 3.3
A_N = tuple(N06_B)
u_wall = unit(A_N, MOD_E)
for _ in range(4):               # fixed point: bearing that hits the module edge
    t_hit, _ = intersect(A_N, u_wall, MOD_E, u_mod)
    hit = (A_N[0] + u_wall[0] * t_hit, A_N[1] + u_wall[1] * t_hit)
    u_wall = unit(A_N, ((hit[0] + MOD_E[0]) / 2, (hit[1] + MOD_E[1]) / 2))
t_hit, _ = intersect(A_N, u_wall, MOD_E, u_mod)
A_S = off(A_N, u_wall, (0, 0), t_hit + 0.05, 0.0)   # 0.05 past the seam
n_we = perp_east(u_wall)
WALL_LEN = math.hypot(A_S[0] - A_N[0], A_S[1] - A_N[1])

# ================================================================ mouth A floor
west_off = 0.34                   # deliberate setback: recessed drain line reads
wline_p = off(N05_A, u05, n05e, 0.0, west_off)      # N05 face + 0.34 offset line
t_w, _ = intersect(MOD_W, u_mod, wline_p, u05)
A_w = (MOD_W[0] + u_mod[0] * t_w, MOD_W[1] + u_mod[1] * t_w)
A_e = off(MOD_E, u_mod, n_we, 0.008, 0.017)         # tucked under module/new wall
C_pt = off(N06_B, u06, n06e, 0.0, 0.03)
D_pt = off((line_x(N06_A, N06_B, -9.95), -9.95), u06, n06e, 0.0, 0.03)
E_pt = (line_x(N05_A, N05_B, -9.95) + west_off, -9.95)
FLOOR_PTS = [A_w, A_e, C_pt, D_pt, E_pt]
verts = [(x, FLOOR_Y, z) for (x, z) in FLOOR_PTS]
uvs = [(x / 2.4, z / 2.4) for (x, z) in FLOOR_PTS]
# explicit fan triangles (no ngon hand-off); winding matches the proven v5 floor
L.mesh('a-floor', verts, [(0, 1, 2), (0, 2, 3), (0, 3, 4)], 'paving', uvs)

# west drain: recessed channel between the N05 face and the floor setback edge
d0, d1, z_ds, z_dn = 0.14, 0.34, -10.30, -16.39
quad('a-drain', [
    (line_x(N05_A, N05_B, z_ds) + d1, z_ds), (line_x(N05_A, N05_B, z_ds) + d0, z_ds),
    (line_x(N05_A, N05_B, z_dn) + d0, z_dn), (line_x(N05_A, N05_B, z_dn) + d1, z_dn),
], 'stone', uv=[(0, 0), (0.20, 0), (0.20, 6.09 / 1.2), (0, 6.09 / 1.2)], y=FLOOR_Y - 0.02)

# street threshold strip (pavement join; z-band unchanged vs v5); lead fix
# 2026-09-20: top capped at floor+0.02 (was +0.025) for the seam contract
th_x0 = line_x(N05_A, N05_B, -10.40) - 0.03
th_x1 = line_x(N06_A, N06_B, -10.40) + 0.03
quad('a-threshold', [(th_x0, -10.40), (th_x1, -10.40), (th_x1, -9.95), (th_x0, -9.95)],
     'stone', uv=[(0, 0), ((th_x1 - th_x0) / 2.4, 0), ((th_x1 - th_x0) / 2.4, 0.45 / 2.4), (0, 0.45 / 2.4)],
     y=FLOOR_Y + 0.02)

# ================================================================ new east mouth wall


def wall_prism(name, wa, wb, n_e, t, y0, y1, m):
    """Oriented wall slab between west-face line wa->wb, thickness t toward
    n_e; local x = wa->wb, y = up, z = west->east (box_glb face layout)."""
    ea, eb = off(wa, (0, 0), n_e, 0, t), off(wb, (0, 0), n_e, 0, t)
    v = [(wa[0], y0, wa[1]), (wb[0], y0, wb[1]), (wb[0], y1, wb[1]), (wa[0], y1, wa[1]),
         (ea[0], y0, ea[1]), (eb[0], y0, eb[1]), (eb[0], y1, eb[1]), (ea[0], y1, ea[1])]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 4, 7, 3), (1, 2, 6, 5), (0, 1, 5, 4), (3, 7, 6, 2)]
    return L.mesh(name, v, faces, m)


wall_prism('a-wall-east-mouth', A_N, A_S, n_we, WALL_T, 0.0, WALL_H, 'plaster')
# brick base band on the lane (west) face, grounded; starts 0.05 into N06
wall_prism('a-wall-east-mouth-base', off(A_N, u_wall, n_we, 0.05, -0.05), off(A_S, u_wall, n_we, 0, -0.05),
           n_we, WALL_T + 0.05, 0.0, 0.6, 'brick')
# tile cap closing the top (same language as the module coping), 0.03 laps all round
wall_prism('a-wall-east-mouth-cap', off(A_N, u_wall, n_we, -0.03, -0.03), off(A_S, u_wall, n_we, 0.03, -0.03),
           n_we, WALL_T + 0.06, WALL_H, WALL_H + 0.10, 'roof')

# ================================================================ mouth piers (re-anchored to the real lines)
for tag, cx in (('west', line_x(N05_A, N05_B, -10.20)), ('east', line_x(N06_A, N06_B, -10.20))):
    L.box(f'a-jamb-{tag}', (cx, 1.7, -10.20), (0.34, 3.2, 0.55), 'plaster', 0.008)
    L.box(f'a-jamb-{tag}-base', (cx, 0.3, -10.20), (0.40, 0.6, 0.61), 'brick', 0.006)
    L.box(f'a-jamb-{tag}-cap', (cx, 3.32, -10.20), (0.40, 0.1, 0.61), 'stone', 0.006)

# ================================================================ mouth B (VERBATIM from kit/build_lanes_interfaces.py)
BC = [57.418, FLOOR_Y, 14.2485]
B_YAW = -0.4818
B_RIGHT = (math.cos(B_YAW), math.sin(B_YAW))
B_IN = (-math.sin(B_YAW), math.cos(B_YAW))


def bpt(right_off, s):
    return [BC[0] + B_RIGHT[0] * right_off + B_IN[0] * s, FLOOR_Y,
            BC[2] + B_RIGHT[1] * right_off + B_IN[1] * s]


apron = [bpt(-1.5, -1.30), bpt(1.5, -1.30), bpt(1.5, -0.02), bpt(-1.5, -0.02)]
quad('b-apron', apron, 'paving',
     uv=[(0, 0), (3.0 / 2.4, 0), (3.0 / 2.4, 1.3 / 2.4), (0, 1.3 / 2.4)], y=FLOOR_Y - 0.015)
outlet = [bpt(-0.36, -0.65), bpt(0.36, -0.65), bpt(0.36, -0.02), bpt(-0.36, -0.02)]
quad('b-drain-outlet', outlet, 'stone',
     uv=[(0, 0), (0.72, 0), (0.72, 0.63), (0, 0.63)], y=FLOOR_Y - 0.035)
for sgn, nm in ((-1, 'w'), (+1, 'e')):
    c = bpt(sgn * 0.925, -0.20)
    L.box(f'b-pier-base-{nm}', (c[0], 0.30, c[2]), (0.44, 0.6, 0.18), 'brick', 0.006, True)

# ---------------------------------------------------------------- collision sidecar (world-space)
colliders = []
for tag, cx in (('west', line_x(N05_A, N05_B, -10.20)), ('east', line_x(N06_A, N06_B, -10.20))):
    colliders.append({
        'name': f'interfaces:a-jamb-{tag}', 'module': 'interfaces', 'type': 'box',
        'min': [cx - 0.17, 0.1, -10.475], 'max': [cx + 0.17, 3.3, -9.925],
        'obb': {'pos': [0, 0, 0], 'theta': 0.0, 'center': [cx, 1.7, -10.20], 'size': [0.34, 3.2, 0.55]},
    })
# the new east mouth wall: OBB aligned with its west-face line (pos carries the
# world translation, center stays rotation-local — the obbToWorld convention)
theta = math.atan2(u_wall[0], u_wall[1])            # local +Z maps to u_wall
mid = ((A_N[0] + A_S[0]) / 2, (A_N[1] + A_S[1]) / 2)
cen = off(mid, (0, 0), n_we, 0, WALL_T / 2)
corners = [A_N, A_S, off(A_N, (0, 0), n_we, 0, WALL_T), off(A_S, (0, 0), n_we, 0, WALL_T)]
colliders.append({
    'name': 'lane-a:wall-east-mouth', 'module': 'interfaces', 'type': 'box',
    'min': [min(c[0] for c in corners), 0.0, min(c[1] for c in corners)],
    'max': [max(c[0] for c in corners), WALL_H, max(c[1] for c in corners)],
    'obb': {'pos': [cen[0], 0.0, cen[1]], 'theta': theta,
            'center': [0, WALL_H / 2, 0], 'size': [WALL_T, WALL_H, WALL_LEN]},
})
for rec in L.COLL:  # b-pier-base-* (world-authored, theta 0)
    c, s = rec['center'], rec['size']
    colliders.append({'name': rec['name'], 'module': 'interfaces', 'type': 'box',
                      'min': [c[0] - s[0] / 2, c[1] - s[1] / 2, c[2] - s[2] / 2],
                      'max': [c[0] + s[0] / 2, c[1] + s[1] / 2, c[2] + s[2] / 2],
                      'obb': {'pos': [0, 0, 0], 'theta': 0.0, 'center': c, 'size': s}})

# ---------------------------------------------------------------- finalize
design = {
    'family': 'lanes-v2-interfaces-polish',
    'sampleId': 'lane-a-interfaces-v2',
    'basedOn': 'measured wall lines (survey 2026-09-20): N05 east face (42.02,-9.83)->(42.57,-16.80); N06 west face (44.00,-9.67)->(44.87,-14.79); module floor edge from holder 43.545,0.09,-16.375 yaw 3.1165',
    'localFrame': 'WORLD coordinates (identity placement), GLB Y-up, floor top y=0.09',
    'measuredAnchors': {
        'n05EastFace': [list(N05_A), list(N05_B)],
        'n06WestFace': [list(N06_A), list(N06_B)],
        'moduleFloorEdge': [list(MOD_W), list(MOD_E)],
        'newWallWestFace': {'north': [round(v, 4) for v in A_N], 'south': [round(v, 4) for v in A_S],
                            'lengthM': round(WALL_LEN, 4), 'thetaRad': round(theta, 5)},
    },
    'floorPolygonXz': [[round(x, 4), round(z, 4)] for (x, z) in FLOOR_PTS],
    'changesVsV5': [
        'a-floor re-closed along real N05/N06/new-wall lines (fills the 6.4 m2 east void band)',
        'explicit floor triangles; west edge set back 0.34 with recessed drain line',
        'new east mouth wall N06-corner -> module east wall (t 0.24, h 3.3) + lane-a:wall-east-mouth collider',
        'mouth piers re-anchored into the real wall lines, brick bases grounded',
        'mouth B copied verbatim (b-apron z-collapse defect registered as leftover, out of A scope)',
    ],
    'groundNodeNames': ['lanes-v2__paving-frontage', 'lanes-v2__worn-stone'],
    'newTextures': 0,
    'budgetTris': 950,
}
a.out.mkdir(parents=True, exist_ok=True)
tris, bytes_ = L.finalize('lane-a-interfaces-v2', a.out, design)
print(f'INTERFACES_V2_READY tris={tris} bytes={bytes_}')
assert tris <= 950, f'interfaces-v2 {tris} > 950 budget'
(a.out / 'collision.json').write_text(json.dumps({
    'axis': 'glTF Y-up; world-space obb records (obb.pos = asset portal origin), consumed by blockViews.makeAssets',
    'assetId': 'interfaces',
    'origin': [0, 0, 0],
    'yawRad': 0,
    'colliders': colliders,
    'knownLeftovers': ['b-apron/b-drain-outlet z-collapse (quad() fed 3-tuples) — lane B, out of A scope, kept verbatim'],
    'notIntegratedOrWalkingTested': True,
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'COLLISION_READY records={len(colliders)}')
print('BUDGET_OK')
