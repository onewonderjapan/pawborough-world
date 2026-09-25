"""商城大楼套件生成器（WP6.2 bazaar-tower-kit，样板=华宝楼 bld-428202599）。

Blender 无头参数化生成商城大楼：footprint 多边形（唯一来源 baseline/layout.json）、
层数与层高、逐层出檐、翼角起翘、转角亭楼、立面开间节奏全部由参数驱动。华宝楼的
数字只存在于 params/huabao-bld-428202599.json（DESIGN_SPEC 冻结值），几何代码不含
任何具体建筑数值——后天裕楼 / 和丰楼等靠新增 params JSON 复用。

坐标契约（同 rockery 站点模块）：内部先在局部正交系 (u=前街轴, v=指后街, h=高) 建模，
to_b() 直接落到地图系 Blender (map_x, -map_z, h)；export_yup=True 导出后 GLB (x, h, z)
即地图世界坐标。GLB 内含名为 <id> 的锚 empty（位于 footprint 面积形心），网格保持
世界坐标挂锚下。

形制（读法记录在 recipe.json）：主体逐层出檐腰檐；4 层退台 2.0 m（退台面=下层檐）；
歇山主屋面（凹曲 profile 破环 + 上段陡坡 + 两端山花），平面在转角亭楼前收头避让；
转角亭楼=全高角塔（随主体层节奏，上加 extraTiers + 攒尖鎏金顶）。

运行：blender -b -t 4 --python-exit-code 1 -P modules/bazaar-tower-kit/build_tower.py -- \
      [--params params/huabao-bld-428202599.json（相对本目录）] [--out out-bazaar-towers/<id>]
"""
import bpy, bmesh, json, math, os, sys, time
from mathutils import Vector

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(flag, default):
    return ARGS[ARGS.index(flag) + 1] if flag in ARGS else default

PARAMS_REL = arg('--params', 'params/huabao-bld-428202599.json')
P = json.load(open(os.path.join(HERE, PARAMS_REL), encoding='utf-8'))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))          # scene-authoring/yuyuan-area
OUT = os.path.join(ROOT, arg('--out', os.path.join('out-bazaar-towers', P['id'])))
os.makedirs(OUT, exist_ok=True)
os.makedirs(os.path.join(OUT, 'renders'), exist_ok=True)

# ---------- 输入：footprint 唯一来源 = baseline/layout.json ----------
LAYOUT = json.load(open(os.path.join(ROOT, 'baseline', 'layout.json'), encoding='utf-8'))
OBJ = next(o for o in LAYOUT['objects'] if o['id'] == P['id'])
FP = [list(q) for q in OBJ['geometry']['footprint']]
if FP[0] == FP[-1]:
    FP = FP[:-1]

# ---------- 材质（source-kit 纹理 + 解析色；参数只给 tint/tile） ----------
TEX_DIR = os.path.abspath(os.path.join(ROOT, '..', '..', 'asset-authoring', 'yuyuan-entry', 'source-kit', 'textures'))
if not os.path.isdir(TEX_DIR):
    TEX_DIR = '/home/baibai/work/onewonderjapan/pawborough-world/asset-authoring/yuyuan-entry/source-kit/textures'
if not os.path.isdir(TEX_DIR):
    raise RuntimeError('source-kit textures not found')

