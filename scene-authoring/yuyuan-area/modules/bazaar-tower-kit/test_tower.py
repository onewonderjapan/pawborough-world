"""商城大楼套件模块测试（bazaar-tower-kit）：华宝楼 DESIGN_SPEC.json tests 逐条 + wave4 四座楼（天裕楼 / 和丰楼 /
悦宾楼 / 上海老饭店）通用断言与逐楼形制断言。

纯 Python3（无 Blender）。位置/形心/朝向/共享边只认 baseline/layout.json 重算值；产物只读
out-bazaar-towers/<id>/model.glb 与 OUT_DIR 分区产物；测试不读模块自报数字（measurements / recipe 一律不读）。
模块 GLB 未构建时跳过（exit 0）；STRICT=1 时缺失也判 FAIL。
--source zone：不读模块 GLB，改从 OUT_DIR 的 zone-bazaar-*.glb 里取该 id 的子树（锚节点 = id，或程序化体块节点名含 |id|）
——用于「新断言先在现有产物（程序化体块）上失败」的负例证明。

用法：python3 -X utf8 modules/bazaar-tower-kit/test_tower.py [--id bld-428202599] [--out out-bazaar-towers/<id>]
      [--source module|zone]  [OUT_DIR=out-zone] [BAZAAR_TOWERS=1] [STRICT=1]
"""
import json, math, os, struct, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))          # scene-authoring/yuyuan-area
ARGS = sys.argv[1:]
def arg(flag, default):
    return ARGS[ARGS.index(flag) + 1] if flag in ARGS else default
ID = arg('--id', 'bld-428202599')
HUABAO = 'bld-428202599'
SOURCE = arg('--source', 'module')
REG = json.load(open(os.path.join(HERE, 'ids.json'), encoding='utf-8'))
_PREL = arg('--params', None) or REG.get('params', {}).get(ID) or next(
    ('params/' + f for f in sorted(os.listdir(os.path.join(HERE, 'params'))) if f.endswith(ID + '.json')), None)
PRM = json.load(open(os.path.join(HERE, _PREL), encoding='utf-8'))
BUDGET = PRM.get('budget', {})
OUT_MODEL = os.path.join(ROOT, arg('--out', os.path.join('out-bazaar-towers', ID)))
GLB = os.path.join(OUT_MODEL, 'model.glb')
OUT_DIR = os.environ.get('OUT_DIR', 'out-zone')
STRICT = os.environ.get('STRICT') == '1'

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

# ---------- layout 重算（唯一权威来源） ----------
LAYOUT = json.load(open(os.path.join(ROOT, 'baseline', 'layout.json'), encoding='utf-8'))
obj = next(o for o in LAYOUT['objects'] if o['id'] == ID)
FP = [list(q) for q in obj['geometry']['footprint']]
if FP[0] == FP[-1]:
    FP = FP[:-1]

def poly_area_centroid(poly):
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
    return cx / (6 * a), cz / (6 * a), abs(a) / 2
ACX, ACZ, AREA = poly_area_centroid(FP)
print('layout 重算：area centroid=(%.3f, %.3f)  area=%.1f m2  vertices=%d' % (ACX, ACZ, AREA, len(FP)))

def point_in_poly(pt, poly, tol=0.0):
    """tol>=0：多边形内、或距边界 ≤ tol（出檐包络）；tol<0：内缩要求——必须在内且距边界 ≥ -tol。"""
    x, y = pt
    inside = False
    best = 1e9
    n = len(poly)
    for i in range(n):
        x0, z0 = poly[i]
        x1, z1 = poly[(i + 1) % n]
        if (z0 > y) != (z1 > y):
            xin = x0 + (y - z0) * (x1 - x0) / (z1 - z0)
            if x < xin:
                inside = not inside
        ex, ez = x1 - x0, z1 - z0
        t = max(0.0, min(1.0, ((x - x0) * ex + (y - z0) * ez) / max(1e-12, ex * ex + ez * ez)))
        dx, dz = x - (x0 + t * ex), y - (z0 + t * ez)
        best = min(best, math.hypot(dx, dz))
    if tol >= 0:
        return inside or best <= tol
    return inside and best >= -tol

# ---------- GLB 解析（节点树 + 世界变换 + 顶点 + 三角数） ----------
def parse_glb(path, only=None):
    buf = open(path, 'rb').read()
    jl = struct.unpack_from('<I', buf, 12)[0]
    assert buf[16:20] == b'JSON'
    j = json.loads(bytes(buf[20:20 + jl]))
    bin_off = 20 + jl
    blen = struct.unpack_from('<I', buf, bin_off)[0]
    data = buf[bin_off + 8:bin_off + 8 + blen]
    comp = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
    ncomp = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
    def accessor(ai):
        a = j['accessors'][ai]
        bv = j['bufferViews'][a['bufferView']]
        fmt, bs = comp[a['componentType']]
        nc = ncomp[a['type']]
        off = (bv.get('byteOffset', 0)) + a.get('byteOffset', 0)
        stride = bv.get('byteStride') or bs * nc
        out = []
        for i in range(a['count']):
            o = off + i * stride
            out.append(struct.unpack_from('<' + fmt * nc, data, o))
        return out
    def node_matrix(n):
        if 'matrix' in n:
            m = n['matrix']          # glTF 列主序
            return [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14], m[3], m[7], m[11], m[15]]
        t = n.get('translation', [0, 0, 0])
        q = n.get('rotation', [0, 0, 0, 1])
        s = n.get('scale', [1, 1, 1])
        x, y, z, w = q
        rot = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
               2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
               2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]
        return [rot[0] * s[0], rot[3] * s[0], rot[6] * s[0], 0,
                rot[1] * s[1], rot[4] * s[1], rot[7] * s[1], 0,
                rot[2] * s[2], rot[5] * s[2], rot[8] * s[2], 0,
                t[0], t[1], t[2], 1]
    def mul4(a, b):
        o = [0.0] * 16
        for c in range(4):
            for r in range(4):
                o[c * 4 + r] = sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4))
        return o
    def mulv(m, v):
        return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
                m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
                m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]
    parent_of = {}
    for i, n in enumerate(j.get('nodes', [])):
        for c in n.get('children', []):
            parent_of[c] = i
    def world_of(ni):
        m = None
        cur = ni
        while cur is not None:
            m = mul4(node_matrix(j['nodes'][cur]), m) if m else node_matrix(j['nodes'][cur])
            cur = parent_of.get(cur)
        return m if m else node_matrix(ni)
    nodes = []
    for i, n in enumerate(j.get('nodes', [])):
        if only is not None and i not in only:
            nodes.append(None)
            continue
        if n.get('mesh') is None:
            nodes.append({'name': n.get('name', 'node%d' % i), 'mesh': False, 'translation': n.get('translation', [0, 0, 0]),
                          'verts': [], 'matrix': world_of(i)})
            continue
        verts, tris = [], 0
        for p in j['meshes'][n['mesh']]['primitives']:
            pos = accessor(p['attributes']['POSITION'])
            tris += accessor_count(j, p['indices'])
            verts.extend(pos)
        mats = [j['materials'][p['material']].get('name', '')
                for p in j['meshes'][n['mesh']]['primitives'] if p.get('material') is not None]
        idx_tris = []
        for p in j['meshes'][n['mesh']]['primitives']:
            ii = [t[0] for t in accessor(p['indices'])]
            idx_tris += [(ii[k], ii[k + 1], ii[k + 2]) for k in range(0, len(ii), 3)]
        nodes.append({'name': n.get('name', 'node%d' % i), 'mesh': True, 'translation': n.get('translation', [0, 0, 0]),
                      'verts': verts, 'tris': tris, 'matrix': world_of(i), 'mats': mats, 'idxTris': idx_tris})
    return j, nodes

