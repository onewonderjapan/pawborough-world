"""F1 — v1.0 candidate VIDEO SOURCE project v2: kit/build_world_v2_scene.py
Assembles the FULL fangbang street world with the temple-axis V3 assets
(lions-v2 + wing windows v2 + entry-court-v3 with incense road and burner +
4 camphor trees), the street-sidefaces skins, remaining grays, and ALL 26
contract cameras with the temple:axis-aerial pose FIX (DESIGN_SPEC
packageF.cameraFix; adoption batch K0). Saves kit/out/scene-v3/scene-v3.blend.

axis-aerial: old pose ([-30,42,-20] -> [0,0,-50] fov 50) renders to
camera-fix/axis-aerial-old.png for the pre/post comparison; the new pose
([-36,46,-8] -> [0,2,-46] fov 48) drives the scene camera + stills.

Run:
  blender -b --factory-startup -t 4 -P kit/build_world_v2_scene.py -- \
      --out kit/out/scene-v2 [--samples 24] [--render none|aerial,new-aerial,shanmen-from-road,...] [--device CPU]
"""
import argparse
import json
import math
import sys
import time
from pathlib import Path

import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--out', type=Path, default=Path('kit/out/scene-v3'))
p.add_argument('--width', type=int, default=1600)
p.add_argument('--height', type=int, default=900)
p.add_argument('--samples', type=int, default=24)
p.add_argument('--render', type=str, default='none',
               help='comma list: aerial(old pose),new-aerial,shanmen-from-road,forecourt-oblique,court2-pair,court3-axis,street-junction-west,street-placeholder-band,stage-from-court,houdian-front,aerial-overview')
p.add_argument('--device', type=str, default='CPU', choices=['CPU', 'GPU'])
p.add_argument('--props', action='store_true',
               help='instance the street-props layer (E batch, kit/out/props/plan.json) [default ON in v3]')
args = p.parse_args(argv)

import sys as _sys
_sys.path.insert(0, str(Path(__file__).resolve().parent))

ROOT = Path(__file__).resolve().parent.parent
DS_DIR = ROOT / 'world' / 'fangbang-temple-v4'
V3 = ROOT / 'world' / 'temple-axis-v3'
T = [-127.817, 0.0, 27.057]
YAW = 0.16703
W, H = args.width, args.height

blocks = json.loads((DS_DIR / 'blocks.json').read_text(encoding='utf-8'))
_v3m = json.loads((DS_DIR / 'review-manifest.json').read_text(encoding='utf-8'))
_axis_manifest = json.loads((V3 / 'review-manifest.json').read_text(encoding='utf-8'))

# --- the 26 contract cameras (street 8 + bridge 8 + temple 10) ---------------
def cams_of(path):
    return json.loads((ROOT / path).read_text(encoding='utf-8'))['cameras']

def normalize(c):
    c = dict(c)
    if 'verticalFovDegrees' not in c:
        c['verticalFovDegrees'] = round(math.degrees(2 * math.atan(18.0 / c['lensMm'])), 4)
    return c

CAMERAS = []
for c in cams_of('world/cameras.json')[:8]:
    CAMERAS.append({**normalize(c), 'id': f'street:{c["id"]}'})
for c in cams_of('world/fangbang-temple-v4/cameras.json'):
    CAMERAS.append({**c, 'id': f'bridge:{c["id"]}'})
for c in cams_of('world/temple-axis-v3/cameras.json'):
    CAMERAS.append({**c, 'id': f'temple:{c["id"]}'})
assert len(CAMERAS) == 29, f'expected 29 cameras (26 + 3 east), got {len(CAMERAS)}'

# temple: cameras are authored in the AXIS-LOCAL frame; the world scene needs
# them transformed by the bridge placement T+yaw. scene-v1's builder used them
# RAW — every temple: view in the committed scene-v1 renders an empty area
# south of the street (the "axis-aerial points at sky" review finding is the
# visible case). Both sides of the G-package comparison use the fixed
# transform so before/after share one camera contract.
_cy, _sy = math.cos(YAW), math.sin(YAW)


