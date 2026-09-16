"""West-extension street surface + seal wall (fangbang-temple bridge batch).

Line-by-line continuation of kit/build_street_completion_surface.py (S3,
validated): visible pavement that IS the physics ground via GROUND_NODE_RE.
The centerline comes from kit/out/fangbang-temple/west-extension-spec.json
(N1, 0.5m samples, chaikin-smoothed). Geometry is built on a 1.0m decimated
step (constant widths; tris stay inside the 8000 budget).

Section (design, same family as the verified street): roadway 8.5m
curb-to-curb, curbs 0.25m wide x 0.09m high, sidewalks 1.35m (frontline 5.6m
from the centerline). The measured frozen cut width is 8.50m so the junction
needs no taper. First 0.4m is tucked 4mm under the frozen road/paving tops
(S3 joint rule; frozen tops measured y=0 road / y=0.09 paving).

Forecourt joint (DESIGN_SPEC.westExtension.forecourtJoint): the temple
forecourt top is y=0.00 (measured from world/temple-dadian/ground.glb), so
the north sidewalk top ramps 0.09 -> 0.005 (step <= 0.02) across the
forecourt x-band; the sidewalk never extends north of the frontline.

Clearance checks (S3 rule adapted, DESIGN_SPEC.placeholders.frontSetback):
map placeholders 153..171 minus the temple-replaced {167,169} stand as
rotated boxes (BlockManager placeholderCollider semantics). Per-shop
centerline distance is REPORTED (intrusions are expected map residuals and
are recorded, never moved); the HARD gate is the capsule-free corridor
(>= 1.9m = 1.2m net + 2 x 0.35m capsule) at every centerline station.
Hard-fails exit 2.

Run:
  blender -b --factory-startup -t 4 -P kit/build_west_extension_surface.py -- \
      --out kit/out/fangbang-temple
"""
import argparse
import json
import math
import shutil
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
ROOT = HERE.parent
TASK = ROOT.parent                # the batch dir itself holds DESIGN_SPEC.json

SPEC = json.loads((ROOT / 'kit/out/fangbang-temple/west-extension-spec.json').read_text(encoding='utf-8'))
DS = json.loads((TASK / 'DESIGN_SPEC.json').read_text(encoding='utf-8'))
MAP = json.loads(Path(DS['mapRegistration']['mapSource']).read_text(encoding='utf-8'))

SAMPLES = SPEC['samples']            # 0.5m: s, x, z, southNx, southNz
STEP = 2                             # build on every 2nd sample = 1.0m
G = [(SAMPLES[i], i) for i in range(0, len(SAMPLES), STEP)]
if G[-1][0] is not SAMPLES[-1]:
    G.append((SAMPLES[-1], len(SAMPLES) - 1))
N = len(G)

ROAD_HW = DS['westExtension']['widths']['roadCurbToCurbM'] / 2        # 4.25
CURB_W = DS['westExtension']['widths']['curbM']                       # 0.25
SW_W = DS['westExtension']['widths']['sidewalkM']                     # 1.35
FRONT = DS['westExtension']['widths']['frontLineM']                   # 5.6
CURB_H = 0.09
SW_TOP = 0.09                     # frozen paving-frontage top (measured)
FORECOURT_TOP = 0.0               # temple ground.glb forecourt top (measured)
JOINT_TOP = 0.005                 # sidewalk top in the forecourt band (step 5mm)
RAMP_S = 4.0                      # total ramp length (2m each side)
SOFFIT = -0.10
TUCK_S = 0.4
CAPSULE_R = 0.35
MIN_NET_BAND = 1.2

# --- temple frame (DESIGN_SPEC) ----------------------------------------------
T = DS['templePlacement']['translationGlb']
YAW = DS['templePlacement']['yawRad']
CY, SY = math.cos(YAW), math.sin(YAW)

def l2w(lx, lz):
    return (T[0] + CY * lx + SY * lz, T[2] - SY * lx + CY * lz)

FC = [l2w(-9, 7), l2w(9, 7)]      # forecourt south edge, world xz

# --- active placeholder boxes (BlockManager rotated-box semantics) -----------
REPLACED = set(DS['placeholders']['replacedByTempleAxis'])
BOXES = []
for s in MAP['shops']:
    if s['id'] not in DS['placeholders']['idsInBand'] or s['id'] in REPLACED:
        continue
    BOXES.append({
        'id': s['id'],
        'x': s['point'][0] - 53.5, 'z': s['point'][1] + 17.4,
        'theta': s['angle'], 'hw': s['width'] / 2, 'hd': s['depth'] / 2,
    })

