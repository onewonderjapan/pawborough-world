"""商城大楼套件生成器（bazaar-tower-kit：华宝楼样板 WP6.2 → wave4 通用化：天裕楼 / 和丰楼 / 悦宾楼 / 上海老饭店）。

Blender 无头参数化生成商城大楼。一个生成器、每座一份 params JSON；几何代码不含任何一座楼的专有数字。
footprint 唯一来源 baseline/layout.json（任意简单多边形，可凹、可有斜切角）；立面角色（临街 / 与邻栋共享 /
普通 / 内部）从 layout 的 frontEdges 与邻栋 footprint 检出，按边分段。

坐标契约（同 rockery / 华宝楼）：局部正交系 (u=前街边方向, v=指向楼内, h=高)，to_b() 落到地图系 Blender
(map_x, -map_z, h)；export_yup 后 GLB (x, h, z) = 地图世界坐标。GLB 内含名为 <id> 的锚 empty（footprint 面积形心）。

构成（全部由 params 驱动，缺省值 = 华宝楼 R2 口径）：
- 体块 blocks：默认一个 = footprint 内缩 wallInset；可按 v 向半平面切成前后两块（上海老饭店：两层前楼 + 四层后楼）。
  每块逐层平面：setbackStoreys 层临街边退台；topPlan='rect' 时顶层 = 多边形内最大轴向矩形（歇山只能盖矩形）。
- 角塔 tower（兼容旧键 pavilion）：位置 = 包围盒角（华宝楼）/ 沿某段街边居中（天裕楼斜切角）/ 某块最近角（老饭店）；
  全高塔身 + extra tiers + 攒尖（宝顶：杆球 / 葫芦）或独立歇山；notchBody=True 时体块让出塔位（华宝楼）。
- 逐层腰檐 + 斗拱（eave_kit，主控只读）；共享边与被别的体块挡住的檐段向内收，檐口不越共享边（规则同 hall-kit）。
- 立面样式按「角色 × 层」：底层 shop（柱 / 石础 / 木框玻璃分扇 / 横披或红招牌带 / 挂落或彩画 / 每间空匾，
  可深进 recessM 成店面廊，可黑漆）；上层 screen（木构框架 + 长窗屏）/ band（红柱 + 白墙窗带）/ half / ends / ends4；
  腰廊直棂栏杆；彩画额枋色块；空匾（黑底金框，不写字）；红灯笼；石狮（简化体块）。
- 所有匾额 / 招牌一律空板，不写任何文字。

运行：blender -b -t 4 --python-exit-code 1 -P modules/bazaar-tower-kit/build_tower.py -- \
      [--params params/huabao-bld-428202599.json（相对本目录）] [--out out-bazaar-towers/<id>]
"""
import bpy, bmesh, json, math, os, sys, time
from mathutils import Vector

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import plan2d as G                                               # noqa: E402

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(flag, default):
    return ARGS[ARGS.index(flag) + 1] if flag in ARGS else default

PARAMS_REL = arg('--params', 'params/huabao-bld-428202599.json')
P = json.load(open(os.path.join(HERE, PARAMS_REL), encoding='utf-8'))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))          # scene-authoring/yuyuan-area
OUT = os.path.join(ROOT, arg('--out', os.path.join('out-bazaar-towers', P['id'])))
os.makedirs(OUT, exist_ok=True)

# ---------- 输入：footprint 唯一来源 = baseline/layout.json ----------
LAYOUT = json.load(open(os.path.join(ROOT, 'baseline', 'layout.json'), encoding='utf-8'))
OBJ = next(o for o in LAYOUT['objects'] if o['id'] == P['id'])
FP = [list(q) for q in OBJ['geometry']['footprint']]
if FP[0] == FP[-1]:
    FP = FP[:-1]

MS, FA, EKP0 = P['massing'], P['facades'], dict(P['eaveKit'])
FM = P['materials']
WALLI = MS['wallInsetM']
PL = MS['plinthHeightM']
WT = 0.3                                     # 墙板厚（比例值）
SHARED_RULE = P.get('sharedEdgeRule', True)      # 华宝楼样板 = False（保持主控已复验的形体）
CLIP_HIDDEN = P.get('eaveClipHidden', True)

# ================================================================ 材质（source-kit 纹理 + 解析色；按需创建）
TEX_DIR = os.path.abspath(os.path.join(ROOT, '..', '..', 'asset-authoring', 'yuyuan-entry', 'source-kit', 'textures'))
if not os.path.isdir(TEX_DIR):
    TEX_DIR = '/home/baibai/work/onewonderjapan/pawborough-world/asset-authoring/yuyuan-entry/source-kit/textures'
if not os.path.isdir(TEX_DIR):
    raise RuntimeError('source-kit textures not found')

TILE, META = {}, {}
def lin(hx):
    a = [int(hx[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in a]

def _tex(nodes, fname, cs):
    t = nodes.new('ShaderNodeTexImage')
    t.extension = 'REPEAT'
    t.image = bpy.data.images.load(os.path.join(TEX_DIR, fname), check_existing=True)
    t.image.colorspace_settings.name = cs
    t.image.pack()
    return t

def _tint_link(nodes, links, color_out, tint, p):
    mix = nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    mix.inputs[7].default_value = (*lin(tint), 1)
    links.new(color_out, mix.inputs[6])
    links.new(mix.outputs[2], p.inputs['Base Color'])

def mat(key, rgb=None, rough=.8, base=None, normal=None, tint=None, tile=(1, 1), metallic=0.0,
        alpha=None, alpha_mode=None, emission=None):
    m = bpy.data.materials.new('btk-' + key)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    p = nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*(rgb if rgb else (1, 1, 1)), 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metallic
    if base:
        t = _tex(nodes, base, 'sRGB')
        if tint:
            _tint_link(nodes, links, t.outputs['Color'], tint, p)
        else:
            links.new(t.outputs['Color'], p.inputs['Base Color'])
    if normal:
        t = _tex(nodes, normal, 'Non-Color')
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
    if emission:                                        # 店内灯光（glTF emissiveFactor）
        p.inputs['Emission Color'].default_value = (*lin(emission), 1)
        p.inputs['Emission Strength'].default_value = 1.0
    TILE[key] = tile
    META['btk-' + key] = {'tintSrgb': tint, 'rgbSrgb': None, 'roughness': rough, 'metallic': metallic, 'alpha': alpha,
                          'emissionSrgb': emission,
                          'alphaMode': alpha_mode,
                          'textures': {k: v for k, v in (('color', base), ('normal', normal)) if v},
                          'tileMeters': list(tile)}
    return m

IMAGES = {}
def gen_image(key, png, size_x, size_y, pixel_fn, alpha=True):
    """程序化贴图（内容与楼无关：各楼同名同尺寸同内容 → 分区导出按名 + 尺寸去重是安全的）。"""
    if key in IMAGES:
        return IMAGES[key]
    px = [0.0] * (size_x * size_y * 4)
    for y in range(size_y):
        for x in range(size_x):
            r, g, b, a = pixel_fn(x, y)
            k = (y * size_x + x) * 4
            px[k], px[k + 1], px[k + 2], px[k + 3] = r / 255.0, g / 255.0, b / 255.0, a / 255.0
    img = bpy.data.images.new('tower-' + key, size_x, size_y, alpha=alpha)
    img.pixels = px
    out = os.path.join(HERE, 'textures', png)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.filepath_raw = out
    img.file_format = 'PNG'
    img.save()
    img.pack()
    IMAGES[key] = img
    return img

def alpha_pattern(kind, cells_per_m=8.0, slat_spacing=0.12, slat_w=0.045, bar_frac=0.16, size=256):
    """解析 alpha 格心 / 直棂 / 挂落：size 像素 = 1 m；棂条白色（颜色由材质 tint 乘上），空隙 alpha 0。"""
    if kind == 'slats':
        period, bar = size * slat_spacing, size * slat_w
        def on(x, y):
            return (x % period) < bar
    else:
        cell = size / cells_per_m
        bar = max(2.0, cell * bar_frac)
        def on(x, y):
            dx, dy = x % cell, y % cell
            sd = (x + y) % cell
            return dx < bar or dy < bar or sd < bar * 0.9
    return lambda x, y: (255, 255, 255, 255) if on(x, y) else (255, 255, 255, 0)

def alpha_mat(key, img, tint, png, extra=None):
    m = bpy.data.materials.new('btk-' + key)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    p = nodes.get('Principled BSDF')
    p.inputs['Roughness'].default_value = .7
    p.inputs['Metallic'].default_value = 0
    t = nodes.new('ShaderNodeTexImage')
    t.image = img
    t.extension = 'REPEAT'
    _tint_link(nodes, links, t.outputs['Color'], tint, p)
    links.new(t.outputs['Alpha'], p.inputs['Alpha'])
    try:
        m.blend_method = 'CLIP'
    except AttributeError:
        pass
    TILE[key] = (1.0, 1.0)
    META['btk-' + key] = {'alpha': 'modules/bazaar-tower-kit/textures/' + png, 'tintSrgb': tint,
                          'alphaMode': 'MASK', 'alphaCutoff': 0.5, 'textures': {}, 'tileMeters': [1.0, 1.0], **(extra or {})}
    return m

def caihua_pixels():
    """彩画额枋色块（青 / 绿 / 蓝交替 + 金线分隔 + 深色上下缘；无图案、无文字）。512 px = 2 m。"""
    cols = [(38, 104, 98), (52, 118, 74), (40, 78, 122), (52, 118, 74)]
    widths = [150, 90, 132, 90]            # 合计 462 + 分隔 4×12 = 510
    seq = []
    for c, w in zip(cols, widths):
        seq += [(196, 160, 72)] * 12 + [c] * w
    seq += [(196, 160, 72)] * (512 - len(seq))
    def f(x, y):
        if y < 10 or y >= 118:
            return (40, 30, 24, 255)
        if y < 16 or y >= 112:
            return (196, 160, 72, 255)
        r, g, b = seq[x % 512]
        return (r, g, b, 255)
    return f

FCP = FA
_MAT_DEFS = {
    'wall': lambda: mat('wall', rough=.85, base='PaintedPlaster017_2K-JPG_Color_1K.jpg', tint=FM['plasterTint'],
                        tile=tuple(FM['plasterTile'])),
    'wood': lambda: mat('wood', rough=.7, base='wood-stain-color.jpg', tint=FM['timberTint'],
                        normal='Wood092_2K-JPG_NormalGL_1K.jpg', tile=tuple(FM['timberTile'])),
    'wood2': lambda: mat('wood2', rough=.7, base='wood-stain-color.jpg', tint=FM.get('timber2Tint', FM['timberTint']),
                         normal='Wood092_2K-JPG_NormalGL_1K.jpg', tile=tuple(FM['timberTile'])),
    'stone': lambda: mat('stone', rough=.92, base='Bricks061_2K-JPG_Color_1K.jpg', tint=FM['plinthTint'],
                         tile=tuple(FM['plinthTile'])),
    'roof': lambda: mat('roof', rough=.8, base='roof-color.jpg', normal='roof-normal.png', tint=FM.get('roofTint'),
                        tile=tuple(FM['roofTile'])),
    'gild': lambda: mat('gild', lin(FM['gilded']), FM.get('gildRough', .38), metallic=FM.get('gildMetallic', .55)),
    'glass': lambda: mat('glass', lin(FM['glass']), .18, alpha=FM['glassAlpha'], alpha_mode='BLEND'),
    'dark': lambda: mat('dark', lin(FM['dark']), .6),
    'shopback': lambda: mat('shopback', lin(FM.get('shopInterior', '6e5238')), .8, emission=FM.get('shopEmission')),
    'lacquer': lambda: mat('lacquer', lin(FM.get('lacquerTint', '15100e')), .32),
    'signred': lambda: mat('signred', lin(FM.get('signRed', 'a82a1e')), .55),
    'lantern': lambda: mat('lantern', lin(FM.get('lanternRed', 'c8301f')), .5),
    'lionstone': lambda: mat('lionstone', rough=.9, base='Bricks061_2K-JPG_Color_1K.jpg', tint=FM.get('lionTint', 'a8a79f'),
                             tile=(0.6, 0.6)),
    'lattice': lambda: alpha_mat('lattice', gen_image('lattice', 'lattice-core-alpha.png', 256, 256, alpha_pattern('lattice')),
                                 FM['timberTint'], 'lattice-core-alpha.png', {'cellM': 0.125}),
    'lattice2': lambda: alpha_mat('lattice2', gen_image('lattice', 'lattice-core-alpha.png', 256, 256, alpha_pattern('lattice')),
                                  FM.get('timber2Tint', FM['timberTint']), 'lattice-core-alpha.png', {'cellM': 0.125}),
    'slats': lambda: alpha_mat('slats', gen_image('slats', 'slats-alpha.png', 256, 256,
                                                  alpha_pattern('slats', slat_spacing=FCP.get('balustradeSlatPitchM', .12),
                                                                slat_w=FCP.get('balustradeSlatBarM', .045))),
                               FM.get(FCP.get('galleryTimber', 'timberTint'), FM['timberTint']), 'slats-alpha.png'),
    'guoluo': lambda: alpha_mat('guoluo', gen_image('guoluo-c%g-b%g' % (FCP.get('guoluoCellsPerM', 8.0), FCP.get('guoluoBarFrac', 0.16)),
                                                    'guoluo-alpha.png' if FCP.get('guoluoBarFrac', 0.16) == 0.16 else 'guoluo-alpha-b%g.png' % FCP['guoluoBarFrac'],
                                                    256, 256,
                                                    alpha_pattern('guoluo', cells_per_m=FCP.get('guoluoCellsPerM', 8.0),
                                                                  bar_frac=FCP.get('guoluoBarFrac', 0.16))),
                                FM.get('guoluoGold', FM['gilded']), 'guoluo-alpha.png',
                                {'cellM': 1.0 / FCP.get('guoluoCellsPerM', 8.0), 'barFrac': FCP.get('guoluoBarFrac', 0.16)}),
    'caihua': lambda: _caihua_mat(),
}
def _caihua_mat():
    img = gen_image('caihua', 'caihua-blocks.png', 512, 128, caihua_pixels(), alpha=False)
    m = bpy.data.materials.new('btk-caihua')
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    p = nodes.get('Principled BSDF')
    p.inputs['Roughness'].default_value = .65
    t = nodes.new('ShaderNodeTexImage')
    t.image = img
    t.extension = 'REPEAT'
    links.new(t.outputs['Color'], p.inputs['Base Color'])
    TILE['caihua'] = (2.0, 1.0)
    META['btk-caihua'] = {'textures': {'color': 'modules/bazaar-tower-kit/textures/caihua-blocks.png'},
                          'note': '青绿彩画色块（无图案、无文字），512 px = 2 m 一个周期', 'tileMeters': [2.0, 1.0]}
    return m

class _Mats(dict):
    def __missing__(self, key):
        m = _MAT_DEFS[key]()
        self[key] = m
        return m
M = _Mats()

# ================================================================ 局部系与网格工具
i0, i1 = P['frontEdge']
O = Vector((FP[i0][0], FP[i0][1]))
du = Vector((FP[i1][0] - FP[i0][0], FP[i1][1] - FP[i0][1])).normalized()
dv = Vector((-du.y, du.x))          # 前街边旋转 +90°：footprint 为 CCW（layout x,z）时指向楼内
def uv_of(pt):
    d = Vector((pt[0], pt[1])) - O
    return (d.dot(du), d.dot(dv))
FPUV = [uv_of(q) for q in FP]
if G.area2(FPUV) < 0:
    raise SystemExit('footprint is CW in the local frame; expected CCW (x,z) like every bazaarBlock in layout')
CX, CZ, AREA = G.area_centroid(FP)

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

def hexa(name, c8, m, part=None, bevel=None):
    """任意六面体（8 角点局部系：底 4 + 顶 4，同序），法线自动朝外，按主轴投影米制 UV。"""
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 4, 7, 3), (1, 2, 6, 5), (0, 1, 5, 4), (3, 7, 6, 2)]
    me = bpy.data.meshes.new(name)
    me.from_pydata([to_b(*c) for c in c8], [], faces)
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bw = P['detail']['bevelM'] if bevel is None else bevel
    if bw > 0:
        ext = [(Vector(c8[1]) - Vector(c8[0])).length, (Vector(c8[3]) - Vector(c8[0])).length,
               (Vector(c8[4]) - Vector(c8[0])).length]
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bw, min(ext) * .3),
                        segments=2, affect='EDGES', clamp_overlap=True)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(me)
    bm.free()
    t = TILE.get(m) or (M[m] and TILE[m])
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