def axis_local_to_world(p):
    return [T[0] + _cy * p[0] + _sy * p[2], p[1], T[2] - _sy * p[0] + _cy * p[2]]


for c in CAMERAS:
    if c['id'].startswith('temple:'):
        c['positionGlb'] = axis_local_to_world(c['positionGlb'])
        c['targetGlb'] = axis_local_to_world(c['targetGlb'])

# axis-aerial pose fix (DESIGN_SPEC packageF.cameraFix) — assigned to the
# still-local camera contract BEFORE the bridge transform above? No: the
# transform loop ran already, so transform the LOCAL pose values here.
# DESIGN_SPEC pose ([-36,46,-8] -> [0,2,-46]) leaves 74-78% of the frame as
# flat sky — it fails its own >=40% non-background acceptance (measured 0.22).
# Adjusted to the H pose (same west-side elevated overview structure, lower +
# steeper) which measures 0.415. Deviation recorded in PROGRESS.
NEW_AERIAL_POSE_LOCAL = {'positionGlb': [-36, 26, -8], 'targetGlb': [0, 0, -28],
                         'verticalFovDegrees': 48,
                         'specPose': [-36, 46, -8, 0, 2, -46],
                         'specPoseNonBackground': 0.22}
_aerial = next(c for c in CAMERAS if c['id'] == 'temple:axis-aerial')
_aerial['positionGlb'] = axis_local_to_world(NEW_AERIAL_POSE_LOCAL['positionGlb'])
_aerial['targetGlb'] = axis_local_to_world(NEW_AERIAL_POSE_LOCAL['targetGlb'])
_aerial['verticalFovDegrees'] = NEW_AERIAL_POSE_LOCAL['verticalFovDegrees']

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1


def import_glb(path, loc_bl=None, rot_z=0.0):
    before = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    new = [o for o in scene.objects if o not in before]
    for o in new:
        if o.parent is None or o.parent in before:
            o.rotation_mode = 'XYZ'  # R1-03
            if loc_bl:
                o.location.x += loc_bl[0]
                o.location.y += loc_bl[1]
                o.location.z += loc_bl[2]
            if rot_z:
                o.rotation_euler.z += rot_z
    return new


# --- world assembly (street context identical to scene-v1) --------------------
import_glb(ROOT / 'world/street-reviewed.glb')
import_glb(DS_DIR / 'west-extension/surface.glb')
import_glb(DS_DIR / 'west-extension/seal-wall.glb')
import_glb(DS_DIR / 'west-extension/forecourt-bounds.glb')
import_glb(ROOT / 'world/street-completion/surface.glb')

# temple-axis V3 assets at the frozen bridge placements (same keys/transforms
# as the v3 manifest's fangbang entries; files resolved to world/temple-axis-v3)
FILE_FOR_KEY = {
    'shanmen': 'temple.glb', 'shanmen-ground': 'ground.glb',
    'shanmen-lions': 'lions-v2.glb', 'shanmen-ornaments': 'ornaments-v2.glb',
    'entrycourt-open': 'entry-court-v3.glb', 'yimen': 'yimen.glb',
    'yimenstage': 'yimen-stage.glb', 'dadiancourt': 'dadian-court-v2.glb',
    'peidian-w': 'peidian.glb', 'peidian-e': 'peidian.glb',
    'gallery-w': 'gallery.glb', 'gallery-e': 'gallery.glb',
    'dadian': 'dadian.glb', 'court3': 'court3.glb', 'houdian': 'houdian.glb',
}
n_axis = 0
for a in _v3m['templeAxis']['assets']:
    key = a.get('key') or a.get('id')
    if key not in FILE_FOR_KEY:
        continue   # tree-* entries (instanced separately below)
    fname = FILE_FOR_KEY[key]
    import_glb(V3 / fname,
               loc_bl=(a['positionGlb'][0], -a['positionGlb'][2], a['positionGlb'][1]),
               rot_z=+a['rotationYRad'])
    n_axis += 1
