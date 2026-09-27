#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave11-lighting：控制层两次渲染的逐值对账 —— 证明 beauty 换引擎 / 换灯光时 depth / normal / segmentation 通道不变。

  对 --a 里每个 <shot>/<通道>/frame-###.png，--b 必须有同名文件，且解码后像素逐值相等（depth 16-bit 按 16-bit 比，
  不是文件字节：Blender 往 PNG 写渲染日期 / 耗时等元数据，同一脚本连跑两次文件字节也不同）；cameras/*.json 解析后相等；
  segmentation-lut.json 相等。beauty 通道默认不比（换引擎本来就变），--channels 可改。
  --a 里没有任何可比帧时判失败（防空目录误过）。
用法：python3 tests/control-pass-parity.py --a <控制层目录> --b <对照目录> [--channels depth,normal,segmentation,cameras] [--report <json>]
退出码：0 全部相等；1 有差异 / 缺帧 / 无可比帧。
"""
import argparse
import glob
import json
import os
import sys

import numpy as np
from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--a', required=True)
    ap.add_argument('--b', required=True)
    ap.add_argument('--channels', default='depth,normal,segmentation,cameras')
    ap.add_argument('--report', default='')
    a = ap.parse_args()
    chans = a.channels.split(',')
    res = {c: {'compared': 0, 'equal': 0, 'missing': [], 'diff': []} for c in chans}
    for f in sorted(glob.glob(os.path.join(a.a, '*', '*', 'frame-*'))):
        rel = os.path.relpath(f, a.a)
        ch = rel.split(os.sep)[1]
        if ch not in res:
            continue
        g = os.path.join(a.b, rel)
        r = res[ch]
        if not os.path.exists(g):
            r['missing'].append(rel)
            continue
        r['compared'] += 1
        if f.endswith('.json'):
            eq = json.load(open(f, encoding='utf-8')) == json.load(open(g, encoding='utf-8'))
            detail = None
        else:
            ia, ib = np.array(Image.open(f)), np.array(Image.open(g))
            eq = ia.shape == ib.shape and np.array_equal(ia, ib)
            detail = None if eq else (int(np.abs(ia.astype(np.int64) - ib.astype(np.int64)).max()) if ia.shape == ib.shape else 'shape')
        if eq:
            r['equal'] += 1
        else:
            r['diff'].append([rel, detail])
    la, lb = os.path.join(a.a, 'segmentation-lut.json'), os.path.join(a.b, 'segmentation-lut.json')
    lut_eq = os.path.exists(la) and os.path.exists(lb) and json.load(open(la, encoding='utf-8')) == json.load(open(lb, encoding='utf-8'))
    total = sum(r['compared'] for r in res.values())
    bad = [c for c, r in res.items() if r['missing'] or r['diff']]
    ok = total > 0 and not bad and lut_eq
    out = {'a': a.a, 'b': a.b, 'channels': res, 'lutEqual': lut_eq, 'framesCompared': total, 'pass': ok}
    for c, r in res.items():
        print('%-13s compared %3d equal %3d missing %d diff %d%s' % (c, r['compared'], r['equal'], len(r['missing']), len(r['diff']),
                                                                    ('  e.g. %s' % r['diff'][:2]) if r['diff'] else ''))
    print('segmentation-lut equal:', lut_eq)
    if a.report:
        with open(a.report, 'w', encoding='utf-8') as fh:
            json.dump(out, fh, ensure_ascii=False, indent=1)
            fh.write('\n')
    print('control-pass-parity:', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
