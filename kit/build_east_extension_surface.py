"""East-extension street surface + end wall (adoption batch package J, G5).

The east twin of kit/build_west_extension_surface.py: visible asphalt that IS
the physics ground (sctail__ names = the frozen GROUND_NODE_RE walkable set),
curbs + sidewalks riding the road-width transition 4.0 -> 8.5 over the first
8m of arc, lamps every 25m, drains every 40m, and the sample end wall
(11.2 x 3.4 x 0.3, 非历史) perpendicular to the road tangent at x=236.

Junction (J1 hard check): the start cross-section is measured from the BUILT
street-completion surface GLB (vertices near connectedBand.to) so the joint
is seamless BY CONSTRUCTION — edge gap <= 0.02 and top step <= 0.02 (fallback
#4 would allow a <=0.5m transition ramp; not needed when the measured edge
matches). Direction/width blend into the spec frames over the first 6m.

Corridor: capsule-free carriageway at every station against the 9 POST-SETBACK
placeholder boxes (kit/out/east-band/plan.json setbacks). Hard-fails exit 2.

Run:
  blender -b --factory-startup -t 4 -P kit/build_east_extension_surface.py -- \
      --out kit/out/east-band
"""
import argparse
import json
import math
import shutil
import struct
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

SPEC = json.loads((ROOT / 'kit/out/east-extension-spec.json').read_text(encoding='utf-8'))
PLAN = json.loads((ROOT / 'kit/out/east-band/plan.json').read_text(encoding='utf-8'))
TAIL_GLB = ROOT / 'world/street-completion/surface.glb'

SAMPLES = SPEC['samples']            # 0.5m: s, x, z, southNx, southNz, widthM
STEP = 2                             # build on every 2nd sample = 1.0m
G = [(SAMPLES[i], i) for i in range(0, len(SAMPLES), STEP)]
if G[-1][0] is not SAMPLES[-1]:
    G.append((SAMPLES[-1], len(SAMPLES) - 1))
N = len(G)

CURB_W = SPEC['widths']['curbM']           # 0.25
SW_W = SPEC['widths']['frontLineM'] - 4.25 - CURB_W  # paving inside the frontline: 1.10
EASE_M = SPEC['widths']['easeM']           # 8.0 width transition
BLEND_M = 6.0                              # direction/width blend from the measured edge
FRONT = SPEC['widths']['frontLineM']       # 5.6
CURB_H = 0.09
SW_TOP = 0.09
SOFFIT = -0.10
TUCK_S = 0.4
CAPSULE_R = 0.35

JUNCTION = [124.6, 27.65]

# --- measured junction edge from the BUILT street-completion surface -----------
def glb_vertices_near(path, center, radius, mesh_name_contains='asphalt'):
    data = path.read_bytes()
    (json_len,) = struct.unpack_from('<I', data, 12)
    gltf = json.loads(data[20:20 + json_len])
    off = 20 + json_len + 8   # + 8: the BIN chunk header itself
    out = []
    for mesh in gltf.get('meshes', []):
        if mesh_name_contains and mesh_name_contains not in (mesh.get('name') or ''):
            continue
        for prim in mesh.get('primitives', []):
            pos_idx = prim.get('attributes', {}).get('POSITION')
            if pos_idx is None:
                continue
            acc = gltf['accessors'][pos_idx]
            bv = gltf['bufferViews'][acc['bufferView']]
            start = off + bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
            count = acc['count']
            stride = bv.get('byteStride') or 12
            for i in range(count):
                x, y, z = struct.unpack_from('<fff', data, start + i * stride)
                if (x - center[0]) ** 2 + (z - center[1]) ** 2 <= radius * radius:
                    out.append((x, y, z))
    return out


near = glb_vertices_near(TAIL_GLB, JUNCTION, 3.0)
if len(near) < 8:
    print('EAST_SURFACE_CHECK_FAIL', json.dumps({'junction': f'only {len(near)} tail vertices within 3.0m'}))
    sys.exit(2)
