"""A4 — sidefaces-full Blender evidence: 4 views over the v3-style assembly
(street modules with sideface skins at their wall boxes, Cycles CPU).

Run: blender -b --factory-startup -t 4 -P kit/build_sidefaces_full_scene.py -- \
      --out kit/out/sidefaces-full/renders
"""
import bpy, bmesh, json, math, sys
from pathlib import Path

argv = sys.argv[sys.argv.index('--') + 1:]
class A: pass
import argparse
p = argparse.ArgumentParser()
p.add_argument('--out', type=Path, required=True)
p.add_argument('--samples', type=int, default=16)
args = p.parse_args(argv)

ROOT = Path('/home/baibai/outbox/pawborough-v1-candidate-night-20260918/workspace')
plan = json.loads((ROOT / 'kit/out/sidefaces/plan-full.json').read_text())
mCfg = json.loads((ROOT / 'kit/gable-skin.config.json').read_text())
fullCfg = json.loads((ROOT / 'kit/gable-skin-full.config.json').read_text())

VIEWS = [
  ('junction-west', [-149.4, 4.0, 43.5], [-100.0, 1.6, 20.0]),
  ('west-road-mid', [-110.0, 5.0, 18.0], [-70.0, 1.6, 5.0]),
  ('placeholder-band', [20.0, 6.0, 30.0], [45.0, 1.6, 5.0]),
  ('aerial-overview', [20.0, 55.0, 35.0], [40.0, 0.0, 10.0]),
]
# map view name -> skins shown (representative per A4 spec: junction-west/west-road-mid/placeholder-band/aerial-overview)
SHOW = {
  'junction-west': ['N01-plain-v1'],
  'west-road-mid': ['N02-pharmacy_shop', 'N03-cloth_shop', 'N04-dry_goods_shop'],
  'placeholder-band': ['N05-restaurant-a', 'N06-curio-a', 'N07-cat_corner', 'N08-plain-v2', 'N09-curio-b', 'N10-plain-v3'],
  'aerial-overview': None,  # all
}

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1

def import_glb(path, loc=None, rot=0.0):
    before = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    new = [o for o in scene.objects if o not in before]
    for o in new:
        if o.parent is None or o.parent in before:
            o.rotation_mode = 'XYZ'
            if loc:
                o.location.x += loc[0]; o.location.y += loc[1]; o.location.z += loc[2]
            if rot:
                o.rotation_euler.z += rot
    return new

# street module GLBs + their skins for the places in view
MODULE_GLB = {
    'N01-plain-v1': ROOT/'building/plain-v1/model.glb',
    'N02-pharmacy_shop': ROOT/'building/pharmacy_shop/model.glb',
    'N03-cloth_shop': ROOT/'building/cloth_shop/model.glb',
    'N04-dry_goods_shop': ROOT/'building/dry_goods_shop/model.glb',
    'N05-restaurant-a': ROOT/'building/restaurant-a/model.glb',
    'N06-curio-a': ROOT/'building/curio-a/model.glb',
    'N07-cat_corner': ROOT/'building/cat_corner/model.glb',
    'N08-plain-v2': ROOT/'building/plain-v2/model.glb',
    'N09-curio-b': ROOT/'building/curio-b/model.glb',
    'N10-plain-v3': ROOT/'building/plain-v3/model.glb',
    'S01-corner': ROOT/'building/corner/model.glb',
    'S02-photo_shop': ROOT/'building/photo_shop/model.glb',
    'S03-plain-v2': ROOT/'building/plain-v2/model.glb',
    'S04-restaurant-b': ROOT/'building/restaurant-b/model.glb',
    'S05-plain-v3': ROOT/'building/plain-v3/model.glb',
    'S07-plain-v2': ROOT/'building/plain-v2/model.glb',
}

