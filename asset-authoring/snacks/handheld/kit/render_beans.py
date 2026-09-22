"""Bean-specific renders (DESIGN_SPEC.beans.renders):
- bean-lineup: 6 variants in a row, 2048x768, camera .25 m, f/4 focused on v3
- bean-macro-{key,rim,top}: single bean v1, 2048x1536, camera .09 m, f/2.8, three light angles
- {dish,jar,packet} close-ups 1600x1200; jar close-up records bean resolvability measurement.
Blank guard on every frame."""
import bpy
import sys
import json
import math
from pathlib import Path
from mathutils import Vector

KIT = Path(__file__).resolve().parent
WS = KIT.parent
sys.path.insert(0, str(WS / 'kit'))
sys.path.insert(0, str(WS / 'tools'))

import glbtools  # noqa: E402

REND = WS / 'renders'
SPEC = json.loads((WS.parent / 'DESIGN_SPEC.json').read_text(encoding='utf-8'))


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
    _, counts = __import__('numpy').unique(q, axis=0, return_counts=True)
    top = float(counts.max()) / q.shape[0]
    return {'file': str(path), 'lumStd255': round(std, 2), 'topColourShare': round(top, 3),
            'ok': bool(std >= 2.0 and top < .95)}


def build_scene(sun_pos=(48, 140)):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
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
    so.rotation_euler = (math.radians(sun_pos[0]), 0, math.radians(sun_pos[1]))
    fill = bpy.data.lights.new('fill', 'AREA')
    fill.energy = 40
    fill.size = .6
    fo = bpy.data.objects.new('fill', fill)
    sc.collection.objects.link(fo)
    fo.location = (.6, -.4, .5)
    fo.rotation_euler = (math.radians(57), 0, math.radians(-33))
    bpy.ops.mesh.primitive_plane_add(size=2, location=(0, 0, -.001))
    tm = bpy.data.materials.new('table')
    tm.use_nodes = True
    tn = tm.node_tree.nodes['Principled BSDF']
    tn.inputs['Base Color'].default_value = (.33, .25, .19, 1)
    tn.inputs['Roughness'].default_value = .6
    bpy.context.object.data.materials.append(tm)
    return sc


def add_camera(sc, name, pos, look, fov, fstop=None, focus=None):
    c = bpy.data.cameras.new(name)
    c.lens_unit = 'FOV'
    c.angle = math.radians(fov)
    c.clip_start = .001
    if fstop:
        c.dof.use_dof = True
        c.dof.aperture_fstop = fstop
        c.dof.focus_distance = focus
    o = bpy.data.objects.new(name, c)
    sc.collection.objects.link(o)
    p, t = Vector(pos), Vector(look)
    o.location = p
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = (t - p).to_track_quat('-Z', 'Y')
    return o


def render(sc, path, rx, ry, spp):
    sc.render.resolution_x = rx
    sc.render.resolution_y = ry
    sc.cycles.samples = spp
    sc.cycles.use_denoising = True
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.quality = 92
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def prefs_gpu():
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'CUDA'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = (d.type == 'CUDA')
        return 'GPU'
    except Exception:
        return 'CPU'


device = prefs_gpu()
log = {'device': device, 'frames': []}
failed = []

# ---------- bean-lineup -----------------------------------------------------
sc = build_scene()
pre = set(sc.objects)
bpy.ops.import_scene.gltf(filepath=str(WS / 'props' / 'bean-single.glb'))
roots = [o for o in sc.objects if o not in pre and o.parent is None]
roots.sort(key=lambda o: o.name)
for k, r in enumerate(roots):
    r.location = (k * .026 - 2.5 * .026, 0, 0)   # blender: x spread
focus = (0.0, 0.0, .004)
cam_pos = Vector((-.05, -.26, .055))
cam = add_camera(sc, 'cam', cam_pos, focus, 34, fstop=4, focus=(cam_pos - Vector(focus)).length)
sc.camera = cam
f = REND / 'bean-lineup.jpg'
render(sc, f, 2048, 768, 128)
g = blank_guard(f)
log['frames'].append(g)
if not g['ok']:
    failed.append(str(f))
bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------- bean macro, three light angles ----------------------------------
ANGLE = {'key': (48, 140), 'rim': (30, 330), 'top': (80, 140)}
for name, (el, az) in ANGLE.items():
    sc = build_scene(sun_pos=(el, az))
    bpy.ops.import_scene.gltf(filepath=str(WS / 'props' / 'bean-single.glb'))
    v1 = next(o for o in sc.objects if o.parent is None and o.name.startswith('wuxiangdou-bean-v1'))
    rest = [o for o in sc.objects if o.parent is None and o is not v1]
    for o in rest:
        for c in list(o.children_recursive):
            bpy.data.objects.remove(c, do_unlink=True)
        bpy.data.objects.remove(o, do_unlink=True)
    v1.location = (0, 0, 0)
    bpy.context.view_layer.update()
    sock = sc.objects.get('socket_grip')
    sock_pos = sock.matrix_world.translation if sock else Vector((.011, 0, .0045))
    cen = Vector((.0, .0, .0045))
    side = Vector((sock_pos.x, sock_pos.y, 0))
    if side.length < 1e-6:
        side = Vector((1, 0, 0))
    side.normalize()
    pos = sock_pos + side * .075 + Vector((0, 0, .012))
    cam = add_camera(sc, 'cam', pos, sock_pos, 30, fstop=2.8, focus=(pos - sock_pos).length)
    sc.camera = cam
    f = REND / ('bean-macro-%s.jpg' % name)
    render(sc, f, 2048, 1536, 128)
    g = blank_guard(f)
    log['frames'].append(g)
    if not g['ok']:
        failed.append(str(f))
    bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------- dish / jar / packet close-ups -----------------------------------
CLOSE = {'bean-dish': 'bean-dish-close.jpg', 'bean-jar': 'bean-jar-close.jpg',
         'bean-packet-open': 'bean-packet-close.jpg'}
jar_cat = json.loads((WS / 'props/catalog/bean-jar.json').read_text(encoding='utf-8'))
bean_pos = jar_cat['beanSet']['positions']
meas = None
for id_, out in CLOSE.items():
    sc = build_scene()
    pre = set(sc.objects)
    bpy.ops.import_scene.gltf(filepath=str(WS / 'props' / (id_ + '.glb')))
    new_objs = [o for o in sc.objects if o not in pre]
    for o in new_objs:
        if o.type == 'MESH' and (o.name.endswith('_LOD1') or o.name.endswith('_LOD2')):
            o.hide_render = True
            o.hide_viewport = True
    pts = []
    for o in new_objs:
        if o.type == 'MESH' and not o.hide_render:
            for c in o.bound_box:
                pts.append(o.matrix_world @ Vector(c))
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    cen = (lo + hi) / 2
    dim = max(hi - lo)
    d = dim * 2.2 + .04
    pos = cen + Vector((d * .55, -d * .7, d * .45))
    cam = add_camera(sc, 'cam', pos, cen, 40)
    sc.camera = cam
    f = REND / out
    render(sc, f, 1600, 1200, 128)
    g = blank_guard(f)
    log['frames'].append(g)
    if not g['ok']:
        failed.append(str(f))
    if id_ == 'bean-jar':
        # resolvability: project each bean centre; px diameter = 1600 * (bean_len / (2*tan(fov/2)*depth))
        import numpy as np
        from bpy_extras.object_utils import world_to_camera_view
        fovr = 40 * math.pi / 180
        ok_px = 0
        px_sizes = []
        sc.view_layers.update()
        dep = bpy.data.objects['cam']
        mw = dep.matrix_world.inverted()
        proj = dep.data.view_frame(scene=sc)
        for pdesign in bean_pos:
            # design glb -> blender coords; camera view space is -Z forward
            pb = Vector((pdesign[0], -pdesign[2], pdesign[1]))
            depth = -(mw @ pb).z
            px = 1600 * .022 / (2 * math.tan(fovr / 2) * depth)
            px_sizes.append(px)
            if px >= 25:
                ok_px += 1
        share = ok_px / len(bean_pos)
        meas = {'beans': len(bean_pos), 'minProjectedPx': round(min(px_sizes), 1),
                'medianProjectedPx': round(float(np.median(px_sizes)), 1),
                'shareOver25Px': round(share, 3), 'threshold': 0.6, 'pass': bool(share >= .6)}
        print('JAR_RESOLVABILITY', json.dumps(meas))

log['jarResolvability'] = meas
(REND / 'render-log-beans.json').write_text(json.dumps(log, indent=2) + '\n', encoding='utf-8')
if meas:
    (WS / 'props' / 'jar-resolvability.json').write_text(json.dumps(meas, indent=2) + '\n', encoding='utf-8')
if failed:
    print('BLANK_FRAMES', json.dumps(failed))
    sys.exit(3)
print('BEAN_RENDERS_DONE', device)
