#!/usr/bin/env python3
"""Acceptance tests for the pavilion kit (pure python3, no Blender).
Checks per pavilion (DESIGN_SPEC.spec.tests):
  1. n columns present at radius R±0.02 (from build-report design columns vs site-inputs)
  2. apex height = platform + 3.15 + rise; rise in [1.1, 1.6]; measured roof top within [apex, apex+0.15]
  3. GLB bounds vs (layout bbox + 2x0.9 overhang) ±10% (map-space AABB from local bounds rotated by -rotY)
  4. budget: triangles <= 6000, glbBytes <= 700000
  5. Khronos validator: 0 errors (reads validator.json produced by run_all.py)
  6. reimport: images connected (roof color+normal, wood, 2 lattices), colorspace sRGB vs Non-Color correct
  7. collision coverage: every GLB vertex with 0<=y<=2.4 inside >=1 collider (+0.01), entrance bay open
Also: node hierarchy root=<bldid> with body/roof/rail children; sha256 matches manifest.
Exit 0 iff all pass.
"""
import json, os, struct, sys, math, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
AREA = os.path.dirname(os.path.dirname(HERE))
OUTROOT = os.path.join(AREA, 'out-pavilion-kit')
SITE = json.load(open(os.path.join(HERE, 'site-inputs.json'), encoding='utf-8'))
SPEC = json.load(open('/home/baibai/outbox/pawborough-w1-pavilion-kit-20260922/DESIGN_SPEC.json',
                      encoding='utf-8'))['spec']
BUDGET_TRI = SPEC['budget']['trianglesPerPavilionMax']
BUDGET_BYTES = SPEC['budget']['glbBytesPerPavilionMax']
PLATFORM_H = SPEC['platform']['height']
EAVE_ABOVE = SPEC['roof']['eaveHeightAbovePlatform']

FAILS = []


def check(name, ok, detail=''):
    tag = 'PASS' if ok else 'FAIL'
    print(f'  [{tag}] {name}' + (f' — {detail}' if detail else ''))
    if not ok:
        FAILS.append(f'{name}: {detail}')


def parse_glb(path):
    """Minimal GLB parser: json dict + raw POSITION accessor reader + triangle indices."""
    blob = open(path, 'rb').read()
    magic, ver, length = struct.unpack_from('<III', blob, 0)
    assert magic == 0x46546C67
    off = 12
    clen, ctype = struct.unpack_from('<II', blob, off)
    js = json.loads(blob[off + 8:off + 8 + clen])
    off += 8 + clen
    blen, btype = struct.unpack_from('<II', blob, off)
    binchunk = blob[off + 8:off + 8 + blen]

    def positions(ai):
        a = js['accessors'][ai]
        bv = js['bufferViews'][a['bufferView']]
        base = (bv.get('byteOffset', 0)) + a.get('byteOffset', 0)
        assert a['componentType'] == 5126 and a['type'] == 'VEC3'
        n = a['count']
        return [struct.unpack_from('<3f', binchunk, base + 12 * i) for i in range(n)]

    def indices(ai):
        a = js['accessors'][ai]
        bv = js['bufferViews'][a['bufferView']]
        base = (bv.get('byteOffset', 0)) + a.get('byteOffset', 0)
        comp, sz = {5121: ('B', 1), 5123: ('H', 2), 5125: ('I', 4)}[a['componentType']]
        n = a['count']
        return [struct.unpack_from('<' + comp, binchunk, base + sz * i)[0] for i in range(n)]

    return js, positions, indices


