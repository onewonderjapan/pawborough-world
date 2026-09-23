// 预览 viewer v2：加载 out/scene-areas.glb（服务端 OUT_DIR 决定实际目录）。
// 默认"核心三区"视图（garden/temple/bazaar/pond 合并边界取景）；保留"全域含外围"。
// 标签分层：全域/核心只显示区域级标签；分区视图显示设施名；OSM 注记默认隐藏（调试开关）。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { setupTour } from './tour.js';   // WP13：取景导览逻辑在 web/tour.js
import { dedupeLabels } from './labels.js'; // WP13：标签去重逻辑在 web/labels.js

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe8ec);
const hemi = new THREE.HemisphereLight(0xffffff, 0x9a927e, 1.35);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
sun.position.set(-260, 420, -180);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.5, 4000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const ZONES = {
  core: ['garden', 'temple', 'bazaar', 'pond'],
  all: ['garden', 'temple', 'bazaar', 'pond', 'outer'],
  garden: ['garden'], temple: ['temple'], bazaar: ['bazaar'], pond: ['pond'],
};
// 标签距离阈值（按距离+层级展示）：区域级不限距；设施名 380m；OSM 注记 240m
const LABEL_DIST = { region: Infinity, facility: 300, note: 240 };
// 区域级标签（全域/核心视图只显示这些）
const REGION_LABELS = new Set(['豫园门楼', '城隍庙', '山门', '大殿', '后殿', '和丰楼', '华宝楼', '九曲桥', '湖心亭', '大假山（示意）', '豫园商城', '中心广场']);
// WP13/T2 地标固定高优先级（仅次于区域级，不落入普通设施 12 上限之外）
const LANDMARK_LABELS = new Set(['三穗堂', '老城隍庙', '华宝楼']); // layout 实际文本为「老城隍庙」(poi-temple)
let zoneRoots = [];
let allRoots = [];
let labelsOn = true, roofsOn = true, bgOn = true, osmOn = false, resOn = false;
let layoutData = null;
let tourCtl = null; // WP13：取景导览控制器（web/tour.js）
const labelEls = new Map();
const resMarkers = []; // {el,x,z}

