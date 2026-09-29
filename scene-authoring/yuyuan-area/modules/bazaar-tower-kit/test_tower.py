"""商城大楼套件模块测试（bazaar-tower-kit）：华宝楼 DESIGN_SPEC.json tests 逐条 + wave4 四座楼（天裕楼 / 和丰楼 /
悦宾楼 / 上海老饭店）通用断言与逐楼形制断言。

纯 Python3（无 Blender）。位置/形心/朝向/共享边只认 baseline/layout.json 重算值；产物只读
out-bazaar-towers/<id>/model.glb 与 OUT_DIR 分区产物；测试不读模块自报数字（measurements / recipe 一律不读；
唯一例外 wave12 test17b：窗背板数量期望 = 生成器 window() 调用计数 measurements.windowBackingCalls——
背板在导出时按 (part,材质) 合并成单节点，产物内部无法分瓣计数，GOAL 明确认可生成器调用计数作独立来源）。
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
sys.path.insert(0, HERE)
import params_load                                               # noqa: E402  wave7 K1：立面预设楼的 params 合并 + auto 值（名楼 params 原样）
PRM = params_load.load(_PREL)
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
_meas_p = os.path.join(OUT_MODEL, 'measurements.json')
_meas = json.load(open(_meas_p, encoding='utf-8')) if os.path.exists(_meas_p) else {}

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
    # wave7 B：离真实 footprint（不简化）欧氏距离 ≤ 1.4 m 也算合规——_FPS 去掉 < 5° 凸折角后弦在 footprint 以内，
    # 贴着真实折线走的檐口（预设楼 kinkDeg 2°）会被按弦量成越界；圆角口径在直段上不比斜接宽松，在转角处更严
    if point_in_poly(pt, FP, tol=1.4):
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
# wave12-debt D7：glTF 2.0 alphaCutoff 缺省值是 0.5（gltfpack 会省略等于缺省的字段）——
# 省略须按 0.5 判，旧写法 `or 0` 把省略当 0，--source zone 下 16 个既有失败即由此而来。
# wave12-debt R1（审查可选）：省略与显式非法值要区分——alphaCutoff 是 number，显式 null/bool/字符串
# 违反 schema，属格式错误（返回 None，调用方判失败），不得偷换成缺省 0.5 掩盖导出器写坏。
def _cutoff(m):
    if 'alphaCutoff' not in m:
        return 0.5
    ac = m['alphaCutoff']
    return ac if isinstance(ac, (int, float)) and not isinstance(ac, bool) else None
ok('test3d 格心材质 alphaMode=MASK + cutoff 0.5（省略按 glTF 缺省 0.5；显式 null/非数按格式错误拒绝）',
   bool(lat_m) and lat_m.get('alphaMode') == 'MASK' and _cutoff(lat_m) is not None
   and abs(_cutoff(lat_m) - 0.5) < 1e-6, str(lat_m and lat_m.get('alphaMode')))
# wave12-debt R1（审查可选）：负例——显式 null / 非法值不是「省略」（glTF 2.0 alphaCutoff 是 number，
# null/bool/字符串都违反 schema），不得偷换成缺省 0.5 放过（掩盖导出器写坏）；省略与合法数值行为不变。
ok('test3d0 负例 alphaCutoff 显式 null/字符串/bool = 格式错误（None），省略=0.5、数值照常',
   _cutoff({'alphaMode': 'MASK', 'alphaCutoff': None}) is None
   and _cutoff({'alphaMode': 'MASK', 'alphaCutoff': '0.5'}) is None
   and _cutoff({'alphaMode': 'MASK', 'alphaCutoff': True}) is None
   and _cutoff({'alphaMode': 'MASK'}) == 0.5
   and _cutoff({'alphaMode': 'MASK', 'alphaCutoff': 0.37}) == 0.37)
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
    if os.environ.get('BAZAAR_TOWERS', '1') != '0':
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
        # alphaCutoff 省略按 glTF 2.0 缺省 0.5（wave12-debt D7，同 test3d 的 _cutoff）；
        # 显式 null/非数是格式错误（R1：_cutoff 返回 None → 判失败，不按缺省 0.5 放过）
        if not m or m.get('alphaMode') != 'MASK':
            return False
        c = _cutoff(m)
        return c is not None and abs(c - 0.5) < 1e-6
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
        _e = PRM['eaveKit']
        _zf = ZT_[1] - ((_e['drop'] + _e['tileH'] + _e['boardH'] + 0.02) if _FC.get('fasciaBelowEave') else 0.0)
        ok('test8e %s 通长 %.1f m、z 在挂落带（顶 %.2f）0.45 m 内' % (n['name'], span, _zf),
           span >= 0.85 * (U1e - U0e)
           and _zf - fd_ - 0.15 <= min(hh) and max(hh) <= _zf + 0.01,
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
def coverage(comps, A, B, dmin, dmax, zmin=-1e9, zmax=1e9):
    """连通分量沿边 A→B 的覆盖率：分量全部顶点落在向内 [dmin, dmax]、高 [zmin, zmax] 内时取其 s 区间，求并长 / 边长。"""
    L, t, n = edge_frame_map(A, B)
    ivs = []
    for c in comps:
        sd = [s_d(A, t, n, p[0], p[2]) for p in c]
        if all(dmin <= d <= dmax for _, d in sd) and all(zmin <= p[1] <= zmax for p in c):
            a_, b_ = max(0.0, min(x for x, _ in sd)), min(L, max(x for x, _ in sd))
            if b_ > a_:
                ivs.append((a_, b_))
    ivs.sort()
    tot, cur = 0.0, None
    for a_, b_ in ivs:
        if cur and a_ <= cur[1]:
            cur[1] = max(cur[1], b_)
        else:
            if cur:
                tot += cur[1] - cur[0]
            cur = [a_, b_]
    if cur:
        tot += cur[1] - cur[0]
    return tot / L

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
if True:                       # lead 2026-09-26：华宝楼也按共享边规则（各模块一致）
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
                # wave7：只看共享边外 5 m 以内的三角（再远就不是「越过这条边」的出檐，而是凹 footprint 绕到这条边
                # 延长线外侧的本栋自身体量——例 bld-165791764 绕着华宝楼东端，旧判据误报 30 m；插进邻栋由 test9b 管）
                if min(p[1] for p in tri) > 5.0:
                    continue
                cp = _clip_s(tri, e['lo'], e['hi'])
                if cp and max(p[1] for p in cp) > 5.0:            # 细长三角（邻边压顶 / 檐）只取 d ≤ 5 m 的部分
                    cp = [(q[1], q[0]) for q in _clip_s([(p[1], p[0]) for p in cp], -1e9, 5.0)]
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
_glass_c = _comps_by_mat('glass')
# ---------- 通行老街（tunnel=building_passage，A2 2026-09-26）：底层店面玻璃覆盖的断言范围扣除通道段 ----------
# 通道段由 layout + inputs/overpass.json 重算（与 build_tower 让位切口 / repair-layout / build-scene cutPassages
# 同口径）；生成器已在条带内让位，通道是设计开口不是店面，覆盖率分母按扣除通道段后的临街边长计。
try:
    _ov = json.load(open(os.path.join(ROOT, 'inputs', 'overpass.json'), encoding='utf-8'))
    _otags = {o['id']: o.get('tags', {}) for o in _ov['elements'] if o.get('type') == 'way'}
except FileNotFoundError:
    _otags = {}
_PASSAGE_RECTS = []
for _o in LAYOUT['objects']:
    if _otags.get((_o.get('sources') or {}).get('osmWay'), {}).get('tunnel') != 'building_passage':
        continue
    _line = _o['geometry']['polyline']
    _w = max(3.4, _o['geometry']['width'] + .4)
    for _a, _b in zip(_line, _line[1:]):
        _dx, _dz = _b[0] - _a[0], _b[1] - _a[1]
        _Ll = math.hypot(_dx, _dz)
        if _Ll < 1e-6:
            continue
        _u = (_dx / _Ll, _dz / _Ll)
        _nn = (-_u[1], _u[0])
        _e = .5
        _PASSAGE_RECTS.append(
            [[_a[0] - _u[0] * _e + _nn[0] * _w / 2, _a[1] - _u[1] * _e + _nn[1] * _w / 2],
             [_b[0] + _u[0] * _e + _nn[0] * _w / 2, _b[1] + _u[1] * _e + _nn[1] * _w / 2],
             [_b[0] + _u[0] * _e - _nn[0] * _w / 2, _b[1] + _u[1] * _e - _nn[1] * _w / 2],
             [_a[0] - _u[0] * _e - _nn[0] * _w / 2, _a[1] - _u[1] * _e - _nn[1] * _w / 2]])

def _strip_ivs(A, B, L, t, n, inset):
    """临街边（含墙面内缩 inset 处）被通行条带覆盖的 s 区间（layout+overpass 重算）。"""
    step = 0.05
    ivs, cur = [], None
    for j in range(int(L / step) + 2):
        s = min(L, j * step)
        inr = False
        for off in (0.0, inset):
            px, pz = A[0] + t[0] * s - n[0] * off, A[1] + t[1] * s - n[1] * off
            if any(point_in_poly((px, pz), r) for r in _PASSAGE_RECTS):
                inr = True
                break
        if inr:
            cur = [s, s] if cur is None else [cur[0], s]
        elif cur is not None:
            ivs.append(tuple(cur))
            cur = None
    if cur is not None:
        ivs.append(tuple(cur))
    return [(max(0.0, a - step / 2), min(L, b + step / 2)) for a, b in ivs]

_INSET = PRM.get('massing', {}).get('wallInsetM', 0.3)
for k, st, A, B in STREET_EDGES:
    L, t, n = edge_frame_map(A, B)
    exc = _strip_ivs(A, B, L, t, n, _INSET)
    # 自由段 = 全边扣除通道条带后的 s 区间（分母口径，A2 2026-09-26）
    free_ivs, _cur = [], 0.0
    for a_, b_ in sorted(exc):
        if a_ - _cur > 1e-9:
            free_ivs.append((_cur, a_))
        _cur = max(_cur, b_)
    if L - _cur > 1e-9:
        free_ivs.append((_cur, L))
    free = sum(b_ - a_ for a_, b_ in free_ivs)
    # 分子同样只计自由段：玻璃连通分量 s 区间（与 coverage() 同一筛选：分量全顶点向内 0.1–2.6 m、高 0–6 m）
    # 与自由段逐段求交后取并长——通道条带里的玻璃不计入分子（主控 2026-09-27 口径核对：不许用整边玻璃
    # 长度除自由段长度把通道内玻璃算进分子）。
    givs = []
    for c in _glass_c:
        sd = [s_d(A, t, n, p[0], p[2]) for p in c]
        if all(0.1 <= d <= 2.6 for _, d in sd) and all(0.0 <= p[1] <= 6.0 for p in c):
            a_, b_ = max(0.0, min(x for x, _ in sd)), min(L, max(x for x, _ in sd))
            if b_ > a_:
                givs.append((a_, b_))
    num_ivs = sorted((max(ga, fa), min(gb, fb)) for ga, gb in givs for fa, fb in free_ivs if min(gb, fb) > max(ga, fa))
    num, _cp = 0.0, None
    for a_, b_ in num_ivs:
        if _cp and a_ <= _cp[1]:
            _cp[1] = max(_cp[1], b_)
        else:
            if _cp:
                num += _cp[1] - _cp[0]
            _cp = [a_, b_]
    if _cp:
        num += _cp[1] - _cp[0]
    if os.environ.get('T10B_DEBUG'):
        print('T10B_DEBUG v%d %s: L=%.2f 通道=%s 自由段=%s 玻璃区间=%s 分子=%.2f'
              % (k, st, L, ['%.2f-%.2f' % r for r in exc], ['%.2f-%.2f' % r for r in free_ivs],
                 ['%.2f-%.2f' % r for r in givs], num))
    if free <= 0.5:      # 自由段不足一开间（< 0.5 m），物理上放不下任何店面构件——本边无店面要求，非跳过检查
        ok('test10b 临街边 v%d（%s，%.1f m，通道段 %.1f m）自由段 %.2f m < 0.5 m 不足以设店面'
           % (k, st, L, L - free, free), True)
    else:
        cov_free = num / free
        ok('test10b 临街边 v%d（%s，%.1f m，其中通行通道段 %.1f m）底层店面玻璃覆盖 %.0f%% ≥ 50%%（分子=自由段玻璃 %.2f m / 自由段 %.2f m）'
           % (k, st, L, L - free, cov_free * 100, num, free), cov_free >= 0.5)

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
            if w >= min_w and -2.5 <= min(dd) and max(dd) <= 3.0:
                out.append({'w': w, 's': (max(ss) + min(ss)) / 2 / L, 'z0': min(p[1] for p in c), 'z1': max(p[1] for p in c)})
    return out
if ID == 'bld-428202601':                                  # 天裕楼
    A, B, L, t, n = front_edge()
    sl = _comps_by_mat('slats')
    levels = sorted({round(min(p[1] for p in c), 1) for c in sl})
    ok('test11a 天裕楼 直棂栏杆外廊楼层数 %d ≥ 3（底标高 %s）' % (len(levels), levels), len(levels) >= 3)
    covs = {}
    for h in levels:
        cv_ = coverage([c for c in sl if abs(min(q[1] for q in c) - h) < 0.06], A, B, -1.6, 0.6)
        if cv_ > 0:
            covs[h] = cv_
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
    cv_ = coverage(_comps_by_mat('signred'), A, B, -0.3, 0.8, 2.5, 4.6)
    ok('test11a 悦宾楼 前街（粮厅路）底层红色招牌带覆盖 %.0f%% ≥ 50%%' % (cv_ * 100), cv_ >= 0.5)
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
elif ID == 'bld-428202603':                                # 上海老饭店（wave7 B2：按 2023 翻新文字资料重建，无实拍）
    A, B, L, t, n = front_edge()
    gil = [v for n_ in meshes if any('gild' in mn for mn in n_.get('mats', [])) for v in world_verts(n_)]
    top = max(all_w, key=lambda v: v[1])
    gtop = max((v[1] for v in gil), default=0.0)
    wtop = max((v[1] for n_ in meshes if n_['name'].startswith('walls__') for v in world_verts(n_)), default=0.0)
    # 11a：不是老庙黄金银楼的金色宝顶转角塔——最高点不是鎏金件，鎏金件都不高于墙顶（layout height）+ 1 m
    ok('test11a 上海老饭店 无金色宝顶塔：最高点 %.2f m 非鎏金，鎏金件最高 %.2f ≤ 墙顶 %.1f + 1 m' % (top[1], gtop, obj['height']),
       gtop <= obj['height'] + 1.0 and (not gil or abs(top[1] - gtop) > 1e-6))
    # 11b：商城语汇——沿旧校场路（params 前街边）每层外廊（直棂栏杆），≥ 3 个标高、每层通长 ≥ 60 %
    sl = _comps_by_mat('slats')
    levels = sorted({round(min(p[1] for p in c), 1) for c in sl})
    covs = {h: coverage([c for c in sl if abs(min(q[1] for q in c) - h) < 0.06], A, B, -1.6, 0.6) for h in levels}
    good = [h for h, c in covs.items() if c >= 0.6]
    ok('test11b 上海老饭店 旧校场路外廊 %d 层 ≥ 3（通长 ≥ 60%%：%s）' % (len(good), {h: '%.0f%%' % (c * 100) for h, c in covs.items()}), len(good) >= 3)
    # 11c：层数 / 墙顶照 layout（4 层 13.6 m）：墙体件最高 = layout height ± 0.2
    ok('test11c 上海老饭店 墙顶 %.2f m = layout %.1f m ± 0.2（%d 层）' % (wtop, obj['height'], obj.get('levels')), abs(wtop - obj['height']) <= 0.2)

# ---------- test 12：匾额 / 招牌是空板（材质无贴图 = 无字）；模块里没有带贴图的匾 ----------
_board = [m for k, m in mats.items() if any(x in k for x in ('dark', 'gild', 'signred'))]
_tex_board = [m['name'] for m in _board if 'baseColorTexture' in m.get('pbrMetallicRoughness', {})]
_pl_nodes = [n_ for n_ in meshes if n_['name'].startswith('plaques__')]
if _pl_nodes or _mat_used('signred'):
    ok('test12 匾额 / 招牌材质无贴图（空板，不写字）：%d 种材质' % len(_board), not _tex_board, str(_tex_board))
else:
    ok('test12 匾额 / 招牌存在', False, '无 plaques__* 节点与 signred 材质')
# ---------- test 13：挂落描金、底层玻璃「看得出」（wave4 B5：主控复验华宝楼 R2——描金在渲染里看不出、底层玻璃偏暗） ----------
# 等效反照率（线性）：挂落带 = 棂条覆盖率 × 金色亮度 + (1 − 覆盖率) × 衬底亮度；店面玻璃 = α × 玻璃亮度 + (1 − α) × 玻璃后衬底（亮度 + 自发光）。
# 覆盖率从 GLB 里内嵌的 alpha 贴图实测（PIL 解码），颜色取 GLB 材质 baseColorFactor / emissiveFactor——不读模块自报数字。
def _img_of_material(m):
    ti = m.get('pbrMetallicRoughness', {}).get('baseColorTexture', {}).get('index')
    if ti is None:
        return None
    src = gj['textures'][ti]['source']
    im = gj['images'][src]
    bv = gj['bufferViews'][im['bufferView']]
    raw = open(GLB, 'rb').read()
    jl_ = struct.unpack_from('<I', raw, 12)[0]
    off = 20 + jl_ + 8 + bv.get('byteOffset', 0)
    import io
    from PIL import Image
    return Image.open(io.BytesIO(raw[off:off + bv['byteLength']]))
def _fac(m):
    return m.get('pbrMetallicRoughness', {}).get('baseColorFactor', [1, 1, 1, 1])
_gm = next((m for k, m in mats.items() if 'guoluo' in k), None)
_fascia_mats = [mn for n_ in meshes if n_['name'].startswith('fascia__') for mn in n_.get('mats', [])]
if _gm is None:
    skip('test13a 挂落', '无挂落材质')
else:
    img = _img_of_material(_gm).convert('RGBA')
    px = [q for q in img.getdata() if q[3] >= 128]
    fill = len(px) / (img.width * img.height)
    def _l(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    texel = [sum(_l(q[i]) for q in px) / max(1, len(px)) for i in range(3)]     # 棂条贴图本身的颜色（R2 把金色烘在贴图里）
    back_name = next((mn for mn in _fascia_mats if 'guoluo' not in mn and 'gild' not in mn and 'caihua' not in mn), None)
    bm_ = mats.get(back_name, {}) if back_name else {}
    back_l = _lum(_fac(bm_)) * (0.35 if 'baseColorTexture' in bm_.get('pbrMetallicRoughness', {}) else 1.0)   # 木纹贴图均值约 0.35
    gold = _lum([f * t for f, t in zip(_fac(_gm), texel)])
    eff = fill * gold + (1 - fill) * back_l
    ok('test13a 挂落描金带等效反照率 %.3f ≥ 0.15（棂条覆盖 %.2f、金 %.3f、衬底 %s %.3f）' % (eff, fill, gold, back_name, back_l),
       eff >= 0.15)
# test13c 挂落 / 彩画带整条在一层檐口外缘下沿以下（高于这条线的墙面从街道眼高永远被檐口挡住）：
# 檐口下沿 = 一层层顶 − (drop + tileH + boardH)，一层层高与檐口参数取 params（输入），带的标高取 GLB 实测
_h1 = PRM['massing']['storeyHeightsM'][0]
_ek = dict(PRM['eaveKit']); _ek.update((PRM.get('eaveKitByStorey') or {}).get('1', {}))
_lip = _h1 - (_ek['drop'] + _ek['tileH'] + _ek['boardH'])
_bands = [v[1] for n_ in meshes if n_['name'].startswith('fascia__') and any(k in mn for mn in n_.get('mats', []) for k in ('guoluo', 'caihua'))
          for v in world_verts(n_)]
if _bands:
    ok('test13c 挂落 / 彩画带顶 %.2f m ≤ 一层檐口下沿 %.2f m（街道眼高看得见）' % (max(_bands), _lip), max(_bands) <= _lip + 0.005)
else:
    skip('test13c 挂落 / 彩画带', '无 fascia 挂落 / 彩画带')
_glm = next((m for k, m in mats.items() if 'glass' in k), None)
if _glm is None:
    skip('test13b 店面玻璃', '无玻璃材质')
else:
    al = _fac(_glm)[3]
    sb = next((m for k, m in mats.items() if 'shopback' in k), None)
    if sb:
        behind = _lum(_fac(sb)) + _lum(sb.get('emissiveFactor', [0, 0, 0]))
        what = 'shopback'
    else:
        wm_ = next((m for k, m in mats.items() if k.startswith('btk-wall')), {})
        behind = _lum(_fac(wm_)) * 0.8 if wm_ else 0.0            # 抹灰贴图均值约 0.8
        what = 'wall'
    eff = al * _lum(_fac(_glm)) + (1 - al) * behind
    ok('test13b 底层玻璃等效亮度 %.3f ≥ 0.20（α %.2f、玻璃 %.3f、后衬 %s %.3f）' % (eff, al, _lum(_fac(_glm)), what, behind), eff >= 0.20)

# ---------- test 14：共享端腰檐端头收口（wave6-eavekit E3；params sharedEdgeEaveEnd=endcap 的楼，现为华宝楼） ----------
# 收口 = 檐口在共享段起点直接收住，不再沿墙内侧回折 / 内收（旧做法：环线内收 over+chu+0.05，檐在墙内走一圈，
# 回折处是带起翘的阳角，航拍看到方形截断）。判据（layout 重算）：瓦面（eaves__* 节点的 roof 材质件）三角形心
# 都不在墙线以内（footprint 内缩 wallInsetM + 0.05）；并且每条共享边上都没有腰檐瓦面（形心离共享段 ≤ 出檐 + 0.5 m 的
# 投影不落在共享段 [lo+0.05, hi-0.05] 内）。
if PRM.get('sharedEdgeEaveEnd') == 'endcap':
    _inset = PRM['massing']['wallInsetM'] + 0.05
    _over = PRM['eaveKit']['over']
    _tile_nodes = [nd for nd in meshes if nd['name'].startswith('eaves__') and any('roof' in mn for mn in nd.get('mats', []))]
    _inside = _near_shared = _ntri = 0
    for nd in _tile_nodes:
        wv = world_verts(nd)
        for (ia, ib, ic) in nd['idxTris']:
            _ntri += 1
            cx = (wv[ia][0] + wv[ib][0] + wv[ic][0]) / 3
            cz = (wv[ia][2] + wv[ib][2] + wv[ic][2]) / 3
            if point_in_poly((cx, cz), FP, tol=-_inset):
                _inside += 1
            for e in SHARED_L:
                s_ = (cx - e['a'][0]) * e['t'][0] + (cz - e['a'][1]) * e['t'][1]
                d_ = (cx - e['a'][0]) * e['n'][0] + (cz - e['a'][1]) * e['n'][1]
                # wave7：墙线以内（d < −wallInset − 0.05）的瓦面是相邻非共享边在转角处的腰檐，不算「共享段上出檐」（test14a 另管内收）
                if e['lo'] + 0.05 < s_ < e['hi'] - 0.05 and -_inset <= d_ <= _over + 0.5:
                    _near_shared += 1
                    break
    if PRM['massing'].get('upperPlan'):          # wave7：上层只在部分平面上起（老饭店后楼）的楼，上层腰檐本来就在 footprint 墙线以内
        skip('test14a 共享端腰檐收口（墙线以内瓦面 %d / %d）' % (_inside, _ntri), 'params.massing.upperPlan：上层腰檐合法地落在墙线以内，此判据不适用')
    else:
        ok('test14a 共享端腰檐收口：腰檐瓦面三角 %d 个里在墙线以内（内收 / 回折）的 %d 个 = 0' % (_ntri, _inside), _ntri > 0 and _inside == 0)
    if SHARED_L:
        ok('test14b 共享段（%d 段）上不出腰檐瓦面（贴着共享段的瓦面三角 %d 个 = 0）' % (len(SHARED_L), _near_shared), _near_shared == 0)
    else:                                                # wave7：endcap 口径也用于无共享边的楼（附属屋面接管段断檐）
        skip('test14b 共享段上不出腰檐瓦面', 'layout 检出本栋无共享边')
else:
    skip('test14 共享端腰檐收口', 'params 未设 sharedEdgeEaveEnd=endcap')

# ---------- test 16：共享边规则（hall-kit 口径，wave7 B 主控定）逐段：(a) 任何三角越过共享段 ≤ 0.02 m；
#            (b) 檐口在共享段处断开收口——任何瓦面（腰檐 / 披檐 / 附属屋面 / 主屋面的 roof 材质三角；封火墙压顶除外）
#            形心投影在共享段内 (lo+0.05, hi−0.05) 时离共享边线向内 ≥ 0.30 m、且不在线外 ----------
_ek16 = PRM['eaveKit']['over']
for e in SHARED_L:
    worst, nearbad, where, nearwho = -1e9, 0, '', ''
    for nd in meshes:
        wv = world_verts(nd)
        is_tile = any('roof' in mn for mn in nd.get('mats', [])) and not nd['name'].startswith('parapet__')
        for (ia, ib, ic) in nd['idxTris']:
            tri = [((wv[ii][0] - e['a'][0]) * e['t'][0] + (wv[ii][2] - e['a'][1]) * e['t'][1],
                    (wv[ii][0] - e['a'][0]) * e['n'][0] + (wv[ii][2] - e['a'][1]) * e['n'][1]) for ii in (ia, ib, ic)]
            if min(p[1] for p in tri) <= 5.0 and max(p[1] for p in tri) > worst:
                cp = _clip_s(tri, e['lo'], e['hi'])
                if cp and max(p[1] for p in cp) > 5.0:
                    cp = [(q[1], q[0]) for q in _clip_s([(p[1], p[0]) for p in cp], -1e9, 5.0)]
                if cp and max(p[1] for p in cp) > worst:
                    worst = max(p[1] for p in cp)
                    where = nd['name']
            if is_tile:
                cs = sum(p[0] for p in tri) / 3
                cd = sum(p[1] for p in tri) / 3
                if e['lo'] + 0.05 < cs < e['hi'] - 0.05 and -0.30 < cd <= _ek16 + 0.5:
                    nearbad += 1
                    nearwho = nd['name']
    ok('test16a 共享段 fpEdge %d / %s（%.2f m）最大越界 %.3f m ≤ 0.02（最越者 %s）' % (e['edge'], e['other'], e['hi'] - e['lo'], worst, where),
       worst <= 0.02)
    ok('test16b 共享段 fpEdge %d / %s 檐口断开收口：贴线瓦面三角 %d = 0 %s' % (e['edge'], e['other'], nearbad, nearwho), nearbad == 0)
if not SHARED_L:
    skip('test16 共享边规则', 'layout 检出本栋无共享边')

# ---------- test 15：航拍看不到平屋顶带（wave7 K0）：正上方正交俯视 z-buffer（roof_cover.py，只读 GLB 网格与 layout footprint），
#            footprint 内最上层是瓦面或坡面的像素 ≥ 97%；最上层是水平（|法线 z| > 0.99）非瓦面的像素 ≤ 3% ----------
sys.path.insert(0, HERE)
import roof_cover as RC                                    # noqa: E402
_rc = RC.raster(RC.load_glb(GLB, ID, zone_subtree=(SOURCE == 'zone')), [tuple(q) for q in FP], px=0.1)
_rc_s = '瓦 %.1f%% + 坡 %.1f%%、平 %.1f%%、空 %.1f%%；平面来源 %s' % (
    _rc['tile'] * 100, _rc['slope'] * 100, _rc['flat'] * 100, _rc['empty'] * 100,
    {k: v for k, v in list(_rc['flatM2ByNode'].items())[:4]})
if PRM.get('roofCoverExempt'):
    skip('test15 航拍屋面覆盖 %.1f%%（%s）' % (_rc['roofCover'] * 100, _rc_s), 'params.roofCoverExempt：' + PRM['roofCoverExempt'])
else:
    ok('test15a 俯视屋面覆盖 %.1f%% ≥ 97%%（%s）' % (_rc['roofCover'] * 100, _rc_s), _rc['roofCover'] >= 0.97)
    ok('test15b 俯视平屋顶 %.1f%% ≤ 3%%' % (_rc['flat'] * 100), _rc['flat'] <= 0.03)

# ---------- test 17：楼上窗背板专用材质（wave12-towerwin W1；wave12-towerwin2 扩 screen/band 拆段）----------
# 契约：
#   a) windows__winback* 节点材质 = btk-winback 家族：wood 段 → btk-winback；非 wood timber 段 →
#      btk-winback-<timber>（着色参数与该 timber 完全相同，extras pbRole=window-backing）；节点名族
#      （windows__ 后的部分）与材质族一致。
#   b) 背板只盖格心覆盖段（towerwin2 拆段）：btk-winback 家族材质不得出现在 windows__winback* 之外的节点；
#      且每个 windows__winback* 节点几何 y 下沿 ≥ 本楼格心节点（windows__lattice*）y 下沿 − 0.005——
#      改动前 window() 的 winb-* 是整块背板，下沿伸到格心底以下约 (1−lf)·(h+0.14)（实心段无格心遮挡，
#      夜间随背板裸亮，T0 缺陷）。拆段后 lit 段与格心同底（win-*/winleaf-*/bandleaf-* 三类逐一成立），
#      全楼取 min 后等号成立。
#   c) 数量对账：windows__winback* 节点三角 //2 = 生成器三类出板调用计数之和
#      （measurements.windowBackingCalls + screenBackingCalls + bandBackingCalls，后两类 towerwin2 新增），
#      并逐 timber 族对账：windows__winback ↔ winbackByTimber.wood、windows__winback-<t> ↔ .<t>，
#      族和 = 三类和（互为守恒）。期望值来源 = 生成器调用计数（W1 test17b 同口径，GOAL 认可的独立来源）。
#   d) 底层店面背板 shop-back-* 仍是原材质 btk-shopback（W1 不动店面）。
# 材质名从 raw GLB 逐 primitive 解析；每块 lit 背板 = 1 个 rpanel 四边形 = 2 三角，节点三角数 // 2 = 块数。
# 分区 GLB（--source zone）里 assemble 合并多楼后 Blender 给重名材质/节点加 .001 数字后缀（对所有 btk-* 一致），
# 故按基名匹配容忍该后缀；模块 GLB（默认 --source module）是精确名。高度轴 = glTF Y-up 的 y。
def _mat_is(name, base):
    return name == base or (name.startswith(base + '.') and name[len(base) + 1:].isdigit())
def _base(nm):
    return nm[:-4] if len(nm) > 4 and nm[-4] == '.' and nm[-3:].isdigit() else nm
_wb_nodes = [n_ for n_ in meshes if n_['name'].startswith('windows__winback')]
_wb_fam = lambda n_: _base(n_['name'])[len('windows__'):]          # 'winback' / 'winback-<timber>'
_wb_fam_bad = [(n_['name'], mn) for n_ in _wb_nodes for mn in n_['mats'] if not _mat_is(mn, 'btk-' + _wb_fam(n_))]
_wb_mats = sorted({mn for n_ in _wb_nodes for mn in n_.get('mats', [])})
_wb_cnt = sum(n_['tris'] for n_ in _wb_nodes) // 2
_wb_expect = _meas.get('windowBackingCalls')
_sb_cnt = _meas.get('screenBackingCalls')
_bb_cnt = _meas.get('bandBackingCalls')
_wb_timber = _meas.get('winbackByTimber')
if not _wb_nodes and _wb_expect in (0, None):
    skip('test17a/17b/17d 楼上窗背板', '本楼无 window() 背板（全 band 样式且无角塔，生成器计数 = 0）')
else:
    ok('test17a 楼上窗背板材质族 = btk-winback*（%d 块，材质 %s）' % (_wb_cnt, _wb_mats),
       bool(_wb_nodes) and not _wb_fam_bad,
       'windows__winback* 节点缺失或材质族与节点名不一致（应为 btk-winback / btk-winback-<timber>）: %s' % (_wb_fam_bad[:4],))
    _calls_missing = [f for f, v in (('windowBackingCalls', _wb_expect), ('screenBackingCalls', _sb_cnt),
                                     ('bandBackingCalls', _bb_cnt)) if v is None]
    ok('test17b 窗背板数量 %d = window(%s)+screen(%s)+band(%s) 出板调用计数' % (_wb_cnt, _wb_expect, _sb_cnt, _bb_cnt),
       None not in (_wb_expect, _sb_cnt, _bb_cnt) and _wb_cnt == _wb_expect + _sb_cnt + _bb_cnt,
       '期望值缺失（旧版生成器产物，无 towerwin2 三类记账字段: %s）或与 GLB 背板块数不一致' % (_calls_missing,))
    _fam_cnt = {t: sum(n_['tris'] for n_ in _wb_nodes if _wb_fam(n_) == ('winback' if t == 'wood' else 'winback-' + t)) // 2
                for t in (_wb_timber or {})}
    ok('test17d 逐 timber 族对账 %s（GLB 节点族计数 %s）' % (_wb_timber, _fam_cnt),
       _wb_timber is not None and _fam_cnt == _wb_timber and sum(_wb_timber.values()) == _wb_cnt,
       'winbackByTimber 缺失（旧版生成器产物）或某 timber 族节点三角数与计数不一致')
# b) 家族材质不出现在 windows__winback* 之外；z 下沿 ≥ 格心节点 z 下沿（实心段不带发光材质的几何不变式）
_wb_elsewhere = sorted((n_['name'], mn) for n_ in meshes if not n_['name'].startswith('windows__winback')
                       for mn in n_.get('mats', []) if _base(mn).startswith('btk-winback'))
_lat_nodes = [n_ for n_ in meshes if n_['name'].startswith('windows__lattice')]
_lat_zmin = min((min(v[1] for v in world_verts(n_)) for n_ in _lat_nodes), default=None)
_wb_zmin = min((min(v[1] for v in world_verts(n_)) for n_ in _wb_nodes), default=None)
if _wb_nodes:
    ok('test17e btk-winback 家族材质只在 windows__winback* 节点（他处 %s）' % (_wb_elsewhere or '无',),
       not _wb_elsewhere, '实心段或其他部件误挂发光材质（背板未按格心覆盖段拆分）')
    ok('test17f 背板 y 下沿 %.3f ≥ 格心下沿 %.3f − 0.005（拆段后与格心同底；改前整板下探实心段）' % (_wb_zmin, _lat_zmin),
       _lat_zmin is not None and _wb_zmin >= _lat_zmin - 0.005,
       'windows__lattice* 缺失或背板下沿低于格心下沿（winb 整板未拆段）')
else:
    skip('test17e/17f 背板范围', '本楼无 windows__winback* 背板节点')
_sb_nodes = [n_ for n_ in meshes if n_['name'].startswith('shopfront__shopback')]
_sb_mats = sorted({mn for n_ in _sb_nodes for mn in n_.get('mats', [])})
if _sb_nodes:
    ok('test17c 底层店面背板仍 = btk-shopback（材质 %s）' % (_sb_mats,),
       all(_mat_is(mn, 'btk-shopback') for mn in _sb_mats))
else:
    skip('test17c 底层店面背板', '本楼无 shopfront 店面背板')

# ---------- test 17g/17h/17n（wave13-habaowin H1；R1 按 REVIEW-astra 必修 1/2 重写；R2 按 GOAL-R2 必修 1–4 再修）----------
# 契约（GOAL：每栋楼每个格心窗段背后都有发光背板；立面边×楼层×窗型与 layout/params 独立期望对账）：
#   g) 不变式（纯 GLB 几何）：windows__lattice* 三角按「墙面局部坐标系」分段——
#      共面组（法向 dot≥0.999、离面 ≤6mm）取平均法向 n 与顶点均值参照点，建立局部系
#      （u=沿墙水平、v=高度 y、d=沿内法向深度；内侧符号 sint 用**墙面几何**定（R2 必修2）：
#      生成器格心面凸出墙面 0.045~0.055，真实墙体只在格心面内侧 0.04~0.15 m——非窗节点竖直三角
#      中该侧 u 跨并集 ≥50% 者为墙面侧（外侧只有框柱装饰面，实测 1~2%）；唯一墙面侧=内侧。
#      歧义才回退 footprint 0.6/0.15m 双距探针（恰一侧命中才定号）；两侧同真/同假不得默认 +1，
#      sint 未定的平面段全部计缺（FAIL 响亮）。sint 与三角绕向无关：整体反转格心+背板绕向，结果不变）。
#      组内先按 v 跨签名（v0、v1 各自 ≤15mm）分簇：同一生成器窗叶 v 跨严格相等；
#      同层 band 叶 [zb0,zb1] 与 ends4 窗 [zl0w,zl1w] v 跨不同、不会互并。
#      簇内按 u 间隙 ≤T_SEG 连通成段，段 u/v 范围全部取三角顶点（非面心）。
#      断言：每段背后（同法向 |dot|≥0.995、d∈[0.002,0.10]）存在 windows__winback* 三角，
#      其 (u,v) **真实面积**覆盖该段 ≥95%（R2 必修1）：背板三角投影后必须是直角边平行 u/v 轴的
#      半矩形三角，按 bbox 键归组、角点 4=完整矩形 / 3=半矩形——「第二个三角换成第一个的副本」
#      只计半块面积（实测覆盖率精确=50% → FAIL），不再把三角形扩成外接矩形。
#      分段依据（15 栋 2026-09-29 实测，v 签名簇内）：同一叶内三角 bbox 间隙 ≤0.004 m
#      （四边形对角切分 bbox 相同）；不同叶/窗间隙 ≥0.05 m（screen 扇距 = leafGapM=0.05、
#      band 条距 0.06、bay 间距 = columnSizeM+0.42=0.74）。T_SEG=0.02 居中，两侧余量 ≥2.4×。
#      段只要求被单块背板盖住，切得再细不破坏判定（每叶整体落在其背板矩形内）。
#   h) layout 独立期望对账（R2 必修3：期望带立面身份「edge×楼层×窗型」；不读生成器输出与
#      measurements）。期望来源 = layout.json（frontEdges→street/plain）+ params（styles 三级回退、
#      storeyHeightsM、frameLintelHM、长/半窗格心率、window、bandHM/bandSillM）× 立面锚定
#      _t17_anchor（(edge,storey)→立面线内距，从墙体几何锚定、与格心段无关：非窗非塔竖直三角、
#      平行该边 ≥0.995、s 整含边跨度、共享段(blank)排除、外圈 1m 内有墙只在 1m 内找、
#      深线压制 + 立面组件带 ±0.15 合并覆盖 ≥max(2.5m,0.25L) + 带内 y 盖层带 ≥95%；
#      podium 起落/斜切/塔体占位/blank 短边(<4m，15 栋实测无一开窗)自然无锚=只豁免该边该层）。
#      有锚 → 该边该层按角色类窗型立期望。认领 = 归边（±25°、内距≤12、中心投影在跨度内、
#      共线取内距最小）+ 同层 + v 跨 ±0.08（多认领：转角带一排窗服务多条边）——期望带 edge 身份
#      后别的立面不可代位（R1 审查的 street 窗带代位即关死）。锚线被占位（该边该层的归边段全部
#      disp=pav/interior 区域豁免）→ _t17_drop_occupied 核减期望（删段则核减失效、期望恢复把守）。
#      逐边期望全空但格心节点在（复合排楼 868/884 无可确定立面线）→ 回退 R1 口径角色类×层守卫
#      （17g 逐段覆盖不放宽），断言名注明 fallback。多出（必修4）：①已归属立面的段只认自身角色
#      该层允许窗型（screen 段在 plain 边=错型必抓）；②塔窗豁免三关：pav-* 包围盒（塔件删则收缩）
#      + 塔体墙盒高度（30m 伪窗超顶即拒）+ 塔体允许窗型 v 跨（_t17_pav_allowed：pav-body/tier 墙盒
#      ×生成器窗公式 body h=1.6/sill=0.9、tier h=1.5/sill=0.8）；③非立面线（内天井/podium 内墙）
#      该层任一角色类窗型 v 跨一致才豁免。期望存在而 windows__lattice*/windows__winback* 整类
#      节点缺失 → FAIL（_t17_entry_missing，不再 SKIP）。
#   n) 负例自检（仅华宝楼跑，证明 17g/17h 捕获力，全部内存突变、零重建）：
#      N1 全部背板 u 向宽度缩到 1%（中心/高度/材质不变，按顶点连通分面板）→ 17g 必须 FAIL；
#      N2 按**立面身份**定位并移除 screen 期望所在边×层的格心段（普通窗保留）→ 17h 必须缺 screen 期望；
#      N3 格心段清空（=整类节点缺失）→ 17h 必须缺全部期望；
#      N4 移除首个期望所在边的全部段 → 17h 必须缺该边全部期望（逐边独立对账把守）；
#      入口级整类缺失判据 _t17_entry_missing 独立断言（R2 可选项）。
_lat_nodes17 = [n_ for n_ in meshes if _base(n_['name']).startswith('windows__lattice')]
_wb_nodes17 = [n_ for n_ in meshes if _base(n_['name']).startswith('windows__winback')]
def _t17_tris(nodes_):
    out = []
    for nd_ in nodes_:
        wv_ = world_verts(nd_)
        for (ia_, ib_, ic_) in nd_['idxTris']:
            a_, b_, c_ = wv_[ia_], wv_[ib_], wv_[ic_]
            u_ = [b_[i] - a_[i] for i in range(3)]
            w_ = [c_[i] - a_[i] for i in range(3)]
            cr = [u_[1] * w_[2] - u_[2] * w_[1], u_[2] * w_[0] - u_[0] * w_[2], u_[0] * w_[1] - u_[1] * w_[0]]
            ln = math.sqrt(cr[0] * cr[0] + cr[1] * cr[1] + cr[2] * cr[2]) or 1.0
            out.append({'v': (a_, b_, c_), 'n': [cr[0] / ln, cr[1] / ln, cr[2] / ln]})
    return out
def _t17_wtris(exclude_pav):
    """非窗节点（排除 windows__*；exclude_pav 再排除 pav-*）的竖直三角，位置与法向一次预计算——
    sint 定号（含塔体：塔窗格心的内侧同样由塔体墙面证明）与立面线锚定（必修3 排除塔体，
    塔身墙不得锚定常规立面线）的独立几何来源；纯位置/朝向判定，与三角绕向无关。"""
    out = []
    for nd_ in meshes:
        bn_ = _base(nd_['name'])
        if bn_.startswith('windows__') or (exclude_pav and bn_.startswith('pav-')):
            continue
        V_ = world_verts(nd_)
        for (ia_, ib_, ic_) in nd_['idxTris']:
            a_, b_, c_ = V_[ia_], V_[ib_], V_[ic_]
            u_ = [b_[i] - a_[i] for i in range(3)]
            w_ = [c_[i] - a_[i] for i in range(3)]
            cr = [u_[1] * w_[2] - u_[2] * w_[1], u_[2] * w_[0] - u_[0] * w_[2], u_[0] * w_[1] - u_[1] * w_[0]]
            ln = math.sqrt(cr[0] * cr[0] + cr[1] * cr[1] + cr[2] * cr[2])
            if ln < 1e-9:
                continue
            n_ = [cr[0] / ln, cr[1] / ln, cr[2] / ln]
            if math.hypot(n_[0], n_[2]) < 0.95:      # 只留竖直面（墙面）
                continue
            out.append((a_, b_, c_, n_))
    return out
def _t17_planes(tris_, wtris_=None):
    planes = []
    for t_ in tris_:
        n_, p_ = t_['n'], t_['v'][0]
        d_ = n_[0] * p_[0] + n_[1] * p_[1] + n_[2] * p_[2]
        hit = None
        for pl_ in planes:
            if pl_['n'][0] * n_[0] + pl_['n'][1] * n_[1] + pl_['n'][2] * n_[2] >= 0.999 and abs(pl_['d'] - d_) <= 0.006:
                hit = pl_
                break
        if hit is None:
            hit = {'n': n_, 'd': d_, 'tris': []}
            planes.append(hit)
        hit['tris'].append(t_)
    for pl_ in planes:
        k_ = len(pl_['tris'])
        n_ = [sum(t_['n'][i] for t_ in pl_['tris']) / k_ for i in range(3)]
        nl_ = math.sqrt(n_[0] * n_[0] + n_[1] * n_[1] + n_[2] * n_[2]) or 1.0
        nb_raw = [n_[0] / nl_, n_[1] / nl_, n_[2] / nl_]
        vs_ = [v_ for t_ in pl_['tris'] for v_ in t_['v']]
        p0_ = [sum(v_[i] for v_ in vs_) / len(vs_) for i in range(3)]
        t2_raw = (-nb_raw[2], nb_raw[0])
        us_ = [(v_[0] - p0_[0]) * t2_raw[0] + (v_[2] - p0_[2]) * t2_raw[1] for v_ in vs_]
        ys_ = [v_[1] for v_ in vs_]
        sint_ = None
        if wtris_ is not None:
            # sint（REVIEW-astra 必修2）：不依赖绕向、不默认选边。
            # ① 墙面几何定号：生成器格心面凸出墙面 0.045~0.055（R1 实测净距 0.023~0.028 同源），
            #    即真实墙体只存在于格心面**内侧** 0.04~0.15 m 处——查非窗节点竖直三角，
            #    法向平行（≥0.995）、全部顶点带号深度 ∈[0.04,0.15]、(u,v) 与本平面格心范围交叠 ≥0.3m，
            #    该侧 u 跨并集（截到格心跨度）≥50% = 墙面侧（外侧只有框柱等细小装饰面，实测并集 1~2%）。
            #    唯一墙面侧 = 内侧。纯位置判定，三角绕向反转不改变结果。
            # ② 歧义回退 footprint 探针（0.6m/0.15m 双距）：仅当恰一侧命中才定号；
            #    两侧同真/同假（退台、塔体等深居 footprint 内的平面）不得默认 +1 → sint=None，
            #    该平面段按「内侧不可证」处理（17g 全部计缺，FAIL 响亮）。
            bb_ = (min(us_), max(us_), min(ys_), max(ys_))
            span_ = max(bb_[1] - bb_[0], 1e-6)
            uvs_ = {1: [], -1: []}
            for (a_, b_, c_, n_) in wtris_:
                if abs(n_[0] * nb_raw[0] + n_[2] * nb_raw[2]) < 0.995:
                    continue
                for sg_ in (1, -1):
                    ok_ = True
                    for v_ in (a_, b_, c_):
                        d__ = ((v_[0] - p0_[0]) * nb_raw[0] + (v_[2] - p0_[2]) * nb_raw[2]) * sg_
                        if not (0.04 <= d__ <= 0.15):
                            ok_ = False
                            break
                    if not ok_:
                        continue
                    uu_ = [(v_[0] - p0_[0]) * t2_raw[0] + (v_[2] - p0_[2]) * t2_raw[1] for v_ in (a_, b_, c_)]
                    vv_ = [v_[1] for v_ in (a_, b_, c_)]
                    if max(min(uu_), bb_[0]) - min(max(uu_), bb_[1]) >= 0.3 or \
                            max(min(vv_), bb_[2]) - min(max(vv_), bb_[3]) >= 0.3:
                        continue
                    uvs_[sg_].append((max(min(uu_), bb_[0]), min(max(uu_), bb_[1])))
            cov_ = {}
            for sg_ in (1, -1):
                tot_ = 0.0
                cur_ = None
                for a_, b_ in sorted(uvs_[sg_]):
                    if cur_ and a_ <= cur_[1]:
                        cur_[1] = max(cur_[1], b_)
                    else:
                        if cur_:
                            tot_ += cur_[1] - cur_[0]
                        cur_ = [a_, b_]
                if cur_:
                    tot_ += cur_[1] - cur_[0]
                cov_[sg_] = tot_ / span_
            side_ = [sg_ for sg_ in (1, -1) if cov_[sg_] >= 0.5]
            if len(side_) == 1:
                sint_ = side_[0]
            else:
                for dist_ in (0.6, 0.15):
                    q1 = point_in_poly((p0_[0] + dist_ * nb_raw[0], p0_[2] + dist_ * nb_raw[2]), FP, tol=0.0)
                    q2 = point_in_poly((p0_[0] - dist_ * nb_raw[0], p0_[2] - dist_ * nb_raw[2]), FP, tol=0.0)
                    if q1 != q2:
                        sint_ = 1 if q1 else -1
                        break
        pl_['nb'] = [q_ * (sint_ or 1) for q_ in nb_raw]
        pl_['p0'] = p0_
        pl_['t2'] = (-pl_['nb'][2], pl_['nb'][0])
        pl_['sint'] = sint_
        pl_['nosint'] = wtris_ is not None and sint_ is None
    return planes
def _t17_loc(pl_, v_):
    dx_, dz_ = v_[0] - pl_['p0'][0], v_[2] - pl_['p0'][2]
    return (dx_ * pl_['t2'][0] + dz_ * pl_['t2'][1], v_[1], dx_ * pl_['nb'][0] + dz_ * pl_['nb'][2])
T_SEG, T_VGRP, D_BACK, COV_MIN17 = 0.02, 0.015, (0.002, 0.10), 0.95
_WTRIS17 = _t17_wtris(False)            # sint 定号：含塔体墙面
_WTRIS_NOPAV17 = _t17_wtris(True)       # 必修3 立面线锚定：排除塔体
def _t17_cover(segs, wb_nodes, cov_min=COV_MIN17):
    """每段背后同法向背板对 (u,v) 段矩形的真实面积覆盖（REVIEW-astra 必修1，不再用三角形外接矩形）：
    背板三角投影后必须是直角边平行 u/v 轴的半矩形三角（3 顶点恰取 2 个 u 值 × 2 个 v 值）；
    按 bbox 键归组，组内并集角点数 4 = 完整矩形（互补三角对）、3 = 半矩形（单三角或副本三角——
    「每块背板第二个三角替换为第一个副本」负例：角点仍 3，只计半块面积 → 覆盖率 ≈50% → FAIL）。
    覆盖面积 = Σ 全矩形·1 + Σ 半矩形·0.5（组间重叠 >0 或非半矩形三角 >0 → 该平面账本不可信 → 段记缺）。
    深度过滤：三角全部顶点带号深度 ∈ D_BACK（nb 已规范化为内侧，镜像到格心前方的背板 d<0 被排除）。"""
    ledger = {}
    for s_ in segs:
        pl_ = s_['pl']
        key = id(pl_)
        if key not in ledger:
            groups = {}
            bad = 0
            for wl_ in _t17_planes(_t17_tris(wb_nodes)):
                if abs(wl_['nb'][0] * pl_['nb'][0] + wl_['nb'][1] * pl_['nb'][1] + wl_['nb'][2] * pl_['nb'][2]) < 0.995:
                    continue
                for t_ in wl_['tris']:
                    ls_ = [_t17_loc(pl_, v_) for v_ in t_['v']]
                    if not all(D_BACK[0] <= q_[2] <= D_BACK[1] for q_ in ls_):
                        continue
                    us_ = sorted({round(q_[0], 3) for q_ in ls_})
                    vs_ = sorted({round(q_[1], 3) for q_ in ls_})
                    if len(us_) != 2 or len(vs_) != 2:
                        bad += 1
                        continue
                    g_ = groups.setdefault((us_[0], us_[1], vs_[0], vs_[1]), set())
                    g_.update((round(q_[0], 3), round(q_[1], 3)) for q_ in ls_)
            full, half = [], []
            for (u0_, u1_, v0_, v1_), cs_ in groups.items():
                if len(cs_) == 4:
                    full.append((u0_, u1_, v0_, v1_))
                elif len(cs_) == 3:
                    half.append((u0_, u1_, v0_, v1_))
                else:
                    bad += 1
            rects = full + half
            ov = 0
            for i_ in range(len(rects)):
                for j_ in range(i_ + 1, len(rects)):
                    a_, b_ = rects[i_], rects[j_]
                    if not (b_[1] <= a_[0] or a_[1] <= b_[0] or b_[3] <= a_[2] or a_[3] <= b_[2]):
                        ov += 1
            ledger[key] = {'full': full, 'half': half, 'bad': bad, 'ov': ov}
            if os.environ.get('BTK17_DEBUG') and (bad or ov or pl_.get('nosint')):
                print('DEBUG17 plane p0=%s nb=%s nosint=%s backing: full=%d half=%d bad=%d ov=%d' % (
                    [round(q, 2) for q in pl_['p0']], [round(q, 2) for q in pl_['nb']],
                    pl_.get('nosint'), len(full), len(half), bad, ov))
        L_ = ledger[key]
        if L_['bad'] or L_['ov'] or pl_.get('nosint'):
            s_['cov'] = -1.0
            continue
        area = (s_['u1'] - s_['u0']) * (s_['v1'] - s_['v0'])
        tot = 0.0
        for r_ in L_['full']:
            w_ = min(r_[1], s_['u1']) - max(r_[0], s_['u0'])
            h_ = min(r_[3], s_['v1']) - max(r_[2], s_['v0'])
            if w_ > 0 and h_ > 0:
                tot += w_ * h_
        for r_ in L_['half']:
            w_ = min(r_[1], s_['u1']) - max(r_[0], s_['u0'])
            h_ = min(r_[3], s_['v1']) - max(r_[2], s_['v0'])
            if w_ > 0 and h_ > 0:
                tot += 0.5 * w_ * h_
        s_['cov'] = tot / area if area > 1e-9 else 0.0
    miss = [s_ for s_ in segs if s_['cov'] < cov_min]
    return miss, (min((s_['cov'] for s_ in segs), default=1.0), max((s_['cov'] for s_ in segs), default=1.0)), len(segs) - len(miss)
def _t17_segments(lat_nodes):
    """格心 → 段（v 签名簇 + u 间隙连通）。段={'u0','u1','v0','v1','pl','cx','cz','ntri'}。"""
    segs = []
    for pl_ in _t17_planes(_t17_tris(lat_nodes), _WTRIS17):
        vgroups = []
        for t_ in pl_['tris']:
            vs_ = [_t17_loc(pl_, v_) for v_ in t_['v']]
            u0_, u1_ = min(q[0] for q in vs_), max(q[0] for q in vs_)
            vy0_, vy1_ = min(q[1] for q in vs_), max(q[1] for q in vs_)
            hit = None
            for g_ in vgroups:
                if abs(g_['v0'] - vy0_) <= T_VGRP and abs(g_['v1'] - vy1_) <= T_VGRP:
                    hit = g_
                    break
            if hit is None:
                hit = {'v0': vy0_, 'v1': vy1_, 'ivs': []}
                vgroups.append(hit)
            hit['ivs'].append((u0_, u1_))
        for g_ in vgroups:
            ivs = sorted(g_['ivs'])
            segs_ = []
            for u0_, u1_ in ivs:
                if segs_ and u0_ - segs_[-1][1] <= T_SEG:
                    segs_[-1][1] = max(segs_[-1][1], u1_)
                else:
                    segs_.append([u0_, u1_])
            for (u0_, u1_) in segs_:
                if (u1_ - u0_) * (g_['v1'] - g_['v0']) < 0.005:
                    continue
                um_ = (u0_ + u1_) / 2
                segs.append({'u0': u0_, 'u1': u1_, 'v0': g_['v0'], 'v1': g_['v1'], 'pl': pl_,
                             'cx': pl_['p0'][0] + pl_['t2'][0] * um_, 'cz': pl_['p0'][2] + pl_['t2'][1] * um_,
                             'ntri': len(pl_['tris'])})
    return segs

# ---- 17h：layout+params 独立期望（哪面墙、哪层、什么窗型、格心 v 跨应是多少） ----
_eq17 = lambda p_, q_: abs(p_[0] - q_[0]) <= 0.02 and abs(p_[1] - q_[1]) <= 0.02   # 同 build_tower._same 口径
_FE17 = set()
for _fe in obj.get('frontEdges', []):
    _e = _fe['edge']
    if _fe.get('lenM', 0) < 1.5:
        continue
    for _i in range(len(FP)):
        _A, _B = FP[_i], FP[(_i + 1) % len(FP)]
        if (_eq17(_e[0], _A) and _eq17(_e[1], _B)) or (_eq17(_e[0], _B) and _eq17(_e[1], _A)):
            _FE17.add(_i)
_blk17 = (PRM.get('massing') or {}).get('blocks') or [{}]
_ST17 = next((b_.get('styles') for b_ in _blk17 if b_.get('styles')), None)
if _ST17 is None:
    _ST17 = (PRM.get('facades') or {}).get('styles')
_LEG17 = {'street': {'1': {'style': 'shop'}, '2': {'style': 'screen'}, '3': {'style': 'screen'}, '4': {'style': 'half'}},
          'plain': {'1': {'style': 'blank'}, '2': {'style': 'ends'}, '3': {'style': 'ends'}, '4': {'style': 'ends4'}}}
if _ST17 is None:
    _ST17 = _LEG17
_FA17 = PRM.get('facades') or {}
_MS17 = PRM.get('massing') or {}
_LH17 = _FA17.get('frameLintelHM', 0.25)
_LFL17 = _FA17.get('longWindowLatticeFrac', 0.62)
_LFH17 = _FA17.get('halfWindowLatticeFrac', 0.5)
_W17 = _FA17.get('window') or {}
_WW17, _WH17, _WS17 = _W17.get('widthM', 1.7), _W17.get('heightM', 1.9), _W17.get('sillM', 0.9)
_SH17 = _MS17.get('storeyHeightsM') or [4.0]
_ZT17 = [0.0]
for _h in _SH17:
    _ZT17.append(_ZT17[-1] + _h)
_N17 = len(_SH17)
def _style17(role_, storey_):
    if role_ == 'shared':
        return {'style': 'blank'}
    if role_ == 'internal':
        role_ = 'plain' if 'internal' not in _ST17 else 'internal'
    tab_ = _ST17.get(role_) or _ST17.get('plain') or {}
    s_ = tab_.get(str(storey_)) or tab_.get('*') or {'style': 'blank'}
    return dict(s_)
def _t17_expect():
    """「立面边 id × 楼层 × 窗型」期望（R2 必修3，带立面身份）：
      - 对每个 (edge k, storey st≥2)：立面线 = _ANCH17[(k, st)]（墙体几何锚定，与格心段无关——
        删窗段不动锚）；无锚 = podium 起落 / 退台斜切 / 塔体占位，**只豁免该边该层**；
      - 有锚 → role = street/plain（k ∈ frontEdges）、窗型与格心 v 跨 = _t17_vrange（layout+params
        公式与生成器一致）；v 跨 None（blank/带高不足）→ 该边该层无期望。
      期望条目 {'edge','cls','role','storey','v0','v1'}——别的立面的段不可代位（认领须 edge 相同）。"""
    exps = []
    for (k_, st_), off_ in sorted(_ANCH17.items()):
        A_, B_ = FP[k_], FP[(k_ + 1) % len(FP)]
        if math.hypot(B_[0] - A_[0], B_[1] - A_[1]) < 4.0:
            continue          # <4m 短边：15 栋实测无一开窗（最短有窗立面边 4.8m）——转角余量/柱廊断片
        role_ = 'street' if k_ in _FE17 else 'plain'
        kind_, vr_ = _t17_vrange(role_, st_)
        if vr_ is None:
            continue
        exps.append({'edge': k_, 'cls': kind_, 'role': role_, 'storey': st_, 'v0': vr_[0], 'v1': vr_[1]})
    return exps
def _t17_win_range(z, ztop, h, sill, lf):
    """生成器 win 类格心 v 跨公式（与 window() 一致）：窗台 z0=sill，窗高顶到 ztop−0.25 止。"""
    z0 = z + sill
    if z0 + h > ztop - 0.25:
        h = ztop - 0.25 - z0
    if h >= 0.8:
        return (z0 - 0.07 + (1.0 - lf) * (h + 0.14), z0 + h + 0.03)
    return None
def _t17_anchor():
    """(edge k, storey st) → 常规立面线内距（R2 必修3，从墙体几何锚定、与格心段无关）。
    候选 = _WTRIS_NOPAV17（非窗非塔）：法向平行该边 ≥0.995（真立面与 FP 边共向；退台斜切墙
    >5.7° 自动排除=斜切区不锚即只豁免斜切区域）、全部顶点在角塔水平范围外（塔体占位不锚）、
    s 区间整含边跨度（±0.3）且不落在该边**共享带**内（生成器 classify 把贴邻栋墙线 ≤WALLI+0.6
    的墙跑标 shared → blank 无窗；测试取同口径 0.6m 宽共享带 _SHARED_WIDE17，比 test9 的
    0.05m 共面宽——873 gallery 排楼邻栋相距 0.1~0.3m，窄口径漏判会把共享 blank 墙误锚成缺窗
    立面）、内距 ∈[-0.15,12]（立面粉面不出 FP 线 0.15）、y 与层带 [ZT+0.3, ZT+1−0.3] 重叠
    ≥0.5m；按 5cm 内距桶聚合 s 跨度并集，覆盖 ≥ max(2.5m, 0.25·L) 的桶里取内距最小（最外）
    者 = 该边该层的立面线。"""
    out = {}
    if not _WTRIS_NOPAV17:
        return out
    for k_ in range(len(FP)):
        A, B = FP[k_], FP[(k_ + 1) % len(FP)]
        L, t_, nn = edge_frame_map(A, B)
        gate = max(2.5, 0.25 * L)
        sh_ = [(e_['lo'] - 0.3, e_['hi'] + 0.3) for e_ in SHARED_L if e_['edge'] == k_]
        for st_ in range(2, _N17 + 1):
            ylo, yhi = _ZT17[st_ - 1] + 0.3, _ZT17[st_] - 0.3
            if yhi - ylo < 0.5:
                continue
            buckets = {}
            near_wall = False      # 外圈 1m 内有墙：立面线只能在 1m 内找（内院墙不得冒充 FP 边立面）
            cands = []
            for (a_, b_, c_, n_) in _WTRIS_NOPAV17:
                if abs(n_[0] * nn[0] + n_[2] * nn[1]) < 0.995:
                    continue
                ys_ = (a_[1], b_[1], c_[1])
                if min(max(ys_), yhi) - max(min(ys_), ylo) < 0.5:
                    continue
                if _TOW17 and all(point_in_poly((v_[0], v_[2]), _TOW17, tol=0.0) for v_ in (a_, b_, c_)):
                    continue
                off = -(((a_[0] + b_[0] + c_[0]) / 3 - A[0]) * nn[0] + ((a_[2] + b_[2] + c_[2]) / 3 - A[1]) * nn[1])
                if off < -0.15 or off > 12.0:
                    continue
                ss_ = [(v_[0] - A[0]) * t_[0] + (v_[2] - A[1]) * t_[1] for v_ in (a_, b_, c_)]
                # 三角 s 区间须整含于边跨度（±0.3）——近角处「邻边立面墙」的投影会伸进本边跨度，
                # 只要求重叠会误锚（华宝楼 edge2 顶到 edge4 立面墙）；真立面墙三角都在本边线内。
                if min(ss_) < -0.3 or max(ss_) > L + 0.3 or max(ss_) - min(ss_) <= 0.05:
                    continue
                if any(lo_ <= min(ss_) and max(ss_) <= hi_ for lo_, hi_ in sh_):
                    continue                     # 共享段内的 blank 墙不锚（生成器 classify 同口径）
                if -0.15 <= off <= 1.0:
                    near_wall = True
                cands.append((off, min(ss_), max(ss_), min(ys_), max(ys_)))
            # 资格判定按「立面组件带」：以候选桶 off 为心 ±0.15m 带内全部墙三角（外墙面碎片+窗樘
            # +框柱+金匾）合并算 s 跨与 y 覆盖——窗洞把外墙面打碎、格心带外凸 0.05，单桶覆盖会碎
            # （华宝楼 edge0 外墙面碎片），而内墙面（+0.29）是整块，会反客为主锚到内面。
            best = None
            yband = yhi - ylo
            seen_bk = {}
            for off_, s0_, s1_, y0_, y1_ in cands:
                seen_bk.setdefault(round(off_ / 0.05), []).append((off_, s0_, s1_, y0_, y1_))
            for bk, own in seen_bk.items():
                off_m = sum(q[0] for q in own) / len(own)
                if near_wall and off_m > 1.0:
                    continue                     # 外圈有墙：更深的墙跑是内院/退让，不是本边立面
                if off_m > 1.0 and any(-0.15 <= q[0] < off_m - 0.6 for q in cands):
                    continue                     # 深线压制：更外侧 0.6m 内还有墙（884 edge5 披屋 8.1
                                                 # 冒充立面而真窗墙在 1.4）——退台立面只在「该带外圈
                                                 # 确实无墙」时才成立（华宝楼四层 2.3 处 ✓）
                band = [q for q in cands if abs(q[0] - off_m) <= 0.15]
                # 带内墙 y 并集须盖住层带 ≥80%——披屋/压顶/檐口护板只占层带一小截（602 roof-annex
                # y[11.8,12.9] 对 [12.3,15.1] 仅 21%），不是开窗立面；真立面墙盒纵贯层带。
                by0 = min(q[3] for q in band)
                by1 = max(q[4] for q in band)
                if min(by1, yhi) - max(by0, ylo) < 0.95 * yband:
                    continue
                ivs = sorted((q[1], q[2]) for q in band)
                tot, cur = 0.0, None
                for a_, b_ in ivs:
                    if cur and a_ <= cur[1]:
                        cur[1] = max(cur[1], b_)
                    else:
                        if cur:
                            tot += cur[1] - cur[0]
                        cur = [a_, b_]
                if cur:
                    tot += cur[1] - cur[0]
                if tot < gate:
                    continue
                if best is None or off_m < best:
                    best = off_m
            if best is not None:
                out[(k_, st_)] = best
    return out
_ANCH17 = None          # 在 _TOW17 就绪后锚定（见下）
def _t17_tower_poly():
    """角塔/阁范围 = pav-* 部件（pav-base/body/tier/roof）包围盒外扩 0.5m；无 pav 件返回 None。
    只用生成器输出划定「塔身区」以豁免塔窗的多出检查（期望仍全部来自 layout+params）；
    塔件若被删，范围自动收缩，不会留下假豁免。外扩 0.5 盖住塔窗外凸 0.054 与基座出檐，
    小于沿街格心带离墙线内距 0.245 的立面带宽，不吞沿立面真窗。"""
    pts = [v_ for nd_ in meshes if _base(nd_['name']).startswith('pav-') for v_ in world_verts(nd_)]
    if not pts:
        return None
    E = 0.5
    x0, x1 = min(v_[0] for v_ in pts) - E, max(v_[0] for v_ in pts) + E
    z0, z1 = min(v_[2] for v_ in pts) - E, max(v_[2] for v_ in pts) + E
    return [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
_TOW17 = _t17_tower_poly()
def _t17_vrange(role_, storey_):
    """(role, storey) 的期望格心 v 跨（screen/band/win 类公式与生成器一致；blank = None）。"""
    sty = _style17(role_, storey_)
    kind = sty.get('style')
    z, ztop = _ZT17[storey_ - 1], _ZT17[storey_]
    zl0, zl1 = z + 0.06 + _LH17 + 0.02, ztop - 0.06 - _LH17 - 0.02
    if zl1 - zl0 <= 0.01:
        return (kind, None)
    if kind == 'screen':
        zw0 = zl0 + (1.0 - _LFL17) * (zl1 - zl0)
        return ('screen', (zw0, zl1 - 0.03)) if zl1 - zw0 > 0.01 else (kind, None)
    if kind == 'band':
        zb0, zb1 = z + sty.get('bandSillM', 0.95), min(z + sty.get('bandSillM', 0.95) + sty.get('bandHM', 1.3), zl1 - 0.1)
        return ('band', (zb0, zb1)) if zb1 - zb0 > 0.01 else (kind, None)
    if kind in ('half', 'ends', 'ends4'):
        if kind == 'ends':
            h, sill, lf = _WH17, _WS17, _LFL17
        else:
            h, sill, lf = 1.3, 1.45, _LFH17
        vr_ = _t17_win_range(z, ztop, h, sill, lf)
        return ('win', vr_) if vr_ else (kind, None)
    return (kind, None)
def _t17_pav_allowed():
    """塔窗豁免双校验来源（R2 必修4）：允许窗型 v 跨 + 塔体墙盒高度范围。
    来源 = pav-body / pav-tier<k> 墙盒（GLB 几何；塔件被删则豁免区自动收缩）× 生成器窗公式：
    body 窗=层带内 h=1.6/sill=0.9（storey 2..N，v 跨须在 body 盒内）；tier 窗=盒上下沿 ±0.06 外推
    层带 h=1.5/sill=0.8。伪窗段（如 30–31m 高于塔顶或 v 跨对不上任一塔窗）两边都过不了。"""
    if _TOW17 is None:
        return [], None
    body = []
    tiers = {}
    for nd_ in meshes:
        bn_ = _base(nd_['name'])
        if bn_.startswith('pav-tier'):
            tiers.setdefault(bn_.split('__')[0], []).extend(v_[1] for v_ in world_verts(nd_))
        elif bn_.startswith('pav-body'):
            body.extend(v_[1] for v_ in world_verts(nd_))
    if not body and not tiers:
        return [], None
    vrs = []
    if body:
        b0, b1 = min(body), max(body)
        for st_ in range(2, _N17 + 1):
            vr_ = _t17_win_range(_ZT17[st_ - 1], _ZT17[st_], 1.6, 0.9, _LFL17)
            if vr_ and b0 - 0.15 <= vr_[0] and vr_[1] <= b1 + 0.15:
                vrs.append(vr_)
    for tn_, ys_ in tiers.items():
        a_, b_ = min(ys_), max(ys_)
        vr_ = _t17_win_range(a_ - 0.06, b_ + 0.06, 1.5, 0.8, _LFL17)
        if vr_ and a_ - 0.2 <= vr_[0] and vr_[1] <= b_ + 0.2:
            vrs.append(vr_)
    ymins = ([min(body)] if body else []) + [min(ys_) for ys_ in tiers.values()]
    hmax = max(([max(body)] if body else []) + [max(ys_) for ys_ in tiers.values()])
    return vrs, (min(ymins), hmax)
_PAVVR17, _PAVH17 = _t17_pav_allowed()
_ANCH17 = _t17_anchor()
def _t17_account(segs, exps):
    """对账（R2 必修3 立面身份 + 必修4 错型必抓）：
    归边：平面 ±25° 平行某 FP 边、内距 [-0.5,12]、段中心投影在该边跨度内（共线延长边取内距最小者）。
    立面身份：段内距贴合 (归边, 楼层) 的锚定立面线 ±0.15 → facade=(edge, storey)。
    认领：期望 edge/storey 相同 + v 跨 ±0.08（别的立面代位不了——edge 身份不同）。
    多出：
      ① 有 facade 的段只认**自身角色该层**的允许窗型 v 跨（screen 段在 plain 立面=错型必抓）；
      ② 塔窗豁免须三关：塔体水平范围 + 塔体墙盒高度 + 塔体允许窗型 v 跨（不只看水平包围盒）；
      ③ 无 facade（内天井/podium 内墙/斜切，段归附不到锚定立面线）：该层任一角色类窗型 v 跨一致才豁免。"""
    for s_ in segs:
        pl_ = s_['pl']
        best, offb = None, None
        for k in range(len(FP)):
            A, B = FP[k], FP[(k + 1) % len(FP)]
            L, t_, nn = edge_frame_map(A, B)
            if abs(pl_['nb'][0] * nn[0] + pl_['nb'][2] * nn[1]) < 0.9:
                continue
            off_i = -((pl_['p0'][0] - A[0]) * nn[0] + (pl_['p0'][2] - A[1]) * nn[1])   # 内距（正=边线以内）
            if off_i < -0.5 or off_i > 12.0:
                continue
            sproj = (s_['cx'] - A[0]) * t_[0] + (s_['cz'] - A[1]) * t_[1]
            if sproj < -0.3 or sproj > L + 0.3:
                continue
            if offb is None or abs(off_i) < abs(offb):
                best, offb = k, off_i
        s_['edge'] = best
        s_['off'] = offb
        s_['role'] = ('street' if best in _FE17 else 'plain') if best is not None else None
        vmid = (s_['v0'] + s_['v1']) / 2
        s_['storey'] = next((st_ for st_ in range(2, _N17 + 1) if _ZT17[st_ - 1] - 0.1 <= vmid < _ZT17[st_] - 0.1),
                            1 if vmid < _ZT17[1] - 0.1 else None)
        an_ = _ANCH17.get((best, s_['storey'])) if best is not None and s_['storey'] is not None else None
        # 立面身份按**线匹配**（不止最近边）：长排楼 FP 常把同一条直线拆成多条边（884：段归到
        # edge12 off4.166，锚在共线 edge2 off4.197）；退台斜切墙与边差 >5.7°（601 e2 四层）——
        # 认领平行放宽到 25°（与归边同口径），须平面平行该边 + 段中心投影在该边跨度内 +
        # 内距与锚线差 ≤0.5（跨立面代位仍被「同线±0.5、同层、同 v 跨」三重条件挡住）。
        s_['facade'] = None
        lines_ = []
        if s_['storey'] is not None:
            fb_, fd_, tol_ = None, 1e9, 0.5
            for (k_, st_), aoff in _ANCH17.items():
                if st_ != s_['storey']:
                    continue
                A, B = FP[k_], FP[(k_ + 1) % len(FP)]
                L, t_, nn = edge_frame_map(A, B)
                if abs(pl_['nb'][0] * nn[0] + pl_['nb'][2] * nn[1]) < 0.90:
                    continue
                off_k = -((pl_['p0'][0] - A[0]) * nn[0] + (pl_['p0'][2] - A[1]) * nn[1])
                if abs(off_k - aoff) >= tol_:
                    continue
                sproj_ = (s_['cx'] - A[0]) * t_[0] + (s_['cz'] - A[1]) * t_[1]
                if sproj_ < -1.0 or sproj_ > L + 1.0:
                    continue                     # 转角斜切带中心投影常越出边端（601 e2/e4 四层），±1.0m
                lines_.append(k_)
                if abs(off_k - aoff) < fd_:
                    fd_ = abs(off_k - aoff)
                    fb_ = (k_, st_)
            if fb_ is not None:
                s_['facade'] = fb_
            elif an_ is not None and abs(offb - an_) <= 0.5:
                s_['facade'] = (best, s_['storey'])
        s_['lines'] = lines_
    claimed = set()
    extra = []
    for s_ in segs:
        # 认领 = 归边 + 同层 + v 跨 ±0.08（多认领：转角带一排窗服务多条边）。归边本身已含
        # 「平行 ±25°、内距 ≤12、中心投影在边跨度内、共线取内距最小」的立面身份——别的立面
        # 归不到这条边（R1 审查的代位发生在角色类合并期望，期望带 edge 身份后即关死）。
        # 锚线距离不进认领条件：外圈装饰墙/压顶会把锚线顶偏 ≥0.5m（607 e2 四层真窗在 1.33）。
        cl_ = False
        for ei_, e_ in enumerate(exps):
            if (e_.get('edge') is None or s_.get('edge') == e_['edge']) and s_.get('role') == e_['role'] \
                    and s_['storey'] == e_['storey'] \
                    and abs(s_['v0'] - e_['v0']) <= 0.08 and abs(s_['v1'] - e_['v1']) <= 0.08:
                claimed.add(ei_)
                cl_ = True
        if cl_:
            s_['disp'] = 'claimed'
            continue
        if s_.get('facade') is not None:
            # 已归属常规立面：只能匹配自身角色在该层的允许窗型（必修4：错型不放过）
            fk_, fst_ = s_['facade']
            vr_ = _t17_vrange('street' if fk_ in _FE17 else 'plain', fst_)[1]
            if vr_ and abs(s_['v0'] - vr_[0]) <= 0.08 and abs(s_['v1'] - vr_[1]) <= 0.08:
                s_['disp'] = 'facade-ok'      # 同边同层合法窗型（该期望已被同边其他段认领）
                continue
            s_['disp'] = 'extra'
            extra.append(s_)
            continue
        # 塔窗豁免（必修4）：水平范围 + 塔体墙盒高度 + 允许窗型 v 跨
        if _TOW17 and point_in_poly((s_['cx'], s_['cz']), _TOW17, tol=0.0) \
                and _PAVH17 and _PAVH17[0] - 0.3 <= s_['v0'] and s_['v1'] <= _PAVH17[1] + 0.3 \
                and any(abs(s_['v0'] - vr_[0]) <= 0.08 and abs(s_['v1'] - vr_[1]) <= 0.08 for vr_ in _PAVVR17):
            s_['disp'] = 'pav'
            continue
        # 非立面线（内天井/podium 内墙）：该层任一角色类的期望窗型 v 跨一致才豁免
        if s_['storey'] is not None:
            vrs = [_t17_vrange(r_, s_['storey'])[1] for r_ in ('street', 'plain')]
            if any(vr_ and abs(s_['v0'] - vr_[0]) <= 0.08 and abs(s_['v1'] - vr_[1]) <= 0.08 for vr_ in vrs):
                s_['disp'] = 'interior'
                continue
        s_['disp'] = 'extra'
        extra.append(s_)
    missing = [e_ for ei_, e_ in enumerate(exps) if ei_ not in claimed]
    return missing, extra
def _t17_expect_legacy():
    """回退期望（R1 口径：角色类×层×screen/band，无立面身份）。仅当逐边期望为空（复合排楼等
    无可确定常规立面线：884 锯齿排楼墙面碎面化、868）但格心段存在时启用——退回 R1 级守卫
    （17g 逐段背板覆盖不放宽），并在断言名中注明 fallback。"""
    exps = []
    for st_ in range(2, _N17 + 1):
        z, ztop = _ZT17[st_ - 1], _ZT17[st_]
        zl0, zl1 = z + 0.06 + _LH17 + 0.02, ztop - 0.06 - _LH17 - 0.02
        if zl1 - zl0 <= 0.01:
            continue
        for role_ in ('street', 'plain'):
            kind_, vr_ = _t17_vrange(role_, st_)
            if kind_ in ('screen', 'band') and vr_ is not None:
                exps.append({'edge': None, 'cls': kind_, 'role': role_, 'storey': st_, 'v0': vr_[0], 'v1': vr_[1]})
    return exps
def _t17_drop_occupied(exps, segs):
    """占位核减（GOAL：豁免限定到具体受影响区域）：若 (edge,storey) 锚线 ±0.5m 上确有归边段、
    但它们**全部**被区域豁免（disp=pav/interior：塔窗/内院线），则该常规立面被占位取代——
    不立期望（601 e2 四层=塔身窗带）。认领段（disp=claimed）说明期望正常把守，不核减；
    删段负例不受影响：段被删则 near 为空，期望恢复并把守（华宝楼删 edge0/3 二三层段仍 FAIL）。"""
    out = []
    for e_ in exps:
        aoff = _ANCH17.get((e_['edge'], e_['storey']))
        near = [s_ for s_ in segs if s_.get('edge') == e_['edge'] and s_.get('storey') == e_['storey']
                and aoff is not None and s_.get('off') is not None and abs(s_['off'] - aoff) <= 0.5]
        if near and all(s_.get('disp') in ('pav', 'interior') for s_ in near):
            continue
        out.append(e_)
    return out
def _t17_entry_missing(n_lat_, n_wb_, n_exp_):
    """入口级「整类节点缺失」判据（R2 可选项，独立可测）：期望存在而格心/背板任一整类节点缺失。"""
    return n_exp_ > 0 and (n_lat_ == 0 or n_wb_ == 0)
_exp17 = _t17_expect()
_LEGFALL17 = False
if not _exp17 and _lat_nodes17:
    # 逐边期望全空（复合排楼无可确定常规立面线）但格心节点在 → 回退 R1 口径守卫
    _exp17 = _t17_expect_legacy()
    _LEGFALL17 = bool(_exp17)
if not _exp17:
    skip('test17g/17h 逐窗段背板与立面期望', 'layout×params 期望本楼无 screen/band/普通窗（无格心守卫对象）')
elif _t17_entry_missing(len(_lat_nodes17), len(_wb_nodes17), len(_exp17)):
    ok('test17g/17h 格心/背板整类节点存在', False,
       '期望 %d 条（edge×层×窗型 %s）但 windows__lattice*/windows__winback* 整类节点缺失（FAIL，不 SKIP）'
       % (len(_exp17), sorted({e_['cls'] for e_ in _exp17})))
else:
    _segs17 = _t17_segments(_lat_nodes17)
    _t17_account(_segs17, _exp17)                     # pass1：打 disp 标（占位核减需要）
    _exp17 = _t17_drop_occupied(_exp17, _segs17) if not _LEGFALL17 else _exp17
    _miss17, (_cmin, _cmax), _nok17 = _t17_cover(_segs17, _wb_nodes17)
    ok('test17g 每个格心窗段背后同法向背板 (u,v) 真实面积覆盖 ≥95%%（%d 段全对上 %d，覆盖率 %.1f%%~%.1f%%，缺 %d）'
       % (_nok17, len(_segs17), _cmin * 100, _cmax * 100, len(_miss17)),
       not _miss17, '缺/欠覆盖格心段（夜间黑窗；cov=-1 = 内侧未定或背板账本异常——非半矩形三角/矩形组重叠）: %s' % [
           {'u_w': round(s_['u1'] - s_['u0'], 2), 'v': [round(s_['v0'], 2), round(s_['v1'], 2)], 'cov': round(s_['cov'], 3)}
           for s_ in _miss17[:6]])
    _miss_e17, _extra17 = _t17_account(_segs17, _exp17)
    if os.environ.get('BTK17_DEBUG'):
        print('DEBUG17 streetEdges=%s anchor=%s pavVR=%s pavH=%s' % (
            sorted(_FE17), {('%d,%d' % k): round(v, 3) for k, v in sorted(_ANCH17.items())},
            [(round(a, 2), round(b, 2)) for a, b in _PAVVR17], None if _PAVH17 is None else [round(q, 2) for q in _PAVH17]))
        for e_ in _exp17:
            print('DEBUG17 exp edge=%d cls=%s role=%s storey=%d v=[%.3f,%.3f]' % (e_['edge'], e_['cls'], e_['role'], e_['storey'], e_['v0'], e_['v1']))
        for s_ in _segs17:
            print('DEBUG17 seg edge=%s off=%.3f facade=%s storey=%s u_w=%.3f v=[%.3f,%.3f] cov=%.3f c=(%.2f,%.2f)' % (
                s_.get('edge'), s_.get('off') if s_.get('off') is not None else 99,
                s_.get('facade'), s_.get('storey'), s_['u1'] - s_['u0'], s_['v0'], s_['v1'], s_['cov'], s_['cx'], s_['cz']))
    ok('test17h layout 独立期望 %s 对账（期望 %d 条全认领，多出段 %d）'
       % ('立面边×楼层×窗型' if not _LEGFALL17 else '角色类×层（fallback：本楼无可确定常规立面线，R1 口径）',
          len(_exp17), len(_extra17)),
       not _miss_e17 and not _extra17,
       '缺: %s；多出: %s' % (
           [(e_['cls'], 'e%d' % e_['edge'], e_['role'], e_['storey']) for e_ in _miss_e17[:6]],
           [{'facade': s_.get('facade'), 'v': [round(s_['v0'], 2), round(s_['v1'], 2)]} for s_ in _extra17[:6]]))
    if ID == HUABAO:
        # ---- test 17n：负例自检（内存突变；证明 17g/17h 的捕获力） ----
        _wb_copy17 = []
        for nd_ in _wb_nodes17:
            nd2 = dict(nd_)
            V = [list(v_) for v_ in nd_['verts']]
            par = list(range(len(V)))
            def _f17(x_):
                while par[x_] != x_:
                    par[x_] = par[par[x_]]
                    x_ = par[x_]
                return x_
            for (ia_, ib_, ic_) in nd_['idxTris']:
                ra, rb, rc = _f17(ia_), _f17(ib_), _f17(ic_)
                if ra != rb:
                    par[ra] = rb
                if rb != rc:
                    par[rb] = rc
            panels = {}
            for (ia_, ib_, ic_) in nd_['idxTris']:
                panels.setdefault(_f17(ia_), []).append((ia_, ib_, ic_))
            for tris in panels.values():
                vset = sorted({i_ for t_ in tris for i_ in t_})
                n_ = [0.0, 0.0, 0.0]
                for (ia_, ib_, ic_) in tris:
                    a_, b_, c_ = V[ia_], V[ib_], V[ic_]
                    u_ = [b_[i] - a_[i] for i in range(3)]
                    w_ = [c_[i] - a_[i] for i in range(3)]
                    cr = [u_[1] * w_[2] - u_[2] * w_[1], u_[2] * w_[0] - u_[0] * w_[2], u_[0] * w_[1] - u_[1] * w_[0]]
                    ln = math.sqrt(cr[0] * cr[0] + cr[1] * cr[1] + cr[2] * cr[2]) or 1.0
                    n_[0] += cr[0] / ln
                    n_[1] += cr[1] / ln
                    n_[2] += cr[2] / ln
                nl = math.sqrt(n_[0] * n_[0] + n_[1] * n_[1] + n_[2] * n_[2]) or 1.0
                n_ = [q / nl for q in n_]
                cen = [sum(V[i_][k_] for i_ in vset) / len(vset) for k_ in range(3)]
                t2 = (-n_[2], n_[0])
                us = [(V[i_][0] - cen[0]) * t2[0] + (V[i_][2] - cen[2]) * t2[1] for i_ in vset]
                uc = sum(us) / len(us)
                for i_, u0_ in zip(vset, us):
                    du = (uc + 0.01 * (u0_ - uc)) - u0_
                    V[i_][0] += du * t2[0]
                    V[i_][2] += du * t2[1]
            nd2['verts'] = [tuple(q) for q in V]
            _wb_copy17.append(nd2)
        _segs_n1 = _t17_segments(_lat_nodes17)
        _miss_n1, _, _ = _t17_cover(_segs_n1, _wb_copy17)
        # N2/N4 按**立面身份**（锚定归边，非认领规则自身）定位要删除的段：
        # N2 = 移除全部 screen 期望所在边×层的段（普通窗保留）→ 17h 必须缺 screen 期望；
        # N4 = 移除首个期望所在边的全部段 → 17h 必须缺该边的全部期望（逐边独立对账把守）。
        _scr_e17 = [e_ for e_ in _exp17 if e_['cls'] == 'screen']
        _n2_keys = {(e_['edge'], e_['storey']) for e_ in _scr_e17}
        _segs_n2 = [s_ for s_ in _segs17 if s_.get('facade') not in _n2_keys]
        _miss_n2, _ = _t17_account(_segs_n2, _exp17)
        _miss_n3, _ = _t17_account([], _exp17)
        _e4 = _exp17[0]['edge']
        _segs_n4 = [s_ for s_ in _segs17 if (s_.get('facade') or (None, None))[0] != _e4]
        _miss_n4, _ = _t17_account(_segs_n4, _exp17)
        _n_ok = len(_miss_n1) > 0 \
            and len(_scr_e17) > 0 and all(any(e_['edge'] == k[0] and e_['storey'] == k[1] for e_ in _miss_n2) for k in _n2_keys) \
            and len(_miss_n3) == len(_exp17) \
            and all(e_['edge'] == _e4 for e_ in _miss_n4) and len(_miss_n4) > 0
        ok('test17n 负例自检（背板缩宽 1%% 缺 %d 段 / 移除 screen 边×层缺 %d 期望 / 整类缺失缺 %d 期望 / 移除 edge%d 全部段缺 %d 期望 —— 全部被捕获）'
           % (len(_miss_n1), len(_miss_n2), len(_miss_n3), _e4, len(_miss_n4)), _n_ok,
           '负例未被捕获：N1=%d N2=%d N3=%d N4=%d（17g/17h 断言力不足）' % (len(_miss_n1), len(_miss_n2), len(_miss_n3), len(_miss_n4)))
        # 入口级整类缺失判据（R2 可选项）：独立纯函数，期望存在而任一整类节点缺失 → 必须 True
        ok('test17n 入口级整类缺失判据（lattice=0 或 winback=0 → True；两类俱在 → False）',
           _t17_entry_missing(0, 5, 2) and _t17_entry_missing(5, 0, 2)
           and not _t17_entry_missing(5, 5, 2) and not _t17_entry_missing(0, 0, 0))

print('\ntest_tower: %d pass, %d fail, %d skip' % (pass_n, fail_n, skip_n))
if fail_n:
    for f in failures:
        print('  FAIL:', f)
    sys.exit(1)
