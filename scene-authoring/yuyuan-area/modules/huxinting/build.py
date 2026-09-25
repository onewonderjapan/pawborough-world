"""湖心亭站点模块（WP9，work/wave1-huxinting-20260925）。世界坐标 GLB（同假山站点模块做法）：
glTF (x,y,z) = 地图 (x, 高度, z)，锚点 = footprint 面积形心（锚 empty 由 assemble.py 创建，模块网格不带变换）。

冻结规格（GOAL 2026-09-25）：位置 = baseline/layout.json 对象 huxin-ting 的 6 点 footprint（pond 区）；
台基灰色石承台顶 y=0.55（layout platformY）、石桩 0.4 m 方间距 ≈3 m 入水到 y=-0.6；主体两层
（一层 3.4 / 二层 3.0）歇山主楼 + 每层外廊深红木栏杆 + 格心长窗（全木构立面、少量白墙）；
一端（远离九曲桥）接方形攒尖塔亭（平面 4.2 m，比主楼高一层，鎏金宝顶 ≈12.0）；
临九曲桥一侧单层抱厦（歇山小顶）；匾额空板。屋面必须用 modules/shared/eave_kit.py（只读），
主楼出檐 1.1 / 出翘 0.3 / 起翘 0.8 / reach 2.0，塔亭攒尖 over 0.9；正脊 9.6 / 宝顶 12.0（design_inference）。
瓦色按灰瓦做（generated/0010-lead-QC.json：推理图偏蓝不照抄）。
九曲桥接口：承台边到桥折线最近点 ≤0.3 m（承台在桥侧外伸 2.3 m）。

局部系：u = 主轴（footprint 最长边方向，+u 指远离九曲桥的一端），+v = 临九曲桥一侧，h 向上。
(u,v,h) -> Blender (x,-z,h) 行列式 +1，保 eave_kit 面绕序/法线。
运行：blender -b -t 4 --python-exit-code 1 modules/huxinting/build.py   预算 ≤30k tris / ≤2.5 MB。
"""
import bpy, json, math, os, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
AREA = ROOT.parent.parent                      # scene-authoring/yuyuan-area
sys.path.insert(0, str(AREA / 'modules' / 'shared'))
import eave_kit

OUT_GLB = AREA / os.environ.get('OUT_DIR', 'out-zone') / 'huxin-ting.glb'   # 随管线 OUT_DIR（rebuild-review.sh 默认开启时调用）
OUT_GLB.parent.mkdir(parents=True, exist_ok=True)
LAYOUT = json.load(open(AREA / 'baseline' / 'layout.json', encoding='utf-8'))
HT = next(o for o in LAYOUT['objects'] if o['id'] == 'huxin-ting')

# ---------------------------------------------------------------- 冻结输入 ----
FP = HT['geometry']['footprint']
if FP[0] == FP[-1]:
    FP = FP[:-1]
PLATFORM_Y = HT['platformY']                  # 0.55

# footprint 面积形心（鞋带公式）与主轴（最长边方向，GOAL 冻结「长边方向为主轴」）
A2 = sum(FP[i][0] * FP[(i + 1) % len(FP)][1] - FP[(i + 1) % len(FP)][0] * FP[i][1] for i in range(len(FP)))
CX = sum((FP[i][0] + FP[(i + 1) % len(FP)][0]) * (FP[i][0] * FP[(i + 1) % len(FP)][1] - FP[(i + 1) % len(FP)][0] * FP[i][1])
         for i in range(len(FP))) / (3 * A2)
CZ = sum((FP[i][1] + FP[(i + 1) % len(FP)][1]) * (FP[i][0] * FP[(i + 1) % len(FP)][1] - FP[(i + 1) % len(FP)][0] * FP[i][1])
         for i in range(len(FP))) / (3 * A2)
L0, A0, B0 = max((math.hypot(FP[(i + 1) % len(FP)][0] - FP[i][0], FP[(i + 1) % len(FP)][1] - FP[i][1]), FP[i], FP[(i + 1) % len(FP)])
                 for i in range(len(FP)))
UX, UZ = (B0[0] - A0[0]) / L0, (B0[1] - A0[1]) / L0
if UX < 0:
    UX, UZ = -UX, -UZ
VX, VZ = UZ, -UX                               # 临桥侧为 +v；(u,v,h)->Blender(x,-z,h) det=+1

def loc_uv(px, pz):
    return ((px - CX) * UX + (pz - CZ) * UZ, (px - CX) * VX + (pz - CZ) * VZ)

LOC = [loc_uv(p[0], p[1]) for p in FP]
U0 = (max(q[0] for q in LOC) - min(q[0] for q in LOC)) / 2
V0 = (max(q[1] for q in LOC) - min(q[1] for q in LOC)) / 2

