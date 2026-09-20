#!/usr/bin/env python3
"""Lane-B polish baseline measurement — targeted checks on the DELIVERED v6
state that must FAIL before the fix and PASS on the v7 candidate (re-run with
--phase after).

Checks (all measured from real GLB triangles / sidecar records, no design
numbers standing in for geometry):
  T1  production transform agreement: lane-b-v2 module GLB corners vs the
      world-space collision sidecar AABBs (3+ non-collinear anchors).
  T2  mouth B interface placement: b-apron / b-drain-outlet / b-pier-base
      triangles must sit in the real mouth band (lane-local ls in [-1.35, 0.05]).
      v6 fact: quad() was fed [x, y, z] triples where it expects [x, z] pairs,
      so the B apron collapsed onto z = 0.09 near the world origin.
  T3  yaw sign: the pier-base bricks must flank the REAL S05/S07 mouth faces
      (|lx| within the measured mouth), not their mirrored positions.
  T4  ground closure: down-rays over the apron band and the funnel corridor
      must hit walkable ground (y in [0.05, 0.16]) with no misses.
  T5  threshold / drain-frame / paving height steps <= 0.02 m along the
      street -> apron -> portal axis.
  T6  clothesline cloth bottom >= 2.2 m over the walkable floor.

Run: python3 tools/lane_b_polish_measure.py [--phase before|after]
Output: artifacts/lane-b-polish/{baseline,verify}/measure-<phase>.json
"""
import argparse
import json
import math
import sys
from pathlib import Path

WS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WS / 'tools'))
from lane_a_survey_glb import collect_tris  # noqa: E402

YAW, T0 = -0.4818, [57.418, 0.09, 14.2485]
C, S = math.cos(YAW), math.sin(YAW)


def to_world(lx, ly, ls):
    return (T0[0] + C * lx + S * ls, T0[1] + ly, T0[2] - S * lx + C * ls)


def to_local(wx, wz):
    dx, dz = wx - T0[0], wz - T0[2]
    return (C * dx - S * dz, S * dx + C * dz)


HOLDER = [C, 0, -S, 0, 0, 1, 0, 0, S, 0, C, 0, T0[0], T0[1], T0[2], 1]

# measured real mouth faces (survey 2026-09-20, y=1.5 slices + collider OBBs):
#   west  S05 left-side wall lane face  lx = -1.096 (parallel to the lane axis)
#   east  S07 right-side lane face line lx(ls) = 1.067 - 0.0536 * (ls + 0.26)
S05_FACE_LX = -1.096
S07_FACE_AT = lambda ls: 1.067 - 0.0536 * (ls + 0.26)


def ray_down(tris, x, z, y0=2.0):
    """Topmost downward ray hit over triangles (Möller–Trumbore, dir (0,-1,0))."""
    best = None
    for t in tris:
        bx0, by0, bz0, bx1, by1, bz1 = t['bbox']
        if x < bx0 or x > bx1 or z < bz0 or z > bz1 or by0 > y0:
            continue
        v0, v1, v2 = t['verts']
        # e1, e2 and the ray dir (0,-1,0)
        e1 = (v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2])
        e2 = (v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2])
        # h = dir x e2 = (-e2z, 0, e2x)
        hx, hy, hz = -e2[2], 0.0, e2[0]
        det = e1[0] * hx + e1[1] * hy + e1[2] * hz
        if abs(det) < 1e-12:
            continue
        inv = 1.0 / det
        sx, sy, sz = x - v0[0], y0 - v0[1], z - v0[2]
        u = (sx * hx + sy * hy + sz * hz) * inv
        if u < -1e-9 or u > 1 + 1e-9:
            continue
        # q = s x e1
        qx = sy * e1[2] - sz * e1[1]
        qy = sz * e1[0] - sx * e1[2]
        qz = sx * e1[1] - sy * e1[0]
        v = (-qy) * inv          # dir . q = -qy
        if v < -1e-9 or u + v > 1 + 1e-9:
            continue
        td = (e2[0] * qx + e2[1] * qy + e2[2] * qz) * inv
        if td < 0 or td > y0 + 2.0:
            continue
        y = y0 - td
        if best is None or y > best:
            best = y
    return best


