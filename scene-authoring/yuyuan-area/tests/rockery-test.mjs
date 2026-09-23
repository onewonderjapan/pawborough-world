// 假山站点模块测试（T1；默认开启，ROCKERY_KIT=0 时跳过）。
// 位置/朝向只从 baseline/layout.json 的 rocks[].{x,z,size} 重算，与总装 garden.glb 实测对比。
// 两组都没有 footprint / facade.dir：形心 = 占位盒并集 AABB 中心（半宽 0.6*size，DESIGN_SPEC 占位盒），
// 朝向 = 石心平面主轴（最大特征值方向，较大分量取正）。公式与 scripts/assemble.py rockery_pose 一致。
// 用法：OUT_DIR=out-zone node tests/rockery-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateBytes } from 'gltf-validator';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const LAYOUT = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const IDS = ['rockery-dajiashan', 'rockery-yulinglong'];
const BUDGET = { 'rockery-dajiashan': 25000, 'rockery-yulinglong': 6000 };
const HALF = 0.6;

let pass = 0, fail = 0, skipped = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; failures.push(`${name}: ${detail}`); console.log('FAIL', name, detail); }
}
function skip(name, why) { skipped++; console.log('SKIP', name, '-', why); }

if (process.env.ROCKERY_KIT === '0' || !fs.existsSync(path.join(OUT, 'garden.glb'))) {
  console.log(`rockery artefacts not found or ROCKERY_KIT=0 (OUT_DIR=${OUT}) — skipping`);
  process.exit(0);
}

export function rockeryPose(rocks) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  let mx = 0, mz = 0;
  for (const r of rocks) {
    x0 = Math.min(x0, r.x - r.size * HALF); x1 = Math.max(x1, r.x + r.size * HALF);
    z0 = Math.min(z0, r.z - r.size * HALF); z1 = Math.max(z1, r.z + r.size * HALF);
    mx += r.x; mz += r.z;
  }
  mx /= rocks.length; mz /= rocks.length;
  let cxx = 0, czz = 0, cxz = 0;
  for (const r of rocks) { cxx += (r.x - mx) ** 2; czz += (r.z - mz) ** 2; cxz += (r.x - mx) * (r.z - mz); }
  const tr = cxx + czz;
  const disc = Math.max(0, tr * tr / 4 - (cxx * czz - cxz * cxz));
  const lam = tr / 2 + Math.sqrt(disc);
  let vx, vz;
  if (Math.abs(cxz) > 1e-9) { vx = -cxz; vz = cxx - lam; }
  else if (cxx >= czz) { vx = 1; vz = 0; }
  else { vx = 0; vz = 1; }
  const n = Math.hypot(vx, vz) || 1;
  vx /= n; vz /= n;
  if (Math.abs(vx) >= Math.abs(vz)) { if (vx < 0) { vx = -vx; vz = -vz; } }
  else if (vz < 0) { vx = -vx; vz = -vz; }
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, rotY: Math.atan2(vx, vz), vx, vz };
}

