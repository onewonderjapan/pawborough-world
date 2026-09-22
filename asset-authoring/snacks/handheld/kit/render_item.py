"""Per-item renders: front/three-quarter/top/back sheet + macro with DOF at socket_grip.
Blender: blender --background --python kit/render_item.py -- --ids a,b [--no-sheet] [--no-macro]
Cycles; CUDA if available (recorded), else CPU. Blank-frame guard on every frame."""
import bpy
import sys
import os
import json
import math
import time
import argparse
from pathlib import Path
import numpy as np
from mathutils import Vector

KIT = Path(__file__).resolve().parent
WS = KIT.parent
sys.path.insert(0, str(WS / 'tools'))
import glbtools  # noqa: E402

REND = Path(os.environ.get('SNACKS_REND', str(WS / 'renders')))
PROPS = Path(os.environ.get('SNACKS_PROPS', str(WS / 'props')))
PKG = WS.parent
while not (PKG / 'DESIGN_SPEC.json').exists() and PKG != PKG.parent:
    PKG = PKG.parent
SPEC = json.loads((PKG / 'DESIGN_SPEC.json').read_text(encoding='utf-8'))
RIG = SPEC['renderSpec']


def setup_device(log):
    prefs = bpy.context.preferences.addons['cycles'].preferences
    if os.environ.get('SNACKS_FORCE_CPU'):
        # R1 rule: CUDA only when GPU utilisation < 20% (it was ~96% at start)
        prefs.compute_device_type = 'NONE'
        log['device'] = 'CPU'
        return 'CPU'
    for ctype in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = ctype
            prefs.get_devices()
            if [d for d in prefs.devices if d.type == ctype]:
                for d in prefs.devices:
                    d.use = (d.type == ctype)
                log['device'] = 'CUDA:' + ctype
                return 'GPU'
        except Exception:
            pass
    log['device'] = 'CPU'
    return 'CPU'


def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.render.engine = 'CYCLES'
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (.5, .5, .5, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = .8
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = RIG['lightRig']['sun']['energy']
    sun.angle = math.radians(RIG['lightRig']['sun']['angleDeg'])
    so = bpy.data.objects.new('sun', sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(RIG['lightRig']['sun']['elevationDeg']), 0,
                         math.radians(RIG['lightRig']['sun']['azimuthDeg']))
    fill = bpy.data.lights.new('fill', 'AREA')
    fill.energy = 40
    fill.size = .6
    fo = bpy.data.objects.new('fill', fill)
    sc.collection.objects.link(fo)
    fo.location = (.6, -.4, .5)    # opposite the sun (azimuth 140), ~33 deg elevation
    fo.rotation_euler = (math.radians(57), 0, math.radians(-33))
    bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, -.001))
    tbl = bpy.context.object
    tm = bpy.data.materials.new('table')
    tm.use_nodes = True
    tn = tm.node_tree.nodes['Principled BSDF']
    tn.inputs['Base Color'].default_value = (.33, .25, .19, 1)
    tn.inputs['Roughness'].default_value = .6
    tbl.data.materials.append(tm)
    return sc


def add_camera(sc, name, pos_bl, look_bl, fov=42, dof_mm=None, focus=None):
    c = bpy.data.cameras.new(name)
    c.lens_unit = 'FOV'
    c.angle = math.radians(fov)
    c.clip_start = .001
    c.clip_end = 100
    if dof_mm:
        c.dof.use_dof = True
        c.dof.aperture_fstop = dof_mm
        c.dof.focus_distance = max(.001, focus)
    o = bpy.data.objects.new(name, c)
    sc.collection.objects.link(o)
    p, t = Vector(pos_bl), Vector(look_bl)
    o.location = p
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = (t - p).to_track_quat('-Z', 'Y')
    return o