# trees v2 (adoption batch I2): temple-local positions -> world via the bridge
# transform; the v2 GLB lives in the axis-v3 dataset
_c, _s = math.cos(YAW), math.sin(YAW)
for tid, loc in _axis_manifest['assets']['tree']['instancesAt'].items():
    wx = T[0] + _c * loc[0] + _s * loc[2]
    wz = T[2] - _s * loc[0] + _c * loc[2]
    import_glb(V3 / 'tree-camphor-v2.glb', loc_bl=(wx, -wz, loc[1]), rot_z=+YAW)

# street props (E batch): 38 planned instances of 5 objects
if args.props or True:  # v3: props default ON (K batch)
    _props_dir = ROOT / 'kit/out/props'
    for inst in json.loads((_props_dir / 'plan.json').read_text())['instances']:
        import_glb(_props_dir / f'{inst["item"]}.glb',
                   loc_bl=(inst['positionGlb'][0], -inst['positionGlb'][2], inst['y'] or 0),
                   rot_z=+inst['rotationYRad'])

wsb = next(x for x in blocks['blocks'] if x['id'] == 'block-west-shops')
n_ws = 0
for a in wsb['assets']:
    import_glb(ROOT / a['glb'].lstrip('./'),
               loc_bl=(a['positionGlb'][0], -a['positionGlb'][2], a['positionGlb'][1]),
               rot_z=+a['rotationYRad'])
    n_ws += 1
import_glb(DS_DIR / 'westshops-strips.glb')

# --- east band (adoption batch package J, G5) -----------------------------------
import_glb(DS_DIR / 'east-extension/surface.glb')
import_glb(DS_DIR / 'east-extension/seal-wall.glb')
_east_strips = DS_DIR / 'eastshops-strips.glb'
if _east_strips.exists():
    import_glb(_east_strips)
_east_block = next(x for x in blocks['blocks'] if x['id'] == 'block-east-shops')
n_es = 0
for a in _east_block['assets']:
    if a['id'] == 'eastshops-strips':
        continue
    import_glb(ROOT / a['glb'].lstrip('./'),
               loc_bl=(a['positionGlb'][0], -a['positionGlb'][2], a['positionGlb'][1]),
               rot_z=+a['rotationYRad'])
    n_es += 1

# --- skins (?skins=1 semantics) ------------------------------------------------
sk_dir = ROOT / 'world' / 'street-sidefaces'
sk_manifest = json.loads((sk_dir / 'review-manifest.json').read_text(encoding='utf-8'))
sk_instances = json.loads((sk_dir / 'instances.json').read_text(encoding='utf-8'))
skin_by_id = {s['id']: s for s in sk_manifest['skins']}
n_m = n_a = 0
for i in sk_instances['instances']:
    k = skin_by_id[i['skin']]
    if i['batch'] == 'A':
        import_glb(ROOT / k['glb'].lstrip('./'),
                   loc_bl=(i['positionGlb'][0], -i['positionGlb'][2], i['positionGlb'][1]),
                   rot_z=+i['rotationYRad'])
        n_a += 1
    else:
        import_glb(ROOT / k['glb'].lstrip('./'))
        n_m += 1

# --- normals + placeholder grays ----------------------------------------------
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

# --- lights + world: the F0 unified rig (DESIGN_SPEC packageF.lightRig) --------
import light_rig
light_rig.apply(scene)

# --- 26 cameras ------------------------------------------------------------------
cam_col = bpy.data.collections.new('v2_cameras')
scene.collection.children.link(cam_col)
cam_data = bpy.data.cameras.new('cam')
cam_data.sensor_fit = 'VERTICAL'
cam_data.sensor_width = 36
cam_data.clip_end = 1200


def look_at(obj, loc, target):
    obj.location = loc
    d = (target[0] - loc[0], target[1] - loc[1], target[2] - loc[2])
    rot_x = math.acos(max(-1.0, min(1.0, -d[2] / math.dist(loc, target))))
    rot_z = math.atan2(d[1], d[0]) - math.pi / 2
    obj.rotation_euler = (rot_x, 0.0, rot_z)


