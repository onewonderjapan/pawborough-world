"""B4 — westshops V3 Blender evidence: full fangbang-temple-v3 assembly
(street + west-extension surfaces + 15 temple-axis-V2 assets + 17 upgraded
westshop modules + 3 gap strips + remaining placeholder grays), rendered from
the west-band camera set. The v2 scene script (kit/build_fangbang_v2_scene.py)
is the untouched base; this adds the block-west-shops instances and strips.

Run:
  blender -b --factory-startup -t 4 -P kit/build_westshops_v3_scene.py -- \
      --out kit/out/fangbang-temple-v3/renders [--samples 24] \
      [--views junction-west,west-road-mid,placeholder-band,aerial-overview]
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
p.add_argument('--views', type=str, default='junction-west,west-road-mid,placeholder-band,aerial-overview')
args = p.parse_args(argv)

ROOT = Path(__file__).resolve().parent.parent
TASK = ROOT.parent
DS_DIR = ROOT / 'world' / 'fangbang-temple-v3'
T = [-127.817, 0.0, 27.057]
YAW = 0.16703
_v1m = json.loads((ROOT / 'world' / 'fangbang-temple' / 'review-manifest.json').read_text(encoding='utf-8'))
assert _v1m['templeAxis']['translationGlb'][0] == T[0] and abs(_v1m['templeAxis']['yawRad'] - YAW) < 1e-9
cams = json.loads((DS_DIR / 'cameras.json').read_text(encoding='utf-8'))
blocks = json.loads((DS_DIR / 'blocks.json').read_text(encoding='utf-8'))
_v3m = json.loads((DS_DIR / 'review-manifest.json').read_text(encoding='utf-8'))
W, H = args.width, args.height


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1


def import_glb(path, loc_bl=None, rot_z=0.0):
    """GLB(x,y,z) -> Blender(x,-z,y); GLB yaw +Y -> Blender Z rotation -yaw.
    Roots forced to XYZ euler (R1-03: importer QUATERNION ignores euler writes)."""
    before = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    new = [o for o in scene.objects if o not in before]
    for o in roots_of(new, before):
        o.rotation_mode = 'XYZ'
        if loc_bl:
            o.location.x += loc_bl[0]
            o.location.y += loc_bl[1]
            o.location.z += loc_bl[2]
        if rot_z:
            o.rotation_euler.z += rot_z
    return new


def roots_of(new, before):
    return [o for o in new if o.parent is None or o.parent in before]


# street assembly (identity) + derived surfaces (world coordinates)
import_glb(ROOT / 'world/street-reviewed.glb')
import_glb(DS_DIR / 'west-extension/surface.glb')
import_glb(DS_DIR / 'west-extension/seal-wall.glb')
import_glb(DS_DIR / 'west-extension/forecourt-bounds.glb')
import_glb(ROOT / 'world/street-completion/surface.glb')

# temple axis V2: 15 composed assets, positionGlb/rotationYRad carry T+offset+yaw
for a in _v3m['templeAxis']['assets']:
    import_glb(ROOT / a['glb'].lstrip('./'),
               loc_bl=(a['positionGlb'][0], -a['positionGlb'][2], a['positionGlb'][1]),
               rot_z=+a['rotationYRad'])

# B: 17 westshop modules (frozen building/ GLBs, referenced not copied)
wsb = next(x for x in blocks['blocks'] if x['id'] == 'block-west-shops')
n_ws = 0
for a in wsb['assets']:
    import_glb(ROOT / a['glb'].lstrip('./'),
               loc_bl=(a['positionGlb'][0], -a['positionGlb'][2], a['positionGlb'][1]),
               rot_z=+a['rotationYRad'])
    n_ws += 1

# B: gap strips GLB (world-baked, identity placement)
import_glb(DS_DIR / 'westshops-strips.glb')

# R1-06: recalc outward normals (base faces render black in Cycles otherwise)
import bmesh as _bm
for _o in scene.objects:
    if _o.type != 'MESH':
        continue
    _b = _bm.new()
    _b.from_mesh(_o.data)
    _bm.ops.recalc_face_normals(_b, faces=_b.faces)
    _b.to_mesh(_o.data)
    _b.free()
    _o.data.update()

gray = bpy.data.materials.new('placeholder-gray')
gray.use_nodes = True
gb = gray.node_tree.nodes['Principled BSDF']
gb.inputs['Base Color'].default_value = (0.60, 0.63, 0.60, 1)
gb.inputs['Roughness'].default_value = 0.95
n_boxes = 0
for ph in blocks['placeholders']:
    if ph['replacedBy']:
        continue
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    o.name = f'placeholder__{ph["id"]}'
    o.scale = (ph['widthM'], ph['depthM'], ph['heightM'])
    o.location = (ph['glbPoint'][0], -ph['glbPoint'][1], ph['heightM'] / 2)
    o.rotation_euler.z = -ph['angleRad']
    o.data.materials.append(gray)
    n_boxes += 1


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
    return BLANK_FRAMES[-1]


sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
scene.collection.objects.link(sun)
sun.data.energy = 2.8
sun.rotation_euler = (math.radians(55), 0.0, math.radians(-35))
fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'SUN'))
scene.collection.objects.link(fill)
fill.data.energy = 0.9
fill.data.color = (0.92, 0.94, 1.0)
fill.rotation_euler = (math.radians(35), 0.0, math.radians(145))
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
cam.data.clip_end = 1200

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
sidecar = {'source': 'kit/build_westshops_v3_scene.py', 'engine': 'cycles-cpu',
           'samples': args.samples, 'resolution': [W, H],
           'assembly': ('street assembly identity + west-extension surface/seal-wall/bounds '
                        '+ east tail surface + 15 temple-axis-V2 assets at T+R(yaw+local) '
                        f'+ {n_ws} block-west-shops module instances + westshops-strips.glb '
                        f'+ {n_boxes} remaining placeholder gray boxes'),
           'views': [], 'note': 'BLENDER evidence; WebGL captures are separate (artifacts/westshops/web)'}

VIEWS = [v.strip() for v in args.views.split(',') if v.strip()]
PLAN = [(v, 'pbr') for v in VIEWS]

for vid, tag in PLAN:
    c = next(x for x in cams['cameras'] if x['id'] == vid)
    loc, tar, got = apply_camera(c)
    scene.render.filepath = str(args.out / f'fangbangv3-{vid}-{tag}.png')
    bpy.ops.render.render(write_still=True)
    blank_stats(scene.render.filepath, scene.render.filepath.split('/')[-1])
    sidecar['views'].append({'view': vid, 'tag': tag,
                             'posBlender': list(loc), 'targetBlender': list(tar),
                             'fovDegVerified': round(got, 4),
                             'file': scene.render.filepath.split('/')[-1]})
    print(f'RENDERED fangbangv3-{vid}-{tag} fov={got:.3f}deg')

sidecar['blankGuard'] = {'frames': BLANK_FRAMES, 'anyBlank': any(f['blank'] for f in BLANK_FRAMES)}
if sidecar['blankGuard']['anyBlank']:
    print('BLANK_FRAMES_PRESENT'); sys.exit(10)
(args.out / 'cameras.json').write_text(json.dumps(sidecar, indent=2) + '\n', encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(args.out / 'scene.blend'))
print(f'WESTSHOPS_V3_SCENE_READY views={len(PLAN)} out={args.out}')