def accessor_count(j, ai):
    return j['accessors'][ai]['count'] // 3

def world_verts(node):
    m = node['matrix']
    return [mulv_local(m, v) for v in node['verts']]
def mulv_local(m, v):
    return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
            m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
            m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]

# ---------- 前置：产物存在 ----------
def zone_subtree():
    """--source zone：在 OUT_DIR 的 bazaar 各件里找该 id 的子树（套件锚 empty 名 = id；程序化体块节点名 'bazaar|id|bazaarBlock|…'）。"""
    man = json.load(open(os.path.join(ROOT, OUT_DIR, 'zones-manifest.json'), encoding='utf-8'))
    for z in man['zones']:
        if z['id'] != 'bazaar' or not z.get('file'):
            continue
        path = os.path.join(ROOT, OUT_DIR, z['file'])
        buf = open(path, 'rb').read()
        jl_ = struct.unpack_from('<I', buf, 12)[0]
        j = json.loads(bytes(buf[20:20 + jl_]))
        roots = [i for i, n in enumerate(j['nodes']) if n.get('name') == ID or ('|%s|' % ID) in n.get('name', '')]
        if not roots:
            continue
        keep = set()
        stack = list(roots)
        while stack:
            i = stack.pop()
            keep.add(i)
            stack.extend(j['nodes'][i].get('children', []))
        j, ns = parse_glb(path, only=keep)
        return j, [ns[i] for i in sorted(keep)], path
    return None, [], None

if SOURCE == 'zone':
    gj, nodes, ZONE_FILE = zone_subtree()
    if not nodes:
        print('FAIL %s 在 %s 的 bazaar 各件里找不到' % (ID, OUT_DIR))
        sys.exit(1)
    GLB = ZONE_FILE
else:
    if not os.path.exists(GLB):
        if STRICT:
            print('FAIL 模块 GLB 缺失（STRICT）:', GLB)
            sys.exit(1)
        print('SKIP 模块 GLB 未构建（%s）— 本测试在构建后运行（STRICT=1 可强制失败）' % GLB)
        sys.exit(0)
    gj, nodes = parse_glb(GLB)
meshes = [n for n in nodes if n['mesh']]
total_tris = sum(n['tris'] for n in meshes)
print('%s（%s）：%d 节点（%d 网格）%d tris，文件 %.2f MB' % (ID, SOURCE, len(nodes), len(meshes), total_tris, os.path.getsize(GLB) / 1e6))

# ---------- test 1：顶点包含（全部 ≤ footprint+1.4；墙体件 ≤ footprint−0.3+ε） ----------
all_w = []
exceed = []
# 2026-09-24 主控修订：出檐按「各边法线方向」量（= 斜接外偏移多边形，footprint 为凸多边形），
# 直段 ≤ 1.4 m；离角点 3 m 内再许 0.35 m 出翘。上一版按「到多边形的距离」量，等于把转角做成圆角，
# 不允许翼角沿角平分线伸出——而那正是江南翼角的形态。
# wave4：footprint 可凹（和丰楼 L 形、悦宾楼台阶、天裕楼斜切），「各边法线外 ≤ d」= 点落在斜接外偏移多边形 O_d 内
# （凸多边形时与上一版逐边取最大完全等价）。先去掉共线 / < 5° 小折角顶点（否则偏移线近平行、交点飞出）。
def _simplify(poly):
    pts = [tuple(p) for p in poly]
    changed = True
    while changed and len(pts) > 3:
        changed = False
        for i in range(len(pts)):
            a, b, c = pts[i - 1], pts[i], pts[(i + 1) % len(pts)]
            t1 = math.atan2(b[1] - a[1], b[0] - a[0])
            t2 = math.atan2(c[1] - b[1], c[0] - b[0])
            if abs(math.degrees((t2 - t1 + math.pi) % (2 * math.pi) - math.pi)) < 5.0:
                pts.pop(i)
                changed = True
                break
    return pts
def _offset_out(poly, d):
    sa = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    n = len(poly)
    lines = []
    for i in range(n):
        (x0, z0), (x1, z1) = poly[i], poly[(i + 1) % n]
        L = math.hypot(x1 - x0, z1 - z0)
        tx, tz = (x1 - x0) / L, (z1 - z0) / L
        nx, nz = (tz, -tx) if sa > 0 else (-tz, tx)
        lines.append(((x0 + nx * d, z0 + nz * d), (tx, tz)))
    out = []
    for i in range(n):
        (p0, d0), (p1, d1) = lines[i - 1], lines[i]
        den = d0[0] * d1[1] - d0[1] * d1[0]
        t = ((p1[0] - p0[0]) * d1[1] - (p1[1] - p0[1]) * d1[0]) / den
        out.append((p0[0] + d0[0] * t, p0[1] + d0[1] * t))
    return out
