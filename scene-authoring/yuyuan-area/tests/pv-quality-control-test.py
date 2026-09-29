#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave14-pvquality R1：PV 渲染画质两修（Q18/Q20）+ R1 返修的行为级测试。

不依赖 Blender 运行、不依赖 GPU 与渲染产物：stub bpy 后加载 render-control-passes.py
（手法同 tests/pv-export-args-test.py：末尾无条件 main() 只截掉这一行，其余原样执行，
结尾不再是裸 main() 即报错退出，不许静默跳过）。

  T1/T5（Q20+R1必修3）：Blender 4.5 的 scene.render.dither_intensity 默认 1.0（8-bit 输出
     带 ±1 有序抖动；wave13-nightqa 取证：pv13 seg 单帧半行抽样 87888 个非 LUT 像素、
     101 种颜色全部是某个 LUT 色/unassigned 的 ±1 变体）。主控裁定：dither 是场景共享
     状态，每个阶段入口显式赋值——seg/normal/depth=0.0、beauty 两引擎=1.0。
     T1 断言单阶段配置；T5 断言同一场景按 seg→beauty(WB)→normal+depth(Cycles)→seg→
     lit beauty→atm depth 顺序切换后每阶段值正确（不依赖执行顺序）。

  T2（Q18）：pv01 航拍远景地平线硬边的根因是 far clip=300 m 处米色地面（ground 大平面
     边界在 2 km 外，被 clip 切断）直接切到世界背景天空，无大气透视。修法（R2 定稿）：
     beauty 段按镜头声明 atmosphere 走 depth 后处理显示域混合，只作用 beauty；控制通道
     （seg/depth/normal）在 finally 卸载。断言 atmosphere_params 纯函数。

  T3（Q20 统计器）：scripts/check-seg-purity.py 的 count_off_lut_pixels——非 LUT 颜色
     像素统计是 Q20 验收判据，测试它「能失败」。

  T4/T4b/T4c/T4d（Q18+R1必修1）：scripts/atmosphere-mix.py 的 mix() 显示域混合。
     R1必修1 重做了背景/表面判定：BW16 深度码 lsb≈4.6mm，round 量化把 z∈[far-2.3mm,far)
     的掠射远景表面与被裁天空编成同一批码（pv01 末帧 y=62 x=600–949 亮线根因，任何
     容差都只移动条带位置），改用同 pose 1spp alpha 覆盖掩码精确判定：天空 α=0 不吃雾、
     表面 α=1 照常吃雾，有效雾化系数 fac×α。T4b 断言 raw=65535 的表面/天空各按 alpha
     处理；T4c 断言边界深度码 65533/65534/65535 在掩码路径下全部按表面吃雾；T4d 锁定
     无掩码回退路径的排除语义（tol 默认统一为 0.01=CLI 默认）与雾色分散度防护字段。

  T6（R1必修4）：beauty 帧循环（render_beauty_frames）必须两引擎共用——workbench
     （lit=False，--beauty 默认值）只渲染不混雾；断言 Workbench 分支实际 render 调用次数
     =帧数、atmosphere 声明不触发非 lit 的二次渲染。

