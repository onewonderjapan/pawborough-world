"""hall-kit —— 园区厅/楼/轩/台统一生成器（Fable WP8；样板：仰山堂 bld-428179902）。

30 座程序化厅/楼/轩/台由本生成器按 layout 对象字段批量重建，仰山堂只是第一栋样板。
参数全部来自 layout 对象（footprint、height、eave、rise、roofMode、storeys、platformY、
facade.dir），缺字段时取 modules/hall-kit/defaults.json；生成器里不写任何一栋楼的专有数字。

平面（GOAL 冻结规格）：footprint 取最小面积外接矩形作主体，墙线内缩 wallInset(0.3)；
台基 = 主体矩形外扩 platformOut(0.2)、高 platformY(缺省 0.45)。柱网开间压在 bayMin–bayMax
（3.2–3.8 m），开间数 = round(墙线宽 / bayTarget)。

屋面（必须用 modules/shared/eave_kit.py，主控构件只读）：
- roofMode=gabled → 硬山：两坡凹曲屋面 + 两端山墙封到屋面线，出檐只在前后两坡
  （前后檐口断面同 eave_kit.eave_skirt：瓦头 tileH + 封檐板 boardH + 檐底下回墙；
  eave_kit 没有 硬山 封闭环构件，两坡主体与前后檐口断面在本文件实现，断比参数取 defaults）；
- hip / 其他 → 歇山：eave_kit.xieshan_roof（kit 全套：下檐腰檐 + 上段两坡 + 山花博风 + 正脊戗脊）；
- 起翘 eaveRise(0.6) 只给歇山，硬山不起翘；出檐 eaveOver(1.0) 两种都一样；
- 斗拱简化件用 eave_kit.brackets，柱位一圈，两种屋面都放。

立面：facade.dir 一侧整面格扇（每开间 6–8 扇，深红木框 + 格心 alpha），另三面白墙 +
少量格心半窗 + 青砖勒脚；檐下额枋一道。

预算：单栋 ≤ budgetTris(10000)。storeys≠1 时本版按单层生成并在 recipe 记 storeysIgnored
（批量升级前由主控定多层剖面）。

坐标契约：GLB Y-up、立面 +Z 朝 facade.dir；模块原点 = footprint 多边形面积形心
（GOAL 冻结的放置公式），assemble.py 把锚点放在同一形心、rotY = atan2(dir.x, dir.z)。
collision.json 为实例坐标（同 sansuitang 契约），assemble 同式变换出世界记录。

运行：blender -b -t 4 --python-exit-code 1 -P modules/hall-kit/build_hall.py -- --id bld-428179902
（--layout 缺省 OUT_DIR/layout.json，否则 baseline/layout.json；--out 缺省 out-garden-kits/hallkit-<id>）
"""
import argparse
import json
import math
import os
import sys
import time

import bpy
import bmesh
from mathutils import Matrix

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
AREA = os.path.dirname(os.path.dirname(HERE))          # scene-authoring/yuyuan-area
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'shared'))   # modules/shared —— eave_kit（主控构件，只读）
import eave_kit                                         # noqa: E402  主控构件，只读
sys.path.insert(0, HERE)
import frame as hk_frame                                # noqa: E402  放置/朝向公式（build/assemble/render 共用）

DEFAULTS = json.load(open(os.path.join(HERE, 'defaults.json'), encoding='utf-8'))

bpy.ops.wm.read_factory_settings(use_empty=True)   # 清默认场景（Cube 会混进导出）

# ------------------------------------------------------------ 参数解析 ----
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--id', default=os.environ.get('HALL_KIT_ID', 'bld-428179902'))
ap.add_argument('--layout', default=os.environ.get('HALL_KIT_LAYOUT', ''))
ap.add_argument('--out', default='')
args = ap.parse_args(argv)

HALL_ID = args.id
if args.layout:
    LAYOUT_PATH = os.path.abspath(args.layout)
else:
    cand = [os.path.join(AREA, os.environ.get('OUT_DIR', 'out'), 'layout.json'),
            os.path.join(AREA, 'baseline', 'layout.json')]
    LAYOUT_PATH = next((p for p in cand if os.path.exists(p)), None)
    if not LAYOUT_PATH:
        raise SystemExit('hall-kit: no layout.json (set --layout or run scripts/repair-layout.py first)')
LAYOUT = json.load(open(LAYOUT_PATH, encoding='utf-8'))
OBJ = next((o for o in LAYOUT['objects'] if o['id'] == HALL_ID), None)
if OBJ is None:
    raise SystemExit('hall-kit: %s not in %s' % (HALL_ID, LAYOUT_PATH))

OUT_DIR = os.path.abspath(args.out) if args.out else os.path.join(
    AREA, 'out-garden-kits', 'hallkit-' + HALL_ID)
os.makedirs(OUT_DIR, exist_ok=True)

# ---------------------------------------------------------- layout 字段 ----
def dval(key):
    v = OBJ.get(key, DEFAULTS.get(key))
    return DEFAULTS.get(key) if v is None else v

fp_raw = OBJ['geometry']['footprint']
FP = [tuple(p) for p in (fp_raw[:-1] if fp_raw[0] == fp_raw[-1] else fp_raw)]
HEIGHT, EAVE, RISE = float(dval('height')), float(dval('eave')), float(dval('rise'))
ROOF_MODE = str(dval('roofMode'))
STOREYS = int(dval('storeys'))
KIND = OBJ.get('kind', 'hall')
KCFG = DEFAULTS['kinds'].get(KIND, DEFAULTS['kinds']['hall'])
# 台基高：layout 字段 > kinds.<kind>.platformY（戏台 1.2，designInference）> defaults.platformY
PLATFORM_Y = float(OBJ['platformY']) if OBJ.get('platformY') is not None else float(KCFG.get('platformY', DEFAULTS['platformY']))
PLATFORM_INFERRED = OBJ.get('platformY') is None and 'platformY' in KCFG
MODE = {'front': KCFG['front'], 'back': KCFG['back'], 'left': KCFG['sides'], 'right': KCFG['sides']}

WALL_T = DEFAULTS['wallThickness']
INSET = DEFAULTS['wallInset']
P_OUT = DEFAULTS['platformOut']
OVER, QIAO = DEFAULTS['eaveOver'], DEFAULTS['eaveRise']
DROP, TILE_H, BOARD_H = DEFAULTS['eaveDrop'], DEFAULTS['tileH'], DEFAULTS['boardH']
ROOT_RISE, SOFFIT_RISE = DEFAULTS['rootRise'], DEFAULTS['soffitRise']
CURVE = DEFAULTS['roofCurve']
XS_MODE = ROOF_MODE == 'gabled'          # 硬山；其余（hip/未知）一律歇山

# ------------------------------------ 平面 / 朝向（frame.py，与 assemble / render 同一份公式） ----
# 外接矩形 = footprint 最小面积外接矩形；正立面 = 矩形上外法线与 facade.dir 最近的一边（defaults.orient，
# 见 frame.py 说明）；模块 +Z = 正立面外法线，+X = 沿正立面。建面以矩形中心为原点，最后重锚到面积形心。
FR = hk_frame.hall_frame(OBJ, DEFAULTS)
HU, HV = FR['hu'], FR['hv']
CXX, CZZ = FR['centroid']
ACU, ACV = hk_frame.to_local(FR, CXX, CZZ)   # 面积形心在矩形系里的坐标（重锚 = −ACU, −ACV）
COVERAGE = FR['coverage']

# ---- 共享边（与邻栋 footprint 重合的边，从 layout 检出）：该侧任何构件不越过边线 ----
# 每侧参数 inset / platformOut / eaveOver，缺省取 defaults；有共享边的一侧：台基齐边、檐口出挑截到边线、
# 墙线按需内收（歇山出檐在 kit 里四面同值，所以歇山靠内收墙线让出 over+chu）。记进 recipe.sides。
SHARED = hk_frame.shared_edges(OBJ, LAYOUT['objects'], DEFAULTS)
LIMITS = hk_frame.side_limits(FR, SHARED)
XI = DEFAULTS['xieshan']
# 墙线外最远构件：窗框+格心 0.172 / 柱 0.17 / 勒脚 0.15 / 角柱斗拱半宽 0.21 / 额枋端头 0.15 → 取 0.22
WALL_OUTER = max(DEFAULTS['columnR'], (WALL_T + 0.08) / 2 + 0.012, WALL_T / 2 + 0.03, 0.21) + 0.01
SIDE_H = {'front': HV, 'back': HV, 'right': HU, 'left': HU}
SNAP = DEFAULTS.get('sharedSnapM', 1.5)
BIG = 1.0e3


def snap_merge(ivs, half, gap=None):
    """区间 [(a, b, val, *extra)]：离 ±half 端 < SNAP 的并到端点（±BIG），间隔 < gap（缺省 SNAP）的合并（val 取小）。"""
    gap = SNAP if gap is None else gap
    out = []
    for iv in sorted(ivs, key=lambda r: r[0]):
        a, b = iv[0], iv[1]
        a = -BIG if a < -half + SNAP else a
        b = BIG if b > half - SNAP else b
        if out and a <= out[-1][1] + gap:
            p = out[-1]
            out[-1] = (p[0], max(p[1], b), min(p[2], iv[2])) + tuple(min(x, y) for x, y in zip(p[3:], iv[3:]))
        else:
            out.append((a, b) + tuple(iv[2:]))
    return out


