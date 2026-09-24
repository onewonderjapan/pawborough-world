# F1 复验装配与出图（工单 wave1-fangbang，主控复验用，不进管线）。
# 方法：v7 world/fangbang-temple-v7/instances.json 驱动，除 temple-axis-v2 组外全部实例
# 从 review-manifest 登记的模块 GLB 链接复制装配（v7 GLB 坐标系）；91 m 街段地面取
# v7 street-reviewed-lanes.glb 的 street-kit__* 节点（该 GLB 的店屋节点与 instances.json
# 重复，剔除，店屋按实例重放）。庙轴装进独立隐藏集合，仅供 bonus 对照图。
# 拍摄：沿 v7 route.json 主路线「街段西端→山门」弧长 s=0/25/50/75/100/125 m 眼高 1.6 m
# 6 张（末张正对山门）+ 连接段/山门缝斜俯 2 张 + 正俯瞰标注连接段范围 1 张
# + 山门缝含庙轴 bonus 1 张。Cycles CPU，空白帧守卫按 COMMON（std<2/255 或主色>95%）。
# 用法：blender -b -t 4 --python-exit-code 1 -P artifacts/f1-review/f1_assemble_shoot.py
import bpy, json, math, os, struct
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
V7 = os.path.join(ROOT, 'world', 'fangbang-temple-v7')
OUT = os.path.join(ROOT, 'artifacts', 'f1-review')
os.makedirs(OUT, exist_ok=True)

inst_doc = json.load(open(os.path.join(V7, 'instances.json'), encoding='utf-8'))
manifest = json.load(open(os.path.join(V7, 'review-manifest.json'), encoding='utf-8'))
MODULE_PATH = {m['id']: os.path.join(ROOT, m['path'][2:]) for m in manifest['modules']}
route = json.load(open(os.path.join(V7, 'route.json'), encoding='utf-8'))['mainStreet']

SHANMEN = (-127.817, 27.057)          # v7 glb 坐标（山门锚，temple-axis）
WALK_START = (-2.3632, 0.8158)        # route.json idx 265（街段西端略西）
EYE_SHOTS = [0, 25, 50, 75, 100, 125] # 每约 25 m 一张

# ---------- 场景 ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def coll(name):
    c = bpy.data.collections.get(name)
    if not c:
        c = bpy.data.collections.new(name)
        scene.collection.children.link(c)
    return c

def import_glb(path, collname):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    tgt = coll(collname)
    for o in new:
        for uc in list(o.users_collection):
            uc.objects.unlink(o)
        tgt.objects.link(o)
    return new

# ---------- 装配 ----------
report = {'placed': [], 'streetGroundNodes': [], 'skippedTempleAxis': 0, 'overlaps': [], 'lowY': []}

# 1) 91 m 街段地面（street-reviewed-lanes.glb 的 street-kit__* 节点；店屋节点剔除后按实例重放）
street_objs = import_glb(os.path.join(V7, 'street-reviewed-lanes.glb'), 'FANGBANG')
keep = [o for o in street_objs if o.name.startswith('street-kit__')]
drop = [o for o in street_objs if not o.name.startswith('street-kit__')]
for o in drop:
    bpy.data.objects.remove(o, do_unlink=True)
report['streetGroundNodes'] = sorted(o.name for o in keep)
print('street ground nodes kept:', len(keep), 'dropped storefront nodes:', len(drop))

# 2) 实例（除 temple-axis-v2）
module_cache = {}
def module_objs(module):
    if module not in module_cache:
        objs = import_glb(MODULE_PATH[module], 'MODLIB')
        for o in objs:
            o.hide_render = True
            o.hide_viewport = True
        module_cache[module] = objs
    return module_cache[module]