TILE = {}
META = {}
def lin(hx):
    a = [int(hx[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in a]

def mat(key, rgb=None, rough=.8, base=None, normal=None, tint=None, tile=(1, 1), metallic=0.0,
        alpha=None, alpha_mode=None):
    m = bpy.data.materials.new('btk-' + key)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    p = nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*(rgb if rgb else (1, 1, 1)), 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metallic
    if base:
        t = nodes.new('ShaderNodeTexImage')
        t.extension = 'REPEAT'
        t.image = bpy.data.images.load(os.path.join(TEX_DIR, base), check_existing=True)
        t.image.colorspace_settings.name = 'sRGB'
        t.image.pack()
        if tint:
            mix = nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1.0
            mix.inputs[7].default_value = (*lin(tint), 1)
            links.new(t.outputs['Color'], mix.inputs[6])
            links.new(mix.outputs[2], p.inputs['Base Color'])
        else:
            links.new(t.outputs['Color'], p.inputs['Base Color'])
    if normal:
        t = nodes.new('ShaderNodeTexImage')
        t.extension = 'REPEAT'
        t.image = bpy.data.images.load(os.path.join(TEX_DIR, normal), check_existing=True)
        t.image.colorspace_settings.name = 'Non-Color'
        t.image.pack()
        nm = nodes.new('ShaderNodeNormalMap')
        nm.inputs['Strength'].default_value = .65
        links.new(t.outputs['Color'], nm.inputs['Color'])
        links.new(nm.outputs['Normal'], p.inputs['Normal'])
    if alpha is not None:
        p.inputs['Alpha'].default_value = alpha
        if alpha_mode:
            try:
                m.blend_method = alpha_mode
            except AttributeError:
                pass
    TILE[key] = tile
    META['btk-' + key] = {'tintSrgb': tint, 'roughness': rough, 'metallic': metallic, 'alpha': alpha,
                          'alphaMode': alpha_mode,
                          'textures': {k: v for k, v in (('color', base), ('normal', normal)) if v},
                          'tileMeters': list(tile)}
    return m

def make_lattice_image(cells_per_m=8.0, size=256, base=(36, 29, 24), key='lattice',
                       png='lattice-core-alpha.png', slats=False, slat_spacing=0.12, slat_w=0.045):
    """解析 alpha 格心/直棂贴图：size 像素 = 1 m（同 sansuitang 手法）。slats=True 画直棂竖条。"""
    px = bytearray(size * size * 4)
    if slats:
        period, bar = size * slat_spacing, size * slat_w
        def _on(x, y):
            return (x % period) < bar
    else:
        cell = size / cells_per_m
        bar = max(2.0, cell * 0.16)
        def _on(x, y):
            dx, dy = x % cell, y % cell
            sd = (x + y) % cell
            return dx < bar or dy < bar or sd < bar * 0.9
    for y in range(size):
        for x in range(size):
            k = (y * size + x) * 4
            if _on(x, y):
                px[k], px[k + 1], px[k + 2], px[k + 3] = *base, 255
            else:
                px[k], px[k + 1], px[k + 2], px[k + 3] = 255, 255, 255, 0
    img = bpy.data.images.new('tower-' + key, size, size, alpha=True)
    img.pixels = [v / 255.0 for v in px]
    tex_out = os.path.join(HERE, 'textures', png)
    os.makedirs(os.path.dirname(tex_out), exist_ok=True)
    img.filepath_raw = tex_out
    img.file_format = 'PNG'
    img.save()
    img.pack()
    m = bpy.data.materials.new('btk-' + key)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    p = nodes.get('Principled BSDF')
    p.inputs['Roughness'].default_value = .7
    p.inputs['Metallic'].default_value = 0
    t = nodes.new('ShaderNodeTexImage')
    t.image = img
    t.extension = 'REPEAT'
    links.new(t.outputs['Color'], p.inputs['Base Color'])
    links.new(t.outputs['Alpha'], p.inputs['Alpha'])
    try:
        m.blend_method = 'CLIP'
    except AttributeError:
        pass
    TILE[key] = (1.0, 1.0)          # UV 单位=米，贴图即 1 m 格网
    META['btk-' + key] = {'alpha': 'modules/bazaar-tower-kit/textures/' + png,
                          **({} if slats else {'cellM': 1.0 / cells_per_m}),
                          'alphaMode': 'MASK', 'alphaCutoff': 0.5,
                          'textures': {}, 'tileMeters': [1.0, 1.0]}
    return m

FM = P['materials']
WOOD_RGB = tuple(bytes.fromhex(FM['timberTint']))       # 深红木（格心/直棂条同色，读作木不是金属网格）
GILD_RGB = tuple(bytes.fromhex(FM['gilded']))
FCP = P['facades']
M = {
    'wall': mat('wall', rough=.85, base='PaintedPlaster017_2K-JPG_Color_1K.jpg',
                tint=FM['plasterTint'], tile=tuple(FM['plasterTile'])),
    'wood': mat('wood', rough=.7, base='wood-stain-color.jpg', tint=FM['timberTint'],
                normal='Wood092_2K-JPG_NormalGL_1K.jpg', tile=tuple(FM['timberTile'])),
    'stone': mat('stone', rough=.92, base='Bricks061_2K-JPG_Color_1K.jpg',
                 tint=FM['plinthTint'], tile=tuple(FM['plinthTile'])),
    'roof': mat('roof', rough=.8, base='roof-color.jpg', normal='roof-normal.png',
                tile=tuple(FM['roofTile'])),
    'gild': mat('gild', lin(FM['gilded']), .38, metallic=.55),
    'glass': mat('glass', lin(FM['glass']), .18, alpha=FM['glassAlpha'], alpha_mode='BLEND'),
    'dark': mat('dark', lin(FM['dark']), .6),
    'lattice': make_lattice_image(base=WOOD_RGB),
    'slats': make_lattice_image(key='slats', png='slats-alpha.png', base=WOOD_RGB, slats=True,
                                slat_spacing=FCP.get('balustradeSlatPitchM', .12),
                                slat_w=FCP.get('balustradeSlatBarM', .045)),
    'guoluo': make_lattice_image(key='guoluo', png='guoluo-alpha.png', base=GILD_RGB,
                                 cells_per_m=FCP.get('guoluoCellsPerM', 8.0)),
}

# ---------- 局部正交系：u=前街轴（footprint frontEdge 0->1），v=指后街，h=高 ----------
i0, i1 = P['frontEdge']
O = Vector((FP[i0][0], FP[i0][1]))
du = Vector((FP[i1][0] - FP[i0][0], FP[i1][1] - FP[i0][1])).normalized()
dv = Vector((-du.y, du.x))          # 前街轴旋转 +90°，指向后街一侧
def uv_of(pt):
    d = Vector((pt[0], pt[1])) - O
    return (d.dot(du), d.dot(dv))
UVP = [uv_of(q) for q in FP]

def poly_area(poly):
    s = 0.0
    for i in range(len(poly)):
        x0, y0 = poly[i][0], poly[i][1]
        x1, y1 = poly[(i + 1) % len(poly)][0], poly[(i + 1) % len(poly)][1]
        s += x0 * y1 - x1 * y0
    return s / 2

def area_centroid(poly):
    """多边形面积形心（shoelace）。返回 (cx, cz, area)。"""
    a = cx = cz = 0.0
    n = len(poly)
    for i in range(n):
        x0, z0 = poly[i]
        x1, z1 = poly[(i + 1) % n]
        cr = x0 * z1 - x1 * z0
        a += cr
        cx += (x0 + x1) * cr
        cz += (z0 + z1) * cr
    a *= 0.5
    return (cx / (6 * a), cz / (6 * a), abs(a) / 2)

def intersect(p0, p1, q0, q1):
    d1 = p1 - p0
    d2 = q1 - q0
    den = d1.x * d2.y - d1.y * d2.x
    t = ((q0.x - p0.x) * d2.y - (q0.y - p0.y) * d2.x) / den
    return p0 + d1 * t

def ccw(poly):
    return poly if poly_area(poly) > 0 else poly[::-1]

def inward_offset(poly, d):
    """闭合多边形向内偏移 d（边线交点法）。"""
    poly = ccw(poly)
    n = len(poly)
    lines = []
    for i in range(n):
        a, b = Vector(poly[i]), Vector(poly[(i + 1) % n])
        e = (b - a)
        e.normalize()
        nv = Vector((-e.y, e.x))            # CCW 左侧=内侧
        lines.append((a + nv * d, b + nv * d))
    return [intersect(lines[i - 1][0], lines[i - 1][1], lines[i][0], lines[i][1]) for i in range(n)]

def outward_offset(poly, d):
    return inward_offset(poly, -d)

CX, CZ, AREA = area_centroid(FP)
WP = [(p.x, p.y) for p in inward_offset([(q[0], q[1]) for q in UVP], P['massing']['wallInsetM'])]
WU = [q[0] for q in WP]
WV = [q[1] for q in WP]
U0, U1 = min(WU), max(WU)
V0, V1 = min(WV), max(WV)
MS = P['massing']
SB = MS['setbackStreetM']
PL = MS['plinthHeightM']
WT = 0.3                                     # 墙板厚（比例值，非冻结数字）
ZT = []
_acc = 0.0
for h in MS['storeyHeightsM']:
    _acc += h
    ZT.append(_acc)                          # 逐层顶标高（自 0 起累计，台基含在第 1 层内）
Z1, Z2, Z3, Z4 = ZT[0], ZT[1], ZT[2], ZT[3]

PAV = dict(P['pavilion']) if P.get('pavilion', {}).get('corner') else None
if PAV:
    PU0, PU1, PV0, PV1 = U1 - PAV['planM'], U1, V0, V0 + PAV['planM']

def rect_minus_pav(rect):
    """矩形挖去亭楼角（若相交），返回 L 多边形（CCW）或原矩形（CCW）。rect=(u0,u1,v0,v1)。"""
    a0, a1, b0, b1 = rect
    poly = [(a0, b0), (a1, b0), (a1, b1), (a0, b1)]
    if not PAV:
        return ccw(poly)
    if PU0 <= a0 or PV1 <= b0 or PU1 >= a1 or PV0 >= b1:
        return ccw(poly)
    return [(a0, b0), (PU0, b0), (PU0, PV1), (a1, PV1), (a1, b1), (a0, b1)]

BODY_L = rect_minus_pav((U0, U1, V0, V1))                       # 1-3 层体块平面
F4_L = rect_minus_pav((U0, U1 - SB, V0 + SB, V1 - SB))          # 4 层退台平面
# 主屋面平面：4 层平面，前街侧从 v=PV1 起（SW 条做平屋面），东向在亭楼西缘外 1 出檐+0.1 收头
if PAV:
    ROOF_U1 = PU0 - P['eaves']['overhangM'] - 0.1
    MAIN_ROOF = [(U0, PV1), (ROOF_U1, PV1), (ROOF_U1, V1 - SB), (U0, V1 - SB)]
else:
    ROOF_U1 = U1 - SB
    MAIN_ROOF = [(U0, V0 + SB), (ROOF_U1, V0 + SB), (ROOF_U1, V1 - SB), (U0, V1 - SB)]

# ---------- 网格工具（局部系建模，per-loop 米制 UV，按 part+材质收尾合并） ----------
PART = 'misc'
GROUPS = {}

def to_b(u, v, h):
    """局部系 -> Blender 地图系 (map_x, -map_z, h)。"""
    return (O.x + u * du.x + v * dv.x, -(O.y + u * du.y + v * dv.y), h)

def add_local(name, items, faces, m, part=None, smooth=False):
    """items=[((u,v,h),(uu,vv))] 局部系；面绕序即法线方向。"""
    me = bpy.data.meshes.new(name)
    me.from_pydata([to_b(*p) for p, _ in items], [], faces)
    me.update()
    uv = me.uv_layers.new(name='UVMap')
    for f in me.polygons:
        for li in f.loop_indices:
            uv.data[li].uv = items[me.loops[li].vertex_index][1]
    me.materials.append(M[m])
    for f in me.polygons:
        f.use_smooth = smooth
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o['part'] = part or PART
    GROUPS.setdefault((o['part'], m), []).append(o)
    return o

def box(name, u0, u1, v0, v1, h0, h1, m, part=None, bevel=None):
    if u1 < u0: u0, u1 = u1, u0
    if v1 < v0: v0, v1 = v1, v0
    if h1 < h0: h0, h1 = h1, h0
    corners = [(u0,v0,h0),(u1,v0,h0),(u1,v1,h0),(u0,v1,h0),(u0,v0,h1),(u1,v0,h1),(u1,v1,h1),(u0,v1,h1)]
    faces = [(0,3,2,1),(4,5,6,7),(0,4,7,3),(1,2,6,5),(0,1,5,4),(3,7,6,2)]
    me = bpy.data.meshes.new(name)
    me.from_pydata([to_b(*c) for c in corners], [], faces)
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bw = P['detail']['bevelM'] if bevel is None else bevel
    if bw > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bw, min(u1-u0, v1-v0, h1-h0) * .3),
                        segments=2, affect='EDGES', clamp_overlap=True)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(me)
    bm.free()
    t = TILE[m]
    uv = me.uv_layers.new(name='UVMap')
    for f in me.polygons:
        nm = f.normal
        axis = max(range(3), key=lambda i: abs(nm[i]))
        for li in f.loop_indices:
            p = me.vertices[me.loops[li].vertex_index].co
            a, b = ((-p.y, p.z) if axis == 0 else (p.x, -p.y) if axis == 1 else (p.x, p.y))
            uv.data[li].uv = (a / t[0], b / t[1])
    me.materials.append(M[m])
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o['part'] = part or PART
    GROUPS.setdefault((o['part'], m), []).append(o)
    return o

