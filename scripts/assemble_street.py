"""Assemble the 90m Fangbang segment: street kit + 16 storefront instances.

Run inside Blender:
  blender -b --factory-startup -t 4 -P assemble_street.py

Outputs (workspace):
  world/street.glb        assembled segment for review/render (shared mesh data per module)
  world/instances.json    placement table (game-side consumption later)
  world/route.json        walkable route polyline + clearance report
  world/collision-world.json  world-space colliders (rotated module boxes + street kit)
"""
import sys, json, math
from pathlib import Path
import bpy
from mathutils import Vector, Matrix

WS = Path(__file__).resolve().parents[1]
BUILD = WS / 'building'
WORLD = WS / 'world'
sys.path.insert(0, str(BUILD))
import mb_lib as L
from helpers import glb_to_blender

# ---------------------------------------------------------------- layout
FRONT = 5.6          # centerline -> front wall (design)
FRONT_NEIGHBOR = 5.9  # neighbor cobbles protrude +1.62, keep clear of the 4.25 road edge
ROAD_HW = 4.25
END_S = 87.6         # nominal east end; actual ends come from the chain walk
SEG_EXTEND = 2.0     # road ribbon continues past both anchors
BRANCH_GAP = 5.5     # 光启路 mouth width along the main street (design)

MODULE_GLB = {
    'plain-v1': BUILD / 'plain-v1/model.glb',
    'plain-v2': BUILD / 'plain-v2/model.glb',
    'plain-v3': BUILD / 'plain-v3/model.glb',
    'pharmacy_shop': BUILD / 'pharmacy_shop/model.glb',
    'cloth_shop': BUILD / 'cloth_shop/model.glb',
    'curio-a': BUILD / 'curio-a/model.glb',
    'curio-b': BUILD / 'curio-b/model.glb',
    'restaurant-a': BUILD / 'restaurant-a/model.glb',
    'restaurant-b': BUILD / 'restaurant-b/model.glb',
    'cat_corner': BUILD / 'cat_corner/model.glb',
    'corner': BUILD / 'corner/model.glb',
    'photo_shop': BUILD / 'photo_shop/model.glb',
    'dry_goods_shop': BUILD / 'dry_goods_shop/model.glb',
}

# ---------------------------------------------------------------- centerline
seg = json.loads((WORLD / 'segment.json').read_text(encoding='utf-8'))
SAMPLES = seg['samplesMeters']
TOTAL = seg['lengthMeters']


def at(s):
    """Point/tangent/facade-normal at arc length s; extrapolates straight beyond both ends."""
    if s < 0:
        p0 = Vector((SAMPLES[0]['x'], 0, SAMPLES[0]['z']))
        p1 = Vector((SAMPLES[1]['x'], 0, SAMPLES[1]['z']))
        d = (p1 - p0)
        d = Vector((d.x, 0, d.z)).normalized()
        return p0 + d * s, d, Vector((-d.z, 0, d.x))
    if s > TOTAL:
        p0 = Vector((SAMPLES[-2]['x'], 0, SAMPLES[-2]['z']))
        p1 = Vector((SAMPLES[-1]['x'], 0, SAMPLES[-1]['z']))
        d = (p1 - p0)
        d = Vector((d.x, 0, d.z)).normalized()
        return p1 + d * (s - TOTAL), d, Vector((-d.z, 0, d.x))
    for i in range(len(SAMPLES) - 1):
        if SAMPLES[i]['s'] <= s <= SAMPLES[i + 1]['s']:
            t = (s - SAMPLES[i]['s']) / max(1e-9, SAMPLES[i + 1]['s'] - SAMPLES[i]['s'])
            x0, z0 = SAMPLES[i]['x'], SAMPLES[i]['z']
            x1, z1 = SAMPLES[i + 1]['x'], SAMPLES[i + 1]['z']
            px, pz = x0 + (x1 - x0) * t, z0 + (z1 - z0) * t
            dx, dz = x1 - x0, z1 - z0
            ln = math.hypot(dx, dz)
            tx, tz = dx / ln, dz / ln
            fx, fz = -tz, tx
            return Vector((px, 0, pz)), Vector((tx, 0, tz)), Vector((fx, 0, fz))
    raise ValueError(s)


# ---------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.unit_settings.system = 'METRIC'
bpy.context.scene.unit_settings.scale_length = 1
L.META.clear(); L.M.clear(); L.COLL.clear()
L.build_materials()
M = L.M

