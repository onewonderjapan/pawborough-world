"""wave5-fangbangqa Q1：眼高普查数据分析（读 fangbang-eye-survey.mjs 的 survey.json，只查不改）。

输出 <SHOT_DIR>/analysis.json：
  floating / buried   各锚世界包围盒底 y（路面 y=0，v7 契约）
  facing              店屋门脸（模块局部 +z）与到路线最近点方向的夹角
  pairs               fangbang 件两两 OBB（局部包围盒 × 锚变换）水平相交：相交面积、穿入深度（相交多边形最小外接矩形短边）
  partPairs           店招 / 雨棚 / 布幌类部件 OBB 穿入相邻件 OBB
  crossZone           非 fangbang 网格顶点（y ≥ 0.15）落入 fangbang 件 OBB（内缩 0.1 m）的数量与深度
  gaps                站点左右水平射线 1.6 m 首中距离 > GAP_M 或无命中
  ground              路面竖直探测：不同网格同高（|Δy| ≤ 0.005）= z-fighting 风险；路面 y 偏离 0
  textures            贴图宽 0（丢失）的部件；shots 近黑占比
  duplicates          同模块锚间距 < 1 m
用法：python3 -X utf8 scripts/fangbang-eye-analyze.py <survey.json> [<analysis.json>]
"""
import json
import math
import sys

from shapely.geometry import Polygon, Point

GAP_M = 16.0
SIGN_MATS = ('sign', 'cotton', 'awning', 'banner', 'flag', 'lantern')
SKIP_FACING = ('strips', 'surface', 'seal-wall', 'temple-bounds', 'interfaces', 'lane-', 'street-ground')

src = sys.argv[1]
dst = sys.argv[2] if len(sys.argv) > 2 else src.replace('survey.json', 'analysis.json')
S = json.load(open(src, encoding='utf-8'))
route = [st['p'] for st in S['stations']]
ground_line = [(g['x'], g['z']) for g in S['ground']]


def obb_poly(a, lo, hi):
    c, s = math.cos(a['rotY']), math.sin(a['rotY'])
    px, pz = a['pos'][0], a['pos'][2]
    pts = []
    for lx, lz in ((lo[0], lo[2]), (hi[0], lo[2]), (hi[0], hi[2]), (lo[0], hi[2])):
        # three.js 绕 Y 旋转：x' = c*x + s*z, z' = -s*x + c*z
        pts.append((px + c * lx + s * lz, pz - s * lx + c * lz))
    return Polygon(pts)


def to_local(a, x, z):
    c, s = math.cos(a['rotY']), math.sin(a['rotY'])
    dx, dz = x - a['pos'][0], z - a['pos'][2]
    return c * dx - s * dz, s * dx + c * dz


def depth(poly):
    if poly.is_empty or poly.area < 1e-6:
        return 0.0
    r = poly.minimum_rotated_rectangle
    xs = list(r.exterior.coords)
    e = [math.dist(xs[i], xs[i + 1]) for i in range(4)]
    return min(e)


anchors = [a for a in S['audit'] if a['localLo'][0] < 1e8]
shops = [a for a in anchors if not any(k in a['id'] for k in SKIP_FACING) and not any(k in a['module'] for k in SKIP_FACING)]
res = {'source': src, 'counts': {'anchors': len(anchors), 'shops': len(shops), 'stations': len(S['stations']), 'shots': len(S['shots'])}}

# 浮空 / 埋地
fl = []
for a in anchors:
    y0 = a['worldLo'][1]
    fl.append({'id': a['id'], 'module': a['module'], 'minY': y0})
res['floating'] = [f for f in fl if f['minY'] > 0.05]
res['buried'] = [f for f in fl if f['minY'] < -0.5]
res['minYAll'] = sorted(fl, key=lambda f: f['minY'])

# 门脸朝向
fac = []
for a in shops:
    x, z = a['pos'][0], a['pos'][2]
    best = min(ground_line, key=lambda p: (p[0] - x) ** 2 + (p[1] - z) ** 2)
    to = (best[0] - x, best[1] - z)
    n = math.hypot(*to) or 1
    f = (math.sin(a['rotY']), math.cos(a['rotY']))
    ang = math.degrees(math.acos(max(-1, min(1, (f[0] * to[0] + f[1] * to[1]) / n))))
    fac.append({'id': a['id'], 'module': a['module'], 'angleDeg': round(ang, 1), 'distToRoute': round(n, 2)})
res['facing'] = sorted(fac, key=lambda f: -f['angleDeg'])
res['backToStreet'] = [f for f in fac if f['angleDeg'] > 90]

# 件间相交
polys = {a['id']: obb_poly(a, a['localLo'], a['localHi']) for a in anchors}
yr = {a['id']: (a['worldLo'][1], a['worldHi'][1]) for a in anchors}
pairs = []
ids = [a['id'] for a in shops]
for i in range(len(ids)):
    for j in range(i + 1, len(ids)):
        A, B = polys[ids[i]], polys[ids[j]]
        if not A.intersects(B):
            continue
        inter = A.intersection(B)
        if inter.area < 0.01:
            continue
        pairs.append({'a': ids[i], 'b': ids[j], 'area': round(inter.area, 2), 'depth': round(depth(inter), 2)})
res['pairs'] = sorted(pairs, key=lambda p: -p['depth'])

