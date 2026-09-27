# wave10-streetfix R4（第 3 轮审查必修1）负例：空数组契约贯彻到所有道路消费方。
# 契约（与 build-scene.mjs road 分支一致）：surfaceFootprints 字段存在即权威，空数组 = 空几何，
# 绝不回退旧单块字段 surfaceFootprint 或 polyline 折线 ribbon。
# 变异（内存构造，不写产物）：产物 layout 所有非 skipRender 的 road 设 surfaceFootprints=[]，
# 旧字段原样保留 —— 修好的消费方必须视作「路上没有面」；带 `or` 回退的旧消费方会把折线 buffer
# 当回路面（第 3 轮审查实测：变异前后可行走面积同为 23283.456246 m²、old-south→old-north 仍判通）。
# 三个真实消费方（临时 OUT_DIR 只承载运行输入/输出，产物目录不碰；惯例同 tests/multipiece-consumer-test.py）：
#   1) scripts/check-commercial-route.py：道路贡献的可行走面积必须降为 0 附近（plaza 不受影响）；
#      old-south→old-north 必须判断不通（exit 非 0）；
#   2) scripts/check-connectivity.mjs：其 R2 段调用 1)（继承契约）；桥端铺面检查按本审查要求改用
#      实际路面 —— 空数组路不得再作为桥端铺面出现（变异 run 的 bridge ends surface 不得引用任何被清空的路），
#      整体 exit 非 0。
# 断言失败 → exit 1（负例被检出时本测试自身必须 exit 0）。
# 道路取面走 scripts/road_surface.py 的 road_surface_polys —— 即两个 Python 消费方 import 的同一实现。
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.python-deps'))
sys.path.insert(0, str(ROOT / 'scripts'))
import shapely
from shapely.geometry import Polygon, LineString, box
from shapely.ops import unary_union
from road_surface import road_surface_polys

R = ROOT
O = R / os.environ.get('OUT_DIR', 'out-zone')
doc = json.loads((O / 'layout.json').read_text(encoding='utf-8'))
AREA = box(-300, -280, 85, 65)

fails = []


def ok(name, cond, detail=''):
    print(('PASS' if cond else 'FAIL'), name, detail)
    if not cond:
        fails.append(name)


# ---------- 变异（内存）：所有非 skipRender road → surfaceFootprints=[]，旧字段保留 ----------
def mutate(d):
    d = json.loads(json.dumps(d))  # 深拷贝
    n = 0
    for o in d['objects']:
        if o.get('kind') == 'road' and not o.get('skipRender'):
            o['geometry']['surfaceFootprints'] = []
            n += 1
    return d, n


mut, n_roads = mutate(doc)

# ---------- 可行走面积（消费方公式，路面取自共享实现 road_surface_polys） ----------
def walkable(d):
    surfaces, obstacles = [], []
    for o in d['objects']:
        g = o.get('geometry') or {}
        if o.get('skipRender'):
            continue
        if o['kind'] == 'road' and g.get('polyline'):
            surfaces.extend(road_surface_polys(g))
        if o['kind'] == 'plaza':
            surfaces.append(Polygon(g['footprint']).buffer(0))
        if o['kind'] in ['outerBuilding', 'bazaarBlock', 'hall', 'tower', 'pavilion', 'xuan',
                         'waterside', 'watersideGallery', 'stage'] and g.get('footprint'):
            obstacles.extend(Polygon(fp).buffer(0) for fp in g.get('groundFootprints', [g['footprint']]))
        if o['kind'] == 'water':
            obstacles.append(Polygon(g['footprint']).buffer(0))
        if o['kind'] == 'wall':
            obstacles.extend(LineString(s).buffer(.18) for s in g.get('segments', []))
    return unary_union(surfaces).intersection(AREA).difference(unary_union(obstacles))


def plaza_only(d):
    plazas = unary_union([Polygon(o['geometry']['footprint']).buffer(0)
                          for o in d['objects'] if o.get('kind') == 'plaza'
                          and (o.get('geometry') or {}).get('footprint')])
    return plazas


walk_base = walkable(doc)
walk_mut = walkable(mut)
plazas = plaza_only(doc)
road_contrib_base = walk_base.area - walk_base.intersection(plazas).area
road_contrib_mut = walk_mut.area - walk_mut.intersection(plazas).area
print('walkable baseline %.6f m^2, mutated %.6f m^2; road contribution %.6f -> %.6f m^2 (%d roads emptied)'
      % (walk_base.area, walk_mut.area, road_contrib_base, road_contrib_mut, n_roads))
ok('道路贡献的可行走面积降为 0 附近（≤0.5 m²）', road_contrib_mut <= 0.5,
   'baseline %.3f -> mutated %.3f' % (road_contrib_base, road_contrib_mut))
ok('plaza 可行走面不受变异影响（±1 m²）', abs((walk_mut.intersection(plazas).area)
   - (walk_base.intersection(plazas).area)) <= 1.0)

# ---------- 消费方 1/2：临时 OUT_DIR 上跑真实脚本 ----------
tmp = Path(tempfile.mkdtemp(prefix='road-consumer-empty-'))
(tmp / 'layout.json').write_text(json.dumps(mut, ensure_ascii=False, separators=(',', ':')),
                                 encoding='utf-8')
env = dict(os.environ, OUT_DIR=str(tmp))

r1 = subprocess.run([sys.executable, '-X', 'utf8', str(R / 'scripts' / 'check-commercial-route.py')],
                    env=env, cwd=str(R), capture_output=True, text=True)
ok('check-commercial-route[mutated] 判定失败（exit 非 0）', r1.returncode != 0,
   'returncode=%s stderr=%s' % (r1.returncode, (r1.stderr or '')[-200:]))
rep = json.loads((tmp / 'commercial-route.json').read_text(encoding='utf-8'))
route = next((x for x in rep['routes'] if x['from'] == 'old-south' and x['to'] == 'old-north'), None)
ok("old-south→old-north 判断不通", route is not None and route.get('pass') is False,
   'route=' + json.dumps(route, ensure_ascii=False)[:200])

r2 = subprocess.run(['node', str(R / 'scripts' / 'check-connectivity.mjs')],
                    env=env, cwd=str(R), capture_output=True, text=True)
ok('check-connectivity[mutated] 判定失败（exit 非 0）', r2.returncode != 0,
   'returncode=%s tail=%s' % (r2.returncode, (r2.stderr or r2.stdout or '')[-200:]))
conn = json.loads((tmp / 'connectivity.json').read_text(encoding='utf-8'))
all_road_ids = {o['id'] for o in mut['objects'] if o.get('kind') == 'road'}
cited = []
for b in conn.get('bridges', []):
    for e in b.get('ends', []):
        s = e.get('surface') or {}   # connectivity surfaceNear 回传 {obj, kind, distM, y}
        if s.get('obj') in all_road_ids:
            # 变异后所有非跳过路都是空数组（无面）、skipRender 路本就不渲染 —— 桥端铺面不得再是任何 road
            cited.append('%s end=%s surface=%s' % (b.get('id'), e.get('end'), s.get('obj')))
ok('桥端铺面不再引用任何空数组路（用实际路面而非中心线）', not cited, '; '.join(cited))

print('ROAD-CONSUMER-EMPTY-ARRAY-TEST %d failure(s)' % len(fails))
sys.exit(1 if fails else 0)
