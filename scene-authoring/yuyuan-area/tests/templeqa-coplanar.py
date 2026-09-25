"""庙区模块之间共面重叠（z-fight 候选）面积：两实例的水平且朝上的三角若同高（差 < 1 mm）且水平投影重叠，
按 shapely 求重叠面积，分「同材质」与「异材质」（异材质 = 浏览器里会闪的那种）。
用法：PYTHONPATH=.python-deps python3 -X utf8 tests/templeqa-coplanar.py [--dir resources/temple-v3] [--json out.json]"""
import json, math, os, re, struct, sys
from collections import defaultdict
from shapely.geometry import Polygon
from shapely.ops import unary_union

AREA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[1:]
DIR = args[args.index('--dir') + 1] if '--dir' in args else os.path.join(AREA, 'resources', 'temple-v3')
OUTJ = args[args.index('--json') + 1] if '--json' in args else None
src = open(os.path.join(AREA, 'scripts', 'assemble.py'), encoding='utf-8').read()
MF = dict(re.findall(r"'([^']+)'\s*:\s*'([^']+)'", re.search(r'MODULE_FILE\s*=\s*\{([\s\S]*?)\}', src).group(1)))
L = json.load(open(os.path.join(AREA, 'baseline', 'layout.json'), encoding='utf-8'))
INSTS = [dict(i, file=MF[i['module']]) for i in L['instances'] if i['module'] in MF]


def read(f):
    b = open(f, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    bin_ = b[28 + jl:]
    def acc(i):
        a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
        nc = {'SCALAR': 1, 'VEC3': 3, 'VEC2': 2, 'VEC4': 4}[a['type']]
        fmt = {5126: 'f', 5125: 'I', 5123: 'H', 5121: 'B'}[a['componentType']]
        sz = struct.calcsize(fmt); off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride', sz * nc)
        return [struct.unpack_from('<' + fmt * nc, bin_, off + k * st) for k in range(a['count'])]
    out = []
    for n in j['nodes']:
        for p in j['meshes'][n['mesh']]['primitives']:
            P = acc(p['attributes']['POSITION']); I = [x[0] for x in acc(p['indices'])]
            out.append((n['name'], P, I))
    return out


def horiz_tris(inst, mod):
    x, z = inst['position']; r = inst['rotY']; c, s = math.cos(r), math.sin(r)
    res = defaultdict(list)   # (y_mm, node) -> [poly]
    for name, P, I in mod:
        W = [(x + c * p[0] + s * p[2], p[1], z - s * p[0] + c * p[2]) for p in P]
        for k in range(0, len(I), 3):
            A, B, C = W[I[k]], W[I[k + 1]], W[I[k + 2]]
            if max(A[1], B[1], C[1]) - min(A[1], B[1], C[1]) > 5e-4:
                continue
            # 只要朝上的面（按绕序的几何法线 ny > 0；地图系 x,z 与 GLB 同手性，放置只绕竖轴转）：朝下的底面贴地看不见
            ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2])
            if ny <= 0:
                continue
            poly = Polygon([(A[0], A[2]), (B[0], B[2]), (C[0], C[2])])
            if poly.area < 1e-6:
                continue
            res[(round(A[1] * 1000), name)].append(poly)
    return {k: unary_union(v) for k, v in res.items()}


mods = {f: read(os.path.join(DIR, f)) for f in set(i['file'] for i in INSTS)}
H = {i['id']: horiz_tris(i, mods[i['file']]) for i in INSTS}
rows = []
for a in range(len(INSTS)):
    for b in range(a + 1, len(INSTS)):
        ia, ib = INSTS[a]['id'], INSTS[b]['id']
        for (ya, na), ga in H[ia].items():
            for (yb, nb), gb in H[ib].items():
                if abs(ya - yb) > 1:
                    continue
                if not ga.intersects(gb):
                    continue
                ar = ga.intersection(gb).area
                if ar < 1e-3:
                    continue
                ma, mb = na.split('__')[-1], nb.split('__')[-1]
                c = ga.intersection(gb).centroid
                rows.append({'a': ia, 'b': ib, 'nodeA': na, 'nodeB': nb, 'y': ya / 1000, 'areaM2': round(ar, 3),
                             'sameMaterial': ma == mb, 'centroid': [round(c.x, 2), round(c.y, 2)]})
rows.sort(key=lambda r: -r['areaM2'])
tot_diff = sum(r['areaM2'] for r in rows if not r['sameMaterial'])
tot_same = sum(r['areaM2'] for r in rows if r['sameMaterial'])
for r in rows[:30]:
    print(r)
print('COPLANAR pairs', len(rows), 'diffMaterialM2', round(tot_diff, 3), 'sameMaterialM2', round(tot_same, 3))
if OUTJ:
    json.dump({'rows': rows, 'diffMaterialM2': round(tot_diff, 3), 'sameMaterialM2': round(tot_same, 3)}, open(OUTJ, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
