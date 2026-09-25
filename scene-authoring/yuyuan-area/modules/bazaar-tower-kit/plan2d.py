"""bazaar-tower-kit 平面几何（纯 Python，无 Blender 依赖；build_tower.py 与离线诊断共用）。

全部在生成器局部系 (u, v) 里：u = 前街边方向，v = 指向楼内（footprint 为 CCW）。
多边形一律 CCW 顶点列表 [(u, v), ...]，不重复首点。
"""
import math


def area2(poly):
    n = len(poly)
    return sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))


def ccw(poly):
    poly = [tuple(p) for p in poly]
    return poly if area2(poly) > 0 else poly[::-1]


def area_centroid(poly):
    a = cx = cz = 0.0
    n = len(poly)
    for i in range(n):
        x0, z0 = poly[i]
        x1, z1 = poly[(i + 1) % n]
        cr = x0 * z1 - x1 * z0
        a += cr
        cx += (x0 + x1) * cr
        cz += (z0 + z1) * cr
    a *= 0.5
    return (cx / (6 * a), cz / (6 * a), abs(a))


def turn_deg(a, b, c):
    """在 b 处的外转角（CCW 多边形：正 = 阳角，负 = 阴角）。"""
    t1 = math.atan2(b[1] - a[1], b[0] - a[0])
    t2 = math.atan2(c[1] - b[1], c[0] - b[0])
    return math.degrees((t2 - t1 + math.pi) % (2 * math.pi) - math.pi)


def simplify(poly, min_turn_deg=5.0, min_len=0.05):
    """去掉重合点与小折角（< min_turn_deg）顶点：小折角会被 eave_kit 当成阳角起翘，立面中段长出翼角。"""
    pts = [tuple(p) for p in poly]
    changed = True
    while changed and len(pts) > 3:
        changed = False
        for i in range(len(pts)):
            a, b, c = pts[i - 1], pts[i], pts[(i + 1) % len(pts)]
            if math.hypot(b[0] - a[0], b[1] - a[1]) < min_len or abs(turn_deg(a, b, c)) < min_turn_deg:
                pts.pop(i)
                changed = True
                break
    return pts


def simplify_idx(poly, min_turn_deg=5.0, min_len=0.05):
    """同 simplify，返回保留顶点在原列表里的下标。"""
    idx = list(range(len(poly)))
    changed = True
    while changed and len(idx) > 3:
        changed = False
        for k in range(len(idx)):
            a, b, c = poly[idx[k - 1]], poly[idx[k]], poly[idx[(k + 1) % len(idx)]]
            if math.hypot(b[0] - a[0], b[1] - a[1]) < min_len or abs(turn_deg(a, b, c)) < min_turn_deg:
                idx.pop(k)
                changed = True
                break
    return idx


def chord_bulge(poly, idx):
    """简化后每条边（弦）相对原折线向外鼓出多少（原顶点落在弦内侧的最大距离；凸折角为 0）。"""
    out = []
    n = len(poly)
    for k in range(len(idx)):
        i0, i1 = idx[k], idx[(k + 1) % len(idx)]
        a, b = poly[i0], poly[i1]
        L, t, nn = edge_frame(a, b)
        worst = 0.0
        j = (i0 + 1) % n
        while j != i1:
            q = poly[j]
            inward = -((q[0] - a[0]) * nn[0] + (q[1] - a[1]) * nn[1])
            worst = max(worst, inward)
            j = (j + 1) % n
        out.append(worst)
    return out


def _line_x(p0, d0, p1, d1):
    den = d0[0] * d1[1] - d0[1] * d1[0]
    if abs(den) < 1e-9:
        return None
    t = ((p1[0] - p0[0]) * d1[1] - (p1[1] - p0[1]) * d1[0]) / den
    return (p0[0] + d0[0] * t, p0[1] + d0[1] * t)


def edge_frame(a, b):
    """边 a→b：长度、单位切向 t、外法线 n（CCW：右手侧为外）。"""
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    t = ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
    return L, t, (t[1], -t[0])


def offset_edges(poly, ds):
    """逐边内缩：ds[i] = 边 i（poly[i]→poly[i+1]）向内平移量（负 = 外扩）；角点 = 相邻偏移线交点。"""
    poly = ccw(poly)
    n = len(poly)
    if not isinstance(ds, (list, tuple)):
        ds = [ds] * n
    lines = []
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        L, t, nn = edge_frame(a, b)
        d = ds[i]
        lines.append(((a[0] - nn[0] * d, a[1] - nn[1] * d), t))
    out = []
    for i in range(n):
        p0, d0 = lines[i - 1]
        p1, d1 = lines[i]
        x = _line_x(p0, d0, p1, d1)
        if x is None:                       # 平行（共线顶点）：取本边起点
            x = p1
        out.append(x)
    return out


def point_in(poly, p):
    x, y = p
    inside = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y):
            if x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
                inside = not inside
    return inside


def dist_to_boundary(poly, p):
    best = 1e18
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        ex, ey = b[0] - a[0], b[1] - a[1]
        t = max(0.0, min(1.0, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / max(1e-12, ex * ex + ey * ey)))
        best = min(best, math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t))
    return best