# ---------------------------------------------------------------- 设计值 ----
D = dict(
    deckSide=1.3, deckBridge=2.3,              # 承台外伸（临桥侧 2.3 接九曲桥，接口 ≤0.3 m）
    deckBot=0.30, pileSize=0.4, pileTop=PLATFORM_Y - 0.25, pileBot=-0.6, pileSpacing=3.0,
    st1=3.4, st2=3.0, st3=2.8,                 # 一层/二层/塔亭三层 层高（塔亭比主楼高一层）
    dadoH=0.95,                                # 一层白墙裙板高（少量白墙）
    win1=(1.60, 3.50), win2=(4.80, 6.20),      # 格心长窗带（一层 / 二层）
    # R2 瓦垄（几何）：沿每块瓦面（主楼 / 抱厦下檐四坡与上段两坡、塔亭攒尖与两道腰檐）顺坡做三角截面垄条，
    # 垄距 ≤0.33 m、垄宽 0.16、垄高 0.07（攒尖向宝顶收拢处随间距等比压低，间距 < 0.3 倍檐口间距处停）。
    wa=dict(pitch=0.33, halfW=0.08, h=0.07, sink=0.012, stopRatio=0.3),
    gallery=1.1, railH=1.05, picketGap=0.55,   # 外廊进深 = 主楼出檐（冻结 1.1）
    roof=dict(over=1.1, chu=0.3, qiao=0.8, reach=2.0, zEave=6.90, breakZ=7.90, ridgeZ=9.6,
              breakInset=0.8, gableInset=1.0, drop=0.55, tileH=0.18, boardH=0.30, curve=1.6, rings=7, ridgeEndLift=0.18,
              # R1：正脊 / 吻 / 戗脊按 eave_kit ornamentScale 缩放。'auto' 按进深 7.82/12 = 0.65 时吻端起翘
              # (0.18+0.9)*0.65 = 0.70 > 0.5 m 仍超限，故给实测定值 0.42：脊顶高出瓦面 0.13、吻起翘 0.45、戗脊截面 ≤0.25。
              ornamentScale=0.42),
    porch=dict(uHalf=2.2, depth=2.2, wallTop=3.05, zEave=3.00, breakZ=3.60, ridgeZ=4.60, drop=0.45,
               over=0.8, chu=0.18, qiao=0.45, reach=1.2, breakInset=0.5, gableInset=0.9,
               tileH=0.15, boardH=0.25, rings=6, ridgeEndLift=0.2,
               # 'auto'（进深 2.45 -> 夹到 0.35）过线，但正脊只有 1.6 m 长，吻起翘 0.38 占满全长，
               # 九曲桥眼高看仍是两只「猫耳」；给实测定值 0.25：吻起翘 0.27、中段约 0.35 m 平脊。
               ornamentScale=0.25),
    tower=dict(half=2.1, over=0.9, zEave=9.65, apex=11.40, finialTop=12.0, drop=0.55, tileH=0.16, boardH=0.26,
               chu=0.2, qiao=0.6, reach=1.4, curve=1.5, rings=6,
               skirt1=dict(z=3.85, over=0.7), skirt2=dict(z=6.75, over=0.7)),
    plaque=dict(w=2.4, h=0.55, z0=2.35),       # 匾额空板（无文字），抱厦前檐下
)
MATS = {'roof': 'ht-tile-grey', 'dark': 'ht-ridge-dark', 'wood': 'ht-wood-red', 'wall': 'ht-plaster-white'}
def srgb(hexstr):
    """sRGB 十六进制 -> Base Color 线性值（IEC 61966-2-1），glTF baseColorFactor 同为线性。"""
    out = []
    for i in (0, 2, 4):
        c = int(hexstr[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)

WOOD_SRGB = '6a2e22'     # R1 冻结：柱、枋、栏杆、格扇框、封檐板、博风统一深红木 sRGB #6a2e22
TILE_SRGB = '6e6f71'     # 灰瓦（0010 lead QC：湖心亭必须灰瓦，推理图偏蓝不照抄）
PALETTE = {
    # Base Color 输入为线性值；从 sRGB 十六进制换算（round-0 手填的线性近似值与此相差 < 0.001）
    'ht-tile-grey':     dict(rgb=srgb(TILE_SRGB), rough=0.85),
    'ht-ridge-dark':    dict(rgb=(0.045, 0.045, 0.050), rough=0.90),
    'ht-wood-red':      dict(rgb=srgb(WOOD_SRGB), rough=0.72),
    'ht-plaster-white': dict(rgb=(0.800, 0.780, 0.740), rough=0.90),
    'ht-stone-deck':    dict(rgb=(0.230, 0.225, 0.210), rough=0.90),
    'ht-stone-pile':    dict(rgb=(0.150, 0.147, 0.140), rough=0.92),
    'ht-gold':          dict(rgb=(0.820, 0.620, 0.230), rough=0.35, metal=0.9),
    'ht-win-dark':      dict(rgb=(0.020, 0.012, 0.010), rough=0.80),  # 匾额空板
    'ht-win-glass':     dict(rgb=srgb('8e9396'), rough=0.40),          # R1 格心后的窗玻璃（浅灰，衬出深色格心）
}

# ---------------------------------------------------------------- 场景/材质 ----
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
PART_STATS = {}
NGON = {}

def mat_new(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    cfg = PALETTE[name]
    p.inputs['Base Color'].default_value = (*cfg['rgb'], 1)
    p.inputs['Roughness'].default_value = cfg['rough']
    p.inputs['Metallic'].default_value = cfg.get('metal', 0)
    return m

MATS_ALL = {k: mat_new(k) for k in PALETTE}

# R1 格心：复用 hall-kit 的格心 alpha 贴图（同名同尺寸 160×160，assemble / export-zones 按「名称+尺寸」去重合并），
# 不另画。材质做法同 hall-kit hk-lattice-core：贴图 Color->Base Color、Alpha->Alpha，导出后改 MASK / cutoff 0.5。
LATTICE_PNG = AREA / 'modules' / 'hall-kit' / 'textures' / 'lattice-core-alpha.png'
LATTICE_CELL_M = 0.125                         # hall-kit cellM：1 UV = 1 m = 8 格

def lattice_material():
    img = bpy.data.images.load(str(LATTICE_PNG), check_existing=False)
    img.name = 'lattice-core-alpha'
    img.pack()
    m = bpy.data.materials.new('ht-lattice-core')
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    p = nodes.get('Principled BSDF')
    p.inputs['Roughness'].default_value = 0.7
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
    return m

MATS_ALL['ht-lattice-core'] = lattice_material()

def world(u, v, h):
    """本地 (u,v,h) -> 地图 (x,z) -> Blender (x,-z,h)。"""
    return (CX + u * UX + v * VX, -(CZ + u * UZ + v * VZ), h)

def mesh_obj(name, verts, faces, mat, part):
    for pre in ('huxin-ting__', 'ht__'):
        while name.startswith(pre):
            name = name[len(pre):]
    name = 'huxin-ting__' + name
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate(verbose=False)
    me.update()
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(MATS_ALL[mat])
    SC.collection.objects.link(ob)
    PART_STATS[part] = PART_STATS.get(part, 0) + sum(max(0, len(f) - 2) for f in faces)
    NGON[part] = NGON.get(part, 0) + 1
    return ob

def mesh_obj_uv(name, verts, faces, uvs, mat, part):
    """同 mesh_obj，另按顶点写 UV（uvs 与 verts 一一对应）。"""
    ob = mesh_obj(name, verts, faces, mat, part)
    me = ob.data
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            uv.data[li].uv = uvs[me.loops[li].vertex_index]
    return ob

def add_local(name, items, faces, material, part):
    """eave_kit 注入口：items=[((u,v,h),(uu,vv))]，局部系换算到 Blender 世界坐标。"""
    verts = [world(it[0][0], it[0][1], it[0][2]) for it in items]
    mesh_obj('huxin-ting__' + name, verts, [list(f) for f in faces], MATS[material], part)

ROOF_SURF = []                                 # R2：eave_kit 出的瓦面网格（局部系），屋面建完后逐块铺瓦垄

def add_local_rec(name, items, faces, material, part):
    add_local(name, items, faces, material, part)
    if material == 'roof' and re.search(r'-(lower|upper-[sn]|cone|tile)$', name):
        ROOF_SURF.append((name, [tuple(it[0]) for it in items], [tuple(f) for f in faces], part))

eave_kit.init(add_local_rec)


# ---------------------------------------------------------------- 瓦垄（R2）----
# eave_kit（主控只读）的瓦面都是规则网格：行 = 顺坡方向（檐口 / 折线 / 根部 → 脊 / 宝顶 / 檐口），列 = 沿檐方向。
# 行宽 S 从第一个面读（S = max(face0) - 1，环形与开口网格同式）；下檐四坡 / 攒尖 / 腰檐为环形（列首尾相接），上段两坡开口。
# 每个列间隔按檐口一行的宽度均分 n = round(宽 / pitch) 条垄，垄在参数空间里走（随瓦面曲率、翼角扇开、攒尖收拢）：
# 每行取左脚 / 垄顶 / 右脚三点，脚点沿瓦面法线下沉 sink（贴死瓦面不留缝），垄顶沿法线抬 h × min(1, 本行间距 / 檐口间距)。
# 截面为三角（两个斜面，一明一暗读出瓦垄 / 瓦沟），两端各一个三角封口（檐口端即瓦头）。同一瓦面的垄合成一个网格
# <瓦面名>-wa，材质同瓦面（ht-tile-grey）。
def _v3sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def _v3add(a, b, k=1.0): return (a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k)
def _v3lerp(a, b, t): return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)
def _v3len(a): return math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
def _v3cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def _v3dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def _v3norm(a):
    L = _v3len(a) or 1.0
    return (a[0] / L, a[1] / L, a[2] / L)

WA_STATS = {}

def tile_ridges(name, pts, faces, part):
    W = D['wa']
    S = max(faces[0]) - 1
    R = len(pts) // S
    closed = not re.search(r'-upper-[sn]$', name)
    eave_row = R - 1 if name.endswith('-tile') else 0          # 腰檐：行 0 = 墙根，末行 = 檐口
    P = [[pts[r * S + c] for c in range(S)] for r in range(R)]
    verts, fcs, nrib, length = [], [], 0, 0.0

    def tri(a, b, c, want):
        n = _v3cross(_v3sub(verts[b], verts[a]), _v3sub(verts[c], verts[a]))
        fcs.append([a, b, c] if _v3dot(n, want) >= 0 else [a, c, b])

    def quad(a, b, c, d, want):
        n = _v3cross(_v3sub(verts[b], verts[a]), _v3sub(verts[c], verts[a]))
        fcs.append([a, b, c, d] if _v3dot(n, want) >= 0 else [d, c, b, a])

    for c in range(S if closed else S - 1):
        c2 = (c + 1) % S
        w_e = _v3len(_v3sub(P[eave_row][c2], P[eave_row][c]))
        if w_e < 0.05:
            continue
        n = max(1, math.ceil(w_e / W['pitch'] - 0.05))            # 垄距 ≤ pitch（留 5% 取整余量）
        hw = min(W['halfW'] / w_e, 0.45 / n)                      # 参数半宽（檐口处 = halfW 米）
        for k in range(n):
            f = (k + 0.5) / n
            rows = []
            for r in range(R):
                a, b = P[r][c], P[r][c2]
                w_r = _v3len(_v3sub(b, a))
                ratio = w_r / w_e
                if ratio < W['stopRatio']:
                    break                                         # 攒尖向宝顶收拢：间距过密处停
                ra, rb = (r - 1 if r > 0 else r), (r + 1 if r < R - 1 else r)
                ts = _v3sub(_v3lerp(P[rb][c], P[rb][c2], f), _v3lerp(P[ra][c], P[ra][c2], f))
                nn = _v3norm(_v3cross(_v3sub(b, a), ts))
                if nn[2] < 0:
                    nn = (-nn[0], -nn[1], -nn[2])
                m = _v3lerp(a, b, f)
                la = _v3add(_v3lerp(a, b, f - hw), nn, -W['sink'])
                lb = _v3add(_v3lerp(a, b, f + hw), nn, -W['sink'])
                top = _v3add(m, nn, W['h'] * min(1.0, ratio))
                rows.append((la, top, lb, nn, ts))
            if len(rows) < 2:
                continue
            base = len(verts)
            for la, top, lb, _nn, _ts in rows:
                verts.extend((la, top, lb))
            for i in range(len(rows) - 1):
                i0, i1 = base + 3 * i, base + 3 * (i + 1)
                la, top, lb, nn, _ = rows[i]
                wa_ = _v3add(_v3norm(_v3sub(la, top)), nn, 0.3)
                wb_ = _v3add(_v3norm(_v3sub(lb, top)), nn, 0.3)
                quad(i0, i1, i1 + 1, i0 + 1, wa_)
                quad(i0 + 1, i1 + 1, i1 + 2, i0 + 2, wb_)
                length += _v3len(_v3sub(rows[i + 1][1], top))
            e0 = base
            e1 = base + 3 * (len(rows) - 1)
            tri(e0, e0 + 1, e0 + 2, tuple(-x for x in rows[0][4]))
            tri(e1, e1 + 1, e1 + 2, rows[-1][4])
            nrib += 1
    if fcs:
        add_local(name + '-wa', [(v, (0.0, 0.0)) for v in verts], fcs, 'roof', part)
    WA_STATS[name] = dict(ribs=nrib, ribLengthM=round(length, 2), rows=R, cols=S, closed=closed)

def prism(name, poly_uv, z0, z1, mat, part):
    """CCW 多边形拉伸；侧面 [a0,b0,b1,a1] 外法线 = 边右向（CCW 时朝外）。"""
    n = len(poly_uv)
    lo = [world(p[0], p[1], z0) for p in poly_uv]
    hi = [world(p[0], p[1], z1) for p in poly_uv]
    faces = []
    for i in range(n):
        k = (i + 1) % n
        faces.append([i, k, n + k, n + i])
    faces.append([n + i for i in range(n)])            # 顶面（高环，CCW -> 朝上）
    faces.append(list(range(n - 1, -1, -1)))           # 底面（低环，反序 -> 朝下）
    # round-0 两个端面都建在低环上（一正一反），顶面缺失：承台顶看上去落在 0.30 的底面上。R1 修正。
    return mesh_obj(name, lo + hi, faces, mat, part)

def box_uv(name, u0, v0, u1, v1, z0, z1, mat, part):
    u0, u1 = min(u0, u1), max(u0, u1)                  # 保证 CCW（round-0 dado-s 传入 v0>v1，整个盒子法线朝内）
    v0, v1 = min(v0, v1), max(v0, v1)
    return prism(name, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], z0, z1, mat, part)

