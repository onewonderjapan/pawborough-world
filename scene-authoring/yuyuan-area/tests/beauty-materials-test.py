#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave12-r1：Cycles beauty 与查看器外观对齐的四项机制检查（真 Blender Cycles，合成小场景）。

背景（工单包 artifacts/r1 实测定位）：scene-areas.glb 与查看器读的 zone-*.glb 出自同一 scene.blend，但
  a) 铺装 / 外围立面贴图由 export-zones.py 按对象 slot 在分区件导出时才绑定，scene-areas.glb 只有 slot + UV；
  b) 相邻路面件在同一高度共面叠放，Cycles 的阴影 / 漫反射射线在 t≈0 打中另一层 → 纯黑三角块；
  c) 顶点法线朝上、绕序朝下的面，命中背面时着色法线被翻进地面 → 纯黑；
  d) 镂空贴图：查看器是三线性 mipmap + 非预乘 alpha（透明像素的白底混进窗棂），Cycles 不做 mipmap。
渲染器（scripts/render-control-passes.py）在 --beauty cycles|eevee 下导入后调 prepare_beauty_materials 处理。

做法：本文件手写一个 glTF（不经 Blender 导出器），用 Blender 导入后调用渲染器自己的
prepare_beauty_materials / set_pixel_angle（渲染器缺这些函数时照常渲染，断言自然失败），
Cycles GPU 渲染，比较像素。期望值全部在本文件里独立得出，不拿产物和自己比：
  T1 铺装：slot=paving-grey-brick 的方块，渲染均值（线性）≈ 同场同光下一块不透明参照方块，参照色 =
     本文件用 PIL 直接读 resources/textures/paving/paving-grey-brick.jpg 算的线性平均（取景恰覆盖整数个 1 m 周期）；
     且块内有纹理起伏（标准差 > 阈值）。改前是顶点色 / 材质平涂米色 → 红。
  T2 共面叠放：两块 slot=paving-asphalt 方块在 y=0 重叠 2 m，重叠区与各自独占区（各 2×2 个周期）均值相对差 ≤ 6%。
     改前重叠区被自遮挡压黑 → 红。
  T3 绕序相反：一块灰色方块两个三角形，其一绕序朝下、顶点法线仍朝上（下方 0.4 m 有地面），两三角形均值相对差 ≤ 6%。
  T5 不重叠铺装完整参与光照（wave12-r2）：只有太阳；抬高 1.2 m 的 slot 铺装板仍在地面铺装上投影（T5a），
     铺装上方盒子的影子仍在（T5b），铺装板下表面只靠地面铺装的漫反射照亮、亮度 > 受光铺装的 5%（T5c）。
     R1（全水平 slot 件关阴影 / 漫反射可见性）上 T5a、T5c 红。
  T6 采样器枚举（wave12-r2；E2 重设计）：行条纹贴图（α∈{1, 64/255} 的 4px 周期行，u 向均匀），
     λ=1.51 → 9985（层间取最近）取第 2 层：均匀 α=0.625、色 = L2 期望，整块不透明 ≈ 参照块；
     9987（层间插值）= 0.49·L1 + 0.51·L2，0.25-α 行的双线性下坡被拉过 0.5 阈值 → ≈16% 面积
     丢弃露黑，窗口均值大幅偏离参照。E2 负对照：「只撤销枚举修复」（9985 摘出 nearest 元组）
     重渲 t6 —— T6a 的块必须偏离参照超 TOL（新断言在旧枚举下判红），且偏离值落在 between
     路径的独立逐像素模拟上（红因单因归到枚举）。旧 T6 用的 4×4 格心贴图在 λ=1.58 下两路径
     窗口均值只差 0.25~0.5%（wave12 R2 审查实测），T6a 无辨别力 → 换纹理 + 负对照。
  T4 镂空 mip：MASK 方块，64² 贴图按 4×4 周期排布（每周期 2×2 透明白、其余不透明红），相机距离使查看器
     λ = log2(像素足迹 / 纹素) ≈ 3（≥2 各层内容相同）→ 查看器里整块不透明、颜色 = 0.75·红 + 0.25·白（线性）；
     与同场一块该色的不透明参照方块比，各通道相对差 ≤ 6%。改前 Cycles 不做 mip：透明处露出黑背景 → 红。

