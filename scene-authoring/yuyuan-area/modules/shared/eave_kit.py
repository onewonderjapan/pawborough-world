"""eave_kit.py — 江南楼阁的檐口 / 屋面构件（主控自建，2026-09-24，替换 GLM 版 eave_band / roof_loft / 攒尖）。

为什么重写：上一版把檐口做成一条单面四边形环带（墙顶 → 檐口外缘）+ 一条单面封檐板，远看是一片薄刀；
起翘只加在转角那一个顶点上，而外圈按 1.7 m 取样，转角附近点太稀，于是戳出一根尖；主屋面按弧长重采样两个环，
转角对不上，戗脊扭成破面。

这里的做法（全部在生成器的局部系 (u, v, h) 里，平面为直角多边形，可凹，如 L 形）：
- 檐口是有体积的闭合截面：屋面上皮（凹曲）→ 檐口立面（上段瓦头、下段封檐板）→ 檐底回到墙面；
- 转角取样加密（阳角按 CORNER_STEPS 扇形扫过去），檐口平面外伸（出翘）+ 竖向上翘（起翘）用同一条平滑核，
  沿檐长连续，所以翼角是一整片扫掠面，没有尖；阴角（L 形内角）只斜接不起翘；
- 屋面放样时两个环按「边 + 边上参数」一一对齐（不按弧长），戗脊是连续直线；
- 攒尖屋面同理从檐口环放样到宝顶，四面凹曲、四角起翘。

所有函数只通过 init() 注入的 add_local(name, items, faces, material, part) 出网格；数值都从参数传入。

逐边出檐（2026-09-25 wave4-roofclip 增补，只加不改）：eave_path(poly, over, ...) 与 eave_skirt(prm['over']) 的 over
除标量外还可以是
  - 序列：与调用方传入的 poly 逐边对齐，第 i 个值 = 边 poly[i] → poly[i+1] 的出檐；
  - 可调用：over(a, b) → 该边出檐，a / b 为调用方坐标里的边端点（与边方向无关）。
逐边时檐口外缘 = 各边外移 over_i 的偏移多边形：角点取相邻两边偏移线交点（阳角另加出翘 chu），两条共线边出檐不同
处在同一墙线点放两个取样（前一边 / 后一边的出檐），檐口在此成直端台阶，eave_skirt 的瓦面 / 瓦头 / 封檐板 / 檐底
在该竖面上连成收头。标量 over 走原代码路径，输出逐字节不变。xieshan_roof / zanjian_roof 仍只收标量。
"""
import math

_ADD = None


def init(add_local):
    global _ADD
    _ADD = add_local


# ---------------------------------------------------------------- 基础 ----
def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def _norm(v):
    L = math.hypot(v[0], v[1]) or 1.0
    return (v[0] / L, v[1] / L)


def _cross(a, b):
    return a[0] * b[1] - a[1] * b[0]


def _ccw(poly):
    s = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1]
            for i in range(len(poly)))
    return poly if s > 0 else list(reversed(poly))


def smooth_kernel(d, reach):
    """转角核：d=到最近阳角的沿檐距离；0 处为 1，reach 处为 0，两端零斜率。"""
    if reach <= 0 or d >= reach:
        return 0.0
    t = d / reach
    return 0.5 * (1.0 + math.cos(math.pi * t))


# ------------------------------------------------------------ 檐口路径 ----
def _edge_overs(poly_in, over):
    """逐边出檐（序列 / 可调用）→ 按 _ccw 之后的边序排好的列表；标量返回 None（走原路径）。"""
    if isinstance(over, (int, float)):
        return None
    pts = [tuple(p) for p in poly_in]
    m = len(pts)
    vals = [float(over(pts[i], pts[(i + 1) % m])) for i in range(m)] if callable(over) else [float(o) for o in over]
    if len(vals) != m:
        raise ValueError('eave_kit: per-edge over needs %d values, got %d' % (m, len(vals)))
    if _ccw(pts) is pts:
        return vals
    # _ccw 反转了顶点序：新边 k = 原边 m-2-k（mod m）
    return [vals[(m - 2 - k) % m] for k in range(m)]


