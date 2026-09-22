#!/usr/bin/env python3
"""Inspect GLB 2.0 storage budgets; use glTF Validator separately for full validity."""
import argparse, hashlib, json, struct
from itertools import product
from pathlib import Path


def image_size(data):
    if data[:8] == b'\x89PNG\r\n\x1a\n' and len(data) >= 24:
        return list(struct.unpack_from('>II', data, 16))
    if data[:2] != b'\xff\xd8':
        return None
    p = 2
    while p + 4 <= len(data):
        if data[p] != 255:
            p += 1
            continue
        while p < len(data) and data[p] == 255:
            p += 1
        if p >= len(data):
            break
        marker = data[p]; p += 1
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            continue
        if marker == 0xDA or p + 2 > len(data):
            break
        length = struct.unpack_from('>H', data, p)[0]
        if length < 2 or p + length > len(data):
            break
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF) and length >= 7:
            height, width = struct.unpack_from('>HH', data, p + 3)
            return [width, height]
        p += length
    return None


def inspect(path):
    data = Path(path).read_bytes()
    if len(data) < 20:
        raise ValueError('Truncated GLB header')
    magic, version, declared = struct.unpack_from('<III', data)
    if magic != 0x46546C67 or version != 2 or declared != len(data):
        raise ValueError('Invalid GLB magic, version, or declared length')
    chunks = []; offset = 12
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError('Truncated chunk header')
        length, kind = struct.unpack_from('<II', data, offset); offset += 8
        if length % 4 or offset + length > len(data):
            raise ValueError('Invalid chunk length or alignment')
        chunks.append((kind, data[offset:offset + length])); offset += length
    if not chunks or chunks[0][0] != 0x4E4F534A:
        raise ValueError('First chunk must be JSON')
    g = json.loads(chunks[0][1]); binary = next((b for k, b in chunks if k == 0x004E4942), b'')
    views = g.get('bufferViews', []); accessors = g.get('accessors', [])
    for v in views:
        if v.get('buffer', 0) == 0 and not g.get('buffers', [{}])[0].get('uri'):
            if v.get('byteOffset', 0) < 0 or v.get('byteOffset', 0) + v['byteLength'] > len(binary):
                raise ValueError('Buffer view exceeds BIN chunk')
    primitives = []; per_mesh = []
    for mi, mesh in enumerate(g.get('meshes', [])):
        count = 0
        for pi, prim in enumerate(mesh.get('primitives', [])):
            attrs = prim.get('attributes', {})
            vertex_count = accessors[attrs['POSITION']]['count'] if 'POSITION' in attrs else 0
            elements = accessors[prim['indices']]['count'] if 'indices' in prim else vertex_count
            tri = elements // 3 if prim.get('mode', 4) == 4 else None
            count += tri or 0
            primitives.append({'mesh': mi, 'primitive': pi, 'material': prim.get('material'), 'triangles': tri, 'vertices': vertex_count, 'attributes': sorted(attrs)})
        per_mesh.append(count)
    nodes = g.get('nodes', [])
    identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    def node_matrix(n):
        if 'matrix' in n:
            return n['matrix']
        x, y, z, w = n.get('rotation', [0, 0, 0, 1])
        sx, sy, sz = n.get('scale', [1, 1, 1]); tx, ty, tz = n.get('translation', [0, 0, 0])
        return [(1-2*(y*y+z*z))*sx, 2*(x*y+w*z)*sx, 2*(x*z-w*y)*sx, 0,
                2*(x*y-w*z)*sy, (1-2*(x*x+z*z))*sy, 2*(y*z+w*x)*sy, 0,
                2*(x*z+w*y)*sz, 2*(y*z-w*x)*sz, (1-2*(x*x+y*y))*sz, 0,
                tx, ty, tz, 1]
    def multiply(a, b):
        return [sum(a[i+4*k]*b[k+4*j] for k in range(4)) for j in range(4) for i in range(4)]
    bound_points = []; bounds_incomplete = False
    def bounds_at(index, parent, ancestors):
        nonlocal bounds_incomplete
        if index in ancestors:
            raise ValueError('Scene node cycle')
        n = nodes[index]; matrix = multiply(parent, node_matrix(n))
        if 'EXT_mesh_gpu_instancing' in n.get('extensions', {}):
            bounds_incomplete = True
        if 'mesh' in n:
            for prim in g['meshes'][n['mesh']]['primitives']:
                a = accessors[prim['attributes']['POSITION']]
                if 'min' not in a or 'max' not in a:
                    bounds_incomplete = True
                    continue
                for x, y, z in product(*zip(a['min'], a['max'])):
                    bound_points.append([matrix[i]*x+matrix[4+i]*y+matrix[8+i]*z+matrix[12+i] for i in range(3)])
        for c in n.get('children', []):
            bounds_at(c, matrix, ancestors | {index})
    def placed(index, ancestors):
        if index in ancestors:
            raise ValueError('Scene node cycle')
        n = nodes[index]; own = per_mesh[n['mesh']] if 'mesh' in n else 0
        ext = n.get('extensions', {}).get('EXT_mesh_gpu_instancing', {})
        if own and ext.get('attributes'):
            own *= accessors[next(iter(ext['attributes'].values()))]['count']
        return own + sum(placed(c, ancestors | {index}) for c in n.get('children', []))
    default_scene = g.get('scene', 0)
    scene_tris = sum(placed(i, set()) for i in g.get('scenes', [{}])[default_scene].get('nodes', []))
    for i in g.get('scenes', [{}])[default_scene].get('nodes', []):
        bounds_at(i, identity, set())
    native_bounds = None
    if bound_points and not bounds_incomplete:
        lo = [min(p[i] for p in bound_points) for i in range(3)]
        hi = [max(p[i] for p in bound_points) for i in range(3)]
        native_bounds = {'min': lo, 'max': hi, 'size': [hi[i]-lo[i] for i in range(3)],
                         'method': 'glTF-native node transforms and accessor AABB corners; conservative for rotated geometry'}
    images = []; image_views = set(); geometry_views = {a['bufferView'] for a in accessors if 'bufferView' in a}
    for im in g.get('images', []):
        size = None; encoded = None
        if 'bufferView' in im:
            vi = im['bufferView']; v = views[vi]; image_views.add(vi)
            start = v.get('byteOffset', 0); encoded = v['byteLength']; size = image_size(binary[start:start + encoded])
        images.append({'name': im.get('name'), 'mime': im.get('mimeType'), 'size': size, 'encodedBytes': encoded, 'externalUri': im.get('uri')})
    return {'file': str(Path(path).resolve()), 'sha256': hashlib.sha256(data).hexdigest(), 'fileBytes': len(data),
            'storedTriangles': sum(per_mesh), 'defaultSceneTriangles': scene_tris, 'meshes': len(per_mesh),
            'gltfNativeBounds': native_bounds, 'boundsIncomplete': bounds_incomplete,
            'primitiveCount': len(primitives), 'materials': len(g.get('materials', [])),
            'imageEncodedBytes': sum(views[i]['byteLength'] for i in image_views),
            'accessorBufferViewBytes': sum(views[i]['byteLength'] for i in geometry_views),
            'images': images, 'primitives': primitives, 'extensionsUsed': g.get('extensionsUsed', []),
            'limits': 'Counts/storage inspection only; not full glTF validation, GPU memory, frame rate, collision or visual approval.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input'); parser.add_argument('--out')
    args = parser.parse_args()
    try:
        result = inspect(args.input)
    except (ValueError, KeyError, IndexError, OSError, struct.error) as exc:
        parser.exit(1, f'GLB inspection failed: {exc}\n')
    output = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if args.out:
        Path(args.out).write_text(output, encoding='utf-8')
    print(output, end='')