# ---- 共享边按段限位（wave3 K1）：硬山的前后两侧，限位只作用在真正重合的那一段（frame.side_intervals，
# 共享边条带 ∪ 邻栋占位），段外照常出檐 / 放台基；段内墙线越界才局部内收（凹口），檐口 / 台基截到边线，端点端板收头。
# 限位区间（或墙线凹口）盖满整侧时退回 wave2 整侧处理——仰山堂 / 三穗堂即此情况：三穗堂的边在共享段外
# 偏出 0.05 容差继续贴着仰山堂背面，按段放开会让背面两端出檐伸进三穗堂。歇山、两山侧仍按整侧处理。
SEG_RECT = {}
SEG_MODE = {}
if XS_MODE and SHARED:
    for sd in ('front', 'back'):
        if sd not in LIMITS:
            continue
        ivs = hk_frame.side_intervals(FR, LAYOUT['objects'], SHARED, sd, HV - INSET + OVER + 0.05, DEFAULTS)
        notch = snap_merge([(iv['t0'] - WALL_OUTER, iv['t1'] + WALL_OUTER, iv['lim']) for iv in ivs
                            if iv['lim'] - WALL_OUTER < HV - INSET - 1e-6], HU)
        if not ivs or any(iv['t0'] <= -HU and iv['t1'] >= HU for iv in ivs) or any(a <= -HU and b >= HU for a, b, _ in notch):
            SEG_MODE[sd] = 'whole'
            continue
        SEG_RECT[sd] = ivs
        SEG_MODE[sd] = 'segments'
        del LIMITS[sd]
SIDES = {}
for sd, hh in SIDE_H.items():
    prm_s = {'inset': INSET, 'platformOut': P_OUT, 'eaveOver': OVER, 'shared': False}
    if sd in SEG_RECT:
        tl = HU if sd in ('front', 'back') else HV
        prm_s['sharedSegments'] = [{'t0': round(max(-tl, iv['t0']), 4), 't1': round(min(tl, iv['t1']), 4), 'lim': round(iv['lim'], 4),
                                    'others': iv['others']} for iv in SEG_RECT[sd]]
    if sd in LIMITS:
        lim = LIMITS[sd] - DEFAULTS.get('sharedEdgeClearM', 0.0)
        prm_s['shared'] = True
        prm_s['limitFromRectCenter'] = round(lim, 4)
        prm_s['platformOut'] = min(P_OUT, lim - hh)
        need = hh - lim + WALL_OUTER
        if not XS_MODE or sd in ('front', 'back'):
            need_roof = hh - lim + (OVER + XI['chu'] + 0.15 if not XS_MODE else 0.0)   # 歇山：出檐+出翘+戗脊截面余量
            need = max(need, need_roof)
        prm_s['inset'] = max(INSET, need)
        if XS_MODE and sd in ('front', 'back'):
            prm_s['eaveOver'] = max(0.0, lim - (hh - prm_s['inset']))
    SIDES[sd] = prm_s
WF, WB = HV - SIDES['front']['inset'], HV - SIDES['back']['inset']
WR, WL = HU - SIDES['right']['inset'], HU - SIDES['left']['inset']
HVW, VOFF = (WF + WB) / 2, (WF - WB) / 2        # 建面系 = 墙线中心；矩形系 v = 建面系 v + VOFF
HUW, UOFF = (WR + WL) / 2, (WR - WL) / 2
OVER_F, OVER_B = SIDES['front']['eaveOver'], SIDES['back']['eaveOver']
PF, PB = HV + SIDES['front']['platformOut'] - VOFF, HV + SIDES['back']['platformOut'] + VOFF   # 台基前/后沿（建面系）
PR, PL = HU + SIDES['right']['platformOut'] - UOFF, HU + SIDES['left']['platformOut'] + UOFF
SH_U, SH_V = UOFF - ACU, VOFF - ACV             # 建面系 → 模块本地（原点 = 面积形心）
GT = WALL_T + 0.04                               # 山墙封顶 / 端板厚


def pieces(ivs, a, b, default):
    """分段常值函数：区间 [(x0, x1, val, ...)] 取小，缺省 default；返回覆盖 [a, b] 的 [(x0, x1, val)]（相邻同值合并）。"""
    cuts = sorted({a, b} | {x for iv in ivs for x in iv[:2] if a < x < b})
    out = []
    for x0, x1 in zip(cuts, cuts[1:]):
        m = (x0 + x1) / 2
        v = min([default] + [iv[2] for iv in ivs if iv[0] <= m <= iv[1]])
        if out and abs(out[-1][2] - v) < 1e-9:
            out[-1] = (out[-1][0], x1, v)
        else:
            out.append((x0, x1, v))
    return out


def val_at(pcs, x):
    return next((v for x0, x1, v in pcs if x0 - 1e-9 <= x <= x1 + 1e-9), pcs[-1][2])


# 按段限位（K1）换到建面系（u = 切向 − UOFF；外向距离：前 = d − VOFF，后 = d + VOFF）。每侧四套区间：
#  lim  共享段（含条带余量）→ 限位线；wall 墙线越界处的凹口（墙线 = lim − WALL_OUTER，左右各让 WALL_OUTER）；
#  eave 正檐截到 lim（凹口段整段截，边界让出端板厚 GT/2）；plat 台基截到 lim；ring 腰檐环线（段外让出 over，保证翼角斜切不进条带）。
SEG = {}
for sd, ivs in SEG_RECT.items():
    off = -VOFF if sd == 'front' else VOFF
    lim = [((iv['t0'] - UOFF) if abs(iv['t0']) < BIG / 2 else -BIG, (iv['t1'] - UOFF) if abs(iv['t1']) < BIG / 2 else BIG,
            iv['lim'] + off) for iv in ivs]
    notch = snap_merge([(x0 - WALL_OUTER, x1 + WALL_OUTER, L - WALL_OUTER, L) for x0, x1, L in lim if L - WALL_OUTER < HVW - 1e-6], HUW)
    ow = DEFAULTS['waistEave']['over']
    SEG[sd] = {
        'lim': lim,
        'wall': [(a, b, dn) for a, b, dn, L in notch],
        'eave': [(x0, x1, L - 0.01) for x0, x1, L in lim] + [(a + (GT / 2 if a > -BIG / 2 else 0), b - (GT / 2 if b < BIG / 2 else 0), L - 0.01)
                                                            for a, b, dn, L in notch],
        'plat': lim,
        'ring': snap_merge([(x0 - ow, x1 + ow, L - ow - 0.01) for x0, x1, L in lim], HUW, gap=2 * ow + 0.1),
    }
FB = pieces(SEG['front']['wall'] if 'front' in SEG else [], -HUW, HUW, HVW)   # 墙线分块 [(u0, u1, 外向距离)]
BB = pieces(SEG['back']['wall'] if 'back' in SEG else [], -HUW, HUW, HVW)
NOTCHED = len(FB) > 1 or len(BB) > 1
dF_L, dF_R, dB_L, dB_R = FB[0][2], FB[-1][2], BB[0][2], BB[-1][2]            # 两山端的前 / 后墙线

# ------------------------------------------------------------- 柱网 ----
bay_n = max(2, round(2 * HUW / DEFAULTS['bayTarget']))
if 2 * HUW / bay_n > DEFAULTS['bayMax']:
    bay_n += 1
if 2 * HUW / bay_n < DEFAULTS['bayMin'] and bay_n > 2:
    bay_n -= 1
BAY = 2 * HUW / bay_n
XS = [-HUW + BAY * i for i in range(bay_n + 1)]
if NOTCHED:
    # 墙线凹口：凹口边界（回墙）必须落在柱线上——按分块各自排开间（每块 ≥ 1 间，同一套 bayMin/Max 规则），柱线取并
    brk = sorted({-HUW, HUW} | {x for pcs in (FB, BB) for p in pcs for x in p[:2]})
    XS = []
    for a_, b_ in zip(brk, brk[1:]):
        w_ = b_ - a_
        n_ = max(1, round(w_ / DEFAULTS['bayTarget']))
        if w_ / n_ > DEFAULTS['bayMax']:
            n_ += 1
        if w_ / n_ < DEFAULTS['bayMin'] and n_ > 1:
            n_ -= 1
        XS += [a_ + w_ * i / n_ for i in range(n_)]
    XS.append(HUW)
    bay_n = len(XS) - 1
    BAY = 2 * HUW / bay_n                          # 平均开间（只记录）


def leaves_of(bw):
    """每开间扇数：按扇宽 leafPitch 自适应，常规开间（3.2–3.8 m）落在 6–7 扇；窄开间（小厅 / 小轩）不强塞 6 扇，最少 2 扇"""
    return min(DEFAULTS['leafPerBayMax'], max(DEFAULTS['leafPerBayMinNarrow'] if bw < DEFAULTS['leafPerBayMin'] * DEFAULTS['leafPitch']
                                              else DEFAULTS['leafPerBayMin'], round(bw / DEFAULTS['leafPitch'])))


