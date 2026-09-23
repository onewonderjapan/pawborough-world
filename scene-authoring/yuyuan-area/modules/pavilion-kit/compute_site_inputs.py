#!/usr/bin/env python3
"""S0 — derive per-pavilion site inputs from the frozen baseline layout.
Numerical authority: DESIGN_SPEC.json (fit/budget/spec.layoutObjects) + baseline/layout.json (READ-ONLY).
Writes site-inputs.json (records/ + artifacts). No side effects on baseline.
"""
import json, math, os

LAYOUT = '/home/baibai/work/onewonderjapan/pawborough-world/scene-authoring/yuyuan-area/baseline/layout.json'
HERE = os.path.dirname(os.path.abspath(__file__))
OUTS = [os.path.join(HERE, 'site-inputs.json'),
        '/home/baibai/outbox/pawborough-w1-pavilion-kit-20260922/artifacts/pavilion-kit/site-inputs.json']

PLATFORM_H = 0.3
INSET = 0.15          # spec fit: minus 0.15 m
OVERHANG_EAVE = 0.9   # spec roof eaveOverhangBeyondColumns

SPEC = {
    'bld-428179924': {'zh': '听鹂亭', 'n': 4, 'variant': 'rect'},
    'bld-428186467': {'zh': '挹秀亭', 'n': 4, 'variant': 'regular'},
    'bld-428196085': {'zh': '流觞亭', 'n': 6, 'variant': 'regular', 'sample': True},
    'bld-428196091': {'zh': '凤凰亭', 'n': 6, 'variant': 'regular'},
    'bld-428196098': {'zh': '耸翠亭', 'n': 6, 'variant': 'regular'},
}

def polygon_area_centroid(pts):
    a = cx = cz = 0.0
    for i in range(len(pts) - 1):
        x0, z0 = pts[i]; x1, z1 = pts[i + 1]
        cr = x0 * z1 - x1 * z0
        a += cr; cx += (x0 + x1) * cr; cz += (z0 + z1) * cr
    a *= 0.5
    return cx / (6 * a), cz / (6 * a), abs(a)

def largest_ngon_in_bbox(w, d, n, deg_step=0.25):
    """Max circumradius of a regular n-gon (free rotation) inside axis-aligned bbox w x d (map axes).
    Returns (R, theta_deg) — theta = map angle of the first vertex."""
    ax, az = w / 2, d / 2
    best = (0.0, 0.0)
    steps = int(round(360.0 / n / deg_step))
    for s in range(steps):
        th = math.radians(s * deg_step)
        mc = ms = 0.0
        for k in range(n):
            a = th + 2 * math.pi * k / n
            mc = max(mc, abs(math.cos(a))); ms = max(ms, abs(math.sin(a)))
        R = min(ax / mc, az / ms)
        if R > best[0]:
            best = (R, math.degrees(th))
    return best

