"""eave_audit.py — 对 eave_record.py 的记录做面朝向审计，可选再到使用者导出的 GLB 里逐面对照（纯 Python）。

  python3 -X utf8 modules/shared/eave_audit.py <record.json> [--glb <model.glb>] [--report <out.json>]

- 记录里的几何是 Blender 世界坐标（Z 向上），直接交给 eave_facing.audit(up=(0,0,1))；
- --glb：把每个记录面在 GLB 里找回来（GLB (x,y,z) = Blender (x,z,-y)；按位置焊接，四边形两条对角线都试），
  用 GLB 里的绕向替换记录绕向后再审计一次——这就是产物（GLB）里的反面数。找不到的面计 glbUnmatched。
- 退出码：0 = 审计完成（不管有无反面；由调用方 / 测试判定）。
"""
import json
import math
import os
import struct
import sys
from array import array

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import eave_facing as EF                                   # noqa: E402

# ------------------------------------------------------------------ GLB ----
_CT = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
_NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def _mat_mul(A, B):
    return [[sum(A[i][k] * B[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def _node_mat(n):
    if 'matrix' in n:
        m = n['matrix']
        return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    x, y, z, w = n.get('rotation', [0, 0, 0, 1])
    sx, sy, sz = n.get('scale', [1, 1, 1])
    tx, ty, tz = n.get('translation', [0, 0, 0])
    R = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    return [[R[0][0] * sx, R[0][1] * sy, R[0][2] * sz, tx], [R[1][0] * sx, R[1][1] * sy, R[1][2] * sz, ty],
            [R[2][0] * sx, R[2][1] * sy, R[2][2] * sz, tz], [0, 0, 0, 1]]


def glb_triangles(path):
    """[(node名, [(x,y,z)...] 世界坐标, [(i,j,k)...])]；负行列式节点已反转绕向。"""
    b = open(path, 'rb').read()
    jl = struct.unpack_from('<I', b, 12)[0]
    j = json.loads(b[20:20 + jl])
    off = 20 + jl
    bl = struct.unpack_from('<I', b, off)[0]
    binb = b[off + 8:off + 8 + bl]

    def acc(i):
        a = j['accessors'][i]
        bv = j['bufferViews'][a['bufferView']]
        n, c = _NC[a['type']], _CT[a['componentType']]
        size = struct.calcsize(c)
        start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride', 0) or n * size
        out = []
        for k in range(a['count']):
            out.append(struct.unpack_from('<' + c * n, binb, start + k * stride))
        return out
    res = []

    def walk(ni, P):
        n = j['nodes'][ni]
        M = _mat_mul(P, _node_mat(n))
        if 'mesh' in n:
            det = (M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
                   + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]))
            for pr in j['meshes'][n['mesh']]['primitives']:
                if pr.get('mode', 4) != 4:
                    continue
                V = [tuple(M[r][0] * p[0] + M[r][1] * p[1] + M[r][2] * p[2] + M[r][3] for r in range(3))
                     for p in acc(pr['attributes']['POSITION'])]
                idx = [i[0] for i in acc(pr['indices'])] if 'indices' in pr else list(range(len(V)))
                T = [tuple(idx[k:k + 3]) for k in range(0, len(idx), 3)]
                if det < 0:
                    T = [(a, c, b_) for a, b_, c in T]
                res.append((n.get('name'), V, T))
        for c in n.get('children', []):
            walk(c, M)
    I4 = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
    for r in j['scenes'][j.get('scene', 0)]['nodes']:
        walk(r, I4)
    return res


class _Snap:
    """位置焊接：2 mm 内视为同一点（GLB float32 与记录 float64 的差）。"""
    def __init__(self, q=0.01, tol=2e-3):
        self.q, self.tol, self.grid, self.pts = q, tol, {}, []

    def find(self, p, add=False):
        cx, cy, cz = (int(math.floor(c / self.q)) for c in p)
        best, bd = None, self.tol
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for i in self.grid.get((cx + dx, cy + dy, cz + dz), ()):
                        q = self.pts[i]
                        d = max(abs(q[0] - p[0]), abs(q[1] - p[1]), abs(q[2] - p[2]))
                        if d <= bd:
                            best, bd = i, d
        if best is None and add:
            best = len(self.pts)
            self.pts.append(p)
            self.grid.setdefault((cx, cy, cz), []).append(best)
        return best


def _tri_n(A, B, C):
    e1 = (B[0] - A[0], B[1] - A[1], B[2] - A[2])
    e2 = (C[0] - A[0], C[1] - A[1], C[2] - A[2])
    return (e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0])


def glb_orient(meshes, glb_path):
    """记录网格 → 用 GLB 里对应三角的绕向改写后的网格列表 + 统计。"""
    snap = _Snap()
    tri_index = {}
    for _nm, V, T in glb_triangles(glb_path):
        ids = [snap.find((v[0], -v[2], v[1]), add=True) for v in V]      # glTF -> Blender (x, -z, y)
        P = snap.pts
        for a, b, c in T:
            k = (ids[a], ids[b], ids[c])
            if len(set(k)) < 3:
                continue
            n = _tri_n(P[k[0]], P[k[1]], P[k[2]])
            tri_index.setdefault(tuple(sorted(k)), []).append((k, n))
    # 使用者在 kit 出网格之后可能整体平移（hall-kit 末尾按面积形心重锚）：先求平移量（只认纯平移，不认旋转 / 镜像）
    probe = [tuple(v) for m in meshes for v in m['verts']]
    probe = probe[::max(1, len(probe) // 12)][:12]
    shift = None
    if probe:
        cands = [(0.0, 0.0, 0.0)] + [(g[0] - probe[0][0], g[1] - probe[0][1], g[2] - probe[0][2]) for g in snap.pts]
        for t in cands:
            if all(snap.find((v[0] + t[0], v[1] + t[1], v[2] + t[2])) is not None for v in probe):
                shift = t
                break
    shift = shift or (0.0, 0.0, 0.0)
    out, st = [], dict(faces=0, matched=0, unmatched=0, ambiguous=0, flippedVsRecord=0, shift=[round(c, 6) for c in shift])
    for m in meshes:
        V = [(v[0] + shift[0], v[1] + shift[1], v[2] + shift[2]) for v in m['verts']]
        ids = [snap.find(tuple(v)) for v in V]
        faces = []
        for f in m['faces']:
            st['faces'] += 1
            fi = [ids[i] for i in f]
            if any(i is None for i in fi):
                st['unmatched'] += 1
                faces.append(f)
                continue
            rn = [0.0, 0.0, 0.0]                                          # 记录面的 Newell 法线
            for a in range(len(f)):
                p, q = V[f[a]], V[f[(a + 1) % len(f)]]
                rn[0] += (p[1] - q[1]) * (p[2] + q[2])
                rn[1] += (p[2] - q[2]) * (p[0] + q[0])
                rn[2] += (p[0] - q[0]) * (p[1] + q[1])
            votes = []
            n = len(fi)
            for a in range(n):
                for b in range(a + 1, n):
                    for c in range(b + 1, n):
                        for _k, gn in tri_index.get(tuple(sorted((fi[a], fi[b], fi[c]))), ()):
                            votes.append(1 if gn[0] * rn[0] + gn[1] * rn[1] + gn[2] * rn[2] > 0 else -1)
            if not votes:
                st['unmatched'] += 1
                faces.append(f)
                continue
            st['matched'] += 1
            if min(votes) != max(votes):
                st['ambiguous'] += 1
            if sum(votes) < 0:
                st['flippedVsRecord'] += 1
                faces.append((f[0],) + tuple(reversed(f[1:])))
            else:
                faces.append(f)
        out.append(dict(name=m['name'], verts=V, faces=faces))
    return out, st


def meshes_from_record(rec):
    ms = []
    for r in rec['records']:
        for o in r['objects']:
            ms.append(dict(name=r['name'], verts=[tuple(v) for v in o['verts']], faces=[tuple(f) for f in o['faces']]))
    return ms


def main(argv):
    path = argv[0]
    glb = argv[argv.index('--glb') + 1] if '--glb' in argv else None
    rep = argv[argv.index('--report') + 1] if '--report' in argv else None
    rec = json.load(open(path, encoding='utf-8'))
    ms = meshes_from_record(rec)
    r_build = EF.audit(ms, up=(0, 0, 1))
    out = dict(record=path, calls=rec['calls'], localSha256=rec['localSha256'], build=r_build)
    print('BUILD', EF.summary(r_build))
    if glb:
        gms, st = glb_orient(ms, glb)
        r_glb = EF.audit(gms, up=(0, 0, 1))
        out.update(glb=glb, glbMatch=st, glbAudit=r_glb)
        print('GLB  ', EF.summary(r_glb), 'match', st)
    if rep:
        slim = json.loads(json.dumps(out))
        for k in ('build', 'glbAudit'):
            if k in slim:
                slim[k]['byMesh'] = {n: v for n, v in slim[k]['byMesh'].items() if v['wrong']}
        with open(rep, 'w', encoding='utf-8') as f:
            json.dump(slim, f, ensure_ascii=False, indent=1)
    return out


if __name__ == '__main__':
    main(sys.argv[1:])
