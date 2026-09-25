"""hall-kit 放置 / 朝向公式（纯 Python，无 bpy）：build_hall.py、render_hall.py、scripts/assemble.py 共用这一份。
JS 侧同式实现在 frame.mjs（export-collision 用）；tests/hallkit-test.mjs 另有一份独立实现，不引用本文件。

- 位置 = footprint 多边形面积形心（GOAL 冻结）。
- 平面 = footprint 最小面积外接矩形（旋转卡壳）。
- 朝向（defaults.orient）：
  * "footprint-side"（缺省）：正立面 = 外接矩形四条边里外法线与 facade.dir 点积最大的一条
    （边长 < frontMinSideM 罚 frontShortPenalty，与 src/build-scene.mjs pickEdge 同规则，程序化体块的格扇带也在这条边上）；
    模块 +Z = 该边外法线，rotY = atan2(n.x, n.z)。几何与 footprint 对齐；与 facade.dir 的夹角记 facadeDeltaDeg。
    （layout 的 facade.dir 是「形心→最近园内水面」方向，不一定垂直于 footprint 任一边：本单 20 栋里 12 栋偏 >5°，
    最大 45°；若按 facade.dir 转整栋，房子会斜出 footprint 伸进园路 / 水面。）
  * "facade-dir"：wave1 样板旧行为——矩形长轴为面宽，前后两长边取靠 facade.dir 的一侧，但锚点 rotY 直接取
    facade.dir（几何随之偏离 footprint facadeDeltaDeg）。
"""
import math


def ring(fp_raw):
    fp = [tuple(p) for p in fp_raw]
    return fp[:-1] if fp[0] == fp[-1] else fp


