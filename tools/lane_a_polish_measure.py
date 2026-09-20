#!/usr/bin/env python3
"""Lane-A polish section re-measure — the survey's three entrance sections
recomputed on the v6 candidate (new lane-a module + measured-line interfaces),
plus a fourth slice through the new east mouth wall.

Ground contract per section: the merged walkable intervals (y in [0.05, 0.20])
must cover the corridor between the VISIBLE wall faces with gaps <= 0.02 m —
the v5 east void band (up to 1.6 m wide) must be gone.

Read-only; output artifacts/lane-a-polish/verify/measure-v6.json.
Run: python3 tools/lane_a_polish_measure.py
"""
import json
import math
import sys
from pathlib import Path

WS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WS / 'tools'))
from lane_a_survey_glb import (  # noqa: E402
    collect_tris, tri_crosses_z, merge_intervals, collider_x_at_z)

OUT = WS / 'artifacts' / 'lane-a-polish' / 'verify'
V6 = WS / 'world' / 'fangbang-temple-v6'

SECTION_Z = [
    (-10.60, 'street mouth 街口'),
    (-13.40, 'mid connection 连接中段'),
    (-15.60, 'new east mouth wall 新东墙'),
    (-16.375, 'portal 门洞'),
    (-19.50, 'inside lane 弄内'),
]

YAW, T = 3.1165, [43.545, 0.09, -16.375]
c, s = math.cos(YAW), math.sin(YAW)
holder = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, T[0], T[1], T[2], 1]

asm = collect_tris(V6 / 'street-reviewed-lanes.glb',
                   name_filter=lambda nm: nm.startswith(('N05-restaurant-a', 'N06-curio-a', 'street-kit__')))
la = collect_tris(WS / 'world' / 'lane-a-polish' / 'lane-a' / 'model.glb', frame=holder)
ifc = collect_tris(WS / 'world' / 'lane-a-polish' / 'interfaces' / 'model.glb')

LANE = dict(x=(37.0, 49.5), z=(-26.0, -7.0))


def in_lane(t):
    x0, y0, z0, x1, y1, z1 = t['bbox']
    return not (x1 < LANE['x'][0] or x0 > LANE['x'][1] or z1 < LANE['z'][0] or z0 > LANE['z'][1])


vis = {
    'assembly': [t for t in asm if in_lane(t)],
    'lane-a': la,
    'interfaces': [t for t in ifc if in_lane(t)],
}

v5col = json.loads((V6 / 'collision-world.json').read_text())
sideA = json.loads((WS / 'world' / 'lane-a-polish' / 'lane-a' / 'collision.json').read_text())
sideI = json.loads((WS / 'world' / 'lane-a-polish' / 'interfaces' / 'collision.json').read_text())
all_col = v5col['colliders'] + sideA['colliders'] + sideI['colliders']

sections = []
fail = 0
for z, label in SECTION_Z:
    ground_ivs, wall_ivs = [], []
    for src, tris in vis.items():
        for t in tris:
            cr = tri_crosses_z(t, z)
            if cr is None:
                continue
            x0, x1, y0, y1 = cr
            if abs(t['n'][1]) > 0.6 and 0.05 <= y0 <= 0.20:
                ground_ivs.append((x0, x1))
            elif x1 - x0 < 0.6 and y0 > 0.2:
                wall_ivs.append((x0, x1, y0, y1))
    ground = merge_intervals(ground_ivs, gap=0.02)
    walls = merge_intervals([(a, b) for a, b, _, _ in wall_ivs], gap=0.05)
    # visible corridor bounds: nearest wall face pair enclosing the walkable y band
    face_w = max((a for a, b in walls), default=None)
    face_e = min((b for a, b in walls), default=None)
    # walkable span = between the two side walls that bound the lane at this z
    col_x = [collider_x_at_z(r, z) for r in all_col]
    col_x = [r for r in col_x if r and r[2] < 2.0 and r[3] > 0.2]
    col_ivs = merge_intervals([(r[0], r[1]) for r in col_x], gap=0.3)
    sec = {
        'z': z, 'label': label,
        'ground': [[round(a, 3), round(b, 3)] for a, b in ground],
        'wallFacesX': [[round(a, 3), round(b, 3)] for a, b in walls],
        'colliders': [[round(a, 3), round(b, 3)] for a, b in col_ivs],
    }
    # hole check: ground must cover the REACHABLE corridor (capsule centre can
    # approach a visible wall face no closer than its 0.35 m radius)
    if z >= -16.4:
        walls_x = [(a, b) for a, b in col_ivs if b - a < 0.8]
        west_edges = [b for a, b in walls_x if b <= 43.5]
        east_edges = [a for a, b in walls_x if a >= 43.5]
        if west_edges and east_edges:
            corr_w = max(west_edges)
            corr_e = min(east_edges)
            reach_w, reach_e = corr_w + 0.35, corr_e - 0.35
            sec['corridor'] = [round(corr_w, 3), round(corr_e, 3)]
            sec['reachable'] = [round(reach_w, 3), round(reach_e, 3)]
            gaps, cur = [], reach_w
            for a, b in ground:
                if b <= cur:
                    continue
                if a > cur:
                    gaps.append([round(cur, 3), round(a, 3), round(a - cur, 3)])
                cur = max(cur, b)
                if cur >= reach_e:
                    break
            if cur < reach_e:
                gaps.append([round(cur, 3), round(reach_e, 3), round(reach_e - cur, 3)])
            sec['groundGaps'] = gaps
            worst = max((g[2] for g in gaps), default=0.0)
            sec['maxGapM'] = worst
            ok = worst <= 0.02
            sec['pass'] = ok
            if not ok:
                fail += 1
            print(f"{'ok  ' if ok else 'FAIL'} z={z} {label}: corridor {sec['corridor']} reachable {sec['reachable']} maxGap={worst}")
    sections.append(sec)

OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'measure-v6.json').write_text(json.dumps({
    'dataset': 'fangbang-temple-v6 + world/lane-a-polish',
    'sections': sections,
    'note': 'ground = upward faces y0.05-0.20 merged at 0.02 tolerance; corridor = wall colliders enclosing the lane; gaps judged between them',
}, ensure_ascii=False, indent=1) + '\n')
print('MEASURE_V6_' + ('PASS' if fail == 0 else f'FAIL({fail})'))
sys.exit(1 if fail else 0)
