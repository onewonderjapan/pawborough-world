# -*- coding: utf-8 -*-
"""WP11 C1：AI 视频控制层导出（beauty / depth / normal / segmentation + 每帧相机内外参 + LUT）。

场景来源（二选一写明）：用 out-zone/scene-areas.glb 重导入（全流程重建的最终产物，
含 assemble-food 增量；不依赖 assemble.py 的 scene.blend）。运行前先过公共验收重建。

用法（Blender 4.x，CPU）：
  blender -b -t 4 --python scripts/render-control-passes.py -- \
      --scene <OUT_DIR>/scene-areas.glb --cameras <OUT_DIR>/control-shots.json \
      --out <输出目录> [--shots id1,id2] [--layout baseline/layout.json]

相机输入 json（scripts/build-control-shots.py 生成；也可手写，格式）：
  { "version": 1, "width": 1280, "height": 720, "nearM": 0.3, "farM": 300.0,
    "coordinateNote": "坐标为地图系 [x, y高度, z]（同 tour.json）",
    "shots": [ { "id": "...", "frames": 24,
                 "eye":   [[x,y,z] ...],   # 每帧相机位置（地图系）
                 "target": [[x,y,z] ...], # 每帧注视点（地图系）
                 "targetId": "<layout id>",  # 可选：取景目标，原样写进 cameras json
                 "lensMm": 50 }              # 可选：焦距（36 mm 横幅传感器），缺省 50
               ] }
  也接受 out-zone/tour.json 风格的固定机位：shot 带 "p":[x,y,z],"t":[x,y,z]（单一机位）。

输出（--out 目录）：
  segmentation-lut.json            layout id <-> RGB 双向映射
  timings.json                     每帧各通道渲染耗时
  <shot>/beauty/frame-###.png      Workbench TEXTURE+STUDIO，Standard 视图变换，8-bit RGB（默认 AA）
  <shot>/depth/frame-###.png       Cycles Depth pass（视轴 z 深度，米），MapRange[near,far]->[0,1]，
                                   BW 16-bit PNG = round(65535*v)，clamp；背景=far
  <shot>/normal/frame-###.png      Cycles 1spp + material_override 自发光 (n+1)/2；n 为 glTF Y-up
                                   世界系法线（x,z,-y 从 Blender Z-up 置换）；8-bit RGB；背景=(0,0,0)
  <shot>/segmentation/frame-###.png Workbench FLAT+OBJECT 色（逐字节精确，filter_size=0 无 AA）；
                                   未归属几何与空背景 = LUT 的 unassigned 固定色
  <shot>/cameras/frame-###.json    fov、分辨率、K、worldToCamera（OpenGL 与 OpenCV 两种，4x4，
                                   glTF Y-up 世界约定）、depthNear/Far、编码说明

坐标约定：地图 (x,z) -> Blender (x,-z,y)；glTF Y-up 世界 = 地图 (x, y高度, z)（与 GLB/three.js 同系）。
分割归属：GLB 节点名 zone|id|kind|lod 取第 2 段；否则沿父链找 layout id 锚空节点；方浜中路件锚名
fangbang-*（v7 记录，非 layout 对象）单列成 id；其余 = unassigned。
颜色：md5(id) 派生 24-bit RGB，碰撞时用 id#k 重哈希；unassigned 固定 (255,0,255)。
"""
import bpy
import hashlib
import json
import math
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

UNASSIGNED = (255, 0, 255)
ARGS = None


