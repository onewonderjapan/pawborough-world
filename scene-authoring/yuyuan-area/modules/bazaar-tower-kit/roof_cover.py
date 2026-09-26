"""bazaar-tower-kit 屋面覆盖检测（wave7 K0）：正上方正交俯视「渲染」（软件 z-buffer），逐像素取最上层三角。

纯 Python + numpy（无 Blender）。输入只有两样：GLB 的网格（世界坐标，锚 empty 变换已乘入）与 baseline/layout.json 的
footprint（地图 x,z）——不读模块自报数字。

像素分类（只统计像素中心落在 footprint 内的像素）：
- tile  ：最上层三角的材质名含 'roof'（瓦面贴图材质 btk-roof / 程序化体块的屋面材质）
- flat  ：最上层三角 |法线 z| > 0.99 且不是瓦面材质（平屋顶 / 露台 / 楼板盖 / 脊顶等一切水平非瓦面）
- slope ：其余（非水平、非瓦面：脊侧、山花、博风、封檐板……）
- empty ：没有任何三角（footprint 内露天）
屋面覆盖 = (tile + slope) / footprint 像素；平屋顶占比 = flat / footprint 像素。
GOAL wave7 K0 判据：屋面覆盖 ≥ 97%，平屋顶 ≤ 3%。

另给出 flat 像素按节点名前缀（part）拆分，便于说明平面来自哪里（terrace / roof 脊顶 / pav-cap ……）。

用法：python3 -X utf8 modules/bazaar-tower-kit/roof_cover.py --glb <model.glb> --id <bld-…> [--px 0.1] [--png <out.png>]
      [--zone-node]（GLB 是分区件时，只取锚名 = id 或节点名含 |id| 的子树）
"""
import json, math, os, struct, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
FLAT_NZ = 0.99


def footprint(bid, layout=None):
    L = layout or json.load(open(os.path.join(ROOT, 'baseline', 'layout.json'), encoding='utf-8'))
    o = next(o for o in L['objects'] if o['id'] == bid)
    fp = [tuple(q) for q in o['geometry']['footprint']]
    if fp[0] == fp[-1]:
        fp = fp[:-1]
    return fp


def _node_matrix(n):
    if 'matrix' in n:
        return np.array(n['matrix'], dtype=float).reshape(4, 4).T
    t = n.get('translation', [0, 0, 0])
    x, y, z, w = n.get('rotation', [0, 0, 0, 1])
    s = n.get('scale', [1, 1, 1])
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4)
    M[:3, :3] = R * np.array(s)[None, :]
    M[:3, 3] = t
    return M


