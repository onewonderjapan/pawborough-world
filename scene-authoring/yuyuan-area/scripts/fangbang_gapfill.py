"""wave5-fangbangqa F-07：方浜中路临街面空档补齐（主控 2026-09-26 决定选项 1，沿用 wave1 决定 2 的补齐规则）。

纯 Python（assemble.py 在 Blender 里 import；也可用系统 python 单独跑出计划，便于复核）。全部输入取源数据：
  v7 instances / collision-world / review-manifest（模块路径旁的 collision.json sidecar）/ route.json（v7 坐标），
  baseline/layout.json（地图坐标，平移 OFF 换到 v7 坐标）。

规则（每条都在 tests/fangbang-test.mjs W6 里独立重算）：
  - 只用 west-band 窄店模块，门面 5–7 m：按 v7 碰撞底层记录（底 ≤ 1 m）局部 x 宽度筛，当前 = curio-a / curio-b（6.2 m），交替；
  - 门脸朝街：沿 v7 主路线（东端 → 山门接点）每侧扫描，锚 = 路线点 + 侧向法线 × 前沿距离 D，门脸 = 指回路线；
    D = 同侧最近的前后两家已放店屋（锚到路线距离）按弧长插值；压到沥青 / 步行线时每 0.5 m 后退，最多 SETBACK_MAX；
  - 不相交（全部为「冲突即跳过」）：
      邻居：候选模块全部碰撞记录的轴对齐盒（外扩 MARGIN）与所有已放置 fangbang 碰撞记录的轴对齐盒不相交（同 wave1 测试口径）；
      路面：底层记录平面矩形与 fangbang 沥青三角形（街段 street-kit / 东西延段 sctail / 尾段 sctail）不相交；
      步行：底层矩形离主路线与支弄出入线（route.json laneA/laneB excursion）≥ WALK_CLEAR；
      全域：layout 实体 footprint（与 assemble 同一 SOLID_KINDS，AABB 保守判）、庙区院墙（段 + 厚度/2）、
            山门前广场（layout.shanmenForecourt）、仍可见的外围店屋轮廓（未被 fangbang 让位的 shopAnchor）、
            除方浜中路外所有 layout 道路（平头路面带半宽 + MOUTH_CLEAR；路口保持开口，含安仁街；T 字路口对街不受限）、v7 庙轴碰撞盒；
  - 放下后下一候选至少隔开 本模块门面 + MARGIN（节奏 = 6.2 + 0.6 m）。
"""
import json
import math
import os
import re
import struct

OFF = (53.5, -17.4)          # 地图 = v7 + OFF
STEP = 0.25                  # 沿路线扫描步长 m
MARGIN = 0.6                 # 与邻居盒的净空、同批相邻两件的间隔
WALK_CLEAR = 2.2             # 底层矩形到主路线 / 支弄出入线的最小距离
MOUTH_CLEAR = 3.0            # 支路路面半宽之外再留的净空（安仁街 w7：3.5 + 3.0 = 6.5 m，同 wave1 决定 2 的路口保留带）
FRONTAGE_RANGE = (5.0, 7.0)  # 门面宽度规则（主控 2026-09-26）
SETBACK_MAX = 3.0            # 前沿压到沥青 / 步行线时最多后退的距离
SOLID_KINDS = {'outerBuilding', 'bazaarBlock', 'tower', 'hall', 'xuan', 'pavilion', 'waterside',
               'stage', 'wall', 'corridor', 'watersideGallery', 'moonGateWall', 'wallHead'}


# ---------------- 几何小工具（凸多边形 SAT、点段距离） ----------------
def _axes(poly):
    out = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        out.append((a[1] - b[1], b[0] - a[0]))
    return out


def convex_overlap(p, q, eps=1e-6):
    for ax in _axes(p) + _axes(q):
        n = math.hypot(*ax) or 1.0
        ax = (ax[0] / n, ax[1] / n)
        pa = [v[0] * ax[0] + v[1] * ax[1] for v in p]
        qa = [v[0] * ax[0] + v[1] * ax[1] for v in q]
        if max(pa) <= min(qa) + eps or max(qa) <= min(pa) + eps:
            return False
    return True


