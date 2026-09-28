# -*- coding: utf-8 -*-
# 仪门双匾贴图测试（wave13-templefix T2）：左右两块匾共用一张图集
# kit/textures/yimen-plaques.png（上半 = 左匾，下半 = 右匾），同一材质、同一 UV 段式。
# wave13-nightqa 报告第 6 条：右匾文字三档都发黑不可读。根因是 make_yimen_textures.py
# draw_plaque 对下半幅（y0 != 0）的三处坐标 bug（字心忽略 y0 / 边框与铆钉下边重复加
# y0），右匾四个字被推出图集底缘裁掉，牌面只剩空黑漆。
# 本测试两道闸（都从左匾独立取期望，右匾向左匾看齐）：
#   1) 图集两半文字区（中心 80% 宽 × 带内 15%..85% 高）的亮度统计接近：
#      亮字像素占比（luma > 96）右/左 >= 0.85，且文字区均值差 <= 8/255；
#   2) yimen.glb 里两块匾面 quad 的 UV 都占满整幅宽、各占一半高（0..1 x [0,.5]/[.5,1]），
#      防止将来把 UV 段式改错。
# 用法：python3 -X utf8 tests/yimen-plaque-texture-test.py
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
TEX = ROOT.parent.parent / 'kit' / 'textures' / 'yimen-plaques.png'
GLB = ROOT / 'resources' / 'temple-v3' / 'yimen.glb'

failures = []


def ok(name, cond, extra=''):
    print(('ok   ' if cond else 'FAIL ') + name + ('' if cond else '  ' + extra))
    if not cond:
        failures.append(name)


def half_stats(img, y0, y1):
    band = img[y0:y1, :, :3].astype(np.float64)
    x0 = int(band.shape[1] * 0.10)
    x1 = int(band.shape[1] * 0.90)
    yy0 = int(band.shape[0] * 0.15)
    yy1 = int(band.shape[0] * 0.85)
    zone = band[yy0:yy1, x0:x1, :]
    luma = zone @ np.array([0.299, 0.587, 0.114])
    bright = float((luma > 96).mean())
    return {'brightFrac': bright, 'mean': float(luma.mean())}


def main():
    img = np.array(Image.open(TEX).convert('RGB'))
    H = img.shape[0]
    half = H // 2
    left = half_stats(img, 0, half)
    right = half_stats(img, half, H)
    ok(f'图集左匾文字区亮字占比 {left["brightFrac"]:.4f}（左匾为期望基准）',
       0.02 < left['brightFrac'] < 0.6)
    ratio = right['brightFrac'] / max(left['brightFrac'], 1e-9)
    ok(f'右匾亮字占比 {right["brightFrac"]:.4f} >= 0.85 x 左匾 {left["brightFrac"]:.4f} (ratio {ratio:.3f})',
       ratio >= 0.85)
    dm = abs(right['mean'] - left['mean'])
    ok(f'两匾文字区均值差 {dm:.2f} <= 8/255', dm <= 8.0)

    # --- GLB UV 段式：两块匾面 quad ---
    buf = GLB.read_bytes()
    jl = struct.unpack_from('<I', buf, 12)[0]
    g = json.loads(buf[20:20 + jl])
    bin_off = 28 + jl
    COMP = {5126: ('f', 4), 5123: ('H', 2), 5125: ('I', 4), 5121: ('B', 1), 5122: ('h', 2)}
    NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

    def acc(ai):
        a = g['accessors'][ai]
        bv = g['bufferViews'][a['bufferView']]
        comp, size = COMP[a['componentType']]
        nc = NC[a['type']]
        off = bin_off + (bv.get('byteOffset') or 0) + (a.get('byteOffset') or 0)
        stride = bv.get('byteStride') or size * nc
        out = []
        for i in range(a['count']):
            out.append(struct.unpack_from('<' + comp * nc, buf, off + i * stride))
        return out

    quads = []
    for mesh in g.get('meshes', []):
        for prim in mesh['primitives']:
            mats = g.get('materials', [])
            mname = mats[prim['material']].get('name', '') if prim.get('material') is not None else ''
            if 'plaque' not in mname or 'TEXCOORD_0' not in prim.get('attributes', {}):
                continue
            U = acc(prim['attributes']['TEXCOORD_0'])
            I = acc(prim['indices']) if 'indices' in prim else [[i] for i in range(len(U))]
            for k in range(0, len(I) - 2, 3):
                uv = [U[I[k + j][0]] for j in range(3)]
                us = [p[0] for p in uv]
                vs = [p[1] for p in uv]
                quads.append((min(us), max(us), min(vs), max(vs)))
    # 匾面 quad：u 横跨 0..1（容差 0.02），v 各占半幅
    faces = [q for q in quads if q[1] - q[0] > 0.95]
    top = [q for q in faces if q[2] >= 0.5 - 0.02 and q[3] <= 1.02]
    bot = [q for q in faces if q[2] <= 0.02 and q[3] <= 0.52]
    ok(f'匾面 UV：找到上半 {len(top)} / 下半 {len(bot)} 个满幅面（各应 >=2 个三角）',
       len(top) >= 2 and len(bot) >= 2, f'faces={faces[:6]}')
    vspan_ok = all(abs((q[3] - q[2]) - 0.5) < 0.03 for q in faces)
    ok('匾面 UV v 跨度都为半幅 (0.5±0.03)', vspan_ok, str([round(q[3] - q[2], 3) for q in faces]))

    print(f'\nyimen-plaque-texture: {len(failures)} failed')
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