function parseName(name) {
  const parts = String(name).split('|');
  if (parts.length >= 4) return { zone: parts[0], id: parts[1], kind: parts[2], lod: parts[3], roof: parts[4] === 'roofpart' };
  return null;
}
function infoOf(node) {
  for (let n = node; n; n = n.parent) {
    const ud = n.userData || {};
    if (ud.id) return ud;
    const p = parseName(n.name);
    if (p) return { id: p.id, zone: p.zone, kind: p.kind, lod: p.lod, roof: p.roof };
  }
  return null;
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);   // EXT_meshopt_compression (zone .cm.glb)
const RAW = new URLSearchParams(location.search).get('raw') === '1';   // ?raw=1 loads uncompressed zone GLBs for comparison
const t0 = performance.now();
const params = new URLSearchParams(location.search);
function prepare(root) {
  root.traverse(o => {
    if (o.isMesh) {
      o.castShadow = false; o.receiveShadow = false;
      if (o.material && o.material.map === null && o.material.vertexColors === false) o.material.side = THREE.FrontSide;
    }
  });
}
function countTris(root) {
  let t = 0;
  root.traverse(o => { if (o.isMesh && o.geometry) t += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  return t;
}
const zoneLoad = {};   // id -> {bytes, ms, tris, state}
function hud(extra) {
  fetch('/out/assemble-stats.json').then(r => r.json()).then(j => {
    let tris = 0; for (const r of allRoots) tris += countTris(r);
    const zl = Object.entries(zoneLoad).map(([z, v]) => `${z} ${v.state === 'ok' ? (v.bytes / 1e6).toFixed(1) + 'MB ' + (v.ms / 1000).toFixed(1) + 's' : v.state}`).join(' · ');
    document.getElementById('hud').innerHTML =
      `<b>${extra}</b>（${((performance.now() - t0) / 1000).toFixed(1)}s）<br>` +
      `tris ${(tris / 1000).toFixed(0)}k · 场景对象 ${j.sceneObjects} · 实例 ${j.instances}` +
      (zl ? `<br>分区：${zl}` : '');
  }).catch(() => {});
}
function afterFirstPaint() {
  const lm = document.getElementById('loadmsg'); if (lm) lm.remove();
  fetch('/out/layout.json').then(r => r.json()).then(j => { layoutData = j; buildLabels(); });
  setZone(params.get('zone') || 'core');
  setCam(params.get('cam') || 'oblique');
  tourCtl.buildTour();
}
function loadGlb(url) { return new Promise((res, rej) => loader.load(url, g => res(g.scene), undefined, rej)); }
async function loadZones(m) {
  // requested zone first, then manifest order; each zone GLB becomes a group named ZN-<zone> (setZone already understands ZN-)
  const want = (ZONES[params.get('zone') || 'core'] || ZONES.core);
  const order = [...m.order.filter(z => want.includes(z)), ...m.order.filter(z => !want.includes(z))];
  let first = true;
  const files = order.flatMap(z => m.zones.filter(x => x.id === z && x.file));
  for (const e of files) {
    const z = e.id, key = e.part && m.zones.filter(x => x.id === z && x.file).length > 1 ? `${z}#${e.part}` : z;
    zoneLoad[key] = { state: '…' };
    const ts = performance.now();
    try {
      const useCm = e.cm && !RAW;
      const root = await loadGlb('/out/' + (useCm ? e.cm.file : e.file));
      prepare(root);
      const grp = new THREE.Group(); grp.name = 'ZN-' + z; grp.add(root); scene.add(grp);
      allRoots.push(grp);
      zoneLoad[key] = { state: 'ok', bytes: useCm ? e.cm.bytes : e.bytes, ms: performance.now() - ts };
      if (first) { first = false; afterFirstPaint(); } else setZone(curZone, false);
      hud(RAW ? '分区加载（未压缩 ?raw=1）' : '分区加载（meshopt 压缩）');
    } catch (err) { zoneLoad[key] = { state: 'fail' }; console.error('zone load failed', key, err); }
  }
  window.__zonesLoaded = Object.keys(zoneLoad).filter(z => zoneLoad[z].state === 'ok');
  window.__ready = true;
  hud('分区加载完成');
}
fetch('/out/zones-manifest.json').then(r => { if (!r.ok) throw 0; return r.json(); }).then(m => {
  document.getElementById('loadmsg').textContent = `按分区加载 ${m.zones.filter(z => z.file).length} 个 GLB …`;
  loadZones(m);
}).catch(() => {
  // fallback: single-file scene-areas.glb (pre zone-split outputs)
  loadGlb('/out/scene-areas.glb').then(root => {
    prepare(root); scene.add(root);
    allRoots = root.children.length ? root.children : [root];
    afterFirstPaint(); hud('scene-areas.glb 已加载'); window.__ready = true;
  }, e => { document.getElementById('loadmsg').textContent = 'GLB 加载失败: ' + e; });
});

// ---------- zone/cam ----------
const zoneBox = new THREE.Box3();
let zoneMaxY = 0;
function frame(nodes, dirName) {
  zoneBox.makeEmpty();
  const box = new THREE.Box3();
  zoneMaxY = 0;
  for (const n of nodes) {
    box.setFromObject(n);
    if (!box.isEmpty()) { zoneBox.union(box); zoneMaxY = Math.max(zoneMaxY, box.max.y); }
  }
  if (zoneBox.isEmpty()) return;
  const c = zoneBox.getCenter(new THREE.Vector3());
  const s = zoneBox.getSize(new THREE.Vector3());
  const r = Math.max(s.x, s.z) * 0.62 + 20;
  const tall = zoneMaxY > 12 ? 1 : 0;
  if (dirName === 'top') camera.position.set(c.x, r * 2.1 + 40, c.z + 0.5);
  else if (dirName === 'low') camera.position.set(c.x + r * 0.42, 17 + s.y * 1.15 + tall * 26, c.z + r * (0.72 + tall * 0.4));
  else camera.position.set(c.x + r * 0.55, r * 1.05 + 20, c.z + r * 0.95);
  controls.target.copy(dirName === 'top' ? c : new THREE.Vector3(c.x, Math.min(6, s.y * 0.3), c.z));
  controls.update();
}
let curCam = 'oblique';
let curZone = 'core';
function setZone(z, reframe = true) {
  curZone = z;
  if (tourCtl) tourCtl.clear();
  document.querySelectorAll('[data-tour]').forEach(b => b.classList.toggle('active', false));
  document.querySelectorAll('[data-zone]').forEach(b => b.classList.toggle('active', b.dataset.zone === z));
  const zs = ZONES[z] || ZONES.core;
  zoneRoots = allRoots.filter(n => {
    const nm = String(n.name || '');
    if (nm.startsWith('ZN-')) return zs.includes(nm.slice(3));
    const i = infoOf(n);
    return i && zs.includes(i.zone);
  });
  if (!zoneRoots.length) zoneRoots = allRoots;
  if (reframe) frame(zoneRoots, curCam);
  updateLabelVis();
}
function setCam(c) {
  curCam = c;
  if (tourCtl) tourCtl.clear();
  document.querySelectorAll('[data-tour]').forEach(b => b.classList.toggle('active', false));
  document.querySelectorAll('[data-cam]').forEach(b => b.classList.toggle('active', b.dataset.cam === c));
  frame(zoneRoots, c);
}

// ---------- 取景导览（固定机位，明确非行走）——逻辑在 web/tour.js ----------
tourCtl = setupTour({
  camera, controls,
  setZone,
  updateLabelVis,
  setHud: (html) => {
    const hud = document.getElementById('hud');
    if (!hud.dataset.base) hud.dataset.base = hud.innerHTML;
    hud.innerHTML = html;
  },
});

document.getElementById('bar').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.zone) { setZone(b.dataset.zone); restoreHud(); }
  if (b.dataset.cam) { setCam(b.dataset.cam); restoreHud(); }
  if (b.id === 't-labels') { labelsOn = !labelsOn; b.classList.toggle('active', labelsOn); updateLabelVis(); }
  if (b.id === 't-osm') { osmOn = !osmOn; b.classList.toggle('active', osmOn); updateLabelVis(); }
  if (b.id === 't-res') { resOn = !resOn; b.classList.toggle('active', resOn); updateResVis(); }
  if (b.id === 't-roofs') {
    roofsOn = !roofsOn; b.classList.toggle('active', roofsOn);
    scene.traverse(o => { const i = infoOf(o); if (i && (i.roof || o.userData?.roof)) o.visible = roofsOn; });
  }
  if (b.id === 't-bg') {
    bgOn = !bgOn; b.classList.toggle('active', bgOn);
    scene.background = bgOn ? new THREE.Color(0xdfe8ec) : new THREE.Color(0x101418);
    hemi.intensity = bgOn ? 1.35 : 0.7;
  }
});
function restoreHud() {
  const hud = document.getElementById('hud');
  if (hud.dataset.base) { hud.innerHTML = hud.dataset.base; delete hud.dataset.base; }
}

