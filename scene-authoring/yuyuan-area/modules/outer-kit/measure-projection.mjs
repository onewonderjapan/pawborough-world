// wave7-outerkit 首载增量外推的独立实测（不改管线、不出 304 栋交付物）：同一套 Node 生成 → Blender 导入导出 → gltfpack 链路，
// 对「全方块」「样板 10 栋换套件」「304 栋全换套件」三组外围楼 GLB 实测 cm 字节，另测每个样板单栋的字节。
// 只含外围 outerBuilding（道路 / 地面等不变量不进文件），所以差值 = 楼本身的字节差。
// 步骤：node modules/outer-kit/measure-projection.mjs <workdir> [mode]   → 写 <workdir>/proj-*.glb + plan.json
//       blender -b -t 4 -P modules/outer-kit/measure_roundtrip.py -- <workdir> <mode>   → <workdir>/<mode>/rt-*.glb（与 export-zones 同导出参数 / 同 slot 材质）
//       node modules/outer-kit/measure-projection.mjs <workdir> [mode] --pack    → gltfpack（与 compress-zones 同参数）+ 汇总 projection.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { shapeGeo, wallRing } from '../../src/lib.mjs';
import { cutPassages } from '../../src/passage-clip.mjs';
import { buildOuterKitGeometry, roadSegments, neighbourRings, SLOT_ATLAS, SLOT_PROC } from '../../src/outer-kit.mjs';

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) { blob.arrayBuffer().then((ab) => { this.result = ab; this.onloadend && this.onloadend({ target: this }); this.onload && this.onload({ target: this }); }); }
  };
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODE = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'tex';
const WORK = path.join(path.resolve(process.argv[2] || 'out-kit-proj'), MODE);   // 每个方案一个子目录
const PACK = process.argv.includes('--pack');
const OUTDIR = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
fs.mkdirSync(WORK, { recursive: true });
const layout = JSON.parse(fs.readFileSync(path.join(OUTDIR, 'layout.json'), 'utf8'));   // 与 build-scene 同一输入
const SAMPLES = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'outer-kit', 'ids.json'), 'utf8')).ids;
const GLTFPACK = process.env.GLTFPACK ?? '/home/baibai/outbox/pawborough-lane-b-night-20260914/artifacts/N4/toolchain/src/build/gltfpack';
const PACK_ARGS = ['-cc', '-kn', '-ke', '-vp', '16', '-vt', '14'];

if (PACK) {
  const plan = JSON.parse(fs.readFileSync(path.join(WORK, `plan-${MODE}.json`), 'utf8'));
  const cm = {};
  for (const f of plan.files) {
    const src = path.join(WORK, 'rt-' + f), dst = src.replace(/\.glb$/, '.cm.glb');
    execFileSync(GLTFPACK, [...PACK_ARGS, '-i', src, '-o', dst], { stdio: 'pipe' });
    cm[f] = { raw: fs.statSync(src).size, cm: fs.statSync(dst).size };
  }
  const d = (a, b) => cm[a].cm - cm[b].cm;
  const perSample = SAMPLES.map(id => ({ id, tris: plan.tris[id], boxTris: plan.boxTris[id],
    kitBytes: d(`one-kit-${id}.glb`, 'ref-kit.glb'), boxBytes: d(`one-box-${id}.glb`, 'ref-box.glb') }));
  for (const s of perSample) s.deltaBytes = s.kitBytes - s.boxBytes;
  const res = {
    mode: MODE, method: 'standalone: same generator → Blender glTF round trip (export-zones settings, slot materials) → gltfpack ' + PACK_ARGS.join(' '),
    files: cm,
    delta10: d('set-s10.glb', 'set-box.glb'), delta304: d('set-all.glb', 'set-box.glb'),
    atlasOnly: d('ref-kit.glb', 'ref-box.glb'),
    kitTris304: plan.kitTris304, boxTris304: plan.boxTris304, kitTris10: plan.kitTris10, boxTris10: plan.boxTris10, buildings: plan.buildings,
    overCap: plan.overCap, degraded: plan.degraded, perSample,
  };
  fs.writeFileSync(path.join(WORK, `projection-${MODE}.json`), JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ mode: MODE, delta10: res.delta10, delta304: res.delta304, atlasOnly: res.atlasOnly, kitTris304: res.kitTris304 }));
  process.exit(0);
}