STREET_COLL = []  # world-space colliders built here (GLB coords, axis-aligned approx after yaw)


def ribbon(pts, half_w, y, mat, tile=(2.0, 2.0), up=True):
    """Horizontal quad strip following pts (Vector xz), width across, at height y."""
    verts, uvs, faces = [], [], []
    acc = 0.0
    prev = None
    for i, p in enumerate(pts):
        if i == 0:
            d = (pts[1] - pts[0])
        else:
            d = (pts[i] - pts[i - 1])
        d = Vector((d.x, 0, d.z))
        if d.length < 1e-6:
            d = Vector((1, 0, 0))
        d.normalize()
        n = Vector((-d.z, 0, d.x))
        if prev is not None:
            acc += (p - prev).length
        prev = p.copy()
        a = p - n * half_w
        b = p + n * half_w
        verts.extend([(a.x, y, a.z), (b.x, y, b.z)])
        uvs.extend([(0.0, acc / tile[1]), (2 * half_w / tile[0], acc / tile[1])])
    for i in range(len(pts) - 1):
        a = i * 2; b = a + 1; c = a + 3; d = a + 2
        faces.append((a, b, c, d) if up else (a, d, c, b))
    return L.mesh('ribbon', verts, faces, mat, uvs)


def wall(pts, h, y0, mat, tile=(2.5, 2.5)):
    """Vertical quad strip along pts (Vector xz), height h from y0. Double-sided."""
    verts, uvs, faces = [], [], []
    acc = 0.0
    prev = None
    for i, p in enumerate(pts):
        if i == 0:
            d = (pts[1] - pts[0])
        else:
            d = (pts[i] - pts[i - 1])
        d = Vector((d.x, 0, d.z))
        if d.length < 1e-6:
            d = Vector((1, 0, 0))
        d.normalize()
        n = Vector((-d.z, 0, d.x))
        if prev is not None:
            acc += (p - prev).length
        prev = p.copy()
        verts.extend([(p.x, y0, p.z), (p.x, y0 + h, p.z)])
        uvs.extend([(acc / tile[0], y0 / tile[1]), (acc / tile[0], (y0 + h) / tile[1])])
    for i in range(len(pts) - 1):
        a = i * 2; b = a + 1; c = a + 3; d = a + 2
        faces.append((a, b, c, d))
        faces.append((a, d, c, b))  # reverse side so the wall shades correctly from both sides
    return L.mesh('wall', verts, faces, mat, uvs)


def solid_thin_wall(p0, p1, h, y0, mat, t=0.06):
    """Oriented thin wall built as two offset single-sided shells (no z-fighting).

    p0/p1: Vector base line; h: height; t: half thickness of each shell offset.
    """
    d = p1 - p0
    d = Vector((d.x, 0, d.z)).normalized()
    e = Vector((-d.z, 0, d.x))  # front side normal
    L0 = p0 + e * t; L1 = p1 + e * t
    B0 = p0 - e * t; B1 = p1 - e * t
    # front shell (faces +e): (L0b, L1b, L1t, L0t)
    f = [(L0.x, y0, L0.z), (L1.x, y0, L1.z), (L1.x, y0 + h, L1.z), (L0.x, y0 + h, L0.z)]
    L.mesh('wall-front', f, [(0, 3, 2, 1)], mat)
    # back shell (faces -e)
    b = [(B0.x, y0, B0.z), (B1.x, y0, B1.z), (B1.x, y0 + h, B1.z), (B0.x, y0 + h, B0.z)]
    L.mesh('wall-back', b, [(0, 1, 2, 3)], mat)
    # top cap
    tp = [(L0.x, y0 + h, L0.z), (L1.x, y0 + h, L1.z), (B1.x, y0 + h, B1.z), (B0.x, y0 + h, B0.z)]
    L.mesh('wall-top', tp, [(0, 1, 2, 3)], mat)


def line_pts(p0, p1, step=2.0):
    n = max(1, int((p1 - p0).length / step))
    return [p0 + (p1 - p0) * (i / n) for i in range(n + 1)]


# ---------------------------------------------------------------- street kit
L.GROUP = 'street-road'
end_a, ta, fa = at(-SEG_EXTEND)
end_b, tb, fb = at(TOTAL + SEG_EXTEND)
road_pts = []
for i in range(int(TOTAL + 2 * SEG_EXTEND) + 1):
    road_pts.append(at(-SEG_EXTEND + i)[0])
