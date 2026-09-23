#!/usr/bin/env python3
# Generic mesh integrity stats, extracted from modules/rockery/check-rockery-r2.py.
# Weld at 1e-4 m, then count shells, open edges, and faces buried inside a solid.
#
#   blender -b -P scripts/mesh-integrity.py -- <glb> [--groups <json>] [--out <json>]
#
# A buried face is one whose outward ray hits another face facing the same way.
# Hit a face in the same shell -> selfFold. Hit a face in another shell -> buried.
# Shells are face-connected components after the weld.
# boundaryEdges / nonManifoldEdges match the rockery checker (a boundary edge
# is also counted as non-manifold).

import argparse
import json
import os
import sys

import bpy
import bmesh
from mathutils.bvhtree import BVHTree


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('glb')
    ap.add_argument('--groups', default=None)
    ap.add_argument('--out', default=None)
    return ap.parse_args(argv)


def load_mesh(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    bm = bmesh.new()
    for o in objs:
        me = o.data.copy()
        me.transform(o.matrix_world)
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.normal_update()
    bm.faces.ensure_lookup_table()
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    return bm, len(objs)


def shells_of(bm):
    comp = {}
    cid = 0
    for f in bm.faces:
        if f.index in comp:
            continue
        stack = [f]
        comp[f.index] = cid
        while stack:
            face = stack.pop()
            for e in face.edges:
                for g in e.link_faces:
                    if g.index not in comp:
                        comp[g.index] = cid
                        stack.append(g)
        cid += 1
    return comp, cid


def group_report(bm, comp, path):
    """Optional. JSON list of {id, box:{xMin..zMax}} in map metres (X east, Y up, Z south)."""
    spec = json.load(open(path, encoding='utf-8'))
    if isinstance(spec, dict):
        spec = spec.get('groups') or spec.get('rocks') or []
    report = []
    for g in spec:
        box = g.get('box') or g
        gid = g.get('id') or g.get('seed') or g.get('name') or 'group'
        shells = set()
        for f in bm.faces:
            c = f.calc_center_median()
            x, y, z = c.x, c.z, -c.y
            if (box['xMin'] <= x <= box['xMax'] and box['yMin'] <= y <= box['yMax']
                    and box['zMin'] <= z <= box['zMax']):
                shells.add(comp[f.index])
        report.append({'id': gid, 'shells': len(shells)})
    return report


def main():
    args = parse_args()
    glb = os.path.abspath(args.glb)
    bm, mesh_objects = load_mesh(glb)
    nfaces = len(bm.faces)
    comp, nshell = shells_of(bm) if nfaces else ({}, 0)
    tris = sum(len(f.verts) - 2 for f in bm.faces)
    boundary = sum(1 for e in bm.edges if e.is_boundary)
    nonmanifold = sum(1 for e in bm.edges if not e.is_manifold)
    buried = 0
    folded = 0
    if nfaces:
        bvh = BVHTree.FromBMesh(bm)
        for f in bm.faces:
            n = f.normal
            if n.length < 1e-9:
                continue
            hit = bvh.ray_cast(f.calc_center_median() + n * 1e-3, n, 60)
            if hit[0] is None or hit[1].dot(n) <= 0:
                continue
            other = hit[2]
            if other is None or other not in comp:
                continue
            if comp[other] == comp[f.index]:
                folded += 1
            else:
                buried += 1
    out = {
        'file': glb,
        'tris': tris,
        'shells': nshell,
        'boundaryEdges': boundary,
        'nonManifoldEdges': nonmanifold,
        'buriedFaceShare': round(buried / nfaces, 4) if nfaces else 0.0,
        'selfFoldShare': round(folded / nfaces, 4) if nfaces else 0.0,
    }
    if args.groups:
        out['groups'] = group_report(bm, comp, args.groups)
    text = json.dumps(out, ensure_ascii=False, indent=2)
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as fh:
            fh.write(text + '\n')
    print(text)
    bm.free()


if __name__ == '__main__':
    main()
