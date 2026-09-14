import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import RAPIER from '@dimforge/rapier3d-compat';
import {loadWorld} from './world/WorldLoader.js';
import {WalkController} from './player/WalkController.js';
import {applyWalkOrientation} from './player/walkCamera.js';
import {CruiseDriver} from './player/cruise.js';
import {BlockManager} from './world/BlockManager.js';
import {createBlockViews} from './world/blockViews.js';

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
const labels={'full-west':'全段·西','full-east':'全段·东','eye-west':'沿街·西向东','eye-east':'沿街·东向西',across:'对街北望',corner:'光启路口',lane:'支弄B',catwall:'猫墙',plaza:'玄扈台前空地','corner-close':'路名牌近景','module-near':'店面近景','lane-b-axis':'支弄B·门洞轴线','lane-b-inside-return':'支弄B·门后回望','lane-b-detail':'支弄B·门框细节','east-czero':'东端C0·原巡游终点视线','east-cone':'东端C1·两栋四分之三','east-front-a':'东128·正面','east-west-a':'东128·西侧山墙','east-front-b':'东129·正面','east-west-b':'东129·西侧山墙'};
// candidate dataset switch: ?world=laneb loads the N5 derived world,
// ?world=east-edge loads the east-edge shops candidate (block-level replacement);
// &assets=off holds the replacement blocks back so the SAME dataset can show
// its original gray boxes for the C0 same-camera comparison
const WORLD_PARAM = new URLSearchParams(location.search).get('world');
const ASSETS_PARAM = new URLSearchParams(location.search).get('assets');
const WORLD_BASE = WORLD_PARAM === 'laneb' ? './world/laneb/' : WORLD_PARAM === 'east-edge' ? './world/east-edge/' : './world/';
const DATASET_TAG = WORLD_PARAM === 'laneb' ? 'laneb' : WORLD_PARAM === 'east-edge' ? 'east-edge' : 'base';
let streetKitNodeCount=0;let ready=false,clayOn=false,selected='full-west',cameras=[],instances=null,manifest=null,lastRender={},loadStats={};
// R3 honest asset accounting: the base assembly and the enabled refined
// asset blocks are reported separately (bytes and triangles) plus their sum;
// assets=off records which additional assets it did NOT load. Everything is
// derived from the dataset manifest (bytes/sha validated against the real
// files by the contract tests) and cross-checked against the live scene.
let assetStats={enabled:false,infos:[],excludedIds:[],bytesBase:0,bytesAdditional:0,bytesTotal:0,additionalTriangles:0,fingerprint:null};
// walking session state (single authority chain: input -> WalkController -> camera follows)
let session=null,controller=null,mode='view',paused=false,cruise=null,lastCruiseStatus=null,resetCount=0,blocks=null;
// F3 framing-view placeholder preference: false = refined buildings only (the
// default). Walk mode ignores it and always shows placeholders together with
// their collision; returning to view restores it.
let placeholderPref=false;
const keys={w:false,a:false,s:false,d:false};
function resources(){const g=new Set(),m=new Set(),t=new Set();let triangles=0,meshes=0;world.traverse(o=>{if(!o.isMesh)return;meshes++;g.add(o.geometry);triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;for(const mat of [o.material].flat()){m.add(mat);for(const v of Object.values(mat))if(v?.isTexture)t.add(v);}});return{meshes,triangles,uniqueGeometries:g.size,uniqueMaterials:m.size,uniqueTextures:t.size};}
function record(){return{ready,view:selected,mode,paused,resources:resources(),
  // triangle accounting with explicit scope naming: baseAssembly is the
  // single assembly, additionalAssets are the refined replacement GLBs, and
  // total is what the scene actually places when this record was taken
  trianglesExpected:{baseAssembly:manifest?.placedTriangles??null,additionalAssets:assetStats.enabled?assetStats.additionalTriangles:0,total:(manifest?.placedTriangles??0)+(assetStats.enabled?assetStats.additionalTriangles:0),additionalAssetsIncluded:assetStats.enabled,excludedAdditionalAssetIds:assetStats.excludedIds},streetKitLoaded:streetKitNodeCount>0,streetKitNodeCount,loadMode:assetStats.enabled?'single_assembly_plus_refined_asset_blocks':'single_assembly_base_only',placedBuildingCount:instances?.instances.length,assets:manifest,dataset:DATASET_TAG,load:loadStats,fetches:[],render:lastRender,camera:{position:camera.position.toArray(),target:mode==='view'?controls.target.toArray():controller?.feetPosition()??null,fov:camera.fov,near:camera.near,quaternion:camera.quaternion.toArray(),matrixWorldFinite:[...camera.matrixWorld.elements].every(Number.isFinite),walkOrientationFinite:camera.quaternion.toArray().every(Number.isFinite)},framebuffer:renderer.getSize(new T.Vector2()).toArray(),lighting:{shadows:renderer.shadowMap.enabled,shadowBias:sun.shadow.bias,shadowNormalBias:sun.shadow.normalBias,toneMapping:'AgX',exposure:1,environmentIntensity:.28,hemisphereIntensity:.72,sunIntensity:2.4,sunPosition:sun.position.toArray()},browserRendered:true,
  walking:{walkingVerified:false,manualKeyboardWalkTested:false,walkResets:resetCount,capsuleFeet:controller?controller.feetPosition():null,eyeHeightM:1.6,capsuleRadiusM:.35,autoPhysicsCruise:lastCruiseStatus,blocks:blocks?{active:blocks.activeIds(),epoch:blocks.epoch}:null},ownerAdopted:false,
  // F3 placeholder presentation: framing view can hide gray-box placeholders
  // (display only). hiddenPlaceholderIds are real loaded stable IDs currently
  // not rendered; colliders stay untouched, so this is NOT a smaller asset
  // pack and NOT an FPS claim — resources() still counts every placed mesh.
  presentation:{placeholdersVisible:mode==='walk'?true:placeholderPref,viewPreference:placeholderPref,
    hiddenPlaceholderIds:mode==='walk'||placeholderPref||!blocks?[]:blocks.loadedPlaceholderIds(),
    loadedPlaceholderCount:blocks?blocks.loadedPlaceholderIds().length:0,
    placeholderColliders:blocks?blocks.colliderCount():null},
  // dataset/version fingerprint: base assembly GLB sha + each ENABLED
  // additional asset's GLB sha + the on/off state, so assets=on vs off and
  // a changed candidate GLB always produce different records (R3). The old
  // single-string field only hashed the base assembly and could not tell
  // the candidate states apart.
  version:{dataset:DATASET_TAG,baseAssemblyPath:manifest?.worldAssembly?.path??null,baseAssembly:manifest?.worldAssembly?`glb-sha256-${manifest.worldAssembly.sha256}`:null,additionalAssets:assetStats.enabled?assetStats.infos.map(a=>({id:a.id,sha256:a.sha256})):[],additionalAssetsIncluded:assetStats.enabled,excludedAdditionalAssetIds:assetStats.excludedIds,fingerprint:assetStats.fingerprint}};}
