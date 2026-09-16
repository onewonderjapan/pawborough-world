"""Extract sparse, inspectable measurements; does not export teacher vertices."""
import argparse, hashlib, json, sys
from pathlib import Path
import bpy
import numpy as np

p=argparse.ArgumentParser()
p.add_argument('--input', required=True)
p.add_argument('--output', required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
src=Path(a.input)
bpy.ops.wm.open_mainfile(filepath=str(src), use_scripts=False)
obj=bpy.data.objects.get('NeutralKitten_Coat')
if obj is None:
    raise ValueError('This measured example expects NeutralKitten_Coat in the normalized neutral asset')
v=np.array([tuple(obj.matrix_world@x.co) for x in obj.data.vertices])
def stats(points):
    if len(points)<8:
        return {'count':len(points), 'usable':False}
    q=np.quantile(points, [.02,.5,.98], axis=0)
    return {'count':len(points), 'usable':True, 'p02':q[0].tolist(), 'p50':q[1].tolist(), 'p98':q[2].tolist(), 'robust_dimensions':(q[2]-q[0]).tolist()}
x,y,z=v.T
regions={
    'head_including_ears':(y<-.11)&(z>.17),
    'head_without_ear_tips':(y<-.11)&(z>.17)&(z<.278),
    'ribcage_and_pelvis':(y>-.085)&(y<.12)&(z>.085)&(z<.18),
    'fore_paws':(y<-.065)&(z<.025),
    'hind_paws':(y>.035)&(y<.13)&(z<.025),
}
# These are approximate spatial gates, not anatomical part segmentation.
sections=[]
for cy in np.linspace(-.07,.1,9):
    mask=(abs(y-cy)<.008)&(z>.075)&(z<.185)
    sections.append({'y':float(cy), 'half_bandwidth':.008, **stats(v[mask])})
result={'source':str(src), 'sha256':hashlib.sha256(src.read_bytes()).hexdigest(),
        'coordinate_system':'Blender Z up, front -Y, ground Z=0; metres',
        'method':'Sparse quantiles of approximate spatial regions; counts are control vertices, not area-weighted anatomy measurements',
        'limits':'No joint locations inferred here. Ear/tail/mane overlap may affect bins; view renders before using.',
        'bounds':{'min':v.min(axis=0).tolist(),'max':v.max(axis=0).tolist()},
        'regions':{k:stats(v[m]) for k,m in regions.items()}, 'torso_sections':sections,
        'raw_vertices_exported':False}
out=Path(a.output);out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'output':str(out),'regions':result['regions']},ensure_ascii=False))