# the tail's end edge runs DIAGONALLY (the two sides end at different x): the
# road-side corners are the easternmost asphalt vertex on each side of the
# junction's z. Measured on the shipped GLB: north corner (124.94, 25.679),
# south corner (124.26, 29.621) — midpoint lands exactly on connectedBand.to.
JX, JZ = JUNCTION
def corner(z_side):
    cand = [v for v in near if (v[2] - JZ) * z_side > 0.1]
    if not cand:
        return None
    best = max(cand, key=lambda v: v[0])
    tops = [v for v in cand if abs(v[0] - best[0]) < 0.01 and v[1] > -0.05]
    return max(tops, key=lambda v: v[1]) if tops else best


north_c = corner(-1)
south_c = corner(1)
if not north_c or not south_c:
    print('EAST_SURFACE_CHECK_FAIL', json.dumps({'junction': 'end-edge corners not found'}))
    sys.exit(2)
edge_pts = [north_c, south_c]
edge_mid = [(north_c[0] + south_c[0]) / 2, 0.0, (north_c[2] + south_c[2]) / 2]
edge_y = max(north_c[1], south_c[1])
edx, edz = south_c[0] - north_c[0], south_c[2] - north_c[2]
Lq = math.hypot(edx, edz)
edge_dir = [edx / Lq, edz / Lq]   # cross-section unit, north -> south (+z dominant)
edge_hw = Lq / 2
# orient the edge direction like the spec normal at s=0 (antiparallel frames
# would collapse the blend vector at t=0.5)
_n0 = SAMPLES[0]
if edge_dir[0] * _n0['southNx'] + edge_dir[1] * _n0['southNz'] < 0:
    edge_dir = [-edge_dir[0], -edge_dir[1]]

junction_check = {
    'tailEdgeMidXZ': [round(edge_mid[0], 4), round(edge_mid[2], 4)],
    'tailEdgeHalfWidthM': round(edge_hw, 4),
    'tailEdgeTopY': round(edge_y, 4),
    'centerOffsetM': round(math.hypot(edge_mid[0] - JUNCTION[0], edge_mid[2] - JUNCTION[1]), 4),
    'centerOffsetPass': math.hypot(edge_mid[0] - JUNCTION[0], edge_mid[2] - JUNCTION[1]) <= 0.02,
    'widthVsSpecM': round(abs(edge_hw * 2 - SPEC['widths']['startWidthM']), 4),
    'widthPass': abs(edge_hw * 2 - SPEC['widths']['startWidthM']) <= 0.02,
    'topStepM': round(abs(edge_y - 0.0), 4),
    'topStepPass': abs(edge_y - 0.0) <= 0.02,
    'note': 'start cross-section = measured tail end edge; direction blends into the spec frames over 6m',
}
if not (junction_check['centerOffsetPass'] and junction_check['widthPass'] and junction_check['topStepPass']):
    print('EAST_SURFACE_CHECK_FAIL', json.dumps({'junction': junction_check}))
    sys.exit(2)

# --- post-setback placeholder boxes (plan.json setbacks) ------------------------
BOXES = []
for sb in PLAN['setbacks']:
    if 'glbPoint' not in sb:
        continue
    ph = next(q for q in json.loads((ROOT / 'world/fangbang-temple-v3/blocks.json').read_text())['placeholders']
              if q['id'] == sb['id'])
    BOXES.append({'id': sb['id'], 'x': sb['glbPoint'][0], 'z': sb['glbPoint'][1],
                  'theta': ph['angleRad'], 'hw': ph['widthM'] / 2, 'hd': ph['depthM'] / 2,
                  'adjusted': True})


def obb_dist(px, pz, b):
    dx, dz = px - b['x'], pz - b['z']
    lx = math.cos(b['theta']) * dx - math.sin(b['theta']) * dz
    lz = math.sin(b['theta']) * dx + math.cos(b['theta']) * dz
    return math.hypot(max(abs(lx) - b['hw'], 0.0), max(abs(lz) - b['hd'], 0.0))


# --- corridor check: capsule-free carriageway at every station ------------------
def corridor(px, pz, nx, nz, hw):
    clear = []
    for k in range(-85, 86):
        t = k * 0.05
        if abs(t) > hw:
            clear.append(False)
            continue
        qx, qz = px + nx * t, pz + nz * t
        clear.append(all(obb_dist(qx, qz, b) > CAPSULE_R + 0.02 for b in BOXES))
    best = cur = 0
    for c in clear:
        cur = cur + 1 if c else 0
        best = max(best, cur)
    return best * 0.05


