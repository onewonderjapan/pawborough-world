#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave14-pvquality：PV 渲染画质两修的行为级测试（Q18 pv01 地平线硬边 / Q20 segmentation 盐点）。

不依赖 Blender 运行、不依赖 GPU 与渲染产物：stub bpy 后加载 render-control-passes.py
（手法同 tests/pv-export-args-test.py：末尾无条件 main() 只截掉这一行，其余原样执行，
结尾不再是裸 main() 即报错退出，不许静默跳过）。

  T1（Q20）：Blender 4.5 的 scene.render.dither_intensity 默认 1.0，Workbench seg 通道
     （OBJECT 色、filter_size=0、AA off）输出仍带 ±1 有序抖动——wave13-nightqa Q20 取证：
     pv13 frame-059 半行抽样非 LUT 像素 87888 个、101 种颜色全部是某个 LUT 色（含
     unassigned）的 ±1 变体（如 ground 87,133,82 → 86,132,81/88,134,83）。断言
     config_workbench 的 seg 分支把 dither_intensity 写成 0.0（纯 ID 色无混色）；
     beauty 分支不得写它（workbench beauty「不给参数 = 旧输出逐字节相同」契约不变）。

  T2（Q18）：pv01 航拍远景地平线硬边的根因是 far clip=300 m 处米色地面（ground 大平面
     边界在 2 km 外，被 clip 切断）直接切到世界背景天空，无大气透视。修法（GOAL 方向二）：
     beauty 段按镜头声明 atmosphere 走 Cycles Mist pass + compositor，把远景按 mist 因子
     线性混入「天空地平色」，只作用 beauty；控制通道（seg/depth/normal）在 finally 卸载。
     断言 atmosphere_params 纯函数：无声明 → None；true → 默认参数，雾色 =
     srgb_lin(sky.horizon)/exposure（与 build_lighting_world 相机射线天空色同一线性域，
     期望由测试自己的 sRGB 解码实现独立计算，不调被测函数的 srgb_lin）；对象声明可覆盖
     startM/depthM；非正数参数报错拒绝。

  T3（Q20 统计器）：scripts/check-seg-purity.py 的 count_off_lut_pixels——非 LUT 颜色
     像素统计是 Q20 验收判据，测试它「能失败」：纯 LUT/unassigned 色图 → 0；注入 ±1
     变体像素 → ≥1；全错图 → 全部像素计数。