def eave_path(poly, over, chu, qiao, reach, straight_step=2.0, corner_step=0.25, corner_steps=6):
    """沿直角多边形 poly（局部 u,v）生成檐口取样点。
    返回列表：每项 dict(p=墙线点, n=外法线, lip=檐口外缘平面点, lift=起翘高, s=累计长度)。
    阳角：墙线在角点不动，法线在 corner_steps 步内从前一边转到后一边，外缘沿角平分线外伸 over*√2 + chu；
    阴角：单点斜接，不起翘。
    over 可为逐边序列 / 可调用（见模块说明），此时每个取样另带 ov = 所在边出檐。"""
    ovs = _edge_overs(poly, over)
    if ovs is not None:
        return _eave_path_edges(poly, ovs, chu, qiao, reach, straight_step, corner_step)
    poly = _ccw([tuple(p) for p in poly])
    n = len(poly)
    # 起翘范围按最短边封顶（小亭 7.5 m 的边上 2.6 m 的范围会把整条边翘成波浪）
    min_edge = min(math.hypot(poly[(i + 1) % n][0] - poly[i][0], poly[(i + 1) % n][1] - poly[i][1]) for i in range(n)
                   if math.hypot(poly[(i + 1) % n][0] - poly[i][0], poly[(i + 1) % n][1] - poly[i][1]) > 1.0)
    if reach > 0.28 * min_edge:
        qiao = qiao * (0.28 * min_edge / reach) ** 0.5
        reach = 0.28 * min_edge
    convex = []
    for i in range(n):
        a, b, c = poly[i - 1], poly[i], poly[(i + 1) % n]
        convex.append(_cross(_sub(b, a), _sub(c, b)) > 0)
    # 每条边的外法线（CCW → 右手侧为外）
    edge_n = []
    for i in range(n):
        d = _norm(_sub(poly[(i + 1) % n], poly[i]))
        edge_n.append((d[1], -d[0]))
    samples = []
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        dvec = _norm(_sub(b, a))
        nrm = edge_n[i]
        # 角点（边 i 的起点 a）：阳角 / 阴角都只放一个斜接点——江南翼角在平面上是沿角平分线伸出的尖角，
        # 不是绕墙角转的圆角（上一版扇形取样会扫出四分之一圆并向内卷）。阳角外伸 = 出檐/cos(半角) + 出翘。
        nb = _norm((edge_n[i - 1][0] + nrm[0], edge_n[i - 1][1] + nrm[1]))
        cosh = max(0.5, nb[0] * nrm[0] + nb[1] * nrm[1])
        samples.append(dict(p=a, n=nb, ext=over / cosh + (chu / cosh if convex[i] else 0.0), corner=bool(convex[i]), t=0))
        # 边内取样：靠近阳角加密
        s = 0.0
        pts = []
        while True:
            near = min(s, L - s)
            step = corner_step if near < reach else straight_step
            s += step
            if s >= L - 1e-6:
                break
            pts.append(s)
        for s in pts:
            samples.append(dict(p=(a[0] + dvec[0] * s, a[1] + dvec[1] * s), n=nrm, ext=over, corner=False, t=0))
    # 到最近阳角的沿檐距离 → 起翘 / 出翘核
    cum = [0.0]
    for i in range(1, len(samples)):
        pa, pb = samples[i - 1]['p'], samples[i]['p']
        cum.append(cum[-1] + math.hypot(pb[0] - pa[0], pb[1] - pa[1]))
    per = cum[-1] + math.hypot(samples[0]['p'][0] - samples[-1]['p'][0], samples[0]['p'][1] - samples[-1]['p'][1])
    corner_s = sorted(set(round(cum[i], 4) for i, sm in enumerate(samples) if sm['corner']))
    for i, sm in enumerate(samples):
        d = min((min(abs(cum[i] - c), per - abs(cum[i] - c)) for c in corner_s), default=1e9)
        k = smooth_kernel(d, reach)
        sm['lift'] = qiao * k
        if not sm['corner']:
            sm['ext'] = sm['ext'] + chu * k * k          # 出翘沿檐渐出（到角点与斜接点平滑衔接）
        p, nn = sm['p'], sm['n']
        sm['lip'] = (p[0] + nn[0] * sm['ext'], p[1] + nn[1] * sm['ext'])
    return samples