function parseGlb(file) {
  const buf = fs.readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen));
  let bin = null;
  if (28 + jsonLen < buf.length) {
    const binLen = buf.readUInt32LE(20 + jsonLen);
    bin = buf.subarray(28 + jsonLen, 28 + jsonLen + binLen);
  }
  const comp = { 5120: [1, Int8Array], 5121: [1, Uint8Array], 5122: [2, Int16Array], 5123: [2, Uint16Array], 5125: [4, Uint32Array], 5126: [4, Float32Array] };
  const ncomp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  function accessor(ai) {
    const a = json.accessors[ai];
    const bv = json.bufferViews[a.bufferView];
    const [bsize, Arr] = comp[a.componentType];
    const nc = ncomp[a.type];
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const stride = bv.byteStride || bsize * nc;
    const out = [];
    for (let i = 0; i < a.count; i++) out.push(Array.from(new Arr(bin.buffer, bin.byteOffset + off + i * stride, nc)));
    return out;
  }
  function nodeMatrix(n) {
    if (n.matrix) return n.matrix;
    const t = n.translation || [0, 0, 0];
    const q = n.rotation || [0, 0, 0, 1];
    const s = n.scale || [1, 1, 1];
    const [x, y, z, w] = q;
    const rot = [
      1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
    return [rot[0] * s[0], rot[3] * s[0], rot[6] * s[0], 0,
            rot[1] * s[1], rot[4] * s[1], rot[7] * s[1], 0,
            rot[2] * s[2], rot[5] * s[2], rot[8] * s[2], 0,
            t[0], t[1], t[2], 1];
  }
  function mul4(a, b) {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  }
  function mulVec(m, v) {
    return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
            m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
            m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
  }
  const nodesByName = new Map((json.nodes || []).map((n, i) => [n.name || `node${i}`, { n, i }]));
  const parentOf = new Map();
  for (const [i, n] of (json.nodes || []).entries()) for (const c of n.children || []) parentOf.set(c, i);
  function worldMatrixOf(ni) {
    let m = null, cur = ni;
    while (cur !== undefined) { m = m ? mul4(nodeMatrix(json.nodes[cur]), m) : nodeMatrix(json.nodes[cur]); cur = parentOf.get(cur); }
    return m || nodeMatrix(json.nodes[ni]);
  }
  function subtreeVerts(rootName) {
    const entry = nodesByName.get(rootName);
    if (!entry) return null;
    const verts = [];
    const w = (ni, pm) => {
      const n = json.nodes[ni];
      const m = pm ? mul4(pm, nodeMatrix(n)) : worldMatrixOf(ni);
      if (n.mesh !== undefined) {
        for (const p of json.meshes[n.mesh].primitives) {
          for (const v of accessor(p.attributes.POSITION)) verts.push(mulVec(m, v));
        }
      }
      for (const c of n.children || []) w(c, m);
    };
    w(entry.i, null);
    return verts;
  }
  return { json, nodesByName, subtreeVerts };
}

function vertPose(verts) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, mx = 0, mz = 0;
  for (const v of verts) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); z0 = Math.min(z0, v[2]); z1 = Math.max(z1, v[2]); mx += v[0]; mz += v[2]; }
  mx /= verts.length; mz /= verts.length;
  let cxx = 0, czz = 0, cxz = 0;
  for (const v of verts) { cxx += (v[0] - mx) ** 2; czz += (v[2] - mz) ** 2; cxz += (v[0] - mx) * (v[2] - mz); }
  const tr = cxx + czz;
  const disc = Math.max(0, tr * tr / 4 - (cxx * czz - cxz * cxz));
  const lam = tr / 2 + Math.sqrt(disc);
  let vx, vz;
  if (Math.abs(cxz) > 1e-6) { vx = -cxz; vz = cxx - lam; }
  else if (cxx >= czz) { vx = 1; vz = 0; }
  else { vx = 0; vz = 1; }
  const n = Math.hypot(vx, vz) || 1;
  return { bcx: (x0 + x1) / 2, bcz: (z0 + z1) / 2, vx: vx / n, vz: vz / n };
}

const garden = parseGlb(path.join(OUT, 'garden.glb'));
const staging = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'garden-kits-staging.json'), 'utf8'));

