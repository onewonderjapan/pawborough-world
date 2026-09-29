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
  --beauty-denoise on|off           Cycles OIDN 降噪（默认 on = 旧行为）；格扇近景可 off 配高 --beauty-samples（wave12-r2）。
  --frames 0,23|last|-1             只渲这些帧（四通道同一组帧；默认全部）。
  --passes beauty,seg,normal        只渲这些通道（normal 含 depth；默认全部）。
  depth / normal / segmentation 通道在 --beauty cycles|eevee 下不变：灯光物体在这三段渲染时 hide_render，
  世界切回 control-world，Cycles 设置由 config_cycles 全部重设；自发光只改材质 Emission，分割（OBJECT 色）与
  法线（material_override）不读材质。非默认引擎另写 <out>/beauty-meta.json（引擎 / 设备 / 采样 / 预设）。
wave12-r1：--beauty cycles|eevee 下导入后调 prepare_beauty_materials（slot 贴图绑定 / 共面铺装只对相机可见 / 绕序相反面
  法线纠正 / 查看器同式 mip 采样镂空贴图），使 beauty 外观与查看器一致；详见 docs/CONTROL-PASSES.md wave12-r1 段。

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
    ap.add_argument('--beauty-denoise', default='on', choices=('on', 'off'))   # wave12-r2：格扇近景可关 OIDN 配高采样
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
        # wave14-pvquality Q20：Blender 4.x 的 dither_intensity 默认 1.0，8-bit 输出带 ±1 有序抖动
        # （wave13-nightqa 取证：pv13 seg 单帧半行抽样 87888 个非 LUT 像素、101 种颜色全部是某个
        # LUT 色/unassigned 的 ±1 变体）。OBJECT 色必须逐字节精确，seg 分支关掉；
        # beauty 分支不写（workbench beauty「不给参数 = 旧输出逐字节相同」契约不变）。
        scene.render.dither_intensity = 0.0
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


# ---------------- wave12-r1：beauty 材质与查看器对齐（只在 --beauty cycles|eevee 下调用） ----------------
# scene-areas.glb 与查看器读的运行时分区件 zone-*.glb 出自同一 scene.blend，但 Blender 渲染与查看器有三处外观差异
# （工单包 artifacts/r1 实测定位）：
#  1) 铺装 / 外围立面贴图：export-zones.py 在导出分区件前按对象 custom prop `slot` 换成贴图材质（paving-<slot>.jpg /
#     outer-kit 图集），scene-areas.glb 更早导出，只带 slot（glTF node extras）+ 世界 UV，材质仍是顶点色平涂
#     → bind_slot_materials 按同一约定在导入后绑定（只换材质槽，不改几何 / UV）。
#  2a) 共面叠放的地面层：部分路面 / 铺装件在同一高度互相重叠（如 z=0.02 的 road-428179933/934）。查看器里同材质共面只是
#     深度打架、看不出；Cycles 从一层发出的阴影 / 漫反射射线在 t≈0 立即打中另一层 → 该处既无日光也无环境光 → 纯黑块。
#     → plan_coplanar_offsets（wave12-r2）：只找「整件水平的地面层」之间高度差 ≤ 2 mm 且三角形投影实际交叠的冲突对，
#     冲突图贪心分层，面积大的留原高度，次层逐级下沉 4 mm（仅 beauty 段；控制通道前 location 原值写回）。
#     不冲突的铺装不动，照常投影 / 反弹 / 被透射看到（R1 的整件关射线可见性已撤掉）。
#  2b) 28 个路面三角形（outer road / bazaar paving 的 slot 网格）顶点法线朝上而绕序朝下：Cycles / EEVEE 命中背面时把
#     着色法线一并翻到朝下（插进地面）→ 纯黑；查看器（three DoubleSide）翻法线后仍吃不被遮挡的半球环境光，与相邻面
#     同亮 → fix_inverted_winding_shading：着色法线与几何法线相背（点积 < -0.5，只有这类数据矛盾面）时取反回来。
#  3) 镂空贴图（MASK / 带贴图的 BLEND）：查看器是 WebGL 三线性 mipmap + 非预乘 alpha，透明像素的白底 RGB 在缩小
#     采样时混进窗棂 → 格心呈浅色纹样；Cycles 不做 mipmap，alpha 测试后只剩纯红窗棂，而三穗堂格扇背板与窗棂同色
#     → 纹样消失。emulate_viewer_texture_filtering 按查看器同式（λ = log2(像素足迹 / 纹素)）在着色器里选 mip 层，
#     alpha 测试仍走导入器生成的节点链（阈值 0.5 = alphaCutoff 缺省）；滤波方式取 GLB sampler。
# depth / normal / segmentation 不读这些材质（normal = material_override，seg = Workbench OBJECT 色）；默认 workbench beauty 不调用。
PAVING_TEX_DIR = os.path.join(ROOT, 'resources', 'textures', 'paving')
# 与 scripts/export-zones.py 的 OUTER_KIT_TEX 同一约定；outerkit-proc 由查看器着色器现画（web/outer-kit-proc.js），Blender 端不复刻
SLOT_TEX = {'outerkit-atlas': os.path.join(ROOT, 'resources', 'textures', 'outer-kit', 'outerkit-atlas-v2.jpg')}
# 已知例外：查看器着色器现画的程序化材质，Blender 端保留导入材质并单列计数（不是缺图）
SLOT_KNOWN_EXCEPTIONS = {'outerkit-proc': 'web/outer-kit-proc.js 着色器现画，Blender 端不复刻'}
# GL 缩小过滤枚举：9984 NEAREST_MIPMAP_NEAREST / 9985 LINEAR_MIPMAP_NEAREST / 9986 NEAREST_MIPMAP_LINEAR / 9987 LINEAR_MIPMAP_LINEAR
#   后半段 = 层间（*_MIPMAP_NEAREST 取最近层，*_MIPMAP_LINEAR 两层插值），前半段 = 层内（NEAREST_* 取最近纹素）；
#   magFilter 只管放大（λ ≤ 0）时的第 0 层。wave12-r2 起按这个拆开（R1 把 9986 误当作层间取整、层内统一用 magFilter）。
GL_MIP_NEAREST_BETWEEN = (9984, 9985)
GL_MIN_NEAREST_WITHIN = (9984, 9986, 9728)
GL_NEAREST_MAG = 9728
PIX_ANGLE_PROP = 'pb_pix_angle'           # 场景 custom prop：画面中心每像素视角（弧度），镜头变了要重设（set_pixel_angle）
UV_SCALE_ATTR = 'pb_uv_m'                 # 面属性：每个 UV 单位对应的世界长度（米，取最密方向）


