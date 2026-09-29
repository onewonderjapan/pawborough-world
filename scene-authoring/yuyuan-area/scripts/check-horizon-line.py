#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave14-pvquality R1必修1：末帧地平线亮线回归检查。

判据（审查原文口径）：对每帧逐行取 RGB 中位数，检查画面顶部 band 内相邻行的中位色跳变。
pv01-aerial-reveal 末帧 y=62 x=600–949 的亮线在行中位上表现为单行跳变 21–54（三档实测：
day (177,170,153)→(200,197,182) 差 23/27/29，dusk 差 20/30/52，night 差 21/37/54）；
正常天空渐变与地平线过渡行差 <10。默认 max-channel 跳变阈值 12：正常帧全过、
带亮线帧必挂。只检查顶部 band（默认前 20% 行）——画面中下部建筑屋顶等水平结构
本来就有大行差，不属于本检查对象。

用法：
  python3 -X utf8 scripts/check-horizon-line.py --frames f0.png f1.png ... [--band-top 0.2]
      [--max-jump 12] [--json out.json]
多帧全部通过 exit 0；任何一帧超阈 exit 1 并打印帧名/行号/三通道差值。
"""
import argparse
import json
import os
import sys


def check_frame(path, band_top, max_jump):
    import numpy as np
    from PIL import Image
    img = np.asarray(Image.open(path).convert('RGB'), dtype=np.float64)
    h = img.shape[0]
    band = max(2, int(h * band_top))
    rows = np.median(img[:band, :, :], axis=1)          # band 内每行全宽 RGB 中位数
    jumps = np.abs(np.diff(rows, axis=0))               # 相邻行差
    y = int(np.argmax(jumps.max(axis=1)))               # 最大跳变行（y 与 y+1 之间）
    worst = [round(float(v), 1) for v in jumps[y]]
    return {'frame': os.path.basename(path), 'bandRows': band, 'maxJumpRow': y,
            'maxJumpRGB': worst, 'maxJump': max(worst),
            'ok': bool(max(worst) <= max_jump)}


def main():
    ap = argparse.ArgumentParser(description='地平线亮线回归检查（行间中位色跳变）')
    ap.add_argument('--frames', nargs='+', required=True)
    ap.add_argument('--band-top', type=float, default=0.2, help='检查顶部多少比例的行（默认 0.2）')
    ap.add_argument('--max-jump', type=float, default=12.0, help='相邻行中位色最大通道差阈值（默认 12）')
    ap.add_argument('--json', default='', help='把逐帧数字写入该 JSON 文件')
    a = ap.parse_args()
    rs = [check_frame(p, a.band_top, a.max_jump) for p in a.frames]
    bad = [r for r in rs if not r['ok']]
    for r in rs:
        print('[horizon-line] %s maxJump=%s at row %d (band %d rows, thr %.0f) %s'
              % (r['frame'], r['maxJumpRGB'], r['maxJumpRow'], r['bandRows'], a.max_jump,
                 'OK' if r['ok'] else 'FAIL'))
    if a.json:
        with open(a.json, 'w', encoding='utf-8') as f:
            json.dump({'maxJumpThreshold': a.max_jump, 'bandTop': a.band_top, 'frames': rs}, f,
                      ensure_ascii=False, indent=1)
            f.write('\n')
    print('[horizon-line] %d/%d frames pass' % (len(rs) - len(bad), len(rs)))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