# ---------------------------------------------------------------- 承台 + 石桩 ----
DECK = [(-(U0 + D['deckSide']), -(V0 + D['deckSide'])), (U0 + D['deckSide'], -(V0 + D['deckSide'])),
        (U0 + D['deckSide'], V0 + D['deckBridge']), (-(U0 + D['deckSide']), V0 + D['deckBridge'])]
prism('deck', DECK, D['deckBot'], PLATFORM_Y, 'ht-stone-deck', 'deck')
nu = max(2, math.ceil((DECK[1][0] - DECK[0][0]) / D['pileSpacing']))
nv = max(2, math.ceil((DECK[2][1] - DECK[1][1]) / D['pileSpacing']))
us = [DECK[0][0] + 0.8 + i * (DECK[1][0] - DECK[0][0] - 1.6) / (nu - 1) for i in range(nu)]
vs = [DECK[0][1] + 0.8 + i * (DECK[2][1] - DECK[0][1] - 1.6) / (nv - 1) for i in range(nv)]
for i, u in enumerate(us):
    for j, v in enumerate(vs):
        if 0 < i < nu - 1 and 0 < j < nv - 1 and (i + j) % 2 == 1:
            continue                            # 内部梅花形减桩（周边满排）
        box_uv('huxin-ting__pile-%d-%d' % (i, j), u - 0.2, v - 0.2, u + 0.2, v + 0.2,
               D['pileBot'], D['pileTop'], 'ht-stone-pile', 'piles')