def obb_dist(px, pz, b):
    dx, dz = px - b['x'], pz - b['z']
    lx = math.cos(b['theta']) * dx - math.sin(b['theta']) * dz
    lz = math.sin(b['theta']) * dx + math.cos(b['theta']) * dz
    return math.hypot(max(abs(lx) - b['hw'], 0.0), max(abs(lz) - b['hd'], 0.0))

# --- checks -------------------------------------------------------------------
# (a) per-shop residual report (informational; frontSetback forbids moving)
shop_report = {}
for b in BOXES:
    d = min(obb_dist(q['x'], q['z'], b) for q in SAMPLES)
    cls = 'roadway_intrusion' if d < ROAD_HW else ('sidewalk_band' if d < FRONT else 'clear')
    shop_report[b['id']] = {'minCenterlineToBoxM': round(d, 3), 'class': cls,
                            'handling': 'residual recorded; placeholder not moved (frontSetback)'}

# (b) HARD: capsule-free corridor at every station
def corridor(px, pz, nx, nz):
    """widest contiguous lateral interval around the centerline clear of all
    boxes (expanded by the capsule radius), sampled at 5cm"""
    clear = []
    for k in range(-85, 86):
        t = k * 0.05
        if abs(t) > ROAD_HW:
            clear.append(False)
            continue
        qx, qz = px + nx * t, pz + nz * t
        clear.append(all(obb_dist(qx, qz, b) > CAPSULE_R + 0.02 for b in BOXES))
    best = cur = 0
    run = []
    best_run = []
    for c in clear:
        if c:
            cur += 1
            run.append(c)
            if cur > best:
                best = cur
                best_run = run[:]
        else:
            cur = 0
            run = []
    return best * 0.05

corridor_min = 1e9
for q, _ in G:
    w = corridor(q['x'], q['z'], q['southNx'], q['southNz'])
    corridor_min = min(corridor_min, w)
corridor_pass = corridor_min >= MIN_NET_BAND + 2 * CAPSULE_R

# (c) forecourt joint: find the joint band, then snap the north sidewalk outer
# edge ONTO the forecourt edge inside the band (齐平 by construction, 2m ramps)
def seg_point_dist(a, b, p):
    vx, vz = b[0] - a[0], b[1] - a[1]
    L2 = vx * vx + vz * vz or 1.0
    raw = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / L2
    t = max(0.0, min(1.0, raw))
    return math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vz)), raw

joint = {'forecourtBandS': None, 'rawFrontlineDeviationM': 0.0, 'stepAtJointM': abs(SW_TOP - JOINT_TOP)}
band = []
for q in SAMPLES:
    fx, fz = q['x'] - q['southNx'] * FRONT, q['z'] - q['southNz'] * FRONT
    d, t = seg_point_dist(FC[0], FC[1], (fx, fz))
    if 0.0 <= t <= 1.0:
        joint['rawFrontlineDeviationM'] = max(joint['rawFrontlineDeviationM'], d)
        if d < 0.3:
            band.append(q['s'])
if not band:
    print('WEST_SURFACE_CHECK_FAIL', json.dumps({'forecourtJoint': 'no frontline band within 0.3m of the forecourt edge'}))
    sys.exit(2)
joint['forecourtBandS'] = [round(min(band), 1), round(max(band), 1)]

s0, s1 = joint['forecourtBandS']
RAMP_J = 2.0
north_outer = []
for q in SAMPLES:
    fx, fz = q['x'] - q['southNx'] * FRONT, q['z'] - q['southNz'] * FRONT
    d, t = seg_point_dist(FC[0], FC[1], (fx, fz))
    tc = max(0.0, min(1.0, t))
    proj = (FC[0][0] + tc * (FC[1][0] - FC[0][0]), FC[0][1] + tc * (FC[1][1] - FC[0][1]))
    if s0 - RAMP_J <= q['s'] <= s1 + RAMP_J:
        if q['s'] < s0:
            k = (q['s'] - (s0 - RAMP_J)) / RAMP_J
        elif q['s'] > s1:
            k = ((s1 + RAMP_J) - q['s']) / RAMP_J
        else:
            k = 1.0
        north_outer.append((fx + (proj[0] - fx) * k, fz + (proj[1] - fz) * k))
    else:
        north_outer.append((fx, fz))