def _eave_path_edges(poly, ovs, chu, qiao, reach, straight_step, corner_step):
    """eave_path 的逐边出檐版（ovs 已按 CCW 边序）。与标量版同一套取样 / 起翘规则，只有外缘按偏移线求交。"""
    poly = _ccw([tuple(p) for p in poly])
    n = len(poly)
    lens = [math.hypot(poly[(i + 1) % n][0] - poly[i][0], poly[(i + 1) % n][1] - poly[i][1]) for i in range(n)]
    long_edges = [L for L in lens if L > 1.0]
    if long_edges and reach > 0.28 * min(long_edges):
        qiao = qiao * (0.28 * min(long_edges) / reach) ** 0.5
        reach = 0.28 * min(long_edges)
    convex = []
    for i in range(n):
        a, b, c = poly[i - 1], poly[i], poly[(i + 1) % n]
        convex.append(_cross(_sub(b, a), _sub(c, b)) > 1e-9)
    edge_n = []
    for i in range(n):
        d = _norm(_sub(poly[(i + 1) % n], poly[i]))
        edge_n.append((d[1], -d[0]))
    samples = []
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        L = lens[i]
        dvec = _norm(_sub(b, a))
        nrm, npv = edge_n[i], edge_n[i - 1]
        o, op = ovs[i], ovs[i - 1]
        det = _cross(npv, nrm)
        if abs(det) < 1e-9:
            # 共线（或折回）：出檐相同 = 普通点；不同 = 同一墙线点两个取样，檐口直端台阶
            if abs(o - op) > 1e-9:
                samples.append(dict(p=a, n=npv, ext=op, ov=op, corner=False, step=True, t=0))
            samples.append(dict(p=a, n=nrm, ext=o, ov=o, corner=False, t=0))
        else:
            # 偏移线交点 q：(q-a)·npv = op, (q-a)·nrm = o
            qx = (op * nrm[1] - o * npv[1]) / det
            qy = (o * npv[0] - op * nrm[0]) / det
            ext = math.hypot(qx, qy)
            nb = (qx / ext, qy / ext) if ext > 1e-12 else _norm((npv[0] + nrm[0], npv[1] + nrm[1]))
            cosh = max(0.5, nb[0] * nrm[0] + nb[1] * nrm[1])
            samples.append(dict(p=a, n=nb, ext=ext + (chu / cosh if convex[i] else 0.0), ov=max(o, op),
                                corner=bool(convex[i]), t=0))
        s = 0.0
        pts = []
        while True:
            near = min(s, L - s)
            step = corner_step if near < reach else straight_step
            s += step
            if s >= L - 1e-6:
                break
            pts.append(s)
        for s in pts:
            samples.append(dict(p=(a[0] + dvec[0] * s, a[1] + dvec[1] * s), n=nrm, ext=o, ov=o, corner=False, t=0))
    cum = [0.0]
    for i in range(1, len(samples)):
        pa, pb = samples[i - 1]['p'], samples[i]['p']
        cum.append(cum[-1] + math.hypot(pb[0] - pa[0], pb[1] - pa[1]))
    per = cum[-1] + math.hypot(samples[0]['p'][0] - samples[-1]['p'][0], samples[0]['p'][1] - samples[-1]['p'][1])
    corner_s = sorted(set(round(cum[i], 4) for i, sm in enumerate(samples) if sm['corner']))
    for i, sm in enumerate(samples):
        d = min((min(abs(cum[i] - c), per - abs(cum[i] - c)) for c in corner_s), default=1e9)
        k = smooth_kernel(d, reach)
        sm['lift'] = qiao * k
        if not sm['corner']:
            sm['ext'] = sm['ext'] + chu * k * k
        p, nn = sm['p'], sm['n']
        sm['lip'] = (p[0] + nn[0] * sm['ext'], p[1] + nn[1] * sm['ext'])
    return samples


