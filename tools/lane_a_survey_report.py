#!/usr/bin/env python3
"""Print a human-readable digest of measure_sections.json (survey aid)."""
import json
import sys
from pathlib import Path

p = Path(__file__).resolve().parents[1] / 'artifacts' / 'lane-a-polish' / 'survey' / 'measure_sections.json'
d = json.loads(p.read_text())

for s in d['sections']:
    print(f"\n=== z={s['z']} {s['label']}")
    print(' GROUND:')
    by = {}
    for g in s['ground']:
        by.setdefault((g['src'], g['node']), []).append((g['x0'], g['x1']))
    for (src, node), ivs in sorted(by.items()):
        m = []
        for a, b in sorted(ivs):
            if m and a <= m[-1][1] + 0.02:
                m[-1][1] = max(m[-1][1], b)
            else:
                m.append([a, b])
        print(f"  {src:10s} {node:42s}", [(round(a, 2), round(b, 2)) for a, b in m])
    print(' WALLS (x-interval y-range):')
    by = {}
    for g in s['walls']:
        by.setdefault((g['src'], g['node']), []).append((g['x0'], g['x1'], g['y0'], g['y1']))
    for (src, node), ivs in sorted(by.items()):
        m = []
        for a, b, y0, y1 in sorted(ivs):
            if m and a <= m[-1][1] + 0.05:
                m[-1][1] = max(m[-1][1], b)
                m[-1][2] = min(m[-1][2], y0)
                m[-1][3] = max(m[-1][3], y1)
            else:
                m.append([a, b, y0, y1])
        if (m[-1][1] - m[0][0]) < 60:
            print(f"  {src:10s} {node:42s}", [(round(a, 2), round(b, 2), f'y{round(c, 1)}-{round(dd, 1)}') for a, b, c, dd in m])
    print(' COLLIDERS crossing (x-window 36..52):')
    for c in sorted(s['colliders'], key=lambda r: r['x0']):
        if c['x1'] > 36 and c['x0'] < 52:
            print(f"  {c['name']:44s} x[{c['x0']:.2f},{c['x1']:.2f}] y[{c['y0']},{c['y1']}]")

print('\n=== N05/N06 visible face vs collider (sampled 0.2m) ===')
print(f"{'z':>7} {'N05 vis max x':>14} {'N05 col min x':>14} {'gap_w':>7} {'N06 vis min x':>14} {'N06 col max x':>14} {'gap_e':>7}")
for f in d['faceLines']:
    g_w = (f['n05_vis_max_x'] - f['n05_col_min_x']) if (f['n05_vis_max_x'] is not None and f['n05_col_min_x'] is not None) else None
    g_e = (f['n06_col_max_x'] - f['n06_vis_min_x']) if (f['n06_vis_min_x'] is not None and f['n06_col_max_x'] is not None) else None
    fmt = lambda v: f'{v:.2f}' if v is not None else '  --'
    print(f"{f['z']:>7} {fmt(f['n05_vis_max_x']):>14} {fmt(f['n05_col_min_x']):>14} {fmt(g_w):>7} "
          f"{fmt(f['n06_vis_min_x']):>14} {fmt(f['n06_col_max_x']):>14} {fmt(g_e):>7}")

print('\n=== lane-a module floor nodes (world bounds x0..x1 / z0..z1) ===')
for k, v in d['laneAFloorNodeBounds'].items():
    print(f"  {k:42s} x[{v[0]:.2f},{v[1]:.2f}] z[{v[2]:.2f},{v[3]:.2f}]")

print('\n=== interfaces a-floor polygon vertices (from GLB) ===')
print(' ', d['interfacesAFloorVertices'])