corridor_min = 1e9
for q, _ in G:
    w = corridor(q['x'], q['z'], q['southNx'], q['southNz'], q['widthM'] / 2)
    corridor_min = min(corridor_min, w)
CORRIDOR_MIN_M = 3.6   # carriageway half >= 1.8m each side of the centerline once boxes sit behind the front line
corridor_pass = corridor_min >= CORRIDOR_MIN_M
print('EAST_SURFACE_CORRIDOR_MIN', round(corridor_min, 2))

fail = {}
if not corridor_pass:
    fail['corridor'] = {'minM': round(corridor_min, 2), 'requiredM': CORRIDOR_MIN_M}
if fail:
    print('EAST_SURFACE_CHECK_FAIL', json.dumps(fail))
    sys.exit(2)

# ---- cross-section frames -------------------------------------------------------
def smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def frames():
    """per-station: center(x,z), south normal, road half-width, curb w, sw w"""
    out = []
    for q, _ in G:
        t = smoothstep(q['s'] / BLEND_M)
        # blended south normal: measured tail edge direction -> spec normal
        nx = edge_dir[0] * (1 - t) + q['southNx'] * t
        nz = edge_dir[1] * (1 - t) + q['southNz'] * t
        nL = math.hypot(nx, nz) or 1.0
        nx, nz = nx / nL, nz / nL
        cx = edge_mid[0] * (1 - t) + q['x'] * t
        cz = edge_mid[2] * (1 - t) + q['z'] * t
        hw = q['widthM'] / 2
        ramp = smoothstep(q['s'] / EASE_M)
        curb_w = CURB_W * ramp
        sw_w = (SW_W + CURB_W) * ramp
        out.append({'s': q['s'], 'x': cx, 'z': cz, 'nx': nx, 'nz': nz,
                    'hw': hw, 'curbW': curb_w, 'swW': sw_w})
    return out


FR = frames()

# ---- geometry -----------------------------------------------------------------
L.reset_scene()
L.build_materials()
L.GROUP = 'sctail'

# asphalt slab (top + soffit + both side faces + end caps)
top = []
for f in FR:
    y = -0.004 if f['s'] < TUCK_S else 0.0
    top.append((f['x'] - f['nx'] * f['hw'], y, f['z'] - f['nz'] * f['hw']))
    top.append((f['x'] + f['nx'] * f['hw'], y, f['z'] + f['nz'] * f['hw']))
bot = [(x, SOFFIT, z) for (x, y, z) in top]
faces = []
for i in range(N - 1):
    a, b, c, d = 2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2
    faces += [(a, b, c, d), (a + 2 * N, d + 2 * N, c + 2 * N, b + 2 * N),
              (a, d, d + 2 * N, a + 2 * N), (b + 2 * N, c + 2 * N, c, b)]
faces += [(0, 2 * N, 2 * N + 1, 1), (2 * N - 2, 2 * N - 1, 4 * N - 1, 4 * N - 2)]
L.mesh('eastext-asphalt', top + bot, faces, 'road')

# sidewalks: hw+curb .. hw+curb+sw (ramped in over the ease zone; zero width
# at the junction so the cross-section matches the bare tail edge)
for side in (-1, 1):
    topv, botv = [], []
    for f in FR:
        w_in = f['hw'] + f['curbW']
        w_out = f['hw'] + f['curbW'] + f['swW']
        ix, iz = f['x'] + f['nx'] * side * w_in, f['z'] + f['nz'] * side * w_in
        ox, oz = f['x'] + f['nx'] * side * w_out, f['z'] + f['nz'] * side * w_out
        topv.append((ix, SW_TOP, iz)); topv.append((ox, SW_TOP, oz))
        botv.append((ix, 0.0, iz)); botv.append((ox, 0.0, oz))
    sf = []
    for i in range(N - 1):
        a, b, c, d = 2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2
        sf += [(a, b, c, d), (a + 2 * N, d + 2 * N, c + 2 * N, b + 2 * N),
               (a, d, d + 2 * N, a + 2 * N), (b + 2 * N, c + 2 * N, c, b)]
    sf += [(0, 2 * N, 2 * N + 1, 1), (2 * N - 2, 2 * N - 1, 4 * N - 1, 4 * N - 2)]
    L.mesh(f'eastext-sidewalk-{"n" if side < 0 else "s"}', topv + botv, sf, 'stone')

