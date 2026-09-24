"""Actual 3m swept path on the union of rendered road/plaza surfaces.
A route graph edge alone is never evidence of passage; obstacles are ground footprints.
"""
import os,sys,json,heapq,math,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'.python-deps'))
import numpy as np
import shapely
from shapely.geometry import Polygon,LineString,Point,box
from shapely.ops import unary_union
R=Path(__file__).resolve().parents[1];O=R/os.environ.get('OUT_DIR','out');d=json.loads((O/'layout.json').read_text(encoding='utf-8'))
by={o['id']:o for o in d['objects']};area=box(-300,-280,85,65)
surfaces=[];obstacles=[]
for o in d['objects']:
 g=o['geometry']
 if o.get('skipRender'):continue
 if o['kind']=='road' and g.get('polyline'):surfaces.append(Polygon(g['surfaceFootprint']) if g.get('surfaceFootprint') else LineString(g['polyline']).buffer(g['width']/2,cap_style=2,join_style=2))
 if o['kind']=='plaza':surfaces.append(Polygon(g['footprint']).buffer(0))
 if o['kind'] in ['outerBuilding','bazaarBlock','hall','tower','pavilion','xuan','waterside','watersideGallery','stage'] and g.get('footprint'):
  obstacles.extend(Polygon(fp).buffer(0) for fp in g.get('groundFootprints',[g['footprint']]))
 if o['kind']=='water':obstacles.append(Polygon(g['footprint']).buffer(0))
 if o['kind']=='wall':obstacles.extend(LineString(s).buffer(.18) for s in g.get('segments',[]))
actual=O/'actual-body-projections.json'
if actual.exists():
 projection=json.loads(actual.read_text(encoding='utf-8'))
 expected=hashlib.sha256((O/'scene-areas.glb').read_bytes()).hexdigest()
 if not isinstance(projection,dict) or projection.get('sourceSha256')!=expected:raise RuntimeError('Actual obstacle projection SHA does not match final GLB; regenerate from GLB first')
 for pts in projection['polygons']:
  # Preserve thin walls too: a vertical triangle projects to a line.
  geom=__import__('shapely').geometry.MultiPoint(pts).convex_hull
  obstacles.append(geom.buffer(.015,join_style=2))
walk=unary_union(surfaces).intersection(area).difference(unary_union(obstacles))
free=walk.buffer(-1.51,join_style=2);STEP=.25;x0,z0,x1,z1=area.bounds
nx,nz=int((x1-x0)/STEP)+1,int((z1-z0)/STEP)+1
zs,xs=np.mgrid[0:nz,0:nx];mask=shapely.contains_xy(free,x0+xs*STEP,z0+zs*STEP)
def point(ij):return (x0+ij[1]*STEP,z0+ij[0]*STEP)
def anchor(shape):
 usable=shape.intersection(free)
 if usable.is_empty:raise ValueError('No 3m wide standing area for anchor; walk distance='+str(walk.distance(shape))+' free distance='+str(free.distance(shape)))
 q=(max(usable.geoms,key=lambda g:g.area) if hasattr(usable,'geoms') else usable).representative_point();ix=round((q.x-x0)/STEP);iz=round((q.y-z0)/STEP)
 near=[(z,x) for z in range(max(0,iz-12),min(nz,iz+13)) for x in range(max(0,ix-12),min(nx,ix+13)) if mask[z,x] and shape.covers(Point(point((z,x))))]
 if not near:raise ValueError('No raster anchor inside surface')
 return min(near,key=lambda t:math.dist(point(t),(q.x,q.y)))
def search(start,end):
 pq=[(0,0,start)];scores={start:0};prev={};closed=set()
 while pq:
  _,cost,u=heapq.heappop(pq)
  if u in closed:continue
  if u==end:break
  closed.add(u)
  for dz,dx in [(0,1),(0,-1),(1,0),(-1,0),(1,1),(1,-1),(-1,1),(-1,-1)]:
   v=(u[0]+dz,u[1]+dx)
   if not(0<=v[0]<nz and 0<=v[1]<nx) or not mask[v]:continue
   if dz and dx and (not mask[u[0],v[1]] or not mask[v[0],u[1]]):continue
   c=cost+math.hypot(dx,dz)
   if c<scores.get(v,float('inf')):scores[v]=c;prev[v]=u;heapq.heappush(pq,(c+math.dist(v,end),c,v))
 else:return None
 path=[end]
 while path[-1]!=start:path.append(prev[path[-1]])
 path=list(map(point,reversed(path)))
 # Greedy visibility simplification constrained to exact eroded surface.
 result=[path[0]];i=0
 while i<len(path)-1:
  j=min(i+120,len(path)-1)
  while j>i+1 and not free.covers(LineString([path[i],path[j]])):j-=1
  result.append(path[j]);i=j
 return result
