#!/usr/bin/env python3
"""Lane-A survey measurements from the real v5 rendered assembly (96b6690).

Reads the v5 candidate world exactly as the client renders it:
  - world/fangbang-temple-v5/street-reviewed-lanes.glb   (assembly, node matrices)
  - world/lanes-v2/lane-a/model.glb                      (local frame -> holder T/R)
  - world/lanes-v2/interfaces/model.glb                  (world-authored, identity)
and the production collision sets:
  - world/fangbang-temple-v5/collision-world.json        (790 wall records)
  - world/lanes-v2/{lane-a,interfaces}/collision.json    (world-space sidecars)

Outputs (artifacts/lane-a-polish/survey/):
  measure_sections.json — cross-sections, visible-face vs collider deviations,
                          ground coverage raster summary, A_PTS check
  sections_topview.svg  — top-view illustration drawn from measured triangles

Read-only on assets; no browser, no construction.
"""
import json
import struct
import sys
from pathlib import Path

WS = Path(__file__).resolve().parents[1]
OUT = WS / 'artifacts' / 'lane-a-polish' / 'survey'

# ---------------------------------------------------------------- GLB parsing
def read_glb(path):
    data = Path(path).read_bytes()
    off = 12
    clen, ctype = struct.unpack_from('<II', data, off)
    assert ctype == 0x4E4F534A
    js = json.loads(data[off + 8:off + 8 + clen])
    bin_chunk = None
    off += 8 + clen
    while off < len(data):
        l, t = struct.unpack_from('<II', data, off)
        if t == 0x004E4942:
            bin_chunk = data[off + 8:off + 8 + l]
        off += 8 + l
    return js, bin_chunk


def accessor_reader(js, bin_chunk):
    def read_acc(idx):
        acc = js['accessors'][idx]
        bv = js['bufferViews'][acc['bufferView']]
        comp = {5126: 'f', 5123: 'H', 5125: 'I'}[acc['componentType']]
        ncomp = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[acc['type']]
        base = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
        stride = bv.get('byteStride', 0) or (struct.calcsize(comp) * ncomp)
        count = acc['count']
        out = []
        for i in range(count):
            o = base + i * stride
            out.append(struct.unpack_from('<' + comp * ncomp, bin_chunk, o))
        return out
    return read_acc


def mat_mul(a, b):
    """column-major 4x4 multiply: result = a @ b (applies b first)."""
    r = [0.0] * 16
    for c in range(4):
        for rr in range(4):
            s = 0.0
            for k in range(4):
                s += a[k * 4 + rr] * b[c * 4 + k]
            r[c * 4 + rr] = s
    return r


def trs_matrix(n):
    """glTF node TRS -> column-major 4x4 (Y-up)."""
    if 'matrix' in n:
        return list(n['matrix'])
    t = n.get('translation', [0, 0, 0])
    q = n.get('rotation', [0, 0, 0, 1])
    s = n.get('scale', [1, 1, 1])
    x, y, z, w = q
    x2, y2, z2 = x + x, y + y, z + z
    xx, yy, zz = x * x2, y * y2, z * z2
    xy, yz, zx = x * y2, y * z2, z * x2
    wx, wy, wz = w * x2, w * y2, w * z2
    # column-major rotation+scale
    m = [0.0] * 16
    m[0] = (1 - (yy + zz)) * s[0]; m[1] = (xy + wz) * s[0]; m[2] = (zx - wy) * s[0]
    m[4] = (xy - wz) * s[1]; m[5] = (1 - (xx + zz)) * s[1]; m[6] = (yz + wx) * s[1]
    m[8] = (zx + wy) * s[2]; m[9] = (yz - wx) * s[2]; m[10] = (1 - (xx + yy)) * s[2]
    m[12], m[13], m[14] = t[0], t[1], t[2]
    m[15] = 1.0
    return m


def mat_apply(m, p):
    x, y, z = p
    return (m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14])