LEAVES = leaves_of(BAY)
BAY_LEAVES = [leaves_of(XS[i + 1] - XS[i]) if NOTCHED else LEAVES for i in range(bay_n)]
# 小体量檐高上限（designInference）：layout 檐高是类别缺省 4.0 m，面宽 4–5 m 的小厅/小轩按它建会成细高塔状；
# 檐高 = min(layout eave, max(smallEaveMin, smallEaveK·面宽 + smallEaveC))，常规面宽（≥ 6.5 m）不受影响。
EAVE_LAYOUT = EAVE
EAVE = min(EAVE, max(DEFAULTS['smallEaveMin'], DEFAULTS['smallEaveK'] * 2 * HU + DEFAULTS['smallEaveC']))
EAVE_INFERRED = EAVE < EAVE_LAYOUT - 1e-6
EAVE_Z = PLATFORM_Y + EAVE
# 屋面坡度下限（designInference）：layout rise 是类别缺省 1.9 m，大进深厅会比已放行的仰山堂样板（檐口→正脊约 17.7°）更平；
# 取 rise = max(layout rise, (墙线半进深 + 出檐) · tan(minRoofPitchDeg))，样板本身不受影响。
RISE_LAYOUT = RISE
RISE = max(RISE, (HVW + OVER) * math.tan(math.radians(DEFAULTS['minRoofPitchDeg'])))   # 按缺省出檐的全坡长计
# 坡度上限（designInference）：进深 2–3 m 的小屋面按 1.9 m 举高会到 44°，压到 maxRoofPitchDeg
RISE = min(RISE, (HVW + OVER) * math.tan(math.radians(DEFAULTS['maxRoofPitchDeg'])))
RISE_INFERRED = abs(RISE - RISE_LAYOUT) > 1e-6
RIDGE_Z = EAVE_Z + RISE
DOOR_H = min(DEFAULTS['doorH'], EAVE - 0.5)          # 檐高压低时门高让出额枋
COL_R = DEFAULTS['columnR']
# 多层（storeys ≥ 2，B4 楼）：层高 = layout height / storeys；底层顶 = 腰檐 + 二层平座楼面；二层正立面格扇后退 upperSetback
# 形成平座（前檐柱、栏杆留在底层墙线上）。storeys 1 时整栋单层（与 wave1 样板同）。
MULTI = STOREYS >= 2
STOREY_H = HEIGHT / STOREYS if MULTI else EAVE
SLAB_T = DEFAULTS['floorSlabT']
Z1 = PLATFORM_Y + STOREY_H                            # 二层楼面（平座）标高
SETBACK = DEFAULTS['upperSetback'] if MULTI else 0.0
# 薄楼（designInference，wave3 K2）：墙线进深 − 后退 < minUpperFloorDepthM 时后退缩到只留该进深（至少 minUpperSetbackM，平座仍读得出），
# 否则观涛楼 / 延清楼（进深 2.4 m）二层只剩 1.4 m。得月楼等常规进深不受影响。
SETBACK_LAYOUT = SETBACK
if MULTI and 2 * HVW - SETBACK < DEFAULTS['minUpperFloorDepthM']:
    SETBACK = max(DEFAULTS['minUpperSetbackM'], min(SETBACK, 2 * HVW - DEFAULTS['minUpperFloorDepthM']))
SETBACK_INFERRED = abs(SETBACK - SETBACK_LAYOUT) > 1e-9
DOOR_H1 = min(DEFAULTS['doorH'], STOREY_H - 0.55) if MULTI else DOOR_H
DOOR_H2 = min(DEFAULTS['doorH'], EAVE_Z - (Z1 + SLAB_T) - 0.5) if MULTI else None

# ------------------------------------------------------------- 材质 ----
TEX_DIRS = [os.path.abspath(os.path.join(AREA, '..', '..', '..', '..', '..', 'asset-authoring', 'yuyuan-entry', 'source-kit', 'textures')),
            '/home/baibai/work/onewonderjapan/pawborough-world/asset-authoring/yuyuan-entry/source-kit/textures']
TEX_DIR = next((d for d in TEX_DIRS if os.path.isdir(d)), None)
if not TEX_DIR:
    raise SystemExit('hall-kit: source-kit textures not found')

META = {}
TILE_OF = {}

def lin(h):
    a = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in a]

def mat(name, rgb=None, rough=.8, base=None, normal=None, tint=None, tile=(1, 1)):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    p = nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*(rgb if rgb else lin('ffffff')), 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = 0
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
    META[name] = {'roughness': rough, 'textures': {k: v for k, v in (('color', base), ('normal', normal)) if v},
                  'tileMeters': list(tile), **({'tintSrgb': tint} if tint else {})}
    TILE_OF[name] = tile
    return m

# 框料深红木：底色直接 = sRGB timberSrgb（#6a2e22），不再乘 wood-stain 贴图（旧版贴图均值 sRGB(68,38,28)
# 再乘 #6a2e22 线性值 → 有效底色约 sRGB(26,5,3)，格扇整面读成黑色）；木纹只走法线图。
# hk-dark-timber 只留给额枋 / 檐下阴影件（檐底、瓦头、脊）；格心背衬另用 hk-lattice-back（室内暗部）。
M = {'wall': mat('hk-white-wall', rough=.85, base='PaintedPlaster017_2K-JPG_Color_1K.jpg', tint='f2efe8', tile=(2.2, 2.2)),
     'stone': mat('hk-platform-stone', rough=.92, base='Bricks061_2K-JPG_Color_1K.jpg', tint='9a968c', tile=(2.0, 1.0)),
     'brick': mat('hk-plinth-brick', rough=.9, base='Bricks061_2K-JPG_Color_1K.jpg', tint='6b7370', tile=(0.9, 0.9)),
     'wood': mat('hk-timber-darkred', lin(DEFAULTS['timberSrgb']), rough=.62, normal='Wood092_2K-JPG_NormalGL_1K.jpg', tile=(0.9, 2.2)),
     'roof': mat('hk-roof-tile', rough=.8, base='roof-color.jpg', normal='roof-normal.png', tile=(1.4, 1.2)),
     'dark': mat('hk-dark-timber', lin(DEFAULTS['darkTimberSrgb']), .6),
     'latback': mat('hk-lattice-back', lin(DEFAULTS['latticeBackSrgb']), .35)}
META['hk-timber-darkred']['baseColorSrgb'] = DEFAULTS['timberSrgb']
MAT_OF = {'wall': M['wall'], 'stone': M['stone'], 'brick': M['brick'], 'wood': M['wood'],
          'roof': M['roof'], 'dark': M['dark'], 'latback': M['latback']}

def make_lattice_image():
    """格心解析 alpha 贴图（1 m 见方 = 8x8 格，方格 + 斜格），生成到模块 textures/ 并 pack。"""
    W = H = 160
    cell, bar = 20, 3
    px = bytearray(W * H * 4)
    tc = DEFAULTS['timberSrgb']
    base = tuple(int(tc[i:i + 2], 16) for i in (0, 2, 4))     # 格心棂条 = 框料同色深红木（sRGB 字节）
    for y in range(H):
        for x in range(W):
            dxx, dyy = x % cell, y % cell
            sd, dd = (x + y) % cell, (x - y) % cell
            on = dxx < bar or dyy < bar or sd < bar or dd < bar
            k = (y * W + x) * 4
            if on:
                px[k], px[k + 1], px[k + 2], px[k + 3] = *base, 255
            else:
                px[k], px[k + 1], px[k + 2], px[k + 3] = 255, 255, 255, 0
    img = bpy.data.images.new('lattice-core-alpha', W, H, alpha=True)
    img.pixels = [v / 255.0 for v in px]
    tdir = os.path.join(HERE, 'textures')
    os.makedirs(tdir, exist_ok=True)
    out = os.path.join(tdir, 'lattice-core-alpha.png')
    img.filepath_raw = out
    img.file_format = 'PNG'
    img.save()
    img.pack()
    m = bpy.data.materials.new('hk-lattice-core')
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
    META['hk-lattice-core'] = {'alpha': 'textures/lattice-core-alpha.png', 'cellM': 0.125, 'alphaMode': 'MASK', 'alphaCutoff': 0.5,
                               'barSrgb': tc, 'sharedImage': 'lattice-core-alpha 160x160（所有厅同名同尺寸，总装按名+尺寸去重）'}
    TILE_OF['hk-lattice-core'] = (1.0, 1.0)
    return m

M['lattice'] = make_lattice_image()
MAT_OF['lattice'] = M['lattice']

# ------------------------------------------------------------ 网格工具 ----
def glb_to_blender(p):
    x, y, z = p
    return (x, -z, y)

PART = 'hall'

def tag(o, part):
    o['part'] = part
    return o

def box(name, center, size, m='wall', part=None, collision=False, tile=None):
    """连通 8 顶点盒（GLB 设计坐标，UV 每面 loop）。"""
    part = part or PART
    hx, hy, hz = [v / 2 for v in size]
    src = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
           (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 4, 7, 3), (1, 2, 6, 5), (0, 1, 5, 4), (3, 7, 6, 2)]
    t = tile or TILE_OF.get(M[m].name, (1, 1))
    me = bpy.data.meshes.new(name + '_mesh')
    me.from_pydata([glb_to_blender((center[0] + s[0], center[1] + s[1], center[2] + s[2])) for s in src], [], faces)
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M[m])
    uv = me.uv_layers.new(name='UVMap')
    for f in me.polygons:
        n = f.normal
        axis = max(range(3), key=lambda i: abs(n[i]))
        for li in f.loop_indices:
            p = me.vertices[me.loops[li].vertex_index].co
            gx = (p.x, p.z, -p.y)   # blender -> glb（网格已按绝对坐标建）
            u, v = ((-gx[2], gx[1]) if axis == 0 else (gx[0], -gx[2]) if axis == 1 else (gx[0], gx[1]))
            uv.data[li].uv = (u / t[0], v / t[1])
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o['part'] = part
    if collision:
        COLL.append({'name': name, 'center': list(center), 'size': list(size), 'type': 'box'})
    return o

def mesh_glb(name, items, faces, m='wall', part=None):
    """items=[(glb_vert,(u,v))]；直接按 GLB 坐标建面（用于格心面板、檐口条带）。"""
    part = part or PART
    me = bpy.data.meshes.new(name + '_mesh')
    me.from_pydata([glb_to_blender(v) for v, _ in items], [], faces)
    me.update()
    me.materials.append(MAT_OF[m] if isinstance(m, str) else m)
    uv = me.uv_layers.new(name='UVMap')
    for p in me.polygons:
        for li in p.loop_indices:
            uv.data[li].uv = items[me.loops[li].vertex_index][1]
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return tag(o, part)

def panel(name, center, w, h, m='lattice', part=None):
    """竖直面板：GLB 本地 X 宽 w、Y 高 h，面朝 +Z。"""
    cx, cy, cz = center
    corners = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    items = [((cx + a, cy + b, cz), (a + w / 2, b + h / 2)) for a, b in corners]
    return mesh_glb(name, items, [(0, 1, 2, 3)], m, part)