# ------------------------------------------------------------ 檐口构件 ----
def eave_skirt(name, poly, z, prm, part, root_rise=None, top_rings=2, with_soffit=True):
    """一圈腰檐：墙线上方 root_rise 处起坡 → 檐口外缘（起翘）→ 立面（瓦头 + 封檐板）→ 檐底回墙。
    prm: over, chu, qiao, reach, drop(檐口外缘比 z 低多少), tileH, boardH, curve, soffitRise。
    prm['over'] 可为逐边序列 / 可调用（见模块说明）；标量时输出与原版逐字节一致。"""
    over, chu, qiao, reach = prm['over'], prm['chu'], prm['qiao'], prm['reach']
    rr = prm.get('rootRise', 0.55) if root_rise is None else root_rise
    S = eave_path(poly, over, chu, qiao, reach, prm.get('straightStep', 2.0), prm.get('cornerStep', 0.25),
                  prm.get('cornerSteps', 6))
    m = len(S)
    drop, tH, bH, curve = prm['drop'], prm['tileH'], prm['boardH'], prm.get('curve', 1.7)

    def lip_top(sm):
        return (sm['lip'][0], sm['lip'][1], z - drop + sm['lift'])

    # 屋面上皮：从墙线（z+rr）到外缘，凹曲（高度按 t^curve 下降，外缘略上扬）
    items, faces = [], []
    for j in range(top_rings + 1):
        t = j / top_rings
        for sm in S:
            p, lp = sm['p'], sm['lip']
            u = p[0] + (lp[0] - p[0]) * t
            v = p[1] + (lp[1] - p[1]) * t
            h = (z + rr) + ((z - drop) - (z + rr)) * (t ** (1.0 / curve)) + sm['lift'] * (t ** 2.2)
            items.append(((u, v, h), (sm.get('s', 0) if False else u + v, t * ((over if 'ov' not in sm else sm['ov']) + rr))))
    for j in range(top_rings):
        for i in range(m):
            k = (i + 1) % m
            faces.append((j * m + i, j * m + k, (j + 1) * m + k, (j + 1) * m + i))
    _ADD(name + '-tile', items, faces, 'roof', part)

    # 檐口立面：上段瓦头（深灰）、下段封檐板（深红木）
    for tag, h0, h1, mt in (('tileend', 0.0, tH, 'dark'), ('board', tH, tH + bH, 'wood')):
        it, fc = [], []
        for sm in S:
            x, y, zt = lip_top(sm)
            it.append(((x, y, zt - h0), (x + y, 0.0)))
            it.append(((x, y, zt - h1), (x + y, h1 - h0)))
        for i in range(m):
            k = (i + 1) % m
            fc.append((2 * i, 2 * i + 1, 2 * k + 1, 2 * k))
        _ADD(name + '-' + tag, it, fc, mt, part)

    # 檐底：封檐板下沿 → 墙线（略上扬），深色
    if with_soffit:
        it, fc = [], []
        for sm in S:
            x, y, zt = lip_top(sm)
            it.append(((x, y, zt - tH - bH), (x + y, 0.0)))
            p = sm['p']
            it.append(((p[0], p[1], z + prm.get('soffitRise', 0.15)), (p[0] + p[1], over if 'ov' not in sm else sm['ov'])))
        for i in range(m):
            k = (i + 1) % m
            fc.append((2 * i, 2 * k, 2 * k + 1, 2 * i + 1))
        _ADD(name + '-soffit', it, fc, 'dark', part)
    return S


def brackets(name, points, z, part, w=0.5, d=0.55, h=0.32, box=None):
    """斗拱简化：柱位处两层叠块（下块小、上块挑出），贴在檐底下方。points=[(u,v,nu,nv)]。"""
    for i, (u, v, nu, nv) in enumerate(points):
        tu, tv = -nv, nu
        for lvl, (ww, dd, hh, off) in enumerate(((w * 0.6, d * 0.6, h * 0.5, 0.0), (w, d, h * 0.5, h * 0.5))):
            cu, cv = u + nu * dd * 0.5, v + nv * dd * 0.5
            corners = []
            for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                corners.append((cu + tu * ww * 0.5 * a + nu * dd * 0.5 * b, cv + tv * ww * 0.5 * a + nv * dd * 0.5 * b))
            z0, z1 = z - h + off, z - h + off + hh
            it = [((c[0], c[1], z0), (0, 0)) for c in corners] + [((c[0], c[1], z1), (0, 0)) for c in corners]
            fc = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
            _ADD('%s-%d-%d' % (name, i, lvl), it, fc, 'wood', part)


# ------------------------------------------------------------ 歇山主屋面 ----
def _rect_ring(u0, u1, v0, v1, n_u, n_v):
    """矩形环按「边 + 边参数」取样（CCW，从 (u0,v0) 起），各边点数固定，便于两个环一一对齐。"""
    pts = []
    for k in range(n_u):
        pts.append((u0 + (u1 - u0) * k / n_u, v0, 0, k / n_u))
    for k in range(n_v):
        pts.append((u1, v0 + (v1 - v0) * k / n_v, 1, k / n_v))
    for k in range(n_u):
        pts.append((u1 - (u1 - u0) * k / n_u, v1, 2, k / n_u))
    for k in range(n_v):
        pts.append((u0, v1 - (v1 - v0) * k / n_v, 3, k / n_v))
    return pts


