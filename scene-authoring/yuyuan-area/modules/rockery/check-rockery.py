#!/usr/bin/env python3
# check-rockery.py — GLB re-import verification dump (Blender headless)
# Run: blender -b -P check-rockery.py -- --cluster <id> --module <modules/rockery> --out <out-rockery> --layout <baseline/layout.json>
#
# Imports the exported GLB fresh, then dumps for the pure-python test stage:
#   - world vertices in map coords (GLB x,y,z == map x,z,y)
#   - material/image wiring and colorspace (sRGB color vs Non-Color normal)
#   - tri count, bounds, outward-normal rate, face-winding consistency
#   - through-hole ray results (3 rays must pass for 玉玲珑)
#   - sha256 + bytes of the file checked

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

    # through-hole ray test: along each hole axis from the hole centre, the hole
    # rock's own tunnel must be clear. Hits beyond the hole rock's max surface
    # radius belong to NEIGHBOUR rocks in the cluster and don't count.
    site = json.load(open(os.path.join(args.module, 'site-inputs.json')))
    cl_rocks = site['clusters'][args.cluster]['rocks']
    holes_path = os.path.join(args.out, f'build-{args.cluster}.record.json')
    holes = []
    if os.path.exists(holes_path):
        holes = json.load(open(holes_path)).get('holes', [])
    ray_results = []
    if holes:
        hole_rock = max(cl_rocks, key=lambda r: r['h'])
        import math as _m
        ray_bound = (0.5 * _m.hypot(hole_rock['size'], 0.85 * hole_rock['size'])
                     + 0.18 * hole_rock['size'] + 0.1)
        deps = bpy.context.evaluated_depsgraph_get()
        bvh = None
        for o in mesh_objs:
            t = BVHTree.FromObject(o, deps)
            bvh = t if bvh is None else bvh  # single merged object expected
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

    # outward normals: weld the per-corner-split reimport, then every connected
    # component (= one rock, or rocks the decimate welded together) must have
    # positive signed volume — detects inverted normals regardless of winding state
    comp_volumes = []
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
            stack = [start_face]
            face_seen.add(start_face.index)
            while stack:
                f = stack.pop()
                vs = [mw @ l.vert.co for l in f.loops]
                for i in range(1, len(vs) - 1):
                    vol += vs[0].dot(vs[i].cross(vs[i + 1])) / 6.0
                for e in f.edges:
                    for lf in e.link_faces:
                        if lf.index not in face_seen:
                            face_seen.add(lf.index)
                            stack.append(lf)
            comp_volumes.append(round(vol, 2))
        bm.free()
    comp_volumes.sort()
    dump['componentSignedVolumes'] = comp_volumes
    dump['componentCount'] = len(comp_volumes)

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
