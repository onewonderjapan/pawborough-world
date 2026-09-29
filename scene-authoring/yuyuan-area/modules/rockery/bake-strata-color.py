# -*- coding: utf-8 -*-
"""bake-strata-color.py — 大假山黄石层理颜色/粗糙度烘焙（wave13-matdetail M2）。

巡检 wave13-nightqa 第 7 条：大假山表面平滑黏土感。R3 黄石几何已有层理沟槽
（YELLOW.strata_period 0.8 m）但颜色均匀（PaintedPlaster017 灰泥细纹 tint a08560），
近景读不出石质。本脚本对**已交付的 staged model.glb 做后处理**：

  - 程序化层理颜色贴图（自有生成）：原 tint 贴图（GLB 内嵌 plaster-tint-a08560）×
    层理乘子。条带沿贴图 v：cube-UV（tileM 2.5）下竖直侧面（大假山绝大部分表面积）
    的 v = 世界高度 / 2.5，条带即水平层带，周期 = strata_period 0.8 m；带缘随 u 做
    波状扰动 ±0.06 m（层理波状感；贴图空间波，与世界坐标噪声不同相，色带与几何
    沟槽错位 ≤ 波幅，真实黄石亦常见，写明权衡）。沟核 ×0.74（同 M1 瓦沟口径）、
    层顶 ×1.06、带内细噪声 ±3%。顶/底面（cube-UV v=水平轴）条带错轴——顶面多为
    平台/苔藓覆盖、底面不可见，接受并写明。
  - 程序化 ORM 贴图（1024×64 自有生成）：G 通道直接编码粗糙度面带 0.85 / 沟带 0.95，
    同一条带相位（含波状扰动，与颜色共用 strata-band 层理场）；UV 同上。
    roughness 口径（R1 审查项 4）：导出 GLB 的 pbrMetallicRoughness.roughnessFactor
    显式置 1.0（R0 依赖「原材质 0.9 不变」但实测导出 factor 缺省 1，G=target/0.9 的
    换算使有效粗糙度漂到 0.944–1.0），有效粗糙度 = G。
  - 材质改动仅限 rockery-stone / rockery-stone-dark 的颜色贴图与新增 roughnessMap；
    rockery-moss（苔藓，沟底覆盖）保持原样。不写顶点色（Blender 4.5 glTF 导出器对
    texture×vertexColor 组合会双写 COLOR_0 白 + COLOR_1 实色，viewer 读 COLOR_0
    顶点色失效——已实测，见 wave13-matdetail 会话记录）。

几何/碰撞不变：不写任何顶点坐标/索引；守卫断言导出后 src 顶点集合 ⊆ dst（接缝
顶点复制不改外形）、tris 数与 AABB 一致。

用法（Blender）：
  blender -b -t 4 --python-exit-code 1 -P modules/rockery/bake-strata-color.py -- \
      --src out-garden-kits/rockery-dajiashan/model.glb \
      --dst out-garden-kits/rockery-dajiashan/model.glb \
      --report modules/rockery/records/strata-bake-dajiashan.json
"""
import argparse
import hashlib
import io
import json
import math
import os
import struct
import sys

import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# R3 YELLOW 冻结值（build-rockery-r2.py，2026-09-23 D5）
STRATA_PERIOD = 0.8
TILE_M = 2.5             # site-inputs stone.tileM（cube-UV 1 周期 = 2.5 m）
GROOVE_DARK = 0.70       # 沟核乘子（v2 调强：0.74→0.70，渲染标定 16.1→目标 ≥16.5）
CREST_LIGHT = 1.08       # 层顶乘子（v2 调强：1.06→1.08）
FINE_AMP = 0.03          # 带内细噪声 ±3%
WAVE_M = 0.06            # 带缘波状扰动 ±0.06 m
ROUGH_FACE = 0.85
ROUGH_GROOVE = 0.95
ROUGHNESS_FACTOR = 1.0   # R1：导出 GLB 显式置 1.0，有效粗糙度 = ORM G（层理场/公式唯一实现在 strata-texture.py）