def xieshan_roof(name, rect, z_eave, prm, part):
    """歇山：下檐四坡（矩形 rect=(u0,u1,v0,v1)，檐口外伸 over，四角起翘）放样到折线环（内收 inset、标高 zb），
    上段两坡到正脊 zr，两端山花（内收 shou）+ 博风板，戗脊、正脊与吻。"""
    u0, u1, v0, v1 = rect
    over, qiao, chu, reach = prm['over'], prm['qiao'], prm['chu'], prm['reach']
    zb, zr, inset, shou = prm['breakZ'], prm['ridgeZ'], prm['breakInset'], prm['gableInset']
    drop = prm['drop']
    Lu, Lv = u1 - u0, v1 - v0
    osc = ornament_scale(prm, Lv)
    nu = max(8, int(Lu / 1.2))
    nv = max(6, int(Lv / 1.2))
    ring_e = _rect_ring(u0 - over, u1 + over, v0 - over, v1 + over, nu, nv)
    ring_b = _rect_ring(u0 + inset, u1 - inset, v0 + inset, v1 - inset, nu, nv)

    def corner_k(side, t, L):
        d = min(t, 1 - t) * L
        return smooth_kernel(d, reach)
    rings = prm.get('rings', 7)
    items, faces = [], []
    mm = len(ring_e)
    for j in range(rings + 1):
        t = j / rings
        for (ue, ve, side, te), (ub, vb, _, _) in zip(ring_e, ring_b):
            L = Lu if side in (0, 2) else Lv
            k = corner_k(side, te, L)
            # 出翘：角部檐口再外伸 chu（沿对角方向）
            du = (1 if ue > (u0 + u1) / 2 else -1) * chu * k * (1 - t)
            dv = (1 if ve > (v0 + v1) / 2 else -1) * chu * k * (1 - t)
            u = ue + (ub - ue) * t + du
            v = ve + (vb - ve) * t + dv
            h = (z_eave - drop) + (zb - (z_eave - drop)) * (t ** prm.get('curve', 1.6)) + qiao * k * (1 - t) ** 2.0
            items.append(((u, v, h), (u + v, h)))
    for j in range(rings):
        for i in range(mm):
            k2 = (i + 1) % mm
            faces.append((j * mm + i, j * mm + k2, (j + 1) * mm + k2, (j + 1) * mm + i))
    _ADD(name + '-lower', items, faces, 'roof', part)
    # 下檐檐口立面 + 檐底（取 j=0 环）
    lip = items[:mm]
    for tag, h0, h1, mt in (('tileend', 0.0, prm['tileH'], 'dark'), ('board', prm['tileH'], prm['tileH'] + prm['boardH'], 'wood')):
        it, fc = [], []
        for (p, _uv) in lip:
            it.append(((p[0], p[1], p[2] - h0), (p[0] + p[1], 0)))
            it.append(((p[0], p[1], p[2] - h1), (p[0] + p[1], h1 - h0)))
        for i in range(mm):
            k2 = (i + 1) % mm
            fc.append((2 * i, 2 * i + 1, 2 * k2 + 1, 2 * k2))
        _ADD(name + '-' + tag, it, fc, mt, part)
    it, fc = [], []
    for (p, _uv), (ub, vb, _s, _t) in zip(lip, _rect_ring(u0, u1, v0, v1, nu, nv)):
        it.append(((p[0], p[1], p[2] - prm['tileH'] - prm['boardH']), (0, 0)))
        it.append(((ub, vb, z_eave + 0.1), (0, 1)))
    for i in range(mm):
        k2 = (i + 1) % mm
        fc.append((2 * i, 2 * k2, 2 * k2 + 1, 2 * i + 1))
    _ADD(name + '-soffit', it, fc, 'dark', part)

    # 上段：两坡（沿 u 方向的长边），山花在 u 两端内收 shou
    bu0, bu1, bv0, bv1 = u0 + inset, u1 - inset, v0 + inset, v1 - inset
    vc = (bv0 + bv1) / 2
    gu0, gu1 = bu0 + shou, bu1 - shou
    ridge_lift = prm.get('ridgeEndLift', 0.35) * osc
    wen_reach = 2.5 * osc
    nr = max(6, int((bu1 - bu0) / 1.5))
    for tag, vb_side, sgn in (('s', bv0, -1), ('n', bv1, 1)):
        it, fc = [], []
        rows = 3
        for r in range(rows + 1):
            t = r / rows
            for c in range(nr + 1):
                s = c / nr
                ua = bu0 + (bu1 - bu0) * s
                ur = gu0 + (gu1 - gu0) * s
                u = ua + (ur - ua) * t
                v = vb_side + (vc - vb_side) * t
                end = smooth_kernel(min(s, 1 - s) * (gu1 - gu0), wen_reach)
                h = zb + (zr - zb) * (t ** 0.8) + ridge_lift * end * t
                it.append(((u, v, h), (u, h)))
        for r in range(rows):
            for c in range(nr):
                a = r * (nr + 1) + c
                q = (a, a + 1, a + nr + 2, a + nr + 1)
                fc.append(q if sgn < 0 else (q[0], q[3], q[2], q[1]))
        _ADD(name + '-upper-' + tag, it, fc, 'roof', part)
    # 山花（三角，内收到 gu0/gu1）+ 两端小坡（从折线环到山花脚，歇山的「撒头」）
    for tag, ub, ug, flip in (('w', bu0, gu0, False), ('e', bu1, gu1, True)):
        tri = [((ug, bv0, zb), (0, 0)), ((ug, bv1, zb), (1, 0)), ((ug, vc, zr), (0.5, zr - zb))]
        _ADD(name + '-shanhua-' + tag, tri, [(0, 2, 1)] if not flip else [(0, 1, 2)], 'wall', part)
        quad = [((ub, bv0, zb), (0, 0)), ((ub, bv1, zb), (1, 0)), ((ug, bv1, zb + 0.05), (1, 1)), ((ug, bv0, zb + 0.05), (0, 1))]
        _ADD(name + '-satou-' + tag, quad, [(0, 1, 2, 3)] if flip else [(0, 3, 2, 1)], 'roof', part)
        # 博风板：山花两斜边外侧一条深红木带
        for side, vv in (('a', bv0), ('b', bv1)):
            bf = [((ug + (0.02 if not flip else -0.02), vv, zb), (0, 0)), ((ug + (0.02 if not flip else -0.02), vc, zr + 0.05), (1, 0)),
                  ((ug + (0.02 if not flip else -0.02), vc, zr - 0.35), (1, 1)), ((ug + (0.02 if not flip else -0.02), vv, zb - 0.35), (0, 1))]
            _ADD(name + '-bofeng-%s%s' % (tag, side), bf, [(0, 1, 2, 3)] if (side == 'a') != flip else [(0, 3, 2, 1)], 'wood', part)
    # 正脊：沿 u 的方截面长条，两端起翘成吻
    ridge_items, ridge_faces = [], []
    ns = nr
    wr, hr, wen = 0.28 * osc, 0.42 * osc, 0.9 * osc
    for c in range(ns + 1):
        s = c / ns
        u = gu0 + (gu1 - gu0) * s
        end = smooth_kernel(min(s, 1 - s) * (gu1 - gu0), wen_reach)
        z0 = zr - 0.05 + ridge_lift * end
        z1 = z0 + hr + wen * end ** 3          # 两端吻起翘
        for dv, zz in ((-wr, z0), (-wr, z1), (wr, z1), (wr, z0)):
            ridge_items.append(((u, vc + dv, zz), (u, zz)))
    for c in range(ns):
        for k in range(4):
            a, b = c * 4 + k, c * 4 + (k + 1) % 4
            ridge_faces.append((a, b, b + 4, a + 4))
    ridge_faces.append((0, 1, 2, 3))
    last = ns * 4
    ridge_faces.append((last + 3, last + 2, last + 1, last))
    _ADD(name + '-ridge', ridge_items, ridge_faces, 'dark', part)
    # 戗脊：下檐四个角，从折线环角点到檐口角点，末端随起翘上扬
    for (cu_e, cv_e), (cu_b, cv_b) in (((u0 - over - chu, v0 - over - chu), (bu0, bv0)), ((u1 + over + chu, v0 - over - chu), (bu1, bv0)),
                                      ((u1 + over + chu, v1 + over + chu), (bu1, bv1)), ((u0 - over - chu, v1 + over + chu), (bu0, bv1))):
        it, fc = [], []
        segs = 6
        for c in range(segs + 1):
            t = 0.94 * c / segs                 # 0 = 折线环角, 0.94 = 收在檐角之内（脊宽不探出檐口）
            u = cu_b + (cu_e - cu_b) * t
            v = cv_b + (cv_e - cv_b) * t
            h = zb + ((z_eave - drop) - zb) * ((1 - t) ** 0 * t ** (1 / prm.get('curve', 1.6))) + qiao * t ** 2.2 + 0.12
            d = _norm((cu_e - cu_b, cv_e - cv_b))
            px, py = -d[1] * 0.16 * osc, d[0] * 0.16 * osc
            top = h + (0.3 + 0.35 * t ** 3) * osc
            for sx, zz in ((-1, h), (-1, top), (1, top), (1, h)):
                it.append(((u + px * sx, v + py * sx, zz), (t, zz)))
        for c in range(segs):
            for k in range(4):
                a, b = c * 4 + k, c * 4 + (k + 1) % 4
                fc.append((a, b, b + 4, a + 4))
        _ADD(name + '-qiangji-%d%d' % (int(cu_b), int(cv_b)), it, fc, 'dark', part)