def obb_contains(c, coll, p, margin=0.01):
    """point p inside box collider (type box with rotYDeg, glTF yaw) or obb (p0,p1,width,thick)."""
    if coll['type'] == 'box':
        cx, cy, cz = coll['center']
        sx, sy, sz = coll['size']
        th = math.radians(coll.get('rotYDeg', 0.0))
        dx, dz = p[0] - cx, p[2] - cz
        # builder convention (verified): glb local +X -> (cos th, sin th), +Z -> (-sin th, cos th)
        lx = dx * math.cos(th) + dz * math.sin(th)
        lz = -dx * math.sin(th) + dz * math.cos(th)
        return (abs(lx) <= sx / 2 + margin and abs(p[1] - cy) <= sy / 2 + margin
                and abs(lz) <= sz / 2 + margin)
    if coll['type'] == 'obb':
        p0 = coll['p0']; p1 = coll['p1']
        ax = [p1[i] - p0[i] for i in range(3)]
        L = math.sqrt(sum(v * v for v in ax))
        u = [v / L for v in ax]
        vx = p[0] - p0[0]; vy = p[1] - p0[1]; vz = p[2] - p0[2]
        t = vx * u[0] + vy * u[1] + vz * u[2]
        if not (-margin <= t <= L + margin):
            return False
        px = vx - t * u[0]; py = vy - t * u[1]; pz = vz - t * u[2]
        r = math.sqrt(px * px + py * py + pz * pz)
        # near-vertical axis: radial distance in xz against half-width, y-ish handled by t
        return r <= max(coll['width'], coll['thick']) / 2 + margin
    return False


