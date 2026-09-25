"""eave_facing.py — eave_kit 产出网格的面朝向检测（纯 Python，无 Blender / numpy 依赖）。

用途：判定 eave_kit 出的每个网格、每个三角面的正面（右手 (b-a)×(c-a)，glTF 逆时针为正面）是否朝着它该朝的
外侧。运行时 web/main.js 对无贴图材质强制 FrontSide（背面剔除），朝反了的面从外面看是透的。

角色按 eave_kit 的网格名后缀认（不认得的网格名 → unknownMeshes，调用方应判 FAIL，防止新构件漏检）：
  surface  -tile / -lower / -upper-s|n / -cone / -satou-w|e   瓦面：法线朝上（n̂·up > 0）
  soffit   -soffit                                             檐底：法线朝下（n̂·up < 0）
  fascia   -tileend / -board / -endcap*                        檐口立面（瓦头 / 封檐板 / 端头收口）：朝外
  gable    -shanhua-* / -bofeng-*                              山花 / 博风：水平朝外（背离本屋面平面形心）
  solid    -ridge / -qiangji-* / 斗拱块 <name>-<i>-<lvl>        实体：正面朝体外（射线奇偶）

判定：
  - surface / soffit 的面若 |n̂·up| ≥ FLAT_TOL，直接按上 / 下判；
  - 近竖直的 surface / soffit 面（逐边出檐台阶处的收头面）和全部 fascia 面没有「上 / 下」可判，按同一组
    （同一次 eave_kit 调用：名字去掉后缀相同）焊接后的流形边做绕向一致性传播：从已判定的面出发，邻面应与
    「已判定面改正后的朝向」一致。与之不一致即为反面。传播不到的面计入 unjudged（调用方应要求为 0）；
  - gable：水平法线分量须背离同组全部顶点的平面形心；
  - solid：从面内一点沿正面法线发射线，与同一网格其余三角面的交点数为奇数 → 正面朝体内 → 反面。

入口：audit(meshes, up) —— meshes = [dict(name=..., verts=[(x,y,z)...], faces=[(i,j,k[,l...])...])]，
up = 世界竖直单位向量（Blender 世界 (0,0,1)；glTF (0,1,0)；eave_kit 局部 (0,0,1)）。面按扇形三角化，
零面积三角跳过（计 degenerate）。返回 dict，wrongTris 为反面三角数。
"""
import math
import re

FLAT_TOL = 0.05          # |n̂·up| 小于此值的 surface / soffit 面视为竖直，交给一致性传播
WELD = 1e-4              # 焊接量化步长（米）

_ROLES = (
    (re.compile(r'-qiangji-'), 'solid'),
    (re.compile(r'-ridge$'), 'solid'),
    (re.compile(r'-(tile|lower|upper-[sn]|cone|satou-[we])$'), 'surface'),
    (re.compile(r'-soffit$'), 'soffit'),
    (re.compile(r'-(tileend|board|endcap(-[a-z0-9]+)?)$'), 'fascia'),
    (re.compile(r'-(shanhua|bofeng)-[a-z]+$'), 'gable'),
    (re.compile(r'-\d+-\d+$'), 'solid'),           # brackets: '%s-%d-%d' % (name, i, lvl)
)


def classify(name):
    """网格名 → (role, group)；不认得返回 (None, None)。group = 去掉角色后缀的名字（同一次 kit 调用）。"""
    for rx, role in _ROLES:
        m = rx.search(name)
        if m:
            return role, (name if role == 'solid' else name[:m.start()])
    return None, None


# ------------------------------------------------------------------ 向量 ----
def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _unit(a):
    L = math.sqrt(_dot(a, a))
    return (a[0] / L, a[1] / L, a[2] / L) if L > 0 else (0.0, 0.0, 0.0)


def _tris(faces):
    for f in faces:
        f = tuple(f)
        for k in range(1, len(f) - 1):
            yield (f[0], f[k], f[k + 1])


def _ray_hits(orig, d, tris, skip):
    """Möller–Trumbore：从 orig 沿 d 的射线与 tris（[(A,B,C)]）的正向交点数（t > 1e-7），跳过下标 skip。"""
    n = 0
    for idx, (A, B, C) in enumerate(tris):
        if idx == skip:
            continue
        e1, e2 = _sub(B, A), _sub(C, A)
        p = _cross(d, e2)
        det = _dot(e1, p)
        if abs(det) < 1e-14:
            continue
        inv = 1.0 / det
        s = _sub(orig, A)
        u = _dot(s, p) * inv
        if u < 0.0 or u > 1.0:
            continue
        q = _cross(s, e1)
        v = _dot(d, q) * inv
        if v < 0.0 or u + v > 1.0:
            continue
        if _dot(e2, q) * inv > 1e-7:
            n += 1
    return n