def box(name, u0, u1, v0, v1, h0, h1, m, part=None, bevel=None):
    if u1 < u0: u0, u1 = u1, u0
    if v1 < v0: v0, v1 = v1, v0
    if h1 < h0: h0, h1 = h1, h0
    return hexa(name, [(u0, v0, h0), (u1, v0, h0), (u1, v1, h0), (u0, v1, h0),
                       (u0, v0, h1), (u1, v0, h1), (u1, v1, h1), (u0, v1, h1)], m, part, bevel)

def prism(name, poly, h0, h1, m, part=None, top=True, bottom=False, sides=True):
    """多边形棱柱（可凹）：顶/底 ngon 由 bmesh 三角化，侧面四边形；米制 UV。"""
    poly = G.ccw(poly)
    n = len(poly)
    t = TILE.get(m) or (M[m] and TILE[m])
    me = bpy.data.meshes.new(name)
    verts = [to_b(p[0], p[1], h0) for p in poly] + [to_b(p[0], p[1], h1) for p in poly]
    faces = []
    if top:
        faces.append(tuple(range(n, 2 * n)))
    if bottom:
        faces.append(tuple(reversed(range(n))))
    if sides:
        for i in range(n):
            j = (i + 1) % n
            faces.append((i, j, n + j, n + i))
    me.from_pydata(verts, [], faces)
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(me)
    bm.free()
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

def sphere(name, c, r, m, part=None, seg=12, rings=8, scale_z=1.0):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=seg, ring_count=rings, location=to_b(*c))
    o = bpy.context.object
    o.name = name
    o.scale = (1, 1, scale_z)
    o.data.materials.append(M[m])
    o['part'] = part or PART
    GROUPS.setdefault((o['part'], m), []).append(o)
    return o

# ---- 立面「段」（run）：多边形边上的一段，局部 (s 沿边, o 外法向, h) ----
class Run:
    def __init__(self, a, b, s0=None, s1=None, role='plain', street=None, tag=''):
        self.a = a
        self.L, self.t, self.n = G.edge_frame(a, b)
        self.s0 = 0.0 if s0 is None else s0
        self.s1 = self.L if s1 is None else s1
        self.role, self.street, self.tag = role, street, tag
        self.turn0 = self.turn1 = 0.0          # 边端点处的外转角（只在 s0==0 / s1==L 时有意义）
        self.ext0 = self.ext1 = 0.0

    def p(self, s, o):
        return (self.a[0] + self.t[0] * s + self.n[0] * o, self.a[1] + self.t[1] * s + self.n[1] * o)

    @property
    def length(self):
        return self.s1 - self.s0

def obox(name, r, s0, s1, o0, o1, h0, h1, m, part=None, bevel=0):
    if s1 < s0: s0, s1 = s1, s0
    if o1 < o0: o0, o1 = o1, o0
    if h1 < h0: h0, h1 = h1, h0
    c = [r.p(s0, o0), r.p(s1, o0), r.p(s1, o1), r.p(s0, o1)]
    return hexa(name, [(q[0], q[1], h0) for q in c] + [(q[0], q[1], h1) for q in c], m, part, bevel)

def rpanel(name, r, sc, o, z0, z1, w, m, part=None, uscale=1.0, vnorm=False):
    """竖直面板，法线 = run 外法线；中心 s=sc，外偏 o。"""
    items = []
    for ux, uz in ((-w / 2, 0), (w / 2, 0), (w / 2, z1 - z0), (-w / 2, z1 - z0)):
        q = r.p(sc + ux, o)
        items.append(((q[0], q[1], z0 + uz), ((ux + w / 2) / uscale, uz / (z1 - z0) if vnorm else uz)))
    add_local(name, items, [(0, 1, 2, 3)], m, part=part)

# ================================================================ 立面角色（layout 检出）
def _same(p, q, tol=0.02):
    return abs(p[0] - q[0]) <= tol and abs(p[1] - q[1]) <= tol

STREET = []
for k in range(len(FP)):
    a, b = FP[k], FP[(k + 1) % len(FP)]
    st = None
    for fe in OBJ.get('frontEdges', []):
        e = fe['edge']
        if fe.get('lenM', 0) < 1.5 or _same(e[0], e[1]):
            continue
        if (_same(e[0], a) and _same(e[1], b)) or (_same(e[0], b) and _same(e[1], a)):
            st = fe['street']
    STREET.append(st)
FEDGES = [(FPUV[k], FPUV[(k + 1) % len(FPUV)]) for k in range(len(FPUV))]

try:
    _hk = json.load(open(os.path.join(HERE, '..', 'hall-kit', 'defaults.json'), encoding='utf-8'))
    SHARED_KINDS = set(_hk.get('sharedEdgeKinds', []))
except OSError:
    SHARED_KINDS = {'hall', 'tower', 'xuan', 'stage', 'waterside', 'pavilion', 'bazaarBlock', 'outerBuilding'}

def shared_segments():
    """本栋 footprint 边与其他会渲染建筑 footprint 边重合（对方两端点到本边直线 ≤ 0.05、重叠 ≥ 0.3）的段（同 hall-kit）。"""
    out = []
    for k in range(len(FP)):
        a, b = FP[k], FP[(k + 1) % len(FP)]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 0.3:
            continue
        ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        for q in LAYOUT['objects']:
            if q['id'] == OBJ['id'] or q.get('skipRender') or q.get('kind') not in SHARED_KINDS:
                continue
            qf = (q.get('geometry') or {}).get('footprint')
            if not qf or len(qf) < 3:
                continue
            for j in range(len(qf)):
                c, d = qf[j], qf[(j + 1) % len(qf)]
                if abs(-(c[0] - a[0]) * uz + (c[1] - a[1]) * ux) > 0.05 or abs(-(d[0] - a[0]) * uz + (d[1] - a[1]) * ux) > 0.05:
                    continue
                tc = (c[0] - a[0]) * ux + (c[1] - a[1]) * uz
                td = (d[0] - a[0]) * ux + (d[1] - a[1]) * uz
                lo, hi = max(0.0, min(tc, td)), min(L, max(tc, td))
                if hi - lo >= 0.3:
                    out.append({'a': uv_of((a[0] + ux * lo, a[1] + uz * lo)), 'b': uv_of((a[0] + ux * hi, a[1] + uz * hi)),
                                'other': q['id'], 'overlapM': hi - lo, 'edge': k})
    return out
SHARED = shared_segments() if SHARED_RULE else []