_FPS = _simplify(FP)
_O14, _O175 = _offset_out(_FPS, 1.4 + 0.001), _offset_out(_FPS, 1.75 + 0.001)
def _edge_excess(pt):
    if point_in_poly(pt, _O14):
        return -1.0
    near_corner = min(math.hypot(pt[0] - q[0], pt[1] - q[1]) for q in FP) <= 3.0
    if near_corner and point_in_poly(pt, _O175):
        return -1.0
    return 1.0
for n in meshes:
    for v in world_verts(n):
        all_w.append(v)
        if _edge_excess((v[0], v[2])) > 0.001:
            exceed.append((n['name'], [round(q, 2) for q in v]))
ok('test1a 全部顶点在各边外 ≤1.4 m（角部 3 m 内 +0.35 出翘）（%d 顶点）' % len(all_w), len(exceed) == 0,
   '越界 %d 个，例 %s' % (len(exceed), exceed[:3]))
wall_out = []
for n in meshes:
    if not n['name'].startswith('walls__'):
        continue
    for v in world_verts(n):
        if not point_in_poly((v[0], v[2]), FP, tol=-0.29):   # 0.3 内（负 tol=向内收）
            wall_out.append((n['name'], [round(q, 2) for q in v]))
ok('test1b 墙体件顶点位于 footprint−0.3 m 内', len(wall_out) == 0, '越界 %d，例 %s' % (len(wall_out), wall_out[:3]))
base_out = []
for n in meshes:
    if not n['name'].startswith('base__'):
        continue
    for v in world_verts(n):
        if not point_in_poly((v[0], v[2]), FP, tol=-0.17):   # 台基出檐 0.12，须在 footprint 内
            base_out.append([round(q, 2) for q in v])
ok('test1c 台基顶点位于 footprint 内（含 0.12 出边）', len(base_out) == 0, '越界 %d，例 %s' % (len(base_out), base_out[:3]))

# ---------- test 2：最高点 ≤ 上限（华宝楼 DESIGN_SPEC 24.5；wave4 各楼 params.budget.maxHeightM） ----------
MAXH = BUDGET.get('maxHeightM', 24.5)
maxy = max(v[1] for v in all_w)
ok('test2 最高点 %.2f ≤ %.1f m' % (maxy, MAXH), maxy <= MAXH)

# ---------- test 3：tris ≤ 上限（华宝楼 40k；wave4 GOAL 单座 60k），GLB ≤ 上限，validator 0 错 ----------
TMAX = BUDGET.get('trisMax', 40000)
GMAX = int(BUDGET.get('glbMaxMB', 2.5) * 1_000_000)
ok('test3a 三角 %d ≤ %d' % (total_tris, TMAX), 0 < total_tris <= TMAX)
gb = os.path.getsize(GLB)
if SOURCE == 'zone':
    skip('test3b/3c GLB 体积与 validator', '--source zone（分件文件，不是模块 GLB）')
else:
    ok('test3b GLB %.2f MB ≤ %.1f MB' % (gb / 1e6, GMAX / 1e6), gb <= GMAX)
if SOURCE != 'zone':
    r = subprocess.run(['node', '--input-type=module', '-e',
                        "import {validateBytes} from 'gltf-validator';import fs from 'node:fs';"
                        "const b=fs.readFileSync(process.argv[1]);"
                        "validateBytes(new Uint8Array(b)).then(r=>console.log('VAL',r.issues.numErrors,"
                        "JSON.stringify((r.issues.messages||[]).filter(m=>m.severity===0).slice(0,3))));", GLB],
                       cwd=ROOT, capture_output=True, text=True, timeout=120)
    line = next((l for l in r.stdout.splitlines() if l.startswith('VAL')), None)
    if line is None:
        ok('test3c gltf-validator 运行', False, r.stderr[-200:])
    else:
        _, errs, msgs = line.split(' ', 2)
        ok('test3c gltf-validator 0 错误', errs == '0', msgs)
_used = {mn for n in meshes for mn in n.get('mats', [])}
mats = {m.get('name', ''): m for m in gj.get('materials', []) if m.get('name', '') in _used}
lat_m = next((v for k, v in mats.items() if 'lattice' in k), None)
gl_m = next((v for k, v in mats.items() if 'glass' in k), None)
ok('test3d 格心材质 alphaMode=MASK + cutoff 0.5', bool(lat_m) and lat_m.get('alphaMode') == 'MASK'
   and abs((lat_m.get('alphaCutoff') or 0) - 0.5) < 1e-6, str(lat_m and lat_m.get('alphaMode')))
ok('test3e 玻璃材质 alphaMode=BLEND', bool(gl_m) and gl_m.get('alphaMode') == 'BLEND',
   str(gl_m and gl_m.get('alphaMode')))

# ---------- test 4：无散件（连通体：碰地或相互 bbox 间距 ≤0.02） ----------
boxes = []
for n in meshes:
    vs = world_verts(n)
    if not vs:
        continue
    mn = [min(v[i] for v in vs) for i in range(3)]
    mx = [max(v[i] for v in vs) for i in range(3)]
    boxes.append((n['name'], mn, mx))
par = list(range(len(boxes)))
def find(a):
    while par[a] != a:
        par[a] = par[par[a]]
        a = par[a]
    return a
def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
        par[ra] = rb
def gap(mn1, mx1, mn2, mx2):
    return max(0.0, max(mn2[0] - mx1[0], mn1[0] - mx2[0]),
               max(mn2[1] - mx1[1], mn1[1] - mx2[1]),
               max(mn2[2] - mx1[2], mn1[2] - mx2[2]))
for i in range(len(boxes)):
    if boxes[i][1][1] <= 0.02:
        continue                     # 触地即连通
    for k in range(len(boxes)):
        if k == i:
            continue
        if gap(boxes[i][1], boxes[i][2], boxes[k][1], boxes[k][2]) <= 0.02:
            union(i, k)
roots = {find(i) for i in range(len(boxes))}
ok('test4 无散件：连通体 %d 个（全部触地或与他件 bbox 贴合 ≤0.02）' % len(roots), len(roots) == 1,
   '孤立组例 %s' % [boxes[i][0] for i in range(len(boxes)) if find(i) in list(roots)[:3]][:4])

# ---------- test 5：锚 empty 位于 footprint 面积形心 ≤0.1 ----------
anchors = [n for n in nodes if not n['mesh'] and n['name'] == ID]
ok('test5a GLB 含名为 %s 的锚节点' % ID, len(anchors) == 1)
if anchors:
    t = anchors[0]['translation']
    d = math.hypot(t[0] - ACX, t[2] - ACZ)
    ok('test5b 锚点 (%.2f, %.2f) 与面积形心偏差 %.3f ≤ 0.1' % (t[0], t[2], d), d <= 0.1)
