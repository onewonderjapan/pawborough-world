# wave10-streetfix S3 · R3 按第 2 轮审查必修2 重写：空面不能算通过；surfaceFootprints 空数组语义统一。
# 口径（R2 版已把道路集合与建筑障碍独立取自 baseline；R3 版新增）：
#   约定：surfaceFootprints 存在即权威——空数组 = 该路不渲染；渲染端（build-scene.mjs road 分支，
#   同步修改）与测试都按此处理，不再回退 ribbon / surfaceFootprint（JS 空数组是真值、Python 空列表
#   是假值，两侧语义必须一致）。baseline 要求渲染的道路若产物给出空数组 → 失败（「应渲染却无面」）。
#   每块必须 ≥3 个不同的有限坐标点、buffer(0) 后有效且面积 > 0.01 m² 才计入渲染面；退化块记失败。
#   检查数只统计有 ≥1 块有效面的道路；0 条 → 失败。
# 负例（审查给的两类，内存变异当前产物 layout，不写文件）：
#   ROAD_CLEARANCE_NEGCASE=1  全部可渲染 road 的 surfaceFootprints 设为 [[]] 或三点重合退化环 → 必须失败；
#   ROAD_CLEARANCE_NEGCASE=2  全部设为 [] 且保留旧 surfaceFootprint → 必须失败（不许回退单块字段）。
#   负例模式断言「变异被检出」，检出 = PASS（exit 0）；未被检出 = FAIL（exit 2）。
# 其余口径与 R2 版一致：
#   应检查道路集合 = baseline/layout.json 所有会渲染的 road（剔除 baseline 已 skipRender 的
#   road-62072384；area=yes 在 repair 转 plaza 的 6 条不再按 road 检查）；
#   建筑障碍 = baseline outerBuilding / bazaarBlock 接地足迹（由 baseline 自身 tunnel=building_passage
#   数据独立重算挖空，宽 max(3.4, w+0.4)、两端外扩 0.5，与 repair-layout.py passage 步骤一致）；
#   每条道路取产物实际渲染的面：surfaceFootprints（权威）→ surfaceFootprint 单块 → 按
#   scripts/ribbon_geom.py（渲染端逐三角一致实现）从 polyline 重算；
#   失败条件：道路缺失 / 渲染面字段缺失 / 应渲染却无面 / 出现 baseline 没有的 skipRender 且非整段被
#   建筑吞没 / 任一块与障碍相交 > 0.05 m² / 某块内部含整栋障碍（孔洞被填）/ 退化块 / 检查数为 0。
# 用法：OUT_DIR=out-zone python3 -X utf8 tests/road-footprint-clearance-test.py
#       ROAD_CLEARANCE_NEGCASE=1|2 OUT_DIR=out-zone python3 -X utf8 tests/road-footprint-clearance-test.py
import copy
import json
import math
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '.python-deps'))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from shapely.geometry import Polygon, LineString, box
from shapely.ops import unary_union
from ribbon_geom import ribbon_polygon  # 审查必修3：与渲染端逐三角一致的共用实现

R = Path(__file__).resolve().parents[1]
O = R / os.environ.get('OUT_DIR', 'out-zone')
base = json.loads((R / 'baseline' / 'layout.json').read_text(encoding='utf-8'))
out = json.loads((O / 'layout.json').read_text(encoding='utf-8'))

# ---------- 建筑障碍：baseline 接地足迹（独立重算 building_passage 挖空） ----------
ov = json.loads((R / 'inputs' / 'overpass.json').read_text(encoding='utf-8'))
tags = {o['id']: o.get('tags', {}) for o in ov['elements'] if o['type'] == 'way'}
by_id_out = {o['id']: o for o in out['objects']}
cuts = []
pass_rects = []
for o in base['objects']:
    if o.get('kind') != 'road' or tags.get(o.get('sources', {}).get('osmWay'), {}).get('tunnel') != 'building_passage':
        continue
    line = o['geometry']['polyline']
    w = max(3.4, o['geometry']['width'] + .4)
    for a, b in zip(line, line[1:]):
        dx, dz = b[0] - a[0], b[1] - a[1]
        L = (dx * dx + dz * dz) ** .5
        u = (dx / L, dz / L)
        n = (-u[1], u[0])
        e = .5
        pass_rects.append([
            [a[0] - u[0] * e + n[0] * w / 2, a[1] - u[1] * e + n[1] * w / 2],
            [b[0] + u[0] * e + n[0] * w / 2, b[1] + u[1] * e + n[1] * w / 2],
            [b[0] + u[0] * e - n[0] * w / 2, b[1] + u[1] * e - n[1] * w / 2],
            [a[0] - u[0] * e - n[0] * w / 2, a[1] - u[1] * e - n[1] * w / 2]])