def column(name, x, z, r, z0, z1, part=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=r, depth=z1 - z0, location=glb_to_blender((x, (z0 + z1) / 2, z)))
    o = bpy.context.object
    o.name = name
    o.data.materials.append(M['wood'])
    tag(o, part or 'hall-frame')
    COLL.append({'name': name, 'center': [x, (z0 + z1) / 2, z], 'size': [2 * r, z1 - z0, 2 * r], 'type': 'box'})
    return o

COLL = []

# --------------------------------------------------- eave_kit 注入回调 ----
# xieshan_roof / brackets 内部只通过 init() 注入的 add_local 出网格；
# 回调把 kit 的局部 (u,v,h) 转 GLB（u,h,v）。v→-v 镜像会翻绕向，faces 统一倒序。
def _add_local(name, items, faces, material, part):
    conv = [((it[0][0], it[0][2], it[0][1]), it[1]) for it in items]
    mesh_glb(name, conv, [tuple(reversed(f)) for f in faces], material, part)

eave_kit.init(_add_local)

# --------------------------------------------------------------- 建造 ----
# ---- 台基 / 地面 / 踏步（hall-base）
PART = 'hall-base'
def combined(a, b, *pcs_list):
    """几套分段函数在 [a, b] 上的公共细分：[(x0, x1, [各套取值])]。"""
    cuts = sorted({a, b} | {x for pcs in pcs_list for p in pcs for x in p[:2] if a < x < b})
    return [(x0, x1, [val_at(p, (x0 + x1) / 2) for p in pcs_list]) for x0, x1 in zip(cuts, cuts[1:])]


# 台基按段：共享段内前 / 后沿截到限位线（齐边、不外挑压顶石），段外照常外扩；分块之间是直端面（台基收头）
PFP = pieces(SEG['front']['plat'] if 'front' in SEG else [], -PL, PR, PF)
PBP = pieces(SEG['back']['plat'] if 'back' in SEG else [], -PL, PR, PB)
PLAT = combined(-PL, PR, PFP, PBP)
# 压顶石外挑 4 cm；共享边一侧不外挑（齐边）
cap_o = {k: (0.0 if SIDES[k]['shared'] else 0.04) for k in SIDES}
for k_, (a_, b_, (pf_, pb_)) in enumerate(PLAT):
    sfx = '' if k_ == 0 else '-%d' % k_
    box('platform' + sfx, ((a_ + b_) / 2, PLATFORM_Y / 2, (pf_ - pb_) / 2), (b_ - a_, PLATFORM_Y, pf_ + pb_), 'stone', collision=True)
    cl = cap_o['left'] if k_ == 0 else 0.0
    cr = cap_o['right'] if k_ == len(PLAT) - 1 else 0.0
    cf = cap_o['front'] if pf_ >= PF - 1e-9 else 0.0
    cb = cap_o['back'] if pb_ >= PB - 1e-9 else 0.0
    box('platform-cap' + sfx, ((b_ + cr + a_ - cl) / 2, PLATFORM_Y - 0.04, (pf_ + cf - pb_ - cb) / 2),
        (b_ - a_ + cr + cl, 0.08, pf_ + pb_ + cf + cb), 'stone')
for k_, (a_, b_, (df_, db_)) in enumerate(combined(-HUW, HUW, FB, BB)):
    a2, b2 = max(a_, -HUW + 0.2), min(b_, HUW - 0.2)
    box('floor' + ('' if k_ == 0 else '-%d' % k_), ((a2 + b2) / 2, PLATFORM_Y + 0.01, (df_ - db_) / 2), (b2 - a2, 0.04, df_ + db_ - 0.4), 'stone')
# 踏步：级数按台基高（每级 ≤ 0.18 m，至少 3 级），放在 kinds.<kind>.steps 一侧
n_steps = max(3, math.ceil(PLATFORM_Y / 0.18))
tread = DEFAULTS['stepTread']
STEPS_SIDE = KCFG.get('steps', 'front')
for k in range(n_steps):
    hk = PLATFORM_Y * (k + 1) / n_steps
    off = tread * (n_steps - k) - tread / 2           # 离台基边的距离（最低一级最远）
    if STEPS_SIDE in ('front', 'back'):
        sg = 1 if STEPS_SIDE == 'front' else -1
        edge = val_at(PFP, 0.0) if sg > 0 else val_at(PBP, 0.0)   # 踏步在正中；按段限位时取该处台基沿
        sw = min(DEFAULTS['stepWidth'], 2 * HUW * 0.5)
        box('step-%d' % k, (0, hk / 2, sg * (edge + off)), (sw, hk, tread), 'stone', collision=True)
    else:
        sg = 1 if STEPS_SIDE == 'right' else -1
        edge = PR if sg > 0 else PL
        sw = min(1.4, 2 * HVW * 0.4)
        box('step-%d' % k, (sg * (edge + off), hk / 2, -HVW * 0.45), (tread, hk, sw), 'stone', collision=True)

wt = WALL_T
ph = DEFAULTS['plinthH']
win = DEFAULTS['window']
RAIL_H = DEFAULTS['railingH']
arch_h = DEFAULTS['architraveH']


def quad_z(name, xc, yc, z, w, h, sg, m):
    """竖直面板（GLB x 宽 w、y 高 h）在 z 处，法线朝 sg·Z。"""
    pts = ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)) if sg > 0 else \
          ((w / 2, -h / 2), (-w / 2, -h / 2), (-w / 2, h / 2), (w / 2, h / 2))
    return mesh_glb(name, [((xc + a, yc + b, z), (a + w / 2, b + h / 2)) for a, b in pts], [(0, 1, 2, 3)], m)


def quad_x(name, x, yc, zc, w, h, sg, m):
    """竖直面板（GLB z 宽 w、y 高 h）在 x 处，法线朝 sg·X。"""
    pts = [((x, yc + b, zc + a), (a + w / 2, b + h / 2)) for a, b in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))]
    return mesh_glb(name, pts, [(3, 2, 1, 0) if sg > 0 else (0, 1, 2, 3)], m)


def railing_z(tag, zl, sg, y0, bays=None):
    """沿 u 的落地栏杆（每开间：上下槛 + 花格 alpha 心板），碰撞高 RAIL_H。bays = 开间下标（缺省全部）。"""
    for i in (range(bay_n) if bays is None else bays):
        a_, b_ = XS[i] + COL_R, XS[i + 1] - COL_R
        xc, L_ = (a_ + b_) / 2, b_ - a_
        box('%s-top-%d' % (tag, i), (xc, y0 + RAIL_H - 0.04, zl), (L_, 0.08, 0.1), 'wood')
        box('%s-bot-%d' % (tag, i), (xc, y0 + 0.08, zl), (L_, 0.08, 0.1), 'wood')
        quad_z('%s-core-%d' % (tag, i), xc, y0 + (0.12 + RAIL_H - 0.08) / 2, zl + sg * 0.01, L_, RAIL_H - 0.2, sg, 'lattice')
        COLL.append({'name': '%s-%d' % (tag, i), 'center': [xc, y0 + RAIL_H / 2, zl], 'size': [L_, RAIL_H, 0.12], 'type': 'box'})


def blocks(sd):
    return FB if sd == 'front' else BB


def party(d):
    """墙线凹口块（共享段内墙线内收）：贴邻栋的隔墙，白墙无窗、无格扇、无平座。"""
    return d < HVW - 1e-6


def ds_at(sd, x):
    """柱线 x 处该侧的墙线外向距离（凹口边界处两块各一根柱）。"""
    out = []
    for x0, x1, d in blocks(sd):
        if x0 - 1e-6 <= x <= x1 + 1e-6 and all(abs(d - o) > 1e-6 for o in out):
            out.append(d)
    return out


def bays_in(x0, x1):
    return [i for i in range(bay_n) if XS[i] >= x0 - 1e-6 and XS[i + 1] <= x1 + 1e-6]


