import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import RAPIER from '@dimforge/rapier3d-compat';
import {loadWorld} from './world/WorldLoader.js';
import {WalkController} from './player/WalkController.js';
import {CruiseDriver} from './player/cruise.js';

const app=document.querySelector('#app'),stats=document.querySelector('#stats'),viewsEl=document.querySelector('#views');
const renderer=new T.WebGLRenderer({antialias:true});renderer.setPixelRatio(1);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.AgXToneMapping;renderer.toneMappingExposure=1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.info.autoReset=false;app.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-label','方浜中路完整三维街景');
const scene=new T.Scene();scene.background=new T.Color(0xdde3df);scene.fog=new T.Fog(0xdde3df,180,380);
const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),env=pmrem.fromScene(room,.04);scene.environment=env.texture;scene.environmentIntensity=.28;room.dispose();pmrem.dispose();
scene.add(new T.HemisphereLight(0xe8f0f5,0xb9b2a1,.72));
const sun=new T.DirectionalLight(0xfff5ea,2.4);sun.position.set(-20,65,48);sun.target.position.set(42,0,4);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-75,right:75,top:60,bottom:-60,near:.5,far:230});sun.shadow.camera.updateProjectionMatrix();sun.shadow.normalBias=.025;sun.shadow.bias=-.0002;sun.shadow.autoUpdate=false;scene.add(sun,sun.target);
const outside=new T.Mesh(new T.PlaneGeometry(600,600),new T.MeshStandardMaterial({color:0xbabdb4,roughness:.98}));outside.rotation.x=-Math.PI/2;outside.position.set(42,-.18,4);outside.receiveShadow=true;scene.add(outside);
const camera=new T.PerspectiveCamera(45,1,.1,600),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.minDistance=.5;controls.maxDistance=220;controls.maxPolarAngle=Math.PI;
const world=new T.Group();world.name='complete-fangbang-world';scene.add(world);
const clay=new T.MeshStandardMaterial({color:0xb8b7ae,roughness:.86});
const labels={'full-west':'全段·西','full-east':'全段·东','eye-west':'沿街·西向东','eye-east':'沿街·东向西',across:'对街北望',corner:'光启路口',lane:'支弄B',catwall:'猫墙',plaza:'玄扈台前空地','corner-close':'路名牌近景','module-near':'店面近景'};
let streetKitNodeCount=0;let ready=false,clayOn=false,selected='full-west',cameras=[],instances=null,manifest=null,lastRender={},loadStats={};
// walking session state (single authority chain: input -> WalkController -> camera follows)
let session=null,controller=null,mode='view',paused=false,cruise=null,lastCruiseStatus=null,resetCount=0;
const keys={w:false,a:false,s:false,d:false};
function resources(){const g=new Set(),m=new Set(),t=new Set();let triangles=0,meshes=0;world.traverse(o=>{if(!o.isMesh)return;meshes++;g.add(o.geometry);triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;for(const mat of [o.material].flat()){m.add(mat);for(const v of Object.values(mat))if(v?.isTexture)t.add(v);}});return{meshes,triangles,uniqueGeometries:g.size,uniqueMaterials:m.size,uniqueTextures:t.size};}
function record(){return{ready,view:selected,mode,paused,resources:resources(),expectedWorldTriangles:manifest?.placedTriangles,streetKitLoaded:streetKitNodeCount>0,streetKitNodeCount,loadMode:'single_assembly_sharing_embedded_images',placedBuildingCount:instances?.instances.length,assets:manifest,load:loadStats,fetches:[],render:lastRender,camera:{position:camera.position.toArray(),target:mode==='view'?controls.target.toArray():controller?.feetPosition()??null,fov:camera.fov,near:camera.near},framebuffer:renderer.getSize(new T.Vector2()).toArray(),lighting:{shadows:renderer.shadowMap.enabled,shadowBias:sun.shadow.bias,shadowNormalBias:sun.shadow.normalBias,toneMapping:'AgX',exposure:1,environmentIntensity:.28,hemisphereIntensity:.72,sunIntensity:2.4,sunPosition:sun.position.toArray()},browserRendered:true,
  walking:{walkingVerified:false,manualKeyboardWalkTested:false,walkResets:resetCount,capsuleFeet:controller?controller.feetPosition():null,eyeHeightM:1.6,capsuleRadiusM:.35,autoPhysicsCruise:lastCruiseStatus},ownerAdopted:false};}