def read_glb_json(path):
    import struct
    with open(path, 'rb') as f:
        head = f.read(20)
        n = struct.unpack('<I', head[12:16])[0]
        return json.loads(f.read(n))


def slot_material(slot, cache):
    if slot in cache:
        return cache[slot]
    if slot in SLOT_KNOWN_EXCEPTIONS:
        cache[slot] = None
        return None
    jpg = SLOT_TEX.get(slot) or os.path.join(PAVING_TEX_DIR, slot + '.jpg')
    if not os.path.exists(jpg):
        # 与 export-zones.py 一致：预期贴图缺失即失败，不许悄悄退回顶点色平涂（wave12-r2）
        raise SystemExit('E: slot %s 的贴图缺失: %s（run: blender -b -P scripts/bake-paving-textures.py'
                         ' / python3 -X utf8 modules/outer-kit/bake_atlas.py）' % (slot, jpg))
    img = bpy.data.images.load(jpg, check_existing=True)
    m = bpy.data.materials.new(slot if slot in SLOT_TEX else 'paving-' + slot)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Roughness'].default_value = 0.93
    bsdf.inputs['Metallic'].default_value = 0.0
    tex = m.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Linear'
    tex.extension = 'REPEAT'
    m.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    cache[slot] = m
    return m


def bind_slot_materials():
    """slot 网格换贴图材质（export-zones.py apply_paving 同式：只换材质槽 0，UV 用第 0 层）。"""
    cache, n, seen, missing = {}, 0, set(), {}
    for ob in bpy.data.objects:
        if ob.type != 'MESH' or ob.data in seen:
            continue
        slot = ob.get('slot')
        if not slot or not ob.data.uv_layers:
            continue
        seen.add(ob.data)
        mat = slot_material(str(slot), cache)
        if mat is None:
            missing[str(slot)] = missing.get(str(slot), 0) + 1      # 只可能是 SLOT_KNOWN_EXCEPTIONS
            continue
        if ob.data.materials:
            ob.data.materials[0] = mat
        else:
            ob.data.materials.append(mat)
        ob.data.uv_layers[0].active = True
        ob.data.uv_layers[0].active_render = True
        n += 1
    return {'slotMeshes': n, 'slotMaterials': sorted(k for k, v in cache.items() if v), 'slotKnownExceptions': missing}


COPLANAR_TOL_M = 0.002          # 两层水平三角形高度差 ≤ 2 mm 视为共面
COPLANAR_MIN_AREA_M2 = 1e-4     # 投影交叠面积 ≥ 1 cm² 才算冲突（边贴边的相邻铺装不算）
COPLANAR_STEP_M = 0.004         # 次层逐级下沉 4 mm（只在 beauty 段，控制通道前恢复）
COPLANAR_MAX_SINK_M = 0.032     # E2 门禁：次层下沉位移预算 32 mm（本场景实测最大 20 mm）；超出即失败


def _flat_layer_triangles(ob, np):
    """整件全是水平三角形的网格（地面层：铺装 / 路面 / 广场 / 地面）→ (N,3,3) 世界坐标三角形；否则 None。"""
    me = ob.data
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    if nt == 0:
        return None
    tv = np.empty(nt * 3, np.int32)
    me.loop_triangles.foreach_get('vertices', tv)
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', co)
    mw = np.array(ob.matrix_world, np.float64)
    co = co.reshape(-1, 3).astype(np.float64) @ mw[:3, :3].T + mw[:3, 3]
    T = co[tv.reshape(-1, 3)]
    n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    ln = np.linalg.norm(n, axis=1)
    ok = ln > 1e-10
    if not ok.any():
        return None
    if not np.all(np.abs(n[ok, 2]) >= 0.999 * ln[ok]):
        return None
    T = T[ok]
    if np.any(T[:, :, 2].max(1) - T[:, :, 2].min(1) > COPLANAR_TOL_M):
        return None
    return T


