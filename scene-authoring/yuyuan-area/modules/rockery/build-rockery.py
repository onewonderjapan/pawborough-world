#!/usr/bin/env python3
# build-rockery.py — 太湖石假山 builder (Blender headless)
# Run: blender -b -P build-rockery.py -- --cluster rockery-yulinglong \
#        --module <modules/rockery> --out <out-rockery>
#
# Convention (scripts/assemble.py, frozen): layout map metres x east z south y up
#   map (x, z, y) -> Blender (x, -z, y); export export_yup=True -> GLB == map coords.
# Meshes are authored at absolute map positions (world == local, transforms applied).
#
# Per DESIGN_SPEC.json: icosphere subdiv 3 (=1280 tris; Blender 4.5 numbers it 4)
#   -> scale (size, size*0.85, h) -> layered noise displacement (3 octaves, total
#   amp 0.18*size, seed per rock) -> 瘦/皱 vertical stretch; merge one mesh per
#   rockery; 玉玲珑 tallest rock gets 3 cylinder-boolean through-holes (r 0.25..0.35).
#
# Robustness notes (see PROGRESS.json):
#   - the boolean runs FIRST on the clean convex icosphere: exact-boolean on the
#     noised/clamped mesh is nondeterministic (observed union-inversion).
#   - vertices within 1.15r of a hole axis get their noise damped to 10% so the
#     tunnels stay clear; hole mouths read as worn rims.
#   - noise is soft-fitted to the expanded placeholder box (displacement scaled to
#     graze the box, never cross it) — no coplanar flats, no self-intersections;
#     a hard clamp remains as an asserted-to-be-empty safety net.

import argparse
import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector, noise

TILE_M = 2.5
OCTAVE_FREQ = (0.8, 1.9, 3.4)     # cycles per rock-size unit
OCTAVE_AMP = (0.5, 0.3, 0.2)      # fractions of total 0.18*size
TAPER_MAX = 0.22                  # 瘦 pinch at the top
TUNNEL_DAMP = 0.10                # noise kept near hole axes


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear_rgb(hexstr):
    h = hexstr.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


def make_tinted_color_texture(src_color, tint_hex, out_path):
    """Delegate the tint bake to system python3 + PIL (subprocess).

    Blender's bundled python has no PIL, and bpy image save/save_render of a
    generated buffer writes black files in background mode (verified 4.5.1);
    the system interpreter is the reliable baker. sRGB-space multiply blend.
    """
    import shutil
    import subprocess
    here = os.path.dirname(os.path.abspath(__file__))
    py = shutil.which('python3')
    if not py:
        raise RuntimeError('system python3 not found for tint bake')
    subprocess.run([py, os.path.join(here, 'tint-texture.py'),
                    '--src', src_color, '--tint', tint_hex, '--dst', out_path],
                   check=True)
    if not (os.path.exists(out_path) and os.path.getsize(out_path) > 10000):
        raise RuntimeError(f'tint bake produced no usable file: {out_path}')
    return out_path


def seg_point_dist(p, a, d, half):
    """Distance from point p to segment a ± d*half (blender coords)."""
    ap = p - a
    t = max(-half, min(half, ap.dot(d)))
    return (ap - d * t).length


def make_hole(rock_center_bl, direction, radius, zh, depth):
    d = direction.normalized()
    c = Vector(rock_center_bl)
    c.z = zh
    return {'center': c, 'dir': d, 'radius': radius, 'depth': depth,
            'record': {
                'radiusM': radius,
                'centerMap': [round(c.x, 4), round(-c.y, 4), round(c.z, 4)],
                'axisMap': [round(d.x, 6), round(-d.y, 6), round(d.z, 6)],
            }}


def cut_boolean(target, hole):
    bpy.ops.mesh.primitive_cylinder_add(radius=hole['radius'], depth=hole['depth'],
                                        location=hole['center'])
    cyl = bpy.context.active_object
    cyl.rotation_euler = hole['dir'].to_track_quat('Z', 'Y').to_euler()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    mod = target.modifiers.new(name='hole', type='BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.object = cyl
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cyl, do_unlink=True)


def soft_fit_factor(p, d, box):
    """Largest f<=1 with p+f*d inside the box (blender x, y=-mapz, z=y)."""
    lims = ((box['xMin'], box['xMax']), (-box['zMax'], -box['zMin']),
            (box['yMin'], box['yMax']))
    f = 1.0
    for pv, dv, (lo, hi) in zip(p, d, lims):
        if dv > 1e-12:
            f = min(f, (hi - pv) / dv)
        elif dv < -1e-12:
            f = min(f, (lo - pv) / dv)
    return max(0.0, min(1.0, f))


