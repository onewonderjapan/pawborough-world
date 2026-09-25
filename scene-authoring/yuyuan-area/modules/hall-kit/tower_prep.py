"""hall-kit 楼阁批量准备诊断（wave3 K2）：只出诊断，不接入（不改 ids.json）。纯 Python，无 bpy。
先逐栋跑生成器（--out out-tower-prep/hallkit-<id>），再运行本脚本：
  python3 -X utf8 modules/hall-kit/tower_prep.py --ids id1,id2,... [--gen-dir out-tower-prep] [--out modules/hall-kit/tower-batch-prep.json]
每栋记：外接矩形覆盖率、共享边段（及按段 / 整侧处理方式）、正立面边与 facade.dir 夹角、推断层高、三角面、
与邻栋互穿（模块 GLB 按 frame.py 放到世界后，顶点落进其他会渲染建筑 footprint 的深度；共享边邻栋另列）、
台基压到园路 / 水面、正立面前净空（机位难拍）、预计问题与建议（直接放 / 需特殊处理 / 跳过）。
所有位置从 baseline/layout.json 重算（frame.py），生成器产物只用来量几何。"""
import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
AREA = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import frame as F  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--ids', required=True)
ap.add_argument('--gen-dir', default='out-tower-prep')
ap.add_argument('--out', default=os.path.join(HERE, 'tower-batch-prep.json'))
ap.add_argument('--calib', default='', help='已接入 20 栋的同一诊断（--gen-dir out-garden-kits）输出 JSON：园路 / 水面阈值取其最大值')
a = ap.parse_args()
LAYOUT = json.load(open(os.path.join(AREA, 'baseline', 'layout.json'), encoding='utf-8'))
D = json.load(open(os.path.join(HERE, 'defaults.json'), encoding='utf-8'))
IDS_JSON = json.load(open(os.path.join(HERE, 'ids.json'), encoding='utf-8'))
O = {o['id']: o for o in LAYOUT['objects']}
BKINDS = set(D['sharedEdgeKinds'])
BUILDINGS = [o for o in LAYOUT['objects'] if o.get('kind') in BKINDS and not o.get('skipRender') and (o.get('geometry') or {}).get('footprint')]
WATER = [o for o in LAYOUT['objects'] if o.get('kind') == 'water' and (o.get('geometry') or {}).get('footprint')]
ROADS = [o for o in LAYOUT['objects'] if o.get('kind') in ('road', 'path') and (o.get('geometry') or {}).get('polyline')]


def glb_verts(p):
    b = open(p, 'rb').read()
    jl = int.from_bytes(b[12:16], 'little')
    j = json.loads(b[20:20 + jl])
    bl = int.from_bytes(b[20 + jl:24 + jl], 'little')
    binb = b[28 + jl:28 + jl + bl]
    import struct
    out = []
    for n in j['nodes']:
        if 'mesh' not in n:
            continue
        t = n.get('translation', [0, 0, 0])
        for pr in j['meshes'][n['mesh']]['primitives']:
            ac = j['accessors'][pr['attributes']['POSITION']]
            bv = j['bufferViews'][ac['bufferView']]
            off = bv.get('byteOffset', 0) + ac.get('byteOffset', 0)
            st = bv.get('byteStride', 12)
            for i in range(ac['count']):
                x, y, z = struct.unpack_from('<3f', binb, off + i * st)
                out.append((x + t[0], y + t[1], z + t[2]))
    return out


def geom_bytes(p):
    """模块 GLB 里几何（非贴图）bufferView 字节：分区里贴图按名去重，增量主要是几何。"""
    b = open(p, 'rb').read()
    jl = int.from_bytes(b[12:16], 'little')
    j = json.loads(b[20:20 + jl])
    img = {im['bufferView'] for im in j.get('images', []) if 'bufferView' in im}
    return sum(bv['byteLength'] for i, bv in enumerate(j['bufferViews']) if i not in img)


def in_poly(pt, poly):
    c = False
    n = len(poly)
    for i in range(n):
        (xi, zi), (xj, zj) = poly[i], poly[i - 1]
        if (zi > pt[1]) != (zj > pt[1]) and pt[0] < (xj - xi) * (pt[1] - zi) / (zj - zi) + xi:
            c = not c
    return c


def seg_dist(p, a_, b_):
    dx, dz = b_[0] - a_[0], b_[1] - a_[1]
    L2 = dx * dx + dz * dz
    k = max(0.0, min(1.0, ((p[0] - a_[0]) * dx + (p[1] - a_[1]) * dz) / L2)) if L2 else 0.0
    return math.hypot(p[0] - a_[0] - k * dx, p[1] - a_[1] - k * dz)


