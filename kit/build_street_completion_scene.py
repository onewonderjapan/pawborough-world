"""Reusable street-completion scene assembly for Blender framing (batch S4,
assembly fixed under the SC-F2 review round).

Imports the frozen street assembly + the six refined buildings + the tail
surface at their dataset transforms, adds the batch cameras from the dataset
cameras.json, saves scene.blend + a cameras.json sidecar, and renders PBR/clay
pairs for the requested views. BLENDER evidence path — kept strictly separate
from the WebGL captures (different engine, same camera definitions).

Asset placement: the glTF importer already converts Y-up geometry to Blender's
Z-up. Under the explicit mapping GLB(x,y,z) -> Blender(x,-z,y) a glb yaw of θ
about +Y conjugates to the SAME-SIGN θ about +Z (Rot_x(90°)·Rot_y(θ)·Rot_x(-90°)
= Rot_z(θ)), so each asset gets a Z-rotation of +rotationYRad (already radians —
never wrapped in math.radians again) at (x, -z_glb). SC-F2: the previous build
used math.radians(-rotationYRad), i.e. negated AND degrees-reconverted — the
black frames in kit/out/sctail-scene are that assembly error, kept as evidence.
Every placement is numerically verified against the GLB file bytes
(AABB corners through the dataset transform) BEFORE any render; see
scene-verify.json.

Run:
  blender -b --factory-startup -t 4 -P kit/build_street_completion_scene.py -- \
      --views sc-czero,sc-pair-cloth-silk --out kit/out/sctail-scene-v2
"""
import argparse
import json
import math
import struct
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

import sys
argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--views', default='sc-czero,sc-pair-cloth-silk')
p.add_argument('--out', type=Path, required=True)
p.add_argument('--width', type=int, default=1280)
p.add_argument('--samples', type=int, default=32)
args = p.parse_args(argv)

ROOT = Path('/home/baibai/pawborough-world')
DATASET = ROOT / 'world' / 'street-completion'
cams = json.loads((DATASET / 'cameras.json').read_text(encoding='utf-8'))['cameras']
by_id = {c['id']: c for c in cams}
manifest = json.loads((DATASET / 'review-manifest.json').read_text(encoding='utf-8'))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'

def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    new_top = [o for o in set(bpy.data.objects) - before if o.parent is None or o.parent not in set(bpy.data.objects) - before]
    return new_top

import_glb(ROOT / 'world' / 'street-reviewed.glb')

pivots = {}
for a in manifest['streetCompletion']['assets']:
    glb_path = ROOT / a['glb'].lstrip('./')
    top = import_glb(glb_path)
    pivot = bpy.data.objects.new(f"asset-root-{a['id']}", None)
    scene.collection.objects.link(pivot)
    x, _y, z = a['positionGlb']
    pivot.location = (x, -z, 0.0)
    # rotationYRad is ALREADY radians; GLB +Y yaw θ == Blender +Z yaw θ under
    # (x,y,z)->(x,-z,y). No negation, no math.radians (SC-F2).
    pivot.rotation_euler = (0.0, 0.0, a['rotationYRad'])
    for o in top:
        o.parent = pivot
    pivots[a['id']] = pivot

surface_tops = import_glb(DATASET / 'surface.glb')

sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
scene.collection.objects.link(sun)
sun.data.energy = 2.8
sun.rotation_euler = (math.radians(55), 0.0, math.radians(-35))
world = bpy.data.worlds.new('world')
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.75, 0.82, 0.88, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = 0.6

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scene.collection.objects.link(cam)
scene.camera = cam

clay = bpy.data.materials.new('clay')
clay.use_nodes = True
cb = clay.node_tree.nodes['Principled BSDF']
cb.inputs['Base Color'].default_value = (0.62, 0.60, 0.57, 1)
cb.inputs['Roughness'].default_value = 0.9

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = args.samples
scene.render.resolution_x = args.width
scene.render.resolution_y = round(args.width * 3 / 4)
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'

# ---- SC-F2 numeric verification (must pass BEFORE any render) -------------
#
# Transform contract under test: GLB(x,y,z) -> Blender(x,-z,y), so a glb yaw θ
# about +Y is a Blender yaw +θ about +Z (Rot_x(90°)·Rot_y(θ)·Rot_x(-90°) =
# Rot_z(θ)). Expected values are derived independently from the GLB FILE BYTES
# plus the dataset numbers; actual values come from the assembled Blender
# scene. Any mismatch raises before a single render is submitted — a failing
# build leaves the old black frames as the evidence, never new fake ones.