# curbs: hw .. hw+curb, 0.09 top (ramped in with the sidewalks)
cv, cf = [], []
vb = 0
for side in (-1, 1):
    ringI, ringO = [], []
    for f in FR:
        if f['curbW'] <= 1e-4:
            ringI.append((f['x'] + f['nx'] * side * f['hw'], CURB_H, f['z'] + f['nz'] * side * f['hw']))
            ringO.append((f['x'] + f['nx'] * side * f['hw'], CURB_H, f['z'] + f['nz'] * side * f['hw']))
            continue
        ringI.append((f['x'] + f['nx'] * side * f['hw'], CURB_H, f['z'] + f['nz'] * side * f['hw']))
        ringO.append((f['x'] + f['nx'] * side * (f['hw'] + f['curbW']), CURB_H, f['z'] + f['nz'] * side * (f['hw'] + f['curbW'])))
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
L.mesh('eastext-curb', cv, cf, 'stone')

# lamps every 25m (alternating sides), iron pole + arm + glass head
lamp_records = []
for k, s_target in enumerate(range(25, int(G[-1][0]["s"]), 25)):
    f = min(FR, key=lambda r: abs(r['s'] - s_target))
    side = 1 if k % 2 == 0 else -1
    bx = f['x'] + f['nx'] * side * (f['hw'] + f['curbW'] + f['swW'] / 2)
    bz = f['z'] + f['nz'] * side * (f['hw'] + f['curbW'] + f['swW'] / 2)
    L.cyl(f'eastext-lamp-pole-{k}', (bx, 0.0, bz), (bx, 3.2, bz), 0.05, 'iron', 8)
    axx, azz = f['nx'] * side, f['nz'] * side
    L.cyl(f'eastext-lamp-arm-{k}', (bx, 3.2, bz), (bx - axx * 0.7, 3.35, bz - azz * 0.7), 0.035, 'iron', 6)
    L.box(f'eastext-lamp-head-{k}', (bx - axx * 0.85, 3.28, bz - azz * 0.85), (0.18, 0.14, 0.18), 'glass', 0)
    lamp_records.append({'stationS': round(f['s'], 1), 'side': 'south' if side > 0 else 'north',
                         'x': round(bx, 3), 'z': round(bz, 3),
                         'basis': 'every 25m from the junction, alternating sides, mid-sidewalk (design)'})

# drains every 40m at the south kerb line
drain_records = []
for k, s_target in enumerate(range(40, int(G[-1][0]["s"]), 40)):
    f = min(FR, key=lambda r: abs(r['s'] - s_target))
    cx, cz = f['x'] + f['nx'] * (f['hw'] - 0.35), f['z'] + f['nz'] * (f['hw'] - 0.35)
    L.box(f'eastext-drain-{k}', (cx, -0.025, cz), (0.42, 0.05, 0.30), 'stone', 0)
    drain_records.append({'stationS': round(f['s'], 1), 'x': round(cx, 3), 'z': round(cz, 3),
                          'basis': 'south kerb line, 0.35m inboard, every 40m (design)'})