def lift_fn(dist, lift, reach):
    """翼角起翘核：角点=lift，reach 处=0，两端零斜率（raised cosine，同 pavilion-kit）。"""
    if lift <= 0 or reach <= 0:
        return 0.0
    t = min(1.0, dist / reach)
    return lift * 0.5 * (1.0 + math.cos(math.pi * t))

def ring_corner_dists(ring):
    """方向突变 >25° 的点视为真角点；返回各点到最近角点的沿边弧长。"""
    n = len(ring)
    corner_idx = []
    for i in range(n):
        d1 = Vector(ring[i]) - Vector(ring[i - 1])
        d2 = Vector(ring[(i + 1) % n]) - Vector(ring[i])
        if d1.length > 1e-9 and d2.length > 1e-9 and d1.angle(d2) > math.radians(25):
            corner_idx.append(i)
    cum = [0.0]
    for i in range(n):
        cum.append(cum[-1] + (Vector(ring[(i + 1) % n]) - Vector(ring[i])).length)
    per = cum[-1]
    return [min(min(abs(cum[i] - cum[c]), per - abs(cum[i] - cum[c])) for c in corner_idx) for i in range(n)]

def sub_ring(poly, seg_m):
    """闭环按 seg_m 细分（保角点），CCW。"""
    poly = ccw(poly)
    pts = []
    n = len(poly)
    for i in range(n):
        a, b = Vector(poly[i]), Vector(poly[(i + 1) % n])
        k = max(1, int(round((b - a).length / seg_m)))
        for j in range(k):
            t = j / k
            pts.append((a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t))
    return pts

def resample_ring(ring, count):
    """按弧长参数把闭环重采样到 count 点（起点对齐原起点）。"""
    n = len(ring)
    cum = [0.0]
    for i in range(n):
        cum.append(cum[-1] + (Vector(ring[(i + 1) % n]) - Vector(ring[i])).length)
    per = cum[-1]
    out = []
    for k in range(count):
        s = per * k / count
        i = max(j for j in range(n) if cum[j] <= s)
        t = (s - cum[i]) / max(1e-9, cum[i + 1] - cum[i])
        a, b = Vector(ring[i]), Vector(ring[(i + 1) % n])
        out.append((a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t))
    return out

def eave_band(name, poly, y, m='roof', part=None, over=None, lift=None, drop=None):
    """逐层出檐：细分外圈（y-drop，角部起翘）→ 墙圈（y+0.10）坡向环带 + 外圈封檐板。"""
    ov = P['eaves']['overhangM'] if over is None else over
    lf = P['eaves']['cornerLiftM'] if lift is None else lift
    dr = P['eaves']['fasciaDropM'] if drop is None else drop
    seg = P['detail']['eaveSegM']
    rc = P['eaves']['cornerReachM']
    outer = sub_ring(outward_offset(poly, ov), seg)
    inner = resample_ring(sub_ring(poly, seg), len(outer))
    dl = ring_corner_dists(outer)
    n = len(outer)
    items, faces = [], []
    for i in range(n):
        items.append(((outer[i][0], outer[i][1], y - dr + lift_fn(dl[i], lf, rc)), (i * ov / seg, 0.0)))
    for i in range(n):
        items.append(((inner[i][0], inner[i][1], y + 0.10), (i * ov / seg, dr + 0.40)))
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))       # CCW 外圈 -> 法线朝外上
    add_local(name, items, faces, m, part=part)
    items2, faces2 = [], []                       # 封檐板：外圈下垂竖带
    for i in range(n):
        items2.append(((outer[i][0], outer[i][1], y - dr + lift_fn(dl[i], lf, rc)), (i * ov / seg, 0.0)))
        items2.append(((outer[i][0], outer[i][1], y - dr - 0.02 + lift_fn(dl[i], lf, rc)), (i * ov / seg, dr)))
    for i in range(n):
        j = (i + 1) % n
        faces2.append((i, n + i, n + j, j))      # (top_i, bot_i, bot_j, top_j) -> 法线朝外
    add_local(name + '-fascia', items2, faces2, 'dark', part=part)