for target in mCfg['targets']:
    mod = target['module']
    pos = target['placement']['positionGlb']; yaw = target['placement']['rotationYRad']
    if mod in MODULE_GLB and MODULE_GLB[mod].exists():
        import_glb(MODULE_GLB[mod], (pos[0], -pos[2], pos[1]), yaw)
    for f in target['faces']:
        fid = f"{target['module']}-{f['rec']}"
        import_glb(ROOT/'world/street-sidefaces/skins'/f'{fid}.glb')
for target in fullCfg['targets']:
    mod = target['module']
    if mod not in MODULE_GLB:
        continue
    pos = target['placement']['positionGlb']; yaw = target['placement']['rotationYRad']
    if Path(MODULE_GLB[mod]).exists():
        import_glb(MODULE_GLB[mod], (pos[0], -pos[2], pos[1]), yaw)
    import_glb(ROOT/'kit/out/sidefaces-full/skins'/f"{target['faces'][0]['rec']}.glb")

sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun','SUN')); scene.collection.objects.link(sun)
sun.data.energy = 2.8; sun.rotation_euler = (math.radians(55), 0.0, math.radians(-35))
fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill','SUN')); scene.collection.objects.link(fill)
fill.data.energy = 0.9; fill.rotation_euler = (math.radians(35), 0.0, math.radians(145))
w = bpy.data.worlds.new('w'); scene.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.75,0.82,0.88,1)
w.node_tree.nodes['Background'].inputs[1].default_value = 0.6
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam)
scene.camera = cam; cam.data.sensor_fit='VERTICAL'; cam.data.sensor_width=36; cam.data.clip_end=800

scene.render.engine='CYCLES'; scene.cycles.device='CPU'; scene.cycles.samples=args.samples
scene.render.resolution_x=1600; scene.render.resolution_y=900
scene.view_settings.view_transform='AgX'; scene.view_settings.look='AgX - Medium High Contrast'

BLANK=[]
def blank_stats(fp, name):
    img=bpy.data.images.load(str(fp)); px=list(img.pixels); bpy.data.images.remove(img)
    n=len(px)//4; step=max(1,n//20000)
    lum=[0.2126*px[i*4]+0.7152*px[i*4+1]+0.0722*px[i*4+2] for i in range(0,n,step)]
    mean=sum(lum)/len(lum); std=(sum((v-mean)**2 for v in lum)/len(lum))**0.5
    cnt={}
    for v in lum: cnt[round(v*255)]=cnt.get(round(v*255),0)+1
    dom=max(cnt.values())/len(lum)
    blank= std*255<2 or dom>0.95
    BLANK.append({'file':name,'std':round(std*255,2),'dom':round(dom,3),'blank':blank})
    if blank: print('BLANK_FRAME',name)

args.out.mkdir(parents=True, exist_ok=True)
report={'views':[]}
for vid, cx_glb, cz_glb in [(v[0], v[1][0], v[1][2]) for v in VIEWS]:
    pass
for vid, pos_glb, tar_glb in VIEWS:
    loc=(pos_glb[0], -pos_glb[2], 6.0)
    tar=(tar_glb[0], -tar_glb[2], 1.6)
    d=(tar[0]-loc[0], tar[1]-loc[1], tar[2]-loc[2])
    rot_x=math.acos(max(-1,min(1,-d[2]/math.dist(loc,tar))))
    rot_z=math.atan2(d[1],d[0])-math.pi/2
    cam.location=loc; cam.rotation_euler=(rot_x,0,rot_z)
    cam.data.lens=36.0/(2*math.tan(math.radians(55)/2))
    fp=args.out/f'{vid}-pbr.png'
    scene.render.filepath=str(fp)
    bpy.ops.render.render(write_still=True)
    blank_stats(fp, fp.name)
    report['views'].append({'view':vid,'file':fp.name})
    print('RENDERED', vid)

report['blankGuard']={'frames':BLANK,'anyBlank':any(f['blank'] for f in BLANK)}
(args.out/'cameras.json').write_text(json.dumps(report, indent=2)+'\n')
if report['blankGuard']['anyBlank']:
    sys.exit(10)
print(f'SIDEFACES_FULL_SCENE_READY views={len(report["views"])}')