def _clip_area(a, b):
    """两个 xy 三角形交叠面积（Sutherland–Hodgman，先统一成逆时针）。"""
    def ccw(t):
        return t if (t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[1][1] - t[0][1]) * (t[2][0] - t[0][0]) > 0 else t[::-1]
    poly = ccw(a)
    clip = ccw(b)
    for i in range(3):
        c0, c1 = clip[i], clip[(i + 1) % 3]
        ex, ey = c1[0] - c0[0], c1[1] - c0[1]

        def side(p):
            return ex * (p[1] - c0[1]) - ey * (p[0] - c0[0])
        out = []
        for j in range(len(poly)):
            p, q = poly[j], poly[(j + 1) % len(poly)]
            sp, sq = side(p), side(q)
            if sp >= 0:
                out.append(p)
            if (sp >= 0) != (sq >= 0):
                t = sp / (sp - sq)
                out.append((p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])))
        poly = out
        if len(poly) < 3:
            return 0.0
    s = 0.0
    for j in range(len(poly)):
        s += poly[j][0] * poly[(j + 1) % len(poly)][1] - poly[(j + 1) % len(poly)][0] * poly[j][1]
    return abs(s) / 2


def find_coplanar_conflicts(offsets=None):
    """地面层（整件水平）两两之间：高度差 ≤ COPLANAR_TOL_M 且三角形 xy 投影实际交叠 ≥ COPLANAR_MIN_AREA_M2 的冲突对。
    offsets：{对象名: dz}，按偏移后的高度复查。返回 ({(a, b): 交叠面积}, {对象名: 该层三角形总面积})。"""
    import numpy as np
    offsets = offsets or {}
    layers, areas = {}, {}
    for ob in bpy.data.objects:
        if ob.type != 'MESH' or ob.hide_render or not ob.data.polygons:
            continue
        T = _flat_layer_triangles(ob, np)
        if T is None:
            continue
        T = T.copy()
        T[:, :, 2] += offsets.get(ob.name, 0.0)
        layers[ob.name] = T
        areas[ob.name] = float(np.abs(np.cross(T[:, 1, :2] - T[:, 0, :2], T[:, 2, :2] - T[:, 0, :2])).sum() / 2)
    # 三角形级网格索引（2 m 格）
    CELL = 2.0
    grid = {}
    recs = []
    for name, T in layers.items():
        lo, hi = T[:, :, :2].min(1), T[:, :, :2].max(1)
        z = T[:, :, 2].mean(1)
        for k in range(len(T)):
            rid = len(recs)
            recs.append((name, k, lo[k], hi[k], z[k]))
            for gx in range(int(math.floor(lo[k][0] / CELL)), int(math.floor(hi[k][0] / CELL)) + 1):
                for gy in range(int(math.floor(lo[k][1] / CELL)), int(math.floor(hi[k][1] / CELL)) + 1):
                    grid.setdefault((gx, gy), []).append(rid)
    conflicts, seen = {}, set()
    for ids in grid.values():
        for i in range(len(ids)):
            ra = recs[ids[i]]
            for j in range(i + 1, len(ids)):
                rb = recs[ids[j]]
                if ra[0] == rb[0] or abs(ra[4] - rb[4]) > COPLANAR_TOL_M:
                    continue
                if ra[2][0] >= rb[3][0] or rb[2][0] >= ra[3][0] or ra[2][1] >= rb[3][1] or rb[2][1] >= ra[3][1]:
                    continue
                key = (ids[i], ids[j]) if ids[i] < ids[j] else (ids[j], ids[i])
                if key in seen:
                    continue
                seen.add(key)
                ta = [tuple(p[:2]) for p in layers[ra[0]][ra[1]]]
                tb = [tuple(p[:2]) for p in layers[rb[0]][rb[1]]]
                a = _clip_area(ta, tb)
                if a >= COPLANAR_MIN_AREA_M2:
                    pk = tuple(sorted((ra[0], rb[0])))
                    conflicts[pk] = conflicts.get(pk, 0.0) + a
    return conflicts, areas


def plan_coplanar_offsets():
    """冲突图贪心分层：面积大的先占 0 层（保持原高度、完整参与光照），与之冲突的逐级下沉 COPLANAR_STEP_M；
    次层在交叠区被上层盖住（相机看不到、上层射线也打不到它），非交叠部分只低 4 mm，照常投影 / 反弹 / 被透射看到。
    E2 门禁（blenderamb R2 可选1）：任一对象下沉位移超出 COPLANAR_MAX_SINK_M，或按偏移复查仍有残余
    共面冲突时直接失败拒绝渲染——复查结果不再只是记录进 meta（宁停，不出受污染的画面）。"""
    conflicts, areas = find_coplanar_conflicts()
    nb = {}
    for a, b in conflicts:
        nb.setdefault(a, set()).add(b)
        nb.setdefault(b, set()).add(a)
    rank = {}
    for name in sorted(nb, key=lambda n: (-areas.get(n, 0.0), n)):
        used = {rank[m] for m in nb[name] if m in rank}
        r = 0
        while r in used:
            r += 1
        rank[name] = r
    offsets = {n: -COPLANAR_STEP_M * r for n, r in rank.items() if r > 0}
    over = sorted((n for n, dz in offsets.items() if -dz > COPLANAR_MAX_SINK_M))
    if over:
        raise SystemExit('E: 共面次层下沉位移超出预算 %.0f mm（COPLANAR_MAX_SINK_M；step %.0f mm × 层级，'
                         'max rank %d）：%s——按位移上限拒绝渲染'
                         % (COPLANAR_MAX_SINK_M * 1000, COPLANAR_STEP_M * 1000,
                            max(rank.values()) if rank else 0,
                            '；'.join('%s %.1f mm' % (n, -offsets[n] * 1000) for n in over[:8])))
    remaining, _ = find_coplanar_conflicts(offsets)
    if remaining:
        raise SystemExit('E: 按下沉偏移复查仍有 %d 对残余共面冲突（%s%s）——贪心分层对这些对象失效，'
                         '拒绝渲染（复查不再只记录）'
                         % (len(remaining),
                            '；'.join('%s <> %s' % k for k in sorted(remaining)[:4]),
                            '…' if len(remaining) > 4 else ''))
    return offsets, {'coplanarConflictPairs': len(conflicts),
                     'coplanarConflictObjects': len(nb),
                     'coplanarOverlapM2': round(sum(conflicts.values()), 3),
                     'coplanarLoweredObjects': len(offsets),
                     'coplanarMaxRank': max(rank.values()) if rank else 0,
                     'coplanarMaxSinkM': round(max((-dz for dz in offsets.values()), default=0.0), 4),
                     'coplanarSinkBudgetM': COPLANAR_MAX_SINK_M,
                     'coplanarRemainingAfterOffset': len(remaining),
                     'coplanarPairs': {'%s <> %s' % k: round(v, 3) for k, v in sorted(conflicts.items())}}


