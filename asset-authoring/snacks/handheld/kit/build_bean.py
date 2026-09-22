"""五香豆 broad-bean geometry + set placement. Import inside Blender.
Parametric bean: flattened kidney ellipsoid, hilum groove on one long edge (+z or -z per
variant), slight asymmetry. Grid seg x rows with collapsed poles, outward winding.
GLB design coords, rest pose min y = 0.
meanRadius := (a*b*c)**(1/3) of the nominal bean; min pair distance = 0.85 * meanRadius.
"""
import math
import json
import random
from pathlib import Path
from geomlib import mesh, lathe, vessel, box, disc, cyl

TAU = math.tau
A, B, C = 0.011, 0.0045, 0.0075          # half extents: length, thickness, width
MEAN_RADIUS = (A * B * C) ** (1 / 3)
MIN_PAIR = 0.85 * MEAN_RADIUS
GRID = {0: (16, 11), 1: (12, 6), 2: (6, 4)}   # lod -> (seg, rows); tri counts 320/120/36


def bean_surface(theta, phi, variant, flip):
    """point on bean surface for azimuth theta, latitude phi (0..pi)."""
    sa = [0.95, 1.0, 1.06, 0.92, 1.04, 0.98][variant % 6]
    sb = [1.05, 0.94, 0.98, 1.08, 0.9, 1.02][variant % 6]
    sc = [0.97, 1.03, 0.9, 1.0, 1.07, 0.95][variant % 6]
    x = A * sa * math.sin(phi) * math.cos(theta)
    y = B * sb * math.copysign(abs(math.cos(phi)) ** 1.18, math.cos(phi))
    z = C * sc * math.sin(phi) * math.sin(theta)
    # kidney bend: tips curve toward -z
    xz = x / (A * sa)
    z += -C * sc * 0.62 * xz * xz * math.sin(phi)
    # slight asymmetry (per-variant seed via variant index)
    r = 1 + .045 * math.sin(3 * theta + 2.1 * variant) + .03 * math.cos(2 * phi + variant)
    x *= r
    z *= r
    # hilum groove: dent at theta = pi/2 (+z edge) or 3pi/2 when flipped, ~6mm long,
    # 1 mm deep (R1 #4)
    hc = math.pi / 2 if not flip else 3 * math.pi / 2
    dt = math.atan2(math.sin(theta - hc), math.cos(theta - hc))
    g = math.exp(-(dt / .30) ** 2) * math.exp(-((phi - math.pi / 2) / .38) ** 2)
    depth = .001 * g
    # pull toward local center: shrink radius about the section center
    cx, cz = 0.0, -C * sc * 0.62 * xz * xz * math.sin(phi)
    x = cx + (x - cx) * (1 - depth / max(A, 1e-6))
    z = cz + (z - cz) * (1 - depth / max(C, 1e-6))
    y *= (1 - .3 * g)
    return x, y, z


def bean_mesh_data(grid, variant, flip):
    """grid = (seg, rows). Returns verts/faces + uv per vertex (atlas cell, full-bean)."""
    seg, rows = grid
    verts, faces, uv_atlas, uv_full = [], [], [], []
    ring_idx = []
    for j in range(rows + 1):
        phi = math.pi * j / rows
        if phi <= 1e-9 or phi >= math.pi - 1e-9:
            verts.append(bean_surface(0.0, phi, variant, flip))
            uv_atlas.append((0.0, 1.0 if phi <= 1e-9 else 0.0))
            uv_full.append((0.0, 1.0 if phi <= 1e-9 else 0.0))
            ring_idx.append([len(verts) - 1])
        else:
            idx = []
            for i in range(seg):
                th = TAU * i / seg
                verts.append(bean_surface(th, phi, variant, flip))
                col, row = variant % 2, variant // 2
                uv_atlas.append((col * .5 + (th / TAU) * .5, row / 3 + (phi / math.pi) / 3))
                uv_full.append((th / TAU, phi / math.pi))
                idx.append(len(verts) - 1)
            ring_idx.append(idx)
    for j in range(rows):
        lo, hi = ring_idx[j], ring_idx[j + 1]
        for i in range(seg):
            a, b = lo[i if len(lo) > 1 else 0], lo[(i + 1) % seg if len(lo) > 1 else 0]
            d, c = hi[i if len(hi) > 1 else 0], hi[(i + 1) % seg if len(hi) > 1 else 0]
            if a == b:            # top pole band: (pole, ring[i+1], ring[i]) is +Y outward
                faces.append((a, c, d))
            elif d == c:          # bottom pole band: (ring[i], ring[i+1], pole) is -Y outward
                faces.append((a, b, d))
            else:
                faces.append((a, b, c, d))
    return verts, faces, uv_atlas, uv_full


