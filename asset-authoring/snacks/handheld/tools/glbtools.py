#!/usr/bin/env python3
"""Pure-python GLB 2.0 reader used by the exporter (catalog) and the contract tests.
No Blender required. Returns node tree, world matrices, per-mesh triangles, bounds,
images, extras, and outward-share for closed meshes."""
import json
import struct
from pathlib import Path
from itertools import product


def parse(path):
    data = Path(path).read_bytes()
    magic, version, declared = struct.unpack_from('<III', data)
    if magic != 0x46546C67 or version != 2 or declared != len(data):
        raise ValueError('bad GLB header: %s' % path)
    offset = 12
    j = None
    binchunk = b''
    while offset < len(data):
        ln, kind = struct.unpack_from('<II', data, offset)
        offset += 8
        chunk = data[offset:offset + ln]
        offset += ln
        if kind == 0x4E4F534A:
            j = json.loads(chunk)
        elif kind == 0x004E4942:
            binchunk = chunk
    return {'json': j, 'bin': binchunk, 'bytes': len(data),
            'sha256': __import__('hashlib').sha256(data).hexdigest()}


def node_matrix(n):
    if 'matrix' in n:
        m = n['matrix']  # column-major
        return [m[c * 4 + r] for r in range(4) for c in range(4)]  # row-major
    x, y, z, w = n.get('rotation', [0, 0, 0, 1])
    sx, sy, sz = n.get('scale', [1, 1, 1])
    tx, ty, tz = n.get('translation', [0, 0, 0])
    return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + w * z) * sx, 2 * (x * z - w * y) * sx, 0,
            2 * (x * y - w * z) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + w * x) * sy, 0,
            2 * (x * z + w * y) * sz, 2 * (y * z - w * x) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
            tx, ty, tz, 1]


def mat_mul(a, b):
    return [sum(a[i + 4 * k] * b[k + 4 * j] for k in range(4)) for j in range(4) for i in range(4)]


def xform(m, p):
    return tuple(m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i] for i in range(3))


def walk(g, idx, parent, out, depth=0):
    n = g['nodes'][idx]
    m = mat_mul(parent, node_matrix(n))
    out.append({'index': idx, 'name': n.get('name', ''), 'matrix': m, 'node': n, 'depth': depth})
    for c in n.get('children', []):
        walk(g, c, m, out, depth + 1)


def scene_nodes(g):
    return g.get('scenes', [{}])[g.get('scene', 0)].get('nodes', [])


def flat_nodes(g):
    out = []
    for r in scene_nodes(g):
        walk(g, r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], out)
    return out


def read_positions(g, blob, mesh_idx):
    acc = g['accessors']
    bv = g['bufferViews']
    pts = []
    for prim in g['meshes'][mesh_idx]['primitives']:
        a = acc[prim['attributes']['POSITION']]
        v = bv[a['bufferView']]
        off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        n = a['count']
        arr = struct.unpack_from('<%df' % (n * 3), blob, off)
        pts.append([tuple(arr[k * 3:k * 3 + 3]) for k in range(n)])
    return pts


def mesh_tris(g, mesh_idx):
    t = 0
    acc = g['accessors']
    for prim in g['meshes'][mesh_idx]['primitives']:
        if 'indices' in prim:
            t += acc[prim['indices']]['count'] // 3
        else:
            t += acc[prim['attributes']['POSITION']]['count'] // 3
    return t


def node_bounds(g, blob, nodes_flat):
    """world-space AABB over all mesh prims; None if no meshes."""
    lo = [1e9] * 3
    hi = [-1e9] * 3
    acc = g['accessors']
    for rec in nodes_flat:
        n = rec['node']
        if 'mesh' not in n:
            continue
        for prim in g['meshes'][n['mesh']]['primitives']:
            a = acc[prim['attributes']['POSITION']]
            for corner in product(*zip(a['min'], a['max'])):
                w = xform(rec['matrix'], corner)
                for i in range(3):
                    lo[i] = min(lo[i], w[i])
                    hi[i] = max(hi[i], w[i])
    if lo[0] > 1e8:
        return None
    return {'min': lo, 'max': hi, 'size': [hi[i] - lo[i] for i in range(3)]}


def images_info(g):
    bv = g.get('bufferViews', [])
    out = []
    for im in g.get('images', []):
        if 'bufferView' in im:
            v = bv[im['bufferView']]
            out.append({'name': im.get('name'), 'mime': im.get('mimeType'),
                        'bytes': v['byteLength']})
    return out