def roof_loft(name, poly, y_eave, break_y, half_run, part=None, rings=6, curve=1.6, m='roof'):
    """主坡屋面（凹曲 profile）：出檐外圈（起翘）升至 break 环（多边形内缩 half-run差）。
    poly 须为矩形；返回 (vc, y0)。上段陡坡与山花由调用方续建。"""
    ov = P['eaves']['overhangM']
    lf = P['eaves']['cornerLiftM']
    rc = P['eaves']['cornerReachM']
    dr = P['roof']['eaveDropM']
    seg = P['detail']['eaveSegM']
    y0 = y_eave - dr
    us = [q[0] for q in poly]
    vs = [q[1] for q in poly]
    vc = (min(vs) + max(vs)) / 2
    half = (max(vs) - min(vs)) / 2
    inset = max(0.05, half - half_run)
    eave = sub_ring(outward_offset(poly, ov), seg)
    top = resample_ring(sub_ring(inward_offset(poly, inset), seg), len(eave))
    n = len(eave)
    dl = ring_corner_dists(eave)
    verts, uvs = [], []
    for j in range(rings + 1):
        t = j / rings
        tc = t ** curve
        fade = (1 - t) ** 2.2
        for i in range(n):
            a = eave[i]
            b = top[i]
            lift = lift_fn(dl[i], lf, rc) * fade
            verts.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t,
                          y0 + (break_y - y0) * tc + lift))
            uvs.append((i * (ov + inset) / seg, tc * (break_y - y0)))
    faces = []
    for j in range(rings):
        for i in range(n):
            k = (i + 1) % n
            faces.append((j * n + i, j * n + k, (j + 1) * n + k, (j + 1) * n + i))
    add_local(name, list(zip(verts, uvs)), faces, m, part=part)
    items2, faces2 = [], []                       # 封檐板
    for i in range(n):
        items2.append((verts[i], (i * ov / seg, 0.0)))
        items2.append(((eave[i][0], eave[i][1], y0 - 0.02 + lift_fn(dl[i], lf, rc)), (i * ov / seg, 0.24)))
    for i in range(n):
        j = (i + 1) % n
        faces2.append((i, n + i, n + j, j))
    add_local(name + '-fascia', items2, faces2, 'dark', part=part)
    return vc, y0

def quad_panel(name, cu, cv, z0, z1, w, yaw, m, part=None):
    """竖直面板：中心 (cu,cv)，宽 w，高 z1-z0；yaw=0 面朝 -v，法线=(sin yaw,-cos yaw)。"""
    h = z1 - z0
    ax, av = math.cos(yaw), math.sin(yaw)
    items = []
    for ux, uz in [(-w/2, 0), (w/2, 0), (w/2, h), (-w/2, h)]:
        items.append(((cu + ux * ax, cv + ux * av, z0 + uz), (ux + w/2, uz)))
    add_local(name, items, [(0, 1, 2, 3)], m, part=part)

def cyl(name, a, b, r, m, sides=10, part=None):
    va, vb = to_b(*a), to_b(*b)
    d = Vector(vb) - Vector(va)
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=r, depth=d.length,
                                        location=(Vector(va) + Vector(vb)) / 2)
    o = bpy.context.object
    o.name = name
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    o.data.materials.append(M[m])
    o['part'] = part or PART
    GROUPS.setdefault((o['part'], m), []).append(o)
    return o

# ================================================================ 几何组装
# ---- 台基（青石） ----
PART = 'base'
po = MS['plinthOutsetM']
box('plinth', U0 - po, U1 + po, V0 - po, V1 + po, 0, PL, 'stone')

# ---- 层身墙（1-3 层 BODY_L；4 层 F4_L），白墙板盒（CCW 左法线=内侧） ----
def wall_ring(poly, z0, z1, part):
    n = len(poly)
    for i in range(n):
        a = Vector(poly[i])
        b = Vector(poly[(i + 1) % n])
        e = b - a
        if e.length < 1e-6:
            continue
        e.normalize()
        nv = Vector((-e.y, e.x)) * WT
        if abs(e.y) < 1e-6:                       # u 向边
            box('wall-%s-%d' % (part, i), min(a.x, b.x), max(a.x, b.x),
                min(a.y, a.y + nv.y), max(a.y, a.y + nv.y), z0, z1, 'wall', part)
        else:                                     # v 向边
            box('wall-%s-%d' % (part, i), min(a.x, a.x + nv.x), max(a.x, a.x + nv.x),
                min(a.y, b.y), max(a.y, b.y), z0, z1, 'wall', part)
PART = 'walls'
zprev = PL
for si, z in enumerate((Z1, Z2, Z3)):
    wall_ring(BODY_L, zprev, z, 's%d' % (si + 1))   # 第 1 层自台基顶起，以上逐层衔接
    zprev = z
wall_ring(F4_L, Z3, Z4, 's4')
# 室内遮暗核心（玻璃/格心后不透亮）
PART = 'core'
box('core-main', U0 + 0.7, (PU0 - 0.7) if PAV else (U1 - 0.7), V0 + 0.7, V1 - 0.7, PL, Z3, 'dark')
if PAV:
    box('core-ne', PU0 + 0.7, U1 - 0.7, PV1 + 0.7, V1 - 0.7, PL, Z3, 'dark')
box('core-s4', U0 + 0.7, U1 - SB - 0.7, V0 + SB + 0.7, V1 - SB - 0.7, Z3, Z4, 'dark')

# ---- 12.0 层顶盖（4 层楼面 + 退台平屋面，青石） ----
PART = 'terrace'
midu = PU0 if PAV else (U0 + U1) / 2
box('terrace-main', U0, midu, V0, V1, Z3 - 0.06, Z3 + 0.06, 'stone')
if PAV:
    box('terrace-ne', PU0, U1, PV1, V1, Z3 - 0.06, Z3 + 0.06, 'stone')

# ---- 檐口 / 屋面构件（主控 eave_kit，2026-09-24 替换 eave_band / roof_loft / 平面攒尖） ----
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'shared'))   # modules/shared —— 主控构件唯一正本
import eave_kit as EK
EK.init(lambda n, it, f, m, part: add_local(n, it, f, m, part=part))
EKP = dict(P['eaveKit'])

def bracket_points(poly, step):
    """沿直角多边形各边按 step 取柱位（含两端内收 0.4 m），返回 (u, v, 外法线 u, 外法线 v)。"""
    poly = ccw([tuple(q) for q in poly])
    out = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 1.2:
            continue
        du, dv = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        k = max(1, int(round((L - 0.8) / step)))
        for j in range(k + 1):
            s = 0.4 + (L - 0.8) * j / k
            out.append((a[0] + du * s, a[1] + dv * s, dv, -du))
    return out

# ---- 逐层腰檐（1-3 层，沿 BODY_L）+ 柱位斗拱 ----
PART = 'eaves'
for si, z in enumerate((Z1, Z2, Z3)):
    EK.eave_skirt('eave-s%d' % (si + 1), BODY_L, z, EKP, 'eaves')
    EK.brackets('dougong-s%d' % (si + 1), bracket_points(BODY_L, EKP['bracketStepM']), z + EKP['soffitRise'], 'eaves')

# ---- 主屋面（歇山，eave_kit）：下檐四坡放样至折线环（与檐口环逐边对齐）+ 上段两坡 + 收山山花 / 博风 + 戗脊 + 正脊与吻 ----
PART = 'roof-main'
_ru = [q[0] for q in MAIN_ROOF]; _rv = [q[1] for q in MAIN_ROOF]
MR = (min(_ru), max(_ru), min(_rv), max(_rv))
RP = dict(EKP); RP.update(P['roof'].get('eaveKit', {}))
RP.update(breakZ=P['roof']['breakHeightM'], ridgeZ=P['roof']['ridgeHeightM'],
          breakInset=(MR[3] - MR[2]) / 2 * P['roof']['breakInsetFrac'], gableInset=P['roof']['gableInsetM'])