def seg_dist(p, a, b):
    vx, vz = b[0] - a[0], b[1] - a[1]
    l2 = vx * vx + vz * vz or 1.0
    t = max(0.0, min(1.0, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / l2))
    return math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vz)


def poly_seg_dist(poly, a, b):
    """凸多边形到线段的距离（相交 = 0）。"""
    if convex_overlap(poly, [a, b, (b[0] + 1e-6, b[1] + 1e-6)]):
        return 0.0
    d = min(seg_dist(v, a, b) for v in poly)
    for i in range(len(poly)):
        c, e = poly[i], poly[(i + 1) % len(poly)]
        d = min(d, seg_dist(a, c, e), seg_dist(b, c, e))
    return d


def poly_seg_dist_flat(poly, a, b):
    """凸多边形到线段的距离，线段两端平头（只算投影落在段内的部分）——路面带到路尽头为止，
    T 字路口的对街不受支路路口保留带影响。相交 = 0；完全落在段外 = inf。"""
    if convex_overlap(poly, [a, b, (b[0] + 1e-6, b[1] + 1e-6)]):
        return 0.0
    vx, vz = b[0] - a[0], b[1] - a[1]
    L = math.hypot(vx, vz) or 1.0
    ux, uz = vx / L, vz / L
    # 多边形边与段两端法线截出的段内部分：用多边形顶点 + 边与端线交点
    cand = []
    for i in range(len(poly)):
        c, e = poly[i], poly[(i + 1) % len(poly)]
        tc = (c[0] - a[0]) * ux + (c[1] - a[1]) * uz
        te = (e[0] - a[0]) * ux + (e[1] - a[1]) * uz
        if 0 <= tc <= L:
            cand.append(c)
        for tb in (0.0, L):
            if (tc - tb) * (te - tb) < 0:
                k = (tb - tc) / (te - tc)
                cand.append((c[0] + (e[0] - c[0]) * k, c[1] + (e[1] - c[1]) * k))
    if not cand:
        return float('inf')
    return min(abs((q[0] - a[0]) * uz - (q[1] - a[1]) * ux) for q in cand)


def aabb_of(poly):
    xs = [v[0] for v in poly]
    zs = [v[1] for v in poly]
    return (min(xs), min(zs), max(xs), max(zs))


def aabb_hit(a, b, m=0.0):
    return a[0] < b[2] + m and b[0] < a[2] + m and a[1] < b[3] + m and b[1] < a[3] + m


def rec_rect(rec, pos=None, theta=None):
    """碰撞记录 -> 平面矩形（v7 坐标）。pos/theta 给定时按新位姿重放（补齐件克隆 donor 记录）。"""
    o = rec.get('obb')
    if o is None:
        mn, mx = rec['min'], rec['max']
        return [(mn[0], mn[2]), (mx[0], mn[2]), (mx[0], mx[2]), (mn[0], mx[2])], (mn[1], mx[1])
    px, pz = (pos if pos is not None else (o['pos'][0], o['pos'][2]))
    th = o['theta'] if theta is None else theta
    c, s = math.cos(th), math.sin(th)
    cx, cz = o['center'][0], o['center'][2]
    hx, hz = o['size'][0] / 2, o['size'][2] / 2
    pts = [(px + c * (cx + lx) + s * (cz + lz), pz - s * (cx + lx) + c * (cz + lz)) for lx, lz in ((-hx, -hz), (hx, -hz), (hx, hz), (-hx, hz))]
    y0 = o['center'][1] - o['size'][1] / 2 + ((o['pos'][1] or 0) if pos is None else 0)
    return pts, (y0, y0 + o['size'][1])