def outward_share(g, blob, mesh_idx, center=None):
    """fraction of triangles whose normal points away from `center` (bounds centre default)."""
    groups = read_positions(g, blob, mesh_idx)
    acc = g['accessors']
    allpts = [p for grp in groups for p in grp]
    if center is None:
        xs = [p[0] for p in allpts]
        ys = [p[1] for p in allpts]
        zs = [p[2] for p in allpts]
        center = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2)
    good = total = 0
    for pi, prim in enumerate(g['meshes'][mesh_idx]['primitives']):
        pts = groups[pi]
        if 'indices' in prim:
            a = acc[prim['indices']]
            v = g['bufferViews'][a['bufferView']]
            off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
            n = a['count']
            if a['componentType'] == 5123:
                idx = struct.unpack_from('<%dH' % n, blob, off)
            elif a['componentType'] == 5125:
                idx = struct.unpack_from('<%dI' % n, blob, off)
            elif a['componentType'] == 5121:
                idx = struct.unpack_from('<%dB' % n, blob, off)
            else:
                raise ValueError('index componentType %d' % a['componentType'])
        else:
            idx = range(len(pts))
        for t in range(0, len(idx), 3):
            a, b, c = pts[idx[t]], pts[idx[t + 1]], pts[idx[t + 2]]
            u = tuple(b[i] - a[i] for i in range(3))
            v = tuple(c[i] - a[i] for i in range(3))
            nrm = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
            nm = sum(x * x for x in nrm) ** .5
            if nm < 1e-10:      # skip degenerate slivers: sign is meaningless
                continue
            cen = tuple((a[i] + b[i] + c[i]) / 3 for i in range(3))
            d = sum(nrm[i] * (cen[i] - center[i]) for i in range(3))
            total += 1
            good += 1 if d > 0 else 0
    return good / max(total, 1)


def outward_share_ray(g, blob, mesh_idx, samples=400):
    """Ray-cast outward test for closed meshes: a triangle faces outward iff a ray from
    its centroid along +normal escapes the mesh (0 further intersections)."""
    import random as _r
    groups = read_positions(g, blob, mesh_idx)
    acc = g['accessors']
    tris = []
    for pi, prim in enumerate(g['meshes'][mesh_idx]['primitives']):
        pts = groups[pi]
        if 'indices' in prim:
            a = acc[prim['indices']]
            v = g['bufferViews'][a['bufferView']]
            off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
            n = a['count']
            if a['componentType'] == 5123:
                idx = struct.unpack_from('<%dH' % n, blob, off)
            elif a['componentType'] == 5125:
                idx = struct.unpack_from('<%dI' % n, blob, off)
            else:
                idx = struct.unpack_from('<%dB' % n, blob, off)
        else:
            idx = range(len(pts))
        for t in range(0, len(idx), 3):
            tris.append((pts[idx[t]], pts[idx[t + 1]], pts[idx[t + 2]]))
    rng = _r.Random(7)
    idxs = list(range(len(tris)))
    rng.shuffle(idxs)
    idxs = idxs[:samples]
    eps = 1e-5
    good = 0
    for ti in idxs:
        A, B, C = tris[ti]
        u = tuple(B[i] - A[i] for i in range(3))
        v = tuple(C[i] - A[i] for i in range(3))
        n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
        nm = sum(x * x for x in n) ** .5
        if nm < 1e-14:
            continue
        dn = tuple(x / nm for x in n)
        o = tuple((A[i] + B[i] + C[i]) / 3 + dn[i] * eps for i in range(3))
        d = dn
        hits = 0
        for tj, (P0, P1, P2) in enumerate(tris):
            if tj == ti:
                continue
            e1 = tuple(P1[i] - P0[i] for i in range(3))
            e2 = tuple(P2[i] - P0[i] for i in range(3))
            pv = (d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0])
            det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2]
            if abs(det) < 1e-14:
                continue
            inv = 1 / det
            tv = tuple(o[i] - P0[i] for i in range(3))
            uu = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) * inv
            if uu < -1e-9 or uu > 1 + 1e-9:
                continue
            qv = (tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0])
            vv = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) * inv
            if vv < -1e-9 or uu + vv > 1 + 1e-9:
                continue
            tt = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) * inv
            if tt > 1e-7:
                hits += 1
        if hits == 0:
            good += 1
    return good / max(len(idxs), 1)
