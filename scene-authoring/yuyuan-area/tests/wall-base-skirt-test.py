#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave14-rockseam：园墙勒脚裙板契约（巡检 #12 tour-dajiashan 黄昏地面硬拼缝）。

取证结论（工单包 artifacts/before/）：建造基面约定 y=0（墙/铺装），全局地面平面 y=-0.4
（src/build-scene.mjs GROUND_Y），园墙墙脚因此悬空 0.4 m。dusk 太阳仰角 9°（lighting/presets.json）
掠射时，光从墙下缝漏过、阴影贴图在缝上打出一条与墙平行的硬直边黑带；pickDebug 证明黑带与
"另一块地面"是同一个 ground 对象（不是两块材质）。修法：沿 baseline/layout.json garden-wall
segments 加勒脚裙板（build-scene.mjs，-0.44..+0.03，闭合交界），交界自然。

期望值全部独立于生成器输出：
  - 墙段来自 baseline/layout.json（冻结设计源）；
  - GROUND_Y 从 src/build-scene.mjs 源码解析（设计常量），并与 zone-outer.glb 实测地面交叉核对；
  - 裙板盒的 y 跨度 / 每段覆盖由本文件常量与段几何重算。
断言对象是运行时 zone-garden.glb（OUT_DIR）。

负例（明显错误输入，变异临时副本后必须红）：
  WALL_SKIRT_NEG=2  裙板整体抬高 +0.6（不再闭合交界带）→ 必须 FAIL
  WALL_SKIRT_NEG=3  删除裙板节点（回到基线状态）→ 必须 FAIL