ribbon(road_pts, ROAD_HW, 0.0, 'road', tile=(3, 3))

# sidewalks both sides, top +0.09
for side, name in ((-1, 'north'), (1, 'south')):
    pts = []
    for i in range(int(TOTAL + 2 * SEG_EXTEND) + 1):
        p, t, f = at(-SEG_EXTEND + i)
        pts.append(p + f * side * ((ROAD_HW + FRONT) / 2))
    ribbon(pts, (FRONT - ROAD_HW) / 2, 0.09, 'paving', tile=(2.4, 2.4))

# curb stones both edges (low, walkable-bump)
L.GROUP = 'street-curb'
s = 0.0
while s <= TOTAL + SEG_EXTEND:
    for side in (-1, 1):
        p, t, f = at(s)
        c = p + f * side * (ROAD_HW + 0.12)
        yaw = math.atan2(t.x, -t.z)  # align long axis with street tangent (GLB yaw)
        # near-axis-aligned street: use axis-aligned box, tangent within ~18 deg of +X
        L.box('curb-stone', (c.x, .015, c.z), (.72, .10, .24), 'stone', .008)
    s += 3.0

# drains + manhole
L.GROUP = 'street-props'
for s_d, side in ((20.0, -1), (55.0, 1), (75.0, -1)):
    p, t, f = at(s_d)
    c = p + f * side * (ROAD_HW - 0.45)
    L.box('drain-frame', (c.x, .051, c.z), (.40, .025, .40), 'iron', .004)
pm, _, fm = at(62.0)
L.cyl('manhole', (pm.x, -0.02, pm.z), (pm.x, 0.012, pm.z), .34, 'iron', 20)

# ---------------------------------------------------------------- modules
L.GROUP = 'buildings'
protos = {}
for mod, glb in MODULE_GLB.items():
    before_names = set(o.name for o in bpy.context.scene.objects if o.type == 'MESH')
    bpy.ops.import_scene.gltf(filepath=str(glb))
    new_names = [o.name for o in bpy.context.scene.objects
                 if o.type == 'MESH' and o.name not in before_names]
    protos[mod] = []
    for nm in new_names:
        o = bpy.data.objects[nm]
        o.name = f'proto__{mod}__{o.name}'
        protos[mod].append(o.name)
        o.hide_render = True
        o.hide_viewport = True

instances = []
world_colliders = []

MODULE_W = {m: json.loads((BUILD / m / 'measurements.json').read_text(encoding='utf-8'))['design']['frontageM']
            for m in MODULE_GLB}
MODULE_DEPTH = {m: json.loads((BUILD / m / 'measurements.json').read_text(encoding='utf-8'))['design']['depthM']
                for m in MODULE_GLB}


def front_point(s, side):
    """Front-line point for a row: centerline + row-normal * FRONT."""
    p, t, f = at(s)
    return p + f * side * FRONT


def walk_front(s, dist, side):
    """Advance arc length until the front-line chord distance dist is covered (signed)."""
    p0 = front_point(s, side)
    prev_s = s
    acc = 0.0
    step = 0.02 * (1 if dist >= 0 else -1)
    while acc < abs(dist) - 1e-9:
        prev_s = s
        s += step
        acc += (front_point(s, side) - front_point(prev_s, side)).length
    return s, p0, front_point(s, side)


