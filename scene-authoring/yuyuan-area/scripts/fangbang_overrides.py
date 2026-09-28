"""全域制作侧的方浜 v7 放置覆盖（Python 读取端；Node 读取端 = scripts/fangbang-overrides.mjs）。

覆盖数据只定义在 baseline/fangbang-placement-overrides.json 一处；本模块与 .mjs 读取端按同一规则应用：
  实例 positionGlb += translateGlb；名称前缀 `<id>:` 的碰撞记录 obb.pos（或 min/max）+= translateGlb；
  结果取 4 位小数；应用前校验实例原位置 == expectBasePositionGlb（容差 1e-4）。
「取 4 位小数」的共享规则（wave12-debt D5，两端逐字一致，勿单边改写）：
  四舍五入到 1e-4、半数远离零 = sign(x) * floor(|x| * 1e4 + 0.5) / 1e4 —— 与 Node 端
  scripts/fangbang-overrides.mjs 的 round4HalfUp 同一公式、同一 double 运算序（先乘、加 0.5、
  取 floor、再除回），IEEE 754 基本运算确定，两端逐位相等。不用 round()：它是银行家舍入，
  与 JS toFixed() 在 0.03125 这类二进精确半数上分歧（0.0312 vs 0.0313）。
  契约测试：tests/fangbang-rounding-contract-test.mjs。
仓库根 world/fangbang-temple-v7/{instances,collision-world}.json 是原客户端共享数据集，不在那里改位置。
纯 Python（assemble.py 在 Blender 里 import；fangbang_gapfill.py 用系统 python 也能跑）。
"""
import json
import math
import os

OVERRIDES_REL = os.path.join('baseline', 'fangbang-placement-overrides.json')
TOL = 1e-4


def _area_root():
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_overrides(area_root=None):
    p = os.path.join(area_root or _area_root(), OVERRIDES_REL)
    doc = json.load(open(p, encoding='utf-8'))
    if doc.get('schema') != 'pawborough.fangbang-placement-overrides/1':
        raise SystemExit(f'{p}: unexpected schema {doc.get("schema")!r}')
    return doc['overrides']


def _round4_half_up(x):
    """四舍五入到 1e-4、半数远离零（共享规则见文件头；与 fangbang-overrides.mjs 同一 double 运算序）。"""
    s = -1.0 if x < 0 else 1.0
    return s * math.floor(abs(x) * 10000.0 + 0.5) / 10000.0


def _add(v, d):
    return [_round4_half_up(v[k] + d[k]) if d[k] else v[k] for k in range(3)]


def apply_overrides(instances, colliders, overrides):
    """原地修改 instances（v7 instances 列表）与 colliders（v7 colliders 列表），返回应用记录。"""
    applied = []
    by_id = {i['id']: i for i in instances}
    for ov in overrides:
        oid, d = ov['id'], ov['translateGlb']
        inst = by_id.get(oid)
        if inst is None:
            raise SystemExit(f'fangbang override: instance {oid} not in v7 instances.json')
        base = inst['positionGlb']
        exp = ov['expectBasePositionGlb']
        if any(abs(base[k] - exp[k]) > TOL for k in range(3)):
            raise SystemExit(f'fangbang override {oid}: v7 base position {base} != expectBasePositionGlb {exp} '
                             '(shared dataset changed? re-derive the override instead of stacking it)')
        inst['positionGlb'] = _add(base, d)
        n = 0
        for r in colliders:
            if r['name'].split(':')[0] != oid:
                continue
            if r.get('obb'):
                r['obb']['pos'] = _add([r['obb']['pos'][0], r['obb']['pos'][1] or 0, r['obb']['pos'][2]], d)
            if isinstance(r.get('min'), list) and isinstance(r.get('max'), list):
                r['min'] = _add(r['min'], d)
                r['max'] = _add(r['max'], d)
            n += 1
        if n == 0:
            raise SystemExit(f'fangbang override {oid}: no collision-world records named "{oid}:*"')
        applied.append({'id': oid, 'translateGlb': d, 'positionGlb': inst['positionGlb'], 'colliders': n})
    return applied


def load_v7(repo, area_root=None):
    """读 v7 instances / collision-world 并应用全域放置覆盖。返回 (instances, colliders, applied)。"""
    fb7 = os.path.join(repo, 'world', 'fangbang-temple-v7')
    inst = json.load(open(os.path.join(fb7, 'instances.json'), encoding='utf-8'))['instances']
    col = json.load(open(os.path.join(fb7, 'collision-world.json'), encoding='utf-8'))['colliders']
    applied = apply_overrides(inst, col, load_overrides(area_root))
    return inst, col, applied