for (const id of IDS) {
  const obj = LAYOUT.objects.find((o) => o.id === id);
  ok(`${id} 在 baseline/layout.json`, !!obj && obj.kind === 'rockery');
  if (!obj) continue;
  const pose = rockeryPose(obj.geometry.rocks);
  console.log(`${id} layout 重算 centroid=(${pose.cx.toFixed(3)}, ${pose.cz.toFixed(3)}) rotY=${pose.rotY.toFixed(4)} axis=(${pose.vx.toFixed(3)}, ${pose.vz.toFixed(3)})`);
  const anchor = garden.nodesByName.get(id);
  ok(`${id} 锚节点在 garden.glb`, !!anchor);
  if (!anchor) continue;
  const t = anchor.n.translation || [0, 0, 0];
  const q = anchor.n.rotation || [0, 0, 0, 1];
  const dist = Math.hypot(t[0] - pose.cx, t[2] - pose.cz);
  ok(`${id} 锚点 vs 占位盒形心 ${dist.toFixed(3)} m ≤ 0.5`, dist <= 0.5, `got (${t[0].toFixed(2)}, ${t[2].toFixed(2)})`);
  const yaw = 2 * Math.atan2(q[1], q[3]);
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const ang = Math.acos(Math.max(-1, Math.min(1, fx * pose.vx + fz * pose.vz))) * 180 / Math.PI;
  ok(`${id} 锚点朝向 vs 石心主轴 ${ang.toFixed(2)}° ≤ 5`, ang <= 5, `yaw=${yaw.toFixed(4)} want=${pose.rotY.toFixed(4)}`);
  const verts = garden.subtreeVerts(id);
  ok(`${id} 子树有几何`, !!verts && verts.length > 1000, `verts=${verts ? verts.length : 0}`);
  if (verts && verts.length) {
    const got = vertPose(verts);
    const d = Math.hypot(got.bcx - pose.cx, got.bcz - pose.cz);
    ok(`${id} 几何 AABB 中心 vs 形心 ${d.toFixed(3)} m ≤ 0.5`, d <= 0.5, `bbox=(${got.bcx.toFixed(2)}, ${got.bcz.toFixed(2)})`);
    const dot = Math.abs(got.vx * pose.vx + got.vz * pose.vz);
    const gang = Math.acos(Math.min(1, dot)) * 180 / Math.PI;
    ok(`${id} 几何主轴 vs 石心主轴 ${gang.toFixed(2)}° ≤ 5`, gang <= 5, `mesh=(${got.vx.toFixed(3)}, ${got.vz.toFixed(3)})`);
  }
  const glb = path.join(ROOT, 'out-garden-kits', id, 'model.glb');
  ok(`${id} staged GLB 存在`, fs.existsSync(glb));
  if (fs.existsSync(glb)) {
    const sha = crypto.createHash('sha256').update(fs.readFileSync(glb)).digest('hex');
    ok(`${id} staging sha 一致`, staging.files[`${id}/model.glb`] === sha, sha);
    const res = await validateBytes(new Uint8Array(fs.readFileSync(glb)));
    ok(`${id} validator 0 错误`, res.issues.numErrors === 0, JSON.stringify(res.issues.messages?.filter((m) => m.severity === 0).slice(0, 3) || []));
    const tris = res.info?.totalTriangleCount ?? 0;
    ok(`${id} 三角 ${tris} ≤ ${BUDGET[id]}`, tris > 0 && tris <= BUDGET[id]);
  }
}

{
  const ps = JSON.parse(fs.readFileSync(path.join(OUT, 'procedural-stats.json'), 'utf8'));
  for (const id of IDS) {
    const def = (ps.deferred || []).find((x) => x.id === id);
    ok(`${id} 程序化占位已让位`, !!def && def.why === 'rockery-kit', def && def.why);
  }
  const proc = parseGlb(path.join(OUT, 'procedural-garden.glb'));
  for (const id of IDS) {
    const hit = [...proc.nodesByName.keys()].some((nm) => nm.includes(`|${id}|`) || nm === id);
    ok(`procedural-garden 不再含 ${id}`, !hit);
  }
}

for (const f of ['zone-garden.glb', 'zone-garden-2.glb']) {
  const p = path.join(OUT, f);
  if (!fs.existsSync(p)) { ok(`${f} 存在`, false); continue; }
  const b = fs.statSync(p).size;
  ok(`${f} ${b} ≤ 12000000`, b <= 12000000);
}

console.log(`\nrockery-test: ${pass} pass, ${fail} fail, ${skipped} skipped`);
if (fail > 0) { for (const f of failures) console.log('  FAIL:', f); process.exit(1); }
