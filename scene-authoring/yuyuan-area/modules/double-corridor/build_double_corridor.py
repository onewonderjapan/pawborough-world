"""复廊 bld-428186469 — lead build 2026-09-23 (replaces two failed GLM rounds).

The OSM way is a CLOSED OUTLINE of the building (a zig-zag band ~11 x 8 m that steps twice), not a centreline.
Build: floor = footprint prism; roof = one continuous surface over the footprint offset by the eave overhang, height
from the distance to the zig-zag centreline (so hips/valleys form at the jogs), vertical fascia/gable skirt to a
constant eave plane; centre wall with lattice windows along the centreline (复廊 = two walkways split by a wall);
columns + low rails on both side lines, ends open.
Site module in world (map) coordinates: GLB (x, y, z) = (map x, height, map z); Blender internal (x, -z, y).
Run: blender -b -t 4 --python-exit-code 1 -P modules/double-corridor/build_double_corridor.py   (OUT_DIR default out-garden-kits)
"""
import bpy, bmesh, math, json, os, sys, hashlib
from mathutils import Vector, geometry
HERE = os.path.dirname(os.path.abspath(__file__)); AREA = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(AREA, os.environ.get('OUT_DIR', 'out-garden-kits'))
TEX = os.environ.get('SOURCE_KIT_TEX', '/home/baibai/work/onewonderjapan/pawborough-world/asset-authoring/yuyuan-entry/source-kit/textures')
OID = 'bld-428186469'
L = json.load(open(os.path.join(AREA, 'baseline', 'layout.json'), encoding='utf-8'))
FP = next(o for o in L['objects'] if o['id'] == OID)['geometry']['polyline']
if FP[0] == FP[-1]: FP = FP[:-1]
FP = [tuple(p) for p in FP]
# Top chain v0..v4 (north edge, west->east), bottom chain v5..v9 (south edge, east->west): pair them for the centreline.
TOP, BOT = FP[0:5], FP[5:10][::-1]          # BOT reversed -> v9..v5, west->east, paired index-wise with TOP
CL = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in zip(TOP, BOT)]
D = dict(floorY=0.12, eaveY=2.85, ridgeY=3.55, overhang=0.5, sideOffset=1.5, colR=0.1, colSpacing=2.5,
         wallT=0.24, wallTop=3.30, win=(1.1, 0.9), sill=0.9, railH=0.45, fascia=0.16)
bpy.ops.wm.read_factory_settings(use_empty=True); sc = bpy.context.scene
def lin(h):
    a = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]; return [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in a]
def mat(name, color, rough=.8, base=None, normal=None, tint=None, nstr=.6):
    m = bpy.data.materials.new(name); m.use_nodes = True; n = m.node_tree.nodes; l = m.node_tree.links; p = n['Principled BSDF']
    p.inputs['Base Color'].default_value = (*lin(color), 1); p.inputs['Roughness'].default_value = rough
    if base:
        t = n.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(os.path.join(TEX, base), check_existing=True); t.image.pack()
        if tint:
            mx = n.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1
            mx.inputs[7].default_value = (*lin(tint), 1); l.new(t.outputs['Color'], mx.inputs[6]); l.new(mx.outputs[2], p.inputs['Base Color'])
        else: l.new(t.outputs['Color'], p.inputs['Base Color'])
    if normal:
        t = n.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(os.path.join(TEX, normal), check_existing=True); t.image.colorspace_settings.name = 'Non-Color'; t.image.pack()
        nm = n.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = nstr; l.new(t.outputs['Color'], nm.inputs['Color']); l.new(nm.outputs['Normal'], p.inputs['Normal'])
    return m
M = {'roof': mat('gray-pan-tile', 'ffffff', .85, 'roof-color.jpg', 'roof-normal.png'),
     'wood': mat('oxblood-stained-timber', 'ffffff', .65, 'wood-stain-color.jpg', 'Wood092_2K-JPG_NormalGL_1K.jpg', tint='a25a4a'),
     'wall': mat('white-lime-plaster', 'ffffff', .85, 'PaintedPlaster017_2K-JPG_Color_1K.jpg', 'PaintedPlaster017_2K-JPG_NormalGL_1K.jpg', tint='ece8e0', nstr=.4),
     'stone': mat('grey-stone', 'ffffff', .9, 'PaintedPlaster017_2K-JPG_Color_1K.jpg', None, tint='9d9a92'),
     'dark': mat('dark-fascia', '3a3632', .6)}
