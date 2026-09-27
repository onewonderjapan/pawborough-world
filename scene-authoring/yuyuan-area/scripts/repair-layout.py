"""Preserve source footprints; restore OSM area and building_passage semantics."""
import os,sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'.python-deps'))
from shapely.geometry import Polygon,LineString
from shapely.ops import unary_union,polygonize
R=Path(__file__).resolve().parents[1]; O=R/os.environ.get('OUT_DIR','out')
O.mkdir(exist_ok=True,parents=True)
BASE=R/os.environ.get('BASE_LAYOUT','baseline/layout.json')
d=json.loads(BASE.read_text(encoding='utf-8'))
ov=json.loads((R/'inputs/overpass.json').read_text(encoding='utf-8'))
tags={o['id']:o.get('tags',{}) for o in ov['elements'] if o['type']=='way'}
fixes=[]
for o in d['objects']:
 t=tags.get(o.get('sources',{}).get('osmWay'),{})
 if o['kind'] in ('road','plaza') and t.get('area')=='yes':
  if 'polyline' in o['geometry']:o['geometry']['footprint']=o['geometry'].pop('polyline')
  o['kind']='plaza';o['height']=0.04
  o['confidence']='OSM area=yes pedestrian square, preserved source ID and polygon'
  fixes.append({'id':o['id'],'fix':'pedestrian area restored from OSM area=yes'})
passages=[]
for o in d['objects']:
 if tags.get(o.get('sources',{}).get('osmWay'),{}).get('tunnel')!='building_passage':continue
 line=o['geometry']['polyline'];w=max(3.4,o['geometry']['width']+.4);rects=[]
 for a,b in zip(line,line[1:]):
  dx,dz=b[0]-a[0],b[1]-a[1];L=(dx*dx+dz*dz)**.5;u=(dx/L,dz/L);n=(-u[1],u[0]);e=.5
  rects.append([[a[0]-u[0]*e+n[0]*w/2,a[1]-u[1]*e+n[1]*w/2],[b[0]+u[0]*e+n[0]*w/2,b[1]+u[1]*e+n[1]*w/2],[b[0]+u[0]*e-n[0]*w/2,b[1]+u[1]*e-n[1]*w/2],[a[0]-u[0]*e-n[0]*w/2,a[1]-u[1]*e-n[1]*w/2]])
 cut=unary_union([Polygon(r) for r in rects]);bs=[]
 for b in d['objects']:
  if b['kind'] not in ['bazaarBlock','outerBuilding'] or not b['geometry'].get('footprint'):continue
  poly=Polygon(b['geometry']['footprint']).buffer(0)
  if poly.intersection(cut).area<.1:continue
  remainder=poly.difference(cut);pieces=list(remainder.geoms) if hasattr(remainder,'geoms') else [remainder]
  b['geometry']['groundFootprints']=[list(g.exterior.coords) for g in pieces if g.area>.01]
  b['geometry']['passageHeight']=3.5;b['geometry']['passageRoad']=o['id'];bs.append(b['id'])
 passages.append({'roadId':o['id'],'width':w,'clearHeight':3.5,'polyline':line,'rectangles':rects,'buildingIds':bs,'provenance':'OSM tunnel=building_passage; width/height are design values'})
# Multiple mapped passages can cross one building: subtract their union once.
allcuts=unary_union([Polygon(r) for p in passages for r in p['rectangles']])
for b in d['objects']:
 if 'groundFootprints' not in b['geometry']:continue
 rem=Polygon(b['geometry']['footprint']).buffer(0).difference(allcuts)
 pieces=list(rem.geoms) if hasattr(rem,'geoms') else [rem]
 b['geometry']['groundFootprints']=[list(g.exterior.coords) for g in pieces if g.area>.01]
# Explicit paving polygons seal butt-joint cracks where two source lines meet at an angle.
for o in d['objects']:
 if o['kind']!='road' or o.get('skipRender'):continue
 line=LineString(o['geometry']['polyline'])
 if not line.intersects(__import__('shapely').geometry.box(-300,-280,85,65)):continue
 g=line.buffer(o['geometry']['width']/2,cap_style=3,join_style=2)
 if g.geom_type=='Polygon':o['geometry']['surfaceFootprint']=list(g.exterior.coords)
# wave10-streetfix S3（GOAL 通用规则）：道路 surfaceFootprint 不得覆盖 outerBuilding / bazaarBlock
# footprint（安仁街 road-495101845 等：路面向建筑本体内推进最深 3.16 m，wave8 l2 报告）。对每条已生成
# 路面的道路做 面-建筑接地部分并集 差集；块写 surfaceFootprints（渲染端逐块画），surfaceFootprint 保留
# 最大块供路线/商业检查等旧消费方；全部块为空（整段被建筑吞没）则 skipRender 不再画路面。只改本脚本
# 生成逻辑，不手改 layout 顶点；layout 顶点仍是源，裁剪在渲染输入生成时确定。接地部分用
# groundFootprints（拱廊/骑楼 building_passage 已挖空）——与 check-commercial-route.py 的障碍口径
# 一致，骑楼下的路面保留，老街穿行路线不受影响。
bldcuts=unary_union([Polygon(fp).buffer(0) for b in d['objects'] if b['kind'] in ('outerBuilding','bazaarBlock') and b['geometry'].get('footprint') for fp in b['geometry'].get('groundFootprints',[b['geometry']['footprint']])])
roadclip=[]
for o in d['objects']:
 if o['kind']!='road' or o.get('skipRender') or 'surfaceFootprint' not in o['geometry']:continue
 g=Polygon(o['geometry']['surfaceFootprint']).buffer(0)
 if g.area<=0.05:continue
 rem=g.difference(bldcuts)
 if g.area-rem.area<=0.05:continue   # 与建筑无实际重叠，保持原样
 pieces=sorted((p for p in (rem.geoms if hasattr(rem,'geoms') else [rem]) if p.area>0.05), key=lambda p:-p.area)
 if not pieces:
  o['skipRender']=True
  roadclip.append({'id':o['id'],'name':o.get('name'),'removedM2':round(g.area,1),'note':'surface fully inside building footprints; not rendered'})
  continue
 o['geometry']['surfaceFootprints']=[list(p.exterior.coords) for p in pieces]
 o['geometry']['surfaceFootprint']=list(pieces[0].exterior.coords)
 roadclip.append({'id':o['id'],'name':o.get('name'),'removedM2':round(g.area-sum(p.area for p in pieces),1),'pieces':len(pieces)})