# ---------------- GLB 读三角形（只要位置 + 索引，节点只允许平移） ----------------
def glb_triangles(path, name_re):
    b = open(path, 'rb').read()
    jl = struct.unpack_from('<I', b, 12)[0]
    j = json.loads(b[20:20 + jl].decode('utf-8'))
    off = 20 + jl
    binc = None
    while off < len(b):
        ln, ty = struct.unpack_from('<II', b, off)
        if ty == 0x004E4942:
            binc = b[off + 8: off + 8 + ln]
        off += 8 + ln

    def acc(i):
        a = j['accessors'][i]
        bv = j['bufferViews'][a['bufferView']]
        st = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        n = {'VEC3': 3, 'SCALAR': 1}[a['type']] * a['count']
        fmt = {5126: 'f', 5125: 'I', 5123: 'H'}[a['componentType']]
        return struct.unpack_from('<' + fmt * n, binc, st)
    tris = []
    for nd in j['nodes']:
        if nd.get('mesh') is None or not re.match(name_re, nd.get('name', '')):
            continue
        if nd.get('rotation') or nd.get('scale') or nd.get('matrix'):
            raise SystemExit(f'gapfill: {path} node {nd.get("name")} has rotation/scale; reader supports translation only')
        t = nd.get('translation', [0, 0, 0])
        for pr in j['meshes'][nd['mesh']]['primitives']:
            P = acc(pr['attributes']['POSITION'])
            I = acc(pr['indices'])
            for k in range(0, len(I), 3):
                tris.append([(P[I[k + q] * 3] + t[0], P[I[k + q] * 3 + 2] + t[2]) for q in range(3)])
    return tris


