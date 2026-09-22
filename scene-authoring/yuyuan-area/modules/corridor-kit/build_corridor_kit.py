"""园廊套件站点模块批量构建（corridor-kit）：3 园廊 + 听涛阁水廊（积玉水廊）。
数值只认 DESIGN_SPEC.json；布局沿用 baseline/layout.json 冻结线，不改布局、不移动对象。
坐标契约：layout 地图系 (x 东, z 南) + 高度 y；Blender 内部 (x, -z_map, y)，export_yup=True 后
GLB 为 Y-up 世界坐标 (x, y, z_map)，原点=地图(0,0)，无实例变换。
运行：blender --background -t 4 --python-exit-code 1 -P modules/corridor-kit/build_corridor_kit.py
     （OUT_DIR 默认 out-corridor-kit；先跑 gen_textures.py 生成漏窗贴图）
输出（OUT_DIR）：site-inputs.json（缺则从 baseline 抽取）、corridor-bld-553893874.glb、
ring-corridor-bld-428179906.glb、double-corridor-bld-428186469.glb、
waterside-gallery-bld-428179920.glb、corridor-kit-collision.json、corridor-kit-catalog.json、
corridor-kit-reimport.json
"""
import bpy, bmesh, json, math, os, time, hashlib
from mathutils import Vector

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
AREA = os.path.dirname(os.path.dirname(HERE))
OUT = os.environ.get('OUT_DIR') or os.path.join(AREA, 'out-corridor-kit')
if not os.path.isabs(OUT):
    OUT = os.path.join(AREA, OUT)
os.makedirs(OUT, exist_ok=True)

TEX_DIRS = [
    os.path.abspath(os.path.join(AREA, '..', '..', 'asset-authoring', 'yuyuan-entry', 'source-kit', 'textures')),
    '/home/baibai/work/onewonderjapan/pawborough-world/asset-authoring/yuyuan-entry/source-kit/textures',
]
TEX_DIR = next((d for d in TEX_DIRS if os.path.isdir(d)), None)
if not TEX_DIR:
    raise RuntimeError('source-kit textures not found')
# 512px 派生集（gen_textures.py 产出；色彩 JPEG / 数据图 PNG，控字节预算）
TEX512 = os.path.join(OUT, 'textures-512')

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.unit_settings.system = 'METRIC'
sc.unit_settings.scale_length = 1

# ---------------------------------------------------------------- 冻结数值（DESIGN_SPEC.json）+ 设计值
EAVE, RIDGE = 2.85, 3.55          # 檐口 / 屋脊高（spec）
COL_H = 2.55                       # 柱高到枋（spec）
FLOOR_T = 0.12                     # 石板厚，顶面 y=0.12（spec）
ROOF_T = 0.10                      # 屋面实心厚（设计值）
OVER = 0.55                        # 檐口每侧出挑（spec）
EXT = 0.35                         # 开口折线端部屋面延伸（设计值，保证端点射线命中）
MAX_SPIKE = 2.75                    # 斜接尖长上限（111° 转角尖长 2.69 可斜接；超过才用小戗角封盖，PLAN fallback 1）
INNER_SCALE = 0.28                  # 复廊内圈檐线：向质心缩放系数（小环内缘偏移 2.85 会自交，改天井式内坡）
LIP_STEP = 0.30                    # 瓦当间距（设计值）
COL_R = 0.10                       # 柱半径 Ø0.20（spec）
SEAT_T, SEAT_H = 0.10, 0.42        # 美人靠坐面厚 / 座面高（spec 0.42）
RAIL_TOP = 0.95                    # 美人靠背扶手顶（设计值）
WIN_W, WIN_H, WIN_SILL = 1.1, 0.9, 1.0   # 复廊漏窗洞口（spec）
WIN_STEP = 3.0                     # 漏窗间距（spec）
WALL_T = 0.20                      # 复廊中墙厚（设计值：2.2+2.2+0.2=4.6）
WALL_TOP = 2.55                    # 中墙顶（与柱枋同高）
PAV_TRI_BUDGET = 9000
TINT_TIMBER = '6a2e22'             # 木作染色（spec）
TINT_STONE = '9d9a92'              # 石作灰调（spec）

CFG = {
    'bld-553893874': dict(glb='corridor-bld-553893874.glb', zh='园廊', width=2.2, closed=True,
                          double=False, pavilion=False, triBudget=9000, bytesBudget=800000),
    'bld-428179906': dict(glb='ring-corridor-bld-428179906.glb', zh='园廊（环形）', width=2.2, closed=True,
                          double=False, pavilion=False, triBudget=9000, bytesBudget=800000),
    'bld-428186469': dict(glb='double-corridor-bld-428186469.glb', zh='复廊', width=2.2, closed=True,
                          double=True, pavilion=False, triBudget=13000, bytesBudget=900000),
    'bld-428179920': dict(glb='waterside-gallery-bld-428179920.glb', zh='听涛阁（积玉水廊）', width=2.6, closed=False,
                          double=False, pavilion=True, triBudget=14000, bytesBudget=900000),
}
PAV = dict(W=10.1, D=6.4, base_h=0.30, c1_top=3.05, c2_bot=4.15, c2_top=6.6,
           hip1_eave=3.05, hip1_ridge=3.58, hip2_eave=6.6, hip2_ridge=7.9)  # 亭 massing 设计值

