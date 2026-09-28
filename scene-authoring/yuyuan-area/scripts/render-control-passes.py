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

wave11-lighting 附加（默认行为不变，不给这些参数 = 旧输出逐字节相同）：
  --beauty workbench|cycles|eevee   beauty 通道引擎（默认 workbench = 旧口径）。cycles / eevee 按 lighting/presets.json
                                   （查看器同一份）布太阳 + 天空 + 环境光 + 夜间自发光 / 点光：软阴影（太阳角径）、
                                   环境光遮蔽（Cycles 路径追踪自带；EEVEE 开光线追踪 + 水平线扫描）、降噪（Cycles OIDN）。
  --preset day|dusk|night           灯光预设（默认 presets.json default）；--presets <json> 换参数文件。
  --beauty-samples N / --beauty-device GPU|CPU   覆盖 presets.json blender 段的采样数 / 设备（默认 GPU）。
  --frames 0,23|last|-1             只渲这些帧（四通道同一组帧；默认全部）。
  --passes beauty,seg,normal        只渲这些通道（normal 含 depth；默认全部）。
  depth / normal / segmentation 通道在 --beauty cycles|eevee 下不变：灯光物体在这三段渲染时 hide_render，
  世界切回 control-world，Cycles 设置由 config_cycles 全部重设；自发光只改材质 Emission，分割（OBJECT 色）与
  法线（material_override）不读材质。非默认引擎另写 <out>/beauty-meta.json（引擎 / 设备 / 采样 / 预设）。

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

# G2 两个主控批准补面（scripts/route-interface-paving.py）在分割里的精确显式映射，不允许静默归为
# unassigned：pond 补面名是 zone|id|kind|lod 管道式（规则 1 已命中 id east-landing-access-apron），
# 只有 temple 补面是普通名、任何既有规则都够不到，这里按确切对象名单列（不做任何前缀/模式泛化）。
EXTRA_OBJECT_IDS = {
    'temple-ground__paving-frontage-passage': 'shanmen-passage-floor',
}


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
    # wave11-lighting（默认值 = 旧行为）
    ap.add_argument('--beauty', default='workbench', choices=('workbench', 'cycles', 'eevee'))
    ap.add_argument('--preset', default='')
    ap.add_argument('--presets', default=os.path.join(ROOT, 'lighting', 'presets.json'))
    ap.add_argument('--beauty-samples', type=int, default=0)
    ap.add_argument('--beauty-device', default='', choices=('', 'GPU', 'CPU'))
    ap.add_argument('--frames', default='')
    ap.add_argument('--passes', default='beauty,seg,normal')
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


# ---------------- wave11-lighting：beauty 灯光（lighting/presets.json，查看器同一份） ----------------
def srgb_lin(hexstr):
    h = hexstr.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def base_mat_name(n):
    return strip_suffix(n)


def sun_dir_map(sun):
    """presets conventions：方位角从北（-z）顺时针到东（+x）；返回地图系单位向量（指向光源）。"""
    az, el = math.radians(sun['azimuthDeg']), math.radians(sun['elevationDeg'])
    return (math.sin(az) * math.cos(el), math.sin(el), -math.cos(az) * math.cos(el))


def enable_gpu(scene):
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for t in ('OPTIX', 'CUDA', 'HIP'):
        try:
            prefs.compute_device_type = t
        except TypeError:
            continue
        prefs.get_devices()
        devs = [d for d in prefs.devices if d.type == t]
        if devs:
            for d in prefs.devices:
                d.use = d.type == t
            return t, [d.name for d in devs]
    return None, []


def ambient_multiplier(P, preset):
    """wave12-blenderamb：Blender 端单独的环境光倍率（blender.ambientMultiplier，查看器不用）。
    Cycles 的环境光被深檐遮挡而查看器的半球环境光不会，檐下立面因此偏暗；倍率只补这一端。
    缺字段 / 缺档按 1.0（向后兼容 = wave11 行为）。"""
    m = P.get('blender', {}).get('ambientMultiplier', {})
    v = m.get(preset, 1.0) if isinstance(m, dict) else 1.0
    return v if isinstance(v, (int, float)) and v > 0 else 1.0


