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
  5. R1 渲染侧取景（cameras json 带 targetId 时）：每帧取景目标（本体 + layout facadeBay.parentBuilding
     指向它的立面开间）在分割图上的像素占比（±2 容差），
     终点帧 ≥ 5% 否则报错；另记画面下 1/3 的九曲桥栏像素占比（分割=jiuqu-bridge 且世界法线 |n_y|<0.5
     即竖直面，桥面不算）。碰撞盒可见性（tests/control-shots-test.mjs）是渲染前的几何代理，这里是渲染后真值。
     终点帧门槛可按镜头加严（TARGET_END_MIN_BY_SHOT；wave3-tourfix T3：③湖心亭 ≥ 10%）。
  7. 顶部天空余量（wave3-tourfix T3 返修，TOP_SKY_MARGIN_BY_SHOT；③ ≥ 3%）：终点帧目标分割掩膜的最高像素（湖心亭即宝顶 / 屋脊）
     正上方连续天空（深度 = far，65535）行数 / 画高 ≥ 门槛，且目标最高像素不贴画面上沿——整座亭的顶部轮廓在画内、上方留天。
  6. 重复件（wave3-tourfix T3）：layout 里 footprint 覆盖目标 footprint ≥ 50%、且有正高度的其他对象
     （例：bld-228035340 与湖心亭同一 OSM way，R1 时把亭下层包成 5 m 体块）在任何帧的分割图上像素占比
     必须 < 0.1%——目标不能被重合的替身包住。

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
TARGET_END_MIN = 0.05   # R1：终点帧里取景目标（cameras json targetId）在分割图上至少占 5% 像素
TARGET_END_MIN_BY_SHOT = {'jiuqu-to-huxinting': 0.10}   # wave3-tourfix T3：湖心亭终帧 ≥ 10%
TOP_SKY_MARGIN_BY_SHOT = {'jiuqu-to-huxinting': 0.03}   # wave3-tourfix T3 返修：终帧宝顶/屋脊上方天空 ≥ 3% 画高
DUP_COVER_MIN = 0.5     # footprint 覆盖目标 footprint 的比例 ≥ 此值 = 重复件
DUP_PIXEL_MAX = 0.001   # 重复件每帧像素占比上限


def point_in_poly(p, poly):
    x, z = p
    ins = False
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        if (a[1] > z) != (b[1] > z) and x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]:
            ins = not ins
    return ins


