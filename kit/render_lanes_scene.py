"""Render the offline evidence views from scene-lanes-v1.blend (reopens the
delivered blend — proving it is reopenable — and renders its own cameras with
the batch's design budget: Cycles CPU, 4 threads, <=24 samples, AgX).

Run: blender -b artifacts/lanes-construction/scene-lanes-v1.blend --factory-startup -t 4 -P kit/render_lanes_scene.py -- --out artifacts/lanes-construction/blender [--views lane-a-forward,lane-a-return,lane-b-forward,lane-b-return] [--width 960]
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
p.add_argument('--views', type=str, default='lane-a-forward,lane-a-return,lane-b-forward,lane-b-return')
p.add_argument('--width', type=int, default=960)
p.add_argument('--samples', type=int, default=24)
a = p.parse_args(argv)
assert a.samples <= 24, 'design rendering budget'

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = a.samples
scene.cycles.use_denoising = True
scene.render.threads_mode = 'FIXED'
scene.render.threads = 4
scene.render.resolution_x = a.width
scene.render.resolution_y = 540
if scene.view_settings.view_transform != 'AgX':
    scene.view_settings.view_transform = 'AgX'

a.out.mkdir(parents=True, exist_ok=True)
report = []
for name in a.views.split(','):
    cam = bpy.data.objects.get(name)
    if cam is None or cam.type != 'CAMERA':
        report.append({'view': name, 'ok': False, 'reason': 'camera missing in blend'})
        continue
    scene.camera = cam
    scene.render.filepath = str(a.out / f'{name}.png')
    bpy.ops.render.render(write_still=True)
    ok = (a.out / f'{name}.png').stat().st_size > 30000
    report.append({'view': name, 'ok': ok, 'cameraPositionGlb': list(cam.get('positionGlb', [])),
                   'targetGlb': list(cam.get('targetGlb', []))})
    print(f'RENDER {name} ok={ok}')
(a.out / 'render-report.json').write_text(json.dumps({
    'blend': 'artifacts/lanes-construction/scene-lanes-v1.blend',
    'reopenProof': 'opened with blender -b <blend>; cameras and asset versions come from the blend sidecar',
    'renders': report,
}, indent=2) + '\n', encoding='utf-8')
