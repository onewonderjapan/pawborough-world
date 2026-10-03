"""Local hero finalization: frozen real anchors, true selected-to-active detail
normal baking from a dense source, embedded portable textures and studio views.
The Flash-authored macro sculpture remains the source of food identity.
"""
import bpy, json, math, hashlib, sys, os
from pathlib import Path
from mathutils import Vector
R = Path(__file__).resolve().parents[3]
O = Path('/home/baibai/outbox/pawborough-food-refinement-20261003/hero')
input_file = O/'BASELINE.json'
if not input_file.exists(): input_file=Path(__file__).resolve().parent/'inputs/baseline.json'
INPUT = json.loads(input_file.read_text(encoding='utf-8'))
anchor_file = O/'ANCHORS.json'
if not anchor_file.exists(): anchor_file=Path(__file__).resolve().parent/'inputs/anchors.json'
ANCHORS = json.loads(anchor_file.read_text(encoding='utf-8'))
OUT = O/'final-v2'; OUT.mkdir(parents=True, exist_ok=True)
IDS = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [r['food']['id'] for r in INPUT]

def coords(v): return Vector((v[0],-v[2],v[1]))
def group(fid):
    return 'dough' if fid in ('xiaolongbao','xiajiao','changfen') else 'crisps' if fid in ('congyoubing','roujiamo','portuguese-egg-tart') else 'wet'
def triangles(objs): return sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objs if o.type=='MESH')

def studio(fid, root, meshes):
    sc=bpy.context.scene; sc.render.engine='BLENDER_EEVEE_NEXT'
    sc.render.resolution_x=1024; sc.render.resolution_y=768;sc.render.resolution_percentage=100
    sc.world=bpy.data.worlds.new('studio');sc.world.use_nodes=True
    sc.world.node_tree.nodes['Background'].inputs[0].default_value=(.72,.69,.62,1)
    sc.world.node_tree.nodes['Background'].inputs[1].default_value=.55
    # Hide the alternate bite for previews, keep it in the runtime hierarchy.
    for o in meshes:
        p=o
        while p:
            if p.name.startswith('toolFood'):o.hide_render=True;break
            p=p.parent
    corners=[o.matrix_world@Vector(v) for o in meshes if not o.hide_render for v in o.bound_box]
    lo=Vector(tuple(min(v[i] for v in corners) for i in range(3)));hi=Vector(tuple(max(v[i] for v in corners) for i in range(3)));center=(lo+hi)*.5
    camera=bpy.data.objects.new('studio_camera',bpy.data.cameras.new('camera'));sc.collection.objects.link(camera);camera.data.type='ORTHO';camera.data.ortho_scale=max((hi-lo).length*1.10,.20)
    camera.location=center+Vector((.28,-.38,.32));camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler();sc.camera=camera
    lights=[]
    for name,loc,power,size in [('key',(.2,-.25,.45),3,.28),('fill',(-.3,-.1,.25),1.5,.30)]:
        l=bpy.data.objects.new(name,bpy.data.lights.new(name,'AREA'));l.location=center+Vector(loc);l.rotation_euler=(center-l.location).to_track_quat('-Z','Y').to_euler();l.data.energy=power;l.data.shape='DISK';l.data.size=size;sc.collection.objects.link(l);lights.append(l)
    sc.render.image_settings.file_format='PNG';sc.render.filepath=str(OUT/(fid+'-full.png'));bpy.ops.render.render(write_still=True)
    camera.data.ortho_scale*=.63;sc.render.filepath=str(OUT/(fid+'-detail.png'));bpy.ops.render.render(write_still=True)
    return [camera]+lights

