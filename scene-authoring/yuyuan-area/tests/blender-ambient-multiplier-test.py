#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave12-blenderamb：Blender 端环境光倍率（lighting/presets.json 的 blender.ambientMultiplier）三项检查。

背景：同一份预设下查看器的半球环境光不被遮挡、Cycles 会被深檐挡住，所以 Cycles 檐下立面偏暗。
机主 2026-09-28 定：给 Blender 端单独加环境光倍率，只乘在 build_lighting_world 的 bg_amb
（非相机射线的半球环境光 Background）Strength 上；相机可见天空 bg_cam、太阳、点光、自发光
depth / normal / segmentation 一概不动；查看器 web/lighting.js 不读它。缺字段按 1.0（向后兼容）。

断言（期望值全部在本文件里从 presets.json 独立重算，不经渲染器任何函数）：
  T1 presets.json：blender.ambientMultiplier 存在，键恰为 day / dusk / night 三档，每档是 [1, 4] 内的数；
  T2 生效：用渲染器自己的 build_lighting_world 建灯光世界（stub bpy），对每档把倍率替换成
     区分度探针值（day 1.6 / dusk 2.4 / night 3.2），世界里的两个 Background 节点强度必须
     恰为 { 1/exposure（相机天空 bg_cam）, ambient.intensity/π × 探针值（环境光 bg_amb） }——
     6a2bf26c 上渲染器不读该字段，强度仍是 intensity/π，此处红；
  T3 兼容：删掉 blender.ambientMultiplier 后重建，bg_amb 强度必须仍 = intensity/π × 1.0。

红绿对照（B3）：6a2bf26c 上 T1+T2 红（artifacts/b3/red/，工单包），B1 改后全绿。
stub bpy 只覆盖 build_lighting_world 触到的面（worlds / node_tree / 节点 / 套接字惰性建），
渲染器文件不改动；末尾无条件 main() 的加载护栏与 pv-export-args-test 相同。

