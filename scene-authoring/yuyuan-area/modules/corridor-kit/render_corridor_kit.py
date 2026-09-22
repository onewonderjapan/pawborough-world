"""corridor-kit 渲染（Blender Cycles CPU，-t 4 由 CLI 传入）。
每廊 3 机位：沿廊看 / 外侧四分之三 / 俯视。
运行：blender --background -t 4 --python render_corridor_kit.py -- --out <dir> [--samples 64] [--res 960x540]
"""
import bpy, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
AREA = os.path.dirname(os.path.dirname(HERE))

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


OUTDIR = arg('--out') or os.path.join(AREA, 'out-corridor-kit', 'renders')
SAMPLES = int(arg('--samples', '64'))
RES = arg('--res', '960x540')
RW, RH = (int(v) for v in RES.split('x'))
os.makedirs(OUTDIR, exist_ok=True)

OUT = os.environ.get('OUT_DIR') or os.path.join(AREA, 'out-corridor-kit')
if not os.path.isabs(OUT):
    OUT = os.path.join(AREA, OUT)
CAT = json.load(open(os.path.join(OUT, 'corridor-kit-catalog.json'), encoding='utf-8'))

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.unit_settings.system = 'METRIC'
sc.unit_settings.scale_length = 1

# 中性环境：天光 + 太阳 + 地面
world = bpy.data.worlds.new('w')
sc.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
bg.inputs[0].default_value = (0.75, 0.8, 0.88, 1.0)
bg.inputs[1].default_value = 0.7
sun = bpy.data.lights.new('sun', 'SUN')
sun.energy = 3.0
sun.angle = math.radians(4)
so = bpy.data.objects.new('sun', sun)
sc.collection.objects.link(so)
so.rotation_euler = (math.radians(52), 0, math.radians(-35))
ground = bpy.data.meshes.new('ground')
import bmesh
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=400)
bm.to_mesh(ground)
bm.free()
gm = bpy.data.materials.new('ground')
gm.use_nodes = True
gm.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (0.42, 0.44, 0.40, 1)
gm.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value = 0.95
ground.materials.append(gm)
go = bpy.data.objects.new('ground', ground)
sc.collection.objects.link(go)

# Cycles CPU
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.render.resolution_x = RW
sc.render.resolution_y = RH
sc.render.image_settings.file_format = 'PNG'
sc.view_settings.view_transform = 'Standard'


def look_at(cam_o, pos, target):
    d = (target - pos)
    cam_o.location = pos
    cam_o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def centreline(m):
    pts = m.get('galleryStart')
    poly = m['polyline']
    pts3 = [tuple(p) for p in poly]
    if pts and pts3[0] == pts3[-1]:
        pts3 = pts3[:-1]
    if pts:
        pts3 = [tuple(pts)] + pts3[1:]
    return pts3


known = set()
for oid, m in CAT['modules'].items():
    glb = os.path.join(OUT, m['glb'])
    bpy.ops.import_scene.gltf(filepath=glb)
    imported = [o for o in sc.objects if o.type == 'MESH' and o.name not in known]
    known |= set(sc.objects)
    pts = centreline(m)
    # 地图 (x,z) -> Blender (x, -z)
    P = [(p[0], -p[1], 0.0) for p in pts]
    import mathutils
    # 沿廊看：沿折线弧长采样（0.5m 处机位，8.5m 处目标），视线贴廊走
    def poly_pt(P, s):
        acc = 0.0
        for i in range(len(P) - 1):
            a, b = mathutils.Vector((P[i][0], P[i][1], 0.0)), mathutils.Vector((P[i + 1][0], P[i + 1][1], 0.0))
            L = (b - a).length
            if acc + L >= s:
                return a + (b - a) * ((s - acc) / L)
            acc += L
        return mathutils.Vector((P[-1][0], P[-1][1], 0.0))

    total = sum(math.dist(P[i], P[i + 1]) for i in range(len(P) - 1))
    s_cam, s_tgt = min(0.5, total * 0.05), min(8.5, total * 0.7)
    p_cam = poly_pt(P, s_cam)
    p_tgt = poly_pt(P, s_tgt)
    if m['double']:
        # 复廊中线即中墙：机位/目标偏到侧廊中线（+1.2 左侧）
        d = (poly_pt(P, s_cam + 0.2) - p_cam).normalized()
        n = mathutils.Vector((-d.y, d.x, 0.0)) * 1.2
        p_cam, p_tgt = p_cam + n, p_tgt + n
    cam = bpy.data.cameras.new('c1')
    co = bpy.data.objects.new('cam-along', cam)
    sc.collection.objects.link(co)
    look_at(co, mathutils.Vector((p_cam.x, p_cam.y, 1.55)), mathutils.Vector((p_tgt.x, p_tgt.y, 1.45)))
    cam.lens = 28
    # 外侧四分之三：取最长段中点外法线
    best = None
    for i in range(len(pts) - 1):
        a, b = P[i], P[i + 1]
        L = math.dist(a, b)
        if best is None or L > best[0]:
            u = mathutils.Vector((b[0] - a[0], b[1] - a[1], 0)).normalized()
            n = mathutils.Vector((-u.y, u.x, 0))   # 左法线（z 南系内为 (-uy, ux) 映射到 blender: blender y=-z -> n=(-u.y_blender?...) 简化任取一侧
            best = (L, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, n)
    L, mx, my, n = best
    mid = mathutils.Vector((mx, my, 1.3))
    cam2 = bpy.data.cameras.new('c2')
    co2 = bpy.data.objects.new('cam-out', cam2)
    sc.collection.objects.link(co2)
    cam2.lens = 35
    look_at(co2, mid + mathutils.Vector((n.x * 14, n.y * 14, 4.5)), mid)
    # 俯视
    cam3 = bpy.data.cameras.new('c3')
    co3 = bpy.data.objects.new('cam-air', cam3)
    sc.collection.objects.link(co3)
    cam3.lens = 32
    look_at(co3, mid + mathutils.Vector((n.x * 8, n.y * 8, 26.0)), mid)
    for tag, cob in (('along', co), ('out34', co2), ('aerial', co3)):
        sc.camera = cob
        sc.render.filepath = os.path.join(OUTDIR, f"{oid}-{tag}.png")
        bpy.ops.render.render(write_still=True)
        print('rendered', oid, tag)
    for o in imported:
        bpy.data.objects.remove(o)
print('RENDER DONE')
