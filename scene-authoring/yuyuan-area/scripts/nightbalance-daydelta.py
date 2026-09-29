#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave13-nightbalance：before/after 同机位亮度对比（白天 ≤8% 门禁 + 夜间改善量）。
读两份 nightbalance-shots.mjs 的 <TAG>.json 报告，逐机位输出全画面平均亮度差与目标区 RGB 差。
R1（astra 必修3）：门禁改**绝对变化率** |a-b|/b（正向增亮超限同样抓）；超限、缺机位、
无效基线（报告缺 views / meanLum 非正数 / 两份报告机位集不一致）均**非零退出**，不再只打印文字。
用法：python3 -X utf8 scripts/nightbalance-daydelta.py <before.json> <after.json> [--gate-day] [--exclude pond,...]
  --exclude：逗号分隔的机位名单，从门禁判定中排除（报告仍打印）。工单口径：水面池带（pond）是
  N2 主动改观感，单独记录，不算入白天 ≤8% 门槛（GOAL-R1 主控裁定）。
退出码：0 = 全部机位通过（--gate-day 时参与门禁的机位全画幅 |delta| ≤ 8）；1 = 门禁超限 / 缺机位 / 基线无效。"""
import json
import sys

if len(sys.argv) < 3:
    print('usage: nightbalance-daydelta.py <before.json> <after.json> [--gate-day]', file=sys.stderr)
    sys.exit(2)
GATE = 8.0
gate = '--gate-day' in sys.argv


def load(path, tag):
    try:
        d = json.load(open(path))
    except (OSError, ValueError) as e:
        print(f'INVALID-BASELINE {tag}: {path}: {e}', file=sys.stderr)
        sys.exit(1)
    views = d.get('views')
    if not isinstance(views, dict) or not views:
        print(f'INVALID-BASELINE {tag}: {path}: views 缺失或为空', file=sys.stderr)
        sys.exit(1)
    for name, v in views.items():
        lum = v.get('meanLum') if isinstance(v, dict) else None
        if not isinstance(lum, (int, float)) or lum <= 0:
            print(f'INVALID-BASELINE {tag}: {path}: 机位 {name} meanLum 缺失/非正数', file=sys.stderr)
            sys.exit(1)
    return views


exclude = set()
for i, a in enumerate(sys.argv):
    if a == '--exclude' and i + 1 < len(sys.argv):
        exclude |= {x for x in sys.argv[i + 1].split(',') if x}
before = load(sys.argv[1], 'before')
after = load(sys.argv[2], 'after')
missing = sorted(set(before) - set(after))
extra = sorted(set(after) - set(before))
if missing:
    print(f'MISSING-VIEWS after 报告缺机位: {missing}', file=sys.stderr)
if extra:
    print(f'EXTRA-VIEWS after 报告多出机位: {extra}', file=sys.stderr)
if missing or extra:
    sys.exit(1)

print(f"{'view':14s} {'lum_b':>7s} {'lum_a':>7s} {'abs|delta|%':>11s}  regions(r/g/b before -> after, delta%)")
worst = None
bad = False
for name in sorted(before):
    vb, va = before[name], after[name]
    d = abs(va['meanLum'] - vb['meanLum']) / vb['meanLum'] * 100
    signed = (va['meanLum'] - vb['meanLum']) / vb['meanLum'] * 100
    regs = []
    for k, cb in vb['color'].items():
        ca = va['color'].get(k)
        if not ca or not cb.get('meanSrgb'):
            continue
        lb = 0.2126 * cb['meanSrgb'][0] + 0.7152 * cb['meanSrgb'][1] + 0.0722 * cb['meanSrgb'][2]
        la = 0.2126 * ca['meanSrgb'][0] + 0.7152 * ca['meanSrgb'][1] + 0.0722 * ca['meanSrgb'][2]
        dl = (la - lb) / lb * 100 if lb > 0 else 0
        regs.append(f"{k} {tuple(round(x*255) for x in cb['meanSrgb'])}->{tuple(round(x*255) for x in ca['meanSrgb'])} {dl:+.1f}%")
    over = gate and d > GATE and name not in exclude
    bad |= over
    print(f"{name:14s} {vb['meanLum']:7.2f} {va['meanLum']:7.2f} {d:10.1f}%{' OVER' if over else (' EXCLUDED' if gate and name in exclude else '')}  {' | '.join(regs)}")
    if gate and name in exclude:
        continue
    if worst is None or d > worst[1]:
        worst = (name, d, signed)
if gate:
    print(f"GATE-DAY worst: {worst[0]} |{worst[1]:.1f}|% (signed {worst[2]:+.1f}%) "
          f"({'OK 全部机位 |delta| ≤8%' if not bad else 'OVER 8% —— 门禁不通过'})")
    sys.exit(1 if bad else 0)
