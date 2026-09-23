"""One-pass checks on the exported GLB: axis/bounds vs design, passage clear volume, rear closure, texture bindings, normals sanity."""
import json,struct,numpy as np,sys
from pygltflib import GLTF2
g=GLTF2().load('model.glb');blob=g.binary_blob();R={}
def acc(i):
 a=g.accessors[i];bv=g.bufferViews[a.bufferView];off=(bv.byteOffset or 0)+(a.byteOffset or 0)
 comp={5126:('<f4',4),5123:('<u2',2),5125:('<u4',4)}[a.componentType];n={'VEC3':3,'VEC4':4,'SCALAR':1,'VEC2':2}[a.type]
 return np.frombuffer(blob[off:off+a.count*n*comp[1]],dtype=comp[0]).reshape(a.count,n)
P=[];Tr=[];Nn=[]
for node in g.nodes:
 if node.mesh is None:continue
 t=np.array(node.translation or [0,0,0])
 for pr in g.meshes[node.mesh].primitives:
  pos=acc(pr.attributes.POSITION)+t;idx=acc(pr.indices).reshape(-1,3);P.append(pos);Tr.append(pos[idx]);Nn.append(acc(pr.attributes.NORMAL))
P=np.vstack(P);T=np.vstack(Tr);N=np.vstack(Nn)
mn,mx=P.min(0),P.max(0);R['bounds']={'min':mn.round(3).tolist(),'max':mx.round(3).tolist()}
d=json.load(open('measurements.json'))['designDimensions']
R['axisChecks']={'groundAtY0':bool(abs(mn[1])<0.01),'frontEaveBeyondFacade(+Z)':float(mx[2]),'rearExtent(-Z)':float(mn[2]),'symmetricX':bool(abs(mx[0]+mn[0])<0.01),'overallWidthIncludingTips':float(mx[0]-mn[0]),'roofPlanAtEaveDesign':d['roofPlanAtEave'],'topY':float(mx[1]),'designRidge':d['ridgeHeight']}
# passage: no triangle whose AABB lies inside the clear volume, no vertex inside it
cx,cy,cz=(-1.1+.005,1.1-.005),(0.005,3.0-.005),(-2.8+.005,-0.005)
ins=(P[:,0]>cx[0])&(P[:,0]<cx[1])&(P[:,1]>cy[0])&(P[:,1]<cy[1])&(P[:,2]>cz[0])&(P[:,2]<cz[1])
# accepted exception: stepped stone corner brackets in the two top corners of the front reveal (|x|>0.78, y>2.74, z>-0.42)
exc=lambda X:np.zeros(len(X),bool)   # v2: no exception, full 2.2 x 3.0 rectangle must be free
ins&=~exc(P)
tmn=T.min(1);tmx=T.max(1)
tin=(tmn[:,0]>cx[0])&(tmx[:,0]<cx[1])&(tmn[:,1]>cy[0])&(tmx[:,1]<cy[1])&(tmn[:,2]>cz[0])&(tmx[:,2]<cz[1])
tin&=~exc(tmn)
# ray march straight through the centre line: any triangle crossing z at x,y inside clear rect
cross=(tmn[:,2]<-0.05)&(tmx[:,2]>-2.75)&(tmn[:,0]>-1.0)&(tmx[:,0]<1.0)&(tmn[:,1]>0.1)&(tmx[:,1]<2.95)
R['passage']={'exception':'none (v2)','verticesInsideClearVolume':int(ins.sum()),'trianglesInsideClearVolume':int(tin.sum()),'trianglesBlockingCentreCorridor':int(cross.sum()),'clear':bool(ins.sum()==0 and tin.sum()==0 and cross.sum()==0)}
def ray_hits(o,d):
 v0=T[:,0];e1=T[:,1]-v0;e2=T[:,2]-v0;h=np.cross(d,e2);a=np.einsum('ij,ij->i',e1,h);ok=np.abs(a)>1e-9
 f=np.where(ok,1/np.where(ok,a,1),0);sv=o-v0;u=f*np.einsum('ij,ij->i',sv,h);q=np.cross(sv,e1);v=f*np.einsum('j,ij->i',d,q);t=f*np.einsum('ij,ij->i',e2,q)
 hit=ok&(u>=0)&(v>=0)&(u+v<=1)&(t>0.001)&(t<3.5);return int(hit.sum())
rays={}
for x,y in ((0,1.8),(0,2.9),(-0.95,2.65),(0.95,2.65),(-0.95,2.9),(0.95,2.9),(-1.05,2.98),(1.05,2.98),(-1.05,0.2),(1.05,0.2)):
 rays[f'x{x}/y{y}']=ray_hits(np.array([x,y,1.0],dtype=np.float64),np.array([0,0,-1.0]))
R['doorRays(-Z from z=+1 to -2.5, hits=blocked)']=rays
# rear closure: for a grid over the rear face (x in ±3.9, y 0.1..5.2) excluding the doorway, there must be a triangle with z<=-2.5 covering it (AABB test)
grid=[(x,y) for x in np.linspace(-3.9,3.9,40) for y in np.linspace(0.1,5.2,27) if not (abs(x)<1.2 and y<3.1)]
rear=T[(tmx[:,2]<=-2.4)]
rmn=rear.min(1);rmx=rear.max(1);missing=0
for x,y in grid:
 if not np.any((rmn[:,0]<=x)&(rmx[:,0]>=x)&(rmn[:,1]<=y)&(rmx[:,1]>=y)):missing+=1
R['rearClosure']={'gridPoints':len(grid),'uncovered':missing,'closed':missing==0}
# textures
mats=[]
for m in g.materials:
 pbr=m.pbrMetallicRoughness;mats.append({'name':m.name,'baseColorTexture':pbr.baseColorTexture is not None,'baseColorFactor':pbr.baseColorFactor,'normalTexture':m.normalTexture is not None,'metallicRoughnessTexture':pbr.metallicRoughnessTexture is not None})
R['materials']=mats;R['images']=len(g.images);R['primitives']=sum(len(m.primitives) for m in g.meshes)
# normals: unit length and upward share on the roof top ring
ln=np.linalg.norm(N,axis=1);R['normals']={'count':int(len(N)),'unitLength':bool(np.all(np.abs(ln-1)<1e-3)),'nanCount':int(np.isnan(N).sum())}
R['triangles']=int(len(T))
json.dump(R,open('check-report.json','w'),indent=2);print(json.dumps(R,indent=1)[:2500])
