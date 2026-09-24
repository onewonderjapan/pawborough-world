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
import bpy, json, math, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
AREA = ROOT.parent.parent                      # scene-authoring/yuyuan-area
sys.path.insert(0, str(AREA / 'modules' / 'shared'))
import eave_kit

OUT_GLB = AREA / 'out-zone' / 'huxin-ting.glb'
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
    gallery=1.1, railH=1.05, picketGap=0.55,   # 外廊进深 = 主楼出檐（冻结 1.1）
    roof=dict(over=1.1, chu=0.3, qiao=0.8, reach=2.0, zEave=6.90, breakZ=7.90, ridgeZ=9.6,
              breakInset=0.8, gableInset=1.0, drop=0.55, tileH=0.18, boardH=0.30, curve=1.6, rings=7, ridgeEndLift=0.18),
    porch=dict(uHalf=2.2, depth=2.2, wallTop=3.05, zEave=3.00, breakZ=3.60, ridgeZ=4.60, drop=0.45,
               over=0.8, chu=0.18, qiao=0.45, reach=1.2, breakInset=0.5, gableInset=0.9,
               tileH=0.15, boardH=0.25, rings=6, ridgeEndLift=0.2),
    tower=dict(half=2.1, over=0.9, zEave=9.65, apex=11.40, finialTop=12.0, drop=0.55, tileH=0.16, boardH=0.26,
               chu=0.2, qiao=0.6, reach=1.4, curve=1.5, rings=6,
               skirt1=dict(z=3.85, over=0.7), skirt2=dict(z=6.75, over=0.7)),
    plaque=dict(w=2.4, h=0.55, z0=2.35),       # 匾额空板（无文字），抱厦前檐下
)
MATS = {'roof': 'ht-tile-grey', 'dark': 'ht-ridge-dark', 'wood': 'ht-wood-red', 'wall': 'ht-plaster-white'}
PALETTE = {
    # Base Color 输入为线性值；深红栗木 = sansuitang tint 6a2e22 的线性值
    'ht-tile-grey':     dict(rgb=(0.155, 0.158, 0.165), rough=0.85),  # 灰瓦（0010 lead QC：不照抄推理图的蓝瓦）
    'ht-ridge-dark':    dict(rgb=(0.045, 0.045, 0.050), rough=0.90),
    'ht-wood-red':      dict(rgb=(0.145, 0.027, 0.016), rough=0.72),  # 深红栗木（6a2e22 线性）
    'ht-plaster-white': dict(rgb=(0.800, 0.780, 0.740), rough=0.90),
    'ht-stone-deck':    dict(rgb=(0.230, 0.225, 0.210), rough=0.90),
    'ht-stone-pile':    dict(rgb=(0.150, 0.147, 0.140), rough=0.92),
    'ht-gold':          dict(rgb=(0.820, 0.620, 0.230), rough=0.35, metal=0.9),
    'ht-win-dark':      dict(rgb=(0.020, 0.012, 0.010), rough=0.80),  # 格心长窗底 + 匾额空板
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

def add_local(name, items, faces, material, part):
    """eave_kit 注入口：items=[((u,v,h),(uu,vv))]，局部系换算到 Blender 世界坐标。"""
    verts = [world(it[0][0], it[0][1], it[0][2]) for it in items]
    mesh_obj('huxin-ting__' + name, verts, [list(f) for f in faces], MATS[material], part)

eave_kit.init(add_local)

def prism(name, poly_uv, z0, z1, mat, part):
    """CCW 多边形拉伸；侧面 [a0,b0,b1,a1] 外法线 = 边右向（CCW 时朝外）。"""
    n = len(poly_uv)
    lo = [world(p[0], p[1], z0) for p in poly_uv]
    hi = [world(p[0], p[1], z1) for p in poly_uv]
    faces = []
    for i in range(n):
        k = (i + 1) % n
        faces.append([i, k, n + k, n + i])
    faces.append(list(range(n)))
    faces.append(list(range(n - 1, -1, -1)))
    return mesh_obj(name, lo + hi, faces, mat, part)

def box_uv(name, u0, v0, u1, v1, z0, z1, mat, part):
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

def win_row(prefix, ua, va, ub, vb, z0, z1, skip=None):
    """沿 (ua,va)->(ub,vb) 带的格心长窗（外法线 = 带方向左法线 (-dv,dx)，调用方向已按外向排）。
    skip=(s0,s1) 让段（沿带参数，米）。"""
    L = math.hypot(ub - ua, vb - va)
    dx, dv = (ub - ua) / L, (vb - va) / L
    if skip:
        if skip[0] <= 0.1 and skip[1] >= L - 0.1:
            return
        spans = [(0.0, skip[0]), (skip[1], L)] if (0.1 < skip[0] and skip[1] < L - 0.1) else \
                ([(skip[1], L)] if skip[0] <= 0.1 else [(0.0, skip[0])])
    else:
        spans = [(0.0, L)]
    idx = 0
    for s0, s1 in spans:
        if s1 - s0 < 0.6:
            continue
        nb = max(1, int(round((s1 - s0) / 1.55)))
        for k in range(nb):
            a0 = s0 + (s1 - s0) * k / nb + 0.14
            a1 = s0 + (s1 - s0) * (k + 1) / nb - 0.14
            if a1 - a0 < 0.35:
                continue
            wu0, wv0 = ua + dx * a0, va + dv * a0
            wu1, wv1 = ua + dx * a1, va + dv * a1
            ou, ov = -dv, dx                  # 外法线
            wu1o, wv1o = wu1 + ou * 0.09, wv1 + ov * 0.09
            if abs(dx) > abs(dv):
                box_uv('%s-%d-%d' % (prefix, idx, k), min(wu0, wu1), min(wv0, wv1o), max(wu0, wu1), max(wv0, wv1o), z0, z1, 'ht-win-dark', 'windows')
                for m in range(3):
                    mu = wu0 + (wu1 - wu0) * (m + 1) / 4
                    box_uv('%s-m%d-%d-%d' % (prefix, idx, k, m), mu - 0.025, min(wv0, wv1o) - 0.02, mu + 0.025, max(wv0, wv1o) + 0.02, z0, z1, 'ht-wood-red', 'windows')
            else:
                box_uv('%s-%d-%d' % (prefix, idx, k), min(wu0, wu1o), min(wv0, wv1), max(wu0, wu1o), max(wv0, wv1), z0, z1, 'ht-win-dark', 'windows')
                for m in range(3):
                    mv = wv0 + (wv1 - wv0) * (m + 1) / 4
                    box_uv('%s-m%d-%d-%d' % (prefix, idx, k, m), min(wu0, wu1o) - 0.02, mv - 0.025, max(wu0, wu1o) + 0.02, mv + 0.025, z0, z1, 'ht-wood-red', 'windows')
        idx += 1

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
box_uv('ht__pdoor', -1.15, V0 - 0.10, 1.15, V0 + 0.14, PLATFORM_Y + 0.08, PLATFORM_Y + 2.25, 'ht-win-dark', 'porch')
box_uv('ht__pframe-l', -1.35, V0 - 0.12, -1.15, V0 + 0.16, PLATFORM_Y, PLATFORM_Y + 2.45, 'ht-wood-red', 'porch')
box_uv('ht__pframe-r', 1.15, V0 - 0.12, 1.35, V0 + 0.16, PLATFORM_Y, PLATFORM_Y + 2.45, 'ht-wood-red', 'porch')
box_uv('ht__pframe-t', -1.35, V0 - 0.12, 1.35, V0 + 0.16, PLATFORM_Y + 2.25, PLATFORM_Y + 2.45, 'ht-wood-red', 'porch')
win_row('ht__pwin-w', -PU + 0.30, V0 + PD - 0.05, -0.30, V0 + PD - 0.05, PLATFORM_Y + 0.95, PLATFORM_Y + 2.40)
win_row('ht__pwin-e', 0.30, V0 + PD - 0.05, PU - 0.30, V0 + PD - 0.05, PLATFORM_Y + 0.95, PLATFORM_Y + 2.40)
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
    win_row('ht__tw%d-s' % ti, TU1 - 0.2, TV0 + 0.06, TU0 + 0.2, TV0 + 0.06, wa, wb)
    win_row('ht__tw%d-n' % ti, TU0 + 0.2, TV1 - 0.06, TU1 - 0.2, TV1 - 0.06, wa, wb)
    win_row('ht__tw%d-e' % ti, TU1 - 0.06, TV1 - 0.2, TU1 - 0.06, TV0 + 0.2, wa, wb)
    if ti > 0:
        win_row('ht__tw%d-w' % ti, TU0 + 0.06, TV0 + 0.2, TU0 + 0.06, TV1 - 0.2, wa, wb)
for si, sk in enumerate((tw['skirt1'], tw['skirt2'])):
    eave_kit.eave_skirt('towerskirt%d' % si,
                        [(TU0 - 0.05, TV0 - 0.05), (TU1 + 0.05, TV0 - 0.05), (TU1 + 0.05, TV1 + 0.05), (TU0 - 0.05, TV1 + 0.05)],
                        sk['z'], dict(over=sk['over'], chu=tw['chu'], qiao=tw['qiao'], reach=tw['reach'], drop=tw['drop'],
                                      tileH=tw['tileH'], boardH=tw['boardH'], curve=tw['curve'], rootRise=0.55), 'tower')
eave_kit.zanjian_roof('towerroof', (TU0, TU1, TV0, TV1), tw['zEave'], tw['apex'],
                      dict(over=tw['over'], chu=tw['chu'], qiao=tw['qiao'], reach=tw['reach'], drop=tw['drop'],
                           tileH=tw['tileH'], boardH=tw['boardH'], curve=tw['curve'], rings=tw['rings']), 'tower')
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
                           ridgeEndLift=po['ridgeEndLift']), 'porch')

# ---------------------------------------------------------------- 导出 + 记录 ----
for ob in bpy.data.objects:
    ob.select_set(ob.name.startswith('huxin-ting__'))
bpy.ops.export_scene.gltf(filepath=str(OUT_GLB), export_format='GLB', export_yup=True, use_selection=True)
print('exported', OUT_GLB, os.path.getsize(OUT_GLB), 'bytes')

tris = sum(PART_STATS.values())
rec = dict(
    id='huxin-ting', glb='out-zone/huxin-ting.glb', bytes=os.path.getsize(OUT_GLB), tris=tris,
    partTriCounts=PART_STATS, partObjectCounts=NGON,
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