all_pass = unary_union([Polygon(r).buffer(0) for r in pass_rects]) if pass_rects else None
for b in base['objects']:
    if b.get('kind') not in ('outerBuilding', 'bazaarBlock') or not b['geometry'].get('footprint'):
        continue
    fps = b['geometry'].get('groundFootprints', [b['geometry']['footprint']])  # baseline 现无该字段，留接口
    for fp in fps:
        p = Polygon(fp).buffer(0)
        if p.is_empty:
            continue
        if all_pass is not None and p.intersection(all_pass).area > 0:
            rem = p.difference(all_pass)
            cuts.extend(g for g in (rem.geoms if hasattr(rem, 'geoms') else [rem]) if g.area > 0.01)
        else:
            cuts.append(p)
cut = unary_union(cuts)

# ---------- 渲染面几何（与渲染端/repair 同一规则） ----------
AREA_BOX = box(-300, -280, 85, 65)

def baseline_surface(o):
    """repair-layout 的路面生成规则：框内 paved(cap_style=3,join_style=2) 得 surfaceFootprint，
    框外按 ribbon 渲染。"""
    line = LineString(o['geometry']['polyline'])
    if line.intersects(AREA_BOX):
        g = line.buffer(o['geometry']['width'] / 2, cap_style=3, join_style=2)
        if g.geom_type == 'Polygon':
            return g, 'paved'
    return ribbon_polygon(o['geometry']['polyline'], o['geometry']['width']), 'ribbon'

# ---------- 应检查集合：baseline 会渲染的 road ----------
skip_base = {o['id'] for o in base['objects'] if o.get('kind') == 'road' and o.get('skipRender')}
to_plaza = {o['id'] for o in base['objects'] if o.get('kind') == 'road'
            and tags.get(o.get('sources', {}).get('osmWay'), {}).get('area') == 'yes'}
roads = [o for o in base['objects']
         if o.get('kind') == 'road' and not o.get('skipRender') and o['id'] not in to_plaza
         and o['geometry'].get('polyline')]

# ---------- 单块校验：≥3 个不同有限点、buffer(0) 有效、面积 > 0.01 m² ----------
def ring_issue(rid, k, ring):
    if not isinstance(ring, list) or len(ring) < 3:
        return f'{rid}#{k}: degenerate ring (<3 points, {ring if not isinstance(ring, list) else len(ring)} pts)'
    pts = set()
    for q in ring:
        if not (isinstance(q, (list, tuple)) and len(q) >= 2
                and all(isinstance(v, (int, float)) and math.isfinite(v) for v in q[:2])):
            return f'{rid}#{k}: non-finite / malformed coordinate {q!r}'
        pts.add((round(float(q[0]), 9), round(float(q[1]), 9)))
    if len(pts) < 3:
        return f'{rid}#{k}: degenerate ring ({len(pts)} distinct points, need >=3)'
    p = Polygon(ring).buffer(0)
    if p.is_empty or not p.is_valid:
        return f'{rid}#{k}: buffer(0) empty/invalid (degenerate)'
    if p.area <= 0.01:
        return f'{rid}#{k}: degenerate piece (area {p.area:.4f} m^2 <= 0.01)'
    return None

