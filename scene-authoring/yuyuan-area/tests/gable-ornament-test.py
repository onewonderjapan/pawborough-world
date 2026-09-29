#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave14-gable：xieshan_roof 山尖装饰（博风板 3D / 悬鱼 / 山花材质键）单元测试。

纯 Python3 无 Blender：python3 -X utf8 tests/gable-ornament-test.py
判据与负例（每个判据一个「明显错误输入」证明测试能失败）：
  J1 缺省参数（不给 shanhuaMaterial / gableOrnament）输出与基线 a2bc8104 逐字节相同
     —— 负例： ornament 模式下 digest 必然不同（改变输入必须改变输出）。
  J2 ornament 模式：山花材质 = prm['shanhuaMaterial']
     —— 负例： 缺省（'wall'）时断言失败。
  J3 ornament 模式：每端 2 条博风板为闭合盒、站在山花面外侧（前脸距山花平面 = bofengProud），
     板宽 = bofengWidth、底端下探 ≥ bofengDrop、脊端到达 zr
     —— 负例： bofengProud=0（贴回平面）时失败。
  J4 ornament 模式：每端 1 条悬鱼板，顶在 zr−xuanyuTuck、垂长 = xuanyuLen、宽 ≤ xuanyuW、
     位于山尖中线 vc、位于山花面外侧
     —— 负例： xuanyuLen=0.06（远小于设计下限）时失败。
  J5 所有装饰件每面法线朝体外（闭合盒自洽，凸包质心判据）
     —— 负例： 翻转全部面绕序后同一判据必须失败。
  J6 冻结尺寸/比例约束（tests/gable-constraints.py，独立常量唯一来源）应用到 records.json
     designValues 的**真实传入参数**（博风宽/山花跨度、博风宽/山尖高、悬鱼长/山尖高、悬鱼宽/长等）
     —— 负例： 把悬鱼长放大到山尖高 1.2 倍（模拟生成器参数与 records 同步越界）时失败。
  J7 悬鱼挂在博风板前方（R1 必修1：R0 悬鱼在博风后被盖 100%/88%）：悬鱼背面沿山花法向
     出平面距离 ≥ 博风前脸出平面距离
     —— 负例： 把悬鱼顶点退回 R0 位置（山花面外 0.008）时失败。
