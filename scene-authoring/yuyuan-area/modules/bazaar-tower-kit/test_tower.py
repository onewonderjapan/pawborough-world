"""华宝楼模块测试（WP6.2 bazaar-tower-kit）：DESIGN_SPEC.json tests 逐条。

纯 Python3（无 Blender）。位置/形心只认 baseline/layout.json 重算值；产物只读
out-bazaar-towers/<id>/model.glb 与 OUT_DIR 分区产物；测试不读模块自报数字。
模块 GLB 未构建时跳过（exit 0）；STRICT=1 时缺失也判 FAIL（用于"未实现产物上必须失败"的负例证明）。

用法：python3 -X utf8 modules/bazaar-tower-kit/test_tower.py [--out out-bazaar-towers/bld-428202599] [OUT_DIR=out-zone]
"""
import json, math, os, struct, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))          # scene-authoring/yuyuan-area
ARGS = sys.argv[1:]
def arg(flag, default):
    return ARGS[ARGS.index(flag) + 1] if flag in ARGS else default
ID = 'bld-428202599'
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
def parse_glb(path):
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
        if n.get('mesh') is None:
            nodes.append({'name': n.get('name', 'node%d' % i), 'mesh': False, 'translation': n.get('translation', [0, 0, 0]),
                          'verts': [], 'matrix': world_of(i)})
            continue
        verts, tris = [], 0
        for p in j['meshes'][n['mesh']]['primitives']:
            pos = accessor(p['attributes']['POSITION'])
            tris += accessor_count(j, p['indices'])
            verts.extend(pos)
        nodes.append({'name': n.get('name', 'node%d' % i), 'mesh': True, 'translation': n.get('translation', [0, 0, 0]),
                      'verts': verts, 'tris': tris, 'matrix': world_of(i)})
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
if not os.path.exists(GLB):
    if STRICT:
        print('FAIL 模块 GLB 缺失（STRICT）:', GLB)
        sys.exit(1)
    print('SKIP 模块 GLB 未构建（%s）— 本测试在构建后运行（STRICT=1 可强制失败）' % GLB)
    sys.exit(0)

gj, nodes = parse_glb(GLB)
meshes = [n for n in nodes if n['mesh']]
total_tris = sum(n['tris'] for n in meshes)
print('GLB：%d 节点（%d 网格）%d tris，%.2f MB' % (len(nodes), len(meshes), total_tris, os.path.getsize(GLB) / 1e6))

# ---------- test 1：顶点包含（全部 ≤ footprint+1.4；墙体件 ≤ footprint−0.3+ε） ----------
all_w = []
exceed = []
# 2026-09-24 主控修订：出檐按「各边法线方向」量（= 斜接外偏移多边形，footprint 为凸多边形），
# 直段 ≤ 1.4 m；离角点 3 m 内再许 0.35 m 出翘。上一版按「到多边形的距离」量，等于把转角做成圆角，
# 不允许翼角沿角平分线伸出——而那正是江南翼角的形态。
def _edge_excess(pt):
    worst, near_corner = -1e9, min(math.hypot(pt[0] - q[0], pt[1] - q[1]) for q in FP) <= 3.0
    sa = sum(FP[i][0] * FP[(i + 1) % len(FP)][1] - FP[(i + 1) % len(FP)][0] * FP[i][1] for i in range(len(FP)))
    for i in range(len(FP)):
        (x0, z0), (x1, z1) = FP[i], FP[(i + 1) % len(FP)]
        ex, ez = x1 - x0, z1 - z0
        L = math.hypot(ex, ez)
        if L < 1e-9:
            continue
        nx, nz = (ez / L, -ex / L) if sa > 0 else (-ez / L, ex / L)   # 外法线
        worst = max(worst, (pt[0] - x0) * nx + (pt[1] - z0) * nz)
    return worst - (1.4 + (0.35 if near_corner else 0.0))
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

# ---------- test 2：最高点 ≤ 24.5 ----------
maxy = max(v[1] for v in all_w)
ok('test2 最高点 %.2f ≤ 24.5 m' % maxy, maxy <= 24.5)

# ---------- test 3：tris ≤ 40k，GLB ≤ 2.5 MB，validator 0 错 ----------
ok('test3a 三角 %d ≤ 40000' % total_tris, 0 < total_tris <= 40000)
gb = os.path.getsize(GLB)
ok('test3b GLB %.2f MB ≤ 2.5 MB' % (gb / 1e6), gb <= 2_500_000)
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
mats = {m.get('name', ''): m for m in gj.get('materials', [])}
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

# ---------- test 6：分区 zone-bazaar-2 raw ≤ 12 MB；BAZAAR_TOWERS=1 时大楼在 bazaar-2 ----------
man_path = os.path.join(ROOT, OUT_DIR, 'zones-manifest.json')
if os.path.exists(man_path):
    man = json.load(open(man_path, encoding='utf-8'))
    b2 = next((z for z in man['zones'] if z['id'] == 'bazaar' and z.get('part') == 2), None)
    if b2 and b2.get('file'):
        raw = os.path.getsize(os.path.join(ROOT, OUT_DIR, b2['file']))
        ok('test6a zone-bazaar-2 raw %.2f MB ≤ 12 MB' % (raw / 1e6), raw <= 12_000_000)
        if os.environ.get('BAZAAR_TOWERS') == '1':
            import hashlib
            glb_path = os.path.join(ROOT, OUT_DIR, b2['file'])
            buf = open(glb_path, 'rb').read()
            jl2 = struct.unpack_from('<I', buf, 12)[0]
            j2 = json.loads(bytes(buf[20:20 + jl2]))
            names = [n.get('name', '') for n in j2.get('nodes', [])]
            ok('test6b BAZAAR_TOWERS=1：锚节点 %s 已在 zone-bazaar-2' % ID, any(nm == ID for nm in names))
        else:
            skip('test6b BAZAAR_TOWERS=1 接入核对', '开关未置 1')
    else:
        skip('test6 分区产物', 'zones-manifest 无 bazaar part2')
else:
    skip('test6 分区产物', 'OUT_DIR 无 zones-manifest.json')

# ---------- test 7：walk（area-collision-contract / zone-walk-check）仍绿 ----------
if os.path.exists(os.path.join(ROOT, OUT_DIR, 'collision-bazaar.json')):
    for script in ('tests/area-collision-contract.mjs', 'tests/zone-walk-check.mjs'):
        env = dict(os.environ, OUT_DIR=OUT_DIR)
        rr = subprocess.run(['node', script], cwd=ROOT, env=env, capture_output=True, text=True, timeout=600)
        ok('test7 %s EXIT 0' % script, rr.returncode == 0, (rr.stdout + rr.stderr).strip()[-300:])
else:
    skip('test7 walk 检查', 'OUT_DIR 无 collision-bazaar.json（未跑分区/碰撞导出）')

print('\ntest_tower: %d pass, %d fail, %d skip' % (pass_n, fail_n, skip_n))
if fail_n:
    for f in failures:
        print('  FAIL:', f)
    sys.exit(1)