EK.xieshan_roof('roof-main', MR, Z4, RP, 'roof-main')
# 4 层顶平屋面（主屋面避让留下的退台面，青石）
if PAV:
    box('terrace-sw', U0, PU0, V0 + SB, PV1, Z4 - 0.06, Z4 + 0.06, 'stone')
    box('terrace-e', ROOF_U1, U1 - SB, PV1, V1 - SB, Z4 - 0.06, Z4 + 0.06, 'stone')

# ---- 转角亭楼（全高角塔 + extraTiers + 攒尖鎏金顶） ----
if PAV:
    TI = PAV.get('tierInsetM', 0.25)
    PART = 'pav-base'
    po = MS['plinthOutsetM']
    box('pav-plinth', PU0 - po, PU1 + po, PV0 - po, PV1 + po, 0, PL, 'stone')
    PART = 'pav-body'
    box('pav-wall-s', PU0, PU1, PV0, PV0 + WT, PL, Z4, 'wall')
    box('pav-wall-e', PU1 - WT, PU1, PV0, PV1, PL, Z4, 'wall')
    box('pav-wall-w', PU0, PU0 + WT, PV0, PV1, PL, Z4, 'wall')
    box('pav-wall-n', PU0, PU1, PV1 - WT, PV1, PL, Z4, 'wall')
    box('pav-core', PU0 + WT, PU1 - WT, PV0 + WT, PV1 - WT, PL, Z4, 'dark')
    for cu, cv, tg in ((PU0 + 0.17, PV0 + 0.17, 'sw'), (PU1 - 0.17, PV0 + 0.17, 'se'),
                       (PU0 + 0.17, PV1 - 0.17, 'nw'), (PU1 - 0.17, PV1 - 0.17, 'ne')):
        box('pav-post-' + tg, cu - 0.17, cu + 0.17, cv - 0.17, cv + 0.17, PL, Z4, 'wood')
    box('pav-cap', PU0 - 0.05, PU1 + 0.05, PV0 - 0.05, PV1 + 0.05, Z4 - 0.06, Z4 + 0.06, 'stone')
    PEKP = dict(EKP); PEKP.update(PAV.get('eaveKit', {}))       # 角亭檐比主楼浅（小体量 + 南立面中段的阳角不越界）
    EK.eave_skirt('pav-eave-z4', [(PU0, PV0), (PU1, PV0), (PU1, PV1), (PU0, PV1)], Z4, PEKP, 'pav-body')
    zt = Z4
    for k, th in enumerate(PAV['tierHeightsM']):
        inset = TI * (k + 1)
        a0, a1, b0, b1 = PU0 + inset, PU1 - inset, PV0 + inset, PV1 - inset
        pk = 'pav-tier%d' % (k + 1)
        PART = pk
        box(pk + '-wall-s', a0, a1, b0, b0 + WT, zt + 0.06, zt + th - 0.06, 'wall')
        box(pk + '-wall-n', a0, a1, b1 - WT, b1, zt + 0.06, zt + th - 0.06, 'wall')
        box(pk + '-wall-w', a0, a0 + WT, b0, b1, zt + 0.06, zt + th - 0.06, 'wall')
        box(pk + '-wall-e', a1 - WT, a1, b0, b1, zt + 0.06, zt + th - 0.06, 'wall')
        box(pk + '-cap', a0 - 0.05, a1 + 0.05, b0 - 0.05, b1 + 0.05, zt + th - 0.06, zt + th + 0.06, 'stone')
        EK.eave_skirt(pk + '-eave', [(a0, b0), (a1, b0), (a1, b1), (a0, b1)], zt + th, PEKP, pk)
        zt += th
    # 攒尖顶 + 鎏金宝顶
    PART = 'pav-roof'
    apex = zt + PAV['apexAboveLastEaveM']
    tin = TI * len(PAV['tierHeightsM'])
    pr = (PU0 + tin - PAV['pyramidOutsetM'], PU1 - tin + PAV['pyramidOutsetM'],
          PV0 + tin - PAV['pyramidOutsetM'], PV1 - tin + PAV['pyramidOutsetM'])
    base_y = zt - 0.25
    pcu, pcv = (pr[0] + pr[1]) / 2, (pr[2] + pr[3]) / 2
    corners = [(pr[0], pr[2]), (pr[1], pr[2]), (pr[1], pr[3]), (pr[0], pr[3])]
    ZP = dict(EKP); ZP.update(PAV.get('zanjian', {}))
    EK.zanjian_roof('pav-roof', (pr[0], pr[1], pr[2], pr[3]), zt, apex, ZP, 'pav-roof')
    fin = PAV['finial']
    cyl('pav-finial-rod', (pcu, pcv, apex - 0.25), (pcu, pcv, fin['topM'] - fin['sphereRM']),
        0.07, 'gild', 8, part='pav-roof')
    bpy.ops.mesh.primitive_uv_sphere_add(radius=fin['sphereRM'], segments=12, ring_count=8,
                                         location=to_b(pcu, pcv, fin['topM'] - fin['sphereRM']))
    sp = bpy.context.object
    sp.name = 'pav-finial-sphere'
    sp.data.materials.append(M['gild'])
    sp['part'] = 'pav-roof'
    GROUPS.setdefault(('pav-roof', 'gild'), []).append(sp)

# ---- 地面层柱廊 + 店面 + 挂落 + 匾额（两条街面） ----
FC = P['facades']
CS = FC['columnSizeM']
def bay_lines(a0, a1):
    """开间轴线：节奏交替，含两端。"""
    lines = [a0]
    k = 0
    while lines[-1] + FC['bayRhythmM'][k % 2] < a1 - CS:
        lines.append(lines[-1] + FC['bayRhythmM'][k % 2])
        k += 1
    lines.append(a1)
    return lines
PART = 'colonnade'
front_lines = bay_lines(U0 + 0.02, U1 - 0.02)
lines_s = bay_lines(U0 + 0.02, (PU0 - 0.02) if PAV else (U1 - 0.02))   # 前街主楼段开间（亭楼底另行）
BAS = FC.get('columnBaseM', 0.06)
for face, cv in (('s', V0 + CS / 2), ('n', V1 - CS / 2)):
    for i, lu in enumerate(front_lines):
        box('colbase-%s-%d' % (face, i), lu - CS / 2 - 0.06, lu + CS / 2 + 0.06,
            cv - CS / 2 - 0.06, cv + CS / 2 + 0.06, 0, PL + BAS, 'stone', part='colbase', bevel=0)
        box('col-%s-%d' % (face, i), lu - CS / 2, lu + CS / 2, cv - CS / 2, cv + CS / 2, PL, Z1, 'wood')

# ---- 二三层木构框架立面（R2：深红木柱 0.32 + 上下额枋 0.25 围合每开间，白墙退为窗间小块） ----
PART = 'frame'
LH = FC['frameLintelHM']
FPR = FC['frameProjectM']
FDP = FC['frameDepthM']
def architrave(tag, axis, coord, sgn, a0, a1, z0, z1):
    """额枋条：axis='v' 竖面朝 ±v（跨 a0..a1 于 u），axis='u' 朝 ±u（跨 a0..a1 于 v）。"""
    o0, o1 = coord + sgn * FPR, coord + sgn * (FPR - FDP)
    if axis == 'v':
        box('frame-' + tag, a0, a1, min(o0, o1), max(o0, o1), z0, z1, 'wood')
    else:
        box('frame-' + tag, min(o0, o1), max(o0, o1), a0, a1, z0, z1, 'wood')