TILE = {'roof': (1.44, 1.36), 'wood': (.75, 1.5), 'wall': (2.5, 2.5), 'stone': (2.5, 2.5), 'dark': (1, 1)}
def mesh(name, verts, faces, m, flip_uv=False):
    """verts in design coords (x, y, z_map); world-metric planar UV by dominant normal axis."""
    me = bpy.data.meshes.new(name); me.from_pydata([(v[0], -v[2], v[1]) for v in verts], [], faces); me.update()
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bm.to_mesh(me); bm.free()
    me.materials.append(M[m]); uv = me.uv_layers.new(name='UVMap'); tw, th = TILE[m]
    for p in me.polygons:
        ax = max(range(3), key=lambda k: abs(p.normal[k]))
        for li in p.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co   # blender coords: x, y(-z_map), z(height)
            a, b = ((v.y, v.z) if ax == 0 else (v.x, v.z) if ax == 1 else (v.x, v.y))
            uv.data[li].uv = (a / tw, b / th)
    o = bpy.data.objects.new(name, me); sc.collection.objects.link(o); return o
def box(name, c, s, m, yaw=0.0):
    """axis box in design coords, rotated by yaw about the vertical (yaw = heading of local +x in map x/z)."""
    hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2; ca, sa = math.cos(yaw), math.sin(yaw)
    loc = [(x, y, z) for x in (-hx, hx) for y in (-hy, hy) for z in (-hz, hz)]
    vs = [(c[0] + x * ca - z * sa, c[1] + y, c[2] + x * sa + z * ca) for x, y, z in loc]
    f = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return mesh(name, vs, f, m)
# ---------- geometry helpers (2D map x/z) ----------
def seg_dist(p, a, b):
    ax, az = b[0] - a[0], b[1] - a[1]; t = max(0, min(1, ((p[0] - a[0]) * ax + (p[1] - a[1]) * az) / (ax * ax + az * az)))
    return math.hypot(p[0] - a[0] - t * ax, p[1] - a[1] - t * az)
EXT = 4.0   # centreline extended past both ends so the ends read as gables, not cones
def extend(pl, e):
    a, b = pl[0], pl[1]; d = math.hypot(b[0] - a[0], b[1] - a[1]); s = (a[0] - (b[0] - a[0]) / d * e, a[1] - (b[1] - a[1]) / d * e)
    a, b = pl[-1], pl[-2]; d = math.hypot(b[0] - a[0], b[1] - a[1]); t = (a[0] - (b[0] - a[0]) / d * e, a[1] - (b[1] - a[1]) / d * e)
    return [s] + pl + [t]
CLX = extend(CL, EXT)
def dist_cl(p): return min(seg_dist(p, CLX[i], CLX[i + 1]) for i in range(len(CLX) - 1))
def offset_poly(poly, d):
    """mitred outward offset of a simple polygon (CCW or CW handled by area sign)."""
    n = len(poly); area = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n)) / 2
    sgn = 1 if area > 0 else -1; out = []
    for i in range(n):
        p0, p1, p2 = poly[i - 1], poly[i], poly[(i + 1) % n]
        def nrm(a, b):
            dx, dz = b[0] - a[0], b[1] - a[1]; l = math.hypot(dx, dz); return (sgn * dz / l, -sgn * dx / l)
        n1, n2 = nrm(p0, p1), nrm(p1, p2); bx, bz = n1[0] + n2[0], n1[1] + n2[1]; bl = math.hypot(bx, bz)
        k = d / max(0.35, (bx * n1[0] + bz * n1[1]) / bl); out.append((p1[0] + bx / bl * k, p1[1] + bz / bl * k))
    return out
def inside(p, poly):
    c = False; n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]: c = not c
    return c