def collect_ground(paths):
    tris = []
    for path, frame in paths:
        tris += collect_tris(str(path), frame=frame)
    return [t for t in tris if abs(t['n'][1]) > 0.6]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--phase', choices=['before', 'after'], default='before')
    a = ap.parse_args()

    if a.phase == 'before':
        laneb_glb = WS / 'world/lanes-v2/lane-b-v2/model.glb'
        ifc_glb = WS / 'world/lane-a-polish/interfaces/model.glb'
        out = WS / 'artifacts/lane-b-polish/baseline'
    else:
        laneb_glb = WS / 'world/lane-b-polish/lane-b/model.glb'
        ifc_glb = WS / 'world/lane-b-polish/interfaces/model.glb'
        out = WS / 'artifacts/lane-b-polish/verify'

    R = {'phase': a.phase, 'checks': [], 'pass': 0, 'fail': 0}

    def check(cid, ok, detail):
        R['checks'].append({'id': cid, 'pass': bool(ok), 'detail': detail})
        R['pass' if ok else 'fail'] += 1
        print(f"{'ok  ' if ok else 'FAIL'} {cid}: {detail}")

    mod = collect_tris(str(laneb_glb), frame=HOLDER)
    ifc = collect_tris(str(ifc_glb))

    # ---- T1 production transform vs collision sidecar --------------------------
    side = json.loads((laneb_glb.parent / 'collision.json').read_text())
    pier_name = 'lane-b-v2:portal-pier-left' if a.phase == 'before' else 'lane-b:portal-pier-left'
    rec = next(r for r in side['colliders'] if r['name'] == pier_name)
    ob = rec['obb']
    ct, st = math.cos(ob['theta']), math.sin(ob['theta'])
    wc = (ob['pos'][0] + ct * ob['center'][0] + st * ob['center'][2],
          ob['pos'][2] - st * ob['center'][0] + ct * ob['center'][2])
    # module GLB pier top-front corner, same local point via production matrix
    lx, ly, lz = ob['center']
    gl = to_world(lx, ly, lz)
    d1 = math.hypot(wc[0] - gl[0], wc[1] - gl[2])
    # three non-collinear anchors: pier centers + floor corner
    anchors = [(-0.925, 1.325, -0.06), (0.925, 1.325, -0.06), (0.0, 0.0, 5.0)]
    worst = 0.0
    for ax, ay, az in anchors:
        w = to_world(ax, ay, az)
        # the same point expressed through the sidecar obb convention
        wx = ob['pos'][0] + ct * ax + st * az
        wz = ob['pos'][2] - st * ax + ct * az
        worst = max(worst, math.hypot(w[0] - wx, w[2] - wz))
    check('T1 transform agreement (3 anchors)', d1 < 1e-6 and worst < 1e-9,
          f'sidecar-vs-production center delta={d1:.2e}, anchor worst={worst:.2e}')

    # ---- T2 mouth interface placement ------------------------------------------
    # any 'paving'/'stone' triangle of the interfaces whose lane-local centroid
    # falls near the mouth band must be counted; the apron band is
    # ls in [-1.35, 0.05], lx in [S05_FACE_LX, S07 face + 0.1]
    mouth_tris = 0
    off_band = []
    for t in ifc:
        if t['node'] not in ('lanes-v2__paving-frontage', 'lanes-v2__worn-stone'):
            continue
        cx = sum(v[0] for v in t['verts']) / 3
        cz = sum(v[2] for v in t['verts']) / 3
        lx, ls = to_local(cx, cz)
        if -1.6 < ls < 1.0 and -1.6 < lx < 1.6:
            mouth_tris += 1
    # where DID the B apron go? triangles with lx in mouth range but z < 5
    stray = []
    for t in ifc:
        if t['node'] != 'lanes-v2__paving-frontage':
            continue
        cx = sum(v[0] for v in t['verts']) / 3
        cz = sum(v[2] for v in t['verts']) / 3
        lx, ls = to_local(cx, cz)
        if cz < 5.0 and 50.0 < cx < 62.0 and ls < -1.6:
            stray.append((round(cx, 2), round(cz, 2), round(ls, 2)))
    check('T2 apron/drain/outlet occupy the real mouth band', mouth_tris >= 4,
          f'interface ground tris in mouth band={mouth_tris}; v6 collapsed strays near origin={stray[:3]}')

    # ---- T3 pier-base bricks flank the real S05/S07 faces -----------------------
    bricks = [t for t in ifc if t['node'] == 'lanes-v2__blue-gray-brick'
              and 12.0 < (t['bbox'][2] + t['bbox'][5]) / 2 < 16.0]
    ok_t3 = len(bricks) >= 2
    detail = []
    west = [t for t in bricks if to_local(*([sum(v[0] for v in t['verts']) / 3, sum(v[2] for v in t['verts']) / 3]))[0] < 0]
    east = [t for t in bricks if t not in west]
    def lx_of(t):
        return to_local(sum(v[0] for v in t['verts']) / 3, sum(v[2] for v in t['verts']) / 3)
    if west:
        lxs = [lx_of(t)[0] for t in west]
        # must bridge wall -> pier: reach into the S05 wall body, cover the
        # pier flank, and stay clear of the 1.5 m opening (inner edge <= 0.75+0.01)
        ok_t3 &= min(lxs) <= S05_FACE_LX + 0.02 and max(lxs) >= -0.80 and max(lxs) <= -0.74
        detail.append(f'west pier-base lx [{min(lxs):.3f},{max(lxs):.3f}] bridges S05 face {S05_FACE_LX} to pier, clear opening kept')
    if east:
        lxs = [lx_of(t)[0] for t in east]
        east_face = S07_FACE_AT(-0.2)
        ok_t3 &= min(lxs) >= 0.74 and min(lxs) <= 0.80 and max(lxs) >= east_face
        detail.append(f'east pier-base lx [{min(lxs):.3f},{max(lxs):.3f}] bridges S07 face {east_face:.3f} to pier, clear opening kept')
    if not west or not east:
        ok_t3 = False
        detail.append(f'bricks found near mouth: {len(bricks)}')
    check('T3 pier bases flank the measured S05/S07 mouth faces', ok_t3, '; '.join(detail))

    # ---- T4 ground closure over apron band + funnel corridor --------------------
    asm = collect_tris(str(WS / 'world/fangbang-temple-v6/street-reviewed-lanes.glb'),
                       name_filter=lambda nm: nm.startswith('street-kit__'))
    ground = collect_ground([(laneb_glb, HOLDER), (ifc_glb, None)]) + [
        t for t in asm if abs(t['n'][1]) > 0.6 and t['verts'][0][1] < 0.2]
    STEP = 0.15
    miss = bad = n = 0
    holes = []
    for ls in [-1.30, -1.05, -0.80, -0.55, -0.30, -0.10, 0.10]:
        for lx in [-0.70, -0.45, -0.20, 0.0, 0.20, 0.45, 0.70]:
            w = to_world(lx, 0, ls)
            n += 1
            y = ray_down(ground, w[0], w[2])
            if y is None:
                miss += 1
                holes.append([round(w[0], 2), round(w[2], 2)])
            elif y < 0.05 or y > 0.16:
                bad += 1
                holes.append([round(w[0], 2), round(w[2], 2), round(y, 3)])
    check('T4 walkable ground across the mouth transition', miss == 0 and bad == 0,
          f'rays={n} misses={miss} badY={bad} first={holes[:4]}')

    # ---- T5 surface steps along the street -> portal -> lane axis ---------------
    axis = [(-1.45 + 0.05 * i) for i in range(int((1.45 + 4.05) / 0.05) + 1)]
    ys = []
    for ls in axis:
        w = to_world(0.0, 0, ls)
        ys.append(ray_down(ground, w[0], w[2]))
    steps = [abs(a - b) for a, b in zip(ys, ys[1:]) if a is not None and b is not None]
    holes_axis = sum(1 for y in ys if y is None)
    worst = max(steps) if steps else None
    check('T5 axis surface steps <= 0.02 m', holes_axis == 0 and worst is not None and worst <= 0.0201,
          f'holes={holes_axis} maxStep={worst:.4f}' if worst is not None else f'holes={holes_axis}')

    # ---- T6 clothesline clearance ----------------------------------------------
    cloth = [t for t in mod if t['node'] in ('lanes-v2__indigo-cotton', 'lanes-v2__sage-cotton')]
    ymin = min((v[1] for t in cloth for v in t['verts']), default=None)
    check('T6 cloth bottom >= 2.2 m', ymin is not None and ymin >= 2.2 - 1e-6,
          f'cloth lowest vertex y={ymin}' if ymin is not None else 'cloth meshes not found')

    out.mkdir(parents=True, exist_ok=True)
    (out / f'measure-{a.phase}.json').write_text(json.dumps(R, ensure_ascii=False, indent=1) + '\n')
    print(f"MEASURE_{a.phase.upper()}_{'PASS' if R['fail'] == 0 else 'FAIL'} ({R['fail']} failing)")
    sys.exit(0 if R['fail'] == 0 else 1)


if __name__ == '__main__':
    main()