def build_storey(tg, y0, y1, door_h, off):
    """一层的柱 / 额枋 / 墙 / 半窗 / 格扇 / 栏杆。tg = 名字前缀（'' 底层，'s2-' 二层）；
    y0 = 楼面、y1 = 该层檐下；off = 正立面格扇线后退（二层平座 SETBACK）；前后檐柱始终在墙线分块上。
    墙线分块 FB / BB（共享段凹口，K1）：凹口块为隔墙；块边界加回墙（两层通高，同时封住平座端头）。"""
    global PART
    wz0, wz1 = y0 + win['sill'], y0 + win['sill'] + win['h']
    lintel0 = y0 + door_h
    # ---- 柱网 / 额枋（hall-frame）
    PART = 'hall-frame'
    for x in XS:
        for d in ds_at('front', x):
            column('%sfront-column-%.2f' % (tg, x), x, d, COL_R, y0, y1)
        for d in ds_at('back', x):
            column('%srear-column-%.2f' % (tg, x), x, -d, COL_R, y0, y1)
    for z in ZS_SIDE[2:]:
        for sx in (-1, 1):
            column('%sside-column-%d' % (tg, sx), sx * HUW, z, COL_R, y0, y1)
    az = y1 - 0.42
    for sd, sg in (('front', 1), ('back', -1)):
        B = blocks(sd)
        for k, (x0, x1, d) in enumerate(B):
            e0, e1 = (0.15 if k == 0 else 0.08), (0.15 if k == len(B) - 1 else 0.08)
            box(tg + 'architrave-%s%s' % (sd, '' if k == 0 else '-%d' % k), ((x0 - e0 + x1 + e1) / 2, az + arch_h / 2, sg * d),
                (x1 - x0 + e0 + e1, arch_h, 0.16), 'dark')
        for k in range(len(B) - 1):
            d1, d2 = B[k][2], B[k + 1][2]
            box(tg + 'architrave-%s-ret-%d' % (sd, k), (B[k][1], az + arch_h / 2, sg * (d1 + d2) / 2), (0.16, arch_h, abs(d1 - d2) + 0.16), 'dark')
    box(tg + 'architrave-l', (-HUW, az + arch_h / 2, (dF_L - dB_L) / 2), (0.16, arch_h, dF_L + dB_L + 0.3), 'dark')
    box(tg + 'architrave-r', (HUW, az + arch_h / 2, (dF_R - dB_R) / 2), (0.16, arch_h, dF_R + dB_R + 0.3), 'dark')
    # ---- 墙身 / 勒脚 / 半窗（hall-wall）：按 MODE 逐侧、逐墙线分块
    PART = 'hall-wall'

    def line(sd, d):
        return d - (off if sd == 'front' and not party(d) else 0.0)
    for sd, sg in (('front', 1), ('back', -1)):
        B = blocks(sd)
        for k, (x0, x1, d) in enumerate(B):
            sfx = '' if k == 0 else '-%d' % k
            md = 'party' if party(d) else MODE[sd]
            zl = sg * line(sd, d)
            xc, w_ = (x0 + x1) / 2, x1 - x0
            if md in ('wall', 'party'):
                box(tg + 'wall-%s%s' % (sd, sfx), (xc, y0 + (y1 - y0) / 2, zl), (w_, y1 - y0, wt), 'wall', collision=True)
                if not tg:
                    box('plinth-%s%s' % (sd, sfx), (xc, y0 + ph / 2, zl), (w_ + 0.06, ph, wt + 0.06), 'brick')
                if md == 'wall' and KCFG.get('backWindows', True):
                    for i in bays_in(x0, x1):
                        x = (XS[i] + XS[i + 1]) / 2
                        box(tg + '%swin-frame-%d' % (sd, i), (x, (wz0 + wz1) / 2, zl), (win['w'], win['h'], wt + 0.08), 'wood')
                        zf = zl + sg * (wt + 0.08) / 2
                        for nm, dz_, mm in (('back', 0.005, 'latback'), ('core', 0.012, 'lattice')):
                            quad_z(tg + '%swin-%s-%d' % (sd, nm, i), x, (wz0 + wz1) / 2, zf + sg * dz_, win['w'] - 0.12, win['h'] - 0.12, sg, mm)
                        COLL.append({'name': tg + '%swin-%d' % (sd, i), 'center': [x, (wz0 + wz1) / 2, zl], 'size': [win['w'], win['h'], wt], 'type': 'box'})
            elif md == 'lattice':
                # 门楣墙（整面格扇落地）；格扇在 hall-facade
                box(tg + 'wall-%s-lintel%s' % (sd, sfx), (xc, (lintel0 + y1) / 2, zl), (w_, y1 - lintel0, wt), 'wall', collision=True)
            elif md == 'railing':
                railing_z(tg + 'rail-%s' % sd, zl, sg, y0, bays_in(x0, x1))
        # 回墙（凹口边界，K1）：从两块里靠内的墙线 / 格扇线到靠外的墙线，两层通高
        for k in range(len(B) - 1):
            dA, dB_ = B[k][2], B[k + 1][2]
            lo, hi = min(line(sd, dA), line(sd, dB_), dA, dB_), max(dA, dB_)
            x = B[k][1]
            box(tg + 'wall-ret-%s-%d' % (sd, k), (x, y0 + (y1 - y0) / 2, sg * (lo + hi) / 2), (wt, y1 - y0, hi - lo + wt), 'wall', collision=True)
            if not tg:
                box('plinth-ret-%s-%d' % (sd, k), (x, y0 + ph / 2, sg * (lo + hi) / 2), (wt + 0.06, ph, hi - lo + wt + 0.06), 'brick')
    for sd, sx in (('left', -1), ('right', 1)):
        xl = sx * HUW
        dF_, dB_ = (dF_L, dB_L) if sx < 0 else (dF_R, dB_R)
        zc, span = (dF_ - dB_) / 2, dF_ + dB_
        if MODE[sd] == 'wall':
            box(tg + 'wall-gable-%s' % sd[0], (xl, y0 + (y1 - y0) / 2, zc), (wt, y1 - y0, span), 'wall', collision=True)
            if not tg:
                box('plinth-gable-%s' % sd[0], (xl, y0 + ph / 2, zc), (wt + 0.06, ph, span + 0.06), 'brick')
            if True:
                zw = zc + span / 2 * 0.35 - SETBACK / 2
                box(tg + 'gablewin-frame-%d' % sx, (xl, (wz0 + wz1) / 2, zw), (wt + 0.08, win['h'], win['w']), 'wood')
                for nm, dx_, mm in (('back', 0.005, 'latback'), ('core', 0.012, 'lattice')):
                    quad_x(tg + 'gablewin-%s-%d' % (nm, sx), sx * (HUW + (wt + 0.08) / 2 + dx_), (wz0 + wz1) / 2, zw,
                           win['w'] - 0.12, win['h'] - 0.12, sx, mm)
        elif MODE[sd] == 'railing':
            zs = sorted(ZS_SIDE)
            for i in range(len(zs) - 1):
                a_, b_ = zs[i] + COL_R, zs[i + 1] - COL_R
                zc, L_ = (a_ + b_) / 2, b_ - a_
                box(tg + 'rail-%s-top-%d' % (sd, i), (xl, y0 + RAIL_H - 0.04, zc), (0.1, 0.08, L_), 'wood')
                box(tg + 'rail-%s-bot-%d' % (sd, i), (xl, y0 + 0.08, zc), (0.1, 0.08, L_), 'wood')
                quad_x(tg + 'rail-%s-core-%d' % (sd, i), xl + sx * 0.01, y0 + (0.12 + RAIL_H - 0.08) / 2, zc, L_, RAIL_H - 0.2, sx, 'lattice')
                COLL.append({'name': tg + 'rail-%s-%d' % (sd, i), 'center': [xl, y0 + RAIL_H / 2, zc], 'size': [0.12, RAIL_H, L_], 'type': 'box'})
    # ---- 格扇（hall-facade）：lattice 侧每开间 LEAVES 扇，深红木框 + 暗背衬 + 同色棂条 alpha + 裙板凸出
    PART = 'hall-facade'
    for sd, sg in (('front', 1), ('back', -1)):
        if MODE[sd] != 'lattice':
            continue
        for x0, x1, d in blocks(sd):
            if party(d):
                continue
            zl = sg * line(sd, d)
            for i in bays_in(x0, x1):
                a, b = XS[i] + 0.06, XS[i + 1] - 0.06
                nl = BAY_LEAVES[i]
                lw = (b - a) / nl
                for k in range(nl):
                    xc = a + lw * k + lw / 2
                    t2 = tg + ('' if sd == 'front' else 'b')
                    box('door%s-frame-%d-%d' % (t2, i, k), (xc, y0 + door_h / 2, zl), (lw - 0.03, door_h, 0.1), 'wood')
                    core_h = door_h - 1.02 - 0.12
                    quad_z('door%s-back-%d-%d' % (t2, i, k), xc, y0 + 1.02 + core_h / 2, zl + sg * 0.053, lw - 0.16, core_h, sg, 'latback')
                    quad_z('door%s-core-%d-%d' % (t2, i, k), xc, y0 + 1.02 + core_h / 2, zl + sg * 0.058, lw - 0.16, core_h, sg, 'lattice')
                    box('door%s-panel-%d-%d' % (t2, i, k), (xc, y0 + 0.14 + 0.62 / 2, zl + sg * 0.062), (lw - 0.18, 0.62, 0.024), 'wood')
                    COLL.append({'name': 'door%s-%d-%d' % (t2, i, k), 'center': [xc, y0 + door_h / 2, zl], 'size': [lw, door_h, 0.1], 'type': 'box'})


# 两山开敞 / 栏杆且进深 > 5 m 时山面加中柱
ZS_SIDE = [-HVW, HVW] + ([0.0] if (2 * HVW > 5.0 and MODE['left'] != 'wall') else [])
if not MULTI:
    build_storey('', PLATFORM_Y, EAVE_Z, DOOR_H, 0.0)
