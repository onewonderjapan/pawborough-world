#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave14-gable：湖心亭山尖装饰产物级验收（R1 起入默认 npm test 链，纯 Python 无浏览器/GPU）。

用法：
  OUT_DIR=out-zone python3 -X utf8 tests/gable-product-check.py
  GABLE_NEGCASE=1..6 OUT_DIR=... 同上   # 负例：内存突变被测模型，判据必须红

判据（期望独立取数：设计值读 modules/huxinting/records.json 的 frame + designValues；
冻结尺寸/比例约束读 tests/gable-constraints.py，应用到**实际 GLB 测量值**——生成器参数与
records 同步越界时，GLB 实测照样红）：
  G1 悬鱼节点 mainroof/porchroof × w/e 存在，材质非白抹灰
  G2 博风板节点 2 顶 × 2 边存在，为盒：出平面厚度 = bofengProud，且背面贴山花平面、前脸在山花面外侧
  G3 山花材质 = ht-wood-red（≠ ht-plaster-white）
  G4 悬鱼顶 = ridgeZ − xuanyuTuck、垂长 = xuanyuLen、在山尖中线、宽 ≤ xuanyuW
  G5 山花三角自身 = 设计值：高 = ridgeZ−breakZ、底宽 = 2×(rectHalfV−breakInset)
  G6 博风板下探 ≤ breakZ − bofengDrop、脊端 ≥ ridgeZ
  G7 博风板实际法向宽（GLB 截面实测）= bofengWidth
  G8 冻结约束（tests/gable-constraints.py）vs GLB 实测：博风宽/山花跨度、博风宽/山尖高、
     悬鱼长/山尖高、悬鱼长 ≤ 山尖高、悬鱼宽/长、悬鱼/博风出平面带
  G9 悬鱼正面投影真实三角面深度遮挡（R2，512×512 沿山花外法向采样）：全部 GLB mesh 的
     三角面参与遮挡判定（不按名称白名单排除，双面不透明材质均算遮挡物），可见率 =
     可见投影面积 / 悬鱼未遮挡投影面积 ≥ 70%。
     —— R0 悬鱼在博风后方被盖死；R1 挂博风前方；R1 的 G9 只枚举山尖端构件、排除瓦面等
     实际遮挡物（审查 FAIL：抱厦两侧被上段瓦垄与 r2 栏杆遮到 65.4%）；R2 抱厦悬鱼顶下移
     到 ridgeZ−0.16 避开瓦垄/栏杆带（实测 85.5%），主楼 e 端正对湖心亭自身塔楼、外部视线
     结构上被挡（实测 0%，遮挡物 towerroof 系列）——按主控裁定从 ≥70% 验收中**排除**，
     只断言悬鱼仍存在且朝向正确，不计 100%。
GLB 缺失 = FAIL（交付守卫不静默跳过）。
负例：
  NEG1 删悬鱼（节点视同缺失）→ G1 红
  NEG2 山花改回白抹灰 → G3 红
  NEG3 博风压回山花平面 → G2「未站在山花面外侧」红
  NEG4 悬鱼退回 R0 位置（山花面外 0.008、博风后方）→ G9 遮挡红（回到 R0 参数必须失败）
  NEG5 悬鱼几何与模拟 records designValues.xuanyuLen **同步**拉长到山尖高 1.2 倍
       （G4 几何 vs records 自洽绿）→ G8 冻结带「xuanyuLen/rise」红（同步越界必须失败）
  NEG6 悬鱼沿 u 再外移 0.5 m（山花/博风全在身后——「博风不遮挡」），上段瓦面/瓦垄与
       r2 栏杆仍在视线上 → G9 遮挡红（R2 新 G9 必须看见山尖端构件之外的遮挡物）