# wave10-streetfix R2（审查必修2）：ribbon 渲染的道路纳入同一裁剪规则。渲染端对没有 surfaceFootprint(s)
# 的道路按 ribbon(polyline,width) 画路面（src/lib.mjs：中心差分方向、平头端 quad strip），R1 的裁剪只
# 覆盖 explicit paving 已生成 surfaceFootprint 的道路，远场两条路仍压楼（road-33683439 8.271 m²、
# road-444342365 21.493 m²，R2 审查按渲染端几何只读复算）。这里用与渲染端完全相同的几何复算 ribbon
# 路面多边形：与建筑接地足迹重叠 > 0.05 m² 的改写成裁后的 surfaceFootprints（渲染端自动改为逐块画），
# surfaceFootprint 保留最大块给旧消费方；无重叠的保持 ribbon 不动，其余道路的渲染不受影响。
# 裁块若带孔（建筑完全落在路面内）拆成无孔多边形（每孔到外环最近顶点对连桥缝后 polygonize），
# 不许只存 exterior 把孔填回去。
def split_holes(p):
 if not p.interiors:return [p]
 ext=list(p.exterior.coords)[:-1]
 lines=[LineString(p.exterior.coords)]+[LineString(r.coords) for r in p.interiors]
 for h in p.interiors:
  best=None
  for hp in list(h.coords)[:-1]:
   for ep in ext:
    d=(hp[0]-ep[0])**2+(hp[1]-ep[1])**2
    if best is None or d<best[0]:best=(d,hp,ep)
  if best[0]>1e-12:lines.append(LineString([best[1],best[2]]))
 return [f for f in polygonize(unary_union(lines)) if f.area>1e-9 and f.intersection(p).area>0.99*f.area]
ribbonclip=[]
for o in d['objects']:
 if o['kind']!='road' or o.get('skipRender') or 'surfaceFootprint' in o['geometry'] or 'surfaceFootprints' in o['geometry']:continue
 line=o['geometry'].get('polyline')
 if not line or len(line)<2:continue
 n=len(line);w=o['geometry']['width'];left=[];right=[]
 for i in range(n):
  a=line[max(0,i-1)];b=line[min(n-1,i+1)]
  dx,dz=b[0]-a[0],b[1]-a[1];L=(dx*dx+dz*dz)**.5 or 1
  nx,nz=-dz/L*w/2,dx/L*w/2
  left.append([line[i][0]+nx,line[i][1]+nz]);right.append([line[i][0]-nx,line[i][1]-nz])
 g=Polygon(left+right[::-1]).buffer(0)
 if g.area<=0.05 or g.intersection(bldcuts).area<=0.05:continue
 rem=g.difference(bldcuts)
 flats=[]
 for p in (rem.geoms if hasattr(rem,'geoms') else [rem]):
  if p.area>0.05:flats.extend(f for f in split_holes(p) if f.area>0.05)
 if not flats:
  o['skipRender']=True
  ribbonclip.append({'id':o['id'],'name':o.get('name'),'removedM2':round(g.area,1),'note':'ribbon surface fully inside building footprints; not rendered'})
  continue
 flats.sort(key=lambda f:-f.area)
 o['geometry']['surfaceFootprints']=[list(f.exterior.coords) for f in flats]
 o['geometry']['surfaceFootprint']=list(flats[0].exterior.coords)
 ribbonclip.append({'id':o['id'],'name':o.get('name'),'removedM2':round(g.area-sum(f.area for f in flats),2),'pieces':len(flats),'source':'ribbon'})
# Preserve all shop units; slide the one blocking the mapped center-square approach
# 1.6m along its row. Adjacent roof envelopes remain separated (>10.2m module span).
import math
inst=next(i for i in d['instances'] if i['id']=='shoprow-p86')
old=inst.get('reviewOriginalPosition',inst['position']);inst['reviewOriginalPosition']=old
new=[old[0]-1.6*math.cos(inst['rotY']),old[1]+1.6*math.sin(inst['rotY'])]
inst['position']=new
for o in d['objects']:
 if o['id']==inst['id']:o['geometry']['position']=new;o['reviewRepair']='1.6m along-row shift to clear mapped center-square approach'
for lab in d['labels']:
 if lab.get('id')==inst['id'] and 'position' in lab:lab['position']=new
d['reviewRepair']={'sourceSemantics':fixes,'passages':passages,'roadClip':roadclip,'ribbonRoadClip':ribbonclip,'sourceFootprintsPreserved':True}
(O/'layout.json').write_text(json.dumps(d,ensure_ascii=False,indent=1)+'\n',encoding='utf-8')
print(json.dumps(d['reviewRepair'],ensure_ascii=False))