snap_dev = max(seg_point_dist(FC[0], FC[1], north_outer[i])[0]
               for i, q in enumerate(SAMPLES) if s0 <= q['s'] <= s1)
joint['maxSnappedDeviationM'] = round(snap_dev, 4)
joint_pass = snap_dev <= 0.02

fail = {}
if not corridor_pass:
    fail['corridor'] = {'minM': round(corridor_min, 2), 'requiredM': MIN_NET_BAND + 2 * CAPSULE_R}
if not joint_pass:
    fail['forecourtJoint'] = joint
print('WEST_SURFACE_SHOPS', json.dumps(shop_report))
print('WEST_SURFACE_CORRIDOR_MIN', round(corridor_min, 2), 'forecourt', json.dumps(joint))
if fail:
    print('WEST_SURFACE_CHECK_FAIL', json.dumps(fail))
    sys.exit(2)

def sw_top(s):
    """north sidewalk top height with the forecourt ramps"""
    s0, s1 = joint['forecourtBandS']
    if s0 - RAMP_S / 2 <= s <= s1 + RAMP_S / 2:
        edge = min(s - (s0 - RAMP_S / 2), (s1 + RAMP_S / 2) - s)
        if edge >= RAMP_S:
            return JOINT_TOP
        k = max(0.0, min(1.0, edge / RAMP_S))
        return SW_TOP + (JOINT_TOP - SW_TOP) * k
    return SW_TOP

# ---- geometry -----------------------------------------------------------------
L.reset_scene()
L.build_materials()
L.GROUP = 'sctail'

# asphalt slab (S3 pattern: top + soffit + both side faces + end caps)
top = []
for q, _ in G:
    hw = ROAD_HW
    y = -0.004 if q['s'] < TUCK_S else 0.0
    top.append((q['x'] - q['southNx'] * hw, y, q['z'] - q['southNz'] * hw))
    top.append((q['x'] + q['southNx'] * hw, y, q['z'] + q['southNz'] * hw))
bot = [(x, SOFFIT, z) for (x, y, z) in top]
faces = []
for i in range(N - 1):
    a, b, c, d = 2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2
    faces += [(a, b, c, d), (a + 2 * N, d + 2 * N, c + 2 * N, b + 2 * N),
              (a, d, d + 2 * N, a + 2 * N), (b + 2 * N, c + 2 * N, c, b)]
faces += [(0, 2 * N, 2 * N + 1, 1), (2 * N - 2, 2 * N - 1, 4 * N - 1, 4 * N - 2)]
L.mesh('westext-asphalt', top + bot, faces, 'road')

# sidewalks: slab 4.5..5.6 from the centerline (north outer edge snapped to
# the forecourt inside the joint band), top + outer face + end caps
for side in (-1, 1):
    topv, botv = [], []
    for q, si in G:
        y = sw_top(q['s']) if side == -1 else SW_TOP
        # north side (side=-1) carries the forecourt ramp + snap
        nox, noz = north_outer[si] if side == -1 else (None, None)
        ox = nox if side == -1 else q['x'] + q['southNx'] * FRONT
        oz = noz if side == -1 else q['z'] + q['southNz'] * FRONT
        ix = q['x'] + q['southNx'] * side * (ROAD_HW + CURB_W)
        iz = q['z'] + q['southNz'] * side * (ROAD_HW + CURB_W)
        topv.append((ix, y, iz))
        topv.append((ox, y, oz))
        botv.append((ix, 0.0, iz))
        botv.append((ox, 0.0, oz))
    sf = []
    for i in range(N - 1):
        a, b, c, d = 2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2
        sf += [(a, b, c, d),                                # top
               (a + 2 * N, d + 2 * N, c + 2 * N, b + 2 * N),  # outer face (bot ring)
               (a, d, d + 2 * N, a + 2 * N), (b + 2 * N, c + 2 * N, c, b)]
    sf += [(0, 2 * N, 2 * N + 1, 1), (2 * N - 2, 2 * N - 1, 4 * N - 1, 4 * N - 2)]
    # stone (worn-stone) so the sidewalk joins sctail__worn-stone = GROUND:
    # paving-frontage is NOT in the frozen GROUND_NODE_RE, and the sidewalk
    # top (0.09) must be walkable, not a 9cm step over unregistered geometry
    L.mesh(f'westext-sidewalk-{"n" if side < 0 else "s"}', topv + botv, sf, 'stone')

