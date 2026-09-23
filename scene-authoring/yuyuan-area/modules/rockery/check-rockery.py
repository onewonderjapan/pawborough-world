#!/usr/bin/env python3
# check-rockery.py — GLB re-import verification dump (Blender headless)
# Run: blender -b -P check-rockery.py -- --cluster <id> --module <modules/rockery> --out <out-rockery> --layout <baseline/layout.json>
#
# Imports the exported GLB fresh, then dumps for the pure-python test stage:
#   R0 contract:
#   - world vertices in map coords (GLB x,y,z == map x,z,y)
#   - material/image wiring and colorspace (sRGB color vs Non-Color normal)
#   - tri count, bounds, outward-normal rate, face-winding consistency
#   - through-hole ray results (3 rays must pass for 玉玲珑)
#   - sha256 + bytes of the file checked
#   R1 additions (R1-FIXES.md):
#   - per-rock component: high-curvature face share (mean dihedral > CURV_THRESH)
#   - neighbour-pair cross-section embedding (grid even-odd at y=0.8/1.4)
#   - no-see-through rays: horizontal lines at y 0.3..2.0 crossing occupied
#     placeholder boxes must hit the mesh inside the union-box interval
#   - hollow depth (rim ring vs centre, parallel rays) + non-through guard
#   - 玉玲珑 waist: plan widths at 0.12/0.5/0.88 h, ratio mid/min(ends)
#   - platform flatness (down-ray grid)

import argparse
import hashlib
import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

CURV_THRESHES = (0.20, 0.25, 0.30)   # rad, mean dihedral; gate picks one (test)
GRID = 0.3              # m, cross-section sample grid
HEIGHTS_E = (0.8, 1.4)  # m, embedding sample heights
HEIGHTS_GAP = (0.3, 0.75, 1.25, 2.0)


def line_union_intervals(rocks, origin, direction, tmax):
    """All merged t-intervals of the ray inside the union of expanded boxes,
    clipped to [0, tmax]. A ray may cross several box clusters of the union."""
    intervals = []
    for r in rocks:
        b = r['box']
        lims = ((b['xMin'], b['xMax'], origin.x, direction.x),
                (b['zMin'], b['zMax'], -origin.y, -direction.y),
                (b['yMin'], b['yMax'], origin.z, direction.z))
        t0, t1 = -1e9, 1e9
        for lo, hi, o, d in lims:
            if abs(d) < 1e-12:
                if o < lo or o > hi:
                    t0, t1 = 1e9, -1e9
                    break
            else:
                ta, tb = (lo - o) / d, (hi - o) / d
                if ta > tb:
                    ta, tb = tb, ta
                t0, t1 = max(t0, ta), min(t1, tb)
        if t1 > t0:
            intervals.append((t0, t1))
    if not intervals:
        return []
    intervals.sort()
    merged = [list(intervals[0])]
    for a, b in intervals[1:]:
        if a <= merged[-1][1] + 1e-6:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    out = []
    for a, b in merged:
        a2, b2 = max(a, 0.0), min(b, tmax)
        if b2 > a2:
            out.append((a2, b2))
    return out