def classify(a, b, near_max=12.0, shared_margin=0.3):
    """多边形边 a→b 按段标角色：最近的平行 footprint 边（外侧 0..near_max）决定 street / plain，
    共享段（外扩 shared_margin）覆盖为 shared，无对应 footprint 边 = internal。返回 [(s0, s1, role, street)]。"""
    L, t, n = G.edge_frame(a, b)
    cands = []
    for j, (fa, fb) in enumerate(FEDGES):
        Lj, tj, nj = G.edge_frame(fa, fb)
        if t[0] * tj[0] + t[1] * tj[1] < math.cos(math.radians(8)):
            continue
        d = (fa[0] - a[0]) * n[0] + (fa[1] - a[1]) * n[1]
        if d < -0.05 or d > near_max:
            continue
        s0 = (fa[0] - a[0]) * t[0] + (fa[1] - a[1]) * t[1]
        s1 = (fb[0] - a[0]) * t[0] + (fb[1] - a[1]) * t[1]
        s0, s1 = max(0.0, min(s0, s1)), min(L, max(s0, s1))
        if s1 - s0 > 0.05:
            cands.append((d, s0, s1, j))
    sh = []
    for e in SHARED:
        _, te, _ = G.edge_frame(e['a'], e['b'])
        if abs(t[0] * te[1] - t[1] * te[0]) > 0.1:
            continue
        d = (e['a'][0] - a[0]) * n[0] + (e['a'][1] - a[1]) * n[1]
        if d < -0.05 or d > WALLI + 0.6:
            continue
        s0 = (e['a'][0] - a[0]) * t[0] + (e['a'][1] - a[1]) * t[1]
        s1 = (e['b'][0] - a[0]) * t[0] + (e['b'][1] - a[1]) * t[1]
        sh.append((max(0.0, min(s0, s1) - shared_margin), min(L, max(s0, s1) + shared_margin)))
    bps = sorted({0.0, L, *[c[1] for c in cands], *[c[2] for c in cands], *[x for iv in sh for x in iv]})
    segs = []
    for x0, x1 in zip(bps[:-1], bps[1:]):
        if x1 - x0 < 1e-6:
            continue
        mid = (x0 + x1) / 2
        if any(s0 <= mid <= s1 for s0, s1 in sh):
            role, st = 'shared', None
        else:
            cov = [c for c in cands if c[1] - 1e-6 <= mid <= c[2] + 1e-6]
            if cov:
                c = min(cov, key=lambda c: c[0])
                st = STREET[c[3]]
                role = 'street' if st else 'plain'
            else:
                role, st = 'internal', None
        if segs and segs[-1][2] == role and segs[-1][3] == st:
            segs[-1][1] = x1
        else:
            segs.append([x0, x1, role, st])
    # 太短的段（< 0.3 m）并进前一段
    out = []
    for s in segs:
        if out and s[1] - s[0] < 0.3:
            out[-1][1] = s[1]
        else:
            out.append(s)
    return out

# ================================================================ 平面：墙线、体块、角塔
_KIDX = G.simplify_idx(FPUV, P.get('detail', {}).get('kinkDeg', 5.0))
FPS = [FPUV[k] for k in _KIDX]
# 去掉的小折角若是阴折（原顶点落在弦内侧），弦会鼓出 footprint：该边墙线多收同样的量，墙仍在 footprint − wallInset 内
WALL = G.offset_edges(FPS, [WALLI + d for d in G.chord_bulge(FPUV, _KIDX)])

def _clip(poly, clip):
    if 'vMax' in clip:
        poly = G.clip_half(poly, 0.0, 1.0, clip['vMax'])
    if 'vMin' in clip:
        poly = G.clip_half(poly, 0.0, -1.0, -clip['vMin'])
    return G.ccw(poly)

BLOCK_DEFS = MS.get('blocks') or [{'name': 'main'}]
BLOCKS = []
for bd in BLOCK_DEFS:
    b = dict(bd)
    b['base'] = _clip(WALL, bd.get('clip', {}))
    b['heights'] = bd.get('storeyHeightsM', MS['storeyHeightsM'])
    zt = [0.0]
    for h in b['heights']:
        zt.append(zt[-1] + h)
    b['ZT'] = zt                                         # ZT[k] = 第 k 层顶（ZT[0]=0）
    b['N'] = len(b['heights'])
    b['setbackStoreys'] = bd.get('setbackStoreys', MS.get('setbackStoreys', []))
    b['setbackStreetM'] = bd.get('setbackStreetM', MS.get('setbackStreetM', 0.0))
    b['topPlan'] = bd.get('topPlan', MS.get('topPlan', 'poly'))
    b['upperPlan'] = bd.get('upperPlan', MS.get('upperPlan'))   # {'fromStorey', 'clip', 'edgeInsetM'}：上层只在一部分平面上起
    b['roof'] = dict(P['roof'], **bd.get('roof', {}))
    b['styles'] = bd.get('styles')
    BLOCKS.append(b)
BLOCK_BY = {b['name']: b for b in BLOCKS}

# ---- 角塔 ----
TWP = P.get('tower') or P.get('pavilion')
TOWER = None
if TWP and TWP.get('corner'):
    spec = TWP['corner']
    pw = TWP.get('planWM', TWP.get('planM'))
    pdp = TWP.get('planDM', TWP.get('planM'))
    if isinstance(spec, str):                            # 华宝楼：墙线包围盒角，如 'uMax-vMin'
        us = [p[0] for p in WALL]; vs = [p[1] for p in WALL]
        su, sv = spec.split('-')
        cu = max(us) if su == 'uMax' else min(us)
        cvv = min(vs) if sv == 'vMin' else max(vs)
        ci = TWP.get('cornerInsetM', 0.0)                 # 角塔离墙线内收（共享边一侧：塔檐外缘不越 footprint 边线）
        cu += -ci if su == 'uMax' else ci
        cvv += ci if sv == 'vMin' else -ci
        a0, a1 = (cu - pw, cu) if su == 'uMax' else (cu, cu + pw)
        b0, b1 = (cvv, cvv + pdp) if sv == 'vMin' else (cvv - pdp, cvv)
        TOWER = {'C': (0.0, 0.0), 'ta': (1.0, 0.0), 'tb': (0.0, 1.0), 'rect': (a0, a1, b0, b1), 'mode': 'bbox-corner'}
    elif 'edgeRun' in spec:                              # 天裕楼：沿某段 footprint 边（可跨共线段）居中，塔正面贴墙线
        k0, k1 = spec['edgeRun']
        A, B = FPUV[k0], FPUV[k1]
        L, t, n = G.edge_frame(A, B)
        Ai = (A[0] - n[0] * WALLI, A[1] - n[1] * WALLI)
        tb = (-t[1], t[0])
        c = L / 2 + spec.get('shiftM', 0.0)
        TOWER = {'C': Ai, 'ta': t, 'tb': tb, 'rect': (c - pw / 2, c + pw / 2, 0.0, pdp), 'mode': 'edge-run'}
    elif 'nearVertex' in spec:                           # 老饭店：某块平面上离 footprint 顶点最近的角，轴向，向块内伸
        _bb = BLOCK_BY[spec.get('block', BLOCKS[0]['name'])]
        bp = _bb['base']
        if spec.get('planStorey'):                       # 上层平面的角（老饭店：塔在后楼角上）——平面在下面按层算，这里先按同规则算一次
            up = _bb['upperPlan']
            cp = _clip(bp, up['clip'])
            cv_ = up['clip'].get('vMin', up['clip'].get('vMax'))
            ds = [0.0 if (abs(cp[i][1] - cv_) < 1e-3 and abs(cp[(i + 1) % len(cp)][1] - cv_) < 1e-3) else up.get('edgeInsetM', 0.0)
                  for i in range(len(cp))]
            bp = G.ccw(G.offset_edges(cp, ds))
        tgt = FPUV[spec['nearVertex']]
        q = min(bp, key=lambda p: math.hypot(p[0] - tgt[0], p[1] - tgt[1]))
        bc = G.area_centroid(bp)
        su = 1 if bc[0] > q[0] else -1
        sv = 1 if bc[1] > q[1] else -1
        cu, cvv = q[0] + su * spec.get('insetM', 0.0), q[1] + sv * spec.get('insetM', 0.0)
        for _ in range(200):                             # 斜边：整体向块内平移直到四角都在块平面内
            r = (min(cu, cu + su * pw), max(cu, cu + su * pw), min(cvv, cvv + sv * pdp), max(cvv, cvv + sv * pdp))
            if all(G.point_in(bp, c) or G.dist_to_boundary(bp, c) < 0.01 for c in G.rect_poly(r)):
                break
            cu += su * 0.05
            cvv += sv * 0.05
        TOWER = {'C': (0.0, 0.0), 'ta': (1.0, 0.0), 'tb': (0.0, 1.0), 'rect': r, 'mode': 'block-corner'}
    TOWER['params'] = TWP
    TOWER['notch'] = TWP.get('notchBody', isinstance(spec, str))

def tconv(tw, tu, tv):
    C, ta, tb = tw['C'], tw['ta'], tw['tb']
    return (C[0] + ta[0] * tu + tb[0] * tv, C[1] + ta[1] * tu + tb[1] * tv)

if TOWER:
    TOWER['poly'] = G.ccw([tconv(TOWER, *c) for c in G.rect_poly(TOWER['rect'])])
    tc = G.area_centroid(TOWER['poly'])
    TOWER['block'] = next((b for b in BLOCKS if G.point_in(b['base'], (tc[0], tc[1]))), BLOCKS[0])
    TOWER['Zb'] = TOWER['block']['ZT'][-1]

# ---- 逐层平面 ----
def edge_major_role(a, b, near_max=4.0):
    segs = classify(a, b, near_max=near_max)
    tot = {}
    for s0, s1, r, st in segs:
        tot[r] = tot.get(r, 0) + (s1 - s0)
    return max(tot, key=tot.get) if tot else 'internal'

def plan_setback(poly, d):
    ds = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        ds.append(d if edge_major_role(a, b) == 'street' else 0.0)
    return G.ccw(G.offset_edges(poly, ds))

def tower_keepout(extra):
    if not TOWER:
        return []
    us = [p[0] for p in TOWER['poly']]; vs = [p[1] for p in TOWER['poly']]
    return [(min(us) - extra, max(us) + extra, min(vs) - extra, max(vs) + extra)]

def shared_keepout_poly(poly, d):
    """共享边一侧内收 d（顶层矩形 / 屋面檐口不越共享边）。"""
    ds = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        segs = classify(a, b, near_max=0.8)
        ds.append(d if any(s[2] == 'shared' for s in segs) else 0.0)
    return G.ccw(G.offset_edges(poly, ds)) if any(ds) else poly