# ---------------------------------------------------------------- site inputs（冻结布局抽取，含 sha）
LAYOUT_PATH = os.path.join(AREA, 'baseline', 'layout.json')
SITE_INPUTS = os.path.join(OUT, 'site-inputs.json')
WANT = list(CFG)
HALL_KINDS = ('hall', 'tower', 'xuan', 'pavilion', 'waterside', 'stage')
if not os.path.exists(SITE_INPUTS):
    raw = open(LAYOUT_PATH, 'rb').read()
    L = json.loads(raw)
    hints = []
    for o in L['objects']:
        fp = o.get('geometry', {}).get('footprint')
        if not fp or o.get('kind') not in HALL_KINDS + ('water',):
            continue
        hints.append({'id': o['id'], 'kind': o['kind'], 'name': o.get('name'),
                      'centroid': [sum(p[0] for p in fp) / len(fp), sum(p[1] for p in fp) / len(fp)]})
    si = {'source': 'scene-authoring/yuyuan-area/baseline/layout.json (frozen G5)',
          'layoutSha256': hashlib.sha256(raw).hexdigest(),
          'objects': {o['id']: o for o in L['objects'] if o['id'] in WANT},
          'railHints': hints}
    json.dump(si, open(SITE_INPUTS, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('extracted site-inputs.json')
SI = json.load(open(SITE_INPUTS, encoding='utf-8'))
ASSUMPTIONS = [
    '美人靠侧别逐段计算：段中点 6m 内有水面取水侧，否则背向最近厅堂；环形/闭合廊只在朝环外的面设，且该面需（6m 内水面 或 无 15m 内厅堂正对）',
    '屋顶顶点斜接尖长 >%.1f m 时该点改分段 + 小戗角封盖（PLAN fallback 1）；复廊 4.6m 宽屋面在小环内缘无法斜接，内圈檐线改为向质心缩放 %.2f 的天井式内坡，外圈仍逐顶点斜接/戗角' % (MAX_SPIKE, INNER_SCALE),
    '瓦当行距 %.2f m、方截面 0.06（spec 未给间距）；屋脊滚筒六边半径 0.06、中心 y=3.53（顶 3.59 < 3.6 射线上限）' % LIP_STEP,
    '开口折线（听涛阁）端部屋面沿方向延伸 %.2f m；亭侧端开敞接端亭，远端三角山墙封口' % EXT,
    '复廊中墙高 %.2f、厚 %.1f；漏窗 %.1fx%.1f、窗台 %.1f，洞内嵌解析 alpha 格栅；开窗沿段按 ≥%.1f m 间距布设、窗边距段端 ≥0.9 m' % (WALL_TOP, WALL_T, WIN_W, WIN_H, WIN_SILL, WIN_STEP),
    '听涛阁端亭 massing：%.1fx%.1f 台基（深为设计值）、柱网 6x4（长边每边 6 柱）、一层腰檐 3.05->%.2f（低于屋面射线上限 3.6 使水廊射线连续）、二层 %.1f->%.1f，格栅带 alpha' % (PAV['W'], PAV['D'], PAV['hip1_ridge'], PAV['hip2_eave'], PAV['hip2_ridge']),
    '听涛阁水廊自端亭南边缘（p1 沿 seg0 反向 %.2f m）起建，seg0 段由端亭 massing 覆盖' % (PAV['W'] / 2),
    '柱距每段均分接近 2.5 m（闭合环每段柱含起点不含终点避免角柱重复）；复廊为外缘单排柱 + 中墙承重',
    '复廊地面 ±2.3 偏移线在 S 弯腰部自交出洞，改分段条带（每段错峰 1.5mm、搭接 0.15）+ 转角补丁（低 4mm 防闪烁）',
    '美人靠坐面探出控制在柱列内侧 0.08 m（内缘 0.82 > 步行半宽 0.8），保证 1.6 m 通行带；转折 >50° 的角部端部家具内缩 1.4 m（急弯口不设座，避免邻段家具侵入相邻段通行带）',
]

# ---------------------------------------------------------------- 坐标：地图(x,z,y) <-> Blender(x,-z,y)
def bl_pt(x, z_map, y=0.0):
    return Vector((x, -z_map, y))

MESHES = {}
MESHES_KEEP = []   # 手工外向绕向、不 recalc 的开管（瓦当）

def _uv_planar(ob, tile):
    me = ob.data
    uv = me.uv_layers.new(name='UVMap')
    for p in me.polygons:
        ng = (p.normal.x, -p.normal.z, p.normal.y)
        ax = max(range(3), key=lambda k: abs(ng[k]))
        for li in p.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            gx, gy, gz = v.x, v.z, -v.y
            u, w = ((-gz, gy) if ax == 0 else (gx, -gz) if ax == 1 else (gx, gy))
            uv.data[li].uv = (u / tile[0], w / tile[1])

def mesh_part(module, name, verts_map3, faces, matls, tile=(1, 1), face_mats=None, no_recalc=False):
    """verts_map3: 地图系 (x, y高度, z_map)；matls: 材质或材质列表；face_mats: 每面槽号。"""
    if not isinstance(matls, (list, tuple)):
        matls = [matls]
    me = bpy.data.meshes.new(name)
    me.from_pydata([bl_pt(v[0], v[2], v[1]) for v in verts_map3], [], faces)
    me.update()
    for m in matls:
        me.materials.append(m)
    if face_mats:
        for p, mi in zip(me.polygons, face_mats):
            p.material_index = mi
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    _uv_planar(ob, tile)
    if no_recalc:
        MESHES_KEEP.append((module, ob))
    else:
        MESHES.setdefault((module, matls[0].name), []).append(ob)
    return ob

def box_part(module, name, center_map, size, rot, matl, tile=(1, 1)):
    cx, cy, cz = center_map
    hx, hy, hz = (s / 2 for s in size)
    sn, cs = math.sin(rot), math.cos(rot)
    loc = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                lx, ly, lz = sx * hx, sy * hy, sz * hz
                loc.append((cx + lx * sn + lz * cs, cy + ly, cz + lx * cs - lz * sn))
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return mesh_part(module, name, loc, faces, matl, tile)

def prism(module, name, ring_xz, y0, y1, matl, tile=(1, 1), capped=True, no_recalc=False):
    """地图系水平多边形环 ring_xz=[(x,z)] 沿 y 拉伸的棱柱（世界位）。"""
    n = len(ring_xz)
    verts = []
    for y in (y0, y1):
        for x, z in ring_xz:
            verts.append((x, y, z))
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, i + n, j + n, j))          # 侧面（外向）
    if capped:
        faces.append(tuple(range(n - 1, -1, -1)))   # 底盖（向下）
        faces.append(tuple(range(2 * n - 1, n - 1, -1)))  # 顶盖（向上）
    return mesh_part(module, name, verts, faces, matl, tile, no_recalc=no_recalc)

def solid_strip(module, tag, a_line, b_line, t, mat_top, mat_bot, loop=False, fas_a=True, fas_b=False):
    """两等长折线 a(低/外缘)、b(高/内缘) 之间的实心带（闭合体，recalc 定法线）。
    单网格双材质：上面 mat_top，其余 mat_bot。loop: 环形闭合。"""
    n = len(a_line)
    dn = [(p[0], p[1] - t, p[2]) for p in a_line]
    db = [(p[0], p[1] - t, p[2]) for p in b_line]
    verts = a_line + b_line + dn + db
    faces, fm = [], []
    rng = range(n) if loop else range(n - 1)

    def quad(base, i, j):
        return (base + i, base + j, base + n + j, base + n + i)
    for i in rng:
        j = (i + 1) % n
        faces.append(quad(0, i, j)); fm.append(0)          # 上面 a->b
        faces.append(quad(2 * n, i, j)); fm.append(1)      # 下面
    if fas_a:
        for i in rng:
            j = (i + 1) % n
            faces.append((i, j, 2 * n + j, 2 * n + i)); fm.append(1)   # a 缘竖板
    if fas_b:
        for i in rng:
            j = (i + 1) % n
            faces.append((n + i, n + j, 3 * n + j, 3 * n + i)); fm.append(1)
    if not loop:
        faces.append((0, n, 3 * n, 2 * n)); fm.append(1)
        e = n - 1
        faces.append((e, n + e, 3 * n + e, 2 * n + e)); fm.append(1)
    return mesh_part(module, tag, verts, faces, [mat_top, mat_bot], face_mats=fm)

# ---------------------------------------------------------------- 材质
def lin(h):
    a = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in a]

META = {}

