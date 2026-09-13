"""Read an asset in an isolated Blender process; never save over the asset."""
from pathlib import Path
import argparse,sys,json,hashlib
import bpy
from mathutils import Vector

parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--output',required=True)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);src=Path(args.input).resolve();dst=Path(args.output).resolve()
if src.suffix.lower()=='.blend':bpy.ops.wm.open_mainfile(filepath=str(src),use_scripts=False)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if src.suffix.lower() in ['.glb','.gltf']:bpy.ops.import_scene.gltf(filepath=str(src))
    elif src.suffix.lower()=='.fbx':bpy.ops.import_scene.fbx(filepath=str(src))
    elif src.suffix.lower()=='.obj':bpy.ops.wm.obj_import(filepath=str(src))
    else:raise ValueError('Unsupported asset type')
meshes=[];rigs=[]
custom_shapes={p.custom_shape for arm in bpy.context.scene.objects if arm.type=='ARMATURE' for p in arm.pose.bones if p.custom_shape}
for ob in bpy.context.scene.objects:
    if ob.type=='MESH' and ob not in custom_shapes:
        mesh=ob.data;lengths=[len(p.vertices) for p in mesh.polygons]
        xyz=[ob.matrix_world@Vector(c) for c in ob.bound_box]
        mods=[]
        for mod in ob.modifiers:
            record={'name':mod.name,'type':mod.type,'enabled_viewport':mod.show_viewport}
            if mod.type=='SUBSURF':record.update(view_levels=mod.levels,render_levels=mod.render_levels)
            if mod.type=='ARMATURE':record['armature_object']=mod.object.name if mod.object else None
            mods.append(record)
        meshes.append({'name':ob.name,'mesh_data':mesh.name,'control_vertices':len(mesh.vertices),'control_edges':len(mesh.edges),'control_faces':len(mesh.polygons),'face_types':{'triangles':lengths.count(3),'quads':lengths.count(4),'ngons':sum(n>4 for n in lengths)},'triangulated_faces':sum(n-2 for n in lengths),'bounds_world':{'min':[min(c[i] for c in xyz) for i in range(3)],'max':[max(c[i] for c in xyz) for i in range(3)]},'modifiers':mods,'vertex_groups':[g.name for g in ob.vertex_groups],'shape_keys':list(mesh.shape_keys.key_blocks.keys()) if mesh.shape_keys else [],'materials':[m.name if m else None for m in mesh.materials],'uv_layers':list(mesh.uv_layers.keys()),'hidden_render':ob.hide_render})
    if ob.type=='ARMATURE':
        rigs.append({'name':ob.name,'bones':[{'name':b.name,'parent':b.parent.name if b.parent else None,'deform':b.use_deform,'head':list(b.head_local),'tail':list(b.tail_local)} for b in ob.data.bones]})
images=[]
for im in bpy.data.images:
    path=bpy.path.abspath(im.filepath) if im.filepath else ''
    images.append({'name':im.name,'source':im.source,'size':list(im.size),'packed':bool(im.packed_file),'file':path,'external_exists':Path(path).exists() if path else None})
actions=[{'name':a.name,'frame_range':list(a.frame_range),'slots':[s.identifier for s in a.slots] if hasattr(a,'slots') else []} for a in bpy.data.actions]
report={'source':str(src),'source_sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'blender_version':bpy.app.version_string,'scripts_enabled':False,'inspection':'Object/control-mesh/material/rig metadata only. No aesthetic or animation acceptance implied.','meshes':meshes,'rigs':rigs,'actions':actions,'images':images}
dst.parent.mkdir(parents=True,exist_ok=True);dst.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'source':str(src),'output':str(dst),'mesh_objects':len(meshes),'armatures':len(rigs),'actions':len(actions),'control_vertices':sum(m['control_vertices'] for m in meshes),'control_quads':sum(m['face_types']['quads'] for m in meshes),'control_triangles':sum(m['face_types']['triangles'] for m in meshes)},ensure_ascii=False),flush=True)