for b in BLOCKS:
    plans = []                                            # 未让塔的平面（底层店面 / 腰廊用）
    cur = b['base']
    for k in range(1, b['N'] + 1):
        if k in b['setbackStoreys'] and b['setbackStreetM'] > 0 and (not plans or plans[-1] is b['base'] or k == b['setbackStoreys'][0]):
            cur = plan_setback(b['base'], b['setbackStreetM'])
        up = b['upperPlan']
        if up and k == up['fromStorey']:
            cp = _clip(cur, up['clip'])
            # 切线（新边）不内收；原 footprint 边内收 edgeInsetM（上层转角翼角离开 footprint 边线，出檐包络不破）
            cv_ = up['clip'].get('vMin', up['clip'].get('vMax'))
            ds = []
            for i in range(len(cp)):
                a_, b_ = cp[i], cp[(i + 1) % len(cp)]
                on_clip = abs(a_[1] - cv_) < 1e-3 and abs(b_[1] - cv_) < 1e-3
                ds.append(0.0 if on_clip else up.get('edgeInsetM', 0.0))
            cur = G.ccw(G.offset_edges(cp, ds))
        plans.append(cur)
    b['roofRect'] = None
    ov = b['roof'].get('eaveKit', {}).get('over', EKP0['over'])
    if b['topPlan'] == 'rect':
        src = shared_keepout_poly(plans[-1], ov + EKP0['chu'] - WALLI + 0.1)
        keep = tower_keepout(b['roof'].get('towerClearM', 1.0)) if (TOWER and TOWER['block'] is b) else []
        vmax = (min(q[1] for q in src) + 0.5) if b['roof'].get('rectAnchor') == 'front' else None
        r = G.inscribed_rect(src, cell=0.25, keepout=keep, v0_max=vmax)
        plans[-1] = G.rect_poly(r)
        b['roofRect'] = r
    b['plans'] = plans
    if TOWER and TOWER['notch'] and TOWER['block'] is b:
        b['plansN'] = [G.corner_notch(p, TOWER['rect']) for p in plans]
    else:
        b['plansN'] = plans
    if b['roofRect'] is None and b['roof'].get('type', 'xishan') in ('xishan', 'xieshan'):
        top = b['plansN'][-1]
        if b['roof'].get('rect') == 'legacy-pav' and TOWER:
            # 华宝楼 R2 口径（主控复验过的形体）：前街侧从塔后缘起，东向在塔西缘外（出檐 + 0.1 m）收头
            us = [p[0] for p in top]; vs = [p[1] for p in top]
            a0, a1, bb0, bb1 = TOWER['rect']
            b['roofRect'] = (min(us), a0 - P['eaves']['overhangM'] - 0.1, bb1, max(vs))
        else:
            b['roofRect'] = G.inscribed_rect(shared_keepout_poly(top, ov + EKP0['chu'] - WALLI + 0.1), cell=0.25,
                                             keepout=tower_keepout(b['roof'].get('towerClearM', 1.0)) if TOWER else [])

# ---- 体积（外露判定）：每块每层 + 角塔 ----
VOLS = []
for b in BLOCKS:
    for k in range(b['N']):
        VOLS.append({'owner': b['name'], 'poly': b['plansN'][k], 'z0': b['ZT'][k], 'z1': b['ZT'][k + 1] + (0.8 if k == b['N'] - 1 else 0.0)})
if TOWER:
    TOWER['top'] = TOWER['Zb'] + sum(TWP['tierHeightsM'])
    VOLS.append({'owner': 'tower', 'poly': TOWER['poly'], 'z0': 0.0, 'z1': TOWER['Zb']})

def inside_other(pt, z, owner):
    for vv in VOLS:
        if vv['owner'] == owner:
            continue
        if vv['z0'] - 0.01 <= z <= vv['z1'] + 0.01 and G.point_in(vv['poly'], pt):
            return True
    return False

def in_tower(pt, z):
    return bool(TOWER) and z <= TOWER['Zb'] + 0.01 and G.point_in(TOWER['poly'], pt)

def runs_of(poly, z_mid, owner, near_max=12.0, skip_tower_face=False, step=0.5):
    """多边形 → 外露立面段（按角色切分，再按「外侧 0.45 m 是否在别的体积里」切掉被挡的部分）。"""
    poly = G.ccw(poly)
    out = []
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        L, t, nn = G.edge_frame(a, b)
        if L < 0.5:
            continue
        t0 = G.turn_deg(poly[i - 1], a, b)
        t1 = G.turn_deg(a, b, poly[(i + 2) % n])
        for s0, s1, role, st in classify(a, b, near_max=near_max):
            k = max(1, int(math.ceil((s1 - s0) / step)))
            flags = []
            for j in range(k):
                s = s0 + (s1 - s0) * (j + 0.5) / k
                po = (a[0] + t[0] * s + nn[0] * 0.45, a[1] + t[1] * s + nn[1] * 0.45)
                pi = (a[0] + t[0] * s - nn[0] * 0.45, a[1] + t[1] * s - nn[1] * 0.45)
                hid = inside_other(po, z_mid, owner) or (skip_tower_face and owner != 'tower' and in_tower(pi, z_mid))
                flags.append(hid)
            j = 0
            while j < k:
                if flags[j]:
                    j += 1
                    continue
                j2 = j
                while j2 < k and not flags[j2]:
                    j2 += 1
                ra = s0 + (s1 - s0) * j / k
                rb = s0 + (s1 - s0) * j2 / k
                if rb - ra >= 0.3:
                    r = Run(a, b, ra, rb, role, st, tag='%s%d' % (owner, i))
                    r.edge = i
                    r.turn0 = t0 if ra <= 1e-6 else 0.0
                    r.turn1 = t1 if rb >= L - 1e-6 else 0.0
                    out.append(r)
                j = j2
    return out

# ================================================================ 样式（角色 × 层）
LEGACY_STYLES = {
    'street': {'1': {'style': 'shop'}, '2': {'style': 'screen'}, '3': {'style': 'screen'}, '4': {'style': 'half'}},
    'plain': {'1': {'style': 'blank'}, '2': {'style': 'ends'}, '3': {'style': 'ends'}, '4': {'style': 'ends4'}},
}
def style_for(b, role, storey):
    st = b.get('styles') or FA.get('styles') or LEGACY_STYLES
    if role == 'shared':
        return {'style': 'blank'}
    if role == 'internal':
        role = 'plain' if 'internal' not in st else 'internal'
    tab = st.get(role) or st.get('plain') or {}
    s = tab.get(str(storey)) or tab.get('*') or {'style': 'blank'}
    return dict(s)

CS = FA['columnSizeM']
LH = FA['frameLintelHM']
FPR = FA['frameProjectM']
FDP = FA['frameDepthM']
W = FA['window']

def bays(r, a, b):
    return G.bay_lines(a, b, FA['bayRhythmM'], CS)

# ---- 窗：木樘背板 + 格心（长窗 / 半窗） ----
def window(name, r, sc, zfloor, ztop, w, h, sill, lf, timber='wood', part='windows'):
    z0 = zfloor + sill
    if z0 + h > ztop - 0.25:
        h = ztop - 0.25 - z0
    if h < 0.8:
        return
    lat = 'lattice' if timber == 'wood' else 'lattice2'
    rpanel('winb-' + name, r, sc, 0.03, z0 - 0.07, z0 + h + 0.07, w + 0.14, timber, part)
    zl0 = z0 - 0.07 + (1.0 - lf) * (h + 0.14)
    rpanel('win-' + name, r, sc, 0.054, zl0, z0 + h + 0.03, w - 0.02, lat, part)

def architrave(name, r, s0, s1, z0, z1, timber='wood'):
    obox('frame-' + name, r, s0, s1, FPR - FDP, FPR, z0, z1, timber, 'frame')

# ================================================================ 几何组装
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'shared'))   # modules/shared —— eave_kit 主控正本，只读
EK = __import__('eave_kit')

def _ek_mirrored(conv=None):
    """kit 局部 (u,v,h)（右手，面绕序即朝外法线）→ Blender 的换算是否镜像（水平行列式 < 0）。
    本套件主局部系 v = 前街边 +90°（地图 x,z 里），to_b 再把地图 z 取负落到 Blender y，整体行列式 = −1：
    kit 的面要倒序才能在 Blender / GLB 里保持朝外（同 hall-kit 注入口 v→-v 时倒序）。conv 为旋转系时一并计入。"""
    c = conv or (lambda a, b: (a, b))
    o, x, y = to_b(*c(0.0, 0.0), 0.0), to_b(*c(1.0, 0.0), 0.0), to_b(*c(0.0, 1.0), 0.0)
    return (x[0] - o[0]) * (y[1] - o[1]) - (x[1] - o[1]) * (y[0] - o[0]) < 0

def _ek_add(conv=None):
    flip = _ek_mirrored(conv)
    def _add(n, it, f, m, part):
        if flip:                                      # 倒序但保留首顶点（四边形对角线不变）
            f = [(q[0],) + tuple(reversed(q[1:])) for q in f]
        if conv is not None:
            it = [((*conv(p[0], p[1]), p[2]), uv) for p, uv in it]
        add_local(n, it, f, m, part=part)
    return _add

EK.init(_ek_add())

def ek_frame(conv):
    """eave_kit 在旋转系里出网格（角塔 / 纵向屋面）：items 的 (u,v) 经 conv 转回主局部系。"""
    EK.init(_ek_add(conv))

def ek_reset():
    EK.init(_ek_add())

def ekp_for(storey):
    e = dict(EKP0)
    e.update((P.get('eaveKitByStorey') or {}).get(str(storey), {}))
    return e

def ring_with_pulls(poly, z, over_total, owner):
    """檐口环：共享段（hall-kit 规则）与被其他体积挡住的段内收 over_total（檐口外缘不越边线），段端做直角回折。"""
    poly = G.ccw(poly)
    n = len(poly)
    subs = []                                  # 每边 [(s0, s1, d)]
    any_pull = False
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        L, t, nn = G.edge_frame(a, b)
        pulls = []
        if SHARED_RULE:
            for s0, s1, role, st in classify(a, b, near_max=0.8, shared_margin=over_total + WALLI + 0.5):
                if role == 'shared':
                    pulls.append((s0, s1))
        if CLIP_HIDDEN:
            k = max(1, int(math.ceil(L / 0.5)))
            for j in range(k):
                s = L * (j + 0.5) / k
                po = (a[0] + t[0] * s + nn[0] * 0.8, a[1] + t[1] * s + nn[1] * 0.8)
                if inside_other(po, z + 0.3, owner) and not in_tower(po, z):
                    pulls.append((max(0.0, L * j / k - 0.3), min(L, L * (j + 1) / k + 0.3)))
        # 合并区间，离端点 < 1.0 m 并到端点
        pulls.sort()
        merged = []
        for s0, s1 in pulls:
            if merged and s0 <= merged[-1][1] + 0.5:
                merged[-1][1] = max(merged[-1][1], s1)
            else:
                merged.append([s0, s1])
        for m_ in merged:
            if m_[0] < 1.0:
                m_[0] = 0.0
            if m_[1] > L - 1.0:
                m_[1] = L
        seq = []
        cur = 0.0
        for s0, s1 in merged:
            if s0 > cur:
                seq.append((cur, s0, 0.0))
            seq.append((s0, s1, over_total))
            cur = s1
            any_pull = True
        if cur < L:
            seq.append((cur, L, 0.0))
        subs.append(seq)
        if os.environ.get('BTK_DEBUG'):
            print('RINGDBG', owner, round(z, 2), i, [round(x, 2) for x in a], [round(x, 2) for x in b], 'pulls', [[round(x, 2) for x in m_] for m_ in merged])
    if not any_pull:
        return poly, False
    lines = []                                  # 逐子段的偏移线（点 + 方向），按环序
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        L, t, nn = G.edge_frame(a, b)
        for s0, s1, d in subs[i]:
            lines.append({'p0': (a[0] + t[0] * s0 - nn[0] * d, a[1] + t[1] * s0 - nn[1] * d),
                          'p1': (a[0] + t[0] * s1 - nn[0] * d, a[1] + t[1] * s1 - nn[1] * d), 't': t, 'edge': i})
    pts = []
    m = len(lines)
    for j in range(m):
        prev, cur_ = lines[j - 1], lines[j]
        if prev['edge'] == cur_['edge']:        # 同边子段：直角回折（两点）
            pts.append(prev['p1'])
            pts.append(cur_['p0'])
        else:
            x = G._line_x(prev['p1'], prev['t'], cur_['p0'], cur_['t'])
            pts.append(x if x else cur_['p0'])
    return G.simplify(pts, 0.5, 0.05), True