# ------------------------------------------------------------------ 检测 ----
def audit(meshes, up=(0.0, 0.0, 1.0)):
    up = _unit(up)
    res = dict(tris=0, wrongTris=0, folded=0, degenerate=0, unjudged=0, conflicts=0, unknownMeshes=[], byMesh={},
               byRole={})
    groups = {}
    # 每个三角：[mesh, A, B, C, n(未归一), role, verdict]；verdict: +1 对 / -1 反 / 0 未判
    for m in meshes:
        role, grp = classify(m['name'])
        if role is None:
            res['unknownMeshes'].append(m['name'])
            continue
        V = [tuple(float(c) for c in v) for v in m['verts']]
        rec = res['byMesh'].setdefault(m['name'], dict(role=role, tris=0, wrong=0))
        g = groups.setdefault(grp, dict(tris=[], verts=[]))
        g['verts'].extend(V)
        solid_tris = []
        for a, b, c in _tris(m['faces']):
            A, B, C = V[a], V[b], V[c]
            nrm = _cross(_sub(B, A), _sub(C, A))
            area2 = math.sqrt(_dot(nrm, nrm))
            scale = max(abs(x) for x in _sub(B, A) + _sub(C, A)) or 1.0
            if area2 < 1e-10 * scale * scale or area2 < 1e-12:
                res['degenerate'] += 1
                continue
            t = dict(mesh=m['name'], role=role, P=(A, B, C), n=nrm, v=0)
            rec['tris'] += 1
            g['tris'].append(t)
            if role == 'solid':
                solid_tris.append(t)
        if role == 'solid':
            geo = [t['P'] for t in solid_tris]
            for i, t in enumerate(solid_tris):
                A, B, C = t['P']
                w = (0.31, 0.33, 0.36)
                o = tuple(A[k] * w[0] + B[k] * w[1] + C[k] * w[2] for k in range(3))
                d = _unit(t['n'])
                d = _unit((d[0] + 1.3e-4, d[1] - 0.7e-4, d[2] + 0.9e-4))
                t['v'] = -1 if _ray_hits(o, d, geo, i) % 2 else 1
    for grp, g in groups.items():
        allv = g['verts']
        # 平面形心（去掉 up 分量）
        cx = [sum(v[k] for v in allv) / max(1, len(allv)) for k in range(3)]
        cd = _dot(cx, up)
        cen = (cx[0] - up[0] * cd, cx[1] - up[1] * cd, cx[2] - up[2] * cd)
        prop = []
        for t in g['tris']:
            if t['role'] == 'solid':
                continue
            nu = _unit(t['n'])
            nz = _dot(nu, up)
            if t['role'] in ('surface', 'soffit') and abs(nz) >= FLAT_TOL:
                t['v'] = 1 if (nz > 0) == (t['role'] == 'surface') else -1
            elif t['role'] == 'gable':
                nh = (nu[0] - up[0] * nz, nu[1] - up[1] * nz, nu[2] - up[2] * nz)
                A, B, C = t['P']
                c = tuple((A[k] + B[k] + C[k]) / 3 for k in range(3))
                cz = _dot(c, up)
                ch = (c[0] - up[0] * cz - cen[0], c[1] - up[1] * cz - cen[1], c[2] - up[2] * cz - cen[2])
                s = _dot(nh, ch)
                if math.sqrt(_dot(nh, nh)) > 0.2 and abs(s) > 1e-9:
                    t['v'] = 1 if s > 0 else -1
            if t['role'] in ('surface', 'soffit', 'fascia'):
                prop.append(t)
        # 连通分量（surface / soffit / fascia 焊接后的流形边）：分量内按绕向一致性求相对朝向 rel，
        # 再用分量里可直接判定的面（rule）投票定整体朝向；rel 与投票结果相反 = 绕向反了（wrong），
        # rel 对但 rule 判反 = 几何本身折回（folded，不是绕向问题，另计）。
        key = lambda P: (round(P[0] / WELD), round(P[1] / WELD), round(P[2] / WELD))
        edges = {}
        for idx, t in enumerate(prop):
            ks = [key(P) for P in t['P']]
            for e in range(3):
                a, b = ks[e], ks[(e + 1) % 3]
                if a == b:
                    continue
                edges.setdefault((a, b) if a < b else (b, a), []).append((idx, (a, b)))
        adj = [[] for _ in prop]
        for lst in edges.values():
            if len(lst) != 2:
                continue
            (i, di), (j, dj) = lst
            same_dir = di == dj                      # 同向走同一条边 = 两面绕向不一致
            adj[i].append((j, same_dir))
            adj[j].append((i, same_dir))
        rel = [0] * len(prop)
        for seed in range(len(prop)):
            if rel[seed]:
                continue
            rel[seed] = 1
            comp, queue = [seed], [seed]
            while queue:
                nxt = []
                for i in queue:
                    for j, same_dir in adj[i]:
                        want = -rel[i] if same_dir else rel[i]
                        if rel[j]:
                            if rel[j] != want:
                                res['conflicts'] += 1
                            continue
                        rel[j] = want
                        comp.append(j)
                        nxt.append(j)
                queue = nxt
            vote = sum(prop[i]['v'] * rel[i] for i in comp)
            sign = 1 if vote > 0 else (-1 if vote < 0 else 0)
            for i in comp:
                t = prop[i]
                rule = t['v']
                t['v'] = rel[i] * sign
                if t['v'] > 0 and rule < 0:
                    t['folded'] = True
        for t in g['tris']:
            res['tris'] += 1
            rb = res['byRole'].setdefault(t['role'], dict(tris=0, wrong=0))
            rb['tris'] += 1
            if t.get('folded'):
                res['folded'] += 1
                rb['folded'] = rb.get('folded', 0) + 1
            if t['v'] == 0:
                res['unjudged'] += 1
            elif t['v'] < 0:
                res['wrongTris'] += 1
                rb['wrong'] += 1
                res['byMesh'][t['mesh']]['wrong'] += 1
    return res


def summary(res, top=12):
    """一行摘要 + 反面最多的若干网格。"""
    worst = sorted(((v['wrong'], k) for k, v in res['byMesh'].items() if v['wrong']), reverse=True)[:top]
    return ('tris=%d wrong=%d folded=%d unjudged=%d conflicts=%d degenerate=%d unknown=%d byRole=%s worst=%s'
            % (res['tris'], res['wrongTris'], res['folded'], res['unjudged'], res['conflicts'], res['degenerate'],
               len(res['unknownMeshes']),
               {k: '%d/%d' % (v['wrong'], v['tris']) for k, v in sorted(res['byRole'].items())},
               ', '.join('%s %d' % (k, w) for w, k in worst)))