def depth_in(pt, poly):
    return min(seg_dist(pt, poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly))) if in_poly(pt, poly) else 0.0


def ray_hit(o, d, poly):
    """射线 o + t d 与多边形边的最近正交点 t（无 → None）。"""
    best = None
    n = len(poly)
    for i in range(n):
        (x1, z1), (x2, z2) = poly[i], poly[(i + 1) % n]
        ex, ez = x2 - x1, z2 - z1
        den = d[0] * ez - d[1] * ex
        if abs(den) < 1e-12:
            continue
        t = ((x1 - o[0]) * ez - (z1 - o[1]) * ex) / den
        s = ((x1 - o[0]) * d[1] - (z1 - o[1]) * d[0]) / den
        if t > 1e-6 and 0 <= s <= 1 and (best is None or t < best):
            best = t
    return best


def reflex_count(fp):
    s = 1 if F._signed_area2(fp) > 0 else -1
    n = len(fp)
    c = 0
    for i in range(n):
        p0, p1, p2 = fp[i - 1], fp[i], fp[(i + 1) % n]
        cr = (p1[0] - p0[0]) * (p2[1] - p1[1]) - (p1[1] - p0[1]) * (p2[0] - p1[0])
        if cr * s < -1e-6:
            c += 1
    return c


CAL = {'road': 1e9, 'water': 1e9, 'source': None}
if a.calib:
    cj = json.load(open(a.calib, encoding='utf-8'))
    CAL = {'road': max(r['platformIntoRoadM'] for r in cj['towers']), 'water': max(r['platformIntoWaterM'] for r in cj['towers']),
           'source': '已接入 %d 栋同一诊断的最大值' % len(cj['towers'])}
