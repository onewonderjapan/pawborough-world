# wave7-outerkit 外推实测的 Blender 往返：measure-projection.mjs 写出的每个 GLB → 导入 → 按 slot 绑定与 scripts/export-zones.py
# 相同的材质（outerkit-atlas 图集 / outerkit-proc 白图，去顶点色）→ 以 export-zones 相同参数导出 rt-<name>.glb。
# 用法：blender -b -t 4 --python-exit-code 1 -P modules/outer-kit/measure_roundtrip.py -- <workdir> <mode>
import bpy, os, sys, json
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
argv = sys.argv[sys.argv.index('--') + 1:]
MODE = argv[1]
WORK = os.path.join(os.path.abspath(argv[0]), MODE)
ATLAS = os.path.join(ROOT, 'resources', 'textures', 'outer-kit', 'outerkit-atlas.jpg')
plan = json.load(open(os.path.join(WORK, f'plan-{MODE}.json'), encoding='utf-8'))

def slot_material(slot):
    m = bpy.data.materials.new(slot)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Roughness'].default_value = 0.93
    bsdf.inputs['Metallic'].default_value = 0.0
    tex = m.node_tree.nodes.new('ShaderNodeTexImage')
    if slot == 'outerkit-atlas':
        tex.image = bpy.data.images.load(ATLAS, check_existing=True)
        tex.interpolation = 'Linear'
        tex.extension = 'REPEAT'
    else:
        img = bpy.data.images.new('outerkit-proc-white', 4, 4)
        img.pixels = [1.0] * 64
        img.file_format = 'PNG'
        img.pack()
        tex.image = img
        tex.interpolation = 'Closest'
    m.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    return m

for f in plan['files']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(WORK, f))
    mats = {}
    for ob in bpy.data.objects:
        if ob.type != 'MESH' or not ob.get('slot'):
            continue
        slot = str(ob['slot'])
        if slot not in mats:
            mats[slot] = slot_material(slot)
        if ob.data.materials:
            ob.data.materials[0] = mats[slot]
        else:
            ob.data.materials.append(mats[slot])
        for ca in list(ob.data.color_attributes):
            ob.data.color_attributes.remove(ca)
    for ob in bpy.context.view_layer.objects:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(WORK, 'rt-' + f), export_format='GLB', export_extras=True, export_yup=True, use_selection=True)
print('ROUNDTRIP DONE', len(plan['files']), 'files', MODE)
