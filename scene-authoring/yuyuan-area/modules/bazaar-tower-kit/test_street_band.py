"""商城大楼套件低处临街净空测试（bazaar-tower-kit，A2 工单新增）。

契约：行人范围 y<2.5 m 的临街披檐 / 店面廊等构件不得越出本楼 layout footprint 阻塞冻结的 3 m swept route
（baseline/commercial-route.pinned.json 的 5 条路线；判定口径与 scripts/check-commercial-route.py 完全一致：
walk.covers(路线折线.buffer(1.5, cap_style=2, join_style=2))）。本测试把范围收窄到单楼：该楼 GLB 在
y∈[0.15, 2.5] 投影带（scripts/check-route-glb.py 同口径：逐三角裁剪 + 凸包）的全部三角并入障碍后，
原本可通行的钉住路线 ribbon 若不再被 walk 覆盖 → FAIL，并列出越 footprint 且压 ribbon 的构件（GLB 节点名，
即 part__material）与 y 范围。高于 2.5 m 的出檐（腰檐 / 主屋面）不进投影带，不受本测试影响。

纯 Python3（无 Blender；shapely 走 .python-deps）。GLB 只读 out-bazaar-towers/<id>/model.glb；
footprint / 路线 / 锚点只认 baseline/layout.json 与 baseline/commercial-route.pinned.json。
模块 GLB 未构建时该楼 SKIP（exit 0）；STRICT=1 时缺失判 FAIL。

用法：python3 -X utf8 modules/bazaar-tower-kit/test_street_band.py [--id bld-428202606 | --all] [STRICT=1]
"""
import json, math, os, struct, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]                                           # scene-authoring/yuyuan-area
sys.path.insert(0, str(ROOT / '.python-deps'))
import shapely                                                   # noqa: E402
from shapely.geometry import LineString, Point, Polygon          # noqa: E402
from shapely.ops import unary_union                              # noqa: E402

ARGS = sys.argv[1:]
def arg(flag, default):
    return ARGS[ARGS.index(flag) + 1] if flag in ARGS else default

ALL = '--all' in ARGS
STRICT = os.environ.get('STRICT') == '1'
BAND_LO, BAND_HI = 0.15, 2.5                                     # check-route-glb.py heightRangeM
RIBBON_M = 1.5                                                   # check-commercial-route.py ribbon_ok

LAYOUT = json.load(open(ROOT / 'baseline' / 'layout.json', encoding='utf-8'))
PIN = json.load(open(ROOT / 'baseline' / 'commercial-route.pinned.json', encoding='utf-8'))
AREA = shapely.geometry.box(-300, -280, 85, 65)                  # check-commercial-route.py area

REG = json.load(open(HERE / 'ids.json', encoding='utf-8'))
ids = sorted(os.path.join(HERE, 'params', f) for f in os.listdir(HERE / 'params') if f.endswith('.json')) \
    if ALL else [REG.get('params', {}).get(arg('--id', '')) or next(
        'params/' + f for f in sorted(os.listdir(HERE / 'params')) if f.endswith(arg('--id', '') + '.json'))]

pass_n = fail_n = skip_n = 0
failures = []
def ok(name, cond, detail=''):
    global pass_n, fail_n
    if cond:
        pass_n += 1
        print('PASS', name)
    else:
        fail_n += 1
        failures.append('%s: %s' % (name, detail))
        print('FAIL', name, detail)
def skip(name, why):
    global skip_n
    skip_n += 1
    print('SKIP', name, '-', why)

def footprint_of(tid):
    obj = next(o for o in LAYOUT['objects'] if o['id'] == tid)
    fp = [list(q) for q in obj['geometry']['footprint']]
    return fp[:-1] if fp[0] == fp[-1] else fp