def build_lighting_world(P, preset):
    """相机射线 = 预设天空渐变（查看器天空贴图同式，除以曝光抵消视图曝光）；其余射线 = 半球环境光（上 sky×I/π、下 ground×I/π）。"""
    p = P['presets'][preset]
    w = bpy.data.worlds.get('lighting-world')
    if w is None:
        w = bpy.data.worlds.new('lighting-world')
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    N, L = nt.nodes.new, nt.links.new

    def rgb(hexstr, scale=1.0):
        n = N('ShaderNodeRGB')
        c = srgb_lin(hexstr)
        n.outputs[0].default_value = (c[0] * scale, c[1] * scale, c[2] * scale, 1)
        return n.outputs[0]

    def math_node(op, a, b=None, clamp=False):
        n = N('ShaderNodeMath')
        n.operation = op
        n.use_clamp = clamp
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L(v, n.inputs[i])
        return n.outputs[0]

    def mix(a, b, fac):
        n = N('ShaderNodeMix')
        n.data_type = 'RGBA'
        L(fac, n.inputs['Factor'])
        L(a, n.inputs['A'])
        L(b, n.inputs['B'])
        return n.outputs['Result']

    sky = p['sky']
    tc = N('ShaderNodeTexCoord')
    nv = N('ShaderNodeVectorMath')
    nv.operation = 'NORMALIZE'
    L(tc.outputs['Generated'], nv.inputs[0])
    sep = N('ShaderNodeSeparateXYZ')
    L(nv.outputs['Vector'], sep.inputs[0])
    z = sep.outputs['Z']                                       # Blender z = 地图 y（仰角正弦）
    t_up = math_node('POWER', math_node('MAXIMUM', z, 0.0), sky['exponent'])
    t_dn = math_node('MINIMUM', math_node('MULTIPLY', math_node('MAXIMUM', math_node('MULTIPLY', z, -1.0), 0.0), 8.0), 1.0)
    hor = rgb(sky['horizon'])
    up = mix(hor, rgb(sky['zenith']), t_up)
    dn = mix(hor, rgb(sky['ground']), t_dn)
    add1 = N('ShaderNodeVectorMath')
    add1.operation = 'ADD'
    L(up, add1.inputs[0])
    L(dn, add1.inputs[1])
    sub = N('ShaderNodeVectorMath')
    sub.operation = 'SUBTRACT'
    L(add1.outputs['Vector'], sub.inputs[0])
    L(hor, sub.inputs[1])
    sd = sun_dir_map(p['sun'])
    dot = N('ShaderNodeVectorMath')
    dot.operation = 'DOT_PRODUCT'
    L(nv.outputs['Vector'], dot.inputs[0])
    dot.inputs[1].default_value = (sd[0], -sd[2], sd[1])       # 地图 -> Blender
    glow = math_node('MULTIPLY', math_node('POWER', math_node('MAXIMUM', dot.outputs['Value'], 0.0), sky['sunGlowPower']), sky['sunGlow'])
    gc = N('ShaderNodeVectorMath')
    gc.operation = 'SCALE'
    L(rgb(sky['sunGlowColor']), gc.inputs[0])
    L(glow, gc.inputs['Scale'])
    add2 = N('ShaderNodeVectorMath')
    add2.operation = 'ADD'
    L(sub.outputs['Vector'], add2.inputs[0])
    L(gc.outputs['Vector'], add2.inputs[1])
    bg_cam = N('ShaderNodeBackground')
    L(add2.outputs['Vector'], bg_cam.inputs['Color'])
    bg_cam.inputs['Strength'].default_value = 1.0 / p['exposure']
    # 半球环境光：z ≥ 0 → sky，z < 0 → ground，强度 I/π
    amb = p['ambient']
    step = math_node('GREATER_THAN', z, 0.0)
    hemi = mix(rgb(amb['ground']), rgb(amb['sky']), step)
    bg_amb = N('ShaderNodeBackground')
    L(hemi, bg_amb.inputs['Color'])
    bg_amb.inputs['Strength'].default_value = amb['intensity'] / math.pi * ambient_multiplier(P, preset)
    lp = N('ShaderNodeLightPath')
    ms = N('ShaderNodeMixShader')
    L(lp.outputs['Is Camera Ray'], ms.inputs['Fac'])
    L(bg_amb.outputs['Background'], ms.inputs[1])
    L(bg_cam.outputs['Background'], ms.inputs[2])
    out = N('ShaderNodeOutputWorld')
    L(ms.outputs['Shader'], out.inputs['Surface'])
    return w