def mat(name, color='ffffff', rough=.8, metal=0, tile=(1, 1), base=None, normal=None,
        roughmap=None, tint=None, nstrength=.8, source=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    n = m.node_tree.nodes
    l = m.node_tree.links
    p = n.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*lin(color), 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    paths = {}
    if base: paths['color'] = os.path.join(TEX512, base)
    if normal: paths['normal'] = os.path.join(TEX512, normal)
    if roughmap: paths['roughness'] = os.path.join(TEX512, roughmap)
    for ch, path in paths.items():
        if not os.path.exists(path):
            raise RuntimeError('missing derived texture %s (run gen_textures.py)' % path)
    for ch, path in paths.items():
        t = n.new('ShaderNodeTexImage')
        t.extension = 'REPEAT'
        t.image = bpy.data.images.load(path, check_existing=True)
        t.image.colorspace_settings.name = 'sRGB' if ch == 'color' else 'Non-Color'
        t.image.pack()
        if ch == 'normal':
            nm = n.new('ShaderNodeNormalMap')
            nm.inputs['Strength'].default_value = nstrength
            l.new(t.outputs['Color'], nm.inputs['Color'])
            l.new(nm.outputs['Normal'], p.inputs['Normal'])
        elif ch == 'roughness':
            l.new(t.outputs['Color'], p.inputs['Roughness'])
        else:
            if tint:
                mul = n.new('ShaderNodeMixRGB')
                mul.blend_type = 'MULTIPLY'
                mul.inputs['Fac'].default_value = 1.0
                mul.inputs['Color2'].default_value = (*lin(tint), 1)
                l.new(t.outputs['Color'], mul.inputs['Color1'])
                l.new(mul.outputs['Color'], p.inputs['Base Color'])
            else:
                l.new(t.outputs['Color'], p.inputs['Base Color'])
    META[name] = {'source': source or 'asset-authoring/yuyuan-entry/source-kit/textures',
                  'images': [os.path.basename(v) for v in paths.values()],
                  'tint': tint, 'tile': list(tile),
                  'colorspace': ['sRGB' if ch == 'color' else 'Non-Color' for ch in paths]}
    return m

M_TILE = mat('corridor-tile', rough=.85, base='roof-color.jpg', normal='roof-normal.png', tile=(1.44, 1.36),
             source='project analytic roof relief (source-kit)')
M_TIMBER = mat('corridor-timber', rough=.7, base='wood-stain-color.jpg', normal='Wood092_2K-JPG_NormalGL_1K.png',
               tint=TINT_TIMBER, tile=(0.55, 1.1), source='source-kit wood + spec tint ' + TINT_TIMBER)
M_STONE = mat('corridor-stone', rough=.8, base='PaintedPlaster017_2K-JPG_Color_1K.jpg',
              normal='PaintedPlaster017_2K-JPG_NormalGL_1K.png',
              tint=TINT_STONE, tile=(1.2, 1.2), source='PaintedPlaster017 color/normal + spec greyStone tint ' + TINT_STONE + '; roughness scalar（控字节省 roughness 图）')
LATTICE_PNG = os.path.join(OUT, 'lattice-alpha.png')
if not os.path.exists(LATTICE_PNG):
    raise RuntimeError('missing %s (run gen_textures.py first)' % LATTICE_PNG)
M_LATTICE = mat('corridor-lattice', rough=.8, tile=(1, 1), source='analytic PIL lattice (map-authoring.json)')
_mt = M_LATTICE.node_tree.nodes.new('ShaderNodeTexImage')
_mt.image = bpy.data.images.load(LATTICE_PNG)
_mt.image.colorspace_settings.name = 'sRGB'
_mt.image.pack()
_p = M_LATTICE.node_tree.nodes.get('Principled BSDF')
M_LATTICE.node_tree.links.new(_mt.outputs['Color'], _p.inputs['Base Color'])
M_LATTICE.node_tree.links.new(_mt.outputs['Alpha'], _p.inputs['Alpha'])
if hasattr(M_LATTICE, 'blend_method'):
    M_LATTICE.blend_method = 'BLEND'
if hasattr(M_LATTICE, 'surface_render_method'):
    M_LATTICE.surface_render_method = 'BLENDED'
M_LATTICE.use_backface_culling = False
META['corridor-lattice'] = {'source': 'analytic PIL lattice (map-authoring.json)',
                            'images': ['lattice-alpha.png'], 'tint': None, 'tile': [1, 1], 'colorspace': ['sRGB']}

# ---------------------------------------------------------------- 几何工具（地图 2D）
def unit(dx, dz):
    L = math.hypot(dx, dz)
    return (dx / L, dz / L)

def left_normal(u):
    """地图系行进方向 u 的左手法线（东行 -> 北 = -z）。"""
    return (u[1], -u[0])

def seg_dir(a, b):
    return unit(b[0] - a[0], b[1] - a[1])

def dedupe_closed(poly):
    pts = [tuple(p) for p in poly]
    if pts[0] == pts[-1]:
        pts = pts[:-1]
    return pts

def vertex_offsets(pts, closed, d, max_spike):
    """每顶点侧向偏移点：{'pt': (x,z), 'hip': bool}。尖长超限/近平行 -> 垂直偏移点 + hip。"""
    n = len(pts)
    out = []
    for i in range(n):
        if closed:
            a, b, c = pts[(i - 1) % n], pts[i], pts[(i + 1) % n]
        elif i == 0:
            u = seg_dir(pts[0], pts[1])
            nl = left_normal(u)
            out.append({'pt': (pts[0][0] + nl[0] * d, pts[0][1] + nl[1] * d), 'hip': False})
            continue
        elif i == n - 1:
            u = seg_dir(pts[-2], pts[-1])
            nl = left_normal(u)
            out.append({'pt': (pts[-1][0] + nl[0] * d, pts[-1][1] + nl[1] * d), 'hip': False})
            continue
        else:
            a, b, c = pts[i - 1], pts[i], pts[i + 1]
        n1 = left_normal(seg_dir(a, b))
        n2 = left_normal(seg_dir(b, c))
        u1 = (-n1[1], n1[0])
        u2 = (-n2[1], n2[0])
        det = u1[0] * u2[1] - u1[1] * u2[0]
        ok = abs(det) >= 1e-6
        if ok:
            s = ((n2[0] - n1[0]) * d * u2[1] - (n2[1] - n1[1]) * d * u2[0]) / det
            px, pz = b[0] + n1[0] * d + u1[0] * s, b[1] + n1[1] * d + u1[1] * s
            spike = math.hypot(px - b[0], pz - b[1])
            ok = spike <= max_spike
        if ok:
            out.append({'pt': (px, pz), 'hip': False})
        else:
            u = seg_dir(b, c)
            nl = left_normal(u)
            out.append({'pt': (b[0] + nl[0] * d, b[1] + nl[1] * d), 'hip': True})
    return out

def rail_side_for(oid, pts, closed):
    """逐段美人靠侧：+1 左 / -1 右 / None（规则见 ASSUMPTIONS[0]）。"""
    hints = SI['railHints']
    halls = [h for h in hints if h['kind'] in HALL_KINDS]
    waters = [h for h in hints if h['kind'] == 'water']
    cx = sum(p[0] for p in pts) / len(pts)
    cz = sum(p[1] for p in pts) / len(pts)
    sides = []
    nseg = len(pts) - (0 if closed else 1)
    for i in range(nseg):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        nl = left_normal(seg_dir(a, b))
        mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2

        def near(lst, rng):
            best = None
            for h in lst:
                dist = math.hypot(h['centroid'][0] - mx, h['centroid'][1] - mz)
                if dist < rng and (best is None or dist < best[0]):
                    sgn = 1 if (nl[0] * (h['centroid'][0] - mx) + nl[1] * (h['centroid'][1] - mz)) > 0 else -1
                    best = (dist, sgn)
            return best

        w = near(waters, 6.0)
        h = near(halls, 40.0)
        if closed:
            outward = 1 if nl[0] * (mx - cx) + nl[1] * (mz - cz) > 0 else -1
            if w and w[1] == outward:
                side = outward
            elif w is None and (h is None or h[0] > 15.0 or h[1] != outward):
                side = outward
            else:
                side = None
        else:
            if w:
                side = w[1]
            elif h:
                side = -h[1]
            else:
                side = None
        sides.append(side)
    return sides

# ---------------------------------------------------------------- 走廊构建
def ring_area(pts):
    s = 0.0
    n = len(pts)
    for i in range(n):
        x1, z1 = pts[i]
        x2, z2 = pts[(i + 1) % n]
        s += x1 * z2 - x2 * z1
    return s / 2


def scaled_ring(pts, k):
    cx = sum(p[0] for p in pts) / len(pts)
    cz = sum(p[1] for p in pts) / len(pts)
    return [(cx + (p[0] - cx) * k, cz + (p[1] - cz) * k) for p in pts]


def build_corridor(oid, pts):
    cfg = CFG[oid]
    closed = cfg['closed']
    double = cfg['double']
    half = 2.3 if double else cfg['width'] / 2
    coloff = 2.2 if double else cfg['width'] / 2 - 0.1
    eoff = half + OVER
    mod = oid
    n = len(pts)
    nseg = n - (0 if closed else 1)
    coll = {'columns': [], 'rails': [], 'walls': [], 'floors': []}

    # --- 柱
    columns = []
    for i in range(nseg):
        a, b = pts[i], pts[(i + 1) % n]
        u = seg_dir(a, b)
        nl = left_normal(u)
        ns = max(1, round(math.dist(a, b) / 2.5))
        ts = [k / ns for k in range(ns)] if closed else [k / ns for k in range(ns + 1)]
        for side in (-1, 1):
            for t in ts:
                x = a[0] + (b[0] - a[0]) * t + side * nl[0] * coloff
                z = a[1] + (b[1] - a[1]) * t + side * nl[1] * coloff
                columns.append({'x': round(x, 4), 'z': round(z, 4), 'side': side,
                                'seg': i, 't': round(t, 4), 'offset': round(side * coloff, 4)})
    for ci, c in enumerate(columns):
        ring = [(c['x'] + COL_R * math.cos(k / 8 * 2 * math.pi), c['z'] + COL_R * math.sin(k / 8 * 2 * math.pi))
                for k in range(8)]
        prism(mod, f'col-{ci}', ring, FLOOR_T, COL_H, M_TIMBER, tile=(0.5, 1.0))
        coll['columns'].append({'center': [c['x'], (FLOOR_T + COL_H) / 2, c['z']],
                                'size': [0.24, COL_H - FLOOR_T, 0.24], 'yaw': 0.0, 'type': 'box', 'name': 'column'})

    # --- 地面板：默认整环斜接带；复廊小环（±half 偏移线在腰部自交）改分段条带 + 转角补丁
    if double and closed:
        for i in range(nseg):
            a, b = pts[i], pts[(i + 1) % n]
            u = seg_dir(a, b)
            nl = left_normal(u)
            top = FLOOR_T - i * 0.0015   # 每段错峰 1.5mm，接缝搭接 0.15 防共面闪烁
            la = [(a[0] + nl[0] * half, top, a[1] + nl[1] * half), (b[0] + nl[0] * half, top, b[1] + nl[1] * half)]
            lb = [(a[0] - nl[0] * half, top, a[1] - nl[1] * half), (b[0] - nl[0] * half, top, b[1] - nl[1] * half)]
            solid_strip(mod, f'floor-{i}', la, lb, FLOOR_T, M_STONE, M_STONE, loop=False, fas_a=True, fas_b=True)
        for i in range(n):
            v = pts[i]
            ui = seg_dir(pts[(i - 1) % n], v)
            uo = seg_dir(v, pts[(i + 1) % n])
            ni_, no = left_normal(ui), left_normal(uo)
            top = FLOOR_T - nseg * 0.0015 - 0.004
            q = [(v[0] + ni_[0] * half, top, v[1] + ni_[1] * half),
                 (v[0] + no[0] * half, top, v[1] + no[1] * half),
                 (v[0] - no[0] * half, top, v[1] - no[1] * half),
                 (v[0] - ni_[0] * half, top, v[1] - ni_[1] * half)]
            qb = [(p[0], p[1] - top, p[2]) for p in q]
            mesh_part(mod, f'floor-patch-{i}', q + qb,
                      [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)],
                      M_STONE)
    else:
        offL = vertex_offsets(pts, closed, half, MAX_SPIKE)
        offR = vertex_offsets(pts, closed, -half, MAX_SPIKE)
        lineL = [(offL[i]['pt'][0], FLOOR_T, offL[i]['pt'][1]) for i in range(n)]
        lineR = [(offR[i]['pt'][0], FLOOR_T, offR[i]['pt'][1]) for i in range(n)]
        solid_strip(mod, 'floor', lineL, lineR, FLOOR_T, M_STONE, M_STONE, loop=closed, fas_a=True, fas_b=True)

    # --- 枋（沿柱列窄木条，按段）
    for i in range(nseg):
        a, b = pts[i], pts[(i + 1) % n]
        u = seg_dir(a, b)
        yaw = math.atan2(u[0], u[1])
        L = math.dist(a, b)
        for side in (-1, 1):
            nl = left_normal(u)
            mx = (a[0] + b[0]) / 2 + side * nl[0] * coloff
            mz = (a[1] + b[1]) / 2 + side * nl[1] * coloff
            box_part(mod, f'beam-{i}-{side}', (mx, COL_H, mz), (L + 0.1, 0.16, 0.14), yaw, M_TIMBER)

    # --- 美人靠
    rail_sides = rail_side_for(oid, pts, closed)

    def turn_at(i):
        """顶点 i 处转折角（度，0=直线）；开口折线端点为 0。"""
        if not closed and (i <= 0 or i >= n - 1):
            return 0.0
        a = pts[(i - 1) % n]
        b = pts[i % n]
        c = pts[(i + 1) % n]
        if a == b or b == c:
            return 0.0
        v1, v2 = seg_dir(a, b), seg_dir(b, c)
        dot = max(-1.0, min(1.0, v1[0] * v2[0] + v1[1] * v2[1]))
        return math.degrees(math.acos(dot))

    for i in range(nseg):
        side = rail_sides[i]
        if side is None:
            continue
        a, b = pts[i], pts[(i + 1) % n]
        L = math.dist(a, b)
        # 家具避开急弯角区：转折 >50° 的端部内缩 1.4 m（真实园廊不在急弯口设座）
        t0 = 1.4 if (closed or i > 0) and turn_at(i) > 50 else 0.18
        t1 = 1.4 if (closed or i < n - 1) and turn_at(i + 1) > 50 else 0.18
        if L - t0 - t1 < 0.4:
            continue
        u = seg_dir(a, b)
        nl = left_normal(u)
        yaw = math.atan2(u[0], u[1])
        s0, s1 = t0, L - t1
        run = s1 - s0
        amx = (s0 + s1) / 2
        ox = a[0] + u[0] * amx + side * nl[0] * (coloff - 0.08)
        oz = a[1] + u[1] * amx + side * nl[1] * (coloff - 0.08)
        box_part(mod, f'seat-{i}', (ox, SEAT_H - SEAT_T / 2, oz), (run, SEAT_T, 0.20), yaw, M_TIMBER)
        bx = a[0] + u[0] * amx + side * nl[0] * (coloff - 0.02)
        bz = a[1] + u[1] * amx + side * nl[1] * (coloff - 0.02)
        box_part(mod, f'railtop-{i}', (bx, RAIL_TOP - 0.045, bz), (run, 0.09, 0.07), yaw, M_TIMBER)
        box_part(mod, f'railmid-{i}', (bx, (SEAT_H + RAIL_TOP) / 2, bz), (run, 0.06, 0.05), yaw, M_TIMBER)
        np_ = max(2, int(run / 1.2) + 1)
        for k in range(np_):
            t = s0 + run * k / (np_ - 1)
            px = a[0] + u[0] * t + side * nl[0] * coloff
            pz = a[1] + u[1] * t + side * nl[1] * coloff
            box_part(mod, f'railpost-{i}-{k}', (px, (SEAT_H - SEAT_T + RAIL_TOP) / 2, pz),
                     (0.06, RAIL_TOP - SEAT_H + SEAT_T + 0.06, 0.06), yaw, M_TIMBER)
        coll['rails'] += [
            {'center': [round(ox, 3), SEAT_H - SEAT_T / 2, round(oz, 3)], 'size': [round(run, 3), SEAT_T, 0.20],
             'yaw': round(yaw, 4), 'type': 'box', 'name': 'seat'},
            {'center': [round(bx, 3), RAIL_TOP - 0.045, round(bz, 3)], 'size': [round(run, 3), 0.09, 0.07],
             'yaw': round(yaw, 4), 'type': 'box', 'name': 'rail'}]

    # --- 屋面（脊=折线 y3.55；檐=顶点斜接 ±eoff y2.85；尖超限顶点戗角封盖）
    voL = vertex_offsets(pts, closed, eoff, MAX_SPIKE)
    voR = vertex_offsets(pts, closed, -eoff, MAX_SPIKE)
    inner_side = None
    if double and closed:
        # 小环内缘偏移 eoff 会自交：内圈改为向质心缩放的天井式内坡（ASSUMPTIONS）
        inner_side = 'L' if abs(ring_area([voL[i]['pt'] for i in range(n)])) < \
            abs(ring_area([voR[i]['pt'] for i in range(n)])) else 'R'
    eave_full = {}
    for side, vo, sd in (('L', voL, 1), ('R', voR, -1)):
        if side == inner_side:
            eave = scaled_ring(pts, INNER_SCALE)
        else:
            eave = []
            if not closed:
                u0 = seg_dir(pts[0], pts[1])
                nl0 = left_normal(u0)
                eave.append((pts[0][0] - u0[0] * EXT + sd * nl0[0] * eoff, pts[0][1] - u0[1] * EXT + sd * nl0[1] * eoff))
            eave += [vo[i]['pt'] for i in range(n)]
            if not closed:
                uE = seg_dir(pts[-2], pts[-1])
                nlE = left_normal(uE)
                eave.append((pts[-1][0] + uE[0] * EXT + sd * nlE[0] * eoff, pts[-1][1] + uE[1] * EXT + sd * nlE[1] * eoff))
        m = len(eave)
        ridge = []
        for j in range(m):
            if not closed and j == 0:
                u0 = seg_dir(pts[0], pts[1])
                ridge.append((pts[0][0] - u0[0] * EXT, pts[0][1] - u0[1] * EXT))
            elif not closed and j == m - 1:
                uE = seg_dir(pts[-2], pts[-1])
                ridge.append((pts[-1][0] + uE[0] * EXT, pts[-1][1] + uE[1] * EXT))
            else:
                vi = j if closed else j - 1
                ridge.append(pts[vi % n])
        aline = [(p[0], EAVE, p[1]) for p in eave]
        bline = [(p[0], RIDGE, p[1]) for p in ridge]
        solid_strip(mod, f'roof-{side}', aline, bline, ROOF_T, M_TILE, M_TIMBER, loop=closed)
        eave_full[side] = eave + [eave[0]] if closed else eave

    # --- 屋脊滚筒（六边环带，中心 y3.53）
    if closed:
        base = pts + [pts[0]]
    else:
        u0 = seg_dir(pts[0], pts[1])
        uE = seg_dir(pts[-2], pts[-1])
        base = ([(pts[0][0] - u0[0] * EXT, pts[0][1] - u0[1] * EXT)] + pts +
                [(pts[-1][0] + uE[0] * EXT, pts[-1][1] + uE[1] * EXT)])
    dense = [base[0]]
    for a, b in zip(base, base[1:]):
        L = math.dist(a, b)
        k = max(1, int(L / 2.5))
        for s in range(1, k + 1):
            dense.append((a[0] + (b[0] - a[0]) * s / k, a[1] + (b[1] - a[1]) * s / k))
    nr = len(dense)
    rverts = []
    for p in dense:
        rverts += [(p[0] + 0.06 * math.cos(k / 6 * 2 * math.pi), 3.53, p[1] + 0.06 * math.sin(k / 6 * 2 * math.pi))
                   for k in range(6)]
    rfaces = []
    lim = nr if closed else nr - 1
    for ri in range(lim):
        ri2 = (ri + 1) % nr
        for k in range(6):
            k2 = (k + 1) % 6
            rfaces.append((ri * 6 + k, ri * 6 + k2, ri2 * 6 + k2, ri2 * 6 + k))
    if not closed:
        for base_i in (0, (nr - 1) * 6):
            rfaces.append(tuple(range(base_i, base_i + 6))[::-1] if base_i == 0 else tuple(range(base_i, base_i + 6)))
    mesh_part(mod, 'ridge-roll', rverts, rfaces, M_TILE, tile=(0.4, 1.2))

    # --- 瓦当行（檐口线下小方齿；开管手工外向绕向，不 recalc）
    for side in ('L', 'R'):
        eave = eave_full[side]
        sd = 1 if side == 'L' else -1
        segs = list(zip(eave, eave[1:])) + ([(eave[-1], eave[0])] if closed else [])
        for a, b in segs:
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            if L < 0.05:
                continue
            u = unit(b[0] - a[0], b[1] - a[1])
            nl = left_normal(u)
            k = max(1, int(round(L / LIP_STEP)))
            for s in range(k):
                t = (s + 0.5) / k
                x = a[0] + (b[0] - a[0]) * t + sd * nl[0] * 0.03
                z = a[1] + (b[1] - a[1]) * t + sd * nl[1] * 0.03
                ring = [(x + 0.042 * math.cos(an), z + 0.042 * math.sin(an))
                        for an in (math.pi / 4, 3 * math.pi / 4, 5 * math.pi / 4, 7 * math.pi / 4)]
                prism(mod, 'lips', ring, 2.71, 2.83, M_TILE, tile=(0.3, 0.3), capped=False, no_recalc=True)

    # --- 开口折线远端山墙（实心三棱柱，石）
    if not closed:
        uE = seg_dir(pts[-2], pts[-1])
        nl = left_normal(uE)
        e = pts[-1]
        tri = [(e[0] + nl[0] * half, EAVE, e[1] + nl[1] * half),
               (e[0], RIDGE, e[1]),
               (e[0] - nl[0] * half, EAVE, e[1] - nl[1] * half)]
        tri2 = [(p[0] - uE[0] * 0.12, p[1], p[2] - uE[1] * 0.12) for p in tri]
        verts = tri + tri2
        faces = [(0, 1, 2), (5, 4, 3), (0, 3, 4), (0, 4, 1), (1, 4, 5), (1, 5, 2), (2, 5, 3), (2, 3, 0)]
        mesh_part(mod, 'gable-end', verts, faces, M_STONE)

    # --- 复廊中墙 + 漏窗 + 格栅
    if double:
        for i in range(nseg):
            a, b = pts[i], pts[(i + 1) % n]
            L = math.dist(a, b)
            if L < 0.4:
                continue
            u = seg_dir(a, b)
            yaw = math.atan2(u[0], u[1])
            kmax = max(0, int(math.floor((L - 2 * 0.9 - WIN_W) / WIN_STEP)) + 1)
            wins = [0.9 + (L - 1.8) * (k + 0.5) / kmax for k in range(kmax)] if kmax else []
            cuts = sorted({0.0, L} | {round(t - WIN_W / 2, 4) for t in wins} | {round(t + WIN_W / 2, 4) for t in wins})
            for j in range(len(cuts) - 1):
                c0, c1 = cuts[j], cuts[j + 1]
                if c1 - c0 < 0.02:
                    continue
                mid = (c0 + c1) / 2
                mx, mz = a[0] + u[0] * mid, a[1] + u[1] * mid
                runlen = c1 - c0
                is_win = any(c0 >= t - WIN_W / 2 - 0.01 and c1 <= t + WIN_W / 2 + 0.01 for t in wins)
                if is_win:
                    box_part(mod, f'wall-sill-{i}-{j}', (mx, (FLOOR_T + WIN_SILL) / 2, mz),
                             (runlen, WIN_SILL - FLOOR_T, WALL_T), yaw, M_STONE)
                    box_part(mod, f'wall-head-{i}-{j}', (mx, (WIN_SILL + WIN_H + WALL_TOP) / 2, mz),
                             (runlen, WALL_TOP - WIN_SILL - WIN_H, WALL_T), yaw, M_STONE)
                else:
                    box_part(mod, f'wall-{i}-{j}', (mx, (FLOOR_T + WALL_TOP) / 2, mz),
                             (runlen, WALL_TOP - FLOOR_T, WALL_T), yaw, M_STONE)
            coll['walls'].append({'center': [round(a[0] + u[0] * L / 2, 3), WALL_TOP / 2, round(a[1] + u[1] * L / 2, 3)],
                                  'size': [round(L, 3), WALL_TOP, WALL_T], 'yaw': round(yaw, 4), 'type': 'box'})
            for t in wins:
                wx, wz = a[0] + u[0] * t, a[1] + u[1] * t
                lat = [(wx - u[0] * WIN_W / 2, WIN_SILL + WIN_H, wz - u[1] * WIN_W / 2),
                       (wx + u[0] * WIN_W / 2, WIN_SILL + WIN_H, wz + u[1] * WIN_W / 2),
                       (wx + u[0] * WIN_W / 2, WIN_SILL, wz + u[1] * WIN_W / 2),
                       (wx - u[0] * WIN_W / 2, WIN_SILL, wz - u[1] * WIN_W / 2)]
                mesh_part(mod, f'lattice-{i}', lat, [(0, 1, 2), (0, 2, 3)], M_LATTICE)
                box_part(mod, f'wframe-h1-{i}', (wx, WIN_SILL + 0.04, wz), (WIN_W + 0.12, 0.08, WALL_T + 0.04), yaw, M_TIMBER)
                box_part(mod, f'wframe-h2-{i}', (wx, WIN_SILL + WIN_H - 0.04, wz), (WIN_W + 0.12, 0.08, WALL_T + 0.04), yaw, M_TIMBER)
                for sgn in (-1, 1):
                    box_part(mod, f'wframe-v-{i}-{sgn}',
                             (wx + u[0] * sgn * (WIN_W / 2 + 0.04), WIN_SILL + WIN_H / 2, wz + u[1] * sgn * (WIN_W / 2 + 0.04)),
                             (0.08, WIN_H, WALL_T + 0.04), yaw, M_TIMBER)

    # --- 戗角封盖（檐点标记为 hip 的顶点；缩放内圈无 hip）
    for side, vo, sd in (('L', voL, 1), ('R', voR, -1)):
        if side == inner_side:
            continue
        m = len(eave_full[side])
        idxs = range(n) if closed else range(1, m - 1)
        for j in idxs:
            if not vo[j if closed else j - 1]['hip']:
                continue
            p1 = eave_full[side][j]
            p0 = eave_full[side][j - 1]
            p2 = eave_full[side][j + 1]
            v = pts[j if closed else j - 1]
            verts = [(p0[0], EAVE, p0[1]), (p1[0], EAVE, p1[1]), (p2[0], EAVE, p2[1]),
                     (v[0], RIDGE - ROOF_T, v[1]), (v[0], RIDGE, v[1]),
                     (p0[0], EAVE - ROOF_T, p0[1]), (p1[0], EAVE - ROOF_T, p1[1]), (p2[0], EAVE - ROOF_T, p2[1])]
            faces = [(0, 1, 4), (1, 2, 4),                      # 上面两三角
                     (5, 6, 3), (6, 7, 3),                      # 下面
                     (0, 5, 6, 1), (1, 6, 7, 2),                # 檐缘竖板
                     (4, 3, 5, 0), (4, 3, 7, 2)]                # 脊侧封板
            mesh_part(mod, f'hip-{side}-{j}', verts, faces, [M_TILE, M_TIMBER],
                      face_mats=[0, 0, 1, 1, 1, 1, 1, 1])

    return {'columns': columns, 'railSides': rail_sides, 'halfRoof': eoff, 'colOffset': coloff,
            'closed': closed, 'double': double, 'coll': coll}