def add_instance(mod, inst_name, pos, theta, side, s0, s1, front_off):
    pos_bl = glb_to_blender((pos.x, 0.0, pos.z))
    mat = Matrix.Translation(pos_bl) @ Matrix.Rotation(theta, 4, 'Z')
    for i, nm in enumerate(protos[mod]):
        ob = bpy.data.objects.new(f'{inst_name}__{i}', bpy.data.objects[nm].data)
        bpy.context.collection.objects.link(ob)
        ob.matrix_world = mat.copy()
    ct, st = math.cos(theta), math.sin(theta)
    # GLB-space yaw about +Y: x' = ct*x + st*z ; z' = -st*x + ct*z ; y unchanged
    R = Matrix(((ct, 0, st), (0, 1, 0), (-st, 0, ct)))
    colj = json.loads((MODULE_GLB[mod].parent / 'collision.json').read_text(encoding='utf-8'))
    for c in colj.get('colliders', []):
        cen = Vector(c['center']); siz = Vector(c['size'])
        lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
        for dx in (-1, 1):
            for dy in (-1, 1):
                for dz in (-1, 1):
                    corner = cen + Vector((dx * siz.x / 2, dy * siz.y / 2, dz * siz.z / 2))
                    wc = R @ corner + pos
                    lo = Vector((min(lo[i], wc[i]) for i in range(3)))
                    hi = Vector((max(hi[i], wc[i]) for i in range(3)))
        world_colliders.append({'name': f"{inst_name}:{c['name']}", 'module': mod,
                                'min': [round(v, 3) for v in lo], 'max': [round(v, 3) for v in hi],
                                'type': 'box',
                                'obb': {'pos': [round(v, 3) for v in pos], 'theta': round(theta, 5),
                                        'center': [round(v, 3) for v in cen], 'size': [round(v, 3) for v in siz]}})
    instances.append({
        'id': inst_name, 'module': mod, 'side': 'north' if side < 0 else 'south',
        'sRange': [round(s0, 3), round(s1, 3)],
        'frontOffsetM': front_off,
        'positionGlb': [round(pos.x, 4), 0.0, round(pos.z, 4)],
        'rotationYRad': round(theta, 5),
        'collisionSource': str((MODULE_GLB[mod].parent / 'collision.json').relative_to(WS)),
    })


def invert_front(point, side):
    """Arc length s whose front-line point is closest to `point` (0.02m scan)."""
    best_s, best_d = 0.0, 1e18
    s = 0.0
    while s <= TOTAL + 10:
        d = (front_point(s, side) - point).length
        if d < best_d:
            best_d, best_s = d, s
        s += 0.02
    return best_s


def place_chain(side, order, s_start=0.0):
    """Chain modules wall-to-wall along the front line.

    order items: ('module', mod, name) | ('gap', width) | ('gap_to', s_abs).
    Returns (s_end, count, last_corner, last_dir): last_corner is the previous
    building's front-right corner in world space so lane gaps can start exactly there.
    """
    s = s_start
    count = 0
    last_corner = front_point(s_start, side)
    last_dir = None
    for item in order:
        if item[0] == 'module':
            _, mod, name = item
            w = MODULE_W[mod]
            off = FRONT_NEIGHBOR if mod in ('photo_shop', 'dry_goods_shop') else FRONT
            s0 = s
            s, pL, pR = walk_front(s, w, side)
            mid = (pL + pR) / 2
            d = pR - pL
            d = Vector((d.x, 0, d.z)).normalized()
            rowdir = Vector((-d.z, 0, d.x)) * side  # centerline -> row
            pos = mid + rowdir.normalized() * (off - FRONT)
            theta = math.atan2(-rowdir.x, -rowdir.z)  # facade faces the street
            count += 1
            add_instance(mod, name, pos, theta, side, s0, s, off)
            last_corner = pR
            last_dir = d
        elif item[0] == 'gap':
            s, _, _ = walk_front(s, item[1], side)
        elif item[0] == 'gap_to':
            s, _, _ = walk_front(s, item[1] - s, side)
    return s, count, last_corner, last_dir


def lane_resume_point(corner, lane_dir, width):
    """Lane mouth far corner: previous corner + lane direction * width."""
    return corner + lane_dir * width


# branch geometry: junction = nearest centerline sample to GLB (12.2, -4.2)
junction_s = min(range(len(SAMPLES)),
                 key=lambda i: (SAMPLES[i]['x'] - 12.2) ** 2 + (SAMPLES[i]['z'] + 4.2) ** 2)
junction_s = SAMPLES[junction_s]['s']
branch_s0, branch_s1 = junction_s - BRANCH_GAP / 2, junction_s + BRANCH_GAP / 2
# photo shop anchor: nearest centerline sample to the map POI (GLB (30.5, 3.4))
photo_s = min(range(len(SAMPLES)),
              key=lambda i: (SAMPLES[i]['x'] - 30.5) ** 2 + (SAMPLES[i]['z'] - 3.4) ** 2)
photo_s = SAMPLES[photo_s]['s']