EAVE_LOG = []
BRACKET_N = 0
for b in BLOCKS:
    ZT, N = b['ZT'], b['N']
    bn = b['name']
    Z1 = ZT[1]
    # ---- 台基（青石）：墙线外扩 plinthOutset ----
    PART = 'base'
    po = MS['plinthOutsetM']
    prism('plinth-' + bn, G.offset_edges(b['base'], -po), 0.0, PL, 'stone', 'base', top=True, sides=True)

    # ---- 底层店面段（未让塔的平面，外露） ----
    ground_runs = runs_of(b['plans'][0], (PL + Z1) / 2, bn)
    recess = {}
    for r in ground_runs:
        stl = style_for(b, r.role, 1)
        r.style = stl
        r.recess = stl.get('recessM', 0.0) if stl.get('style') == 'shop' else 0.0
    # 相邻段（同角点）都深进时端点互相收；否则加回墙
    for r in ground_runs:
        r.nb0 = r.nb1 = None
        for q in ground_runs:
            if q is r:
                continue
            if math.hypot(*[x - y for x, y in zip(q.p(q.s1, 0), r.p(r.s0, 0))]) < 0.05:
                r.nb0 = q
            if math.hypot(*[x - y for x, y in zip(q.p(q.s0, 0), r.p(r.s1, 0))]) < 0.05:
                r.nb1 = q

    # ---- 层身墙（每层按外露段；角塔墙面所在段让给塔，避免共面闪烁） ----
    PART = 'walls'
    for k in range(1, N + 1):
        z0 = PL if k == 1 else ZT[k - 1]
        rs = ground_runs if k == 1 else runs_of(b['plansN'][k - 1], (ZT[k - 1] + ZT[k]) / 2, bn, skip_tower_face=True)
        if k == 1 and TOWER and TOWER['notch'] and TOWER['block'] is b:
            rs = runs_of(b['plansN'][0], (PL + Z1) / 2, bn)
            for r in rs:
                src = next((g for g in ground_runs if g.edge is not None and abs(g.t[0] - r.t[0]) < 1e-6 and abs(g.t[1] - r.t[1]) < 1e-6
                            and abs((r.a[0] - g.a[0]) * g.n[0] + (r.a[1] - g.a[1]) * g.n[1]) < 1e-3), None)
                r.recess = src.recess if src else 0.0
        # 被塔占住的段不出墙（塔自有墙）
        rs2 = []
        for r in rs:
            if TOWER and not TOWER['notch'] and in_tower(r.p((r.s0 + r.s1) / 2, -0.45), (z0 + ZT[k]) / 2):
                continue
            rs2.append(r)
        for i, r in enumerate(rs2):
            rc = getattr(r, 'recess', 0.0) if k == 1 else 0.0
            e0 = e1 = 0.0
            if rc > 0:
                if r.nb0 is not None and getattr(r.nb0, 'recess', 0) > 0 and r.turn0 > 0:
                    e0 = rc * math.tan(math.radians(r.turn0) / 2)
                if r.nb1 is not None and getattr(r.nb1, 'recess', 0) > 0 and r.turn1 > 0:
                    e1 = rc * math.tan(math.radians(r.turn1) / 2)
            if rc > 0:                                           # 退进的店面墙：端点沿相邻墙线（非直角转角时随深度斜移）
                def _cot(th):
                    return -1.0 / math.tan(math.radians(th)) if abs(abs(th) - 90) > 1e-3 and abs(th) > 1e-3 else 0.0
                c0 = _cot(r.turn0) if (r.s0 <= 1e-6 and e0 == 0.0) else 0.0
                c1 = _cot(r.turn1) if (r.s1 >= r.L - 1e-6 and e1 == 0.0) else 0.0
                c4 = [r.p(r.s0 + e0 + rc * c0, -rc), r.p(r.s1 - e1 - rc * c1, -rc),
                      r.p(r.s1 - e1 - (rc + WT) * c1, -rc - WT), r.p(r.s0 + e0 + (rc + WT) * c0, -rc - WT)]
                hexa('wall-%s-s%d-%d' % (bn, k, i), [(q[0], q[1], z0) for q in c4] + [(q[0], q[1], ZT[k]) for q in c4], 'wall', 'walls', bevel=0)
            else:                                                # 转角斜接：内皮按外转角收 / 伸（非直角转角不戳出相邻墙线）
                m0 = WT * math.tan(math.radians(r.turn0) / 2) if r.s0 <= 1e-6 else 0.0
                m1 = WT * math.tan(math.radians(r.turn1) / 2) if r.s1 >= r.L - 1e-6 else 0.0
                c4 = [r.p(r.s0, 0.0), r.p(r.s1, 0.0), r.p(r.s1 - m1, -WT), r.p(r.s0 + m0, -WT)]
                if P['detail'].get('bevelM', 0) > 0:             # 华宝楼样板（直角、倒棱 1 cm）：沿用轴向盒
                    obox('wall-%s-s%d-%d' % (bn, k, i), r, r.s0, r.s1, -WT, 0.0, z0, ZT[k], 'wall', 'walls', bevel=None)
                else:
                    hexa('wall-%s-s%d-%d' % (bn, k, i), [(q[0], q[1], z0) for q in c4] + [(q[0], q[1], ZT[k]) for q in c4], 'wall', 'walls', bevel=0)
            if rc > 0:                                           # 深进店面廊：两端回墙 + 廊顶
                for end, nb, s in ((0, r.nb0, r.s0), (1, r.nb1, r.s1)):
                    if nb is None or getattr(nb, 'recess', 0) <= 0:
                        # 回墙沿相邻墙线走（非直角转角时是斜的）；段中角色切换处为直角回墙
                        th = r.turn0 if end == 0 else r.turn1
                        at_corner = (r.s0 <= 1e-6) if end == 0 else (r.s1 >= r.L - 1e-6)
                        sh = (-rc / math.tan(math.radians(th)) if abs(th) > 1e-3 else 0.0) if at_corner and abs(abs(th) - 90) > 1e-3 else 0.0
                        sg = 1.0 if end == 0 else -1.0
                        c4 = [r.p(s, 0.0), r.p(s + sg * WT, 0.0), r.p(s + sg * (WT + sh), -rc), r.p(s + sg * sh, -rc)]
                        hexa('wall-ret-%s-%d-%d' % (bn, i, end), [(q[0], q[1], z0) for q in c4] + [(q[0], q[1], ZT[k]) for q in c4],
                             'wall', 'walls', bevel=0)
                obox('arcade-ceil-%s-%d' % (bn, i), r, r.s0 + e0, r.s1 - e1, -rc, 0.0, Z1 - 0.05, Z1 - 0.01, 'dark', 'shopfront', bevel=0)

    # ---- 室内遮暗核心（玻璃 / 格心后不透亮）----
    PART = 'core'
    for k in range(1, N + 1):
        pk = b['plansN'][k - 1]
        ds = []
        for i in range(len(pk)):
            a_, b_ = G.ccw(pk)[i], G.ccw(pk)[(i + 1) % len(pk)]
            rc = 0.0
            if k == 1:
                for r in ground_runs:
                    if abs(r.t[0] - G.edge_frame(a_, b_)[1][0]) < 1e-6 and abs(r.t[1] - G.edge_frame(a_, b_)[1][1]) < 1e-6 \
                            and abs((a_[0] - r.a[0]) * r.n[0] + (a_[1] - r.a[1]) * r.n[1]) < 1e-3:
                        rc = max(rc, getattr(r, 'recess', 0.0))
            ds.append(0.7 + rc + (WT if rc else 0.0))
        z0 = PL if k == 1 else ZT[k - 1]
        try:
            prism('core-%s-%d' % (bn, k), G.offset_edges(pk, ds), z0, ZT[k], 'dark', 'core', top=(k == N), sides=True)
        except Exception as ex:                                   # 退化（极窄）平面：跳过核心，只记日志
            print('WARN core skipped', bn, k, ex)

    # ---- 楼层顶盖（退台 / 顶层矩形外的平屋面，青石）----
    PART = 'terrace'
    for k in range(1, N):
        if b['plansN'][k] != b['plansN'][k - 1]:
            prism('terrace-%s-%d' % (bn, k), b['plansN'][k - 1], ZT[k] - 0.06, ZT[k] + 0.06, 'stone', 'terrace', top=True, sides=True)

    # ---- 逐层腰檐（1..N-1）+ 斗拱 ----
    PART = 'eaves'
    for k in range(1, N):
        ek = ekp_for(k)
        # 内收量 = over + chu + 0.05：檐口外缘（含翼角出翘）整段收进墙线以内，共享边一侧是干净的山墙，不留檐头残桩
        ring, pulled = ring_with_pulls(b['plansN'][k - 1], ZT[k], ek['over'] + ek['chu'] + 0.05, bn)
        # 内收的环：自身体积判定要排除本块本层
        EK.eave_skirt('eave-%s-s%d' % (bn, k), ring, ZT[k], ek, 'eaves')
        EAVE_LOG.append({'block': bn, 'storey': k, 'z': ZT[k], 'pulled': pulled, 'ringVerts': len(ring)})
        pts = []
        for r in runs_of(b['plansN'][k - 1], ZT[k] - 0.5, bn):
            if r.role == 'shared':
                continue
            step = ek['bracketStepM'] if r.role == 'street' else ek.get('bracketStepPlainM', ek['bracketStepM'])
            L = r.length
            if L < 1.2:
                continue
            nb = max(1, int(round((L - 0.8) / step)))
            for j in range(nb + 1):
                s = r.s0 + 0.4 + (L - 0.8) * j / nb
                q = r.p(s, 0.0)
                pts.append((q[0], q[1], r.n[0], r.n[1]))
        BRACKET_N += len(pts)
        EK.brackets('dougong-%s-s%d' % (bn, k), pts, ZT[k] + ek['soffitRise'], 'eaves')

    # ---- 主屋面（歇山，eave_kit）----
    rf = b['roof']
    if b['roofRect'] and rf.get('type', 'xishan') in ('xishan', 'xieshan'):
        PART = 'roof-' + bn
        u0, u1, v0, v1 = b['roofRect']
        RP = dict(EKP0)
        RP.update(rf.get('eaveKit', {}))
        ax = rf.get('ridgeAxis', 'long')                  # 'u' = 正脊平行前街（坡面朝街），'v' = 山花朝街，'long' = 沿长边
        long_u = ax == 'u' or (ax == 'long' and (u1 - u0) >= (v1 - v0))
        depth = (v1 - v0) if long_u else (u1 - u0)
        ZN = ZT[N]
        if 'ridgeHeightM' in rf:
            bz, rz = rf['breakHeightM'], rf['ridgeHeightM']
        else:
            bz = ZN + rf['breakAboveM']
            rz = ZN + rf['ridgeAboveM']
        RP.update(breakZ=bz, ridgeZ=rz, breakInset=depth / 2 * rf['breakInsetFrac'], gableInset=rf['gableInsetM'])
        b['ridgeZ'] = rz
        if long_u:
            EK.xieshan_roof('roof-' + bn, (u0, u1, v0, v1), ZN, RP, PART)
        else:                                           # 纵向矩形：旋转 90°（仍右手系）让正脊沿长边
            ek_frame(lambda tu, tv: (-tv, tu))
            EK.xieshan_roof('roof-' + bn, (v0, v1, -u1, -u0), ZN, RP, PART)
            ek_reset()
        # 华宝楼 'poly' 顶层：屋面矩形之外的顶层面做平屋面（直角多边形按格拆盒）
        if b['topPlan'] != 'rect':
            PART = 'terrace'
            top = b['plansN'][-1]
            us = sorted({round(p[0], 4) for p in top} | {u0, u1} | ({TOWER['rect'][0], TOWER['rect'][1]} if TOWER else set()))
            vs = sorted({round(p[1], 4) for p in top} | {v0, v1} | ({TOWER['rect'][2], TOWER['rect'][3]} if TOWER else set()))
            for ua, ub in zip(us[:-1], us[1:]):
                for va, vb in zip(vs[:-1], vs[1:]):
                    cu, cvv = (ua + ub) / 2, (va + vb) / 2
                    if not G.point_in(top, (cu, cvv)) or (u0 < cu < u1 and v0 < cvv < v1):
                        continue
                    if TOWER and G.point_in(TOWER['poly'], (cu, cvv)):
                        continue
                    box('terrace-top-%s-%.1f-%.1f' % (bn, cu, cvv), ua, ub, va, vb, ZN - 0.06, ZN + 0.06, 'stone', 'terrace')
    else:
        b['ridgeZ'] = ZT[N]

    # ================= 立面：底层店面 =================
    sf = FA['shopfront']
    fd = FA['fasciaDepthM']
    # 挂落 / 彩画带挂到一层檐口下缘以下（wave4 B5）：一层檐口外缘下沿 = Z1 − drop − tileH − boardH，
    # 街道眼高的视线擦着它进来，墙面上高于这条线的东西从街上永远看不见（华宝楼 R2 的挂落带整条落在这里面）
    _ek1 = ekp_for(1)
    ZF = Z1 - ((_ek1['drop'] + _ek1['tileH'] + _ek1['boardH'] + 0.02) if FA.get('fasciaBelowEave') else 0.0)
    for i, r in enumerate(ground_runs):
        stl = r.style
        if stl.get('style') != 'shop':
            continue
        rc = r.recess
        tim = stl.get('timber', 'wood')
        coltim = stl.get('columnTimber', 'wood')
        gh = min(stl.get('glassHeadM', sf['glassHeadM']), ZF - fd - 0.2)
        sh = stl.get('sillM', sf['sillM'])
        sfm, smm, smp = sf.get('frameM', 0.12), sf.get('mullionM', 0.08), sf.get('mullionPitchM', 1.05)
        lines = bays(r, r.s0 + 0.02, r.s1 - 0.02)
        tag = '%s-%d' % (bn, i)
        PART = 'colonnade'
        for j, lu in enumerate(lines):
            obox('colbase-%s-%d' % (tag, j), r, lu - CS / 2 - 0.06, lu + CS / 2 + 0.06, -CS - 0.06, 0.06, 0.0, PL + FA.get('columnBaseM', 0.06),
                 'stone', 'colbase', bevel=0)
            obox('col-%s-%d' % (tag, j), r, lu - CS / 2, lu + CS / 2, -CS, 0.0, PL, Z1, coltim, 'colonnade', bevel=None)
        PART = 'shopfront'
        op = -rc                                                   # 店面平面（深进时退到廊后）
        for a_, b_ in zip(lines[:-1], lines[1:]):
            if b_ - a_ < 1.6:
                continue
            g0, g1 = a_ + 0.18, b_ - 0.18
            bt = '%s-%.1f' % (tag, a_)
            obox('shop-post-' + bt, r, g0 - sfm, g0, op - 0.06, op + 0.06, PL, ZF - fd, tim, 'shopfront')
            obox('shop-post-' + bt + 'r', r, g1, g1 + sfm, op - 0.06, op + 0.06, PL, ZF - fd, tim, 'shopfront')
            obox('shop-riser-' + bt, r, g0, g1, op - 0.04, op + 0.02, PL, PL + sh, tim, 'shopfront', bevel=None)
            obox('shop-head-' + bt, r, g0, g1, op - 0.06, op + 0.06, gh, gh + 0.08, tim, 'shopfront')
            obox('shop-headtop-' + bt, r, g0, g1, op - 0.06, op + 0.06, ZF - fd - 0.04, ZF - fd, tim, 'shopfront')
            if stl.get('signBand'):                               # 红招牌带（空板，不写字）
                rpanel('shop-sign-' + bt, r, (g0 + g1) / 2, op + 0.03, gh + 0.08, ZF - fd - 0.04, g1 - g0, 'signred', 'shopfront')
            elif ZF - fd - 0.04 - (gh + 0.08) >= 0.1:          # 横披格心（挂落带下移后可能没空间，则不做）
                rpanel('shop-fan-' + bt, r, (g0 + g1) / 2, op + 0.02, gh + 0.08, ZF - fd - 0.04, g1 - g0,
                       'lattice' if tim == 'wood' else 'lattice2', 'shopfront')
            if FM.get('shopInterior'):                           # 店内暖色衬底（玻璃后不再是一片黑）
                rpanel('shop-back-' + bt, r, (g0 + g1) / 2, op - 0.08, PL + sh, gh, g1 - g0, 'shopback', 'shopfront')
            n_leaf = max(1, int(round((g1 - g0) / smp)))
            if n_leaf == 1 and g1 - g0 > smp:
                n_leaf = 2
            lw = (g1 - g0) / n_leaf
            for kk in range(n_leaf):
                rpanel('shop-glass-%s-%d' % (bt, kk), r, g0 + lw * (kk + 0.5), op + 0.02, PL + sh, gh, lw - smm + 0.01, 'glass', 'shopfront')
            for kk in range(1, n_leaf):
                mu = g0 + lw * kk
                obox('shop-mullion-%s-%d' % (bt, kk), r, mu - smm / 2, mu + smm / 2, op + 0.01, op + 0.07, PL + sh, gh, tim, 'shopfront')
        # 檐下挂落（鎏金格心带）或彩画额枋
        PART = 'fascia'
        if ZF < Z1 - 0.1:                                   # 挂落带上方到楼面：一道额枋（木），挡住带与檐底之间的空当
            obox('fascia-beam-' + tag, r, r.s0, r.s1, -0.25, 0.03, ZF, Z1 - 0.05, 'wood', 'fascia', bevel=0)
        gz0, gz1 = ZF - fd + 0.02, ZF - 0.02
        sc, w_ = (r.s0 + r.s1) / 2, r.length
        if stl.get('fascia', 'guoluo') == 'caihua':
            obox('caihua-g-' + tag, r, r.s0, r.s1, -0.02, 0.05, ZF - fd, ZF, 'wood', 'fascia', bevel=0)
            rpanel('caihua-' + tag, r, sc, 0.056, ZF - fd + 0.01, ZF - 0.01, w_, 'caihua', 'fascia', uscale=2.0, vnorm=True)
        else:
            rpanel('guoluo-back-' + tag, r, sc, 0.008, gz0, gz1, w_, stl.get('guoluoBack', FA.get('guoluoBackKey', 'dark')), 'fascia')
            rpanel('guoluo-' + tag, r, sc, 0.04, gz0, gz1, w_, 'guoluo', 'fascia')
            obox('guoluo-trim-' + tag, r, r.s0, r.s1, -0.01, 0.055, ZF - fd - 0.05, ZF - fd, 'gild', 'fascia', bevel=None)
        if stl.get('bayPlaques', True):
            PART = 'plaques'
            for a_, b_ in zip(lines[:-1], lines[1:]):
                if b_ - a_ < 1.6:
                    continue
                rpanel('plaque-%s-%.1f' % (tag, a_), r, (a_ + b_) / 2, 0.14, ZF - fd + 0.02, ZF - 0.04, 1.5, 'dark', 'plaques')

    # ================= 立面：二层以上 =================
    for k in range(2, N + 1):
        z, ztop = ZT[k - 1], ZT[k]
        for i, r in enumerate(runs_of(b['plansN'][k - 1], (z + ztop) / 2, bn, skip_tower_face=True)):
            stl = style_for(b, r.role, k)
            sty = stl.get('style', 'blank')
            tim = stl.get('timber', 'wood')
            tag = '%s-%d-%d' % (bn, k, i)
            if sty in ('screen', 'band', 'half', 'ends'):
                architrave('xia-' + tag, r, r.s0, r.s1, z + 0.06, z + 0.06 + LH, tim)
                architrave('shang-' + tag, r, r.s0, r.s1, ztop - 0.06 - LH, ztop - 0.06, tim)
            if stl.get('caihua'):
                ch = stl.get('caihuaHM', 0.5)
                zc1 = ztop - 0.06 - stl.get('caihuaDropM', 0.0)      # 深檐下压低，街道眼高不被檐口挡住
                PART = 'frame'
                obox('caihua-b-' + tag, r, r.s0, r.s1, FPR - FDP, FPR, zc1 - ch, zc1, tim, 'frame', bevel=0)
                rpanel('caihua-' + tag, r, (r.s0 + r.s1) / 2, FPR + 0.006, zc1 - ch + 0.02, zc1 - 0.02, r.length, 'caihua',
                       'frame', uscale=2.0, vnorm=True)
            if sty in ('screen', 'band'):
                lines = bays(r, r.s0 + 0.02, r.s1 - 0.02)
                for j, lu in enumerate(lines):
                    obox('frame-col-%s-%d' % (tag, j), r, lu - CS / 2, lu + CS / 2, FPR - CS, FPR, z, ztop, tim, 'framecol')
                zl0, zl1 = z + 0.06 + LH + 0.02, ztop - 0.06 - LH - 0.02
                for bi, (a_, b_) in enumerate(zip(lines[:-1], lines[1:])):
                    g0, g1 = a_ + CS / 2, b_ - CS / 2
                    if g1 - g0 < 1.8:
                        continue
                    if sty == 'screen':                         # 长窗屏：整樘木背板 + 每开间数扇格心长窗
                        nlv, gap, lf = FA['longWindowLeaves'], FA['leafGapM'], FA['longWindowLatticeFrac']
                        zw0 = zl0 + (1.0 - lf) * (zl1 - zl0)
                        rpanel('winbay-%s-%d' % (tag, bi), r, (g0 + g1) / 2, 0.02, zl0, zl1, g1 - g0, tim, 'windows')
                        pitch = (g1 - g0) / nlv
                        for kk in range(nlv):
                            rpanel('winleaf-%s-%d-%d' % (tag, bi, kk), r, g0 + pitch * (kk + 0.5), 0.045, zw0, zl1 - 0.03,
                                   pitch - gap, 'lattice' if tim == 'wood' else 'lattice2', 'windows')
                    else:                                       # 窗带：白墙上一条通开间的格心窗（上下露白墙）
                        bh, bs = stl.get('bandHM', 1.3), stl.get('bandSillM', 0.95)
                        zb0 = z + bs
                        zb1 = min(zb0 + bh, zl1 - 0.1)
                        m_ = 0.18
                        rpanel('bandb-%s-%d' % (tag, bi), r, (g0 + g1) / 2, 0.03, zb0 - 0.08, zb1 + 0.08, g1 - g0 - 2 * m_ + 0.16, tim, 'windows')
                        nlv = max(2, int(round((g1 - g0 - 2 * m_) / 0.75)))
                        pitch = (g1 - g0 - 2 * m_) / nlv
                        for kk in range(nlv):
                            rpanel('bandleaf-%s-%d-%d' % (tag, bi, kk), r, g0 + m_ + pitch * (kk + 0.5), 0.055, zb0, zb1,
                                   pitch - 0.06, 'lattice' if tim == 'wood' else 'lattice2', 'windows')
            elif sty == 'half':
                lines = bays(r, r.s0 + 0.02, r.s1 - 0.02)
                cs_ = [(a_ + b_) / 2 for a_, b_ in zip(lines[:-1], lines[1:]) if b_ - a_ >= 2.0]
                for j, c in enumerate(cs_):
                    ww = min(W['widthM'], 2.2)
                    if c < r.s0 + ww / 2 + 0.1 or c > r.s1 - ww / 2 - 0.1:
                        continue
                    window('%s-%d' % (tag, j), r, c, z, ztop, ww, 1.3, 1.45, FA['halfWindowLatticeFrac'], tim)
            elif sty == 'ends':
                fr_ = (0.3, 0.7) if not stl.get('pitchM') else \
                    [(j + 0.5) / max(2, int(round(r.length / stl['pitchM']))) for j in range(max(2, int(round(r.length / stl['pitchM']))))]
                for j, f in enumerate(fr_):
                    c = r.s0 + r.length * f
                    if c < r.s0 + W['widthM'] / 2 + 0.1 or c > r.s1 - W['widthM'] / 2 - 0.1:
                        continue
                    window('%s-%d' % (tag, j), r, c, z, ztop, W['widthM'], W['heightM'], W['sillM'], FA['longWindowLatticeFrac'], tim)
            elif sty == 'ends4':
                cnt = max(2, int(r.length / 4.4))
                for j in range(cnt):
                    c = r.s0 + r.length * (j + 0.5) / cnt
                    if c < r.s0 + W['widthM'] / 2 + 0.1 or c > r.s1 - W['widthM'] / 2 - 0.1:
                        continue
                    window('%s-%d' % (tag, j), r, c, z, ztop, W['widthM'], 1.3, 1.45, FA['halfWindowLatticeFrac'], tim)

    # ================= 腰廊（直棂木栏杆） =================
    gd = FA['galleryDepthM']
    bh = FA['balustradeHM']
    bpp = FA.get('balustradePostPitchM', 2.3)
    gal_st = b.get('galleryStoreys', FA['galleryStoreys'])
    gt = FA.get('galleryTimberKey', 'wood')
    for k in gal_st:
        if k > N:
            continue
        z = ZT[k - 1]
        grs = [r for r in runs_of(b['plans'][k - 1], z + 0.6, bn) if r.role == 'street']
        for r in grs:
            r.nb0 = r.nb1 = None
            for q in grs:
                if q is r:
                    continue
                if math.hypot(*[x - y for x, y in zip(q.p(q.s1, 0), r.p(r.s0, 0))]) < 0.05:
                    r.nb0 = q
                if math.hypot(*[x - y for x, y in zip(q.p(q.s0, 0), r.p(r.s1, 0))]) < 0.05:
                    r.nb1 = q
        for i, r in enumerate(grs):
            e0 = gd * math.tan(math.radians(r.turn0) / 2) if r.nb0 is not None else 0.0
            e1 = gd * math.tan(math.radians(r.turn1) / 2) if r.nb1 is not None else 0.0
            sa, sb = r.s0 - e0, r.s1 + e1
            tag = '%s-%d-%d' % (bn, k, i)
            PART = 'gallery'
            obox('gal-slab-' + tag, r, sa, sb, -0.1, gd, z - 0.06, z + 0.06, 'stone', 'gallery', bevel=None)
            npost = max(1, int((sb - sa) / bpp))
            for j in range(npost + 1):
                pu = sa + (sb - sa) * j / npost
                obox('gal-post-%s-%d' % (tag, j), r, pu - 0.06, pu + 0.06, gd - 0.05, gd + 0.05, z, z + bh, gt, 'gallery', bevel=0)
            obox('gal-rail-' + tag, r, sa, sb, gd - 0.055, gd + 0.055, z + bh - 0.08, z + bh, gt, 'gallery', bevel=0)
            obox('gal-sill-' + tag, r, sa, sb, gd - 0.045, gd + 0.045, z + 0.08, z + 0.16, gt, 'gallery', bevel=0)
            rpanel('gal-lattice-' + tag, r, (sa + sb) / 2, gd + 0.03, z + 0.16, z + bh - 0.08, sb - sa, 'slats', 'gallery')

