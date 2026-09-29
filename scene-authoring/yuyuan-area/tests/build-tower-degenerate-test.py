#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave13-debt2 E3：商城楼 window / screen 拆段的退化参数保护单元测试（内存参数，不构建 GLB）。

审查（wave12-towerwin2 REVIEW-astra 可选3）：band 在高度 ≤0.01 时整体保留 timber，window/screen 没有同等
保护——lf=0.995 时 7.2mm 实心段被跳过（总背板 1.44m 缩成 1.4328m）、lf=0 仍生成零面积 lit 板并计数、
lf>1 不拒绝会越过背板下边界。E3 契约（build_tower.py window() 与 screen 拆段）：
  ① 覆盖段（格心覆盖 zl0..上缘）高 ≤ 0.01：不拆段、不出 lit 背板、不计数，整体保留 timber（完整覆盖）；
  ② 实心段为正高度（含 ≤ 1cm 细条）就出板，总背板覆盖恒等于 h+0.14；
  ③ lf 超出 [0,1] 直接报错。

做法：纯 python3（无 Blender）。build_tower.py 以桩 bpy/bmesh/mathutils exec 到 `def architrave` 前
（全部为输入装载与函数定义，无几何发射）；add_local 换成捕获桩、crosses_shared 置 False（单元口径），
window() 用内存参数直接调用。期望值全部按契约解析式独立算出（z0、zl0、分段高度），不拿产物和自己比。
screen 拆段在同一条 build 路径内联、无法单独调用，用源码锚点断言同款三保护在位（与 window 同构）。