用法：python3 -X utf8 tests/blender-ambient-multiplier-test.py [--presets <json>] [--renderer <py>]
退出码：0 全过；1 有失败。
"""
import argparse
import copy
import importlib.util
import json
import math
import os
import sys
import types

AREA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRESETS = os.path.join(AREA, 'lighting', 'presets.json')
RENDERER = os.path.join(AREA, 'scripts', 'render-control-passes.py')
TOL = 1e-6
PROBE = {'day': 1.6, 'dusk': 2.4, 'night': 3.2}
NAMES = ('day', 'dusk', 'night')

fails = 0
passes = 0


def ok(cond, msg, data=None):
    global fails, passes
    if cond:
        passes += 1
        print('PASS %s' % msg)
    else:
        fails += 1
        print('FAIL %s%s' % (msg, (' ' + json.dumps(data, ensure_ascii=False)) if data is not None else ''))


# ---------------- stub bpy（只覆盖 build_lighting_world 触到的面） ----------------
class Socket:
    def __init__(self, key, node, kind):
        self.key = key
        self.node = node
        self.kind = kind
        self.default_value = None
        self.source = None


class Sockets:
    """整数或名字索引，惰性建套接字（脚本按 type 用到哪个建哪个）。"""

    def __init__(self, node, kind):
        self.node = node
        self.kind = kind
        self._m = {}

    def __getitem__(self, k):
        key = int(k) if isinstance(k, int) else str(k)
        if key not in self._m:
            self._m[key] = Socket(key, self.node, self.kind)
        return self._m[key]


NODE_TYPE = {
    'ShaderNodeRGB': 'RGB',
    'ShaderNodeMath': 'MATH',
    'ShaderNodeMix': 'MIX',
    'ShaderNodeTexCoord': 'TEX_COORD',
    'ShaderNodeVectorMath': 'VECTOR_MATH',
    'ShaderNodeSeparateXYZ': 'SEPARATE_XYZ',
    'ShaderNodeLightPath': 'LIGHT_PATH',
    'ShaderNodeBackground': 'BACKGROUND',
    'ShaderNodeOutputWorld': 'OUTPUT_WORLD',
}


class Node:
    def __init__(self, bl_idname):
        self.bl_idname = bl_idname
        self.type = NODE_TYPE.get(bl_idname, bl_idname)
        self.inputs = Sockets(self, 'in')
        self.outputs = Sockets(self, 'out')
        self.operation = None
        self.use_clamp = False
        self.data_type = None


class Nodes:
    def __init__(self):
        self._l = []

    def new(self, bl_idname):
        n = Node(bl_idname)
        self._l.append(n)
        return n

    def remove(self, n):
        self._l.remove(n)

    def __iter__(self):
        return iter(self._l)


class Links:
    def __init__(self):
        self._l = []

    def new(self, out_sock, in_sock):
        in_sock.source = out_sock
        self._l.append((out_sock, in_sock))


class Tree:
    def __init__(self):
        self.nodes = Nodes()
        self.links = Links()


class World:
    def __init__(self, name):
        self.name = name
        self.use_nodes = False
        self._tree = None

    @property
    def node_tree(self):
        if self._tree is None:
            self._tree = Tree()
        return self._tree


class Worlds:
    def __init__(self):
        self._d = {}

    def get(self, name):
        return self._d.get(name)

    def new(self, name):
        w = World(name)
        self._d[name] = w
        return w


def install_stub_bpy():
    bpy = sys.modules.get('bpy')
    if bpy is None or not hasattr(getattr(bpy, 'data', None), 'worlds'):
        bpy = types.ModuleType('bpy')
        bpy.data = types.SimpleNamespace(worlds=Worlds())
        sys.modules['bpy'] = bpy


def load_renderer(path):
    """加载渲染器模块但停在主流程之前：末尾无条件 main() 只在 Blender --python 下该跑。"""
    src = open(path, encoding='utf-8').read().rstrip()
    if not src.endswith('\nmain()'):
        raise SystemExit('E: %s 末尾不是裸 main()，加载护栏失效，拒绝继续（不许静默跳过）' % path)
    body = src[:src.rindex('\nmain()')]
    install_stub_bpy()
    spec = importlib.util.spec_from_file_location('render_control_passes_under_test', path)
    mod = importlib.util.module_from_spec(spec)
    mod.__file__ = path
    sys.modules[spec.name] = mod
    exec(compile(body, path, 'exec'), mod.__dict__)
    return mod


def background_strengths(rcp, doc, preset):
    """用渲染器自己的 build_lighting_world 建灯光世界，返回两个 Background 节点的 Strength 升序。"""
    install_stub_bpy()
    sys.modules['bpy'].data = types.SimpleNamespace(worlds=Worlds())  # 每例全新 world 集
    w = rcp.build_lighting_world(doc, preset)
    vals = sorted(n.inputs['Strength'].default_value for n in w.node_tree.nodes if n.type == 'BACKGROUND')
    return vals


def expected_strengths(doc, preset, mult):
    """独立重算：{ 1/exposure（bg_cam 相机天空）, ambient.intensity/π × 倍率（bg_amb 环境光） }，升序。"""
    p = doc['presets'][preset]
    return sorted([1.0 / p['exposure'], p['ambient']['intensity'] / math.pi * mult])


def close(a, b):
    return len(a) == len(b) and all(abs(x - y) <= TOL for x, y in zip(a, b))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--presets', default=PRESETS)
    ap.add_argument('--renderer', default=RENDERER)
    a = ap.parse_args()

    doc = json.load(open(a.presets, encoding='utf-8'))

    # T1 仓库 presets.json：blender.ambientMultiplier 三档齐、[1,4]
    m = doc.get('blender', {}).get('ambientMultiplier')
    ok(isinstance(m, dict) and sorted(m.keys()) == sorted(NAMES),
       'T1 blender.ambientMultiplier 键恰为 day/dusk/night', m)
    if isinstance(m, dict):
        for k in NAMES:
            v = m.get(k)
            ok(isinstance(v, (int, float)) and not isinstance(v, bool) and 1.0 <= float(v) <= 4.0,
               'T1 %s 倍率在 [1,4]' % k, v)

    rcp = load_renderer(a.renderer)

    # T2 生效：探针倍率被乘到 bg_amb（stub bpy 下用渲染器自己的函数读节点强度）
    for k in NAMES:
        d2 = copy.deepcopy(doc)
        d2.setdefault('blender', {})['ambientMultiplier'] = dict(PROBE)
        got = background_strengths(rcp, d2, k)
        want = expected_strengths(d2, k, PROBE[k])
        ok(close(got, want),
           'T2 %s Background 强度 = {1/exposure, I/π×%.2f}' % (k, PROBE[k]),
           {'got': [round(x, 6) for x in got], 'want': [round(x, 6) for x in want]})

    # T3 兼容：缺字段按 1.0
    for k in NAMES:
        d3 = copy.deepcopy(doc)
        d3.get('blender', {}).pop('ambientMultiplier', None)
        got = background_strengths(rcp, d3, k)
        want = expected_strengths(d3, k, 1.0)
        ok(close(got, want),
           'T3 %s 缺字段 bg_amb = I/π×1.0' % k,
           {'got': [round(x, 6) for x in got], 'want': [round(x, 6) for x in want]})

    print('blender-ambient-multiplier-test: %d/%d pass' % (passes, passes + fails))
    sys.exit(0 if fails == 0 else 1)


main()