else:
    # 底层：格扇在前檐柱线
    build_storey('', PLATFORM_Y, Z1, DOOR_H1, 0.0)
    # 平座楼面（整层楼板，前沿到底层墙线分块）+ 平座栏杆（前檐柱线上；凹口隔墙块没有平座）
    PART = 'hall-frame'
    SLABS = combined(-HUW, HUW, FB, BB)
    for k_, (a_, b_, (df_, db_)) in enumerate(SLABS):
        e0, e1 = (0.05 if k_ == 0 else 0.0), (0.05 if k_ == len(SLABS) - 1 else 0.0)
        box('floor-slab' + ('' if k_ == 0 else '-%d' % k_), ((a_ - e0 + b_ + e1) / 2, Z1 + SLAB_T / 2, (df_ - db_) / 2),
            (b_ - a_ + e0 + e1, SLAB_T, df_ + db_ + 0.1), 'wood')
    PART = 'hall-wall'
    for x0_, x1_, d_ in FB:
        if not party(d_):
            railing_z('s2-balcony-rail', d_, 1, Z1 + SLAB_T, bays_in(x0_, x1_))
    # 腰檐（eave_kit.eave_skirt）：绕底层墙线一圈，根部在平座楼板下
    sk = DEFAULTS['waistEave']
    sk_over = sk['over']
    prm_sk = {'over': sk_over, 'chu': 0.0, 'qiao': 0.0, 'reach': 0.0, 'drop': sk['drop'], 'tileH': TILE_H * 0.8,
              'boardH': BOARD_H * 0.8, 'curve': 1.7, 'soffitRise': 0.1, 'rootRise': sk['rootRise']}
    if SEG:
        # 按段限位（K1）：环线 = 墙线分块，共享段（左右各让出 over，凸角翼角斜切出在段外）内环线内收到 lim − over，
        # 段内檐口外缘不越边线；段外腰檐照常外伸 over。eave_kit.eave_skirt 支持凹多边形（阴角斜接）。
        RF = pieces((SEG['front']['wall'] + SEG['front']['ring']) if 'front' in SEG else [], -HUW, HUW, HVW)
        RB = pieces((SEG['back']['wall'] + SEG['back']['ring']) if 'back' in SEG else [], -HUW, HUW, HVW)
        ring_pts = [p for x0_, x1_, d_ in RB for p in ((x0_, -d_), (x1_, -d_))] + \
                   [p for x0_, x1_, d_ in reversed(RF) for p in ((x1_, d_), (x0_, d_))]
        WAIST_RING = []
        for p in ring_pts:
            if not WAIST_RING or math.hypot(p[0] - WAIST_RING[-1][0], p[1] - WAIST_RING[-1][1]) > 1e-6:
                WAIST_RING.append(p)
        if math.hypot(WAIST_RING[0][0] - WAIST_RING[-1][0], WAIST_RING[0][1] - WAIST_RING[-1][1]) <= 1e-6:
            WAIST_RING.pop()
        # 去共线点
        k_ = 0
        while k_ < len(WAIST_RING) and len(WAIST_RING) > 3:
            p0, p1, p2 = WAIST_RING[k_ - 1], WAIST_RING[k_], WAIST_RING[(k_ + 1) % len(WAIST_RING)]
            if abs((p1[0] - p0[0]) * (p2[1] - p1[1]) - (p1[1] - p0[1]) * (p2[0] - p1[0])) < 1e-9:
                WAIST_RING.pop(k_)
            else:
                k_ += 1
    else:
        # 正立面若有整侧共享边限位（wave2 规则），环线前沿内收让檐口不越边线
        allow_f = (OVER_F if XS_MODE else OVER)             # 屋面正立面允许出挑（共享边时已截短）
        vf_sk = HVW - max(0.0, sk_over - allow_f)
        WAIST_RING = [(-HUW, -HVW), (HUW, -HVW), (HUW, vf_sk), (-HUW, vf_sk)]
    eave_kit.eave_skirt('waist-eave', WAIST_RING, Z1 - sk['rootRise'] - 0.02, prm_sk, 'hall-roof')
    # 二层：格扇后退 SETBACK，前檐柱仍在墙线
    build_storey('s2-', Z1 + SLAB_T, EAVE_Z, DOOR_H2, SETBACK)

# ---- 山墙封顶三角（硬山）/ 屋面（hall-roof）
PART = 'hall-roof'
if XS_MODE:
    # 两坡凹曲屋面：檐口线 v=±(HVW+OVER)、z=EAVE_Z-DROP → 正脊 v=0、z=RIDGE_Z，u 到 ±HUW（与山墙齐平）
    # 两坡同一条剖面（缺省出檐 OVER 时的凹曲线）；共享边一侧出檐截短 = 在同一剖面上截断，檐口抬高、不改屋脊
    E_FULL, eave_z0 = HVW + OVER, EAVE_Z - DROP
    nu, nv = 10, 6

    def prof(av):
        return eave_z0 + (RIDGE_Z - eave_z0) * (max(0.0, 1 - av / E_FULL) ** CURVE)
    def prism_x(name, poly_vz, ua, ub, sgn, m='wall', part='hall-roof'):
        """(v, z) 多边形沿 u 从 ua 挤到 ub 的闭合棱柱（v 按 sgn 镜像）；n 边形面由 finalize 三角化（凹多边形可）。
        UV 按面主轴平面映射（米 / 贴图 tile），满足 validator 的 TEXCOORD 要求。"""
        n_ = len(poly_vz)
        vs = [(ua, z, sgn * v) for v, z in poly_vz] + [(ub, z, sgn * v) for v, z in poly_vz]
        fs = [tuple(range(n_)), tuple(range(2 * n_ - 1, n_ - 1, -1))] + [(i, (i + 1) % n_, n_ + (i + 1) % n_, n_ + i) for i in range(n_)]
        me = bpy.data.meshes.new(name + '_mesh')
        me.from_pydata([glb_to_blender(v) for v in vs], [], fs)
        me.update()
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(me)
        bm.free()
        me.materials.append(M[m])
        uv = me.uv_layers.new(name='UVMap')
        t = TILE_OF[M[m].name]
        for f in me.polygons:
            ax = max(range(3), key=lambda i: abs(f.normal[i]))
            for li in f.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                uv.data[li].uv = ((co.y if ax == 0 else co.x) / t[0], (co.z if ax != 2 else co.y) / t[1])
        o = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(o)
        return tag(o, part)

    EAVE_PIECES = {}
    for sgn, tagp in ((1, 's'), (-1, 'n')):
        sd = 'front' if sgn > 0 else 'back'
        # 按段限位（K1）：该侧正檐按段截到限位线（同一剖面上截断，檐口抬高、不改屋脊）；无共享段时整坡一块（同 wave2）
        EP = pieces(SEG[sd]['eave'] if sd in SEG else [], -HUW, HUW, HVW + (OVER_F if sgn > 0 else OVER_B))
        EAVE_PIECES[sd] = EP
        for kp, (x0, x1, eave_v) in enumerate(EP):
            sfx = '' if kp == 0 else '-%d' % kp
            nu_k = nu if len(EP) == 1 else max(2, round(nu * (x1 - x0) / (2 * HUW)))
            wall_v = val_at(blocks(sd), (x0 + x1) / 2)
            eave_z = prof(eave_v)
            items, faces = [], []
            for j in range(nv + 1):
                t = j / nv
                v = sgn * eave_v * (1 - t)               # 檐口 v=±eave_v → 正脊 v=0
                z = prof(abs(v))
                for c in range(nu_k + 1):
                    u = x0 + (x1 - x0) * c / nu_k
                    items.append(((u, z, v), (u + v, z)))
            for j in range(nv):
                for c in range(nu_k):
                    r0 = j * (nu_k + 1) + c
                    q = (r0, r0 + 1, r0 + nu_k + 2, r0 + nu_k + 1)
                    faces.append(q if sgn > 0 else (q[0], q[3], q[2], q[1]))
            mesh_glb('roof-slope-' + tagp + sfx, items, faces, 'roof')
            # 前后檐口断面（同 eave_skirt：瓦头 + 封檐板 + 檐底下回墙）
            rows = ((eave_z, eave_z - TILE_H, 'dark'), (eave_z - TILE_H, eave_z - TILE_H - BOARD_H, 'wood'))
            for r, (z0, z1, mm) in enumerate(rows):
                it = []
                for c in range(nu_k + 1):
                    u = x0 + (x1 - x0) * c / nu_k
                    it.append(((u, z0, eave_v * sgn), (u, z0)))
                    it.append(((u, z1, eave_v * sgn), (u, z1)))
                fc = []
                for c in range(nu_k):
                    a0 = 2 * c
                    # 顶点布局：2c=外缘(z0), 2c+1=内缘(z1)；两缘各沿 u 推进
                    fc.append((a0, a0 + 1, a0 + 3, a0 + 2) if sgn > 0 else (a0, a0 + 2, a0 + 3, a0 + 1))
                mesh_glb('roof-%s-%s%s' % (tagp, 'tileend' if r == 0 else 'board', sfx), it, fc, mm)
            # 檐底：封檐板下沿 → 墙线（略上扬）
            it, fc = [], []
            for c in range(nu_k + 1):
                u = x0 + (x1 - x0) * c / nu_k
                it.append(((u, eave_z - TILE_H - BOARD_H, eave_v * sgn), (u, 0)))
                it.append(((u, max(EAVE_Z + SOFFIT_RISE, eave_z - TILE_H - BOARD_H), wall_v * sgn), (u, eave_v - wall_v)))
            for c in range(nu_k):
                a0 = 2 * c
                # 2c=檐口外缘点, 2c+1=墙线点；不交叉的四边形，背面坡反向
                fc.append((a0, a0 + 1, a0 + 3, a0 + 2) if sgn > 0 else (a0, a0 + 2, a0 + 3, a0 + 1))
            mesh_glb('roof-soffit-' + tagp + sfx, it, fc, 'dark')
        # 端板（K1 段端收头）：相邻两块出檐不同处，在出檐长的一块一侧放白墙端板（墀头式），
        # 封住长檐的断面（屋面上皮 → 瓦头 / 封檐板 → 檐底 → 回墙顶），端板整块落在段外
        for kp in range(len(EP) - 1):
            x = EP[kp][1]
            eL, eR = EP[kp][2], EP[kp + 1][2]
            if abs(eL - eR) < 1e-6:
                continue
            left_long = eL > eR
            eA = max(eL, eR)
            ua, ub = (x - GT, x) if left_long else (x, x + GT)
            dA = val_at(blocks(sd), x - GT if left_long else x + GT)
            dB_ = val_at(blocks(sd), x + 1e-3 if left_long else x - 1e-3)
            v0 = min(dA, dB_)
            bb = prof(eA) - TILE_H - BOARD_H
            pv = [(v0, EAVE_Z)] + ([(dA, EAVE_Z)] if dA - v0 > 1e-6 else []) + \
                 [(dA, max(EAVE_Z + SOFFIT_RISE, bb)), (eA, bb)]
            pv += [(eA - (eA - v0) * j / 8, prof(eA - (eA - v0) * j / 8) - 0.02) for j in range(9)]
            prism_x('roof-endcap-%s-%d' % (tagp, kp), pv, ua, ub, sgn)
    # 山墙封顶：三角棱柱（白墙，厚同墙）从檐高起到屋面线；两山端前 / 后墙线取分块端值（凹口并到端点时随墙线内收）
    gt = GT
    for sx in (-1, 1):
        x = sx * HUW
        dF_, dB_ = (dF_L, dB_L) if sx < 0 else (dF_R, dB_R)
        vs = [(x - gt / 2, EAVE_Z, dF_), (x + gt / 2, EAVE_Z, dF_), (x + gt / 2, EAVE_Z, -dB_),
              (x - gt / 2, EAVE_Z, -dB_), (x - gt / 2, RIDGE_Z - 0.02, 0), (x + gt / 2, RIDGE_Z - 0.02, 0)]
        fs = [(0, 1, 5), (0, 5, 4), (3, 4, 5), (3, 5, 2), (0, 4, 3), (1, 2, 5)]
        me = bpy.data.meshes.new('gable-top-%d_mesh' % sx)
        me.from_pydata([glb_to_blender(v) for v in vs], [], fs)
        me.update()
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(me)
        bm.free()
        me.materials.append(M['wall'])
        # 贴图材质必须带 TEXCOORD_0（validator）：按米做 (u, h) 平面映射
        uv = me.uv_layers.new(name='UVMap')
        t = TILE_OF[M['wall'].name]
        for p in me.polygons:
            for li in p.loop_indices:
                vv = me.vertices[me.loops[li].vertex_index].co
                uv.data[li].uv = (vv.x / t[0], vv.z / t[1])
        o = bpy.data.objects.new('gable-top-%d' % sx, me)
        bpy.context.collection.objects.link(o)
        tag(o, 'hall-roof')
    # 正脊：方截面长条，两端按 eave_kit.smooth_kernel 微翘
    wr, hr = 0.13, 0.3
    nr = 8
    items, faces = [], []
    for c in range(nr + 1):
        s = c / nr
        u = -HUW + 2 * HUW * s
        end = eave_kit.smooth_kernel(min(s, 1 - s) * 2 * HUW, 2.0)
        z0 = RIDGE_Z + 0.02
        z1 = z0 + hr + 0.25 * end ** 2
        for dv, zz in ((-wr, z0), (-wr, z1), (wr, z1), (wr, z0)):
            items.append(((u, zz, dv), (u, zz)))
    for c in range(nr):
        for k in range(4):
            a0, b0 = c * 4 + k, c * 4 + (k + 1) % 4
            faces.append((a0, b0, b0 + 4, a0 + 4))
    faces.append((0, 1, 2, 3))
    last = nr * 4
    faces.append((last + 3, last + 2, last + 1, last))
    mesh_glb('roof-ridge', items, faces, 'dark')