# curbs (S3 strip method), constant 0.09 top, 0.25 wide at the roadway edge
cv, cf = [], []
vb = 0
for side in (-1, 1):
    ringI, ringO = [], []
    for q, _ in G:
        ringI.append((q['x'] + q['southNx'] * side * ROAD_HW, CURB_H, q['z'] + q['southNz'] * side * ROAD_HW))
        ringO.append((q['x'] + q['southNx'] * side * (ROAD_HW + CURB_W), CURB_H, q['z'] + q['southNz'] * side * (ROAD_HW + CURB_W)))
    m = len(ringI)
    verts4 = (ringI + ringO
              + [(x, 0.0, z) for (x, y, z) in ringO]
              + [(x, 0.0, z) for (x, y, z) in ringI])
    cv += verts4
    for i in range(m - 1):
        it0, it1 = vb + i, vb + i + 1
        ot0, ot1 = vb + m + i, vb + m + i + 1
        ob0, ob1 = vb + 2 * m + i, vb + 2 * m + i + 1
        ib0, ib1 = vb + 3 * m + i, vb + 3 * m + i + 1
        cf += [(it0, ot0, ot1, it1), (ot0, ob0, ob1, ot1), (it1, ib1, ib0, it0)]
    cf += [(vb, vb + 3 * m, vb + 2 * m, vb + m), (vb + m - 1, vb + 2 * m - 1, vb + 3 * m - 1, vb + 4 * m - 1)]
    vb += 4 * m
L.mesh('westext-curb', cv, cf, 'stone')

# lamps every 25m (alternating sides), simple iron pole + arm + glass head
lamp_records = []
for k, s_target in enumerate(range(25, int(G[-1][0]["s"]), 25)):
    q = min(G, key=lambda r: abs(r[0]['s'] - s_target))[0]
    side = 1 if k % 2 == 0 else -1
    bx = q['x'] + q['southNx'] * side * (ROAD_HW + CURB_W + SW_W / 2)
    bz = q['z'] + q['southNz'] * side * (ROAD_HW + CURB_W + SW_W / 2)
    L.cyl(f'westext-lamp-pole-{k}', (bx, 0.0, bz), (bx, 3.2, bz), 0.05, 'iron', 8)
    ax, az = q['southNx'] * side, q['southNz'] * side
    L.cyl(f'westext-lamp-arm-{k}', (bx, 3.2, bz), (bx - ax * 0.7, 3.35, bz - az * 0.7), 0.035, 'iron', 6)
    L.box(f'westext-lamp-head-{k}', (bx - ax * 0.85, 3.28, bz - az * 0.85), (0.18, 0.14, 0.18), 'glass', 0)
    lamp_records.append({'stationS': round(q['s'], 1), 'side': 'south' if side > 0 else 'north',
                         'x': round(bx, 3), 'z': round(bz, 3),
                         'basis': 'every 25m from the junction, alternating sides, mid-sidewalk (design)'})

# drains every 40m at the south kerb line (S3 basis)
drain_records = []
for k, s_target in enumerate(range(40, int(G[-1][0]["s"]), 40)):
    q = min(G, key=lambda r: abs(r[0]['s'] - s_target))[0]
    cx, cz = q['x'] + q['southNx'] * (ROAD_HW - 0.35), q['z'] + q['southNz'] * (ROAD_HW - 0.35)
    L.box(f'westext-drain-{k}', (cx, -0.025, cz), (0.42, 0.05, 0.30), 'stone', 0)
    drain_records.append({'stationS': round(q['s'], 1), 'x': round(cx, 3), 'z': round(cz, 3),
                          'basis': 'south kerb line, 0.35m inboard (S3 rule), every 40m (design)'})