// ---------- 标签（分层+按距离） ----------
function buildLabels() {
  const holder = document.getElementById('labels');
  for (const l of layoutData.labels) {
    const isNote = !!l.note || l.kind === 'osm-note';
    const region = !isNote && REGION_LABELS.has(l.text);
    const el = document.createElement('div');
    el.className = 'lbl' + (isNote ? ' note' : '') + (region ? ' region' : '');
    el.textContent = l.text;
    holder.appendChild(el);
    el.dataset.labelText = l.text;
    const prio = region ? 0 : LANDMARK_LABELS.has(l.text) && !isNote ? 1 : isNote ? 3 : 2;
    labelEls.set(el, { x: l.x, z: l.z, zone: zoneOfLabel(l), note: isNote, region, prio, maxDist: isNote ? LABEL_DIST.note : region || prio === 1 ? LABEL_DIST.region : LABEL_DIST.facility });
  }
  buildResiduals(holder);
  updateLabelVis();
}
function zoneOfLabel(l) {
  if (l.kind === 'garden') return 'garden';
  if (l.kind === 'temple') return 'temple';
  if (l.kind === 'pond') return 'pond';
  if (l.kind === 'osm-note') return 'temple';
  return null;
}
const zsNow = () => ZONES[document.querySelector('[data-zone].active')?.dataset.zone || 'core'];
function updateLabelVis() {
  const z = document.querySelector('[data-zone].active')?.dataset.zone || 'core';
  const overview = z === 'core' || z === 'all';
  const zs = zsNow();
  for (const [el, p] of labelEls) {
    let show = labelsOn;
    if (p.note) show = show && osmOn && zs.includes(p.zone); // OSM 注记：仅调试开关
    else if (overview) show = show && p.region;              // 全域/核心：仅区域级标签
    else show = show && (!p.zone || zs.includes(p.zone));    // 分区：设施名
    el.style.display = show ? 'block' : 'none';
  }
}
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
function drawLabels() {
  if (!layoutData) return;
  const w = innerWidth, h = innerHeight;
  const shown = [];
  for (const [el, p] of labelEls) {
    if (el.style.display === 'none') continue;
    _v.set(p.x, 4, p.z).project(camera);
    if (_v.z > 1) { el.style.visibility = 'hidden'; continue; }
    // 按距离：超出层级阈值的标签不展示
    const dist = camera.position.distanceTo(_w.set(p.x, 4, p.z));
    if (dist > p.maxDist) { el.style.visibility = 'hidden'; continue; }
    el.style.visibility = 'visible';
    const sx = (_v.x * 0.5 + 0.5) * w, sy = (-_v.y * 0.5 + 0.5) * h;
    el.style.left = sx + 'px';
    el.style.top = sy + 'px';
    shown.push({ el, prio: p.prio, x: sx, y: sy, dist });
  }
  // WP13/T2 屏幕空间去重（region > facility > note，设施标签每屏 ≤12）——逻辑在 web/labels.js
  window.__lastLabelDedupe = dedupeLabels(shown, w, h);
  drawResiduals();
}