else:
    # 歇山：主控构件全套（下檐腰檐 + 上段两坡 + 山花博风 + 正脊戗脊）
    xi = DEFAULTS['xieshan']
    # 小屋面起翘 / 出翘范围按最短墙线封顶（同 eave_kit.eave_path 的规则：reach ≤ 0.28·最短边，qiao/chu 按 √比例缩），
    # 否则 3–4 m 的小轩整条檐都在翼角核里、翘成波浪。记 recipe.xieshanScaled。
    XS_REACH, XS_QIAO, XS_CHU = xi['reach'], QIAO, xi['chu']
    min_edge = min(2 * HUW, 2 * HVW)
    if XS_REACH > 0.28 * min_edge:
        k_ = (0.28 * min_edge / XS_REACH) ** 0.5
        XS_QIAO, XS_CHU, XS_REACH = QIAO * k_, xi['chu'] * k_, 0.28 * min_edge
    # 小歇山翼角起翘封顶（wave3 W0）：外接矩形短边 < 5 m 时檐口角点比檐口直段高出的量 ≤ wingLiftCapM
    #（GLB 实测起翘 = qiao，见 tests/hallkit-test.mjs 3c），否则小轩翼角翘得比屋脊还抢眼。
    WING_CAP = xi.get('wingLiftCapM')
    XIESHAN_WING_CAPPED = False
    if 2 * min(HU, HV) < 5.0 and WING_CAP is not None and XS_QIAO > WING_CAP:
        XS_QIAO = WING_CAP
        XIESHAN_WING_CAPPED = True
    XIESHAN_SCALED = {'reach': round(XS_REACH, 3), 'qiao': round(XS_QIAO, 3), 'chu': round(XS_CHU, 3),
                      **({'wingLiftCapM': WING_CAP, 'capped': True} if XIESHAN_WING_CAPPED else {})}
    prm = {'over': OVER, 'qiao': XS_QIAO, 'chu': XS_CHU, 'reach': XS_REACH,
           'breakZ': EAVE_Z + RISE * xi['breakFrac'], 'ridgeZ': RIDGE_Z,
           'breakInset': min(2 * HUW, 2 * HVW) * xi['breakInsetFrac'],
           'gableInset': (2 * HUW) * xi['gableInsetFrac'],
           'drop': DROP, 'tileH': TILE_H, 'boardH': BOARD_H, 'curve': 1.6,
           'ridgeEndLift': xi['ridgeEndLift'],
           'ornamentScale': DEFAULTS.get('ornamentScale', 'auto')}      # 小屋面正脊/吻/戗脊按进深缩（eave_kit.ornament_scale）
    eave_kit.xieshan_roof('hall-roof', (-HUW, HUW, -HVW, HVW), EAVE_Z, prm, 'hall-roof')

# ---- 斗拱简化（eave_kit.brackets）：前后檐柱柱顶。叠块顶须压在其正上方檐底之下（wave3 W0：
# 檐底从墙线（+soffitRise，歇山 kit 内定 +0.10）斜下到檐口外缘（−drop−tileH−boardH）；旧版顶 = 檐高 −0.02，
# 外挑端顶高出檐底 ~0.16 m，斜俯图檐线上露小红块。顶 = soffit(外挑深度) − 0.03 余量，出挑越深顶越低。
# part 记 hall-bracket（独立成组，hallkit-test 3b 按名取斗拱顶点核对不穿屋面）。
BRACKET_WALL_Z = (EAVE_Z + SOFFIT_RISE) if XS_MODE else (EAVE_Z + 0.10)
BRACKET_LIP_BOT = (EAVE_Z - DROP) - TILE_H - BOARD_H

def bracket_z(dd, over_side):
    """外挑 dd（≤ over_side）处的檐底高 − 0.03 余量 = 斗拱叠块顶（brackets 顶 = z）。"""
    return BRACKET_WALL_Z - (BRACKET_WALL_Z - BRACKET_LIP_BOT) * min(1.0, dd / max(1e-6, over_side)) - 0.03

for sgn, ov in ((1.0, OVER_F if XS_MODE else OVER), (-1.0, OVER_B if XS_MODE else OVER)):
    sd = 'front' if sgn > 0 else 'back'
    if sd in SEG:
        # 按段限位（K1）：每柱的出挑 = min(0.42, 斗拱宽度范围内的正檐外缘 − 该柱墙线)，按出挑分组调 kit
        groups = {}
        for x in XS:
            for d in ds_at(sd, x):
                e_lo = min(v for x0, x1, v in EAVE_PIECES[sd] if x1 > x - 0.21 and x0 < x + 0.21)
                groups.setdefault((round(min(0.42, e_lo - d), 4), round(e_lo - d, 4)), []).append((x, sgn * d, 0.0, sgn))
        for gi, ((dd, os_), pts) in enumerate(sorted(groups.items(), reverse=True)):
            if dd >= 0.12:
                eave_kit.brackets('hall-bracket-%s%s' % ('f' if sgn > 0 else 'b', '' if gi == 0 else str(gi)), pts,
                                  bracket_z(dd, os_), 'hall-bracket', w=0.42, d=dd, h=0.22)
        continue
    dd = min(0.42, ov)
    if dd >= 0.12:
        eave_kit.brackets('hall-bracket-%s' % ('f' if sgn > 0 else 'b'), [(x, sgn * HVW, 0.0, sgn) for x in XS],
                          bracket_z(dd, ov), 'hall-bracket', w=0.42, d=dd, h=0.22)

# --------------------------------------- join per (part, material) + 重锚 ----
def finalize(items, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in items:
        o.select_set(True)
    bpy.context.view_layer.objects.active = items[0]
    if len(items) > 1:
        bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(o.data)
    bm.free()
    bpy.ops.object.select_all(action='DESELECT')
    return o

sc = bpy.context.scene
parts = {}
for o in list(sc.objects):
    if o.type == 'MESH':
        parts.setdefault((o.get('part', 'hall'), o.data.materials[0].name), []).append(o)
final = [finalize(it, g + '__' + mname) for (g, mname), it in sorted(parts.items())]

# 重锚：模块原点 = footprint 面积形心（矩形系 (ACU,ACV)；blender y = -glb z）
for o in final:
    o.data.transform(Matrix.Translation((SH_U, -SH_V, 0)))

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, 'model.blend'))
bpy.ops.object.select_all(action='DESELECT')
for o in final:
    o.select_set(True)
glb_path = os.path.join(OUT_DIR, 'model.glb')
bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB', export_yup=True, export_apply=True,
                          use_selection=True, export_animations=False, export_cameras=False, export_lights=False)

# alphaMode 兜底：格心材质导出为 MASK + cutoff（Blender 4.5 会写成 BLEND）
buf = bytearray(open(glb_path, 'rb').read())
jl = int.from_bytes(buf[12:16], 'little')
j = json.loads(bytes(buf[20:20 + jl]))
bl_off = 20 + jl
bl = int.from_bytes(buf[bl_off:bl_off + 4], 'little')
bindata = bytes(buf[bl_off + 8:bl_off + 8 + bl])
changed = False
for mm in j.get('materials', []):
    if 'lattice' in mm.get('name', ''):
        if mm.get('alphaMode') != 'MASK':
            mm['alphaMode'] = 'MASK'
            changed = True
        if mm.get('alphaCutoff') != 0.5:
            mm['alphaCutoff'] = 0.5
            changed = True