def main():
    layout = json.load(open(LAYOUT, encoding='utf-8'))
    objs = {o['id']: o for o in layout['objects']}
    out = []
    for bid, sp in SPEC.items():
        o = objs[bid]
        fp = o['geometry']['footprint']
        fp = fp[:-1] if fp[0] == fp[-1] else fp
        cx, cz, area = polygon_area_centroid(fp)
        xs = [p[0] for p in fp]; zs = [p[1] for p in fp]
        w, d = max(xs) - min(xs), max(zs) - min(zs)
        dx, dz = o['facade']['dir']
        rotY = math.atan2(dx, dz)  # assemble.py Blender Z-yaw convention
        rec = {'id': bid, 'zh': sp['zh'], 'n': sp['n'], 'variant': sp['variant'],
               'sample': sp.get('sample', False),
               'footprint': fp, 'centroid': [round(cx, 4), round(cz, 4)],
               'footprintAreaM2': round(area, 2),
               'bboxMap': {'w': round(w, 3), 'd': round(d, 3)},
               'facadeDir': [dx, dz], 'facadeBasis': o['facade']['basis'],
               'rotY': round(rotY, 6),
               'heightLayout': o.get('height'), 'eaveLayout': o.get('eave'), 'riseLayout': o.get('rise')}
        if sp['variant'] == 'rect':
            # footprint's own rectangle (it is a 4-gon): use its side vectors
            v1 = (fp[1][0] - fp[0][0], fp[1][1] - fp[0][1])
            v2 = (fp[2][0] - fp[1][0], fp[2][1] - fp[1][1])
            L1, L2 = math.hypot(*v1), math.hypot(*v2)
            long_axis = v1 if L1 >= L2 else v2
            phi = math.atan2(long_axis[1], long_axis[0])   # footprint long axis, map angle
            long_len, short_len = max(L1, L2), min(L1, L2)
            Rx, Rz = long_len / 2 - INSET, short_len / 2 - INSET
            # facade should roughly face a long side; which long side is nearest the facade dir?
            n1 = (-math.sin(phi), math.cos(phi))  # long-side normal, map
            side_sign = 1.0 if (n1[0] * dx + n1[1] * dz) >= 0 else -1.0
            rec.update({'Rx': round(Rx, 4), 'Rz': round(Rz, 4),
                        'phi': round(phi, 6),
                        'footprintRect': {'long': round(max(L1, L2), 3), 'short': round(min(L1, L2), 3)},
                        'entranceLongSideNormal': [round(side_sign * n1[0], 6), round(side_sign * n1[1], 6)],
                        'note': 'rect variant uses the footprint own rectangle inset 0.15, aligned to footprint axes; map-axis bbox 5.49x2.96 is the bbox of a rotated rect and is not itself buildable'})
        else:
            R0, theta = largest_ngon_in_bbox(w, d, sp['n'])
            R = R0 - INSET
            rin = R * math.cos(math.pi / sp['n'])
            # local vertex angles = map angle + rotY ; entrance bay = bay midpoint nearest local +Z (90 deg)
            vmap, vloc = [], []
            for k in range(sp['n']):
                am = math.radians(theta) + 2 * math.pi * k / sp['n']
                al = am + rotY
                vmap.append([round(cx + R0 * math.cos(am), 4), round(cz + R0 * math.sin(am), 4)])
                vloc.append([round(R * math.cos(al), 4), round(R * math.sin(al), 4)])
            bays = []
            for k in range(sp['n']):
                a0 = math.radians(theta) + 2 * math.pi * k / sp['n']
                a1 = math.radians(theta) + 2 * math.pi * ((k + 1) % sp['n']) / sp['n']
                if a1 < a0: a1 += 2 * math.pi
                mid = (a0 + a1) / 2 + rotY
                bays.append({'k': k, 'midLocalDeg': round(math.degrees(mid) % 360, 2),
                             'chord': round(2 * R0 * math.sin(math.pi / sp['n']), 4)})
            ent = min(bays, key=lambda b: abs((b['midLocalDeg'] - 90 + 180) % 360 - 180))
            rec.update({'fit': {'R': round(R, 4), 'inradius': round(rin, 4),
                                'eaveRadius': round(R + OVERHANG_EAVE, 4),
                                'thetaDeg': theta, 'source': 'largest regular n-gon in map-axis bbox minus 0.15 (free rotation)'},
                        'localColumns': vloc, 'bays': bays,
                        'entranceBay': ent['k'], 'entranceOffAxisDeg': round(abs((ent['midLocalDeg'] - 90 + 180) % 360 - 180), 2)})
        out.append(rec)
    doc = {'packageId': 'pawborough-w1-pavilion-kit-20260922',
           'source': 'scene-authoring/yuyuan-area/baseline/layout.json (frozen, READ-ONLY)',
           'conventions': {'map': 'x east, z south (layout.json)', 'module': 'GLB Y-up, facade +Z, origin platform centre at ground y=0',
                           'rotY': 'assemble.py Blender Z-yaw; derived rotY = atan2(dx, dz) so local +Z maps to facade.dir'},
           'platformHeight': PLATFORM_H, 'fitInset': INSET, 'eaveOverhang': OVERHANG_EAVE,
           'pavilions': out}
    for p in OUTS:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        json.dump(doc, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for r in out:
        line = f"{r['zh']} {r['id']} n={r['n']} {r['variant']} bbox={r['bboxMap']['w']}x{r['bboxMap']['d']} rotY={r['rotY']}"
        if r['variant'] == 'rect':
            line += f" Rx={r['Rx']} Rz={r['Rz']} phi={math.degrees(r['phi']):.2f}deg"
        else:
            line += f" R={r['fit']['R']} rin={r['fit']['inradius']} theta={r['fit']['thetaDeg']} entBay={r['entranceBay']} off={r['entranceOffAxisDeg']}deg"
        print(line)

if __name__ == '__main__':
    main()
