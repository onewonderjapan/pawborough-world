"""garden-kit 快速目检渲染：4 个 GLB 各出形态图（CPU Cycles 低 spp）+ 空白帧守卫。
用法：blender -b -P modules/garden-kit/checkrender.py
输出：OUT_DIR/garden-kit-check/*.png + guard 结果 JSON；空白帧 exit 1。
"""
import bpy, json, math, os, sys
from mathutils import Vector

AREA = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(AREA, os.environ.get('OUT_DIR', 'out-garden-kit'))
CK = os.path.join(OUT, 'garden-kit-check')
os.makedirs(CK, exist_ok=True)

SHOTS = {
    'garden-wall.glb': [
        ('wall-run', (-100.5, 3.0, -95.0), (-100.0, 2.0, -104.0)),
        ('dragon-head', (-164.0, 4.0, -157.4), (-165.46, 3.55, -158.87)),
        ('lattice-window', (-87.0, 1.7, -91.8), (-87.73, 1.55, -90.92)),
    ],
    'temple-wall.glb': [('wall-run', (-110.0, 2.2, -30.0), (-116.17, 1.5, -39.12))],
    'moon-gate.glb': [
        ('front', (-97.84, 1.6, -140.0), (-97.84, 1.5, -142.8)),
        ('through', (-97.84, 1.6, -145.6), (-97.84, 1.5, -142.8)),
    ],
    'jiuqu-bridge.glb': [
        ('deck-level', (-172.5, 1.6, -110.5), (-168.0, 0.8, -112.5)),
        ('from-above', (-166.0, 18.0, -122.0), (-160.0, 0.0, -122.0)),
    ],
}

def stats_guard(path):
    img = bpy.data.images.load(path)
    px = list(img.pixels)
    n = len(px) // 4
    if n == 0:
        return {'blank': True, 'why': 'no pixels'}
    sums = [0.0, 0.0, 0.0]
    sq = 0.0
    colors = {}
    step = max(1, n // 40000)
    cnt = 0
    for i in range(0, n, step):
        r, g, b = px[i*4], px[i*4+1], px[i*4+2]
        lum = 0.2126*r + 0.7152*g + 0.0722*b
        sums[0] += r; sums[1] += g; sums[2] += b
        sq += lum*lum
        key = (round(r, 1), round(g, 1), round(b, 1))
        colors[key] = colors.get(key, 0) + 1
        cnt += 1
    mean = [s/cnt for s in sums]
    meanlum = 0.2126*mean[0] + 0.7152*mean[1] + 0.0722*mean[2]
    var = sq/cnt - meanlum*meanlum
    std = math.sqrt(max(0.0, var))
    dom = max(colors.values())/cnt
    return {'std255': round(std*255, 2), 'dominant': round(dom, 3),
            'blank': std < 2/255 or dom > 0.95}

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 24
sc.cycles.use_denoising = True
sc.cycles.device = 'CPU'
sc.render.threads_mode = 'FIXED'
sc.render.threads = 4
sc.render.resolution_x = 900
sc.render.resolution_y = 640
sc.world = bpy.data.worlds.new('daylight')
sc.world.use_nodes = True
sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.55, .65, .8, 1)
sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value = .7
light = bpy.data.lights.new('sun', 'SUN')
light.energy = 3.0
light.angle = math.radians(12)
so = bpy.data.objects.new('sun', light)
sc.collection.objects.link(so)
so.rotation_euler = (math.radians(35), math.radians(-15), math.radians(-40))

guard = []
for glb, shots in SHOTS.items():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, glb))
    for name, pos, tgt in shots:
        camd = bpy.data.cameras.new('cam')
        cam = bpy.data.objects.new('cam-' + name, camd)
        sc.collection.objects.link(cam)
        camd.lens = 30
        camd.clip_end = 2500
        cam.location = (pos[0], -pos[2], pos[1])
        look = Vector((tgt[0], -tgt[2], tgt[1]))
        cam.rotation_euler = (look - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.camera = cam
        sc.render.filepath = os.path.join(CK, f'{glb[:-4]}-{name}.png')
        bpy.ops.render.render(write_still=True)
        st = stats_guard(sc.render.filepath)
        st['file'] = f'{glb[:-4]}-{name}.png'
        guard.append(st)
        print('GUARD', json.dumps(st))
        bpy.data.objects.remove(cam)
    # 只保留最后一个 glb 的物体也无妨；清掉避免相互干扰
    for o in [o for o in bpy.data.objects if o not in before and o.type == 'MESH']:
        bpy.data.objects.remove(o)

json.dump(guard, open(os.path.join(CK, 'guard.json'), 'w'), indent=1)
if any(g['blank'] for g in guard):
    print('BLANK FRAME DETECTED')
    sys.exit(1)
print('CHECK RENDER OK')