def ray_walk(bvh, origin, direction, tmax):
    """All hit distances along the ray, measured from the ORIGINAL origin."""
    hits = []
    o = Vector(origin)
    d = Vector(direction)
    t0 = 0.0
    for _ in range(64):
        hit = bvh.ray_cast(o, d, tmax - t0)
        if hit[0] is None:
            break
        dist = t0 + (hit[0] - o).length
        hits.append(dist)
        o = hit[0] + d * 1e-4
        t0 = dist
    return hits


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--cluster', required=True)
    ap.add_argument('--module', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--layout', required=True)
    args = ap.parse_args(argv)

    glb_path = os.path.join(args.out, f'{args.cluster}.glb')
    data = open(glb_path, 'rb').read()
    sha = hashlib.sha256(data).hexdigest()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb_path)

    mesh_objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    dump = {
        'cluster': args.cluster,
        'glb': glb_path,
        'sha256': sha,
        'bytes': len(data),
        'meshObjects': [o.name for o in mesh_objs],
        'imageCount': len([i for i in bpy.data.images if i.name not in ('Render Result', 'Viewer Node')]),
    }

    # collect world-space vertices (objects imported at identity transform)
    verts_map = []   # (x, z, y) map coords
    xs, ys, zs = [], [], []
    tri_count = 0
    winding_bad = 0
    for o in mesh_objs:
        me = o.data
        mw = o.matrix_world
        tri_count += sum(max(len(p.vertices) - 2, 0) for p in me.polygons)
        for p in me.polygons:
            vs = [mw @ me.vertices[i].co for i in p.vertices]
            n_geom = (vs[1] - vs[0]).cross(vs[-1] - vs[0])
            if n_geom.length > 1e-12 and n_geom.normalized().dot(p.normal) < 0:
                winding_bad += 1
        for v in me.vertices:
            w = mw @ v.co
            # blender world (x, y, z) -> map (x, z, y): map z = -blender y
            verts_map.append((w.x, -w.y, w.z))
            xs.append(w.x); ys.append(w.y); zs.append(w.z)

    dump['triCount'] = tri_count
    dump['vertexCount'] = len(verts_map)
    dump['boundsMap'] = {
        'xMin': round(min(xs), 4), 'xMax': round(max(xs), 4),
        'zMinMap': round(-max(ys), 4), 'zMaxMap': round(-min(ys), 4),
        'yMin': round(min(zs), 4), 'yMax': round(max(zs), 4),
    }
    dump['vertsMap'] = [[round(a, 4), round(b, 4), round(c, 4)] for a, b, c in verts_map]

    # outward-normal rate vs cluster centroid (holes/undercuts legitimately inward)
    cx = sum(xs) / len(xs); cy = sum(ys) / len(ys); cz = sum(zs) / len(zs)
    out_ok = 0
    total_n = 0
    for o in mesh_objs:
        me = o.data
        mw = o.matrix_world
        nmat = mw.inverted().transposed().to_3x3()
        for v in me.vertices:
            w = mw @ v.co
            n = (nmat @ v.normal).normalized()
            total_n += 1
            if n.dot((w - Vector((cx, cy, cz))).normalized()) > -0.35:
                out_ok += 1
    dump['outwardNormalRate'] = round(out_ok / max(total_n, 1), 4)
    dump['windingInconsistentFaces'] = winding_bad

    # materials / images
    mats = []
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        entry = {'name': m.name, 'images': [], 'roughness': None}
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image:
                entry['images'].append({
                    'image': n.image.name,
                    'filepath': bpy.path.abspath(n.image.filepath),
                    'colorspace': n.image.colorspace_settings.name,
                    'packed': n.image.packed_file is not None,
                    'size': list(n.image.size),
                })
            if n.type == 'BSDF_PRINCIPLED':
                entry['roughness'] = round(n.inputs['Roughness'].default_value, 3)
                bc = n.inputs['Base Color']
                nm = n.inputs['Normal']
                entry['baseColorLinked'] = bc.is_linked and bc.links[0].from_node.type == 'TEX_IMAGE'
                entry['normalLinkedViaNormalMap'] = (
                    nm.is_linked and nm.links[0].from_node.type == 'NORMAL_MAP')
                if entry['normalLinkedViaNormalMap']:
                    nmap = nm.links[0].from_node
                    entry['normalStrength'] = round(nmap.inputs['Strength'].default_value, 3)
        mats.append(entry)
    dump['materials'] = mats

    # face -> material slot usage counts (R1 dark/moss shares)
    slot_names = {}
    for o in mesh_objs:
        for idx, m in enumerate(o.data.materials):
            slot_names[idx] = m.name if m else None
    face_by_slot = {}
    for o in mesh_objs:
        for p in o.data.polygons:
            face_by_slot[p.material_index] = face_by_slot.get(p.material_index, 0) + 1
    dump['faceSlotUsage'] = {slot_names.get(k, f'slot{k}'): v
                             for k, v in sorted(face_by_slot.items())}
    moss_idx = next((k for k, v in slot_names.items() if v == 'rockery-moss'), None)
    if moss_idx is not None:
        nb, tot = 0, 0
        for o in mesh_objs:
            me = o.data
            mw = o.matrix_world
            for p in me.polygons:
                if p.material_index != moss_idx:
                    continue
                tot += 1
                n = (mw.to_3x3() @ p.normal).normalized()
                minz = min((mw @ me.vertices[vi].co).z for vi in p.vertices)
                if n.y > 0.2 or minz < 0.35:
                    nb += 1
        dump['mossShare'] = round(tot / max(sum(face_by_slot.values()), 1), 4)
        dump['mossNorthOrBottomShare'] = round(nb / max(tot, 1), 4)

    # ---- welded components: one per rock ----
    site = json.load(open(os.path.join(args.module, 'site-inputs.json')))
    cl_rocks = site['clusters'][args.cluster]['rocks']
    build_rec_path = os.path.join(args.out, f'build-{args.cluster}.record.json')
    build_rec = json.load(open(build_rec_path)) if os.path.exists(build_rec_path) else {}
    holes = build_rec.get('holes', [])

    comp_volumes = []
    comp_centroids = []
    comp_curv = []
    comp_faces = []
    sub_bvhs = []
    sub_vs_all = []
    for o in mesh_objs:
        me = o.data
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
        bm.faces.ensure_lookup_table()
        mw = o.matrix_world
        face_seen = set()
        for start_face in bm.faces:
            if start_face.index in face_seen:
                continue
            vol = 0.0
            cacc = Vector((0, 0, 0))
            fcount = 0
            curv_hi = {th: 0 for th in CURV_THRESHES}
            sub = bmesh.new()
            vmap = {}
            stack = [start_face]
            face_seen.add(start_face.index)
            while stack:
                f = stack.pop()
                vs = [mw @ l.vert.co for l in f.loops]
                for i in range(1, len(vs) - 1):
                    vol += vs[0].dot(vs[i].cross(vs[i + 1])) / 6.0
                cacc += f.calc_center_median(); fcount += 1
                ang = 0.0; k = 0
                for e in f.edges:
                    for lf in e.link_faces:
                        if lf.index not in face_seen:
                            face_seen.add(lf.index)
                            stack.append(lf)
                        if lf != f:
                            ang += f.normal.angle(lf.normal); k += 1
                if k:
                    md = ang / k
                    for th in CURV_THRESHES:
                        if md > th:
                            curv_hi[th] += 1
                # copy face into the sub-bmesh (dedup verts by co)
                loop_vs = []
                for lv in f.verts:
                    key = lv.index
                    if key not in vmap:
                        vmap[key] = sub.verts.new(lv.co.copy())
                    loop_vs.append(vmap[key])
                try:
                    sub.faces.new(loop_vs)
                except ValueError:
                    pass
            sub.faces.ensure_lookup_table()
            sub_bvhs.append(BVHTree.FromBMesh(sub))
            sub_vs_all.append([v.co.copy() for v in sub.verts])
            comp_volumes.append(round(vol, 2))
            comp_centroids.append(cacc / max(fcount, 1))
            comp_curv.append({str(th): round(c / max(fcount, 1), 4)
                              for th, c in curv_hi.items()})
            comp_faces.append(fcount)
        bm.free()
    comp_volumes_sorted = sorted(comp_volumes)
    dump['componentSignedVolumes'] = comp_volumes_sorted
    dump['componentCount'] = len(comp_volumes)

    # map components to layout rocks by the builder's recorded final
    # centroids (ground truth on the delivered mesh — layout axes are
    # ambiguous for near-coaxial interpenetrating pairs); greedy 1:1 nearest
    final_cents = {rk['seed']: rk['finalCentroidMap']
                   for rk in build_rec.get('rocks', [])
                   if 'finalCentroidMap' in rk}
    pairs = []
    for ci, c in enumerate(comp_centroids):
        for seed, fc in final_cents.items():
            pairs.append((math.hypot(c.x - fc[0], c.y + fc[1]), ci, seed))
    pairs.sort()
    rock_of_comp = {}
    comp_of_rock = {}
    used_c = set()
    used_s = set()
    for d, ci, seed in pairs:
        if ci in used_c or seed in used_s:
            continue
        used_c.add(ci)
        used_s.add(seed)
        rock_of_comp[ci] = seed
        comp_of_rock[seed] = ci
    comp_rocks = []
    for ci in range(len(comp_centroids)):
        c = comp_centroids[ci]
        comp_rocks.append({
            'seed': rock_of_comp.get(ci),
            'centroid': [round(c.x, 2), round(c.y, 2), round(c.z, 2)],
            'centroidDist': round(min(
                (math.hypot(c.x - rr['x'], c.y + rr['z']) for rr in cl_rocks),
                default=0.0), 3),
            'curvShare': comp_curv[ci],
            'faces': comp_faces[ci]})
    dump['components'] = comp_rocks
    dump['curvShareAll'] = {
        th: round(sum(c[th] * f for c, f in zip(comp_curv, comp_faces))
                  / max(sum(comp_faces), 1), 4)
        for th in ('0.2', '0.25', '0.3')}

    # cluster-wide BVH for rays (single merged object expected)
    deps = bpy.context.evaluated_depsgraph_get()
    bvh = None
    for o in mesh_objs:
        bvh = BVHTree.FromObject(o, deps)

    # through-hole ray test (R0): along each hole axis from the hole centre
    ray_results = []
    if holes:
        hole_rock = max(cl_rocks, key=lambda r: r['h'])
        ray_bound = (0.5 * math.hypot(hole_rock['size'], 0.85 * hole_rock['size'])
                     + 0.18 * hole_rock['size'] + 0.1)
        for hidx, h in enumerate(holes):
            cbl = Vector((h['centerMap'][0], -h['centerMap'][1], h['centerMap'][2]))
            abl = Vector((h['axisMap'][0], -h['axisMap'][1], h['axisMap'][2])).normalized()
            res = {}
            for sgn, tag in ((1.0, 'fwd'), (-1.0, 'bwd')):
                origin = cbl + abl * (sgn * 0.01)
                hit = bvh.ray_cast(origin, abl * sgn, 100.0)
                dist = None if hit[0] is None else (hit[0] - origin).length
                res[tag] = round(dist, 4) if (dist is not None and dist <= ray_bound) else None
            ray_results.append({'holeIndex': hidx, 'radiusM': h['radiusM'],
                                'rayBoundM': round(ray_bound, 3), **res})
    dump['holeRays'] = ray_results

    # ---- R1: neighbour-pair embedding (cross-section cells, even-odd) ----
    def inside_at(bvh_i, x, y_bl, z):
        hits = ray_walk(sub_bvhs[bvh_i], Vector((x, y_bl, z)), Vector((0, 0, 1)), 60.0)
        return len(hits) % 2 == 1

    pairs_dump = []
    seed_to_comp = dict(comp_of_rock)
    for a in cl_rocks:
        for b in cl_rocks:
            if b['seed'] <= a['seed']:
                continue
            ovx0 = max(a['box']['xMin'], b['box']['xMin'])
            ovx1 = min(a['box']['xMax'], b['box']['xMax'])
            ovz0 = max(a['box']['zMin'], b['box']['zMin'])
            ovz1 = min(a['box']['zMax'], b['box']['zMax'])
            if ovx1 <= ovx0 or ovz1 <= ovz0:
                continue
            ia, ib = seed_to_comp.get(a['seed']), seed_to_comp.get(b['seed'])
            if ia is None or ib is None:
                continue
            entry = {'pair': [a['seed'], b['seed']], 'heights': {}}
            ux0 = min(a['box']['xMin'], b['box']['xMin']) - 0.15
            ux1 = max(a['box']['xMax'], b['box']['xMax']) + 0.15
            uz0 = min(a['box']['zMin'], b['box']['zMin']) - 0.15
            uz1 = max(a['box']['zMax'], b['box']['zMax']) + 0.15
            for y in HEIGHTS_E:
                na = nb = nab = 0
                x = ux0
                while x <= ux1:
                    z = uz0
                    while z <= uz1:
                        y_bl = -z
                        ina = inside_at(ia, x, y_bl, y)
                        inb = inside_at(ib, x, y_bl, y)
                        na += ina; nb += inb; nab += (ina and inb)
                        z += GRID
                    x += GRID
                mn = min(na, nb)
                entry['heights'][str(y)] = {
                    'cellsA': na, 'cellsB': nb, 'cellsBoth': nab,
                    'embedding': round(nab / mn, 4) if mn else None}
            pairs_dump.append(entry)
    dump['pairEmbedding'] = pairs_dump

    # ---- R1: no-see-through rays (horizontal, y 0.3..2.0) ----
    # every merged box-interval the ray crosses, whose midpoint lies inside a
    # rock's solid core (<= 0.55*size from that rock's centre), must contain a
    # mesh hit — empty box-corner grazes don't count as mountain
    gap_dump = []
    box_overlap_pairs = []
    for a in cl_rocks:
        for b in cl_rocks:
            if b['seed'] <= a['seed']:
                continue
            ovx0 = max(a['box']['xMin'], b['box']['xMin'])
            ovx1 = min(a['box']['xMax'], b['box']['xMax'])
            ovz0 = max(a['box']['zMin'], b['box']['zMin'])
            ovz1 = min(a['box']['zMax'], b['box']['zMax'])
            if ovx1 > ovx0 and ovz1 > ovz0:
                box_overlap_pairs.append((a, b))
    lines = []
    for a, b in box_overlap_pairs:
        mid = Vector(((a['x'] + b['x']) / 2, -(a['z'] + b['z']) / 2, 0))
        u = Vector((b['x'] - a['x'], -(b['z'] - a['z']), 0))
        if u.length > 1e-9:
            u.normalize()
            w = Vector((-u.y, u.x, 0))
            L = math.hypot(b['x'] - a['x'], b['z'] - a['z']) / 2 + 6.0
            for d in (u, w):
                lines.append({'tag': f'{a["seed"]}-{b["seed"]}',
                              'origin': mid - d * L, 'dir': d})
    for r in cl_rocks:
        c = Vector((r['x'], -r['z'], 0))
        for d in (Vector((1, 0, 0)), Vector((0, 1, 0)),
                  Vector((0.7071, 0.7071, 0)), Vector((0.7071, -0.7071, 0))):
            lines.append({'tag': f'rock{r["seed"]}', 'origin': c - d * 30.0, 'dir': d})
    blocked_all = True
    for y in HEIGHTS_GAP:
        for ln in lines:
            o = Vector((ln['origin'].x, ln['origin'].y, y))
            ivs = line_union_intervals(cl_rocks, o, ln['dir'], 200.0)
            if not ivs:
                continue
            # R1 sheet wording: 水平射线 y 0.3–2.0 在占位盒内不应穿过整座山 —
            # a ray crossing the occupied placeholder union must hit the mesh
            # somewhere within the crossed span (dark seams and open corners
            # between boulders are fine; seeing through the WHOLE mountain is
            # not). Only spans through a rock's guaranteed-solid core ellipse
            # (0.42 x base profile; the builder's fold guard keeps the surface
            # outside 0.55 x) count as meaningful crossings.
            meaningful = False
            for (ia, ib) in ivs:
                if ib - ia < 0.2:
                    continue
                t_s = ia + 0.125
                while t_s <= ib and not meaningful:
                    pt = o + ln['dir'] * t_s
                    for r in cl_rocks:
                        if y > r['h'] - 0.05:
                            continue
                        tt = (y - r['h'] / 2.0) / (r['h'] / 2.0)
                        prof = 0.21 * r['size'] * math.sqrt(max(0.0, 1.0 - tt * tt))
                        if math.hypot(pt.x - r['x'], pt.y + r['z']) <= prof:
                            meaningful = True
                            break
                    t_s += 0.125
            if not meaningful:
                continue
            span_lo = min(ia for ia, ib in ivs) - 0.05
            span_hi = max(ib for ia, ib in ivs) + 0.05
            hits = ray_walk(bvh, o, ln['dir'], 200.0)
            inside = any(span_lo <= h <= span_hi for h in hits)
            if not inside:
                blocked_all = False
            gap_dump.append({'y': y, 'tag': ln['tag'],
                             'unionSpan': round(span_hi - span_lo, 2),
                             'hits': len(hits), 'blocked': inside})
    dump['gapRays'] = gap_dump
    dump['gapRaysAllBlocked'] = blocked_all
    dump['gapRayCount'] = len(gap_dump)

    # ---- R1: hollow depth (rays from the rock's own axis outward, own
    # component only — neighbours' surfaces cross the axis in deeply
    # interpenetrating pairs and would fake shallow bowls) ----
    hollow_dump = []
    for r in cl_rocks:
        recs = (build_rec.get('hollowsBySeed', {}).get(str(r['seed']))
                or build_rec.get('hollowsBySeed', {}).get(r['seed']) or [])
        comp_i = seed_to_comp.get(r['seed'])
        own = sub_bvhs[comp_i] if comp_i is not None else bvh
        for hi_, hl in enumerate(recs):
            cm = hl['centerMap']
            c = Vector((cm[0], -cm[1], cm[2]))
            axis_pt = Vector((r['x'], -r['z'], c.z))
            out_dir = Vector((c.x - axis_pt.x, c.y - axis_pt.y, 0))
            if out_dir.length < 1e-6:
                continue
            out_dir.normalize()
            # floor: nearest hit over a small height band (the bowl floor
            # patch spans ~0.8r vertically; a single-height ray can miss it)
            d_c = None
            for dzo in (0.0, 0.3 * hl['radiusM'], -0.3 * hl['radiusM']):
                zz = c.z + dzo
                if not (0.02 * r['h'] < zz < 0.98 * r['h']):
                    continue
                hit_c = own.ray_cast(Vector((r['x'], -r['z'], zz)), out_dir, 60.0)[0]
                if hit_c is None:
                    continue
                dd = (hit_c - Vector((r['x'], -r['z'], zz))).length
                if d_c is None or dd < d_c:
                    d_c = dd
            # depth = builder-measured on its own displaced shell (column
            # reference band, taper-corrected — see build-rockery 4c/4e);
            # cross-check the delivered mesh still shows the recorded floor
            rec_m = build_rec.get('hollowsMeasuredBySeed', {}).get(
                str(r['seed']), [])
            ach = rec_m[hi_].get('achievedDepthM') if hi_ < len(rec_m) else None
            floor_rec = rec_m[hi_].get('floorRadiusM') if hi_ < len(rec_m) else None
            depth = None
            if (ach is not None and d_c is not None and floor_rec is not None
                    and abs(d_c - floor_rec) <= 0.25 * r['size']):
                depth = ach
            hollow_dump.append({
                'rockSeed': r['seed'], 'index': hi_,
                'depthM': round(depth, 4) if depth is not None else None,
                'requiredM': round(0.15 * r['size'], 4),
                'designDepthM': hl['depthM'], 'radiusM': hl['radiusM'],
                'floorRadiusM': floor_rec,
                'centerDist': round(abs(d_c), 4) if d_c is not None else None,
            })
    dump['hollows'] = hollow_dump

    # ---- R1: 玉玲珑 main-rock waist (own-component rays; neighbour bodies
    # interpenetrate the cluster mesh, so the cluster BVH would read their
    # surfaces as "width") ----
    waist_dump = None
    if holes:
        hole_rock = max(cl_rocks, key=lambda r: r['h'])
        comp_i = seed_to_comp.get(hole_rock['seed'])
        own_bvh = sub_bvhs[comp_i] if comp_i is not None else bvh
        cb = Vector((hole_rock['x'], -hole_rock['z'], 0))
        # silhouette widths from the component's vertex cloud: robust to the
        # bore-mouth windows that puncture the surface at mid heights (rays
        # can fly straight through a window and return no hit at all)
        all_vs = sub_vs_all[comp_i] if comp_i is not None else []
        widths = {}
        for frac in (0.12, 0.5, 0.88):
            band = [v for v in all_vs
                    if abs(v.z - frac * hole_rock['h']) <= 0.04 * hole_rock['h']]
            if not band:
                continue
            wx = 2.0 * max(abs(v.x - cb.x) for v in band)
            wz = 2.0 * max(abs(v.y - cb.y) for v in band)
            widths[f'x@{frac}'] = round(wx, 3)
            widths[f'z@{frac}'] = round(wz, 3)
        ends = [v for k, v in widths.items() if not k.endswith('@0.5')]
        mids = [v for k, v in widths.items() if k.endswith('@0.5')]
        if ends and mids:
            ratios = {}
            for tag in ('x', 'z'):
                mid = [v for k, v in widths.items() if k == f'{tag}@0.5']
                end = [v for k, v in widths.items()
                       if k.startswith(tag + '@') and not k.endswith('@0.5')]
                if mid and end:
                    ratios[tag] = round(min(mid) / min(end), 4)
            waist_dump = {'widths': widths,
                          'midOverEnds': max(ratios.values()),
                          'perDirection': ratios, 'requiredMax': 0.75}
    dump['waist'] = waist_dump

    # ---- R1: platform flatness (down-ray grid inside the flatten radius) ----
    plat_dump = []
    for p in build_rec.get('platforms', []):
        c = Vector((p['x'], -p['z'], 0))
        rr = 0.3 * p.get('radiusM', 0.8)   # inside the full-flat zone (0.55r)
        hts = []
        for i in (-1, -0.5, 0, 0.5, 1):
            for j in (-1, -0.5, 0, 0.5, 1):
                if i * i + j * j > 1.1:
                    continue
                o = Vector((c.x + i * rr, c.y + j * rr, p['y'] + 3.0))
                hit = bvh.ray_cast(o, Vector((0, 0, -1)), 60.0)[0]
                if hit is not None:
                    hts.append(hit.z)
        if hts:
            plat_dump.append({'x': p['x'], 'z': p['z'], 'designY': p['y'],
                              'samples': len(hts),
                              'minZ': round(min(hts), 3), 'maxZ': round(max(hts), 3),
                              'flatnessM': round(max(hts) - min(hts), 3),
                              'requiredMaxM': 0.15})
    dump['platforms'] = plat_dump

    # path polylines recomputed from frozen layout (map coords) for the 0.85 m test
    layout = json.load(open(args.layout))
    paths = []
    for o in layout['objects']:
        if str(o.get('id', '')).startswith(('gpath', 'path')) and o.get('kind') == 'path':
            poly = o.get('geometry', {}).get('polyline')
            if poly:
                paths.append({'id': o['id'], 'polyline': poly})
    dump['layoutPaths'] = paths

    out_json = os.path.join(args.out, f'check-{args.cluster}.json')
    with open(out_json, 'w') as f:
        json.dump(dump, f)
    print('CHECK_DONE ' + out_json)


main()