else:
    ok('test5b 锚点位置', False, '无锚节点')

# ---------- test 6：套件楼所在分件（ids.json zonePart，wave4 Z0 起不再与程序化体块同件）raw ≤ 12 MB − 2 MB 余量；
#            BAZAAR_TOWERS=1 时锚节点在该件 ----------
REG = json.load(open(os.path.join(HERE, 'ids.json'), encoding='utf-8'))
ZP = int(REG['zonePart'][ID]) if ID in REG['zonePart'] else None
man_path = os.path.join(ROOT, OUT_DIR, 'zones-manifest.json')
if ZP is None:
    ok('test6 %s 登记在 modules/bazaar-tower-kit/ids.json' % ID, False, 'ids.json 无此 id')
elif os.path.exists(man_path):
    man = json.load(open(man_path, encoding='utf-8'))
    bp = next((z for z in man['zones'] if z['id'] == 'bazaar' and z.get('part') == ZP and z.get('file')), None)
    if os.environ.get('BAZAAR_TOWERS') == '1':
        ok('test6a BAZAAR_TOWERS=1：zone-bazaar 第 %d 件存在' % ZP, bp is not None)
        if bp:
            raw = os.path.getsize(os.path.join(ROOT, OUT_DIR, bp['file']))
            ok('test6a %s raw %.2f MB ≤ 10 MB（12 MB 上限留 2 MB 余量）' % (bp['file'], raw / 1e6), raw <= 10_000_000)
            buf = open(os.path.join(ROOT, OUT_DIR, bp['file']), 'rb').read()
            jl2 = struct.unpack_from('<I', buf, 12)[0]
            j2 = json.loads(bytes(buf[20:20 + jl2]))
            names = [n.get('name', '') for n in j2.get('nodes', [])]
            ok('test6b BAZAAR_TOWERS=1：锚节点 %s 在 %s' % (ID, bp['file']), any(nm == ID for nm in names))
    else:
        skip('test6 BAZAAR_TOWERS=1 接入核对', '开关未置 1')
else:
    skip('test6 分区产物', 'OUT_DIR 无 zones-manifest.json')

# ---------- test 7：walk（area-collision-contract / zone-walk-check）仍绿 ----------
if os.environ.get('SKIP_WALK') == '1':
    skip('test7 walk 检查', 'SKIP_WALK=1（公共验收里单独跑 area-collision-contract / zone-walk-check）')
elif os.path.exists(os.path.join(ROOT, OUT_DIR, 'collision-bazaar.json')):
    for script in ('tests/area-collision-contract.mjs', 'tests/zone-walk-check.mjs'):
        env = dict(os.environ, OUT_DIR=OUT_DIR)
        rr = subprocess.run(['node', script], cwd=ROOT, env=env, capture_output=True, text=True, timeout=600)
        ok('test7 %s EXIT 0' % script, rr.returncode == 0, (rr.stdout + rr.stderr).strip()[-300:])
else:
    skip('test7 walk 检查', 'OUT_DIR 无 collision-bazaar.json（未跑分区/碰撞导出）')

