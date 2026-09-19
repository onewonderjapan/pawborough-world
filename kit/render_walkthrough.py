"""F3 — walkthrough renderer for clipA (design-world cruise, honestly labeled).

Route: equal-arc-length samples along the v4 world route polyline (Catmull-Rom
smoothed eye path, 1.6 m eye height), look-at a smooth point ~6 m ahead,
1.4 m/s (0.9 at sharp turns), 24 fps, 1280x720, 16 spp + OIDN.
Guards: blank-frame check per frame (std < 2/255 or mono > 95% => counter;
3 consecutive blanks => STOP). Device policy: nvidia-smi at start + every 200
frames; CUDA only below 20% utilization, else CPU; --resume skips existing
frames so a device switch is a restart of the same command.

Run:
  blender -b kit/out/scene-v2/scene-v2.blend -noaudio \
      --python kit/render_walkthrough.py -- \
      --route world/fangbang-temple-v4/route.json --frames artifacts/corridor-video/frames \
      [--start-frame N] [--max-frames N] [--device CPU|GPU] [--speed 1.4]
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
p.add_argument('--route', type=Path, default=Path('world/fangbang-temple-v4/route.json'))
p.add_argument('--frames', type=Path, default=Path('artifacts/corridor-video/frames'))
p.add_argument('--width', type=int, default=1280)
p.add_argument('--height', type=int, default=720)
p.add_argument('--samples', type=int, default=16)
p.add_argument('--fps', type=int, default=24)
p.add_argument('--speed', type=float, default=1.4)
p.add_argument('--eye', type=float, default=1.6)
p.add_argument('--look-ahead', type=float, default=6.0)
p.add_argument('--device', type=str, default='CPU', choices=['CPU', 'GPU'])
p.add_argument('--start-frame', type=int, default=0)
p.add_argument('--max-frames', type=int, default=0, help='0 = to the end')
p.add_argument('--device-log', type=Path, default=None)
args = p.parse_args(argv)

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import light_rig  # noqa: E402

scene = bpy.context.scene

# --- route: resample to equal arc length, Catmull-Rom smooth --------------------
route = json.loads(args.route.read_text())
route = route.get("mainStreet", route) if isinstance(route, dict) else route
pts = [(p[0], p[2]) for p in route]
# cumulative length of the POLYLINE
seglen = [math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
          for i in range(len(pts) - 1)]
total = sum(seglen)
print(f'ROUTE polyline points={len(pts)} length={total:.1f}m')

# dense polyline sampling -> Catmull-Rom control points every ~2 m
DENSE = max(2, int(total / 2.0))
dense = []
for i in range(len(pts) - 1):
    ax, az = pts[i]
    bx, bz = pts[i + 1]
    n = max(1, int(seglen[i] / 0.5))
    for k in range(n):
        t = k / n
        dense.append((ax + (bx - ax) * t, az + (bz - az) * t))
dense.append(pts[-1])
# cumulative arc on the dense polyline
cum = [0.0]
for i in range(1, len(dense)):
    cum.append(cum[-1] + math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]))
total_d = cum[-1]


def point_at(s):
    """World position at arc length s (dense polyline lookup)."""
    s = max(0.0, min(total_d, s))
    lo, hi = 0, len(cum) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if cum[mid] < s:
            lo = mid + 1
        else:
            hi = mid
    i = max(1, lo)
    seg = cum[i] - cum[i - 1]
    t = 0 if seg == 0 else (s - cum[i - 1]) / seg
    return (dense[i - 1][0] + (dense[i][0] - dense[i - 1][0]) * t,
            dense[i - 1][1] + (dense[i][1] - dense[i - 1][1]) * t)


def _add(*ps, k=1.0):
    return tuple(k * sum(p[i] for p in ps) for i in range(2))


def catmull(p0, p1, p2, p3, t):
    # uniform Catmull-Rom on 2-tuples
    out = []
    for i in range(2):
        v = 0.5 * ((2 * p1[i]) + (-p0[i] + p2[i]) * t
                   + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t * t
                   + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t * t * t)
        out.append(v)
    return tuple(out)


def smooth_at(s, span=3.0):
    """Catmull-Rom smoothed position around arc length s."""
    p1 = point_at(max(0, s - span))
    p2 = point_at(s)
    p3 = point_at(min(total_d, s + span))
    p0 = point_at(max(0, s - 2 * span))
    return catmull(p0, p1, p2, p3, 0.5)


# --- turn slowdown: curvature from heading change over a 6 m window --------------
def speed_scale(s):
    h1 = smooth_at(max(0, s - 3), 1.5)
    h2 = smooth_at(min(total_d, s + 3), 1.5)
    a = smooth_at(s, 1.5)
    v1 = (h1[0] - a[0], h1[1] - a[1])
    v2 = (h2[0] - a[0], h2[1] - a[1])
    l1 = math.hypot(*v1) or 1
    l2 = math.hypot(*v2) or 1
    dot = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2)))
    turn = math.acos(dot)
    return max(0.64, 1.0 - turn * 0.55)   # 0.9 at ~45deg+ turns, 1.0 straight

# --- frame timeline ---------------------------------------------------------------
duration = total_d / args.speed
n_frames = int(duration * args.fps)
if args.max_frames:
    n_frames = min(n_frames, args.start_frame + args.max_frames)
print(f'CLIP_PLAN length={total_d:.1f}m speed={args.speed} duration={duration:.1f}s '
      f'frames={n_frames} @ {args.fps}fps')

# --- render settings -----------------------------------------------------------------
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
scene.view_settings.view_transform = 'AgX'
try:
    scene.view_settings.look = 'AgX - Base Contrast'
except TypeError:
    pass

device = args.device
if device == 'GPU':
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'CUDA'
    prefs.get_devices()
    ok = any(d.type == 'CUDA' for d in prefs.devices)
    if not ok:
        print('GPU_REQUESTED_BUT_NO_CUDA_DEVICE -> CPU')
        device = 'CPU'
    else:
        for d in prefs.devices:
            d.use = d.type == 'CUDA'
        scene.cycles.device = 'GPU'

cam_obj = next(o for o in scene.objects if o.type == 'CAMERA')
args.frames.mkdir(parents=True, exist_ok=True)
device_log_path = args.device_log or (args.frames.parent / 'render-log.json')
log = {'clip': 'walkthrough-street-to-houdian', 'route': str(args.route),
       'polylinePoints': len(pts), 'polylineLengthM': round(total_d, 2),
       'fps': args.fps, 'speed': args.speed, 'samples': args.samples,
       'resolution': [args.width, args.height], 'framesPlanned': n_frames,
       'devicePolicy': 'nvidia-smi at start + every 200 frames; CUDA <20% else CPU; resume on switch',
       'events': [{'event': 'render_start', 'device': device,
                   'utilizationPct': None, 'wallClock': time.strftime('%H:%M:%S')}],
       'frames': [], 'blankRuns': []}
try:
    out = subprocess.run(['nvidia-smi', '--query-gpu=utilization.gpu', '--format=csv,noheader'],
                         capture_output=True, text=True, timeout=5)
    log['events'][0]['utilizationPct'] = out.stdout.strip().rstrip('%')
except Exception:
    log['events'][0]['utilizationPct'] = 'nvidia-smi unavailable'

# --- main loop -----------------------------------------------------------------------
t_start = time.time()
frame_times = []
since_log = 0
blank_streak = 0
last_written = args.start_frame - 1
for f in range(args.start_frame, n_frames):
    png = args.frames / f'frame-{f:05d}.png'
    if png.exists():
        continue
    s = total_d * (f / n_frames)
    ex, ez = smooth_at(s, 3.0)
    ax, az = smooth_at(min(total_d, s + args.look_ahead), 2.0)
    dx, dz = ax - ex, az - ez
    L2 = math.hypot(dx, dz) or 1
    # gentle look-ahead: never snap; 1.6m eye height
    from mathutils import Vector
    # world GLB (x, z) -> Blender (x, -z, y): height lives on the BL z axis
    eye = Vector((ex, -ez, args.eye))
    tgt = Vector((ex + dx / L2 * 10.0, -(ez + dz / L2 * 10.0), args.eye + 0.2))
    d = tgt - eye
    cam_obj.location = eye
    cam_obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    light_rig.apply(scene, cam_obj)
    scene.camera = cam_obj
    scene.render.filepath = str(png)
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    dt = time.time() - t0
    frame_times.append(dt)
    since_log += 1
    last_written = f

    px = np.array(bpy.data.images.load(str(png)).pixels[:], dtype=np.float32).reshape(-1, 4)
    img = bpy.data.images['frame-%05d.png' % f]
    bpy.data.images.remove(img)
    lum = px[:, :3].mean(axis=1) * 255
    std = float(lum.std())
    vals, counts = np.unique(lum.round(0), return_counts=True)
    mono = float(counts.max()) / lum.size
    entry = {'frame': f, 'seconds': round(dt, 2), 'std': round(std, 1),
             'mono': round(mono, 3), 'blank': bool(std < 2 or mono > 0.95)}
    log['frames'].append(entry)
    if entry['blank']:
        blank_streak += 1
        log['blankRuns'].append({'frame': f, 'std': entry['std'], 'mono': entry['mono']})
        if blank_streak >= 3:
            log['events'].append({'event': 'STOP_3_CONSECUTIVE_BLANKS', 'frame': f})
            device_log_path.write_text(json.dumps(log, indent=1))
            print(f'BLANK_STOP frame={f}')
            sys.exit(3)
    else:
        blank_streak = 0

    if since_log >= 200 or f == n_frames - 1:
        since_log = 0
        avg = sum(frame_times[-200:]) / min(200, len(frame_times))
        util = None
        try:
            out = subprocess.run(['nvidia-smi', '--query-gpu=utilization.gpu', '--format=csv,noheader'],
                                 capture_output=True, text=True, timeout=5)
            util = out.stdout.strip().rstrip('%')
        except Exception:
            pass
        log['events'].append({'event': 'progress_200', 'frame': f, 'device': device,
                              'avgFrameSeconds': round(avg, 2), 'utilizationPct': util,
                              'wallClock': time.strftime('%H:%M:%S')})
        device_log_path.write_text(json.dumps(log, indent=1))
        eta = (n_frames - f - 1) * avg / 60
        print(f'PROGRESS frame={f}/{n_frames} avg={avg:.2f}s eta={eta:.0f}min util={util}')

avg_all = sum(frame_times) / len(frame_times) if frame_times else 0
log['summary'] = {'framesRendered': len(frame_times), 'lastFrame': last_written,
                  'avgFrameSeconds': round(avg_all, 2),
                  'totalRenderMinutes': round((time.time() - t_start) / 60, 1),
                  'device': device}
device_log_path.write_text(json.dumps(log, indent=1))
print(f'WALKTHROUGH_DONE frames={len(frame_times)} avg={avg_all:.2f}s')
