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
import params_load                                               # noqa: E402  wave7 K1：立面预设 + auto 值
P = params_load.load(PARAMS_REL)
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
# 共享 / 内收段檐口的收法：缺省 = 环线内收 + 直角回折（原行为）；'endcap'（wave6-eavekit E3，华宝楼）= 环线不动、
# 内收段整段不出檐，由 eave_kit endCaps 在断开处做端头收口（端面 ⟂ 本段墙线、过墙线角点，端部不起翘）
EAVE_END_CAP = P.get('sharedEdgeEaveEnd', 'return') == 'endcap'

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
    # wave7 B：预设楼（zone-bazaar-4 件）台基 / 楼板用素色石（materials.plinthPlain），件里少带一张 130 KB 砖纹贴图
    'stone': lambda: (mat('stone', lin(FM['plinthTint']), .92) if FM.get('plinthPlain') else
                      mat('stone', rough=.92, base='Bricks061_2K-JPG_Color_1K.jpg', tint=FM['plinthTint'], tile=tuple(FM['plinthTile']))),
    'roof': lambda: mat('roof', rough=.8, base='roof-color.jpg', normal='roof-normal.png', tint=FM.get('roofTint'),
                        tile=tuple(FM['roofTile'])),
    'gild': lambda: mat('gild', lin(FM['gilded']), FM.get('gildRough', .38), metallic=FM.get('gildMetallic', .55)),
    'glass': lambda: mat('glass', lin(FM['glass']), .18, alpha=FM['glassAlpha'], alpha_mode='BLEND'),
    'dark': lambda: mat('dark', lin(FM['dark']), .6),
    'shopback': lambda: mat('shopback', lin(FM.get('shopInterior', '6e5238')), .8, emission=FM.get('shopEmission')),
    'lacquer': lambda: mat('lacquer', lin(FM.get('lacquerTint', '15100e')), .32),
    'signred': lambda: mat('signred', lin(FM.get('signRed', 'a82a1e')), .55),
    'lantern': lambda: mat('lantern', lin(FM.get('lanternRed', 'c8301f')), .5),
    'lionstone': lambda: (mat('lionstone', lin(FM.get('lionTint', 'a8a79f')), .9) if FM.get('plinthPlain') else
                          mat('lionstone', rough=.9, base='Bricks061_2K-JPG_Color_1K.jpg', tint=FM.get('lionTint', 'a8a79f'), tile=(0.6, 0.6))),
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
# wave7 K1：顺时针 footprint（layout 里少数 bazaarBlock）倒序成逆时针，前街边下标随之换算（params 仍按 layout 原序写）
FP, i0, i1, FP_FLIPPED = params_load.ccw_frame(FP, P['frontEdge'])
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
    if SHARED_GUARD and (crosses_shared(r.p(sc - w / 2, o + 0.01), 0.0) or crosses_shared(r.p(sc + w / 2, o + 0.01), 0.0)):
        return                                           # wave7 B：面板（窗 / 匾 / 招牌）不探过共享边
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

# ---- wave7 B：共享边硬规则（同 hall-kit）：任何构件不越过共享段 0.02 m 以上、不插进邻栋 footprint ----
# SHARED_GUARD 缺省只对预设楼（params 带 preset）开：名楼已按原做法通过 test9，输出不变
SHARED_GUARD = P.get('sharedGuard', bool(P.get('preset')))
NEIGH_UV = []
for _oid in sorted({e['other'] for e in SHARED}):
    _q = next(q for q in LAYOUT['objects'] if q['id'] == _oid)
    _qf = [list(x) for x in _q['geometry']['footprint']]
    NEIGH_UV.append(G.ccw([uv_of(x) for x in (_qf[:-1] if _qf[0] == _qf[-1] else _qf)]))

def crosses_shared(pt, margin=0.05):
    """局部 (u,v) 点是否越过某共享段（段内 s，外法向距离 > −margin）或落进邻栋 footprint（距其边界 ≥ 0.02 以内侧）。"""
    if not SHARED_GUARD:
        return False
    for e in SHARED:
        L_, t_, n_ = G.edge_frame(e['a'], e['b'])
        dx, dy = pt[0] - e['a'][0], pt[1] - e['a'][1]
        s_ = dx * t_[0] + dy * t_[1]
        d_ = dx * n_[0] + dy * n_[1]
        if -0.05 <= s_ <= L_ + 0.05 and -margin < d_ < 6.0:
            return True
    for q in NEIGH_UV:
        if G.point_in(q, pt) and G.dist_to_boundary(q, pt) > 0.02:
            return True
    return False

def rect_fit(r, over, chu, env_pts0, step=0.25, min_side=3.0, ang=0.0):
    """歇山矩形的出檐探针（四角翼角 + 四边每 1 m 檐口点）全部合规前，逐步把违规一侧内收 step；收不动返回 None。
    env_pts(pt) → True = 合规（出檐包络内 且 不越共享边）。ang = 矩形所在方向系（探针转回局部 u,v 再判）。
    边上探针离角 2 m 内的违规算作角违规；角违规只收一侧——收掉面积损失小的那一侧（斜切角处不必整条长边后退）。"""
    env_pts = (lambda q: env_pts0(G.frame_to_uv(ang, q))) if ang else env_pts0
    r = list(r)
    for _ in range(160):
        u0, u1, v0, v1 = r
        c = over + chu
        bad = set()
        cbad = []
        for side, q in ((('u0', 'v0'), (u0 - c, v0 - c)), (('u1', 'v0'), (u1 + c, v0 - c)),
                        (('u1', 'v1'), (u1 + c, v1 + c)), (('u0', 'v1'), (u0 - c, v1 + c))):
            if not env_pts(q):
                cbad.append(side)
        for side, a_, b_, fix, o_, ends in (('v0', u0, u1, v0, -over, ('u0', 'u1')), ('v1', u0, u1, v1, over, ('u0', 'u1')),
                                            ('u0', v0, v1, u0, -over, ('v0', 'v1')), ('u1', v0, v1, u1, over, ('v0', 'v1'))):
            m = max(2, int((b_ - a_) / 1.0))
            for j in range(m + 1):
                x = a_ + (b_ - a_) * j / m
                q = (x, fix + o_) if side[0] == 'v' else (fix + o_, x)
                if env_pts(q):
                    continue
                if x - a_ < 2.0:
                    cbad.append((side, ends[0]))
                elif b_ - x < 2.0:
                    cbad.append((side, ends[1]))
                else:
                    bad.add(side)
        for sa, sb in cbad:
            if sa in bad or sb in bad:
                continue
            lu, lv = u1 - u0, v1 - v0
            su, sv = (sa, sb) if sa[0] == 'u' else (sb, sa)
            bad.add(su if lv < lu else sv)          # 收 u 侧损失 lv × step，收 v 侧损失 lu × step
        if not bad:
            return tuple(r)
        if 'u0' in bad: r[0] += step
        if 'u1' in bad: r[1] -= step
        if 'v0' in bad: r[2] += step
        if 'v1' in bad: r[3] -= step
        if r[1] - r[0] < min_side or r[3] - r[2] < min_side:
            return None
    return None

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
        if d < -0.05 or d > e.get('det', WALLI + 0.6):
            continue
        s0 = (e['a'][0] - a[0]) * t[0] + (e['a'][1] - a[1]) * t[1]
        s1 = (e['b'][0] - a[0]) * t[0] + (e['b'][1] - a[1]) * t[1]
        lo_, hi_ = max(0.0, min(s0, s1) - shared_margin), min(L, max(s0, s1) + shared_margin)
        if hi_ - lo_ > 1e-6:                     # wave7 B：共线延长线上的共享段（整段在本边之外）不算，否则会切出 s > L 的段
            sh.append((lo_, hi_))
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
_KIDX = G.simplify_idx(FPUV, P.get('detail', {}).get('kinkDeg', 5.0), P.get('detail', {}).get('minEdgeM', 0.05))
FPS = [FPUV[k] for k in _KIDX]
# 去掉的小折角若是阴折（原顶点落在弦内侧），弦会鼓出 footprint：该边墙线多收同样的量，墙仍在 footprint − wallInset 内
_WDS = [WALLI + d for d in G.chord_bulge(FPUV, _KIDX)]
if P.get('preset'):                  # wave7 B：近共线（< 15°）两边内缩量不同时交点会沿边飞出——链上统一取大值
    for _ in range(len(_WDS)):
        ch = False
        for i in range(len(FPS)):
            if abs(G.turn_deg(FPS[i - 1], FPS[i], FPS[(i + 1) % len(FPS)])) < 15.0 and abs(_WDS[i - 1] - _WDS[i]) > 1e-9:
                _WDS[i - 1] = _WDS[i] = max(_WDS[i - 1], _WDS[i])
                ch = True
        if not ch:
            break