# ---------------------------------------------------------------- 听涛阁端亭 massing
def build_pavilion(oid, c, u):
    mod = oid
    yaw = math.atan2(u[0], u[1])
    PW, PD = PAV['W'], PAV['D']
    sn, cs = math.sin(yaw), math.cos(yaw)

    def lp(lx, lz):
        return (c[0] + lx * sn + lz * cs, c[1] + lx * cs - lz * sn)

    coll = []
    box_part(mod, 'pav-base', (c[0], PAV['base_h'] / 2, c[1]), (PW, PAV['base_h'], PD), yaw, M_STONE)
    coll.append({'center': [round(c[0], 3), PAV['base_h'] / 2, round(c[1], 3)],
                 'size': [PW, PAV['base_h'], PD], 'yaw': round(yaw, 4), 'type': 'box', 'name': 'pav-base'})
    xs = [-PW / 2 + PW * i / 5 for i in range(6)]
    zs = [-PD / 2 + PD * k / 3 for k in range(4)]
    for st, (y0, y1) in enumerate(((PAV['base_h'], PAV['c1_top']), (PAV['c2_bot'], PAV['c2_top']))):
        for lx in xs:
            for lz in zs:
                p = lp(lx, lz)
                ring = [(p[0] + COL_R * math.cos(k / 8 * 2 * math.pi), p[1] + COL_R * math.sin(k / 8 * 2 * math.pi))
                        for k in range(8)]
                prism(mod, f'pav-col-{st}', ring, y0, y1, M_TIMBER, tile=(0.5, 1.0))
                if st == 0:
                    coll.append({'center': [round(p[0], 3), (y0 + y1) / 2, round(p[1], 3)],
                                 'size': [0.24, y1 - y0, 0.24], 'yaw': 0.0, 'type': 'box', 'name': 'pav-col'})
    box_part(mod, 'pav-deck', (c[0], PAV['c2_bot'] - 0.1, c[1]), (PW - 0.3, 0.18, PD - 0.3), yaw, M_TIMBER)

    def hip(tag, eave_w, eave_d, y_eave, ridge_w, y_ridge):
        corners = [(-eave_w / 2, -eave_d / 2), (eave_w / 2, -eave_d / 2),
                   (eave_w / 2, eave_d / 2), (-eave_w / 2, eave_d / 2)]
        verts = []
        for lx, lz in corners:
            p = lp(lx, lz)
            verts.append((p[0], y_eave, p[1]))
        for lx in (-ridge_w / 2, ridge_w / 2):
            p = lp(lx, 0.0)
            verts.append((p[0], y_ridge, p[1]))
        faces = [(0, 1, 5, 4), (1, 2, 5), (2, 3, 4, 5), (3, 0, 4),   # 四坡 + 两坡面
                 (0, 1, 2, 3)]                                        # 底（木望，同网格换材质）
        mesh_part(mod, tag, verts, faces, [M_TILE, M_TIMBER], face_mats=[0, 0, 0, 0, 1])
    hip('pav-hip-low', PW + 0.9, PD + 0.9, PAV['hip1_eave'], 4.2, PAV['hip1_ridge'])
    hip('pav-hip-top', PW + 1.2, PD + 1.2, PAV['hip2_eave'], 5.0, PAV['hip2_ridge'])

    for st, (ys, ye) in enumerate(((1.0, 2.5), (4.6, 6.1))):
        base_y = PAV['base_h'] if st == 0 else PAV['c2_bot']
        for sx in (-1, 1):
            for k in range(5):
                lx0 = -PW / 2 + PW * k / 5 + 0.12
                lx1 = -PW / 2 + PW * (k + 1) / 5 - 0.12
                a, b = lp(lx0, sx * PD / 2), lp(lx1, sx * PD / 2)
                mesh_part(mod, f'pav-band-{st}-x{sx}-{k}',
                          [(a[0], ye, a[1]), (b[0], ye, b[1]), (b[0], ys, b[1]), (a[0], ys, a[1])],
                          [(0, 1, 2), (0, 2, 3)], M_LATTICE)
            p = lp(0, sx * (PD / 2 - 0.05))
            box_part(mod, f'pav-sill-{st}-{sx}', (p[0], base_y + (ys - base_y) / 2, p[1]),
                     (PW - 0.2, ys - base_y, 0.10), yaw, M_STONE)
        for sz in (-1, 1):
            a, b = lp(-PW / 2, sz * PD / 2), lp(PW / 2, sz * PD / 2)
            mesh_part(mod, f'pav-band-{st}-z{sz}',
                      [(a[0], ye, a[1]), (b[0], ye, b[1]), (b[0], ys, b[1]), (a[0], ys, a[1])],
                      [(0, 1, 2), (0, 2, 3)], M_LATTICE)
    return {'center': [round(c[0], 3), round(c[1], 3)], 'yaw': round(yaw, 4), 'size': [PW, PD],
            'topY': PAV['hip2_ridge'], 'budgetTris': PAV_TRI_BUDGET}, coll