# ---------- 公共底图：repair-layout 处理后的 layout（通行老街切 groundFootprints、路面 surfaceFootprint） ----------
def repaired_layout():
    if os.environ.get('OUT_DIR'):
        p = Path(os.environ['OUT_DIR']) / 'layout.json'
        if p.exists():
            return json.load(open(p, encoding='utf-8'))
    tmp = tempfile.mkdtemp(prefix='streetband-')
    env = dict(os.environ, OUT_DIR=tmp)
    r = subprocess.run([sys.executable, '-X', 'utf8', str(ROOT / 'scripts' / 'repair-layout.py')], env=env,
                       capture_output=True, text=True, cwd=str(ROOT))
    if r.returncode != 0:
        raise RuntimeError('repair-layout failed: ' + r.stderr[-500:])
    return json.load(open(Path(tmp) / 'layout.json', encoding='utf-8'))

def base_walk():
    LAYOUT2 = repaired_layout()
    surfaces, obstacles = [], []
    for o in LAYOUT2['objects']:
        g = o.get('geometry') or {}
        if o.get('skipRender'):
            continue
        if o['kind'] == 'road' and g.get('polyline'):
            surfaces.append(Polygon(g['surfaceFootprint']) if g.get('surfaceFootprint')
                            else LineString(g['polyline']).buffer(g['width'] / 2, cap_style=2, join_style=2))
        elif o['kind'] == 'plaza':
            surfaces.append(Polygon(g['footprint']).buffer(0))
        elif o['kind'] in ['outerBuilding', 'bazaarBlock', 'hall', 'tower', 'pavilion', 'xuan', 'waterside', 'watersideGallery', 'stage'] and g.get('footprint'):
            obstacles.extend(Polygon(fp).buffer(0) for fp in g.get('groundFootprints', [g['footprint']]))
        elif o['kind'] == 'water':
            obstacles.append(Polygon(g['footprint']).buffer(0))
        elif o['kind'] == 'wall' and g.get('segments'):
            obstacles.extend(LineString(s).buffer(.18) for s in g['segments'])
    return unary_union(surfaces).intersection(AREA).difference(unary_union(obstacles))

WALK = base_walk()