def load_glb(path, bid=None, zone_subtree=False):
    """→ [(node_name, material_name, tris ndarray (k,3,3) 世界坐标 glTF y-up)]"""
    buf = open(path, 'rb').read()
    jl = struct.unpack_from('<I', buf, 12)[0]
    j = json.loads(bytes(buf[20:20 + jl]))
    boff = 20 + jl
    blen = struct.unpack_from('<I', buf, boff)[0]
    data = buf[boff + 8:boff + 8 + blen]
    ctype = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
    ncomp = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

    def acc(ai):
        a = j['accessors'][ai]
        bv = j['bufferViews'][a['bufferView']]
        dt = np.dtype(ctype[a['componentType']])
        nc = ncomp[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride') or dt.itemsize * nc
        if stride == dt.itemsize * nc:
            arr = np.frombuffer(data, dtype=dt, count=a['count'] * nc, offset=off).reshape(-1, nc)
        else:
            raw = np.frombuffer(data, dtype=np.uint8, count=stride * a['count'], offset=off).reshape(-1, stride)
            arr = raw[:, :dt.itemsize * nc].copy().view(dt).reshape(-1, nc)
        return arr
    nodes = j.get('nodes', [])
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[c] = i
    keep = None
    if zone_subtree and bid:
        roots = [i for i, n in enumerate(nodes) if n.get('name') == bid or ('|%s|' % bid) in n.get('name', '')]
        keep = set()
        st = list(roots)
        while st:
            i = st.pop()
            keep.add(i)
            st.extend(nodes[i].get('children', []))

    def world(i):
        M = _node_matrix(nodes[i])
        p = parent.get(i)
        while p is not None:
            M = _node_matrix(nodes[p]) @ M
            p = parent.get(p)
        return M
    out = []
    for i, n in enumerate(nodes):
        if n.get('mesh') is None or (keep is not None and i not in keep):
            continue
        M = world(i)
        for p in j['meshes'][n['mesh']]['primitives']:
            if p.get('mode', 4) != 4:
                continue
            pos = acc(p['attributes']['POSITION']).astype(float)
            pos = pos @ M[:3, :3].T + M[:3, 3]
            idx = acc(p['indices']).reshape(-1).astype(np.int64) if 'indices' in p else np.arange(len(pos))
            tris = pos[idx.reshape(-1, 3)]
            mname = j['materials'][p['material']].get('name', '') if p.get('material') is not None else ''
            out.append((n.get('name', 'node%d' % i), mname, tris))
    return out


def point_in_poly_grid(poly, X, Z):
    inside = np.zeros(X.shape, dtype=bool)
    n = len(poly)
    for i in range(n):
        x0, z0 = poly[i]
        x1, z1 = poly[(i + 1) % n]
        cond = (z0 > Z) != (z1 > Z)
        with np.errstate(divide='ignore', invalid='ignore'):
            xin = x0 + (Z - z0) * (x1 - x0) / (z1 - z0)
        inside ^= cond & (X < xin)
    return inside


def raster(meshes, fp, px=0.1, margin=2.0):
    """俯视 z-buffer：返回 dict（grid 数组 + 分类统计）。地图系 (x, z)，高度 = glTF y。"""
    xs = [q[0] for q in fp]
    zs = [q[1] for q in fp]
    x0, z0 = min(xs) - margin, min(zs) - margin
    nx = int(math.ceil((max(xs) + margin - x0) / px))
    nz = int(math.ceil((max(zs) + margin - z0) / px))
    H = np.full((nz, nx), -1e9)
    MAT = np.full((nz, nx), -1, dtype=np.int32)
    NZ = np.zeros((nz, nx))
    NODE = np.full((nz, nx), -1, dtype=np.int32)
    mat_names, node_names = [], []
    for nname, mname, tris in meshes:
        if mname not in mat_names:
            mat_names.append(mname)
        if nname not in node_names:
            node_names.append(nname)
        mi, ni = mat_names.index(mname), node_names.index(nname)
        if not len(tris):
            continue
        e1 = tris[:, 1] - tris[:, 0]
        e2 = tris[:, 2] - tris[:, 0]
        nrm = np.cross(e1, e2)
        ln = np.linalg.norm(nrm, axis=1)
        ok = ln > 1e-12
        nzs = np.zeros(len(tris))
        nzs[ok] = np.abs(nrm[ok, 1]) / ln[ok]
        for t, nzv in zip(tris[ok], nzs[ok]):
            ax, az = t[:, 0], t[:, 2]
            i0 = max(0, int(math.floor((ax.min() - x0) / px - 0.5)))
            i1 = min(nx - 1, int(math.ceil((ax.max() - x0) / px - 0.5)))
            j0 = max(0, int(math.floor((az.min() - z0) / px - 0.5)))
            j1 = min(nz - 1, int(math.ceil((az.max() - z0) / px - 0.5)))
            if i1 < i0 or j1 < j0:
                continue
            gx = x0 + (np.arange(i0, i1 + 1) + 0.5) * px
            gz = z0 + (np.arange(j0, j1 + 1) + 0.5) * px
            GX, GZ = np.meshgrid(gx, gz)
            (xa, xb, xc), (za, zb, zc) = ax, az
            den = (zb - zc) * (xa - xc) + (xc - xb) * (za - zc)
            if abs(den) < 1e-12:
                continue                                   # 竖直面：俯视无面积
            l1 = ((zb - zc) * (GX - xc) + (xc - xb) * (GZ - zc)) / den
            l2 = ((zc - za) * (GX - xc) + (xa - xc) * (GZ - zc)) / den
            l3 = 1 - l1 - l2
            m = (l1 >= -1e-9) & (l2 >= -1e-9) & (l3 >= -1e-9)
            if not m.any():
                continue
            h = l1 * t[0, 1] + l2 * t[1, 1] + l3 * t[2, 1]
            sub = H[j0:j1 + 1, i0:i1 + 1]
            upd = m & (h > sub + 1e-6)
            if upd.any():
                sub[upd] = h[upd]
                MAT[j0:j1 + 1, i0:i1 + 1][upd] = mi
                NZ[j0:j1 + 1, i0:i1 + 1][upd] = nzv
                NODE[j0:j1 + 1, i0:i1 + 1][upd] = ni
    GX, GZ = np.meshgrid(x0 + (np.arange(nx) + 0.5) * px, z0 + (np.arange(nz) + 0.5) * px)
    IN = point_in_poly_grid(fp, GX, GZ)
    tile_m = np.array(['roof' in m for m in mat_names] + [False])       # 下标 -1 → 末位 False
    is_tile = tile_m[MAT]
    hit = MAT >= 0
    flat = hit & ~is_tile & (NZ > FLAT_NZ)
    tile = hit & is_tile
    slope = hit & ~is_tile & ~(NZ > FLAT_NZ)
    n_in = int(IN.sum())
    by_part = {}
    fl_nodes = NODE[flat & IN]
    for ni in np.unique(fl_nodes):
        by_part[node_names[ni]] = round(float((fl_nodes == ni).sum()) * px * px, 2)
    res = {
        'px': px, 'footprintPx': n_in, 'footprintM2': round(n_in * px * px, 1),
        'tile': round(float((tile & IN).sum()) / n_in, 4),
        'slope': round(float((slope & IN).sum()) / n_in, 4),
        'flat': round(float((flat & IN).sum()) / n_in, 4),
        'empty': round(float((~hit & IN).sum()) / n_in, 4),
        'flatM2ByNode': dict(sorted(by_part.items(), key=lambda kv: -kv[1])),
    }
    res['roofCover'] = round(res['tile'] + res['slope'], 4)
    res['_grids'] = {'IN': IN, 'tile': tile, 'slope': slope, 'flat': flat, 'H': H}
    return res


def save_png(res, path):
    from PIL import Image
    g = res['_grids']
    img = np.full(g['IN'].shape + (3,), 235, dtype=np.uint8)
    img[g['tile']] = (90, 96, 104)
    img[g['slope']] = (150, 70, 50)
    img[g['flat']] = (240, 200, 40)
    img[g['IN'] & ~(g['tile'] | g['slope'] | g['flat'])] = (230, 30, 200)
    edge = g['IN'] ^ np.roll(g['IN'], 1, axis=0) | g['IN'] ^ np.roll(g['IN'], 1, axis=1)
    img[edge] = (0, 0, 0)
    # 地图 z 向下为行号增加；俯视图北（-z）朝上
    Image.fromarray(img).save(path)


def check(glb, bid, px=0.1, zone_subtree=False):
    return raster(load_glb(glb, bid, zone_subtree), footprint(bid), px)


if __name__ == '__main__':
    A = sys.argv[1:]
    def arg(f, d=None):
        return A[A.index(f) + 1] if f in A else d
    r = check(arg('--glb'), arg('--id'), float(arg('--px', '0.1')), '--zone-node' in A)
    if arg('--png'):
        save_png(r, arg('--png'))
    r.pop('_grids')
    print(json.dumps(r, ensure_ascii=False))