def place(inst, tgt_coll):
    objs = module_objs(inst['module'])
    anchor = bpy.data.objects.new(inst['id'], None)
    x, y, z = inst['positionGlb']
    anchor.location = (x, -z, y)
    anchor.rotation_euler = (0, 0, inst['rotationYRad'])
    anchor['id'] = inst['id']
    anchor['module'] = inst['module']
    anchor['group'] = inst.get('group', '')
    coll(tgt_coll).objects.link(anchor)
    tgt = coll(tgt_coll)
    for o in objs:
        dup = o.copy()  # 链接复制：共享网格/材质；库本体隐藏，副本要恢复可见
        dup.hide_render = False
        dup.hide_viewport = False
        tgt.objects.link(dup)
        dup.parent = anchor
    return anchor

temple_ids = []
for inst in inst_doc['instances']:
    if inst.get('group') == 'temple-axis-v2':
        report['skippedTempleAxis'] += 1
        temple_ids.append(inst['id'])
        place(inst, 'TEMPLEAXIS')          # 独立集合，默认不渲染
        continue
    place(inst, 'FANGBANG')
    report['placed'].append({'id': inst['id'], 'module': inst['module'], 'group': inst.get('group', '')})
coll('TEMPLEAXIS').hide_render = True
print('placed instances:', len(report['placed']), 'temple-axis (hidden):', report['skippedTempleAxis'])

# 贴图去重（同 assemble.py 的 SITE_MODULES 路径做法，只省内存/字节）
import re
seen = {}
for img in list(bpy.data.images):
    if img.source != 'FILE' or img.size[0] == 0:
        continue
    k = (re.sub(r'\.\d{3}$', '', img.name), img.size[0], img.size[1])
    if k in seen:
        img.user_remap(seen[k]); bpy.data.images.remove(img)
    else:
        seen[k] = img

bpy.context.view_layer.update()

# ---------- 几何对账：世界 AABB / 真实网格重叠 / 低浮 ----------
dg = bpy.context.evaluated_depsgraph_get()

def inst_meshes(anchor):
    out = []
    for ch in anchor.children_recursive:
        if ch.type == 'MESH' and not ch.hide_render:
            out.append(ch)
    return out

def world_aabb(meshes):
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
    return mn, mx

anchors = [o for o in coll('FANGBANG').objects if o.type == 'EMPTY']
info = {}
for a in anchors:
    ms = inst_meshes(a)
    mn, mx = world_aabb(ms)
    info[a.name] = {'group': a.get('group', ''), 'min': [round(v, 2) for v in mn], 'max': [round(v, 2) for v in mx]}
    if ms and mn.z > 0.15:
        report['lowY'].append({'id': a.name, 'worldMinY': round(mn.z, 3)})

def aabb_vol(a, b):
    ov = [min(a['max'][i], b['max'][i]) - max(a['min'][i], b['min'][i]) for i in range(3)]
    return max(0.0, ov[0]) * max(0.0, ov[1]) * max(0.0, ov[2])

names = list(info)
bvh_cache = {}
def bvh(obj):
    if obj.name not in bvh_cache:
        bvh_cache[obj.name] = BVHTree.FromObject(obj.evaluated_get(dg), dg)
    return bvh_cache[obj.name]

pairs_done = set()
for i in range(len(names)):
    for j in range(i + 1, len(names)):
        a, b = info[names[i]], info[names[j]]
        v = aabb_vol(a, b)
        if v <= 0.01:
            continue
        rec = {'a': names[i], 'b': names[j], 'aabbOverlapM3': round(v, 2)}
        if v > 0.5:  # 大重叠对才做逐网格 BVH 精查
            key = tuple(sorted((names[i], names[j])))
            if key not in pairs_done:
                pairs_done.add(key)
                ma = [o for o in coll('FANGBANG').objects if o.type == 'EMPTY' and o.name == names[i]][0]
                mb = [o for o in coll('FANGBANG').objects if o.type == 'EMPTY' and o.name == names[j]][0]
                hits = 0
                for oa in inst_meshes(ma):
                    for ob in inst_meshes(mb):
                        hits += len(bvh(oa).overlap(bvh(ob)))
                rec['meshOverlapPairs'] = hits
        report['overlaps'].append(rec)