def glb_extract_image_bytes(glb_path, image_name):
    """从 GLB 提取指定名 image 的编码字节（jpeg/png 原样）。"""
    with open(glb_path, 'rb') as f:
        buf = f.read()
    jl = struct.unpack('<I', buf[12:16])[0]
    gj = json.loads(buf[20:20 + jl].decode('utf-8'))
    off = 20 + jl
    binb = buf[off + 8:off + 8 + struct.unpack('<I', buf[off:off + 4])[0]]
    for img in gj.get('images', []):
        if img.get('name') != image_name:
            continue
        bv = gj['bufferViews'][img['bufferView']]
        o = bv.get('byteOffset', 0)
        return binb[o:o + bv['byteLength']], gj, binb
    raise KeyError(f'image {image_name} not in {glb_path}')


def glb_geometry_fingerprint(buf):
    """GLB 几何指纹：有向三角形坐标 multiset（量化 1e-6）+ 三角总数 + AABB + 顶点点集。
    Blender 导入/导出往返会在 UV 接缝/材质边界复制顶点（外形与绕序不变），
    R1 守卫升级为有向三角形比较（审查可选）：顶点复制不改有向三角形集合，
    任何位移 / 翻面 / 增删面都会被捕获；顶点 multiset 保留输出用于拆分诊断。"""
    jl = struct.unpack('<I', buf[12:16])[0]
    gj = json.loads(buf[20:20 + jl].decode('utf-8'))
    off = 20 + jl
    binb = buf[off + 8:off + 8 + struct.unpack('<I', buf[off:off + 4])[0]]
    tris_total = 0
    pts = []
    tris = []
    aabb = [float('inf')] * 3, [float('-inf')] * 3
    for mesh in gj['meshes']:
        for prim in mesh['primitives']:
            acc = gj['accessors'][prim['attributes']['POSITION']]
            bv = gj['bufferViews'][acc['bufferView']]
            base = (bv.get('byteOffset', 0)) + acc.get('byteOffset', 0)
            P = []
            for i in range(acc['count']):
                o = base + i * 12
                p = tuple(round(struct.unpack_from('<f', binb, o + k)[0], 6) for k in (0, 4, 8))
                P.append(p)
                pts.append(p)
                for c in range(3):
                    aabb[0][c] = min(aabb[0][c], p[c])
                    aabb[1][c] = max(aabb[1][c], p[c])
            iacc = gj['accessors'][prim['indices']]
            ibv = gj['bufferViews'][iacc['bufferView']]
            ibase = (ibv.get('byteOffset', 0)) + iacc.get('byteOffset', 0)
            u32 = iacc['componentType'] == 5125
            idx = [struct.unpack_from('<I' if u32 else '<H', binb, ibase + i * (4 if u32 else 2))[0]
                   for i in range(iacc['count'])]
            for t in range(0, len(idx) - 2, 3):
                tris.append((P[idx[t]], P[idx[t + 1]], P[idx[t + 2]]))   # 绕序保留（有向）
            tris_total += iacc['count'] // 3
    from collections import Counter
    return Counter(pts), tris_total, tuple(round(v, 4) for v in aabb[0] + aabb[1]), Counter(tris)


def bake_textures(dst_dir, mat_srcs):
    """委托 system python3 + PIL 烘焙（Blender 内无 PIL，同 build-rockery.make_tinted_color_texture
    的既有模式）。mat_srcs = [(材质名, 贴图名, 原贴图字节), ...]，逐材质生成
    strata-<贴图名>.png；ORM 只生成一份（粗糙度层理两材质共用）。"""
    import shutil
    import subprocess
    os.makedirs(dst_dir, exist_ok=True)
    py = shutil.which('python3')
    if not py:
        raise RuntimeError('system python3 not found for strata bake')
    tool = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'strata-texture.py')
    out = {}
    for mat_name, img_name, src_bytes in mat_srcs:
        src_jpg = os.path.join(dst_dir, f'_src-{img_name}.bin')
        with open(src_jpg, 'wb') as f:
            f.write(src_bytes)
        color_path = os.path.join(dst_dir, f'strata-{img_name}.png')
        r = subprocess.run([py, tool, '--src', src_jpg, '--color', color_path,
                            '--orm', os.path.join(dst_dir, 'rockery-strata-orm.png')],
                           check=True, capture_output=True, text=True)
        line = [l for l in r.stdout.splitlines() if l.startswith('STRATA_TEX_DONE')][-1]
        kv = dict(t.split('=', 1) for t in line.split() if '=' in t)
        os.remove(src_jpg)
        w, h = kv['size'].split('x')
        out[mat_name] = (color_path, {'size': [int(w), int(h)],
                                      'lumaMean': float(kv['lumaMean']),
                                      'lumaStd': float(kv['lumaStd']),
                                      'ormGMin': float(kv.get('ormGMin', -1)),
                                      'ormGMax': float(kv.get('ormGMax', -1))})
    return out, os.path.join(dst_dir, 'rockery-strata-orm.png')