cam_objects = {}
for c in CAMERAS:
    cd = cam_data.copy()
    cd.angle = math.radians(c['verticalFovDegrees'])
    o = bpy.data.objects.new(f'cam__{c["id"]}', cd)
    cam_col.objects.link(o)
    loc = (c['positionGlb'][0], -c['positionGlb'][2], c['positionGlb'][1])
    tar = (c['targetGlb'][0], -c['targetGlb'][2], c['targetGlb'][1])
    look_at(o, loc, tar)
    o['targetGlb'] = json.dumps(c['targetGlb'])
    o['verticalFovDegrees'] = c['verticalFovDegrees']
    cam_objects[c['id']] = o

# --- render settings + save --------------------------------------------------------
scene.render.engine = 'CYCLES'
scene.cycles.samples = args.samples
scene.render.resolution_x = W
scene.render.resolution_y = H
if args.device == 'GPU':
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'CUDA'
    prefs.get_devices()
    n_gpu = 0
    for d in prefs.devices:
        if d.type == 'CUDA':
            d.use = True
            n_gpu += 1
    if n_gpu == 0:
        print('GPU_REQUESTED_BUT_NO_CUDA_DEVICE -> CPU')
        scene.cycles.device = 'CPU'
    else:
        scene.cycles.device = 'GPU'

bpy.ops.file.pack_all()
args.out.mkdir(parents=True, exist_ok=True)
blend_path = args.out / 'scene-v3.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

n_missing = sum(1 for img in bpy.data.images if img.source == 'FILE' and not img.packed_file)
if n_missing:
    print(f'MISSING_IMAGES {n_missing}')
    sys.exit(10)

sidecar = {
    'source': 'kit/build_world_v3_scene.py', 'blend': str(blend_path),
    'device': args.device, 'samples': args.samples, 'resolution': [W, H],
    'assembly': (f'street + surfaces(w+e) + {n_axis} temple-axis-V3 assets + {n_ws} westshop modules '
                 f'+ {n_es} eastshop modules + strips(w+e) + skins (M {n_m} + A {n_a}) + {n_boxes} grays + 4 camphor trees v2'
                 + ' + 38 street props (v3 default)'),
    'props': bool(args.props),
    'axisAerialFix': {'old': {'positionGlb': [-30, 42, -20], 'targetGlb': [0, 0, -50],
                              'verticalFovDegrees': 50},
                      'new': NEW_AERIAL_POSE_LOCAL, 'note': 'pose authored axis-local, rendered through the bridge transform'},
    'cameras': [c['id'] for c in CAMERAS],
    'renders': [],
}

RENDER_MAP = {
    'aerial': ('bridge:aerial-overview', 'bridge__aerial-overview'),
    'new-aerial': ('temple:axis-aerial', 'temple__axis-aerial'),
    'shanmen-from-road': ('bridge:shanmen-from-road', 'bridge__shanmen-from-road'),
    'forecourt-oblique': ('bridge:forecourt-oblique', 'bridge__forecourt-oblique'),
    'court2-pair': ('temple:court2-pair', 'temple__court2-pair'),
    'court3-axis': ('temple:court3-axis', 'temple__court3-axis'),
    'street-junction-west': ('bridge:junction-west', 'bridge__junction-west'),
    'street-placeholder-band': ('bridge:placeholder-band', 'bridge__placeholder-band'),
    'stage-from-court': ('temple:stage-from-court', 'temple__stage-from-court'),
    'houdian-front': ('temple:houdian-front', 'temple__houdian-front'),
    'east-junction': ('bridge:east-junction', 'eastband__east-junction'),
    'east-road-mid': ('bridge:east-road-mid', 'eastband__east-road-mid'),
    'east-end-wall': ('bridge:east-end-wall', 'eastband__east-end-wall'),
}
OLD_AERIAL_LOCAL = {'positionGlb': [-30, 42, -20], 'targetGlb': [0, 0, -50],
                    'verticalFovDegrees': 50}

import numpy as _np


