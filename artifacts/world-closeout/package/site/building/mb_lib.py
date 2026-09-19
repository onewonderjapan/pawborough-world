"""Module builder library for the Fangbang 90m segment.

Derived from the accepted 檐下三间 build method (inputs/baseline/building/build.py).
Design coordinates are GLB space: Y up, facade +Z, depth -Z, front-wall center bottom origin.
Runs INSIDE Blender. One module per process: reset_scene() first, build_materials() next,
primitives during build, finalize() to join/export/self-check.
"""
import bpy, bmesh, math, json, hashlib, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
from helpers import box_glb, glb_to_blender

TEX = HERE / 'textures'
SIGN_ROWS = 16
META = {}
M = {}
COLL = []
GROUP = 'module'


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1
    META.clear(); M.clear(); COLL.clear()
    globals()['GROUP'] = 'module'


def lin(hex):
    a = [int(hex[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in a]


def mat(name, color='ffffff', rough=.8, metal=0, family=None, tile=(1, 1), base=None, normal=None, extend=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    n = m.node_tree.nodes; l = m.node_tree.links
    p = n.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*lin(color), 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    paths = {}
    if family:
        for ch, suf in [('color', 'Color'), ('normal', 'NormalGL'), ('roughness', 'Roughness')]:
            files = list(TEX.glob(f'{family}*{suf}*jpg'))
            if files:
                paths[ch] = files[0]
    if base: paths['color'] = TEX / base
    if normal: paths['normal'] = TEX / normal
    for ch, path in paths.items():
        t = n.new('ShaderNodeTexImage')
        t.extension = 'EXTEND' if extend else 'REPEAT'
        t.image = bpy.data.images.load(str(path), check_existing=True)
        t.image.colorspace_settings.name = 'sRGB' if ch == 'color' else 'Non-Color'
        t.image.pack()
        if ch == 'normal':
            norm = n.new('ShaderNodeNormalMap')
            norm.inputs['Strength'].default_value = .65
            l.new(t.outputs['Color'], norm.inputs['Color'])
            l.new(norm.outputs['Normal'], p.inputs['Normal'])
        elif ch == 'roughness':
            l.new(t.outputs['Color'], p.inputs['Roughness'])
        else:
            l.new(t.outputs['Color'], p.inputs['Base Color'])
    META[name] = {'tileMeters': list(tile), 'colorSrgb': color, 'roughness': rough,
                  'textures': {k: str(v.relative_to(HERE)) for k, v in paths.items()},
                  'normalConvention': 'OpenGL',
                  'source': 'ambientCG CC0 project textures' if family else 'locally authored / constant material'}
    return m


def build_materials():
    """Shared palette frozen from the accepted baseline slice."""
    M['plaster'] = mat('weathered-lime-plaster', family='PaintedPlaster017', tile=(2.5, 2.5))
    M['brick'] = mat('blue-gray-brick', family='Bricks061', tile=(1.05, 1.20))
    M['wood'] = mat('oxblood-stained-timber', '542c25', .65, base='wood-stain-color.jpg', normal='Wood092_2K-JPG_NormalGL_1K.jpg', tile=(.75, 1.5))
    M['dark'] = mat('deep-door-lacquer', '252320', .53)
    M['roof'] = mat('gray-pan-tile', base='roof-color.jpg', normal='roof-normal.png', tile=(1.44, 1.36))
    M['stone'] = mat('worn-stone', '9a9a8c', .92)
    M['glass'] = mat('recessed-old-glass', '364347', .28, .12)
    M['gold'] = mat('aged-brass', 'bb9a5b', .44, .55)
    M['inner'] = mat('interior-warm-shadow', '736555', .96)
    M['drawer'] = mat('medicine-drawer-wood', '71503b', .75)
    M['iron'] = mat('dark-iron', '44453d', .64, .48)
    M['paper'] = mat('aged-paper', 'c1b18b', .93)
    M['sign'] = mat('shop-sign-typeset-atlas', base='sign-atlas.png', rough=.68)
    M['cat'] = mat('cat-wall-reference-repaint', base='catwall-mural.png', rough=.98, extend=True)
    M['clothR'] = mat('wine-cotton', '8b4346', .98)
    M['clothB'] = mat('indigo-cotton', '536b7d', .98)
    M['clothG'] = mat('sage-cotton', '899786', .98)
    M['clothC'] = mat('cream-cotton', 'c9b893', .98)
    M['road'] = mat('quiet-gray-asphalt', family='Asphalt033', tile=(3, 3))
    M['paving'] = mat('paving-frontage', family='PavingStones138', tile=(2.4, 2.4))
    M['silkR'] = mat('red-silk-lantern', 'a04a42', .82)
    M['scroll'] = mat('scroll-paper', 'd8cdb2', .9)


def tag(o):
    o['part'] = GROUP
    return o


def box(name, c, s, m='wood', bevel=.008, collision=False):
    if max(s) / min(s) > 55:
        bevel = 0
    o = tag(box_glb(name, c, s, M[m], META[M[m].name]['tileMeters'], bevel))
    if collision:
        COLL.append({'name': name, 'group': GROUP, 'center': list(c), 'size': list(s), 'type': 'box', 'axis': 'glTF Y-up'})
    return o


def mesh(name, verts, faces, m, uvs=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([glb_to_blender(v) for v in verts], [], faces)
    me.update()
    if uvs:
        uv = me.uv_layers.new(name='UVMap')
        for p in me.polygons:
            for li in p.loop_indices:
                uv.data[li].uv = uvs[me.loops[li].vertex_index]
    else:
        uv = me.uv_layers.new(name='UVMap')
        tile = META[M[m].name]['tileMeters']
        for p in me.polygons:
            for li in p.loop_indices:
                v = verts[me.loops[li].vertex_index]
                normal = p.normal
                axis = max(range(3), key=lambda k: abs(normal[k]))
                a, b = ((v[2], v[1]) if axis == 0 else (v[0], v[1]) if axis == 1 else (v[0], v[2]))
                uv.data[li].uv = (a / tile[0], b / tile[1])
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    me.materials.append(M[m])
    return tag(o)


def plane(name, x, y, z, w, h, m, row=None):
    rows = SIGN_ROWS
    uv = [(0, 0), (1, 0), (1, 1), (0, 1)] if row is None else [
        (0, 1 - (row + 1) / rows), (1, 1 - (row + 1) / rows), (1, 1 - row / rows), (0, 1 - row / rows)]
    return mesh(name, [(x - w / 2, y - h / 2, z), (x + w / 2, y - h / 2, z), (x + w / 2, y + h / 2, z), (x - w / 2, y + h / 2, z)],
                [(0, 1, 2, 3)], m, uv)


def cyl(name, a, b, r, m='wood', sides=10):
    va, vb = glb_to_blender(a), glb_to_blender(b)
    d = vb - va
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=r, depth=d.length, location=(va + vb) / 2)
    o = bpy.context.object
    o.name = name
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    o.data.materials.append(M[m])
    return tag(o)


def rod(name, a, b, w, m='wood'):
    return cyl(name, a, b, w, m, 6)


def sign(x, y, z, w, h, row):
    box('sign-solid-backing', (x, y, z - .07), (w + .2, h + .18, .15), 'dark', .016)
    plane('sign-lettering', x, y, z + .012, w, h, 'sign', row)
    for xx in (x - w / 2 - .035, x + w / 2 + .035):
        box('sign-side-frame', (xx, y, z + .04), (.075, h + .18, .075), 'wood')
    for yy in (y - h / 2 - .035, y + h / 2 + .035):
        box('sign-frame', (x, yy, z + .04), (w + .2, .075, .075), 'wood')


def window(x, y, z, w=1.55, h=2.05, ornate=True):
    box('window-recess', (x, y, z - .17), (w + .18, h + .18, .16), 'dark', 0)
    box('window-glass', (x, y, z - .065), (w, h, .025), 'glass', 0)
    for xx in (x - w / 2, x, x + w / 2):
        box('window-stile', (xx, y, z + .01), (.07, h + .13, .13), 'wood', .005)
    for yy in (y - h / 2, y + h / 2, y - h * .16):
        box('window-rail', (x, yy, z + .025), (w + .10, .065, .13), 'wood', .004)
    for k in range(1, 6):
        box('window-thin-upright', (x - w / 2 + w * k / 6, y + h * .19, z + .02), (.027, h * .58, .045), 'wood', 0)
    for k in range(1, 4):
        box('window-lattice-rail', (x, y - h * .11 + h * .15 * k, z + .035), (w, .027, .045), 'wood', 0)
    if ornate:
        for xx in (x - w * .25, x + w * .25):
            for dy in (-.20, .20):
                box('lower-lattice-square', (xx, y - h * .32 + dy, z + .04), (w * .32, .035, .04), 'wood', 0)
            for dx in (-w * .16, w * .16):
                box('lower-lattice-square', (xx + dx, y - h * .32, z + .04), (.035, .43, .04), 'wood', 0)
    box('stone-window-sill', (x, y - h / 2 - .09, z + .04), (w + .32, .15, .30), 'stone', .012)


def shutter_window(x, y, z, w=1.4, h=1.9):
    """Plain shop-house window: folded timber shutters + lintel, no open lattice."""
    box('shutter-window-recess', (x, y, z - .15), (w + .2, h + .2, .14), 'dark', 0)
    box('shutter-window-glass', (x, y, z - .055), (w - .18, h - .18, .025), 'glass', 0)
    for xx in (x - w / 2, x + w / 2):
        box('shutter-window-stile', (xx, y, z + .01), (.075, h + .14, .13), 'wood', .005)
    for yy in (y - h / 2, y + h / 2):
        box('shutter-window-rail', (x, yy, z + .02), (w + .12, .075, .13), 'wood', .004)
    for i, xx in enumerate((x - w * .22, x + w * .16)):
        box('shutter-panel', (xx, y, z - .02), (w * .38, h * .92, .045), 'wood', .006)
    box('shutter-window-sill', (x, y - h / 2 - .09, z + .04), (w + .3, .14, .28), 'stone', .012)


def roof(x, w, d, eave, ridge, z0=0, ornate=True):
    """Continuous curved roof, baseline method. Spans X (facade width); slopes fall toward +/-Z."""
    hw = w / 2 + .4
    mid = z0 - d / 2
    span = d / 2 + .85

    def point(u, t, side):
        xx = hw * u
        curve = (.32 if ornate else .1) * abs(u) ** 8 * t ** 3
        yy = ridge - (ridge - eave + .4) * t + .4 * t ** 6 + curve
        return (x + xx, yy, mid + side * span * t)

    for side in (-1, 1):
        vs = []; uv = []
        nx = 14; ny = 10
        for j in range(ny + 1):
            for i in range(nx + 1):
                u = -1 + 2 * i / nx; t = j / ny
                vs.append(point(u, t, side))
                uv.append(((x + hw * u) / 1.44, span * t / 1.36))
        fs = []
        for j in range(ny):
            for i in range(nx):
                a = j * (nx + 1) + i; b = a + 1; c = b + nx + 1; dd = a + nx + 1
                fs.append((a, dd, c, b) if side == 1 else (a, b, c, dd))
        mesh('continuous-curved-roof', vs, fs, 'roof', uv)
        edge = [point(-1 + 2 * i / nx, 1, side) for i in range(nx + 1)]
        for i in range(nx):
            a, b = edge[i:i + 2]
            mesh('curved-eave-fascia', [a, b, (b[0], b[1] - .15, b[2]), (a[0], a[1] - .15, a[2])], [(0, 1, 2, 3)], 'dark')
        count = int(2 * hw / .24)
        for i in range(count):
            u = -1 + (i + .5) * 2 / count
            p = point(u, 1, side)
            v = []
            for zz in (p[2] - side * .16, p[2] + side * .05):
                for k in range(7):
                    a = k * math.pi / 6
                    v.append((p[0] + .105 * math.cos(a), p[1] + .065 * math.sin(a), zz))
            mesh('tile-lip', v, [(k, k + 1, k + 8, k + 7) for k in range(6)], 'roof')
        for u in (-1, 1):
            pts = [point(u, j / 10, side) for j in range(11)]
            for a, b in zip(pts, pts[1:]):
                rod('sloped-barge-cap', a, b, .085, 'roof')
    cyl('ridge-roll', (x - hw, ridge + .07, mid), (x + hw, ridge + .07, mid), .115, 'roof', 10)
    if ornate:
        for side in (-1, 1):
            for j in range(4):
                a = (x + side * (hw - .32 + j * .11), ridge + .06 + j * j * .012, mid)
                b = (x + side * (hw - .32 + (j + 1) * .11), ridge + .06 + (j + 1) ** 2 * .012, mid)
                rod('ridge-end-rise', a, b, .07, 'roof')
    for sideX in (-1, 1):
        for sideZ in (-1, 1):
            v = [point(sideX, j / 10, sideZ) for j in range(11)]
            v = [(x + sideX * w / 2, p[1] - .12, p[2]) for p in v] + [(x + sideX * w / 2, eave - .25, mid + sideZ * span), (x + sideX * w / 2, eave - .25, mid)]
            mesh('gable-closure', v, [tuple(range(len(v))) if sideX * sideZ < 0 else tuple(reversed(range(len(v))))], 'plaster')


def canopy(x, w, y, z):
    """Single curved tile canopy with visible end brackets (baseline pharmacy method)."""
    nx = 12; ny = 6
    verts = []; uv = []
    for j in range(ny + 1):
        t = j / ny
        for i in range(nx + 1):
            u = -1 + 2 * i / nx
            verts.append((x + u * w / 2, y - .48 * t + .17 * t ** 5 + .18 * abs(u) ** 8 * t * t, z + t * 1.08))
            uv.append(((x + u * w / 2) / 1.44, t * 1.08 / 1.36))
    faces = []
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + nx + 1, a + nx + 2, a + 1))
    mesh('projecting-shop-canopy', verts, faces, 'roof', uv)
    for xx in (x - w * .43, x + w * .43):
        box('canopy-arm', (xx, y - .38, z + .43), (.11, .14, .95), 'wood')
        rod('canopy-diagonal', (xx, y - .90, z + .03), (xx, y - .39, z + .82), .055, 'wood')
    box('canopy-front-trim', (x, y - .40, z + 1.08), (w, .12, .1), 'dark')


def shell(x, w, d, eave, open_front=True, front_z=0.0, brick_base=True, floor_z=0.0):
    """Closed perimeter walls + floors for one unit. Ground floor front is open bays."""
    z = front_z
    box('left-side', (x - w / 2 + .14, eave / 2, z - d / 2), (.28, eave, d), 'plaster', 0, True)
    box('right-side', (x + w / 2 - .14, eave / 2, z - d / 2), (.28, eave, d), 'plaster', 0, True)
    box('back-wall', (x, eave / 2, z - d + .14), (w - .55, eave, .28), 'plaster', 0, True)
    box('shop-floor', (x, .07 + floor_z, z - d / 2), (w, .14, d), 'stone', .005, True)
    box('upper-floor', (x, 3.6, z - d / 2), (w - .56, .22, d - .55), 'wood', 0, True)
    box('rear-interior', (x, 1.65, z - 3.65), (w - .5, 3.15, .20), 'inner', 0, True)
    if brick_base:
        for xx in (x - w / 2 - .01, x + w / 2 + .01):
            box('brick-base', (xx, .52 + floor_z, z - d / 2), (.31, 1.04, d), 'brick', 0)


def downpipe(x_right, eave, z=0.0):
    px = x_right - .36
    cyl('downpipe', (px, .22, z + .29), (px, eave - .4, z + .29), .05, 'iron', 10)
    for yy in (1.2, 3.0, 5.0, 7.0):
        if yy < eave:
            rod('pipe-wall-clip', (px, yy, z + .14), (px, yy, z + .30), .023, 'iron')


def finalize(module_id, out_dir, design):
    """Join by (part, material), triangulate, save .blend, export .glb, write sidecars, reimport check."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    parts = {}
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            parts.setdefault((o.get('part', 'misc'), o.data.materials[0].name), []).append(o)
    for (group, material), items in parts.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in items:
            o.select_set(True)
        bpy.context.view_layer.objects.active = items[0]
        if len(items) > 1:
            bpy.ops.object.join()
        o = bpy.context.object
        o.name = group + '__' + material
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        for p in o.data.polygons:
            p.use_smooth = False
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
        bm.to_mesh(o.data); bm.free()
    for image in bpy.data.images:
        if image.filepath:
            image.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(out / 'model.blend'))
    bpy.ops.export_scene.gltf(filepath=str(out / 'model.glb'), export_format='GLB', export_yup=True,
                              export_apply=True, export_animations=False, export_tangents=True,
                              export_image_format='JPEG', export_jpeg_quality=92,
                              export_cameras=False, export_lights=False)
    before = len([o for o in bpy.context.scene.objects if o.type == 'MESH'])
    tris = 0
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
    bytes_ = (out / 'model.glb').stat().st_size
    (out / 'collision.json').write_text(json.dumps({
        'axis': 'glTF Y-up, facade +Z, front-wall center bottom origin',
        'colliders': COLL,
        'doors': design.get('doors', 'ground-floor front open into shallow interior; rear and sides closed'),
        'notIntegratedOrWalkingTested': True,
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (out / 'materials.json').write_text(json.dumps(META, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (out / 'measurements.json').write_text(json.dumps({
        'moduleId': module_id, 'triangles': tris, 'meshes': before, 'fileBytes': bytes_,
        'sha256': hashlib.sha256((out / 'model.glb').read_bytes()).hexdigest(),
        'design': design, 'units': 'meters', 'surveyed': False,
        'bakedGlobalIllumination': False, 'referencePhotoTexturesUsed': False,
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    # reimport into a separate scene: verify real material/image connections survive export
    original = bpy.context.window.scene
    check = bpy.data.scenes.new('GLB_REIMPORT_CHECK')
    bpy.context.window.scene = check
    bpy.ops.import_scene.gltf(filepath=str(out / 'model.glb'))
    observed = []
    for m in {m for o in check.objects if o.type == 'MESH' for m in o.data.materials}:
        observed.append({'name': m.name, 'imageNodes': [
            {'name': n.image.name, 'size': list(n.image.size), 'colorSpace': n.image.colorspace_settings.name}
            for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image]})
    meshes = len([o for o in check.objects if o.type == 'MESH'])
    (out / 'reimport-check.json').write_text(json.dumps(
        {'imported': True, 'materials': observed, 'meshes': meshes}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    bpy.context.window.scene = original
    print(f'MODULE_READY {module_id} tris={tris} bytes={bytes_}')
    return tris, bytes_