// ---------- 生成 ----------
const MAT_VERTEX = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, flatShading: true, side: THREE.FrontSide });
const hashStr = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
function colorize(geoIn, hex) {
  const geo = geoIn.index ? geoIn.toNonIndexed() : geoIn;
  const c = new THREE.Color(hex), n = geo.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!geo.attributes.normal) { const nn = new Float32Array(n * 3); for (let i = 0; i < n; i++) nn[i * 3 + 1] = 1; geo.setAttribute('normal', new THREE.BufferAttribute(nn, 3)); }
  for (const k of Object.keys(geo.attributes)) if (!['position', 'color', 'normal'].includes(k)) geo.deleteAttribute(k);
  return geo;
}
function boxGeo(o) {   // = build-scene buildOuterBuilding
  const fp = o.geometry.footprint, h = o.height || 6;
  const base = 0xb4a890 + ((hashStr(o.id) % 5) * 0x040302);
  const walls = wallRing(fp, 0, h, base, 'w'); walls.updateMatrixWorld(true);
  return mergeGeometries([colorize(shapeGeo(fp, 0), 0x9a8f7c), colorize(shapeGeo(fp, h), 0x87806f), colorize(walls.geometry.clone(), base)], false);
}
const passages = layout.reviewRepair?.passages || [];
const roads = roadSegments(layout);
// 与 build-scene 相同的对象集合：外围区 outerBuilding，去掉湖心亭重合占位（HUXINTING 默认开时让位）
const obs = layout.objects.filter(o => o.kind === 'outerBuilding' && o.zone === 'outer' && !o.skipRender && o.id !== 'bld-228035340');
const meshes = {}, tris = {}, boxTris = {};
let overCap = 0, degraded = 0;
for (const o of obs) {
  const ud = { id: o.id, zone: o.zone, kind: o.kind, lod: o.lod, disposition: o.disposition };
  const key = `${o.zone}|${o.id}|${o.kind}|${o.lod}`;
  let bg = boxGeo(o);
  if (passages.length) bg = cutPassages(bg, passages);
  const box = new THREE.Mesh(bg, MAT_VERTEX); box.name = key; box.userData = { ...ud };
  const r = buildOuterKitGeometry(o, { roadSegs: roads, others: neighbourRings(layout, o.id) }, MODE);
  if (r.overCap) overCap++;
  if (r.degrade) degraded++;
  let kg = r.geometry;
  if (passages.length) kg = cutPassages(kg, passages);
  const kud = { ...ud, outerKit: MODE, kitType: r.plan.type, kitTris: r.tris };
  if (MODE !== 'geo') kud.slot = MODE === 'tex' ? SLOT_ATLAS : SLOT_PROC;
  const kit = new THREE.Mesh(kg, MAT_VERTEX); kit.name = key; kit.userData = kud;
  meshes[o.id] = { box, kit };
  tris[o.id] = r.tris; boxTris[o.id] = bg.attributes.position.count / 3;
}
const exporter = new GLTFExporter();
async function write(name, list) {
  const g = new THREE.Group(); g.name = 'ZN-outer';
  for (const m of list) g.add(m.clone());
  const ab = await new Promise((res, rej) => exporter.parse(g, res, rej, { binary: true }));
  fs.writeFileSync(path.join(WORK, name), Buffer.from(ab));
  return name;
}
// 参照件：1 个三角、同材质（tex/proc 带 slot → 往返后带图集 / 白图），用来扣掉单栋文件里的固定开销
function refMesh(slot) {
  const g = colorize(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3)), 0x888888);
  if (slot) { g.deleteAttribute('color'); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2)); }
  const m = new THREE.Mesh(g, MAT_VERTEX); m.name = 'outer|ref|outerBuilding|L0'; m.userData = slot ? { id: 'ref', slot } : { id: 'ref' };
  return m;
}
const files = [];
files.push(await write('set-box.glb', obs.map(o => meshes[o.id].box)));
files.push(await write('set-s10.glb', obs.map(o => (SAMPLES.includes(o.id) ? meshes[o.id].kit : meshes[o.id].box))));
files.push(await write('set-all.glb', obs.map(o => meshes[o.id].kit)));
const slot = MODE === 'geo' ? null : MODE === 'tex' ? SLOT_ATLAS : SLOT_PROC;
files.push(await write('ref-box.glb', [refMesh(null)]));
files.push(await write('ref-kit.glb', [refMesh(slot)]));
for (const id of SAMPLES) {
  files.push(await write(`one-kit-${id}.glb`, [refMesh(slot), meshes[id].kit]));
  files.push(await write(`one-box-${id}.glb`, [refMesh(null), meshes[id].box]));
}
const sum = (ids, t) => ids.reduce((s, id) => s + t[id], 0);
const allIds = obs.map(o => o.id);
fs.writeFileSync(path.join(WORK, `plan-${MODE}.json`), JSON.stringify({ mode: MODE, files, buildings: obs.length, tris, boxTris,
  kitTris304: sum(allIds, tris), boxTris304: sum(allIds, boxTris), kitTris10: sum(SAMPLES, tris), boxTris10: sum(SAMPLES, boxTris), overCap, degraded }, null, 1));
console.log('wrote', files.length, 'files to', WORK, 'mode', MODE, 'buildings', obs.length, 'kit tris', sum(allIds, tris), 'overCap', overCap, 'degraded', degraded);