if changed:
    nj = json.dumps(j, separators=(',', ':')).encode()
    njp = nj + b' ' * ((-len(nj)) % 4)
    total = 12 + 8 + len(njp) + 8 + bl
    open(glb_path, 'wb').write(b'glTF' + (2).to_bytes(4, 'little') + total.to_bytes(4, 'little')
                               + len(njp).to_bytes(4, 'little') + b'JSON' + njp
                               + bl.to_bytes(4, 'little') + b'BIN\x00' + bindata)

# ------------------------------------------------------------- 记录 ----
tris = 0
by_node = {}
for o in final:
    o.data.calc_loop_triangles()
    n = len(o.data.loop_triangles)
    tris += n
    by_node[o.name] = n
maxy = max(v.co.z for o in final for v in o.data.vertices)
# 碰撞记录同步重锚（实例 GLB 坐标 x=u-ACU, z=v-ACV）
for c in COLL:
    c['center'][0] += SH_U
    c['center'][2] += SH_V
json.dump({'axis': 'Y-up +Z facade', 'origin': 'area centroid of layout footprint (GOAL frozen placement)',
           'instanceSpace': True, 'integratedIntoWorld': False, 'colliders': COLL},
          open(os.path.join(OUT_DIR, 'collision.json'), 'w'), ensure_ascii=False, indent=1)
# 模块目录的 collision.json（已跟踪）只对应样板 id（ids.json sample），批量生成其他栋不覆盖它
if HALL_ID == json.load(open(os.path.join(HERE, 'ids.json'), encoding='utf-8')).get('sample'):
    json.dump({'axis': 'Y-up +Z facade', 'origin': 'area centroid of layout footprint (GOAL frozen placement)',
               'instanceSpace': True, 'integratedIntoWorld': False, 'colliders': COLL},
              open(os.path.join(HERE, 'collision.json'), 'w'), ensure_ascii=False, indent=1)

# 格扇立面检色区：正立面格扇所在的墙线分块（凹口隔墙块不算）
_fac = [(x0, x1) for x0, x1, d in FB if not party(d)] or [(-HUW, HUW)]
FAC_U0, FAC_U1 = max(_fac, key=lambda p: p[1] - p[0])
MEAS = {'id': HALL_ID, 'triangles': tris, 'byNode': by_node, 'glbBytes': os.path.getsize(glb_path),
        'maxY': round(maxy, 3), 'roofMode': ROOF_MODE, 'builtAs': 'yingshan' if XS_MODE else 'xieshan',
        'rect': {'u': round(2 * HU, 3), 'v': round(2 * HV, 3), 'coverage': round(COVERAGE, 3)},
        'orient': FR['orient'], 'rotY': round(FR['rotY'], 6), 'front': [round(FR['front'][0], 6), round(FR['front'][1], 6)],
        'facadeDeltaDeg': round(FR['facadeDeltaDeg'], 2),
        'wallLine': {'u': round(2 * HUW, 3), 'v': round(2 * HVW, 3)},
        'bays': bay_n, 'bayWidth': round(BAY, 3), 'leavesPerBay': LEAVES,
        'eaveZ': round(EAVE_Z, 3), 'ridgeZ': round(RIDGE_Z, 3), 'platformY': PLATFORM_Y,
        'areaCentroid': [round(CXX, 4), round(CZZ, 4)],
        # 格扇立面检色区（模块本地 GLB 坐标，已重锚）：正立面格扇带 u∈±(HUW-0.06)、y∈[台基+0.14, 台基+门高]
        'facadeRegionLocal': ([[round(x + SH_U, 4), round(y, 4), round(HVW + 0.06 + SH_V, 4)]
                               for x, y in ((FAC_U0 + 0.06, PLATFORM_Y + 0.14), (FAC_U1 - 0.06, PLATFORM_Y + 0.14),
                                            (FAC_U1 - 0.06, PLATFORM_Y + DOOR_H1), (FAC_U0 + 0.06, PLATFORM_Y + DOOR_H1))]
                              if MODE['front'] == 'lattice' else None),   # 正立面无格扇（水榭/戏台）不检色
        'kind': KIND, 'sideModes': MODE, 'steps': {'side': STEPS_SIDE, 'count': n_steps},
        'reanchorLocalUV': [round(ACU, 4), round(ACV, 4)],
        'wallCenterOffsetUV': [round(UOFF, 4), round(VOFF, 4)],
        'sharedEdges': [{'other': e['other'], 'overlapM': round(e['overlapM'], 3)} for e in SHARED],
        'sharedSideMode': SEG_MODE,
        'wallBlocks': ({'front': [[round(x0, 3), round(x1, 3), round(d, 3)] for x0, x1, d in FB],
                        'back': [[round(x0, 3), round(x1, 3), round(d, 3)] for x0, x1, d in BB]} if NOTCHED else None),
        'storeys': STOREYS, 'storeysIgnored': False,
        'section': ({'storeyH': round(STOREY_H, 3), 'storeyHSource': 'layout height / storeys', 'floor2Z': round(Z1 + SLAB_T, 3),
                     'upperSetback': round(SETBACK, 3), 'upperSetbackInferred': SETBACK_INFERRED, 'doorH1': round(DOOR_H1, 3), 'doorH2': round(DOOR_H2, 3),
                     'waistEave': 'eave_kit.eave_skirt', 'balconyRailing': True} if MULTI else None), 'buildSeconds': round(time.time() - T0, 1)}
json.dump(MEAS, open(os.path.join(OUT_DIR, 'measurements.json'), 'w'), ensure_ascii=False, indent=1)
json.dump({'layoutSource': os.path.relpath(LAYOUT_PATH, AREA),
           'layoutFields': {'footprintPts': len(FP), 'height': OBJ.get('height'), 'eave': OBJ.get('eave'),
                            'rise': OBJ.get('rise'), 'roofMode': OBJ.get('roofMode'), 'storeys': OBJ.get('storeys'),
                            'facadeDir': OBJ.get('facade', {}).get('dir')},
           'defaultsUsed': {k: DEFAULTS[k] for k in ('platformY',) if 'platformY' not in OBJ and not PLATFORM_INFERRED},
           'platform': {'y': PLATFORM_Y, 'designInference': PLATFORM_INFERRED,
                        'source': 'layout' if OBJ.get('platformY') is not None else ('kinds.%s.platformY' % KIND if PLATFORM_INFERRED else 'defaults.platformY')},
           'kind': KIND, 'sideModes': MODE, 'kindNote': KCFG.get('note'),
           'roofPlan': 'eave_kit.xieshan_roof' if not XS_MODE else 'build_hall yingshan (kit section params + brackets + smooth_kernel)',
           'materials': META, 'budgetTris': DEFAULTS['budgetTris'],
           'sides': {k: {kk: (round(vv, 4) if isinstance(vv, float) else vv) for kk, vv in v.items()} for k, v in SIDES.items()},
           'sharedSegments': {'rule': 'wave3 K1：硬山前后侧按段限位（frame.side_intervals：共享边条带 ∪ 邻栋占位；区间盖满整侧 → 整侧处理）',
                              'mode': SEG_MODE,
                              'pieces': {sd: {k: [[round(c, 3) if abs(c) < BIG / 2 else ('-inf' if c < 0 else 'inf') for c in iv[:3]] for iv in v]
                                              for k, v in SEG[sd].items()} for sd in SEG},
                              'eavePieces': ({sd: [[round(x0, 3), round(x1, 3), round(e, 3)] for x0, x1, e in EAVE_PIECES[sd]] for sd in SEG}
                                             if XS_MODE and SEG else None),
                              'waistRing': ([[round(p[0], 3), round(p[1], 3)] for p in WAIST_RING] if MULTI else None)},
           'sharedEdges': [{'other': e['other'], 'overlapM': round(e['overlapM'], 3),
                            'a': [round(c, 3) for c in e['a']], 'b': [round(c, 3) for c in e['b']]} for e in SHARED],
           'eave': {'layout': EAVE_LAYOUT, 'used': round(EAVE, 3), 'designInference': EAVE_INFERRED,
                    'rule': 'min(layout eave, max(%s, %s*frontWidth+%s))' % (DEFAULTS['smallEaveMin'], DEFAULTS['smallEaveK'], DEFAULTS['smallEaveC'])},
           'rise': {'layout': RISE_LAYOUT, 'used': round(RISE, 3), 'designInference': RISE_INFERRED,
                    'rule': 'clamp(layout rise, (HVW+eaveOver)*tan(%s°), (HVW+eaveOver)*tan(%s°))' % (DEFAULTS['minRoofPitchDeg'], DEFAULTS['maxRoofPitchDeg'])},
           'upperSetback': ({'default': SETBACK_LAYOUT, 'used': round(SETBACK, 3), 'designInference': SETBACK_INFERRED,
                             'rule': 'max(minUpperSetbackM, min(upperSetback, 墙线进深 − minUpperFloorDepthM))，仅进深不足时'} if MULTI else None),
           'xieshanScaled': None if XS_MODE else XIESHAN_SCALED,
           'ornamentScale': {'param': DEFAULTS.get('ornamentScale', 'auto'),
                             'applied': None if XS_MODE else round(eave_kit.ornament_scale(
                                 {'ornamentScale': DEFAULTS.get('ornamentScale', 'auto')}, 2 * HVW), 3),
                             'note': '歇山传给 eave_kit.xieshan_roof；硬山正脊为本文件小截面，不经 kit'}},
          open(os.path.join(OUT_DIR, 'recipe.json'), 'w'), ensure_ascii=False, indent=1)
print('HALLKIT_BUILD', HALL_ID, tris, os.path.getsize(glb_path), 'ridge', round(maxy, 2),
      'rect %.2fx%.2f bays %d@%.2f leaves %d' % (2 * HU, 2 * HV, bay_n, BAY, LEAVES))
if tris > DEFAULTS['budgetTris']:
    raise SystemExit('hall-kit: %d tris > budget %d' % (tris, DEFAULTS['budgetTris']))