# ---------- test 8：R2 立面（2026-09-24 主控复验项：木构框架/长窗半窗/直棂栏杆/木框店面/挂落/石础/金匾边；只对华宝楼） ----------
def huabao_r2_tests():
    FM_ = PRM['massing']
    _FC = PRM['facades']
    ZT_ = [0.0]
    for h in FM_['storeyHeightsM']:
        ZT_.append(ZT_[-1] + h)
    PL_ = FM_['plinthHeightM']
    # layout 重算局部系（同 build_tower：u=frontEdge 0->1，v=指后街）
    i0_, i1_ = PRM['frontEdge']
    O_ = [FP[i0_][0], FP[i0_][1]]
    _du = [FP[i1_][0] - FP[i0_][0], FP[i1_][1] - FP[i0_][1]]
    _dul = math.hypot(*_du)
    du_ = [_du[0] / _dul, _du[1] / _dul]
    dv_ = [-du_[1], du_[0]]
    def uv_of(vtx):
        """GLB 顶点 (x, h, z)（Y-up：= 地图 x, 高, 地图 z）-> 局部 (u, v, h)。"""
        dx, dz = vtx[0] - O_[0], vtx[2] - O_[1]
        return (dx * du_[0] + dz * du_[1], dx * dv_[0] + dz * dv_[1], vtx[1])
    def u_v_h_of(node):
        return [uv_of(v) for v in world_verts(node)]

    def node_prim_mat(n):
        return n['mats'][0] if n.get('mats') else ''

    def node_by_name(sub):
        return [n for n in meshes if sub in n['name']]
    def components(node):
        """按三角形索引邻接求连通分量（= 收尾合并 join 前的原始件，join 不焊顶点）。"""
        vs = world_verts(node)
        par = list(range(len(vs)))
        def find(a):
            while par[a] != a:
                par[a] = par[par[a]]
                a = par[a]
            return a
        for a, b, c in node['idxTris']:
            for x, y in ((a, b), (b, c), (a, c)):
                ra, rb = find(x), find(y)
                if ra != rb:
                    par[ra] = rb
        pos = {}
        for i, v in enumerate(vs):                    # 同位置焊回（导出按面法线拆顶点）
            k = tuple(round(q, 3) for q in v)
            if k in pos:
                ra, rb = find(i), find(pos[k])
                if ra != rb:
                    par[ra] = rb
            else:
                pos[k] = i
        groups = {}
        for i in range(len(vs)):
            groups.setdefault(find(i), []).append(vs[i])
        return list(groups.values())

    # test8a 直棂/挂落 alpha 材质存在且 MASK
    mats_by_name = {m.get('name', ''): m for m in gj.get('materials', [])}
    def mask_ok(sub):
        m = next((v for k, v in mats_by_name.items() if sub in k), None)
        return bool(m) and m.get('alphaMode') == 'MASK' and abs((m.get('alphaCutoff') or 0) - 0.5) < 1e-6
    ok('test8a 直棂(slats)/挂落(guoluo) alpha 材质 MASK+0.5', mask_ok('slats') and mask_ok('guoluo'),
       str({k: v.get('alphaMode') for k, v in mats_by_name.items() if 'slats' in k or 'guoluo' in k}))

    # test8b 无整面玻璃幕墙：shopfront__glass 连通分量（分扇）≥8，每扇 u 宽 ≤ mullionPitch+0.2
    smp_ = _FC['shopfront'].get('mullionPitchM', 1.05)
    sgl_nodes = node_by_name('shopfront__glass')
    leaves = [c for n in sgl_nodes for c in components(n)]
    worst_w = 0.0
    for c in leaves:
        us = [p[0] for p in c]
        worst_w = max(worst_w, (max(us) - min(us)) if len(us) > 1 else 0.0)
    ok('test8b 店面玻璃分扇 %d 块（≥8），最宽 %.2f ≤ %.2f m' % (len(leaves), worst_w, smp_ + 0.2),
       len(leaves) >= 8 and worst_w <= smp_ + 0.2 + 1e-6)

    # test8c 二三层木构框架柱（framecol__wood）：≥12 根，贴前/后街墙带，z 跨 2-3 层
    fc_nodes = node_by_name('framecol__wood')
    fcols = [c for n in fc_nodes for c in components(n)]
    _UVP = [uv_of((q[0], 0.0, q[1])) for q in FP]     # footprint -> 局部 (u, v)
    U0e = min(p[0] for p in _UVP) + FM_['wallInsetM']
    U1e = max(p[0] for p in _UVP) - FM_['wallInsetM']
    V0e = min(p[1] for p in _UVP) + FM_['wallInsetM']
    V1e = max(p[1] for p in _UVP) - FM_['wallInsetM']
    band = 0.45
    in_band = all((v - band <= V0e <= v + band) or (v - band <= V1e <= v + band)
                  for c in fcols for _, v, _ in (uv_of(q) for q in c))
    zok = all(ZT_[1] - 0.01 <= h <= ZT_[3] + 0.01 for c in fcols for _, _, h in (uv_of(q) for q in c))
    ok('test8c 木构框架柱 %d 根（≥12），沿前/后街墙带 ±%.2f m，z 在 2-3 层' % (len(fcols), band),
       len(fcols) >= 12 and bool(fcols) and in_band and zok,
       'in_band=%s zok=%s' % (in_band, zok))

    # test8d 腰廊栏杆=直棂木栏板（gallery__slats，两街面 × galleryStoreys，材质 slats）
    sl_nodes = node_by_name('gallery__slats')
    sl_ok = len(sl_nodes) == 1 and all('slats' in node_prim_mat(n) for n in sl_nodes)
    if sl_nodes:
        hh = [uv_of(v)[2] for n in sl_nodes for v in world_verts(n)]
        uu = [uv_of(v)[0] for n in sl_nodes for v in world_verts(n)]
        ncomp = len(components(sl_nodes[0]))
        sl_ok = (ncomp >= 2 * len(_FC['galleryStoreys'])
                 and ZT_[1] + 0.1 <= min(hh) and max(hh) <= ZT_[2] + _FC['balustradeHM'] + 0.01
                 and max(uu) - min(uu) >= 0.85 * (U1e - U0e))
    ok('test8d 直棂栏杆板（gallery__slats 材质 slats，两街面两层通长）', bool(sl_ok),
       str([(n['name'], node_prim_mat(n)) for n in sl_nodes]))

    # test8e 檐下挂落：fascia__guoluo 金色 alpha 带沿街面通长，z 在檐下 0.45 m 带内
    fd_ = _FC['fasciaDepthM']
    glo_nodes = node_by_name('fascia__guoluo')
    ok('test8e 挂落 alpha 带（fascia__guoluo，材质含 guoluo）', len(glo_nodes) == 1
       and all('guoluo' in node_prim_mat(n) for n in glo_nodes),
       str([(n['name'], node_prim_mat(n)) for n in glo_nodes]))
    for n in glo_nodes:
        uu = [uv_of(v)[0] for v in world_verts(n)]
        hh = [uv_of(v)[2] for v in world_verts(n)]
        span = max(uu) - min(uu)
        ok('test8e %s 通长 %.1f m、z 在檐下 0.45 m 带内' % (n['name'], span),
           span >= 0.85 * (U1e - U0e)
           and ZT_[1] - fd_ - 0.15 <= min(hh) and max(hh) <= ZT_[1] + 0.01,
           'span=%.1f z=[%.2f,%.2f]' % (span, min(hh), max(hh)))

    # test8f 柱脚石础（colbase__stone）：≥12 个分量，落地、顶 ≤ 台基顶+0.12
    cb_nodes = node_by_name('colbase__stone')
    cbases = [c for n in cb_nodes for c in components(n)]
    bmax = max((max(p[1] for p in c) for c in cbases), default=0)
    bmin = min((min(p[1] for p in c) for c in cbases), default=1)
    ok('test8f 柱脚石础 %d 个（stone，z %.2f..%.2f ≤ %.2f）' % (len(cbases), bmin, bmax, PL_ + 0.12),
       len(cbases) >= 12 and all('stone' in node_prim_mat(n) for n in cb_nodes)
       and bmin <= 0.01 and bmax <= PL_ + 0.12)

    # test8g 二层大匾金色边框（plaques__gild，8×2 m + 边框 0.09）
    pqb = _FC.get('floor2PlaqueBorderM', 0.09)
    pf = next((n for n in meshes if n['name'] == 'plaques__gild'), None)
    if pf:
        uu = [uv_of(v)[0] for v in world_verts(pf)]
        hh = [uv_of(v)[2] for v in world_verts(pf)]
        w_, h_ = max(uu) - min(uu), max(hh) - min(hh)
        exp_w, exp_h = _FC['floor2PlaqueM'][0] + 2 * pqb, _FC['floor2PlaqueM'][1] + 2 * pqb
        ok('test8g 二层大匾金边 %.2f×%.2f ≈ %.2f×%.2f（gild）' % (w_, h_, exp_w, exp_h),
           'gild' in node_prim_mat(pf) and abs(w_ - exp_w) < 0.06 and abs(h_ - exp_h) < 0.06,
           'mat=%s' % node_prim_mat(pf))
    else:
        ok('test8g 二层大匾金色边框', False, '无 plaques__gild')

if ID == HUABAO:
    huabao_r2_tests()

# ================================================================ wave4 通用断言（全部从 layout 重算）
def _mat_used(sub):
    return [k for k in mats if sub in k]