results=[]
for fid in IDS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc=bpy.context.scene;sc.render.threads_mode='FIXED';sc.render.threads=8
    src=O/group(fid)/(fid+'-hero-v1.glb')
    if group(fid)=='dough' and (O/'dough-repair'/(fid+'-hero-v1.glb')).exists():src=O/'dough-repair'/(fid+'-hero-v1.glb')
    bpy.ops.import_scene.gltf(filepath=str(src))
    low=list(sc.objects);meshes=[o for o in low if o.type=='MESH'];root=next((o for o in low if o.name==fid),None)
    assert root is not None,fid
    for name,v in ANCHORS[fid].items():
        o=bpy.data.objects.get(name)
        if o:
            world=o.matrix_world.copy();world.translation=coords(v);o.matrix_world=world
    if fid == 'congyoubing':
        vertices=[o.matrix_world@v.co for o in meshes for v in o.data.vertices]
        lo=Vector(tuple(min(v[i] for v in vertices) for i in range(3)));hi=Vector(tuple(max(v[i] for v in vertices) for i in range(3)))
        ratio=min(1.0, .015*max(hi.x-lo.x,hi.y-lo.y)/.22/(hi.z-lo.z))
        for o in meshes:
            inverse=o.matrix_world.inverted()
            for v in o.data.vertices:
                w=o.matrix_world@v.co;w.z=lo.z+(w.z-lo.z)*ratio;v.co=inverse@w
            o.data.update()
    if fid == 'xiajiao':
        # Keep the continuous folded white wrapper; tuck the distinct shrimp
        # component behind it, rather than letting it spill through the front.
        import bmesh
        for o in meshes:
            slot=next((i for i,m in enumerate(o.data.materials) if 'shrimp_core' in m.name),None)
            if slot is None:continue
            bm=bmesh.new();bm.from_mesh(o.data);selected=set(v for f in bm.faces if f.material_index==slot for v in f.verts)
            while selected:
                seed=selected.pop();component={seed};queue=[seed]
                while queue:
                    v=queue.pop()
                    for edge in v.link_edges:
                        w=edge.other_vert(v)
                        if w in selected:selected.remove(w);component.add(w);queue.append(w)
                center=sum((v.co for v in component),Vector())/len(component)
                for v in component:v.co=center+(v.co-center)*.42
            bm.to_mesh(o.data);bm.free();o.data.update()
        for m in bpy.data.materials:
            if 'crystal_skin' not in m.name:continue
            bs=m.node_tree.nodes.get('Principled BSDF')
            tr=bs.inputs.get('Transmission Weight') or bs.inputs.get('Transmission')
            if tr:tr.default_value=0
            if bs.inputs.get('Coat Weight'):bs.inputs['Coat Weight'].default_value=.15
    if fid in ('xiaolongbao','boboji'):
        food=bpy.data.objects.get('toolFood');tip=bpy.data.objects.get('toolBite')
        def under(o,parent):
            while o:
                if o==parent:return True
                o=o.parent
            return False
        pieces=[o for o in meshes if under(o,food)]
        assert pieces and tip,fid+' bite geometry'
        corners=[o.matrix_world@Vector(v) for o in pieces for v in o.bound_box]
        lo=Vector(tuple(min(v[i] for v in corners) for i in range(3)));hi=Vector(tuple(max(v[i] for v in corners) for i in range(3)));center=(lo+hi)*.5
        scale=min(1.0,.04/max(hi-lo)) if fid=='boboji' else 1.0
        for o in pieces:
            inverse=o.matrix_world.inverted()
            for v in o.data.vertices:v.co=inverse@(tip.matrix_world.translation+(o.matrix_world@v.co-center)*scale)
            o.data.update()
    if fid=='roujiamo':
        for o in meshes:
            slots={i for i,m in enumerate(o.data.materials) if 'roujiamo_bun' in m.name}
            if not slots:continue
            uv=o.data.uv_layers.active
            points=[o.matrix_world@o.data.vertices[o.data.loops[li].vertex_index].co for p in o.data.polygons if p.material_index in slots for li in p.loop_indices]
            lo=Vector(tuple(min(v[i] for v in points) for i in range(3)));hi=Vector(tuple(max(v[i] for v in points) for i in range(3)))
            for poly in o.data.polygons:
                if poly.material_index not in slots:continue
                for li in poly.loop_indices:
                    pos=o.matrix_world@o.data.vertices[o.data.loops[li].vertex_index].co
                    uv.data[li].uv=(.05+.9*(pos.x-lo.x)/(hi.x-lo.x),.05+.9*(pos.y-lo.y)/(hi.y-lo.y))
    if fid=='roujiamo':
        img=bpy.data.images.load(str(R/'asset-authoring/snacks/hero/assets/bread-albedo-v1.webp'));img.name='bread_generated_color';img.colorspace_settings.name='sRGB';img.pack()
        for m in bpy.data.materials:
            if 'roujiamo_bun' not in m.name:continue
            bs=m.node_tree.nodes.get('Principled BSDF');n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=img;m.node_tree.links.new(n.outputs['Color'],bs.inputs['Base Color'])
    # The artist-generated custard color replaces the mechanical star pattern.
    if fid=='portuguese-egg-tart':
        tex=R/'asset-authoring/snacks/hero/assets/custard-albedo-v1.webp'
        img=bpy.data.images.load(str(tex));img.name='custard_generated_color';img.colorspace_settings.name='sRGB';img.pack()
        for m in bpy.data.materials:
            if 'custard' not in m.name:continue
            bs=m.node_tree.nodes.get('Principled BSDF');n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=img;m.node_tree.links.new(n.outputs['Color'],bs.inputs['Base Color'])
    # Dense source retains the authored silhouette; micro surface belongs in maps.
    high_collection=bpy.data.collections.new('HERO_HIGH_DETAIL_SOURCE');sc.collection.children.link(high_collection);highs=[]
    candidates=[o for o in meshes if any(s in o.name.lower() for s in ('edible','rice-piece','bao-piece')) and not any(s in o.name.lower() for s in ('wrapper','skewer'))]
    if not candidates:candidates=[max(meshes,key=lambda o:len(o.data.polygons))]
    for target in candidates:
        hi=target.copy();hi.data=target.data.copy();hi.name='SCULPT_HIGH_'+target.name;high_collection.objects.link(hi)
        sub=hi.modifiers.new('Dense sculpt surface','SUBSURF');sub.subdivision_type='SIMPLE';sub.levels=2;sub.render_levels=2
        texture=bpy.data.textures.new('food_micro_'+fid,type='CLOUDS');texture.noise_scale=.006 if group(fid)=='crisps' else .012;texture.noise_depth=1
        disp=hi.modifiers.new('Fine cooked surface','DISPLACE');disp.texture=texture;disp.strength=.00018 if group(fid)=='crisps' else .00006;disp.mid_level=.5
        highs.append((target,hi))
    target,hi=max(highs,key=lambda pair:len(pair[0].data.polygons))
    # Actual NORMAL bake uses the low object's existing UV and the dense source.
    assert target.data.uv_layers,fid+' missing UV'
    sc.render.engine='CYCLES';sc.cycles.samples=8;sc.cycles.device='CPU'
    image=bpy.data.images.new(fid+'_true_detail_normal',width=512,height=512);image.colorspace_settings.name='Non-Color'
    priority = ('noodle','skin','rice','custard','bun','chicken')
    primary_index=next((i for token in priority for i,m in enumerate(target.data.materials) if token in m.name.lower()),0)
    for i,m in enumerate(target.data.materials):
        if i == primary_index and fid not in ('boboji','luosifen'):
            m=m.copy();target.data.materials[i]=m
        node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=image;m.node_tree.nodes.active=node
    bpy.ops.object.select_all(action='DESELECT');target.select_set(True);hi.select_set(True);bpy.context.view_layer.objects.active=target
    bpy.ops.object.bake(type='NORMAL',use_selected_to_active=True,max_ray_distance=.0015,normal_space='TANGENT',use_clear=True)
    image.filepath_raw=str(OUT/(fid+'-normal.png'));image.file_format='PNG';image.save();image.pack()
    for m in [target.data.materials[primary_index]]:
        bs=m.node_tree.nodes.get('Principled BSDF');tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
        normal=m.node_tree.nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=0 if fid in ('roujiamo','xiajiao') else .12
        m.node_tree.links.new(tex.outputs['Color'],normal.inputs['Color']);m.node_tree.links.new(normal.outputs['Normal'],bs.inputs['Normal'])
    evaluated=bpy.context.evaluated_depsgraph_get();high_count=0
    for _,h in highs:
        e=h.evaluated_get(evaluated);mesh=e.to_mesh();high_count+=sum(len(p.vertices)-2 for p in mesh.polygons);e.to_mesh_clear();h.hide_render=True;h.hide_set(True)
    if fid in ('roujiamo','xiajiao'):
        for m in bpy.data.materials:
            if not ('roujiamo_bun' in m.name or fid=='xiajiao' and 'crystal_skin' in m.name):continue
            bs=m.node_tree.nodes.get('Principled BSDF')
            for key in ('Normal','Roughness'):
                for link in list(bs.inputs[key].links):m.node_tree.links.remove(link)
            bs.inputs['Roughness'].default_value=.58
            if bs.inputs.get('Coat Weight'):bs.inputs['Coat Weight'].default_value=0
            if bs.inputs.get('Specular IOR Level'):bs.inputs['Specular IOR Level'].default_value=.25
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(fid+'-source.blend')))
    studio_objects=studio(fid,root,meshes)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in low:obj.select_set(True)
    bpy.context.view_layer.objects.active=root
    glb=OUT/(fid+'-hero-v2.glb');bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_cameras=False,export_lights=False,export_extras=True)
    results.append({'id':fid,'path':str(glb),'sha256':hashlib.sha256(glb.read_bytes()).hexdigest(),'bytes':glb.stat().st_size,'lowTriangles':triangles(meshes),'highTriangles':high_count,'normalBake':{'operator':'bpy.ops.object.bake NORMAL','selectedToActive':True,'size':512,'rayDistance':.0015,'appliedStrength':0 if fid in ('roujiamo','xiajiao') else .12},'frozenAnchorsRestored':True,'colorSource':'built-in imagegen' if fid in ('portuguese-egg-tart','roujiamo') else 'Flash procedural color maps'})
    print('FINALIZED',fid,results[-1]['bytes'],flush=True)
(OUT/('RECEIPT-'+str(len(IDS))+'.json')).write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