# ---------------------------------------------------------------- 主楼（歇山两层）----
UW, UE = -U0, U0 - D['tower']['half'] * 2      # 主楼体块（东端 4.2 m 让塔亭）；体块东缘伸入塔亭墙内防缝
GAL = D['gallery']
gu0, gu1, gv0, gv1 = UW - GAL, UE + GAL, -V0 - GAL, V0 + GAL
prism('body1', [(UW + 0.12, -V0 + 0.12), (UE + 0.2, -V0 + 0.12), (UE + 0.2, V0 - 0.12), (UW + 0.12, V0 - 0.12)],
      PLATFORM_Y, PLATFORM_Y + D['st1'], 'ht-wood-red', 'body1')
box_uv('ht__dado-s', UW + 0.12, -V0 + 0.12, UE - 0.12, -V0 - 0.02, PLATFORM_Y, PLATFORM_Y + D['dadoH'], 'ht-plaster-white', 'body1')
box_uv('ht__dado-n', UW + 0.12, V0 - 0.12, UE - 0.12, V0 + 0.02, PLATFORM_Y, PLATFORM_Y + D['dadoH'], 'ht-plaster-white', 'body1')

# 一层外廊柱列（出檐线上；抱厦占用段跳过）
col_xy = []
n_u = int(round((UE - UW) / 1.55))
n_v = int(round((2 * V0) / 1.55))
for i in range(n_u + 1):
    u = UW + (UE - UW) * i / n_u
    col_xy.append((u, gv0))
    if abs(u) > 2.5:
        col_xy.append((u, gv1))
for j in range(1, n_v):
    v = -V0 + (2 * V0) * j / n_v
    col_xy.append((gu0, v)); col_xy.append((gu1, v))
for i, (u, v) in enumerate(col_xy):
    box_uv('huxin-ting__gcol-%d' % i, u - 0.11, v - 0.11, u + 0.11, v + 0.11,
           PLATFORM_Y, PLATFORM_Y + 3.0, 'ht-wood-red', 'gallery1')
# 额枋（R1）：外廊柱头一圈木枋，把柱列连成框（-v 面全长、西端面全长；+v 面只到抱厦屋面以西的柱；
# 东端柱列落在塔亭墙内，不做）。西端两角无角柱，枋延到西侧柱列线相交。截面 0.16 × 0.28，顶面 = 柱顶。
LT0, LT1 = PLATFORM_Y + 2.72, PLATFORM_Y + 3.0
u_cols_b = sorted(u for (u, v) in col_xy if abs(v - gv1) < 1e-6 and u < 0)
box_uv('huxin-ting__lintel-s', gu0 - 0.08, gv0 - 0.08, UE + 0.11, gv0 + 0.08, LT0, LT1, 'ht-wood-red', 'gallery1')
box_uv('huxin-ting__lintel-w', gu0 - 0.08, gv0 + 0.08, gu0 + 0.08, gv1 - 0.08, LT0, LT1, 'ht-wood-red', 'gallery1')
if len(u_cols_b) >= 2:
    box_uv('huxin-ting__lintel-n', gu0 - 0.08, gv1 - 0.08, u_cols_b[-1] + 0.11, gv1 + 0.08, LT0, LT1, 'ht-wood-red', 'gallery1')