# 店招 / 雨棚部件穿入邻件；部件伸出本体墙面范围
by_id = {a['id']: a for a in anchors}
pp = []
overhang = []
for a in shops:
    walls = [p for p in a['parts'] if any(k in p['mat'] for k in ('plaster', 'brick'))]
    if walls:
        wlo = [min(p['lo'][i] for p in walls) for i in range(3)]
        whi = [max(p['hi'][i] for p in walls) for i in range(3)]
    for p in a['parts']:
        if not any(k in p['mat'] for k in SIGN_MATS):
            continue
        P = obb_poly(a, p['lo'], p['hi'])
        for b in shops:
            if b['id'] == a['id']:
                continue
            Q = polys[b['id']]
            if P.intersects(Q):
                inter = P.intersection(Q)
                if inter.area > 0.01 and min(p['hi'][1], yr[b['id']][1]) > max(p['lo'][1], yr[b['id']][0]):
                    pp.append({'part': f"{a['id']}:{p['mat']}", 'into': b['id'], 'area': round(inter.area, 2), 'depth': round(depth(inter), 2)})
        if walls:
            side = max(wlo[0] - p['lo'][0], p['hi'][0] - whi[0])
            back = wlo[2] - p['lo'][2]
            if side > 0.3 or back > 0.3:
                overhang.append({'id': a['id'], 'module': a['module'], 'mat': p['mat'], 'sideOverhang': round(side, 2), 'backOverhang': round(back, 2)})
res['partPairs'] = sorted(pp, key=lambda p: -p['depth'])
res['partOverhang'] = overhang

# 跨分区顶点穿入
cz = {}
for o in S['others']:
    v = o['v']
    # 只查建筑实体（店屋）：路面 / 围界等多段件的联合包围盒会跨过整片区域（假阳性），这些件改用碰撞 OBB 查
    for a in shops:
        lo, hi = a['localLo'], a['localHi']
        wlo, whi = a['worldLo'], a['worldHi']
        n = 0
        dmax = 0.0
        for k in range(0, len(v), 3):
            x, y, z = v[k], v[k + 1], v[k + 2]
            if x < wlo[0] or x > whi[0] or z < wlo[2] or z > whi[2] or y < max(0.15, wlo[1]) or y > whi[1]:
                continue
            lx, lz = to_local(a, x, z)
            if lo[0] + 0.1 < lx < hi[0] - 0.1 and lo[2] + 0.1 < lz < hi[2] - 0.1:
                n += 1
                dmax = max(dmax, min(lx - lo[0], hi[0] - lx, lz - lo[2], hi[2] - lz))
        if n:
            key = (a['id'], o['id'], o['zone'])
            c = cz.setdefault(key, {'fangbang': a['id'], 'other': o['id'], 'zone': o['zone'], 'meshes': set(), 'verts': 0, 'depth': 0.0})
            c['meshes'].add(o['mesh'])
            c['verts'] += n
            c['depth'] = max(c['depth'], round(dmax, 2))
res['crossZone'] = sorted([{**c, 'meshes': sorted(c['meshes'])[:6]} for c in cz.values()], key=lambda c: -c['depth'])

# 空档（水平射线）
gaps = []
for pr in S['probes']:
    for side in ('L', 'R'):
        r = pr['rays'].get(f'{side}0@1.6')
        if r is None or r['d'] > GAP_M:
            gaps.append({'station': pr['station'], 's': pr['s'], 'side': side, 'hit': r})
res['gaps'] = gaps
res['rayHitZones'] = {}
for pr in S['probes']:
    for k, r in pr['rays'].items():
        z = r['zone'] if r else 'none'
        res['rayHitZones'][z] = res['rayHitZones'].get(z, 0) + 1

# 路面
zf = []
off = []
for g in S['ground']:
    hs = g['hits']
    if hs and abs(hs[0]['y']) > 0.05:
        off.append({'s': g['s'], 'x': g['x'], 'z': g['z'], 'top': hs[0]})
    for i in range(len(hs) - 1):
        if abs(hs[i]['y'] - hs[i + 1]['y']) <= 0.005 and hs[i]['mesh'] != hs[i + 1]['mesh']:
            zf.append({'s': g['s'], 'x': g['x'], 'z': g['z'], 'a': hs[i], 'b': hs[i + 1]})
            break
res['groundCoplanar'] = zf
res['groundOffset'] = off
res['groundTop'] = {}
for g in S['ground']:
    z = f"{g['hits'][0]['zone']}:{g['hits'][0]['id']}" if g['hits'] else 'none'
    res['groundTop'][z] = res['groundTop'].get(z, 0) + 1

# 贴图 / 近黑
miss = []
for a in anchors:
    for p in a['parts']:
        if p['map'] is not None and (p['map']['w'] == 0 or p['map']['h'] == 0):
            miss.append({'id': a['id'], 'mesh': p['mesh'], 'mat': p['mat']})
res['textureMissing'] = miss
res['shotsDark'] = sorted([{'key': s['key'], 'darkFrac': s['darkFrac'], 'bgLowFrac': s['bgLowFrac']} for s in S['shots']], key=lambda s: -s['darkFrac'])[:10]
res['shotsBgLow'] = sorted([{'key': s['key'], 'bgLowFrac': s['bgLowFrac']} for s in S['shots']], key=lambda s: -s['bgLowFrac'])[:12]

# 重复放置
dup = []
for i in range(len(anchors)):
    for j in range(i + 1, len(anchors)):
        a, b = anchors[i], anchors[j]
        if a['module'] == b['module'] and math.dist(a['pos'], b['pos']) < 1.0:
            dup.append({'a': a['id'], 'b': b['id'], 'module': a['module'], 'dist': round(math.dist(a['pos'], b['pos']), 3)})
res['duplicates'] = dup

json.dump(res, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in res.items() if k not in ('source',)}, ensure_ascii=False)[:3000])