WALL = G.offset_edges(FPS, _WDS)
# 共享段检出距离：墙线离 footprint 边 ≤ 该值即认作贴共享边（预设楼墙线含弦鼓补偿，放宽到实际最大内缩 + 0.6）
# 共享段检出距离：墙线离该段所在 footprint 边的实际内缩 + 0.6（预设楼墙线含弦鼓补偿；逐段取，不取全局最大——否则凹口里
# 平行于共享边、离它一两米的内墙也会被当成共享段，整面白墙不出檐）
if P.get('preset'):
    _nk = len(_KIDX)
    for e in SHARED:
        for j in range(_nk):
            k0, k1 = _KIDX[j], _KIDX[(j + 1) % _nk]
            if (k0 <= e['edge'] < k1) if k0 < k1 else (e['edge'] >= k0 or e['edge'] < k1):
                e['det'] = _WDS[j] + 0.6
                break
if os.environ.get('BTK_DEBUG'):
    print('WALLDBG', [[round(O.x + p[0] * du.x + p[1] * dv.x, 2), round(O.y + p[0] * du.y + p[1] * dv.y, 2)] for p in WALL], [round(x, 2) for x in _WDS])
_ENV14 = G.offset_edges(FPS, -1.35)
_ENV17 = G.offset_edges(FPS, -1.70)
def env_test(pt):
    """test1a 同口径（各边法线外 ≤ 1.4；离 footprint 顶点 3 m 内 ≤ 1.75），各留 5 cm，另加共享边规则。"""
    if crosses_shared(pt, 0.35):                       # 主屋面檐口离共享边线 ≥ 0.35 m（test16b 口径 0.30）
        return False
    if G.point_in(_ENV14, pt):
        return True
    return G.point_in(_ENV17, pt) and min(math.hypot(pt[0] - q[0], pt[1] - q[1]) for q in FPUV) <= 2.95
DIRS = G.edge_dirs(FPS) if (P.get('roof') or {}).get('multiFrame') else [0.0]    # wave7 B：多方向矩形（非正交 footprint）

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

ROOF_FIT = P.get('roofFit', SHARED_GUARD)             # wave7 B1：主屋面矩形按出檐包络 + 共享边规则收（预设楼）
def _main_fit(b, r, ang=0.0):
    if not ROOF_FIT or r is None:
        return r
    ek_ = dict(EKP0); ek_.update(b['roof'].get('eaveKit', {}))
    return rect_fit(r, ek_['over'], ek_['chu'], env_test, ang=ang) or r

def _best_rect(b, poly, extra_holes=()):
    """主屋面 / 裙楼矩形：multiFrame（预设楼）时在各长边方向系里找最大内接矩形，否则前街系。返回 (ang, rect)。"""
    if not b['roof'].get('multiFrame'):
        return 0.0, G.inscribed_rect(poly, cell=0.25, keepout=tower_keepout(b['roof'].get('towerClearM', 1.0)) if TOWER else [])
    holes = list(extra_holes)
    if TOWER:
        holes.append(G.ccw(G.offset_edges(TOWER['poly'], -b['roof'].get('towerClearM', 1.0))))
    R = G.rect_cover_dirs(poly, holes=holes, dirs=DIRS, cell=0.25, min_side=3.0, max_n=1, min_area=0.0)
    return R[0] if R else (0.0, None)

for b in BLOCKS:
    plans = []                                            # 未让塔的平面（底层店面 / 腰廊用）
    cur = b['base']
    # wave7 B1 裙楼：平面里能放下的最大矩形占比 < massing.podium.rectShareBelow 时（凹角多、非正交的碎平面），
    # 二层起全部落在这个矩形上（一层裙楼满铺 footprint，裙楼顶一圈附属屋面 / 披檐），不再逐层跟着碎平面走、在顶层才收
    b['podium'] = None
    pod = MS.get('podium')
    if pod and b['N'] >= 2:
        _ov = b['roof'].get('eaveKit', {}).get('over', EKP0['over'])
        _a0, _r0 = _best_rect(b, shared_keepout_poly(b['base'], _ov + EKP0['chu'] - WALLI + 0.1))
        _r0 = _main_fit(b, _r0, _a0)
        if _r0:
            share = (_r0[1] - _r0[0]) * (_r0[3] - _r0[2]) / G.area_centroid(b['base'])[2]
            b['rectShare'] = round(share, 3)
            if share < pod.get('rectShareBelow', 0.6):
                b['podium'] = _r0
                b['podiumAng'] = _a0
    for k in range(1, b['N'] + 1):
        if b['podium'] and k >= pod.get('fromStorey', 2):
            plans.append(G.frame_poly(b['podiumAng'], b['podium']))
            continue
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
    b['roofAng'] = 0.0
    ov = b['roof'].get('eaveKit', {}).get('over', EKP0['over'])
    if b['topPlan'] == 'rect':
        src = shared_keepout_poly(plans[-1], ov + EKP0['chu'] - WALLI + 0.1)
        keep = tower_keepout(b['roof'].get('towerClearM', 1.0)) if (TOWER and TOWER['block'] is b) else []
        vmax = (min(q[1] for q in src) + 0.5) if b['roof'].get('rectAnchor') == 'front' else None
        if b['podium']:
            ang, r = b['podiumAng'], b['podium']
        elif b['roof'].get('multiFrame'):
            ang, r = _best_rect(b, src)
            r = _main_fit(b, r, ang)
        else:
            ang, r = 0.0, _main_fit(b, G.inscribed_rect(src, cell=0.25, keepout=keep, v0_max=vmax))
        plans[-1] = G.frame_poly(ang, r) if ang else G.rect_poly(r)
        b['roofRect'] = r
        b['roofAng'] = ang
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
            b['roofRect'] = _main_fit(b, G.inscribed_rect(shared_keepout_poly(top, ov + EKP0['chu'] - WALLI + 0.1), cell=0.25,
                                             keepout=tower_keepout(b['roof'].get('towerClearM', 1.0)) if TOWER else []))