def blank_guard(sc, path):
    """spec: std of luminance < 2/255 or single colour > 95% => blank."""
    img = bpy.data.images.load(str(path), check_existing=False)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[::-1]
    bpy.data.images.remove(img)
    small = px[:: max(1, h // 512), :: max(1, w // 512), :3]
    lum = small @ np.array([.2126, .7152, .0722], dtype=np.float32)
    std = float(lum.std()) * 255
    q = (small * 255).astype(np.uint8)
    flat = q.reshape(-1, 3)
    colors, counts = np.unique(flat, axis=0, return_counts=True)
    top = float(counts.max()) / flat.shape[0]
    ok = std >= 2.0 and top < .95
    return {'file': str(path), 'lumStd255': round(std, 2), 'topColourShare': round(top, 3), 'ok': bool(ok)}


def render(sc, path, rx, ry, spp):
    sc.render.resolution_x = rx
    sc.render.resolution_y = ry
    sc.render.resolution_percentage = 100
    sc.cycles.samples = spp
    sc.cycles.use_denoising = True
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.quality = 92
    sc.render.filepath = str(path)
    t = time.time()
    bpy.ops.render.render(write_still=True)
    return round(time.time() - t, 1)


def views_for(bounds_center, dim, view):
    d = 2.1 * dim + .05
    cx, cy, cz = bounds_center
    if view == 'front':
        return (cx, cy - d, cz + dim * .18)
    if view == 'back':
        return (cx, cy + d, cz + dim * .18)
    if view == 'top':
        return (cx, cy + .001, cz + d * .95)
    return (cx + d * .65, cy - d * .65, cz + d * .5)  # three-quarter


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ids', required=True)
    ap.add_argument('--no-sheet', action='store_true')
    ap.add_argument('--no-macro', action='store_true')
    ap.add_argument('--views', default=None, help='comma list restricting sheet views')
    ap.add_argument('--props', default=None, help='GLB source dir (default $SNACKS_PROPS or WS/props)')
    ap.add_argument('--rend', default=None, help='renders output dir (default $SNACKS_REND or WS/renders)')
    ap.add_argument('--lid-off', dest='lid_off', action='store_true', default=True,
                    help='render an extra lid-off frame for items with a lid child (default on)')
    ap.add_argument('--no-lid-off', dest='lid_off', action='store_false')
    args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    global REND, PROPS
    if args.props:
        PROPS = Path(args.props)
    if args.rend:
        REND = Path(args.rend)
    log = {'frames': [], 'device': None}
    device = setup_device(log)
    if device == 'CPU':
        sc_threads = int(os.environ.get('SNACKS_THREADS', '4'))
    failed = []
    for id_ in [s.strip() for s in args.ids.split(',') if s.strip()]:
        glb = PROPS / (id_ + '.glb')
        out = REND / id_
        out.mkdir(parents=True, exist_ok=True)
        sc = build_scene()
        if device == 'CPU':
            sc.render.threads_mode = 'FIXED'
            sc.render.threads = sc_threads
        pre = set(sc.objects)
        bpy.ops.import_scene.gltf(filepath=str(glb))
        imported = [o for o in sc.objects if o not in pre]
        lid = sc.objects.get('lid')
        for o in imported:
            if o.type == 'MESH' and (o.name.endswith('_LOD1') or o.name.endswith('_LOD2')):
                o.hide_render = True
                o.hide_viewport = True
        # bounds over imported mesh objects (blender coords)
        pts = []
        for o in imported:
            if o.type == 'MESH':
                for c in o.bound_box:
                    pts.append(o.matrix_world @ Vector(c))
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        cen = (lo + hi) / 2
        dim = max(hi - lo)
        # socket_grip world pos (blender) for macro focus (distance camera -> socket)
        sock = sc.objects.get('socket_grip')
        sock_pos = sock.matrix_world.translation if sock else cen
        sheet = SPEC['renderSpec']['perItemSheet']
        views = args.views.split(',') if args.views else list(sheet['views'])
        if not args.no_sheet:
            for view in views:
                pos = views_for((cen.x, cen.y, cen.z), dim, view)
                cam = add_camera(sc, 'cam-' + view, pos, (cen.x, cen.y, cen.z), fov=42)
                sc.camera = cam
                f = out / ('%s-%s.jpg' % (id_, view))
                secs = render(sc, f, sheet['size'][0], sheet['size'][1], sheet['spp'])
                g = blank_guard(sc, f)
                g['seconds'] = secs
                log['frames'].append(g)
                if not g['ok']:
                    failed.append(str(f))
        if args.lid_off and lid is not None:
            # R1 #7: extra lid-off view (buns visible), same rig, lid hidden for this frame
            lid.hide_render = True
            pos = views_for((cen.x, cen.y, cen.z), dim, 'three-quarter')
            cam = add_camera(sc, 'cam-lid-off', (pos[0], pos[1], cen.z + (pos[2] - cen.z) * 1.35),
                             (cen.x, cen.y, cen.z), fov=42)
            sc.camera = cam
            f = out / ('%s-lid-off.jpg' % id_)
            secs = render(sc, f, sheet['size'][0], sheet['size'][1], sheet['spp'])
            g = blank_guard(sc, f)
            g['seconds'] = secs
            log['frames'].append(g)
            if not g['ok']:
                failed.append(str(f))
            lid.hide_render = False
        if not args.no_macro:
            mac = SPEC['renderSpec']['perItemMacro']
            d = 1.2 * dim + .03
            # camera on the socket_grip side, looking at the socket, focused on the socket
            sd = Vector((sock_pos.x - cen.x, sock_pos.y - cen.y, 0))
            if sd.length < 1e-6:
                sd = Vector((1, 0, 0))
            sd.normalize()
            pos = Vector((cen.x, cen.y, cen.z)) + sd * d + Vector((0, 0, .35 * d))
            cam = add_camera(sc, 'cam-macro', pos, sock_pos, fov=35,
                             dof_mm=2.8, focus=(Vector(sock_pos) - pos).length)
            sc.camera = cam
            f = out / ('%s-macro.jpg' % id_)
            secs = render(sc, f, mac['size'][0], mac['size'][1], mac['spp'])
            g = blank_guard(sc, f)
            g['seconds'] = secs
            log['frames'].append(g)
            if not g['ok']:
                failed.append(str(f))
        (REND / 'render-log.json').write_text(json.dumps({'device': log['device'], **log}, indent=2) + '\n',
                                              encoding='utf-8') if False else None
        print('RENDER_DONE', id_, device)
        bpy.ops.wm.read_factory_settings(use_empty=True)
    # merge with existing log so partial re-renders keep other records
    lf = REND / 'render-log.json'
    merged = {'device': log['device'], 'frames': []}
    if lf.exists():
        try:
            old_log = json.loads(lf.read_text(encoding='utf-8'))
            keep = {f['file']: f for f in old_log.get('frames', [])}
            for f in log['frames']:
                keep[f['file']] = f
            merged['frames'] = list(keep.values())
        except Exception:
            merged['frames'] = log['frames']
    else:
        merged['frames'] = log['frames']
    lf.write_text(json.dumps(merged, indent=2) + '\n', encoding='utf-8')
    if failed:
        print('BLANK_FRAMES', json.dumps(failed))
        sys.exit(3)
    print('ALL_RENDERED', device)


if __name__ == '__main__':
    main()
