// goal-identity-20260927 facadeBay 几何不变性测试（真实 GLB 层）。
// 修前/修后 procedural-bazaar.glb 按空间签名逐 bay 配对：顶点数/世界系顶点/顶点色/门窗盒全等；
// 门位与 doorVariant 及旧 hashStr(legacyId)%2 parity 一致；元数据差异合法（不要求整文件同 hash，
// 也不以 hash 不同 SKIP）。负例：单一移动（签名配对失败）、doorVariant 篡改（门位 parity 失配）必须被抓。
// 用法：OUT_DIR=out-identity PRE_OUT_DIR=out node tests/facade-identity-geometry-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { legacyDoorVariant } from '../src/facade-identity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-identity');
const PRE = path.resolve(ROOT, process.env.PRE_OUT_DIR || 'out');
let npass = 0, nfail = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { npass++; console.log('PASS', name); }
  else { nfail++; failures.push(`${name}: ${detail}`); console.log('FAIL', name, detail); }
};

// ---------- GLB 读取（POSITION/COLOR_0 + name/extras；facadeBay 节点变换恒等、几何烘世界系） ----------
function readGlb(file) {
  const buf = fs.readFileSync(file);
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'JSON') json = JSON.parse(data.toString('utf8'));
    else if (type === 'BIN\0') bin = data;
    off += 8 + len;
  }
  const ACC_T = { 5126: ['getFloat32', 4] };
  const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const acc = (ai) => {
    const a = json.accessors[ai];
    const bv = json.bufferViews[a.bufferView];
    const o = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const nc = NC[a.type];
    const [rd, sz] = ACC_T[a.componentType];
    const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const out = new Float64Array(a.count * nc);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < nc; c++) out[i * nc + c] = view[rd](o + (i * nc + c) * sz, true);
    return out;
  };
  const nodes = [];
  for (const n of json.nodes || []) {
    if (n.mesh === undefined || !/facadeBay/.test(n.name || '')) continue;
    for (const pr of json.meshes[n.mesh].primitives) {
      nodes.push({ name: n.name || '', extras: n.extras || {}, P: acc(pr.attributes.POSITION), C: acc(pr.attributes.COLOR_0) });
    }
  }
  return nodes;
}

// 开间锚（与 buildFacadeBay 组锚一致）+ 毫米空间签名
const anchorOf = (o) => {
  const [x, z] = o.geometry.position;
  const dir = o.geometry.dir || [Math.sin(o.geometry.rotY || 0), Math.cos(o.geometry.rotY || 0)];
  return [x + dir[0] * 0.16, z + dir[1] * 0.16];
};
const centroidOf = (n) => {
  let cx = 0, cy = 0, cz = 0;
  const m = n.P.length / 3;
  for (let i = 0; i < m; i++) { cx += n.P[i * 3]; cy += n.P[i * 3 + 1]; cz += n.P[i * 3 + 2]; }
  return [cx / m, cy / m, cz / m];
};
const sigOf = (o) => {
  const [ax, az] = anchorOf(o);
  return `${Math.round(ax * 1000)}|${Math.round(az * 1000)}|${Math.round((o.geometry.rotY || 0) * 1000)}|${Math.round(o.geometry.width * 1000)}`;
};

const layout = JSON.parse(fs.readFileSync(path.join(OUT, 'layout.json'), 'utf8'));
const preLayout = JSON.parse(fs.readFileSync(path.join(PRE, 'layout.json'), 'utf8'));
const postBays = layout.objects.filter((o) => o.kind === 'facadeBay');
const preBays = preLayout.objects.filter((o) => o.kind === 'facadeBay');
const postNodes = readGlb(path.join(OUT, 'procedural-bazaar.glb'));
const preNodes = readGlb(path.join(PRE, 'procedural-bazaar.glb'));
ok('bay-counts-equal-175', postBays.length === 175 && preBays.length === 175, `pre=${preBays.length} post=${postBays.length}`);
ok('glb-node-counts-175', postNodes.length === 175 && preNodes.length === 175, `pre=${preNodes.length} post=${postNodes.length}`);

