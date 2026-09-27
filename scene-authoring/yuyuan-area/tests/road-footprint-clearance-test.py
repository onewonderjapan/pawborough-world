# wave10-streetfix S3 · R2 按审查必修3改写：道路路面不得覆盖 outerBuilding / bazaarBlock 接地足迹。
# 口径（与 R1 版的区别：道路集合与建筑障碍都独立取自 baseline，不拿待验产物决定查谁——R1 版把
# 道路/障碍都取自 OUT_DIR，删光道路字段测试仍过，审查打回）：
#   应检查道路集合 = baseline/layout.json 所有会渲染的 road（剔除 baseline 已 skipRender 的
#   road-62072384；area=yes 在 repair 转 plaza 的 6 条不再按 road 检查）；
#   建筑障碍 = baseline outerBuilding / bazaarBlock 接地足迹（groundFootprints 优先——baseline 无该
#   字段，故由 baseline 自身的 tunnel=building_passage 数据独立重算挖空，几何与 repair-layout.py
#   passage 步骤一致：宽 max(3.4, w+0.4)、两端外扩 0.5；骑楼下路面保留，与
#   check-commercial-route.py 的障碍口径一致）。
#   每条道路取产物实际渲染的面（镜像 build-scene.mjs road 分支）：有 surfaceFootprints 用之，否则
#   surfaceFootprint 单块，否则按渲染端 ribbon() 同一几何（中心差分方向、平头端 quad strip）从
#   polyline 重算。
# 以下任一情况失败：
#   1) 应检查的道路在产物里缺失；2) 渲染面字段缺失（无 surface 字段且 polyline < 2 点）；
#   3) 出现 baseline 没有的 skipRender 且该路面并非整段被建筑吞没（按 repair 同一规则复算：
#      框内 paved / 框外 ribbon，差建筑接地并集后无 >0.05 m² 的块）；
#   4) 任一面块与障碍相交 > 0.05 m²；5) 某块内部含整栋障碍（孔洞被填）；
#   6) 检查到的道路数为 0。
#   另加护栏：若出现 >1 块的裁块路面，三个旧消费方（check-commercial-route.py、
#   modules/bazaar-tower-kit/test_street_band.py、build-scene.mjs FANGBANG_ROAD_SINK）必须读
#   surfaceFootprints 并集——文件里应出现该字段（缺失则提示改消费方）。
# 用法：OUT_DIR=out-zone python3 -X utf8 tests/road-footprint-clearance-test.py
import json
import math
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '.python-deps'))
from shapely.geometry import Polygon, LineString, box
from shapely.ops import unary_union

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
def ribbon_surface(pts, width):
    """src/lib.mjs ribbon()：中心差分方向、平头端 quad strip 的外轮廓。"""
    n = len(pts)
    left, right = [], []
    for i in range(n):
        a = pts[max(0, i - 1)]
        b = pts[min(n - 1, i + 1)]
        dx, dz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dz) or 1
        nx, nz = -dz / L * width / 2, dx / L * width / 2
        left.append([pts[i][0] + nx, pts[i][1] + nz])
        right.append([pts[i][0] - nx, pts[i][1] - nz])
    return Polygon(left + right[::-1]).buffer(0)

AREA_BOX = box(-300, -280, 85, 65)

def baseline_surface(o):
    """repair-layout 的路面生成规则：框内 paved(cap_style=3,join_style=2) 得 surfaceFootprint，
    框外按 ribbon 渲染。"""
    line = LineString(o['geometry']['polyline'])
    if line.intersects(AREA_BOX):
        g = line.buffer(o['geometry']['width'] / 2, cap_style=3, join_style=2)
        if g.geom_type == 'Polygon':
            return g, 'paved'
    return ribbon_surface(o['geometry']['polyline'], o['geometry']['width']), 'ribbon'

# ---------- 应检查集合：baseline 会渲染的 road ----------
skip_base = {o['id'] for o in base['objects'] if o.get('kind') == 'road' and o.get('skipRender')}
to_plaza = {o['id'] for o in base['objects'] if o.get('kind') == 'road'
            and tags.get(o.get('sources', {}).get('osmWay'), {}).get('area') == 'yes'}
roads = [o for o in base['objects']
         if o.get('kind') == 'road' and not o.get('skipRender') and o['id'] not in to_plaza
         and o['geometry'].get('polyline')]

fails = []
checked = 0
multi = []
covered = []
for o in roads:
    rid = o['id']
    po = by_id_out.get(rid)
    if po is None or po.get('kind') != 'road':
        fails.append(f'{rid}: missing from product (baseline renders it as road)')
        continue
    if po.get('skipRender'):
        # baseline 没有（此处只见到 baseline 会渲染的 road）；合法仅当整段被建筑吞没
        g, _src = baseline_surface(o)
        rem = g.difference(cut)
        pieces = [p for p in (rem.geoms if hasattr(rem, 'geoms') else [rem]) if p.area > 0.05]
        if pieces:
            fails.append(f'{rid}: new skipRender but {g.area - sum(p.area for p in pieces):.1f} m^2 would remain visible')
        continue
    g = po.get('geometry') or {}
    if g.get('surfaceFootprints'):
        pieces = [Polygon(r).buffer(0) for r in g['surfaceFootprints']]
    elif g.get('surfaceFootprint'):
        pieces = [Polygon(g['surfaceFootprint']).buffer(0)]
    elif len(g.get('polyline', [])) >= 2:
        pieces = [ribbon_surface(g['polyline'], g['width'])]
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

# 护栏：多块路面出现时，旧消费方必须读 surfaceFootprints 并集（wave10-streetfix R2 已改三处；
# 若此处失败说明有人回退了消费方——按审查可选项1改读并集后再合入）
if multi:
    consumers = [
        R / 'scripts' / 'check-commercial-route.py',
        R / 'modules' / 'bazaar-tower-kit' / 'test_street_band.py',
        R / 'src' / 'build-scene.mjs',
    ]
    missing = [str(c.relative_to(R)) for c in consumers
               if 'surfaceFootprints' not in c.read_text(encoding='utf-8')]
    if missing:
        fails.append('multi-piece road surfaces exist but consumers do not read surfaceFootprints union: '
                     + ', '.join(missing) + ' — 改消费方')

if not roads:
    print('FAIL road-footprint-clearance: no baseline roads resolved to check')
    sys.exit(2)
if fails:
    print(f'FAIL road-footprint-clearance (R2 caliber, baseline-sampled): {len(fails)} failures over {checked} roads')
    for f in fails[:15]:
        print('  ', f)
    if len(fails) > 15:
        print(f'   ... and {len(fails) - 15} more')
    sys.exit(2)
extra = f'; multi-piece: {", ".join(multi)}' if multi else ''
print(f'road-footprint-clearance (R2 caliber, baseline-sampled): {checked} roads checked, 0 failures{extra}')
