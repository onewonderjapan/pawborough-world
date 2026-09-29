#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave14-pvquality Q20：segmentation 通道纯度统计——非 LUT 颜色像素必须为 0。

判据（GOAL Q20 验收）：seg 帧的每个像素都必须逐字节等于 segmentation-lut.json 里的
某个 idToRgb 颜色或 unassigned 固定色。Blender 输出抖动（dither_intensity 默认 1.0）
会让全部 LUT 色带 ±1 变体（wave13-nightqa 取证：pv13 单帧半行抽样 87888 个非 LUT
像素、101 种颜色全部是 ±1 变体）；渲染器 seg 分支写 dither_intensity=0 后应为 0。

统计与校验分离：
  count_off_lut_pixels(img, legal, unassigned)   纯函数（tests/pv-quality-control-test.py
                                                 的 T3 直接测它「能失败」）
  CLI：--control <控制通道目录> --lut <segmentation-lut.json> [--shot id] [--frames 0,59,...]
    校验模式（默认）：任一帧非 0 → EXIT 1 并列出前若干处坐标。
    --report 模式：只打印逐帧计数（验收取证用），EXIT 0。

用法：
  python3 -X utf8 scripts/check-seg-purity.py --control <out-root>/control-24fps-day \
      --lut <out-root>/control-24fps-day/segmentation-lut.json --shot pv13-corridor-walk
"""
import argparse
import json
import os
import sys


def count_off_lut_pixels(img, legal, unassigned):
    """统计 img（PIL RGB Image）中不等于任何合法 LUT 色 / unassigned 色的像素数。"""
    px = img.load()
    w, h = img.size
    n = 0
    for y in range(h):
        for x in range(w):
            c = px[x, y]
            if c != unassigned and c not in legal:
                n += 1
    return n


def off_lut_samples(img, legal, unassigned, limit=8):
    """返回前 limit 个非 LUT 像素的 (x, y, 颜色)（报错定位用）。"""
    px = img.load()
    w, h = img.size
    out = []
    for y in range(h):
        for x in range(w):
            c = px[x, y]
            if c != unassigned and c not in legal:
                out.append((x, y, c))
                if len(out) >= limit:
                    return out
    return out


def main():
    ap = argparse.ArgumentParser(description='segmentation 通道非 LUT 像素统计（Q20 验收）')
    ap.add_argument('--control', required=True, help='渲染输出根目录（其下 <shot>/segmentation/frame-###.png）')
    ap.add_argument('--lut', required=True, help='segmentation-lut.json 路径')
    ap.add_argument('--shot', default='', help='只查该镜头（缺省 = 目录下全部含 segmentation 子目录的镜头）')
    ap.add_argument('--frames', default='', help='逗号分隔帧号（缺省 = 全部已有帧）')
    ap.add_argument('--report', action='store_true', help='只打印逐帧计数（EXIT 0），不校验')
    a = ap.parse_args()

    lut = json.load(open(a.lut, encoding='utf-8'))
    legal = set(tuple(v) for v in lut['idToRgb'].values())
    ua = tuple(lut['unassigned'])

    if a.shot:
        shots = [a.shot]
    else:
        shots = sorted(d for d in os.listdir(a.control)
                       if os.path.isdir(os.path.join(a.control, d, 'segmentation')))
    if not shots:
        raise SystemExit('E: %s 下没有镜头的 segmentation 目录' % a.control)

    want_frames = None
    if a.frames:
        want_frames = {'frame-%03d.png' % int(t) for t in a.frames.split(',') if t.strip() != ''}

    from PIL import Image
    total_bad = 0
    checked = 0
    for sid in shots:
        sdir = os.path.join(a.control, sid, 'segmentation')
        names = sorted(f for f in os.listdir(sdir) if f.endswith('.png'))
        if want_frames is not None:
            missing = want_frames - set(names)
            if missing:
                raise SystemExit('E: %s 缺帧 %s（不许静默跳过）' % (sdir, sorted(missing)))
            names = [f for f in names if f in want_frames]
        if not names:
            raise SystemExit('E: %s 没有可统计的帧（查到 0 帧要失败，不许当通过）' % sdir)
        for f in names:
            im = Image.open(os.path.join(sdir, f)).convert('RGB')
            n = count_off_lut_pixels(im, legal, ua)
            checked += 1
            total_bad += n
            mark = '' if n == 0 else '  <-- 非 LUT 像素 %d' % n
            print('%s/%s: %d%s' % (sid, f, n, mark))
            if n and not a.report:
                for x, y, c in off_lut_samples(im, legal, ua):
                    print('    first: (%d,%d)=%s' % (x, y, c))
                break
    print('check-seg-purity: %d frames, off-lut pixels total %d' % (checked, total_bad))
    if a.report:
        return 0
    if total_bad:
        raise SystemExit('E: segmentation 通道存在 %d 个非 LUT 颜色像素（必须为 0）' % total_bad)
    return 0


if __name__ == '__main__':
    sys.exit(main())
