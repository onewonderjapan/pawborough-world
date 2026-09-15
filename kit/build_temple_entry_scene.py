"""Temple ENTRY-GROUP render scene (BLENDER evidence path, separate from the
WebGL captures). Three jobs in one script:

  review   — fresh scene importing the six assembled GLBs (shanmen identity,
             yimen translated to world (0,0,-21), court in place), the EIGHT
             lead cameras, one sun + AgX. Renders all 8 views PBR + clay pairs
             for yimen-front and court-quarter at 1280x960, Cycles CPU.
  compare  — opens a NATIVE source scene assembled from the three kit
             scene.blend files (shanmen-entry + yimen translated + court) and
             renders the same camera next to the GLB-reimport render of the
             same views (source-vs-reimport same-pose comparison).

Camera numerics asserted (same guard as build_temple_scene.py): degrees
measured via camera.data.angle must equal the JSON verticalFovDegrees.

Coordinate note (the temple lesson): GLB(x,y,z)->Blender(x,-z,y); a GLB
translation of -21 in z maps to Blender +Y 21 with NO rotation change.

Run:
  blender -b --factory-startup -t 4 -P kit/build_temple_entry_scene.py -- \
      --mode review --out kit/out/entry-renders
  blender -b --factory-startup -t 4 -P kit/build_temple_entry_scene.py -- \
      --mode compare --out kit/out/entry-renders
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--mode', choices=('review', 'compare'), default='review')
p.add_argument('--out', type=Path, required=True)
p.add_argument('--width', type=int, default=1280)
p.add_argument('--height', type=int, default=960)
p.add_argument('--samples', type=int, default=24)
args = p.parse_args(argv)

ROOT = Path(__file__).resolve().parent.parent
DS = ROOT / 'world' / 'temple-entry'
cams = json.loads((DS / 'cameras.json').read_text(encoding='utf-8'))
by_id = {c['id']: c for c in cams['cameras']}
fb = cams.get('framebuffer', [1280, 960])
W, H = args.width, args.height or round(args.width * fb[1] / fb[0])

# GLB z -21 (north) == Blender +Y 21 — pure translation, yaw 0
YIMEN_BL_Y = 21.0

if args.mode == 'review':
    bpy.ops.wm.read_factory_settings(use_empty=True)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # native source: append every MESH from the three kit scene.blends
    srcs = [
        (ROOT / 'kit/out/temple-shanmen-entry/scene.blend', 0.0),
        (ROOT / 'kit/out/yimen/scene.blend', YIMEN_BL_Y),
        (ROOT / 'kit/out/entry-court/scene.blend', 0.0),
    ]
    for src, dy in srcs:
        if not src.exists():
            sys.exit(f'compare mode needs {src} (run the builders first)')
        with bpy.data.libraries.load(str(src), link=False) as (data_from, data_to):
            data_to.objects = [n for n in data_from.objects]
        for o in data_to.objects:
            if o is None:
                continue
            bpy.context.collection.objects.link(o)
            o.location.y += dy

scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1

if args.mode == 'review':
    for glb in ('temple.glb', 'ground.glb', 'lions.glb', 'ornaments.glb'):
        bpy.ops.import_scene.gltf(filepath=str(DS / glb))
    bpy.ops.import_scene.gltf(filepath=str(DS / 'yimen.glb'))
    # the last import's objects: translate to world (0,0,-21) GLB -> +Y 21
    for o in scene.objects:
        if o.name.startswith(('yimen-body', 'yimen-plaque')) or 'yimen' in (o.parent.name if o.parent else ''):
            o.location.y += YIMEN_BL_Y
    bpy.ops.import_scene.gltf(filepath=str(DS / 'court.glb'))

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
cam.data.sensor_fit = 'VERTICAL'
cam.data.sensor_width = 36

clay = bpy.data.materials.new('clay')
clay.use_nodes = True
cb = clay.node_tree.nodes['Principled BSDF']
cb.inputs['Base Color'].default_value = (0.62, 0.60, 0.57, 1)
cb.inputs['Roughness'].default_value = 0.9

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = args.samples
scene.render.resolution_x = W
scene.render.resolution_y = H
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'


def look_at(loc, target):
    cam.location = loc
    d = (target[0] - loc[0], target[1] - loc[1], target[2] - loc[2])
    rot_x = math.acos(max(-1.0, min(1.0, -d[2] / math.dist(loc, target))))
    rot_z = math.atan2(d[1], d[0]) - math.pi / 2
    cam.rotation_euler = (rot_x, 0.0, rot_z)


def apply_camera(c):
    loc = (c['positionGlb'][0], -c['positionGlb'][2], c['positionGlb'][1])
    tar = (c['targetGlb'][0], -c['targetGlb'][2], c['targetGlb'][1])
    look_at(loc, tar)
    fov_rad = math.radians(c['verticalFovDegrees'])
    cam.data.lens = 36.0 / (2.0 * math.tan(fov_rad / 2.0))
    got = math.degrees(cam.data.angle)
    if abs(got - c['verticalFovDegrees']) > 1e-4:
        half = cam.data.lens * math.tan(math.radians(got) / 2.0)
        cam.data.lens = half / math.tan(fov_rad / 2.0)
        got = math.degrees(cam.data.angle)
    if abs(got - c['verticalFovDegrees']) > 1e-3:
        sys.exit(f"camera {c['id']}: vertical fov {got:.4f}deg != contract {c['verticalFovDegrees']}")
    return loc, tar, got


args.out.mkdir(parents=True, exist_ok=True)
sidecar = {'source': 'kit/build_temple_entry_scene.py', 'engine': 'cycles-cpu',
           'samples': args.samples, 'resolution': [W, H], 'mode': args.mode,
           'assembly': 'shanmen identity + yimen GLB z-21 (Blender +Y 21) + court in place',
           'views': [],
           'note': 'BLENDER evidence; WebGL captures are separate (kit/out/entry-renders/web)'}
meshes = [o for o in scene.objects if o.type == 'MESH']

ALL_VIEWS = ['entry-axis', 'from-gate', 'court-quarter', 'yimen-front',
             'yimen-roof', 'yimen-detail', 'return-to-gate', 'rear-inferred']
CLAY_VIEWS = {'yimen-front', 'court-quarter'}
COMPARE_VIEWS = ['yimen-front', 'entry-axis']

if args.mode == 'review':
    PLAN = [(v, tag) for v in ALL_VIEWS
            for tag in (['pbr', 'clay'] if v in CLAY_VIEWS else ['pbr'])]
else:
    PLAN = [(v, 'pbr') for v in COMPARE_VIEWS]

for vid, tag in PLAN:
    c = by_id[vid]
    loc, tar, got = apply_camera(c)
    if tag == 'clay':
        saved = [(o, [s.material for s in o.material_slots]) for o in meshes]
        for o in meshes:
            for s in o.material_slots:
                s.material = clay
    scene.render.filepath = str(args.out / f'{vid}-{tag}{"-native" if args.mode == "compare" else "-glb"}.png')
    bpy.ops.render.render(write_still=True)
    if tag == 'clay':
        for o, mats in saved:
            for s, m in zip(o.material_slots, mats):
                s.material = m
    sidecar['views'].append({'view': vid, 'tag': tag,
                             'geometry': 'native-blend' if args.mode == 'compare' else 'glb-reimport',
                             'posBlender': list(loc), 'targetBlender': list(tar),
                             'fovDegVerified': round(got, 4),
                             'file': scene.render.filepath.split('/')[-1]})
    print(f'RENDERED {vid}-{tag} fov={got:.3f}deg')

(args.out / ('compare-cameras.json' if args.mode == 'compare' else 'cameras.json')).write_text(
    json.dumps(sidecar, indent=2) + '\n', encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(args.out / ('compare-scene.blend' if args.mode == 'compare' else 'scene.blend')))
print(f'ENTRY_SCENE_{args.mode.upper()}_READY views={len(PLAN)} out={args.out}')