def clip_half(poly, nx, ny, c):
    """Sutherland–Hodgman：保留 nx*u + ny*v <= c 的一侧。"""
    out = []
    n = len(poly)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        fp = nx * p[0] + ny * p[1] - c
        fq = nx * q[0] + ny * q[1] - c
        if fp <= 0:
            out.append(p)
        if (fp < 0 < fq) or (fq < 0 < fp):
            t = fp / (fp - fq)
            out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
    return simplify(out, 0.5, 0.02)


def inscribed_rect(poly, cell=0.25, keepout=(), min_side=3.0, v0_max=None):
    """多边形内最大面积的轴向（u,v）矩形：栅格化（格全在多边形内且不碰 keepout 矩形）+ 直方图最大矩形。
    keepout = [(u0,u1,v0,v1)]；v0_max = 只接受下缘 v0 ≤ 该值的矩形（顶层贴前街，不让到后面）。返回 (u0,u1,v0,v1)。"""
    us = [p[0] for p in poly]
    vs = [p[1] for p in poly]
    u0, v0 = min(us), min(vs)
    nu = int(math.ceil((max(us) - u0) / cell))
    nv = int(math.ceil((max(vs) - v0) / cell))

    def ok_pt(x, y):
        return point_in(poly, (x, y))
    corner_ok = [[ok_pt(u0 + i * cell, v0 + j * cell) for i in range(nu + 1)] for j in range(nv + 1)]
    grid = []
    for j in range(nv):
        row = []
        for i in range(nu):
            good = corner_ok[j][i] and corner_ok[j][i + 1] and corner_ok[j + 1][i] and corner_ok[j + 1][i + 1]
            if good:
                cu, cv = u0 + (i + 0.5) * cell, v0 + (j + 0.5) * cell
                for (a0, a1, b0, b1) in keepout:
                    if a0 - cell * 0.5 < cu < a1 + cell * 0.5 and b0 - cell * 0.5 < cv < b1 + cell * 0.5:
                        good = False
                        break
            row.append(good)
        grid.append(row)
    best = (0.0, None)
    h = [0] * nu
    for j in range(nv):
        for i in range(nu):
            h[i] = h[i] + 1 if grid[j][i] else 0
        stack = []
        for i in range(nu + 1):
            cur = h[i] if i < nu else 0
            start = i
            while stack and stack[-1][1] >= cur:
                si, sh = stack.pop()
                w = i - si
                rv0 = v0 + (j - sh + 1) * cell
                if w * cell >= min_side and sh * cell >= min_side and w * sh > best[0] and (v0_max is None or rv0 <= v0_max):
                    best = (w * sh, (u0 + si * cell, u0 + i * cell, rv0, v0 + (j + 1) * cell))
                start = si
            stack.append((start, cur))
    return best[1]


def corner_notch(poly, rect):
    """从多边形挖去位于某个角上的轴向矩形 rect=(u0,u1,v0,v1)（华宝楼角亭做法：体块平面让出角塔）。
    角点 = 离矩形中心最远、且落在矩形内的多边形顶点；返回新多边形（CCW）。"""
    poly = ccw(poly)
    a0, a1, b0, b1 = rect
    inside = [i for i, p in enumerate(poly) if a0 - 1e-6 <= p[0] <= a1 + 1e-6 and b0 - 1e-6 <= p[1] <= b1 + 1e-6]
    if len(inside) != 1:
        raise ValueError('corner_notch: expected exactly one polygon vertex in the tower rect, got %d' % len(inside))
    k = inside[0]
    c = poly[k]
    prev, nxt = poly[k - 1], poly[(k + 1) % len(poly)]
    cu = a0 if abs(c[0] - a1) < abs(c[0] - a0) else a1     # 对角（矩形内侧）坐标
    cv = b0 if abs(c[1] - b1) < abs(c[1] - b0) else b1

    def hit(p, q):
        """p（矩形外）→ q（矩形角点）线段与矩形内侧边的交点。"""
        best = None
        for axis, val in ((0, cu), (1, cv)):
            d = q[axis] - p[axis]
            if abs(d) < 1e-9:
                continue
            t = (val - p[axis]) / d
            if 0 <= t <= 1:
                x = (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)
                if best is None or t < best[0]:
                    best = (t, x)
        return best[1]
    e_in = hit(prev, c)
    e_out = hit(nxt, c)
    return ccw(poly[:k] + [e_in, (cu, cv), e_out] + poly[k + 1:])


def rect_poly(r):
    a0, a1, b0, b1 = r
    return [(a0, b0), (a1, b0), (a1, b1), (a0, b1)]


def bay_lines(a0, a1, rhythm, min_last):
    """开间轴线：节奏交替，含两端（同华宝楼 R2）。"""
    lines = [a0]
    k = 0
    while lines[-1] + rhythm[k % len(rhythm)] < a1 - min_last:
        lines.append(lines[-1] + rhythm[k % len(rhythm)])
        k += 1
    lines.append(a1)
    return lines
