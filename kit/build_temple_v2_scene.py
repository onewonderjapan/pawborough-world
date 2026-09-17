"""Temple AXIS V2 render scene (BLENDER evidence path, separate from the WebGL
captures) — expansion batch N8. Copy-adapted from build_dadian_scene.py.

  review   — imports the 13 assembled GLBs of world/temple-axis-v2 exactly as
             the dataset places them (7 frozen identity/+Y, dadian-court-v2 in
             place, stage at +Y21, peidian/gallery pairs yawed ±90°, court3 in
             place, houdian at +Y74), the TEN lead cameras, sun + AgX. All 10
             views PBR + clay pairs for court2-pair and court3-axis at
             1600x900, Cycles CPU (budgets.blenderDevice), 24 samples.
  compare  — native kit scene.blend assembly (peidian/gallery rotated, etc.)
             rendered next to the GLB reimports for court2-pair and
             houdian-front (same-pose source-vs-reimport comparison).

Instance convention: GLB(x,y,z)->Blender(x,-z,y); a GLB yaw about +Y maps to a
Blender Z rotation of the SAME sign (R_z(t) = M R_y(t) M^-1), so peidian-w
(+90°) faces Blender +X = GLB +X, matching the page and physics.

Run:
  blender -b --factory-startup -t 4 -P kit/build_temple_v2_scene.py -- \
      --mode review --out kit/out/temple-axis-v2/renders
  blender -b --factory-startup -t 4 -P kit/build_temple_v2_scene.py -- \
      --mode compare --out kit/out/temple-axis-v2/renders
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
DS = ROOT / 'world' / 'temple-axis-v2'
cams = json.loads((DS / 'cameras.json').read_text(encoding='utf-8'))
by_id = {c['id']: c for c in cams['cameras']}
W, H = args.width, args.height

HALF_PI = math.pi / 2
# the assembled instance table (must mirror instances.json)
INSTANCES = [
    ('temple.glb', (0, 0, 0), 0.0), ('ground.glb', (0, 0, 0), 0.0),
    ('lions.glb', (0, 0, 0), 0.0), ('ornaments.glb', (0, 0, 0), 0.0),
    ('yimen.glb', (0, 0, -21), 0.0), ('yimen-stage.glb', (0, 0, -21), 0.0),
    ('court-open.glb', (0, 0, 0), 0.0), ('dadian-court-v2.glb', (0, 0, 0), 0.0),
    ('peidian.glb', (-11.2, 0, -35.8), HALF_PI), ('peidian.glb', (11.2, 0, -35.8), -HALF_PI),
    ('gallery.glb', (-10.78, 0, -30.99), HALF_PI), ('gallery.glb', (10.78, 0, -30.99), -HALF_PI),
    ('dadian.glb', (0, 0, -44), 0.0), ('court3.glb', (0, 0, 0), 0.0),
    ('houdian.glb', (0, 0, -74), 0.0),
]

scene = None


def import_instance(path, pos, yaw):
    """Import one GLB root and apply the instance transform in Blender space."""
    before = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    new = [o for o in scene.objects if o not in before]
    roots = [o for o in new if o.parent is None or o.parent in before]
    for o in roots:
        o.location.x += pos[0]
        o.location.y += -pos[2]
        o.location.z += pos[1]
        if yaw:
            o.rotation_euler.z += yaw
    return new


if args.mode == 'review':
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    for glb, pos, yaw in INSTANCES:
        import_instance(DS / glb, pos, yaw)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    # native kit assembly (scene.blend files carry GLB-local geometry in
    # Blender space already): place + rotate per instance
    KIT_BLEND = {
        'temple.glb': ROOT / 'kit/out/temple-shanmen-entry/scene.blend',
        'yimen.glb': ROOT / 'kit/out/yimen/scene.blend',
        'court-open.glb': ROOT / 'kit/out/court-open/scene.blend',
        'dadian-court-v2.glb': ROOT / 'kit/out/dadian-court-v2/scene.blend',
        'dadian.glb': ROOT / 'kit/out/dadian/scene.blend',
        'peidian.glb': ROOT / 'kit/out/peidian/scene.blend',
        'gallery.glb': ROOT / 'kit/out/gallery/scene.blend',
        'houdian.glb': ROOT / 'kit/out/houdian/scene.blend',
    }
    for glb, pos, yaw in INSTANCES:
        src = KIT_BLEND.get(glb)
        if src is None or not src.exists():
            # no native kit blend for this module (yimen-stage/court3/etc.):
            # fall back to the GLB for scene completeness; the compared views
            # themselves (court2-pair, houdian-front) are native
            import_instance(DS / glb, pos, yaw)
            continue
        with bpy.data.libraries.load(str(src), link=False) as (data_from, data_to):
            data_to.objects = [n for n in data_from.objects]
        for o in data_to.objects:
            if o is None:
                continue
            bpy.context.collection.objects.link(o)
            if o.parent is None:
                o.location.x += pos[0]
                o.location.y += -pos[2]
                o.location.z += pos[1]
                if yaw:
                    o.rotation_euler.z += yaw

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
sidecar = {'source': 'kit/build_temple_v2_scene.py', 'engine': 'cycles-cpu',
           'samples': args.samples, 'resolution': [W, H], 'mode': args.mode,
           'assembly': 'temple-axis-v2 instances verbatim (peidian/gallery yaw ±90°)',
           'views': [],
           'note': 'BLENDER evidence; WebGL captures are separate (kit/out/temple-axis-v2/web)'}

ALL_VIEWS = ['court2-pair', 'peidian-west-front', 'gallery-link', 'stage-from-court',
             'stage-3q', 'passage-east', 'court3-axis', 'houdian-front', 'houdian-3q',
             'axis-aerial']
CLAY_VIEWS = {'court2-pair', 'court3-axis'}
COMPARE_VIEWS = ['court2-pair', 'houdian-front']

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
print(f'TEMPLE_V2_SCENE_{args.mode.upper()}_READY views={len(PLAN)} out={args.out}')