# ---- north row: chain, lane A gap laid out corner-to-corner between chains
north_a_end, n_count, na_corner, na_dir = place_chain(-1, [
    ('module', 'plain-v1', 'N01-plain-v1'),
    ('module', 'pharmacy_shop', 'N02-pharmacy_shop'),
    ('module', 'cloth_shop', 'N03-cloth_shop'),
    ('module', 'dry_goods_shop', 'N04-dry_goods_shop'),
    ('module', 'restaurant-a', 'N05-restaurant-a'),
])
na_far = lane_resume_point(na_corner, na_dir, 2.0)
north_end, n_count_more, _, _ = place_chain(-1, [
    ('module', 'curio-a', 'N06-curio-a'),
    ('module', 'cat_corner', 'N07-cat_corner'),
    ('module', 'plain-v2', 'N08-plain-v2'),
    ('module', 'curio-b', 'N09-curio-b'),
    ('module', 'plain-v3', 'N10-plain-v3'),
], s_start=invert_front(na_far, -1))
n_count += n_count_more
lane_a_mouth = (na_corner, na_far)

# ---- south row: corner unit, branch mouth (geometric), plaza to the photo anchor,
# then chain with lane B laid out corner-to-corner.
south_corner_end, s_count, sc_corner, sc_dir = place_chain(1, [('module', 'corner', 'S01-corner')])
s_b0, _, _ = walk_front(south_corner_end, branch_s0 - south_corner_end, 1)
s_after_branch, _, _ = walk_front(s_b0, BRANCH_GAP, 1)
plaza_end = photo_s - MODULE_W['photo_shop'] / 2
s_plaza_end, _, _ = walk_front(s_after_branch, plaza_end - s_after_branch, 1)
south_a_end, s_count_more, sa_corner, sa_dir = place_chain(1, [
    ('module', 'photo_shop', 'S02-photo_shop'),
    ('module', 'plain-v2', 'S03-plain-v2'),
    ('module', 'restaurant-b', 'S04-restaurant-b'),
    ('module', 'plain-v3', 'S05-plain-v3'),
], s_start=s_plaza_end)
s_count += s_count_more
sb_far = lane_resume_point(sa_corner, sa_dir, 2.4)
south_end, s_count_more, _, _ = place_chain(1, [
    ('module', 'plain-v2', 'S07-plain-v2'),
], s_start=invert_front(sb_far, 1))
s_count += s_count_more
lane_b_mouth = (sa_corner, sb_far)
# east vacant lot: the south row stops short of the north row's end; close the gap
# with a low demolition-site wall (an honest 1990s condition, not a storefront).
lot_s0, lot_s1 = south_end, north_end
print(f'CHAIN junction_s={junction_s:.2f} branch[{branch_s0:.2f}..{branch_s1:.2f}] photo_s={photo_s:.2f} '
      f'north_end={north_end:.2f} south_end={south_end:.2f}')
print(f'LANE_A mouth {tuple(round(v,2) for v in na_corner)} -> {tuple(round(v,2) for v in na_far)} '
      f'width={na_far and (na_far - na_corner).length:.2f}')
print(f'LANE_B mouth {tuple(round(v,2) for v in sa_corner)} -> {tuple(round(v,2) for v in sb_far)} '
      f'width={(sb_far - sa_corner).length:.2f}')

# ---------------------------------------------------------------- street kit after placement
# branch 光启路: south from the junction
L.GROUP = 'street-branch'
jc, jt, jf = at(junction_s)
br0 = jc + jf * 3.2
br1 = jc + jf * 24.0
ribbon(line_pts(br0, br1, 2.0), 2.75, -0.004, 'road', tile=(3, 3))
for side in (-1, 1):
    for k in range(8):
        off = 5.0 + k * 2.4
        if off > 23.5:
            break
        c = jc + jf * off + jt * side * 2.87
        L.box('branch-curb', (c.x, .015, c.z), (.24, .10, .72), 'stone', .008)

# lanes: floor paving + end wall with closed door; centered on the chained gaps
def inst_by_id(iid):
    return next(i for i in instances if i['id'] == iid)