function render(){if(!ready)return;const near=mode==='view'?Math.max(.05,Math.min(2,camera.position.distanceTo(controls.target)*.003)):.1;if(camera.near!==near){camera.near=near;camera.updateProjectionMatrix();}renderer.info.reset();const started=performance.now();renderer.render(scene,camera);lastRender={callsIncludingShadow:renderer.info.render.calls,trianglesIncludingShadow:renderer.info.render.triangles,cpuSubmitMs:performance.now()-started};const r=resources();stats.textContent=mode==='walk'?`行走模式 · 脚底 (${controller.feetPosition().map(v=>v.toFixed(1)).join(', ')}) ${paused?'· 已暂停':''}\nWASD 移动 · 鼠标环视(点击画面锁定) · 空格跳 · P 暂停 · V 返回取景`:`${instances.instances.length} 门面＋完整路面/支弄/前庭 · ${r.triangles.toLocaleString()} 三角形\n几何/材质/纹理 ${r.uniqueGeometries}/${r.uniqueMaterials}/${r.uniqueTextures} · 本机资产 ${(loadStats.bytes/1e6).toFixed(2)} MB\n拖动旋转 · 滚轮缩放 · 右键平移 · 行走模式按钮在上方`;document.querySelector('#record').textContent=JSON.stringify(record(),null,2);}
function setView(id){const v=cameras.find(c=>c.id===id);if(!v)return;selected=id;camera.position.set(...v.positionGlb);controls.target.set(...v.targetGlb);camera.fov=2*Math.atan(v.sensorWidthMm/2/v.lensMm/camera.aspect)*180/Math.PI;camera.updateProjectionMatrix();controls.update();for(const b of viewsEl.querySelectorAll('[data-view]'))b.classList.toggle('on',b.dataset.view===id);render();}
function setupButtons(){for(const c of cameras){const b=document.createElement('button');b.textContent=labels[c.id]??c.id;b.dataset.view=c.id;b.onclick=()=>{if(mode==='walk')setMode('view');setView(c.id);};viewsEl.appendChild(b);}
const walkBtn=document.createElement('button');walkBtn.id='btn-walk';walkBtn.textContent='行走模式';walkBtn.onclick=()=>setMode(mode==='walk'?'view':'walk');viewsEl.appendChild(walkBtn);
const cruiseBtn=document.createElement('button');cruiseBtn.textContent='路线巡游（物理链）';cruiseBtn.onclick=()=>startCruise();viewsEl.appendChild(cruiseBtn);
const c=document.createElement('button');c.textContent='灰模';c.onclick=()=>{clayOn=!clayOn;scene.overrideMaterial=clayOn?clay:null;c.classList.toggle('on',clayOn);sun.shadow.needsUpdate=true;render();};viewsEl.appendChild(c);
const save=document.createElement('button');save.textContent='保存实测图';save.onclick=async()=>{if(!ready)return;render();const image=renderer.domElement.toDataURL('image/jpeg',.94);try{const res=await fetch('/__review-evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:`${mode==='walk'?'walk':selected}-${clayOn?'clay':'pbr'}`,image,record:record()})});if(!res.ok)throw Error(`保存 HTTP ${res.status}`);document.querySelector('#notice').textContent='当前WebGL画面与数据已保存。';}catch(e){document.querySelector('#notice').textContent=e.message;}};viewsEl.appendChild(save);}
async function json(path){const r=await fetch(path);if(!r.ok)throw Error(`${path} HTTP ${r.status}`);return r.json();}
// ---- walk mode ----------------------------------------------------------
function setMode(next){
  if(!ready||!controller||next===mode)return;
  mode=next;paused=false;
  document.querySelector('#btn-walk').classList.toggle('on',mode==='walk');
  controls.enabled=mode==='view';
  if(mode==='walk'){
    // entering walk from view is a switch/reset to a legal spawn, never counted as walked route
    resetController(session.spawn,true);
    camera.fov=45;camera.updateProjectionMatrix();
  }else{
    // back to orbit: anchor the orbit rig where the walker stood
    const eye=controller.eyePosition(),feet=controller.feetPosition();
    camera.position.set(...eye);controls.target.set(...feet);
    const v=cameras.find(c=>c.id===selected);
    if(v){camera.fov=2*Math.atan(v.sensorWidthMm/2/v.lensMm/camera.aspect)*180/Math.PI;}
    camera.updateProjectionMatrix();controls.update();
    if(document.pointerLockElement)document.exitPointerLock();
    keys.w=keys.a=keys.s=keys.d=false;
  }
  sun.shadow.needsUpdate=true;render();
}
function resetController(spawn,countsAsReset){
  controller.body.setTranslation({x:spawn.x,y:spawn.y+controller.centerOffset,z:spawn.z},true);
  controller.vy=0;controller.yaw=-Math.PI/2; // face east (+X) along the street
  controller.pitch=0;controller.clearKeys();controller.resume();cruise=null;
  if(countsAsReset)resetCount++;
}
function startCruise(){
  if(!ready||!controller)return;
  if(mode!=='walk')setMode('walk');else resetController(session.spawn,false);
  cruise=new CruiseDriver({controller,waypoints:session.route.mainStreet});
  notice('巡游中：经由与人工输入相同的物理链向东路过全部路点…');
}
function notice(text){document.querySelector('#notice').textContent=text;}
const KEYMAP={KeyW:'w',KeyA:'a',KeyS:'s',KeyD:'d'};
window.addEventListener('keydown',e=>{
  if(mode!=='walk')return;
  if(e.code==='KeyV'){setMode('view');return;}
  if(e.code==='KeyP'){paused=!paused;if(paused)controller.pause();else controller.resume();notice(paused?'行走已暂停（P 继续）。':'继续行走。');render();return;}
  if(paused)return;
  const k=KEYMAP[e.code];if(k){keys[k]=true;e.preventDefault();}
  if(e.code==='Space'){controller.setJump(true);e.preventDefault();}
});
window.addEventListener('keyup',e=>{const k=KEYMAP[e.code];if(k)keys[k]=false;});
window.addEventListener('blur',()=>{keys.w=keys.a=keys.s=keys.d=false;if(mode==='walk'&&!paused){paused=true;controller.pause();}render();});
renderer.domElement.addEventListener('click',()=>{if(mode==='walk'&&!paused&&document.pointerLockElement!==renderer.domElement)renderer.domElement.requestPointerLock();});
document.addEventListener('mousemove',e=>{if(mode==='walk'&&!paused&&document.pointerLockElement===renderer.domElement)controller.look(e.movementX*.0023,e.movementY*.0023);});
document.addEventListener('pointerlockchange',()=>{if(mode==='walk'&&!paused&&document.pointerLockElement!==renderer.domElement){keys.w=keys.a=keys.s=keys.d=false;}});
// ---- frame loop ----------------------------------------------------------
let lastT=null;
function frame(t){
  requestAnimationFrame(frame);
  if(!ready)return;
  const dt=lastT===null?.016:Math.min(.25,(t-lastT)/1000);lastT=t;
  if(mode==='walk'&&!paused){
    if(cruise){
      if(!cruise.tick(dt)){lastCruiseStatus=cruise.status();notice(lastCruiseStatus.blocked?`巡游受阻于路点 ${lastCruiseStatus.blocked.waypointIndex}。`:`巡游完成：${lastCruiseStatus.reached}/${lastCruiseStatus.total} 路点（自动物理巡游记录，不计人工行走）。`);cruise=null;}
    }else{const f=(keys.w?1:0)-(keys.s?1:0),r=(keys.d?1:0)-(keys.a?1:0);controller.setMoveInput(f,r);}
    controller.step(dt);
  }
  if(mode==='walk'){
    const eye=controller.eyePosition();
    camera.position.set(...eye);
    camera.quaternion.setFromEuler(new T.Euler(controller.pitch,controller.yaw,'YXZ'));
  }
  render();
}
async function load(){const t0=performance.now();
  await RAPIER.init();
  session=await loadWorld({RAPIER,baseUrl:'./'});
  ({cameras}=await json('./world/cameras.json'));
  instances=session.instances;manifest=session.manifest;
  world.add(session.root);
  session.root.traverse(o=>{if(o.name.startsWith('street-kit__'))streetKitNodeCount++;});
  world.traverse(o=>{if(o.isMesh){o.castShadow=![o.material].flat().every(m=>/asphalt|paving/i.test(m.name));o.receiveShadow=true;for(const m of [o.material].flat())for(const v of Object.values(m))if(v?.isTexture)v.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());}});
  world.updateMatrixWorld(true);
  const total=resources().triangles;
  if(total!==manifest.placedTriangles)throw Error(`几何不完整：实际 ${total} / 预期 ${manifest.placedTriangles}`);
  controller=new WalkController({RAPIER,physics:session.physics,capsule:{...session.capsule,spawn:session.spawn}});
  loadStats={bytes:manifest.worldAssembly.bytes,fpsNotMeasured:true,localOnly:true};
  setupButtons();setView('full-west');
  const parsed=performance.now();await renderer.compileAsync(scene,camera);const compiled=performance.now();
  loadStats={...loadStats,allAssetsReadyMs:parsed-t0,shaderCompileMs:compiled-parsed};
  ready=true;sun.shadow.needsUpdate=true;render();
  requestAnimationFrame(frame);
  notice('完整世界已载入 · 取景模式。点「行走模式」落入街面（切换/重置不计路线），「路线巡游」走物理链全段。');}
controls.addEventListener('change',render);new ResizeObserver(()=>{const w=app.clientWidth,h=app.clientHeight,k=Math.min(1,1600/w,900/h);renderer.setSize(Math.round(w*k),Math.round(h*k),false);camera.aspect=w/h;const v=cameras.find(v=>v.id===selected);if(v)camera.fov=2*Math.atan(v.sensorWidthMm/2/v.lensMm/camera.aspect)*180/Math.PI;camera.updateProjectionMatrix();render();}).observe(app);
void load().catch(e=>{stats.textContent='载入失败：'+e.message;notice('未取得完整场景，不计为验证通过。');console.error(e);});
window.addEventListener('pagehide',()=>{controls.dispose();if(controller)controller.dispose();if(session)session.dispose();renderer.dispose();renderer.forceContextLoss();});