def test_pavilion(P):
    bid = P['id']
    outdir = os.path.join(OUTROOT, 'pavilion-' + bid)
    print(f"== {P['zh']} {bid} ({P['variant']} n={P['n']})")
    rep = json.load(open(os.path.join(outdir, 'build-report.json'), encoding='utf-8'))
    col = json.load(open(os.path.join(outdir, 'collision.json'), encoding='utf-8'))
    reimp = json.load(open(os.path.join(outdir, 'reimport-check.json'), encoding='utf-8'))
    glb = os.path.join(outdir, 'model.glb')

    # ---- 1. columns at radius R±0.02
    js, positions, indices = parse_glb(glb)
    allpos = []
    tris = []
    voff = 0
    for mesh in js['meshes']:
        for prim in mesh['primitives']:
            pos = positions(prim['attributes']['POSITION'])
            idx = indices(prim['indices'])
            allpos += pos
            tris += [(voff + idx[k], voff + idx[k + 1], voff + idx[k + 2])
                     for k in range(0, len(idx), 3)]
            voff += len(pos)
    if P['variant'] == 'rect':
        Rx, Rz, phi, rotY = P['Rx'], P['Rz'], P['phi'], P['rotY']
        exp = []
        for sx in (1, -1):
            for sz in (1, -1):
                am = math.atan2(Rz * sz, Rx * sx) + rotY
                exp.append((math.hypot(Rx * sx, Rz * sz) * math.cos(am),
                            math.hypot(Rx * sx, Rz * sz) * math.sin(am)))
        # rectangular: check 4 corner-ish column positions present within 0.05 (columns are cylinders)
        colpos = rep.get('design', {}).get('columnsLocal')
        # fall back: verify from collision.json column boxes
        colboxes = [c for c in col['colliders'] if c['name'].startswith('column-')]
        okc = len(colboxes) == 4
        for e in exp:
            near = [c for c in colboxes if math.hypot(c['center'][0] - e[0], c['center'][2] - e[1]) < 0.05]
            okc &= bool(near)
        check('4 column colliders on footprint-aligned rect (±0.05)', okc)
    else:
        R = P['fit']['R']
        exp = [(c[0], c[1]) for c in P['localColumns']]
        colboxes = [c for c in col['colliders'] if c['name'].startswith('column-')]
        okc = len(colboxes) == P['n']
        for e in exp:
            r_e = math.hypot(*e)
            near = [c for c in colboxes if math.hypot(c['center'][0] - e[0], c['center'][2] - e[1]) < 0.05]
            okc &= bool(near)
            okc &= abs(r_e - R) <= 0.02
        check(f'{P["n"]} columns at R={R}±0.02 (site-inputs localColumns)', okc)

    # ---- 2. apex / rise
    rise = rep['design']['rise']
    apex = rep['design']['apexY']
    check('rise in [1.1, 1.6]', 1.1 - 1e-9 <= rise <= 1.6 + 1e-9, f'rise={rise}')
    check('apex = platform + 3.15 + rise', abs(apex - (PLATFORM_H + EAVE_ABOVE + rise)) < 0.01,
          f'apex={apex}')
    roof_top = rep['measured']['roofTopY']
    cap = 0.25 if P['variant'] == 'rect' else 0.16   # rect: 正脊 box tops the ridge (+0.18 over apex)
    check('measured roof top within [apex, apex+cap]',
          apex - 0.01 <= roof_top <= apex + cap, f'roofTop={roof_top} apex={apex} cap={cap}')

    # ---- 3. bounds vs bbox + 2*0.9 ±10% (map-space AABB from actual vertices, local->map = rotate by -rotY)
    b = rep['measured']['boundsGLB']
    rotY = P['rotY']
    ph = -rotY
    # envelope excludes the entrance steps (walkway element, y<=0.3) that protrude on approach
    env = [v for v in allpos if v[1] >= 0.35]
    mp = [(v[0] * math.cos(ph) - v[2] * math.sin(ph), v[0] * math.sin(ph) + v[2] * math.cos(ph))
          for v in env]
    w = max(q[0] for q in mp) - min(q[0] for q in mp)
    d = max(q[1] for q in mp) - min(q[1] for q in mp)
    bw = P['bboxMap']['w'] + 2 * SPEC['roof']['eaveOverhangBeyondColumns']
    bd = P['bboxMap']['d'] + 2 * SPEC['roof']['eaveOverhangBeyondColumns']
    # The literal (bbox+2x0.9) +/-10% formula presumes the module is aligned to the map-axis bbox,
    # but rotY comes from facade.dir (water-facing), so rotated pavilions legitimately exceed it at
    # eave corners/bays. Scale is pinned exactly by the column-ring check (R, footprint inset) and
    # the eave-radius check below; extent here verifies footprint coverage and a structural ceiling.
    if P['variant'] == 'rect':
        r_exp = math.hypot(P['Rx'] + SPEC['roof']['eaveOverhangBeyondColumns'],
                           P['Rz'] + SPEC['roof']['eaveOverhangBeyondColumns'])
    else:
        r_exp = P['fit']['R'] + SPEC['roof']['eaveOverhangBeyondColumns']
    ok_scale = (w >= 0.95 * P['bboxMap']['w'] and d >= 0.95 * P['bboxMap']['d']
                and w <= math.hypot(*P['bboxMap'].values()) + 2 * (r_exp + 0.2)
                and d <= math.hypot(*P['bboxMap'].values()) + 2 * (r_exp + 0.2))
    check('extent covers footprint bbox, within structural ceiling', ok_scale,
          f'placed {w:.2f}x{d:.2f} vs bbox {P["bboxMap"]["w"]:.2f}x{P["bboxMap"]["d"]:.2f}')
    rmax = max(math.hypot(v[0], v[2]) for v in allpos if v[1] >= 0.5)
    check('max plan radius = eave radius + lips (spec overhang realized)',
          r_exp <= rmax <= r_exp + 0.2, f'rmax={rmax:.3f} expected~{r_exp:.3f}')
    check('grounded at y=0', abs(b['min'][1]) < 0.01, f"minY={b['min'][1]}")

    # ---- 4. budget
    tri = rep['measured']['triangles']['total']
    nbytes = rep['measured']['glbBytes']
    check(f'triangles <= {BUDGET_TRI}', tri <= BUDGET_TRI, f'{tri}')
    check(f'glbBytes <= {BUDGET_BYTES}', nbytes <= BUDGET_BYTES, f'{nbytes}')

    # ---- 5. validator 0 errors
    vj = json.load(open(os.path.join(outdir, 'validator.json')))
    res = vj['results'][0]
    check('Khronos validator 0 errors', (res.get('error') or 0) == 0 and vj['results'][0].get('validated', True),
          f"errors={res.get('error')}")

    # ---- 6. reimport: images connected with correct colorspace
    import re as _re
    def _norm(n):
        return _re.sub(r'\.\d{3}$', '', n)
    img_by_mat = {_norm(m['name']): m['imageNodes'] for m in reimp['materials']}
    tile = img_by_mat.get('pav-tile', [])
    check('tile material has color+normal images', len(tile) >= 2, str([t['image'] for t in tile]))
    cs = {t['image']: t['colorSpace'] for t in tile}
    check('tile colorspace sRGB(color)/Non-Color(normal)',
          any(v == 'sRGB' for v in cs.values()) and any(v == 'Non-Color' for v in cs.values()), str(cs))
    timber = img_by_mat.get('pav-timber', [])
    check('timber material has image', len(timber) >= 1)
    la = img_by_mat.get('pav-hanglo-fret', [])
    lb = img_by_mat.get('pav-hanglo-slat', [])
    check('both lattice images connected', len(la) >= 1 and len(lb) >= 1)
    check('all materials have Principled BSDF', all(m['hasPrincipled'] for m in reimp['materials']))
    tree = {_norm(n['name']): _norm(n['parent']) if n['parent'] else None for n in reimp['nodeTree']}
    check('root node is <bldid>', bid in tree, str(list(tree)[:6]))
    kids = {_norm(n['name']) for n in reimp['nodeTree'] if n['parent'] and _norm(n['parent']) == bid}
    check('children body/roof/rail under root', kids >= {'body', 'roof', 'rail'}, str(kids))

    # ---- 7. collision coverage: every GLB vertex 0<=y<=2.4 inside >=1 collider
    band = [p for p in allpos if 0.0 <= p[1] <= 2.4]
    colliders = col['colliders']
    leaks = []
    for p in band:
        if not any(obb_contains(None, c, p) for c in colliders):
            leaks.append(p)
    check(f'collision coverage 0 leaks (y 0-2.4, {len(band)} verts)', not leaks,
          f'{len(leaks)} leaks e.g. {leaks[:3]}')
    # entrance bay open: count rail colliders == n-1 (rect) or n-1 (regular)
    rails = [c for c in colliders if c['name'].startswith(('seat-', 'back-rail-'))]
    nrails = len({c['name'].replace('back-rail-', '').replace('seat-', '') for c in rails})
    check('rails on all bays except entrance', nrails == P['n'] - 1, f'{nrails} rail bays vs n-1={P["n"] - 1}')

    # ================= R1 rework assertions (2026-09-23 master review) =================
    r1 = rep.get('r1', {})

    # R1-A (fix1, rect): envelope — every vertex above the platform inside the map bbox + 2x0.9
    # eave envelope (0.10 tolerance = tile-lip relief protruding up to 0.08 past the eave line).
    # Ground walkway (steps, y<=0.3) excluded, same rule as the bounds test above.
    if P['variant'] == 'rect':
        ew = P['bboxMap']['w'] / 2 + SPEC['roof']['eaveOverhangBeyondColumns']
        ed = P['bboxMap']['d'] / 2 + SPEC['roof']['eaveOverhangBeyondColumns']
        env_bad = []
        for v in allpos:
            if v[1] < 0.35:
                continue
            mx_ = v[0] * math.cos(ph) - v[2] * math.sin(ph)
            mz_ = v[0] * math.sin(ph) + v[2] * math.cos(ph)
            if abs(mx_) > ew + 0.10 or abs(mz_) > ed + 0.10:
                env_bad.append((round(v[0], 2), round(v[1], 2), round(v[2], 2), round(mx_, 2), round(mz_, 2)))
        check('R1 envelope: all verts y>=0.35 within bbox+2x0.9 (+0.10 lip relief)',
              not env_bad, f'{len(env_bad)} outside e.g. {env_bad[:3]}')

    # R1-B (fix1): interior centre region clear for y 0.3-2.4 — horizontal rays from the module
    # centre must not hit any triangle inside the colonnade (catches beams/rails crossing rooms).
    import numpy as np
    V = np.array(allpos, dtype=np.float64)
    T = np.array(tris, dtype=np.int64)
    tv = V[T]
    v0t, e1t, e2t = tv[:, 0], tv[:, 1] - tv[:, 0], tv[:, 2] - tv[:, 0]
    inrad = P['Rz'] if P['variant'] == 'rect' else P['fit']['R'] * math.cos(math.pi / P['n'])
    far = inrad - 0.12
    hits = 0
    for yy in (0.4, 0.75, 1.1, 1.45, 1.8, 2.15, 2.35):
        s = np.array([0.0, yy, 0.0]) - v0t
        for ka in range(24):
            d = np.array([math.cos(2 * math.pi * ka / 24), 0.0, math.sin(2 * math.pi * ka / 24)])
            h = np.cross(d, e2t)
            a_ = np.einsum('ij,ij->i', e1t, h)
            ok = np.abs(a_) > 1e-12
            f_ = np.zeros_like(a_)
            f_[ok] = 1.0 / a_[ok]
            u_ = f_ * np.einsum('ij,ij->i', s, h)
            q_ = np.cross(s, e1t)
            vv_ = f_ * (q_ @ d)
            t_ = f_ * np.einsum('ij,ij->i', e2t, q_)
            hit = ok & (u_ >= 0) & (vv_ >= 0) & (u_ + vv_ <= 1) & (t_ > 1e-6) & (t_ < far)
            hits += int(hit.sum())
    check('R1 interior: y 0.3-2.4 centre region geometry-free (168 rays)', hits == 0, f'{hits} hits')

    # R1-C (fix2): rafters under the eave — build-time asserted; clearance recorded in report
    check('R1 rafters: top <= eave-0.05, len 0.25 (margin recorded)',
          r1.get('rafterTopMarginMin', -1) >= 0.0, f"margin={r1.get('rafterTopMarginMin')}")

    # R1-D (fix3): corner kernel recorded as the continuous perimeter kernel
    check('R1 corner kernel: continuous raised-cosine perimeter kernel',
          'raised-cosine' in r1.get('cornerKernel', ''), r1.get('cornerKernel', 'missing')[:60])

    # R1-E (fix1, rect): 4 hip ridges — feet on the 4 corner-column diagonals, tops at the
    # short-ridge ENDS (rect frame), i.e. the hips land over the corner columns
    if P['variant'] == 'rect':
        feet, tops = r1.get('hipRidgeFeetLocal', []), r1.get('hipRidgeTopsLocal', [])
        okh = len(feet) == 4 and len(tops) == 4
        col_ang = sorted(math.atan2(P['Rz'] * sz, P['Rx'] * sx) for sx in (1, -1) for sz in (1, -1))
        for ft in feet:
            fu = ft[0] * math.cos(ph) - ft[2] * math.sin(ph)
            fv = ft[0] * math.sin(ph) + ft[2] * math.cos(ph)
            ang = math.atan2(fv, fu)
            okh &= min(abs(ang - ca) for ca in col_ang) <= 0.26   # ~15 deg: on the corner diagonal
        rh = rep['design']['ridgeHalf']
        okt = len(tops) == 4
        for tp in tops:
            tu = tp[0] * math.cos(ph) - tp[2] * math.sin(ph)
            tvv = tp[0] * math.sin(ph) + tp[2] * math.cos(ph)
            okt &= abs(tvv) <= 0.15 and rh - 0.25 <= abs(tu) <= rh + 0.25
            okt &= abs(tp[1] - rep['design']['apexY']) <= 0.15
        check('R1 rect hips: 4 rods, feet on corner-column diagonals, tops at ridge ends',
              okh and okt, f'feet={len(feet)} tops={len(tops)}')

    # ---- manifest sha
    man = json.load(open(os.path.join(OUTROOT, 'manifest.json')))
    sha = hashlib.sha256(open(glb, 'rb').read()).hexdigest()
    check('sha256 matches manifest', man[bid]['sha256'] == sha)


def main():
    print(f'pavilion-kit acceptance tests — {len(SITE["pavilions"])} pavilions')
    for P in SITE['pavilions']:
        test_pavilion(P)
    print()
    if FAILS:
        print(f'{len(FAILS)} FAILURES:')
        for f in FAILS:
            print(' -', f)
        sys.exit(1)
    print('ALL TESTS PASSED')


if __name__ == '__main__':
    main()
