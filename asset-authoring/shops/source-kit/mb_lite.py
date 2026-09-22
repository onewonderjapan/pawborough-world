"""Slim module builder library for the 6-shop base-model batch.

Adapted from pawborough-world-ten-hour-20260921/workspace/building/mb_lib.py
(provenance and SHA in PROVENANCE.md). Trimmed for CLOSED ordinary shop-house
base models: no signage atlas, no open-front interior dressing, no lanterns or
fabric. Kept unchanged: design-coordinate contract (GLB Y-up, facade +Z, depth
-Z, front-wall center bottom origin), material node wiring, box/mesh/cyl
primitives and the finalize() join/triangulate/save/export/reimport pipeline.
Differences from mb_lib.py:
- textures resolved from this source-kit directory (relative, offline rerun)
- palette reduced to the 7 closed-base materials
- box() default bevel=0 (budget policy: bevel only requested hero edges)
Run INSIDE Blender. One module per process: reset_scene() -> build_materials()
-> primitives -> finalize().
"""
import bpy, bmesh, math, json, hashlib, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
from helpers import box_glb, glb_to_blender

TEX = HERE / 'textures'
META = {}
M = {}
COLL = []
GROUP = 'module'
ASSERTIONS = []


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1
    META.clear(); M.clear(); COLL.clear(); ASSERTIONS.clear()
    globals()['GROUP'] = 'module'


def lin(hex):
    a = [int(hex[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in a]


def mat(name, color='ffffff', rough=.8, metal=0, family=None, tile=(1, 1), base=None, normal=None):
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
        t.extension = 'REPEAT'
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
    """Frozen palette for the closed ordinary shop-house family."""
    M['plaster'] = mat('light-lime-plaster', family='PaintedPlaster017', tile=(2.5, 2.5))
    M['brick'] = mat('blue-gray-brick', family='Bricks061', tile=(1.05, 1.20))
    M['wood'] = mat('stained-timber', '542c25', .65, base='wood-stain-color.jpg', normal='Wood092_2K-JPG_NormalGL_1K.jpg', tile=(.75, 1.5))
    M['dark'] = mat('deep-door-lacquer', '252320', .53)
    M['roof'] = mat('gray-pan-tile', base='roof-color.jpg', normal='roof-normal.png', tile=(1.44, 1.36))
    M['stone'] = mat('worn-stone', '9a9a8c', .92)
    M['glass'] = mat('recessed-old-glass', '364347', .28, .12)


def tag(o):
    o['part'] = GROUP
    return o


def box(name, c, s, m='wood', bevel=0, collision=False):
    if bevel > 0 and (max(s) / max(min(s), 1e-4) > 55 or min(s) < .05):
        bevel = 0
    o = tag(box_glb(name, c, s, M[m], META[M[m].name]['tileMeters'], bevel))
    if collision:
        COLL.append({'name': name, 'group': GROUP, 'center': list(c), 'size': list(s), 'type': 'box', 'axis': 'glTF Y-up'})
    return o


def mesh(name, verts, faces, m, uvs=None, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata([glb_to_blender(v) for v in verts], [], faces)
    me.update()
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)); bm.to_mesh(me); bm.free()
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
                axis = max(range(3), key=lambda k: abs(p.normal[k]))
                a, b = ((v[2], v[1]) if axis == 0 else (v[0], v[1]) if axis == 1 else (v[0], v[2]))
                uv.data[li].uv = (a / tile[0], b / tile[1])
    for p in me.polygons:
        p.use_smooth = smooth
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    me.materials.append(M[m])
    return tag(o)


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


def assert_true(name, ok, detail):
    ASSERTIONS.append({'assert': name, 'ok': bool(ok), 'detail': detail})
    if not ok:
        print(f'ASSERT_FAIL {name}: {detail}')
    return ok


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
                              export_image_format='JPEG', export_jpeg_quality=90,
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
        'doors': design.get('doors', 'all doors and windows modeled CLOSED; openings have real recesses with solid leaves'),
        'notIntegratedOrWalkingTested': True,
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (out / 'materials.json').write_text(json.dumps(META, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (out / 'measurements.json').write_text(json.dumps({
        'moduleId': module_id, 'triangles': tris, 'meshes': before, 'fileBytes': bytes_,
        'sha256': hashlib.sha256((out / 'model.glb').read_bytes()).hexdigest(),
        'design': design, 'assertions': ASSERTIONS, 'units': 'meters', 'surveyed': False,
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
