#!/usr/bin/env python3
"""GLB geometric-equivalence proof (fallback #6 caliber).

Bytes may differ across Blender builds (bevel corner welding ±2-4 verts,
see temple-expansion-night memory). This compares the thing that matters:
per-mesh primitive counts, POSITION accessor min/max, and total vertex /
triangle counts. Usage:
  python3 kit/compare_glb_geometry.py <delivered.glb> <rerun.glb> [--out proof.json]
Exit 0 = geometrically equivalent.
"""
import json
import struct
import sys


def read_glb(path):
    data = open(path, 'rb').read()
    assert data[:4] == b'glTF', path
    length = struct.unpack('<I', data[8:12])[0]
    off = 12
    js = None
    bin_chunk = b''
    while off < length:
        clen, ctype = struct.unpack('<II', data[off:off + 8])
        chunk = data[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode('utf-8'))
        elif ctype == 0x004E4942:
            bin_chunk = chunk
        off += 8 + clen
    return js, bin_chunk


_COMPONENT = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2),
              5125: ('I', 4), 5126: ('f', 4)}
_NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def accessors(js, bin_chunk):
    out = []
    for acc in js['accessors']:
        comp, size = _COMPONENT[acc['componentType']]
        n = _NCOMP[acc['type']]
        bv = js['bufferViews'][acc['bufferView']]
        start = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
        count = acc['count'] * n
        vals = struct.unpack_from(f'<{count}{comp}', bin_chunk, start)
        out.append({'count': acc['count'], 'type': acc['type'], 'vals': vals})
    return out


def summarize(path):
    js, bin_chunk = read_glb(path)
    accs = accessors(js, bin_chunk)
    prims = tris = verts = 0
    mins, maxs = [], []
    for mesh in js['meshes']:
        for prim in mesh['primitives']:
            prims += 1
            mode = prim.get('mode', 4)
            assert mode == 4, f'non-triangles mode {mode} in {path}'
            pos_acc = accs[prim['attributes']['POSITION']]
            verts += pos_acc['count']
            idx = accs[prim['indices']]
            tris += idx['count'] // 3
            mins.append(pos_acc['vals'][0::3] and min(pos_acc['vals'][0::3]))
            maxs.append(max(pos_acc['vals'][0::3]))
    return {'path': path, 'meshes': len(js['meshes']), 'primitives': prims,
            'vertices': verts, 'triangles': tris,
            'materials': [m.get('name') for m in js.get('materials', [])]}


def pos_bounds(path):
    js, bin_chunk = read_glb(path)
    accs = accessors(js, bin_chunk)
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for mesh in js['meshes']:
        for prim in mesh['primitives']:
            acc = accs[prim['attributes']['POSITION']]
            v = acc['vals']
            xs, ys, zs = v[0::3], v[1::3], v[2::3]
            for k, series in enumerate((xs, ys, zs)):
                lo[k] = min(lo[k], min(series))
                hi[k] = max(hi[k], max(series))
    return lo, hi


def main():
    a_path, b_path = sys.argv[1], sys.argv[2]
    out_path = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else None
    A, B = summarize(a_path), summarize(b_path)
    la, ha = pos_bounds(a_path)
    lb, hb = pos_bounds(b_path)
    checks = {
        'primitives_equal': A['primitives'] == B['primitives'],
        'triangles_equal': A['triangles'] == B['triangles'],
        'vertex_count_within_weld_tolerance': abs(A['vertices'] - B['vertices']) <= 4,
        'materials_equal': A['materials'] == B['materials'],
        'bounds_within_1e-4': all(abs(la[k] - lb[k]) <= 1e-4 and abs(ha[k] - hb[k]) <= 1e-4
                                  for k in range(3)),
    }
    proof = {'delivered': A, 'rerun': B, 'boundsDelivered': [la, ha],
             'boundsRerun': [lb, hb], 'checks': checks,
             'equivalent': all(checks.values()),
             'caliber': 'fallback #6: tris/prims/materials equal, verts +-4 (weld), bounds 1e-4'}
    print(json.dumps(proof, indent=2))
    if out_path:
        open(out_path, 'w', encoding='utf-8').write(json.dumps(proof, indent=2) + '\n')
    sys.exit(0 if proof['equivalent'] else 1)


if __name__ == '__main__':
    main()