def glb_union_aabb(path):
    """Union AABB of every mesh node in a GLB, in glTF scene-local coords,
    parsed from the file bytes (POSITION accessor min/max through the node
    chain — no Blender involvement)."""
    data = path.read_bytes()
    off = 12
    jlen = struct.unpack('<I', data[off:off + 4])[0]
    j = json.loads(data[off + 8:off + 8 + jlen])
    nodes = j.get('nodes', [])
    parent = {}
    for i, n in enumerate(nodes):
        for ch in n.get('children', []):
            parent[ch] = i

    def node_matrix(ni):
        n = nodes[ni]
        if 'matrix' in n:
            m = Matrix([n['matrix'][0:4], n['matrix'][4:8], n['matrix'][8:12], n['matrix'][12:16]])
            return m.transposed()  # glTF stores column-major
        loc = Vector(n.get('translation', (0.0, 0.0, 0.0)))
        q = n.get('rotation', (0.0, 0.0, 0.0, 1.0))
        rot = Quaternion((q[3], q[0], q[1], q[2])).to_matrix().to_4x4()  # mathutils wants (w,x,y,z)
        scl = Matrix.Diagonal((*n.get('scale', (1.0, 1.0, 1.0)), 1.0))
        return Matrix.Translation(loc) @ rot @ scl

    def world_matrix(ni):
        m = node_matrix(ni)
        while ni in parent:
            ni = parent[ni]
            m = node_matrix(ni) @ m
        return m

    mn = [float('inf')] * 3
    mx = [float('-inf')] * 3
    for ni, n in enumerate(nodes):
        if 'mesh' not in n:
            continue
        m = world_matrix(ni)
        for prim in j['meshes'][n['mesh']]['primitives']:
            acc = j['accessors'][prim['attributes']['POSITION']]
            for xx in (acc['min'][0], acc['max'][0]):
                for yy in (acc['min'][1], acc['max'][1]):
                    for zz in (acc['min'][2], acc['max'][2]):
                        pt = m @ Vector((xx, yy, zz))
                        mn = [min(a_, b_) for a_, b_ in zip(mn, pt)]
                        mx = [max(a_, b_) for a_, b_ in zip(mx, pt)]
    if mn[0] == float('inf'):
        raise RuntimeError(f'{path.name}: no mesh nodes found')
    return mn, mx

def expected_corners(a):
    """8 expected Blender-space corners: GLB local AABB corners through
    R_y(yaw) + position, then the (x,-z,y) mapping."""
    mn, mx = glb_union_aabb(ROOT / a['glb'].lstrip('./'))
    x, _y, z = a['positionGlb']
    th = a['rotationYRad']
    c, s = math.cos(th), math.sin(th)
    out = []
    for lx in (mn[0], mx[0]):
        for ly in (mn[1], mx[1]):
            for lz in (mn[2], mx[2]):
                wx = x + c * lx + s * lz
                wz = z - s * lx + c * lz
                out.append(Vector((wx, -wz, ly)))
    return out

def objects_under(pivot):
    for o in scene.objects:
        if o.type != 'MESH':
            continue
        p = o
        while p is not None and p != pivot:
            p = p.parent
        if p == pivot:
            yield o

def meshes_below(tops):
    """All MESH objects at or below the given top-level objects."""
    tops = set(tops)
    for o in scene.objects:
        if o.type != 'MESH':
            continue
        p = o
        while p is not None and p not in tops:
            p = p.parent
        if p in tops:
            yield o

def union_aabb(objs):
    """True vertex bounds (NOT object.bound_box — after programmatic
    parenting its cached box can be stale/inflated by metres; probe on
    east-shop-131 showed 2.4 m slack on beveled/glass parts)."""
    bpy.context.view_layer.update()
    mn = [float('inf')] * 3
    mx = [float('-inf')] * 3
    count = 0
    for o in objs:
        count += 1
        mw = o.matrix_world
        for v in o.data.vertices:
            pt = mw @ v.co
            mn = [min(a_, b_) for a_, b_ in zip(mn, pt)]
            mx = [max(a_, b_) for a_, b_ in zip(mx, pt)]
    if not count:
        raise RuntimeError('union_aabb: no meshes')
    return mn, mx

verify = {'assets': [], 'cameraChecks': [],
          'note': 'expected from GLB file bytes + dataset numbers; actual from assembled Blender scene'}