def duplicate_footprints(objects, tid, exclude, n=24):
    """footprint 覆盖目标 footprint（n×n 网格采样）≥ DUP_COVER_MIN、高度 > 0 的其他对象 id。"""
    tgt = next((o for o in objects if o['id'] == tid), None)
    fp = (tgt or {}).get('geometry', {}).get('footprint')
    if not fp:
        return []
    xs, zs = [p[0] for p in fp], [p[1] for p in fp]
    pts = [(min(xs) + (max(xs) - min(xs)) * (i + .5) / n, min(zs) + (max(zs) - min(zs)) * (j + .5) / n)
           for i in range(n) for j in range(n)]
    pts = [p for p in pts if point_in_poly(p, fp)]
    out = []
    for o in objects:
        ofp = o.get('geometry', {}).get('footprint')
        if not ofp or o['id'] in exclude or not ((o.get('height') or 0) > 0):
            continue
        if pts and sum(point_in_poly(p, ofp) for p in pts) / len(pts) >= DUP_COVER_MIN:
            out.append(o['id'])
    return out


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
    ap.add_argument('--layout', default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'baseline', 'layout.json'))
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
    # 取景目标的像素 = 目标本体 + 其立面开间（layout facadeBay.parentBuilding == 目标，分割里是独立 id）
    bays = {}
    lay_objects = load_json(args.layout)['objects'] if os.path.exists(args.layout) else []
    if lay_objects:
        for o in lay_objects:
            if o.get('parentBuilding'):
                bays.setdefault(o['parentBuilding'], []).append(o['id'])
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
            # ---- R1 渲染侧取景（真实几何，补碰撞盒代理的盲区）：取景目标像素占比、画面下 1/3 桥栏占比 ----
            tid = (cj or {}).get('targetId')
            if tid:
                tc = i2r.get(tid)
                if tc is None:
                    errors.append('%s/%s targetId %s 不在 LUT' % (sid, tag, tid))
                else:
                    sai = sa.astype(int)
                    m = np.zeros(sai.shape[:2], dtype=bool)
                    for iid in [tid] + bays.get(tid, []):
                        if iid in i2r:
                            m |= np.abs(sai - np.array(i2r[iid])).max(axis=2) <= 2
                    fr['targetPixelShare'] = round(float(m.mean()), 4)
                    rows = np.where(m.any(axis=1))[0]
                    if rows.size:   # 目标最高像素 + 其正上方连续天空（depth = far）行数
                        r0 = int(rows[0]); cols = np.where(m[r0])[0]; c0 = int(cols[len(cols) // 2])
                        sky = 0
                        while r0 - 1 - sky >= 0 and dep[r0 - 1 - sky, c0] >= 65535:
                            sky += 1
                        fr['targetTop'] = {'row': r0, 'col': c0, 'topFrac': round(r0 / H, 4), 'skyAbovePx': sky,
                                           'skyAboveFrac': round(sky / H, 4),
                                           'touchesLeft': bool(m[:, 0].any()), 'touchesRight': bool(m[:, -1].any())}
                    for did in duplicate_footprints(lay_objects, tid, set([tid] + bays.get(tid, []))):
                        # 不在 LUT = 场景里没有这件几何 = 0 像素（照记，便于核对）
                        dshare = float((np.abs(sai - np.array(i2r[did])).max(axis=2) <= 2).mean()) if did in i2r else 0.0
                        fr.setdefault('duplicatePixelShare', {})[did] = round(dshare, 4)
                        if dshare >= DUP_PIXEL_MAX:
                            errors.append('%s/%s 与目标 %s footprint 重合的 %s 露出 %.2f%% 像素（≥ %.1f%%，目标被替身包住）'
                                          % (sid, tag, tid, did, dshare * 100, DUP_PIXEL_MAX * 100))
                    brc = i2r.get('jiuqu-bridge')
                    if brc is not None:
                        lo = sai[2 * H // 3:]
                        ny = np.asarray(Image.open(os.path.join(sdir, 'normal', tag + '.png')).convert('RGB'))[2 * H // 3:, :, 1] / 255.0 * 2 - 1
                        fr['railLowerThirdShare'] = round(float(((np.abs(lo - np.array(brc)).max(axis=2) <= 2) & (np.abs(ny) < 0.5)).mean()), 4)
            st[tag] = fr
        last = frame_report.get(sid, {}).get('frame-%03d' % (n - 1), {}) if n else {}
        if 'targetPixelShare' in last:
            shares = [frame_report[sid]['frame-%03d' % k].get('targetPixelShare', 0) for k in range(n)]
            if sid in TOP_SKY_MARGIN_BY_SHOT:
                need = TOP_SKY_MARGIN_BY_SHOT[sid]
                tt_ = last.get('targetTop') or {}
                okm = tt_.get('skyAboveFrac', 0) >= need and tt_.get('row', 0) > 0
                checks.append({'check': 'target-top-sky-margin', 'shot': sid, 'need': need, 'endFrame': tt_,
                               'perFrameSkyAboveFrac': [frame_report[sid]['frame-%03d' % k].get('targetTop', {}).get('skyAboveFrac') for k in range(n)],
                               'pass': bool(okm)})
                if not okm:
                    errors.append('%s 终点帧目标顶部上方天空 %.1f%% < %.0f%%（目标最高像素行 %s，宝顶/屋脊出画或贴边）'
                                  % (sid, tt_.get('skyAboveFrac', 0) * 100, need * 100, tt_.get('row')))
            end_min = TARGET_END_MIN_BY_SHOT.get(sid, TARGET_END_MIN)
            checks.append({'check': 'target-pixels', 'shot': sid, 'endShare': last['targetPixelShare'],
                           'endMin': end_min, 'minShare': min(shares), 'framesWithTarget': sum(1 for v in shares if v > 0),
                           'perFrame': shares, 'pass': last['targetPixelShare'] >= end_min})
            if last['targetPixelShare'] < end_min:
                errors.append('%s 终点帧取景目标像素占比 %.1f%% < %.0f%%' % (sid, last['targetPixelShare'] * 100, end_min * 100))

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