局部系还原：glTF 世界 (X,Y,Z) = (map_x, h, map_z)；u/v 由 records.frame 的 centroid/axis/normal 正交基还原。
"""
import json
import math
import os
import struct
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gable_constraints as FC                                  # noqa: E402  冻结约束唯一来源

ROOT = os.path.dirname(os.path.abspath(__file__))
FAILS = []
CHECKS = [0]

def ck(cond, msg):
    CHECKS[0] += 1
    if not cond:
        FAILS.append(msg)

def load_glb(path):
    buf = open(path, 'rb').read()
    assert buf[:4] == b'glTF', path
    jl = struct.unpack('<I', buf[12:16])[0]
    gj = json.loads(buf[20:20 + jl])
    bo = 20 + jl
    bl = struct.unpack('<I', buf[bo:bo + 4])[0]
    return gj, buf[bo + 8:bo + 8 + bl]

def positions(gj, bin_chunk, mesh_idx):
    """解码 mesh 的全部 POSITION（多 primitive 拼接），返回 [(x,y,z)]（glTF 世界系）。"""
    out = []
    for prim in gj['meshes'][mesh_idx]['primitives']:
        acc = gj['accessors'][prim['attributes']['POSITION']]
        bv = gj['bufferViews'][acc['bufferView']]
        off = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
        n = acc['count']
        for i in range(n):
            x, y, z = struct.unpack_from('<3f', bin_chunk, off + i * 12)
            out.append((x, y, z))
    return out

def node_mesh(gj, name):
    for nd in gj['nodes']:
        if nd.get('name') == name:
            return nd.get('mesh')
    return None

def mesh_materials(gj, mesh_idx):
    names = []
    for prim in gj['meshes'][mesh_idx]['primitives']:
        mi = prim.get('material')
        names.append(gj['materials'][mi]['name'] if mi is not None else None)
    return names

# ---------------------------------------- G9 真实三角面深度遮挡（R2，numpy）----
def _accessor(gj, bin_chunk, ai):
    acc = gj['accessors'][ai]
    bv = gj['bufferViews'][acc['bufferView']]
    off = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    comp, item, npv = {5126: (4, 1, np.float32), 5123: (2, 1, np.uint16),
                       5125: (4, 1, np.uint32), 5121: (1, 1, np.uint8)}[acc['componentType']]
    ncomp = {'VEC3': 3, 'VEC2': 2, 'SCALAR': 1}[acc['type']]
    raw = np.frombuffer(bin_chunk, dtype=np.uint8,
                        count=acc['count'] * ncomp * comp, offset=off)
    return raw.view(npv).reshape(acc['count'], ncomp if ncomp > 1 else 1)

def node_triangles(gj, bin_chunk, mesh_idx, node):
    """mesh 的全部三角面 (T,3,3)，世界系，应用节点 TRS/matrix 变换。"""
    m = np.eye(4)
    if 'matrix' in node:
        m = np.asarray(node['matrix'], dtype=np.float64).reshape(4, 4).T
    else:
        if 'scale' in node:
            m[:3, :3] *= np.asarray(node['scale'])
        if 'rotation' in node:
            x, y, z, w = node['rotation']
            r = np.array([
                [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
            m[:3, :3] = m[:3, :3] @ r
        if 'translation' in node:
            m[:3, 3] = node['translation']
    tris = []
    for prim in gj['meshes'][mesh_idx]['primitives']:
        pos = _accessor(gj, bin_chunk, prim['attributes']['POSITION']).astype(np.float64)
        idx = _accessor(gj, bin_chunk, prim['indices']).astype(np.int64).reshape(-1)
        t = pos[idx].reshape(-1, 3, 3)
        hom = np.concatenate([t, np.ones(t.shape[:2] + (1,))], axis=2)
        tris.append((hom @ m.T)[..., :3])
    return np.concatenate(tris, axis=0) if tris else np.zeros((0, 3, 3))

def scene_triangles_local(gj, bin_chunk, fr):
    """全部节点三角面，转换到山花局部系 (u,v,h)。返回 dict(node名 -> (T,3,3))。"""
    cx, cz = fr['centroid']
    ux, uz = fr['axis']
    vx, vz = fr['normal']
    out = {}
    for nd in gj['nodes']:
        if 'mesh' not in nd:
            continue
        t = node_triangles(gj, bin_chunk, nd['mesh'], nd)
        x, y, z = t[..., 0], t[..., 1], t[..., 2]
        dx, dz = x - cx, z - cz
        out[nd.get('name', '')] = np.stack([dx * ux + dz * uz, dx * vx + dz * vz, y], axis=-1)
    return out

def raster_depth(tris, m_out, box=None, N=512, pad=0.02):
    """把三角面 (T,3,3)（局部 (u,v,h)）光栅化到 (v,h) N×N 网格。
    返回 (depth, cover, box)：depth = 每像素最靠近观察者的 u（w 端 m_out=-1 取 min，e 端取
    max），cover = 投影覆盖，box = (v0,v1,h0,h1,像素面积)。box 传入时沿用同一网格
    （悬鱼与其遮挡物必须逐像素同框比较）。视线沿山花外法向，双面填充。"""
    if box is None:
        v0b, v1b = tris[..., 1].min() - pad, tris[..., 1].max() + pad
        h0b, h1b = tris[..., 2].min() - pad, tris[..., 2].max() + pad
    else:
        v0b, v1b, h0b, h1b = box
    dv, dh = (v1b - v0b) / N, (h1b - h0b) / N
    depth = np.full((N, N), math.inf if m_out < 0 else -math.inf)
    cover = np.zeros((N, N), dtype=bool)
    tv = (tris[..., 1] - v0b) / (v1b - v0b) * N - 0.5
    th = (tris[..., 2] - h0b) / (h1b - h0b) * N - 0.5
    tu = tris[..., 0]
    for k in range(len(tris)):
        xs, ys, us = tv[k], th[k], tu[k]
        i0 = max(0, int(math.floor(xs.min()))); i1 = min(N - 1, int(math.ceil(xs.max())))
        j0 = max(0, int(math.floor(ys.min()))); j1 = min(N - 1, int(math.ceil(ys.max())))
        if i1 < i0 or j1 < j0:
            continue
        gx, gy = np.meshgrid(np.arange(i0, i1 + 1) + 0.5, np.arange(j0, j1 + 1) + 0.5)
        d0 = (xs[1] - xs[0]) * (gy - ys[0]) - (ys[1] - ys[0]) * (gx - xs[0])
        d1 = (xs[2] - xs[1]) * (gy - ys[1]) - (ys[2] - ys[1]) * (gx - xs[1])
        d2 = (xs[0] - xs[2]) * (gy - ys[2]) - (ys[0] - ys[2]) * (gx - xs[2])
        inside = ((d0 >= 0) & (d1 >= 0) & (d2 >= 0)) | ((d0 <= 0) & (d1 <= 0) & (d2 <= 0))
        if not inside.any():
            continue
        area = d0 + d1 + d2
        w0 = np.where(np.abs(area) > 1e-12, d1 / area, 0.0)
        w1 = np.where(np.abs(area) > 1e-12, d2 / area, 0.0)
        ui = w0 * us[0] + w1 * us[1] + (1.0 - w0 - w1) * us[2]
        sl = (slice(j0, j1 + 1), slice(i0, i1 + 1))
        sub = depth[sl]
        upd = (inside & (ui < sub)) if m_out < 0 else (inside & (ui > sub))
        sub[upd] = ui[upd]
        depth[sl] = sub
        cover[sl] |= inside
    return depth, cover, (v0b, v1b, h0b, h1b, dv * dh)

NEG6_OLD_BAD = []


def main():
    out_dir = os.environ.get('OUT_DIR', 'out-zone')
    glb = os.path.join(out_dir, 'huxin-ting.glb')
    if not os.path.exists(glb):
        print('gable-product-check: FAIL —— %s 不存在（先跑标准重建，交付守卫不跳过）' % glb)
        return 1
    rec = json.load(open(os.path.join(ROOT, '..', 'modules', 'huxinting', 'records.json'), encoding='utf-8'))
    fr = rec['frame']
    cx, cz = fr['centroid']
    ux, uz = fr['axis']
    vx, vz = fr['normal']
    V0 = fr['rectHalfV']

    def to_local(pts):
        out = []
        for x, y, z in pts:
            dx, dz = x - cx, z - cz
            out.append((dx * ux + dz * uz, dx * vx + dz * vz, y))
        return out

    gj, bin_chunk = load_glb(glb)
    SCENE = scene_triangles_local(gj, bin_chunk, fr)      # G9：全场景三角面（局部系），一次解码
    neg = os.environ.get('GABLE_NEGCASE', '')
    D = rec['designValues']

    roofs = {'mainroof': D['roof'], 'porchroof': D['porch']}
    occ_report = []
    for rname, rp in roofs.items():
        orb = rp.get('gableOrnament')
        if not orb:
            FAILS.append('%s designValues 缺 gableOrnament（旧设计）' % rname); CHECKS[0] += 1
            continue
        zb, zr = rp['breakZ'], rp['ridgeZ']
        inset = rp['breakInset']
        # 屋面 v 跨：主楼 = 2*rectHalfV；抱厦 = depth + 0.25（rect=(−PU,PU, V0−0.25, V0+PD)）
        vext = 2 * V0 if rname == 'mainroof' else rp['depth'] + 0.25
        bw, bp, bd = orb['bofengWidth'], orb['bofengProud'], orb['bofengDrop']
        xl, xw, xp = orb['xuanyuLen'], orb['xuanyuW'], orb['xuanyuProud']
        xt = orb.get('xuanyuTuck', 0.04)
        # 山花参考（G5 先钉设计值；实测 rise/span 作为 G8/G9 的参考系）
        sh = {}
        for tag in ('w', 'e'):
            nm = 'huxin-ting__%s-shanhua-%s' % (rname, tag)
            mi = node_mesh(gj, nm)
            if mi is None:
                ck(False, '%s 山花节点缺失' % nm); continue
            loc = to_local(positions(gj, bin_chunk, mi))
            us = [p[0] for p in loc]; vs = [p[1] for p in loc]; hs = [p[2] for p in loc]
            rise_m = max(hs) - min(hs)
            span_m = max(vs) - min(vs)
            ck(abs(rise_m - (zr - zb)) < 0.01, '%s 山花高 %s != ridgeZ-breakZ' % (nm, max(hs) - min(hs)))
            ck(abs(span_m - (vext - 2 * inset)) < 0.02, '%s 山花底宽 != v跨−2×breakInset' % nm)
            ck(len(mesh_materials(gj, mi)) == 1, '%s 山花应单材质' % nm)
            sh[tag] = dict(u=us[0], vc=(max(vs) + min(vs)) / 2, mats=mesh_materials(gj, mi),
                           rise=rise_m, span=span_m)
        if neg == '2':
            for tag in sh:
                sh[tag]['mats'] = ['ht-plaster-white']
        for tag, m_out in (('w', -1), ('e', 1)):
            if tag not in sh:
                continue
            ck(sh[tag]['mats'][0] != 'ht-plaster-white',
               '%s-shanhua-%s 山花仍是白抹灰 %s' % (rname, tag, sh[tag]['mats'][0]))
            ck(sh[tag]['mats'][0] == 'ht-wood-red',
               '%s-shanhua-%s 山花材质 %s != ht-wood-red' % (rname, tag, sh[tag]['mats'][0]))
            # 博风板（G2/G6 + G7 实际法向宽）
            bw_meas = None
            for side in ('s', 'n'):
                nm = 'huxin-ting__%s-bofeng3d-%s%s' % (rname, tag, side)
                mi = node_mesh(gj, nm)
                if mi is None:
                    ck(False, '%s 博风板缺失' % nm); continue
                loc = to_local(positions(gj, bin_chunk, mi))
                if neg == '3':                       # 负例：把博风板整体压回山花平面（模拟被遮旧状）
                    loc = [(sh[tag]['u'], v, h) for (_u, v, h) in loc]
                us = [p[0] for p in loc]; vs = [p[1] for p in loc]; hs = [p[2] for p in loc]
                umin, umax = min(us), max(us)
                ck(abs((umax - umin) - bp) < 2e-3, '%s 出平面 %s != bofengProud' % (nm, umax - umin))
                back = umax if m_out < 0 else umin
                outmost = umin if m_out < 0 else umax
                ck(abs(back - sh[tag]['u']) < 2e-3, '%s 背面未贴山花平面' % nm)
                ck((outmost - sh[tag]['u']) * m_out > 1e-4, '%s 未站在山花面外侧' % nm)
                ck(min(hs) <= zb - bd + 1e-3, '%s 未下探到 zb-bofengDrop' % nm)
                ck(max(hs) >= zr - 1e-3, '%s 脊端未到 ridgeZ' % nm)
                # G7 实际法向宽：截面（u≈umax 一侧）顶点去重后两两最短距离 = 板宽
                # （GLB 导出器按 UV 复制顶点，同位置会重复，必须先去重）
                face = sorted(set((round(p[1], 4), round(p[2], 4)) for p in loc
                                  if abs(p[0] - (umax if m_out < 0 else umin)) < 1e-4))
                if len(face) >= 3:
                    wmin = min(math.hypot(a[0] - b[0], a[1] - b[1])
                               for i, a in enumerate(face) for b in face[i + 1:])
                    if bw_meas is None or wmin < bw_meas:
                        bw_meas = wmin
            if bw_meas is not None:
                ck(abs(bw_meas - bw) < 3e-3,
                   'G7 %s-%s 博风实际板宽 %.4f != bofengWidth %.4f' % (rname, tag, bw_meas, bw))
            # 悬鱼（G1/G4 + G8 实测比例 + G9 正面遮挡）
            nm = 'huxin-ting__%s-xuanyu-%s' % (rname, tag)
            mi = node_mesh(gj, nm)
            if neg == '1':                           # 负例：悬鱼节点视同缺失
                mi = None
            if mi is None:
                ck(False, '%s 悬鱼节点缺失（G1）' % nm); continue
            loc = to_local(positions(gj, bin_chunk, mi))
            if neg == '4':
                # 负例：退回 R0 悬鱼位置（山花面外 0.008、博风板后方）——回到 R0 参数必须失败
                loc = [(x - m_out * (bp - 0.004), v, h) for (x, v, h) in loc]
            us = [p[0] for p in loc]; vs = [p[1] for p in loc]; hs = [p[2] for p in loc]
            mats = mesh_materials(gj, mi)
            ck(mats and mats[0] != 'ht-plaster-white', '%s 悬鱼材质是白抹灰' % nm)
            zt, zbm = max(hs), min(hs)
            xl_meas = zt - zbm
            xw_meas = max(vs) - min(vs)
            xp_meas = max(us) - min(us)
            neg5_stretch = 1.0
            if neg == '5':
                # R2 负例（审查可选固化）：几何与模拟 records **同步**越界——悬鱼几何与
                # designValues.xuanyuLen 一起拉长到山尖高的 1.2 倍：G4「几何 vs records」
                # 自洽绿，必须由 G8 冻结约束（xuanyuLen/rise 与 ≤山尖高）独立拦下。
                new_xl = 1.2 * sh[tag]['rise']
                neg5_stretch = new_xl / xl_meas
                loc = [(x, v, zt - (zt - h) * neg5_stretch) for (x, v, h) in loc]
                orb['xuanyuLen'] = new_xl          # 同步模拟 records（D = rec['designValues']）
                xl = new_xl                        # 后续 G4 断言改用同步后的设计值
                hs = [p[2] for p in loc]
                xl_meas = zt - min(hs)
            ck(abs(zt - (zr - xt)) < 5e-3, '%s 悬鱼顶 %s != ridgeZ-tuck' % (nm, zt))
            ck(abs(xl_meas - xl) < 5e-3, '%s 悬鱼垂长 %s != xuanyuLen' % (nm, xl_meas))
            ck(xw_meas <= xw + 2e-3, '%s 悬鱼宽超设计' % nm)
            ck(abs((max(vs) + min(vs)) / 2 - sh[tag]['vc']) < 5e-3, '%s 悬鱼不在山尖中线' % nm)
            outmost = min(us) if m_out < 0 else max(us)
            ck((outmost - sh[tag]['u']) * m_out > 1e-4, '%s 悬鱼未在山花面外侧' % nm)
            # ---- G8 冻结约束 vs GLB 实测（数字写进失败消息与报告）----
            rise_m, span_m = sh[tag]['rise'], sh[tag]['span']
            for tagc, val in (('bofengWidth/span', (bw_meas or 0) / span_m),
                              ('bofengWidth/rise', (bw_meas or 0) / rise_m),
                              ('xuanyuLen/rise', xl_meas / rise_m),
                              ('xuanyuW/xuanyuLen', xw_meas / xl_meas if xl_meas > 1e-6 else 9)):
                okc, msgc = FC.ratio_ok(tagc, val)
                ck(okc, 'G8 %s-%s %s（GLB 实测）' % (rname, tag, msgc))
            ck(xl_meas <= FC.XUANYU_L_MAX_RISE * rise_m + 1e-6,
               'G8 %s-%s 悬鱼长 %.3f 超过山尖高 %.3f' % (rname, tag, xl_meas, rise_m))
            for lbl, val2, band in (('xuanyuProud', xp_meas, FC.XUANYU_PROUD), ('bofengProud', bp, FC.BOFENG_PROUD)):
                ck(band[0] <= val2 <= band[1],
                   'G8 %s-%s %s=%.4f 不在冻结带 %s' % (rname, tag, lbl, val2, band))
            # ---- G9 真实三角面深度遮挡（R2）：可见投影面积 / 悬鱼未遮挡投影面积 ≥ 70% ----
            # 全部 GLB mesh 三角面参与遮挡判定（不按名称白名单排除；双面不透明材质均算
            # 遮挡物）。视线沿山花外法向（local ±u），512×512 深度采样：悬鱼自身节点不算
            # 遮挡物，两侧悬鱼互在对方身后（深度更远），深度比较天然排除。
            fish_tris = SCENE[nm].copy()
            if neg == '4':                       # 与顶点级 loc 同公式：退回 R0 位置
                fish_tris[..., 0] -= m_out * (bp - 0.004)
            elif neg == '6' and rname == 'porchroof':
                # 主控修正（astra R2 必修1）：抱厦悬鱼整体上移 0.12 m = 恢复 R1 安装高度
                # （xuanyuTuck 0.16 → 0.04）。此时只看山尖端构件（R1 旧口径：山花/博风/撒头/
                # 正脊）悬鱼 100% 可见；全三角面口径下被上段瓦面/瓦垄与 r2 栏杆遮挡 ≈65%
                # ——真实遮挡必须红，同时断言旧口径是绿的（证明本负例专抓 R1 的漏检）。
                fish_tris[..., 2] += 0.12
            elif neg == '5':
                fish_tris[..., 2] = zt - (zt - fish_tris[..., 2]) * neg5_stretch
            fd, fc, box = raster_depth(fish_tris, m_out)
            others = [t for n2, t in SCENE.items() if n2 != nm]
            occts = np.concatenate(others, axis=0) if others else np.zeros((0, 3, 3))
            od, oc, _ = raster_depth(occts, m_out, box=box[:4])
            blocked = (oc & (od < fd - 1e-5)) if m_out < 0 else (oc & (od > fd + 1e-5))
            n_total = int(fc.sum())
            n_blk = int((fc & blocked).sum())
            a_total = n_total * box[4]
            a_vis = (n_total - n_blk) * box[4]
            ratio = (n_total - n_blk) / n_total if n_total else 0.0
            if neg == '6' and rname == 'porchroof':
                gable_nodes = ['huxin-ting__%s%s' % (rname, sfx) for sfx in
                               ('-shanhua-' + tag, '-bofeng3d-' + tag + 's', '-bofeng3d-' + tag + 'n',
                                '-satou-' + tag, '-ridge')]
                olds = [SCENE[n2] for n2 in gable_nodes if n2 in SCENE]
                if olds:
                    od2, oc2, _ = raster_depth(np.concatenate(olds, axis=0), m_out, box=box[:4])
                    blk2 = (oc2 & (od2 < fd - 1e-5)) if m_out < 0 else (oc2 & (od2 > fd + 1e-5))
                    r_old = (n_total - int((fc & blk2).sum())) / n_total if n_total else 0.0
                else:
                    r_old = 0.0
                occ_report.append('NEG6 %s-%s 旧口径（仅山尖端构件）可见 %.1f%%，全三角面 %.1f%%'
                                  % (rname, tag, r_old * 100, ratio * 100))
                if r_old < 0.70:
                    NEG6_OLD_BAD.append('%s-%s 旧口径 %.1f%%' % (rname, tag, r_old * 100))
            if rname == 'mainroof' and tag == 'e':
                # 主控裁定（R2 验收范围）：主楼 e 端山花正对湖心亭自身塔楼（towerroof 系列
                # 构件实测挡在整片视线上，可见率 0%），从外部视线结构上就被挡——该端悬鱼
                # 从 ≥70% 验收中排除，不计 100%；悬鱼仍须存在（G1 上方）且朝向正确
                # （上方「未在山花面外侧」断言照跑）。
                occ_report.append('%s-%s 实测可见 %.1f%%（%.4f/%.4f m²）——验收排除：'
                                  '正对湖心亭自身塔楼，外部视线结构上被挡'
                                  % (rname, tag, ratio * 100, a_vis, a_total))
            else:
                occ_report.append('%s-%s 可见 %.1f%%（%.4f/%.4f m²，%d/%d px）'
                                  % (rname, tag, ratio * 100, a_vis, a_total, n_total - n_blk, n_total))
                ck(ratio >= 0.70,
                   'G9 %s-%s 悬鱼正面投影可见率 %.1f%% < 70%%（真实三角面深度遮挡）'
                   % (rname, tag, ratio * 100))

    label = ('负例 %s' % neg) if neg else '验收'
    print('gable-product-check[%s]: %d checks, %d fail' % (label, CHECKS[0], len(FAILS)))
    for line in occ_report:
        print('  G9', line)
    for f in FAILS:
        print('  FAIL', f)
    if neg:
        # 负例必须红在「指定的那条」上，不能靠别的失败凑数
        need = {'1': '悬鱼节点缺失', '2': '山花材质', '3': '未站在山花面外侧',
                '4': '悬鱼正面投影可见率', '5': 'xuanyuLen/rise',
                '6': '悬鱼正面投影可见率'}[neg]
        ok = any(need in f for f in FAILS)
        if neg == '6':
            # 负例只算数于：旧口径（仅山尖端构件）全绿、真实遮挡红——否则说明它抓的不是 R1 漏检
            ok = ok and not NEG6_OLD_BAD and any('porchroof' in f and need in f for f in FAILS)
            print('  NEG6 旧口径需全绿：%s' % ('✓' if not NEG6_OLD_BAD else '✗ ' + '; '.join(NEG6_OLD_BAD)))
        print('  负例期望失败「%s」：%s' % (need, '出现 ✓' if ok else '未出现 ✗'))
        return 0 if ok else 1
    return 1 if FAILS else 0

if __name__ == '__main__':
    sys.exit(main())