asset_frames = []  # (origin x/z, yaw, local GLB AABB) per asset — for OBB containment
for a in manifest['streetCompletion']['assets']:
    pivot = pivots[a['id']]
    x, _y, z = a['positionGlb']
    th = a['rotationYRad']
    # 1) pivot must be exactly the contract transform
    want = Matrix.Translation((x, -z, 0.0)) @ Matrix.Rotation(th, 4, 'Z')
    derr = max((want @ v - pivot.matrix_world @ v).length
               for v in (Vector((0, 0, 0)), Vector((1, 0, 0)), Vector((0, 0, 1))))
    if derr > 1e-9:
        raise RuntimeError(f"{a['id']}: pivot transform deviates from contract by {derr}")
    # 2) assembled geometry must land where the GLB bytes + dataset say
    exp = expected_corners(a)
    lmn, lmx = glb_union_aabb(ROOT / a['glb'].lstrip('./'))
    emn = [min(pt[i] for pt in exp) for i in range(3)]
    emx = [max(pt[i] for pt in exp) for i in range(3)]
    amn, amx = union_aabb(objects_under(pivot))
    # 0.05 m tolerance: the glTF exporter writes accessor min/max from the
    # export-time bounding box, which runs up to ~0.016 m larger than the true
    # vertex bounds (measured on brick/tile/downpipe parts of these six GLBs;
    # Z-axis exact). Any rotation mistake this check exists to catch — the old
    # radians(-rad) bug, a negated yaw, a 180° flip — displaces the AABB by
    # metres, two orders of magnitude beyond that padding.
    aerr = max(max(abs(m - n) for m, n in zip(emn, amn)), max(abs(m - n) for m, n in zip(emx, amx)))
    if aerr > 0.05:
        raise RuntimeError(f"{a['id']}: assembled AABB deviates from GLB-derived expectation by {aerr:.6f} m")
    # 3) facade normal: GLB local +Z -> world (sinθ,0,cosθ) -> Blender (sinθ,-cosθ,0);
    #    must point toward the row's pair camera (the two rows face each other)
    nrm = Vector((math.sin(th), -math.cos(th), 0.0))
    pair = by_id['sc-pair-cloth-silk' if a['id'] in ('east-shop-130', 'east-shop-131') else 'sc-pair-embroidery-leather']
    to_cam = Vector((pair['positionGlb'][0], -pair['positionGlb'][2], 0.0)) - Vector((x, -z, 0.0))
    facing = nrm.dot(to_cam.normalized())
    if facing <= 0.1:
        raise RuntimeError(f"{a['id']}: facade normal faces away from the lane (dot={facing:.3f}) — wrong yaw sign?")
    verify['assets'].append({'id': a['id'], 'pivotTransformMaxDev': derr, 'aabbMaxDev': aerr,
                             'facadeDotToLane': round(facing, 4),
                             'expectedAABB': {'min': emn, 'max': emx}, 'actualAABB': {'min': amn, 'max': amx}})
    asset_frames.append((x, z, th, lmn, lmx))
    print(f"VERIFY {a['id']}: pivot {derr:.2e} aabb {aerr:.2e} facade_dot {facing:.3f}")

# surface: imported without a pivot, so its Blender bounds must equal the
# file's own GLB bounds through the identity placement. The walkable asphalt
# tops at y≈0 while the worn-stone band legitimately rises 0.09 m above it
# (kerb/gutter band, same profile as the frozen street) — "top must be zero"
# would be a wrong assertion, equality with the file is the right one.
smn, smx = union_aabb(meshes_below(surface_tops))
fmn, fmx = glb_union_aabb(DATASET / 'surface.glb')
semn = (fmn[0], -fmx[2], fmn[1])
semx = (fmx[0], -fmn[2], fmx[1])
serr = max(max(abs(m - n) for m, n in zip(semn, smn)), max(abs(m - n) for m, n in zip(semx, smx)))
verify['surfaceAABB'] = {'min': smn, 'max': smx, 'expectedFromFile': {'min': list(semn), 'max': list(semx)}}
if serr > 0.05:
    raise RuntimeError(f'surface placement deviates from its own GLB bounds by {serr:.4f} m')
print(f"VERIFY surface: identity placement, dev {serr:.4f}, z [{smn[2]:.3f}, {smx[2]:.3f}]")