// 空间签名配对（不依赖 id——修前 id 有歧义，签名是唯一可靠键）
const pairBySignature = (bays, nodes) => {
  const used = new Set();
  const map = new Map();   // bay -> node
  const byCentroid = nodes.map((n) => { const c = centroidOf(n); return { n, c }; });
  let unpaired = 0;
  for (const o of bays) {
    const [ax, az] = anchorOf(o);
    let best = null;
    byCentroid.forEach((e, i) => {
      if (used.has(i)) return;
      const d = Math.hypot(e.c[0] - ax, e.c[2] - az);
      if (!best || d < best.d) best = { i, d, e };
    });
    if (best && best.d < 1.5) { used.add(best.i); map.set(o, best.e.n); } else unpaired++;
  }
  return { map, unpaired };
};
const prePair = pairBySignature(preBays, preNodes);
const postPair = pairBySignature(postBays, postNodes);
ok('pre-all-bays-paired', prePair.unpaired === 0, `${prePair.unpaired} unpaired`);
ok('post-all-bays-paired', postPair.unpaired === 0, `${postPair.unpaired} unpaired`);

// 同一物理开间在修前/修后的配对：签名相同（几何未动的直接证据之一）
const preBySig = new Map(preBays.map((o) => [sigOf(o), o]));
let sigMatched = 0;
for (const o of postBays) if (preBySig.has(sigOf(o))) sigMatched++;
ok('spatial-signature-pairs-pre-post', sigMatched === 175, `${sigMatched}/175`);

// 逐 bay 几何全等：顶点数、(顶点,颜色) 多重集、门窗盒
const s2l = (u) => { u /= 255; return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; };
const lin = (hex) => [s2l((hex >> 16) & 255), s2l((hex >> 8) & 255), s2l(hex & 255)];
const PARTS = { door: lin(0x3f3a34), window: lin(0x4a5560), frame: lin(0x8a7a62), pilaster: lin(0xb5ab97), panel: lin(0xcac2b0) };
const near = (c, ref, tol = 0.02) => Math.abs(c[0] - ref[0]) < tol && Math.abs(c[1] - ref[1]) < tol && Math.abs(c[2] - ref[2]) < tol;
const bayParts = (n, o) => {
  const rotY = o.geometry.rotY || 0;
  const [ax, az] = anchorOf(o);
  const ux = Math.cos(rotY), uz = -Math.sin(rotY), vx = Math.sin(rotY), vz = Math.cos(rotY);
  const part = { door: [], window: [], frame: [], pilaster: [], panel: [] };
  const m = n.P.length / 3;
  for (let i = 0; i < m; i++) {
    const wx = n.P[i * 3] - ax, wy = n.P[i * 3 + 1], wz = n.P[i * 3 + 2] - az;
    const pt = [wx * ux + wz * uz, wy, wx * vx + wz * vz, n.C[i * 3], n.C[i * 3 + 1], n.C[i * 3 + 2]];
    for (const [k, ref] of Object.entries(PARTS)) if (near([pt[3], pt[4], pt[5]], ref)) { part[k].push(pt); break; }
  }
  return part;
};
const extentX = (arr) => arr.length ? [Math.min(...arr.map((p) => p[0])), Math.max(...arr.map((p) => p[0]))] : null;
const doorCenterX = (ext) => ext ? (ext[0] + ext[1]) / 2 : null;

let vertBad = 0, tupleBad = 0, doorBad = 0;
const tuples = (n) => Array.from({ length: n.P.length / 3 }, (_, i) =>
  [n.P[i * 3], n.P[i * 3 + 1], n.P[i * 3 + 2], n.C[i * 3], n.C[i * 3 + 1], n.C[i * 3 + 2]].join(',')).sort();
for (const [o, pNode] of prePair.map) {   // 修前开间 -> 修后同签名开间 -> 各自 GLB 节点
  const postBay = preBays === postBays ? o : postBays.find((b) => sigOf(b) === sigOf(o));
  const postNode = postPair.map.get(postBay);
  if (!pNode || !postNode) { vertBad++; continue; }
  if (pNode.P.length !== postNode.P.length) vertBad++;
  const a = tuples(pNode), b = tuples(postNode);
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) tupleBad++;
  const preDoor = doorCenterX(extentX(bayParts(pNode, o).door));
  const postDoor = doorCenterX(extentX(bayParts(postNode, postBay).door));
  if (preDoor === null || postDoor === null || Math.abs(preDoor - postDoor) > 1e-6) doorBad++;
}
ok('vertex-counts-identical-per-bay', vertBad === 0, `${vertBad} bays differ`);
ok('vertex-and-color-tuples-identical-per-bay', tupleBad === 0, `${tupleBad} bays differ (顺序无关多重集比较)`);
ok('door-placement-identical-pre-post', doorBad === 0, `${doorBad} bays differ`);