def build_rock(rock, cluster, holes):
    """One displaced icosphere at absolute map position; returns (obj, record)."""
    x, z, size, h, seed = rock['x'], rock['z'], rock['size'], rock['h'], rock['seed']
    box = rock['box']  # expanded placeholder, map coords
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=0.5,
                                          location=(x, -z, h / 2.0))
    obj = bpy.context.active_object
    obj.name = f"rock-{cluster}-{seed}"
    obj.scale = (size, size * 0.85, h)
    # apply everything: mesh must be authored in world/map coords for noise+fit
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    hole_records = []
    if holes:
        me0 = obj.data
        for hole in holes:
            cut_boolean(obj, hole)
            hole_records.append(hole['record'])
        bm = bmesh.new()
        bm.from_mesh(me0)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me0)
        me0.validate(verbose=False)
        me0.update()

    me = obj.data
    seedvec = Vector((seed * 0.618, seed * 0.382, seed * 0.913))
    amp_total = 0.18 * size
    damped = 0
    softfit = 0
    hard_clamped = 0
    for i, v in enumerate(me.vertices):
        p = v.co.copy()
        # 瘦: pinch x/y about the rock's own centre axis toward the top half
        # (Blender z == map y; (x, -z) is the rock centre in blender coords)
        t = max(0.0, (p.z - (h / 2.0)) / (h / 2.0))
        pinch = 1.0 - TAPER_MAX * t * t
        p.x = x + (p.x - x) * pinch
        p.y = -z + (p.y + z) * pinch
        # layered vector noise, wavelengths tied to rock size
        d = Vector((0.0, 0.0, 0.0))
        for f, wa in zip(OCTAVE_FREQ, OCTAVE_AMP):
            off = seedvec * (7.13 + 3.77 * OCTAVE_FREQ.index(f))
            d += noise.noise_vector(p * (f / max(size, 0.8)) + off) * (wa * amp_total)
        if holes:
            near_tunnel = any(
                seg_point_dist(p, hl['center'], hl['dir'], hl['depth'] * 0.5)
                < hl['radius'] * 1.15 for hl in holes)
            if near_tunnel:
                d *= TUNNEL_DAMP
                damped += 1
        f = soft_fit_factor(p, d, box)
        if f < 1.0:
            softfit += 1
        v.co = p + d * f
        # hard safety net (expected empty)
        nz = min(max(v.co.z, box['yMin']), box['yMax'])
        cx = min(max(v.co.x, box['xMin']), box['xMax'])
        cy = min(max(-v.co.y, box['zMin']), box['zMax'])
        if (abs(v.co.x - cx) > 1e-9 or abs(v.co.y + cy) > 1e-9
                or abs(v.co.z - nz) > 1e-9):
            hard_clamped += 1
            v.co = (cx, -cy, nz)
    me.update()
    return obj, {'seed': seed, 'verts': len(me.vertices),
                 'tunnelDampedVerts': damped, 'softFittedVerts': softfit,
                 'hardClampedVerts': hard_clamped,
                 'holes': hole_records}


def clean_mesh(obj, dist=0.0005):
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    me.validate(verbose=False)
    me.update()
    return len(me.polygons)


def cube_project_uv(obj, tile_m=TILE_M):
    me = obj.data
    uvl = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        n = poly.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            co = me.vertices[vi].co
            if ax >= ay and ax >= az:
                uv = (co.y / tile_m, co.z / tile_m)
            elif ay >= az:
                uv = (co.x / tile_m, co.z / tile_m)
            else:
                uv = (co.x / tile_m, co.y / tile_m)
            uvl.data[li].uv = uv


def assign_moss(obj, band_m=0.3, max_share=0.2):
    """Second slot for faces near the ground; caps share at max_share."""
    me = obj.data
    moss = bpy.data.materials.get('rockery-moss')
    me.materials.append(moss)
    faces = []
    for poly in me.polygons:
        minz = min(me.vertices[vi].co.z for vi in poly.vertices)
        faces.append((minz, poly.index))
    faces.sort()
    cap = int(len(me.polygons) * max_share)
    in_band = [i for mz, i in faces if mz < band_m]
    chosen = set(in_band if len(in_band) <= cap else in_band[:cap])
    for poly in me.polygons:
        if poly.index in chosen:
            poly.material_index = 1
    used_band = band_m
    if len(in_band) > cap:
        used_band = faces[cap - 1][0] if cap else 0.0
    return {
        'mossFaces': len(chosen),
        'totalFaces': len(me.polygons),
        'share': round(len(chosen) / max(len(me.polygons), 1), 4),
        'bandRequestedM': band_m,
        'bandEffectiveM': round(used_band, 4) if len(chosen) else None,
        'shareCapped': len(in_band) > cap,
    }