for st in FC['galleryStoreys']:
    z, ztop = ZT[st - 2], ZT[st - 1]
    for face, v0, lines, xu1 in (('s', V0, lines_s, PU0 if PAV else U1), ('n', V1, front_lines, U1)):
        sgn = -1.0 if face == 's' else 1.0
        co0, co1 = v0 + sgn * FPR, v0 + sgn * (FPR - CS)          # 柱：外皮随枋出挑，深 0.32
        for i, lu in enumerate(lines):
            box('frame-col-%s%d-%d' % (face, st, i), lu - CS / 2, lu + CS / 2,
                min(co0, co1), max(co0, co1), z, ztop, 'wood', part='framecol', bevel=0)
        architrave('xia-%s%d' % (face, st), 'v', v0, sgn, U0, xu1, z + 0.06, z + 0.06 + LH)
        architrave('shang-%s%d' % (face, st), 'v', v0, sgn, U0, xu1, ztop - 0.06 - LH, ztop - 0.06)
    for coord, a0, a1, sgn, tf in ((U1, PV1 if PAV else V0, V1, 1, 'e'), (U0, V0, V1, -1, 'w')):
        architrave('xia-%s%d' % (tf, st), 'u', coord, sgn, a0, a1, z + 0.06, z + 0.06 + LH)
        architrave('shang-%s%d' % (tf, st), 'u', coord, sgn, a0, a1, ztop - 0.06 - LH, ztop - 0.06)

PART = 'shopfront'
sf = FC['shopfront']
gh = sf['glassHeadM']
sh = sf['sillM']
fd = FC['fasciaDepthM']
sfm = sf.get('frameM', 0.12)                # 边枋宽
smm = sf.get('mullionM', 0.08)              # 中枋宽
smp = sf.get('mullionPitchM', 1.05)         # 玻璃分扇节奏
for face, cv, sgn in (('s', V0, -1), ('n', V1, 1)):
    for a, b in zip(front_lines[:-1], front_lines[1:]):
        if b - a < 1.6:
            continue
        g0, g1 = a + 0.18, b - 0.18
        zp = cv + sgn * 0.02                    # 玻璃面：墙皮外 0.02
        yaw = 0 if sgn < 0 else math.pi
        tag = '%s-%.1f' % (face, a)
        # 深红木框：两边立枋通高 + 上槛；下段木裙板（不再是整面玻璃幕墙）
        box('shop-post-' + tag, g0 - sfm, g0, cv - 0.06, cv + 0.06, PL, Z1 - fd, 'wood', bevel=0)
        box('shop-post-' + tag + 'r', g1, g1 + sfm, cv - 0.06, cv + 0.06, PL, Z1 - fd, 'wood', bevel=0)
        box('shop-riser-' + tag, g0, g1, min(cv, zp) - 0.04, max(cv, zp), PL, PL + sh, 'wood')
        box('shop-head-' + tag, g0, g1, cv - 0.06, cv + 0.06, gh, gh + 0.08, 'wood', bevel=0)
        box('shop-headtop-' + tag, g0, g1, cv - 0.06, cv + 0.06, Z1 - fd - 0.04, Z1 - fd, 'wood', bevel=0)
        # 横披（格心）：上槛与檐下挂落之间
        quad_panel('shop-fan-' + tag, (g0 + g1) / 2, zp, gh + 0.08, Z1 - fd - 0.04, g1 - g0, yaw, 'lattice')
        # 玻璃分扇 + 木中枋（枋凸出玻璃面 5 cm，读作木框）
        n_leaf = max(1, int(round((g1 - g0) / smp)))
        if n_leaf == 1 and g1 - g0 > smp:       # 窄开间别用超宽单扇，拆两扇
            n_leaf = 2
        lw = (g1 - g0) / n_leaf
        vo0, vo1 = (zp - 0.05, zp + 0.01) if sgn < 0 else (zp - 0.01, zp + 0.05)
        for k in range(n_leaf):
            quad_panel('shop-glass-' + tag + '-%d' % k, g0 + lw * (k + 0.5), zp, PL + sh, gh,
                       lw - smm + 0.01, yaw, 'glass')
        for k in range(1, n_leaf):
            mu = g0 + lw * k
            box('shop-mullion-' + tag + '-%d' % k, mu - smm / 2, mu + smm / 2, vo0, vo1,
                PL + sh, gh, 'wood', bevel=0)
PART = 'fascia'
# 檐下挂落：金漆雕花感 = 鎏金格心 alpha 带（高 0.45 m = fasciaDepthM，沿两条街面连续）+ 深色衬底 + 下缘金条
gz0, gz1 = Z1 - fd + 0.02, Z1 - 0.02
for face, wv, sgn in (('s', V0, -1), ('n', V1, 1)):
    quad_panel('guoluo-back-' + face, (U0 + U1) / 2, wv + sgn * 0.008, gz0, gz1, U1 - U0,
               0 if sgn < 0 else math.pi, 'dark')
    quad_panel('guoluo-' + face, (U0 + U1) / 2, wv + sgn * 0.04, gz0, gz1, U1 - U0,
               0 if sgn < 0 else math.pi, 'guoluo')
    box('guoluo-trim-' + face, U0, U1, wv - 0.055 if sgn < 0 else wv - 0.01,
        wv + 0.01 if sgn < 0 else wv + 0.055, Z1 - fd - 0.05, Z1 - fd, 'gild')
PART = 'plaques'
for face, cv, sgn in (('s', V0, -1), ('n', V1, 1)):
    for a, b in zip(front_lines[:-1], front_lines[1:]):
        if b - a < 1.6:
            continue
        quad_panel('plaque-%s-%.1f' % (face, a), (a + b) / 2, cv + sgn * 0.14, Z1 - fd + 0.02, Z1 - 0.04,
                   1.5, 0 if sgn < 0 else math.pi, 'dark')
pq = FC['floor2PlaqueM']
pqb = FC.get('floor2PlaqueBorderM', 0.09)
pc2 = (U0 + (PU0 if PAV else U1)) / 2
quad_panel('plaque-floor2-frame', pc2, V0 - 0.054, Z1 + 0.8 - pqb, Z1 + 0.8 + pq[1] + pqb,
           pq[0] + 2 * pqb, 0, 'gild')
quad_panel('plaque-floor2', pc2, V0 - 0.06, Z1 + 0.8, Z1 + 0.8 + pq[1], pq[0], 0, 'dark')