def glb_rewrite_json(path, mutate):
    """GLB JSON 段重写（bin 原样），同 modules/huxinting/build.py 导出后处理模式。"""
    buf = bytearray(open(path, 'rb').read())
    jl = int.from_bytes(buf[12:16], 'little')
    gj = json.loads(bytes(buf[20:20 + jl]))
    mutate(gj)
    nj = json.dumps(gj, separators=(',', ':')).encode()
    nj += b' ' * ((-len(nj)) % 4)
    bl_off = 20 + jl
    bl = int.from_bytes(buf[bl_off:bl_off + 4], 'little')
    bindata = bytes(buf[bl_off + 8:bl_off + 8 + bl])
    open(path, 'wb').write(b'glTF' + (2).to_bytes(4, 'little') + (12 + 8 + len(nj) + 8 + bl).to_bytes(4, 'little')
                           + len(nj).to_bytes(4, 'little') + b'JSON' + nj
                           + bl.to_bytes(4, 'little') + b'BIN\x00' + bindata)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--dst', required=True)
    ap.add_argument('--report', required=True)
    # 重复烘焙救援口：GLB 内原贴图已被上次 bake 替换时，从外部提供原贴图字节
    # （a08560 = 源 kit × tint（tint-texture.py 管道）；836d4f = 源 kit × hex_scale(a08560, 0.82)）
    ap.add_argument('--color-src-a', default=None, help='plaster-tint-a08560 原贴图（jpg）路径')
    ap.add_argument('--color-src-b', default=None, help='plaster-tint-836d4f 原贴图（jpg）路径')
    a = ap.parse_args(argv)
    # R2（审查可选）：src==dst 时第二次 bake 会把上一次的输出当输入读（审查实测记录确为
    # src==dst，无法区分"非逐位确定"与"读到上次输出"），禁止覆盖读；输出必须走新路径。
    if os.path.realpath(a.src) == os.path.realpath(a.dst):
        sys.exit('bake-strata-color: --src 与 --dst 不得同路径（会覆盖读上次输出）；请输出到新路径')

    src_buf = open(a.src, 'rb').read()
    src_fp = glb_geometry_fingerprint(src_buf)

    def orig_bytes(name):
        try:
            data, _gj, _binb = glb_extract_image_bytes(a.src, name)
            return data
        except KeyError:
            fallback = {'plaster-tint-a08560': a.color_src_a,
                        'plaster-tint-836d4f': a.color_src_b}[name]
            if not fallback or not os.path.exists(fallback):
                raise
            return open(fallback, 'rb').read()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=a.src)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    assert len(meshes) == 1, f'expect 1 mesh, got {len(meshes)}'
    me = meshes[0].data

    mat_srcs = [('rockery-stone', 'tint-a08560', orig_bytes('plaster-tint-a08560')),
                ('rockery-stone-dark', 'tint-836d4f', orig_bytes('plaster-tint-836d4f'))]
    tex_map, orm_path = bake_textures(
        os.path.join(os.path.dirname(a.dst) or '.', 'textures'), mat_srcs)

    orm_img = bpy.data.images.load(orm_path, check_existing=True)
    orm_img.colorspace_settings.name = 'Non-Color'

    touched = []
    tex_stats = None
    for slot in me.materials:
        if slot.name not in tex_map:
            continue                      # moss（苔藓）保持原样
        color_path, stats = tex_map[slot.name]
        if slot.name == 'rockery-stone':
            tex_stats = stats
        col_img = bpy.data.images.load(color_path, check_existing=True)
        col_img.colorspace_settings.name = 'sRGB'
        nt = slot.node_tree
        bsdf = nt.nodes.get('Principled BSDF')
        base_in = bsdf.inputs['Base Color']
        tex_node = base_in.links[0].from_node if base_in.links else None
        assert tex_node is not None and tex_node.image is not None, \
            f'{slot.name}: expected baseColor texture node'
        tex_node.image = col_img          # 换层理颜色贴图（dark 用自己的暗版层理贴图）
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = orm_img
        t.extension = 'REPEAT'
        nt.links.new(t.outputs['Color'], bsdf.inputs['Roughness'])
        touched.append(slot.name)

    bpy.ops.export_scene.gltf(filepath=a.dst, export_format='GLB', export_yup=True,
                              use_selection=False)

    # roughness 口径（R1 审查项 4）：Blender 连接贴图后导出的 roughnessFactor 实测缺省 1 且不受
    # socket default 控制，显式写 1.0 使有效粗糙度 = ORM G（面 0.85 / 沟 0.95）
    fixed_mats = []
    def _fix_roughness(gj):
        for m in gj.get('materials', []):
            if m.get('name') in ('rockery-stone', 'rockery-stone-dark'):
                m.setdefault('pbrMetallicRoughness', {})['roughnessFactor'] = ROUGHNESS_FACTOR
                fixed_mats.append(m['name'])
    glb_rewrite_json(a.dst, _fix_roughness)
    assert fixed_mats == ['rockery-stone', 'rockery-stone-dark'] or sorted(fixed_mats) == ['rockery-stone', 'rockery-stone-dark'], \
        f'roughnessFactor fix touched unexpected materials: {fixed_mats}'

    dst_fp = glb_geometry_fingerprint(open(a.dst, 'rb').read())
    guard = {
        'srcTris': src_fp[1], 'dstTris': dst_fp[1],
        'srcAABB': list(src_fp[2]), 'dstAABB': list(dst_fp[2]),
        'srcVertsSubsetOfDst': not (src_fp[0] - dst_fp[0]),
        'dstSplitVerts': sum((dst_fp[0] - src_fp[0]).values()),
        'orientedTrisEqual': src_fp[3] == dst_fp[3],
        'orientedTriDiff': sum(((src_fp[3] - dst_fp[3]) + (dst_fp[3] - src_fp[3])).values()),
        # 表面几何不变 = 有向三角形集合完全一致（R1 口径；顶点记录数可因 UV 接缝复制而不同，
        # 不称 POSITION／索引缓冲区逐位不变）
        'geometryUnchanged': (not (src_fp[0] - dst_fp[0])) and src_fp[1] == dst_fp[1]
        and src_fp[2] == dst_fp[2] and src_fp[3] == dst_fp[3],
    }
    if not guard['geometryUnchanged']:
        print('GEOMETRY_GUARD_FAIL ' + json.dumps(guard))
        sys.exit(2)

    report = {
        'cluster': 'rockery-dajiashan', 'src': a.src, 'dst': a.dst,
        'colorTex': {m: os.path.relpath(p, ROOT) for m, (p, _s) in tex_map.items()},
        'ormTex': os.path.relpath(orm_path, ROOT),
        'materials': touched,
        'params': {'strataPeriod': STRATA_PERIOD, 'tileM': TILE_M,
                   'grooveDark': GROOVE_DARK, 'crestLight': CREST_LIGHT,
                   'fineAmp': FINE_AMP, 'waveM': WAVE_M,
                   'roughFace': ROUGH_FACE, 'roughGroove': ROUGH_GROOVE,
                   'roughnessFactor': ROUGHNESS_FACTOR,
                   'roughnessNote': 'ORM G encodes target roughness (face 0.85 / groove 0.95) on the same strata band field (incl. wave perturbation) as color; glTF roughnessFactor explicitly 1.0'},
        'texStats': tex_stats,
        'guard': guard,
        'bytes': os.path.getsize(a.dst),
        'sha256': hashlib.sha256(open(a.dst, 'rb').read()).hexdigest(),
    }
    with open(a.report, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print('STRATA_BAKE_DONE ' + json.dumps(report))


if __name__ == '__main__':
    main()
