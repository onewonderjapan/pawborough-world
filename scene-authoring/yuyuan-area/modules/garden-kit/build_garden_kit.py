"""豫园站点模块批量构建（garden-kit）：龙墙 / 庙区院墙 / 玉华堂月洞门 / 九曲桥 + 龙头。
数值只认 DESIGN_SPEC.json；布局沿用 baseline/layout.json 冻结线，不改布局、不移动对象。
坐标契约：layout 地图系 (x, z) + 高度 y；Blender 内部 (x, -z_map, y)，export_yup=True 后
GLB 为 Y-up 世界坐标 (x, y, z_map)，原点=地图(0,0)，无实例变换。
运行：blender -b --python-exit-code 1 -P modules/garden-kit/build_garden_kit.py  （OUT_DIR 默认 out-garden-kit）
输出（OUT_DIR）：site-inputs.json（缺则从 baseline 抽取）、garden-wall.glb（含龙头）、
temple-wall.glb、moon-gate.glb、jiuqu-bridge.glb、garden-kit-collision.json、
garden-kit-catalog.json、garden-kit-reimport.json
"""
import bpy, bmesh, json, math, os, time, hashlib
from mathutils import Vector

T0 = time.time()
AREA = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(AREA, os.environ.get('OUT_DIR', 'out-garden-kit'))
os.makedirs(OUT, exist_ok=True)

TEX_DIRS = [
    os.path.abspath(os.path.join(AREA, '..', '..', 'asset-authoring', 'yuyuan-entry', 'source-kit', 'textures')),
    '/home/baibai/work/onewonderjapan/pawborough-world/asset-authoring/yuyuan-entry/source-kit/textures',
]
TEX_DIR = next((d for d in TEX_DIRS if os.path.isdir(d)), None)
if not TEX_DIR:
    raise RuntimeError('source-kit textures not found')

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.unit_settings.system = 'METRIC'
sc.unit_settings.scale_length = 1