用法：python3 -X utf8 tests/beauty-materials-test.py [--renderer <render-control-passes.py>] [--keep <目录>]
退出码：0 全过；1 有失败。需要 ~/.local/bin/blender（或环境变量 BLENDER）。
"""
import argparse
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib

AREA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RENDERER = os.path.join(AREA, 'scripts', 'render-control-passes.py')
PAVING = os.path.join(AREA, 'resources', 'textures', 'paving')
BLENDER = os.environ.get('BLENDER', os.path.expanduser('~/.local/bin/blender'))
TOL = 0.06

# ---------------- 场景参数（Blender 侧驱动与 Python 侧断言共用） ----------------
T4_TEX = 64
T4_RED = (0.55, 0.12, 0.08)                     # 线性
T4_W, T4_H, T4_LENS = 96, 96, 50.0              # 36 mm 传感器
T4_PIX = 36.0 / (T4_LENS * max(T4_W, T4_H))     # 每像素视角
T4_DIST = 8.0 / (T4_PIX * T4_TEX)               # 足迹 8 纹素 → λ = 3（UV 1 单位 = 1 m）
T6_LAMBDA = 1.51                                # 层间最近取第 2 层（ceil(λ+.5)-1）；层间权重 (0.49, 0.51)
T6_DIST = 2 ** T6_LAMBDA / (T4_PIX * T4_TEX)
T6_W = 288                                      # t6 渲染分辨率：3× 细分提窗口采样精度（λ 仍按 96 宽定义）
T6_WIN = 24                                     # 断言窗口 24×24 px（块中心）
T6_SUP = 3                                      # 模拟每输出像素 3×3 超采样（近似 Cycles 像素滤波）
T5_SUN_DEG = 35.0                               # T5 太阳绕 Blender x 轴倾角：影子向 +y 偏 h·tan35°


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin_to_srgb(c):
    c = max(0.0, min(1.0, c))
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


# ---------------- 手写 glTF ----------------
def png_rgba(w, h, pix):
    raw = b''.join(b'\x00' + bytes(pix[y * w * 4:(y + 1) * w * 4]) for y in range(h))

    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


class Gltf:
    def __init__(self):
        self.j = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [], 'meshes': [],
                  'materials': [], 'accessors': [], 'bufferViews': [], 'buffers': [{'byteLength': 0}]}
        self.bin = bytearray()

    def view(self, data, target=None):
        while len(self.bin) % 4:
            self.bin += b'\x00'
        bv = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)}
        if target:
            bv['target'] = target
        self.bin += data
        self.j['bufferViews'].append(bv)
        return len(self.j['bufferViews']) - 1

    def acc(self, vals, typ, ncomp):
        if typ == 'idx':
            data = struct.pack('<%dI' % len(vals), *vals)
            a = {'bufferView': self.view(data, 34963), 'componentType': 5125, 'count': len(vals), 'type': 'SCALAR'}
        else:
            flat = [x for v in vals for x in v]
            data = struct.pack('<%df' % len(flat), *flat)
            a = {'bufferView': self.view(data, 34962), 'componentType': 5126, 'count': len(vals),
                 'type': {2: 'VEC2', 3: 'VEC3'}[ncomp]}
            if typ == 'pos':
                a['min'] = [min(v[i] for v in vals) for i in range(3)]
                a['max'] = [max(v[i] for v in vals) for i in range(3)]
        self.j['accessors'].append(a)
        return len(self.j['accessors']) - 1

    def material(self, m):
        self.j['materials'].append(m)
        return len(self.j['materials']) - 1

    def mesh(self, name, pos, nrm, uv, tris, mat, extras=None):
        prim = {'attributes': {'POSITION': self.acc(pos, 'pos', 3), 'NORMAL': self.acc(nrm, 'n', 3),
                               'TEXCOORD_0': self.acc(uv, 'uv', 2)},
                'indices': self.acc([i for t in tris for i in t], 'idx', 1), 'material': mat}
        self.j['meshes'].append({'name': name, 'primitives': [prim]})
        node = {'name': name, 'mesh': len(self.j['meshes']) - 1}
        if extras:
            node['extras'] = extras
        self.j['nodes'].append(node)
        self.j['scenes'][0]['nodes'].append(len(self.j['nodes']) - 1)

    def image(self, png, min_filter=9987, mag_filter=9729):
        """加一张图 + 一个 sampler + 一个 texture，返回 texture 下标（同一张 png 可多次加，各自 sampler）。"""
        imgs = self.j.setdefault('images', [])
        imgs.append({'name': 't-lattice-%d' % len(imgs), 'mimeType': 'image/png', 'bufferView': self.view(png)})
        smp = self.j.setdefault('samplers', [])
        smp.append({'magFilter': mag_filter, 'minFilter': min_filter})
        tex = self.j.setdefault('textures', [])
        tex.append({'sampler': len(smp) - 1, 'source': len(imgs) - 1})
        return len(tex) - 1

    def write(self, path):
        while len(self.bin) % 4:
            self.bin += b'\x00'
        self.j['buffers'][0]['byteLength'] = len(self.bin)
        js = json.dumps(self.j).encode()
        js += b' ' * ((4 - len(js) % 4) % 4)
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, total))
            f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
            f.write(struct.pack('<II', len(self.bin), 0x004E4942) + bytes(self.bin))


def horiz_quad(x0, x1, z0, z1, y=0.0):
    """y 平面方块，绕序从 +y 看逆时针（法线 +y），UV = 世界米。"""
    pos = [(x0, y, z0), (x0, y, z1), (x1, y, z1), (x1, y, z0)]
    return pos, [(0, 1, 0)] * 4, [(p[0], p[2]) for p in pos], [(0, 1, 2), (0, 2, 3)]


def vert_quad(x0, x1, y0, y1, z):
    """z 平面方块，法线 +z（朝相机），UV = (x, -y) 米。"""
    pos = [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)]
    return pos, [(0, 0, 1)] * 4, [(p[0], -p[1]) for p in pos], [(0, 1, 2), (0, 2, 3)]


def opaque(color_lin, name, double=False):
    return {'name': name, 'doubleSided': double,
            'pbrMetallicRoughness': {'baseColorFactor': list(color_lin) + [1.0], 'metallicFactor': 0.0, 'roughnessFactor': 1.0}}


def paving_mean_lin(slot):
    from PIL import Image
    import numpy as np
    a = np.asarray(Image.open(os.path.join(PAVING, slot + '.jpg')).convert('RGB'), dtype=np.float64) / 255.0
    lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    return tuple(float(x) for x in lin.reshape(-1, 3).mean(0))


def t4_texture():
    pix = []
    for y in range(T4_TEX):
        for x in range(T4_TEX):
            clear = (x % 4) >= 2 and (y % 4) >= 2          # 每 4×4 周期里 2×2 透明
            if clear:
                pix += [255, 255, 255, 0]
            else:
                pix += [int(round(255 * lin_to_srgb(c))) for c in T4_RED] + [255]
    return png_rgba(T4_TEX, T4_TEX, pix)


def t4_expected_lin():
    # 查看器：透明像素 RGB 为白，非预乘平均（线性空间）；λ≥2 各层每纹素 = 12/16 红 + 4/16 白，alpha 0.75 ≥ 0.5
    red_q = [srgb_to_lin(round(255 * lin_to_srgb(c)) / 255.0) for c in T4_RED]
    return tuple(0.75 * r + 0.25 * 1.0 for r in red_q)


def t6_texel_row(j):
    """T6 贴图第 j 行的（线性 RGB, alpha）：j%4∈{0,1} 红 α=1；j%4∈{2,3} 白 α=64/255（非预乘）。
    渲染 PNG 与 numpy 模拟共用本定义——期望值独立于渲染取得。"""
    red = j % 4 in (0, 1)
    rgb = [srgb_to_lin(round(255 * lin_to_srgb(c)) / 255.0) for c in T4_RED] if red else [1.0, 1.0, 1.0]
    return rgb, 1.0 if red else 64.0 / 255.0


def t6_texture():
    pix = []
    for j in range(T4_TEX):
        rgb, a = t6_texel_row(j)
        row = [int(round(255 * lin_to_srgb(c))) for c in rgb] + [int(round(a * 255))]
        pix += row * T4_TEX
    return png_rgba(T4_TEX, T4_TEX, pix)


def t6_levels_lin():
    """T6 贴图的查看器同式 mip 链：线性空间非预乘逐层 2×2 盒式平均（与渲染器 _mip_chain 同式）。"""
    import numpy as np
    L0 = np.zeros((T4_TEX, T4_TEX, 4))
    for j in range(T4_TEX):
        rgb, a = t6_texel_row(j)
        L0[j, :, :3] = rgb
        L0[j, :, 3] = a
    levels = [L0]
    while levels[-1].shape[0] > 1:
        p = levels[-1]
        h = p.shape[0] // 2
        levels.append(p.reshape(h, 2, h, 2, 4).mean(axis=(1, 3)))
    return levels


def t6_window_exp(nearest, lam=T6_LAMBDA):
    """T6 窗口的独立逐像素模拟：T6_WIN×T6_WIN px 窗口（块中心），每输出像素 T6_SUP×T6_SUP 超采样
    （近似 Cycles 像素滤波）；双线性（纹素中心 (i+0.5)/N，REPEAT）；层间权重 max(1-|λ-k|,0)；
    alpha < 0.5 丢弃（露黑背景）。nearest=True 取 ceil(λ+.5)-1 单层（9985 语义）；False 取层间
    插值（9987 语义）。窗口 v 相位取块中心（条纹翻转不变），u 向贴图均匀。
    返回 (窗口平均线性 RGB, 丢弃占比)。"""
    import numpy as np
    levels = t6_levels_lin()
    dist = 2 ** lam / (T4_PIX * T4_TEX)
    ppm = T6_W / (36.0 / T4_LENS * dist)
    offs = (np.arange(T6_WIN * T6_SUP) + 0.5) / T6_SUP - T6_WIN / 2
    U, V = np.meshgrid(offs / ppm, offs / ppm, indexing='xy')
    u = (-1.3 + U.ravel())
    v = (-1.0 + V.ravel())

    def bil(Lk):
        N = Lk.shape[0]
        x, y = u * N - 0.5, v * N - 0.5
        x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
        fx, fy = (x - x0)[:, None], (y - y0)[:, None]
        g = lambda i, j: Lk[j % N, i % N]
        return (g(x0, y0) * (1 - fx) * (1 - fy) + g(x0 + 1, y0) * fx * (1 - fy)
                + g(x0, y0 + 1) * (1 - fx) * fy + g(x0 + 1, y0 + 1) * fx * fy)

    if nearest:
        k = max(math.ceil(lam + 0.5) - 1, 0)
        s = bil(levels[k])
    else:
        k = math.floor(lam)
        f = lam - k
        s = bil(levels[k]) * (1 - f) + bil(levels[k + 1]) * f
    keep = (s[:, 3] >= 0.5).reshape(T6_WIN * T6_SUP, T6_WIN * T6_SUP)
    col = np.where(keep[..., None], s[:, :3].reshape(T6_WIN * T6_SUP, T6_WIN * T6_SUP, 3), 0.0)
    px = col.reshape(T6_WIN, T6_SUP, T6_WIN, T6_SUP, 3).mean(axis=(1, 3))
    return tuple(float(x) for x in px.reshape(-1, 3).mean(0)), float(1 - keep.mean())


def box(x0, x1, y0, y1, z0, z1):
    """轴对齐盒子（24 顶点，法线朝外，逆时针从外看）。"""
    pos, nrm, uv, tris = [], [], [], []
    faces = [((1, 0, 0), [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)]),
             ((-1, 0, 0), [(x0, y0, z1), (x0, y1, z1), (x0, y1, z0), (x0, y0, z0)]),
             ((0, 1, 0), [(x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0)]),
             ((0, -1, 0), [(x0, y0, z1), (x0, y0, z0), (x1, y0, z0), (x1, y0, z1)]),
             ((0, 0, 1), [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]),
             ((0, 0, -1), [(x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)])]
    for n, q in faces:
        b = len(pos)
        pos += q
        nrm += [n] * 4
        uv += [(0, 0), (1, 0), (1, 1), (0, 1)]
        tris += [(b, b + 1, b + 2), (b, b + 2, b + 3)]
    return pos, nrm, uv, tris


def build_scenes(tmp):
    grey = (0.35, 0.35, 0.35)
    beige = (srgb_to_lin(0.749), srgb_to_lin(0.682), srgb_to_lin(0.557))
    out = {}
    # T1：slot 铺装块 x∈[-4,0]，参照块 x∈[0,4]
    g = Gltf()
    m_flat = g.material(opaque(beige, 'Material_1'))
    m_ref = g.material(opaque(paving_mean_lin('paving-grey-brick'), 'ref-grey-brick'))
    g.mesh('t1|paving|L1', *horiz_quad(-4, 0, -3, 3), m_flat, {'slot': 'paving-grey-brick'})
    g.mesh('t1|ref', *horiz_quad(0, 4, -3, 3), m_ref)
    g.write(os.path.join(tmp, 't1.glb'))
    out['t1'] = 't1.glb'
    # T2：两块 asphalt slot 块在 x∈[-1,1] 重叠
    g = Gltf()
    m = g.material(opaque(beige, 'Material_1.003'))
    g.mesh('t2|road-a|road|L0', *horiz_quad(-3, 1, -3, 3), m, {'slot': 'paving-asphalt'})
    g.mesh('t2|road-b|road|L0', *horiz_quad(-1, 3, -3, 3), m, {'slot': 'paving-asphalt'})
    g.write(os.path.join(tmp, 't2.glb'))
    out['t2'] = 't2.glb'
    # T3：灰块沿对角线两三角形，第二个绕序朝下（法线仍朝上）；下方 0.4 m 地面
    g = Gltf()
    m = g.material(opaque(grey, 'grey-single'))
    pos = [(-2, 0, -2), (-2, 0, 2), (2, 0, 2), (2, 0, -2)]
    g.mesh('t3|slab', pos, [(0, 1, 0)] * 4, [(p[0], p[2]) for p in pos], [(0, 1, 2), (0, 3, 2)], m)
    mg = g.material(opaque((0.3, 0.28, 0.25), 'ground'))
    g.mesh('t3|ground', *horiz_quad(-20, 20, -20, 20, y=-0.4), mg)
    g.write(os.path.join(tmp, 't3.glb'))
    out['t3'] = 't3.glb'
    # T4：MASK 格心块 x∈[-2.5,-0.5] 与参照块 x∈[0.5,2.5]，z=0 朝 +z
    g = Gltf()
    ti = g.image(t4_texture())
    m_l = g.material({'name': 't4-lattice', 'alphaMode': 'MASK', 'doubleSided': True,
                      'pbrMetallicRoughness': {'baseColorTexture': {'index': ti}, 'metallicFactor': 0.0, 'roughnessFactor': 1.0}})
    m_r = g.material(opaque(t4_expected_lin(), 't4-ref', True))
    g.mesh('t4|lattice', *vert_quad(-2.5, -0.5, 0, 2, 0.0), m_l)
    g.mesh('t4|ref', *vert_quad(0.5, 2.5, 0, 2, 0.0), m_r)
    g.write(os.path.join(tmp, 't4.glb'))
    out['t4'] = 't4.glb'
    # T5：不重叠的铺装仍完整参与光照（wave12-r2）。地面铺装 + 抬高 1.2 m 的水平 slot 铺装板（不与任何层共面）
    #     + 一个非铺装盒子；只有太阳（世界全黑），俯视看影子，另从铺装板下方仰视看它的下表面（只能靠地面反弹照亮）。
    g = Gltf()
    m = g.material(opaque(beige, 'Material_1'))
    g.mesh('t5|ground-paving|paving|L1', *horiz_quad(-4, 4, -3, 3), m, {'slot': 'paving-grey-brick'})
    g.mesh('t5|canopy-paving|paving|L1', *horiz_quad(1, 3, -1, 1, y=1.2), m, {'slot': 'paving-grey-brick'})
    g.mesh('t5|box', *box(-3, -1, 1.0, 1.4, -1, 1), g.material(opaque(grey, 'box-grey')))
    g.write(os.path.join(tmp, 't5.glb'))
    out['t5'] = 't5.glb'
    # T6：采样器枚举（E2 重设计：行条纹贴图）。左块 LINEAR_MIPMAP_NEAREST(9985)，中块 LINEAR_MIPMAP_LINEAR(9987)，
    #     右块参照色 = nearest 路径的独立模拟期望（均匀第 2 层）
    g = Gltf()
    png = t6_texture()
    m_near = g.material({'name': 't6-9985', 'alphaMode': 'MASK', 'doubleSided': True,
                         'pbrMetallicRoughness': {'baseColorTexture': {'index': g.image(png, 9985)}, 'metallicFactor': 0.0, 'roughnessFactor': 1.0}})
    m_lin = g.material({'name': 't6-9987', 'alphaMode': 'MASK', 'doubleSided': True,
                        'pbrMetallicRoughness': {'baseColorTexture': {'index': g.image(png, 9987)}, 'metallicFactor': 0.0, 'roughnessFactor': 1.0}})
    g.mesh('t6|near', *vert_quad(-1.8, -0.8, 0.5, 1.5, 0.0), m_near)
    g.mesh('t6|lin', *vert_quad(-0.5, 0.5, 0.5, 1.5, 0.0), m_lin)
    g.mesh('t6|ref', *vert_quad(0.8, 1.8, 0.5, 1.5, 0.0), g.material(opaque(t6_window_exp(True)[0], 't6-ref', True)))
    g.write(os.path.join(tmp, 't6.glb'))
    out['t6'] = 't6.glb'
    # E2 门禁单元用例（不渲染，驱动里只调 prepare_beauty_materials 看是否失败）：
    # t7：A(z=0) 与 B(z=+1.5mm) 共面冲突 → B 下沉 4mm 落到 C(z=-2.5mm) 上 → 复查出残余共面冲突 → 必须失败；
    # t8：10 块 0.2mm 间距全两两共面冲突的层 → 贪心分层最深下沉 9×4=36mm > 32mm 预算 → 必须失败。
    g = Gltf()
    m = g.material(opaque((0.4, 0.4, 0.4), 'grey'))
    g.mesh('t7|slab-a', *horiz_quad(-3, 3, -3, 3, y=0.0), m)          # 面积最大 → 占 0 层
    g.mesh('t7|slab-b', *horiz_quad(-1, 1, -1, 1, y=0.0015), m)       # 与 A 冲突 → 下沉 4mm
    g.mesh('t7|slab-c', *horiz_quad(-1, 1, -1, 1, y=-0.0025), m)      # 原本无冲突；B 下沉后同高 → 残余
    g.write(os.path.join(tmp, 't7.glb'))
    out['t7'] = 't7.glb'
    g = Gltf()
    m8 = g.material(opaque((0.4, 0.4, 0.4), 'grey'))
    g.mesh('t8|s0', *horiz_quad(-1, 1, -1, 1, y=0.0), m8)
    for kk in range(1, 10):
        g.mesh('t8|s%d' % kk, *horiz_quad(-1, 1, -1, 1, y=0.0002 * kk), m8)   # 两两 |Δz| ≤ 1.8mm ≤ tol
    g.write(os.path.join(tmp, 't8.glb'))
    out['t8'] = 't8.glb'
    return out


# ---------------- Blender 侧驱动（本文件在 Blender 里以 --driver 运行） ----------------
def driver(argv):
    import bpy
    import types
    from mathutils import Vector
    renderer, tmp = argv[0], argv[1]
    src = open(renderer, encoding='utf-8').read().rstrip()
    if not src.endswith('\nmain()'):
        raise SystemExit('E: 渲染器末尾不是裸 main()')
    if os.environ.get('BEAUTY_MAT_T6_NEG') == '1':
        # E2 负对照：只撤销枚举修复——9985 摘出 nearest 元组（与 9987 一样走层间插值），其余机制不动
        anchor = 'GL_MIP_NEAREST_BETWEEN = (9984, 9985)'
        if anchor not in src:
            raise SystemExit('E: 负对照锚点缺失（渲染器枚举定义已变？拒绝盲跑）')
        src = src.replace(anchor, 'GL_MIP_NEAREST_BETWEEN = (9984,)')
    rcp = types.ModuleType('rcp_under_test')
    rcp.__file__ = renderer
    exec(compile(src[:src.rindex('\nmain()')], renderer, 'exec'), rcp.__dict__)
    import numpy as np
    report = {}
    # 每个用例：(镜头名, 相机设置)；T5 两个镜头（俯视 / 铺装板下仰视）；t7/t8 只调 prepare 看门禁
    cases_all = ('t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8')
    want_cases = [c for c in os.environ.get('BEAUTY_MAT_CASES', ','.join(cases_all)).split(',') if c in cases_all]
    shots = {'t1': ['t1'], 't2': ['t2'], 't3': ['t3'], 't4': ['t4'], 't5': ['t5', 't5up'], 't6': ['t6']}
    for case in want_cases:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        sc = bpy.context.scene
        glb = os.path.join(tmp, case + '.glb')
        bpy.ops.import_scene.gltf(filepath=glb)
        if case in ('t7', 't8'):
            # E2 门禁用例：预期 prepare_beauty_materials 直接失败（SystemExit），记录失败原因
            try:
                rcp.prepare_beauty_materials(glb)
                report[case] = {'gate': 'no-gate-fired（本应失败却通过了）'}
            except SystemExit as e:
                report[case] = {'gate': str(e)}
            continue
        info = rcp.prepare_beauty_materials(glb) if hasattr(rcp, 'prepare_beauty_materials') else None
        # 世界：相机射线黑，其余射线白 1.0（均匀环境光）；T5 只要太阳（世界全黑），才能单看反弹与投影
        w = bpy.data.worlds.new('w')
        w.use_nodes = True
        nt = w.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        lp, ms = nt.nodes.new('ShaderNodeLightPath'), nt.nodes.new('ShaderNodeMixShader')
        b1, b0 = nt.nodes.new('ShaderNodeBackground'), nt.nodes.new('ShaderNodeBackground')
        b1.inputs['Color'].default_value = (0, 0, 0, 1) if case == 't5' else (1, 1, 1, 1)
        b0.inputs['Color'].default_value = (0, 0, 0, 1)
        o = nt.nodes.new('ShaderNodeOutputWorld')
        nt.links.new(lp.outputs['Is Camera Ray'], ms.inputs['Fac'])
        nt.links.new(b1.outputs[0], ms.inputs[1])
        nt.links.new(b0.outputs[0], ms.inputs[2])
        nt.links.new(ms.outputs[0], o.inputs['Surface'])
        sc.world = w
        if case in ('t2', 't3', 't5'):
            sun = bpy.data.lights.new('sun', 'SUN')
            sun.energy = 3.0
            sun.angle = math.radians(1.0)
            so = bpy.data.objects.new('sun', sun)
            so.rotation_euler = (math.radians(T5_SUN_DEG), 0, 0) if case == 't5' else (math.radians(30), math.radians(10), 0)
            sc.collection.objects.link(so)
        cd = bpy.data.cameras.new('cam')
        co = bpy.data.objects.new('cam', cd)
        sc.collection.objects.link(co)
        sc.camera = co
        sc.render.engine = 'CYCLES'
        prefs = bpy.context.preferences.addons['cycles'].preferences
        dev = None
        for t in ('OPTIX', 'CUDA', 'HIP'):
            try:
                prefs.compute_device_type = t
            except TypeError:
                continue
            prefs.get_devices()
            if any(d.type == t for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == t
                dev = t
                break
        sc.cycles.device = 'GPU' if dev else 'CPU'
        sc.cycles.samples = 256
        sc.cycles.use_adaptive_sampling = False
        sc.cycles.use_denoising = False
        sc.cycles.max_bounces = 4
        sc.cycles.transparent_max_bounces = 8
        sc.view_settings.view_transform = 'Standard'
        sc.view_settings.look = 'None'
        sc.view_settings.exposure = 0
        sc.render.image_settings.file_format = 'OPEN_EXR'
        sc.render.image_settings.color_depth = '32'
        for shot in shots[case]:
            cd.type = 'PERSP'
            cd.clip_end = 100
            if shot in ('t4', 't6'):
                cd.sensor_width = 36.0
                cd.lens = T4_LENS
                # t6 用 3× 分辨率渲染（提窗口采样精度）；像素角仍按 96 宽定义 → 模拟 λ = T6_LAMBDA 不变
                sc.render.resolution_x, sc.render.resolution_y = ((T4_W, T4_H) if shot == 't4' else (T6_W, T6_W))
                dist = T4_DIST if shot == 't4' else T6_DIST
                cz = 1.0
                co.location = Vector((0.0, -dist, cz))          # Blender：glTF (x,y,z) → (x,-z,y)；方块中心 glTF y=1 → z=1
                co.rotation_euler = (math.radians(90), 0, 0)
                if hasattr(rcp, 'set_pixel_angle'):
                    rcp.set_pixel_angle(sc, cd, T4_W, T4_H)
            elif shot == 't5up':
                cd.type = 'ORTHO'
                cd.ortho_scale = 1.5
                sc.render.resolution_x, sc.render.resolution_y = 64, 64
                co.location = (2.0, 0.0, 0.6)                   # 铺装板正下方、地面上 0.6 m，仰视
                co.rotation_euler = (math.radians(180), 0, 0)
            else:
                cd.type = 'ORTHO'
                cd.ortho_scale = {'t3': 4.0, 't5': 8.0}.get(shot, 6.0)
                sc.render.resolution_x, sc.render.resolution_y = {'t3': (128, 128), 't5': (256, 192)}.get(shot, (192, 96))
                co.location = (0, 0, 10)
                co.rotation_euler = (0, 0, 0)
            sc.render.filepath = os.path.join(tmp, shot + '.exr')
            bpy.ops.render.render(write_still=True)
            img = bpy.data.images.load(sc.render.filepath)
            px = np.empty(img.size[0] * img.size[1] * 4, np.float32)
            img.pixels.foreach_get(px)
            np.save(os.path.join(tmp, shot + '.npy'), px.reshape(img.size[1], img.size[0], 4)[::-1, :, :3])
            bpy.data.images.remove(img)
        report[case] = {'info': {k: (v if not isinstance(v, (list, dict)) else len(v)) for k, v in (info or {}).items()},
                        'device': sc.cycles.device}
    with open(os.path.join(tmp, 'driver.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False)


# ---------------- 断言 ----------------
fails = passes = 0


def ok(cond, msg, data=None):
    global fails, passes
    if cond:
        passes += 1
    else:
        fails += 1
    print('%s %s%s' % ('PASS' if cond else 'FAIL', msg, (' ' + json.dumps(data, ensure_ascii=False)) if data is not None else ''))


def rel(a, b):
    return abs(a - b) / max(abs(b), 1e-6)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--renderer', default=RENDERER)
    ap.add_argument('--keep', default='')
    a = ap.parse_args()
    import numpy as np
    tmp = a.keep or tempfile.mkdtemp(prefix='beauty-mat-')
    os.makedirs(tmp, exist_ok=True)
    build_scenes(tmp)
    r = subprocess.run([BLENDER, '-b', '-t', '4', '--python', os.path.abspath(__file__), '--', '--driver',
                        os.path.abspath(a.renderer), tmp], capture_output=True, text=True, timeout=1800)
    ok(r.returncode == 0 and os.path.exists(os.path.join(tmp, 'driver.json')), 'Blender 驱动跑完 (exit %d)' % r.returncode,
       r.stderr[-2000:] if r.returncode else None)
    if r.returncode != 0:
        print(r.stdout[-3000:])
        print('beauty-materials-test: %d passed, %d failed' % (passes, fails))
        return 1
    rep = json.load(open(os.path.join(tmp, 'driver.json'), encoding='utf-8'))
    print('driver:', json.dumps(rep, ensure_ascii=False))

    def region(case, x0, x1, y0, y1):
        img = np.load(os.path.join(tmp, case + '.npy'))
        return img[y0:y1, x0:x1].reshape(-1, 3)

    # T1：192×96 正交 6 m 宽 → 32 px/m；左半中央 3×3 m（x∈[-3,0]，z∈[-1.5,1.5]）恰 3×3 个周期
    pav = region('t1', 0, 96, 0, 96)
    ref = region('t1', 112, 176, 16, 80)
    pm, rm = pav.mean(0), ref.mean(0)
    ok(all(rel(pm[i], rm[i]) <= TOL for i in range(3)),
       'T1 slot 铺装块均值≈贴图平均色参照块（≤%d%%）' % (TOL * 100), {'paving': pm.round(4).tolist(), 'ref': rm.round(4).tolist()})
    lum = pav @ np.array([0.2126, 0.7152, 0.0722])
    ok(lum.std() / max(lum.mean(), 1e-6) > 0.04, 'T1 slot 铺装块有纹理起伏（亮度变异系数 > 4%）',
       {'cv': round(float(lum.std() / max(lum.mean(), 1e-6)), 4)})
    # T2：x∈[-3,-1]、[-1,1]、[1,3] 各 2 m = 64 px；z 取中间 2 m
    a_only = region('t2', 0, 64, 16, 80).mean(0)
    both = region('t2', 64, 128, 16, 80).mean(0)
    b_only = region('t2', 128, 192, 16, 80).mean(0)
    side = (a_only + b_only) / 2
    ok(all(rel(both[i], side[i]) <= TOL for i in range(3)) and both.max() > 0.02,
       'T2 共面叠放区与独占区同亮（≤%d%%）' % (TOL * 100),
       {'overlap': both.round(4).tolist(), 'aOnly': a_only.round(4).tolist(), 'bOnly': b_only.round(4).tolist()})
    # T3：128×128 正交 4 m → 32 px/m；两三角形各取远离对角线的 24×24 窗
    img3 = np.load(os.path.join(tmp, 't3.npy'))
    ys, xs = np.mgrid[0:128, 0:128]
    bx, by = (xs + 0.5) / 32 - 2, 2 - (ys + 0.5) / 32          # 图像 → Blender x / y（正交俯视，图像上方 = +y）
    # 对角线 glTF (x=-2,z=-2)→(2,2) 即 Blender (-2,2)→(2,-2)：x + y = 0 两侧各一个三角形
    t_a = (bx + by) > 0.6
    t_b = (bx + by) < -0.6
    va, vb = img3[t_a].mean(0), img3[t_b].mean(0)
    ok(all(rel(va[i], vb[i]) <= TOL for i in range(3)) and min(va.max(), vb.max()) > 0.02,
       'T3 绕序相反的三角形与相邻三角形同亮（≤%d%%）' % (TOL * 100), {'triA': va.round(4).tolist(), 'triB': vb.round(4).tolist()})
    # T4：96×96，焦距 50 → 画面宽 36/50·距离；两块中心在 x=∓1.5 m
    span = 36.0 / T4_LENS * T4_DIST
    ppm = T4_W / span

    def at(xm):
        cx = int(round(T4_W / 2 + xm * ppm))
        cy = T4_H // 2
        return np.load(os.path.join(tmp, 't4.npy'))[cy - 3:cy + 3, cx - 3:cx + 3].reshape(-1, 3).mean(0)
    lat, rf = at(-1.5), at(1.5)
    ok(all(rel(lat[i], rf[i]) <= TOL for i in range(3)),
       'T4 镂空贴图按查看器 mip 口径：格心块≈（0.75 红 + 0.25 白）参照块（≤%d%%）' % (TOL * 100),
       {'lattice': lat.round(4).tolist(), 'ref': rf.round(4).tolist(), 'expectedAlbedoLin': [round(x, 4) for x in t4_expected_lin()],
        'distM': round(T4_DIST, 3)})
    # T5（wave12-r2）：256×192 正交 8 m → 32 px/m，图像行 0 = Blender y=+3。太阳绕 x 轴 35°，影子向 +y 偏 h·tan35°。
    def box_px(x0, x1, y0, y1):
        return region('t5', int((x0 + 4) * 32), int((x1 + 4) * 32), int((3 - y1) * 32), int((3 - y0) * 32)).mean(0)
    lum = np.array([0.2126, 0.7152, 0.0722])
    lit = box_px(-0.7, 0.7, 1.15, 1.6) @ lum
    canopy_sh = box_px(1.3, 2.7, 1.15, 1.6) @ lum               # 铺装板（1.2 m）影子露出板外的部分
    box_sh = box_px(-2.7, -1.3, 1.15, 1.6) @ lum                # 盒子影子露出盒外的部分
    ok(lit > 0.05 and canopy_sh / lit < 0.5, 'T5a 不重叠的 slot 铺装板仍向地面投影（影区/受光 < 0.5）',
       {'lit': round(float(lit), 4), 'shadow': round(float(canopy_sh), 4), 'ratio': round(float(canopy_sh / max(lit, 1e-6)), 3)})
    ok(lit > 0.05 and box_sh / lit < 0.5, 'T5b 铺装上方物体在铺装上的影子仍在（影区/受光 < 0.5）',
       {'lit': round(float(lit), 4), 'shadow': round(float(box_sh), 4), 'ratio': round(float(box_sh / max(lit, 1e-6)), 3)})
    under = region('t5up', 8, 56, 8, 56).mean(0) @ lum
    ok(under / max(lit, 1e-6) > 0.05, 'T5c 铺装仍作为漫反射面：铺装板下表面只靠地面铺装反弹照亮（下表面/受光铺装 > 0.05）',
       {'underside': round(float(under), 5), 'litPaving': round(float(lit), 4), 'ratio': round(float(under / max(lit, 1e-6)), 4)})
    # T6（wave12-r2；E2 重设计）：采样器枚举。行条纹贴图 + λ=1.51：9985 层间取最近 → 第 2 层（均匀 α=.625）
    # 整块 ≈ 参照块；9987 层间插值 → 0.25-α 行下坡被拉过 0.5 阈值，≈16% 面积丢弃露黑，窗口均值大幅偏离。
    span6 = 36.0 / T4_LENS * T6_DIST
    ppm6 = T6_W / span6

    def at6(xm, base=tmp):
        cx = int(round(T6_W / 2 + xm * ppm6))
        cy = T6_W // 2
        w = T6_WIN // 2
        return np.load(os.path.join(base, 't6.npy'))[cy - w:cy + w, cx - w:cx + w].reshape(-1, 3).mean(0)
    near6, lin6, ref6 = at6(-1.3), at6(0.0), at6(1.3)
    exp_n, holes_n = t6_window_exp(True)
    exp_b, holes_b = t6_window_exp(False)
    ok(holes_n == 0.0 and holes_b > TOL,
       'T6c 独立模拟前置（期望独立取得）：nearest 无丢弃、between 丢弃 %.1f%% > TOL（两行为可分）' % (holes_b * 100),
       {'holesNearest': holes_n, 'holesBetween': round(holes_b, 4),
        'expNearest': [round(x, 4) for x in exp_n], 'expBetween': [round(x, 4) for x in exp_b]})
    ok(all(rel(near6[i], ref6[i]) <= TOL for i in range(3)),
       'T6a LINEAR_MIPMAP_NEAREST(9985) 按层间最近取第 2 层：整块不透明 ≈ 参照色（≤%d%%）' % (TOL * 100),
       {'9985': near6.round(4).tolist(), 'ref': ref6.round(4).tolist(), 'lambda': T6_LAMBDA})
    # 参照块反照率 = nearest 期望，用它把「期望反照率」换成同光照下的期望像素值
    exp_px = [ref6[i] * exp_b[i] / exp_n[i] for i in range(3)]
    ok(all(rel(lin6[i], exp_px[i]) <= TOL for i in range(3)),
       'T6b LINEAR_MIPMAP_LINEAR(9987) 层间插值：≈ 独立逐像素模拟（λ=%.2f，丢弃 %.1f%%，≤%d%%）' % (T6_LAMBDA, holes_b * 100, TOL * 100),
       {'9987': lin6.round(4).tolist(), 'expected': [round(float(x), 4) for x in exp_px], 'holeShare': round(holes_b, 4)})

    # E2（blenderamb R2 可选3）负对照：只撤销枚举修复（9985 摘出 nearest 元组）重渲 t6——
    # T6a 的块必须偏离参照超 TOL（证明新断言在旧枚举下会红），且偏离值落在 between 独立模拟上（红因单因归到枚举）。
    tmp_neg = os.path.join(tmp, 'neg')
    os.makedirs(tmp_neg, exist_ok=True)
    build_scenes(tmp_neg)
    r_neg = subprocess.run([BLENDER, '-b', '-t', '4', '--python', os.path.abspath(__file__), '--', '--driver',
                            os.path.abspath(a.renderer), tmp_neg], capture_output=True, text=True, timeout=1800,
                           env=dict(os.environ, BEAUTY_MAT_T6_NEG='1', BEAUTY_MAT_CASES='t6'))
    ok(r_neg.returncode == 0 and os.path.exists(os.path.join(tmp_neg, 't6.npy')),
       '负对照驱动跑完（enum 撤销，仅 t6）(exit %d)' % r_neg.returncode,
       r_neg.stderr[-1500:] if r_neg.returncode else None)
    if r_neg.returncode == 0:
        near6n = at6(-1.3, tmp_neg)
        ok(all(rel(near6n[i], ref6[i]) > TOL for i in range(3)),
           '负对照 只撤销枚举修复 → T6a 判红（偏离参照 > %d%%）' % (TOL * 100),
           {'neg9985': near6n.round(4).tolist(), 'ref': ref6.round(4).tolist()})
        # 近块在 x=-1.3 偏轴：λ = log2(视距/cos × pix × 纹素) = λ0 + log2(1+(Δx/d)²)，丢弃带比中心块窄，
        # 期望值用块的有效 λ 独立重算（不接受拿中心块期望硬套）
        lam_neg = T6_LAMBDA + math.log2(1.0 + 1.3 ** 2 / T6_DIST ** 2)
        exp_bn, holes_bn = t6_window_exp(False, lam=lam_neg)
        exp_pxn = [ref6[i] * exp_bn[i] / exp_n[i] for i in range(3)]
        ok(all(rel(near6n[i], exp_pxn[i]) <= TOL for i in range(3)),
           '负对照 渲染值 = between 路径独立模拟（λ_eff=%.3f，丢弃 %.1f%%；红因单因归到枚举修复）'
           % (lam_neg, holes_bn * 100),
           {'neg9985': near6n.round(4).tolist(), 'expected': [round(float(x), 4) for x in exp_pxn]})

    # E2 门禁单元用例（blenderamb R2 可选1）：t7 残余共面冲突、t8 位移超预算都必须让 prepare 直接失败
    gate7 = (rep.get('t7') or {}).get('gate') or ''
    ok('残余共面冲突' in gate7, 'E2 门禁 t7：下沉产生残余共面冲突时直接失败（不再只记录）',
       {'gate': gate7[:200]})
    gate8 = (rep.get('t8') or {}).get('gate') or ''
    ok('预算' in gate8 and '32' in gate8, 'E2 门禁 t8：下沉位移超 32mm 预算直接失败',
       {'gate': gate8[:200]})
    if not a.keep:
        shutil.rmtree(tmp, ignore_errors=True)
    print('beauty-materials-test: %d passed, %d failed' % (passes, fails))
    return 1 if fails else 0


if __name__ == '__main__':
    if '--driver' in sys.argv:
        driver(sys.argv[sys.argv.index('--driver') + 1:])
    else:
        sys.exit(main())