L.GROUP = 'street-lane'
lane_axes = {}
for lane_id, mouth, side in (('A', lane_a_mouth, -1), ('B', lane_b_mouth, 1)):
    a, b = mouth
    m = (a + b) / 2
    d = b - a
    d = Vector((d.x, 0, d.z)).normalized()
    inward = Vector((-d.z, 0, d.x)) * side  # from street into the lane
    endp = m + inward * 6.5
    lane_axes[lane_id] = (m, inward)
    ribbon(line_pts(m + inward * 0.0, endp, 1.5), (b - a).length / 2, 0.09, 'paving', tile=(2.4, 2.4))
    solid_thin_wall(endp - d * 1.1, endp + d * 1.1, 3.0, 0.09, 'plaster')
    door_c = endp - inward * 0.06
    solid_thin_wall(door_c - d * .6, door_c + d * .6, 2.3, 0.14, 'dark', t=0.03)
    solid_thin_wall(door_c - d * .67, door_c + d * .67, 0.28, 2.44, 'wood', t=0.05)
    STREET_COLL.append({'name': f'lane-{lane_id}-end-wall',
                        'center': [round(endp.x, 3), 1.6, round(endp.z, 3)],
                        'size': [round(abs((endp + d).x - (endp - d).x) + 0.16, 3), 3.1,
                                 round(abs((endp + d).z - (endp - d).z) + 0.16, 3)],
                        'type': 'box', 'axis': 'glTF Y-up'})

# east vacant lot: low demolition-site wall with an opening, crates inside
L.GROUP = 'street-lot'
for s0, s1 in ((lot_s0 + 0.2, lot_s0 + (lot_s1 - lot_s0) * .45),
               (lot_s0 + (lot_s1 - lot_s0) * .62, lot_s1 - 0.2)):
    a, _, fa_ = at(s0)
    b, _, fb_ = at(s1)
    wa = a + fa_ * FRONT
    wb = b + fb_ * FRONT
    solid_thin_wall(wa, wb, 1.1, 0.0, 'brick')
    c = (wa + wb) / 2
    STREET_COLL.append({'name': 'lot-front-wall', 'center': [round(c.x, 3), 0.6, round(c.z, 3)],
                        'size': [abs(wb.x - wa.x) + 0.16, 1.2, abs(wb.z - wa.z) + 0.16], 'type': 'box', 'axis': 'glTF Y-up'})
