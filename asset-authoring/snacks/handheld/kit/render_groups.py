"""S4 group scenes. blender --background --python kit/render_groups.py -- [--skip-counter]
- table-spread: all 27 GLBs on a 1.2 x 0.8 m table, 3 rows, 1920x1080
- counter-integration: copy of baseline building/model.blend + 6 items on the takeaway
  counter (design y=0.995), takeaway-counter camera from inputs/render_shop.py."""
import bpy
import json
import sys
import math
import shutil
from pathlib import Path
from mathutils import Vector

KIT = Path(__file__).resolve().parent
WS = KIT.parent
PKG = WS.parent
BASELINE = PKG.parent / 'pawborough-snackshop-20260921'
sys.path.insert(0, str(WS / 'tools'))
import glbtools  # noqa: E402

REND = WS / 'renders'
ITEMS = [i['id'] for i in __import__('json').loads(
    (PKG / 'DESIGN_SPEC.json').read_text(encoding='utf-8'))['items']]


def blank_guard(path):
    import numpy as np
    img = bpy.data.images.load(str(path), check_existing=False)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[::-1]
    bpy.data.images.remove(img)
    small = px[:: max(1, h // 512), :: max(1, w // 512), :3]
    lum = small @ np.array([.2126, .7152, .0722], dtype=np.float32)
    std = float(lum.std()) * 255
    q = (small * 255).astype(np.uint8).reshape(-1, 3)
    import numpy as np2
    _, counts = np2.unique(q, axis=0, return_counts=True)
    top = float(counts.max()) / q.shape[0]
    return {'file': str(path), 'lumStd255': round(std, 2), 'topColourShare': round(top, 3),
            'ok': bool(std >= 2.0 and top < .95)}


def setup_lights(sc):
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (.5, .5, .5, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = .8
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.5
    sun.angle = math.radians(3)
    so = bpy.data.objects.new('sun', sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(48), 0, math.radians(140))
    fill = bpy.data.lights.new('fill', 'AREA')
    fill.energy = 400
    fill.size = 1.0
    fo = bpy.data.objects.new('fill', fill)
    sc.collection.objects.link(fo)
    fo.location = (-1.9, -1.6, 1.2)   # clear of the sun path and the table
    fo.rotation_mode = 'QUATERNION'
    fo.rotation_quaternion = (Vector((.5, -.35, 0)) - Vector(fo.location)).to_track_quat('-Z', 'Y')


def gpu():
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'CUDA'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = (d.type == 'CUDA')
        return 'GPU'
    except Exception:
        return 'CPU'


skip_counter = '--skip-counter' in sys.argv
log = {'device': gpu(), 'frames': []}
failed = []

# ---------------- table-spread ----------------
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
setup_lights(sc)
bpy.ops.mesh.primitive_plane_add(size=1, location=(.05, -.31, -.001))
tbl = bpy.context.object
tbl.scale = (1.3, .85, 1)
tm = bpy.data.materials.new('table')
tm.use_nodes = True
tn = tm.node_tree.nodes['Principled BSDF']
tn.inputs['Base Color'].default_value = (.33, .25, .19, 1)
tn.inputs['Roughness'].default_value = .6
tbl.data.materials.append(tm)

CLASS_OF = {}
spec = __import__('json').loads((PKG / 'DESIGN_SPEC.json').read_text(encoding='utf-8'))
for it in spec['items']:
    CLASS_OF[it['id']] = it['class']
rows = {'pinch': 0, 'grip': 1, 'carry': 2}
x = {0: -.45, 1: -.45, 2: -.45}
yrow = {0: -.05, 1: -.3, 2: -.62}
placed = []
for id_ in ITEMS:
    pre = set(sc.objects)
    bpy.ops.import_scene.gltf(filepath=str(WS / 'props' / (id_ + '.glb')))
    new = [o for o in sc.objects if o not in pre]
    root = next(o for o in new if o.parent is None)
    for o in new:   # render the active surface only: LOD0 (+ named nodes)
        if o.type == 'MESH' and (o.name.endswith('_LOD1') or o.name.endswith('_LOD2')):
            o.hide_render = True
            o.hide_viewport = True
    pts = []
    for o in new:
        if o.type == 'MESH':
            for c in o.bound_box:
                pts.append(o.matrix_world @ Vector(c))
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    dim = max(hi - lo)
    r = rows[CLASS_OF[id_]]
    cx = x[r] + dim / 2 + .01
    if cx > .55:
        pass
    root.location = Vector((x[r] + dim * .04, yrow[r], 0))
    x[r] += dim + .025
    placed.append(id_)

c = bpy.data.cameras.new('cam')
c.lens_unit = 'FOV'
c.angle = math.radians(50)
c.clip_start = .001
cam = bpy.data.objects.new('cam', c)
sc.collection.objects.link(cam)
pos = Vector((.05, -1.55, 1.15))
look = Vector((.05, -.3, .02))
cam.location = pos
cam.rotation_mode = 'QUATERNION'
cam.rotation_quaternion = (look - pos).to_track_quat('-Z', 'Y')
sc.camera = cam
sc.cycles.samples = 128
sc.cycles.use_denoising = True
sc.render.resolution_x = 1920
sc.render.resolution_y = 1080
sc.render.image_settings.file_format = 'JPEG'
sc.render.image_settings.quality = 92
sc.render.filepath = str(REND / 'table-spread.jpg')
bpy.ops.render.render(write_still=True)
g = blank_guard(REND / 'table-spread.jpg')
log['frames'].append(g)
if not g['ok']:
    failed.append(str(g['file']))
print('TABLE_SPREAD_DONE', len(placed))

# ---------------- counter-integration ----------------
if not skip_counter:
    work = WS / 'counter_work'
    if work.exists():
        shutil.rmtree(work)
    work.mkdir()
    shutil.copy(BASELINE / 'building' / 'model.blend', work / 'model.blend')
    bpy.ops.wm.open_mainfile(filepath=str(work / 'model.blend'))
    sc = bpy.data.scenes['Scene']
    bpy.context.window.scene = sc
    sc.render.engine = 'CYCLES'
    setup_lights(sc)
    sc.render.resolution_x = 1920
    sc.render.resolution_y = 1080
    sc.cycles.samples = 96
    sc.cycles.use_denoising = True
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.quality = 92
    # takeaway-counter camera from inputs/render_shop.py (design coords -> blender)
    c = bpy.data.cameras.new('takeaway-counter')
    c.lens_unit = 'FOV'
    c.angle = math.radians(45)
    c.clip_start = .001
    cam = bpy.data.objects.new('takeaway-counter', c)
    sc.collection.objects.link(cam)
    p = Vector((2.7, -1.4, 1.5))     # design (2.7,1.5,1.4) -> blender (x,-z,y)
    t = Vector((1.5, .35, 1.0))      # design (1.5,1.0,-.35)
    cam.location = p
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = (t - p).to_track_quat('-Z', 'Y')
    sc.camera = cam
    COUNTER_Y = .995                 # design y of the counter surface
    # counter top: centre (2.12, -.32) design, x+-0.95, z+-0.35, surface y=.995
    for id_, pos_x, pos_z, yaw in (('steamer-xiaolongbao-8', 1.78, -.22, 0),
                                   ('vinegar-dish', 2.02, -.12, 0),
                                   ('teacup-filled', 2.22, -.18, 0),
                                   ('chopsticks-pair', 2.32, -.5, math.pi / 2),
                                   ('bean-dish', 2.52, -.3, 0),
                                   ('bean-jar', 2.85, -.32, 0)):
        pre = set(sc.objects)
        bpy.ops.import_scene.gltf(filepath=str(WS / 'props' / (id_ + '.glb')))
        new = [o for o in sc.objects if o not in pre]
        root = next(o for o in new if o.parent is None)
        for o in new:
            if o.type == 'MESH' and (o.name.endswith('_LOD1') or o.name.endswith('_LOD2')):
                o.hide_render = True
                o.hide_viewport = True
        # gltf import maps glTF (x,y,z) -> blender (x,-z,y): design y up becomes blender z
        root.location = Vector((pos_x, -pos_z, COUNTER_Y))
        root.rotation_euler = (0, 0, yaw)
    f = REND / 'counter-integration.jpg'
    sc.render.filepath = str(f)
    bpy.ops.render.render(write_still=True)
    g = blank_guard(f)
    log['frames'].append(g)
    if not g['ok']:
        failed.append(str(g['file']))
    shutil.rmtree(work, ignore_errors=True)

(REND / 'render-log-groups.json').write_text(json.dumps(log, indent=2) + '\n', encoding='utf-8')
if failed:
    print('BLANK_FRAMES', failed)
    sys.exit(3)
print('GROUPS_DONE', log['device'])