def ornament_scale(prm, depth):
    """正脊 / 吻 / 戗脊截面与起翘的比例。默认 1.0（华宝楼大屋面的原尺寸）；
    'auto' = 按屋面进深 depth 线性缩放，12 m 进深为 1.0，夹在 [0.35, 1.0]（小亭不长角）。"""
    v = prm.get('ornamentScale', 1.0)
    if v == 'auto':
        return max(0.35, min(1.0, depth / 12.0))
    return float(v)


# ------------------------------------------------------------ 攒尖 ----
def zanjian_roof(name, rect, z_eave, apex_z, prm, part):
    """方形攒尖：檐口环（外伸 over，四角起翘 / 出翘）放样到宝顶，四面凹曲。"""
    u0, u1, v0, v1 = rect
    over, qiao, chu, reach = prm['over'], prm['qiao'], prm['chu'], prm['reach']
    n = max(4, int((u1 - u0) / 0.8))
    ring = _rect_ring(u0 - over, u1 + over, v0 - over, v1 + over, n, n)
    cu, cv = (u0 + u1) / 2, (v0 + v1) / 2
    rings = prm.get('rings', 6)
    items, faces = [], []
    mm = len(ring)
    for j in range(rings + 1):
        t = j / rings
        for (ue, ve, side, te) in ring:
            L = (u1 - u0) + 2 * over
            k = smooth_kernel(min(te, 1 - te) * L, reach)
            du = (1 if ue > cu else -1) * chu * k * (1 - t)
            dv = (1 if ve > cv else -1) * chu * k * (1 - t)
            u = ue + (cu - ue) * (t ** 0.85) + du
            v = ve + (cv - ve) * (t ** 0.85) + dv
            h = (z_eave - prm['drop']) + (apex_z - (z_eave - prm['drop'])) * (t ** prm.get('curve', 1.5)) + qiao * k * (1 - t) ** 2
            items.append(((u, v, h), (u + v, h)))
    for j in range(rings):
        for i in range(mm):
            k2 = (i + 1) % mm
            faces.append((j * mm + i, j * mm + k2, (j + 1) * mm + k2, (j + 1) * mm + i))
    _ADD(name + '-cone', items, faces, 'roof', part)
    lip = items[:mm]
    for tag, h0, h1, mt in (('tileend', 0.0, prm['tileH'], 'dark'), ('board', prm['tileH'], prm['tileH'] + prm['boardH'], 'wood')):
        it, fc = [], []
        for (p, _uv) in lip:
            it.append(((p[0], p[1], p[2] - h0), (0, 0)))
            it.append(((p[0], p[1], p[2] - h1), (0, 1)))
        for i in range(mm):
            k2 = (i + 1) % mm
            fc.append((2 * i, 2 * i + 1, 2 * k2 + 1, 2 * k2))
        _ADD(name + '-' + tag, it, fc, mt, part)
    it, fc = [], []
    for (p, _uv), (ub, vb, _s, _t) in zip(lip, _rect_ring(u0, u1, v0, v1, n, n)):
        it.append(((p[0], p[1], p[2] - prm['tileH'] - prm['boardH']), (0, 0)))
        it.append(((ub, vb, z_eave + 0.1), (0, 1)))
    for i in range(mm):
        k2 = (i + 1) % mm
        fc.append((2 * i, 2 * k2, 2 * k2 + 1, 2 * i + 1))
    _ADD(name + '-soffit', it, fc, 'dark', part)