# ---------------- 主计划 ----------------
def plan(repo, layout_path, excluded_ids, existing_infill, shop_dims):
    """返回 {'placed': [...], 'rules': {...}, 'donors': [...]}。
    excluded_ids：不放置的 v7 实例（封墙 / 171 等）；existing_infill：已放补齐件 [{id, donor, positionGlb, rotY}]；
    shop_dims：外围店屋单元 {module: (frontageM, depthM)}（resources/shops measurements）。"""
    fb7 = os.path.join(repo, 'world', 'fangbang-temple-v7')
    inst = json.load(open(os.path.join(fb7, 'instances.json'), encoding='utf-8'))['instances']
    col = json.load(open(os.path.join(fb7, 'collision-world.json'), encoding='utf-8'))['colliders']
    man = json.load(open(os.path.join(fb7, 'review-manifest.json'), encoding='utf-8'))
    route = json.load(open(os.path.join(fb7, 'route.json'), encoding='utf-8'))
    L = json.load(open(layout_path, encoding='utf-8'))
    mod_path = {m['id']: os.path.join(repo, m['path'][2:]) for m in man['modules']}
    temple_ids = {i['id'] for i in inst if i.get('group') == 'temple-axis-v2'}
    by = {}
    for r in col:
        by.setdefault(r['name'].split(':')[0], []).append(r)
    placed = [i for i in inst if i['id'] not in temple_ids and i['id'] not in excluded_ids]
    for i in placed:   # sidecar 碰撞（与 export-collision-fangbang 同源）
        if i['id'] in by:
            continue
        side = os.path.join(os.path.dirname(mod_path.get(i['module'], '')), 'collision.json')
        if os.path.exists(side):
            by[i['id']] = [r for r in json.load(open(side, encoding='utf-8')).get('colliders', []) if r['name'].split(':')[0] == i['id']]
    obstacles = []   # (id, aabb)
    for i in placed:
        for r in by.get(i['id'], []):
            obstacles.append((i['id'], aabb_of(rec_rect(r)[0])))
    for it in existing_infill:
        for r in by.get(it['donor'], []):
            obstacles.append((it['id'], aabb_of(rec_rect(r, (it['positionGlb'][0], it['positionGlb'][2]), it['rotY'])[0])))
    temple_boxes = [aabb_of(rec_rect(r)[0]) for tid in temple_ids for r in by.get(tid, [])]

    # 路面（沥青）三角形
    asphalt = glb_triangles(os.path.join(fb7, 'street-reviewed-lanes.glb'), r'^street-kit__quiet-gray-asphalt')
    for key in ('westext-surface', 'eastext-surface'):
        asphalt += glb_triangles(mod_path[key], r'^sctail__quiet-gray-asphalt')
    asphalt += glb_triangles(os.path.join(repo, man['streetCompletion']['eastTailSurface']['path'][2:]), r'^sctail__quiet-gray-asphalt')
    asphalt_bb = [aabb_of(t) for t in asphalt]

    # 路线（v7）：主路线东端 → 山门接点；支弄出入线
    sm = route['entries']['shanmenThreshold']
    ms = route['mainStreet']
    end = next(k for k, p in enumerate(ms) if math.hypot(p[0] - sm[0], p[2] - sm[2]) < 0.02)
    line = [(p[0], p[2]) for p in ms[:end + 1]]
    cum = [0.0]
    for k in range(1, len(line)):
        cum.append(cum[-1] + math.dist(line[k - 1], line[k]))
    total = cum[-1]
    walk_lines = [line] + [[(p[0], p[2]) for p in route[k]] for k in ('laneAExcursion', 'laneBExcursion')]

    def at(s):
        k = 1
        while k < len(line) - 1 and cum[k] < s:
            k += 1
        a, b = line[k - 1], line[k]
        t = max(0.0, min(1.0, (s - cum[k - 1]) / ((cum[k] - cum[k - 1]) or 1)))
        return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)

    def tangent(s):
        a, b = at(max(0.0, s - 4)), at(min(total, s + 4))
        n = math.dist(a, b) or 1.0
        return ((b[0] - a[0]) / n, (b[1] - a[1]) / n)

    def project(p):
        best = (1e18, 0.0, 0.0)
        for k in range(1, len(line)):
            a, b = line[k - 1], line[k]
            vx, vz = b[0] - a[0], b[1] - a[1]
            l2 = vx * vx + vz * vz or 1.0
            t = max(0.0, min(1.0, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / l2))
            q = (a[0] + t * vx, a[1] + t * vz)
            d = math.dist(p, q)
            if d < best[0]:
                side = vx * (p[1] - a[1]) - vz * (p[0] - a[0])
                best = (d, cum[k - 1] + t * math.sqrt(l2), 1 if side > 0 else -1)
        return best   # (dist, s, side)  side +1 = 路线前进方向右手系的 +法线侧

    # 同侧店屋前沿距离（锚 = 前墙中点）
    shops = [i for i in placed if (i.get('group') or '') in ('street', 'west-band-shops', 'east-band-shops', 'street-tail-shops')
             and not i['module'].endswith('strips')]
    fronts = {1: [], -1: []}
    for i in shops:
        d, s, sd = project((i['positionGlb'][0], i['positionGlb'][2]))
        if d < 20:
            fronts[sd].append((s, d))
    for it in existing_infill:
        d, s, sd = project((it['positionGlb'][0], it['positionGlb'][2]))
        fronts[sd].append((s, d))
    for k in fronts:
        fronts[k].sort()

    def front_d(side, s):
        arr = fronts[side]
        before = [x for x in arr if x[0] <= s]
        after = [x for x in arr if x[0] > s]
        if before and after:
            (s0, d0), (s1, d1) = before[-1], after[0]
            return d0 + (d1 - d0) * (s - s0) / ((s1 - s0) or 1)
        return (before[-1] if before else after[0])[1]

    # donor：west-band 模块中底层门面宽度落在 5–7 m 的（v7 碰撞底层记录局部 x 宽）
    donors = []
    for i in inst:
        if not (i.get('group') or '').startswith('west-band') or i['module'].endswith('strips'):
            continue
        base = [r for r in by.get(i['id'], []) if r.get('obb') and r['obb']['center'][1] - r['obb']['size'][1] / 2 <= 1.0]
        if not base:
            continue
        lo = min(r['obb']['center'][0] - r['obb']['size'][0] / 2 for r in base)
        hi = max(r['obb']['center'][0] + r['obb']['size'][0] / 2 for r in base)
        w = hi - lo
        if FRONTAGE_RANGE[0] <= w <= FRONTAGE_RANGE[1] and all(d['module'] != i['module'] for d in donors):
            donors.append({'donor': i['id'], 'module': i['module'], 'frontageM': round(w, 3), 'xMid': (lo + hi) / 2})
    donors.sort(key=lambda d: d['module'])
    if not donors:
        raise SystemExit('gapfill: no west-band module with 5-7 m frontage')

    # 全域对象（layout 地图坐标 -> v7）
    def to_v7(p):
        return (p[0] - OFF[0], p[1] - OFF[1])
    solids = []
    for o in L['objects']:
        g = o.get('geometry') or {}
        if o.get('kind') in SOLID_KINDS and g.get('footprint'):
            solids.append((o['id'], aabb_of([to_v7(p) for p in g['footprint']])))
    wall = next(o for o in L['objects'] if o['id'] == 'temple-wall')
    wall_segs = [(to_v7(a), to_v7(b)) for a, b in wall['geometry']['segments']]
    wall_half = (wall.get('thickness') or 0.4) / 2
    forecourt = [to_v7(p) for p in L['shanmenForecourt']['polygon']]
    roads = []
    for o in L['objects']:
        if o.get('kind') == 'road' and o.get('name') != '方浜中路' and (o.get('geometry') or {}).get('polyline'):
            pl = [to_v7(p) for p in o['geometry']['polyline']]
            roads.append((o['id'], pl, o['geometry'].get('width') or 6))
    fb_ids = {i['id'] for i in placed}
    outer_shops = []
    linst = {i['id']: i for i in L['instances']}
    for o in L['objects']:
        if o.get('kind') != 'shopAnchor' or o.get('zone') != 'outer':
            continue
        m = re.match(r'^shoprow-p(\d+)$', o['id'])
        if m and f'westshop-shop-{m.group(1)}' in fb_ids:
            continue   # 方浜加载后让位隐藏（F-01）
        li = linst.get(o['id'])
        dims = li and shop_dims.get(li['module'])
        if not dims:
            continue
        w, dd = dims
        x, z = to_v7(o['geometry']['position'])
        c, s = math.cos(o['geometry']['rotY']), math.sin(o['geometry']['rotY'])
        outer_shops.append((o['id'], [(x + c * lx + s * lz, z - s * lx + c * lz) for lx, lz in ((-w / 2, 0), (w / 2, 0), (w / 2, -dd), (-w / 2, -dd))]))

    def check(base_rects, all_rects):
        """返回冲突原因（None = 可放）。"""
        abs_ = [aabb_of(r) for r in all_rects]
        for bb in abs_:
            for oid, ob in obstacles:
                if aabb_hit(bb, ob, MARGIN):
                    return 'neighbour ' + oid
            for tb in temple_boxes:
                if aabb_hit(bb, tb):
                    return 'temple-axis'
            for sid, sb in solids:
                if aabb_hit(bb, sb):
                    return 'layout ' + sid
        for r in base_rects:
            rb = aabb_of(r)
            for t, tb in zip(asphalt, asphalt_bb):
                if aabb_hit(rb, tb) and convex_overlap(r, t):
                    return 'asphalt'
            for wl in walk_lines:
                for k in range(1, len(wl)):
                    if poly_seg_dist(r, wl[k - 1], wl[k]) < WALK_CLEAR:
                        return 'walk-line'
        for r in all_rects:
            for a, b in wall_segs:
                if poly_seg_dist(r, a, b) < wall_half:
                    return 'temple-wall'
            if convex_overlap(r, forecourt):
                return 'shanmen-forecourt'
            for oid, poly in outer_shops:
                if convex_overlap(r, poly):
                    return 'outer ' + oid
            for rid, pl, w in roads:
                for k in range(1, len(pl)):
                    if poly_seg_dist_flat(r, pl[k - 1], pl[k]) < w / 2 + MOUTH_CLEAR:
                        return 'road-mouth ' + rid
        return None

    out = []
    reasons = {}
    for side, tag in ((1, 'r'), (-1, 'l')):
        s = 0.0
        di = 0
        while s <= total:
            t = tangent(s)
            nrm = (-t[1], t[0]) if side == 1 else (t[1], -t[0])
            # side 与 project() 的 side 同号：+1 = 叉积 > 0 一侧
            p = at(s)
            cand = None
            for k in range(len(donors)):
                dn = donors[(di + k) % len(donors)]
                D0 = front_d(side, s)
                face = (-nrm[0], -nrm[1])               # 门脸指回路线
                rot = math.atan2(face[0], face[1])       # facing = (sin rot, cos rot)
                c, sn = math.cos(rot), math.sin(rot)
                recs = by[dn['donor']]
                # 前沿先取邻店插值 D0；压到沥青时向后退（D0 … D0+SETBACK_MAX），退不开才跳过
                for q in range(int(SETBACK_MAX / 0.5) + 1):
                    D = D0 + 0.5 * q
                    # 门面中点落在路线法线上：原点沿局部 x 反移 xMid
                    ox = p[0] + nrm[0] * D - c * dn['xMid']
                    oz = p[1] + nrm[1] * D + sn * dn['xMid']
                    allr = [rec_rect(r, (ox, oz), rot + (r['obb']['theta'] - recs[0]['obb']['theta']))[0] for r in recs]
                    base = [rec_rect(r, (ox, oz), rot)[0] for r in recs if r['obb']['center'][1] - r['obb']['size'][1] / 2 <= 1.0]
                    why = check(base, allr)
                    if why != 'asphalt' and why != 'walk-line':
                        break
                if why is None:
                    cand = (dn, ox, oz, rot, allr, round(D - D0, 2))
                    di = (di + k + 1) % len(donors)
                    break
                reasons[why.split(' ')[0]] = reasons.get(why.split(' ')[0], 0) + 1
            if cand is None:
                s += STEP
                continue
            dn, ox, oz, rot, allr, setback = cand
            iid = f'fangbang-infill-g{tag}{len([o for o in out if o["side"] == tag]) + 1}'
            out.append({'id': iid, 'module': dn['module'], 'donor': dn['donor'], 'side': tag,
                        'positionGlb': [round(ox, 4), 0, round(oz, 4)],
                        'positionMap': [round(ox + OFF[0], 4), 0, round(oz + OFF[1], 4)],
                        'rotY': round(rot, 5), 'routeS': round(s, 2), 'frontageM': dn['frontageM'], 'setbackM': setback,
                        'designInference': True, 'gap': 'frontage'})
            for r in allr:
                obstacles.append((iid, aabb_of(r)))
            s += dn['frontageM'] + MARGIN
    return {'placed': out, 'donors': donors, 'skipReasons': reasons,
            'rules': {'frontageRangeM': FRONTAGE_RANGE, 'marginM': MARGIN, 'walkClearM': WALK_CLEAR,
                      'mouthClearM': MOUTH_CLEAR, 'stepM': STEP, 'setbackMaxM': SETBACK_MAX,
                      'globals': 'layout solids (AABB), temple-wall, shanmenForecourt, visible outer shops, non-方浜中路 roads, v7 temple-axis boxes',
                      'pavement': 'fangbang asphalt triangles (street-kit / sctail quiet-gray-asphalt)'}}