用法：python3 -X utf8 tests/build-tower-degenerate-test.py（npm test 已挂）。退出码 0 全过；1 有失败。
"""
import math
import sys
import types

AREA = __file__.rsplit('/tests/', 1)[0]
SRC = AREA + '/modules/bazaar-tower-kit/build_tower.py'

FAILS = []
PASSES = 0


def ok(name, cond, detail=''):
    global PASSES
    if cond:
        PASSES += 1
        print('PASS', name)
    else:
        FAILS.append('%s: %s' % (name, detail))
        print('FAIL', name, detail)


# ---------------- 桩：bpy / bmesh / mathutils（仅模块装载期用到；截断点前无几何发射） ----------------
class StubAny:
    def __init__(self, *a, **k):
        pass

    def __getattr__(self, name):
        return StubAny()

    def __setattr__(self, name, v):
        object.__setattr__(self, name, v)

    def __call__(self, *a, **k):
        return StubAny()

    def __iter__(self):
        return iter([])

    def __len__(self):
        return 0

    def __getitem__(self, k):
        return StubAny()


class V:
    """mathutils.Vector 最小子集（模块装载期的 2D 足迹坐标运算用）。"""

    def __init__(self, *a):
        self._v = list(a[0]) if len(a) == 1 and not isinstance(a[0], (int, float)) else list(a)

    @property
    def x(self):
        return self._v[0]

    @property
    def y(self):
        return self._v[1]

    @property
    def z(self):
        return self._v[2] if len(self._v) > 2 else 0.0

    def __sub__(self, o):
        return V([a - b for a, b in zip(self._v, o._v)])

    def __add__(self, o):
        return V([a + b for a, b in zip(self._v, o._v)])

    def __truediv__(self, s):
        return V([a / s for a in self._v])

    def __mul__(self, s):
        if isinstance(s, V):
            return sum(a * b for a, b in zip(self._v, s._v))
        return V([a * s for a in self._v])

    dot = __mul__

    def normalized(self):
        n = math.sqrt(sum(a * a for a in self._v)) or 1.0
        return V([a / n for a in self._v])

    @property
    def length(self):
        return math.sqrt(sum(a * a for a in self._v))


def main():
    bpy_stub = StubAny()
    bpy_stub.data = StubAny()
    bpy_stub.context = StubAny()
    bpy_stub.ops = StubAny()
    sys.modules.setdefault('bpy', bpy_stub)
    sys.modules.setdefault('bmesh', StubAny())
    mu = types.ModuleType('mathutils')
    mu.Vector = V
    sys.modules.setdefault('mathutils', mu)

    src = open(SRC, encoding='utf-8').read()
    ok('E3 契约在源码：window lf 校验锚点', "lf=%r 超出 [0,1]" in src and src.count("lf=%r 超出 [0,1]") >= 2,
       'window 与 screen 两处都须有 lf 参数校验')
    cut = src.index('\ndef architrave')
    bt = types.ModuleType('bt_under_test')
    bt.__file__ = SRC
    exec(compile(src[:cut], SRC, 'exec'), bt.__dict__)
    ok('build_tower 内存装载（桩 bpy，exec 到 def architrave 前）', bool(bt.P.get('id')),
       str(bt.P.get('id')))

    CAP = []
    bt.crosses_shared = lambda pt, margin=0.05: False  # 单元口径：共享边守卫不参与

    def fake_add(name, items, faces, m, part=None, smooth=False):
        CAP.append({'name': name, 'z0': items[0][0][2], 'z1': items[2][0][2], 'mat': m})
        return {'name': name}  # 真 add_local 返回对象；_winback_panel 以 is not None 计数

    bt.add_local = fake_add

    class FakeRun:
        def p(self, s, o):
            return (s, o)

    # 内存参数：zfloor=0, ztop=6, w=1.1, h=1.3, sill=0.9 → z0=0.9；总背板 0.83..2.27（h+0.14=1.44）
    Z0, H = 0.9, 1.3
    LO, HI = Z0 - 0.07, Z0 + H + 0.07

    def call(lf):
        CAP.clear()
        bt.WINBACK_N = 0
        bt.window('t', FakeRun(), 0.0, 0.0, 6.0, 1.1, H, 0.9, lf)
        return list(CAP), bt.WINBACK_N

    def spans(cap):
        return [(p['name'], round(p['z0'], 6), round(p['z1'], 6)) for p in cap]

    # ① lf=0.995：7.2mm 实心段是正高度 → 必须出板；总覆盖 = h+0.14 不缩水（旧实现跳过 ≤1cm 实心段）
    cap, n = call(0.995)
    sol = (1.0 - 0.995) * (H + 0.14)
    ok('① lf=0.995 出 7.2mm 正高度实心段 + 完整覆盖',
       spans(cap) == [('winb-solid-t', round(LO, 6), round(LO + sol, 6)),
                      ('winb-t', round(LO + sol, 6), round(HI, 6)),
                      ('win-t', round(LO + sol, 6), round(Z0 + H + 0.03, 6))] and n == 1,
       'got %s n=%d（期望 solid %.4f m，总覆盖 %.2f m）' % (spans(cap), n, sol, H + 0.14))
    # ② lf=0：覆盖段零高 → 不拆段不出 lit 板不计数，整体保留 timber（旧实现仍出零面积板并计数）
    cap, n = call(0.0)
    ok('② lf=0 覆盖段零高：整体保留 timber、不出 lit 板、不计数',
       spans(cap) == [('winb-solid-t', round(LO, 6), round(HI, 6))] and n == 0,
       'got %s n=%d' % (spans(cap), n))
    # ④ lf=0.75（正常值回归）：拆段几何与基线一致
    cap, n = call(0.75)
    sol = 0.25 * (H + 0.14)
    ok('④ lf=0.75 正常拆段回归（与 wave12-towerwin2 T0 几何一致）',
       spans(cap) == [('winb-solid-t', round(LO, 6), round(LO + sol, 6)),
                      ('winb-t', round(LO + sol, 6), round(HI, 6)),
                      ('win-t', round(LO + sol, 6), round(Z0 + H + 0.03, 6))] and n == 1,
       'got %s n=%d' % (spans(cap), n))
    # ③ lf 超出 [0,1]：直接报错（旧实现静默越界）
    for bad in (1.2, -0.1):
        try:
            call(bad)
            ok('③ lf=%s 直接报错' % bad, False, '未抛 SystemExit')
        except SystemExit as e:
            ok('③ lf=%s 直接报错' % bad, '超出 [0,1]' in str(e), str(e)[:80])

    # screen 拆段（内联在主 build 路径，无法单独调用）→ 源码锚点断言三保护与 window 同构在位
    i0 = src.index("if sty == 'screen':")
    i1 = src.index('# 窗带：白墙上一条通开间的格心窗')
    scr = src[i0:i1]
    ok('screen 拆段三保护在位（lf 校验 / 覆盖段>0.01 才拆 / 否则整板 timber）',
       '超出 [0,1]' in scr and 'zl1 - zw0 > 0.01' in scr
       and "rpanel('winbay-solid-%s-%d' % (tag, bi), r, (g0 + g1) / 2, 0.02, zl0, zl1" in scr
       and 'SCREENBACK_N += 1' in scr,
       'screen 分支缺同款退化保护')

    if FAILS:
        print('build-tower-degenerate-test：%d 项 FAIL' % len(FAILS))
        return 1
    print('build-tower-degenerate-test：all green（%d 项）' % PASSES)
    return 0


if __name__ == '__main__':
    sys.exit(main())