# ================================================================ 角塔
if TOWER:
    TW = TOWER
    tp = TW['params']
    conv = lambda tu, tv: tconv(TW, tu, tv)
    def tbox(name, a0, a1, b0, b1, h0, h1, m, part, bevel=None):
        c = [conv(a0, b0), conv(a1, b0), conv(a1, b1), conv(a0, b1)]
        return hexa(name, [(q[0], q[1], h0) for q in c] + [(q[0], q[1], h1) for q in c], m, part, bevel)
    PU0, PU1, PV0, PV1 = TW['rect']
    Zb = TW['Zb']
    TB = TW['block']
    TI = tp.get('tierInsetM', 0.25)
    po = MS['plinthOutsetM']
    tbox('pav-plinth', PU0 - po, PU1 + po, PV0 - po, PV1 + po, 0, PL, 'stone', 'pav-base')
    tbox('pav-wall-s', PU0, PU1, PV0, PV0 + WT, PL, Zb, 'wall', 'pav-body')
    tbox('pav-wall-e', PU1 - WT, PU1, PV0, PV1, PL, Zb, 'wall', 'pav-body')
    tbox('pav-wall-w', PU0, PU0 + WT, PV0, PV1, PL, Zb, 'wall', 'pav-body')
    tbox('pav-wall-n', PU0, PU1, PV1 - WT, PV1, PL, Zb, 'wall', 'pav-body')
    tbox('pav-core', PU0 + WT, PU1 - WT, PV0 + WT, PV1 - WT, PL, Zb, 'dark', 'pav-body')
    for cu, cv_, tg in ((PU0 + 0.17, PV0 + 0.17, 'sw'), (PU1 - 0.17, PV0 + 0.17, 'se'),
                        (PU0 + 0.17, PV1 - 0.17, 'nw'), (PU1 - 0.17, PV1 - 0.17, 'ne')):
        tbox('pav-post-' + tg, cu - 0.17, cu + 0.17, cv_ - 0.17, cv_ + 0.17, PL, Zb, tp.get('postTimber', 'wood'), 'pav-body')
    tbox('pav-cap', PU0 - 0.05, PU1 + 0.05, PV0 - 0.05, PV1 + 0.05, Zb - 0.06, Zb + 0.06, 'stone', 'pav-body')
    PEKP = dict(EKP0)
    PEKP.update(tp.get('eaveKit', {}))
    ek_frame(conv)
    EK.eave_skirt('pav-eave-z4', [(PU0, PV0), (PU1, PV0), (PU1, PV1), (PU0, PV1)], Zb, PEKP, 'pav-body')
    ek_reset()

    def tower_face_runs(a0, a1, b0, b1):
        cs = [conv(a0, b0), conv(a1, b0), conv(a1, b1), conv(a0, b1)]
        return [Run(cs[i], cs[(i + 1) % 4], tag='face%d' % i) for i in range(4)]
    # 塔身窗（塔底所在块的 2..N 层，只开外露面）
    for k in range(2, TB['N'] + 1):
        z, ztop = TB['ZT'][k - 1], TB['ZT'][k]
        for fi, r in enumerate(tower_face_runs(PU0, PU1, PV0, PV1)):
            mid = r.p(r.L / 2, 0.45)
            if inside_other(mid, (z + ztop) / 2, 'tower'):
                continue
            for j, f in enumerate(tp.get('bodyWindowAt', (0.32, 0.68))):
                window('pav-%d-%d-%d' % (k, fi, j), r, r.L * f, z, ztop, 1.3, 1.6, 0.9, FA['longWindowLatticeFrac'],
                       tp.get('windowTimber', 'wood'), part='windows')
    zt = Zb
    tiers = tp['tierHeightsM']
    for kk, th in enumerate(tiers):
        inset = TI * (kk + 1)
        a0, a1, b0, b1 = PU0 + inset, PU1 - inset, PV0 + inset, PV1 - inset
        pk = 'pav-tier%d' % (kk + 1)
        tbox(pk + '-wall-s', a0, a1, b0, b0 + WT, zt + 0.06, zt + th - 0.06, 'wall', pk)
        tbox(pk + '-wall-n', a0, a1, b1 - WT, b1, zt + 0.06, zt + th - 0.06, 'wall', pk)
        tbox(pk + '-wall-w', a0, a0 + WT, b0, b1, zt + 0.06, zt + th - 0.06, 'wall', pk)
        tbox(pk + '-wall-e', a1 - WT, a1, b0, b1, zt + 0.06, zt + th - 0.06, 'wall', pk)
        last = kk == len(tiers) - 1
        if not (last and tp.get('roofType', 'zanjian') in ('xishan', 'xieshan')):
            tbox(pk + '-cap', a0 - 0.05, a1 + 0.05, b0 - 0.05, b1 + 0.05, zt + th - 0.06, zt + th + 0.06, 'stone', pk)
        if not last or tp.get('roofType', 'zanjian') not in ('xishan', 'xieshan'):
            ek_frame(conv)
            EK.eave_skirt(pk + '-eave', [(a0, b0), (a1, b0), (a1, b1), (a0, b1)], zt + th, PEKP, pk)
            ek_reset()
        faces = tower_face_runs(a0, a1, b0, b1)
        for fi, r in enumerate(faces):
            if fi == 0:
                cs_ = [r.L / 2 - 1.0, r.L / 2 + 1.0] if r.L >= 4.0 else [r.L / 2]
            else:
                cs_ = [r.L / 2]
            for j, c in enumerate(cs_):
                window('pt%d-%d-%d' % (kk + 1, fi, j), r, c, zt, zt + th, 1.3, 1.5, 0.8, FA['longWindowLatticeFrac'],
                       tp.get('windowTimber', 'wood'), part='windows')
        zt += th
    TW['wallTop'] = zt
    rt = tp.get('roofType', 'zanjian')
    if rt == 'zanjian':
        PART = 'pav-roof'
        apex = zt + tp['apexAboveLastEaveM']
        tin = TI * len(tiers)
        pr = (PU0 + tin - tp['pyramidOutsetM'], PU1 - tin + tp['pyramidOutsetM'],
              PV0 + tin - tp['pyramidOutsetM'], PV1 - tin + tp['pyramidOutsetM'])
        pcu, pcv = (pr[0] + pr[1]) / 2, (pr[2] + pr[3]) / 2
        ZP = dict(EKP0)
        ZP.update(tp.get('zanjian', {}))
        ek_frame(conv)
        EK.zanjian_roof('pav-roof', pr, zt, apex, ZP, 'pav-roof')
        ek_reset()
        TW['roofTop'] = apex
    else:                                                 # 独立高起的歇山（天裕楼转角塔楼）
        PART = 'pav-roof'
        tin = TI * len(tiers)
        a0, a1, b0, b1 = PU0 + tin, PU1 - tin, PV0 + tin, PV1 - tin
        TRP = dict(PEKP)
        TRP.update(tp.get('xieshan', {}).get('eaveKit', {}))
        xs = tp['xieshan']
        dep = min(a1 - a0, b1 - b0)
        TRP.update(breakZ=zt + xs['breakAboveM'], ridgeZ=zt + xs['ridgeAboveM'], breakInset=dep / 2 * xs['breakInsetFrac'],
                   gableInset=xs['gableInsetM'], ornamentScale=xs.get('ornamentScale', 'auto'))
        if (a1 - a0) >= (b1 - b0):
            ek_frame(conv)
            EK.xieshan_roof('pav-roof', (a0, a1, b0, b1), zt, TRP, 'pav-roof')
        else:
            ek_frame(lambda tu, tv: conv(-tv, tu))
            EK.xieshan_roof('pav-roof', (b0, b1, -a1, -a0), zt, TRP, 'pav-roof')
        ek_reset()
        pcu, pcv = (a0 + a1) / 2, (b0 + b1) / 2
        TW['roofTop'] = TRP['ridgeZ']
    fin = tp.get('finial')
    if fin:
        cxy = conv(pcu, pcv)
        base_z = TW['roofTop'] - 0.25
        if fin.get('style', 'rod-sphere') == 'gourd':           # 葫芦宝顶：座 + 下大球 + 上小球 + 尖
            r1, r2 = fin['lowerRM'], fin['upperRM']
            cyl('pav-finial-seat', (cxy[0], cxy[1], base_z), (cxy[0], cxy[1], base_z + 0.5), r1 * 0.55, 'gild', 10, part='pav-roof')
            zc1 = base_z + 0.5 + r1 * 0.85
            sphere('pav-finial-lower', (cxy[0], cxy[1], zc1), r1, 'gild', 'pav-roof', seg=12, rings=8, scale_z=0.9)
            zc2 = zc1 + r1 * 0.8 + r2 * 0.9
            sphere('pav-finial-upper', (cxy[0], cxy[1], zc2), r2, 'gild', 'pav-roof', seg=12, rings=8, scale_z=1.0)
            cyl('pav-finial-tip', (cxy[0], cxy[1], zc2 + r2 * 0.9), (cxy[0], cxy[1], fin['topM']), 0.05, 'gild', 6, part='pav-roof')
        else:
            cyl('pav-finial-rod', (cxy[0], cxy[1], base_z), (cxy[0], cxy[1], fin['topM'] - fin['sphereRM']), 0.07, 'gild', 8, part='pav-roof')
            sphere('pav-finial-sphere', (cxy[0], cxy[1], fin['topM'] - fin['sphereRM']), fin['sphereRM'], 'gild', 'pav-roof')