# ---------------------------------------------------------------- 构建
CATALOG = {'packageId': 'pawborough-w1-corridor-kit-20260922',
           'coordinateContract': 'GLB Y-up world (x, y, z_map), origin map(0,0), no instance transform; Blender internal (x, -z_map, y); export_yup=True',
           'frozen': {'EAVE': EAVE, 'RIDGE': RIDGE, 'COL_H': COL_H, 'FLOOR_T': FLOOR_T, 'ROOF_T': ROOF_T,
                      'OVER': OVER, 'COL_R': COL_R, 'SEAT_H': SEAT_H, 'RAIL_TOP': RAIL_TOP,
                      'WIN': [WIN_W, WIN_H, WIN_SILL], 'WALL_T': WALL_T, 'WALL_TOP': WALL_TOP},
           'materials': META, 'modules': {}, 'assumptions': ASSUMPTIONS}
COLL = {'axis': 'glTF Y-up; map coords (x east, z south), y height',
        'note': 'coarse proxies: column boxes + rail boxes + floor slabs (+ double-corridor centre wall, pavilion base/columns)',
        'modules': {}}

for oid in CFG:
    cfg = CFG[oid]
    o = SI['objects'][oid]
    pts = dedupe_closed([tuple(p) for p in o['geometry']['polyline']]) if cfg['closed'] else \
        [tuple(p) for p in o['geometry']['polyline']]
    info = None
    if cfg['pavilion']:
        # 水廊自端亭南边缘起建：p1 沿 seg0 反向 5.05 m；seg0 交由端亭 massing 覆盖
        u0 = seg_dir(pts[0], pts[1])
        p_edge = (pts[1][0] - u0[0] * PAV['W'] / 2, pts[1][1] - u0[1] * PAV['W'] / 2)
        pts_g = [p_edge] + pts[1:]
        info = build_corridor(oid, pts_g)
        pav, pav_coll = build_pavilion(oid, pts[1], seg_dir(pts[1], pts[2]))
        info['pavilion'] = pav
        info['galleryStart'] = [round(p_edge[0], 3), round(p_edge[1], 3)]
        info['coll']['floors'] = []
    else:
        info = build_corridor(oid, pts)
        info['pavilion'] = None
    # 地面碰撞按段
    half = 2.3 if cfg['double'] else cfg['width'] / 2
    bpts = info.get('galleryStart')
    pp = pts
    if bpts:
        pp = [tuple(bpts)] + pts[1:]
    nseg = len(pp) - (0 if cfg['closed'] else 1)
    for i in range(nseg):
        a, b = pp[i], pp[(i + 1) % len(pp)]
        u = seg_dir(a, b)
        info['coll']['floors'].append(
            {'center': [round((a[0] + b[0]) / 2, 3), FLOOR_T / 2, round((a[1] + b[1]) / 2, 3)],
             'size': [round(math.dist(a, b) + 0.4, 3), FLOOR_T, round(half * 2, 3)],
             'yaw': round(math.atan2(u[0], u[1]), 4), 'type': 'box', 'name': 'floor'})
    boxes = info['coll']['columns'] + info['coll']['rails'] + info['coll']['walls'] + info['coll']['floors']
    if cfg['pavilion']:
        boxes += pav_coll
    COLL['modules'][oid] = {'boxes': boxes}
    CATALOG['modules'][oid] = {'glb': cfg['glb'], 'zh': cfg['zh'], 'width': cfg['width'],
                               'closed': cfg['closed'], 'double': cfg['double'],
                               'polyline': o['geometry']['polyline'],
                               'columns': info['columns'], 'railSides': info['railSides'],
                               'halfRoof': info['halfRoof'], 'colOffset': info['colOffset'],
                               'galleryStart': info.get('galleryStart'), 'pavilion': info['pavilion'],
                               'budgetTriangles': cfg['triBudget'], 'budgetBytes': cfg['bytesBudget']}