// ---------- 残差图层（独立调试开关，数据来自 out 目录审计文件，不硬编码） ----------
function buildResiduals(holder) {
  const add = (x, z, text) => {
    const el = document.createElement('div');
    el.className = 'lbl res';
    el.textContent = text;
    el.style.display = 'none';
    holder.appendChild(el);
    resMarkers.push({ el, x, z });
  };
  // 1) 庙区配准残差（unresolved）
  const tr = layoutData.templeRegistration && layoutData.templeRegistration.adopted;
  if (tr && tr.meanResidualM > 0.5) {
    const anchors = layoutData.objects.filter(o => o.kind === 'templeAnchor' && o.geometry && o.geometry.position);
    if (anchors.length) {
      const cx = anchors.reduce((s, o) => s + o.geometry.position[0], 0) / anchors.length;
      const cz = anchors.reduce((s, o) => s + o.geometry.position[1], 0) / anchors.length;
      add(cx, cz, `庙区配准残差 ${tr.name}: 均值${tr.meanResidualM}m/最大${tr.maxResidualM}m (unresolved)`);
    }
  }
  // 2) 通路窄段/源图冲突（clearWidth < 设计宽 的线段，锚在其 layout 对象上）
  fetch('/out/connectivity.json').then(r => { if (!r.ok) throw 0; return r.json(); }).then(conn => {
    for (const route of conn.routes || []) {
      for (const seg of route.segments || []) {
        if (typeof seg.clearWidthM === 'number' && typeof seg.designWidthM === 'number' && seg.clearWidthM < seg.designWidthM) {
          const o = layoutData.objects.find(x => x.id === seg.id);
          const pos = o && (o.geometry.position || (o.geometry.polyline && o.geometry.polyline[Math.floor(o.geometry.polyline.length / 2)]));
          if (pos) add(pos[0], pos[1] ?? pos[2], `${seg.name || seg.id}: 净宽${seg.clearWidthM}m < 设计${seg.designWidthM}m`);
        }
      }
    }
    for (const rc of conn.routeConstraints || []) {
      const pos = rc.geometry && (rc.geometry.position || (rc.geometry.polyline && rc.geometry.polyline[Math.floor(rc.geometry.polyline.length / 2)]));
      if (pos) add(pos[0], pos[1] ?? pos[2], `受限: ${rc.id || rc.reason || 'routeConstraint'}`);
    }
    updateResVis();
  }).catch(() => {});
  // 3) 商业界面 >15m 缺口（弧长中点映射回道路折线）
  fetch('/out/commerce-audit.json').then(r => { if (!r.ok) throw 0; return r.json(); }).then(ca => {
    for (const sf of ca.streetFrontage || []) {
      const road = layoutData.objects.find(x => x.id === `road-${sf.osmWay}`);
      if (!road || !road.geometry.polyline) continue;
      for (const [s, e] of sf.gapsOver15M || []) {
        const p = pointAtArc(road.geometry.polyline, (s + e) / 2);
        if (p) add(p[0], p[1], `${sf.street}: 界面缺口 ~${Math.round(e - s)}m`);
      }
    }
    updateResVis();
  }).catch(() => {});
}
function pointAtArc(pl, s) {
  let acc = 0;
  for (let i = 1; i < pl.length; i++) {
    const L = Math.hypot(pl[i][0] - pl[i - 1][0], pl[i][1] - pl[i - 1][1]);
    if (acc + L >= s) {
      const t = (s - acc) / (L || 1);
      return [pl[i - 1][0] + (pl[i][0] - pl[i - 1][0]) * t, pl[i - 1][1] + (pl[i][1] - pl[i - 1][1]) * t];
    }
    acc += L;
  }
  return pl[pl.length - 1];
}
function updateResVis() {
  for (const m of resMarkers) m.el.style.display = resOn ? 'block' : 'none';
}
function drawResiduals() {
  if (!resOn) return;
  const w = innerWidth, h = innerHeight;
  for (const m of resMarkers) {
    if (m.el.style.display === 'none') continue;
    _v.set(m.x, 5, m.z).project(camera);
    if (_v.z > 1) { m.el.style.visibility = 'hidden'; continue; }
    m.el.style.visibility = 'visible';
    m.el.style.left = ((_v.x * 0.5 + 0.5) * w) + 'px';
    m.el.style.top = ((-_v.y * 0.5 + 0.5) * h) + 'px';
  }
}