基线金值 fd0ade7c… 由 a2bc8104 的 eave_kit.py 在本测试同一批参数下捕获（独立 oracle，非被测代码输出）。
"""
import hashlib
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gable_constraints as FC                                  # noqa: E402  冻结约束唯一来源
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'modules', 'shared'))
import eave_kit as EK                                          # noqa: E402

BASELINE_DIGEST = 'fd0ade7c2f234d569bfdb21d9b063a20ef792399dd2c746c75bbc65587c57102'

FAILS = []
CHECKS = [0]

def ck(cond, msg):
    CHECKS[0] += 1
    if not cond:
        FAILS.append(msg)

def capture(fn):
    out = []
    EK.init(lambda n, it, f, m, part: out.append(dict(name=n, verts=[tuple(p) for p, _ in it],
                                                      faces=[tuple(x) for x in f], material=m, part=part,
                                                      items=[(tuple(p), tuple(uv)) for p, uv in it])))
    fn()
    return out

def digest(meshes):
    h = hashlib.sha256()
    for m in meshes:
        h.update(repr((m['name'], m['items'], m['faces'], m['material'], m['part'])).encode('utf-8'))
    return h.hexdigest()

PRM = dict(over=1.1, chu=0.3, qiao=0.8, reach=2.0, drop=0.3, tileH=0.12, boardH=0.2, soffitRise=0.15)
RECT = (0, 12, 0, 8)                                           # u0,u1,v0,v1
BREAKZ, RIDGEZ, INSET, SHOU = 6.0, 8.0, 2.0, 1.0
ORB = dict(bofengWidth=0.40, bofengProud=0.06, bofengDrop=0.12,
           xuanyuLen=0.60, xuanyuW=0.24, xuanyuProud=0.035, xuanyuTuck=0.04)

def trinormal(p0, p1, p2):
    ax, ay, az = p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]
    bx, by, bz = p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]
    return (ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx)

def face_normal(mesh, face):
    idx = list(face)
    return trinormal(mesh['verts'][idx[0]], mesh['verts'][idx[1]], mesh['verts'][idx[2]])

def face_tris(mesh):
    for f in mesh['faces']:
        for k in range(1, len(f) - 2):
            yield (f[0], f[k + 1], f[k + 2])

def centroid(mesh):
    vs = mesh['verts']
    return tuple(sum(v[i] for v in vs) / len(vs) for i in range(3))

# ---------------------------------------------------------------- 判据实现 ----
def check_box_normals(meshes, label=''):
    """J5：闭合装饰件（博风/悬鱼）每面法线朝体外（凸包质心判据）。"""
    bad = []
    for m in meshes:
        if '-bofeng3d-' not in m['name'] and '-xuanyu-' not in m['name']:
            continue
        c = centroid(m)
        for f in m['faces']:
            p0, p1, p2 = [m['verts'][i] for i in f[:3]]
            n = trinormal(p0, p1, p2)
            fc = tuple(sum(m['verts'][i][a] for i in f) / len(f) for a in range(3))
            if sum(n[a] * (fc[a] - c[a]) for a in range(3)) <= 0:
                bad.append('%s %s 有面法线朝内' % (label, m['name'])); break
    return bad

def check_ornament(meshes, prm, tag_prefix='xs', label=''):
    """J2–J5：对 ornament 模式输出逐项断言，返回失败清单（供负例模式复用）。"""
    bad = []
    u0, u1, v0, v1 = (RECT[0] + INSET, RECT[1] - INSET, RECT[2] + INSET, RECT[3] - INSET)
    bv0, bv1, vc = v0, v1, (v0 + v1) / 2
    smt = prm.get('shanhuaMaterial', 'wall')
    sh = {m['name']: m for m in meshes if '-shanhua-' in m['name']}
    for tag, ug, m_out in (('w', u0 + SHOU, -1.0), ('e', u1 - SHOU, 1.0)):
        k = tag_prefix + '-shanhua-' + tag
        if k not in sh:
            bad.append('%s shanhua %s 缺失' % (label, k)); continue
        if sh[k]['material'] != smt:
            bad.append('%s 山花材质 %s != %s' % (label, sh[k]['material'], smt))
        if sh[k]['material'] == 'wall':
            bad.append('%s 山花是白抹灰（ornament 模式不允许）' % label)
        # 博风板：每端 a/b 两条
        for side in ('s', 'n'):
            nm = '%s-bofeng3d-%s%s' % (tag_prefix, tag, side)
            bm = [m for m in meshes if m['name'] == nm]
            if len(bm) != 1:
                bad.append('%s 博风板 %s 不存在或重复' % (label, nm)); continue
            b = bm[0]
            us = sorted(set(v[0] for v in b['verts']))
            if len(us) != 2 or abs((us[1] - us[0]) - ORB['bofengProud']) > 1e-6:
                bad.append('%s 博风板 %s 出平面厚度 %s != bofengProud' % (label, nm, us))
            if len(us) == 2:
                front_u = us[1] if m_out > 0 else us[0]
                if (front_u - ug) * m_out <= 1e-9:
                    bad.append('%s 博风板 %s 未站在山花面外侧 (front_u=%s ug=%s)' % (label, nm, front_u, ug))
            vv = bv0 if side == 's' else bv1
            zb_min = min(v[2] for v in b['verts'])
            if zb_min > BREAKZ - ORB['bofengDrop'] + 1e-6:
                bad.append('%s 博风板 %s 底端未下探 (min z=%s)' % (label, nm, zb_min))
            if max(v[2] for v in b['verts']) < RIDGEZ - 1e-6:
                bad.append('%s 博风板 %s 脊端未到 zr' % (label, nm))
            # 板宽 = 截面四边形的最短边（两条宽边 = bofengWidth，两条沿斜边）
            fp = [b['verts'][i] for i in b['faces'][0]]
            lens = [math.hypot(fp[(k + 1) % len(fp)][1] - fp[k][1], fp[(k + 1) % len(fp)][2] - fp[k][2])
                    for k in range(len(fp))]
            if abs(min(lens) - ORB['bofengWidth']) > 1e-6:
                bad.append('%s 博风板 %s 板宽 %s != bofengWidth' % (label, nm, min(lens)))
        # 悬鱼
        nm = '%s-xuanyu-%s' % (tag_prefix, tag)
        xm = [m for m in meshes if m['name'] == nm]
        if len(xm) != 1:
            bad.append('%s 悬鱼 %s 不存在或重复' % (label, nm)); continue
        x = xm[0]
        zt, zb_ = max(v[2] for v in x['verts']), min(v[2] for v in x['verts'])
        if abs(zt - (RIDGEZ - ORB['xuanyuTuck'])) > 1e-6:
            bad.append('%s 悬鱼顶 %s != zr-tuck' % (label, zt))
        if abs((zt - zb_) - ORB['xuanyuLen']) > 1e-6:
            bad.append('%s 悬鱼垂长 %s != xuanyuLen' % (label, zt - zb_))
        vs = [v[1] for v in x['verts']]
        if max(vs) - min(vs) > ORB['xuanyuW'] + 1e-6:
            bad.append('%s 悬鱼宽 %s > xuanyuW' % (label, max(vs) - min(vs)))
        if abs((max(vs) + min(vs)) / 2 - vc) > 1e-6:
            bad.append('%s 悬鱼未在山尖中线' % label)
        us = sorted(set(v[0] for v in x['verts']))
        if (us[0] - ug) * m_out <= 1e-9:
            bad.append('%s 悬鱼未在山花面外侧' % label)
        if x['material'] == 'wall':
            bad.append('%s 悬鱼材质是白抹灰' % label)
    # J5 闭合盒面法线
    bad.extend(check_box_normals(meshes, label))
    return bad

def expect_fail(bad, why):
    ck(bool(bad), '负例未失败：%s' % why)

def main():
    # ---- J1 缺省 = 基线逐字节 ----
    base = capture(lambda: (EK.xieshan_roof('xs', RECT, 5.0, dict(PRM, breakZ=BREAKZ, ridgeZ=RIDGEZ,
                                                                  breakInset=INSET, gableInset=SHOU), 'p'),
                            EK.xieshan_roof('xs-small', (-2, 2, -1.6, 1.6), 3.5,
                                            dict(PRM, breakZ=4.2, ridgeZ=5.2, breakInset=0.8, gableInset=0.4,
                                                 ornamentScale='auto'), 'p')))
    ck(digest(base) == BASELINE_DIGEST, 'J1 缺省输出偏离基线金值')

    # ---- J2–J5 ornament 模式（huxinting 设计值口径）----
    prm = dict(PRM, breakZ=BREAKZ, ridgeZ=RIDGEZ, breakInset=INSET, gableInset=SHOU,
               shanhuaMaterial='wood', gableOrnament=dict(ORB))
    orn = capture(lambda: EK.xieshan_roof('xs', RECT, 5.0, prm, 'p'))
    for msg in check_ornament(orn, prm):
        FAILS.append(msg); CHECKS[0] += 1
    ck(len([m for m in orn if '-xuanyu-' in m['name']]) == 2, '悬鱼应恰 2 件（w/e 各一）')
    ck(len([m for m in orn if '-bofeng3d-' in m['name']]) == 4, '博风板应恰 4 件（2 端 × 2 边）')
    # J1 负例：同一调用带 ornament，digest 必须变
    ck(digest(orn) != BASELINE_DIGEST, 'J1 负例失效：ornament 输出与缺省相同')

    # ---- 负例组（每个判据配一个明显错误输入）----
    old = capture(lambda: EK.xieshan_roof('xs', RECT, 5.0, dict(PRM, breakZ=BREAKZ, ridgeZ=RIDGEZ,
                                                                breakInset=INSET, gableInset=SHOU), 'p'))
    expect_fail(check_ornament(old, dict(PRM, breakZ=BREAKZ, ridgeZ=RIDGEZ, breakInset=INSET, gableInset=SHOU)),
                'J2/J3/J4 旧路径（无 ornament、山花 wall、无悬鱼）必须全红')
    prm_bad = dict(PRM, breakZ=BREAKZ, ridgeZ=RIDGEZ, breakInset=INSET, gableInset=SHOU,
                   shanhuaMaterial='wood', gableOrnament=dict(ORB, bofengProud=0.0))
    expect_fail(check_ornament(capture(lambda: EK.xieshan_roof('xs', RECT, 5.0, prm_bad, 'p')), prm_bad),
                'J3 bofengProud=0（贴回山花面）必须红')
    prm_bad2 = dict(PRM, breakZ=BREAKZ, ridgeZ=RIDGEZ, breakInset=INSET, gableInset=SHOU,
                    shanhuaMaterial='wood', gableOrnament=dict(ORB, xuanyuLen=0.06))
    expect_fail(check_ornament(capture(lambda: EK.xieshan_roof('xs', RECT, 5.0, prm_bad2, 'p')), prm_bad2),
                'J4 xuanyuLen=0.06（远小于设计）必须红')
    prm_bad3 = dict(PRM, breakZ=BREAKZ, ridgeZ=RIDGEZ, breakInset=INSET, gableInset=SHOU,
                    gableOrnament=dict(ORB))
    got = capture(lambda: EK.xieshan_roof('xs', RECT, 5.0, prm_bad3, 'p'))
    CHECKS[0] += 1
    if not any(m['material'] == 'wall' for m in got if '-shanhua-' in m['name']):
        FAILS.append('J2 负例失效：缺省材质不是 wall'); CHECKS[0] -= 1
    expect_fail(check_ornament(got, prm_bad3), 'J2 缺省白抹灰山花必须红')
    # J5 负例：整体翻面
    flipped = [dict(name=m['name'], verts=m['verts'], material=m['material'], part=m['part'], items=m['items'],
                    faces=[tuple(reversed(f)) for f in m['faces']])
               for m in orn if '-bofeng3d-' in m['name'] or '-xuanyu-' in m['name']]
    expect_fail(check_box_normals(flipped), 'J5 全部面翻绕序必须红')

    # ---- J6 冻结尺寸/比例约束（gable-constraints.py 唯一来源）vs records.json 实际传入参数 ----
    rec = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..',
                                      'modules', 'huxinting', 'records.json'), encoding='utf-8'))
    frv = rec['frame']['rectHalfV']

    def check_design(go, rise, span):
        bad = []
        for tagc, val in (('bofengWidth/span', go['bofengWidth'] / span),
                          ('bofengWidth/rise', go['bofengWidth'] / rise),
                          ('xuanyuLen/rise', go['xuanyuLen'] / rise),
                          ('xuanyuW/xuanyuLen', go['xuanyuW'] / go['xuanyuLen'])):
            okc, msgc = FC.ratio_ok(tagc, val)
            if not okc:
                bad.append(msgc)
        if not FC.XUANYU_PROUD[0] <= go['xuanyuProud'] <= FC.XUANYU_PROUD[1]:
            bad.append('xuanyuProud %s 出冻结带' % go['xuanyuProud'])
        if not FC.BOFENG_PROUD[0] <= go['bofengProud'] <= FC.BOFENG_PROUD[1]:
            bad.append('bofengProud %s 出冻结带' % go['bofengProud'])
        return bad

    for dkey, rname in (('roof', 'mainroof'), ('porch', 'porchroof')):
        rp = rec['designValues'][dkey]
        go = rp.get('gableOrnament')
        if not go:
            FAILS.append('J6 %s designValues 缺 gableOrnament' % dkey); CHECKS[0] += 1
            continue
        rise = rp['ridgeZ'] - rp['breakZ']
        # 山花跨度（参数层，与生成器同一公式；产物层实测由 gable-product-check G5/G8 钉）
        span = 2 * frv - 2 * rp['breakInset'] if rname == 'mainroof' else rp['depth'] + 0.25 - 2 * rp['breakInset']
        bad = check_design(go, rise, span)
        CHECKS[0] += 1
        if bad:
            FAILS.append('J6 %s 设计值出冻结带: %s' % (dkey, bad))
    # J6 负例：悬鱼长 = 1.2×山尖高（模拟生成器参数与 records 同步越界——判据用冻结带，同步改 records 也拦住）
    go_n = dict(rec['designValues']['porch']['gableOrnament'],
                xuanyuLen=1.2 * (rec['designValues']['porch']['ridgeZ'] - rec['designValues']['porch']['breakZ']))
    rp_p = rec['designValues']['porch']
    rise_p = rp_p['ridgeZ'] - rp_p['breakZ']
    span_p = rp_p['depth'] + 0.25 - 2 * rp_p['breakInset']
    expect_fail(check_design(go_n, rise_p, span_p), 'J6 悬鱼拉长到山尖高 1.2 倍（同步越界）必须红')

    # ---- J7 悬鱼挂博风板前方（R1 必修1：R0 悬鱼在博风后被盖 100%/88%）----
    def xuanyu_back_margin(meshes, tag_prefix='xs'):
        bad = []
        for tag, m_out in (('w', -1.0), ('e', 1.0)):
            bm = [m for m in meshes if m['name'] == '%s-bofeng3d-%ss' % (tag_prefix, tag)]
            xm = [m for m in meshes if m['name'] == '%s-xuanyu-%s' % (tag_prefix, tag)]
            if len(bm) != 1 or len(xm) != 1:
                bad.append('%s 端 J7 构件缺失' % tag); continue
            bfront = max(m_out * v[0] for v in bm[0]['verts'])       # 博风前脸沿山花法向
            xback = min(m_out * v[0] for v in xm[0]['verts'])        # 悬鱼背面沿山花法向
            if xback < bfront - 1e-9:
                bad.append('%s 悬鱼背面(mout %.4f) 在博风前脸(%.4f) 之后——正面会被博风遮挡' % (tag, xback, bfront))
        return bad

    for msg in xuanyu_back_margin(orn):
        FAILS.append(msg); CHECKS[0] += 1

    def shift_xuanyu(meshes, d):
        """把悬鱼沿 u 平移 d（负例：退回 R0 位置）。"""
        out = []
        for m in meshes:
            if '-xuanyu-' in m['name']:
                m_out = -1.0 if m['name'].endswith('w') else 1.0
                out.append(dict(m, verts=[(v[0] + m_out * d, v[1], v[2]) for v in m['verts']],
                                items=[((p[0] + m_out * d, p[1], p[2]), uv) for p, uv in m['items']]))
            else:
                out.append(m)
        return out

    expect_fail(xuanyu_back_margin(shift_xuanyu(orn, -(ORB['bofengProud'] - 0.004))),
                'J7 悬鱼退回 R0 位置（博风后方）必须红')

    print('gable-ornament-test: %d checks, %d fail' % (CHECKS[0], len(FAILS)))
    for f in FAILS:
        print('  FAIL', f)
    return 1 if FAILS else 0

if __name__ == '__main__':
    sys.exit(main())