def area_centroid(fp):
    n = len(fp)
    a2 = sum(fp[i][0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * fp[i][1] for i in range(n)) / 2
    if abs(a2) < 1e-6:
        return sum(p[0] for p in fp) / n, sum(p[1] for p in fp) / n
    cx = sum((fp[i][0] + fp[(i + 1) % n][0]) * (fp[i][0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * fp[i][1])
             for i in range(n)) / (6 * a2)
    cz = sum((fp[i][1] + fp[(i + 1) % n][1]) * (fp[i][0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * fp[i][1])
             for i in range(n)) / (6 * a2)
    return cx, cz


def polygon_area(fp):
    n = len(fp)
    return abs(sum(fp[i][0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * fp[i][1] for i in range(n)) / 2)


def convex_hull(pts):
    pts = sorted(set(pts))

    def cr(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo = []
    for p in pts:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    up = []
    for p in reversed(pts):
        while len(up) >= 2 and cr(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def min_rect(fp):
    """返回 (面积, 轴 a=(ax,az), 中心 (x,z), 半长 ha（沿 a）, 半长 hb（沿 b=(-az,ax)）)。"""
    H = convex_hull(fp)
    best = None
    m = len(H)
    for i in range(m):
        x1, y1 = H[i]
        x2, y2 = H[(i + 1) % m]
        L = math.hypot(x2 - x1, y2 - y1)
        if L < 1e-9:
            continue
        ux, uy = (x2 - x1) / L, (y2 - y1) / L
        us = [(p[0] - x1) * ux + (p[1] - y1) * uy for p in H]
        vs = [-(p[0] - x1) * uy + (p[1] - y1) * ux for p in H]
        area = (max(us) - min(us)) * (max(vs) - min(vs))
        if best is None or area < best[0]:
            um, vm = (max(us) + min(us)) / 2, (max(vs) + min(vs)) / 2
            cxr = x1 + um * ux - vm * uy
            czr = y1 + um * uy + vm * ux
            best = (area, (ux, uy), (cxr, czr), (max(us) - min(us)) / 2, (max(vs) - min(vs)) / 2)
    return best


def hall_frame(obj, defaults):
    fp = ring(obj['geometry']['footprint'])
    fdir = (obj.get('facade') or {}).get('dir') or defaults['facadeDir']
    fl = math.hypot(fdir[0], fdir[1]) or 1.0
    fx, fz = fdir[0] / fl, fdir[1] / fl
    area, (ax, az), rc, ha, hb = min_rect(fp)
    bx, bz = -az, ax
    mode = defaults.get('orient', 'footprint-side')
    min_side = defaults.get('frontMinSideM', 3.2)
    pen = defaults.get('frontShortPenalty', 0.6)
    if mode == 'facade-dir':
        # 旧行为：长轴为面宽；前侧取靠 facade.dir 的长边；rotY = facade.dir
        if ha >= hb:
            n = (bx, bz) if bx * fx + bz * fz >= 0 else (-bx, -bz)
            hu, hv = ha, hb
        else:
            n = (ax, az) if ax * fx + az * fz >= 0 else (-ax, -az)
            hu, hv = hb, ha
        rot_y = math.atan2(fx, fz)
    else:
        cands = [((bx, bz), 2 * ha, ha, hb), ((-bx, -bz), 2 * ha, ha, hb),
                 ((ax, az), 2 * hb, hb, ha), ((-ax, -az), 2 * hb, hb, ha)]
        best = max(cands, key=lambda c: c[0][0] * fx + c[0][1] * fz - (pen if c[1] < min_side else 0.0))
        n, _side, hu, hv = best
        rot_y = math.atan2(n[0], n[1])
    vx, vz = n
    ux, uz = vz, -vx                         # 模块 +X（与 assemble.place：local(1,0) → world(cos, -sin)）
    cxa, cza = area_centroid(fp)
    dot = max(-1.0, min(1.0, vx * fx + vz * fz))
    return {
        'centroid': (cxa, cza), 'rectCenter': rc, 'front': (vx, vz), 'uAxis': (ux, uz),
        'hu': hu, 'hv': hv, 'rotY': rot_y, 'orient': mode,
        'facadeDir': (fx, fz), 'facadeDeltaDeg': math.degrees(math.acos(dot)),
        'rectArea': area, 'coverage': polygon_area(fp) / area if area > 0 else 0.0,
    }


def to_local(fr, wx, wz):
    """世界 (x,z) → 以外接矩形中心为原点的 (u, v)。"""
    dx, dz = wx - fr['rectCenter'][0], wz - fr['rectCenter'][1]
    return dx * fr['uAxis'][0] + dz * fr['uAxis'][1], dx * fr['front'][0] + dz * fr['front'][1]


# ------------------------------------------------------------ 共享边 ----
def _signed_area2(fp):
    n = len(fp)
    return sum(fp[i][0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * fp[i][1] for i in range(n))


def shared_edges(obj, objects, defaults):
    """本栋 footprint 与其他「会渲染的建筑」footprint 重合（两端点到本边直线 ≤ sharedEdgeTolM、重叠长 ≥ sharedEdgeMinLenM）的边段。
    返回 [{a, b（重叠段世界端点）, n（本栋外法线）, other}]。从 layout 检出，不写死 id。"""
    tol = defaults.get('sharedEdgeTolM', 0.05)
    min_len = defaults.get('sharedEdgeMinLenM', 0.3)
    kinds = set(defaults.get('sharedEdgeKinds', []))
    fp = ring(obj['geometry']['footprint'])
    sgn = 1.0 if _signed_area2(fp) > 0 else -1.0
    out = []
    for i in range(len(fp)):
        a, b = fp[i], fp[(i + 1) % len(fp)]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < min_len:
            continue
        ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        nx, nz = (uz * sgn, -ux * sgn)          # CCW（面积>0）内侧在左 → 外法线在右
        for q in objects:
            if q['id'] == obj['id'] or q.get('skipRender') or q.get('kind') not in kinds:
                continue
            g = q.get('geometry') or {}
            if not g.get('footprint'):
                continue
            qf = ring(g['footprint'])
            for j in range(len(qf)):
                c, d = qf[j], qf[(j + 1) % len(qf)]
                dc = abs(-(c[0] - a[0]) * uz + (c[1] - a[1]) * ux)
                dd = abs(-(d[0] - a[0]) * uz + (d[1] - a[1]) * ux)
                if dc > tol or dd > tol:
                    continue
                tc = (c[0] - a[0]) * ux + (c[1] - a[1]) * uz
                td = (d[0] - a[0]) * ux + (d[1] - a[1]) * uz
                lo, hi = max(0.0, min(tc, td)), min(L, max(tc, td))
                if hi - lo >= min_len:
                    out.append({'a': (a[0] + ux * lo, a[1] + uz * lo), 'b': (a[0] + ux * hi, a[1] + uz * hi),
                                'n': (nx, nz), 'other': q['id'], 'overlapM': hi - lo})
    return out


def side_limits(fr, edges):
    """共享边 → 外接矩形四侧的限位（矩形中心起沿该侧外法线的最大允许距离）。
    侧名：front(+v) back(-v) right(+u) left(-u)；边外法线与侧法线夹角 ≤ 30° 才归到该侧。"""
    sides = {'front': (0.0, 1.0), 'back': (0.0, -1.0), 'right': (1.0, 0.0), 'left': (-1.0, 0.0)}
    lim = {}
    for e in edges:
        ln = (e['n'][0] * fr['uAxis'][0] + e['n'][1] * fr['uAxis'][1], e['n'][0] * fr['front'][0] + e['n'][1] * fr['front'][1])
        name, sv = max(sides.items(), key=lambda kv: kv[1][0] * ln[0] + kv[1][1] * ln[1])
        if sv[0] * ln[0] + sv[1] * ln[1] < math.cos(math.radians(30)):
            continue
        for p in (e['a'], e['b']):
            u, v = to_local(fr, *p)
            d = u * sv[0] + v * sv[1]
            lim[name] = min(lim.get(name, 1e9), d)
    return lim
