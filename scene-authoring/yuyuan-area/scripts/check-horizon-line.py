#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave14-pvquality R1必修1：末帧地平线亮线回归检查。

口径（审查原文）：pv01-aerial-reveal 末帧 y=62、**x=600–949 段**的水平亮线。本检查对每帧取
该段逐行 RGB 中位数，检查顶部 band 内两种异常：
  1) 线形（亮线/暗线）：某行中位色与上一行、下一行同时显著异号跳变——二阶差分特征。
     旧产物三档实测 line-ness = day 28 / dusk 51 / night 54（y=62）；
  2) 上行台阶：某行较上一行同向跳升 ≥ 阈值（捕获「亮平台顶边」型——亮行下方仍是亮雾化带时
     无下行跳变，纯线形判据会漏）。
内容性边缘不报：雾天背景→成片屋顶是向下的单调台阶（下行差大、上行差小），不构成「线」，
也不是上行台阶；已对 v2 全部 39 帧（三档 × 首中末+10 抽样）实测最坏 4.0，阈值 12 有 3 倍裕度。
只检查顶部 band（默认前 12.5% = 90 行）：pv01 三档 13 帧的 far 裁切带实测在 rows 55–90，
更深处屋顶等水平结构是内容边缘，不属本检查对象。

用法：
  python3 -X utf8 scripts/check-horizon-line.py --frames f0.png f1.png ... [--band-top 0.125]
      [--max-jump 12] [--x0 600 --x1 950] [--json out.json]
多帧全部通过 exit 0；任何一帧超阈 exit 1 并打印帧名/行号/lineNess 与 upStep。
"""
import argparse
import json
import os
import sys


def check_frame(path, band_top, max_jump, x0, x1):
    import numpy as np
    from PIL import Image
    img = np.asarray(Image.open(path).convert('RGB'), dtype=np.float64)
    h, w = img.shape[:2]
    band = max(3, int(h * band_top))
    x1 = min(x1, w)
    rows = np.median(img[:band, x0:x1, :], axis=1)      # band 内每行段内 RGB 中位数
    d = np.diff(rows, axis=0)                           # d[i] = rows[i+1]-rows[i]
    up_step = np.max(d, axis=1)                         # 上行台阶（亮线/亮平台顶边）
    up_line = np.minimum(d[:-1], -d[1:]).max(axis=1)    # 亮线：上跳后立即下跳
    dn_line = np.minimum(-d[:-1], d[1:]).max(axis=1)    # 暗线：下跳后立即上跳
    line = np.maximum(up_line, dn_line)                 # line[i] 属于行 i+1
    yu = int(np.argmax(up_step[1:])) + 1
    yl = int(np.argmax(line)) + 1
    up_v = round(float(up_step[yu - 1]), 1)
    ln_v = round(float(line[yl - 1]), 1)
    worst = max(up_v, ln_v)
    wy = yu if up_v >= ln_v else yl
    return {'frame': os.path.basename(path), 'bandRows': band, 'xRange': [x0, x1],
            'upStepRow': yu, 'upStep': up_v, 'lineRow': yl, 'lineNess': ln_v,
            'maxJumpRow': wy, 'maxJump': worst,
            'ok': bool(worst <= max_jump)}


def main():
    ap = argparse.ArgumentParser(description='地平线亮线回归检查（x=600-949 段行中位）')
    ap.add_argument('--frames', nargs='+', required=True)
    ap.add_argument('--band-top', type=float, default=0.125, help='检查顶部多少比例的行（默认 0.125）')
    ap.add_argument('--max-jump', type=float, default=12.0, help='上行台阶/线形阈值（默认 12）')
    ap.add_argument('--x0', type=int, default=600, help='段起点列（默认 600）')
    ap.add_argument('--x1', type=int, default=950, help='段终点列（默认 950，不含）')
    ap.add_argument('--json', default='', help='把逐帧数字写入该 JSON 文件')
    a = ap.parse_args()
    rs = [check_frame(p, a.band_top, a.max_jump, a.x0, a.x1) for p in a.frames]
    bad = [r for r in rs if not r['ok']]
    for r in rs:
        print('[horizon-line] %s upStep=%s@%d lineNess=%s@%d (band %d rows, x %d-%d, thr %.0f) %s'
              % (r['frame'], r['upStep'], r['upStepRow'], r['lineNess'], r['lineRow'],
                 r['bandRows'], r['xRange'][0], r['xRange'][1], a.max_jump,
                 'OK' if r['ok'] else 'FAIL'))
    if a.json:
        with open(a.json, 'w', encoding='utf-8') as f:
            json.dump({'maxJumpThreshold': a.max_jump, 'bandTop': a.band_top,
                       'xRange': [a.x0, a.x1], 'frames': rs}, f, ensure_ascii=False, indent=1)
            f.write('\n')
    print('[horizon-line] %d/%d frames pass' % (len(rs) - len(bad), len(rs)))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