用法：python3 -X utf8 tests/pv-quality-control-test.py
"""
import importlib.util
import json
import os
import sys
import tempfile
import types

from PIL import Image

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
        self.film_transparent = False   # setup_render_base 基线（atmosphere 掩码临时改 True 再恢复）


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
        self.materials = FakeMaterials()


class FakeMaterial:
    def __init__(self, name):
        self.name = name
        self._use_nodes = False
        self._node_tree = None

    @property
    def use_nodes(self):
        return self._use_nodes

    @use_nodes.setter
    def use_nodes(self, v):
        # Blender 里 use_nodes=True 自动建 node_tree，fake 同式模拟
        self._use_nodes = bool(v)
        if self._use_nodes and self._node_tree is None:
            self._node_tree = FakeNodeTree()

    @property
    def node_tree(self):
        return self._node_tree


class FakeMaterials:
    def __init__(self):
        self._d = {}

    def get(self, name):
        return self._d.get(name)

    def new(self, name):
        m = FakeMaterial(name)
        self._d[name] = m
        return m


# ---------------- compositor 节点树 fake（R1：config_cycles / config_atmosphere_depth 行为级测试用） ----------------
class FakeSocketDict(dict):
    def __missing__(self, k):
        s = types.SimpleNamespace(default_value=None)
        self[k] = s
        return s


class FakeNode:
    def __init__(self, kind):
        self.bl_idname = kind
        self.inputs = FakeSocketDict()
        self.outputs = FakeSocketDict()
        self.operation = None
        self.use_clamp = None
        self.format = types.SimpleNamespace(file_format=None, color_mode=None, color_depth=None, compression=None)
        self.base_path = None


class FakeLinks:
    def __init__(self):
        self.links = []

    def new(self, a, b):
        self.links.append((a, b))


class FakeNodeBag:
    def __init__(self):
        self._l = []

    def __iter__(self):
        return iter(list(self._l))

    def new(self, kind):
        n = FakeNode(kind)
        self._l.append(n)
        return n

    def remove(self, n):
        self._l.remove(n)


class FakeNodeTree:
    def __init__(self):
        self.nodes = FakeNodeBag()
        self.links = FakeLinks()


class FakeCycles:
    def __init__(self):
        self.device = None
        self.samples = 0
        self.use_adaptive_sampling = None
        self.use_denoising = None
        self.max_bounces = None
        self.diffuse_bounces = None
        self.glossy_bounces = None
        self.transmission_bounces = None
        self.transparent_max_bounces = None
        self.sample_clamp_indirect = None
        self.denoiser = None
        self.denoising_use_gpu = None


class FakeRenderOps:
    """bpy.ops.render.render 调用计数（R1必修4：Workbench 分支实际 render 次数）。
    实例本身可调用（bpy.ops.render.render(write_still=...) 即调用实例）。"""

    def __init__(self):
        self.calls = []          # 每次的 write_still 值
        self.filepaths = []      # 每次渲染前的 scene.render.filepath 快照

    def __call__(self, write_still=False):
        self.calls.append(write_still)

    def render(self, write_still=False):
        self.__call__(write_still)


class FakeScene:
    def __init__(self):
        self.render = FakeRender()
        self.display = FakeDisplay()
        self.view_settings = FakeViewSettings()
        self.world = None
        self.use_nodes = False
        self.node_tree = FakeNodeTree()
        self.cycles = FakeCycles()
        self.frame_current = 0
        self.frame_set_calls = []

    def frame_set(self, k):
        self.frame_current = k
        self.frame_set_calls.append(k)


def make_fake_bpy():
    bpy = types.ModuleType('bpy')
    bpy.data = FakeData()
    bpy.context = types.SimpleNamespace(
        # 注意：故意不提供 use_pass_alpha——Blender 4.5 无此属性，代码若再碰它会当场
        # AttributeError（R1 首轮渲染在 frame-0 全崩的根因），让测试红在这里而不是渲染时。
        view_layer=types.SimpleNamespace(use_pass_z=False, material_override=None))
    bpy.ops = types.SimpleNamespace(render=types.SimpleNamespace(render=FakeRenderOps()))
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

    # ---- T1（Q20/R1必修3）：seg 通道 dither=0，beauty 分支显式保持默认 1.0 ----
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
          'T1: config_workbench(beauty) 后 dither_intensity=%r（期望显式 1.0——R1必修3 主控裁定：'
          '每阶段自己设置，beauty 显式保持 Blender 原默认，不依赖「没被前面的 seg 碰过」）'
          % sc2.render.dither_intensity)

    # ---- T5（R1必修3）：同一场景按 seg→beauty(WB)→normal+depth(Cycles)→seg→lit beauty→atm depth
    #      顺序切换（--fast-group 同进程多镜头的执行顺序），每阶段入口的 dither 值必须正确、
    #      不依赖此前阶段写过什么。 ----
    sc5 = FakeScene()
    bpy_stub.data = FakeData()
    vl5 = bpy_stub.context.view_layer
    tmp5 = tempfile.mkdtemp(prefix='pvq-t5-')

    def d5():
        return sc5.render.dither_intensity

    rcp.config_workbench(sc5, 'seg')
    check(d5() == 0.0, 'T5: ①seg 后 dither=%r（期望 0.0）' % d5())
    rcp.config_workbench(sc5, 'beauty')
    check(d5() == 1.0, 'T5: ②seg 后紧接 workbench beauty，dither=%r（期望 1.0——阶段自设，'
          '不是「没被碰过」）' % d5())
    rcp.config_cycles(sc5, 0.3, 300.0, tmp5)
    check(d5() == 0.0, 'T5: ③normal+depth（config_cycles）后 dither=%r（期望 0.0——'
          '数据通道显式关，不依赖先跑过 seg）' % d5())
    rcp.config_workbench(sc5, 'seg')
    check(d5() == 0.0, 'T5: ④回到 seg 后 dither=%r（期望 0.0）' % d5())
    P_day = P['presets']['day']
    rcp.config_beauty_lit(sc5, P, 'day', 'cycles', 0, 'CPU', bpy_stub.data.worlds.new('w5'))
    check(d5() == 1.0, 'T5: ⑤lit beauty（cycles）后 dither=%r（期望显式 1.0）' % d5())
    rcp.config_atmosphere_depth(sc5, 0.3, 300.0, tmp5)
    check(d5() == 0.0, 'T5: ⑥atmosphere depth（config_atmosphere_depth）后 dither=%r'
          '（期望 0.0——depth 数据通道）' % d5())
    check(sc5.render.film_transparent is True,
          'T5: ⑥atmosphere depth 后 film_transparent=True（R1必修1：RLayers.Alpha 掩码需要'
          ' film_transparent 才能区分被裁天空 α=0 与表面 α=1；Blender 4.5 无 use_pass_alpha 属性）')
    rcp.unconfig_atmosphere_depth(sc5)
    check(sc5.render.film_transparent is False and sc5.use_nodes is False,
          'T5: ⑥atmosphere depth 卸载后 film_transparent/use_nodes 复位'
          '（不透明天空是 beauty/控制通道基线，残留透明背景会渲出黑天）')
    rcp.config_beauty_lit(sc5, P, 'day', 'cycles', 0, 'CPU', bpy_stub.data.worlds.new('w5b'))
    check(d5() == 1.0, 'T5: ⑦atm depth 后回到 lit beauty，dither=%r（期望 1.0——try/finally'
          ' 卸载后由阶段入口重新自设）' % d5())
    rcp.unconfig_cycles(sc5)
    check(vl5.material_override is None and sc5.use_nodes is False,
          'T5: unconfig_cycles 后 material_override/use_nodes 已复位')

    # ---- T6（R1必修4）：Workbench 分支实际 render 调用次数——beauty 帧循环必须两引擎共用 ----
    tmp6 = tempfile.mkdtemp(prefix='pvq-t6-')
    sdir6 = os.path.join(tmp6, 'pv13-x')
    for sub in ('beauty', 'depth', 'normal', 'segmentation', 'cameras'):
        os.makedirs(os.path.join(sdir6, sub), exist_ok=True)
    ops6 = FakeRenderOps()
    bpy_stub.ops = types.SimpleNamespace(render=types.SimpleNamespace(render=ops6))
    st6 = {}
    ks6 = [0, 1, 2]
    pose6_calls = []

    def pose6(k):
        pose6_calls.append(k)

    def log6(msg):
        pass

    # Workbench（lit=False）：3 帧 3 次 write_still 渲染，filepath 依次是 beauty 帧路径
    rcp.render_beauty_frames(ks6, sdir6, pose6, sc5, 0.3, 300.0, False, None, None,
                             0, 0, '', None, True, None, None, 640, 360, st6, 'pv13-x',
                             log6, None)
    check(ops6.calls == [True, True, True],
          'T6: workbench（lit=False）render 调用=%r（期望 [True,True,True]——R1必修4：'
          'beauty 帧循环不得只在 lit 分支里，否则 --beauty workbench 默认调用一个 beauty 帧都不出）'
          % ops6.calls)
    exp_paths = [os.path.join(sdir6, 'beauty', 'frame-%03d.png' % k) for k in ks6]
    check(sc5.render.filepath == exp_paths[-1] and pose6_calls == ks6,
          'T6: 最后一次 filepath=%r / pose 序列=%r（期望逐帧 pose 后渲到 beauty/frame-00%d.png）'
          % (sc5.render.filepath, pose6_calls, ks6[-1]))
    check(sorted(st6.keys()) == ['frame-000', 'frame-001', 'frame-002'],
          'T6: st 记录=%r（期望三帧各有 beauty_s）' % sorted(st6.keys()))
    n_before = len(ops6.calls)
    # workbench 下即使误带 atmo 声明也不得触发 atmosphere 渲染（lit 才混雾）
    rcp.render_beauty_frames(ks6, sdir6, pose6, sc5, 0.3, 300.0, False, None, None,
                             0, 0, '', None, True, {'startM': 220.0, 'depthM': 80.0},
                             None, 640, 360, st6, 'pv13-x', log6, None)
    check(len(ops6.calls) == n_before + 3,
          'T6: workbench + atmosphere 声明时 render 调用增量=%r（期望仍只 +3——'
          '非 lit 引擎不触发 atmosphere depth 二次渲染）' % (len(ops6.calls) - n_before))

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

    # ---- T3b（R1可选1）：purity --cameras 按镜头声明的完整帧号核对（缺帧 FAIL，不依赖显式 --frames）----
    # 审查指出的缺口：目录仅剩 frame-000 时默认检查（查全部已有帧）仍返回成功；
    # --cameras 声明 2 帧 → 缺 frame-001 必须 FAIL。调度器在写成功 .done.json 前按全帧号调用。
    import subprocess
    tmp3b = tempfile.mkdtemp(prefix='pvq-t3b-')
    seg3b = os.path.join(tmp3b, 'x', 'segmentation')
    os.makedirs(seg3b, exist_ok=True)
    Image.new('RGB', (4, 4), (10, 20, 30)).save(os.path.join(seg3b, 'frame-000.png'))
    lut3b = os.path.join(tmp3b, 'segmentation-lut.json')
    with open(lut3b, 'w', encoding='utf-8') as f:
        json.dump({'version': 1, 'unassigned': [255, 0, 255], 'colorSpace': 'test',
                   'idToRgb': {'a': [10, 20, 30]}}, f)
    cam3b = os.path.join(tmp3b, 'pv-cameras.json')
    with open(cam3b, 'w', encoding='utf-8') as f:
        json.dump({'width': 4, 'height': 4, 'fps': 24,
                   'shots': [{'id': 'x', 'frames': 2, 'p': [0, 0, 0], 't': [1, 0, 0]}]}, f)
    base_cmd = ['python3', '-X', 'utf8', PURITY, '--control', tmp3b, '--lut', lut3b, '--shot', 'x']
    r3b_old = subprocess.run(base_cmd, capture_output=True, text=True)
    check(r3b_old.returncode == 0,
          'T3b: 无 --cameras 旧行为（查目录里已有帧）对仅剩 frame-000 的目录返回 %d'
          '（保持兼容；缺口由 --cameras 补）' % r3b_old.returncode)
    r3b_cam = subprocess.run(base_cmd + ['--cameras', cam3b], capture_output=True, text=True)
    check(r3b_cam.returncode != 0 and 'frame-001' in (r3b_cam.stdout + r3b_cam.stderr),
          'T3b: --cameras 声明 2 帧、目录只有 frame-000 → 缺帧 FAIL（得到 rc=%d %s）'
          % (r3b_cam.returncode, (r3b_cam.stdout + r3b_cam.stderr).strip()[-120:]))
    Image.new('RGB', (4, 4), (10, 20, 30)).save(os.path.join(seg3b, 'frame-001.png'))
    r3b_ok = subprocess.run(base_cmd + ['--cameras', cam3b], capture_output=True, text=True)
    check(r3b_ok.returncode == 0,
          'T3b: 补齐 frame-001 后 --cameras 全帧核对通过（rc=%d）' % r3b_ok.returncode)

    # ---- T4（Q18 混合器）：scripts/atmosphere-mix.py 的 mix() 显示域混合行为 ----
    spec4 = importlib.util.spec_from_file_location('atmosphere_mix', os.path.join(AREA, 'scripts', 'atmosphere-mix.py'))
    amix = importlib.util.module_from_spec(spec4)
    spec4.loader.exec_module(amix)
    check(hasattr(amix, 'mix'),
          'T4: scripts/atmosphere-mix.py 没有 mix()（Q18 要求 depth 单独渲 + 显示域混合，'
          '雾色取本帧顶部天空实际显示色，被 far 裁掉的背景不吃雾）')
    if hasattr(amix, 'mix'):
        tmp = tempfile.mkdtemp(prefix='pvq-t4-')
        bp, dp = os.path.join(tmp, 'b.png'), os.path.join(tmp, 'd.png')
        w, h, near, far = 4, 4, 0.3, 300.0

        def write_case(beauty_rows, z_rows):
            flat = bytes(v for row in beauty_rows for px in row for v in px)
            Image.frombytes('RGB', (w, h), flat).save(bp)
            zg = Image.new('I', (w, h))
            zpx = zg.load()
            for y in range(h):
                for x in range(w):
                    zpx[x, y] = z_rows[y]
            zg.save(dp)

        z250 = int(round(65535 * (250.0 - near) / (far - near)))
        sky = (200, 210, 220)
        # 构造：顶部行=天空色 (200,210,220) 且 z=背景（不吃雾）；其余行 z=250（fac=0.375）、纯黑
        write_case([[sky] * w] + [[(0, 0, 0)] * w for _ in range(h - 1)],
                   [65535] + [z250] * (h - 1))
        st = amix.mix(bp, dp, near, far, 220.0, 80.0)
        out = Image.open(bp).convert('RGB')
        opx = out.load()
        check(opx[0, 0] == sky,
              'T4: 背景（z≥far-0.5，顶部天空行）被雾化 %s（期望原样 %s——天空不吃雾，否则整片天空被换色）'
              % (opx[0, 0], sky))
        fac = 0.375
        expect = tuple(round(c * fac) for c in sky)     # 黑地面 × (1-fac) + 天空色 × fac
        got = opx[0, 2]
        check(all(abs(a - b) <= 1 for a, b in zip(got, expect)),
              'T4: z=250 混合值 %s ≠ 期望 %s（雾色应取顶部天空行中位 %s、fac=(250-220)/80=0.375）'
              % (got, expect, sky))
        check(list(st.get('fogSampledRGB', [])) == [float(c) for c in sky],
              'T4: fogSampledRGB=%r（期望 %s——本帧顶部天空实际显示色，保证远景与天空交界无缝）'
              % (st.get('fogSampledRGB'), list(sky)))
        check(abs(st.get('foggedFraction', -1) - 0.75) < 1e-6,
              'T4: foggedFraction=%r（期望 0.75：4 行里除背景行外 3 行吃雾）' % st.get('foggedFraction'))

        # ---- T4b（R1必修1）：alpha 掩码路径——天空/表面判定与深度码解耦 ----
        # 构造掠射远景表面：z raw=65535（深度阈值判定必然误判「被裁背景」——BW16 round 量化把
        # z∈[far-2.3mm, far) 与被裁天空编成同一批码，pv01 末帧 y=62 亮线根因），alpha=255 表面
        # vs alpha=0 天空各占两行。期望：表面行吃雾（fac≈1 → 雾色），天空行原样。
        mp = os.path.join(tmp, 'm.png')
        def write_mask(rows):
            mg = Image.new('L', (w, h))
            mpx = mg.load()
            for y in range(h):
                for x in range(w):
                    mpx[x, y] = rows[y]
            mg.save(mp)

        write_case([[sky] * w] + [[(10, 12, 14)] * w for _ in range(h - 1)],
                   [65535] * h)
        write_mask([0, 255, 255, 255])
        st = amix.mix(bp, dp, near, far, 220.0, 80.0, mask_png=mp)
        out = Image.open(bp).convert('RGB')
        opx = out.load()
        check(opx[0, 0] == sky,
              'T4b: raw=65535 且 alpha=0（被裁天空）被雾化 %s（期望原样 %s）' % (opx[0, 0], sky))
        expect_far = tuple(round(c * (1.0 - (300.0 - 220.0) / 80.0) + fc * 1.0)
                           for c, fc in zip((10, 12, 14), sky))
        got_far = opx[0, 1]
        check(all(abs(a - b) <= 1 for a, b in zip(got_far, expect_far)),
              'T4b: raw=65535 且 alpha=255（掠射远景表面）混合值 %s ≠ 期望 %s（'
              'z=far → fac=1 全雾化——深度阈值会把这行判成背景漏雾，alpha 判定纠正，'
              '这就是 pv01 末帧 y=62 亮线的修复判据）' % (got_far, expect_far))
        check(abs(st.get('skyFraction', -1) - 0.25) < 1e-6,
              'T4b: skyFraction=%r（期望 0.25）' % st.get('skyFraction'))
        check(st.get('farClipSaltPixels') == 12,
              'T4b: farClipSaltPixels=%r（期望 12=3 行表面×4 列——量化歧义区 raw≥far-tol 且 '
              'alpha=1 的真实表面像素数，被 alpha 判定纠正的量，出报告数字）'
              % st.get('farClipSaltPixels'))

        # ---- T4c（R1必修1/可选2）：边界深度码 65533/65534/65535 在掩码路径下全部按表面吃雾 ----
        # 行0=雾色来源行（beauty=sky、z=65533、alpha=255），行1/2=边界码表面（beauty=黑），
        # 行3=被裁天空（alpha=0）。若边界码被误判背景，行1/2 会保持黑色而挂。
        write_case([[sky] * w] + [[(0, 0, 0)] * w for _ in range(h - 1)],
                   [65533, 65534, 65535, 65535])
        write_mask([255, 255, 255, 0])
        st = amix.mix(bp, dp, near, far, 220.0, 80.0, mask_png=mp)
        out = Image.open(bp).convert('RGB')
        opx = out.load()
        for x, raw in ((1, 65534), (2, 65535)):
            got_b = opx[x, 1]
            check(all(abs(a - b) <= 1 for a, b in zip(got_b, sky)),
                  'T4c: 边界码 raw=%d 表面行混合值 %s ≠ 期望≈雾色 %s（fac≈0.9999 全雾化——'
                  '掩码路径下边界码表面照常吃雾，不吃雾只由 alpha=0 决定）' % (raw, got_b, sky))
        check(opx[0, 3] == sky,
              'T4c: raw=65535 且 alpha=0 的被裁天空行紧邻远带表面（cut_row±3 内）→ 边界 AA 渗漏'
              '修复生效，eff=1 收敛到雾色 %s（本例雾色=顶部带中位=同色；v2 语义，见 T4e）' % (sky,))

        # ---- T4d（可选2）：无掩码回退路径与统一容差默认——三码排除语义与 CLI 默认一致 ----
        # tol=0.01 m、(far-near)=299.7 → 排除码 ≥ round((far-0.01-near)/(far-near)*65535)
        # = round(65532.85) = 65533，即 raw∈{65533,65534,65535} 全部判背景不吃雾（回退路径的
        # 已知量化歧义——正式链路必须传掩码，这里锁定回退语义防漂移）。
        write_case([[sky] * w] + [[(7, 7, 7)] * w for _ in range(h - 1)],
                   [65533, 65534, 65535, int(round(65535 * (250.0 - near) / (far - near)))])
        st = amix.mix(bp, dp, near, far, 220.0, 80.0)
        out = Image.open(bp).convert('RGB')
        opx = out.load()
        check(opx[0, 1] == (7, 7, 7) and opx[0, 2] == (7, 7, 7),
              'T4d: 回退路径 raw=65534/65535 应判背景不吃雾（tol=0.01 与 CLI 默认统一），'
              '得到 %s' % [opx[0, i] for i in (1, 2)])
        expect_d = tuple(round(c * 0.625 + fc * 0.375) for c, fc in zip((7, 7, 7), sky))
        got_d = opx[0, 3]
        check(all(abs(a - b) <= 1 for a, b in zip(got_d, expect_d)),
              'T4d: raw=z250 行吃雾 %s ≠ 期望 %s（雾色=顶部 sky 行中位）' % (got_d, expect_d))
        check(st.get('fogSpreadWarn') in (True, False),
              'T4d: 统计应含 fogSpreadWarn（顶部中位色 MAD 防护字段，R1可选3）')
        check(isinstance(st.get('topSpreadMAD'), float),
              'T4d: 统计应含 topSpreadMAD=%r（顶部样本分散度数字）' % st.get('topSpreadMAD'))

        # ---- T4e（R1必修1 v2）：远裁边界 AA 渗漏修复 + 雾色地平线带取样 ----
        # 真实根因（pv01 night frame-143 实测）：夜档月光把远地面照成亮蓝灰 (60,80,127)，far clip
        # 把它直切暗天空；beauty 像素过滤把这行亮色渗进「中心射线是天空」的 AA 行，1 spp 掩码判
        # 其为天空（α=0 不吃雾）→ 残留 1 行亮边 (15,30,62)。判据与 beauty 采样一致化：cut_row
        # （远带表面像素最多的行）±3 行内、α=0 且 8 邻域有远带表面的像素 eff=1；雾色取 cut_row
        # 上方净天空带中位（地平线本地天空，不是天顶向的顶部 2%）；紧邻近处屋顶（邻域 fac 低）
        # 的天空不受影响。
        W2, H2 = 8, 32
        def write_case2(beauty_rows, z_rows, mask_rows):
            flat = bytes(v for row in beauty_rows for px in row for v in px)
            Image.frombytes('RGB', (W2, H2), flat).save(bp)
            zg = Image.new('I', (W2, H2))
            zpx = zg.load()
            mg = Image.new('L', (W2, H2))
            mpx = mg.load()
            for y in range(H2):
                for x in range(W2):
                    zpx[x, y] = z_rows[y]
                    mpx[x, y] = mask_rows[y]
            zg.save(dp)
            mg.save(mp)
        high_sky, hor_sky, bright, roof, gnd = (10, 20, 30), (2, 1, 14), (60, 80, 127), (90, 60, 40), (30, 30, 30)
        z299 = int(round(65535 * (299.25 - near) / (far - near)))
        z297 = int(round(65535 * (297.0 - near) / (far - near)))
        z100 = int(round(65535 * (100.0 - near) / (far - near)))
        z250e = int(round(65535 * (250.0 - near) / (far - near)))
        b_rows = ([high_sky] * W2, [high_sky] * W2, [high_sky] * W2) \
            + ([hor_sky] * W2,) * 9 + ([roof] * W2,) + ([hor_sky] * W2,) * 13 \
            + ([bright] * W2,) + ([bright] * W2,) * 2 + ([gnd] * W2,) * 3
        b_rows = [list(r) for r in b_rows]
        z_rows = [65535] * 27 + [z299] + [z297] + [z250e] * 3
        z_rows[12] = z100                                   # 行12=近处屋顶（穿进天空区）
        m_rows = [0] * 27 + [255] * 5
        m_rows[12] = 255
        m_rows[26] = 0                                      # 行26=边界渗漏 AA 行（中心射线是天空）
        write_case2(b_rows, z_rows, m_rows)
        st = amix.mix(bp, dp, near, far, 220.0, 80.0, mask_png=mp)
        out = Image.open(bp).convert('RGB')
        opx = out.load()
        check(st.get('boundaryRow') == 27,
              'T4e: boundaryRow=%r（期望 27=远带表面像素最多的裁切主线，而非行12 屋顶或行0 天空）'
              % st.get('boundaryRow'))
        check(list(st.get('fogSampledRGB', [])) == [float(c) for c in hor_sky] and st.get('fogSource') == 'horizon-sky',
              'T4e: fogSampledRGB=%r fogSource=%r（期望 %s/horizon-sky——雾色取裁切主线上方净天空带'
              '中位=地平线本地天空，不受行0-2 高空天 %s 影响）'
              % (st.get('fogSampledRGB'), st.get('fogSource'), list(hor_sky), list(high_sky)))
        check(opx[0, 26] == hor_sky,
              'T4e: 渗漏 AA 行混合值 %s ≠ 雾色 %s（α=0 且紧邻 cut_row 远带表面 → eff=1 全雾化，'
              '雾色=本地天空故与上方天空无缝——亮线消除的判据）' % (opx[0, 26], hor_sky))
        check(opx[0, 11] == hor_sky,
              'T4e: 屋顶邻接天空 %s 被改动（期望原样 %s——近处剪影的 AA 边缘是正常行为，'
              '不做边界修复）' % (opx[0, 11], hor_sky))
        got_far = opx[0, 27]
        expect_far = tuple(round(c * 0.0094 + f * 0.9906) for c, f in zip(bright, hor_sky))
        check(all(abs(a - b) <= 1 for a, b in zip(got_far, expect_far)),
              'T4e: 裁切行表面混合值 %s ≠ 期望 %s（fac(z=299.25)=0.9906 标准路径）'
              % (got_far, expect_far))
        check(opx[0, 12] == roof,
              'T4e: 近处屋顶 %s 被雾化（期望原样 %s——z=100 fac=0 不吃雾）' % (opx[0, 12], roof))
        got_gnd = opx[0, 29]
        expect_gnd = tuple(round(c * 0.625 + f * 0.375) for c, f in zip(gnd, hor_sky))
        check(all(abs(a - b) <= 1 for a, b in zip(got_gnd, expect_gnd)),
              'T4e: 近地面混合值 %s ≠ 期望 %s（z=250 fac=0.375 标准路径，雾色=地平线天）'
              % (got_gnd, expect_gnd))
        check(opx[0, 0] == high_sky,
              'T4e: 高空天 %s 被改动（期望原样 %s——远离裁切带的天空一字节不动）'
              % (opx[0, 0], high_sky))

    print('pv-quality-control-test: %d pass, %d fail' % (passes, fails))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