# ================================================================ 特征件：空匾 / 灯笼 / 石狮
FEAT = P.get('features', {})
def front_run(block, storey, near_max=12.0):
    """某块某层平面上，与 params.frontEdge 对应 footprint 边平行且最近的外露临街段（最长者）。"""
    fa, fb = FEDGES[i0]
    _, tf, _ = G.edge_frame(fa, fb)
    z = (block['ZT'][storey - 1] + block['ZT'][storey]) / 2
    plan = block['plans'][storey - 1] if storey == 1 else block['plansN'][storey - 1]
    rs = [r for r in runs_of(plan, z, block['name'], skip_tower_face=(storey > 1))
          if r.t[0] * tf[0] + r.t[1] * tf[1] > 0.99]
    Lf, _, nf = G.edge_frame(fa, fb)
    def key(r):
        m = r.p((r.s0 + r.s1) / 2, 0.0)
        d = -((m[0] - fa[0]) * nf[0] + (m[1] - fa[1]) * nf[1])          # 离前街边向内距离
        sm = (m[0] - fa[0]) * tf[0] + (m[1] - fa[1]) * tf[1]
        return (0 if -0.5 <= sm <= Lf + 0.5 else 1, round(d, 1), -r.length)
    return min(rs, key=key) if rs else None

PLAQUE_LOG = []
for pi_, pq in enumerate(FEAT.get('plaques', [])):
    blk = BLOCK_BY[pq.get('block', BLOCKS[0]['name'])]
    r = front_run(blk, pq['storey'])
    if r is None:
        raise SystemExit('plaque %d: no front run on storey %d' % (pi_, pq['storey']))
    at = pq.get('at', 0.5)
    sc = r.s0 + r.length * at
    zb = blk['ZT'][pq['storey'] - 1] + pq['z0']
    w_, h_ = pq['wM'], pq['hM']
    bd_ = pq.get('borderM', 0.09)
    o_ = pq.get('o', 0.06)
    PART = 'plaques'
    rpanel('plaque-big-frame-%d' % pi_, r, sc, o_ - 0.006, zb - bd_, zb + h_ + bd_, w_ + 2 * bd_, 'gild', 'plaques')
    rpanel('plaque-big-%d' % pi_, r, sc, o_, zb, zb + h_, w_, 'dark', 'plaques')
    if o_ > 0.2:                                          # 外挑的匾：背后两根深色挂杆接回墙面
        for sgn in (-1, 1):
            obox('plaque-arm-%d-%d' % (pi_, sgn), r, sc + sgn * w_ * 0.35 - 0.04, sc + sgn * w_ * 0.35 + 0.04, 0.0, o_ - 0.006,
                 zb + h_ * 0.5 - 0.04, zb + h_ * 0.5 + 0.04, 'dark', 'plaques', bevel=0)
    PLAQUE_LOG.append({'storey': pq['storey'], 'center': [round(x, 2) for x in r.p(sc, o_)], 'z': [round(zb, 2), round(zb + h_, 2)],
                       'w': w_, 'h': h_})