def _lum(f):
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]
def _comps_by_mat(sub):
    """所有用到材质名含 sub 的网格节点的连通分量（世界坐标顶点列表）。"""
    out = []
    for n in meshes:
        if any(sub in mn for mn in n.get('mats', [])):
            out.extend(_components(n))
    return out
def _components(node):
    vs = world_verts(node)
    par = list(range(len(vs)))
    def f(a):
        while par[a] != a:
            par[a] = par[par[a]]
            a = par[a]
        return a
    for a, b, c in node['idxTris']:
        for x, y in ((a, b), (b, c), (a, c)):
            ra, rb = f(x), f(y)
            if ra != rb:
                par[ra] = rb
    pos = {}
    for i, v in enumerate(vs):
        k = tuple(round(q, 3) for q in v)
        if k in pos:
            ra, rb = f(i), f(pos[k])
            if ra != rb:
                par[ra] = rb
        else:
            pos[k] = i
    g = {}
    for i in range(len(vs)):
        g.setdefault(f(i), []).append(vs[i])
    return list(g.values())
SA = sum(FP[i][0] * FP[(i + 1) % len(FP)][1] - FP[(i + 1) % len(FP)][0] * FP[i][1] for i in range(len(FP)))
def edge_frame_map(a, b):
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    t = ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
    n = (t[1], -t[0]) if SA > 0 else (-t[1], t[0])           # 外法线
    return L, t, n
def s_d(a, t, n, x, z):
    """点 (x,z) 相对边：沿边 s、向内距离 d_in。"""
    return (x - a[0]) * t[0] + (z - a[1]) * t[1], -((x - a[0]) * n[0] + (z - a[1]) * n[1])

# ---------- test 9：共享边（hall-kit 规则，从 layout 独立检出）：任何三角不越过与邻栋共用的边 0.02 m 以上；不插进邻栋 ----------
try:
    _KINDS = set(json.load(open(os.path.join(HERE, '..', 'hall-kit', 'defaults.json'), encoding='utf-8'))['sharedEdgeKinds'])
except Exception:
    _KINDS = {'hall', 'tower', 'xuan', 'stage', 'waterside', 'pavilion', 'bazaarBlock', 'outerBuilding'}
SHARED_L = []
for i in range(len(FP)):
    a, b = FP[i], FP[(i + 1) % len(FP)]
    L, t, n = edge_frame_map(a, b)
    for q in LAYOUT['objects']:
        if q['id'] == ID or q.get('skipRender') or q.get('kind') not in _KINDS:
            continue
        qf = (q.get('geometry') or {}).get('footprint')
        if not qf or len(qf) < 3:
            continue
        for j in range(len(qf)):
            c, d = qf[j], qf[(j + 1) % len(qf)]
            if abs((c[0] - a[0]) * n[0] + (c[1] - a[1]) * n[1]) > 0.05 or abs((d[0] - a[0]) * n[0] + (d[1] - a[1]) * n[1]) > 0.05:
                continue
            sc_, sd_ = (c[0] - a[0]) * t[0] + (c[1] - a[1]) * t[1], (d[0] - a[0]) * t[0] + (d[1] - a[1]) * t[1]
            lo, hi = max(0.0, min(sc_, sd_)), min(L, max(sc_, sd_))
            if hi - lo >= 0.3:
                SHARED_L.append({'a': a, 't': t, 'n': n, 'lo': lo, 'hi': hi, 'other': q['id'], 'edge': i,
                                 'otherFp': [list(p) for p in qf if True]})
def _clip_s(poly, lo, hi):
    def clip(pts, keep, val):
        out = []
        for k in range(len(pts)):
            p, q = pts[k], pts[(k + 1) % len(pts)]
            fp, fq = keep(p[0], val), keep(q[0], val)
            if fp:
                out.append(p)
            if fp != fq:
                tt = (val - p[0]) / (q[0] - p[0])
                out.append((val, p[1] + (q[1] - p[1]) * tt))
        return out
    pts = clip(poly, lambda s, v: s >= v, lo)
    if pts:
        pts = clip(pts, lambda s, v: s <= v, hi)
    return pts
if ID != HUABAO:
    if not SHARED_L:
        print('INFO test9 %s 无共享边（layout 检出）' % ID)
    for e in SHARED_L:
        worst = -1e9
        for nd in meshes:
            wv = world_verts(nd)
            for (ia, ib, ic) in nd['idxTris']:
                tri = []
                for ii in (ia, ib, ic):
                    x, z = wv[ii][0], wv[ii][2]
                    tri.append(((x - e['a'][0]) * e['t'][0] + (z - e['a'][1]) * e['t'][1],
                                (x - e['a'][0]) * e['n'][0] + (z - e['a'][1]) * e['n'][1]))
                if max(p[1] for p in tri) <= worst:
                    continue
                cp = _clip_s(tri, e['lo'], e['hi'])
                if cp:
                    worst = max(worst, max(p[1] for p in cp))
        ok('test9a 不越过与 %s 的共享边（重叠 %.2f m，最大越界 %.3f m ≤ 0.02）' % (e['other'], e['hi'] - e['lo'], worst), worst <= 0.02)
    for oid in sorted({e['other'] for e in SHARED_L}):
        ofp = next(e['otherFp'] for e in SHARED_L if e['other'] == oid)
        bad = [v for v in all_w if v[1] > 0.05 and point_in_poly((v[0], v[2]), ofp, tol=-0.05)]
        ok('test9b 构件不插进共享边邻栋 %s 的 footprint（> 0.05 m 顶点 %d 个）' % (oid, len(bad)), not bad)

# ---------- test 10：朝向 / 位置（layout 重算）：params 前街边 = layout 临街边；每条临街边（≥5 m、非共享）底层有店面玻璃 ----------
FE = PRM['frontEdge']
_fe_street = None
for fe in obj.get('frontEdges', []):
    e = fe['edge']
    A, B = FP[FE[0]], FP[FE[1]]
    if (abs(e[0][0] - A[0]) < 0.02 and abs(e[0][1] - A[1]) < 0.02 and abs(e[1][0] - B[0]) < 0.02 and abs(e[1][1] - B[1]) < 0.02):
        _fe_street = fe['street']