for s_c, off in ((lot_s0 + 1.6, 7.2), (lot_s1 - 1.8, 7.6)):
    p, t, f = at(s_c)
    c = p + f * off
    for k in range(3):
        L.box('lot-crate', (c.x + (k % 2) * .62, .3 + (k // 2) * .62, c.z), (.6, .6, .6), 'wood', .012)
    L.box('lot-crate-flat', (c.x + .3, .06, c.z + .65), (.9, .12, .7), 'wood', .01)

# plaza: paving, low back wall with two gaps, two lampposts
L.GROUP = 'street-plaza'
pl0, pl1 = s_after_branch, s_plaza_end
pl_pts = []
n_pl = max(2, int(pl1 - pl0))
for i in range(n_pl + 1):
    p, t, f = at(pl0 + (pl1 - pl0) * i / n_pl)
    pl_pts.append(p + f * ((FRONT + 10.2) / 2))
ribbon(pl_pts, (10.2 - FRONT) / 2, 0.07, 'paving', tile=(2.4, 2.4))
gap1a, gap1b = pl0 + (pl1 - pl0) * .24, pl0 + (pl1 - pl0) * .32
gap2a, gap2b = pl0 + (pl1 - pl0) * .68, pl0 + (pl1 - pl0) * .76
for s0, s1 in ((pl0, gap1a), (gap1b, gap2a), (gap2b, pl1)):
    a, _, fa_ = at(s0)
    b, _, fb_ = at(s1)
    wa = a + fa_ * 10.2
    wb = b + fb_ * 10.2
    solid_thin_wall(wa, wb, 0.9, 0.07, 'brick')
    solid_thin_wall(wa, wb, 0.08, 0.97, 'stone', t=0.09)  # stone cap finishes the top
    c = (wa + wb) / 2
    STREET_COLL.append({'name': 'plaza-back-wall', 'center': [c.x, 0.52, c.z],
                        'size': [abs(wb.x - wa.x) + 0.2, 0.95, abs(wb.z - wa.z) + 0.2], 'type': 'box', 'axis': 'glTF Y-up'})
for frac in (0.12, 0.88):
    p, t, f = at(pl0 + (pl1 - pl0) * frac)
    c = p + f * 6.4
    L.cyl('lamp-pole', (c.x, .09, c.z), (c.x, 4.2, c.z), .055, 'iron', 8)
    L.cyl('lamp-head', (c.x, 4.2, c.z), (c.x, 4.45, c.z), .12, 'gold', 8)
    L.box('lamp-arm', (c.x, 4.32, c.z), (.1, .1, .5), 'iron', .008)

# hide/delete proto source objects (mesh data survives via linked duplicates)
for mod, names in protos.items():
    for nm in names:
        if nm in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[nm], do_unlink=True)

# ---------------------------------------------------------------- route
def obb_distance(q, obb):
    """Exact point-to-rotated-box distance in GLB space."""
    px, py, pz = q
    ox, oy, oz = obb['pos']
    dx, dz = px - ox, pz - oz
    ct, st = math.cos(obb['theta']), math.sin(obb['theta'])
    lx = ct * dx - st * dz - obb['center'][0]
    ly = py - oy - obb['center'][1]
    lz = st * dx + ct * dz - obb['center'][2]
    sx = [obb['size'][0] / 2, obb['size'][1] / 2, obb['size'][2] / 2]
    ddx = max(abs(lx) - sx[0], 0)
    ddy = max(abs(ly) - sx[1], 0)
    ddz = max(abs(lz) - sx[2], 0)
    return math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz)


def clearance_report(route_pts, colliders, radius=0.35, summary=None):
    worst = []
    for seg_i in range(len(route_pts) - 1):
        a, b = route_pts[seg_i], route_pts[seg_i + 1]
        ln = (b - a).length
        steps = max(1, int(ln / 0.5))
        for k in range(steps + 1):
            q = a + (b - a) * (k / steps)
            for col in colliders:
                if 'obb' in col:
                    d = obb_distance(q, col['obb'])
                    hit = d <= radius
                else:
                    mn = Vector(col['min']); mx = Vector(col['max'])
                    ex_mn = mn - Vector((radius, radius, radius))
                    ex_mx = mx + Vector((radius, radius, radius))
                    hit = all(ex_mn[i] <= q[i] <= ex_mx[i] for i in range(3))
                    d = 0.0
                    if hit:
                        for i in range(3):
                            d = max(d, max(mn[i] - q[i], q[i] - mx[i], 0.0))
                        hit = d <= radius
                if hit:
                    worst.append({'point': [round(v, 2) for v in q], 'collider': col['name'],
                                  'distance': round(d, 3)})
                    if summary is not None:
                        summary[col['name']] = summary.get(col['name'], 0) + 1
    return worst


def flank_midline(left_inst, left_x_local, right_inst, right_x_local, depths):
    """Midline between two flanking walls (world space), sampled at local depths.
    left/right = instances flanking a lane; x_local = flank wall's local x on that wall."""
    out = {'L': [], 'R': []}
    for key, (iname, xl) in (('L', (left_inst, left_x_local)), ('R', (right_inst, right_x_local))):
        inst = next(i for i in instances if i['id'] == iname)
        mod = inst['module']
        Wm = json.loads((BUILD / mod / 'measurements.json').read_text(encoding='utf-8'))['design']['depthM']
        th = inst['rotationYRad']
        px, pz = inst['positionGlb'][0], inst['positionGlb'][2]
        ct, st = math.cos(th), math.sin(th)
        for o in depths:
            wx = ct * xl + st * (-o) + px
            wz = -st * xl + ct * (-o) + pz
            out[key].append(Vector((wx, 0, wz)))
    return [Vector(((a.x + b.x) / 2, 0, (a.z + b.z) / 2)) for a, b in zip(out['L'], out['R'])]


main_pts = [at(0.5 + i * 4.0)[0] for i in range(int((TOTAL - 1.0) / 4.0) + 1)]
main_pts.append(at(TOTAL - 0.3)[0])
jc2, jt2, jf2 = at(junction_s)
branch_pts = [jc2 + jf2 * 5.0, jc2 + jf2 * 11.5]
# lane excursions follow each lane's own geometric axis (corner-anchored mouth)
lane_a_pts = [lane_axes['A'][0] + lane_axes['A'][1] * d for d in (0.8, 2.6, 4.4)]
lane_b_pts = [lane_axes['B'][0] + lane_axes['B'][1] * d for d in (0.8, 1.8, 2.6)]

route = {
    'axis': 'GLB Y-up X east Z south; heights 0 (ground walking)',
    'mainStreet': [[round(p.x, 3), 0.0, round(p.z, 3)] for p in main_pts],
    'branchExcursionGuangqi': [[round(p.x, 3), 0.0, round(p.z, 3)] for p in branch_pts],
    'laneAExcursion': [[round(p.x, 3), 0.0, round(p.z, 3)] for p in lane_a_pts],
    'laneBExcursion': [[round(p.x, 3), 0.0, round(p.z, 3)] for p in lane_b_pts],
    'entries': {'west': [round(main_pts[0].x, 3), 0.0, round(main_pts[0].z, 3)],
                'east': [round(main_pts[-1].x, 3), 0.0, round(main_pts[-1].z, 3)]},
    'note': 'geometric clearance only; no real player walk test in this night package',
}

# normalize street-kit colliders (center/size -> min/max) so checks and export share one shape
for c in STREET_COLL:
    if 'min' not in c and 'center' in c:
        ctr, siz = c['center'], c['size']
        c['min'] = [round(ctr[0] - siz[0] / 2, 3), round(ctr[1] - siz[1] / 2, 3), round(ctr[2] - siz[2] / 2, 3)]
        c['max'] = [round(ctr[0] + siz[0] / 2, 3), round(ctr[1] + siz[1] / 2, 3), round(ctr[2] + siz[2] / 2, 3)]
        del c['center'], c['size']

all_colliders = world_colliders + STREET_COLL
hit_summary = {}
hits = (clearance_report(main_pts, all_colliders, summary=hit_summary)
        + clearance_report(branch_pts, all_colliders, summary=hit_summary)
        + clearance_report(lane_a_pts, all_colliders, summary=hit_summary)
        + clearance_report(lane_b_pts, all_colliders, summary=hit_summary))
print('HIT_SUMMARY', json.dumps(hit_summary, ensure_ascii=False))
for h in hits[:6]:
    print('HIT_POINT', json.dumps(h, ensure_ascii=False))
# negative controls: through plaza back wall and into the cat wall block must fail
neg1 = [at(24.5)[0] + at(24.5)[2] * 5.9, at(24.5)[0] + at(24.5)[2] * 10.6]
neg2 = [at(56.5)[0] - at(56.5)[2] * 5.9, at(56.5)[0] - at(56.5)[2] * 8.5]
neg_hits1 = clearance_report(neg1, all_colliders)
neg_hits2 = clearance_report(neg2, all_colliders)
route['clearance'] = {
    'sampledRouteHits': hits,
    'clearRadiusM': 0.35,
    'negativeControlPlazaWallHits': len(neg_hits1),
    'negativeControlCatWallHits': len(neg_hits2),
    'negativeControlsWork': len(neg_hits1) > 0 and len(neg_hits2) > 0,
    'walked': False,
}

# ---------------------------------------------------------------- export
WORLD.mkdir(exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(WS / 'street.blend'))
bpy.ops.export_scene.gltf(filepath=str(WORLD / 'street.glb'), export_format='GLB', export_yup=True,
                          export_apply=False, export_animations=False, export_tangents=True,
                          export_image_format='JPEG', export_jpeg_quality=92,
                          export_cameras=False, export_lights=False)

tris = 0
meshes = set()
for o in bpy.context.scene.objects:
    if o.type == 'MESH':
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
        meshes.add(o.data.name)

(WORLD / 'instances.json').write_text(json.dumps({
    'axis': 'GLB Y-up X east Z south; instances: rotationY about +Y at ground y=0',
    'worldOriginMapSpace': json.loads((WORLD / 'segment-spec.json').read_text(encoding='utf-8'))['world']['worldOriginMapSpace'],
    'frontLineOffsetM': FRONT,
    'streetKit': ['road', 'sidewalks', 'curbs', 'branchGuangqi', 'laneA', 'laneB', 'plaza', 'lamps', 'drains', 'manhole'],
    'instances': instances,
    'counts': {'storefronts': len(instances), 'north': n_count, 'south': s_count},
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

(WORLD / 'collision-world.json').write_text(json.dumps({
    'axis': 'glTF Y-up; AABBs are yaw-expanded bounds of rotated module boxes',
    'colliders': world_colliders + STREET_COLL,
    'walkableLow': ['curb-stone (0.10m)', 'branch-curb (0.10m)'],
    'notIntegratedOrWalkingTested': True,
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

(WORLD / 'route.json').write_text(json.dumps(route, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

size = (WORLD / 'street.glb').stat().st_size
print(f'STREET_READY storefronts={len(instances)} (N{n_count}/S{s_count}) tris={tris} uniqueMeshes={len(meshes)} bytes={size}')
print(f"CLEARANCE routeHits={len(hits)} negWall1={len(neg_hits1)} negWall2={len(neg_hits2)}")