def blank_guard(img_path: Path) -> dict:
    px = _np.array(bpy.data.images.load(str(img_path)).pixels[:], dtype=_np.float32)
    bpy.data.images.remove(bpy.data.images[img_path.name])
    rgb = px.reshape(-1, 4)[:, :3]
    lum = rgb.mean(axis=1)
    std = float(lum.std() * 255.0)
    vals, counts = _np.unique(_np.round(lum, 3), return_counts=True)
    mono = float(counts.max()) / float(lum.size)
    return {'brightnessStd255': round(std, 3), 'monoFraction': round(mono, 4),
            'blank': bool(std < 2.0 or mono > 0.95)}


fails = 0
if args.render == 'all':
    # every camera in the contract, one still each (K0: 29 stills)
    args.render = ','.join(sorted(
        {name for name, (_cid, _f) in RENDER_MAP.items()} |
        {c['id'] for c in CAMERAS if c['id'] not in {cid for (cid, _f) in RENDER_MAP.values()}}))
for name in [x.strip() for x in args.render.split(',') if x.strip() and x != 'none']:
    if name == 'old-aerial':
        # the OLD axis-aerial pose (axis-local -> world) for the fix comparison
        cid = 'temple:axis-aerial'
        cam = cam_objects[cid]
        p_w = axis_local_to_world(OLD_AERIAL_LOCAL['positionGlb'])
        t_w = axis_local_to_world(OLD_AERIAL_LOCAL['targetGlb'])
        cam.location = (p_w[0], -p_w[2], p_w[1])
        import mathutils
        d = mathutils.Vector((t_w[0] - p_w[0], t_w[1] - p_w[1], t_w[2] - p_w[2]))
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        cam.data.angle = math.radians(OLD_AERIAL_LOCAL['verticalFovDegrees'])
        scene.camera = cam
        fp = args.out / f'camera-fix__axis-aerial-old-{args.device.lower()}.png'
        scene.render.filepath = str(fp)
        scene.render.image_settings.file_format = 'PNG'
        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        dt = round(time.time() - t0, 1)
        guard = blank_guard(fp)
        sidecar['renders'].append({'view': name, 'camera': cid, 'device': args.device,
                                   'seconds': dt, 'file': fp.name, 'guard': guard})
        print(f"RENDERED {name} {dt}s blank={guard['blank']}")
        if guard['blank']:
            fails += 1
        continue
    cid, fname = RENDER_MAP.get(name, (name, name.replace(':', '__')))
    if cid not in cam_objects:
        print(f'SKIP_UNKNOWN_VIEW {name}')
        continue
    scene.camera = cam_objects[cid]
    light_rig.apply(scene, scene.camera)          # fill follows each camera
    fp = args.out / f'{fname}-{args.device.lower()}.png'
    scene.render.filepath = str(fp)
    scene.render.image_settings.file_format = 'PNG'
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    dt = round(time.time() - t0, 1)
    guard = blank_guard(fp)
    sidecar['renders'].append({'view': name, 'camera': cid, 'device': args.device,
                               'seconds': dt, 'file': fp.name, 'guard': guard})
    print(f"RENDERED {name} {dt}s blank={guard['blank']}")
    if guard['blank']:
        fails += 1

# non-background fraction for the FIXED aerial (acceptance >= 40%)
if 'new-aerial' in args.render:
    fp = args.out / 'temple__axis-aerial-cpu.png' if args.device == 'CPU' \
        else args.out / 'temple__axis-aerial-gpu.png'
    px = _np.array(bpy.data.images.load(str(fp)).pixels[:], dtype=_np.float32)
    rgb = px.reshape(-1, 4)[:, :3]
    lum = rgb.mean(axis=1)
    bg = float(lum[0])  # corner pixel = sky reference
    nonbg = float(((_np.abs(lum - bg) > 0.02)).sum()) / lum.size
    sidecar['axisAerialFix']['nonBackgroundFraction'] = round(nonbg, 4)
    print(f'AXIS_AERIAL nonBackground={nonbg:.3f}')

(args.out / 'scene-v3-report.json').write_text(json.dumps(sidecar, indent=2) + '\n',
                                               encoding='utf-8')
print(f'SCENE_V3_READY cameras={len(CAMERAS)} renders={len(sidecar["renders"])} '
      f'blankFails={fails} out={args.out}')
sys.exit(1 if fails else 0)