# ---- 腰廊（galleryStoreys 连续画廊 + 直棂木栏杆，两条街面） ----
PART = 'gallery'
gd = FC['galleryDepthM']
bh = FC['balustradeHM']
bpp = FC.get('balustradePostPitchM', 2.3)
for st in FC['galleryStoreys']:
    z = ZT[st - 2]                   # 楼层 st 的楼面标高（ZT[0]=第2层楼面）
    for face, v0_, v1_, sgn in (('s', V0 - gd, V0 + 0.1, -1), ('n', V1 - 0.1, V1 + gd, 1)):
        box('gal-slab-%s-%d' % (face, st), U0, U1, v0_, v1_, z - 0.06, z + 0.06, 'stone')
        edge = v0_ if sgn < 0 else v1_
        npost = max(1, int((U1 - U0) / bpp))
        for i in range(npost + 1):
            pu = U0 + (U1 - U0) * i / npost
            box('gal-post-%s-%d-%d' % (face, st, i), pu - 0.06, pu + 0.06, edge - 0.05, edge + 0.05,
                z, z + bh, 'wood', bevel=0)
        box('gal-rail-%s-%d' % (face, st), U0, U1, edge - 0.055, edge + 0.055, z + bh - 0.08, z + bh, 'wood', bevel=0)
        box('gal-sill-%s-%d' % (face, st), U0, U1, edge - 0.045, edge + 0.045, z + 0.08, z + 0.16, 'wood', bevel=0)
        quad_panel('gal-lattice-%s-%d' % (face, st), (U0 + U1) / 2, edge + sgn * 0.03, z + 0.16,
                   z + bh - 0.08, U1 - U0, 0 if sgn < 0 else math.pi, 'slats')

# ---- 格心窗（R2：长窗/半窗——深红木整樘背板=窗框+裙板，上部格心；不再白墙开黑方洞） ----
PART = 'windows'
W = FC['window']
def windows_on_face(tag, axis, coord, a0, a1, zfloor, ztop, centers, w, h, sill, sgn, lf=None):
    """axis='v': 竖面垂直 v（coord=v 平面，跨 u）；axis='u' 对偶。sgn=外法线方向。
    lf=格心占樘高的比：长窗 0.62，半窗 0.5（下段露木裙板）。"""
    if lf is None:
        lf = FC['longWindowLatticeFrac']
    for i, c in enumerate(centers):
        if c < a0 + w / 2 + 0.1 or c > a1 - w / 2 - 0.1:
            continue
        z0 = zfloor + sill
        if z0 + h > ztop - 0.25:
            h = ztop - 0.25 - z0
        if h < 0.8:
            continue
        off = 0.03 * sgn
        yaw = (0 if sgn < 0 else math.pi) if axis == 'v' else (math.pi / 2 if sgn > 0 else -math.pi / 2)
        cu = c if axis == 'v' else coord + off
        cv = coord + off if axis == 'v' else c
        quad_panel('winb-' + tag + '-%d' % i, cu, cv, z0 - 0.07, z0 + h + 0.07, w + 0.14, yaw, 'wood')
        zl0 = z0 - 0.07 + (1.0 - lf) * (h + 0.14)
        quad_panel('win-' + tag + '-%d' % i, cu, cv + off * 0.8, zl0, z0 + h + 0.03, w - 0.02, yaw, 'lattice')
def bay_long_windows(face, v0, lines, amax, sgn, z, ztop):
    """二三层街面每开间长窗屏：柱枋之间整樘木背板 + 每开间数扇格心长窗（落到腰檐下）。"""
    yaw = 0 if sgn < 0 else math.pi
    zp = v0 + sgn * 0.02                       # 背板面（微凸墙面）
    zl0, zl1 = z + 0.06 + LH + 0.02, ztop - 0.06 - LH - 0.02
    nlv, gap, lf = FC['longWindowLeaves'], FC['leafGapM'], FC['longWindowLatticeFrac']
    zw0 = zl0 + (1.0 - lf) * (zl1 - zl0)       # 格心下缘，以下为木裙板
    for bi, (a, b) in enumerate(zip(lines[:-1], lines[1:])):
        g0, g1 = a + CS / 2, min(b, amax) - CS / 2
        if g1 - g0 < 1.8:
            continue
        quad_panel('winbay-%s%d-%d' % (face, z, bi), (g0 + g1) / 2, zp, zl0, zl1, g1 - g0, yaw, 'wood')
        pitch = (g1 - g0) / nlv
        for k in range(nlv):
            lc = g0 + pitch * (k + 0.5)
            quad_panel('winleaf-%s%d-%d-%d' % (face, z, bi, k), lc, zp + sgn * 0.025,
                       zw0, zl1 - 0.03, pitch - gap, yaw, 'lattice')
for st in (2, 3):
    z, ztop = ZT[st - 2], ZT[st - 1]   # 楼层 st 的层底/层顶
    bay_long_windows('s', V0, lines_s, PU0 if PAV else U1, -1, z, ztop)
    bay_long_windows('n', V1, front_lines, U1, 1, z, ztop)
    for coord, a0, a1, sgn, tf in ((U1, PV1 if PAV else V0, V1, 1, 'e'), (U0, V0, V1, -1, 'w')):
        cs = [a0 + (a1 - a0) * f for f in (0.3, 0.7)]
        windows_on_face('%s%d' % (tf, st), 'u', coord, a0, a1, z, ztop, cs,
                        W['widthM'], W['heightM'], W['sillM'], sgn)
# ---- 四层半窗 + 木裙板（退台面，R2：上半格心，下段裙板，开间与下方对齐） ----
z = Z3
L4S = bay_lines(U0 + 0.02, (PU0 - 0.02) if PAV else (U1 - SB - 0.02))
L4N = bay_lines(U0 + 0.02, U1 - SB - 0.02)
PART = 'frame'
for tf, v0, lines, sgn, a1f in (('s4', V0 + SB, L4S, -1, PU0 if PAV else U1 - SB),
                                ('n4', V1 - SB, L4N, 1, U1 - SB)):
    architrave('xia-' + tf, 'v', v0, sgn, U0, a1f, z + 0.06, z + 0.06 + LH)
    architrave('shang-' + tf, 'v', v0, sgn, U0, a1f, Z4 - 0.06 - LH, Z4 - 0.06)
PART = 'windows'
for tf, v0, lines, sgn, a1f in (('s', V0 + SB, L4S, -1, PU0 if PAV else U1 - SB),
                                ('n', V1 - SB, L4N, 1, U1 - SB)):
    cs = [(a + b) / 2 for a, b in zip(lines[:-1], lines[1:]) if b - a >= 2.0]
    windows_on_face('%s4' % tf, 'v', v0, U0, a1f, z, Z4, cs,
                    min(W['widthM'], 2.2), 1.3, 1.45, sgn, lf=FC['halfWindowLatticeFrac'])
for coord, a0, a1, sgn, tf in ((U1 - SB, PV1 if PAV else V0 + SB, V1 - SB, 1, 'e'),
                               (U0, V0 + SB, V1 - SB, -1, 'w')):
    cnt = max(2, int((a1 - a0) / 4.4))
    cs = [a0 + (a1 - a0) * (i + 0.5) / cnt for i in range(cnt)]
    windows_on_face('%s4' % tf, 'u', coord, a0, a1, z, Z4, cs,
                    W['widthM'], 1.3, 1.45, sgn, lf=FC['halfWindowLatticeFrac'])