shapes={'main':LineString(by['road-238219462']['geometry']['polyline']).buffer(2).intersection(box(-230,25,-145,46)),
 'gold':Polygon(by['plaza-428199191']['geometry']['footprint']),
 'center':Polygon(by['plaza-428199199']['geometry']['footprint']),
 'jiuqu':Polygon(by['road-428199195']['geometry'].get('footprint',by['road-428199195']['geometry'].get('polyline')))}
# The mapped covered old street must also be traversable end to end, not merely bypassed.
line=by['road-428199190']['geometry']['polyline'];shapes['old-south']=Point(line[0]).buffer(1);shapes['old-north']=Point(line[-1]).buffer(1)
anchors={};errors=[]
for k,s in shapes.items():
 if k!='main' and 'main' in anchors:
  regions=list(free.geoms) if hasattr(free,'geoms') else [free]
  reachable=next((g for g in regions if g.covers(Point(point(anchors['main'])))),None)
  if reachable is not None and s.intersects(reachable):s=s.intersection(reachable)
 try:anchors[k]=anchor(s)
 except ValueError as e:errors.append(k+': '+str(e))
from shapely.ops import nearest_points
parts=list(free.geoms) if hasattr(free,'geoms') else [free]
mainpart=next(g for g in parts if g.covers(Point(point(anchors['main']))))
centerpart=next(g for g in parts if g.covers(Point(point(anchors['center']))))
pa,pb=nearest_points(mainpart,centerpart)
(O/'nav-gap.json').write_text(json.dumps({'main':[pa.x,pa.y],'center':[pb.x,pb.y],'gap':pa.distance(pb),'anchors':{k:point(v) for k,v in anchors.items()}},indent=1),encoding='utf-8')
routes=[]
# 路线稳定性（wave1-huxinting 2026-09-25）：网格 free 对投影输入的字节级变化存在浮点敏感，
# 等价走廊会被无谓重排并连带导览机位翻转。规则：上一份 commercial-route.json 里 pass 的路线，
# 只要其 3m swept ribbon 在当前几何（最新 walk）上仍逐点有效，就原样保留（keptFromPrevious），
# 只有失效的路线才走重新寻优。有效性以当前几何重验为准，与来源 GLB 无关。
prevmap={}
prevfile=O/'commercial-route.json'
if prevfile.exists():
 try:
  prev=json.loads(prevfile.read_text(encoding='utf-8'))
  if prev.get('pass'):
   for r in prev.get('routes',[]):
    if r.get('pass') and r.get('points'):
     ribbon=LineString(r['points']).buffer(1.5,cap_style=2,join_style=2)
     if walk.covers(ribbon):prevmap[(r['from'],r['to'])]=r
 except Exception:prevmap={}
for a,b in [('main','jiuqu'),('main','gold'),('main','center'),('old-south','old-north'),('gold','jiuqu')]:
 if (a,b) in prevmap:
  pr=prevmap[(a,b)]
  routes.append({'from':a,'to':b,'pass':True,'widthM':3,'points':pr['points'],'lengthM':pr.get('lengthM'),
                 'routeSource':'kept-previous (3m swept ribbon revalidated on current geometry)'})
  continue
 pts=search(anchors[a],anchors[b]) if a in anchors and b in anchors else None
 passed=bool(pts) and walk.covers(LineString(pts).buffer(1.5,cap_style=2,join_style=2))
 if not passed:errors.append(a+' -> '+b+': no verified 3m corridor')
 routes.append({'from':a,'to':b,'pass':passed,'widthM':3,'points':pts,'lengthM':round(LineString(pts).length,2) if pts else None})
report={'sourceGlbSha256':expected if actual.exists() else None,'method':'3m swept ribbon on rendered surfaces minus ground footprints/walls/water; 0.25m search, exact polygon swept validation; previous pass routes kept while still sweep-valid on current geometry','pass':not errors,'routes':routes,'errors':errors,'notPhysicsPlaytest':True}
(O/'commercial-route.json').write_text(json.dumps(report,ensure_ascii=False,indent=1)+'\n',encoding='utf-8');print(json.dumps({k:v for k,v in report.items() if k!='routes'},ensure_ascii=False));print([(r['from'],r['to'],r['pass'],r['lengthM']) for r in routes]);sys.exit(bool(errors))
