"""Temple DADIAN render scene (BLENDER evidence path, separate from the
WebGL captures). Three jobs in one script:

  review   — fresh scene importing the eight assembled GLBs (shanmen identity,
             yimen translated to world (0,0,-21), court-open + dadian-court in
             place, dadian translated to world (0,0,-44)), the TEN lead
             cameras, one sun + AgX. Renders all 10 views PBR + clay pairs for
             court-axis and dadian-front at 1600x900, Cycles CPU 24 samples.
  compare  — opens a NATIVE source scene assembled from the kit scene.blend
             files (shanmen-entry + yimen +Y21 + court-open + dadian-court +
             dadian +Y44) and renders the same cameras next to the
             GLB-reimport renders (source-vs-reimport same-pose comparison).

Camera numerics asserted (measured-fov guard): degrees measured via
camera.data.angle must equal the JSON verticalFovDegrees.

Coordinate note: GLB(x,y,z)->Blender(x,-z,y); GLB z -21/-44 map to Blender
+Y 21/+44 — pure translation, yaw 0.

Run:
  blender -b --factory-startup -t 4 -P kit/build_dadian_scene.py -- \
      --mode review --out kit/out/dadian-renders
  blender -b --factory-startup -t 4 -P kit/build_dadian_scene.py -- \
      --mode compare --out kit/out/dadian-renders
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
p.add_argument('--width', type=int, default=1600)
p.add_argument('--height', type=int, default=900)
p.add_argument('--samples', type=int, default=24)
args = p.parse_args(argv)

ROOT = Path(__file__).resolve().parent.parent
DS = ROOT / 'world' / 'temple-dadian'
cams = json.loads((DS / 'cameras.json').read_text(encoding='utf-8'))
by_id = {c['id']: c for c in cams['cameras']}
W, H = args.width, args.height

YIMEN_BL_Y = 21.0
DADIAN_BL_Y = 44.0


def import_glb_shifted(path, shift_y):
    """Import one GLB and translate ONLY its own objects (scene-object delta)."""
    before = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    new = [o for o in scene.objects if o not in before]
    roots = [o for o in new if o.parent is None or o.parent in before]
    for o in roots:
        o.location.y += shift_y
    return new


if args.mode == 'review':
    bpy.ops.wm.read_factory_settings(use_empty=True)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    srcs = [
        (ROOT / 'kit/out/temple-shanmen-entry/scene.blend', 0.0),
        (ROOT / 'kit/out/yimen/scene.blend', YIMEN_BL_Y),
        (ROOT / 'kit/out/court-open/scene.blend', 0.0),
        (ROOT / 'kit/out/dadian-court/scene.blend', 0.0),
        (ROOT / 'kit/out/dadian/scene.blend', DADIAN_BL_Y),
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
    import_glb_shifted(DS / 'yimen.glb', YIMEN_BL_Y)
    import_glb_shifted(DS / 'court-open.glb', 0.0)
    import_glb_shifted(DS / 'dadian-court.glb', 0.0)
    import_glb_shifted(DS / 'dadian.glb', DADIAN_BL_Y)

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
sidecar = {'source': 'kit/build_dadian_scene.py', 'engine': 'cycles-cpu',
           'samples': args.samples, 'resolution': [W, H], 'mode': args.mode,
           'assembly': ('shanmen identity + yimen GLB z-21 (Blender +Y 21) + court-open in place '
                        '+ dadian-court in place + dadian GLB z-44 (Blender +Y 44)'),
           'views': [],
           'note': 'BLENDER evidence; WebGL captures are separate (kit/out/temple-dadian/web)'}

ALL_VIEWS = ['court-axis', 'dadian-front', 'steps-low', 'plaque-close', 'burner-close',
             'dadian-roof', 'court-quarter', 'look-back', 'corner-detail', 'hall-flank']
CLAY_VIEWS = {'court-axis', 'dadian-front'}
COMPARE_VIEWS = ['court-axis', 'dadian-front']

if args.mode == 'review':
    PLAN = [(v, tag) for v in ALL_VIEWS
            for tag in (['pbr', 'clay'] if v in CLAY_VIEWS else ['pbr'])]
else:
    PLAN = [(v, 'pbr') for v in COMPARE_VIEWS]

meshes = [o for o in scene.objects if o.type == 'MESH']

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
print(f'DADIAN_SCENE_{args.mode.upper()}_READY views={len(PLAN)} out={args.out}')