# ---- 附属坡屋面（wave7 K0）：退台 / 顶层矩形以外露出的平屋面，改铺若干座低一级的小歇山 ----
# 规则（params roof.annex，缺省关 = 原输出）：每个「本层平面 ≠ 上一层平面」的楼层 k，露台区 = 第 k 层平面
# − 第 k+1 层平面（上层墙线）− 角塔（外扩 towerClearM）；共享边一侧内收同主屋面（檐口不越共享边）。露台区用
# plan2d.rect_cover 贪心铺轴向矩形，每个矩形一座歇山，檐口标高 = 第 k 层层顶（与该层腰檐同高，腰檐在这些段断开、
# 端头收口，由附属屋面自己出檐）。正脊平行于它贴着的上层墙（坡面对着上层墙落下，交线藏在上层檐下）；
# 脊高 = min(ridgeFrac × 进深, 上层层高 − underUpperEaveM)，附属屋面始终低于上一层的檐口。
ANNEX = []
for b in BLOCKS:
    b['annex'] = []
    an = b['roof'].get('annex')
    if not an or not an.get('enabled', True):
        continue
    if not EAVE_END_CAP:
        raise SystemExit('roof.annex needs sharedEdgeEaveEnd=endcap (waist eaves break where an annex roof takes over)')
    aek = dict(EKP0)
    aek.update(an.get('eaveKit', {}))
    for k in range(1, b['N']):
        lower, upper = b['plansN'][k - 1], b['plansN'][k]
        if upper == lower:
            continue
        src = shared_keepout_poly(lower, aek['over'] + aek['chu'] - WALLI + 0.1)
        holes = [G.ccw(upper)]
        if TOWER and TOWER['block'] is b:
            holes.append(G.ccw(G.offset_edges(TOWER['poly'], -an.get('towerClearM', 1.0))))
        MF = b['roof'].get('multiFrame')
        if MF:                                            # wave7 B：多方向矩形（斜翼落在自己方向的附属歇山里）
            rects_a = G.rect_cover_dirs(src, holes=holes, dirs=DIRS, cell=an.get('cellM', 0.25), min_side=an.get('minSideM', 3.0),
                                        max_n=an.get('maxRoofs', 4), min_area=an.get('minAreaM2', 12.0))
            rects = []
        else:
            rects = G.rect_cover(src, holes=holes, cell=an.get('cellM', 0.25), min_side=an.get('minSideM', 3.0),
                                 max_n=an.get('maxRoofs', 4), min_area=an.get('minAreaM2', 12.0))
        # 出檐包络：附属屋面的檐口 / 翼角（矩形外 over、角上再 chu 斜出）不得出 footprint 各边 1.35 m（test1a 1.4 留 5 cm）；
        # 斜边（非正交 footprint）处翼角会探出，矩形向内收 0.25 m 一步直到四角翼角与四边檐口中点都在包络内
        ENV = G.offset_edges(FPS, -1.35)
        def _env_ok(r_):
            u0, u1, v0, v1 = r_
            e, c = aek['over'], aek['over'] + aek['chu']
            pts = [(u0 - c, v0 - c), (u1 + c, v0 - c), (u1 + c, v1 + c), (u0 - c, v1 + c),
                   ((u0 + u1) / 2, v0 - e), ((u0 + u1) / 2, v1 + e), (u0 - e, (v0 + v1) / 2), (u1 + e, (v0 + v1) / 2)]
            return [i for i, q in enumerate(pts) if not G.point_in(ENV, q)]
        fixed = []
        if os.environ.get('BTK_DEBUG'):
            print('ANNEXDBG', k, 'rects', [[round(x, 2) for x in r_] for r_ in rects])
        if SHARED_GUARD:                                  # wave7 B：再加共享边规则（rect_fit 同一套探针）
            _g = lambda q: G.point_in(ENV, q) and not crosses_shared(q)
            rects = [x for x in (rect_fit(r_, aek['over'], aek['chu'], _g, min_side=an.get('minSideM', 3.0)) for r_ in rects) if x]
        for r_ in rects:
            r_ = list(r_)
            for _ in range(40):
                bad = _env_ok(r_)
                if not bad:
                    break
                for i in bad:                             # 角 i：0 (u0,v0) 1 (u1,v0) 2 (u1,v1) 3 (u0,v1)；中点 4 v0 5 v1 6 u0 7 u1
                    if i in (0, 3, 6): r_[0] += 0.25
                    if i in (1, 2, 7): r_[1] -= 0.25
                    if i in (0, 1, 4): r_[2] += 0.25
                    if i in (2, 3, 5): r_[3] -= 0.25
            if not _env_ok(r_) and r_[1] - r_[0] >= an.get('minSideM', 3.0) and r_[3] - r_[2] >= an.get('minSideM', 3.0):
                fixed.append(tuple(r_))
        rects = [(0.0, r_) for r_ in fixed]
        if MF:
            _g = lambda q: G.point_in(ENV, q) and not crosses_shared(q, 0.35)
            for ang_, r_ in rects_a:
                x = rect_fit(r_, aek['over'], aek['chu'], _g, min_side=an.get('minSideM', 3.0), ang=ang_)
                if x:
                    rects.append((ang_, x))
        for ri, (ang_, r) in enumerate(rects):
            u0, u1, v0, v1 = r
            # 贴着上层墙的边（该边中线向外 0.4 m 落在上层平面内）→ 正脊平行于它；都不贴 → 沿长边
            touch = {}
            for side, mid, out in (('v0', ((u0 + u1) / 2, v0), (0, -1)), ('v1', ((u0 + u1) / 2, v1), (0, 1)),
                                   ('u0', (u0, (v0 + v1) / 2), (-1, 0)), ('u1', (u1, (v0 + v1) / 2), (1, 0))):
                probe = G.frame_to_uv(ang_, (mid[0] + out[0] * 0.4, mid[1] + out[1] * 0.4))
                if G.point_in(holes[0], probe):
                    touch[side] = (u1 - u0) if side[0] == 'v' else (v1 - v0)
            if touch:
                s_ = max(touch, key=touch.get)
                along_u = s_[0] == 'v'
            else:
                along_u = (u1 - u0) >= (v1 - v0)
            dep = (v1 - v0) if along_u else (u1 - u0)
            ln = (u1 - u0) if along_u else (v1 - v0)
            cap = b['heights'][k] - an.get('underUpperEaveM', 0.3)
            rz = min(an.get('ridgeFrac', 0.36) * dep, cap)
            ANNEX.append({'block': b['name'], 'storey': k, 'rect': r, 'ang': ang_, 'alongU': along_u, 'touch': sorted(touch),
                          'z': b['ZT'][k], 'ridgeAbove': rz, 'breakAbove': rz * an.get('breakFrac', 0.55),
                          'depth': dep, 'length': ln, 'gableInset': min(an.get('gableInsetM', 1.2), 0.12 * ln),
                          'eaveKit': aek, 'breakInsetFrac': an.get('breakInsetFrac', 0.36),
                          # 下檐抬高（脊高不变）：檐口 = 层顶 + lift − drop 高过本层墙顶 / 露台板面，
                          # 露台与墙顶不会从附属屋面檐口一带的瓦面里露出来
                          'lift': an.get('eaveLiftM', aek['drop'] + 0.1)})
            b['annex'].append(ANNEX[-1])

def _ray_hit(p, d, polys):
    """p 沿单位向量 d 的射线与若干多边形边界的最近交点距离（无交点 None）。"""
    best = None
    for poly in polys:
        n_ = len(poly)
        for i in range(n_):
            a_, b_ = poly[i], poly[(i + 1) % n_]
            ex, ey = b_[0] - a_[0], b_[1] - a_[1]
            den = d[0] * ey - d[1] * ex
            if abs(den) < 1e-12:
                continue
            tt = ((a_[0] - p[0]) * ey - (a_[1] - p[1]) * ex) / den
            uu = ((a_[0] - p[0]) * d[1] - (a_[1] - p[1]) * d[0]) / den
            if tt > 1e-6 and -1e-9 <= uu <= 1 + 1e-9 and (best is None or tt < best):
                best = tt
    return best