# ---- finalize surface -----------------------------------------------------------
outdir = args.out / 'east-extension'
design = {
    'family': 'fangbang-east-extension-surface',
    'sampleId': 'eastext',
    'frontageM': round(G[-1][0]['s'], 2),
    'buildStepM': G[1][0]['s'] - G[0][0]['s'],
    'band': {'roadCurbToCurbStartM': 4.0, 'roadCurbToCurbFullM': 8.5, 'easeM': EASE_M,
             'curbW': CURB_W, 'curbH': CURB_H, 'sidewalkBandM': 1.35, 'frontLineM': FRONT,
             'junctionMeasuredEdgeHalfWidthM': round(edge_hw, 4)},
    'junction': junction_check,
    'corridor': {'minFreeM': round(corridor_min, 2), 'capsuleR': CAPSULE_R,
                 'rule': '>=3.6m (carriageway clear; boxes behind the 5.6m front line)'},
    'groundNodeNames': ['sctail__quiet-gray-asphalt', 'sctail__worn-stone'],
    'groundNodeNote': 'paving/curb/drains join into sctail__worn-stone; the sctail__ prefix family is the registered GROUND_NODE_RE walkable set',
    'physics': 'visible faces ARE the walkable ground via GROUND_NODE_RE; no invisible slab',
    'surveyed': False,
}
tris, bytes_ = L.finalize('eastext', outdir, design)
(outdir / 'surface-spec.json').write_text(json.dumps({
    'schemaVersion': 1,
    'generatedBy': 'kit/build_east_extension_surface.py',
    'inputs': {'centerline': 'kit/out/east-extension-spec.json (OSM 238219464 design reuse)',
               'junctionEdge': 'measured from world/street-completion/surface.glb vertices near [124.6, 27.65]',
               'postSetbackBoxes': 'kit/out/east-band/plan.json setbacks'},
    'design': design,
    'lamps': lamp_records,
    'drains': drain_records,
    'endWall': SPEC['widths'],
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# ---- end wall (separate GLB, own group prefix) -----------------------------------
L.reset_scene()
L.build_materials()
L.GROUP = 'eastseal'
W = {'widthM': 11.2, 'heightM': 3.4, 'thicknessM': 0.3, 'label': '样段端墙，非历史'}
end = FR[-1]
wx, wz = end['x'] + end['nx'] * 0.0, end['z'] + end['nz'] * 0.0
ux, uz = end['nx'], end['nz']            # along-wall direction = cross-section normal
vx, vz = -end['nz'], end['nx']           # thickness direction = road tangent
theta_e = math.atan2(ux, uz)             # obb local z maps to the along-wall direction
hw2, ht, h = W['widthM'] / 2, W['thicknessM'] / 2, W['heightM']


def corner(a, b, y):
    return (wx + ux * a + vx * b, y, wz + uz * a + vz * b)


vs = [corner(-hw2, -ht, 0.0), corner(hw2, -ht, 0.0), corner(hw2, ht, 0.0), corner(-hw2, ht, 0.0),
      corner(-hw2, -ht, h), corner(hw2, -ht, h), corner(hw2, ht, h), corner(-hw2, ht, h)]
fs = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
L.mesh('eastext-end-wall', vs, fs, 'dark')

wall_tris, wall_bytes = L.finalize('eastseal', args.out / 'east-seal-wall', {
    'family': 'fangbang-east-extension-end-wall',
    'label': W['label'],
    'at': [round(wx, 4), round(wz, 4)],
    'orientation': 'perpendicular to the road tangent at the x=236 clip (long axis along the cross-section)',
    'sizeM': [W['widthM'], W['heightM'], W['thicknessM']],
    'obbRecord': {'pos': [round(wx, 6), 0.0, round(wz, 6)], 'theta': round(theta_e, 8),
                  'center': [0.0, h / 2, 0.0],
                  'size': [W['thicknessM'], W['heightM'], W['widthM']],
                  'note': 'thickness on local x, length on local z — obbToWorld maps local z to the cross-section direction at theta'},
    'surveyed': False,
})
shutil.copyfile(args.out / 'east-seal-wall' / 'model.glb', outdir / 'seal-wall.glb')

hx = abs(vx) * ht + abs(ux) * hw2
hz = abs(vz) * ht + abs(uz) * hw2
(outdir / 'collision.json').write_text(json.dumps({
    'axis': 'glTF Y-up; world-space records consumed by src/world/collisionAdapter',
    'colliders': [{
        'name': 'eastext-seal-wall:seal-wall', 'group': 'eastext-seal-wall:seal-wall', 'type': 'box',
        'min': [round(wx - hx, 4), 0.0, round(wz - hz, 4)],
        'max': [round(wx + hx, 4), round(h, 4), round(wz + hz, 4)],
        'obb': {'pos': [round(wx, 6), 0.0, round(wz, 6)], 'theta': round(theta_e, 8),
                'center': [0.0, h / 2, 0.0],
                'size': [W['thicknessM'], W['heightM'], W['widthM']]},
    }],
    'surfaceGroundColliders': False,
    'note': 'the surface needs no wall colliders: its visible faces are the ground trimesh (GROUND_NODE_RE); the end wall is the only solid here',
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print(f'EAST_SURFACE_READY tris={tris} wall_tris={wall_tris} bytes={bytes_} wall_bytes={wall_bytes} '
      f'corridor_min={corridor_min:.2f} length={G[-1][0]["s"]:.1f}m junction={json.dumps(junction_check)}')