def railing(prefix, u0, v0, u1, v1, z0, z1, skip=None):
    """矩形栏杆圈；skip=(side, s_lo, s_hi) 让段。side: 0=-v 1=+u 2=+v 3=-u，s 沿边方向。"""
    sides = [((u0, v0), (u1, v0), 0), ((u1, v0), (u1, v1), 1), ((u1, v1), (u0, v1), 2), ((u0, v1), (u0, v0), 3)]
    idx = 0
    for a, b, side in sides:
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 0.3:
            continue
        dx, dv = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        if skip and skip[0] == side:
            if skip[1] <= 0.05 and skip[2] >= L - 0.05:
                continue
            segs = [(0.0, skip[1]), (skip[2], L)] if (0.05 < skip[1] and skip[2] < L - 0.05) else \
                   ([(skip[2], L)] if skip[1] <= 0.05 else [(0.0, skip[1])])
        else:
            segs = [(0.0, L)]
        for s0, s1 in segs:
            segL = s1 - s0
            if segL < 0.25:
                continue
            ax, av = a[0] + dx * s0, a[1] + dv * s0
            bx, bv = a[0] + dx * s1, a[1] + dv * s1
            for zz, hh in ((z0, 0.07), (z0 + (z1 - z0) * 0.45, 0.06)):
                mu, mv = (ax + bx) / 2, (av + bv) / 2
                if abs(dx) > abs(dv):
                    box_uv('%s-rail-%d' % (prefix, idx), min(ax, bx), mv - 0.035, max(ax, bx), mv + 0.035, zz, zz + hh, 'ht-wood-red', 'railing')
                else:
                    box_uv('%s-rail-%d' % (prefix, idx), mu - 0.035, min(av, bv), mu + 0.035, max(av, bv), zz, zz + hh, 'ht-wood-red', 'railing')
                idx += 1
            npick = max(2, int(segL / D['picketGap']))
            for k in range(npick + 1):
                t = s0 + segL * k / npick
                pu, pv = a[0] + dx * t, a[1] + dv * t
                box_uv('%s-pick-%d-%d' % (prefix, idx, k), pu - 0.035, pv - 0.035, pu + 0.035, pv + 0.035, z0, z1, 'ht-wood-red', 'railing')
            idx += 1

railing('ht__r1', gu0, gv0, gu1, gv1, PLATFORM_Y + 0.05, PLATFORM_Y + D['railH'],
        skip=(2, gu1 - 3.2, gu1 + 3.2))          # 抱厦占用段（|u|≤3.2）

# ---------------------------------------------------------------- 格心窗（R1）----
# round-0 是「暗色窗底 + 3 根竖棂」，远看一根根竖条。R1：每开间分 2 扇格扇，每扇 = 边梃 2 + 上下抹头 + 中抹头
# （框料几何，深红木）+ 格心面（hall-kit 格心 alpha 贴图，UV 以米计）+ 下段夹堂 / 裙板（木板）；格心后衬浅灰窗玻璃。
# 同组全部窗合并成 frame / lattice / glass 三个网格（少节点、少 draw call）。
WIN = dict(frame=0.06, depth=0.09, latO=0.045, glassO=0.01, panelO=0.03, leafW=0.62)
WINBUF = {}

def _wbuf(group, kind):
    return WINBUF.setdefault((group, kind), dict(verts=[], faces=[], uvs=[]))

def _quad(buf, pts, want, uvs=None):
    """局部 (u,v,h) 四点面；按期望法线 want 自动定绕序（局部 -> Blender 行列式 +1，朝向保持）。"""
    a, b, c = pts[0], pts[1], pts[2]
    e1 = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    e2 = (c[0] - b[0], c[1] - b[1], c[2] - b[2])
    n = (e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0])
    uvs = list(uvs) if uvs else [(0.0, 0.0)] * 4
    if n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0:
        pts, uvs = pts[::-1], uvs[::-1]
    base = len(buf['verts'])
    buf['verts'].extend(world(*q) for q in pts)
    buf['uvs'].extend(uvs)
    buf['faces'].append([base, base + 1, base + 2, base + 3])

class Band:
    """窗带局部系：原点 (ua,va)，d = 带方向，n = 外法线（d 的左法线，同 round-0 约定）。"""
    def __init__(self, ua, va, ub, vb):
        self.L = math.hypot(ub - ua, vb - va)
        self.o = (ua, va)
        self.d = ((ub - ua) / self.L, (vb - va) / self.L)
        self.n = (-self.d[1], self.d[0])

    def P(self, s, o, z):
        return (self.o[0] + self.d[0] * s + self.n[0] * o, self.o[1] + self.d[1] * s + self.n[1] * o, z)

    def box(self, buf, s0, s1, o0, o1, z0, z1, sides):
        P, d, n = self.P, self.d, self.n
        F = {'front': ([P(s0, o1, z0), P(s1, o1, z0), P(s1, o1, z1), P(s0, o1, z1)], (n[0], n[1], 0)),
             'back': ([P(s0, o0, z0), P(s1, o0, z0), P(s1, o0, z1), P(s0, o0, z1)], (-n[0], -n[1], 0)),
             'top': ([P(s0, o0, z1), P(s1, o0, z1), P(s1, o1, z1), P(s0, o1, z1)], (0, 0, 1)),
             'bottom': ([P(s0, o0, z0), P(s1, o0, z0), P(s1, o1, z0), P(s0, o1, z0)], (0, 0, -1)),
             'left': ([P(s0, o0, z0), P(s0, o1, z0), P(s0, o1, z1), P(s0, o0, z1)], (-d[0], -d[1], 0)),
             'right': ([P(s1, o0, z0), P(s1, o1, z0), P(s1, o1, z1), P(s1, o0, z1)], (d[0], d[1], 0))}
        for k in sides:
            _quad(buf, *F[k])

    def plane(self, buf, s0, s1, o, z0, z1, facing, uv_m=False):
        pts = [self.P(s0, o, z0), self.P(s1, o, z0), self.P(s1, o, z1), self.P(s0, o, z1)]
        uvs = [(s0, z0), (s1, z0), (s1, z1), (s0, z1)] if uv_m else None     # 1 UV = 1 m（格心 8 格 / 米）
        want = (self.n[0] * facing, self.n[1] * facing, 0)
        _quad(buf, pts, want, uvs)