# ---- finalize surface ----------------------------------------------------------
outdir = args.out / 'west-extension'
design = {
    'family': 'fangbang-west-extension-surface',
    'sampleId': 'westext',
    'frontageM': round(G[-1][0]['s'], 2),
    'buildStepM': G[1][0]['s'] - G[0][0]['s'],
    'band': {'roadCurbToCurbM': ROAD_HW * 2, 'curbW': CURB_W, 'curbH': CURB_H,
             'sidewalkM': SW_W, 'frontLineM': FRONT,
             'junctionMeasuredCutWidthM': SPEC['junctionWidthM'],
             'taperM': 0, 'taperNote': 'measured cut width equals the 8.5m design width — no taper'},
    'forecourtJoint': joint,
    'placeholderResiduals': shop_report,
    'corridor': {'minFreeM': round(corridor_min, 2), 'capsuleR': CAPSULE_R, 'rule': '>=1.9m (1.2 net + 2r) at every station'},
    'groundNodeNames': ['sctail__quiet-gray-asphalt', 'sctail__worn-stone'],
    'groundNodeNote': 'paving/curb/drains join into sctail__worn-stone; the sctail__ prefix family is the registered GROUND_NODE_RE walkable set (collisionAdapter.js is frozen — no new prefix)',
    'physics': 'visible faces ARE the walkable ground via GROUND_NODE_RE; no invisible slab',
    'surveyed': False,
}
tris, bytes_ = L.finalize('westext', outdir, design)
(outdir / 'surface-spec.json').write_text(json.dumps({
    'schemaVersion': 1,
    'generatedBy': 'kit/build_west_extension_surface.py',
    'inputs': {'centerline': 'kit/out/fangbang-temple/west-extension-spec.json (N1)',
               'templeFrame': 'DESIGN_SPEC.templePlacement (T + yaw)'},
    'design': design,
    'lamps': lamp_records,
    'drains': drain_records,
    'sealWall': DS['westExtension']['sealWall'],
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# ---- seal wall (separate GLB, own group prefix) --------------------------------
L.reset_scene()
L.build_materials()
L.GROUP = 'westseal'
W = DS['westExtension']['sealWall']
wx, wz = DS['westExtension']['westEndGlb'][0], DS['westExtension']['westEndGlb'][2]
ux, uz = SY, CY                   # along-wall direction = south normal at westEnd
vx, vz = CY, -SY                  # wall thickness direction = road tangent
hw2, ht, h = W['widthM'] / 2, W['thicknessM'] / 2, W['heightM']

def corner(a, b, y):
    return (wx + ux * a + vx * b, y, wz + uz * a + vz * b)

vs = [corner(-hw2, -ht, 0.0), corner(hw2, -ht, 0.0), corner(hw2, ht, 0.0), corner(-hw2, ht, 0.0),
      corner(-hw2, -ht, h), corner(hw2, -ht, h), corner(hw2, ht, h), corner(-hw2, ht, h)]
fs = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
L.mesh('westext-seal-wall', vs, fs, 'dark')

wall_tris, wall_bytes = L.finalize('westseal', args.out / 'west-seal', {
    'family': 'fangbang-west-extension-seal-wall',
    'label': W['label'],
    'at': DS['westExtension']['westEndGlb'],
    'orientation': 'perpendicular to the road tangent (long axis along the south normal)',
    'sizeM': [W['widthM'], W['heightM'], W['thicknessM']],
    'obbRecord': {'pos': [wx, 0.0, wz], 'theta': YAW, 'center': [0.0, h / 2, 0.0],
                  'size': [W['thicknessM'], W['heightM'], W['widthM']],
                  'note': 'thickness on local x, length on local z — obbToWorld maps local z to the south normal at theta=yaw'},
    'surveyed': False,
})
# ship the wall GLB next to the surface under the dataset-facing name
shutil.copyfile(args.out / 'west-seal' / 'model.glb', outdir / 'seal-wall.glb')

# collision sidecar for the wall (world-space obb record + yaw-expanded AABB)
hx = abs(CY) * (W['thicknessM'] / 2) + abs(SY) * (W['widthM'] / 2)
hz = abs(SY) * (W['thicknessM'] / 2) + abs(CY) * (W['widthM'] / 2)
(outdir / 'collision.json').write_text(json.dumps({
    'axis': 'glTF Y-up; world-space records consumed by src/world/collisionAdapter',
    'colliders': [{
        'name': 'westext-seal-wall:seal-wall', 'group': 'westext-seal-wall:seal-wall', 'type': 'box',
        'min': [round(wx - hx, 4), 0.0, round(wz - hz, 4)],
        'max': [round(wx + hx, 4), round(h, 4), round(wz + hz, 4)],
        'obb': {'pos': [wx, 0.0, wz], 'theta': YAW, 'center': [0.0, h / 2, 0.0],
                'size': [W['thicknessM'], W['heightM'], W['widthM']]},
    }],
    'surfaceGroundColliders': False,
    'note': 'the surface needs no wall colliders: its visible faces are the ground trimesh (GROUND_NODE_RE); the seal wall is the only solid here',
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print(f'WEST_SURFACE_READY tris={tris} wall_tris={wall_tris} bytes={bytes_} wall_bytes={wall_bytes} '
      f'corridor_min={corridor_min:.2f} length={G[-1][0]["s"]:.1f}m')
