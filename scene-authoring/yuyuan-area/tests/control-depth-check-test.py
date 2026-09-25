#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave5-shots2：check-control-passes 深度单调性判据（只计同一分割物体内的倒置）的负对照测试。

合成用例（不依赖渲染产物，npm test 里跑）：
  1) 遮挡边界：平地透视（自下而上由近到远），远地面上方叠一栋 12 m 的楼（另一分割色）→ 有倒置但跨物体 → 通过；
  2) 同物体翻转：取样带（画面下 45%）内深度上下翻转、分割不变 → 同一物体内倒置（4 次）→ 必须报错；
  3) 门槛边界：同一物体内恰好 2 次倒置（⑧大殿重檐实测最大值）→ 通过；3 次 → 报错。
真实帧用例（可选，--control <control目录> --shot <id> [--frame N]）：取真实渲染的一帧，原样应通过，
  把取样带（画面下 45%）内的深度上下翻转后应报错（分割不变，所以翻转造成的倒置落在同一物体内）。
  需要取样带里有伸向远处的地面 / 水面的帧（街景、池面）；近景整面墙的帧翻转后深度几乎不变，不适合作负对照。

用法：python3 tests/control-depth-check-test.py [--control DIR --shot ID --frame N]
"""
import argparse
import importlib.util
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('ccp', os.path.join(ROOT, 'scripts', 'check-control-passes.py'))
ccp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ccp)
W, H, LIM = ccp.W, ccp.H, ccp.DEPTH_SAME_OBJ_INV_MAX

fails = passes = 0


def check(ok, msg):
    global fails, passes
    if ok:
        passes += 1
    else:
        fails += 1
        print('FAIL:', msg)


def verdict(dep, seg):
    a, s, n = ccp.depth_inversions(dep, seg)
    return a, s, n, s > LIM


GROUND, BLD = (10, 200, 30), (200, 40, 90)
rows = np.arange(H)
# 平地透视：眼高 1.6 m、焦距 853 px（24 mm）、地平线在第 380 行：z = 1.6·853 / (row − 380)，地平线以上 = far
enc = lambda m: np.clip(np.round(65535 * (m - 0.3) / (300 - 0.3)), 0, 65535)
ground_m = np.where(rows > 380, 1.6 * 853 / np.maximum(rows - 380, 1e-6), 300.0)
dep = np.repeat(enc(ground_m)[:, None], W, axis=1).astype(float)
BAND = int(H * 0.55) - 12                                # 取样带（第 384 行起到画底）
seg = np.zeros((H, W, 3), int)
seg[:] = GROUND

# 1) 遮挡边界：行 384–408 是一栋 12 m 远的楼，它下方（第 412 行）的地面已在 42 m —— 往上走突然变近，但跨物体
d1, s1 = dep.copy(), seg.copy()
d1[384:409] = enc(12.0)
s1[384:409] = BLD
a, s, n, bad = verdict(d1, s1)
check(a >= 1 and s == 0 and not bad, '遮挡边界：全部倒置 %d、同物体 %d（应 ≥1 / 0 且通过）' % (a, s))

# 2) 同物体翻转：取样带内深度上下翻转（远处落到画底，分割不变）
d2 = dep.copy()
d2[BAND:] = dep[BAND:][::-1]
a2, s2, n2, bad2 = verdict(d2, seg)
check(bad2 and s2 > LIM, '同物体翻转：同物体倒置 %d（应 > %d 且报错）' % (s2, LIM))

# 3) 门槛边界：同一物体内恰好 k 次 3 m 以上的变近
def k_steps(k):
    d = dep.copy()
    for i in range(k):
        r0 = H - 20 - 12 * (3 + 4 * i)       # 取样行上的台阶
        d[r0 - 11: r0 + 1] = d[r0 + 12] - 4 * ccp.DEPTH_INV_STEP
    return d
for k in (LIM, LIM + 1):
    a, s, n, bad = verdict(k_steps(k), seg)
    check(s == k and bad == (k > LIM), '门槛：同物体倒置 %d（构造 %d）→ %s' % (s, k, '报错' if bad else '通过'))

# 真实帧（可选）
ap = argparse.ArgumentParser()
ap.add_argument('--control', default='')
ap.add_argument('--shot', default='')
ap.add_argument('--frame', type=int, default=10)
args = ap.parse_args()
if args.control:
    from PIL import Image
    tag = 'frame-%03d.png' % args.frame
    rd = np.asarray(Image.open(os.path.join(args.control, args.shot, 'depth', tag))).astype(float)
    band = int(H * 0.55) - 12
    rs = np.asarray(Image.open(os.path.join(args.control, args.shot, 'segmentation', tag)).convert('RGB')).astype(int)
    a, s, n, bad = verdict(rd, rs)
    print('real %s/%s: all %d, same-object %d / %d steps -> %s' % (args.shot, tag, a, s, n, 'ERROR' if bad else 'ok'))
    check(not bad, '真实帧原样应通过')
    rf = rd.copy()
    rf[band:] = rd[band:][::-1]          # 取样带内深度上下翻转，分割不变 = 同一物体内的深度倒置
    a, s, n, bad = verdict(rf, rs)
    print('real %s/%s depth flipped: all %d, same-object %d / %d steps -> %s' % (args.shot, tag, a, s, n, 'ERROR' if bad else 'ok'))
    check(bad, '真实帧深度翻转后应报错')

print('control-depth-check-test: %d pass, %d fail (DEPTH_SAME_OBJ_INV_MAX=%d)' % (passes, fails, LIM))
sys.exit(1 if fails else 0)