def light_candidates(P):
    """点光候选位置（查看器 web/lighting.js 同一规则）：灯笼材质顶点按 clusterM 网格聚类中心、摊位锚点上方 offsetY。Blender 世界坐标。"""
    import re
    out = []
    for src in P['pointLights']['sources']:
        if src['kind'] == 'node-anchor':
            rx = re.compile(src['pattern'])
            for ob in bpy.data.objects:
                if rx.search(strip_suffix(ob.name)) and not ob.hide_render:
                    loc = ob.matrix_world.translation
                    out.append((loc.x, loc.y, loc.z + src['offsetY']))
        elif src['kind'] == 'material-clusters':
            c = src['clusterM']
            cells = {}
            for ob in bpy.data.objects:
                if ob.type != 'MESH' or ob.hide_render:
                    continue
                if not any(m and base_mat_name(m.name) in src['materials'] for m in ob.data.materials):
                    continue
                mw = ob.matrix_world
                for v in ob.data.vertices:
                    wv = mw @ v.co
                    # 聚类格按地图系（x, 高, z）取，与查看器一致
                    k = (math.floor(wv.x / c), math.floor(wv.z / c), math.floor(-wv.y / c))
                    e = cells.setdefault(k, [0.0, 0.0, 0.0, 0])
                    e[0] += wv.x
                    e[1] += wv.y
                    e[2] += wv.z
                    e[3] += 1
            for e in cells.values():
                out.append((e[0] / e[3], e[1] / e[3], e[2] / e[3] + src['offsetY']))
    return out


def setup_beauty_lighting(scene, P, preset):
    """太阳 + 点光 + 自发光材质。返回灯光物体列表（非 beauty 段 hide_render）。"""
    from mathutils import Vector
    p = P['presets'][preset]
    objs = []
    old = [ob for ob in bpy.data.objects if ob.name.startswith('lighting-')]
    for ob in old:
        bpy.data.objects.remove(ob, do_unlink=True)
    sd = sun_dir_map(p['sun'])
    sun = bpy.data.lights.new('lighting-sun', 'SUN')
    sun.energy = p['sun']['intensity']                       # 辐照度，= three DirectionalLight.intensity
    sun.color = srgb_lin(p['sun']['color'])
    sun.angle = math.radians(p['sun']['angularDiameterDeg'])
    so = bpy.data.objects.new('lighting-sun', sun)
    so.rotation_euler = (-Vector((sd[0], -sd[2], sd[1]))).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(so)
    objs.append(so)
    npl = 0
    scale = p.get('emissiveScale', 0)
    if p.get('pointLights', 0) > 0:
        pl = P['pointLights']
        for i, pos in enumerate(light_candidates(P)):
            ld = bpy.data.lights.new('lighting-point-%03d' % i, 'POINT')
            ld.energy = 4 * math.pi * pl['intensity']            # three 坎德拉 I（E=I/d²）-> Cycles 功率 P=4πI（E=P/(4πd²)，已用单平面标定）
            ld.color = srgb_lin(pl['color'])
            ld.shadow_soft_size = 0.15
            lo = bpy.data.objects.new('lighting-point-%03d' % i, ld)
            lo.location = pos
            scene.collection.objects.link(lo)
            objs.append(lo)
            npl += 1
    nmat = 0
    groups = {m: g for g in P['emissiveGroups'] for m in g['materials']}
    for mat in bpy.data.materials:
        g = groups.get(base_mat_name(mat.name))
        if not g or not mat.use_nodes or scale <= 0:
            continue
        bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf is None:
            continue
        col = srgb_lin(g['color'])
        nt = mat.node_tree
        for l in list(bsdf.inputs['Emission Color'].links):
            nt.links.remove(l)
        base_links = bsdf.inputs['Base Color'].links
        if g.get('useMap') and base_links:
            mul = nt.nodes.new('ShaderNodeMix')
            mul.data_type = 'RGBA'
            mul.blend_type = 'MULTIPLY'
            mul.inputs['Factor'].default_value = 1.0
            nt.links.new(base_links[0].from_socket, mul.inputs['A'])
            mul.inputs['B'].default_value = (col[0], col[1], col[2], 1)
            nt.links.new(mul.outputs['Result'], bsdf.inputs['Emission Color'])
        else:
            bsdf.inputs['Emission Color'].default_value = (col[0], col[1], col[2], 1)
        bsdf.inputs['Emission Strength'].default_value = g['intensity'] * scale
        nmat += 1
    log('beauty lighting: preset %s sun az %.0f el %.0f, point lights %d, emissive materials %d'
        % (preset, p['sun']['azimuthDeg'], p['sun']['elevationDeg'], npl, nmat))
    return objs, {'pointLights': npl, 'emissiveMaterials': nmat}


