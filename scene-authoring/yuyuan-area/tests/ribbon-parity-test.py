# wave10-streetfix R3（审查必修3）：Python 侧 ribbon 几何必须与渲染端逐三角一致。
# 期望值来源（不许拿 Python 实现和自己比）：用 Node 直接跑 src/lib.mjs 的 ribbon()
# （tests/ribbon-triangles-export.mjs 导出 BufferGeometry 的真实三角形），shapely 取并集为真值；
# Python 侧被检对象是 scripts/ribbon_geom.py 的 ribbon_polygon（repair-layout.py 与
# road-footprint-clearance-test.py 共用的同一实现）。回归用例：
#   A) baseline 的 road-1064398308（仍走 ribbon 渲染）：真值必须 ≈ 4713.565546 m²（第 2 轮审查
#      独立复算的按索引构造三角形并集面积，容差 0.01），且 ribbon_polygon 与真值差 ≤ 0.01；
#   B) 人造急弯/自交折线（末段急拐 → 端部张口，与 A 同一失效机制）：ribbon_polygon 与真值差 ≤ 0.01。
# R2 版旧实现（外环 + buffer(0)）在 A 上 4707.790604，差 5.78 m²——红测驱动
# tests/ribbon-parity-red-driver.py（artifacts/r3/red-ribbon-parity-2e840467.txt）。
# 用法：python3 -X utf8 tests/ribbon-parity-test.py
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.python-deps'))
sys.path.insert(0, str(ROOT / 'scripts'))
from shapely.geometry import Polygon
from shapely.ops import unary_union
from ribbon_geom import ribbon_polygon

pass_n = fail_n = 0
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


def renderer_truth(pts, width):
    """Node 跑 src/lib.mjs ribbon() 导出的三角形并集面积（渲染端真值）。"""
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, dir=str(ROOT)) as f:
        json.dump({'objects': [{'id': 'x', 'geometry': {'polyline': pts, 'width': width}}]}, f)
        inp = f.name
    r = subprocess.run(['node', str(ROOT / 'tests' / 'ribbon-triangles-export.mjs'), inp, 'x'],
                       capture_output=True, text=True, cwd=str(ROOT))
    Path(inp).unlink()
    if r.returncode != 0:
        raise RuntimeError('ribbon-triangles-export.mjs failed: ' + r.stderr[-300:])
    d = json.loads(r.stdout)
    return unary_union([Polygon(t) for t in d['triangles']]), len(d['triangles'])


def check_case(name, pts, width, want_area=None):
    truth, ntri = renderer_truth(pts, width)
    mine = ribbon_polygon(pts, width)
    ok(name + ': 渲染端三角形数 %d' % ntri, ntri == 2 * (len(pts) - 1), str(ntri))
    if want_area is not None:
        ok(name + ': 渲染端真值 %.6f ≈ %.6f (±0.01)' % (truth.area, want_area),
           abs(truth.area - want_area) <= 0.01, '差 %.4f' % (truth.area - want_area))
    dev = abs(mine.area - truth.area)
    ok(name + ': ribbon_polygon %.6f 与渲染端差 ≤0.01' % mine.area, dev <= 0.01, '差 %.4f m²' % dev)
    # R4（审查可选项3）：除总面积外，加对称差 ≤ 0.01 m² 断言——面积相等但形状错开（面积守恒的错位）
    # 也必须被抓到；对称差 = (mine∖truth) ∪ (truth∖mine) 的面积。
    sym = mine.symmetric_difference(truth).area
    ok(name + ': 与渲染端并集对称差 %.6f ≤0.01 m²' % sym, sym <= 0.01, '对称差 %.4f m²' % sym)


# A) baseline 仍走 ribbon 的 road-1064398308（期望值 = 第 2 轮审查独立复算 4713.565546 m²）
base = json.loads((ROOT / 'baseline' / 'layout.json').read_text(encoding='utf-8'))
o = next(x for x in base['objects'] if x['id'] == 'road-1064398308')
check_case('road-1064398308', o['geometry']['polyline'], o['geometry']['width'], 4713.565546)

# B) 人造急弯/自交折线（末段急拐，端部张口；旧外环法会丢 2.29 m²）
check_case('人造急弯(end-kink)', [[0, 0], [10, 0], [20, 0], [30, 0], [30.5, -3]], 8)

print('RIBBON-PARITY-TEST %d pass / %d fail' % (pass_n, fail_n))
if failures:
    print('FAILURES:')
    for f in failures:
        print(' -', f)
sys.exit(1 if fail_n else 0)
