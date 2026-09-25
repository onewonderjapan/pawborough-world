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
# 冻结源（2026-09-25 主控）：baseline/commercial-route.pinned.json 钉住锚点与路线。栅格 A* 对远场几何
# 编辑浮点敏感（GEOS union noding 抖一格就可能翻转首段方向，连带导览机位失效），所以：钉住的锚点只要仍在
# 3m 可站立区（free）且仍在本锚点的形状内就原样沿用；钉住的路线只要端点与锚点一致、3m swept ribbon 在当前
# walk 上仍逐点有效就原样沿用；失效者才重新搜索，report 逐条写 anchorSource / routeSource。
# 只依赖仓库里的冻结源，与 OUT_DIR 里上一次的产物无关（全新 OUT_DIR 与增量重建结果一致）。
# 刷新冻结源：PIN_ROUTES_UPDATE=1（主控操作，提交前复验路线与导览机位）。
PIN=R/'baseline'/'commercial-route.pinned.json'
pinned=json.loads(PIN.read_text(encoding='utf-8')) if PIN.exists() else {'anchors':{},'routes':[]}
def grid_near(xy):
 ix=round((xy[0]-x0)/STEP);iz=round((xy[1]-z0)/STEP)
 near=[(z,x) for z in range(max(0,iz-4),min(nz,iz+5)) for x in range(max(0,ix-4),min(nx,ix+5)) if mask[z,x]]
 return min(near,key=lambda t:math.dist(point(t),xy)) if near else None
anchors={};anchor_xy={};anchor_src={};errors=[]
for k,s in shapes.items():
 if k!='main' and 'main' in anchors:
  regions=list(free.geoms) if hasattr(free,'geoms') else [free]
  reachable=next((g for g in regions if g.covers(Point(point(anchors['main'])))),None)
  if reachable is not None and s.intersects(reachable):s=s.intersection(reachable)
 pa_=pinned['anchors'].get(k)
 if pa_ and free.covers(Point(pa_)) and s.buffer(.01).covers(Point(pa_)) and grid_near(pa_) is not None:
  anchors[k]=grid_near(pa_);anchor_xy[k]=list(pa_);anchor_src[k]='pinned';continue
 try:anchors[k]=anchor(s);anchor_xy[k]=list(point(anchors[k]));anchor_src[k]='searched'
 except ValueError as e:errors.append(k+': '+str(e))
from shapely.ops import nearest_points
parts=list(free.geoms) if hasattr(free,'geoms') else [free]
mainpart=next(g for g in parts if g.covers(Point(anchor_xy['main'])))
centerpart=next(g for g in parts if g.covers(Point(anchor_xy['center'])))
pa,pb=nearest_points(mainpart,centerpart)
(O/'nav-gap.json').write_text(json.dumps({'main':[pa.x,pa.y],'center':[pb.x,pb.y],'gap':pa.distance(pb),'anchors':{k:tuple(v) for k,v in anchor_xy.items()},'anchorSource':anchor_src},indent=1),encoding='utf-8')
routes=[]
def ribbon_ok(pts):return bool(pts) and walk.covers(LineString(pts).buffer(1.5,cap_style=2,join_style=2))
pinned_routes={(r['from'],r['to']):r['points'] for r in pinned.get('routes',[])}
for a,b in [('main','jiuqu'),('main','gold'),('main','center'),('old-south','old-north'),('gold','jiuqu')]:
 pp=pinned_routes.get((a,b));src='searched'
 if pp and a in anchor_xy and b in anchor_xy and math.dist(pp[0],anchor_xy[a])<=.01 and math.dist(pp[-1],anchor_xy[b])<=.01 and ribbon_ok(pp):
  pts=[list(q) for q in pp];src='pinned'
 else:
  sa=anchors.get(a);sb=anchors.get(b)
  pts=search(sa,sb) if sa is not None and sb is not None else None
  if pts:pts=[anchor_xy[a]]+[list(q) for q in pts[1:-1]]+[anchor_xy[b]] if free.covers(LineString([anchor_xy[a]]+list(pts[1:-1])+[anchor_xy[b]])) else [list(q) for q in pts]
 passed=ribbon_ok(pts)
 if not passed:errors.append(a+' -> '+b+': no verified 3m corridor')
 routes.append({'from':a,'to':b,'pass':passed,'widthM':3,'points':pts,'lengthM':round(LineString(pts).length,2) if pts else None,'routeSource':src})
report={'sourceGlbSha256':expected if actual.exists() else None,'method':'3m swept ribbon on rendered surfaces minus ground footprints/walls/water; 0.25m search, exact polygon swept validation; pinned anchors/routes (baseline/commercial-route.pinned.json) kept while still valid on current geometry','pinnedSource':str(PIN.relative_to(R)) if PIN.exists() else None,'anchorSource':anchor_src,'pass':not errors,'routes':routes,'errors':errors,'notPhysicsPlaytest':True}
if os.environ.get('PIN_ROUTES_UPDATE')=='1' and not errors:
 PIN.write_text(json.dumps({'note':'Frozen commercial anchors/routes (map x,z). check-commercial-route.py keeps each while still valid on current geometry; refresh with PIN_ROUTES_UPDATE=1 (lead only).','anchors':anchor_xy,'routes':[{'from':r['from'],'to':r['to'],'points':r['points']} for r in routes]},ensure_ascii=False,indent=1)+'\n',encoding='utf-8');print('pinned file updated',PIN)
(O/'commercial-route.json').write_text(json.dumps(report,ensure_ascii=False,indent=1)+'\n',encoding='utf-8');print(json.dumps({k:v for k,v in report.items() if k!='routes'},ensure_ascii=False));print([(r['from'],r['to'],r['pass'],r['lengthM']) for r in routes]);sys.exit(bool(errors))