LANTERN_N = 0
if FEAT.get('lanterns'):
    ln = FEAT['lanterns']
    blk = BLOCK_BY[ln.get('block', BLOCKS[0]['name'])]
    Z1 = blk['ZT'][1]
    rs = [front_run(blk, 1)] if ln.get('runs', 'front') == 'front' else \
        [r for r in runs_of(blk['plans'][0], Z1 / 2, blk['name']) if r.role == 'street']
    for ri, r in enumerate([x for x in rs if x]):
        cnt = max(1, int(r.length / ln['pitchM']))
        for j in range(cnt):
            s = r.s0 + r.length * (j + 0.5) / cnt
            q = r.p(s, ln['o'])
            zc = Z1 - ln['zBelowEaveM']
            rr = ln['rM']
            PART = 'lanterns'
            sphere('lantern-%d-%d' % (ri, j), (q[0], q[1], zc), rr, 'lantern', 'lanterns', seg=8, rings=6, scale_z=1.25)
            cyl('lantern-cap-%d-%d' % (ri, j), (q[0], q[1], zc + rr * 1.15), (q[0], q[1], zc + rr * 1.3), rr * 0.45, 'gild', 6, part='lanterns')
            cyl('lantern-cord-%d-%d' % (ri, j), (q[0], q[1], zc + rr * 1.3), (q[0], q[1], Z1 - 0.02), 0.015, 'dark', 4, part='lanterns')
            LANTERN_N += 1

LION_LOG = []
if FEAT.get('lions'):
    li = FEAT['lions']
    blk = BLOCK_BY[li.get('block', BLOCKS[0]['name'])]
    r = front_run(blk, 1)
    sc = r.s0 + r.length * li.get('at', 0.5)
    for sgn in (-1, 1):
        s = sc + sgn * li['gapM'] / 2
        o = li['o']
        PART = 'lions'
        obox('lion-ped-%d' % sgn, r, s - 0.45, s + 0.45, o - 0.35, o + 0.35, PL, PL + 0.85, 'stone', 'lions', bevel=0.02)
        obox('lion-body-%d' % sgn, r, s - 0.3, s + 0.3, o - 0.28, o + 0.22, PL + 0.85, PL + 1.45, 'lionstone', 'lions', bevel=0.06)
        obox('lion-paws-%d' % sgn, r, s - 0.26, s + 0.26, o + 0.1, o + 0.34, PL + 0.85, PL + 1.1, 'lionstone', 'lions', bevel=0.04)
        q = r.p(s, o + 0.12)
        sphere('lion-head-%d' % sgn, (q[0], q[1], PL + 1.72), 0.3, 'lionstone', 'lions', seg=10, rings=6)
        LION_LOG.append([round(x, 2) for x in r.p(s, o)])

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
bpy.context.view_layer.update()
for o in final:
    o.parent = anchor
    o.matrix_parent_inverse = anchor.matrix_world.inverted()

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
    if 'glass' in nm_ and mm.get('alphaMode') != 'BLEND':
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
texs = {}
for nm, meta in META.items():
    for f in meta.get('textures', {}).values():
        pth = os.path.join(TEX_DIR, f) if not f.startswith('modules/') else os.path.join(ROOT, f)
        if os.path.exists(pth):
            texs[f] = os.path.getsize(pth)
blocks_rec = [{'name': b['name'], 'storeyHeightsM': b['heights'], 'wallTopM': round(b['ZT'][-1], 3),
               'topPlan': b['topPlan'], 'roofRectUV': [round(x, 3) for x in b['roofRect']] if b['roofRect'] else None,
               'ridgeZ': round(b.get('ridgeZ', 0), 3), 'setbackStoreys': b['setbackStoreys'],
               'planVerts': [len(p) for p in b['plansN']]} for b in BLOCKS]
tower_rec = None
if TOWER:
    tower_rec = {'mode': TOWER['mode'], 'rectTowerFrame': [round(x, 3) for x in TOWER['rect']],
                 'polyUV': [[round(x, 3) for x in p] for p in TOWER['poly']],
                 'polyMap': [[round(O.x + p[0] * du.x + p[1] * dv.x, 3), round(O.y + p[0] * du.y + p[1] * dv.y, 3)] for p in TOWER['poly']],
                 'baseBlock': TOWER['block']['name'], 'bodyTopM': TOWER['Zb'], 'wallTopM': round(TOWER.get('wallTop', 0), 3),
                 'roofTopM': round(TOWER.get('roofTop', 0), 3), 'notchBody': TOWER['notch']}
json.dump({'triangles': tris, 'byNode': by, 'glbBytes': os.path.getsize(glb), 'maxY': round(maxy, 3),
           'anchorMap': [round(CX, 4), round(CZ, 4)], 'footprintAreaM2': round(AREA, 2),
           'textures': texs, 'textureTotalBytes': sum(texs.values()), 'params': PARAMS_REL,
           'blocks': blocks_rec, 'tower': tower_rec, 'eaves': EAVE_LOG, 'brackets': BRACKET_N,
           'plaques': PLAQUE_LOG, 'lanterns': LANTERN_N, 'lions': LION_LOG,
           'sharedEdges': [{'other': e['other'], 'overlapM': round(e['overlapM'], 2), 'fpEdge': e['edge']} for e in SHARED],
           'streetEdges': {str(k): s for k, s in enumerate(STREET) if s},
           'buildSeconds': round(time.time() - T0, 1)},
          open(os.path.join(OUT, 'measurements.json'), 'w'), ensure_ascii=False, indent=2)
json.dump({'axis': 'GLB Y-up world map coords (x=layout x, z=layout z, y=height); anchor empty at footprint AREA centroid',
           'instanceSpace': False, 'integratedIntoWorld': True,
           'materials': META, 'params': P, 'designInference': P.get('designInference', []),
           'textureSource': 'asset-authoring/yuyuan-entry/source-kit/textures (read-only) + modules/bazaar-tower-kit/textures（程序化）',
           'notes': ['瓦垄/瓦当以 roof 材质贴图表达，无逐瓦几何；正脊素端头、无走兽。',
                     '所有匾额 / 招牌为空板（深色板 + 金框 / 红板），不写任何文字。',
                     '格心 / 直棂 / 挂落为程序化 alpha 贴图（白条 × 材质色）；彩画为色块贴图，无图案。',
                     *P.get('notes', [])],
           'buildSeconds': round(time.time() - T0, 1)},
          open(os.path.join(OUT, 'recipe.json'), 'w'), ensure_ascii=False, indent=2)
print('BAZAAR_TOWER_BUILT', P['id'], tris, os.path.getsize(glb), round(maxy, 2),
      'anchor', round(CX, 3), round(CZ, 3), 'secs', round(time.time() - T0, 1))