def config_beauty_lit(scene, P, preset, engine, samples, device, world):
    scene.world = world
    B = P['blender']
    if engine == 'cycles':
        scene.render.engine = 'CYCLES'
        dev_type, dev_names = (enable_gpu(scene) if device == 'GPU' else (None, []))
        scene.cycles.device = 'GPU' if dev_type else 'CPU'
        c = B['cycles']
        scene.cycles.samples = samples or c['samples']
        scene.cycles.use_adaptive_sampling = True
        scene.cycles.max_bounces = c['maxBounces']
        scene.cycles.diffuse_bounces = c['maxBounces']
        scene.cycles.glossy_bounces = c['maxBounces']
        scene.cycles.transmission_bounces = c['maxBounces']
        scene.cycles.transparent_max_bounces = 8
        scene.cycles.sample_clamp_indirect = c['clampIndirect']
        scene.cycles.use_denoising = True
        scene.cycles.denoiser = c['denoise']
        try:
            scene.cycles.denoising_use_gpu = bool(dev_type)
        except AttributeError:
            pass
        scene.render.filter_size = 1.5
        meta = {'engine': 'CYCLES', 'device': scene.cycles.device, 'computeDeviceType': dev_type, 'devices': dev_names,
                'samples': scene.cycles.samples, 'denoiser': c['denoise'], 'maxBounces': c['maxBounces']}
    else:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
        e = B['eevee']
        ee = scene.eevee
        ee.taa_render_samples = samples or e['samples']
        for attr, val in (('use_shadows', True), ('use_raytracing', e['raytracing']), ('ray_tracing_method', 'SCREEN'),
                          ('fast_gi_method', 'GLOBAL_ILLUMINATION'), ('use_fast_gi', True),
                          ('fast_gi_distance', P['blender']['ambientOcclusion']['distanceM']),
                          ('shadow_resolution_scale', e['shadowResolutionScale'])):
            try:
                setattr(ee, attr, val)
            except (AttributeError, TypeError):
                pass
        scene.render.filter_size = 1.5
        meta = {'engine': 'BLENDER_EEVEE_NEXT', 'device': 'GPU (OpenGL/EGL)', 'samples': ee.taa_render_samples}
    try:
        scene.view_settings.view_transform = B['viewTransform']
    except TypeError:
        scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = math.log2(P['presets'][preset]['exposure'])
    scene.view_settings.gamma = 1
    meta.update({'viewTransform': scene.view_settings.view_transform, 'exposureStops': scene.view_settings.exposure,
                 'preset': preset, 'ambientMultiplier': ambient_multiplier(P, preset)})
    return meta


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
    passes = set(args.passes.split(','))
    lit = args.beauty != 'workbench'
    P = preset = None
    if lit:
        P = json.load(open(args.presets, encoding='utf-8'))
        preset = args.preset or P['default']
        if preset not in P['presets']:
            raise SystemExit('unknown preset %s' % preset)

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
            ident = EXTRA_OBJECT_IDS.get(strip_suffix(ob.name))
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
        # G2 两个主控批准补面的可追溯归属（GLB extras 携带同源 module/inference，见 scripts/route-interface-paving.py）
        'patchFaces': {
            'shanmen-passage-floor': {'node': 'temple-ground__paving-frontage-passage',
                                      'module': 'shanmen-passage', 'runtimePart': 'zone-temple-4.glb',
                                      'inference': 'lead-approved measured existing gate-floor gap; no historical survey claim'},
            'east-landing-access-apron': {'node': 'pond|east-landing-access-apron|paving|L1',
                                          'module': 'east-landing-access-apron', 'runtimePart': 'zone-pond-2.glb',
                                          'inference': 'lead-approved .715m2 visible dry road-to-lowest-tread interface; existing bridge and stairs unchanged'},
        },
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

    lit_objs, lit_world, lit_meta = [], None, None
    if lit:
        lit_world = build_lighting_world(P, preset)
        lit_objs, lit_info = setup_beauty_lighting(scene, P, preset)
        for ob in lit_objs:
            ob.hide_render = True

    def frame_ids(n):
        if not args.frames:
            return list(range(n))
        ids = []
        for tok in args.frames.split(','):
            tok = tok.strip()
            k = n - 1 if tok == 'last' else int(tok)
            ids.append(k + n if k < 0 else k)
        return [k for k in ids if 0 <= k < n]

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
        ks = frame_ids(n_frames)
        unconfig_cycles(scene)
        if lit and 'beauty' in passes:
            for ob in lit_objs:
                ob.hide_render = False
            lit_meta = config_beauty_lit(scene, P, preset, args.beauty, args.beauty_samples,
                                         args.beauty_device or P['blender']['cycles']['device'], lit_world)
            lit_meta.update(lit_info)
        elif 'beauty' in passes:
            config_workbench(scene, 'beauty')
        for k in (ks if 'beauty' in passes else []):
            pose(k)
            t = time.perf_counter()
            scene.render.filepath = os.path.join(sdir, 'beauty', 'frame-%03d.png' % k)
            bpy.ops.render.render(write_still=True)
            st.setdefault('frame-%03d' % k, {})['beauty_s'] = round(time.perf_counter() - t, 2)
            log('%s frame-%03d beauty %.1fs' % (sid, k, st['frame-%03d' % k]['beauty_s']))
        if lit:
            # 回到控制层口径：灯光不渲、世界 = control-world（config_workbench / config_cycles 只改它的颜色）
            for ob in lit_objs:
                ob.hide_render = True
            cw = bpy.data.worlds.get('control-world')
            if cw is not None:
                scene.world = cw

        if 'seg' in passes:
            config_workbench(scene, 'seg')
        for k in (ks if 'seg' in passes else []):
            pose(k)
            t = time.perf_counter()
            scene.render.filepath = os.path.join(sdir, 'segmentation', 'frame-%03d.png' % k)
            bpy.ops.render.render(write_still=True)
            st.setdefault('frame-%03d' % k, {})['seg_s'] = round(time.perf_counter() - t, 2)
            log('%s frame-%03d seg %.1fs' % (sid, k, st['frame-%03d' % k]['seg_s']))

        if 'normal' not in passes:
            continue
        config_cycles(scene, near, far, sdir)
        tmp = os.path.join(sdir, '_depth_tmp')
        for k in ks:
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

    # --shots 分批渲染时保留同目录里其他镜头的耗时记录（wave5-shots2：11 镜头分两批出，不能互相覆盖）
    tpath = os.path.join(args.out, 'timings.json')
    if os.path.exists(tpath):
        merged = json.load(open(tpath, encoding='utf-8'))
        merged.update(timings)
        timings = merged
    with open(tpath, 'w', encoding='utf-8') as f:
        json.dump(timings, f, ensure_ascii=False, indent=1)
        f.write('\n')
    if lit and lit_meta is not None:
        with open(os.path.join(args.out, 'beauty-meta.json'), 'w', encoding='utf-8') as f:
            json.dump(dict(lit_meta, presetsFile=args.presets, shots=[s['id'] for s in want]), f, ensure_ascii=False, indent=1)
            f.write('\n')
    log('done: %d shots, %d frames total' % (len(want), sum(len(s['eye']) if 'eye' in s else 1 for s in want)))


main()