// ---------- 点选 ----------
const ray = new THREE.Raycaster();
renderer.domElement.addEventListener('click', (e) => {
  ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  const hits = ray.intersectObjects(scene.children, true);
  for (const hit of hits) {
    const info = infoOf(hit.object);
    if (!info) continue;
    const el = document.getElementById('info');
    el.style.display = 'block';
    el.innerHTML = `<h2>${info.name || info.id}</h2><dl>` +
      `<dt>ID</dt><dd>${info.id || '-'}</dd>` +
      (info.zone ? `<dt>分区</dt><dd>${info.zone}</dd>` : '') +
      (info.kind ? `<dt>类别</dt><dd>${info.kind}</dd>` : '') +
      (info.lod ? `<dt>精度</dt><dd>${info.lod}</dd>` : '') +
      (info.trade ? `<dt>业态候选</dt><dd>${info.trade}</dd>` : '') +
      (info.disposition ? `<dt>处理</dt><dd>${info.disposition}</dd>` : '') +
      (info.inference ? `<dt>推断</dt><dd>${info.inference}</dd>` : '') +
      `</dl>`;
    break;
  }
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); drawLabels(); });

// playwright 钩子
window.__ready = false;
window.__scene = scene;
window.__bigMeshes = () => {
  const list = [];
  scene.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox;
    const s = new THREE.Vector3(); b.getSize(s);
    const c = new THREE.Vector3(); b.getCenter(c);
    if (Math.max(s.x, s.z) > 60 || b.max.y > 30) list.push({ name: o.name, size: [s.x.toFixed(0), s.y.toFixed(0), s.z.toFixed(0)], center: [c.x.toFixed(0), c.y.toFixed(0), c.z.toFixed(0)], maxy: b.max.y.toFixed(0) });
  });
  return list;
};
window.__pixelStats = () => {
  const gl = renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let sum = 0, sum2 = 0; const n = px.length / 4;
  const uniq = new Set();
  for (let i = 0; i < px.length; i += 4) {
    const v = (px[i] + px[i + 1] + px[i + 2]) / 3;
    sum += v; sum2 += v * v;
    if (uniq.size < 5000 && i % 40 === 0) uniq.add((px[i] >> 3) + ',' + (px[i + 1] >> 3) + ',' + (px[i + 2] >> 3));
  }
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), uniq: uniq.size, w, h };
};
window.__goto = (zone, cam) => { setZone(zone); setCam(cam); };
window.__tour = (key) => { tourCtl.setTour(key); return tourCtl.curTour; };
window.__res = (on) => { resOn = !!on; document.getElementById('t-res').classList.toggle('active', resOn); updateResVis(); return resMarkers.length; };
window.__resMarkers = () => resMarkers.map(m => ({ text: m.el.textContent, x: +m.x.toFixed(1), z: +m.z.toFixed(1) }));
window.__labelStats = () => {
  let visible = 0, region = 0, facility = 0, note = 0;
  for (const [el, p] of labelEls) {
    if (el.style.display === 'none' || el.style.visibility === 'hidden') continue;
    visible++;
    if (p.region) region++; else if (p.note) note++; else facility++;
  }
  return { visible, region, facility, note };
};
window.__cam = () => ({ p: camera.position.toArray().map(v => +v.toFixed(1)), t: controls.target.toArray().map(v => +v.toFixed(1)), maxY: +zoneMaxY.toFixed(1) });
window.__viewAt = (p, t) => {
  camera.position.set(p[0], p[1], p[2]);
  controls.target.set(t[0], t[1], t[2]);
  controls.update();
};
window.__osmDebug = (on) => {
  osmOn = !!on;
  document.getElementById('t-osm').classList.toggle('active', osmOn);
  updateLabelVis();
};
window.__streetView = (which) => {
  const pts = window.__fangbang || [[-110, 12], [60, 24]];
  const pick = (t) => {
    const x0 = which === 'east' ? 42 : -102;
    let best = pts[0];
    for (const p of pts) if (Math.abs(p[0] - x0) < Math.abs(best[0] - x0)) best = p;
    return best;
  };
  const a = pick();
  const ahead = which === 'east' ? -55 : 45;
  let target = pts[0];
  for (const p of pts) if (Math.abs(p[0] - ahead) < Math.abs(target[0] - ahead)) target = p;
  const side = which === 'east' ? 1 : -1;
  camera.position.set(a[0], 2.2, a[1] + side * 6.5);
  controls.target.set(target[0], 3.5, target[1] + side * 2);
  controls.update();
};
fetch('/out/layout.json').then(r => r.json()).then(j => {
  const segs = j.objects.filter(o => o.kind === 'road' && o.name === '方浜中路');
  let pts = null;
  for (const s of segs) {
    const near = s.geometry.polyline.filter(p => p[0] > -120 && p[0] < 70);
    if (near.length > 1) { pts = near.sort((a, b) => a[0] - b[0]); break; }
  }
  window.__fangbang = pts || (segs[0] ? segs[0].geometry.polyline : [[-110, 12], [60, 24]]);
});