# ---- 披檐（wave7 K0）：附属歇山铺不下的窄露台（上层墙与本层墙之间 0.25–leanTo.maxM 宽的条 / 楔形，多因 footprint 边
# 不正交而顶层是轴向矩形），腰檐的根从本层墙线移到上层墙（或角塔墙）根：一片单坡瓦面从上层墙根落到本层檐口，檐口外伸
# 同腰檐。逐墙线取样（0.5 m）：向内射线先碰到上层平面 / 角塔（而不是附属屋面）且距离在范围内的样点连成段；
# 相邻两边的段在阳角处用斜接檐角 + 上层墙角连成一个小戗角。共享边上不做披檐（那里做封火墙压顶，见下）。
# ---- 封火墙压顶（wave7 K0）：共享边一侧上层后退、露出露台的段，本层墙向上接 parapetHM 高的封火墙，顶上两坡瓦压顶，
# 压顶外缘止于 footprint 边线内 0.02 m（不越共享边），俯视把墙线与墙外 wallInset 空隙都盖住。
LEAN, PARAPET = [], []
for b in BLOCKS:
    an = b['roof'].get('annex')
    if not an or not an.get('enabled', True):
        continue
    aek = dict(EKP0)
    aek.update(an.get('eaveKit', {}))
    lt = an.get('leanTo', {})
    wmax = lt.get('maxM', 4.5)
    for k in range(1, b['N']):
        if b['plansN'][k] == b['plansN'][k - 1]:
            continue
        lower, upper = G.ccw(b['plansN'][k - 1]), G.ccw(b['plansN'][k])
        ups = [upper]
        if TOWER and TOWER['block'] is b:
            ups.append(G.ccw(TOWER['poly']))
        anx = [G.frame_poly(a.get('ang', 0.0), a['rect']) for a in ANNEX if a['block'] == b['name'] and a['storey'] == k]
        n_ = len(lower)
        for i in range(n_):
            a_, b_ = lower[i], lower[(i + 1) % n_]
            L, t, nn = G.edge_frame(a_, b_)
            if L < 0.5:
                continue
            segs = classify(a_, b_, near_max=0.8)
            if os.environ.get('BTK_DEBUG'):
                print('LEANDBG', k, i, [round(x, 2) for x in a_], [round(x, 2) for x in b_], [(round(x0, 2), round(x1, 2), r_) for x0, x1, r_, _ in segs])
            m_ = max(2, int(math.ceil(L / 0.5)))
            samp, par, slean = [], [], []
            for j in range(m_ + 1):
                s = L * j / m_
                sm = min(max(s, 0.05), L - 0.05)
                role = next((r for s0, s1, r, _ in segs if s0 - 1e-6 <= sm <= s1 + 1e-6), 'plain')
                d = (-nn[0], -nn[1])
                sp = min(max(s, 0.02), L - 0.02)                  # 射线起点离角点 2 cm（不落在相邻边上）
                p2 = (a_[0] + t[0] * sp + d[0] * 0.02, a_[1] + t[1] * sp + d[1] * 0.02)
                wu = _ray_hit(p2, d, ups[:1])
                wt = _ray_hit(p2, d, ups[1:]) if len(ups) > 1 else None
                lim = wmax
                if wt is not None and (wu is None or wt < wu):          # 先碰到角塔：披檐靠塔身，许更宽（towerMaxM）
                    wu, lim = wt, lt.get('towerMaxM', wmax)
                wa = _ray_hit(p2, d, anx) if anx else None
                exposed = wu is not None and wu + 0.02 > 0.25 and (wa is None or wa > wu)
                if any(G.point_in(q, p2) for q in ups):             # 起点已在上层 / 塔身里（塔正面贴本层墙线）：不是露台
                    exposed = False
                if role == 'shared':
                    # 封火墙：墙线内 0.5 m 不在上层 / 塔身里就做（前方是附属屋面也做——附属屋面檐口按共享边规则退开，中间一条要压顶盖住）
                    pin = (p2[0] + d[0] * 0.5, p2[1] + d[1] * 0.5)
                    par.append((s, not any(G.point_in(q, pin) for q in ups) if SHARED_GUARD else exposed))
                    samp.append((s, None))
                    # wave7 B：共享边一侧的露台也铺披檐——单坡从上层墙根落向封火墙，檐口止于 footprint 边线内 0.08 m（不越共享边）
                    slean.append((s, wu + 0.02 if lt.get('sharedLean') and exposed and wu + 0.02 <= lim else None))
                    continue
                slean.append((s, None))
                if SHARED_GUARD and crosses_shared((a_[0] + t[0] * sp + nn[0] * (aek['over'] + aek['chu']),
                                                      a_[1] + t[1] * sp + nn[1] * (aek['over'] + aek['chu']))):
                    samp.append((s, None))                 # wave7 B：檐口会越过共享边 / 插进邻栋的样点不做披檐
                else:
                    samp.append((s, wu + 0.02 if exposed and wu + 0.02 <= lim else None))
            # 连续样点成段；段端离边端 < 1.0 m 的并到边端（与腰檐断开的并端规则一致）
            for src_, dst in ((samp, 'lean'), (par, 'par'), (slean, 'slean')):
                runs, cur = [], []
                for s, w in src_:
                    if (w is not None and w is not False):
                        cur.append((s, w))
                    elif cur:
                        runs.append(cur)
                        cur = []
                if cur:
                    runs.append(cur)
                for r in runs:
                    if len(r) < 2:
                        continue
                    _ovg = aek['over'] + aek['chu']
                    _okend = lambda s_: dst != 'lean' or not SHARED_GUARD or not crosses_shared(
                        (a_[0] + t[0] * s_ + nn[0] * _ovg, a_[1] + t[1] * s_ + nn[1] * _ovg))
                    if 0 < r[0][0] < 1.0 and _okend(0.0):        # 并端时端点也要合共享边规则
                        r.insert(0, (0.0, r[0][1]))
                    if L - 1.0 < r[-1][0] < L and _okend(L):
                        r.append((L, r[-1][1]))
                    if dst == 'par':
                        PARAPET.append({'block': b['name'], 'storey': k, 'z': b['ZT'][k], 'edge': i, 'a': a_, 't': t, 'n': nn,
                                        's0': r[0][0], 's1': r[-1][0], 'h': lt.get('parapetHM', 0.9)})
                        continue
                    LEAN.append({'block': b['name'], 'storey': k, 'z': b['ZT'][k], 'edge': i, 'a': a_, 't': t, 'n': nn, 'L': L,
                                 'samples': r, 'nEdges': n_,
                                 'rise': max(lt.get('minRiseM', 0.6), min(b['heights'][k] - lt.get('underUpperM', 1.2),
                                             math.tan(math.radians(lt.get('pitchDeg', 16.0))) * (max(w for _, w in r) + aek['over']))),
                                 'eaveKit': aek, 'lift': lt.get('eaveLiftM', aek['drop'] + 0.1),
                                 'over': -(WT + 0.02) if dst == 'slean' else aek['over']})

# ---- 顶层封火墙（wave7 B，预设楼）：顶层墙线贴共享边的段，墙上接 parapetTopHM 高的封火墙 + 瓦压顶（外缘 footprint 边线内
# 0.02 m）。主屋面矩形按共享边规则退进后，墙顶与墙外 wallInset 空隙在俯视里原是一条平带 / 空带，压顶把它盖住（同 hall-kit
# 共享边一侧收山墙的读法）。
if SHARED_GUARD:
    for b in BLOCKS:
        an = b['roof'].get('annex') or {}
        hp = (an.get('leanTo') or {}).get('parapetTopHM')
        if not hp:
            continue
        top = G.ccw(b['plansN'][-1])
        for i in range(len(top)):
            a_, b_ = top[i], top[(i + 1) % len(top)]
            L, t, nn = G.edge_frame(a_, b_)
            if L < 0.5:
                continue
            for s0, s1, role, st in classify(a_, b_, near_max=0.8, shared_margin=0.05):
                if role == 'shared' and s1 - s0 >= 0.3:
                    PARAPET.append({'block': b['name'], 'storey': b['N'], 'z': b['ZT'][-1], 'edge': i, 'a': a_, 't': t, 'n': nn,
                                    's0': s0, 's1': s1, 'h': hp, 'top': True})

