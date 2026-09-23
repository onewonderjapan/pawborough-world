#!/usr/bin/env python3
# check-rockery-r2.py — measure a delivered rockery GLB (Blender headless).
# Run: blender -b -P check-rockery-r2.py -- --cluster <id> --module <modules/rockery> --out <out-rockery-r2>
# Reads <out>/<cluster>.glb + build record, writes <out>/check-<cluster>.json.
# Everything is measured on the exported GLB (re-imported), never on build-side
# numbers; the build record only supplies where the features were designed.

import argparse
import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def bl(x, y, z):          # map (x, y-up, z-south) -> Blender
    return Vector((x, -z, y))


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--cluster', required=True)
    ap.add_argument('--module', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args(argv)
    site = json.load(open(os.path.join(args.module, 'site-inputs.json'), encoding='utf-8'))
    cl = site['clusters'][args.cluster]
    rocks = cl['rocks']
    rec = json.load(open(os.path.join(args.out, f'build-{args.cluster}.record.json'), encoding='utf-8'))
    glb = os.path.join(args.out, f'{args.cluster}.glb')

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    bm = bmesh.new()
    mat_names = []
    for o in objs:
        me = o.data.copy()
        me.transform(o.matrix_world)
        base = len(mat_names)
        mat_names += [m.name if m else '' for m in me.materials]
        for p in me.polygons:
            p.material_index += base
        bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.normal_update()
    bm.faces.ensure_lookup_table()
    bm.verts.ensure_lookup_table()
    out = {'cluster': args.cluster, 'glb': glb, 'glbBytes': os.path.getsize(glb)}
    out['tris'] = sum(len(f.verts) - 2 for f in bm.faces)
    out['budget'] = site['budget'][args.cluster.replace('rockery-', '')]
    out['boundaryEdges'] = sum(1 for e in bm.edges if e.is_boundary)
    out['nonManifoldEdges'] = sum(1 for e in bm.edges if not e.is_manifold)

    # components vs box-overlap groups
    comp = {}
    cid = 0
    for f in bm.faces:
        if f.index in comp:
            continue
        st = [f]; comp[f.index] = cid
        while st:
            x = st.pop()
            for e in x.edges:
                for g in e.link_faces:
                    if g.index not in comp:
                        comp[g.index] = cid; st.append(g)
        cid += 1
    out['components'] = cid
    adj = {r['seed']: set() for r in rocks}
    for i, a in enumerate(rocks):
        for b in rocks[i + 1:]:
            A, B = a['box'], b['box']
            if min(A['xMax'], B['xMax']) > max(A['xMin'], B['xMin']) and \
               min(A['zMax'], B['zMax']) > max(A['zMin'], B['zMin']):
                adj[a['seed']].add(b['seed']); adj[b['seed']].add(a['seed'])
    groups, seen = [], set()
    for s in adj:
        if s in seen:
            continue
        g, st = [], [s]; seen.add(s)
        while st:
            x = st.pop(); g.append(x)
            for y in adj[x]:
                if y not in seen:
                    seen.add(y); st.append(y)
        groups.append(sorted(g))
    out['boxGroups'] = groups
    # which group does each component live in (by its vertices' boxes)
    comp_groups = {}
    for f in bm.faces:
        c = f.calc_center_median()
        mx, mz = c.x, -c.y
        for gi, g in enumerate(groups):
            if any(r['box']['xMin'] <= mx <= r['box']['xMax'] and r['box']['zMin'] <= mz <= r['box']['zMax']
                   for r in rocks if r['seed'] in g):
                comp_groups.setdefault(comp[f.index], set()).add(gi)
                break
    out['componentsPerGroup'] = [sum(1 for c, gs in comp_groups.items() if gi in gs) for gi in range(len(groups))]
    out['componentsSpanningGroups'] = sum(1 for gs in comp_groups.values() if len(gs) > 1)

    # vertices inside the (already +0.3 m expanded) placeholder boxes
    outside = 0
    for v in bm.verts:
        x, y, z = v.co.x, v.co.z, -v.co.y
        if not any(r['box']['xMin'] - 1e-4 <= x <= r['box']['xMax'] + 1e-4 and
                   r['box']['zMin'] - 1e-4 <= z <= r['box']['zMax'] + 1e-4 and
                   r['box']['yMin'] - 1e-4 <= y <= r['box']['yMax'] + 1e-4 for r in rocks):
            outside += 1
    out['verticesOutsideBoxes'] = outside

    # path clearance (xz distance of every vertex to every nearby path polyline)
    def seg_d(px, pz, a, b):
        ax, az = a; bx, bz = b
        dx, dz = bx - ax, bz - az
        L = dx * dx + dz * dz
        t = 0.0 if L == 0 else max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / L))
        return math.hypot(px - (ax + t * dx), pz - (az + t * dz))
    best = (1e9, None)
    for pth in cl.get('pathsNear', []):
        pl = pth['polyline']
        for v in bm.verts:
            x, z = v.co.x, -v.co.y
            for a, b in zip(pl, pl[1:]):
                d = seg_d(x, z, a, b)
                if d < best[0]:
                    best = (d, pth['id'])
    out['minPathDistanceM'] = round(best[0], 3)
    out['minPathId'] = best[1]

    bvh = BVHTree.FromBMesh(bm)

    # buried / folded faces: a ray along the face normal that hits a face facing
    # the same way means the face sits inside the solid
    buried = 0
    for f in bm.faces:
        n = f.normal
        if n.length < 1e-9:
            continue
        hit = bvh.ray_cast(f.calc_center_median() + n * 1e-3, n, 60)
        if hit[0] is not None and hit[1].dot(n) > 0:
            buried += 1
    out['buriedFaceShare'] = round(buried / len(bm.faces), 4)

    def inside(p):
        cnt = 0
        o = p.copy()
        d = Vector((0.0, 0.0, 1.0))
        for _ in range(64):
            h = bvh.ray_cast(o, d, 100)
            if h[0] is None:
                break
            cnt += 1
            o = h[0] + d * 1e-4
        return cnt % 2 == 1

    # hollows: depth measured on the mesh along the design axis. t0 = hit at the
    # bowl centre, rim = median hit of 8 parallel rays offset 1.25x the mouth
    # radius; depth = t0 - rim. Non-through: the axis must re-enter solid behind.
    hol = []
    for hl in rec['hollows']:
        d = Vector((hl['dir'][0], -hl['dir'][2], hl['dir'][1]))
        s = bl(*hl['surface'])
        start = s + d * 3.0
        h0 = bvh.ray_cast(start, -d, 6.0)
        if h0[0] is None:
            hol.append({'seed': hl['seed'], 'depthM': None}); continue
        t0 = h0[3]
        up = Vector((0, 0, 1))
        side = d.cross(up).normalized()
        mouth = max(hl['radii'][0], hl['radii'][2]) * 1.25
        ts = []
        for k in range(8):
            a = 2 * math.pi * k / 8
            off = side * (math.cos(a) * mouth) + up * (math.sin(a) * mouth * hl['radii'][1] / hl['radii'][0])
            h = bvh.ray_cast(start + off, -d, 6.0)
            if h[0] is not None:
                ts.append(h[3])
        if len(ts) < 5:
            hol.append({'seed': hl['seed'], 'depthM': None}); continue
        ts.sort()
        rim = ts[len(ts) // 2]
        depth = t0 - rim
        # non-through: behind the bowl floor the solid continues
        floor = h0[0]
        behind = inside(floor - d * 0.08)
        hol.append({'seed': hl['seed'], 'size': hl['size'], 'depthM': round(depth, 3),
                    'needM': round(0.15 * hl['size'], 3), 'nonThrough': behind,
                    'ok': depth >= 0.15 * hl['size'] and behind})
    out['hollows'] = hol
    per = {}
    for h in hol:
        per.setdefault(h['seed'], 0)
        if h.get('ok'):
            per[h['seed']] += 1
    out['hollowsOkPerSeed'] = {str(r['seed']): per.get(r['seed'], 0) for r in rocks}

    # through-holes: ray along each bore axis from outside to outside
    bores = []
    for b in rec.get('bores', []):
        a = bl(*b['a']); e = bl(*b['b'])
        d = (e - a).normalized()
        L = (e - a).length
        h = bvh.ray_cast(a - d * 0.5, d, L + 1.0)
        centre_inside = inside(bl(*b['centre']))
        bores.append({'radiusM': b['r'], 'clear': h[0] is None, 'centreInsideSolid': centre_inside})
    out['bores'] = bores

    # waist (玉玲珑 main rock): plan widths along x and z of the vertices in the
    # main rock's box column at 0.2h / 0.48h / 0.8h (±0.05h)
    if rec.get('waistSeed') is not None:
        r = next(rr for rr in rocks if rr['seed'] == rec['waistSeed'])
        b = r['box']
        def widths(frac):
            yy = frac * r['h']
            xs, zs = [], []
            for v in bm.verts:
                x, y, z = v.co.x, v.co.z, -v.co.y
                if abs(y - yy) <= 0.05 * r['h'] and b['xMin'] <= x <= b['xMax'] and b['zMin'] <= z <= b['zMax']:
                    xs.append(x); zs.append(z)
            if len(xs) < 4:
                return None
            return {'x': max(xs) - min(xs), 'z': max(zs) - min(zs)}
        w = {k: widths(f) for k, f in (('bottom', 0.2), ('mid', 0.48), ('top', 0.8))}
        if all(w.values()):
            ratio = {ax: round(w['mid'][ax] / max(w['top'][ax], w['bottom'][ax]), 4) for ax in ('x', 'z')}
            ratio_min_end = {ax: round(w['mid'][ax] / min(w['top'][ax], w['bottom'][ax]), 4) for ax in ('x', 'z')}
            out['waist'] = {'widths': {k: {a: round(v2, 3) for a, v2 in v.items()} for k, v in w.items()},
                            'midOverWiderEnd': ratio, 'midOverNarrowerEnd': ratio_min_end}
        else:
            out['waist'] = None

    # platforms: downward rays on a grid within 0.6 r of each platform centre
    plats = []
    for pl in rec.get('platforms', []):
        hs = []
        rr = 0.6 * pl['r']
        for i in range(-3, 4):
            for j in range(-3, 4):
                dx, dz = i / 3 * rr, j / 3 * rr
                if dx * dx + dz * dz > rr * rr:
                    continue
                h = bvh.ray_cast(bl(pl['x'] + dx, 20.0, pl['z'] + dz), Vector((0, 0, -1)), 40.0)
                if h[0] is not None:
                    hs.append(h[0].z)
        spread = (max(hs) - min(hs)) if hs else None
        plats.append({'seed': pl['seed'], 'y': pl['y'], 'samples': len(hs),
                      'spreadM': round(spread, 3) if spread is not None else None,
                      'ok': spread is not None and spread <= 0.15 and len(hs) >= 20})
    out['platforms'] = plats

    # joined rocks: points on the saddle between every pair of overlapping
    # neighbours (t = 0.35/0.5/0.65, y = 0.3 m) must be inside the solid
    sad = []
    for i, a in enumerate(rocks):
        for b2 in rocks[i + 1:]:
            A, B = a['box'], b2['box']
            ox = min(A['xMax'], B['xMax']) - max(A['xMin'], B['xMin'])
            oz = min(A['zMax'], B['zMax']) - max(A['zMin'], B['zMin'])
            if ox > 0.3 and oz > 0.3:
                pts = [inside(bl(a['x'] + t * (b2['x'] - a['x']), yy, a['z'] + t * (b2['z'] - a['z'])))
                       for t in (0.35, 0.5, 0.65) for yy in (0.3, 0.6)]
                sad.append({'pair': [a['seed'], b2['seed']], 'solid': pts})
    out['saddles'] = sad

    # materials
    mat_of = [mat_names[f.material_index] if f.material_index < len(mat_names) else '' for f in bm.faces]
    n = len(bm.faces)
    moss = [f for f, m in zip(bm.faces, mat_of) if 'moss' in m]
    dark = sum(1 for m in mat_of if 'dark' in m)
    out['materials'] = {
        'names': sorted(set(mat_names)),
        'mossShare': round(len(moss) / n, 4),
        'mossNorthOrBottom': all(f.normal.y > 0.2 or f.calc_center_median().z < 0.35 for f in moss),
        'darkShare': round(dark / n, 4),
        'hollowFacesDarkShare': None,
    }
    json.dump(out, open(os.path.join(args.out, f'check-{args.cluster}.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    brief = {k: out[k] for k in ('tris', 'components', 'componentsPerGroup', 'boundaryEdges', 'nonManifoldEdges',
                                 'verticesOutsideBoxes', 'minPathDistanceM', 'buriedFaceShare')}
    print('CHECK', json.dumps(brief, ensure_ascii=False))
    print('HOLLOWS_OK', out['hollowsOkPerSeed'])
    print('HOLLOW_FAIL', [h for h in hol if not h.get('ok')][:12])
    print('BORES', bores, 'WAIST', out.get('waist'))
    print('PLATFORMS', plats)
    print('SADDLES', [s for s in sad if not all(s['solid'])])
    print('MATERIALS', out['materials'])


if __name__ == '__main__':
    main()