function render(){if(!ready)return;const near=mode==='view'?Math.max(.05,Math.min(2,camera.position.distanceTo(controls.target)*.003)):.1;if(camera.near!==near){camera.near=near;camera.updateProjectionMatrix();}renderer.info.reset();const started=performance.now();renderer.render(scene,camera);lastRender={callsIncludingShadow:renderer.info.render.calls,trianglesIncludingShadow:renderer.info.render.triangles,cpuSubmitMs:performance.now()-started};const r=resources();stats.textContent=mode==='walk'?`行走模式 · 脚底 (${controller.feetPosition().map(v=>v.toFixed(1)).join(', ')}) ${paused?'· 已暂停':''}\nWASD 移动 · 鼠标环视(点击画面锁定) · 空格跳 · P 暂停 · V 返回取景`:`${instances.instances.length} 门面＋完整路面/支弄/前庭 · ${r.triangles.toLocaleString()} 三角形\n几何/材质/纹理 ${r.uniqueGeometries}/${r.uniqueMaterials}/${r.uniqueTextures} · 本机资产 ${(loadStats.bytesTotal/1e6).toFixed(2)} MB${assetStats.enabled&&loadStats.bytesAdditional>0?`（基础 ${(loadStats.bytesBase/1e6).toFixed(2)} + 追加精修 ${(loadStats.bytesAdditional/1e6).toFixed(2)}）`:''}\n拖动旋转 · 滚轮缩放 · 右键平移 · 行走模式按钮在上方`;document.querySelector('#record').textContent=JSON.stringify(record(),null,2);}
function setView(id){const v=cameras.find(c=>c.id===id);if(!v)return;selected=id;camera.position.set(...v.positionGlb);controls.target.set(...v.targetGlb);camera.fov=2*Math.atan(v.sensorWidthMm/2/v.lensMm/camera.aspect)*180/Math.PI;camera.updateProjectionMatrix();controls.update();for(const b of viewsEl.querySelectorAll('[data-view]'))b.classList.toggle('on',b.dataset.view===id);render();}
function setupButtons(){for(const c of cameras){const b=document.createElement('button');b.textContent=labels[c.id]??c.id;b.dataset.view=c.id;b.onclick=()=>{if(mode==='walk')setMode('view');setView(c.id);};viewsEl.appendChild(b);}
const walkBtn=document.createElement('button');walkBtn.id='btn-walk';walkBtn.textContent='行走模式';walkBtn.onclick=()=>setMode(mode==='walk'?'view':'walk');viewsEl.appendChild(walkBtn);
const cruiseBtn=document.createElement('button');cruiseBtn.textContent='路线巡游（物理链）';cruiseBtn.onclick=()=>startCruise();viewsEl.appendChild(cruiseBtn);
// F3: framing-view switch for gray-box placeholders. Checked state in walk
// mode is enforced (visible == collision) and the box is disabled there.
const phLabel=document.createElement('label');phLabel.style.cssText='display:inline-flex;align-items:center;gap:4px;padding:5px 9px;border:1px solid #c7c6b9;border-radius:3px;background:#f8f5ed;cursor:pointer;user-select:none';
const phBox=document.createElement('input');phBox.type='checkbox';phBox.id='chk-placeholder';
phBox.onchange=()=>{if(mode!=='view'){phBox.checked=placeholderPref;return;}const prev=placeholderPref;placeholderPref=phBox.checked;try{applyPlaceholderDisplay(placeholderPref);notice(placeholderPref?'取景：显示占位建筑（仅显示切换，碰撞不变）。':'取景：仅显示精修建筑，占位已隐藏（碰撞不变）。');}catch(e){placeholderPref=prev;phBox.checked=prev;notice('占位显示切换失败：'+e.message);}render();};
phLabel.appendChild(phBox);phLabel.appendChild(document.createTextNode('占位建筑'));viewsEl.appendChild(phLabel);
const c=document.createElement('button');c.textContent='灰模';c.onclick=()=>{clayOn=!clayOn;scene.overrideMaterial=clayOn?clay:null;c.classList.toggle('on',clayOn);sun.shadow.needsUpdate=true;render();};viewsEl.appendChild(c);
const save=document.createElement('button');save.textContent='保存实测图';save.onclick=async()=>{if(!ready)return;render();const image=renderer.domElement.toDataURL('image/jpeg',.94);// the name labels the dataset + presentation state: refined-only (-noph) and
// engineering (-ph) shots of the same camera are never confused
const phHidden=mode!=='walk'&&!placeholderPref;try{const res=await fetch('/__review-evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:`${DATASET_TAG}-${mode==='walk'?'walk':selected}-${clayOn?'clay':'pbr'}${phHidden?'-noph':'-ph'}`,image,record:record()})});if(!res.ok)throw Error(`保存 HTTP ${res.status}`);document.querySelector('#notice').textContent='当前WebGL画面与数据已保存。';}catch(e){document.querySelector('#notice').textContent=e.message;}};viewsEl.appendChild(save);}
// F3 display-only application: manager flips loaded placeholder views by their
// stable identity; the static shadow map must be re-rendered afterwards or the
// hidden boxes would leave ghost shadows behind. Never destroys colliders.
function applyPlaceholderDisplay(visible){const applied=blocks.setPlaceholdersVisible(visible);sun.shadow.needsUpdate=true;return applied;}
function syncPlaceholderUi(){const box=document.querySelector('#chk-placeholder');if(!box)return;box.checked=mode==='walk'?true:placeholderPref;box.disabled=mode==='walk';box.parentElement.classList.toggle('on',mode==='walk'||placeholderPref);}
async function json(path){const r=await fetch(path);if(!r.ok)throw Error(`${path} HTTP ${r.status}`);return r.json();}
// ---- walk mode ----------------------------------------------------------
function setMode(next){
  if(!ready||!controller||next===mode)return;
  if(next==='walk'){
    // F3: restore placeholder display/collision consistency BEFORE any
    // movement is enabled — a hidden box must never stand as an invisible
    // wall. On failure stay in view mode paused with the reason; no
    // half-switched state.
    try{applyPlaceholderDisplay(true);}
    catch(e){paused=true;controller.pause();notice('占位显示恢复失败，已保持暂停：'+e.message);render();return;}
  }
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
    // F3: return to the user's framing preference; if applying it somehow
    // fails, fall back to VISIBLE (fail-safe side), never half-hidden
    try{applyPlaceholderDisplay(placeholderPref);}
    catch(e){applyPlaceholderDisplay(true);notice('恢复取景占位偏好失败，已回退为显示占位。');}
    if(document.pointerLockElement)document.exitPointerLock();
    keys.w=keys.a=keys.s=keys.d=false;
  }
  syncPlaceholderUi();
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
  if(mode!=='walk')setMode('walk');
  else{
    // F2-01: clicking cruise starts a NEW run — page pause and controller
    // pause must clear together and leftover key input must drop, or the
    // capsule sits frozen at spawn height until P is pressed again
    paused=false;
    keys.w=keys.a=keys.s=keys.d=false;
    resetController(session.spawn,false);
  }
  cruise=new CruiseDriver({controller,waypoints:session.route.mainStreet});
  notice('巡游中：从合法出生点开始新一轮巡游，经由与人工输入相同的物理链向东路过全部路点…');
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
    applyWalkOrientation(camera,controller.pitch,controller.yaw);
    if(blocks)blocks.update(...controller.feetPosition());
  }
  render();
}
async function load(){const t0=performance.now();
  await RAPIER.init();
  session=await loadWorld({RAPIER,baseUrl:WORLD_BASE,renderer});
  ({cameras}=await json(WORLD_BASE+'cameras.json'));
  instances=session.instances;manifest=session.manifest;
  world.add(session.root);
  session.root.traverse(o=>{if(o.name.startsWith('street-kit__'))streetKitNodeCount++;});
  world.traverse(o=>{if(o.isMesh){o.castShadow=![o.material].flat().every(m=>/asphalt|paving/i.test(m.name));o.receiveShadow=true;for(const m of [o.material].flat())for(const v of Object.values(m))if(v?.isTexture)v.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());}});
  world.updateMatrixWorld(true);
  const total=resources().triangles;
  if(total!==manifest.placedTriangles)throw Error(`几何不完整：实际 ${total} / 预期 ${manifest.placedTriangles}`);
  controller=new WalkController({RAPIER,physics:session.physics,capsule:{...session.capsule,spawn:session.spawn}});
  // blocks dataset is a REQUIRED world input (fetched+validated in loadWorld):
  // a missing/corrupt blocks.json must fail the load loudly, never fall back
  // to a silently block-less scene (R3)
  blocks=new BlockManager({RAPIER,physics:session.physics,views:createBlockViews(scene,session),dataset:session.blocks,
    // a load resumed after pagehide sees session.disposed and releases only
    // GPU resources — never calls into the already-freed Rapier world (R2)
    physicsAlive:()=>!session.disposed});
  await blocks.applyReviewed(); // reviewed street owned by the manager; adjacent blocks cycle in walk mode
  if (ASSETS_PARAM !== 'off') for (const id of blocks.assetBlockIds()) await blocks.applyAssets(id); // refined replacement blocks declared autoApply in the dataset
  if (WORLD_PARAM === 'east-edge') await blocks.loadBlock('block-adjacent-east'); // the C0 comparison frames the street end from view mode: load the east district here too (walk mode still cycles it as before), so gray-box and candidate shots see the same context
  blocks.setPlaceholdersVisible(placeholderPref); // F3 framing default: refined only; any later load follows this preference
  // R3 honest asset accounting from the dataset manifest (bytes/sha are
  // validated against the real files by the contract tests). assets=off
  // records exactly which additional assets it held back; a dataset that
  // declares asset blocks without manifest bytes/sha fails loudly instead
  // of shipping made-up numbers.
  const assetBlocks=session.blocks.blocks.filter(b=>b.kind==='assets'&&b.autoApply);
  const manifestAssets=manifest.eastEdgeAssets?.assets??[];
  const allAssetIds=assetBlocks.flatMap(b=>(b.assets??[]).map(a=>a.id));
  const assetsEnabled=ASSETS_PARAM!=='off';
  const assetInfos=assetsEnabled?assetBlocks.flatMap(b=>b.assets??[]).map(a=>{
    const m=manifestAssets.find(e=>e.id===a.id);
    if(!m)throw Error(`asset ${a.id}: bytes/sha missing from dataset manifest — honest load statistics require them`);
    return {id:a.id,glb:a.glb,bytes:m.bytes,sha256:m.sha256,triangles:m.triangles??0};
  }):[];
  const bytesAdditional=assetInfos.reduce((s,a)=>s+a.bytes,0);
  const additionalTriangles=assetInfos.reduce((s,a)=>s+(a.triangles||0),0);
  const sceneTriangles=resources().triangles;
  if(sceneTriangles!==manifest.placedTriangles+additionalTriangles)throw Error(`资产完整性：实际 ${sceneTriangles} / 预期 ${manifest.placedTriangles+additionalTriangles}（基础 ${manifest.placedTriangles} + 追加 ${additionalTriangles}）`);
  loadStats={bytesBase:manifest.worldAssembly.bytes,bytesAdditional,bytesTotal:manifest.worldAssembly.bytes+bytesAdditional,assetsEnabled,fpsNotMeasured:true,localOnly:true};
  assetStats={enabled:assetsEnabled,infos:assetInfos,excludedIds:assetsEnabled?[]:allAssetIds,bytesBase:loadStats.bytesBase,bytesAdditional,bytesTotal:loadStats.bytesTotal,additionalTriangles,
    fingerprint:[`glb-sha256-${manifest.worldAssembly.sha256}`,...(assetsEnabled?assetInfos.map(a=>`${a.id}:${a.sha256}`):['assets-off'])].join('+')};
  setupButtons();setView('full-west');syncPlaceholderUi();
  const parsed=performance.now();await renderer.compileAsync(scene,camera);const compiled=performance.now();
  loadStats={...loadStats,allAssetsReadyMs:parsed-t0,shaderCompileMs:compiled-parsed};
  ready=true;sun.shadow.needsUpdate=true;render();
  requestAnimationFrame(frame);
  notice('完整世界已载入 · 取景模式。点「行走模式」落入街面（切换/重置不计路线），「路线巡游」走物理链全段。');}
controls.addEventListener('change',render);new ResizeObserver(()=>{const w=app.clientWidth,h=app.clientHeight,k=Math.min(1,1600/w,900/h);renderer.setSize(Math.round(w*k),Math.round(h*k),false);camera.aspect=w/h;const v=cameras.find(v=>v.id===selected);if(v)camera.fov=2*Math.atan(v.sensorWidthMm/2/v.lensMm/camera.aspect)*180/Math.PI;camera.updateProjectionMatrix();render();}).observe(app);
void load().catch(e=>{stats.textContent='载入失败：'+e.message;notice('未取得完整场景，不计为验证通过。');console.error(e);});
window.addEventListener('pagehide',()=>{controls.dispose();if(controller)controller.dispose();if(blocks)blocks.dispose();if(session)session.dispose();renderer.dispose();renderer.forceContextLoss();});
