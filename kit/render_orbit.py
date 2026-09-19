"""F4 — clipB temple aerial orbit: 24 s @ 24 fps around the axis midpoint.

DESIGN_SPEC packageF.video.clipB: orbit (0,0,-45) r=55 h=40, target (0,4,-45)
— axis-LOCAL coords, transformed by the bridge placement (T+yaw) exactly like
the temple cameras in build_world_v2_scene.

Run:
  blender -b kit/out/scene-v2/scene-v2.blend -noaudio --python kit/render_orbit.py -- \
      --frames artifacts/corridor-video/frames-b [--start-frame 0] [--max-frames 0] [--device CPU]
"""
import argparse
import json
import math
import subprocess
import sys
import time
from pathlib import Path

import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--frames', type=Path, default=Path('artifacts/corridor-video/frames-b'))
p.add_argument('--width', type=int, default=1280)
p.add_argument('--height', type=int, default=720)
p.add_argument('--samples', type=int, default=16)
p.add_argument('--fps', type=int, default=24)
p.add_argument('--duration', type=float, default=24.0)
p.add_argument('--center-local', type=str, default='0,0,-45')
p.add_argument('--target-local', type=str, default='0,4,-45')
p.add_argument('--orbit-radius', type=float, default=55.0)
p.add_argument('--orbit-height', type=float, default=40.0)
p.add_argument('--device', type=str, default='CPU', choices=['CPU', 'GPU'])
p.add_argument('--start-frame', type=int, default=0)
p.add_argument('--max-frames', type=int, default=0)
args = p.parse_args(argv)

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import light_rig  # noqa: E402

T = [-127.817, 0.0, 27.057]
YAW = 0.16703
cy, sy = math.cos(YAW), math.sin(YAW)


def w(p):
    return [T[0] + cy * p[0] + sy * p[2], p[1], T[2] - sy * p[0] + cy * p[2]]


center = w([float(v) for v in args.center_local.split(',')])
target = w([float(v) for v in args.target_local.split(',')])
n_frames = int(args.duration * args.fps)
if args.max_frames:
    n_frames = min(n_frames, args.start_frame + args.max_frames)

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
try:
    scene.cycles.denoiser = 'OPENIMAGEDENOISE'
except Exception:
    pass
scene.render.resolution_x = args.width
scene.render.resolution_y = args.height
scene.render.image_settings.file_format = 'PNG'

device = args.device
if device == 'GPU':
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'CUDA'
    prefs.get_devices()
    if not any(d.type == 'CUDA' for d in prefs.devices):
        device = 'CPU'
    else:
        for d in prefs.devices:
            d.use = d.type == 'CUDA'
        scene.cycles.device = 'GPU'

from mathutils import Vector
cam = next(o for o in scene.objects if o.type == 'CAMERA')
args.frames.mkdir(parents=True, exist_ok=True)
log = {'clip': 'temple-aerial-orbit', 'framesPlanned': n_frames, 'device': device,
       'events': [], 'frames': []}

t0 = time.time()
frame_times = []
blank_streak = 0
for f in range(args.start_frame, n_frames):
    png = args.frames / f'frame-b-{f:05d}.png'
    if png.exists():
        continue
    ang = 2 * math.pi * f / n_frames
    px = center[0] + args.orbit_radius * math.cos(ang)
    py = center[2] + args.orbit_radius * math.sin(ang)
    loc = Vector((px, -py, args.orbit_height))
    tgt = Vector((target[0], -target[2], target[1]))
    d = tgt - loc
    cam.location = loc
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    light_rig.apply(scene, cam)
    scene.camera = cam
    scene.render.filepath = str(png)
    tt = time.time()
    bpy.ops.render.render(write_still=True)
    dt = time.time() - tt
    frame_times.append(dt)
    px2 = np.array(bpy.data.images.load(str(png)).pixels[:], dtype=np.float32).reshape(-1, 4)
    img = bpy.data.images[png.name]
    bpy.data.images.remove(img)
    lum = px2[:, :3].mean(axis=1) * 255
    std = float(lum.std())
    blank = std < 2
    log['frames'].append({'frame': f, 'seconds': round(dt, 2), 'std': round(std, 1), 'blank': blank})
    blank_streak = blank_streak + 1 if blank else 0
    if blank_streak >= 3:
        log['events'].append({'event': 'STOP_BLANKS', 'frame': f})
        break
    if f % 100 == 0:
        avg = sum(frame_times[-100:]) / min(100, len(frame_times))
        log['events'].append({'event': 'progress', 'frame': f, 'avg': round(avg, 2),
                              'eta_min': round((n_frames - f) * avg / 60, 1)})
        (args.frames.parent / 'render-log-orbit.json').write_text(json.dumps(log, indent=1))
        print(f'PROGRESS orbit frame={f} avg={avg:.2f}s')

avg = sum(frame_times) / len(frame_times) if frame_times else 0
log['summary'] = {'framesRendered': len(frame_times), 'avgFrameSeconds': round(avg, 2),
                  'totalRenderMinutes': round((time.time() - t0) / 60, 1), 'device': device}
(args.frames.parent / 'render-log-orbit.json').write_text(json.dumps(log, indent=1))
print(f'ORBIT_DONE frames={len(frame_times)} avg={avg:.2f}s')