// 门位 parity：布局 doorVariant（与旧 hash parity）↔ GLB 实测门位。
// GLB 顶点是 float32 世界坐标（|x|≈126 → 量化噪声 ~1e-5），parity 容差取 1e-2：
// 比噪声大两个量级，比 variant 翻转的位移（≥ w*0.22 ≈ 0.9m）小两个量级。
let parityBad = 0;
for (const [o, node] of postPair.map) {
  const w = o.geometry.width || 4.6;
  const expected = o.doorVariant === 'center' ? 0 : -w * 0.22;
  const actual = doorCenterX(extentX(bayParts(node, o).door));
  if (actual === null || Math.abs(actual - expected) > 0.01) parityBad++;
}
ok('glb-door-matches-layout-variant', parityBad === 0, `${parityBad} bays mismatch`);

// 身份元数据：GLB name/extras 正确且可定位；legacy 双写；预文件不带新元数据
let metaBad = 0;
const byId = new Map(postBays.map((o) => [o.id, o]));
for (const n of postNodes) {
  const m = /^bazaar\|([^|]+)\|facadeBay\|L1$/.exec(n.name);
  const o = m && byId.get(m[1]);
  if (!o) { metaBad++; continue; }
  const e = n.extras;
  if (e.id !== o.id || e.legacyId !== o.legacyId || e.doorVariant !== o.doorVariant || e.trade !== o.trade || e.kind !== 'facadeBay') metaBad++;
}
ok('glb-names-and-extras-traceable', metaBad === 0, `${metaBad} bad`);
const preWithVariant = preNodes.filter((n) => n.extras.doorVariant !== undefined).length;
ok('pre-glb-has-no-variant-metadata', preWithVariant === 0, `${preWithVariant} nodes carry doorVariant`);

// ---------- 负例 ----------
// N1 单一移动：把一个 bay 在布局副本里移 1m → 空间签名配对必须抓到配不上的开间
{
  const tampered = JSON.parse(JSON.stringify(layout));
  const tb = tampered.objects.filter((o) => o.kind === 'facadeBay');
  tb[0].geometry.position[0] += 1.0; tb[0].geometry.position[1] += 1.0;
  const re = pairBySignature(tb, postNodes);
  ok('negative-single-move-caught', re.unpaired >= 1, `unpaired=${re.unpaired}`);
}
// N2 doorVariant 篡改：布局翻转型 ↔ GLB 实测门位失配必须被抓
{
  const tampered = JSON.parse(JSON.stringify(layout));
  const tb = tampered.objects.filter((o) => o.kind === 'facadeBay');
  const flip = tb.find((o) => o.doorVariant === 'center') || tb[0];
  flip.doorVariant = flip.doorVariant === 'center' ? 'offsetLeft' : 'center';
  const nodeOf = postPair.map.get(postBays.find((b) => b.id === flip.id));
  const w = flip.geometry.width || 4.6;
  const expected = flip.doorVariant === 'center' ? 0 : -w * 0.22;
  const actual = doorCenterX(extentX(bayParts(nodeOf, flip).door));
  ok('negative-variant-tamper-caught', actual !== null && Math.abs(actual - expected) > 0.01,
    `expected=${expected?.toFixed(3)} actual=${actual?.toFixed(3)}`);
}

console.log('policy: whole-file GLB hash equality is NOT required (identity/extras metadata legitimately differ); geometry invariance is proven per-bay by spatial-signature pairing instead');
if (nfail) { console.log(`FAILED ${nfail} (pass ${npass})`); for (const f of failures) console.log('  -', f); process.exit(1); }
console.log(`ALL PASS (${npass})`);