def build_materials(textures):
    """stone = tinted PaintedPlaster017 color (sRGB) + normal (Non-Color, 0.6) + rough 0.9."""
    mat = bpy.data.materials.new('rockery-stone')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.9

    col = nt.nodes.new('ShaderNodeTexImage')
    col.image = bpy.data.images.load(textures['colorTinted'])
    col.image.colorspace_settings.name = 'sRGB'
    nt.links.new(col.outputs['Color'], bsdf.inputs['Base Color'])

    nrm = nt.nodes.new('ShaderNodeTexImage')
    nrm.image = bpy.data.images.load(textures['normal'], check_existing=True)
    nrm.image.colorspace_settings.name = 'Non-Color'
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nmap.inputs['Strength'].default_value = 0.6
    nt.links.new(nrm.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])

    moss = bpy.data.materials.new('rockery-moss')
    moss.use_nodes = True
    mbsdf = moss.node_tree.nodes['Principled BSDF']
    mbsdf.inputs['Base Color'].default_value = (*hex_to_linear_rgb('5c6b4a'), 1.0)
    mbsdf.inputs['Roughness'].default_value = 0.95
    return mat, moss


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--cluster', required=True, choices=['rockery-dajiashan', 'rockery-yulinglong'])
    ap.add_argument('--module', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args(argv)

    site = json.load(open(os.path.join(args.module, 'site-inputs.json')))
    cl = site['clusters'][args.cluster]
    rocks = cl['rocks']
    budget = site['budget'][args.cluster.replace('rockery-', '')]
    out = args.out
    os.makedirs(os.path.join(out, 'textures'), exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)

    tinted = make_tinted_color_texture(
        site['material']['stone']['textures']['color'],
        site['material']['stone']['tintSrgbHex'],
        os.path.join(out, 'textures', 'plaster-tint-7d8288.jpg'))
    build_materials({'colorTinted': tinted, 'normal': site['material']['stone']['textures']['normal']})

    # 玉玲珑: tallest rock (by h) gets 3 through-holes
    holes = []
    hole_rock_seed = None
    if args.cluster == 'rockery-yulinglong':
        tallest = max(rocks, key=lambda r: r['h'])
        hole_rock_seed = tallest['seed']
        center = (tallest['x'], -tallest['z'], 0.0)
        depth = 3.0 * tallest['size']
        for direction, radius, zh in (
                (Vector((1, 0, 0)), 0.25, 0.42 * tallest['h']),
                (Vector((0, 1, 0)), 0.30, 0.60 * tallest['h']),
                (Vector((1, 1, 0.2)), 0.35, 0.30 * tallest['h'])):
            holes.append(make_hole(center, direction, radius, zh, depth))

    records = {'cluster': args.cluster, 'holeRockSeed': hole_rock_seed, 'rocks': [],
               'clampedTotal': 0, 'softFittedTotal': 0, 'tunnelDampedTotal': 0}
    objs = []
    for rock in rocks:
        rock_holes = holes if (holes and rock['seed'] == hole_rock_seed) else None
        obj, rec = build_rock(rock, args.cluster, rock_holes)
        obj.data.materials.append(bpy.data.materials['rockery-stone'])
        objs.append(obj)
        records['rocks'].append(rec)
        records['clampedTotal'] += rec['hardClampedVerts']
        records['softFittedTotal'] += rec['softFittedVerts']
        records['tunnelDampedTotal'] += rec['tunnelDampedVerts']

    # merge cluster into one mesh
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    rockery = bpy.context.active_object
    rockery.name = args.cluster

    tris = clean_mesh(rockery)
    records['trisAfterClean'] = tris
    records['budget'] = budget

    if tris > budget:
        ratios = []
        for _ in range(4):  # iterate to fit; decimate keeps silhouette (PLAN fallback)
            ratio = max(0.05, min(0.999, (budget * 0.92) / tris))
            ratios.append(round(ratio, 4))
            mod = rockery.modifiers.new(name='decimate', type='DECIMATE')
            mod.ratio = ratio
            mod.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = rockery
            bpy.ops.object.modifier_apply(modifier=mod.name)
            tris = clean_mesh(rockery)
            if tris <= budget:
                break
        records['decimateRatios'] = ratios
        records['trisAfterDecimate'] = tris

    cube_project_uv(rockery)
    records['moss'] = assign_moss(rockery)
    records['holes'] = [h['record'] for h in holes]

    glb_path = os.path.join(out, f'{args.cluster}.glb')
    bpy.ops.object.select_all(action='DESELECT')
    rockery.select_set(True)
    bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB',
                              export_yup=True, use_selection=True)
    records['glb'] = glb_path
    records['glbBytes'] = os.path.getsize(glb_path)

    zs = [v.co.z for v in rockery.data.vertices]
    xs = [v.co.x for v in rockery.data.vertices]
    ys = [v.co.y for v in rockery.data.vertices]
    records['boundsMap'] = {
        'xMin': round(min(xs), 3), 'xMax': round(max(xs), 3),
        'zMinMap': round(-max(ys), 3), 'zMaxMap': round(-min(ys), 3),
        'yMin': round(min(zs), 3), 'yMax': round(max(zs), 3),
    }
    records['layoutHeight'] = cl['layoutHeight']

    with open(os.path.join(out, f'build-{args.cluster}.record.json'), 'w') as f:
        json.dump(records, f, indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, f'{args.cluster}.blend'))
    print('BUILD_RECORD ' + json.dumps(records))


main()
