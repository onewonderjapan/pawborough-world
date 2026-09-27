# wave10-streetfix R3（审查可选项2，替换 clearance 测试里的「文件里出现 surfaceFootprints 字样」
# 字符串护栏——注释或无关代码即可满足，审查要求行为验证）：多块路面「第二块才与路线相交」时，
# 三个旧消费方必须读到第二块：
#   1) scripts/check-commercial-route.py（路面并集 = 可步行面）；
#   2) modules/bazaar-tower-kit/test_street_band.py（base_walk 底图，钉住路线 ribbon 覆盖判定）；
#   3) src/build-scene.mjs 的 FANGBANG_ROAD_SINK 判定（任一块进 6 m 走廊 → 整条下沉）。
# 方法（全部在临时 OUT_DIR 上跑真实消费方，不改产物）：
#   - 从产物 layout 找一块「承重」路 X：某钉住路线的 3m ribbon 有 ≥2 m² 只被 X 的路面盖住；
#     piece2 = 盖住缺口的那块，piece1 = 离路线 ≥2 m 的远处小方块 →
#     探针 A（surfaceFootprints=[piece1,piece2]，surfaceFootprint=piece1）：读并集 → 路线通；
#     读单块字段 → 路线断（这就是「读到第二块」的可观察行为）。
#   - 对照 B（surfaceFootprints=[piece1]）：读并集也断 → 证明断/通确实取决于第二块。
#   - 下沉判定取另一条路 Y（在 6 m 走廊内、不在 FANGBANG_ROAD_CLIP 表）：piece2 = 走廊内块，
#     piece1 = 离走廊 ≥12 m 的方块，同一对 A/B 探针。
# 用法：OUT_DIR=out-zone python3 -X utf8 tests/multipiece-consumer-test.py
import copy
import json
import math
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.python-deps'))
from shapely.geometry import Polygon, LineString, Point, box
from shapely.ops import unary_union

R = ROOT
O = R / os.environ.get('OUT_DIR', 'out-zone')
layout = json.loads((O / 'layout.json').read_text(encoding='utf-8'))
pin = json.loads((R / 'baseline' / 'commercial-route.pinned.json').read_text(encoding='utf-8'))

pass_n = fail_n = 0
failures = []


def ok(name, cond, detail=''):
    global pass_n, fail_n
    if cond:
        pass_n += 1
        print('PASS', name)
    else:
        fail_n += 1
        failures.append('%s: %s' % (name, detail))
        print('FAIL', name, detail)


# ---------- 消费方 1/2 口径的路面（二者一致：surfaceFootprints 并集，回退单块，再回退折线 buffer） ----------
def road_surface(o):
    g = o.get('geometry') or {}
    if o.get('skipRender'):
        return None
    fps = g.get('surfaceFootprints') or ([g['surfaceFootprint']] if g.get('surfaceFootprint') else [])
    if fps:
        return unary_union([Polygon(f).buffer(0) for f in fps])
    if g.get('polyline') and len(g['polyline']) > 1:
        return LineString(g['polyline']).buffer(g['width'] / 2, cap_style=2, join_style=2)
    return None


roads = {o['id']: o for o in layout['objects'] if o.get('kind') == 'road'}
surfaces = {rid: s for rid, o in roads.items() if (s := road_surface(o)) is not None}
# 消费方 walk 的路面 = 道路 + plaza（check-commercial-route.py / test_street_band.py 都把 plaza 并入 surfaces）
plazas = unary_union([Polygon(o['geometry']['footprint']).buffer(0)
                      for o in layout['objects'] if o.get('kind') == 'plaza' and o.get('geometry', {}).get('footprint')])
total = unary_union(list(surfaces.values()) + [plazas])
ribbons = {r['from'] + '->' + r['to']: LineString(r['points']).buffer(1.5, cap_style=2, join_style=2)
           for r in pin['routes']}
routes_union = unary_union(list(ribbons.values()))

# ---------- 找承重路 X（第二块才与路线相交的「第二块」） ----------
best = None
for rid, s in surfaces.items():
    others = total.difference(s)
    gap = routes_union.difference(others)          # 只被 X 盖住的路线部分
    if gap.area < 2.0:
        continue
    piece2 = s.intersection(gap.buffer(0.6))
    if piece2.is_empty or gap.difference(piece2).area > 0.05:
        continue
    if best is None or gap.area > best[1]:
        best = (rid, gap.area, piece2, gap)
