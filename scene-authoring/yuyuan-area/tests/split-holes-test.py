# wave10-streetfix R3（审查必修1）：split_holes() 必须输出真正的无孔多边形列表。
# R2 版只连一条桥缝后 polygonize，最小案例（路面 [0,10]×[0,10]、建筑 [4,6]×[4,6]）返回的
# 块仍带 interiors；渲染字段只存 exterior，序列化后孔洞被重新填回建筑。本测试从
# scripts/repair-layout.py 里按 AST 提取 split_holes() 原函数（不 import 整个脚本——它顶层就
# 会跑管线、写 OUT_DIR），对审查给的最小案例断言：
#   1) 每块都是 Polygon 且 len(interiors)==0；
#   2) 各块并集面积 = 差集面积 96 m²（误差 1e-6）；
#   3) 与建筑交集面积 = 0（孔不许被填回去）；
#   4) 按 exterior 序列化再还原（渲染端实际读法）后并集面积仍为 96 m²。
# 再加一个两孔案例（一条路面同时含两个建筑孔）。
# 用法：python3 -X utf8 tests/split-holes-test.py
import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.python-deps'))
from shapely.geometry import Polygon
from shapely.ops import unary_union


def load_split_holes():
    src = (ROOT / 'scripts' / 'repair-layout.py').read_text(encoding='utf-8')
    tree = ast.parse(src)
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'split_holes')
    ns = {}
    exec('from shapely.geometry import Polygon,LineString\n'
         'from shapely.ops import unary_union,polygonize\n'
         + ast.get_source_segment(src, fn), ns)
    return ns['split_holes']


split_holes = load_split_holes()

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


def check_case(name, road, building, want_area):
    diffed = road.difference(building)
    assert diffed.geom_type == 'Polygon' and diffed.interiors, 'case setup: difference 应得到带孔多边形'
    pieces = split_holes(diffed)
    ok(name + ': 返回非空', len(pieces) > 0, '0 块')
    for i, p in enumerate(pieces):
        ok(name + ': #%d 是 Polygon' % i, p.geom_type == 'Polygon', p.geom_type)
        ok(name + ': #%d 无 interiors' % i, not p.interiors,
           '%d 个孔' % len(p.interiors))
        ok(name + ': #%d 有效' % i, p.is_valid, 'invalid')
    area = sum(p.area for p in pieces)
    ok(name + ': 并集面积 %.6f ≈ %.6f' % (area, want_area),
       abs(area - want_area) <= 1e-6, '偏差 %.3g' % (area - want_area))
    inter = unary_union(pieces).intersection(building).area
    ok(name + ': 与建筑交集 0', inter <= 1e-9, '%.6f m²（孔被填回）' % inter)
    # 渲染字段按 exterior 序列化（repair-layout 实际写法），渲染端还原后不许丢面积
    rings = [list(p.exterior.coords) for p in pieces]
    back = [Polygon(r).buffer(0) for r in rings]
    area2 = sum(p.area for p in back)
    ok(name + ': exterior 序列化往返面积 %.6f ≈ %.6f' % (area2, want_area),
       abs(area2 - want_area) <= 1e-6, '偏差 %.3g' % (area2 - want_area))


# 审查必修1 的最小案例：路面 [0,10]×[0,10]、建筑 [4,6]×[4,6]，差集 96 m²
check_case('最小案例(1孔)', Polygon([(0, 0), (10, 0), (10, 10), (0, 10)]),
           Polygon([(4, 4), (6, 4), (6, 6), (4, 6)]), 96.0)

# 两孔案例：路面 [0,20]×[0,8]，两栋建筑挖出两个孔，差集 160-8-12 = 140 m²
check_case('两孔案例', Polygon([(0, 0), (20, 0), (20, 8), (0, 8)]),
           unary_union([Polygon([(3, 2), (5, 2), (5, 6), (3, 6)]),
                        Polygon([(12, 2), (15, 2), (15, 6), (12, 6)])]),
           140.0)

# R4（审查可选项3）：候选切线全部失败 → 必须抛错，不许静默返回带孔面（exterior 序列化会填回）。
# 该失败路径在有效几何上不可达（过孔环包围盒的竖直/水平候选线按介值定理必穿孔环，interiors 必递减；
# 人造无效几何会被 GEOS 正则化、同样到不了该路径），所以除常规用例外，按 AST 断言函数末尾的
# 兜底语句是 raise 而不是 return [p]——行为用例（上两例）保证正常路径，结构断言保证失败路径显式。
src = (ROOT / 'scripts' / 'repair-layout.py').read_text(encoding='utf-8')
fn_ast = next(n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == 'split_holes')
ok('split_holes 末尾兜底是 raise（切线全部失败时显式失败）', isinstance(fn_ast.body[-1], ast.Raise),
   '末尾语句: ' + type(fn_ast.body[-1]).__name__)
ok('split_holes 序列化前断言无孔（repair-layout 两处 assert all(not f.interiors)）',
   src.count('assert all(not f.interiors for f in flats)') >= 2,
   '出现 %d 处' % src.count('assert all(not f.interiors for f in flats)'))

print('SPLIT-HOLES-TEST %d pass / %d fail' % (pass_n, fail_n))
if failures:
    print('FAILURES:')
    for f in failures:
        print(' -', f)
sys.exit(1 if fail_n else 0)