# ---- 补缝坡面（wave7 B，预设楼）：附属歇山与披檐都铺不到的露台残块（多在非正交 footprint 的楔形角里），按 0.5 m 格
# 铺一片连续瓦面：格角高度 = 檐口标高 + rise × 离本层墙线 /（离本层墙线 + 离上层墙 / 塔 / 附属屋面），从上层一侧落向本层墙线
FILL = []
if SHARED_GUARD:
    for b in BLOCKS:
        an = b['roof'].get('annex') or {}
        fcfg = an.get('fill')
        if not an.get('enabled', False) or not fcfg:
            continue
        aek = dict(EKP0); aek.update(an.get('eaveKit', {}))
        for k in range(1, b['N']):
            if b['plansN'][k] == b['plansN'][k - 1]:
                continue
            lower, upper = G.ccw(b['plansN'][k - 1]), G.ccw(b['plansN'][k])
            highs = [upper] + ([G.ccw(TOWER['poly'])] if TOWER and TOWER['block'] is b else [])
            highs += [G.frame_poly(a.get('ang', 0.0), a['rect']) for a in ANNEX if a['block'] == b['name'] and a['storey'] == k]
            leans = []
            for r in LEAN:
                if r['block'] == b['name'] and r['storey'] == k:
                    Pp = [(r['a'][0] + r['t'][0] * s_, r['a'][1] + r['t'][1] * s_) for s_, _ in r['samples']]
                    Rr = [(q[0] - r['n'][0] * (w + 0.05), q[1] - r['n'][1] * (w + 0.05)) for q, (_, w) in zip(Pp, r['samples'])]
                    leans.append(Pp + Rr[::-1])
            cs = fcfg.get('cellM', 0.5)
            us = [q[0] for q in lower]; vs = [q[1] for q in lower]
            nu, nv = int(math.ceil((max(us) - min(us)) / cs)), int(math.ceil((max(vs) - min(vs)) / cs))
            cells = set()
            for j in range(nv):
                for i in range(nu):
                    c = (min(us) + (i + 0.5) * cs, min(vs) + (j + 0.5) * cs)
                    if not G.point_in(lower, c) or any(G.point_in(h, c) for h in highs) or any(G.point_in(q, c) for q in leans):
                        continue
                    if crosses_shared(c, 0.75):             # 共享边一侧留给封火墙压顶（瓦面离共享边线 ≥ 0.3 m）
                        continue
                    cells.add((i, j))
            if len(cells) * cs * cs < fcfg.get('minAreaM2', 1.0):
                continue
            FILL.append({'block': b['name'], 'storey': k, 'z': b['ZT'][k] + an.get('eaveLiftM', 0.4) - aek['drop'],
                         'rise': fcfg.get('riseM', 0.8), 'cells': sorted(cells), 'cs': cs, 'u0': min(us), 'v0': min(vs),
                         'lower': lower, 'highs': highs})

def build_fill(f, tag):
    cs, u0, v0 = f['cs'], f['u0'], f['v0']
    hcache = {}
    def h_at(i, j):
        if (i, j) not in hcache:
            c = (u0 + i * cs, v0 + j * cs)
            dl = G.dist_to_boundary(f['lower'], c)
            dh = min(G.dist_to_boundary(h, c) for h in f['highs']) if f['highs'] else 99.0
            hcache[(i, j)] = f['z'] + f['rise'] * dl / max(1e-6, dl + dh)
        return hcache[(i, j)]
    items, faces, idx = [], [], {}
    def vid(i, j):
        if (i, j) not in idx:
            idx[(i, j)] = len(items)
            u, v = u0 + i * cs, v0 + j * cs
            items.append(((u, v, h_at(i, j)), (u / 1.4, v / 1.2)))
        return idx[(i, j)]
    for (i, j) in f['cells']:
        q = [vid(i, j), vid(i + 1, j), vid(i + 1, j + 1), vid(i, j + 1)]
        pts = [items[x][0] for x in q]
        faces.append(_oface(pts, (0, 1, 2, 3), (0, 0, 1)))
        faces[-1] = tuple(q[x] for x in faces[-1])
    _ADDR('fill-' + tag, items, faces, 'roof', 'roof-fill')

def lean_cover(z, block_name, edge, s):
    """该块该标高的第 edge 条墙线（CCW 序）上 s 处是否归披檐（腰檐该处断开）。"""
    for r in LEAN:
        if r['block'] == block_name and abs(r['z'] - z) < 1e-6 and r['edge'] == edge and \
                r['samples'][0][0] - 1e-6 <= s <= r['samples'][-1][0] + 1e-6:
            return True
    return False

def annex_cover(pt, z, block_name, probe_in=1.0):
    """墙线上一点（局部 u,v）向内 probe_in 处是否落在同块同标高的附属屋面矩形里（腰檐该处断开）。"""
    for a in ANNEX:
        if a['block'] != block_name or abs(a['z'] - z) > 1e-6:
            continue
        u0, u1, v0, v1 = a['rect']
        q = G.uv_to_frame(a.get('ang', 0.0), pt)
        if u0 - 1e-6 <= q[0] <= u1 + 1e-6 and v0 - 1e-6 <= q[1] <= v1 + 1e-6:
            return True
    return False

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

class CapList(list):
    ovs = None
    nolift = None

def ring_with_pulls(poly, z, over_total, owner, ek_over=None):
    """檐口环：共享段（hall-kit 规则）与被其他体积挡住的段内收 over_total（檐口外缘不越边线），段端做直角回折。"""
    poly = G.ccw(poly)
    n = len(poly)
    if ek_over is None:
        ek_over = over_total
    subs = []                                  # 每边 [(s0, s1, d)]
    any_pull = False
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        L, t, nn = G.edge_frame(a, b)
        pulls = []
        if SHARED_RULE:
            # 内收做法要给翼角出翘让位（外扩 over+chu+墙厚+0.5）；端头收口在段端不起翘不出翘，只让 0.05 m，端面贴着邻栋侧墙
            for s0, s1, role, st in classify(a, b, near_max=0.8, shared_margin=0.05 if EAVE_END_CAP else over_total + WALLI + 0.5):
                if role == 'shared':
                    pulls.append((s0, s1))
        if CLIP_HIDDEN:
            k = max(1, int(math.ceil(L / 0.5)))
            for j in range(k):
                s = L * (j + 0.5) / k
                po = (a[0] + t[0] * s + nn[0] * 0.8, a[1] + t[1] * s + nn[1] * 0.8)
                if inside_other(po, z + 0.3, owner) and not in_tower(po, z):
                    pulls.append((max(0.0, L * j / k - 0.3), min(L, L * (j + 1) / k + 0.3)))
        if SHARED_GUARD and EAVE_END_CAP:       # wave7 B：短檐（0.45 + chu）也会越过共享边 / 插进邻栋的样段断檐收口
            k = max(1, int(math.ceil(L / 0.5)))
            for j in range(k + 1):
                s = min(L, L * j / k)
                lip = (a[0] + t[0] * s + nn[0] * (over_total - ek_over + 0.45), a[1] + t[1] * s + nn[1] * (over_total - ek_over + 0.45))
                if crosses_shared(lip):
                    pulls.append((max(0.0, L * (j - 0.5) / k), min(L, L * (j + 0.5) / k)))
        if ANNEX or LEAN:                        # wave7 K0：附属屋面 / 披檐接管的段（墙线向内 1.0 m 落在附属屋面矩形里，或归披檐）腰檐断开
            k = max(1, int(math.ceil(L / 0.5)))
            for j in range(k):
                s = L * (j + 0.5) / k
                pi_ = (a[0] + t[0] * s - nn[0] * 1.0, a[1] + t[1] * s - nn[1] * 1.0)
                if annex_cover(pi_, z, owner) or lean_cover(z, owner, i, s):
                    pulls.append((L * j / k, L * (j + 1) / k))
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
    if EAVE_END_CAP:
        # 端头收口：环 = 墙线本身，子段分界处插点；内收子段对应的环边整段交给 eave_kit endCaps（不出檐、两端补端面）
        ring, caps = [], CapList()
        ovs = []
        for i in range(n):
            a = poly[i]
            L, t, nn = G.edge_frame(a, poly[(i + 1) % n])
            for s0, s1, d in subs[i]:
                ring.append((a[0] + t[0] * s0, a[1] + t[1] * s0))
                ov_ = ek_over
                if SHARED_GUARD and d <= 0:           # wave7 B：出檐按共享边规则逐段取最大可行值（0.45 m 起），不再整段断开
                    m_ = max(2, int(math.ceil((s1 - s0) / 0.5)))
                    for cand in (ek_over, 1.0, 0.7, 0.45):
                        if cand > ek_over:
                            continue
                        ext = cand + (over_total - ek_over)
                        if not any(crosses_shared((a[0] + t[0] * (s0 + (s1 - s0) * j / m_) + nn[0] * ext,
                                                   a[1] + t[1] * (s0 + (s1 - s0) * j / m_) + nn[1] * ext)) for j in range(m_ + 1)):
                            ov_ = cand
                            break
                    else:
                        d = 1.0
                caps.append(d > 0)
                ovs.append(ov_)
        if SHARED_GUARD and any(abs(o - ek_over) > 1e-9 for o in ovs):
            caps.ovs = ovs
        if SHARED_GUARD:                          # wave7 B：小折角（< 10°，预设楼 kinkDeg 调小后墙线贴着 footprint 走）不起翘
            m_ = len(ring)
            caps.nolift = [abs(G.turn_deg(ring[i - 1], ring[i], ring[(i + 1) % m_])) < 10.0 for i in range(m_)]
        return ring, caps
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

