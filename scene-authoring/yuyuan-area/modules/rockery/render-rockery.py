#!/usr/bin/env python3
# render-rockery.py — Cycles CPU renders with blank-frame guard (Blender headless)
# Run: blender -b -P render-rockery.py -- --cluster <id> --mode after|before \
#        --out <out-rockery> --module <modules/rockery> --main <main repo root>
#
# after  : import out-rockery/<cluster>.glb (the new rockery)
# before : import <main>/scene-authoring/yuyuan-area/out/procedural-garden.glb (READ-ONLY)
#          and render with the same cameras (procedural rocks baseline).
# Views: A (side 3/4), B (opposite side), C (aerial), close (tallest rock close-up).

import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector

RES = (960, 540)
SAMPLES = 64


def hex_rgb(c):
    c = c.lstrip('#')
    return tuple(int(c[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = RES
    sc.render.image_settings.file_format = 'PNG'

    world = bpy.data.worlds.new('w')
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (*hex_rgb('aab6bf'), 1.0)
    bg.inputs['Strength'].default_value = 0.9

    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(52), 0, math.radians(-35))
    bpy.context.collection.objects.link(sun)

    import bmesh
    me = bpy.data.meshes.new('ground')
    b = bmesh.new()
    a = b.verts.new((-90, -90, 0)); bb = b.verts.new((90, -90, 0))
    c = b.verts.new((90, 90, 0)); d = b.verts.new((-90, 90, 0))
    b.faces.new((a, bb, c, d))
    b.to_mesh(me)
    b.free()
    gm = bpy.data.materials.new('ground')
    gm.use_nodes = True
    gb = gm.node_tree.nodes['Principled BSDF']
    gb.inputs['Base Color'].default_value = (0.30, 0.30, 0.29, 1)
    gb.inputs['Roughness'].default_value = 1.0
    me.materials.append(gm)
    ground = bpy.data.objects.new('ground', me)
    bpy.context.collection.objects.link(ground)
    return sc


def add_cam(name, pos, target):
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    cam.data.lens = 50
    cam.location = pos
    d = Vector(target) - Vector(pos)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.collection.objects.link(cam)
    return cam


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--cluster', required=True)
    ap.add_argument('--mode', required=True, choices=['after', 'before'])
    ap.add_argument('--out', required=True)
    ap.add_argument('--module', required=True)
    ap.add_argument('--main', required=True)
    ap.add_argument('--src-glb', default=None,
                    help='override the source GLB (R1: before = the R0 delivery '
                         'GLB at 26a63b85, same cameras)')
    args = ap.parse_args(argv)

    site = json.load(open(os.path.join(args.module, 'site-inputs.json')))
    cl = site['clusters'][args.cluster]
    rocks = cl['rocks']
    cx = sum(r['x'] for r in rocks) / len(rocks)
    cz = sum(r['z'] for r in rocks) / len(rocks)
    cbl = Vector((cx, -cz, 0))
    hmax = cl['layoutHeight']

    tallest = max(rocks, key=lambda r: r['h'])
    tbl = Vector((tallest['x'], -tallest['z'], tallest['h'] / 2))

    scale = 1.0 if args.cluster == 'rockery-yulinglong' else 2.1
    views = {
        'A': (cbl + Vector((13.0 * scale, -9.5 * scale, 5.5 * scale)), (cbl.x, cbl.y, hmax * 0.45)),
        'B': (cbl + Vector((-14.5 * scale, -2.0 * scale, 3.8 * scale)), (cbl.x, cbl.y, hmax * 0.45)),
        'C': (cbl + Vector((7.0 * scale, 9.5 * scale, 12.0 * scale)), (cbl.x, cbl.y, 0.5)),
        'close': (tbl + Vector((3.2 * scale, 2.8 * scale, 1.2 * scale)), (tbl.x, tbl.y, tbl.z)),
    }

    sc = setup_scene()
    if args.src_glb:
        glb = args.src_glb
        isolate = False       # R0 site-module GLB: rockery-only already
    elif args.mode == 'after':
        glb = os.path.join(args.out, f'{args.cluster}.glb')
        isolate = False
    else:
        glb = os.path.join(args.main, 'scene-authoring', 'yuyuan-area', 'out',
                           'procedural-garden.glb')
        isolate = True
    bpy.ops.import_scene.gltf(filepath=glb)
    if isolate:
        # spec: render the procedural-garden.glb ROCKS with the same camera —
        # the module's water/buildings occlude the rocks, so keep rockery only
        removed = 0
        for o in list(bpy.context.scene.objects):
            if o.type == 'MESH' and 'rockery' not in o.name:
                bpy.data.objects.remove(o, do_unlink=True)
                removed += 1
        print('BEFORE_ISOLATION removed', removed, 'kept',
              [o.name for o in bpy.context.scene.objects if o.type == 'MESH'])
    imported = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    print('IMPORTED_MESHES', len(imported), [o.name for o in imported][:4])

    outdir = os.path.join(args.out, 'renders')
    os.makedirs(outdir, exist_ok=True)
    for vname, (pos, target) in views.items():
        cam = add_cam(f'cam-{vname}', pos, target)
        sc.camera = cam
        sc.render.filepath = os.path.join(outdir, f'{args.cluster}-{args.mode}-{vname}.png')
        bpy.ops.render.render(write_still=True)

    # blank-frame guard (runs on every render; numpy ships with Blender, no PIL here)
    import numpy as np
    for vname in views:
        p = os.path.join(outdir, f'{args.cluster}-{args.mode}-{vname}.png')
        img = bpy.data.images.load(p)
        w, h = img.size
        buf = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(buf)
        bpy.data.images.remove(img)
        rgb = (buf.reshape(-1, 4)[:, :3] * 255.0)
        lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
        std = float(lum.std())
        packed = (rgb[:, 0].astype(np.uint32) << 16) | (rgb[:, 1].astype(np.uint32) << 8) | rgb[:, 2].astype(np.uint32)
        _, counts = np.unique(packed, return_counts=True)
        dom = float(counts.max()) / float(len(packed))
        status = 'OK'
        if std < 2.0 or dom > 0.95:
            status = 'BLANK_FAIL'
        print(f'BLANKGUARD {args.cluster}-{args.mode}-{vname} std={std:.2f} dom={dom:.3f} {status}')
        if status == 'BLANK_FAIL':
            sys.exit(9)
    print('RENDER_DONE', args.cluster, args.mode)


main()