ok('test10a params.frontEdge %s = layout 临街边（%s）' % (FE, _fe_street), bool(_fe_street))
_glass = [v for n in meshes if any('glass' in mn for mn in n.get('mats', [])) for v in world_verts(n)]
_shared_edges_idx = {e['edge'] for e in SHARED_L if e['hi'] - e['lo'] > 0.5 * edge_frame_map(FP[e['edge']], FP[(e['edge'] + 1) % len(FP)])[0]}
STREET_EDGES = []
for fe in obj.get('frontEdges', []):
    (A, B) = fe['edge']
    if fe.get('lenM', 0) < 5.0 or math.hypot(B[0] - A[0], B[1] - A[1]) < 5.0:
        continue
    k = next((i for i in range(len(FP)) if abs(FP[i][0] - A[0]) < .02 and abs(FP[i][1] - A[1]) < .02), None)
    if k is None or k in _shared_edges_idx:
        continue
    STREET_EDGES.append((k, fe['street'], A, B))
for k, st, A, B in STREET_EDGES:
    L, t, n = edge_frame_map(A, B)
    bins = set()
    for v in _glass:
        s, d = s_d(A, t, n, v[0], v[2])
        if 0.1 <= d <= 2.6 and 0 <= s <= L and v[1] < 6.0:
            bins.add(int(s / 0.5))
    cov = len(bins) * 0.5 / L
    ok('test10b 临街边 v%d（%s，%.1f m）底层店面玻璃覆盖 %.0f%% ≥ 50%%' % (k, st, L, cov * 100), cov >= 0.5)

# ---------- test 11：逐楼形制（主控文字规格 → 可测条目；位置 / 高度全部按 layout 重算） ----------
def front_edge():
    A, B = FP[FE[0]], FP[FE[1]]
    L, t, n = edge_frame_map(A, B)
    return A, B, L, t, n
def comp_center(c):
    return (sum(p[0] for p in c) / len(c), sum(p[1] for p in c) / len(c), sum(p[2] for p in c) / len(c))
def frames_on_front(min_w):
    A, B, L, t, n = front_edge()
    out = []
    for n_ in meshes:
        if not n_['name'].startswith('plaques__') or not any('gild' in mn for mn in n_.get('mats', [])):
            continue
        for c in _components(n_):
            ss = [s_d(A, t, n, p[0], p[2])[0] for p in c]
            dd = [s_d(A, t, n, p[0], p[2])[1] for p in c]
            w = max(ss) - min(ss)
            if w >= min_w and -2.5 <= min(dd) and max(dd) <= 1.0:
                out.append({'w': w, 's': (max(ss) + min(ss)) / 2 / L, 'z0': min(p[1] for p in c), 'z1': max(p[1] for p in c)})
    return out