def cdt(poly, step=None):
    """constrained Delaunay of a polygon, optional interior grid points; returns verts2d, faces (inside only)."""
    pts = []
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]; L_ = math.hypot(b[0] - a[0], b[1] - a[1]); k = max(1, int(L_ / step)) if step else 1
        for j in range(k): pts.append((a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k))
    nb = len(pts)
    if step:
        xs = [p[0] for p in poly]; zs = [p[1] for p in poly]; x = min(xs) + step / 2
        while x < max(xs):
            z = min(zs) + step / 2
            while z < max(zs):
                if inside((x, z), poly) and min(math.hypot(x - q[0], z - q[1]) for q in pts[:nb]) > step * 0.45: pts.append((x, z))
                z += step
            x += step
    edges = [(i, (i + 1) % nb) for i in range(nb)]
    res = geometry.delaunay_2d_cdt([Vector(p) for p in pts], edges, [], 1, 1e-6)   # 1 = inside constraint polygon only
    return [tuple(v) for v in res[0]], [tuple(f) for f in res[2]], nb
# ---------- floor ----------
fv, ff, _ = cdt(FP)
top = [(v[0], D['floorY'], v[1]) for v in fv]; bot = [(v[0], 0.0, v[1]) for v in fv]; n = len(fv)
faces = [f for f in ff] + [tuple(i + n for i in reversed(f)) for f in ff]
for i in range(len(FP)): faces.append((i, (i + 1) % len(FP), (i + 1) % len(FP) + n, i + n))
mesh('floor', top + bot, faces, 'stone')
# ---------- roof: one height-field surface over the eave outline ----------
EAVE = offset_poly(FP, D['overhang'])
def roof_y(p):
    d = dist_cl(p); half = D['sideOffset'] + 0.2 + D['overhang']        # distance at which the roof reaches the eave plane
    return D['ridgeY'] - (D['ridgeY'] - D['eaveY']) * min(d / half, 1.25)
rv, rf, nb = cdt(EAVE, step=0.3)
rverts = [(v[0], roof_y(v), v[1]) for v in rv]; mesh('roof', rverts, rf, 'roof')
under = [(v[0], roof_y(v) - 0.1, v[1]) for v in rv]; mesh('roof-underside', under, [tuple(reversed(f)) for f in rf], 'wood')
# fascia / gable skirt from the roof edge down to a constant plane (sides: thin fascia; ends: gable triangle)
bnd = rverts[:nb]
def low(v): return min(v[1], D['eaveY']) - D['fascia']   # sides: thin fascia under the edge; ends (edge above eave): gable down to eave
for i in range(nb):
    a, b = bnd[i], bnd[(i + 1) % nb]
    mesh('fascia', [a, b, (b[0], low(b), b[2]), (a[0], low(a), a[2])], [(0, 1, 2, 3)], 'wall' if max(a[1], b[1]) > D['eaveY'] + 0.25 else 'dark')
# ridge roll along the (unextended) centreline
for i in range(len(CL) - 1):
    a, b = CL[i], CL[i + 1]; L_ = math.hypot(b[0] - a[0], b[1] - a[1]); yaw = math.atan2(b[1] - a[1], b[0] - a[0])
    box('ridge', ((a[0] + b[0]) / 2, D['ridgeY'] + 0.06, (a[1] + b[1]) / 2), (L_ + 0.24, 0.14, 0.2), 'roof', yaw)
# ---------- centre wall with lattice windows on the two long runs ----------
for i in range(len(CL) - 1):
    a, b = CL[i], CL[i + 1]; L_ = math.hypot(b[0] - a[0], b[1] - a[1]); yaw = math.atan2(b[1] - a[1], b[0] - a[0])
    ux, uz = (b[0] - a[0]) / L_, (b[1] - a[1]) / L_
    def at(s): return (a[0] + ux * s, a[1] + uz * s)
    y0, y1, t = D['floorY'], D['wallTop'], D['wallT']
    if L_ >= 3.0:
        w, h = D['win']; s0, s1 = L_ / 2 - w / 2, L_ / 2 + w / 2; sill, head = D['sill'], D['sill'] + h
        for (sa, sb, ya, yb) in ((-.12, s0, y0, y1), (s1, L_ + .12, y0, y1), (s0, s1, y0, sill), (s0, s1, head, y1)):
            c = at((sa + sb) / 2); box('centre-wall', (c[0], (ya + yb) / 2, c[1]), (sb - sa, yb - ya, t), 'wall', yaw)
        c = at(L_ / 2); box('window-frame-top', (c[0], head + .04, c[1]), (w + .16, .08, t + .04), 'stone', yaw)
        box('window-frame-sill', (c[0], sill - .04, c[1]), (w + .16, .08, t + .04), 'stone', yaw)
        for k in range(1, 5):   # lattice: 4 verticals + 3 horizontals, see-through
            cc = at(s0 + w * k / 5); box('lattice-v', (cc[0], sill + h / 2, cc[1]), (.035, h, .05), 'wood', yaw)
        for k in range(1, 4):
            box('lattice-h', (c[0], sill + h * k / 4, c[1]), (w, .035, .05), 'wood', yaw)
    else:
        c = at(L_ / 2); box('centre-wall', (c[0], (y0 + y1) / 2, c[1]), (L_ + .24, y1 - y0, t), 'wall', yaw)