def collect_tris(glb_path, frame=None, name_filter=None):
    """-> list of dicts {node, verts:[(x,y,z)x3], n:(nx,ny,nz), bbox}
    frame: optional extra column-major 4x4 applied on top of the scene (the
    runtime holder transform for block assets authored in a local frame)."""
    js, bc = read_glb(glb_path)
    rd = accessor_reader(js, bc)
    ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    root_m = frame if frame is not None else ident
    out = []

    def walk(ni, parent_m):
        n = js['nodes'][ni]
        m = mat_mul(parent_m, trs_matrix(n))
        if 'mesh' in n and (name_filter is None or name_filter(n.get('name', ''))):
            mesh = js['meshes'][n['mesh']]
            for prim in mesh['primitives']:
                pos = rd(prim['attributes']['POSITION'])
                idx = rd(prim['indices']) if 'indices' in prim else None
                tris = [(idx[i][0], idx[i + 1][0], idx[i + 2][0]) for i in range(0, len(idx), 3)] \
                    if idx else [(i, i + 1, i + 2) for i in range(0, len(pos), 3)]
                for a, b, c in tris:
                    va, vb, vc = mat_apply(m, pos[a]), mat_apply(m, pos[b]), mat_apply(m, pos[c])
                    ux, uy, uz = vb[0] - va[0], vb[1] - va[1], vb[2] - va[2]
                    vx, vy, vz = vc[0] - va[0], vc[1] - va[1], vc[2] - va[2]
                    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
                    ln = (nx * nx + ny * ny + nz * nz) ** 0.5 or 1.0
                    xs = (va[0], vb[0], vc[0]); ys = (va[1], vb[1], vc[1]); zs = (va[2], vb[2], vc[2])
                    out.append({'node': n.get('name', '?'),
                                'verts': (va, vb, vc),
                                'n': (nx / ln, ny / ln, nz / ln),
                                'bbox': (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs))})
        for ch in n.get('children', []):
            walk(ch, m)

    for ri in js['scenes'][js.get('scene', 0)]['nodes']:
        walk(ri, root_m)
    return out


# ------------------------------------------------------------- plane sampling
def tri_crosses_z(t, z, ylo=None, yhi=None):
    x0, y0, z0, x1, y1, z1 = t['bbox']
    if not (z0 <= z <= z1):
        return None
    v = t['verts']
    pts = []
    for i in range(3):
        a, b = v[i], v[(i + 1) % 3]
        if (a[2] - z) * (b[2] - z) <= 0 and a[2] != b[2]:
            s = (z - a[2]) / (b[2] - a[2])
            pts.append((a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1])))
    if len(pts) < 2:
        return None
    pts = sorted(set(pts))
    if len(pts) < 2:
        return None
    x0i, x1i = pts[0][0], pts[-1][0]
    yy0 = min(p[1] for p in pts); yy1 = max(p[1] for p in pts)
    if ylo is not None and yy1 < ylo:
        return None
    if yhi is not None and yy0 > yhi:
        return None
    return (x0i, x1i, yy0, yy1)


def merge_intervals(ivs, gap=0.02):
    ivs = sorted(ivs)
    out = []
    for a, b in ivs:
        if out and a <= out[-1][1] + gap:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def collider_x_at_z(rec, z):
    """Exact x-range of an oriented box where the z-plane cuts it; None if no cut."""
    if rec.get('obb'):
        import math
        o = rec['obb']
        c, s = math.cos(o['theta']), math.sin(o['theta'])
        cx, cy, cz = o['center'][0], o['center'][1], o['center'][2]
        hx, hy, hz = o['size'][0] / 2, o['size'][1] / 2, o['size'][2] / 2
        pos = o['pos']
    else:
        mn, mx = rec['min'], rec['max']
        if not (mn[2] <= z <= mx[2]):
            return None
        return [mn[0], mx[0], mn[1], mx[1]]
    pts = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                lx, ly, lz = cx + sx * hx, cy + sy * hy, cz + sz * hz
                pts.append((pos[0] + c * lx + s * lz, ly + pos[1], pos[2] - s * lx + c * lz))
    xs = []
    for i in range(8):
        for j in range(i + 1, 8):
            a, b = pts[i], pts[j]
            if (a[2] - z) * (b[2] - z) <= 0 and a[2] != b[2]:
                t = (z - a[2]) / (b[2] - a[2])
                xs.append(a[0] + t * (b[0] - a[0]))
            elif a[2] == b[2] == z:
                xs.extend([a[0], b[0]])
    if not xs:
        return None
    return [min(xs), max(xs), min(p[1] for p in pts), max(p[1] for p in pts)]


# ------------------------------------------------------------------- analysis
LANE = dict(x=(37.0, 49.0), z=(-26.0, -7.0))  # survey window
SECTION_Z = [(-10.60, 'street mouth 街口'),
             (-13.40, 'mid connection 连接中段'),
             (-16.375, 'portal 门洞'),
             (-19.50, 'inside lane 弄内'),
             (-23.00, 'lane end vicinity 尽端附近')]