# ---------------------------------------------------------------- 三角化/法线/导出
def finalize(lst):
    for ob in lst:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(ob.data)
        bm.free()
        ob.data.calc_loop_triangles()

GROUPS_FINAL = []
tris_total = 0
for oid in CFG:
    cfg = CFG[oid]
    final = []
    tri = 0
    for (m2, _mn), lst in list(MESHES.items()):
        if m2 == oid:
            for ob in lst:
                finalize([ob])
                final.append(ob)
            del MESHES[(m2, _mn)]
    for m2, ob in [t for t in MESHES_KEEP if t[0] == oid]:
        ob.data.calc_loop_triangles()
        final.append(ob)
    MESHES_KEEP[:] = [t for t in MESHES_KEEP if t[0] != oid]
    # 合并为单对象（glTF 按 mesh 切缓冲，528 个小网格的 accessor 开销远超几何本身）
    if len(final) > 1:
        bpy.ops.object.select_all(action='DESELECT')
        for o in final:
            o.select_set(True)
        bpy.context.view_layer.objects.active = final[0]
        bpy.ops.object.join()
        final = [bpy.context.view_layer.objects.active]
    joined = final[0]
    joined.name = f'{oid}__joined'
    joined.data.calc_loop_triangles()
    tri = len(joined.data.loop_triangles)
    path = os.path.join(OUT, cfg['glb'])
    bpy.ops.object.select_all(action='DESELECT')
    for o in final:
        o.select_set(True)
    bpy.context.view_layer.objects.active = final[0]
    try:
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                                  use_selection=True, export_animations=False, export_tangents=False,
                                  export_image_format='AUTO', export_cameras=False, export_lights=False)
    except TypeError:
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, use_selection=True)
    size = os.path.getsize(path)
    CATALOG['modules'][oid].update({'triangles': tri, 'bytes': size,
                                    'overTri': bool(tri > cfg['triBudget']),
                                    'overBytes': bool(size > cfg['bytesBudget'])})
    tris_total += tri
    print(cfg['glb'], size, 'bytes', tri, 'tris')

