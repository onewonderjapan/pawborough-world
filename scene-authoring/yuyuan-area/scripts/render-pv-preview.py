# -*- coding: utf-8 -*-
"""wave11-pvboard：PV 动态样片用的 Workbench beauty 预览（只出 beauty 一个通道，分辨率可降）。

与 scripts/render-control-passes.py 的 beauty 通道同一套设置（Workbench TEXTURE + STUDIO、Standard 视图变换、
天灰背景、同一相机约定：地图 [x,y,z] → Blender (x,-z,y)、36 mm 横幅传感器 + 镜头 lensMm、near/far 取相机 json），
只是不出 depth / normal / segmentation，也不写相机 json——相机真值在 pv-cameras.json 与四通道预览里。
预览只是节奏 / 取景参考，不是正式渲染；正式条件输入用 render-control-passes.py（见 artifacts/pv/AI-HANDOFF.md）。

用法（Blender 4.x，CPU，同时只跑 1 个）：
  blender -b -t 4 --python-exit-code 1 --python scripts/render-pv-preview.py -- \
      --scene <OUT_DIR>/scene-areas.glb --cameras <取样后的 pv 相机 json> --out <目录> \
      [--width 640 --height 360] [--shots id1,id2] [--aa 8]
输出：<out>/<shot>/frame-###.png（### = 取样序号；对应 24 fps 帧号见相机 json 的 sourceFrames）+ <out>/render-log.json
"""
import bpy
import json
import os
import sys
import time


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = __import__('argparse').ArgumentParser()
    ap.add_argument('--scene', required=True)
    ap.add_argument('--cameras', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--width', type=int, default=640)
    ap.add_argument('--height', type=int, default=360)
    ap.add_argument('--shots', default='')
    ap.add_argument('--aa', default='8')
    return ap.parse_args(argv)


def to_blender(p):
    return (p[0], -p[2], p[1])


def main():
    a = parse_args()
    doc = json.load(open(a.cameras, encoding='utf-8'))
    want = [s for s in doc['shots'] if not a.shots or s['id'] in a.shots.split(',')]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    r = scene.render
    r.resolution_x, r.resolution_y, r.resolution_percentage = a.width, a.height, 100
    r.image_settings.file_format = 'PNG'
    r.image_settings.color_mode = 'RGB'
    r.image_settings.color_depth = '8'
    r.film_transparent = False
    t0 = time.perf_counter()
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.scene))
    print('[pv-preview] glb imported in %.1fs' % (time.perf_counter() - t0), flush=True)

    r.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'TEXTURE'
    sh.show_shadows = False
    sh.show_cavity = False
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    r.filter_size = 1.5
    try:
        scene.display.render_aa = a.aa
    except TypeError:
        pass
    w = bpy.data.worlds.new('pv-world')
    w.color = (0.53, 0.60, 0.67)
    scene.world = w
    try:
        sh.background_type = 'WORLD'
    except TypeError:
        pass

    cam_data = bpy.data.cameras.new('pv-cam')
    cam_data.clip_start, cam_data.clip_end = doc['nearM'], doc['farM']
    cam_data.sensor_width = 36.0
    cam_ob = bpy.data.objects.new('pv-cam', cam_data)
    scene.collection.objects.link(cam_ob)
    scene.camera = cam_ob
    from mathutils import Vector

    log = {'scene': a.scene, 'cameras': a.cameras, 'width': a.width, 'height': a.height, 'shots': {}}
    for s in want:
        cam_data.lens = float(s.get('lensMm', 50.0))
        d = os.path.join(a.out, s['id'])
        os.makedirs(d, exist_ok=True)
        t1 = time.perf_counter()
        for k in range(s['frames']):
            eye, tgt = to_blender(s['eye'][k]), to_blender(s['target'][k])
            cam_ob.location = eye
            cam_ob.rotation_euler = (Vector(tgt) - Vector(eye)).to_track_quat('-Z', 'Y').to_euler()
            r.filepath = os.path.join(d, 'frame-%03d.png' % k)
            bpy.ops.render.render(write_still=True)
        log['shots'][s['id']] = {'frames': s['frames'], 'sourceFrames': s.get('sourceFrames'),
                                 'seconds': round(time.perf_counter() - t1, 1)}
        print('[pv-preview] %s %d frames %.1fs' % (s['id'], s['frames'], time.perf_counter() - t1), flush=True)
    lp = os.path.join(a.out, 'render-log.json')
    if os.path.exists(lp):
        old = json.load(open(lp, encoding='utf-8'))
        old['shots'].update(log['shots'])
        log['shots'] = old['shots']
    with open(lp, 'w', encoding='utf-8') as f:
        json.dump(log, f, ensure_ascii=False, indent=1)
        f.write('\n')


main()