# ---------- columns + rails on both side lines ----------
def offset_line(pl, d):
    out = []
    for i, p in enumerate(pl):
        dirs = []
        if i > 0: dirs.append((p[0] - pl[i - 1][0], p[1] - pl[i - 1][1]))
        if i < len(pl) - 1: dirs.append((pl[i + 1][0] - p[0], pl[i + 1][1] - p[1]))
        ns = [(-dz / math.hypot(dx, dz), dx / math.hypot(dx, dz)) for dx, dz in dirs]
        nx, nz = sum(q[0] for q in ns), sum(q[1] for q in ns); l = math.hypot(nx, nz); c = (nx / l * ns[0][0] + nz / l * ns[0][1])
        out.append((p[0] + nx / l * d / max(c, .5), p[1] + nz / l * d / max(c, .5)))
    return out
cols = []
FPin = offset_poly(FP, -0.12)
for side in (-1, 1):
    line = offset_line(CL, side * D['sideOffset']); pts = []
    for i in range(len(line) - 1):
        a, b = line[i], line[i + 1]; L_ = math.hypot(b[0] - a[0], b[1] - a[1]); k = max(1, math.ceil(L_ / D['colSpacing']))
        for j in range(k): pts.append((a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k))
    pts.append(line[-1])
    pts = [p for p in pts if inside(p, FPin)]
    for p in pts:
        top_y = roof_y(p) - 0.1
        box('column', (p[0], (D['floorY'] + top_y) / 2, p[1]), (.2, top_y - D['floorY'], .2), 'wood'); cols.append({'x': p[0], 'z': p[1], 'side': side})
    for i in range(1, len(pts) - 2):   # rails between columns, first and last bay left open (entrances)
        a, b = pts[i], pts[i + 1]; L_ = math.hypot(b[0] - a[0], b[1] - a[1]); yaw = math.atan2(b[1] - a[1], b[0] - a[0])
        c = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        box('rail-top', (c[0], D['floorY'] + D['railH'], c[1]), (L_ - .2, .06, .12), 'wood', yaw)
        box('rail-panel', (c[0], D['floorY'] + D['railH'] / 2, c[1]), (L_ - .2, D['railH'] - .06, .04), 'wood', yaw)
# ---------- join per material, export ----------
by = {}
for o in sc.objects:
    if o.type == 'MESH': by.setdefault(o.data.materials[0].name, []).append(o)
parts = []
for mname, objs in by.items():
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]; bpy.ops.object.join(); o = bpy.context.object; o.name = f'fulang__{mname}'
    bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.triangulate(bm, faces=bm.faces[:]); bm.to_mesh(o.data); bm.free(); parts.append(o)
os.makedirs(OUT, exist_ok=True)
glb = os.path.join(OUT, 'double-corridor-bld-428186469.glb')
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_yup=True, use_selection=True, export_apply=True)
tris = 0
for o in parts: o.data.calc_loop_triangles(); tris += len(o.data.loop_triangles)
rec = {'id': OID, 'glb': os.path.basename(glb), 'bytes': os.path.getsize(glb), 'sha256': hashlib.sha256(open(glb, 'rb').read()).hexdigest(),
       'triangles': tris, 'centreline': CL, 'designValues': D, 'columns': len(cols),
       'interpretation': 'OSM way 428186469 is the closed building outline; centreline = midpoints of paired north/south outline vertices',
       'coordinates': 'site module, GLB (x, y, z) = (map x, height, map z)'}
json.dump(rec, open(os.path.join(HERE, 'double-corridor-record.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('DOUBLE_CORRIDOR_DONE', tris, rec['bytes'], len(cols), 'columns')