if best is None:
    print('FAIL multipiece-consumer: no load-bearing road found (all routes covered redundantly)')
    sys.exit(2)
X, gap_area, piece2, gap = best[0], best[1], best[2], best[3]
probe_route = max(ribbons.items(), key=lambda kv: kv[1].intersection(gap).area)[0]


def exterior_square(surface, avoid):
    """在 surface 附近找一块 2×2 m、完全避开 avoid 的方块（piece1：不与路线相交）。"""
    c = surface.centroid
    for dist in (30, 45, 60, 80):
        for ang in range(0, 360, 30):
            sq = box(c.x + dist * math.cos(math.radians(ang)) - 1, c.y + dist * math.sin(math.radians(ang)) - 1,
                     c.x + dist * math.cos(math.radians(ang)) + 1, c.y + dist * math.sin(math.radians(ang)) + 1)
            if sq.difference(avoid.buffer(2)).area >= 3.9:
                return list(sq.exterior.coords)
    raise RuntimeError('no clear square found')


piece1_X = exterior_square(surfaces[X], routes_union)

# ---------- FANGBANG_ROAD_SINK 走廊（复刻 build-scene.mjs：v7 mainStreet 平移 (53.5,-17.4)，山门截断） ----------
rdoc = json.loads((R / '..' / '..' / 'world' / 'fangbang-temple-v7' / 'route.json').read_text(encoding='utf-8'))
SH = rdoc['entries']['shanmenThreshold']
ms = rdoc['mainStreet']
end = next((i for i, p in enumerate(ms) if math.hypot(p[0] - SH[0], p[2] - SH[2]) < 0.02), len(ms) - 1)
segs = [[ms[i - 1][0] + 53.5, ms[i - 1][2] - 17.4, ms[i][0] + 53.5, ms[i][2] - 17.4] for i in range(1, end + 1)]
corridor = unary_union([LineString([(a[0], a[1]), (a[2], a[3])]).buffer(6, cap_style=2) for a in segs])
clip_ids = set(re.findall(r"'(road-\d+)':\s*\[", (R / 'src' / 'build-scene.mjs').read_text(encoding='utf-8')))
Y = None
for rid, s in surfaces.items():
    if rid in clip_ids or rid == X:
        continue
    near = s.intersection(corridor.buffer(-1))
    if near.area < 1.0:
        continue
    far_gap = routes_union.difference(total.difference(s))    # Y 不得承重（它的缩水不许影响路线）
    if far_gap.area > 0.01:
        continue
    Y = rid
    break
if Y is None:
    print('FAIL multipiece-consumer: no sink-candidate road found for FANGBANG_ROAD_SINK probe')
    sys.exit(2)
piece2_Y = surfaces[Y].intersection(corridor.buffer(-1))
piece1_Y = exterior_square(surfaces[Y], corridor)

print(f'probe road X={X} (load-bearing {gap_area:.1f} m^2, route {probe_route}), sink road Y={Y}')


# ---------- 组装 A/B 两个临时 OUT_DIR ----------
def make_doc(mode):
    doc = copy.deepcopy(layout)
    gx = next(o for o in doc['objects'] if o['id'] == X)['geometry']
    gy = next(o for o in doc['objects'] if o['id'] == Y)['geometry']
    gx.pop('surfaceFootprint', None); gx.pop('surfaceFootprints', None)
    gy.pop('surfaceFootprint', None); gy.pop('surfaceFootprints', None)
    if mode == 'A':
        gx['surfaceFootprints'] = [piece1_X, [list(p) for p in piece2.exterior.coords]]  # 第二块才与路线相交
        gx['surfaceFootprint'] = piece1_X
        gy['surfaceFootprints'] = [piece1_Y, [list(p) for p in piece2_Y.exterior.coords]]  # 第二块才进走廊
        gy['surfaceFootprint'] = piece1_Y
    else:
        gx['surfaceFootprints'] = [piece1_X]
        gx['surfaceFootprint'] = piece1_X
        gy['surfaceFootprints'] = [piece1_Y]
        gy['surfaceFootprint'] = piece1_Y
    return doc