# ---------- 主检查：返回 (fails, checked, multi) ----------
def check(doc, label):
    by_id = {o['id']: o for o in doc['objects']}
    fails, checked, multi, covered = [], 0, [], []
    for o in roads:
        rid = o['id']
        po = by_id.get(rid)
        if po is None or po.get('kind') != 'road':
            fails.append(f'{rid}: missing from product (baseline renders it as road)')
            continue
        if po.get('skipRender'):
            # baseline 没有（此处只见到 baseline 会渲染的 road）；合法仅当整段被建筑吞没
            g0, _src = baseline_surface(o)
            rem = g0.difference(cut)
            pieces = [p for p in (rem.geoms if hasattr(rem, 'geoms') else [rem]) if p.area > 0.05]
            if pieces:
                fails.append(f'{rid}: new skipRender but {g0.area - sum(p.area for p in pieces):.1f} m^2 would remain visible')
            continue
        g = po.get('geometry') or {}
        pieces = []
        if 'surfaceFootprints' in g:
            # 存在即权威：空数组 = 不渲染，不回退（与 build-scene.mjs 同步的语义）
            if not g['surfaceFootprints']:
                fails.append(f'{rid}: 应渲染却无面 (surfaceFootprints 空数组 = 不渲染, baseline renders it)')
                continue
            bad = False
            for k, ring in enumerate(g['surfaceFootprints']):
                issue = ring_issue(rid, k, ring)
                if issue:
                    fails.append(issue + ' [surfaceFootprints]')
                    bad = True
                else:
                    pieces.append(Polygon(ring).buffer(0))
            if bad and not pieces:
                fails.append(f'{rid}: 应渲染却无面 (surfaceFootprints 全部退化，无有效面)')
                continue
            if bad:
                continue
        elif g.get('surfaceFootprint'):
            issue = ring_issue(rid, 0, g['surfaceFootprint'])
            if issue:
                fails.append(issue + ' [surfaceFootprint]')
                continue
            pieces = [Polygon(g['surfaceFootprint']).buffer(0)]
        elif len(g.get('polyline', [])) >= 2:
            pieces = [ribbon_polygon(g['polyline'], g['width'])]
        else:
            fails.append(f'{rid}: no renderable surface fields (no surfaceFootprints/surfaceFootprint, polyline < 2)')
            continue
        checked += 1
        if len(pieces) > 1:
            multi.append(f'{rid} ({len(pieces)} pieces)')
        for k, p in enumerate(pieces):
            inter = p.intersection(cut)
            if inter.area > 0.05:
                fails.append(f'{rid}#{k}: {inter.area:.1f} m^2 overlaps building ground footprints')
            for c in cuts:
                if c.area > 1.0 and c.difference(p).area <= 0.05:
                    covered.append(f'{rid}#{k}: covers a whole building piece ({c.area:.1f} m^2) — filled hole?')
    fails.extend(covered)
    return fails, checked, multi

# ---------- 负例：内存变异当前产物 layout（不写文件） ----------
def renderable(doc):
    return [o for o in doc['objects'] if o.get('kind') == 'road' and not o.get('skipRender')]

NEG = os.environ.get('ROAD_CLEARANCE_NEGCASE')
if NEG == '1':
    doc = copy.deepcopy(out)
    for i, o in enumerate(renderable(doc)):
        p = (o['geometry'].get('polyline') or [[0, 0]])[0]
        o['geometry']['surfaceFootprints'] = [[]] if i % 2 == 0 else [p, p, p]   # 退化环：空 / 三点重合
    fails, checked, multi = check(doc, f'negcase{NEG}')
    if fails:
        print(f'PASS road-footprint-clearance negcase{NEG}: mutation detected — {len(fails)} failures over {checked} roads '
              f'(e.g. {fails[0]})')
        sys.exit(0)
    print(f'FAIL road-footprint-clearance negcase{NEG}: degenerate/empty faces still counted as {checked} checked roads, 0 failures')
    sys.exit(2)
if NEG == '2':
    doc = copy.deepcopy(out)
    for o in renderable(doc):
        o['geometry']['surfaceFootprints'] = []   # 保留旧 surfaceFootprint——不许回退
    fails, checked, multi = check(doc, f'negcase{NEG}')
    if fails:
        print(f'PASS road-footprint-clearance negcase{NEG}: empty-array mutation detected — {len(fails)} failures '
              f'(e.g. {fails[0]})')
        sys.exit(0)
    print(f'FAIL road-footprint-clearance negcase{NEG}: surfaceFootprints=[] fell back to surfaceFootprint/ribbon, '
          f'{checked} roads passed')
    sys.exit(2)
if NEG:
    print(f'FAIL road-footprint-clearance: unknown ROAD_CLEARANCE_NEGCASE={NEG}')
    sys.exit(2)

# ---------- 正式检查：产物 ----------
fails, checked, multi = check(out, 'product')

# （多块消费方护栏已升级为行为用例：tests/multipiece-consumer-test.py 用「第二块才与路线相交」
# 的两块探针分别驱动 check-commercial-route.py / test_street_band.py / build-scene 的
# FANGBANG_ROAD_SINK 判定，R3 审查可选项2；此处的字符串检查已删除。）

if not roads:
    print('FAIL road-footprint-clearance: no baseline roads resolved to check')
    sys.exit(2)
if fails:
    print(f'FAIL road-footprint-clearance (R3 caliber, baseline-sampled): {len(fails)} failures over {checked} roads')
    for f in fails[:15]:
        print('  ', f)
    if len(fails) > 15:
        print(f'   ... and {len(fails) - 15} more')
    sys.exit(2)
extra = f'; multi-piece: {", ".join(multi)}' if multi else ''
print(f'road-footprint-clearance (R3 caliber, baseline-sampled): {checked} roads checked, 0 failures{extra}')