def in_lane(t):
    x0, y0, z0, x1, y1, z1 = t['bbox']
    return not (x1 < LANE['x'][0] or x0 > LANE['x'][1] or z1 < LANE['z'][0] or z0 > LANE['z'][1])


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    print('parsing v5 assembly GLB ...', file=sys.stderr)
    asm = collect_tris(WS / 'world' / 'fangbang-temple-v5' / 'street-reviewed-lanes.glb',
                       name_filter=lambda nm: nm.startswith(('N05-restaurant-a', 'N06-curio-a', 'street-kit__')))
    asm = [t for t in asm if in_lane(t)]
    print(f'  assembly tris in lane window: {len(asm)}', file=sys.stderr)

    print('parsing lane-a module GLB ...', file=sys.stderr)
    import math
    yaw = 3.1165
    c, s = math.cos(yaw), math.sin(yaw)
    T = [43.545, 0.09, -16.375]
    holder = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, T[0], T[1], T[2], 1]
    la = collect_tris(WS / 'world' / 'lanes-v2' / 'lane-a' / 'model.glb', frame=holder)
    print(f'  lane-a tris: {len(la)}', file=sys.stderr)

    ifc = collect_tris(WS / 'world' / 'lanes-v2' / 'interfaces' / 'model.glb')
    ifc_a = [t for t in ifc if in_lane(t)]
    print(f'  interfaces tris in lane window: {len(ifc_a)}', file=sys.stderr)

    v5col = json.loads((WS / 'world' / 'fangbang-temple-v5' / 'collision-world.json').read_text())
    sideA = json.loads((WS / 'world' / 'lanes-v2' / 'lane-a' / 'collision.json').read_text())
    sideI = json.loads((WS / 'world' / 'lanes-v2' / 'interfaces' / 'collision.json').read_text())
    all_col = (v5col['colliders'] + sideA['colliders'] + sideI['colliders'])

    vis = {'assembly': asm, 'lane-a': la, 'interfaces': ifc_a}

    # ---- 1. cross-sections -------------------------------------------------
    sections = []
    for z, label in SECTION_Z:
        ground, walls = [], []
        for src, tris in vis.items():
            for t in tris:
                cr = tri_crosses_z(t, z)
                if cr is None:
                    continue
                x0, x1, yy0, yy1 = cr
                if abs(t['n'][1]) > 0.6 and -0.10 <= yy0 <= 0.6:
                    ground.append({'src': src, 'node': t['node'], 'x0': round(x0, 3), 'x1': round(x1, 3),
                                   'y': round(yy0, 3)})
                elif abs(t['n'][1]) <= 0.6 and yy0 < 2.45 and yy1 > 0.05:
                    walls.append({'src': src, 'node': t['node'], 'x0': round(x0, 3), 'x1': round(x1, 3),
                                  'y0': round(yy0, 3), 'y1': round(yy1, 3)})
        cols = []
        for rec in all_col:
            cx = collider_x_at_z(rec, z)
            if cx:
                cols.append({'name': rec['name'], 'x0': round(cx[0], 3), 'x1': round(cx[1], 3),
                             'y0': round(cx[2], 2), 'y1': round(cx[3], 2)})
        sections.append({'z': z, 'label': label, 'ground': ground, 'walls': walls, 'colliders': cols})

    # ---- 2. N05 east / N06 west visible face lines vs colliders ------------
    face = []
    z = -9.9
    while z >= -16.9:
        n05_max, n06_min = None, None
        for t in asm:
            if not t['node'].startswith(('N05', 'N06')):
                continue
            cr = tri_crosses_z(t, round(z, 2), ylo=0.15, yhi=2.30)
            if cr is None:
                continue
            if t['node'].startswith('N05'):
                n05_max = cr[1] if n05_max is None else max(n05_max, cr[1])
            else:
                n06_min = cr[0] if n06_min is None else min(n06_min, cr[0])
        n05col = collider_x_at_z(next(r for r in v5col['colliders'] if r['name'] == 'N05-restaurant-a:right-side'), round(z, 2))
        n06col = collider_x_at_z(next(r for r in v5col['colliders'] if r['name'] == 'N06-curio-a:left-side'), round(z, 2))
        face.append({'z': round(z, 2), 'n05_vis_max_x': n05_max and round(n05_max, 3),
                     'n05_col_min_x': n05col and round(n05col[0], 3),
                     'n06_vis_min_x': n06_min and round(n06_min, 3),
                     'n06_col_max_x': n06col and round(n06col[1], 3)})
        z -= 0.2

    # ---- 3. ground raster (what surface covers the lane footprint) ---------
    ground_whitelist = ['street-kit__quiet-gray-asphalt', 'street-kit__paving-frontage',
                        'street-kit__worn-stone', 'lanes-v2__paving-frontage',
                        'lanes-v2__worn-stone']
    ground_all = {k: [] for k in ground_whitelist}
    ground_all['other'] = []
    for src, tris in vis.items():
        for t in tris:
            if abs(t['n'][1]) > 0.6 and -0.15 <= t['bbox'][1] <= 0.7:
                nm = t['node']
                k = nm if nm in ground_all else 'other'
                ground_all[k].append(t)
                t['kind'] = k if k != 'other' else nm
    RASTER = []
    x = 39.0
    while x <= 46.01:
        z = -25.0
        while z <= -8.99:
            top = None
            for k, tris in ground_all.items():
                for t in tris:
                    cr = tri_crosses_z(t, round(z, 3))
                    if cr and cr[0] - 1e-6 <= x <= cr[1] + 1e-6 and -0.15 <= cr[2] <= 0.8:
                        ytop = cr[2]
                        if top is None or ytop > top[0]:
                            top = (ytop, t.get('kind', k))
            RASTER.append((round(x, 2), round(z, 2), top[0] if top else None, top[1] if top else 'VOID'))
            z += 0.10
        x += 0.10

    # summarize raster: for each z-row the runs of coverage kind
    raster_rows = []
    xs = sorted({r[0] for r in RASTER})
    zs = sorted({r[1] for r in RASTER})
    kinds = {}
    for xx, zz, y, k in RASTER:
        kinds[(xx, zz)] = (k, y)
    for zz in zs:
        runs = []
        for xx in xs:
            k, y = kinds[(xx, zz)]
            if runs and runs[-1][2] == k and abs(xx - runs[-1][1]) < 0.11:
                runs[-1][1] = xx
            else:
                runs.append([xx, xx, k])
        raster_rows.append({'z': zz, 'runs': [{'x0': a, 'x1': b, 'kind': k} for a, b, k in runs]})    # ---- 4. lane-a module stone vs gray split (world) ----------------------
    la_floor = {}
    for t in la:
        if abs(t['n'][1]) > 0.6:
            nm = t['node']
            bb = t['bbox']
            e = la_floor.setdefault(nm, [1e9, -1e9, 1e9, -1e9])
            e[0] = min(e[0], bb[0]); e[1] = max(e[1], bb[3])
            e[2] = min(e[2], bb[2]); e[3] = max(e[3], bb[5])
    la_floor = {k: [round(v, 3) for v in vv] for k, vv in la_floor.items()}

    # ---- 5. interfaces a-floor polygon (A_PTS ground truth from GLB) -------
    afloor_verts = set()
    for t in ifc:
        if t['node'] == 'lanes-v2__paving-frontage':
            for v in t['verts']:
                afloor_verts.add((round(v[0], 3), round(v[2], 3)))
    a_pts_actual = sorted(afloor_verts)

    result = {
        'sources': {
            'assembly': 'world/fangbang-temple-v5/street-reviewed-lanes.glb',
            'laneA': 'world/lanes-v2/lane-a/model.glb placed by holder T=[43.545,0.09,-16.375] yaw=3.1165 (blocks.json block-lanes-v2)',
            'interfaces': 'world/lanes-v2/interfaces/model.glb (identity, world-authored)',
            'collision': ['world/fangbang-temple-v5/collision-world.json',
                          'world/lanes-v2/lane-a/collision.json',
                          'world/lanes-v2/interfaces/collision.json'],
        },
        'sections': sections,
        'faceLines': face,
        'rasterRows': raster_rows,
        'laneAFloorNodeBounds': la_floor,
        'interfacesAFloorVertices': a_pts_actual,
    }
    (OUT / 'measure_sections.json').write_text(json.dumps(result, indent=1))
    print(f'wrote {OUT / "measure_sections.json"}', file=sys.stderr)

    # ---- 6. top-view SVG illustration from measured triangles --------------
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="1400" font-family="monospace">',
           '<rect width="1100" height="1400" fill="#ffffff"/>']
    # north = -z up. map world: px = (x-38)*40, py = (z+27)*40  -> x 38..47.5 -> 0..380... use 120 px/m? too big; use 40px/m over window x 37..49 (480px), z -26..-7 (760px)
    def px(x): return 40 + (x - 37.0) * 80
    def py(z): return 40 + (z + 26.0) * 80
    colors = {'street-kit__quiet-gray-asphalt': '#b9bcc0', 'street-kit__paving-frontage': '#9aa39b',
              'street-kit__worn-stone': '#c9b98a', 'lanes-v2__paving-frontage': '#8fb0c9',
              'lanes-v2__worn-stone': '#d9c46a'}
    # raster cells
    for xx, zz, y, k in RASTER:
        if k == 'VOID':
            col = '#ffffff'
        elif k in colors:
            col = colors[k]
        elif k.startswith('N05'):
            col = '#e8c9a0'
        elif k.startswith('N06'):
            col = '#d8b890'
        else:
            col = '#cccccc'
        svg.append(f'<rect x="{px(xx - 0.05):.1f}" y="{py(zz - 0.05):.1f}" width="80" height="80" fill="{col}" fill-opacity="0.85"/>')
    # building visible tris above ground (walls) as outlines: N05/N06 vertical faces
    for t in asm:
        if not t['node'].startswith(('N05', 'N06')):
            continue
        x0, y0, z0, x1, y1, z1 = t['bbox']
        if y1 < 0.2 or abs(t['n'][1]) > 0.6:
            continue
        if not in_lane(t):
            continue
        pts = ' '.join(f'{px(v[0]):.1f},{py(v[2]):.1f}' for v in t['verts'])
        svg.append(f'<polygon points="{pts}" fill="none" stroke="#333" stroke-width="0.6" stroke-opacity="0.5"/>')
    # colliders (production + sidecars) dashed red
    import math as _m
    for rec in all_col:
        cc = collider_x_at_z(rec, -16.0)
        if rec.get('obb'):
            o = rec['obb']; c_, s_ = _m.cos(o['theta']), _m.sin(o['theta'])
            h = [o['size'][0] / 2, o['size'][2] / 2]
            cxw = o['pos'][0] + c_ * o['center'][0] + s_ * o['center'][2]
            czw = o['pos'][2] - s_ * o['center'][0] + c_ * o['center'][2]
            corners = []
            for sx in (-1, 1):
                for sz in (-1, 1):
                    lx, lz = o['center'][0] + sx * h[0], o['center'][2] + sz * h[1]
                    corners.append((o['pos'][0] + c_ * lx + s_ * lz, o['pos'][2] - s_ * lx + c_ * lz))
        else:
            mn, mx = rec['min'], rec['max']
            corners = [(mn[0], mn[2]), (mx[0], mn[2]), (mx[0], mx[2]), (mn[0], mx[2])]
        nmm = rec['name']
        if not any((px(a) > 20 and px(a) < 1080 and py(b) > 20 and py(b) < 1380) for a, b in corners):
            continue
        ptsc = ' '.join(f'{px(a):.1f},{py(b):.1f}' for a, b in corners)
        col = '#e03030' if nmm.startswith(('N05', 'N06')) else '#2060e0'
        svg.append(f'<polygon points="{ptsc}" fill="none" stroke="{col}" stroke-width="1.1" stroke-dasharray="5,3" stroke-opacity="0.9"/>')
    # section lines
    for z, label in SECTION_Z:
        svg.append(f'<line x1="{px(37.2)}" y1="{py(z)}" x2="{px(48.8)}" y2="{py(z)}" stroke="#00a000" stroke-width="1.2"/>')
        svg.append(f'<text x="{px(44.2)}" y="{py(z) - 4:.1f}" font-size="14" fill="#006000">{label} z={z}</text>')
    svg.append('<text x="40" y="1390" font-size="13">ground raster from measured triangles; red dash = street colliders (N05/N06), blue dash = lane sidecar colliders; green = sections</text>')
    svg.append('</svg>')
    (OUT / 'sections_topview.svg').write_text('\n'.join(svg))
    print(f'wrote {OUT / "sections_topview.svg"}', file=sys.stderr)


if __name__ == '__main__':
    main()
