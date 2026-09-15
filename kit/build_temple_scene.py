"""Reusable temple pilot render scene (BLENDER evidence path, separate from the
WebGL captures). Two jobs in one script:

  review   — fresh scene importing the four exported GLBs at identity, the six
             lead cameras (verticalFovDegrees -> lens via sensor_fit VERTICAL),
             one sun + AgX. Renders 6 views PBR + front/quarter-left clay at
             the contract framebuffer 1280x960, Cycles CPU (GPU not grabbed).
  compare  — opens the builder's SOURCE scene.blend (native Blender geometry)
             and renders the same camera on the same light rig, next to the
             GLB-reimport render of the same view: the same-pose reimport
             comparison the lead asked for.

Camera numerics are asserted, not assumed: degrees(camera.data.angle) must
equal the JSON verticalFovDegrees (a radians double-conversion would be off by
~57x and fail instantly), and the look-at is built from the GLB pose with the
standard (x,-z,y) mapping.

Run:
  blender -b --factory-startup -t 4 -P kit/build_temple_scene.py -- \
      --mode review --out kit/out/temple-shanmen-renders
  blender -b --factory-startup -t 4 -P kit/build_temple_scene.py -- \
      --mode compare --out kit/out/temple-shanmen-renders
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
DS = ROOT / 'world' / 'temple-shanmen'
KITSRC = ROOT / 'kit' / 'out' / 'temple-shanmen' / 'scene.blend'
cams = json.loads((DS / 'cameras.json').read_text(encoding='utf-8'))
by_id = {c['id']: c for c in cams['cameras']}
fb = cams.get('framebuffer', [1280, 960])
W, H = args.width, args.height or round(args.width * fb[1] / fb[0])

if args.mode == 'review':
    bpy.ops.wm.read_factory_settings(use_empty=True)
else:
    if not KITSRC.exists():
        sys.exit('compare mode needs kit/out/temple-shanmen/scene.blend (run the builder first)')
    bpy.ops.wm.open_mainfile(filepath=str(KITSRC))
    # strip any previous rig objects from the source scene, keep geometry
    for o in list(bpy.context.scene.objects):
        if o.type in ('CAMERA', 'LIGHT'):
            bpy.data.objects.remove(o, do_unlink=True)

scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1

if args.mode == 'review':
    for glb in ('temple.glb', 'ground.glb', 'lions.glb', 'ornaments.glb'):
        bpy.ops.import_scene.gltf(filepath=str(DS / glb))

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
    """GLB pose -> Blender pose; fov via lens with the numeric anti-radians guard.
    Blender's VERTICAL sensor fit resolves against its own effective sensor
    height, so the lens is set, MEASURED via camera.data.angle, then corrected
    once — the assert at the end is on the measured value, never assumed."""
    loc = (c['positionGlb'][0], -c['positionGlb'][2], c['positionGlb'][1])
    tar = (c['targetGlb'][0], -c['targetGlb'][2], c['targetGlb'][1])
    look_at(loc, tar)
    fov_rad = math.radians(c['verticalFovDegrees'])
    cam.data.lens = 36.0 / (2.0 * math.tan(fov_rad / 2.0))
    got = math.degrees(cam.data.angle)
    if abs(got - c['verticalFovDegrees']) > 1e-4:
        half = cam.data.lens * math.tan(math.radians(got) / 2.0)   # effective half-sensor
        cam.data.lens = half / math.tan(fov_rad / 2.0)
        got = math.degrees(cam.data.angle)
    if abs(got - c['verticalFovDegrees']) > 1e-3:
        sys.exit(f"camera {c['id']}: vertical fov {got:.4f}deg != contract {c['verticalFovDegrees']} (radians conversion bug?)")
    return loc, tar, got


args.out.mkdir(parents=True, exist_ok=True)
sidecar = {'source': 'kit/build_temple_scene.py', 'engine': 'cycles-cpu', 'samples': args.samples,
           'resolution': [W, H], 'mode': args.mode, 'views': [],
           'note': 'BLENDER evidence; WebGL captures are separate (kit/out/temple-shanmen/web)'}
meshes = [o for o in scene.objects if o.type == 'MESH']

if args.mode == 'review':
    PLAN = [(v, tag) for v in ('front', 'street-eye', 'quarter-left', 'roof', 'doorway', 'rear-inferred')
            for tag in (['pbr', 'clay'] if v in ('front', 'quarter-left') else ['pbr'])]
else:
    PLAN = [('front', 'pbr'), ('quarter-left', 'pbr')]

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
    sidecar['views'].append({'view': vid, 'tag': tag, 'geometry': 'native-blend' if args.mode == 'compare' else 'glb-reimport',
                             'posBlender': list(loc), 'targetBlender': list(tar),
                             'fovDegVerified': round(got, 4), 'file': scene.render.filepath.split('/')[-1]})
    print(f'RENDERED {vid}-{tag} fov={got:.3f}deg')

(args.out / ('compare-cameras.json' if args.mode == 'compare' else 'cameras.json')).write_text(
    json.dumps(sidecar, indent=2) + '\n', encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(args.out / ('compare-scene.blend' if args.mode == 'compare' else 'scene.blend')))
print(f'TEMPLE_SCENE_{args.mode.upper()}_READY views={len(PLAN)} out={args.out}')