CATALOG['totals'] = {'triangles': tris_total, 'budgetTriangles': 45000,
                     'bytes': sum(CATALOG['modules'][o]['bytes'] for o in CFG), 'budgetBytes': 2500000}
json.dump(COLL, open(os.path.join(OUT, 'corridor-kit-collision.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
json.dump(CATALOG, open(os.path.join(OUT, 'corridor-kit-catalog.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
json.dump({
    'lattice-alpha.png': {'kind': 'analytic PIL', 'size': [286, 234], 'metres': [1.1, 0.9],
                          'use': '复廊漏窗 alpha 格栅 + 端亭格栅带', 'generator': 'modules/corridor-kit/gen_textures.py'},
    'textures-512/': {'kind': 'derived (PIL LANCZOS 512px) from asset-authoring/yuyuan-entry/source-kit/textures 1K',
                      'why': 'glTF 导出会把 Non-Color 图重编码为 PNG，1K 集使 4 GLB 超字节预算；512px 后总字节入 2.5MB',
                      'colorMaps': 'JPEG q85', 'dataMaps': 'PNG optimize',
                      'generator': 'modules/corridor-kit/gen_textures.py'},
}, open(os.path.join(HERE, 'map-authoring.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

# ---------------------------------------------------------------- 重导入核对
EXPECT = {'corridor-tile': {'images': 2, 'colorspace': ['sRGB', 'Non-Color']},
          'corridor-timber': {'images': 2, 'colorspace': ['sRGB', 'Non-Color']},
          'corridor-stone': {'images': 2, 'colorspace': ['sRGB', 'Non-Color']},
          'corridor-lattice': {'images': 1, 'colorspace': ['sRGB']}}
reimport = {'checked': [], 'issues': []}
for oid in CFG:
    cfg = CFG[oid]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, cfg['glb']))
    new = [o for o in bpy.data.objects if o not in before]
    tri2 = 0
    for o in new:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            tri2 += len(o.data.loop_triangles)
    mats = {}
    for m in {m for o in new if o.type == 'MESH' for m in o.data.materials if m}:
        imgs = [n for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image]
        principled = [n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED']
        cs = [i.image.colorspace_settings.name for i in imgs]
        connected = all(n.outputs['Color'].is_linked or n.outputs['Alpha'].is_linked for n in imgs)
        exp = EXPECT.get(m.name)
        if exp and (len(imgs) != exp['images'] or sorted(cs) != sorted(exp['colorspace']) or len(principled) != 1 or not connected):
            reimport['issues'].append(f"{cfg['glb']}:{m.name}: images={len(imgs)} cs={cs} principled={len(principled)} connected={connected}")
        mats[m.name] = {'images': len(imgs), 'colorspace': cs, 'allConnected': connected}
    if tri2 != CATALOG['modules'][oid]['triangles']:
        reimport['issues'].append(f"{cfg['glb']}: tri mismatch reimport {tri2} vs export {CATALOG['modules'][oid]['triangles']}")
    reimport['checked'].append({'glb': cfg['glb'], 'reimportedMeshes': len([o for o in new if o.type == 'MESH']),
                                'triangles': tri2, 'materials': mats})
    for o in new:
        bpy.data.objects.remove(o)
json.dump(reimport, open(os.path.join(OUT, 'corridor-kit-reimport.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
if reimport['issues']:
    print('REIMPORT ISSUES', reimport['issues'])
    raise RuntimeError('reimport check failed')

print('TOTAL tris', tris_total, '/ 45000; bytes', CATALOG['totals']['bytes'], '/ 2500000')
if tris_total > 45000:
    raise RuntimeError('triangle budget exceeded')
if CATALOG['totals']['bytes'] > 2500000:
    raise RuntimeError('bytes budget exceeded')
print('BUILD DONE', round(time.time() - T0, 1), 's')
