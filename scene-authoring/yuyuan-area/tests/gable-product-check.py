#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave14-gable：湖心亭山尖装饰产物级验收（交付守卫，不入默认 npm test 链）。

用法：
  OUT_DIR=out-zone python3 -X utf8 tests/gable-product-check.py
  GABLE_NEGCASE=1|2|3 OUT_DIR=... 同上   # 负例：内存突变被测模型，判据必须红

判据（期望值独立取数：设计值读 modules/huxinting/records.json 的 frame + designValues，
山花三角本身作为山花平面/脊线参考，但它先被 G5 钉到设计值上）：
  G1 悬鱼节点 mainroof/porchroof × w/e 存在，材质非白抹灰
  G2 博风板节点 2 顶 × 2 边存在，为盒：出平面厚度 = bofengProud，且背面贴山花平面、前脸在山花面外侧
  G3 山花材质 = ht-wood-red（≠ ht-plaster-white）
  G4 悬鱼顶 = ridgeZ − xuanyuTuck、垂长 = xuanyuLen、在山尖中线、宽 ≤ xuanyuW
  G5 山花三角自身 = 设计值：高 = ridgeZ−breakZ、底宽 = 2×(rectHalfV−breakInset)
  G6 博风板下探 ≤ breakZ − bofengDrop、脊端 ≥ ridgeZ
GLB 缺失 = FAIL（交付守卫不静默跳过）。
局部系还原：glTF 世界 (X,Y,Z) = (map_x, h, map_z)；u/v 由 records.frame 的 centroid/axis/normal 正交基还原。
"""
import json
import math
import os
import struct
import sys

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
        # 山花参考（G5 先钉设计值）
        sh = {}
        for tag in ('w', 'e'):
            nm = 'huxin-ting__%s-shanhua-%s' % (rname, tag)
            mi = node_mesh(gj, nm)
            if mi is None:
                ck(False, '%s 山花节点缺失' % nm); continue
            loc = to_local(positions(gj, bin_chunk, mi))
            us = [p[0] for p in loc]; vs = [p[1] for p in loc]; hs = [p[2] for p in loc]
            ck(abs((max(hs) - min(hs)) - (zr - zb)) < 0.01, '%s 山花高 %s != ridgeZ-breakZ' % (nm, max(hs) - min(hs)))
            ck(abs((max(vs) - min(vs)) - (vext - 2 * inset)) < 0.02, '%s 山花底宽 != v跨−2×breakInset' % nm)
            ck(len(mesh_materials(gj, mi)) == 1, '%s 山花应单材质' % nm)
            sh[tag] = dict(u=us[0], vc=(max(vs) + min(vs)) / 2, mats=mesh_materials(gj, mi))
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
            # 博风板
            for side in 'ab':
                nm = 'huxin-ting__%s-bofeng-%s%s' % (rname, tag, side)
                mi = node_mesh(gj, nm)
                if mi is None:
                    ck(False, '%s 博风板缺失' % nm); continue
                loc = to_local(positions(gj, bin_chunk, mi))
                if neg == '3':                       # 负例：把博风板整体压回山花平面（模拟被遮旧状）
                    loc = [(sh[tag]['u'], v, h) for (_u, v, h) in loc]
                us = [p[0] for p in loc]; hs = [p[2] for p in loc]
                umin, umax = min(us), max(us)
                ck(abs((umax - umin) - bp) < 2e-3, '%s 出平面 %s != bofengProud' % (nm, umax - umin))
                back = umax if m_out < 0 else umin
                outmost = umin if m_out < 0 else umax
                ck(abs(back - sh[tag]['u']) < 2e-3, '%s 背面未贴山花平面' % nm)
                ck((outmost - sh[tag]['u']) * m_out > 1e-4, '%s 未站在山花面外侧' % nm)
                ck(min(hs) <= zb - bd + 1e-3, '%s 未下探到 zb-bofengDrop' % nm)
                ck(max(hs) >= zr - 1e-3, '%s 脊端未到 ridgeZ' % nm)
            # 悬鱼
            nm = 'huxin-ting__%s-xuanyu-%s' % (rname, tag)
            mi = node_mesh(gj, nm)
            if neg == '1':                           # 负例：悬鱼节点视同缺失
                mi = None
            if mi is None:
                ck(False, '%s 悬鱼节点缺失（G1）' % nm); continue
            loc = to_local(positions(gj, bin_chunk, mi))
            us = [p[0] for p in loc]; vs = [p[1] for p in loc]; hs = [p[2] for p in loc]
            mats = mesh_materials(gj, mi)
            ck(mats and mats[0] != 'ht-plaster-white', '%s 悬鱼材质是白抹灰' % nm)
            zt, zbm = max(hs), min(hs)
            ck(abs(zt - (zr - xt)) < 5e-3, '%s 悬鱼顶 %s != ridgeZ-tuck' % (nm, zt))
            ck(abs((zt - zbm) - xl) < 5e-3, '%s 悬鱼垂长 %s != xuanyuLen' % (nm, zt - zbm))
            ck(max(vs) - min(vs) <= xw + 2e-3, '%s 悬鱼宽超设计' % nm)
            ck(abs((max(vs) + min(vs)) / 2 - sh[tag]['vc']) < 5e-3, '%s 悬鱼不在山尖中线' % nm)
            outmost = min(us) if m_out < 0 else max(us)
            ck((outmost - sh[tag]['u']) * m_out > 1e-4, '%s 悬鱼未在山花面外侧' % nm)

    label = ('负例 %s' % neg) if neg else '验收'
    print('gable-product-check[%s]: %d checks, %d fail' % (label, CHECKS[0], len(FAILS)))
    for f in FAILS:
        print('  FAIL', f)
    if neg:
        # 负例必须红在「指定的那条」上，不能靠别的失败凑数
        need = {'1': '悬鱼节点缺失', '2': '山花材质', '3': '未站在山花面外侧'}[neg]
        ok = any(need in f for f in FAILS)
        print('  负例期望失败「%s」：%s' % (need, '出现 ✓' if ok else '未出现 ✗'))
        return 0 if ok else 1
    return 1 if FAILS else 0

if __name__ == '__main__':
    sys.exit(main())