_OFFSET_SAVED = {}


def apply_beauty_offsets(offsets, on):
    """beauty 段前 on=True 下沉次层（世界 z 方向 dz，换算到父空间改 location）；控制通道前 on=False 把 location
    原值写回（存的是原 float，不经矩阵分解，逐值不变）。"""
    from mathutils import Vector
    for name, dz in offsets.items():
        ob = bpy.data.objects.get(name)
        if ob is None:
            continue
        if on:
            if name in _OFFSET_SAVED:
                continue
            _OFFSET_SAVED[name] = tuple(ob.location)
            base = ob.parent.matrix_world @ ob.matrix_parent_inverse if ob.parent else None
            d = Vector((0.0, 0.0, dz))
            if base is not None:
                d = base.to_3x3().inverted() @ d
            ob.location = ob.location + d
        elif name in _OFFSET_SAVED:
            ob.location = _OFFSET_SAVED.pop(name)
    bpy.context.view_layer.update()


def _normal_fix_group():
    g = bpy.data.node_groups.get('pb-winding-normal-fix')
    if g is not None:
        return g
    g = bpy.data.node_groups.new('pb-winding-normal-fix', 'ShaderNodeTree')
    g.interface.new_socket('Normal', in_out='INPUT', socket_type='NodeSocketVector')
    g.interface.new_socket('Normal', in_out='OUTPUT', socket_type='NodeSocketVector')
    N, L = g.nodes.new, g.links.new
    gi, go = N('NodeGroupInput'), N('NodeGroupOutput')
    geo = N('ShaderNodeNewGeometry')
    dot = N('ShaderNodeVectorMath')
    dot.operation = 'DOT_PRODUCT'
    L(geo.outputs['Normal'], dot.inputs[0])
    L(geo.outputs['True Normal'], dot.inputs[1])
    lt = N('ShaderNodeMath')
    lt.operation = 'LESS_THAN'
    L(dot.outputs['Value'], lt.inputs[0])
    lt.inputs[1].default_value = -0.5
    sign = N('ShaderNodeMath')                 # 1 - 2·[相背]
    sign.operation = 'MULTIPLY_ADD'
    L(lt.outputs['Value'], sign.inputs[0])
    sign.inputs[1].default_value = -2.0
    sign.inputs[2].default_value = 1.0
    sc = N('ShaderNodeVectorMath')
    sc.operation = 'SCALE'
    L(gi.outputs['Normal'], sc.inputs[0])
    L(sign.outputs['Value'], sc.inputs['Scale'])
    L(sc.outputs['Vector'], go.inputs['Normal'])
    return g