if ID == 'bld-428202601':                                  # 天裕楼
    A, B, L, t, n = front_edge()
    sl = _comps_by_mat('slats')
    levels = sorted({round(min(p[1] for p in c), 1) for c in sl})
    ok('test11a 天裕楼 直棂栏杆外廊楼层数 %d ≥ 3（底标高 %s）' % (len(levels), levels), len(levels) >= 3)
    bins = {}
    for c in sl:
        for p in c:
            s, d = s_d(A, t, n, p[0], p[2])
            if -1.6 <= d <= 0.6 and 0 <= s <= L:
                bins.setdefault(round(min(q[1] for q in c), 1), set()).add(int(s / 0.5))
    covs = {h: len(b) * 0.5 / L for h, b in bins.items()}
    ok('test11b 天裕楼 前街（方浜中路）每层外廊通长 ≥ 60%%：%s' % {h: '%.0f%%' % (c * 100) for h, c in sorted(covs.items())},
       len(covs) >= 3 and all(c >= 0.6 for c in covs.values()))
    ds = sorted(s_d(A, t, n, v[0], v[2])[1] for v in _glass if 0 <= s_d(A, t, n, v[0], v[2])[0] <= L and v[1] < 6
                and -0.5 <= s_d(A, t, n, v[0], v[2])[1] <= 4)
    med = ds[len(ds) // 2] if ds else 0
    ok('test11c 天裕楼 底层深进店面带：前街店面玻璃向内 %.2f m ≥ 1.2 m' % med, med >= 1.2)
    ch = ((FP[5][0] + FP[7][0]) / 2, (FP[5][1] + FP[7][1]) / 2)          # 方浜中路 × 旧校场路斜切角中点
    non_g = [v for n_ in meshes if not any('gild' in mn for mn in n_.get('mats', [])) for v in world_verts(n_)]
    top = max(non_g, key=lambda v: v[1])
    near = math.hypot(top[0] - ch[0], top[2] - ch[1])
    far_top = max((v[1] for v in non_g if math.hypot(v[0] - ch[0], v[2] - ch[1]) > 18.0), default=0)
    ok('test11d 天裕楼 最高屋顶在斜切角塔楼（距角中点 %.1f m ≤ 12），比主屋面高 %.2f m ≥ 1.5' % (near, top[1] - far_top),
       near <= 12.0 and top[1] - far_top >= 1.5)
    fwd = (-n[0], -n[1])                                  # 站在前街看楼：视线 = 内法线
    left = (fwd[1], -fwd[0])
    mid = ((A[0] + B[0]) / 2, (A[1] + B[1]) / 2)
    side = (top[0] - mid[0]) * left[0] + (top[2] - mid[1]) * left[1]
    ok('test11e 天裕楼 从方浜中路看塔楼在左端（左向投影 %.1f m > 0）' % side, side > 0)
elif ID == 'bld-389701812':                                # 和丰楼
    A, B, L, t, n = front_edge()
    lq = [m for k, m in mats.items() if 'lacquer' in k]
    lqv = [v for n_ in meshes if n_['name'].startswith('shopfront__') and any('lacquer' in mn for mn in n_.get('mats', []))
           for v in world_verts(n_)]
    blk = bool(lq) and _lum(lq[0]['pbrMetallicRoughness'].get('baseColorFactor', [1, 1, 1])) < 0.02
    ok('test11a 和丰楼 底层黑漆店面（shopfront 用 lacquer 材质、色值近黑）', blk and len(lqv) > 0)
    fr = frames_on_front(3.5)
    low = [f for f in fr if 2.0 <= f['z0'] and f['z1'] <= 5.5]
    high = [f for f in fr if f['z0'] >= 9.5]
    ok('test11b 和丰楼 前街入口上方大横匾 %d 块（宽 ≥ 3.5 m、2–5.5 m 高）+ 高处匾 %d 块（≥ 9.5 m）' % (len(low), len(high)),
       len(low) >= 1 and len(high) >= 1 and all(0.25 <= f['s'] <= 0.75 for f in low))
    lions = _comps_by_mat('lionstone')
    lion_heads = [c for c in lions if max(p[1] for p in c) > 1.6]
    inside = [c for c in lion_heads if point_in_poly((comp_center(c)[0], comp_center(c)[2]), FP, tol=-0.05)
              and 0 <= s_d(A, t, n, comp_center(c)[0], comp_center(c)[2])[1] <= 3.5]
    ok('test11c 和丰楼 门口石狮一对（footprint 内、离前街 ≤ 3.5 m）：%d' % len(inside), len(inside) >= 2)
    lan = [c for c in _comps_by_mat('lantern') if 2.0 <= comp_center(c)[1] <= 4.8]
    lan_f = [c for c in lan if -1.5 <= s_d(A, t, n, comp_center(c)[0], comp_center(c)[2])[1] <= 0.5]
    ok('test11d 和丰楼 前街檐下红灯笼 %d 盏 ≥ 8' % len(lan_f), len(lan_f) >= 8)
    ok('test11e 和丰楼 檐下彩画额枋（caihua 材质）', bool(_mat_used('caihua')))
elif ID == 'bld-428202602':                                # 悦宾楼
    A, B, L, t, n = front_edge()
    sr = [v for n_ in meshes if any('signred' in mn for mn in n_.get('mats', [])) for v in world_verts(n_)]
    bins = {int(s_d(A, t, n, v[0], v[2])[0] / 0.5) for v in sr
            if -0.3 <= s_d(A, t, n, v[0], v[2])[1] <= 0.8 and 2.5 <= v[1] <= 4.6 and 0 <= s_d(A, t, n, v[0], v[2])[0] <= L}
    ok('test11a 悦宾楼 前街（粮厅路）底层红色招牌带覆盖 %.0f%% ≥ 50%%' % (len(bins) * 50 / L), len(bins) * 0.5 / L >= 0.5)
    ch_levels = sorted({round(min(p[1] for p in c), 0) for c in _comps_by_mat('caihua')})
    ok('test11b 悦宾楼 各层檐下彩画额枋 ≥ 3 个标高（%s）' % ch_levels, len(ch_levels) >= 3)
    lan = [c for c in _comps_by_mat('lantern') if 2.0 <= comp_center(c)[1] <= 4.8]
    ok('test11c 悦宾楼 檐下红灯笼 %d 盏 ≥ 6' % len(lan), len(lan) >= 6)
    fr = frames_on_front(3.0)
    ok('test11d 悦宾楼 入口上方黑底金框匾（前街居中、宽 ≥ 3 m）%d 块' % len(fr), any(0.25 <= f['s'] <= 0.75 for f in fr))
    br = [c for n_ in meshes if n_['name'].startswith('eaves__') and any('wood' in mn for mn in n_.get('mats', []))
          for c in _components(n_) if (max(p[1] for p in c) - min(p[1] for p in c)) < 0.4]
    brf = [c for c in br if -0.2 <= -s_d(A, t, n, comp_center(c)[0], comp_center(c)[2])[1] <= 1.2 and comp_center(c)[1] < 5.5]
    ok('test11e 悦宾楼 底层檐下斗拱密排：前街 %d 组，间距 ≤ 1.6 m（%.1f m 边）' % (len(brf), L), len(brf) >= L / 1.6)
elif ID == 'bld-428202603':                                # 上海老饭店
    A, B, L, t, n = front_edge()
    gil = [v for n_ in meshes if any('gild' in mn for mn in n_.get('mats', [])) for v in world_verts(n_)]
    top = max(all_w, key=lambda v: v[1])
    topg = max(gil, key=lambda v: v[1]) if gil else [0, 0, 0]
    d3 = math.hypot(topg[0] - FP[3][0], topg[2] - FP[3][1])
    ok('test11a 上海老饭店 最高点是鎏金宝顶（%.2f m，金 %.2f m），在旧校场路北端转角塔（离 v3 %.1f m ≤ 16）' % (top[1], topg[1], d3),
       abs(top[1] - topg[1]) < 1e-6 and d3 <= 16.0 and topg[1] >= 23.0)
    fin = [c for c in _comps_by_mat('gild') if min(p[1] for p in c) >= topg[1] - 3.0]
    ok('test11b 上海老饭店 葫芦宝顶（塔顶鎏金件 %d 个 ≥ 3：座 / 下球 / 上球 / 尖）' % len(fin), len(fin) >= 3)
    front_v = [v for v in all_w if 0.3 <= s_d(A, t, n, v[0], v[2])[1] <= 6.5 and 0 <= s_d(A, t, n, v[0], v[2])[0] <= L
               and math.hypot(v[0] - topg[0], v[2] - topg[2]) > 9.0]
    rear_v = [v for v in all_w if s_d(A, t, n, v[0], v[2])[1] >= 12.0 and math.hypot(v[0] - topg[0], v[2] - topg[2]) > 9.0]
    fh = max(v[1] for v in front_v) if front_v else 99
    rh = max(v[1] for v in rear_v) if rear_v else 0
    ok('test11c 上海老饭店 两层前楼（临街 6.5 m 进深内最高 %.2f ≤ 12.5 m）+ 后楼更高（%.2f ≥ 16 m）' % (fh, rh), fh <= 12.5 and rh >= 16.0)

# ---------- test 12：匾额 / 招牌是空板（材质无贴图 = 无字）；模块里没有带贴图的匾 ----------
_board = [m for k, m in mats.items() if any(x in k for x in ('dark', 'gild', 'signred'))]
_tex_board = [m['name'] for m in _board if 'baseColorTexture' in m.get('pbrMetallicRoughness', {})]
_pl_nodes = [n_ for n_ in meshes if n_['name'].startswith('plaques__')]
if _pl_nodes or _mat_used('signred'):
    ok('test12 匾额 / 招牌材质无贴图（空板，不写字）：%d 种材质' % len(_board), not _tex_board, str(_tex_board))
else:
    ok('test12 匾额 / 招牌存在', False, '无 plaques__* 节点与 signred 材质')
print('\ntest_tower: %d pass, %d fail, %d skip' % (pass_n, fail_n, skip_n))
if fail_n:
    for f in failures:
        print('  FAIL:', f)
    sys.exit(1)