def _oface(pts, face, want):
    """按期望朝向 want（局部 u,v,h）定面序（右手：(b-a)×(c-a) 为法线）；配合 _ek_add() 的镜像修正写入。"""
    a, b, c = (pts[i] for i in face[:3])
    e1 = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    e2 = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
    nrm = (e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0])
    return tuple(face) if sum(x * y for x, y in zip(nrm, want)) >= 0 else (face[0],) + tuple(reversed(face[1:]))

_ADDR = _ek_add()
def _emit(name, pts, uvs, faces_want, m, part):
    items = [(p, uv) for p, uv in zip(pts, uvs)]
    _ADDR(name, items, [_oface(pts, f, w) for f, w in faces_want], m, part)

def ridge_cap(name, rect, RP, conv, part):
    """wave7 B（预设楼）：eave_kit 歇山正脊中段顶面是水平的（俯视算平面）；在中段加一道 ∧ 形脊帽（约 27°，同色），
    两端吻起翘段不动。rect / conv 与该歇山调用 eave_kit 时相同（conv：歇山局部 → 本套件 u,v）。"""
    u0, u1, v0, v1 = rect
    osc = EK.ornament_scale(RP, v1 - v0)
    bu0, bu1 = u0 + RP['breakInset'], u1 - RP['breakInset']
    gu0, gu1 = bu0 + RP['gableInset'], bu1 - RP['gableInset']
    vc = (v0 + v1) / 2
    wr, hr = 0.28 * osc, 0.42 * osc
    a0, a1 = gu0 + 2.5 * osc, gu1 - 2.5 * osc
    if a1 - a0 < 0.5:
        return
    zt = RP['ridgeZ'] - 0.05 + hr
    loc = [(a0, vc - wr - 0.01, zt - 0.005), (a1, vc - wr - 0.01, zt - 0.005), (a1, vc, zt + 0.15 * osc), (a0, vc, zt + 0.15 * osc),
           (a0, vc + wr + 0.01, zt - 0.005), (a1, vc + wr + 0.01, zt - 0.005)]
    pts = [(*conv(p[0], p[1]), p[2]) for p in loc]
    uvs = [(0, 0), (a1 - a0, 0), (a1 - a0, 0.3), (0, 0.3), (0, 0), (a1 - a0, 0)]
    _emit(name + '-ridgecap', pts, uvs, [((0, 1, 2, 3), (0, 0, 1)), ((3, 2, 5, 4), (0, 0, 1))], 'dark', part)

def build_lean(r, runs, tag):
    """披檐一段：瓦面（上层墙根 → 檐口）+ 瓦头 + 封檐板 + 檐底（檐口 → 本层墙线），阳角与相邻段斜接成小戗角，开口端封山墙。"""
    z, ek = r['z'], r['eaveKit']
    drop, tH, bH, over = ek['drop'], ek['tileH'], ek['boardH'], r.get('over', ek['over'])
    zl = z + r['lift'] - drop
    zr = zl + r['rise']
    a, t, n, L = r['a'], r['t'], r['n'], r['L']
    P = [(a[0] + t[0] * s, a[1] + t[1] * s) for s, _ in r['samples']]
    R = [(p[0] - n[0] * (w + 0.05), p[1] - n[1] * (w + 0.05)) for p, (_, w) in zip(P, r['samples'])]
    Q = [(p[0] + n[0] * over, p[1] + n[1] * over) for p in P]
    ne = r['nEdges']
    ov_r = r.get('over', ek['over'])
    # 相邻段只在出檐相同（同为普通披檐 / 同为封火墙披檐）时斜接；混接处各自开口封山（wave7 B）
    nxt = next((q for q in runs if q['storey'] == r['storey'] and q['edge'] == (r['edge'] + 1) % ne and q['samples'][0][0] < 1e-6
                and abs(q.get('over', ek['over']) - ov_r) < 1e-6), None) if r['samples'][-1][0] > L - 1e-6 else None
    prv = next((q for q in runs if q['storey'] == r['storey'] and q['edge'] == (r['edge'] - 1) % ne and q['samples'][-1][0] > q['L'] - 1e-6
                and abs(q.get('over', ek['over']) - ov_r) < 1e-6), None) if r['samples'][0][0] < 1e-6 else None
    def miter(e0, e1):
        c = (e0['a'][0] + e0['t'][0] * e0['L'], e0['a'][1] + e0['t'][1] * e0['L'])
        x = G._line_x((c[0] + e0['n'][0] * over, c[1] + e0['n'][1] * over), e0['t'],
                      (c[0] + e1['n'][0] * over, c[1] + e1['n'][1] * over), e1['t'])
        return x or (c[0] + e0['n'][0] * over, c[1] + e0['n'][1] * over)
    if nxt is not None:
        Q[-1] = miter(r, nxt)
    if prv is not None:
        Q[0] = miter(prv, r)
    m = len(P)
    def ztile(i):                                         # 墙线处瓦面高（R → Q 直线插值）
        wi = r['samples'][i][1] + 0.05
        return zl + r['rise'] * over / (wi + over)
    # 瓦面
    pts = [(q[0], q[1], zl) for q in Q] + [(p[0], p[1], zr) for p in R]
    uvs = [(r['samples'][i][0], 0.0) for i in range(m)] + [(r['samples'][i][0], r['samples'][i][1] + over) for i in range(m)]
    fw = [((i, i + 1, m + i + 1, m + i), (0, 0, 1)) for i in range(m - 1)]
    _emit('lean-tile-' + tag, pts, uvs, fw, 'roof', 'roof-lean')
    # 瓦头 / 封檐板 / 檐底
    for part_, h0, h1, mt in (('tileend', 0.0, tH, 'dark'), ('board', tH, tH + bH, ek.get('boardMaterial', 'wood'))):
        pts = [(q[0], q[1], zl - h0) for q in Q] + [(q[0], q[1], zl - h1) for q in Q]
        uvs = [(r['samples'][i][0], 0.0) for i in range(m)] + [(r['samples'][i][0], h1 - h0) for i in range(m)]
        fw = [((i, i + 1, m + i + 1, m + i), (n[0], n[1], 0)) for i in range(m - 1)]
        _emit('lean-%s-%s' % (part_, tag), pts, uvs, fw, mt, 'roof-lean')
    pts = [(q[0], q[1], zl - tH - bH) for q in Q] + [(p[0], p[1], z + ek.get('soffitRise', 0.15)) for p in P]
    uvs = [(r['samples'][i][0], 0.0) for i in range(m)] + [(r['samples'][i][0], over) for i in range(m)]
    fw = [((i, i + 1, m + i + 1, m + i), (0, 0, -1)) for i in range(m - 1)]
    _emit('lean-soffit-' + tag, pts, uvs, fw, 'dark', 'roof-lean')
    # 阳角小戗角：本段末 R、上层墙角 U、下段首 R'、斜接檐角 Qm
    if nxt is not None:
        Rn = (nxt['a'][0] - nxt['n'][0] * (nxt['samples'][0][1] + 0.05), nxt['a'][1] - nxt['n'][1] * (nxt['samples'][0][1] + 0.05))
        U = G._line_x(R[-1], t, Rn, nxt['t']) or R[-1]
        pts = [(R[-1][0], R[-1][1], zr), (U[0], U[1], zr), (Rn[0], Rn[1], zr), (Q[-1][0], Q[-1][1], zl)]
        _emit('lean-hip-' + tag, pts, [(0, 0), (1, 0), (2, 0), (1, 1)], [((0, 1, 3), (0, 0, 1)), ((1, 2, 3), (0, 0, 1))], 'roof', 'roof-lean')
    # 开口端：山墙封板（墙线以内，白墙）+ 檐头断面（深色）
    for end, i, nb in ((0, 0, prv), (1, m - 1, nxt)):
        if nb is not None:
            continue
        sgn = -1.0 if end == 0 else 1.0
        want = (t[0] * sgn, t[1] * sgn, 0)
        zp = ztile(i)
        pts = [(P[i][0], P[i][1], z), (R[i][0], R[i][1], z), (R[i][0], R[i][1], zr), (P[i][0], P[i][1], zp)]
        _emit('lean-gable-%s-%d' % (tag, end), pts, [(0, 0), (1, 0), (1, 1), (0, 1)], [((0, 1, 2, 3), want)], 'wall', 'roof-lean')
        pts = [(Q[i][0], Q[i][1], zl), (Q[i][0], Q[i][1], zl - tH - bH), (P[i][0], P[i][1], z + ek.get('soffitRise', 0.15)),
               (P[i][0], P[i][1], zp)]
        _emit('lean-end-%s-%d' % (tag, end), pts, [(0, 0), (0, 1), (1, 1), (1, 0)], [((0, 1, 2, 3), want)], 'dark', 'roof-lean')