if PAV:
    for st in (2, 3):
        z, ztop = ZT[st - 2], ZT[st - 1]
        windows_on_face('ps%d' % st, 'v', PV0, PU0 + 0.5, PU1 - 0.5, z, ztop,
                        [PU0 + (PU1 - PU0) * f for f in (0.32, 0.68)], 1.3, 1.6, 0.9, -1)
        windows_on_face('pe%d' % st, 'u', PU1, PV0 + 0.5, PV1 - 0.5, z, ztop,
                        [PV0 + (PV1 - PV0) * f for f in (0.32, 0.68)], 1.3, 1.6, 0.9, 1)
    zt = Z4
    for k, th in enumerate(PAV['tierHeightsM']):
        inset = TI * (k + 1)
        a0, a1, b0, b1 = PU0 + inset, PU1 - inset, PV0 + inset, PV1 - inset
        windows_on_face('ptS%d' % (k + 1), 'v', b0, a0 + 0.3, a1 - 0.3, zt, zt + th,
                        [(a0 + a1) / 2 - 1.0, (a0 + a1) / 2 + 1.0], 1.3, 1.5, 0.8, -1)
        windows_on_face('ptN%d' % (k + 1), 'v', b1, a0 + 0.3, a1 - 0.3, zt, zt + th,
                        [(a0 + a1) / 2], 1.3, 1.5, 0.8, 1)
        windows_on_face('ptE%d' % (k + 1), 'u', a1, b0 + 0.3, b1 - 0.3, zt, zt + th,
                        [(b0 + b1) / 2], 1.3, 1.5, 0.8, 1)
        windows_on_face('ptW%d' % (k + 1), 'u', a0, b0 + 0.3, b1 - 0.3, zt, zt + th,
                        [(b0 + b1) / 2], 1.3, 1.5, 0.8, -1)
        zt += th

# ================================================================ 收尾：合并、三角化、锚、导出
final = []
for (part, m), items in sorted(GROUPS.items()):
    bpy.ops.object.select_all(action='DESELECT')
    for o in items:
        o.select_set(True)
    bpy.context.view_layer.objects.active = items[0]
    if len(items) > 1:
        bpy.ops.object.join()
    o = bpy.context.object
    o.name = part + '__' + m
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(o.data)
    bm.free()
    final.append(o)

anchor = bpy.data.objects.new(P['id'], None)
anchor.empty_display_size = 2
anchor.location = (CX, -CZ, 0)                  # Blender 系 = (map_x, -map_z)
anchor['id'] = P['id']
anchor['module'] = 'bazaar-tower-kit'
anchor['zone'] = P['zone']
anchor['lod'] = 'L2'
bpy.context.collection.objects.link(anchor)
bpy.context.view_layer.update()                 # 先让 anchor.matrix_world 求值，再保世界挂父
for o in final:
    o.parent = anchor
    o.matrix_parent_inverse = anchor.matrix_world.inverted()   # 网格已是世界坐标，抵消锚平移

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'model.blend'))
bpy.ops.object.select_all(action='DESELECT')
anchor.select_set(True)
for o in final:
    o.select_set(True)
glb = os.path.join(OUT, 'model.glb')
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_yup=True, export_extras=True,
                          export_apply=True, use_selection=True, export_animations=False,
                          export_cameras=False, export_lights=False)

# alphaMode 兜底：格心/直棂/挂落=MASK+0.5、玻璃=BLEND（Blender 4.5 导出命名差异修正，同 sansuitang）
buf = bytearray(open(glb, 'rb').read())
jl = int.from_bytes(buf[12:16], 'little')
assert bytes(buf[16:20]) == b'JSON'
j = json.loads(bytes(buf[20:20 + jl]))
bl_off = 20 + jl
bl = int.from_bytes(buf[bl_off:bl_off + 4], 'little')
bindata = bytes(buf[bl_off + 8:bl_off + 8 + bl])
changed = False
for mm in j.get('materials', []):
    nm_ = mm.get('name', '')
    if any(k in nm_ for k in ('lattice', 'slats', 'guoluo')) and mm.get('alphaMode') != 'MASK':
        mm['alphaMode'] = 'MASK'
        mm['alphaCutoff'] = 0.5
        changed = True
    if 'glass' in mm.get('name', '') and mm.get('alphaMode') != 'BLEND':
        mm['alphaMode'] = 'BLEND'
        changed = True
if changed:
    nj = json.dumps(j, separators=(',', ':')).encode()
    njp = nj + b' ' * ((-len(nj)) % 4)
    total = 12 + 8 + len(njp) + 8 + bl
    open(glb, 'wb').write(b'glTF' + (2).to_bytes(4, 'little') + total.to_bytes(4, 'little') +
                          len(njp).to_bytes(4, 'little') + b'JSON' + njp +
                          bl.to_bytes(4, 'little') + b'BIN\x00' + bindata)

tris = 0
by = {}
for o in final:
    o.data.calc_loop_triangles()
    n = len(o.data.loop_triangles)
    tris += n
    by[o.name] = n
maxy = max(v.co.z for o in final for v in o.data.vertices)
minx = min(v.co.x for o in final for v in o.data.vertices)
maxx = max(v.co.x for o in final for v in o.data.vertices)
miny = min(v.co.y for o in final for v in o.data.vertices)
maxy2 = max(v.co.y for o in final for v in o.data.vertices)
texs = {}
for nm, meta in META.items():
    for f in meta.get('textures', {}).values():
        texs[f] = os.path.getsize(os.path.join(TEX_DIR, f))
json.dump({'triangles': tris, 'byNode': by, 'glbBytes': os.path.getsize(glb),
           'maxY': round(maxy, 3), 'planBBoxBlenderX': [round(minx, 2), round(maxx, 2)],
           'planBBoxBlenderY': [round(miny, 2), round(maxy2, 2)],
           'anchorMap': [round(CX, 4), round(CZ, 4)], 'footprintAreaM2': round(AREA, 2),
           'textures': texs, 'textureTotalBytes': sum(texs.values()),
           'params': PARAMS_REL, 'buildSeconds': round(time.time() - T0, 1)},
          open(os.path.join(OUT, 'measurements.json'), 'w'), ensure_ascii=False, indent=2)
json.dump({'axis': 'GLB Y-up world map coords (x=layout x, z=layout z, y=height); anchor empty at footprint AREA centroid',
           'instanceSpace': False, 'integratedIntoWorld': True,
           'materials': META, 'params': P,
           'textureSource': 'asset-authoring/yuyuan-entry/source-kit/textures (read-only)',
           'notes': ['瓦垄/瓦当以 roof 材质贴图表达，无逐瓦几何；正脊素端头、无走兽。',
                     '转角亭楼全高角塔读法：地面起随主体层节奏，上加 extraTiers + 攒尖鎏金顶。',
                     '主屋面平面在亭楼西缘（出檐+0.1m）收头，留出的 4 层顶面做平屋面（terrace-*），构造上避开亭楼穿插。',
                     'R2 立面（2026-09-25）：木构框架柱+额枋围合开间，二三层长窗/四层半窗格心，腰廊直棂木栏杆（望柱+扶手+底枋），底层木框玻璃店面+横披格心+檐下鎏金格心挂落带+柱脚石础；lattice/slats/guoluo 均程序化 alpha 贴图（深红木/鎏金色）。'],
           'buildSeconds': round(time.time() - T0, 1)},
          open(os.path.join(OUT, 'recipe.json'), 'w'), ensure_ascii=False, indent=2)
print('BAZAAR_TOWER_BUILT', P['id'], tris, os.path.getsize(glb), round(maxy, 2),
      'anchor', round(CX, 3), round(CZ, 3), 'secs', round(time.time() - T0, 1))
