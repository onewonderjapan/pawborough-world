# wave10-streetfix S3（GOAL 通用规则）：道路 surfaceFootprint(s) 不得覆盖 outerBuilding / bazaarBlock
# footprint。源 = OUT_DIR/layout.json（repair-layout 的产物 = 渲染输入），建筑接地足迹并集在本测试内
# 独立重算（groundFootprints 优先——拱廊/骑楼已挖空，与 check-commercial-route.py 的障碍口径一致；
# 无 groundFootprints 时用 footprint）；任意道路面块与建筑接地足迹相交面积 > 0.05 m² 即失败。
# 修前产物上跑必失败（安仁街 road-495101845 等，最深推进建筑内 3.16 m，wave8 l2
# road-centreline-over-buildings.json）。
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '.python-deps'))
from shapely.geometry import Polygon
from shapely.ops import unary_union

R = Path(__file__).resolve().parents[1]
O = R / os.environ.get('OUT_DIR', 'out-zone')
d = json.loads((O / 'layout.json').read_text(encoding='utf-8'))
cut = unary_union([Polygon(fp).buffer(0) for b in d['objects']
                   if b.get('kind') in ('outerBuilding', 'bazaarBlock') and b['geometry'].get('footprint')
                   for fp in b['geometry'].get('groundFootprints', [b['geometry']['footprint']])])
bad = []
checked = 0
for o in d['objects']:
    if o.get('kind') != 'road' or o.get('skipRender'):
        continue
    g = o.get('geometry') or {}
    rings = g.get('surfaceFootprints') or ([g['surfaceFootprint']] if g.get('surfaceFootprint') else [])
    for k, ring in enumerate(rings):
        checked += 1
        inter = Polygon(ring).buffer(0).intersection(cut)
        if inter.area > 0.05:
            bad.append(f"{o['id']}#{k} {inter.area:.1f} m^2 overlap")
if bad:
    print(f'FAIL road-footprint-clearance: {len(bad)} road surface pieces overlap building footprints (checked {checked})')
    for b in bad[:10]:
        print('  ', b)
    sys.exit(2)
print(f'road-footprint-clearance: {checked} road surface pieces clear of outerBuilding/bazaarBlock footprints')