def build_parapet(pr, tag):
    """封火墙：本层墙线上接一段墙（o ∈ [−WT, 0]），两坡瓦压顶，压顶外缘 o = wallInset − 0.02（不越 footprint 边）。"""
    a, t, n = pr['a'], pr['t'], pr['n']
    run = Run(a, (a[0] + t[0] * 100.0, a[1] + t[1] * 100.0))
    s0, s1, z, h = pr['s0'], pr['s1'], pr['z'], pr['h']
    obox('parapet-' + tag, run, s0, s1, -WT, 0.0, z, z + h, 'wall', 'parapet', bevel=0)
    oi, oo = -WT - 0.3, WALLI - 0.02
    om, ze, zm = (oi + oo) / 2, z + h - 0.02, z + h + 0.22
    P_ = lambda s, o, hh: (run.p(s, o)[0], run.p(s, o)[1], hh)
    pts = [P_(s0, oi, ze), P_(s1, oi, ze), P_(s1, om, zm), P_(s0, om, zm), P_(s0, oo, ze), P_(s1, oo, ze)]
    uvs = [(0, 0), (s1 - s0, 0), (s1 - s0, 0.5), (0, 0.5), (0, 0), (s1 - s0, 0)]
    _emit('coping-' + tag, pts, uvs, [((0, 1, 2, 3), (0, 0, 1)), ((3, 2, 5, 4), (0, 0, 1))], 'roof', 'parapet')
    pts = [P_(s0, oi, ze), P_(s0, om, zm), P_(s0, oo, ze), P_(s1, oi, ze), P_(s1, om, zm), P_(s1, oo, ze)]
    _emit('coping-end-' + tag, pts, [(0, 0)] * 6, [((0, 1, 2), (-t[0], -t[1], 0)), ((3, 4, 5), (t[0], t[1], 0))], 'dark', 'parapet')

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
        if os.environ.get('BTK_DEBUG'):
            print('GRDBG', r.tag, round(r.s0, 2), round(r.s1, 2), r.role, stl.get('style'), [round(x, 2) for x in r.p(r.s0, 0)], [round(x, 2) for x in r.p(r.s1, 0)])
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
                    # wave7 B：小折角（< 15°，预设楼 kinkDeg 调小后出现）按直线续接，不沿相邻墙线斜移（cot 会飞到几十米）
                    return -1.0 / math.tan(math.radians(th)) if abs(abs(th) - 90) > 1e-3 and abs(th) > 15.0 else 0.0
                c0 = _cot(r.turn0) if (r.s0 <= 1e-6 and e0 == 0.0) else 0.0
                c1 = _cot(r.turn1) if (r.s1 >= r.L - 1e-6 and e1 == 0.0) else 0.0
                c4 = [r.p(r.s0 + e0 + rc * c0, -rc), r.p(r.s1 - e1 - rc * c1, -rc),
                      r.p(r.s1 - e1 - (rc + WT) * c1, -rc - WT), r.p(r.s0 + e0 + (rc + WT) * c0, -rc - WT)]
                hexa('wall-%s-s%d-%d' % (bn, k, i), [(q[0], q[1], z0) for q in c4] + [(q[0], q[1], ZT[k]) for q in c4], 'wall', 'walls', bevel=0)
            else:                                                # 转角斜接：内皮按外转角收 / 伸（非直角转角不戳出相邻墙线）
                m0 = WT * math.tan(math.radians(r.turn0) / 2) if r.s0 <= 1e-6 else 0.0
                m1 = WT * math.tan(math.radians(r.turn1) / 2) if r.s1 >= r.L - 1e-6 else 0.0
                c4 = [r.p(r.s0, 0.0), r.p(r.s1, 0.0), r.p(r.s1 - m1, -WT), r.p(r.s0 + m0, -WT)]
                if os.environ.get('BTK_DEBUG') and k == 1:
                    print('WDBG', i, round(r.s0, 2), round(r.s1, 2), round(r.L, 2), round(r.turn0, 1), round(r.turn1, 1), round(m0, 2), round(m1, 2))
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
                        sh = (-rc / math.tan(math.radians(th)) if abs(th) > 15.0 else 0.0) if at_corner and abs(abs(th) - 90) > 1e-3 else 0.0
                        sg = 1.0 if end == 0 else -1.0
                        c4 = [r.p(s, 0.0), r.p(s + sg * WT, 0.0), r.p(s + sg * (WT + sh), -rc), r.p(s + sg * sh, -rc)]
                        if os.environ.get('BTK_DEBUG'):
                            print('RETDBG', i, end, round(th, 2), round(sh, 2), at_corner, [[round(x, 2) for x in q] for q in c4])
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
            if SHARED_GUARD:                                      # 小折角两侧内缩量不同时交点会飞出：预设楼核心统一内缩
                ds = [max(ds)] * len(ds)
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
        ring, pulled = ring_with_pulls(b['plansN'][k - 1], ZT[k], ek['over'] + ek['chu'] + 0.05, bn, ek_over=ek['over'])
        # 内收的环：自身体积判定要排除本块本层
        if isinstance(pulled, list) and all(pulled):   # 整圈都断开（全被附属屋面 / 共享边接管）：不出腰檐
            EAVE_LOG.append({'block': bn, 'storey': k, 'z': ZT[k], 'pulled': True, 'ringVerts': len(ring), 'endCapEdges': len(pulled)})
        elif isinstance(pulled, list):                   # EAVE_END_CAP：pulled = 逐环边「断开 + 端头收口」标记
            EK.eave_skirt('eave-%s-s%d' % (bn, k), ring, ZT[k], dict(ek, endCaps=list(pulled), **({'over': pulled.ovs} if pulled.ovs else {}),
                                                                   **({'noLift': pulled.nolift} if pulled.nolift and any(pulled.nolift) else {})), 'eaves')
            EAVE_LOG.append({'block': bn, 'storey': k, 'z': ZT[k], 'pulled': True, 'ringVerts': len(ring),
                             'endCapEdges': sum(pulled)})
        else:
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
                if SHARED_GUARD and (crosses_shared(r.p(s, 0.7)) or crosses_shared(r.p(s - 0.35, 0.7)) or crosses_shared(r.p(s + 0.35, 0.7))):
                    continue                                 # wave7 B：斗拱不探过共享边（近乎共线的共享段接头处）
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
        # wave7 B1：进深超过 roof.maxDepthM 的屋面沿进深等分成几座平行歇山（勾连搭），每座按自己的进深定脊高
        nsplit = max(1, int(math.ceil(depth / rf['maxDepthM']))) if rf.get('maxDepthM') else 1
        sdep = depth / nsplit
        if 'ridgeHeightM' in rf:
            bz, rz = rf['breakHeightM'], rf['ridgeHeightM']
        elif 'ridgeAboveFrac' in rf:                    # wave7 K1 预设：脊高按屋面进深取比例（封顶 ridgeAboveMaxM）
            # wave7 B1：再按墙顶高封顶（ridgeAboveMaxWallFrac × 墙顶），矮楼不顶大屋面
            cap = min(rf.get('ridgeAboveMaxM', 99), rf.get('ridgeAboveMaxWallFrac', 99) * ZN)
            bz = ZN + min(rf['breakAboveFrac'] * sdep, cap * 0.45)
            rz = ZN + min(rf['ridgeAboveFrac'] * sdep, cap)
        else:
            bz = ZN + rf['breakAboveM']
            rz = ZN + rf['ridgeAboveM']
        if RP.get('ornamentScale') == 'auto-h':         # wave7 B1：脊饰按进深与墙顶高取小（矮楼吻兽不过大）
            RP['ornamentScale'] = max(0.35, min(1.0, sdep / 12.0, ZN / 13.6))
        RP.update(breakZ=bz, ridgeZ=rz, breakInset=sdep / 2 * rf['breakInsetFrac'], gableInset=rf['gableInsetM'])
        b['ridgeZ'] = rz
        b['roofSplit'] = nsplit
        # wave7 K0：eaveLiftM = 下檐整体抬高（脊高不变）。xieshan 下檐在墙线处的瓦面比檐口标高低约 0.1 m，
        # 墙顶 / 外框柱顶会从瓦面里露出一条（航拍看是沿墙线的细平带）；抬 0.2 m 后墙线处瓦面高于墙顶
        ZE = ZN + rf.get('eaveLiftM', 0.0)
        ang_ = b.get('roofAng', 0.0)
        for si in range(nsplit):
            nm_ = 'roof-' + bn if nsplit == 1 else 'roof-%s-%d' % (bn, si)
            if long_u:
                if ang_:
                    ek_frame(lambda ta, tb, _a=ang_: G.frame_to_uv(_a, (ta, tb)))
                EK.xieshan_roof(nm_, (u0, u1, v0 + sdep * si, v0 + sdep * (si + 1)), ZE, RP, PART)
                if ang_:
                    ek_reset()
                if SHARED_GUARD:
                    ridge_cap(nm_, (u0, u1, v0 + sdep * si, v0 + sdep * (si + 1)), RP,
                              lambda ta, tb, _a=ang_: G.frame_to_uv(_a, (ta, tb)), PART)
            else:                                           # 纵向矩形：旋转 90°（仍右手系）让正脊沿长边
                ek_frame(lambda tu, tv, _a=ang_: G.frame_to_uv(_a, (-tv, tu)))
                EK.xieshan_roof(nm_, (v0, v1, -(u0 + sdep * (si + 1)), -(u0 + sdep * si)), ZE, RP, PART)
                ek_reset()
                if SHARED_GUARD:
                    ridge_cap(nm_, (v0, v1, -(u0 + sdep * (si + 1)), -(u0 + sdep * si)), RP,
                              lambda tu, tv, _a=ang_: G.frame_to_uv(_a, (-tv, tu)), PART)
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

    # ---- 附属坡屋面（wave7 K0，见上方 ANNEX 规则）----
    for ai, a in enumerate(b['annex']):
        PART = 'roof-annex'
        u0, u1, v0, v1 = a['rect']
        RP = dict(a['eaveKit'])
        RP.update(breakZ=a['z'] + a['breakAbove'], ridgeZ=a['z'] + a['ridgeAbove'],
                  breakInset=a['depth'] / 2 * a['breakInsetFrac'], gableInset=a['gableInset'],
                  ornamentScale=RP.get('ornamentScale', 'auto'))
        nm = 'annex-%s-s%d-%d' % (bn, a['storey'], ai)
        ang_ = a.get('ang', 0.0)
        if a['alongU']:
            if ang_:
                ek_frame(lambda ta, tb, _a=ang_: G.frame_to_uv(_a, (ta, tb)))
            EK.xieshan_roof(nm, (u0, u1, v0, v1), a['z'] + a['lift'], RP, PART)
            if ang_:
                ek_reset()
            if SHARED_GUARD:
                ridge_cap(nm, (u0, u1, v0, v1), RP, lambda ta, tb, _a=ang_: G.frame_to_uv(_a, (ta, tb)), PART)
        else:
            ek_frame(lambda tu, tv, _a=ang_: G.frame_to_uv(_a, (-tv, tu)))
            EK.xieshan_roof(nm, (v0, v1, -u1, -u0), a['z'] + a['lift'], RP, PART)
            ek_reset()
            if SHARED_GUARD:
                ridge_cap(nm, (v0, v1, -u1, -u0), RP, lambda tu, tv, _a=ang_: G.frame_to_uv(_a, (-tv, tu)), PART)

    # ---- 披檐（wave7 K0，见上方 LEAN 规则）----
    runs_b = [r for r in LEAN if r['block'] == bn]
    for li, r in enumerate(runs_b):
        build_lean(r, runs_b, '%s-%d' % (bn, li))
    for fi_, f in enumerate([q for q in FILL if q['block'] == bn]):
        build_fill(f, '%s-%d' % (bn, fi_))
    # ---- 封火墙压顶（wave7 K0，见上方 PARAPET 规则）----
    for pi_, pr in enumerate([q for q in PARAPET if q['block'] == bn]):
        build_parapet(pr, '%s-%d' % (bn, pi_))

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
           'podium': [{'block': b['name'], 'rectShare': b.get('rectShare'), 'podiumRect': b['podium']} for b in BLOCKS],
           'roofSplit': [b.get('roofSplit', 1) for b in BLOCKS],
           'roofAngDeg': [round(math.degrees(b.get('roofAng', 0.0)), 1) for b in BLOCKS],
           'annexRoofs': [{'block': a['block'], 'storey': a['storey'], 'rectUV': [round(x, 2) for x in a['rect']],
                           'ridgeAlongU': a['alongU'], 'angDeg': round(math.degrees(a.get('ang', 0.0)), 1), 'touchesUpper': a['touch'], 'eaveZ': round(a['z'], 2),
                           'ridgeZ': round(a['z'] + a['ridgeAbove'], 2), 'depthM': round(a['depth'], 2)} for a in ANNEX],
           'leanTo': [{'block': r['block'], 'storey': r['storey'], 'edge': r['edge'], 's': [round(r['samples'][0][0], 2), round(r['samples'][-1][0], 2)],
                       'widthM': [round(min(w for _, w in r['samples']), 2), round(max(w for _, w in r['samples']), 2)],
                       'riseM': round(r['rise'], 2)} for r in LEAN],
           'fillPatches': [{'block': f['block'], 'storey': f['storey'], 'areaM2': round(len(f['cells']) * f['cs'] ** 2, 1)} for f in FILL],
           'parapets': [{'block': q['block'], 'storey': q['storey'], 'edge': q['edge'], 's': [round(q['s0'], 2), round(q['s1'], 2)]} for q in PARAPET],
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