def shift_to_ground(verts):
    y0 = min(v[1] for v in verts)
    return [(v[0], v[1] - y0, v[2]) for v in verts]


def build_bean_object(name, lod, variant, matkey='beanskin'):
    return bean_object_grid(name, GRID[lod], variant, matkey)


def bean_object_grid(name, grid, variant, matkey='beanskin'):
    flip = variant % 2 == 1
    verts, faces, uv_a, uv_f = bean_mesh_data(grid, variant, flip)
    verts = shift_to_ground(verts)
    o = mesh(name, verts, faces, matkey, uv_a)
    me = o.data
    uv2 = me.uv_layers.new(name='UVNorm')
    # Resolve seam per face, including pole U; never interpolate across atlas cells.
    for poly in me.polygons:
        vals=[list(uv_f[me.loops[li].vertex_index]) for li in poly.loop_indices]
        regular=[v[0] for v in vals if 0 < v[1] < 1]
        if regular and max(regular)-min(regular)>.5:
            for v in vals:
                if v[0]<.5:v[0]+=1
        regular=[v[0] for v in vals if 0 < v[1] < 1]
        for li,v in zip(poly.loop_indices,vals):
            if v[1] in (0,1):v[0]=sum(regular)/len(regular)
            uv2.data[li].uv=v
            me.uv_layers[0].data[li].uv=((variant%2+(min(1,max(0,v[0]))*.996+.002))*.5,
                (variant//2+(v[1]*.996+.002))/3)
    return o


def bean_instance(name, grid, variant, pos, orient, matkey='beanskin'):
    """bean mesh object placed at `pos` (GLB) with (yaw, tilt); Blender XYZ euler equivalent."""
    o = bean_object_grid(name, grid, variant, matkey)
    o.rotation_mode = 'XYZ'
    o.rotation_euler = (-orient[1], 0.0, orient[0])
    o.location = glb_to_bl(pos)
    return o


def glb_to_bl(p):
    return (p[0], -p[2], p[1])


# ---------------- sets ------------------------------------------------------

def _template(grid, variant):
    verts, faces, _, _ = bean_mesh_data(grid, variant, variant % 2 == 1)
    verts = shift_to_ground(verts)
    cy = sum(v[1] for v in verts) / len(verts)
    return [(v[0], v[1] - cy, v[2]) for v in verts]


def rot_y(v, a):
    c, s = math.cos(a), math.sin(a)
    return (v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c)


def rot_x(v, a):
    c, s = math.cos(a), math.sin(a)
    return (v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c)


class Placement:
    """rejection sampling with spatial hash for the min-pair assertion."""

    def __init__(self, seed):
        self.rng = random.Random(seed)
        self.pos = []
        self.orient = []
        self.cell = MEAN_RADIUS
        self.hash = {}

    def _key(self, p):
        return (int(p[0] // self.cell), int(p[1] // self.cell), int(p[2] // self.cell))

    def ok(self, p, tpl, orient, bounds):
        k0 = self._key(p)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for q in self.hash.get((k0[0] + dx, k0[1] + dy, k0[2] + dz), []):
                        if math.dist(p, self.pos[q]) < MIN_PAIR:
                            return False
        for v in tpl:
            # matches the Blender export euler XYZ (-tilt about X, then yaw about Z)
            w = rot_y(rot_x(v, orient[1]), orient[0])
            wp = (p[0] + w[0], p[1] + w[1], p[2] + w[2])
            if not bounds(wp):
                return False
        return True

    def add(self, p, o=(0.0, 0.0)):
        self.pos.append(p)
        self.orient.append(o)
        self.hash.setdefault(self._key(p), []).append(len(self.pos) - 1)


def _orient(rng):
    return (rng.uniform(0, math.tau), rng.uniform(-.35, .35))


def place_dish():
    """45 beans, 3 gravity-free layers, hex jitter 15%, on the porcelain saucer."""
    rng = random.Random(51)
    pl = Placement(51)
    tpl = _template((10, 6), 0)
    per = [15, 15, 15]
    ys = [.0085, .0155, .0225]
    s = .013
    count = 0
    for layer in range(3):
        # hex grid positions within radius
        cells = []
        rr = [.006, .020, .033] if layer == 0 else [.014, .027] if layer == 1 else [.008, .022, .034]
        cells.append((0.0, 0.0))
        for rad in rr:
            n = max(4, int(math.tau * rad / s))
            for i in range(n):
                a = math.tau * i / n + rad * 7.3
                cells.append((rad * math.cos(a), rad * math.sin(a)))
        cells = cells[:per[layer]]
        for (cx, cz) in cells:
            for attempt in range(200):
                jx, jz = rng.gauss(0, .15 * s), rng.gauss(0, .15 * s)
                jy = rng.gauss(0, .0012)
                p = (cx + jx, ys[layer] + jy, cz + jz)
                o = _orient(rng)

                def bounds(wp, layer=layer):
                    rad = math.hypot(wp[0], wp[2])
                    return wp[1] > .0045 and rad < .0365 and wp[1] < .032
                if pl.ok(p, tpl, o, bounds):
                    pl.add(p, o)
                    count += 1
                    break
    return pl, count


def place_packet():
    """30 beans: 18 visible in/above the torn-open standing packet + 12 spilled
    (within r=0.06 of the spill centre at (.040, .052))."""
    rng = random.Random(77)
    pl = Placement(77)
    tpl = _template((8, 5), 1)
    n_in = 0
    while n_in < 18:
        # beans heaped in the torn top opening, a few poking above the lip
        px = rng.uniform(-.032, .032)
        pz = rng.uniform(-.012, .012)
        py = rng.uniform(.09, .138)
        p = (px, py, pz)
        o = _orient(rng)

        def bounds(wp):
            return wp[1] > .098 and wp[1] < .1455 and abs(wp[0]) < .045 and abs(wp[2]) < .028
        if pl.ok(p, tpl, o, bounds):
            pl.add(p, o)
            n_in += 1
    n_spill = 0
    while n_spill < 12:
        if n_spill == 0:
            # pinned front spill bean: pins the packet's spec z extent (centre .058 from
            # the spill centre, inside the r=0.062 test disc)
            p = (.040, .006, .108)
            o = (rng.uniform(0, math.tau), .12)
        else:
            a = rng.uniform(0, math.tau)
            rr = .060 * math.sqrt(rng.random())
            p = (.040 + rr * math.cos(a), .006 + rng.uniform(0, .002), .052 + rr * math.sin(a))
            o = _orient(rng)

        def bounds(wp):
            # centres stay within the r=0.06 spill disc (test); verts may tumble a bit
            # further so the spilled spread reaches the packet's spec z extent
            return wp[1] > .0005 and math.hypot(wp[0] - .040, wp[2] - .052) < .069
        if pl.ok(p, tpl, o, bounds):
            pl.add(p, o)
            n_spill += 1
    return pl, 30


def place_jar():
    """R1 #5: fill the jar to y=0.15 (spec). 260 beans in gravity-free horizontal layers
    (17 per full layer: centre + ring .028 x6 + ring .056 x10), rejection-sampled with the
    shared min-pair hash; per-vertex bounds keep every vertex above the floor (.0048),
    inside the inner radius and below the fill line (.1505)."""
    rng = random.Random(123)
    pl = Placement(123)
    tpls = {v: _template((6, 4), v) for v in range(6)}
    ring = [(0.0, 0.0)] + [(.028 * math.cos(math.tau * i / 6), .028 * math.sin(math.tau * i / 6)) for i in range(6)] \
        + [(.056 * math.cos(math.tau * i / 10 + .31), .056 * math.sin(math.tau * i / 10 + .31)) for i in range(10)]
    placed = 0
    layer = 0
    while placed < 260:
        y = .0098 + layer * .0090
        for (cx, cz) in ring:
            if placed >= 260:
                break
            for attempt in range(120):
                jx, jz = rng.gauss(0, .0012), rng.gauss(0, .0012)
                p = (cx + jx, y + rng.gauss(0, .0004), cz + jz)
                o = _orient(rng)
                variant = (placed + 1) % 6

                def bounds(wp):
                    rad = math.hypot(wp[0], wp[2])
                    return wp[1] > .0050 and rad < .0737 and wp[1] < .1500
                if pl.ok(p, tpls[variant], o, bounds):
                    pl.add(p, o)
                    placed += 1
                    break
        layer += 1
        if layer > 40:
            raise RuntimeError('jar fill did not converge')
    return pl, placed


# ---------------- vessel companions ----------------------------------------

def build_dish_vessel(lod=0):
    sides = 32 if lod == 0 else (16 if lod == 1 else 8)
    return vessel('saucer', (0, 0, 0), [(0, .0248), (.004, .0306), (.012, .0405), (.02, .045)],
                  'porcelain', 'rim', .017, sides)


def build_packet_torn(lod):
    """R1 #6: standing kraft packet 0.09 x 0.13 x 0.032, torn open at the top with an
    irregular 6-8 segment zigzag rim flared 0.8 cm outward; label/mark upright on the
    front face (same layout as wuxiangdou-packet)."""
    objs = [box('packet-body', (0, .062, 0), (.09, .122, .032), 'paper', .003)]
    if lod == 0:
        objs.append(_torn_rim('torn-rim', (.0, .1228, 0), (.09, .032), seg=(7, 2), flare=.008))
        # labels upright on the front (+z) face, same rows/UVs as the closed packet
        objs.append(mesh('packet-label',
                         [(-.04, .03, .0166), (.04, .03, .0166), (.04, .082, .0166), (-.04, .082, .0166)],
                         [(0, 1, 2, 3)], 'label', [(0, .75), (1, .75), (1, 1), (0, 1)]))
        objs.append(mesh('packet-mark',
                         [(-.025, .088, .0167), (.025, .088, .0167), (.025, .114, .0167), (-.025, .114, .0167)],
                         [(0, 1, 2, 3)], 'label', [(0, .75), (1, .75), (1, 1), (0, 1)]))
    return objs


def _torn_rim(name, origin, size, seg=(7, 2), flare=.008, jag=.004):
    """Irregular torn collar around a rectangular top rim: 6-8 zigzag segments per long
    side, flared `flare` outward and torn up/down by up to `jag`. GLB Y-up design coords."""
    import random as _r
    rng = _r.Random(413)
    ox, oy, oz = origin
    hx, hy = size[0] / 2, size[1] / 2
    pts_in, pts_out = [], []
    corners = [(-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)]
    for c in range(4):
        x0, z0 = corners[c]
        x1, z1 = corners[(c + 1) % 4]
        long_side = abs(x1 - x0) > abs(z1 - z0)
        n = seg[0] if long_side else seg[1]
        nx, nz = (0.0, 1 if z0 >= 0 else -1) if long_side else (1 if x0 >= 0 else -1, 0.0)
        for i in range(n):
            t = i / n
            px, pz = x0 + (x1 - x0) * t, z0 + (z1 - z0) * t
            pts_in.append((ox + px, oy + rng.uniform(-jag, jag), oz + pz))
            pts_out.append((ox + px + nx * flare, oy + rng.uniform(-jag * .5, jag) - .003,
                            oz + pz + nz * flare))
    n = len(pts_in)
    verts = [tuple(p) for p in pts_in] + [tuple(p) for p in pts_out]
    faces = [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    return mesh(name, verts, faces, 'paper')


def build_jar_vessel(lod):
    objs = [vessel('jar', (0, 0, 0),
                   [(0, .07), (.004, .078), (.17, .078), (.19, .07), (.2, .06), (.215, .06)],
                   'glass', None, None, 32 if lod == 0 else (18 if lod == 1 else 10), .003),
            lathe('jar-lid', (0, .213, 0), [(0, .063, 0), (.014, .063, 0), (.014, 0, 0)], 'steel',
                  32 if lod == 0 else (16 if lod == 1 else 8))]
    if lod == 0:
        # R1 #5: label as a curved surface hugging the jar wall - cylinder projection at
        # r=0.0795, 0.045 tall, 0.11 wide (arc), UV uniform in arc length (no stretch,
        # no facet-chamfer distortion). Centred on +z (front).
        r_lab, y0, y1, width = .0795, .075, .12, .11
        a0, a1 = -width / (2 * r_lab), width / (2 * r_lab)
        cols = 14
        verts, uvs, faces = [], [], []
        for j, yy in enumerate((y0, y1)):
            for i in range(cols + 1):
                a = a0 + (a1 - a0) * i / cols
                verts.append((r_lab * math.sin(a), yy, r_lab * math.cos(a)))
                uvs.append((i / cols, (0.75, 1.0)[j]))
        for i in range(cols):
            faces.append((i, i + 1, i + 1 + cols + 1, i + cols + 1))
        objs.append(mesh('jar-label', verts, faces, 'label', uvs))
    return objs


def bean_mass_lathe(lod, for_dish=False):
    """Bean mass lathe for jar LOD1/2 (baseline profile) or a dish-sized mound."""
    if for_dish:
        rings = [(0, .024, 0), (.005, .034, 0), (.011, .0385, 0), (.016, .034, 0), (.019, 0, 0)]
        return [lathe('bean-mass', (0, .004, 0), rings, 'beans-mass', 20 if lod == 1 else 8, bumps=(7, .04))]
    rings = [(0, .06, 0), (.02, .073, 0), (.12, .074, 0), (.145, .065, 0), (.15, 0, 0)]
    return [lathe('bean-mass', (0, .006, 0), rings, 'beans-mass', 24 if lod == 1 else 10, bumps=(11, .03))]
