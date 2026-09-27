"""wave10-pondqa 渲染器：读 tests/pondqa-shots.mjs 的 shots JSON，一次导入全部分区 GLB（除方浜），逐机位渲染。
Cycles CPU + 空白帧守卫（亮度 std < 2/255 或主色 > 95% 判空白 -> exit 1）。图片只写 --out（工单包 artifacts/，不进仓库）。
用法：blender -b -t 4 -P tests/pondqa-render.py -- --shots <shots.json> --out <dir> [--res 960x600] [--spp 24] [--filter re]
"""
import argparse, json, math, os, re, sys
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--shots', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--res', default='960x600')
ap.add_argument('--spp', type=int, default=24)
ap.add_argument('--filter', default='')
a = ap.parse_args(argv)
os.makedirs(a.out, exist_ok=True)
RX, RY = (int(v) for v in a.res.split('x'))
SH = json.load(open(a.shots, encoding='utf-8'))

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = a.spp
sc.cycles.use_denoising = True
sc.cycles.device = 'CPU'
sc.render.threads_mode = 'FIXED'
sc.render.threads = 4
sc.render.resolution_x, sc.render.resolution_y = RX, RY
sc.render.resolution_percentage = 100
sc.view_settings.view_transform = 'AgX'
sc.world = bpy.data.worlds.new('daylight')
sc.world.use_nodes = True
sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.55, .65, .8, 1)
sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value = .65
lt = bpy.data.lights.new('sun', 'SUN'); lt.energy = 2.5; lt.angle = math.radians(12)
so = bpy.data.objects.new('sun', lt); sc.collection.objects.link(so)
so.rotation_euler = (math.radians(28), math.radians(-25), math.radians(-35))

for f in SH['glbs']:
    bpy.ops.import_scene.gltf(filepath=f)
bpy.context.view_layer.update()
print('imported', len(SH['glbs']), 'glbs,', len(bpy.data.objects), 'objects')

def guard(path):
    img = bpy.data.images.load(path)
    px_ = img.pixels[:]
    cnt = len(px_) // 4
    step = max(1, cnt // 40000)
    s = sq = 0.0; colors = {}; k = 0
    for i in range(0, cnt, step):
        r, g, b = px_[i * 4], px_[i * 4 + 1], px_[i * 4 + 2]
        lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        s += lum; sq += lum * lum
        key = (round(r, 1), round(g, 1), round(b, 1)); colors[key] = colors.get(key, 0) + 1; k += 1
    mean = s / k; std = math.sqrt(max(0.0, sq / k - mean * mean)); dom = max(colors.values()) / k
    bpy.data.images.remove(img)
    return {'std255': round(std * 255, 2), 'dominant': round(dom, 3), 'blank': std < 2 / 255 or dom > 0.95}

pat = re.compile(a.filter) if a.filter else None
camd = bpy.data.cameras.new('cam'); camd.clip_start = 0.05; camd.clip_end = 3000
cam = bpy.data.objects.new('cam', camd); sc.collection.objects.link(cam); sc.camera = cam
fails, report = [], []
for shot in SH['shots']:
    if pat and not pat.search(shot['name']):
        continue
    camd.lens = shot.get('lens', 30)
    p, t = shot['pos'], shot['tgt']
    cam.location = Vector((p[0], -p[2], p[1]))
    tgt = Vector((t[0], -t[2], t[1]))
    cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.view_layer.update()
    out = os.path.join(a.out, shot['name'] + '.png')
    sc.render.filepath = out
    bpy.ops.render.render(write_still=True)
    g = guard(out)
    report.append({'shot': shot['name'], 'guard': g, 'pos': p, 'tgt': t, 'lens': shot.get('lens', 30), 'note': shot.get('note', '')})
    print('SHOT', shot['name'], g, flush=True)
    if g['blank']:
        fails.append(shot['name'])
json.dump(report, open(os.path.join(a.out, 'render-report.json'), 'w'), ensure_ascii=False, indent=1)
if fails:
    print('BLANK FRAMES:', fails); sys.exit(1)
print('all', len(report), 'shots ok')