report['overlaps'].sort(key=lambda r: -r['aabbOverlapM3'])
json.dump(report, open(os.path.join(OUT, 'f1-geometry.json'), 'w'), ensure_ascii=False, indent=1)
print('aabb overlap pairs >0.01 m3:', len(report['overlaps']),
      ' mesh-confirmed:', sum(1 for r in report['overlaps'] if r.get('meshOverlapPairs')),
      ' lowY:', report['lowY'])

# ---------- 路线弧长（街段西端 → 山门） ----------
di = min(i for i, p in enumerate(route) if p[0] <= WALK_START[0])
i_shan = min(range(di, len(route)), key=lambda i: math.hypot(route[i][0] - SHANMEN[0], route[i][2] - SHANMEN[1]))
seg = route[di:i_shan + 1]
acc = [0.0]
for i in range(1, len(seg)):
    acc.append(acc[-1] + math.hypot(seg[i][0] - seg[i - 1][0], seg[i][2] - seg[i - 1][2]))
walk_len = acc[-1]

def at(s):
    for i in range(1, len(seg)):
        if acc[i] >= s:
            t = (s - acc[i - 1]) / max(acc[i] - acc[i - 1], 1e-9)
            return (seg[i - 1][0] + (seg[i][0] - seg[i - 1][0]) * t,
                    seg[i - 1][2] + (seg[i][2] - seg[i - 1][2]) * t)
    return seg[-1][0], seg[-1][2]
print('connection walk length %.1f m' % walk_len)

# ---------- 灯光 / 渲染设置 ----------
world = bpy.data.worlds.new('World')
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs[0].default_value = (0.82, 0.86, 0.92, 1.0)
bg.inputs[1].default_value = 0.75
sun_data = bpy.data.lights.new('Sun', 'SUN')
sun_data.energy = 3.2
sun_data.angle = math.radians(4)
sun = bpy.data.objects.new('Sun', sun_data)
sun.rotation_euler = (math.radians(52), 0, math.radians(-115))
scene.collection.objects.link(sun)

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'Standard'