def inside_any_box(p, margin=0.02):
    """OBB containment: a point inside a rotated building's AXIS-ALIGNED
    rectangle can still be outdoors (corner slack), so test in asset-local
    coordinates. p is Blender (x,y,z); GLB world y = Blender z."""
    gwx, gwy, gwz = p[0], p[2], -p[1]
    for x, z, th, lmn, lmx in asset_frames:
        c, s = math.cos(th), math.sin(th)
        dx, dz = gwx - x, gwz - z
        lx, lz = c * dx - s * dz, s * dx + c * dz
        if all(lmn[i] - margin <= v <= lmx[i] + margin for i, v in enumerate((lx, gwy, lz))):
            return True
    return False

def look_at(loc, target, lens_mm):
    cam.location = loc
    cam.data.lens = lens_mm
    cam.data.sensor_width = 36
    d = (target[0] - loc[0], target[1] - loc[1], target[2] - loc[2])
    # point -Z (camera forward) along d: keep world Z-up
    rot_x = math.acos(max(-1.0, min(1.0, -d[2] / math.dist(loc, target))))
    rot_z = math.atan2(d[1], d[0]) - math.pi / 2
    cam.rotation_euler = (rot_x, 0.0, rot_z)
    bpy.context.view_layer.update()
    # numeric proof the camera looks at the target (never trust guessed Euler):
    fwd = cam.matrix_world.to_quaternion() @ Vector((0.0, 0.0, -1.0))
    want = (Vector(target) - Vector(loc)).normalized()
    dot = fwd.dot(want)
    if dot < 1.0 - 1e-6:
        raise RuntimeError(f'look_at: forward·aim = {dot} (camera {loc} -> {target})')
    for name, pt in (('camera', loc), ('target', target)):
        if inside_any_box(pt):
            raise RuntimeError(f'look_at: {name} {pt} sits inside a building AABB — black frame guaranteed')
    return dot

sidecar = {'views': [], 'source': 'kit/build_street_completion_scene.py', 'engine': 'cycles-cpu',
           'samples': args.samples, 'note': 'BLENDER evidence; WebGL captures are separate',
           'assembly': 'GLB(x,y,z)->Blender(x,-z,y); pivot Z-rotation = +rotationYRad (radians, same sign)',
           'verifyFile': 'scene-verify.json'}
args.out.mkdir(parents=True, exist_ok=True)
for vid in [v.strip() for v in args.views.split(',') if v.strip()]:
    c = by_id[vid]
    loc = (c['positionGlb'][0], -c['positionGlb'][2], c['positionGlb'][1])
    tar = (c['targetGlb'][0], -c['targetGlb'][2], c['targetGlb'][1])
    dot = look_at(loc, tar, c['lensMm'])
    verify['cameraChecks'].append({'view': vid, 'forwardDotAim': round(dot, 9),
                                   'posBlender': list(loc), 'targetBlender': list(tar)})
    print(f"VERIFY cam {vid}: forward·aim {dot:.9f}")
meshes = [o for o in scene.objects if o.type == 'MESH']
for vid in [v.strip() for v in args.views.split(',') if v.strip()]:
    c = by_id[vid]
    loc = (c['positionGlb'][0], -c['positionGlb'][2], c['positionGlb'][1])
    tar = (c['targetGlb'][0], -c['targetGlb'][2], c['targetGlb'][1])
    look_at(loc, tar, c['lensMm'])
    saved = []
    for tag in ('pbr', 'clay'):
        if tag == 'clay':
            saved = [(o, [s.material for s in o.material_slots]) for o in meshes]
            for o in meshes:
                for s in o.material_slots:
                    s.material = clay
        scene.render.filepath = str(args.out / f'{vid}-{tag}.png')
        bpy.ops.render.render(write_still=True)
        if tag == 'clay':
            for o, mats in saved:
                for s, m in zip(o.material_slots, mats):
                    s.material = m
        sidecar['views'].append({'view': vid, 'tag': tag, 'posBlender': list(loc), 'targetBlender': list(tar),
                                 'lensMm': c['lensMm'], 'resolution': [args.width, round(args.width * 3 / 4)]})

(args.out / 'cameras.json').write_text(json.dumps(sidecar, indent=2) + '\n', encoding='utf-8')
(args.out / 'scene-verify.json').write_text(json.dumps(verify, indent=2) + '\n', encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(args.out / 'scene.blend'))
print(f'SCENE_READY {args.out} views={args.views}')
