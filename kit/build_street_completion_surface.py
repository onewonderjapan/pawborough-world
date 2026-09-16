"""Street-completion tail surface (batch 20260915) — visible pavement that IS
the physics ground (same faces, extracted client-side via GROUND_NODE_RE).

Builds the connected road tail from the verified street's wedge end
((84,21.45)-(88.5,14.31), measured from street-kit__quiet-gray-asphalt) through
the midpoints of the three front-wall pairs (128/129, 130/131, 132/133) and
stops in front of the 132/133 pair. PLAN.md S3 rules:
  - pavement only over the connected band (no city-wide slab)
  - >=0.10m clearance between pavement edge and actual walls/footings
    (foundation protrusion 0.06 included in the check)
  - walkable center band >=1.2m net (the band here is the full 4.0m asphalt)
  - continuous stone curbs on the constant-width section, 2 drains + 1 manhole
    with recorded placement basis, no street furniture beyond that
Hard-fails (exit 2) if any clearance check cannot hold.

Run:
  blender -b --factory-startup -t 4 -P kit/build_street_completion_surface.py -- \
      --out kit/out/sctail
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
args = p.parse_args(argv)

# ---- design inputs ---------------------------------------------------------
ROAD_END = [(84.0, 21.45), (88.5, 14.31)]   # measured wedge end of the frozen road
PAIR_MIDPOINTS = [
    (96.7016, 20.8414),                      # 128 + 129
    (109.2719, 24.2916),                     # 130 + 131
    (120.9569, 27.0216),                     # 132 + 133
]
TAIL_END = (124.6, 27.65)
STEERING_POINTS = [(104.07, 23.08)]  # keeps the run on the 130/131 medial line through their west corridor (argmin fix)
WIDTH_TAIL = 4.0
WIDTH_START = 8.44
TAPER_S = 8.0
CURB_W = 0.25
CURB_H = 0.09
FOUNDATION_PROTRUSION = 0.06
MIN_EDGE_CLEARANCE = 0.10

FRONT_WALLS = {
    'east-shop-128': (97.66450990714537, 17.734234931801197, -0.301652, 10.7),
    'east-shop-129': (95.7340372829119, 23.93834100897118, 2.839941, 10.7),
    'east-shop-130': (109.78575716044992, 22.102845323533415, -0.22938, 10.7),
    'east-shop-131': (108.75792755015615, 26.4802503875359, 2.912213, 10.7),
    'east-shop-132': (121.69313096704158, 23.859037769611177, -0.22938, 10.7),
    'east-shop-133': (120.22055408090135, 30.184058020222682, 2.912213, 10.7),
}

# ---- centerline ------------------------------------------------------------
def chaikin(pts, passes=2):
    for _ in range(passes):
        out = [pts[0]]
        for p0, p1 in zip(pts, pts[1:]):
            out.append((0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]))
            out.append((0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]))
        out.append(pts[-1])
        pts = out
    return pts

def resample(pts, step=0.5):
    out = [pts[0]]
    acc = 0.0
    for p0, p1 in zip(pts, pts[1:]):
        seg = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        t = step - acc
        while t <= seg + 1e-9:
            k = min(1.0, t / seg)
            out.append((p0[0] + (p1[0] - p0[0]) * k, p0[1] + (p1[1] - p0[1]) * k))
            t += step
        acc = (acc + seg) % step
    out.append(pts[-1])
    return out

ctrl = [((ROAD_END[0][0] + ROAD_END[1][0]) / 2, (ROAD_END[0][1] + ROAD_END[1][1]) / 2)]
ctrl += PAIR_MIDPOINTS
ctrl.append(TAIL_END)
ctrl = sorted(ctrl, key=lambda q: q[0])          # steering points merge in x-order
for k, sp in enumerate(STEERING_POINTS):          # re-insert with x-order kept
    ctrl = sorted(ctrl + [sp], key=lambda q: q[0])

center = resample(chaikin(ctrl, 2), 0.5)
ss = [0.0]
for p0, p1 in zip(center, center[1:]):
    ss.append(ss[-1] + math.hypot(p1[0] - p0[0], p1[1] - p0[1]))
S_TOTAL = ss[-1]
n_st = len(center)

def width_at(s):
    if s >= TAPER_S:
        return WIDTH_TAIL
    k = max(0.0, min(1.0, s / TAPER_S))
    return WIDTH_START + (WIDTH_TAIL - WIDTH_START) * k

def south_normal(i):
    j, k = min(i + 1, n_st - 1), max(i - 1, 0)
    tx, tz = center[j][0] - center[k][0], center[j][1] - center[k][1]
    n = math.hypot(tx, tz) or 1.0
    return (tz / n, -tx / n)   # tangent (1,0) -> (0,1) = +z = south

# ---- clearances vs actual front walls --------------------------------------
def seg_point_dist(seg, pt):
    (ax, az), (bx, bz) = seg
    vx, vz = bx - ax, bz - az
    L2 = vx * vx + vz * vz or 1.0
    t = max(0.0, min(1.0, ((pt[0] - ax) * vx + (pt[1] - az) * vz) / L2))
    return math.hypot(pt[0] - (ax + t * vx), pt[1] - (az + t * vz))

clearance_report = {}
for bid, (ox, oz, th, w) in FRONT_WALLS.items():
    tx, tz = math.cos(th), -math.sin(th)
    seg = ((ox - tx * w / 2, oz - tz * w / 2), (ox + tx * w / 2, oz + tz * w / 2))
    dists = [(seg_point_dist(seg, pt), pt) for pt in center]
    d, at_pt = min(dists, key=lambda q: q[0])
    clearance_report.setdefault('_argmin', {})[bid] = {'at': [round(at_pt[0], 2), round(at_pt[1], 2)]}
    clearance_report[bid] = {
        'minCenterlineToWallM': round(d, 3),
        'minPavementEdgeToFoundationM': round(d - WIDTH_TAIL / 2 - FOUNDATION_PROTRUSION, 3),
        'pass': d - WIDTH_TAIL / 2 - FOUNDATION_PROTRUSION >= MIN_EDGE_CLEARANCE,
    }
failed = {k: v for k, v in clearance_report.items() if isinstance(v, dict) and not v.get('pass', True)}
print('SURFACE_ARGMIN', json.dumps(clearance_report.get('_argmin', {})))
if failed:
    print('SURFACE_CLEARANCE_FAIL', json.dumps(failed))
    sys.exit(2)

# ---- geometry ---------------------------------------------------------------
L.reset_scene()
L.build_materials()
L.GROUP = 'sctail'

# asphalt slab: top y=0 (tucked 4mm under the frozen road for the first 0.4m),
# soffit -0.10 so no open edge ever faces the camera
top = []
for i in range(n_st):
    pt, s = center[i], ss[i]
    nx, nz = south_normal(i)
    hw = width_at(s) / 2
    y = -0.004 if s < 0.4 else 0.0
    top.append((pt[0] - nx * hw, y, pt[1] - nz * hw))
    top.append((pt[0] + nx * hw, y, pt[1] + nz * hw))
bot = [(x, -0.10, z) for (x, y, z) in top]
faces = []
for i in range(n_st - 1):
    a, b, c, d = 2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2
    faces += [(a, b, c, d), (a + 2 * n_st, d + 2 * n_st, c + 2 * n_st, b + 2 * n_st),
              (a, d, d + 2 * n_st, a + 2 * n_st), (b + 2 * n_st, c + 2 * n_st, c, b)]
# end caps
faces += [(0, 2 * n_st, 2 * n_st + 1, 1), (2 * n_st - 2, 2 * n_st - 1, 4 * n_st - 1, 4 * n_st - 2)]
L.mesh('sctail-asphalt', top + bot, faces, 'road')

# curbs: two extruded strips on the constant-width section
i0 = next(i for i, s in enumerate(ss) if s >= TAPER_S)
curb_v, curb_f = [], []
vb = 0
for side in (-1, 1):
    ringI, ringO = [], []
    for i in range(i0, n_st):
        pt = center[i]
        nx, nz = south_normal(i)
        ringI.append((pt[0] + nx * side * (WIDTH_TAIL / 2), CURB_H, pt[1] + nz * side * (WIDTH_TAIL / 2)))
        ringO.append((pt[0] + nx * side * (WIDTH_TAIL / 2 + CURB_W), CURB_H, pt[1] + nz * side * (WIDTH_TAIL / 2 + CURB_W)))
    m = len(ringI)
    verts4 = ([(x, y, z) for (x, y, z) in ringI]                      # inner top
              + [(x, y, z) for (x, y, z) in ringO]                    # outer top
              + [(x, CURB_H - CURB_H, z) for (x, y, z) in ringO]      # outer bottom (=0.0)
              + [(x, 0.0, z) for (x, y, z) in ringI])                 # inner bottom
    curb_v += verts4
    for i in range(m - 1):
        it0, it1 = vb + i, vb + i + 1
        ot0, ot1 = vb + m + i, vb + m + i + 1
        ob0, ob1 = vb + 2 * m + i, vb + 2 * m + i + 1
        ib0, ib1 = vb + 3 * m + i, vb + 3 * m + i + 1
        curb_f += [(it0, ot0, ot1, it1)          # top band
                   , (ot0, ob0, ob1, ot1)        # outer face
                   , (it1, ib1, ib0, it0)]       # inner (kerb) face
    # end caps (start & finish of the strip)
    curb_f += [(vb, vb + 3 * m, vb + 2 * m, vb + m), (vb + m - 1, vb + 2 * m - 1, vb + 3 * m - 1, vb + 4 * m - 1)]
    vb += 4 * m
L.mesh('sctail-curb', curb_v, curb_f, 'stone')

# drains: 2 grates sunk at the south kerb line; manhole: 1 stone cover
def station_near(x_target):
    return min(range(n_st), key=lambda i: abs(center[i][0] - x_target))

drain_stations = [station_near(100.0), station_near(124.0)]
manhole_i = station_near(109.27)
drain_records, manhole_record = [], None
for k, di in enumerate(drain_stations):
    pt = center[di]
    nx, nz = south_normal(di)
    cx, cz = pt[0] + nx * (WIDTH_TAIL / 2 - 0.35), pt[1] + nz * (WIDTH_TAIL / 2 - 0.35)
    L.box(f'sctail-drain-{k}', (cx, -0.025, cz), (0.42, 0.05, 0.30), 'stone', 0)
    drain_records.append({'stationX': round(cx, 3), 'stationZ': round(cz, 3),
                          'basis': 'south kerb line, 0.35m inboard; continues the frozen street\u2019s frontage-drain side'})
mx = center[manhole_i]
nx, nz = south_normal(manhole_i)
mcx, mcz = mx[0] + nx * 1.0, mx[1] + nz * 1.0
L.cyl('sctail-manhole', (mcx, -0.02, mcz), (mcx, 0.015, mcz), 0.33, 'stone', 10)
manhole_record = {'stationX': round(mcx, 3), 'stationZ': round(mcz, 3),
                  'basis': '1.0m south of the 130/131 pair midpoint (the narrowest pinch), off the walking line'}

# ---- finalize + spec ---------------------------------------------------------
args.out.mkdir(parents=True, exist_ok=True)
design = {
    'family': 'street-completion-tail-surface',
    'sampleId': 'sctail',
    'frontageM': round(S_TOTAL, 2),
    'band': {'widthTailM': WIDTH_TAIL, 'widthStartM': WIDTH_START, 'taperS': TAPER_S,
             'walkBandNetM': WIDTH_TAIL, 'curbW': CURB_W, 'curbH': CURB_H},
    'controlPoints': ctrl,
    'endpoints': {'start': ctrl[0], 'end': ctrl[-1]},
    'clearanceRule': f'pavement edge >= {MIN_EDGE_CLEARANCE}m from wall/footing (foundation +{FOUNDATION_PROTRUSION}m included)',
    'interiorBuilt': False,
    'surveyed': False,
}
used = {'design': design, 'clearanceReport': clearance_report}
tris, bytes_ = L.finalize('sctail', args.out, design)
(args.out / 'surface-spec.json').write_text(json.dumps({
    'schemaVersion': 1,
    'generatedBy': 'kit/build_street_completion_surface.py',
    'sources': {
        'verifiedRoadEnd': {'mesh': 'street-kit__quiet-gray-asphalt (world/street-reviewed.glb)',
                            'wedgeEndMeters': ROAD_END,
                            'measuredBy': 'scripts read of assembly GLB, batch 20260915'},
        'frontWallOrigins': 'delivered east-edge + street-completion assets (positionGlb/yawRad from collision sidecars)',
    },
    'connectedBand': {
        'from': 'the frozen road\u2019s east wedge end',
        'through': ['128/129 pair midpoint', '130/131 pair midpoint', '132/133 pair midpoint'],
        'to': TAIL_END,
        'centerlineSamplesEveryM': 0.5,
        'widthProfile': f'{WIDTH_START}m at the joint tapering to {WIDTH_TAIL}m over the first {TAPER_S}m, then constant',
        'walkBandNetM': WIDTH_TAIL,
        'noCitywideSlab': True,
        'jointOverlap': 'first 0.4m sits 4mm under the frozen road top so the joint cannot gap or z-fight',
    },
    'clearance': {'requiredEdgeClearanceM': MIN_EDGE_CLEARANCE,
                  'foundationProtrusionM': FOUNDATION_PROTRUSION,
                  'perBuilding': clearance_report},
    'curbs': {'widthM': CURB_W, 'heightM': CURB_H, 'section': 'constant-width section only; the taper zone meets the frozen sidewalk/curb geometry',
              'walkableNote': 'curb tops are walkable (matches frozen walkableLow curb-stone 0.10m language)'},
    'drains': drain_records,
    'manhole': manhole_record,
    'physics': {'groundSource': 'this GLB\u2019s own faces, extracted client-side by GROUND_NODE_RE (sctail__ nodes); visible surface = walkable surface, same source'},
    'route': {
        'extension': 'derived dataset route.json extends mainStreet from entries.east through the pair midpoints to the tail end',
        'tailSamplesEvery2M': [[round(x, 3), round(z, 3)] for (x, z) in center[::4]],
        'tailEnd': [round(center[-1][0], 3), round(center[-1][1], 3)],
    },
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'SCTAIL_READY tris={tris} bytes={bytes_} length={S_TOTAL:.1f}m clearances_pass={len(clearance_report)}')
