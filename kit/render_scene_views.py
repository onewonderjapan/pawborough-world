"""Generic scene re-render: reopen a scene blend, render selected contract
cameras with blank-frame guard + timing.  Reused by D0 before-shots, F0
lighting pixel-diff check and the F2 26-still re-render.

Usage:
  blender -b <scene.blend> -P kit/render_scene_views.py -- \
      --out <dir> [--cameras street:junction-west,temple:court2-pair | --all] \
      [--width 1600 --height 900 --samples 24 --device CPU|GPU] \
      [--prefix scene-v1] [--log <render-log.json>]

Blank-frame guard (contract): std-brightness < 2/255 or single-tone > 95%
=> non-zero exit.  Log appends {"camera","device","seconds","width","height"}.
"""
import argparse
import json
import sys
import time
from pathlib import Path

import bpy
import numpy as np
import sys as _sys
import pathlib as _pathlib
_sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parent))

argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--out', type=Path, required=True)
p.add_argument('--cameras', type=str, default='')
p.add_argument('--all', action='store_true')
p.add_argument('--width', type=int, default=1600)
p.add_argument('--height', type=int, default=900)
p.add_argument('--samples', type=int, default=24)
p.add_argument('--device', type=str, default='CPU', choices=['CPU', 'GPU'])
p.add_argument('--prefix', type=str, default='view')
p.add_argument('--log', type=Path, default=None)
p.add_argument('--denoise', type=str, default='OIDN', choices=['OIDN', 'OPENIMAGEDENOISE', 'NONE'])
p.add_argument('--no-rig', action='store_true')
p.add_argument('--fix-temple-cameras', action='store_true',
               help='rebuild temple:* cameras from world/temple-axis-v2/cameras.json '
                    '(axis-local) transformed by the bridge placement T+yaw. scene-v1 '
                    'baked them raw; both sides of the before/after set use this flag.')
args = p.parse_args(argv)

scene = bpy.context.scene
# F0 unified rig (re-applied per camera below); --no-rig keeps legacy lighting
import light_rig
RIG = not args.no_rig
if RIG:
    light_rig.apply(scene)
if args.fix_temple_cameras:
    import math
    import mathutils
    root = Path(bpy.data.filepath).resolve().parents[3]
    contract = json.loads((root / 'world/temple-axis-v2/cameras.json').read_text())['cameras']
    T = [-127.817, 0.0, 27.057]
    YAW = 0.16703
    cy, sy = math.cos(YAW), math.sin(YAW)

    def w(p):
        return [T[0] + cy * p[0] + sy * p[2], p[1], T[2] - sy * p[0] + cy * p[2]]

    for c in contract:
        o = bpy.data.objects.get('cam__temple:' + c['id'])
        if not o:
            continue
        p_w = w(c['positionGlb'])
        t_w = w(c['targetGlb'])
        o.location = (p_w[0], -p_w[2], p_w[1])
        # BL axes: (x, -z, y) — map the DELTA too
        d = mathutils.Vector((t_w[0] - p_w[0], -(t_w[2] - p_w[2]), t_w[1] - p_w[1]))
        o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        o.data.angle = math.radians(c['verticalFovDegrees'])
    bpy.context.view_layer.update()
cams = {o.name[len('cam__'):]: o for o in scene.objects
        if o.type == 'CAMERA' and o.name.startswith('cam__')}
wanted = sorted(cams.keys()) if args.all else [c.strip() for c in args.cameras.split(',') if c.strip()]
missing = [c for c in wanted if c not in cams]
if missing:
    print(f'MISSING_CAMERAS {missing}; have {sorted(cams.keys())}')
    sys.exit(2)

scene.render.engine = 'CYCLES'
scene.cycles.samples = args.samples
scene.render.resolution_x = args.width
scene.render.resolution_y = args.height
scene.cycles.use_denoising = args.denoise != 'NONE'
if args.denoise == 'OIDN':
    try:
        scene.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
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
        print('GPU_REQUESTED_BUT_NO_CUDA_DEVICE -> falling back to CPU')
        scene.cycles.device = 'CPU'
        args.device = 'CPU'
    else:
        scene.cycles.device = 'GPU'

args.out.mkdir(parents=True, exist_ok=True)
out_abs = args.out.resolve()
log_path = args.log if args.log else args.out / 'render-log.json'
entries = []
if log_path.exists():
    try:
        entries = json.loads(log_path.read_text(encoding='utf-8'))
        if isinstance(entries, dict):
            entries = entries.get('renders', [])
    except Exception:
        entries = []


def blank_guard(img_path: Path) -> dict:
    px = np.array(bpy.data.images.load(str(img_path)).pixels[:], dtype=np.float32)
    bpy.data.images.remove(bpy.data.images[img_path.name])
    rgb = px.reshape(-1, 4)[:, :3]
    lum = rgb.mean(axis=1)
    std = float(lum.std() * 255.0)
    vals, counts = np.unique(np.round(lum, 3), return_counts=True)
    mono = float(counts.max()) / float(lum.size)
    return {'brightnessStd255': round(std, 3), 'monoFraction': round(mono, 4),
            'blank': bool(std < 2.0 or mono > 0.95)}


fails = 0
for cid in wanted:
    scene.camera = cams[cid]
    if RIG:
        light_rig.apply(scene, scene.camera)
    fp = out_abs / f'{args.prefix}--{cid.replace(":", "__")}-{args.device.lower()}.png'
    scene.render.filepath = str(fp)
    scene.render.image_settings.file_format = 'PNG'
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    dt = round(time.time() - t0, 1)
    guard = blank_guard(fp)
    entry = {'camera': cid, 'device': args.device, 'samples': args.samples,
             'resolution': [args.width, args.height], 'seconds': dt,
             'file': str(fp), 'guard': guard}
    entries.append(entry)
    print(f"RENDERED {cid} {dt}s blank={guard['blank']} std={guard['brightnessStd255']}")
    if guard['blank']:
        fails += 1
    log_path.write_text(json.dumps({'renders': entries}, indent=2) + '\n', encoding='utf-8')

print(f'VIEWS_DONE n={len(wanted)} blankFrames={fails}')
sys.exit(1 if fails else 0)