def fix_inverted_winding_shading():
    """找出「顶点法线与绕序相背」的多边形所用材质，给其 BSDF 法线接上相背纠正（其余面上是恒等变换）。"""
    import numpy as np
    mats, n_poly, n_obj, seen = set(), 0, 0, set()
    for ob in bpy.data.objects:
        if ob.type != 'MESH' or ob.data in seen or ob.hide_render:
            continue
        me = ob.data
        seen.add(me)
        npoly = len(me.polygons)
        if npoly == 0 or not me.materials:
            continue
        pn = np.empty(npoly * 3, np.float32)
        me.polygons.foreach_get('normal', pn)
        ls = np.empty(npoly, np.int32)
        me.polygons.foreach_get('loop_start', ls)
        lt = np.empty(npoly, np.int32)
        me.polygons.foreach_get('loop_total', lt)
        cn = np.empty(len(me.loops) * 3, np.float32)
        me.corner_normals.foreach_get('vector', cn)
        acc = np.add.reduceat(cn.reshape(-1, 3), ls, axis=0)
        d = (acc * pn.reshape(-1, 3)).sum(1) / np.maximum(lt, 1)
        bad = np.nonzero(d < -0.5)[0]
        if len(bad) == 0:
            continue
        mi = np.empty(npoly, np.int32)
        me.polygons.foreach_get('material_index', mi)
        for k in set(mi[bad].tolist()):
            if k < len(me.materials) and me.materials[k] is not None:
                mats.add(me.materials[k])
        n_poly += len(bad)
        n_obj += 1
    grp = _normal_fix_group()
    fixed = []
    for mat in mats:
        if not mat.use_nodes:
            continue
        nt = mat.node_tree
        for bsdf in [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED']:
            gn = nt.nodes.new('ShaderNodeGroup')
            gn.node_tree = grp
            links = list(bsdf.inputs['Normal'].links)
            if links:
                nt.links.new(links[0].from_socket, gn.inputs['Normal'])
                nt.links.remove(links[0])
            else:
                geo = nt.nodes.new('ShaderNodeNewGeometry')
                nt.links.new(geo.outputs['Normal'], gn.inputs['Normal'])
            nt.links.new(gn.outputs['Normal'], bsdf.inputs['Normal'])
        fixed.append(mat.name)
    return {'invertedWindingPolygons': n_poly, 'invertedWindingMeshes': n_obj, 'normalFixMaterials': sorted(fixed)}


def _srgb_to_lin(c):
    import numpy as np
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _lin_to_srgb(c):
    import numpy as np
    c = np.maximum(c, 0.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def _linear_colorspace(im):
    for cs in ('Linear Rec.709', 'Linear', 'Linear CIE-XYZ D65'):
        try:
            im.colorspace_settings.name = cs
            return cs
        except TypeError:
            continue
    return im.colorspace_settings.name


def _mip_chain(img):
    """查看器同式 mip 链（含第 0 层）：非预乘 RGBA；sRGB 贴图先解码成线性再逐层 2×2 盒式平均，直到 1×1。
    各层都存成线性浮点图（wave12-r2）：WebGL 的 SRGB8_ALPHA8 在解码后的线性空间做双线性 / 层间插值，
    而 Cycles 对 8 位 sRGB 图是在编码值上插值（合成场景 T6b 实测偏暗）——换成线性浮点图后两者同一空间。"""
    import numpy as np
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    lin = px.reshape(h, w, 4).astype(np.float64)
    if img.colorspace_settings.name == 'sRGB':
        lin[..., :3] = _srgb_to_lin(lin[..., :3])
    levels = []
    k = 0
    while True:
        hh, ww = lin.shape[0], lin.shape[1]
        im = bpy.data.images.new('%s#lin-mip%d' % (img.name, k), ww, hh, alpha=True, float_buffer=True)
        _linear_colorspace(im)
        im.alpha_mode = 'CHANNEL_PACKED'
        im.pixels.foreach_set(np.clip(lin, 0, None).astype(np.float32).ravel())
        im.pack()
        levels.append(im)
        if hh == 1 and ww == 1:
            break
        k += 1
        nh, nw = max(1, hh // 2), max(1, ww // 2)
        fy, fx = hh // nh, ww // nw
        lin = lin[:nh * fy, :nw * fx].reshape(nh, fy, nw, fx, 4).mean(axis=(1, 3))
    return levels


def _mip_group(img, nearest_mip, min_closest, mag_closest):
    name = 'pb-viewer-mip|%s|%s%s%s' % (img.name, 'N' if nearest_mip else 'L', 'c' if min_closest else 'l',
                                        'c' if mag_closest else 'l')
    g = bpy.data.node_groups.get(name)
    if g is not None:
        return g
    imgs = _mip_chain(img)
    g = bpy.data.node_groups.new(name, 'ShaderNodeTree')
    g.interface.new_socket('Vector', in_out='INPUT', socket_type='NodeSocketVector')
    g.interface.new_socket('Color', in_out='OUTPUT', socket_type='NodeSocketColor')
    g.interface.new_socket('Alpha', in_out='OUTPUT', socket_type='NodeSocketFloat')
    g.interface.new_socket('Lod', in_out='OUTPUT', socket_type='NodeSocketFloat')
    N, L = g.nodes.new, g.links.new
    gi, go = N('NodeGroupInput'), N('NodeGroupOutput')

    def m(op, a, b=None):
        n = N('ShaderNodeMath')
        n.operation = op
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L(v, n.inputs[i])
        return n.outputs[0]

    # λ = log2( 视距 · 每像素视角 · 贴图边长 / (每 UV 单位米数 · |cos 入射角|) )，夹到 [0, 层数-1]
    cam = N('ShaderNodeCameraData')
    geo = N('ShaderNodeNewGeometry')
    pix = N('ShaderNodeAttribute')
    pix.attribute_type = 'VIEW_LAYER'
    pix.attribute_name = PIX_ANGLE_PROP
    uvm = N('ShaderNodeAttribute')
    uvm.attribute_type = 'GEOMETRY'
    uvm.attribute_name = UV_SCALE_ATTR
    cos = N('ShaderNodeVectorMath')
    cos.operation = 'DOT_PRODUCT'
    L(geo.outputs['Incoming'], cos.inputs[0])
    L(geo.outputs['True Normal'], cos.inputs[1])
    cosa = m('MAXIMUM', m('ABSOLUTE', cos.outputs['Value']), 0.02)
    size = float(max(img.size))
    foot = m('MULTIPLY', m('MULTIPLY', cam.outputs['View Distance'], pix.outputs['Fac']), size)
    den = m('MULTIPLY', m('MAXIMUM', uvm.outputs['Fac'], 1e-6), cosa)
    raw = m('LOGARITHM', m('MAXIMUM', m('DIVIDE', foot, den), 1e-6), 2.0)
    lod = m('MINIMUM', m('MAXIMUM', raw, 0.0), float(len(imgs) - 1))
    if nearest_mip:
        # GL：*_MIPMAP_NEAREST 取 d = ceil(λ + 1/2) - 1（λ 恰为 k+0.5 时取 k）
        lod = m('SUBTRACT', m('CEIL', m('ADD', lod, 0.5)), 1.0)
        lod = m('MAXIMUM', lod, 0.0)
    magnify = m('LESS_THAN', raw, 1e-6)            # λ ≤ 0：放大，第 0 层按 magFilter
    col_acc = alpha_acc = None

    def add(color, alpha, w):
        nonlocal col_acc, alpha_acc
        cs = N('ShaderNodeVectorMath')
        cs.operation = 'SCALE'
        L(color, cs.inputs[0])
        L(w, cs.inputs['Scale'])
        aw = m('MULTIPLY', alpha, w)
        if col_acc is None:
            col_acc, alpha_acc = cs.outputs['Vector'], aw
        else:
            ad = N('ShaderNodeVectorMath')
            ad.operation = 'ADD'
            L(col_acc, ad.inputs[0])
            L(cs.outputs['Vector'], ad.inputs[1])
            col_acc = ad.outputs['Vector']
            alpha_acc = m('ADD', alpha_acc, aw)

    def tex(im, closest):
        t = N('ShaderNodeTexImage')
        t.image = im
        t.interpolation = 'Closest' if closest else 'Linear'
        t.extension = 'REPEAT'
        L(gi.outputs['Vector'], t.inputs['Vector'])
        return t

    for k, im in enumerate(imgs):
        w = m('MAXIMUM', m('SUBTRACT', 1.0, m('ABSOLUTE', m('SUBTRACT', lod, float(k)))), 0.0)   # 层间权重
        if k == 0:
            tm = tex(im, mag_closest)
            add(tm.outputs['Color'], tm.outputs['Alpha'], m('MULTIPLY', w, magnify))
            t0 = tex(im, min_closest)
            add(t0.outputs['Color'], t0.outputs['Alpha'], m('MULTIPLY', w, m('SUBTRACT', 1.0, magnify)))
        else:
            t = tex(im, min_closest)
            add(t.outputs['Color'], t.outputs['Alpha'], w)
    L(col_acc, go.inputs['Color'])
    L(alpha_acc, go.inputs['Alpha'])
    L(lod, go.inputs['Lod'])
    return g


def _uv_scale_attr(ob):
    """面属性 pb_uv_m：UV→世界 雅可比的最小奇异值（米 / UV 单位，最密方向；GL 取两轴里纹素变化更快的那轴）。"""
    import numpy as np
    me = ob.data
    if UV_SCALE_ATTR in me.attributes or not me.uv_layers:
        return
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    npoly = len(me.polygons)
    vals = np.full(npoly, 1.0, np.float32)
    if nt:
        tl = np.empty(nt * 3, np.int32)
        me.loop_triangles.foreach_get('loops', tl)
        tp = np.empty(nt, np.int32)
        me.loop_triangles.foreach_get('polygon_index', tp)
        tv = np.empty(nt * 3, np.int32)
        me.loop_triangles.foreach_get('vertices', tv)
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get('co', co)
        mw = np.array(ob.matrix_world, np.float64)
        co = co.reshape(-1, 3).astype(np.float64) @ mw[:3, :3].T
        uv = np.empty(len(me.loops) * 2, np.float32)
        me.uv_layers[0].data.foreach_get('uv', uv)
        uv = uv.reshape(-1, 2).astype(np.float64)
        P = co[tv.reshape(-1, 3)]
        U = uv[tl.reshape(-1, 3)]
        e1, e2 = P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]
        d1, d2 = U[:, 1] - U[:, 0], U[:, 2] - U[:, 0]
        det = d1[:, 0] * d2[:, 1] - d1[:, 1] * d2[:, 0]
        ok = np.abs(det) > 1e-12
        inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
        Ju = (e1 * d2[:, 1:2] - e2 * d1[:, 1:2]) * inv[:, None]     # dP/du
        Jv = (e2 * d1[:, 0:1] - e1 * d2[:, 0:1]) * inv[:, None]     # dP/dv
        a, b, c = (Ju * Ju).sum(1), (Ju * Jv).sum(1), (Jv * Jv).sum(1)
        tr, dt = a + c, a * c - b * b
        lmin = np.maximum(tr / 2 - np.sqrt(np.maximum(tr * tr / 4 - dt, 0)), 0)
        s = np.where(ok, np.sqrt(lmin), np.inf)
        best = np.full(npoly, np.inf)
        np.minimum.at(best, tp, s)
        vals = np.where(np.isfinite(best) & (best > 0), best, 1.0).astype(np.float32)
    at = me.attributes.new(UV_SCALE_ATTR, 'FLOAT', 'FACE')
    at.data.foreach_set('value', vals)


def emulate_viewer_texture_filtering(glb_json):
    """MASK / 带贴图 BLEND 材质的 baseColor 贴图换成查看器同式三线性 mip 采样（alpha 测试沿用导入器节点链）。"""
    gm = {m.get('name'): m for m in glb_json.get('materials', [])}
    samplers = glb_json.get('samplers', [])
    textures = glb_json.get('textures', [])
    target = {}
    for mat in bpy.data.materials:
        g = gm.get(mat.name) or gm.get(strip_suffix(mat.name))
        if not g or g.get('alphaMode') not in ('MASK', 'BLEND') or not mat.use_nodes:
            continue
        bt = g.get('pbrMetallicRoughness', {}).get('baseColorTexture')
        if not bt or bt['index'] >= len(textures):
            continue
        t = textures[bt['index']]
        s = samplers[t['sampler']] if 'sampler' in t and t['sampler'] < len(samplers) else {}
        mn = s.get('minFilter', 9987)
        target[mat] = (mn in GL_MIP_NEAREST_BETWEEN, mn in GL_MIN_NEAREST_WITHIN, s.get('magFilter') == GL_NEAREST_MAG)
    users = [ob for ob in bpy.data.objects
             if ob.type == 'MESH' and any(m in target for m in ob.data.materials)]
    for ob in users:
        _uv_scale_attr(ob)
    done = []
    for mat, (nearest_mip, min_closest, mag_closest) in target.items():
        nt = mat.node_tree
        for tex in [n for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image is not None]:
            # 只换 baseColor 贴图（sRGB）；法线 / ORM 等 Non-Color 图不动
            if tex.image.colorspace_settings.name != 'sRGB':
                continue
            if not (tex.outputs['Color'].links or tex.outputs['Alpha'].links):
                continue
            grp = nt.nodes.new('ShaderNodeGroup')
            grp.node_tree = _mip_group(tex.image, nearest_mip, min_closest, mag_closest)
            vl = list(tex.inputs['Vector'].links)
            if vl:
                nt.links.new(vl[0].from_socket, grp.inputs['Vector'])
            else:
                uvn = nt.nodes.new('ShaderNodeUVMap')
                nt.links.new(uvn.outputs['UV'], grp.inputs['Vector'])
            for outn in ('Color', 'Alpha'):
                for lk in list(tex.outputs[outn].links):
                    to = lk.to_socket
                    nt.links.remove(lk)
                    nt.links.new(grp.outputs[outn], to)
            done.append(mat.name)
    return {'mipFilteredMaterials': sorted(set(done)), 'mipFilteredMeshes': len(users)}


BEAUTY_OFFSETS = {}


def prepare_beauty_materials(scene_path, apply_offsets=True):
    """导入 scene-areas.glb 之后、布光之前调用一次（只改 beauty 引擎读的材质 / 状态；返回统计写进 beauty-meta.json）。
    共面次层的下沉量存进 BEAUTY_OFFSETS；apply_offsets=True 时立即进入 beauty 状态，控制通道前须
    apply_beauty_offsets(BEAUTY_OFFSETS, False) 恢复（main 每镜头 beauty 段前后各调一次）。"""
    info = {}
    info.update(bind_slot_materials())
    offsets, cinfo = plan_coplanar_offsets()
    BEAUTY_OFFSETS.clear()
    BEAUTY_OFFSETS.update(offsets)
    info.update(cinfo)
    info['coplanarOffsets'] = {k: round(v, 4) for k, v in sorted(offsets.items())}
    if apply_offsets:
        apply_beauty_offsets(BEAUTY_OFFSETS, True)
    info.update(fix_inverted_winding_shading())
    info.update(emulate_viewer_texture_filtering(read_glb_json(scene_path)))
    log('beauty coplanar layers: %d conflict pairs among %d objects (%.3f m2 overlap), %d lowered (max rank %d), '
        'remaining after offset %d' % (info['coplanarConflictPairs'], info['coplanarConflictObjects'],
                                       info['coplanarOverlapM2'], info['coplanarLoweredObjects'],
                                       info['coplanarMaxRank'], info['coplanarRemainingAfterOffset']))
    log('beauty materials: slot meshes %d (%s; known exceptions %s), inverted-winding polys %d -> %d materials, '
        'viewer-mip materials %d' % (info['slotMeshes'], ','.join(info['slotMaterials']), info['slotKnownExceptions'] or '-',
                                     info['invertedWindingPolygons'], len(info['normalFixMaterials']),
                                     len(info['mipFilteredMaterials'])))
    return info


def set_pixel_angle(scene, cam_data, w, h):
    """画面中心每像素视角（弧度）写进场景 custom prop，mip 选层用；AUTO 适配下长边铺满传感器。"""
    scene[PIX_ANGLE_PROP] = cam_data.sensor_width / (cam_data.lens * float(max(w, h)))
    return scene[PIX_ANGLE_PROP]


def config_beauty_lit(scene, P, preset, engine, samples, device, world, denoise=True):
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
        scene.cycles.use_denoising = bool(denoise)
        scene.cycles.denoiser = c['denoise']
        try:
            scene.cycles.denoising_use_gpu = bool(dev_type)
        except AttributeError:
            pass
        scene.render.filter_size = 1.5
        meta = {'engine': 'CYCLES', 'device': scene.cycles.device, 'computeDeviceType': dev_type, 'devices': dev_names,
                'samples': scene.cycles.samples, 'denoiser': c['denoise'] if denoise else None, 'maxBounces': c['maxBounces']}
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


# ---------------- wave14-pvquality Q18：beauty 大气透视（镜头级 atmosphere 声明才开启） ----------------
# pv01 航拍（眼高 90 m）远景地平线硬边取证：外围地面 ground 是 2000×800 m 大平面（边界在 2 km 外，
# 不是网格太小），在 far clip=300 m 处被裁，米色地面（0xcfc6b4）直接切到世界背景天空，无大气透视。
# 修法（GOAL 方向二，渲染端最小改动）：beauty 段开 Cycles Mist pass + compositor，把远景按 mist
# 因子线性混入「天空地平色」，clip 边缘处 mist=1.0 完全隐入天空、交界不可见；只作用 beauty，
# finally 卸载（depth 的 config_cycles 会整体重搭 compositor，不受影响；seg/normal 走各自配置）。
# 默认参数按 pv01 取证：注视目标湖心亭约 175 m——起点必须 ≥175 免得画面主体吃雾；start+depth
# 必须恰好 = far clip 300 m，裁剪边缘才完全雾化。
MIST_START_M = 220.0
MIST_DEPTH_M = 80.0


def atmosphere_params(P, preset, shot):
    """镜头级 atmosphere 声明 → {startM, depthM, fogLinear}；无声明返回 None（场景一字节不动）。
    声明 true 用默认参数；对象 {startM, depthM} 覆盖；非正数参数报错拒绝。雾色 =
    srgb_lin(sky.horizon)/exposure：与 build_lighting_world 的相机射线天空色同一线性域
    （背景 strength=1/exposure，曝光在 view transform 阶段才乘回）。"""
    a = (shot or {}).get('atmosphere')
    if not a:
        return None
    if isinstance(a, dict):
        start = float(a.get('startM', MIST_START_M))
        depth = float(a.get('depthM', MIST_DEPTH_M))
    else:
        start, depth = MIST_START_M, MIST_DEPTH_M
    if not (start > 0 and depth > 0):
        raise SystemExit('E: atmosphere mist 参数必须为正数（startM=%r depthM=%r）' % (start, depth))
    p = P['presets'][preset]
    fog = srgb_lin(p['sky']['horizon'])
    return {'startM': start, 'depthM': depth,
            'fogLinear': (fog[0] / p['exposure'], fog[1] / p['exposure'], fog[2] / p['exposure'])}


def apply_beauty_atmosphere(scene, params):
    """beauty 段开 Mist pass + compositor（RLayers.Image 按 Mist 混雾色 → Composite）。
    须在 config_beauty_lit 之后调用（scene.world 已是 lighting-world，mist 参数挂在 world 上）。"""
    ms = scene.world.mist_settings
    ms.start = params['startM']
    ms.depth = params['depthM']
    ms.falloff = 'LINEAR'
    bpy.context.view_layer.use_pass_mist = True
    scene.use_nodes = True
    nt = scene.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    rl = nt.nodes.new('CompositorNodeRLayers')
    mix = nt.nodes.new('CompositorNodeMixRGB')
    mix.blend_type = 'MIX'
    fog = nt.nodes.new('CompositorNodeRGB')
    fog.outputs[0].default_value = (params['fogLinear'][0], params['fogLinear'][1], params['fogLinear'][2], 1.0)
    outn = nt.nodes.new('CompositorNodeComposite')
    nt.links.new(rl.outputs['Image'], mix.inputs['Color1'])
    nt.links.new(fog.outputs[0], mix.inputs['Color2'])
    nt.links.new(rl.outputs['Mist'], mix.inputs['Fac'])
    nt.links.new(mix.outputs[0], outn.inputs[0])


def teardown_beauty_atmosphere(scene):
    """beauty finally 卸载大气透视（幂等：未开启时也是安全复位）——防泄漏进 seg/normal/depth。"""
    scene.use_nodes = False
    nt = scene.node_tree
    if nt:
        for n in list(nt.nodes):
            nt.nodes.remove(n)
    vl = bpy.context.view_layer
    if vl is not None:
        vl.use_pass_mist = False


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
        mat_info = prepare_beauty_materials(args.scene)      # wave12-r1：材质与查看器对齐（控制通道不读）
        apply_beauty_offsets(BEAUTY_OFFSETS, False)          # wave12-r2：共面次层下沉只在 beauty 段生效
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
        if lit:
            set_pixel_angle(scene, cam_data, w, h)             # wave12-r1：mip 选层用的每像素视角

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
            apply_beauty_offsets(BEAUTY_OFFSETS, True)
            for ob in lit_objs:
                ob.hide_render = False
        elif 'beauty' in passes:
            config_workbench(scene, 'beauty')
        try:
            if lit and 'beauty' in passes:
                lit_meta = config_beauty_lit(scene, P, preset, args.beauty, args.beauty_samples,
                                             args.beauty_device or P['blender']['cycles']['device'], lit_world,
                                             denoise=args.beauty_denoise == 'on')
                lit_meta.update(lit_info)
                lit_meta['beautyMaterials'] = {k: (v if not isinstance(v, (list, dict)) else len(v)) for k, v in mat_info.items()}
                atmo = atmosphere_params(P, preset, shot)
                if atmo is not None:
                    apply_beauty_atmosphere(scene, atmo)     # wave14 Q18：只作用 beauty 段，finally 卸载
                    lit_meta['atmosphere'] = atmo
            for k in (ks if 'beauty' in passes else []):
                pose(k)
                t = time.perf_counter()
                scene.render.filepath = os.path.join(sdir, 'beauty', 'frame-%03d.png' % k)
                bpy.ops.render.render(write_still=True)
                st.setdefault('frame-%03d' % k, {})['beauty_s'] = round(time.perf_counter() - t, 2)
                log('%s frame-%03d beauty %.1fs' % (sid, k, st['frame-%03d' % k]['beauty_s']))
        finally:
            if lit:
                # E2（blenderamb R2 可选2）：下沉 + 亮灯 + lit 世界是受保护的临时状态——引擎配置或
                # beauty 渲染抛异常也必须恢复 location / hide_render / control-world，
                # 后续 seg/normal/depth 控制通道不吃 beauty 残留状态。
                teardown_beauty_atmosphere(scene)            # wave14 Q18：compositor/Mist 只许活在 beauty 段
                apply_beauty_offsets(BEAUTY_OFFSETS, False)
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