def leaf(band, group, s0, s1, z0, z1, kind='half', two_sided=False):
    """一扇格扇。kind='half'：半窗（下段矮夹堂板 0.16）；'door'：长窗 / 门（下 40% 裙板）。"""
    fb, D_, lo = WIN['frame'], WIN['depth'], WIN['latO']
    fr, lat = _wbuf(group, 'frame'), _wbuf(group, 'lattice')
    side3 = ('front', 'left', 'right') + (('back',) if two_sided else ())
    band.box(fr, s0, s0 + fb, 0, D_, z0, z1, side3 + ('top',))                  # 边梃
    band.box(fr, s1 - fb, s1, 0, D_, z0, z1, side3 + ('top',))
    rail = ('front', 'top', 'bottom') + (('back',) if two_sided else ())
    band.box(fr, s0 + fb, s1 - fb, 0, D_, z1 - fb, z1, rail)                    # 上抹头
    band.box(fr, s0 + fb, s1 - fb, 0, D_, z0, z0 + fb, rail)                    # 下抹头
    zm = z0 + fb + (0.16 if kind == 'half' else 0.40 * (z1 - z0 - 2 * fb))
    band.box(fr, s0 + fb, s1 - fb, 0, D_, zm, zm + fb * 0.8, rail)              # 中抹头
    band.plane(fr, s0 + fb, s1 - fb, WIN['panelO'], z0 + fb, zm, +1)            # 夹堂 / 裙板
    if two_sided:
        band.plane(fr, s0 + fb, s1 - fb, WIN['panelO'], z0 + fb, zm, -1)
    band.plane(lat, s0 + fb, s1 - fb, lo, zm + fb * 0.8, z1 - fb, +1, uv_m=True)  # 格心
    if two_sided:
        band.plane(lat, s0 + fb, s1 - fb, lo - 0.002, zm + fb * 0.8, z1 - fb, -1, uv_m=True)

def lattice_bay(band, group, a0, a1, z0, z1, kind='half', two_sided=False):
    """一个开间 [a0,a1]：分若干扇 + 一块窗玻璃衬底。"""
    n = max(1, int(round((a1 - a0) / WIN['leafW'])))
    for k in range(n):
        leaf(band, group, a0 + (a1 - a0) * k / n, a0 + (a1 - a0) * (k + 1) / n, z0, z1, kind, two_sided)
    gl = _wbuf(group, 'glass')
    band.plane(gl, a0, a1, WIN['glassO'], z0, z1, +1)
    if two_sided:
        band.plane(gl, a0, a1, WIN['glassO'] - 0.002, z0, z1, -1)

def win_row(prefix, ua, va, ub, vb, z0, z1, skip=None, group='main', two_sided=False):
    """沿 (ua,va)->(ub,vb) 带的格心窗（外法线 = 带方向左法线 (-dv,dx)，调用方向已按外向排）。
    skip=(s0,s1) 让段（沿带参数，米）。开间划分同 round-0（≈1.55 m 一间，两侧各留 0.14）。"""
    band = Band(ua, va, ub, vb)
    L = band.L
    if skip:
        if skip[0] <= 0.1 and skip[1] >= L - 0.1:
            return
        spans = [(0.0, skip[0]), (skip[1], L)] if (0.1 < skip[0] and skip[1] < L - 0.1) else \
                ([(skip[1], L)] if skip[0] <= 0.1 else [(0.0, skip[0])])
    else:
        spans = [(0.0, L)]
    for s0, s1 in spans:
        if s1 - s0 < 0.6:
            continue
        nb = max(1, int(round((s1 - s0) / 1.55)))
        for k in range(nb):
            a0 = s0 + (s1 - s0) * k / nb + 0.14
            a1 = s0 + (s1 - s0) * (k + 1) / nb - 0.14
            if a1 - a0 < 0.35:
                continue
            lattice_bay(band, group, a0, a1, z0, z1, 'half', two_sided)

def flush_windows():
    part_of = {'main': 'windows', 'tower': 'tower', 'porch': 'porch'}
    mat_of = {'frame': 'ht-wood-red', 'lattice': 'ht-lattice-core', 'glass': 'ht-win-glass'}
    for (group, kind), buf in sorted(WINBUF.items()):
        if not buf['faces']:
            continue
        name = 'huxin-ting__win-%s-%s' % (group, kind)
        if kind == 'lattice':                  # 只有格心面带 UV（框料 / 玻璃无贴图，不导出多余 TEXCOORD）
            mesh_obj_uv(name, buf['verts'], buf['faces'], buf['uvs'], mat_of[kind], part_of[group])
        else:
            mesh_obj(name, buf['verts'], buf['faces'], mat_of[kind], part_of[group])

W1A, W1B = D['win1']
W2A, W2B = D['win2']
win_row('ht__w1s', UE - 0.14, -V0 + 0.05, UW + 0.14, -V0 + 0.05, W1A, W1B)     # -v 面（反向调用 → 外法线 -v）
sP0, sP1 = -2.5 - (UW + 0.14), 2.5 - (UW + 0.14)
win_row('ht__w1b', UW + 0.14, V0 - 0.05, UE - 0.14, V0 - 0.05, W1A, W1B, skip=(sP0, sP1))  # +v 面，抱厦段让
win_row('ht__w1w', UW + 0.05, -V0 + 0.14, UW + 0.05, V0 - 0.14, W1A, W1B)      # 西端面

# 二层：楼板边带 + 全木构窗带 + 外廊栏杆（东面正对塔亭，做环绕塔亭的窄廊）
box_uv('ht__floor2', UW - 0.95, -V0 - 0.95, UE + 0.95, V0 + 0.95,
       PLATFORM_Y + D['st1'] - 0.09, PLATFORM_Y + D['st1'], 'ht-wood-red', 'body2')
prism('body2', [(UW + 0.12, -V0 + 0.12), (UE + 0.2, -V0 + 0.12), (UE + 0.2, V0 - 0.12), (UW + 0.12, V0 - 0.12)],
      PLATFORM_Y + D['st1'], PLATFORM_Y + D['st1'] + D['st2'], 'ht-wood-red', 'body2')