cam_data = bpy.data.cameras.new('Cam')
cam_data.lens = 24
cam = bpy.data.objects.new('Cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

def aim(loc, target):
    cam.location = loc
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

def shoot(name):
    if os.environ.get('F1_ONLY') and name.split('.')[0] not in os.environ['F1_ONLY'].split(','):
        print('SKIP', name)
        return {'file': name, 'skipped': True}
    scene.render.filepath = os.path.join(OUT, name)
    bpy.ops.render.render(write_still=True)
    stats = {}
    try:
        img = bpy.data.images.load(scene.render.filepath)
        n = img.size[0] * img.size[1]
        px = [0.0] * (n * 4)
        img.pixels.foreach_get(px)
        lum = [(px[i] + px[i + 1] + px[i + 2]) / 3 for i in range(0, len(px), 4)]
        mean = sum(lum) / n
        std = math.sqrt(sum((v - mean) ** 2 for v in lum) / n)
        buckets = {}
        for v in lum:
            b = min(31, int(v * 32))
            buckets[b] = buckets.get(b, 0) + 1
        dominant = max(buckets.values()) / n
        blank = std < 2 / 255 or dominant > 0.95
        bpy.data.images.remove(img)
        stats = {'mean': round(mean, 4), 'std': round(std, 4), 'dominant': round(dominant, 4), 'blank': blank}
        print('SHOT', name, stats)
    except Exception as e:   # 像素统计失败不阻断出图
        print('SHOT', name, 'stats failed:', e)
    return {'file': name, **stats}

shots = []

# 6 张眼高 1.6 m（末张正对山门）。Blender 坐标 = (x_glb, −z_glb, 高度)
for k, s in enumerate(EYE_SHOTS, 1):
    x, z = at(s)
    last = (k == len(EYE_SHOTS))
    if last:
        aim((x, -z, 1.6), (SHANMEN[0], -SHANMEN[1], 4.0))
    else:
        x2, z2 = at(min(s + 4, walk_len))
        aim((x, -z, 1.6), (x2, -z2, 1.6))
    shots.append(shoot('eye-%d-s%03dm.png' % (k, s)))

# 2 张斜俯视
aim((30, -165, 95), (-64, -22, 0))     # 连接段全景（东南侧上空）
shots.append(shoot('oblique-1-connection.png'))
aim((-60, -95, 55), (-128, -27, 3))    # 山门接缝近观（南侧偏东上空）
shots.append(shoot('oblique-2-shanmen-seam.png'))

# 1 张正俯瞰标注连接段范围：沿路线的发光条带 + 端点标记 + 文字
steps = 60
HW = 2.5   # 条带半宽 m
pts = [at(walk_len * i / steps) for i in range(steps + 1)]
band = []; faces = []
for i, (bx, bz) in enumerate(pts):
    if i < steps:
        dx, dz = pts[i + 1][0] - bx, pts[i + 1][1] - bz
        n = math.hypot(dx, dz) or 1.0
        px, pz = -dz / n * HW, dx / n * HW
    band.append((bx + px, -(bz + pz), 2.6))
    band.append((bx - px, -(bz - pz), 2.6))
    if i:
        faces.append((2 * i - 2, 2 * i - 1, 2 * i + 1, 2 * i))
mesh = bpy.data.meshes.new('band')
mesh.from_pydata(band, [], faces)
band_obj = bpy.data.objects.new('connection-band', mesh)
coll('MARKERS').objects.link(band_obj)
sp = bpy.data.materials.new('band-mat'); sp.use_nodes = True
nt = sp.node_tree; nt.nodes.clear()
em = nt.nodes.new('ShaderNodeEmission'); em.inputs[0].default_value = (1.0, 0.15, 0.05, 1); em.inputs[1].default_value = 6
outn = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(em.outputs[0], outn.inputs[0])
band_obj.data.materials.append(sp)
for e, (mx, mz) in enumerate([WALK_START, SHANMEN]):
    mk = bpy.data.meshes.new('mark%d' % e)
    mk.from_pydata([(mx - 6, -mz, 0), (mx + 6, -mz, 0), (mx, -mz + 9, 0)], [], [(0, 1, 2)])
    mk.validate()
    mk_obj = bpy.data.objects.new('walk-end-%d' % e, mk)
    mk_obj.data.materials.append(sp)
    coll('MARKERS').objects.link(mk_obj)
txt_data = bpy.data.curves.new('lbl', 'FONT')
txt_data.body = 'FANGBANG connection ~128m'
txt_data.size = 12
txt_obj = bpy.data.objects.new('label', txt_data)
txt_obj.location = (-60, -55, 3)
txt_obj.rotation_euler = (0, 0, math.radians(-13))
coll('MARKERS').objects.link(txt_obj)

cam_data.type = 'ORTHO'
cam_data.ortho_scale = 400
cam_data.clip_end = 1000
cam.location = (45, -5, 300)           # 正俯（rotation 0,0,0 → 看向 −Z）
cam.rotation_euler = (0, 0, 0)
shots.append(shoot('map-top-connection-range.png'))

# bonus：山门缝含庙轴对照（TEMPLEAXIS 临时开渲染、MARKERS 隐藏；恢复透视相机）
coll('TEMPLEAXIS').hide_render = False
coll('MARKERS').hide_render = True
cam_data.type = 'PERSP'
cam_data.lens = 24
x, z = at(125)
aim((x, -z, 1.6), (SHANMEN[0], -SHANMEN[1], 4.0))
shots.append(shoot('bonus-eye6-s125m-with-temple-axis.png'))
coll('TEMPLEAXIS').hide_render = True

json.dump({'walkLenM': round(walk_len, 1), 'shots': shots},
          open(os.path.join(OUT, 'f1-shots.json'), 'w'), ensure_ascii=False, indent=1)
print('F1 SHOOTS DONE', len(shots))