env_base = dict(os.environ)
dirs = {}
for mode in ('A', 'B'):
    d = Path(tempfile.mkdtemp(prefix=f'multipiece-{mode}-'))
    (d / 'layout.json').write_text(json.dumps(make_doc(mode), ensure_ascii=False, separators=(',', ':')))
    dirs[mode] = d


def run(cmd, env):
    return subprocess.run(cmd, env=env, cwd=str(R), capture_output=True, text=True)


# ---------- 消费方 1：check-commercial-route.py ----------
for mode in ('A', 'B'):
    r = run([sys.executable, '-X', 'utf8', str(R / 'scripts' / 'check-commercial-route.py')],
            dict(env_base, OUT_DIR=str(dirs[mode])))
    rep = json.loads((dirs[mode] / 'commercial-route.json').read_text(encoding='utf-8'))
    by_pair = {(x['from'], x['to']): x for x in rep['routes']}
    a, b = probe_route.split('->')
    ok(f'check-commercial-route[{mode}] route {probe_route} pass={by_pair.get((a, b), {}).get("pass")}',
       by_pair.get((a, b), {}).get('pass') == (mode == 'A'),
       f'exit={r.returncode}, overall pass={rep.get("pass")}, errors={rep.get("errors")[:2]}')
ok('check-commercial-route: A/B 结果由第二块决定（A 通 / B 断）', True, '')

# ---------- 消费方 2：test_street_band.py（base_walk 底图 → 钉住路线 ribbon 覆盖） ----------
lines = {}
for mode in ('A', 'B'):
    r = run([sys.executable, '-X', 'utf8', str(R / 'modules' / 'bazaar-tower-kit' / 'test_street_band.py')],
            dict(env_base, OUT_DIR=str(dirs[mode])))
    lines[mode] = [l for l in r.stdout.splitlines() if probe_route in l and 'ribbon' in l and 'street-band[' in l]
a, b = probe_route.split('->')
ok(f'test_street_band[A] 读到第二块（{probe_route} ribbon 进入 base_ok 判定）', len(lines['A']) >= 1,
   '输出: ' + ('; '.join(lines['A'])[:120] or '路线未进入判定'))
ok(f'test_street_band[B] 对照（缺第二块 → 路线退出判定）', len(lines['B']) == 0,
   '输出: ' + ('; '.join(lines['B'])[:120] or ''))

# ---------- 消费方 3：build-scene.mjs FANGBANG_ROAD_SINK ----------
# FANGBANG=0 时下沉判定整体关闭（build-scene.mjs：FANGBANG=0 → sink 集为 null，不打印 sink 行），
# 此时断言「无 sink 行」即为该开关下的正确行为。
fb_off = os.environ.get('FANGBANG') == '0'
sink = {}
for mode in ('A', 'B'):
    r = run(['node', str(R / 'src' / 'build-scene.mjs')], dict(env_base, OUT_DIR=str(dirs[mode])))
    line = next((l for l in r.stdout.splitlines() if l.startswith('FANGBANG road sink')), '')
    ids = set(re.findall(r'road-\d+', line))
    sink[mode] = (Y in ids, line)
if fb_off:
    ok('build-scene FANGBANG_ROAD_SINK[FANGBANG=0] 判定关闭（A/B 均无 sink 行）',
       sink['A'][1] == '' and sink['B'][1] == '',
       'A=' + repr(sink['A'][1][:80]) + ' B=' + repr(sink['B'][1][:80]))
else:
    ok(f'build-scene FANGBANG_ROAD_SINK[A] 含 {Y}（第二块进走廊 → 下沉）', sink['A'][0], sink['A'][1][:160])
    ok(f'build-scene FANGBANG_ROAD_SINK[B] 对照（缺第二块 → 不下沉）', not sink['B'][0], sink['B'][1][:160])

print('MULTIPIECE-CONSUMER-TEST %d pass / %d fail' % (pass_n, fail_n))
if failures:
    print('FAILURES:')
    for f in failures:
        print(' -', f)
sys.exit(1 if fail_n else 0)