用法：python3 -X utf8 tests/pv-quality-control-test.py
"""
import importlib.util
import json
import os
import sys
import types

AREA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RENDERER = os.path.join(AREA, 'scripts', 'render-control-passes.py')
PURITY = os.path.join(AREA, 'scripts', 'check-seg-purity.py')
PRESETS = os.path.join(AREA, 'lighting', 'presets.json')

passes = 0
fails = 0


def check(ok, msg):
    global passes, fails
    if ok:
        passes += 1
    else:
        fails += 1
        print('FAIL:', msg)


def load_renderer(path):
    src = open(path, encoding='utf-8').read().rstrip()
    if not src.endswith('\nmain()'):
        raise SystemExit('E: %s 末尾不是裸 main()，加载护栏失效，拒绝继续' % path)
    body = src[:src.rindex('\nmain()')]
    sys.modules.setdefault('bpy', types.ModuleType('bpy'))
    mod = types.ModuleType('render_control_passes_under_test')
    mod.__file__ = path
    exec(compile(body, path, 'exec'), mod.__dict__)
    return mod


# ---------------- T1 fake scene ----------------
class FakeShading:
    def __init__(self):
        self.light = None
        self.color_type = None
        self.show_shadows = None
        self.show_cavity = None
        self.background_type = None


class FakeDisplay:
    def __init__(self):
        self.shading = FakeShading()
        self.render_aa = None


class FakeViewSettings:
    def __init__(self):
        self.view_transform = None
        self.look = None
        self.exposure = None
        self.gamma = None


class FakeRender:
    def __init__(self):
        self.engine = None
        self.filter_size = None
        self.dither_intensity = 1.0     # Blender 4.5 默认值（实测 DITHER_DEFAULT 1.0）


class FakeWorld:
    def __init__(self, name):
        self.name = name
        self.color = None


class FakeWorlds:
    def __init__(self):
        self.worlds = {}

    def get(self, name):
        return self.worlds.get(name)

    def new(self, name):
        w = FakeWorld(name)
        self.worlds[name] = w
        return w


class FakeData:
    def __init__(self):
        self.worlds = FakeWorlds()


class FakeScene:
    def __init__(self):
        self.render = FakeRender()
        self.display = FakeDisplay()
        self.view_settings = FakeViewSettings()
        self.world = None


def make_fake_bpy():
    bpy = types.ModuleType('bpy')
    bpy.data = FakeData()
    bpy.context = types.SimpleNamespace(view_layer=None)
    return bpy


def srgb_to_lin_hex(hexstr):
    """测试自己的 sRGB 解码实现（独立期望，不调被测模块的 srgb_lin）。"""
    h = hexstr.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return out


def main():
    bpy_stub = make_fake_bpy()
    sys.modules['bpy'] = bpy_stub
    rcp = load_renderer(RENDERER)

    P = json.load(open(PRESETS, encoding='utf-8'))

    # ---- T1（Q20）：seg 通道 dither=0，beauty 分支不动 dither ----
    sc = FakeScene()
    bpy_stub.data = FakeData()
    rcp.config_workbench(sc, 'seg')
    check(sc.render.dither_intensity == 0.0,
          'T1: config_workbench(seg) 后 dither_intensity=%r（期望 0.0——OBJECT 色必须逐字节精确，'
          '默认 1.0 的有序抖动让所有 LUT 色带 ±1 变体）' % sc.render.dither_intensity)

    sc2 = FakeScene()
    bpy_stub.data = FakeData()
    rcp.config_workbench(sc2, 'beauty')
    check(sc2.render.dither_intensity == 1.0,
          'T1: config_workbench(beauty) 改了 dither_intensity=%r（期望保持默认 1.0 不写——'
          'workbench beauty「不给参数 = 旧输出逐字节相同」契约）' % sc2.render.dither_intensity)

    # ---- T2（Q18）：atmosphere_params 纯函数 ----
    check(hasattr(rcp, 'atmosphere_params'),
          'T2: 渲染器没有 atmosphere_params（Q18 修法要求渲染器提供镜头级 atmosphere 参数'
          '纯函数：beauty 段 Mist pass + compositor 只作用 beauty）')
    if hasattr(rcp, 'atmosphere_params'):
        r = rcp.atmosphere_params(P, 'day', {'id': 'pv01-aerial-reveal'})
        check(r is None, 'T2: 无 atmosphere 声明 → 期望 None，得到 %r' % (r,))

        r = rcp.atmosphere_params(P, 'day', {'id': 'pv01-aerial-reveal', 'atmosphere': True})
        check(isinstance(r, dict), 'T2: atmosphere=true → 期望参数 dict，得到 %r' % (r,))
        if isinstance(r, dict):
            p = P['presets']['day']
            exp_fog = tuple(c / p['exposure'] for c in srgb_to_lin_hex(p['sky']['horizon']))
            got = r.get('fogLinear')
            check(all(abs(a - b) < 1e-9 for a, b in zip(got, exp_fog)) and len(got) == 3,
                  'T2: 雾色 %r ≠ 期望 srgb_lin(sky.horizon)/exposure=%r（必须与相机射线天空色'
                  '同一线性域：build_lighting_world 的背景 strength=1/exposure）' % (got, exp_fog))
            check(r.get('startM', 0) > 0 and r.get('depthM', 0) > 0,
                  'T2: mist 参数非法 startM=%r depthM=%r' % (r.get('startM'), r.get('depthM')))
            # 几何口径（取证数字写进断言）：start+depth 必须恰好覆盖 far clip（300 m），
            # 且起点不得短于 pv01 注视目标距离（湖心亭 ~175 m，主体不吃雾）
            check(abs((r['startM'] + r['depthM']) - 300.0) < 1e-6,
                  'T2: startM+depthM=%r（期望 = far clip 300.0——300 m 处 mist 必须到 1.0，'
                  'clip 裁剪边缘才完全隐入天空色）' % (r['startM'] + r['depthM']))
            check(r['startM'] >= 175.0,
                  'T2: startM=%r（期望 ≥ 175——pv01 注视目标湖心亭约 175 m，起点更近会让'
                  '画面主体被雾化）' % r['startM'])

        r = rcp.atmosphere_params(P, 'dusk', {'id': 'x', 'atmosphere': {'startM': 100.0, 'depthM': 200.0}})
        check(isinstance(r, dict) and r.get('startM') == 100.0 and r.get('depthM') == 200.0,
              'T2: atmosphere 对象声明应覆盖 startM/depthM，得到 %r' % (r,))
        if isinstance(r, dict):
            p = P['presets']['dusk']
            exp_fog = tuple(c / p['exposure'] for c in srgb_to_lin_hex(p['sky']['horizon']))
            check(all(abs(a - b) < 1e-9 for a, b in zip(r.get('fogLinear', (0, 0, 0)), exp_fog)),
                  'T2: dusk 雾色未按 dusk 预设的 sky.horizon/exposure 计算：%r vs %r'
                  % (r.get('fogLinear'), exp_fog))

        for bad in ({'startM': 0}, {'depthM': -5}):
            try:
                rcp.atmosphere_params(P, 'day', {'id': 'x', 'atmosphere': dict(bad)})
                check(False, 'T2: 非法参数 %r 未被拒绝（期望 SystemExit）' % bad)
            except SystemExit:
                check(True, '')

    # ---- T3（Q20 统计器）：count_off_lut_pixels 能失败 ----
    spec = importlib.util.spec_from_file_location('check_seg_purity', PURITY)
    pur = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pur)
    from PIL import Image
    legal = {(10, 20, 30), (200, 100, 50)}
    ua = (255, 0, 255)
    im = Image.new('RGB', (4, 4))
    px = im.load()
    for y in range(4):
        for x in range(4):
            px[x, y] = legal.pop() if False else (10, 20, 30) if (x + y) % 2 else (255, 0, 255)
    check(pur.count_off_lut_pixels(im, legal, ua) == 0,
          'T3: 纯 LUT/unassigned 色图统计非 0（判据对合法图误报）')
    px[2, 1] = (11, 20, 30)          # legal ±1 变体（dither 形态）
    px[0, 3] = (254, 0, 254)         # unassigned ±1 变体
    check(pur.count_off_lut_pixels(im, legal, ua) == 2,
          'T3: 注入两个 ±1 变体后计数=%r（期望 2——统计器必须抓得住 dither 形态的盐点）'
          % pur.count_off_lut_pixels(im, legal, ua))
    im2 = Image.new('RGB', (3, 3), (1, 2, 3))
    check(pur.count_off_lut_pixels(im2, legal, ua) == 9,
          'T3: 全错图计数=%r（期望 9=全部像素）' % pur.count_off_lut_pixels(im2, legal, ua))

    print('pv-quality-control-test: %d pass, %d fail' % (passes, fails))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