# ---------- GLB 三角世界坐标（y=高度；纯解析，同 test_tower.py 口径） ----------
def glb_triangles(path):
    buf = open(path, 'rb').read()
    jl = int.from_bytes(buf[12:16], 'little')
    j = json.loads(bytes(buf[20:20 + jl]))
    bl_off = 20 + jl
    bl = int.from_bytes(buf[bl_off:bl_off + 4], 'little')
    bin_ = buf[bl_off + 8:bl_off + 8 + bl]
    def accessor(ai):
        a = j['accessors'][ai]
        bv = j['bufferViews'][a['bufferView']]
        ct = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}[a['componentType']]
        nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        st = bv.get('byteStride') or nc * struct.calcsize(ct)
        return [struct.unpack_from('<' + ct * nc, bin_, off + i * st) for i in range(a['count'])]
    def node_matrix(n):
        if 'matrix' in n:
            m = n['matrix']
            return [[m[0], m[4], m[8], m[12]], [m[1], m[5], m[9], m[13]], [m[2], m[6], m[10], m[14]], [m[3], m[7], m[11], m[15]]]
        m = [[1.0 if i == k else 0.0 for k in range(4)] for i in range(4)]
        t, r, s = n.get('translation', (0, 0, 0)), n.get('rotation', (0, 0, 0, 1)), n.get('scale', (1, 1, 1))
        x, y, z, w = r
        rot = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
               [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
               [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
        for i in range(3):
            m[i] = [rot[i][k] * s[k] for k in range(3)] + [t[i]]
        return m
    def mul4(a, b):
        return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]
    def mulv(m, v):
        return tuple(sum(m[i][k] * v[k] for k in range(3)) + m[i][3] for i in range(3))
    def world_of(ni, m):
        n = j['nodes'][ni]
        m = mul4(m, node_matrix(n))
        out = []
        if 'mesh' in n:
            for p in j['meshes'][n['mesh']]['primitives']:
                pos = accessor(p['attributes']['POSITION'])
                idx = [t[0] for t in accessor(p['indices'])]
                nm = n.get('name') or j['meshes'][n['mesh']].get('name') or 'mesh'
                for k in range(0, len(idx), 3):
                    out.append((nm, tuple(mulv(m, pos[idx[k + t_]]) for t_ in range(3))))
        for c in n.get('children', []):
            out.extend(world_of(c, m))
        return out
    scenes = j['scenes'][j.get('scene', 0)]
    tris = []
    for ni in scenes['nodes']:
        tris.extend(world_of(ni, [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]))
    return tris

def band_projection(tris):
    """check-route-glb.py 口径：y∈[BAND_LO, BAND_HI] 的三角在两个水平面上裁剪后 ≥3 点 → 地图系多边形（附节点名与 y 范围）。"""
    out = []
    for name, tri in tris:
        ys = [p[1] for p in tri]
        if min(ys) > BAND_HI or max(ys) < BAND_LO:
            continue
        poly = list(tri)
        for level in (BAND_LO, BAND_HI):
            clipped = []
            n = len(poly)
            for i in range(n):
                a, b = poly[i], poly[(i + 1) % n]
                da, db = a[1] - level, b[1] - level
                if da * db < 0:
                    clipped.append(tuple(a[k] + (b[k] - a[k]) * da / (da - db) for k in range(3)))
                if da >= 0:
                    clipped.append(a)
            poly = clipped
        if len(poly) >= 3:
            out.append((name, min(ys), max(ys), [(p[0], p[2]) for p in poly]))
    return out

def point_in_poly(pt, poly):
    x, y = pt
    inside = False
    n = len(poly)
    for i in range(n):
        x0, z0 = poly[i]
        x1, z1 = poly[(i + 1) % n]
        if (z0 > y) != (z1 > y) and x < (x1 - x0) * (y - z0) / (z1 - z0) + x0:
            inside = not inside
    return inside

for prel in ids:
    P = json.load(open(HERE / prel, encoding='utf-8'))
    tid = P['id']
    glb = ROOT / 'out-bazaar-towers' / tid / 'model.glb'
    if not glb.exists():
        if STRICT:
            ok('street-band[%s]' % tid, False, 'GLB missing: %s' % glb)
        else:
            skip('street-band[%s]' % tid, 'GLB 未构建')
        continue
    fp = footprint_of(tid)
    fp_poly = Polygon(fp).buffer(0)
    polys = band_projection(glb_triangles(glb))
    tower_obs = [shapely.geometry.MultiPoint(pts).convex_hull.buffer(.015, join_style=2)
                 for _, _, _, pts in polys]                       # check-commercial-route.py 同口径的薄墙保留
    walk_t = WALK.difference(unary_union(tower_obs)) if tower_obs else WALK
    # 逐条钉住路线：单楼低处投影并入后 ribbon 是否仍被 walk 覆盖
    for r in PIN['routes']:
        a, b = r['from'], r['to']
        pts = [list(q) for q in r['points']]
        ribbon = LineString(pts).buffer(RIBBON_M, cap_style=2, join_style=2)
        base_ok = WALK.covers(ribbon)
        tower_ok = walk_t.covers(ribbon)
        if not base_ok:
            continue                                              # 底图本就不通（与该楼无关）
        ok('street-band[%s] %s->%s ribbon' % (tid, a, b), tower_ok,
           '低处 %.2f–%.2fm 投影阻断 3m swept ribbon' % (BAND_LO, BAND_HI))
        if base_ok and not tower_ok:
            seen = {}
            for name, ylo, yhi, pts2 in polys:
                hull = shapely.geometry.MultiPoint(pts2).convex_hull
                if hull.intersects(ribbon) and not fp_poly.covers(hull):
                    key = name
                    if key not in seen or ylo < seen[key][0]:
                        seen.setdefault(key, [ylo, yhi])
                    else:
                        seen[key][1] = max(seen[key][1], yhi)
                    bd = hull.bounds
                    print('  INTRUDE[%s] %s y=%.2f..%.2f bounds x[%.1f,%.1f] z[%.1f,%.1f]'
                          % (tid, name, ylo, yhi, bd[0], bd[2], bd[1], bd[3]))
            if not seen:
                print('  INTRUDE[%s] ribbon 破坏来自 footprint 内薄壁 / 缝隙效应（无数值越界构件）' % tid)

summary = '%d pass / %d fail / %d skip' % (pass_n, fail_n, skip_n)
print('STREET-BAND-TEST', summary)
if failures:
    print('FAILURES:')
    for f in failures:
        print(' -', f)
sys.exit(1 if fail_n else 0)