# ---------------------------------------------------------------- site inputs（冻结布局抽取，含 sha）
LAYOUT_PATH = os.path.join(AREA, 'baseline', 'layout.json')
SITE_INPUTS = os.path.join(OUT, 'site-inputs.json')
WANT = ['garden-wall', 'garden-wall-dragonhead', 'yuhuatang-moongate', 'jiuqu-bridge', 'temple-wall']
if not os.path.exists(SITE_INPUTS):
    raw = open(LAYOUT_PATH, 'rb').read()
    L = json.loads(raw)
    si = {'source': 'scene-authoring/yuyuan-area/baseline/layout.json (frozen G5)',
          'layoutSha256': hashlib.sha256(raw).hexdigest(),
          'objects': {o['id']: o for o in L['objects'] if o['id'] in WANT},
          'gardenRouteAudit': L.get('gardenRouteAudit'), 'gardenMoonGate': L.get('gardenMoonGate')}
    json.dump(si, open(SITE_INPUTS, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('extracted site-inputs.json')
SI = json.load(open(SITE_INPUTS, encoding='utf-8'))
ASSUMPTIONS = []
HEAD_INFO = {}

# ---------------------------------------------------------------- 坐标：地图(x,z,y) <-> Blender(x,-z,y)
def bl_pt(x, z_map, y=0.0):
    return Vector((x, -z_map, y))

MESHES = {}

def _uv_planar(ob, tile, per_vertex=False):
    """GLB 系主轴平面投影、按米平铺（helpers.box_glb 同款约定）。
    per_vertex: UV 按顶点（顶点平均法线主轴）——同一顶点各面 UV 一致，
    smooth 盒体导出时才能合并到 8 顶点。"""
    me = ob.data
    uv = me.uv_layers.new(name='UVMap')
    vuv = {}
    for p in me.polygons:
        if per_vertex:
            ng3 = None
        ng = (p.normal.x, -p.normal.z, p.normal.y)
        ax = max(range(3), key=lambda k: abs(ng[k]))
        for li in p.loop_indices:
            vi = me.loops[li].vertex_index
            v = me.vertices[vi].co
            gx, gy, gz = v.x, v.z, -v.y
            if per_vertex:
                if vi not in vuv:
                    vn = me.vertices[vi].normal
                    vng = (vn.x, -vn.z, vn.y)
                    vax = max(range(3), key=lambda k: abs(vng[k]))
                    vuv[vi] = ((-gz, gy) if vax == 0 else (gx, -gz) if vax == 1 else (gx, gy))
                u, w = vuv[vi]
            else:
                u, w = ((-gz, gy) if ax == 0 else (gx, -gz) if ax == 1 else (gx, gy))
            uv.data[li].uv = (u / tile[0], w / tile[1])

def mesh_part(module, name, verts, faces, matl, tile=(1, 1), smooth_faces=(), uv_vertex=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata([Vector(v) for v in verts], [], faces)
    me.update()
    me.materials.append(matl)
    for i in smooth_faces:
        me.polygons[i].use_smooth = True
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    _uv_planar(ob, tile, per_vertex=uv_vertex)
    MESHES.setdefault((module, matl.name), []).append(ob)
    return ob

def box_part(module, name, center_map, size, rot, matl, tile=(1, 1), smooth_all=False):
    """地图位 (x, y高度, z)、GLB 轴对齐盒 size=(x宽,y高,z厚)，rot 为 layout 式 yaw：
    局部 +x -> 地图 (sin rot, cos rot)，局部 +z -> 地图 (cos rot, -sin rot)。"""
    cx, cy, cz = center_map
    hx, hy, hz = (s / 2 for s in size)
    sn, cs = math.sin(rot), math.cos(rot)
    loc = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                lx, ly, lz = sx * hx, sy * hy, sz * hz
                loc.append(bl_pt(cx + lx * sn + lz * cs, cz + lx * cs - lz * sn, cy + ly))
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return mesh_part(module, name, loc, faces, matl, tile, smooth_faces=list(range(6)) if smooth_all else (), uv_vertex=smooth_all)

def loft(module, name, rings, matl, tile=(1, 1), cap_start=True, cap_end=True, smooth_sides=False, uv_vertex=False):
    """等长环列 loft；封端成闭合体（统一重算法线）。
    smooth_sides: 侧面标记 smooth —— 导出时沿路径共享顶点（索引几何，字节减半以上），
    端盖保持 flat；沿路径相邻面近共面，readable。"""
    n = len(rings[0])
    faces = []
    for r in range(len(rings) - 1):
        for i in range(n):
            j = (i + 1) % n
            faces.append((r * n + i, r * n + j, (r + 1) * n + j, (r + 1) * n + i))
    if cap_start:
        faces.append(tuple(range(n - 1, -1, -1)))
    if cap_end:
        last = (len(rings) - 1) * n
        faces.append(tuple(last + i for i in range(n)))
    sm = list(range((len(rings) - 1) * n)) if smooth_sides else ()
    return mesh_part(module, name, [v for ring in rings for v in ring], faces, matl, tile, sm, uv_vertex=uv_vertex)

def sph_part(module, name, c_bl, r, matl, nr=8, nz=5, smooth=True, uv_vertex=False):
    """UV 球（极点三角扇，闭合流形），c_bl 为 Blender 坐标。"""
    verts = [c_bl + Vector((0, 0, r))]
    for j in range(1, nz):
        phi = math.pi * j / nz
        for i in range(nr):
            th = 2 * math.pi * i / nr
            verts.append(c_bl + Vector((r * math.sin(phi) * math.cos(th), r * math.sin(phi) * math.sin(th), r * math.cos(phi))))
    verts.append(c_bl + Vector((0, 0, -r)))
    faces = []
    for i in range(nr):
        faces.append((0, 1 + i, 1 + (i + 1) % nr))
    for j in range(nz - 2):
        b0, b1 = 1 + j * nr, 1 + (j + 1) * nr
        for i in range(nr):
            k = (i + 1) % nr
            faces.append((b0 + i, b1 + i, b1 + k, b0 + k))
    bot = len(verts) - 1
    lb = 1 + (nz - 2) * nr
    for i in range(nr):
        faces.append((bot, lb + (i + 1) % nr, lb + i))
    sm = list(range(len(faces))) if smooth else ()
    return mesh_part(module, name, verts, faces, matl, smooth_faces=sm, uv_vertex=uv_vertex)

def cyl_part(module, name, a_bl, b_bl, r, sides, matl):
    d = b_bl - a_bl
    nrm = d.normalized()
    up = Vector((0, 0, 1)) if abs(nrm.z) < 0.9 else Vector((1, 0, 0))
    xa = up.cross(nrm).normalized()
    ya = nrm.cross(xa)
    rings = []
    for t in (0.0, 1.0):
        c = a_bl + d * t
        rings.append([c + xa * (r * math.cos(2 * math.pi * i / sides)) + ya * (r * math.sin(2 * math.pi * i / sides)) for i in range(sides)])
    return loft(module, name, rings, matl, smooth_sides=True)

def triangulate_and_recalc(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.object
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(ob.data)
    bm.free()
    return ob

# ---------------------------------------------------------------- 材质（v2/build.py 已验证模式；数值=DESIGN_SPEC.materials）
META = {}

def lin(h):
    a = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in a]

def mat(name, color='ffffff', rough=.8, base=None, normal=None, tint=None, tile=(1, 1), source=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    p = nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*lin(color), 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = 0
    for ch, fn in (('color', base), ('normal', normal)):
        if not fn:
            continue
        t = nodes.new('ShaderNodeTexImage')
        t.extension = 'REPEAT'
        t.image = bpy.data.images.load(os.path.join(TEX_DIR, fn), check_existing=True)
        t.image.colorspace_settings.name = 'sRGB' if ch == 'color' else 'Non-Color'
        t.image.pack()
        if ch == 'normal':
            nm = nodes.new('ShaderNodeNormalMap')
            nm.inputs['Strength'].default_value = .65
            links.new(t.outputs['Color'], nm.inputs['Color'])
            links.new(nm.outputs['Normal'], p.inputs['Normal'])
        elif tint:
            mix = nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1.0
            mix.inputs[7].default_value = (*lin(tint), 1)
            links.new(t.outputs['Color'], mix.inputs[6])
            links.new(mix.outputs[2], p.inputs['Base Color'])
        else:
            links.new(t.outputs['Color'], p.inputs['Base Color'])
    META[name] = {'tileMeters': list(tile), 'tintSrgb': tint, 'roughness': rough,
                  'textures': {ch: fn for ch, fn in (('color', base), ('normal', normal)) if fn},
                  'textureDir': TEX_DIR, 'normalConvention': 'OpenGL', 'source': source}
    return m

M = {
    'whitePlaster': mat('garden-white-plaster', base='PaintedPlaster017_2K-JPG_Color_1K.jpg', tint='ece8e0', rough=.85, tile=(2.5, 2.5), source='DESIGN_SPEC whitePlaster'),
    'greyStone': mat('garden-grey-stone', base='PaintedPlaster017_2K-JPG_Color_1K.jpg', tint='9d9a92', rough=.9, tile=(2.5, 2.5), source='DESIGN_SPEC greyStoneBase'),
    'tileCap': mat('garden-tile-cap', base='roof-color.jpg', normal='roof-normal.png', rough=.8, tile=(1.44, 1.36), source='DESIGN_SPEC tileCap'),
    'darkGlaze': mat('garden-dark-glaze', color='2f2d2b', rough=.55, source='DESIGN_SPEC darkGlaze'),
    'deckStone': mat('garden-deck-stone', base='PaintedPlaster017_2K-JPG_Color_1K.jpg', tint='b3ada2', rough=.8, tile=(2.5, 2.5), source='DESIGN_SPEC deckStone'),
}

# ---------------------------------------------------------------- 折线工具（地图系）
# layout 的 segments 是按序列出的多段 run（段间可有跳变、短 stub）；逐段构建，
# 云墙相位沿"列出顺序累计长度"连续（DESIGN_SPEC.yunqiangCap.phase）。
def cumlen_segs(segs):
    out = [0.0]
    for a, b in segs:
        out.append(out[-1] + math.dist(a, b))
    return out

def cumlen(pts):
    out = [0.0]
    for a, b in zip(pts, pts[1:]):
        out.append(out[-1] + math.dist(a, b))
    return out

def seg_dir(a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    l = math.hypot(dx, dz)
    return (dx / l, dz / l)

def seg_yaw(a, b):
    d = seg_dir(a, b)
    return math.atan2(d[0], d[1])

def turn_at(pts, i):
    d0, d1 = seg_dir(pts[i - 1], pts[i]), seg_dir(pts[i], pts[i + 1])
    return abs(math.atan2(d0[0] * d1[1] - d0[1] * d1[0], d0[0] * d1[0] + d0[1] * d1[1]))

def smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)

# ================================================================ 墙构建器
def wall_strip(module, name, a, b, v0, v1fn, thick, matl, ds=0.35):
    L = math.dist(a, b)
    if L < 1e-4:
        return
    d = seg_dir(a, b)
    nx, nz = -d[1], d[0]
    t2 = thick / 2
    n = max(2, int(math.ceil(L / ds)) + 1)
    rings = []
    for i in range(n):
        t = L * i / (n - 1)
        x, z = a[0] + d[0] * t, a[1] + d[1] * t
        v1 = v1fn(t) if callable(v1fn) else v1fn
        rings.append([bl_pt(x - nx * t2, z - nz * t2, v0), bl_pt(x + nx * t2, z + nz * t2, v0),
                      bl_pt(x + nx * t2, z + nz * t2, v1), bl_pt(x - nx * t2, z - nz * t2, v1)])
    loft(module, name, rings, matl, smooth_sides=True)

def wall_cap(module, name, a, b, topfn, spec, ds):
    L = math.dist(a, b)
    d = seg_dir(a, b)
    nx, nz = -d[1], d[0]
    n = max(2, int(math.ceil(L / ds)) + 1)
    rb, rr = spec['capWidth'] / 2, spec['ridgeRoll']['radius']
    ct = spec['capThickness']
    rings_b, rings_r = [], []
    for i in range(n):
        t = L * i / (n - 1)
        x, z = a[0] + d[0] * t, a[1] + d[1] * t
        ty = topfn(t)
        cy = ty + ct - 0.02  # roll chord 沉入瓦板防共面
        rings_b.append([bl_pt(x - nx * rb, z - nz * rb, ty), bl_pt(x + nx * rb, z + nz * rb, ty),
                        bl_pt(x + nx * rb, z + nz * rb, ty + ct), bl_pt(x - nx * rb, z - nz * rb, ty + ct)])
        rings_r.append([bl_pt(x - nx * rr, z - nz * rr, cy),
                        bl_pt(x, z, cy + rr * 0.9),
                        bl_pt(x + nx * rr, z + nz * rr, cy)])
    loft(module, name + '-board', rings_b, M['tileCap'], tile=(1.44, 1.36), smooth_sides=True)
    loft(module, name + '-roll', rings_r, M['tileCap'], tile=(1.44, 1.36), smooth_sides=True, uv_vertex=True)

def wall_lips(module, a, b, topfn, top_offset, spacing, radius):
    L = math.dist(a, b)
    d = seg_dir(a, b)
    nx, nz = -d[1], d[0]
    cnt = max(0, int((L - 0.3) // spacing))
    for k in range(cnt):
        t = 0.15 + (k + 0.5) * spacing
        if t > L - 0.15:
            break
        x, z = a[0] + d[0] * t, a[1] + d[1] * t
        ty = topfn(t) + top_offset
        for sgn in (-1, 1):
            off = sgn * 0.235
            x2, z2 = x + d[0] * 0.15, z + d[1] * 0.15
            ring0 = [bl_pt(x + nx * (off - radius), z + nz * (off - radius), ty),
                     bl_pt(x + nx * off, z + nz * off, ty + radius),
                     bl_pt(x + nx * (off + radius), z + nz * (off + radius), ty)]
            ring1 = [bl_pt(x2 + nx * (off - radius), z2 + nz * (off - radius), ty),
                     bl_pt(x2 + nx * off, z2 + nz * off, ty + radius),
                     bl_pt(x2 + nx * (off + radius), z2 + nz * (off + radius), ty)]
            loft(module, 'lip', [ring0, ring1], M['tileCap'], tile=(1.44, 1.36), smooth_sides=True, uv_vertex=True)

def build_wall(spec_id, opts):
    o = SI['objects'][spec_id]
    segs = [tuple(map(tuple, s)) for s in o['geometry']['segments']]
    cl = cumlen_segs(segs)
    total = cl[-1]
    thick = o.get('thickness', 0.45)
    H = o.get('height', 2.9)
    mod = spec_id
    PH, PP = opts['plinthH'], opts['plinthProud']
    amp, lam = opts.get('amp', 0.0), opts.get('lambda', 6.0)
    head_s = None
    head = SI['objects'].get('garden-wall-dragonhead')
    if head and opts.get('riseToHead'):
        hx, hz = head['geometry']['x'], head['geometry']['z']
        # 龙头端 = 离龙头最近的段端点；s_head = 该端点在列出顺序里的累计长度
        best = None
        for j, (a, b) in enumerate(segs):
            for which, p, s_at in (('end', b, cl[j + 1]), ('start', a, cl[j])):
                d = math.dist(p, (hx, hz))
                if best is None or d < best[0]:
                    best = (d, which, j, s_at)
        d_head, which, j, s_head = best
        HEAD_INFO.update({'end': f'seg{j}-{which}', 'distToPolylineEnd': round(d_head, 3),
                          'headXZ': [hx, hz], 'rotY': head['geometry']['rotY'], 'sHeadM': round(s_head, 2)})
        if d_head > 4.0:
            ASSUMPTIONS.append(f'garden-wall dragon head is {d_head:.2f}m from nearest segment endpoint; cap rise anchored to that endpoint anyway')
        globals()['HEAD_S'] = s_head

    def top_at_s(s):
        y = H + amp * math.sin(2 * math.pi * s / lam) if amp else H
        if head_s is None and opts.get('riseToHead') and 'HEAD_S' in globals():
            pass
        s_head = globals().get('HEAD_S') if opts.get('riseToHead') else None
        if s_head is not None:
            d_head = abs(s_head - s)  # 龙头前的 6 m：沿墙向龙头
            if s_head < 6.0:
                d_head = s  # 链起点即龙头端：向链尾方向抬升
            if d_head < 6.0:
                y += 0.9 * smoothstep((6.0 - d_head) / 6.0)
        return y

    windows = []
    for lw in o['geometry'].get('lattice', []):
        best = None
        for i, (a, b) in enumerate(segs):
            d = seg_dir(a, b)
            t = max(0.0, min(math.dist(a, b), (lw['x'] - a[0]) * d[0] + (lw['z'] - a[1]) * d[1]))
            px, pz = a[0] + d[0] * t, a[1] + d[1] * t
            dist = math.hypot(lw['x'] - px, lw['z'] - pz)
            if best is None or dist < best[3]:
                best = (i, t, d, dist)
        i, t, d, dist = best
        if dist > 0.3:
            raise ValueError(f'lattice window {lw} not on wall ({dist:.2f}m off)')
        wyaw = lw['rotY']
        wd = (math.sin(wyaw), math.cos(wyaw))
        if abs(wd[0] * d[0] + wd[1] * d[1]) < 0.98:
            ASSUMPTIONS.append(f'lattice window ({lw["x"]:.2f},{lw["z"]:.2f}) rotY deviates from its segment direction by {math.degrees(math.acos(min(1, abs(wd[0] * d[0] + wd[1] * d[1])))):.1f}deg; segment direction used (layout line is authority)')
        windows.append({'seg': i, 'u': t, 'x': lw['x'], 'z': lw['z']})

    gaps = {}
    for w in windows:
        gaps.setdefault(w['seg'], []).append(w['u'])
    for i, (a, b) in enumerate(segs):
        L = math.dist(a, b)
        if L < 0.05:
            continue
        us = sorted(gaps.get(i, []))
        wall_strip(mod, 'plinth', a, b, 0.0, PH, thick + 2 * PP, M['greyStone'], ds=8.0)
        prev = 0.0
        for u in us:
            if u - 0.65 > prev + 0.05:
                u0, u1 = prev, u - 0.65
                a2 = (a[0] + (b[0] - a[0]) * u0 / L, a[1] + (b[1] - a[1]) * u0 / L)
                b2 = (a[0] + (b[0] - a[0]) * u1 / L, a[1] + (b[1] - a[1]) * u1 / L)
                wall_strip(mod, 'body', a2, b2, PH, (lambda t, s0=cl[i] + u0: top_at_s(s0 + t)), thick, M['whitePlaster'], ds=0.75 if amp else 8.0)
            a2 = (a[0] + (b[0] - a[0]) * (u - 0.65) / L, a[1] + (b[1] - a[1]) * (u - 0.65) / L)
            b2 = (a[0] + (b[0] - a[0]) * (u + 0.65) / L, a[1] + (b[1] - a[1]) * (u + 0.65) / L)
            wall_strip(mod, 'win-under', a2, b2, PH, 1.0, thick, M['whitePlaster'], ds=2.0)
            wall_strip(mod, 'win-over', a2, b2, 2.1, (lambda t, s0=cl[i] + u - 0.65: top_at_s(s0 + t)), thick, M['whitePlaster'], ds=0.45)
            prev = u + 0.65
        if L - 0.05 > prev:
            a2 = (a[0] + (b[0] - a[0]) * prev / L, a[1] + (b[1] - a[1]) * prev / L)
            wall_strip(mod, 'body', a2, b, PH, (lambda t, s0=cl[i] + prev: top_at_s(s0 + t)), thick, M['whitePlaster'], ds=0.75 if amp else 8.0)
        if amp:
            cap_top = lambda t, s0=cl[i]: top_at_s(s0 + t)
            wall_cap(mod, 'cap', a, b, cap_top, opts['cap'], ds=0.45)
            wall_lips(mod, a, b, cap_top, opts['cap']['capThickness'] - 0.02, opts['cap']['tileLips']['spacing'], opts['cap']['tileLips']['radius'])
        else:
            wall_cap(mod, 'cap', a, b, lambda t, s0=cl[i]: H + opts['capThicknessPlain'], opts['cap'], ds=max(2.0, L / 2))
    # 角墩：run 两端 + 连接转角>15°（temple：全部顶点）
    pier_h = H + 0.25
    conns = {}
    for j, (a, b) in enumerate(segs):
        ka = (round(a[0], 4), round(a[1], 4))
        kb = (round(b[0], 4), round(b[1], 4))
        conns.setdefault(ka, []).append(('a', j))
        conns.setdefault(kb, []).append(('b', j))
    for key, clist in conns.items():
        if not opts.get('piersAtAllVertices'):
            if len(clist) == 1:
                pass  # run 端点
            elif len(clist) == 2 and {w for w, _ in clist} == {'b', 'a'}:
                (_, j1), (_, j2) = clist
                d0, d1 = seg_dir(*segs[j1]), seg_dir(*segs[j2])
                if not (amp and abs(math.atan2(d0[0] * d1[1] - d0[1] * d1[0], d0[0] * d1[0] + d0[1] * d1[1])) > math.radians(15)):
                    continue
            else:
                continue
        p = (key[0], key[1])
        _w, j = clist[0]
        yaw = seg_yaw(*segs[j])
        box_part(mod, 'pier', (p[0], pier_h / 2, p[1]), (0.6, pier_h, 0.6), yaw, M['whitePlaster'])
    if opts.get('lattice'):
        for k, w in enumerate(windows):
            yaw = seg_yaw(*segs[w['seg']])
            wd = (math.sin(yaw), math.cos(yaw))
            x, z = w['x'], w['z']
            for su in (-1, 1):
                box_part(mod, 'frame', (x + wd[0] * su * 0.65, 1.55, z + wd[1] * su * 0.65), (0.08, 1.26, thick + 0.06), yaw, M['greyStone'], smooth_all=True)
            for sv in (1.0 - 0.04, 2.1 + 0.04):
                box_part(mod, 'frame', (x, sv, z), (1.46, 0.08, thick + 0.06), yaw, M['greyStone'], smooth_all=True)
            nbars = lattice_bars(mod, (x, z), wd, 'huiwen' if k % 2 == 0 else 'haitang', M['darkGlaze'])
            if nbars > 26:
                raise ValueError('too many lattice bars')
    return {'total': round(total, 2), 'segments': len(segs)}

def lattice_bars(module, C, wdir, pat, matl):
    th = 0.035
    cnt = 0
    def bar(u0, v0, u1, v1):
        nonlocal cnt
        cu, cv = (u0 + u1) / 2, (v0 + v1) / 2
        ln = math.hypot(u1 - u0, v1 - v0) + th
        size = (ln, th, 0.06) if abs(u1 - u0) >= abs(v1 - v0) else (th, ln, 0.06)
        yaw = math.atan2(wdir[0], wdir[1])
        box_part(module, 'lattice', (C[0] + wdir[0] * cu, cv, C[1] + wdir[1] * cu), size, yaw, matl, smooth_all=True)
        cnt += 1
    bar(-0.60, 1.04, 0.60, 1.04); bar(-0.60, 2.06, 0.60, 2.06)
    bar(-0.60, 1.04, -0.60, 2.06); bar(0.60, 1.04, 0.60, 2.06)
    if pat == 'huiwen':
        bar(-0.45, 1.22, 0.45, 1.22); bar(-0.45, 1.88, 0.45, 1.88)
        for u0 in (-0.45, 0.15):
            bar(u0, 1.22, u0, 1.48); bar(u0 + 0.30, 1.22, u0 + 0.30, 1.88)
            bar(u0, 1.48, u0 + 0.30, 1.48); bar(u0 + 0.30, 1.48, u0 + 0.30, 1.88)
        bar(-0.15, 1.66, 0.15, 1.66)
    else:
        bar(-0.60, 1.42, 0.60, 1.42); bar(0.0, 1.04, 0.0, 2.06)
        for su in (-1, 1):
            bar(su * 0.16, 1.60, su * 0.34, 1.88)   # 上斜瓣
            bar(su * 0.16, 1.50, su * 0.34, 1.22)   # 下斜瓣
    return cnt

# ================================================================ 龙头（占位同姿态）
def head_map(lx, ly, lz):
    hx, hz, r = (SI['objects']['garden-wall-dragonhead']['geometry'][k] for k in ('x', 'z', 'rotY'))
    sn, cs = math.sin(r), math.cos(r)
    return (hx + sn * lz - cs * lx, ly, hz + cs * lz + sn * lx)

def build_dragon_head():
    mod = 'garden-wall-dragonhead'
    def P(lx, ly, lz):
        mx, my, mz = head_map(lx, ly, lz)
        return bl_pt(mx, mz, my)
    # 头体椭球：环 + 极扇闭合
    NR, NZ = 14, 7
    cen = P(0, 3.55, 0.55)
    fwd = P(0, 3.55, 1.55) - cen
    up = Vector((0, 0, 1))
    lft = fwd.cross(up).normalized()
    fwd = fwd.normalized()
    ax_f, ax_w, ax_h = 0.675, 0.55, 0.425
    verts = [cen + up * ax_h]
    for j in range(1, NZ):
        phi = math.pi * j / NZ
        for i in range(NR):
            th = 2 * math.pi * i / NR
            verts.append(cen + fwd * (ax_f * math.sin(phi) * math.sin(th)) + lft * (ax_w * math.sin(phi) * math.cos(th)) + up * (ax_h * math.cos(phi)))
    verts.append(cen - up * ax_h)
    faces = []
    for i in range(NR):
        faces.append((0, 1 + (i + 1) % NR, 1 + i))
    for j in range(NZ - 2):
        b0, b1 = 1 + j * NR, 1 + (j + 1) * NR
        for i in range(NR):
            k = (i + 1) % NR
            faces.append((b0 + i, b1 + i, b1 + k, b0 + k))
    bot = len(verts) - 1
    lb = 1 + (NZ - 2) * NR
    for i in range(NR):
        faces.append((bot, lb + i, lb + (i + 1) % NR))
    mesh_part(mod, 'head-body', verts, faces, M['darkGlaze'], smooth_faces=list(range(len(faces))))
    # 上下颚（张口 0.32）+ 牙
    box_part(mod, 'jaw-upper', head_map(0, 3.72, 0.98), (0.55, 0.26, 0.80), SI['objects']['garden-wall-dragonhead']['geometry']['rotY'], M['darkGlaze'])
    box_part(mod, 'jaw-lower', head_map(0, 3.40, 0.95), (0.50, 0.22, 0.75), SI['objects']['garden-wall-dragonhead']['geometry']['rotY'], M['darkGlaze'])
    hr = SI['objects']['garden-wall-dragonhead']['geometry']['rotY']
    for k in range(6):
        u = -0.20 + k * 0.08
        box_part(mod, 'tooth', head_map(u, 3.545, 1.32), (0.05, 0.11, 0.05), hr, M['whitePlaster'])
        box_part(mod, 'tooth', head_map(u, 3.565, 1.30), (0.05, 0.11, 0.05), hr, M['whitePlaster'])
    # 双角三段弯杆 / 双须
    for su in (-1, 1):
        path = [(su * 0.28, 3.92, 0.10), (su * 0.36, 4.18, -0.05), (su * 0.38, 4.36, -0.28), (su * 0.34, 4.44, -0.52)]
        for a, b in zip(path, path[1:]):
            cyl_part(mod, 'horn', P(*a), P(*b), 0.085, 6, M['darkGlaze'])
        wpath = [(su * 0.20, 3.46, 1.30), (su * 0.34, 3.40, 1.90), (su * 0.30, 3.30, 2.50)]
        for a, b in zip(wpath, wpath[1:]):
            cyl_part(mod, 'whisker', P(*a), P(*b), 0.02, 4, M['darkGlaze'])
    # 鬃鳍 5 片（薄片棱柱）
    for k in range(5):
        lz = -0.35 + k * 0.18
        h = 0.30 - abs(k - 2) * 0.05
        v0, v1, v2 = P(0, 3.92, lz), P(0, 3.92 + h, lz - 0.12), P(0, 3.92, lz + 0.20)
        dx = P(0.014, 0, 0) - P(-0.014, 0, 0)
        vs = [v0, v1, v2, v0 + dx, v1 + dx, v2 + dx]
        fs = [(0, 1, 2), (5, 4, 3), (0, 3, 4), (0, 4, 1), (1, 4, 5), (1, 5, 2), (2, 5, 3), (2, 3, 0)]
        mesh_part(mod, 'mane', vs, fs, M['darkGlaze'])
    # 眼 2
    for su in (-1, 1):
        sph_part(mod, 'eye', P(su * 0.22, 3.66, 0.92), 0.08, M['whitePlaster'], nr=7, nz=4)
    # 颈鳞 3 圈（截面矩形环）
    for k in range(3):
        lz = -0.12 - k * 0.16
        rr, cy = 0.44 - k * 0.06, 3.50 - k * 0.04
        rings = []
        for i in range(7):
            th = 2 * math.pi * i / 7
            base = P(rr * math.cos(th), cy + rr * 0.7 * math.sin(th), lz)
            out = (base - P(0, cy, lz))
            out.z = 0
            if out.length < 1e-6:
                out = Vector((1, 0, 0))
            out.normalize()
            rings.append([base, base + out * 0.05, base + out * 0.05 + Vector((0, 0, 0.07)), base + Vector((0, 0, 0.07))])
        rings.append(rings[0])
        loft(mod, 'neckscale', rings, M['darkGlaze'], cap_start=False, cap_end=False, smooth_sides=True)

# ================================================================ 月洞门
def build_moon_gate():
    o = SI['objects']['yuhuatang-moongate']
    x0, z0 = o['geometry']['position']
    rotY = o['geometry']['rotY']
    w, h, th, r = o['width'], o['height'], o['thickness'], o['openingR']
    cyh = 1.6
    mod = 'moon-gate'
    th_ = rotY - math.pi / 2
    wdir = (math.cos(th_), -math.sin(th_))
    ndir = (math.sin(th_), math.cos(th_))
    def pt(u, v, t):
        return bl_pt(x0 + wdir[0] * u + ndir[0] * t, z0 + wdir[1] * u + ndir[1] * t, v)
    if cyh + r > h:
        ASSUMPTIONS.append(f'moon-gate opening apex {cyh + r:.3f}m exceeds wall height {h}m by {cyh + r - h:.3f}m (spec internal): opening runs open into the top edge, stone ring crown meets the cap')
    hu = math.sqrt(max(0.0, r * r - (h - cyh) ** 2)) if cyh + r > h else 0.0
    outline = [(-w / 2, 0.0), (w / 2, 0.0), (w / 2, h)]
    if cyh + r > h:
        a0 = math.atan2(h - cyh, hu)
        outline.append((hu, h))
        k = 12
        for i in range(1, k + 1):
            ang = a0 - (a0 + (math.pi - a0)) * i / k  # 72deg -> -252deg 顺时针绕洞整圈
            outline.append((r * math.cos(ang), cyh + r * math.sin(ang)))
    outline += [(-w / 2, h)]
    n_out = len(outline)
    t2 = th / 2
    front = [pt(u, v, t2) for u, v in outline]
    back = [pt(u, v, -t2) for u, v in outline]
    def ear_clip(poly2):
        """poly2: [(u,v)] 任意简单多边形 -> 原索引三角列表。"""
        idx = list(range(len(poly2)))
        tris = []
        guard = 0
        while len(idx) > 3 and guard < 10000:
            guard += 1
            n = len(idx)
            done = False
            for i in range(n):
                ia, ib, ic = idx[(i - 1) % n], idx[i], idx[(i + 1) % n]
                a, b, c = poly2[ia], poly2[ib], poly2[ic]
                cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
                if cross <= 1e-9:
                    continue
                ok = True
                for jj in idx:
                    if jj in (ia, ib, ic):
                        continue
                    px, py = poly2[jj]
                    d0 = (c[0] - a[0], c[1] - a[1])
                    d1 = (b[0] - a[0], b[1] - a[1])
                    d2 = (px - a[0], py - a[1])
                    den = d0[0] * d1[1] - d0[1] * d1[0]
                    if abs(den) < 1e-12:
                        continue
                    ss = (d1[1] * d2[0] - d1[0] * d2[1]) / den
                    tt = (d0[0] * d2[1] - d0[1] * d2[0]) / den
                    if ss >= -1e-9 and tt >= -1e-9 and ss + tt <= 1 + 1e-9:
                        ok = False
                        break
                if ok:
                    tris.append((ia, ib, ic))
                    del idx[i]
                    done = True
                    break
            if not done:
                tris.append((idx[0], idx[1], idx[2]))
                del idx[1]
        tris.append((idx[0], idx[1], idx[2]))
        return tris
    # 面积定绕序，保证耳切方向一致
    area2 = sum((outline[i][0] * outline[(i + 1) % n_out][1] - outline[(i + 1) % n_out][0] * outline[i][1]) for i in range(n_out))
    poly_ccw = outline if area2 > 0 else list(reversed(outline))
    cap_tris = ear_clip(poly_ccw)
    faces = []
    for i in range(n_out):
        j = (i + 1) % n_out
        faces.append((i, j, n_out + j, n_out + i))
    for (a, b, c) in cap_tris:
        faces.append((a, c, b))                      # 前盖
        faces.append((n_out + a, n_out + b, n_out + c))  # 后盖
    mesh_part(mod, 'wall', front + back, faces, M['whitePlaster'])
    # 石环：全圆矩形截面 torus（径向 0.14，两侧出挑 0.04）
    rw, proud, segs = 0.14, 0.04, 24
    rt = th / 2 + proud
    rings = []
    for i in range(segs):
        ang = 2 * math.pi * i / segs
        ca, sa = math.cos(ang), math.sin(ang)
        cu, cv = r * ca, cyh + r * sa
        rr = rw / 2
        rings.append([pt(cu - rr * ca, cv - rr * sa, -rt), pt(cu + rr * ca, cv + rr * sa, -rt),
                      pt(cu + rr * ca, cv + rr * sa, rt), pt(cu - rr * ca, cv - rr * sa, rt)])
    rings.append(rings[0])
    loft(mod, 'ring', rings, M['greyStone'], cap_start=False, cap_end=False, smooth_sides=True)
    # 瓦帽 0.55 宽 + 两侧瓦当；端墩
    cap_w, cap_l = 0.55, w + 0.5
    yaw = math.atan2(wdir[0], wdir[1])
    box_part(mod, 'cap', (x0, h + 0.06, z0), (cap_l, 0.12, cap_w), yaw, M['tileCap'], tile=(1.44, 1.36))
    for su in (-1, 1):
        off = su * (cap_w / 2 - 0.09)
        cnt = int((cap_l - 0.2) // 0.24)
        for k in range(cnt):
            u = -cap_l / 2 + 0.1 + (k + 0.5) * 0.24
            px, pz = x0 + wdir[0] * u, z0 + wdir[1] * u
            x2, z2 = px + wdir[0] * 0.15, pz + wdir[1] * 0.15
            ring0 = [bl_pt(px + ndir[0] * (off - 0.09), pz + ndir[1] * (off - 0.09), h + 0.10),
                     bl_pt(px + ndir[0] * off, pz + ndir[1] * off, h + 0.19),
                     bl_pt(px + ndir[0] * (off + 0.09), pz + ndir[1] * (off + 0.09), h + 0.10)]
            ring1 = [bl_pt(x2 + ndir[0] * (off - 0.09), z2 + ndir[1] * (off - 0.09), h + 0.10),
                     bl_pt(x2 + ndir[0] * off, z2 + ndir[1] * off, h + 0.19),
                     bl_pt(x2 + ndir[0] * (off + 0.09), z2 + ndir[1] * (off + 0.09), h + 0.10)]
            loft(mod, 'caplip', [ring0, ring1], M['tileCap'], smooth_sides=True, uv_vertex=True)
    for su in (-1, 1):
        px, pz = x0 + wdir[0] * su * (w / 2 + 0.25), z0 + wdir[1] * su * (w / 2 + 0.25)
        box_part(mod, 'pier', (px, 2.85 / 2, pz), (0.5, 2.85, 0.5), yaw, M['whitePlaster'])
    return {'yawDeg': round(math.degrees(yaw), 2)}

# ================================================================ 九曲桥
def build_bridge():
    o = SI['objects']['jiuqu-bridge']
    pts = [tuple(p) for p in o['geometry']['polyline']]
    W = o.get('width', 2.4)
    deckY = o.get('deckY', 0.55)
    mod = 'jiuqu-bridge'
    botY = deckY - 0.18
    n = len(pts)
    dirs = [seg_dir(pts[i], pts[i + 1]) for i in range(n - 1)]
    nrms = [(-d[1], d[0]) for d in dirs]
    def mitre(i, side):
        if i <= 0:
            nn = nrms[0]
            return (pts[0][0] + nn[0] * side * W / 2, pts[0][1] + nn[1] * side * W / 2)
        if i >= n - 1:
            nn = nrms[-1]
            return (pts[-1][0] + nn[0] * side * W / 2, pts[-1][1] + nn[1] * side * W / 2)
        n0, n1 = nrms[i - 1], nrms[i]
        cx, cz = (n0[0] + n1[0]) * side, (n0[1] + n1[1]) * side
        cl2 = math.hypot(cx, cz)
        if cl2 < 1e-6:
            cx, cz, cl2 = n1[0] * side, n1[1] * side, 1.0
        cx, cz = cx / cl2, cz / cl2
        m = min((W / 2) / max(cx * n1[0] + cz * n1[1], 0.35), 1.9)
        return (pts[i][0] + cx * m, pts[i][1] + cz * m)
    for i in range(n - 1):
        corners = [mitre(i, -1), mitre(i + 1, -1), mitre(i + 1, 1), mitre(i, 1)]
        verts = [bl_pt(cx, cz, deckY) for cx, cz in corners] + [bl_pt(cx, cz, botY) for cx, cz in corners]
        mesh_part(mod, 'deck', verts, [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], M['deckStone'], smooth_faces=list(range(6)))
        for side in (-1, 1):
            e0, e1 = mitre(i, side), mitre(i + 1, side)
            nn = nrms[i]
            f = [(e0[0], e0[1]), (e1[0], e1[1]), (e1[0] - nn[0] * side * 0.12, e1[1] - nn[1] * side * 0.12), (e0[0] - nn[0] * side * 0.12, e0[1] - nn[1] * side * 0.12)]
            verts = [bl_pt(ax, az, deckY) for ax, az in f] + [bl_pt(ax, az, deckY + 0.06) for ax, az in f]
            mesh_part(mod, 'curb', verts, [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], M['greyStone'], smooth_faces=list(range(6)), uv_vertex=True)
    # 栏杆
    post_off = W / 2 - 0.08 - 0.11
    seen = []
    def add_post(q):
        if not any(math.dist(q[:2], p[:2]) < 0.05 for p in seen):
            seen.append(q)
    for i in range(n - 1):
        L = math.dist(pts[i], pts[i + 1])
        npost = max(1, int(math.ceil(L / 1.5)))
        for k in range(npost + 1):  # 含跨端 -> 顶点必有柱
            t = L * k / npost
            for side in (-1, 1):
                nn = nrms[i]
                add_post((pts[i][0] + dirs[i][0] * t + nn[0] * side * post_off, pts[i][1] + dirs[i][1] * t + nn[1] * side * post_off))
    for (px, pz) in seen:
        box_part(mod, 'post', (px, deckY + 0.475, pz), (0.22, 0.95, 0.22), 0.0, M['greyStone'], smooth_all=True)
        sph_part(mod, 'postcap', bl_pt(px, pz, deckY + 1.02), 0.12, M['greyStone'], nr=6, nz=3, uv_vertex=True)
    npost_total = len(seen)
    # 栏板：相邻柱之间（同跨同侧），四边框 + 内嵌凹板（凹 0.03）
    panels = 0
    for i in range(n - 1):
        L = math.dist(pts[i], pts[i + 1])
        npost = max(1, int(math.ceil(L / 1.5)))
        for k in range(npost):
            t0, t1 = L * k / npost, L * (k + 1) / npost
            for side in (-1, 1):
                nn = nrms[i]
                ax, az = pts[i][0] + dirs[i][0] * t0 + nn[0] * side * post_off, pts[i][1] + dirs[i][1] * t0 + nn[1] * side * post_off
                bx, bz = pts[i][0] + dirs[i][0] * t1 + nn[0] * side * post_off, pts[i][1] + dirs[i][1] * t1 + nn[1] * side * post_off
                if math.dist((ax, az), (bx, bz)) < 0.3:
                    continue
                mx, mz, ln = (ax + bx) / 2, (az + bz) / 2, math.dist((ax, az), (bx, bz))
                yaw = math.atan2(dirs[i][0], dirs[i][1])
                y0, hh = deckY + 0.12, 0.72
                fb = 0.055  # 边框宽
                # 边框：方管截面（厚 0.06 × 宽 fb）沿板面矩形路径一圈（picture-frame torus，共享顶点）
                sn, cs = math.sin(yaw), math.cos(yaw)
                nnx, nnz = cs, -sn  # 板面水平法向（地图系）
                th2, wb = 0.03, fb / 2
                rect = [(0.0, 0.0), (ln, 0.0), (ln, hh), (0.0, hh)]
                rings = []
                for k in range(4):
                    a = rect[k]
                    b = rect[(k + 1) % 4]
                    tm = (b[0] - a[0], b[1] - a[1])
                    tl = math.hypot(*tm)
                    tu_, tv_ = tm[0] / tl, tm[1] / tl
                    npx, npz = -tv_, tu_
                    corner = a
                    ring = []
                    for tofs, wofs in ((th2, wb), (-th2, wb), (-th2, -wb), (th2, -wb)):
                        ux_off = npx * wofs   # 面内 (u, v) 基下直接偏移
                        v_off = npz * wofs
                        ring.append(bl_pt(
                            mx + (corner[0] + ux_off) * sn + nnx * tofs,
                            mz + (corner[0] + ux_off) * cs + nnz * tofs,
                            y0 + corner[1] + v_off))
                    rings.append(ring)
                rings.append(rings[0])
                loft(mod, 'panel', rings, M['greyStone'], cap_start=False, cap_end=False, smooth_sides=True, uv_vertex=True)
                box_part(mod, 'panel-recess', (mx, y0 + hh / 2, mz), (max(0.1, ln - 2 * fb), hh - 2 * fb, 0.024), yaw, M['greyStone'], smooth_all=True)
                panels += 1
    # 桥墩对：每 3.0 m + 每顶点
    pier_pos, acc, next_at = [pts[0]], 0.0, 3.0
    for i in range(n - 1):
        L = math.dist(pts[i], pts[i + 1])
        while acc + L >= next_at:
            t = next_at - acc
            pier_pos.append((pts[i][0] + dirs[i][0] * t, pts[i][1] + dirs[i][1] * t))
            next_at += 3.0
        acc += L
    uniq = []
    for p in pier_pos + pts[1:]:
        if not any(math.dist(p, q) < 0.3 for q in uniq):
            uniq.append(p)
    for (px, pz) in uniq:
        best = None
        for i in range(n - 1):
            d = seg_dir(pts[i], pts[i + 1])
            t = max(0, min(math.dist(pts[i], pts[i + 1]), (px - pts[i][0]) * d[0] + (pz - pts[i][1]) * d[1]))
            qx, qz = pts[i][0] + d[0] * t, pts[i][1] + d[1] * t
            dist = math.hypot(px - qx, pz - qz)
            if best is None or dist < best[0]:
                best = (dist, (-d[1], d[0]))
        nn = best[1]
        for side in (-1, 1):
            box_part(mod, 'piercol', (px + nn[0] * side * 0.9, (botY - 0.7) / 2, pz + nn[1] * side * 0.9), (0.36, botY - (-0.7), 0.36), 0.0, M['greyStone'], smooth_all=True)
    return {'posts': npost, 'panels': panels, 'piers': len(uniq), 'spans': n - 1}

# ================================================================ 执行
print('== garden-kit build start ==')
gw = build_wall('garden-wall', {
    'plinthH': 0.35, 'plinthProud': 0.06, 'amp': 0.32, 'lambda': 6.0, 'riseToHead': True,
    'cap': {'capWidth': 0.72, 'capThickness': 0.14, 'ridgeRoll': {'radius': 0.11}, 'tileLips': {'spacing': 0.6, 'radius': 0.10}},
    'lattice': True})
build_dragon_head()
build_wall('temple-wall', {
    'plinthH': 0.35, 'plinthProud': 0.06, 'amp': 0.0,
    'cap': {'capWidth': 0.60, 'capThickness': 0.12, 'ridgeRoll': {'radius': 0.10}},
    'capThicknessPlain': 0.12, 'piersAtAllVertices': True})
ASSUMPTIONS.append('temple-wall plain variant dims borrowed from garden cap ratios: capWidth 0.60 / thickness 0.12 / roll r0.10 / piers 0.6x2.85x0.6 at every vertex (spec gives no temple cap dims)')
mg = build_moon_gate()
br = build_bridge()
ASSUMPTIONS.append('bridge: panel band y deck+0.12..+0.84 (0.72 high), recess 0.03 proud each side of center; lotus-bud cap as sphere r0.12 at post top; post centers at edge inset 0.08+0.11')
ASSUMPTIONS.append('lattice patterns simplified analytic 回纹/十字海棠 bars 0.035, <=26 bars per window (spec allows); render from both faces via 0.06 depth centered bars')

# 导出：garden-wall(含龙头) / temple-wall / moon-gate / jiuqu-bridge
BUDGET = {'garden-wall': (70000, 1800000), 'garden-wall-dragonhead': (3500, None), 'temple-wall': (20000, None),
          'moon-gate': (4000, None), 'jiuqu-bridge': (30000, 900000)}
GROUPS = [('garden-wall.glb', ['garden-wall', 'garden-wall-dragonhead']),
          ('temple-wall.glb', ['temple-wall']), ('moon-gate.glb', ['moon-gate']), ('jiuqu-bridge.glb', ['jiuqu-bridge'])]
catalog = {'packageId': 'pawborough-yuyuan-garden-kit-night-20260922',
           'coordinateContract': 'GLB Y-up world (x, y, z_map), origin map(0,0), no instance transform; Blender internal (x, -z_map, y); export_yup=True',
           'materials': {}, 'modules': {}, 'headInfo': HEAD_INFO, 'bridgeInfo': br, 'moonGateInfo': mg, 'assumptions': ASSUMPTIONS}
ASSUMPTIONS.append('bridge panel recess plate 0.024 thick centered in 0.06 panel: visible recess ~0.018 per face (spec 0.03 single-sided would leave a zero-thickness plate)')
for glb_name, mods in GROUPS:
    final, tri_by_mod = [], {}
    for mod in mods:
        tri_by_mod[mod] = 0
        for (m2, mat_name), lst in list(MESHES.items()):
            if m2 != mod:
                continue
            ob = triangulate_and_recalc(lst)
            ob.name = f'{mod}__{mat_name}'
            ob.data.calc_loop_triangles()
            tri_by_mod[mod] += len(ob.data.loop_triangles)
            final.append(ob)
            del MESHES[(m2, mat_name)]
    path = os.path.join(OUT, glb_name)
    bpy.ops.object.select_all(action='DESELECT')
    for o in final:
        o.select_set(True)
    bpy.context.view_layer.objects.active = final[0]
    try:
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True, use_selection=True,
                                  export_animations=False, export_tangents=False, export_image_format='AUTO', export_cameras=False, export_lights=False)
    except TypeError:
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, use_selection=True)
    size = os.path.getsize(path)
    entry = {'glb': glb_name, 'bytes': size}
    for mod in mods:
        tmax, bmax = BUDGET.get(mod, (None, None))
        entry[mod] = {'triangles': tri_by_mod[mod], 'budgetTriangles': tmax,
                      'overTri': bool(tmax and tri_by_mod[mod] > tmax)}
    entry['budgetBytes'] = BUDGET.get(mods[0], (None, None))[1]
    entry['overBytes'] = bool(entry['budgetBytes'] and size > entry['budgetBytes'])
    catalog['modules'][mods[0] if mods[0] != 'garden-wall' else 'garden-wall'] = entry
    print(glb_name, size, 'bytes', {k: v for k, v in entry.items() if k.endswith('riangles') or k == 'overBytes'})
catalog['materials'] = META

# ---------------------------------------------------------------- 碰撞代理（地图系盒子）
COLL = {'axis': 'glTF Y-up; map coords (x east, z south), y height', 'note': 'coarse proxies generated from frozen layout lines', 'modules': {}}
def boxes_for_wall(spec_id, thick, height, include_head=False):
    o = SI['objects'][spec_id]
    out = []
    for a, b in o['geometry']['segments']:
        L = math.dist(a, b)
        if L < 0.5:
            continue
        out.append({'center': [(a[0] + b[0]) / 2, height / 2, (a[1] + b[1]) / 2], 'size': [thick, height, L], 'yaw': seg_yaw(a, b), 'type': 'box'})
    if include_head:
        hx, hz, r = (SI['objects']['garden-wall-dragonhead']['geometry'][k] for k in ('x', 'z', 'rotY'))
        sn, cs = math.sin(r), math.cos(r)
        cxm, cym, czm = head_map(0, 3.6, 0.3)
        out.append({'center': [cxm, cym, czm], 'size': [1.6, 1.5, 1.9], 'yaw': r, 'type': 'box', 'name': 'dragon-head'})
    return out
COLL['modules']['garden-wall'] = {'boxes': boxes_for_wall('garden-wall', 0.45, 2.9, include_head=True)}
COLL['modules']['temple-wall'] = {'boxes': boxes_for_wall('temple-wall', 0.4, 2.6)}
mgc = SI['objects']['yuhuatang-moongate']
mgx, mgz = mgc['geometry']['position']
th_ = mgc['geometry']['rotY'] - math.pi / 2
wdir = (math.cos(th_), -math.sin(th_))
mb = [{'center': [mgx, 1.3, mgz], 'size': [mgc['width'], 2.6, mgc['thickness']], 'yaw': mgc['geometry']['rotY'] - math.pi / 2, 'type': 'box', 'note': 'solid screen; moon opening not walkable'}]
for su in (-1, 1):
    mb.append({'center': [mgx + wdir[0] * su * (mgc['width'] / 2 + 0.25), 1.425, mgz + wdir[1] * su * (mgc['width'] / 2 + 0.25)], 'size': [0.5, 2.85, 0.5], 'yaw': mgc['geometry']['rotY'] - math.pi / 2, 'type': 'box'})
COLL['modules']['moon-gate'] = {'boxes': mb}
o = SI['objects']['jiuqu-bridge']
bpts = [tuple(p) for p in o['geometry']['polyline']]
bb = []
for a, b in zip(bpts, bpts[1:]):
    L = math.dist(a, b)
    if L < 0.3:
        continue
    bb.append({'center': [(a[0] + b[0]) / 2, 0.55 - 0.09, (a[1] + b[1]) / 2], 'size': [o.get('width', 2.4), 0.18, L], 'yaw': seg_yaw(a, b), 'type': 'box', 'walkableTop': 0.55})
    for side in (-1, 1):
        d = seg_dir(a, b)
        nn = (-d[1], d[0])
        off = o.get('width', 2.4) / 2 - 0.19
        bb.append({'center': [(a[0] + b[0]) / 2 + nn[0] * side * off, 0.55 + 0.59, (a[1] + b[1]) / 2 + nn[1] * side * off], 'size': [0.24, 1.18, L], 'yaw': seg_yaw(a, b), 'type': 'box', 'name': 'balustrade'})
COLL['modules']['jiuqu-bridge'] = {'boxes': bb}
json.dump(COLL, open(os.path.join(OUT, 'garden-kit-collision.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
json.dump(catalog, open(os.path.join(OUT, 'garden-kit-catalog.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

# ---------------------------------------------------------------- 重导入核对（Blender 侧）
reimport = {'checked': [], 'issues': []}
EXPECT = {'garden-white-plaster': {'images': 1, 'colorspace': ['sRGB']}, 'garden-grey-stone': {'images': 1, 'colorspace': ['sRGB']},
          'garden-tile-cap': {'images': 2, 'colorspace': ['sRGB', 'Non-Color']}, 'garden-dark-glaze': {'images': 0, 'colorspace': []},
          'garden-deck-stone': {'images': 1, 'colorspace': ['sRGB']}}
for glb_name, mods in GROUPS:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, glb_name))
    new = [o for o in bpy.data.objects if o not in before]
    tri = 0
    for o in new:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            tri += len(o.data.loop_triangles)
    mats = {}
    for m in {m for o in new if o.type == 'MESH' for m in o.data.materials if m}:
        imgs = [n for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image]
        principled = [n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED']
        ok = len(principled) == 1
        exp = EXPECT.get(m.name)
        cs = [i.image.colorspace_settings.name for i in imgs]
        if exp and (len(imgs) != exp['images'] or sorted(cs) != sorted(exp['colorspace']) or not ok):
            reimport['issues'].append(f'{glb_name}:{m.name}: images={len(imgs)} cs={cs} principled={ok}')
        mats[m.name] = {'images': len(imgs), 'colorspace': cs, 'allConnected': all(n.outputs['Color'].is_linked or len(imgs) == 0 for n in imgs)}
    expected_tri = sum(catalog['modules'][mods[0]][m]['triangles'] for m in mods)
    if tri != expected_tri:
        reimport['issues'].append(f'{glb_name}: tri mismatch reimport {tri} vs export {expected_tri}')
    reimport['checked'].append({'glb': glb_name, 'reimportedMeshes': len([o for o in new if o.type == 'MESH']), 'triangles': tri, 'materials': mats})
    for o in new:
        bpy.data.objects.remove(o)
json.dump(reimport, open(os.path.join(OUT, 'garden-kit-reimport.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
if reimport['issues']:
    print('REIMPORT ISSUES', reimport['issues'])
    raise RuntimeError('reimport check failed')
print('BUILD DONE', round(time.time() - T0, 1), 's')