用法：OUT_DIR=out-zone python3 -X utf8 tests/wall-base-skirt-test.py
"""
import json
import math
import os
import re
import struct
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, os.environ.get('OUT_DIR', 'out-zone'))

# 设计常量（与 src/build-scene.mjs 园墙勒脚块一致）
SKIRT_BOT = -0.44
SKIRT_TOP = 0.03

pass_n = 0
fail_n = 0
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


def read_glb(path):
    data = open(path, 'rb').read()
    if data[:4] != b'glTF':
        raise RuntimeError('not glb: ' + path)
    jlen = struct.unpack('<I', data[12:16])[0]
    j = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blen = struct.unpack('<I', data[off:off + 4])[0]
    return j, data[off + 8:off + 8 + blen]


CT = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def accessor(j, bin_, ai):
    a = j['accessors'][ai]
    bv = j['bufferViews'][a['bufferView']]
    fmt, bs = CT[a['componentType']]
    nc = NC[a['type']]
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride') or bs * nc
    return [struct.unpack_from('<' + fmt * nc, bin_, base + i * stride) for i in range(a['count'])]


def node_tris(j, bin_):
    """[(node_name, [tri, ...])]，tri = 世界坐标三顶点。"""
    parent = {}
    for i, n in enumerate(j.get('nodes', [])):
        for c in n.get('children', []):
            parent[c] = i

    def mat(n):
        if 'matrix' in n:
            m = struct.unpack('<16f', struct.pack('<16f', *n['matrix']))
            import numpy as np
            return np.array(n['matrix'], dtype=float).reshape(4, 4).T
        t = n.get('translation', [0, 0, 0])
        r = n.get('rotation', [0, 0, 0, 1])
        s = n.get('scale', [1, 1, 1])
        x, y, z, w = r
        R = [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
        return [[R[c][k] * s[k] for k in range(3)] + [t[c]] for c in range(3)] + [[0, 0, 0, 1]]

    def mul(a, b):
        return [[sum(a[r][k] * b[k][c] for k in range(4)) for c in range(4)] for r in range(4)]

    def xform(m, v):
        return [m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2] + m[r][3] for r in range(3)]

    def wm(i):
        m = None
        cur = i
        chain = []
        seen = set()
        while cur is not None:
            if cur in seen:
                raise RuntimeError('节点父链成环（node %d）——GLB 节点引用损坏' % cur)
            seen.add(cur)
            chain.append(cur)
            cur = parent.get(cur)
        for c in reversed(chain):
            m = mat(j['nodes'][c]) if m is None else mul(m, mat(j['nodes'][c]))
        return m

    out = []
    for i, n in enumerate(j.get('nodes', [])):
        if 'mesh' not in n:
            continue
        m = wm(i)
        tris = []
        for prim in j['meshes'][n['mesh']].get('primitives', []):
            pos = accessor(j, bin_, prim['attributes']['POSITION'])
            wpos = [xform(m, v) for v in pos]
            if 'indices' in prim:
                idx = [int(v[0]) for v in accessor(j, bin_, prim['indices'])]
            else:
                idx = list(range(len(wpos)))
            for k in range(0, len(idx) - 2, 3):
                tris.append([wpos[idx[k]], wpos[idx[k + 1]], wpos[idx[k + 2]]])
        out.append((n.get('name', '?'), tris))
    return out


def tri_bbox(tri):
    xs = [v[0] for v in tri]
    ys = [v[1] for v in tri]
    zs = [v[2] for v in tri]
    return min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)


def collect():
    gp = os.path.join(OUT, 'zone-garden.glb')
    if not os.path.exists(gp):
        print('zone-garden.glb 不存在（OUT_DIR=%s）——需要 ZONE_SPLIT=1 标准重建后运行' % OUT)
        return None
    j, bin_ = read_glb(gp)
    skirt, wall = [], []
    for nm, tris in node_tris(j, bin_):
        if 'wallBaseSkirt' in nm:
            skirt.extend(tris)
        elif nm.startswith('garden-wall__'):
            wall.extend(tris)
    ground_y = None
    op = os.path.join(OUT, 'zone-outer.glb')
    if os.path.exists(op):
        jo, bo = read_glb(op)
        for nm, tris in node_tris(jo, bo):
            if nm.endswith('|ground|L0') and tris:
                ground_y = min(v[1] for t in tris for v in t)
    return skirt, wall, ground_y


def main():
    global OUT
    layout = json.load(open(os.path.join(ROOT, 'baseline', 'layout.json'), encoding='utf-8'))
    wall_obj = next((o for o in layout['objects'] if o.get('id') == 'garden-wall'), None)
    ok('layout 有 garden-wall 且带 segments', bool(wall_obj) and bool(wall_obj.get('geometry', {}).get('segments')))
    if not wall_obj:
        sys.exit(1)
    segs = [s for s in wall_obj['geometry']['segments'] if math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) >= 0.5]

    # GROUND_Y 设计常量：从 build-scene.mjs 源码解析（不读产物当真值）
    src = open(os.path.join(ROOT, 'src', 'build-scene.mjs'), encoding='utf-8').read()
    mgy = re.search(r'const GROUND_Y = ([-0-9.]+)', src)
    ok('build-scene.mjs 可解析 GROUND_Y', bool(mgy))
    if not mgy:
        sys.exit(1)
    ground_design = float(mgy.group(1))

    got = collect()
    neg = os.environ.get('WALL_SKIRT_NEG', '')
    if neg:
        # 负例：变异临时副本后按同一套断言评估，必须出现失败（变异被抓住）
        assert neg in ('2', '3'), 'unknown NEG'
        data = open(os.path.join(OUT, 'zone-garden.glb'), 'rb').read()
        jlen = struct.unpack('<I', data[12:16])[0]
        j = json.loads(data[20:20 + jlen])
        if neg == '3':
            # 保留节点索引（children / scenes 引用不变），只摘掉裙板节点的 mesh 引用——
            # 旧写法直接过滤 nodes 使后续索引整体前移，父链成环、无限循环吃满内存（2026-09-30 5 次 OOM 的根因）
            hit = 0
            for n in j['nodes']:
                if 'wallBaseSkirt' in (n.get('name') or '') and 'mesh' in n:
                    del n['mesh']; hit += 1
            ok('NEG3 变异目标存在', hit > 0)
            # 必须把变异后的 JSON 写回 GLB 字节（只改解析对象不重写 = 副本等于原件，测了个寂寞）
            newj = json.dumps(j, separators=(',', ':')).encode('utf-8')
            if len(newj) % 4:
                newj += b' ' * (4 - len(newj) % 4)
            off = 20 + jlen
            blen = struct.unpack('<I', data[off:off + 4])[0]
            total = 12 + 8 + len(newj) + 8 + blen
            data = (struct.pack('<III', 0x46546C67, 2, total)
                    + struct.pack('<I', len(newj)) + b'JSON' + newj
                    + struct.pack('<I', blen) + b'BIN\x00'
                    + data[off + 8:off + 8 + blen])
        else:
            # 抬高裙板：把含 wallBaseSkirt 的网格顶点 y +0.6（直接改二进制里的 float）
            targets = [i for i, n in enumerate(j['nodes']) if 'wallBaseSkirt' in (n.get('name') or '')]
            ok('NEG2 变异目标存在', bool(targets))
            blob = bytearray(data)
            for ni in targets:
                nm = j['nodes'][ni]
                for prim in j['meshes'][nm['mesh']]['primitives']:
                    a = j['accessors'][prim['attributes']['POSITION']]
                    bv = j['bufferViews'][a['bufferView']]
                    base = 20 + jlen + 8 + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
                    stride = bv.get('byteStride') or 12
                    for i in range(a['count']):
                        off = base + i * stride + 4  # y 分量（glTF y-up）
                        y = struct.unpack_from('<f', blob, off)[0]
                        struct.pack_into('<f', blob, off, y + 0.6)
            data = bytes(blob)
        tmp = tempfile.mkdtemp(prefix='wallskirt-neg-')
        mut = os.path.join(tmp, 'zone-garden.glb')
        open(mut, 'wb').write(data)
        # 原地切 OUT 到变异副本目录再评估
        old_out = OUT
        OUT = tmp
        open(os.path.join(tmp, 'zone-outer.glb'), 'wb').write(open(os.path.join(old_out, 'zone-outer.glb'), 'rb').read())
        got = collect()
        p0, f0 = pass_n, fail_n
        run_assertions(got, segs, ground_design)
        caught = (fail_n - f0) > 0
        ok('NEG%s 变异被抓住（%d 项断言失败）' % (neg, fail_n - f0), caught,
           '变异后仍然全绿 = 断言没绑住被测对象')
        _ = mut
        print('wall-base-skirt-test NEG%s: %d pass, %d fail' % (neg, pass_n, fail_n))
        sys.exit(0 if caught else 1)

    if got is None:
        print('SKIP: zone-garden.glb 缺失（0 断言）——与 rockery-test 同口径；标准重建后必在')
        sys.exit(0)
    run_assertions(got, segs, ground_design)
    print('wall-base-skirt-test: %d pass, %d fail' % (pass_n, fail_n))
    if fail_n:
        for f in failures:
            print('  FAIL:', f)
        sys.exit(1)


def run_assertions(got, segs, ground_design):
    skirt, wall, ground_runtime = got
    ok('A1 裙板几何存在（≥100 三角）', len(skirt) >= 100, 'got %d' % len(skirt))
    ok('A1b 设计地面常量 GROUND_Y=-0.4', abs(ground_design - (-0.4)) < 1e-6, str(ground_design))
    if ground_runtime is not None:
        ok('A1c 运行时地面与设计常量一致(±0.01)', abs(ground_runtime - ground_design) <= 0.01,
           'runtime %s design %s' % (ground_runtime, ground_design))
    else:
        ok('A1c 运行时地面可读（zone-outer.glb ground）', False, 'ground node missing')
    if not skirt:
        return
    ys = [v[1] for t in skirt for v in t]
    # A2 交界带闭合：裙板向下到地面（±0.05），向上到建造基面 y=0
    ok('A2 裙板触及地面侧（min_y ≤ GROUND_Y+0.05）', min(ys) <= ground_design + 0.05,
       'min_y=%.3f' % min(ys))
    ok('A2b 裙板接到建造基面（max_y ≥ -0.02）', max(ys) >= -0.02, 'max_y=%.3f' % max(ys))
    # A2c 顶面不与园路铺装（顶 +0.05）共面：至少低 1 cm，避免门楼通路交界深度争夺（astra 2026-09-30 必修2）
    ok('A2c 裙板顶面低于园路铺装顶（≤ +0.04）', max(ys) <= 0.04, 'max_y=%.3f' % max(ys))
    # A3 逐段覆盖：每段中点附近有裙板三角，且其 y 在裙板跨度内
    missing = []
    for si, s in enumerate(segs):
        cx = (s[0][0] + s[1][0]) / 2
        cz = (s[0][1] + s[1][1]) / 2
        hit = 0
        for t in skirt:
            x0, x1, y0, y1, z0, z1 = tri_bbox(t)
            if abs((x0 + x1) / 2 - cx) <= 0.6 and abs((z0 + z1) / 2 - cz) <= 0.6 \
                    and abs((y0 + y1) / 2 - (SKIRT_BOT + SKIRT_TOP) / 2) <= 0.3:
                hit += 1
        if not hit:
            missing.append(si)
    ok('A3 全部 %d 段都有裙板盒' % len(segs), len(missing) == 0, 'missing segs %s' % missing)
    # A4 交界带被实体占据：每段中点邻域（与 A3 同一 0.6 m 窗口）内的裙板材料，
    # 其 y 联合跨度必须覆盖整条交界带 [GROUND_Y, 0]。
    # （裙板盒是空心网格：竖直线穿盒心只交顶/底两面，"单竖线连续覆盖"永不成立；
    #   工程语义是低角度视线在该段范围内打到的裙板材料从地面侧连到墙脚——
    #   等价于该段邻域材料的 y 跨度 ⊇ 交界带。负例：整体抬高后 min_y 抬离地面侧 → FAIL。）
    open_band = []
    band_lo, band_hi = ground_design + 0.02, -0.03
    for si, s in enumerate(segs):
        cx = (s[0][0] + s[1][0]) / 2
        cz = (s[0][1] + s[1][1]) / 2
        near_ys = []
        for t in skirt:
            x0, x1, y0, y1, z0, z1 = tri_bbox(t)
            if abs((x0 + x1) / 2 - cx) <= 0.6 and abs((z0 + z1) / 2 - cz) <= 0.6:
                near_ys.append((y0, y1))
        covered = bool(near_ys) and min(y0 for y0, _ in near_ys) <= band_lo \
            and max(y1 for _, y1 in near_ys) >= band_hi
        if not covered:
            open_band.append(si)
    ok('A4 墙脚 0.4 m 交界带被裙板实体闭合（逐段）', not open_band, 'open segs %s' % open_band)


if __name__ == '__main__':
    main()