win_row('ht__w2s', UE - 0.14, -V0 + 0.05, UW + 0.14, -V0 + 0.05, W2A, W2B)
win_row('ht__w2b', UW + 0.14, V0 - 0.05, UE - 0.14, V0 - 0.05, W2A, W2B)
win_row('ht__w2w', UW + 0.05, -V0 + 0.14, UW + 0.05, V0 - 0.14, W2A, W2B)
railing('ht__r2', UW - 0.9, -V0 - 0.9, UE + 0.9, V0 + 0.9, PLATFORM_Y + D['st1'] + 0.05, PLATFORM_Y + D['st1'] + D['railH'],
        skip=(2, UE + 0.9 - 3.2, UE + 0.9 + 3.2))   # 抱厦屋面上方段

# ---------------------------------------------------------------- 抱厦（临桥侧单层歇山小顶 + 匾额空板）----
PU, PD, PT = D['porch']['uHalf'], D['porch']['depth'], D['porch']['wallTop']
prism('porch-floor', [(-PU, V0 - 0.05), (PU, V0 - 0.05), (PU, V0 + PD), (-PU, V0 + PD)], D['deckBot'], PLATFORM_Y + 0.02, 'ht-wood-red', 'porch')
for i, u in enumerate((-PU + 0.1, -0.75, 0.75, PU - 0.1)):
    box_uv('huxin-ting__pcol-%d' % i, u - 0.09, V0 + PD - 0.18, u + 0.09, V0 + PD, PLATFORM_Y, PT - 0.05, 'ht-wood-red', 'porch')
box_uv('ht__pwall-w', -PU, V0, -PU + 0.18, V0 + PD, PLATFORM_Y, PT, 'ht-wood-red', 'porch')
box_uv('ht__pwall-e', PU - 0.18, V0, PU, V0 + PD, PLATFORM_Y, PT, 'ht-wood-red', 'porch')
# 门开在主楼 +v 墙面（抱厦正后方），暗色门扇 + 木框
# 门：4 扇长窗（下 40% 裙板、上格心），门框 pframe 不变
lattice_bay(Band(-1.15, V0 + 0.03, 1.15, V0 + 0.03), 'porch', 0.0, 2.30, PLATFORM_Y + 0.02, PLATFORM_Y + 2.25, 'door')
box_uv('ht__pframe-l', -1.35, V0 - 0.12, -1.15, V0 + 0.16, PLATFORM_Y, PLATFORM_Y + 2.45, 'ht-wood-red', 'porch')
box_uv('ht__pframe-r', 1.15, V0 - 0.12, 1.35, V0 + 0.16, PLATFORM_Y, PLATFORM_Y + 2.45, 'ht-wood-red', 'porch')
box_uv('ht__pframe-t', -1.35, V0 - 0.12, 1.35, V0 + 0.16, PLATFORM_Y + 2.25, PLATFORM_Y + 2.45, 'ht-wood-red', 'porch')
# 抱厦前檐窗：前面无墙，窗扇悬在柱间，做双面（从抱厦里看也有框、格心、玻璃）
win_row('ht__pwin-w', -PU + 0.30, V0 + PD - 0.05, -0.30, V0 + PD - 0.05, PLATFORM_Y + 0.95, PLATFORM_Y + 2.40, group='porch', two_sided=True)
win_row('ht__pwin-e', 0.30, V0 + PD - 0.05, PU - 0.30, V0 + PD - 0.05, PLATFORM_Y + 0.95, PLATFORM_Y + 2.40, group='porch', two_sided=True)
PQ = D['plaque']
box_uv('ht__plaque', -PQ['w'] / 2, V0 + PD - 0.34, PQ['w'] / 2, V0 + PD - 0.28, PQ['z0'], PQ['z0'] + PQ['h'], 'ht-win-dark', 'porch')
box_uv('ht__plaque-t', -PQ['w'] / 2 - 0.06, V0 + PD - 0.35, PQ['w'] / 2 + 0.06, V0 + PD - 0.27, PQ['z0'] + PQ['h'], PQ['z0'] + PQ['h'] + 0.06, 'ht-wood-red', 'porch')
box_uv('ht__plaque-b', -PQ['w'] / 2 - 0.06, V0 + PD - 0.35, PQ['w'] / 2 + 0.06, V0 + PD - 0.27, PQ['z0'] - 0.06, PQ['z0'], 'ht-wood-red', 'porch')

# ---------------------------------------------------------------- 塔亭（+u 端，方形攒尖，比主楼高一层）----
TU0, TU1 = UE, U0
TV0, TV1 = -D['tower']['half'], D['tower']['half']
tw = D['tower']
tiers = [(PLATFORM_Y, PLATFORM_Y + D['st1']), (PLATFORM_Y + D['st1'], PLATFORM_Y + D['st1'] + D['st2']),
         (PLATFORM_Y + D['st1'] + D['st2'], PLATFORM_Y + D['st1'] + D['st2'] + D['st3'])]
for ti, (z0, z1) in enumerate(tiers):
    prism('tower%d' % ti, [(TU0 + 0.12, TV0 + 0.12), (TU1 - 0.12, TV0 + 0.12), (TU1 - 0.12, TV1 - 0.12), (TU0 + 0.12, TV1 - 0.12)],
          z0, z1, 'ht-wood-red', 'tower')
    wa, wb = z0 + 1.0, z1 - 0.55
    win_row('ht__tw%d-s' % ti, TU1 - 0.2, TV0 + 0.06, TU0 + 0.2, TV0 + 0.06, wa, wb, group='tower')
    win_row('ht__tw%d-n' % ti, TU0 + 0.2, TV1 - 0.06, TU1 - 0.2, TV1 - 0.06, wa, wb, group='tower')
    win_row('ht__tw%d-e' % ti, TU1 - 0.06, TV1 - 0.2, TU1 - 0.06, TV0 + 0.2, wa, wb, group='tower')
    if ti > 0:
        win_row('ht__tw%d-w' % ti, TU0 + 0.06, TV0 + 0.2, TU0 + 0.06, TV1 - 0.2, wa, wb, group='tower')
for si, sk in enumerate((tw['skirt1'], tw['skirt2'])):
    eave_kit.eave_skirt('towerskirt%d' % si,
                        [(TU0 - 0.05, TV0 - 0.05), (TU1 + 0.05, TV0 - 0.05), (TU1 + 0.05, TV1 + 0.05), (TU0 - 0.05, TV1 + 0.05)],
                        sk['z'], dict(over=sk['over'], chu=tw['chu'], qiao=tw['qiao'], reach=tw['reach'], drop=tw['drop'],
                                      tileH=tw['tileH'], boardH=tw['boardH'], curve=tw['curve'], rootRise=0.55), 'tower')