if __name__ == '__main__':   # 单独复核：python3 -X utf8 scripts/fangbang_gapfill.py <repo> <layout.json> [excluded,...]
    import sys
    repo, lay = sys.argv[1], sys.argv[2]
    exc = set(sys.argv[3].split(',')) if len(sys.argv) > 3 else {'westext-seal-wall', 'eastext-seal-wall', 'westshop-shop-171'}
    area = os.path.join(repo, 'scene-authoring', 'yuyuan-area')
    dims = {}
    for m in os.listdir(os.path.join(area, 'resources', 'shops')):
        f = os.path.join(area, 'resources', 'shops', m, 'measurements.json')
        if os.path.exists(f):
            dsg = json.load(open(f, encoding='utf-8')).get('design') or {}
            if dsg.get('frontageM'):
                dims[m] = (dsg['frontageM'], dsg['depthM'])
    inf = json.load(open(sys.argv[4], encoding='utf-8'))['southGap']['placed'] if len(sys.argv) > 4 else []
    res = plan(repo, lay, exc, inf, dims)
    print(json.dumps({'n': len(res['placed']), 'donors': res['donors'], 'skip': res['skipReasons'],
                      'placed': [(p['id'], p['module'], p['positionMap'][0], p['positionMap'][2], p['rotY']) for p in res['placed']]}, ensure_ascii=False, indent=1))
