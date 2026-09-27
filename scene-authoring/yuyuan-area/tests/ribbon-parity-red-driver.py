# wave10-streetfix R3（审查必修3）红测驱动：复刻 repair-layout.py@2e840467 的旧 ribbon 组装
# （左右偏移边串外环 + buffer(0)），与 Node 跑 src/lib.mjs ribbon() 导出的渲染端三角形并集比面积。
# R2 版测试/repair 都用旧近似，与渲染端不等价（审查：road-1064398308 对称差 5.77 m²）。
# 本驱动只做红绿证据，不属于 npm test；绿测是 tests/ribbon-parity-test.py。
# 用法：python3 -X utf8 tests/ribbon-parity-red-driver.py
import json
import math
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.python-deps'))
from shapely.geometry import Polygon
from shapely.ops import unary_union


def old_ribbon_surface(pts, width):
    """repair-layout.py@2e840467 第 99-105 行的旧实现（逐行复刻）。"""
    n = len(pts)
    left, right = [], []
    for i in range(n):
        a = pts[max(0, i - 1)]
        b = pts[min(n - 1, i + 1)]
        dx, dz = b[0] - a[0], b[1] - a[1]
        L = (dx * dx + dz * dz) ** .5 or 1
        nx, nz = -dz / L * width / 2, dx / L * width / 2
        left.append([pts[i][0] + nx, pts[i][1] + nz])
        right.append([pts[i][0] - nx, pts[i][1] - nz])
    return Polygon(left + right[::-1]).buffer(0)


def node_truth(pts, width, tag):
    tmp = ROOT / '.ribbon-red-input.json'
    tmp.write_text(json.dumps({'objects': [{'id': 'x', 'geometry': {'polyline': pts, 'width': width}}]}), encoding='utf-8')
    r = subprocess.run(['node', str(ROOT / 'tests' / 'ribbon-triangles-export.mjs'), str(tmp), 'x'],
                       capture_output=True, text=True, cwd=str(ROOT))
    tmp.unlink()
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    d = json.loads(r.stdout)
    u = unary_union([Polygon(t) for t in d['triangles']])
    print(f'{tag}: renderer truth triangles={len(d["triangles"])} union={u.area:.6f} m^2')
    return u.area


fail = 0
base = json.loads((ROOT / 'baseline' / 'layout.json').read_text(encoding='utf-8'))
o = next(x for x in base['objects'] if x['id'] == 'road-1064398308')
truth = node_truth(o['geometry']['polyline'], o['geometry']['width'], 'road-1064398308')
old = old_ribbon_surface(o['geometry']['polyline'], o['geometry']['width']).area
dev = abs(old - truth)
print(f'road-1064398308: old exterior+buffer(0)={old:.6f} dev={dev:.6f} (review: 4707.790604 / 5.774942)')
if dev > 0.01:
    print(f'FAIL road-1064398308: old implementation deviates {dev:.4f} m^2 from renderer (>0.01)')
    fail += 1

hairpin = [[0, 0], [12, 0], [12, 1.2], [0, 2.4]]
truth = node_truth(hairpin, 6, 'hairpin-self-intersect')
old = old_ribbon_surface(hairpin, 6).area
dev = abs(old - truth)
print(f'hairpin: old exterior+buffer(0)={old:.6f} dev={dev:.6f}')
if dev > 0.01:
    print(f'FAIL hairpin: old implementation deviates {dev:.4f} m^2 from renderer (>0.01)')
    fail += 1

print('RIBBON-PARITY-RED-DRIVER', 'RED (old implementation deviates)' if fail else 'old implementation agrees (driver useless)')
sys.exit(1 if fail else 0)