eave_kit.zanjian_roof('towerroof', (TU0, TU1, TV0, TV1), tw['zEave'], tw['apex'],
                      dict(over=tw['over'], chu=tw['chu'], qiao=tw['qiao'], reach=tw['reach'], drop=tw['drop'],
                           tileH=tw['tileH'], boardH=tw['boardH'], curve=tw['curve'], rings=tw['rings'],
                           ornamentScale='auto'), 'tower')   # 攒尖无正脊 / 吻，eave_kit 不读该参数；统一传入备查
cu, cv = (TU0 + TU1) / 2, (TV0 + TV1) / 2
bx, by, _ = world(cu, cv, 0)
bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=0.34, radius2=0.12, depth=0.42, location=(bx, by, tw['apex'] + 0.16))
ob = bpy.context.object; ob.name = 'huxin-ting__finial-base'; ob.data.materials.append(MATS_ALL['ht-gold']); ob.data.shade_flat()
PART_STATS['finial'] = PART_STATS.get('finial', 0) + sum(len(p.vertices) - 2 for p in ob.data.polygons)
bpy.ops.mesh.primitive_uv_sphere_add(segments=14, ring_count=9, radius=0.40, location=(bx, by, tw['finialTop'] - 0.40))
ob = bpy.context.object; ob.name = 'huxin-ting__finial-ball'; ob.data.materials.append(MATS_ALL['ht-gold']); ob.data.shade_flat()
PART_STATS['finial'] = PART_STATS.get('finial', 0) + sum(len(p.vertices) - 2 for p in ob.data.polygons)

# ---------------------------------------------------------------- 屋面（eave_kit；主楼参数冻结）----
eave_kit.xieshan_roof('mainroof', (UW, UE, -V0, V0), D['roof']['zEave'], D['roof'], 'roof')
po = D['porch']
eave_kit.xieshan_roof('porchroof', (-PU, PU, V0 - 0.25, V0 + PD), po['zEave'],
                      dict(over=po['over'], chu=po['chu'], qiao=po['qiao'], reach=po['reach'], zEave=po['zEave'],
                           breakZ=po['breakZ'], ridgeZ=po['ridgeZ'], breakInset=po['breakInset'], gableInset=po['gableInset'],
                           drop=po['drop'], tileH=po['tileH'], boardH=po['boardH'], curve=1.6, rings=po['rings'],
                           ridgeEndLift=po['ridgeEndLift'], ornamentScale=po['ornamentScale']), 'porch')

# R2 瓦垄：全部 eave_kit 屋面建完后逐块铺
for _nm, _pts, _fcs, _part in ROOF_SURF:
    tile_ridges(_nm, _pts, _fcs, _part)

flush_windows()

# ---------------------------------------------------------------- 导出 + 记录 ----
for ob in bpy.data.objects:
    ob.select_set(ob.name.startswith('huxin-ting__'))
bpy.ops.export_scene.gltf(filepath=str(OUT_GLB), export_format='GLB', export_yup=True, use_selection=True)

# 格心材质导出兜底为 MASK + cutoff 0.5（Blender 4.5 会写成 BLEND；同 hall-kit build_hall.py）
buf = bytearray(open(OUT_GLB, 'rb').read())
jl = int.from_bytes(buf[12:16], 'little')
gj = json.loads(bytes(buf[20:20 + jl]))
bl_off = 20 + jl
bl = int.from_bytes(buf[bl_off:bl_off + 4], 'little')
bindata = bytes(buf[bl_off + 8:bl_off + 8 + bl])
for mm in gj.get('materials', []):
    if mm.get('name') == 'ht-lattice-core':
        mm['alphaMode'] = 'MASK'
        mm['alphaCutoff'] = 0.5
nj = json.dumps(gj, separators=(',', ':')).encode()
nj += b' ' * ((-len(nj)) % 4)
open(OUT_GLB, 'wb').write(b'glTF' + (2).to_bytes(4, 'little') + (12 + 8 + len(nj) + 8 + bl).to_bytes(4, 'little')
                          + len(nj).to_bytes(4, 'little') + b'JSON' + nj
                          + bl.to_bytes(4, 'little') + b'BIN\x00' + bindata)
print('exported', OUT_GLB, os.path.getsize(OUT_GLB), 'bytes')

tris = sum(PART_STATS.values())
rec = dict(
    id='huxin-ting', glb='<OUT_DIR>/huxin-ting.glb', bytes=os.path.getsize(OUT_GLB), tris=tris,
    partTriCounts=PART_STATS, partObjectCounts=NGON,
    tileRidges=WA_STATS,
    frame=dict(centroid=[round(CX, 6), round(CZ, 6)], axis=[round(UX, 6), round(UZ, 6)], normal=[round(VX, 6), round(VZ, 6)],
               rectHalfU=round(U0, 4), rectHalfV=round(V0, 4),
               centroidRule='footprint area centroid (shoelace)', axisRule='longest footprint edge, +u away from bridge',
               vRule='+v = bridge side (jiuqu-bridge polyline near-run)'),
    designValues=D,
    heights=dict(platformY=PLATFORM_Y, storey1Top=PLATFORM_Y + D['st1'], storey2Top=PLATFORM_Y + D['st1'] + D['st2'],
                 mainRidgeZ=D['roof']['ridgeZ'], towerApex=tw['apex'], finialTop=tw['finialTop']),
    bridge=dict(polylineRef='baseline/layout.json jiuqu-bridge.polyline', deckBridgeMargin=D['deckBridge'],
                tolerance=0.3, note='deck edge to nearest bridge polyline vertex ≤0.3 m; tested in tests/huxinting-test.mjs'),
    materials={k: v['rgb'] for k, v in PALETTE.items()},
    eaveKit='modules/shared/eave_kit.py (lead-owned, read-only)',
)
json.dump(rec, open(ROOT / 'records.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('TRIS', tris, 'PARTS', sum(NGON.values()))
print('BUILD_DONE')
