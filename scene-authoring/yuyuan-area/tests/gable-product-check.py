#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave14-gable：湖心亭山尖装饰产物级验收（R1 起入默认 npm test 链，纯 Python 无浏览器/GPU）。

用法：
  OUT_DIR=out-zone python3 -X utf8 tests/gable-product-check.py
  GABLE_NEGCASE=1..5 OUT_DIR=... 同上   # 负例：内存突变被测模型，判据必须红

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
  G9 悬鱼正面投影遮挡（沿山花法向采样）：每个悬鱼可见投影面积 ≥ 设计面积的 70%
     —— R0 悬鱼在博风后方被合拢区盖死（实测抱厦 e 侧 100%、主楼 88%），R1 悬鱼挂博风前方
GLB 缺失 = FAIL（交付守卫不静默跳过）。
负例：
  NEG1 删悬鱼（节点视同缺失）→ G1 红
  NEG2 山花改回白抹灰 → G3 红
  NEG3 博风压回山花平面 → G2「未站在山花面外侧」红
  NEG4 悬鱼退回 R0 位置（山花面外 0.008、博风后方）→ G9 遮挡红（回到 R0 参数必须失败）
  NEG5 悬鱼垂长拉伸到山尖高 1.2 倍 → G8「xuanyuLen/rise」红（同步越界必须失败）
局部系还原：glTF 世界 (X,Y,Z) = (map_x, h, map_z)；u/v 由 records.frame 的 centroid/axis/normal 正交基还原。
"""
import json
import math
import os
import struct
import sys

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

# ---------------------------------------------------- 2D 几何（正面投影采样）----
def convex2d(pts):
    """Andrew monotone chain 凸包（CCW）。鱼形轮廓的凹鳍处被凸近似填平——
    G9 的「设计面积」与「占据判定」用同一凸包，口径一致。"""
    pts = sorted(set((round(p[0], 6), round(p[1], 6)) for p in pts))
    if len(pts) <= 2:
        return pts
    def half(seq):
        h = []
        for p in seq:
            while len(h) >= 2 and (h[-1][0] - h[-2][0]) * (p[1] - h[-2][1]) - (h[-1][1] - h[-2][1]) * (p[0] - h[-2][0]) <= 0:
                h.pop()
            h.append(p)
        return h
    lo = half(pts)
    hi = half(reversed(pts))
    return lo[:-1] + hi[:-1]

def shoelace(poly):
    n = len(poly)
    return abs(sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))) / 2.0

def point_in_convex(p, poly):
    """凸多边形点内测试（边界算内）。"""
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
        if cr < -1e-9:
            return False
    return True

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
            if neg == '5':
                # 负例：悬鱼垂长拉伸到山尖高的 1.2 倍（模拟生成器参数与 records 同步越界）
                stretch = 1.2 * sh[tag]['rise'] / xl_meas
                loc = [(x, v, zt - (zt - h) * stretch) for (x, v, h) in loc]
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
            # ---- G9 正面投影遮挡采样：可见投影面积 ≥ 设计面积 70% ----
            # 候选遮挡件 = 同 roof 同端的山尖构件（山花/博风×2/撒头/正脊）。
            # 排除两侧悬鱼互遮（各在山一端，正面互不在对方之前）与瓦面/远处构件
            # （upper/lower 瓦面在悬鱼 (v,h) 处的实体不在其 u 前方，物理不遮；此处按本意只查山尖端构件）。
            fish_pts = [(p[1], p[2]) for p in loc]
            ch_fish = convex2d(fish_pts)
            area_design = shoelace(ch_fish)
            cands = []
            for suffix in ('-shanhua-' + tag, '-bofeng3d-' + tag + 's', '-bofeng3d-' + tag + 'n',
                           '-satou-' + tag, '-ridge'):
                cnm = 'huxin-ting__%s%s' % (rname, suffix)
                cm = node_mesh(gj, cnm)
                if cm is None:
                    continue
                cloc = to_local(positions(gj, bin_chunk, cm))
                cus = [p[0] for p in cloc]
                cands.append((min(cus), max(cus), convex2d([(p[1], p[2]) for p in cloc]), cnm))
            EPS = 1e-4
            x_umin, x_umax = min(us), max(us)
            v0b, v1b = min(p[0] for p in ch_fish), max(p[0] for p in ch_fish)
            h0b, h1b = min(p[1] for p in ch_fish), max(p[1] for p in ch_fish)
            NG = 64
            n_in = n_vis = 0
            for iv in range(NG):
                for ih in range(NG):
                    pv = v0b + (v1b - v0b) * (iv + 0.5) / NG
                    ph = h0b + (h1b - h0b) * (ih + 0.5) / NG
                    if not point_in_convex((pv, ph), ch_fish):
                        continue
                    n_in += 1
                    blocked = False
                    for cumin, cumax, cch, _cn in cands:
                        cross = cumin <= x_umax + EPS and cumax >= x_umin - EPS      # u 区间穿插
                        front = (cumin > x_umax + EPS) if m_out > 0 else (cumax < x_umin - EPS)
                        if (cross or front) and point_in_convex((pv, ph), cch):
                            blocked = True
                            break
                    if not blocked:
                        n_vis += 1
            ratio = (n_vis / n_in) if n_in else 0.0
            occ_report.append('%s-%s 可见 %d/%d = %.1f%%（设计面积 %.4f m²）'
                              % (rname, tag, n_vis, n_in, ratio * 100, area_design))
            ck(ratio >= 0.70,
               'G9 %s-%s 悬鱼正面投影可见率 %.1f%% < 70%%（被山尖端构件遮挡）' % (rname, tag, ratio * 100))

    label = ('负例 %s' % neg) if neg else '验收'
    print('gable-product-check[%s]: %d checks, %d fail' % (label, CHECKS[0], len(FAILS)))
    for line in occ_report:
        print('  G9', line)
    for f in FAILS:
        print('  FAIL', f)
    if neg:
        # 负例必须红在「指定的那条」上，不能靠别的失败凑数
        need = {'1': '悬鱼节点缺失', '2': '山花材质', '3': '未站在山花面外侧',
                '4': '悬鱼正面投影可见率', '5': 'xuanyuLen/rise'}[neg]
        ok = any(need in f for f in FAILS)
        print('  负例期望失败「%s」：%s' % (need, '出现 ✓' if ok else '未出现 ✗'))
        return 0 if ok else 1
    return 1 if FAILS else 0

if __name__ == '__main__':
    sys.exit(main())