def log(*a):
    print('[control]', *a, flush=True)


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = __import__('argparse').ArgumentParser()
    ap.add_argument('--scene', required=True)
    ap.add_argument('--cameras', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--layout', default=os.path.join(ROOT, 'baseline', 'layout.json'))
    ap.add_argument('--shots', default='')
    return ap.parse_args(argv)


# ---------------- 色板 ----------------
def color_for(used, ident):
    h = hashlib.md5(ident.encode('utf-8')).digest()
    c = (h[0], h[1], h[2])
    k = 0
    while c in used or c == UNASSIGNED:
        k += 1
        h = hashlib.md5(('%s#%d' % (ident, k)).encode('utf-8')).digest()
        c = (h[0], h[1], h[2])
    used.add(c)
    return c


def strip_suffix(name):
    if '.' in name:
        base, suf = name.rsplit('.', 1)
        if suf.isdigit() and len(suf) <= 3:
            return base
    return name


def layout_id_of(obj, id_set):
    n = obj.name
    if '|' in n:
        parts = n.split('|')
        if len(parts) >= 2:
            cand = parts[1]
            if cand in id_set:
                return cand
            if len(parts) == 2 and obj.parent is None:
                return cand        # food|<socket> 顶层管道名（food 件伪 id，同 fangbang 规则）
            if len(parts) >= 4:
                return cand
    p = obj.parent
    while p is not None:
        pn = strip_suffix(p.name)
        if pn in id_set:
            return pn
        aw = awning_owner(pn, id_set)
        if aw:
            return aw
        if '|' in pn:
            pp = pn.split('|')
            if len(pp) >= 4:
                return pp[1]
        p = p.parent
    return None


def awning_owner(name, id_set):
    """awning-<layoutid>-<k> 檐棚锚 -> 所属 layout 建筑 id。"""
    if name.startswith('awning-'):
        rest = name[len('awning-'):]
        if rest.rfind('-') > 0:
            cand = rest[:rest.rfind('-')]
            if cand in id_set:
                return cand
    return None


# ---------------- 场景与配置 ----------------
def setup_render_base(scene, w, h):
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.color_depth = '8'
    scene.render.film_transparent = False
    scene.render.use_persistent_data = True   # 同场景多帧：复用 Cycles BVH


def set_view(scene, view):
    scene.view_settings.view_transform = view
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1


def world_color(scene, rgb01):
    w = bpy.data.worlds.get('control-world')
    if w is None:
        w = bpy.data.worlds.new('control-world')
        scene.world = w
    w.color = rgb01
    sh = scene.display.shading
    try:
        sh.background_type = 'WORLD'
    except TypeError:
        pass


def config_workbench(scene, mode):
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    if mode == 'beauty':
        sh.light = 'STUDIO'
        sh.color_type = 'TEXTURE'
        sh.show_shadows = False
        sh.show_cavity = False
        set_view(scene, 'Standard')
        scene.render.filter_size = 1.5
        try:
            scene.display.render_aa = '8'
        except TypeError:
            pass
        world_color(scene, (0.53, 0.60, 0.67))
    elif mode == 'seg':
        sh.light = 'FLAT'
        sh.color_type = 'OBJECT'
        sh.show_shadows = False
        sh.show_cavity = False
        set_view(scene, 'Raw')
        scene.render.filter_size = 0.0
        try:
            scene.display.render_aa = 'OFF'
        except TypeError:
            pass
        u = UNASSIGNED
        world_color(scene, (u[0] / 255, u[1] / 255, u[2] / 255))


def config_cycles(scene, near, far, out_dir):
    """depth + normal 共用一次渲染：material_override 自发光法线；compositor Depth->BW16 PNG。"""
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 1
    scene.cycles.use_adaptive_sampling = False
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 0
    scene.cycles.diffuse_bounces = 0
    scene.cycles.glossy_bounces = 0
    scene.cycles.transmission_bounces = 0
    scene.cycles.transparent_max_bounces = 0
    scene.render.filter_size = 0.0
    set_view(scene, 'Raw')
    world_color(scene, (0, 0, 0))
    bpy.context.view_layer.use_pass_z = True      # RenderLayers 'Depth' 输出需要显式开 Z pass

    mat = bpy.data.materials.get('control-normal')
    if mat is None:
        mat = bpy.data.materials.new('control-normal')
        mat.use_nodes = True
        nt = mat.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        outn = nt.nodes.new('ShaderNodeOutputMaterial')
        em = nt.nodes.new('ShaderNodeEmission')
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        com = nt.nodes.new('ShaderNodeCombineXYZ')       # glTF Y-up: (x, z, -y)
        add = nt.nodes.new('ShaderNodeVectorMath')
        add.operation = 'ADD'
        add.inputs[1].default_value = (1, 1, 1)
        mul = nt.nodes.new('ShaderNodeVectorMath')
        mul.operation = 'SCALE'
        mul.inputs['Scale'].default_value = 0.5
        nt.links.new(geo.outputs['Normal'], sep.inputs['Vector'])
        nt.links.new(sep.outputs['X'], com.inputs['X'])
        nt.links.new(sep.outputs['Z'], com.inputs['Y'])
        nt.links.new(sep.outputs['Y'], com.inputs['Z'])
        nt.links.new(com.outputs['Vector'], add.inputs[0])
        nt.links.new(add.outputs['Vector'], mul.inputs[0])
        nt.links.new(mul.outputs['Vector'], em.inputs['Color'])
        nt.links.new(em.outputs['Emission'], outn.inputs['Surface'])
    bpy.context.view_layer.material_override = mat

    scene.use_nodes = True
    nt = scene.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    rl = nt.nodes.new('CompositorNodeRLayers')
    mr = nt.nodes.new('CompositorNodeMapRange')
    mr.use_clamp = True
    mr.inputs['From Min'].default_value = near
    mr.inputs['From Max'].default_value = far
    mr.inputs['To Min'].default_value = 0.0
    mr.inputs['To Max'].default_value = 1.0
    fo = nt.nodes.new('CompositorNodeOutputFile')
    fo.format.file_format = 'PNG'
    fo.format.color_mode = 'BW'
    fo.format.color_depth = '16'
    fo.format.compression = 15
    fo.base_path = os.path.join(out_dir, '_depth_tmp')
    nt.links.new(rl.outputs['Depth'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Value'], fo.inputs['Image'])


def unconfig_cycles(scene):
    bpy.context.view_layer.material_override = None
    scene.use_nodes = False
    nt = scene.node_tree
    if nt:
        for n in list(nt.nodes):
            nt.nodes.remove(n)


# ---------------- 相机 ----------------
def aim(cam_ob, eye_b, tgt_b):
    from mathutils import Vector
    d = Vector(tgt_b) - Vector(eye_b)
    cam_ob.location = eye_b
    cam_ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def to_blender(p):
    """地图 [x,y,z] -> Blender (x,-z,y)。"""
    return (p[0], -p[2], p[1])


# B: glTF Y-up -> Blender Z-up（正交置换，逆=转置）
B4 = [[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]]


def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def mat_from_blender(m):
    return [[m[i][j] for j in range(4)] for i in range(4)]


def write_camera_json(path, shot_id, k, cam, cam_ob, w, h, near, far, eye_m, tgt_m, target_id=None):
    from mathutils import Matrix
    mw = cam_ob.matrix_world
    cb = mw.inverted()                                  # Blender world -> camera
    cbg = cb @ Matrix(B4)                               # glTF Y-up world -> camera（OpenGL 约定）
    flip = Matrix.Diagonal((1, -1, -1, 1))
    ccv = flip @ cbg                                    # OpenCV 约定（z 前向，y 下）
    f = cam.lens
    sensor_w = cam.sensor_width                         # AUTO fit、横幅 -> 水平 36mm
    fov_x = 2 * math.atan(sensor_w / (2 * f))
    fov_y = 2 * math.atan(sensor_w * h / w / (2 * f))
    fx = w / (2 * math.tan(fov_x / 2))
    fy = h / (2 * math.tan(fov_y / 2))
    doc = {
        'shot': shot_id, 'frame': k,
        'width': w, 'height': h,
        'worldConvention': 'glTF Y-up（three.js）= 地图 [x, y高度, z]；Blender 世界=(x,-z,y)。相机局部系 +X 右 +Y 上、看向 -Z（OpenGL/three.js）。',
        'fovXDeg': math.degrees(fov_x), 'fovYDeg': math.degrees(fov_y),
        'focalLengthMm': f, 'sensorWidthMm': sensor_w,
        'K': [[fx, 0, w / 2], [0, fy, h / 2], [0, 0, 1]],
        'principalPoint': [w / 2, h / 2],
        'worldToCameraOpenGL': [list(r) for r in cbg],
        'worldToCameraOpenCV': [list(r) for r in ccv],
        'projectionNote': 'OpenCV 式投影：p=worldToCameraOpenCV@[x,y,z,1]，u=fx*x/z+cx，v=fy*y/z+cy（z>0 在前方）。',
        'cameraPositionWorld': [eye_m[0], eye_m[1], eye_m[2]],
        'targetWorld': [tgt_m[0], tgt_m[1], tgt_m[2]],
        'targetId': target_id,                          # R1：镜头声明的取景目标 layout id（分割 LUT 可反查其像素）
        'depthNearM': near, 'depthFarM': far,
        'depthEncoding': 'BW 16-bit PNG：gray=round(65535*clamp((z-near)/(far-near),0,1))；z=Cycles Depth pass 视轴 z 深度（米，沿相机 -Z 轴的平面距离，非欧氏线距）；背景=clip_end=far -> 65535',
        'normalEncoding': 'RGB 8-bit PNG：rgb=round(255*((n+1)/2))；n=glTF Y-up 世界系单位法线（+Y=地面向上->(128,255,128)）；背景/负向溢出=(0,0,0)',
        'segmentationEncoding': 'RGB 8-bit PNG：Workbench FLAT+OBJECT 逐字节精确色；未归属几何与空背景=unassigned',
        'blenderMatrixWorld': [list(r) for r in mw],
    }
    with open(path, 'w', encoding='utf-8') as fjson:
        json.dump(doc, fjson, ensure_ascii=False, indent=1)
        fjson.write('\n')


# ---------------- 主流程 ----------------
def main():
    args = parse_args()
    global ARGS
    ARGS = args
    shots_doc = json.load(open(args.cameras, encoding='utf-8'))
    w, h = shots_doc['width'], shots_doc['height']
    near, far = shots_doc['nearM'], shots_doc['farM']
    want = [s for s in shots_doc['shots'] if not args.shots or s['id'] in args.shots.split(',')]
    os.makedirs(args.out, exist_ok=True)

    layout_ids = set()
    if os.path.exists(args.layout):
        L = json.load(open(args.layout, encoding='utf-8'))
        layout_ids |= {o['id'] for o in L['objects']}
        layout_ids |= {i['id'] for i in L.get('instances', [])}
    log('layout id universe:', len(layout_ids))

    scene = bpy.context.scene
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    setup_render_base(scene, w, h)

    t0 = time.perf_counter()
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.scene))
    log('glb imported in %.1fs, objects=%d' % (time.perf_counter() - t0, len(bpy.data.objects)))

    # 归属 + 上色 + LUT
    t0 = time.perf_counter()
    used = set()
    id2rgb = {}
    n_map = n_un = 0
    for ob in list(bpy.data.objects):
        if ob.type != 'MESH' or ob.hide_render:
            continue   # 模块库本体（hide_render）不进渲染，跳过
        ident = layout_id_of(ob, layout_ids)
        if ident is None:
            anchor = ob
            while anchor is not None and anchor.type != 'EMPTY':
                anchor = anchor.parent
            if anchor is not None and strip_suffix(anchor.name).startswith('fangbang-'):
                ident = strip_suffix(anchor.name)      # 方浜中路 v7 件伪 id（见脚本头注释）
        if ident is None:
            ob.color = (UNASSIGNED[0] / 255, UNASSIGNED[1] / 255, UNASSIGNED[2] / 255, 1)
            n_un += 1
            continue
        if ident not in id2rgb:
            id2rgb[ident] = color_for(used, ident)
        c = id2rgb[ident]
        ob.color = (c[0] / 255, c[1] / 255, c[2] / 255, 1)
        n_map += 1
    rgb2id = {'#%02x%02x%02x' % v: k for k, v in id2rgb.items()}
    lut = {
        'version': 1,
        'unassigned': list(UNASSIGNED),
        'colorSpace': '8-bit 文件值（Workbench FLAT+OBJECT + Raw 视图变换逐字节精确；无 AA）',
        'idToRgb': {k: list(v) for k, v in id2rgb.items()},
        'rgbToId': rgb2id,
        'note': '方浜中路件为伪 id fangbang-<v7id>（v7 记录不在 baseline/layout.json）；未归属几何与空背景=unassigned',
        'sourceGlb': args.scene,
        'meshObjects': {'mapped': n_map, 'unassigned': n_un},
    }
    with open(os.path.join(args.out, 'segmentation-lut.json'), 'w', encoding='utf-8') as f:
        json.dump(lut, f, ensure_ascii=False, indent=1)
        f.write('\n')
    log('attribution in %.1fs: mapped=%d unassigned=%d lut ids=%d'
        % (time.perf_counter() - t0, n_map, n_un, len(id2rgb)))

    cam_data = bpy.data.cameras.new('control-cam')
    cam_data.clip_start = near
    cam_data.clip_end = far
    cam_ob = bpy.data.objects.new('control-cam', cam_data)
    scene.collection.objects.link(cam_ob)
    scene.camera = cam_ob
    scene.frame_start = 0

    timings = {}
    for shot in want:
        sid = shot['id']
        sdir = os.path.join(args.out, sid)
        for sub in ('beauty', 'depth', 'normal', 'segmentation', 'cameras'):
            os.makedirs(os.path.join(sdir, sub), exist_ok=True)
        fixed = 'p' in shot and 't' in shot and 'eye' not in shot
        n_frames = shot.get('frames', 1 if fixed else 0)
        eyes = [shot['p']] * n_frames if fixed else shot['eye']
        tgts = [shot['t']] * n_frames if fixed else shot['target']
        st = timings.setdefault(sid, {})
        # R1：每镜头可选焦距 lensMm（36 mm 横幅传感器，AUTO 适配=水平）；缺省 50 mm（Blender 默认，①与 round 0 一致）
        cam_data.sensor_width = 36.0
        cam_data.lens = float(shot.get('lensMm', 50.0))

        def pose(k):
            eye_b, tgt_b = to_blender(eyes[k]), to_blender(tgts[k])
            cam_data.clip_start, cam_data.clip_end = near, far
            aim(cam_ob, eye_b, tgt_b)
            scene.frame_set(k)
            write_camera_json(os.path.join(sdir, 'cameras', 'frame-%03d.json' % k),
                              sid, k, cam_data, cam_ob, w, h, near, far, eyes[k], tgts[k], shot.get('targetId'))

        # 每镜头三段连续渲染：beauty(WB) -> seg(WB) -> normal+depth(Cycles)，
        # 引擎各只切换一次，Cycles BVH 借 use_persistent_data 跨帧复用。
        unconfig_cycles(scene)
        config_workbench(scene, 'beauty')
        for k in range(n_frames):
            pose(k)
            t = time.perf_counter()
            scene.render.filepath = os.path.join(sdir, 'beauty', 'frame-%03d.png' % k)
            bpy.ops.render.render(write_still=True)
            st.setdefault('frame-%03d' % k, {})['beauty_s'] = round(time.perf_counter() - t, 2)
            log('%s frame-%03d beauty %.1fs' % (sid, k, st['frame-%03d' % k]['beauty_s']))

        config_workbench(scene, 'seg')
        for k in range(n_frames):
            pose(k)
            t = time.perf_counter()
            scene.render.filepath = os.path.join(sdir, 'segmentation', 'frame-%03d.png' % k)
            bpy.ops.render.render(write_still=True)
            st.setdefault('frame-%03d' % k, {})['seg_s'] = round(time.perf_counter() - t, 2)
            log('%s frame-%03d seg %.1fs' % (sid, k, st['frame-%03d' % k]['seg_s']))

        config_cycles(scene, near, far, sdir)
        tmp = os.path.join(sdir, '_depth_tmp')
        for k in range(n_frames):
            pose(k)
            ft = st.setdefault('frame-%03d' % k, {})
            t = time.perf_counter()
            scene.render.filepath = os.path.join(sdir, 'normal', 'frame-%03d.png' % k)
            bpy.ops.render.render(write_still=True)
            ft['normal_depth_s'] = round(time.perf_counter() - t, 2)
            produced = sorted((f for f in os.listdir(tmp) if f.endswith('.png')),
                              key=lambda f: os.path.getmtime(os.path.join(tmp, f)))
            os.replace(os.path.join(tmp, produced[-1]),
                       os.path.join(sdir, 'depth', 'frame-%03d.png' % k))
            for f in produced:
                p = os.path.join(tmp, f)
                if os.path.exists(p):
                    os.remove(p)
            ft['total_s'] = round(sum(v for kk, v in ft.items() if kk != 'total_s'), 2)
            log('%s frame-%03d normal+depth %.1fs' % (sid, k, ft['normal_depth_s']))
        os.rmdir(tmp)

    with open(os.path.join(args.out, 'timings.json'), 'w', encoding='utf-8') as f:
        json.dump(timings, f, ensure_ascii=False, indent=1)
        f.write('\n')
    log('done: %d shots, %d frames total' % (len(want), sum(len(s['eye']) if 'eye' in s else 1 for s in want)))


main()
