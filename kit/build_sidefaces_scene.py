"""Street-sidefaces Blender evidence scene (expansion batch package 2, M5).

For each of the 6 skin places: import the MODULE GLB at its instance transform
(pos/yaw, same convention as the world: GLB yaw about +Y -> Blender Z rotation
of the same sign) + the skin GLB at identity (world-baked), place the camera
at the calibrated evidence pose from world/street-sidefaces/cameras.json, and
render one PBR view (Cycles CPU 24spp AgX 1600x900).

Run:
  blender -b --factory-startup -t 4 -P kit/build_sidefaces_scene.py -- \
      --out kit/out/sidefaces/renders
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--out', type=Path, required=True)
p.add_argument('--width', type=int, default=1600)
p.add_argument('--height', type=int, default=900)
p.add_argument('--samples', type=int, default=24)
args = p.parse_args(argv)

ROOT = Path(__file__).resolve().parent.parent
DS = ROOT / 'world' / 'street-sidefaces'
cams = json.loads((DS / 'cameras.json').read_text(encoding='utf-8'))
cfg = json.loads((ROOT / 'kit' / 'gable-skin.config.json').read_text(encoding='utf-8'))

MODULE_GLB = {
    'N01-plain-v1': ROOT / 'building/plain-v1/model.glb',
    'N05-restaurant-a': ROOT / 'building/restaurant-a/model.glb',
    'N06-curio-a': ROOT / 'building/curio-a/model.glb',
    'S05-plain-v3': ROOT / 'building/plain-v3/model.glb',
    'S07-plain-v2': ROOT / 'building/plain-v2/model.glb',
    'east-shop-133': ROOT / 'world/street-completion/east-shop-133/model.glb',
}

scene = bpy.context.scene


def import_glb(path, loc_bl=None, rot_z=0.0):
    before = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    new = [o for o in scene.objects if o not in before]
    roots = [o for o in new if o.parent is None or o.parent in before]
    for o in roots:
        o.rotation_mode = 'XYZ'  # R1-03: importer defaults to QUATERNION; euler writes are ignored otherwise
        if loc_bl:
            o.location.x += loc_bl[0]
            o.location.y += loc_bl[1]
            o.location.z += loc_bl[2]
        if rot_z:
            o.rotation_euler.z += rot_z
    return new


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1


BLANK_FRAMES = []


def blank_stats(png_path, name):
    img = bpy.data.images.load(str(png_path))
    px = list(img.pixels)
    bpy.data.images.remove(img)
    n = len(px) // 4
    step = max(1, n // 20000)
    lum = []
    for i in range(0, n, step):
        r, g, b = px[i * 4], px[i * 4 + 1], px[i * 4 + 2]
        lum.append(0.2126 * r + 0.7152 * g + 0.0722 * b)
    mean = sum(lum) / len(lum)
    std = (sum((v - mean) ** 2 for v in lum) / len(lum)) ** 0.5
    counts = {}
    for v in lum:
        counts[round(v * 255)] = counts.get(round(v * 255), 0) + 1
    dom = max(counts.values()) / len(lum)
    blank = std * 255 < 2.0 or dom > 0.95
    BLANK_FRAMES.append({'file': name, 'lumStd255': round(std * 255, 3),
                         'dominantShare': round(dom, 4), 'blank': blank})
    if blank:
        print(f"BLANK_FRAME {name}")

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

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = args.samples
scene.render.resolution_x = args.width
scene.render.resolution_y = args.height
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'

args.out.mkdir(parents=True, exist_ok=True)
sidecar = {'source': 'kit/build_sidefaces_scene.py', 'engine': 'cycles-cpu',
           'samples': args.samples, 'resolution': [args.width, args.height], 'views': []}

for target in cfg['targets']:
    mod = target['module']
    pos = target['placement']['positionGlb']
    yaw = target['placement']['rotationYRad']
    src = MODULE_GLB[mod]
    if not src.exists():
        sys.exit(f'missing module GLB {src}')
    import_glb(src, loc_bl=(pos[0], -pos[2], pos[1]), rot_z=yaw)
    import_glb(DS / 'skins' / f'{target["module"]}-{target["faces"][0]["rec"]}.glb')
    if len(target['faces']) > 1:
        import_glb(DS / 'skins' / f'{target["module"]}-{target["faces"][1]["rec"]}.glb')
    # cameras for this place (1-2 per place, first one renders the place view)
    place_key = target['id'].replace('gable-skin-', '')
    place_cams = [c for c in cams['cameras']
                  if c['id'].replace('skin-gable-skin-', '').rsplit('-', 1)[0] == place_key]
    for c in place_cams:
        loc = (c['positionGlb'][0], -c['positionGlb'][2], c['positionGlb'][1])
        tar = (c['targetGlb'][0], -c['targetGlb'][2], c['targetGlb'][1])
        d = (tar[0] - loc[0], tar[1] - loc[1], tar[2] - loc[2])
        rot_x = math.acos(max(-1.0, min(1.0, -d[2] / math.dist(loc, tar))))
        rot_z = math.atan2(d[1], d[0]) - math.pi / 2
        cam.location = loc
        cam.rotation_euler = (rot_x, 0.0, rot_z)
        fov = math.radians(c['verticalFovDegrees'])
        cam.data.lens = 36.0 / (2.0 * math.tan(fov / 2.0))
        scene.render.filepath = str(args.out / f'{c["id"]}-pbr.png')
        bpy.ops.render.render(write_still=True)
        blank_stats(scene.render.filepath, scene.render.filepath.split('/')[-1])
        sidecar['views'].append({'view': c['id'], 'file': scene.render.filepath.split('/')[-1],
                                 'calibratedDistanceM': c.get('calibratedDistanceM')})
        print(f'RENDERED {c["id"]}')
    # clean the module + skins for the next place
    bpy.ops.object.select_all(action='DESELECT')
    for o in scene.objects:
        if o.name not in ('cam', 'sun'):
            o.select_set(True)
    bpy.ops.object.delete()

sidecar_path = args.out / 'cameras.json'
sidecar_path.parent.mkdir(parents=True, exist_ok=True)
sidecar_path.write_text(json.dumps(sidecar, indent=2) + '\n', encoding='utf-8')
sidecar['blankGuard'] = {'frames': BLANK_FRAMES, 'anyBlank': any(f['blank'] for f in BLANK_FRAMES)}
if sidecar['blankGuard']['anyBlank']:
    print('BLANK_FRAMES_PRESENT'); sys.exit(10)
print(f'SIDEFACES_SCENE_READY views={len(sidecar["views"])} out={args.out}')