rows = []
for hid in [i for i in a.ids.split(',') if i]:
    o = O[hid]
    fr = F.hall_frame(o, D)
    fp = F.ring(o['geometry']['footprint'])
    shared = F.shared_edges(o, LAYOUT['objects'], D)
    gdir = os.path.join(AREA, a.gen_dir, 'hallkit-' + hid)
    meas = json.load(open(os.path.join(gdir, 'measurements.json'), encoding='utf-8'))
    rec = json.load(open(os.path.join(gdir, 'recipe.json'), encoding='utf-8'))
    ACU, ACV = meas['reanchorLocalUV']
    rc, ua, fv = fr['rectCenter'], fr['uAxis'], fr['front']

    def to_world(lx, lz):
        u, v = lx + ACU, lz + ACV
        return (rc[0] + u * ua[0] + v * fv[0], rc[1] + u * ua[1] + v * fv[1])
    verts = glb_verts(os.path.join(gdir, 'model.glb'))
    wv = [(to_world(x, z), y) for x, y, z in verts]
    # 自检：模块台基层外廓应罩住 footprint 顶点（放置变换对不上会立刻露出来）
    plat_y = meas['platformY']
    # 与其他建筑互穿
    others = {e['other'] for e in shared}
    pen = []
    cx, cz = fr['centroid']
    R = math.hypot(fr['hu'], fr['hv']) + 3.0
    for q in BUILDINGS:
        if q['id'] == hid:
            continue
        qf = F.ring(q['geometry']['footprint'])
        if min(math.hypot(p[0] - cx, p[1] - cz) for p in qf) > R + 30:
            continue
        worst, cnt = 0.0, 0
        for (pw, y) in wv:
            if y <= 0.05:
                continue
            d_ = depth_in(pw, qf)
            if d_ > 0.05:
                cnt += 1
                worst = max(worst, d_)
        if cnt:
            pen.append({'other': q['id'], 'name': q.get('name'), 'kind': q.get('kind'), 'sharedEdge': q['id'] in others,
                        'integrated': q['id'] in IDS_JSON['ids'], 'verts': cnt, 'maxDepthM': round(worst, 3)})
    water, road = 0.0, 0.0
    low = [pw for pw, y in wv if y <= plat_y + 1e-3]
    for w in WATER:
        wf = F.ring(w['geometry']['footprint'])
        for pw in low:
            water = max(water, depth_in(pw, wf))
    for r in ROADS:
        pl, hw = r['geometry']['polyline'], (r['geometry'].get('width') or 3.0) / 2
        for pw in low:
            dmin = min(seg_dist(pw, pl[i], pl[i + 1]) for i in range(len(pl) - 1))
            road = max(road, hw - dmin)
    # 正立面前净空：正立面中点沿外法线到最近的其他建筑 / 水面
    fx = (rc[0] + fv[0] * fr['hv'], rc[1] + fv[1] * fr['hv'])
    clear, wclear = None, None
    for q in BUILDINGS + WATER:
        if q['id'] == hid:
            continue
        t = ray_hit(fx, fv, F.ring(q['geometry']['footprint']))
        if t is None:
            continue
        if q.get('kind') == 'water':
            wclear = t if wclear is None else min(wclear, t)
        elif clear is None or t < clear[0]:
            clear = (t, q['id'], q.get('kind'), q.get('name'))
    wlm = meas['wallLine']
    sb_used = (meas.get('section') or {}).get('upperSetback', D['upperSetback'])
    upper_depth = wlm['v'] - sb_used
    mode = (rec.get('sharedSegments') or {}).get('mode') or {}
    wb = meas.get('wallBlocks')
    notch = {sd: [b for b in blks if b[2] < max(bb[2] for bb in blks) - 1e-6] for sd, blks in (wb or {}).items()} if wb else {}
    # 预计问题
    issues = []
    cov = fr['coverage']
    rx = reflex_count(fp)
    if cov < 0.85 or rx:
        issues.append('不规则 footprint：覆盖率 %.2f、凹角 %d 个，外接矩形把 %.1f m² 非本栋地面盖成楼身' % (cov, rx, fr['rectArea'] * (1 - cov)))
    for p_ in pen:
        issues.append('与%s %s(%s) 互穿：%d 个顶点、最深 %.2f m%s' % ('共享边邻栋' if p_['sharedEdge'] else '邻栋', p_['name'] or '', p_['other'],
                                                                p_['verts'], p_['maxDepthM'], '（已接入 hall-kit）' if p_['integrated'] else ''))
    if water > CAL['water']:
        issues.append('台基压进水面 %.2f m（已接入 20 栋最大 %.2f）' % (water, CAL['water']))
    elif water > 0.05:
        issues.append('台基压进水面 %.2f m（已接入 20 栋最大 %.2f，同量级，提示）' % (water, CAL['water']))
    if road > CAL['road']:
        issues.append('台基压进园路 %.2f m（已接入 20 栋最大 %.2f）' % (road, CAL['road']))
    if fr['facadeDeltaDeg'] > 15:
        issues.append('正立面边与 facade.dir 夹角 %.1f°（>15°：朝最近水面的方向不垂直于任何边，正立面按最近边取）' % fr['facadeDeltaDeg'])
    if clear is not None and clear[0] < 6.0:
        issues.append('机位难拍：正立面中点前 %.1f m 就是 %s %s（< 6 m，园内眼高看不全正面）' % (clear[0], clear[2], clear[3] or clear[1]))
    if wclear is not None and wclear < 3.0:
        issues.append('正立面前 %.1f m 即水面（临水，眼高机位只能从对岸或斜向取）' % wclear)
    if upper_depth < D.get('minUpperFloorDepthM', 2.0) - 1e-6:
        issues.append('进深太浅：墙线进深 %.2f m，二层格扇后退 %.2f m 后只剩 %.2f m（B4 两层剖面不适用）' % (wlm['v'], sb_used, upper_depth))
    if (meas.get('section') or {}).get('upperSetbackInferred'):
        issues.append('薄楼：墙线进深 %.2f m，二层后退按 designInference 从 %.1f 缩到 %.2f m（二层留 %.2f m，平座窄）'
                      % (wlm['v'], D['upperSetback'], sb_used, upper_depth))
    if shared:
        issues.append('共享边 %d 段（%s）：%s' % (len(shared), ','.join(sorted(others)),
                                            '；'.join('%s 侧按%s' % (sd, '段限位' if m == 'segments' else '整侧') for sd, m in mode.items()) or '两山侧按整侧'))
    if notch:
        issues.append('墙线凹口：%s' % '；'.join('%s 侧 %s' % (sd, ['u[%.2f,%.2f] 内收到 %.2f' % tuple(b) for b in bl]) for sd, bl in notch.items() if bl))
    # 建议：skip = 覆盖率 < 0.70（wave2 Fallback）；special = 共享边 / 与非共享邻栋互穿 / 压水压路超过已接入 20 栋 / 夹角 > 30° / 进深太浅；
    # 其余 direct（覆盖率 0.70–0.85 的不规则 footprint 只记问题，与得月楼 0.78 同样按外接矩形放）
    hard = [p_ for p_ in pen if not p_['sharedEdge']]
    reasons = [x for x, c in (('共享边按段限位 / 墙线凹口，需与邻栋同看', shared),
                              ('外接矩形伸进非共享边邻栋（%s）' % ','.join('%s %.2f m' % (p_['other'], p_['maxDepthM']) for p_ in hard), hard),
                              ('台基压水面超过已接入最大值', water > CAL['water']), ('台基压园路超过已接入最大值', road > CAL['road']),
                              ('正立面与 facade.dir 夹角 > 30°，正立面取哪边需主控定', fr['facadeDeltaDeg'] > 30),
                              ('进深 < 两层剖面所需', upper_depth < D.get('minUpperFloorDepthM', 2.0) - 1e-6),
                              ('薄楼二层后退按 designInference 缩窄，需主控看剖面', (meas.get('section') or {}).get('upperSetbackInferred'))) if c]
    if cov < 0.70:
        verdict, why = 'skip', '覆盖率 < 0.70（wave2 Fallback 规则）'
    elif reasons:
        verdict, why = 'special', '；'.join(reasons)
    else:
        verdict, why = 'direct', '按 B4 两层剖面直接放' + ('（不规则 footprint 覆盖率 %.2f，同得月楼按外接矩形）' % cov if cov < 0.85 else '')
    rows.append({
        'id': hid, 'name': o.get('name'), 'kind': o.get('kind'), 'zone': o.get('zone'),
        'rect': {'u': round(2 * fr['hu'], 3), 'v': round(2 * fr['hv'], 3), 'coverage': round(cov, 3),
                 'footprintPts': len(fp), 'reflexCorners': rx, 'overbuildM2': round(fr['rectArea'] * (1 - cov), 2)},
        'sharedEdges': [{'other': e['other'], 'overlapM': round(e['overlapM'], 3), 'side': F.side_of_edge(fr, e),
                         'a': [round(c, 3) for c in e['a']], 'b': [round(c, 3) for c in e['b']]} for e in shared],
        'sharedSideMode': mode, 'wallNotches': notch or None,
        'facadeDeltaDeg': round(fr['facadeDeltaDeg'], 2),
        'storey': {'storeys': o.get('storeys'), 'storeysSource': o.get('storeySource'), 'height': o.get('height'),
                   'storeyH': round((o.get('height') or D['height']) / (o.get('storeys') or 1), 3), 'rule': 'layout height / storeys（同 B4）',
                   'floor2Z': (meas.get('section') or {}).get('floor2Z')},
        'roof': {'roofMode': o.get('roofMode'), 'eaveZ': meas['eaveZ'], 'ridgeZ': meas['ridgeZ'],
                 'riseUsed': rec['rise']['used'], 'riseInferred': rec['rise']['designInference']},
        'bays': meas['bays'], 'bayWidth': meas['bayWidth'],
        'triangles': meas['triangles'], 'glbBytes': meas['glbBytes'],
        'penetration': pen, 'platformIntoWaterM': round(water, 3), 'platformIntoRoadM': round(max(0.0, road), 3),
        'frontClearBuildings': ({'m': round(clear[0], 2), 'hit': clear[1], 'kind': clear[2], 'name': clear[3]} if clear else None),
        'frontClearWaterM': round(wclear, 2) if wclear is not None else None,
        'upperFloorDepthM': round(upper_depth, 3), 'geomBytes': geom_bytes(os.path.join(gdir, 'model.glb')),
        'issues': issues, 'verdict': verdict, 'verdictWhy': why,
    })
    print(hid, o.get('name'), verdict, '|', why)
summary = {
    'direct': [r['id'] for r in rows if r['verdict'] == 'direct'],
    'special': [r['id'] for r in rows if r['verdict'] == 'special'],
    'skip': [r['id'] for r in rows if r['verdict'] == 'skip'],
    'trianglesTotal': sum(r['triangles'] for r in rows), 'glbBytesTotal': sum(r['glbBytes'] for r in rows),
    'geomBytesTotal': sum(r['geomBytes'] for r in rows), 'calibration': CAL,
}
json.dump({'comment': 'wave3 K2 楼阁批量准备诊断（只出诊断，未接入；ids.json 未改）。由 modules/hall-kit/tower_prep.py 生成；'
                      'verdict: direct = 直接放 / special = 需特殊处理 / skip = 跳过。位置全部从 baseline/layout.json 重算。',
           'generator': 'build_hall.py @ wave3 K1（共享边按段限位）', 'genDir': a.gen_dir, 'summary': summary, 'towers': rows},
          open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
open(a.out, 'a', encoding='utf-8').write('\n')
print('WROTE', a.out, json.dumps(summary, ensure_ascii=False))
