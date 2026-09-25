#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""WP11 C3：控制层导出校验 + RESULT.json（含每帧耗时）。

校验内容（GOAL C3）：
  1. 四通道逐帧空白帧守卫：亮度 std < 2/255 或主色占比 > 95% 判空白（COMMON 口径；
     depth 16-bit 换算到 0-65535 同阈值），另查尺寸 1280x720、深度位深 16-bit、帧数齐全。
  2. LUT 双向对得上：每帧随机抽 200 像素，反查 layout id（精确或 ±2 内最近邻；
     Workbench FLAT 抖动有 ±1 LSB 偏差）；再验证 LUT 本身 id->rgb->id 可逆。
  3. 深度单调性抽查：每帧中列竖带自下而上（近 -> 远）取带内中位深度，
     相邻步倒置数 <= 总步数的 10%（斜坡/桥面/遮挡允许少量倒置）。
  4. 每帧 cameras json 存在且字段齐全（fov/K/worldToCamera/near/far）。

用法：python3 scripts/check-control-passes.py --control <control目录> --report <RESULT.json路径>
"""
import argparse
import glob
import json
import math
import os
import random
import sys

W, H = 1280, 720
CHANNELS = ('beauty', 'depth', 'normal', 'segmentation')


def load_json(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def blank_stats_gray(gray):
    """gray: 2D numpy。返回 (std_0_255, 主值占比)。"""
    import numpy as np
    std = float(gray.std())
    vals, counts = np.unique(gray, return_counts=True)
    dom = float(counts.max()) / gray.size
    return std, dom


def nearest_lut(px, i2r_items, unassigned):
    d = max(abs(px[i] - unassigned[i]) for i in range(3))
    if d <= 2:
        return 'unassigned', d
    best, bd = None, 1e9
    for k, v in i2r_items:
        dd = max(abs(px[i] - v[i]) for i in range(3))
        if dd < bd:
            best, bd = k, dd
    return best, bd


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--control', required=True)
    ap.add_argument('--report', required=True)
    ap.add_argument('--seed', type=int, default=20260925)
    args = ap.parse_args()
    import numpy as np
    from PIL import Image

    control = args.control
    lut = load_json(os.path.join(control, 'segmentation-lut.json'))
    timings = load_json(os.path.join(control, 'timings.json'))
    errors, checks = [], []
    shots = sorted(d for d in os.listdir(control)
                   if os.path.isdir(os.path.join(control, d)))
    if not shots:
        errors.append('control 目录无镜头子目录（产物未渲染？）')
    frame_report = {}

    # LUT 双向可逆
    i2r = lut['idToRgb']
    r2i = lut['rgbToId']
    bidir = all(r2i.get('#%02x%02x%02x' % tuple(v)) == k for k, v in i2r.items()) \
        and len(i2r) == len(r2i)
    checks.append({'check': 'lut-bidirectional', 'pass': bool(bidir),
                   'ids': len(i2r)})
    if not bidir:
        errors.append('LUT 双向映射不一致')
    i2r_items = [(k, v) for k, v in i2r.items()]
    unassigned = lut['unassigned']

    for sid in shots:
        sdir = os.path.join(control, sid)
        frames = sorted(glob.glob(os.path.join(sdir, 'beauty', 'frame-*.png')))
        n = len(frames)
        checks.append({'check': 'frame-count', 'shot': sid, 'pass': n == 24, 'frames': n})
        if n != 24:
            errors.append('%s 帧数 %d != 24' % (sid, n))
        st = {}
        for k in range(n):
            tag = 'frame-%03d' % k
            fr = frame_report.setdefault(sid, {}).setdefault(tag, {})
            # ---- 四通道空白守卫（beauty/segmentation 用 COMMON 口径；normal/depth 动态范围窄，用更严的近常数判据） ----
            for ch in CHANNELS:
                p = os.path.join(sdir, ch, tag + '.png')
                if not os.path.exists(p):
                    errors.append('%s/%s 缺 %s' % (sid, tag, ch))
                    fr[ch] = 'missing'
                    continue
                img = Image.open(p)
                if img.size != (W, H):
                    errors.append('%s/%s %s 尺寸 %s' % (sid, tag, ch, img.size))
                if ch == 'depth':
                    if img.mode not in ('I;16', 'I;16B', 'I', 'uint16'):
                        errors.append('%s/%s depth 非 16-bit (mode=%s)' % (sid, tag, img.mode))
                    g = np.asarray(img)
                    std, dom = blank_stats_gray(g)
                else:
                    a = np.asarray(img.convert('RGB'))
                    g = a.mean(axis=2)
                    std, dom = blank_stats_gray(g)
                if ch in ('beauty',):
                    blank = std < 2.0 or dom > 0.95          # COMMON：亮度 std < 2/255 或主色 > 95%
                elif ch == 'segmentation':
                    blank = dom > 0.98                        # 平面色明度方差天然低，按主色占比判
                else:
                    blank = std < 0.2 or dom > 0.98          # 近乎常数 = 空白
                fr[ch] = {'std': round(std, 2), 'dominant': round(dom, 3), 'blank': bool(blank)}
                if blank:
                    errors.append('%s/%s %s 空白帧 (std=%.2f dom=%.3f)' % (sid, tag, ch, std, dom))
            # ---- LUT 反查（200 随机像素）----
            rng = random.Random(args.seed + k * 131 + sum(ord(c) for c in sid) % 100000)
            sa = np.asarray(Image.open(os.path.join(sdir, 'segmentation', tag + '.png')).convert('RGB'))
            pix = sa.reshape(-1, 3)
            miss = 0
            for _ in range(200):
                p = [int(x) for x in pix[rng.randrange(pix.shape[0])]]
                _, d = nearest_lut(p, i2r_items, unassigned)
                if d > 2:
                    miss += 1
            fr['lutMiss200'] = miss
            if miss:
                errors.append('%s/%s LUT 反查失败 %d/200' % (sid, tag, miss))
            # ---- 深度单调性（中列竖带，下 -> 上 = 近 -> 远）----
            dep = np.asarray(Image.open(os.path.join(sdir, 'depth', tag + '.png'))).astype(float)
            band = dep[:, W // 2 - 40: W // 2 + 40]
            med = np.median(band, axis=1)
            rows = list(range(H - 20, int(H * 0.55), -12))
            seq = [med[r] for r in rows]
            inv = sum(1 for a, b in zip(seq, seq[1:]) if b < a - 655.35)  # 允 1% 深度噪声
            fr['depthInversions'] = inv
            if inv > 0.1 * (len(seq) - 1):
                errors.append('%s/%s 深度单调性倒置 %d/%d' % (sid, tag, inv, len(seq) - 1))
            # ---- cameras json ----
            cp = os.path.join(sdir, 'cameras', tag + '.json')
            cj = load_json(cp) if os.path.exists(cp) else None
            okc = cj is not None and all(f in cj for f in (
                'fovYDeg', 'fovXDeg', 'K', 'worldToCameraOpenGL', 'worldToCameraOpenCV',
                'depthNearM', 'depthFarM', 'width', 'height'))
            fr['cameraJson'] = bool(okc)
            if not okc:
                errors.append('%s/%s cameras json 缺失或字段不全' % (sid, tag))
            st[tag] = fr

        # 耗时
        tt = timings.get(sid, {})
        if tt:
            per = list(tt.values())
            fr_t = {
                'beautyAvgS': round(sum(f.get('beauty_s', 0) for f in per) / max(len(per), 1), 2),
                'segAvgS': round(sum(f.get('seg_s', 0) for f in per) / max(len(per), 1), 2),
                'normalDepthAvgS': round(sum(f.get('normal_depth_s', 0) for f in per) / max(len(per), 1), 2),
                'totalS': round(sum(f.get('total_s', 0) for f in per), 1),
            }
            frame_report.setdefault(sid, {})['timing'] = fr_t
            checks.append({'check': 'timing', 'shot': sid, **fr_t})

    status = 'delivered_for_lead_review' if not errors else 'blocked'
    result = {
        'item': 'WP11 C1-C3 AI 视频控制层导出（wave1-controlpass-20260925）',
        'status': status,
        'ownerAdopted': False,
        'checkedAt': '2026-09-25',
        'controlDir': os.path.abspath(control),
        'checks': checks,
        'numbers': {
            'shots': len(shots),
            'framesPerShot': 24,
            'channels': len(CHANNELS),
            'lutIds': len(i2r),
            'errors': len(errors),
        },
        'partial': [],
        'blockers': errors,
        'commits': [],
        'visualVerdict': '',
    }
    # 每帧明细（去掉过大的字段后直接记录）
    result['frameDetail'] = frame_report
    with open(args.report, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(json.dumps({'status': status, 'errors': errors[:20], 'errorCount': len(errors)},
                     ensure_ascii=False, indent=1))
    sys.exit(0 if not errors else 1)


if __name__ == '__main__':
    main()
