#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave13-nightbalance：before/after 同机位亮度对比（白天 ≤8% 门禁 + 夜间改善量）。
读两份 nightbalance-shots.mjs 的 <TAG>.json 报告，逐机位输出全画面平均亮度差与目标区 RGB 差。
用法：python3 -X utf8 scripts/nightbalance-daydelta.py <before.json> <after.json> [--gate-day]"""
import json
import sys

before = json.load(open(sys.argv[1]))
after = json.load(open(sys.argv[2]))
gate = '--gate-day' in sys.argv
print(f"{'view':14s} {'lum_b':>7s} {'lum_a':>7s} {'delta%':>7s}  regions(r/g/b before -> after, delta%)")
worst = None
for name, vb in sorted(before['views'].items()):
    va = after['views'].get(name)
    if not va:
        continue
    d = (va['meanLum'] - vb['meanLum']) / vb['meanLum'] * 100
    regs = []
    for k, cb in vb['color'].items():
        ca = va['color'].get(k)
        if not ca or not cb.get('meanSrgb'):
            continue
        lb = 0.2126 * cb['meanSrgb'][0] + 0.7152 * cb['meanSrgb'][1] + 0.0722 * cb['meanSrgb'][2]
        la = 0.2126 * ca['meanSrgb'][0] + 0.7152 * ca['meanSrgb'][1] + 0.0722 * ca['meanSrgb'][2]
        dl = (la - lb) / lb * 100 if lb > 0 else 0
        regs.append(f"{k} {tuple(round(x*255) for x in cb['meanSrgb'])}->{tuple(round(x*255) for x in ca['meanSrgb'])} {dl:+.1f}%")
    print(f"{name:14s} {vb['meanLum']:7.2f} {va['meanLum']:7.2f} {d:+6.1f}%  {' | '.join(regs)}")
    if gate and (worst is None or d < worst[1]):
        worst = (name, d)
if gate:
    print(f"GATE-DAY worst: {worst[0]} {worst[1]:+.1f}% ({'OK ≤8%' if worst[1] >= -8 else 'OVER 8%'})")
