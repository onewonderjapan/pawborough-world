import bpy,json
from pathlib import Path
R=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(R/'world/scene.blend'))
s=bpy.context.scene;rows=json.loads((R/'world/cameras.json').read_text(encoding='utf-8'))['cameras'];cams=[o for o in s.objects if o.type=='CAMERA'];imgs=[im for im in bpy.data.images if im.source=='FILE'];tri=0
for c in [bpy.data.collections['01_Buildings'],bpy.data.collections['02_Street_And_Props']]:
 for o in c.objects:
  if o.type=='MESH':o.data.calc_loop_triangles();tri+=len(o.data.loop_triangles)
# cameras must still sit exactly on the delivered cameras.json poses (GLB->Blender: y=-z)
cam_err=0.0
for row in rows:
 o=bpy.data.objects.get('Camera_'+row['id'])
 if o is None:cam_err=1e9;continue
 p=o.location
 cam_err=max(cam_err,abs(p.x-row['positionGlb'][0])+abs(p.y+row['positionGlb'][2])+abs(p.z-row['positionGlb'][1]))
mani=json.loads((R/'world/review-manifest.json').read_text(encoding='utf-8'))
report={'opened':True,'worldTriangles':tri,'expectedWorldTriangles':mani['placedTriangles'],'cameraCount':len(cams),'activeCamera':s.camera.name,'packedImages':sum(bool(im.packed_file) for im in imgs),'fileImages':len(imgs),'expectedImages':mani['sceneImages']['count'],'maxCameraPositionError':round(cam_err,6),'collections':[c.name for c in s.collection.children],'engine':s.render.engine,'device':s.cycles.device,'unitScale':s.unit_settings.scale_length}
print('DIAG',json.dumps(report))
assert tri==mani['placedTriangles'] and len(cams)==len(rows)==11 and all(im.packed_file for im in imgs) and len(imgs)==mani['sceneImages']['count'] and cam_err<1e-4
(R.parent/'artifacts/r2/scene-reopen-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('SCENE_REOPEN_PASS',json.dumps(report))
