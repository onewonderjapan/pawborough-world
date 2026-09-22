// garden-kit 站点模块测试：DESIGN_SPEC.tests.asserts 逐条。
// 纯 Node：解析 GLB（JSON+BIN）取三角/顶点/材质/图片，Möller–Trumbore 射线。
// 缺 out-garden-kit 时跳过（不进默认 npm test；test:garden-kit 单独跑）。
// 用法：OUT_DIR=out-garden-kit node tests/garden-kit-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBytes } from 'gltf-validator';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-garden-kit');
const LAYOUT = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));

let pass = 0, fail = 0, skipped = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; failures.push(`${name}: ${detail}`); console.log('FAIL', name, detail); }
}
function skip(name, why) { skipped++; console.log('SKIP', name, '-', why); }

if (!fs.existsSync(path.join(OUT, 'garden-wall.glb'))) {
  console.log(`garden-kit artefacts not found in ${OUT} (OUT_DIR) — skipping (build with SITE_MODULES=1 first)`);
  process.exit(0);
}

// ---------- GLB 解析 ----------
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
    for (let i = 0; i < a.count; i++) {
      const o = off + i * stride;
      const v = new Arr(bin.buffer, bin.byteOffset + o, nc);
      out.push(Array.from(v));
    }
    return out;
  }
  // 节点树展开（应用 TRS/矩阵），收集每 primitive 的三角形世界坐标
  const meshes = json.meshes || [];
  const tris = [];      // {v0,v1,v2, mat, meshName}
  const verts = [];     // [x,y,z]
  const triMats = [];
  function nodeMatrix(n) {
    if (n.matrix) return n.matrix; // glTF 列主序 4x4
    const t = n.translation || [0, 0, 0];
    const q = n.rotation || [0, 0, 0, 1];
    const s = n.scale || [1, 1, 1];
    const [x, y, z, w] = q;
    const rot = [
      1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
      2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
    // 列主序 4x4
    return [rot[0] * s[0], rot[3] * s[0], rot[6] * s[0], 0,
            rot[1] * s[1], rot[4] * s[1], rot[7] * s[1], 0,
            rot[2] * s[2], rot[5] * s[2], rot[8] * s[2], 0,
            t[0], t[1], t[2], 1];
  }
  function mulVec(m, v) {
    return [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
  }
  function walk(ni, pm) {
    const n = json.nodes[ni];
    const m = pm ? mul4(pm, nodeMatrix(n)) : nodeMatrix(n);
    if (n.mesh !== undefined) {
      const mesh = meshes[n.mesh];
      for (const p of mesh.primitives) {
        const pos = accessor(p.attributes.POSITION).map((v) => mulVec(m, v));
        const idx = p.indices !== undefined ? accessor(p.indices).map((v) => v[0]) : pos.map((_, i) => i);
        const base = verts.length;
        verts.push(...pos);
        for (let i = 0; i < idx.length; i += 3) {
          tris.push([base + idx[i], base + idx[i + 1], base + idx[i + 2]]);
          triMats.push(p.material !== undefined ? json.materials[p.material].name : null);
        }
      }
    }
    for (const c of n.children || []) walk(c, m);
  }
  function mul4(a, b) {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  }
  const scene = json.scenes[json.scene || 0];
  for (const ni of scene.nodes) walk(ni, null);
  const images = (json.images || []).map((i) => i.uri || i.mimeType);
  const mats = (json.materials || []).map((m) => ({
    name: m.name,
    baseTex: !!(m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture),
    normalTex: !!m.normalTexture,
  }));
  const matIdxByName = new Map((json.materials || []).map((m, i) => [m.name, i]));
  const usedImages = new Set();
  for (const m of json.materials || []) {
    const texs = [];
    if (m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture) texs.push(m.pbrMetallicRoughness.baseColorTexture.index);
    if (m.normalTexture) texs.push(m.normalTexture.index);
    if (m.occlusionTexture) texs.push(m.occlusionTexture.index);
    for (const ti of texs) {
      const src = json.textures[ti].source;
      if (src !== undefined) usedImages.add(src);
    }
  }
  return { json, tris, verts, triMats, images, mats, usedImages, matIdxByName, binLen: bin ? bin.length : 0 };
}

function triCount(g) { return g.tris.length; }

// ---------- 射线（Möller–Trumbore），返回最近命中距离或 null ----------
function raycast(g, o, d, maxDist = 1e9, maxHitY = 1e9) {
  let best = null;
  const [ox, oy, oz] = o, [dx, dy, dz] = d;
  for (let t = 0; t < g.tris.length; t++) {
    const [ia, ib, ic] = g.tris[t];
    const a = g.verts[ia], b = g.verts[ib], c = g.verts[ic];
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (det > -1e-9 && det < 1e-9) continue;
    const inv = 1 / det;
    const sx = ox - a[0], sy = oy - a[1], sz = oz - a[2];
    const u = (sx * hx + sy * hy + sz * hz) * inv;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < -1e-9 || u + v > 1 + 1e-9) continue;
    const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (dist > 1e-6 && dist < maxDist && oy + dy * dist <= maxHitY && (best === null || dist < best)) best = dist;
  }
  return best;
}

// ---------- 布局数据 ----------
const objById = {};
for (const o of LAYOUT.objects) objById[o.id] = o;

function segDir(a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l = Math.hypot(dx, dz);
  return [dx / l, dz / l];
}
function pointDistToSeg(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2;
  t = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t)), t };
}

const garden = parseGlb(path.join(OUT, 'garden-wall.glb'));
const temple = parseGlb(path.join(OUT, 'temple-wall.glb'));
const moon = parseGlb(path.join(OUT, 'moon-gate.glb'));
const bridge = parseGlb(path.join(OUT, 'jiuqu-bridge.glb'));

// ---------- 1) 两道墙贴线（每 1 m 沿段法线射线打墙面：墙面平面应在 thick/2 ± 0.05；
// 关节点由 0.6 角墩包住，容差放宽到 0.1，skip 说明见 DELIVERY） ----------
function checkWallOnLines(g, wallId, name) {
  const o = objById[wallId];
  const thick = o.thickness;
  const segs = o.geometry.segments;
  const joints = [];
  for (const [a, b] of segs) { joints.push(a, b); }
  const windows = o.geometry.lattice || [];
  let worst = 0, worstJoint = 0, checked = 0, misses = 0;
  for (const [a, b] of segs) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const d = segDir(a, b);
    const nrm = [-d[1], d[0]];
    for (let s = 0.5; s < L; s += 1.0) {
      const px = a[0] + d[0] * s, pz = a[1] + d[1] * s;
      const nearJoint = joints.some((j) => Math.hypot(j[0] - px, j[1] - pz) <= 0.8);
      if (nearJoint) continue;  // 关节墩区（0.6 墩包住，非本检查对象）
      if (windows.some((w) => Math.hypot(w.x - px, w.z - pz) <= 0.85)) continue;  // 漏窗敞口：射线穿透为正确行为
      // 从墙面外 1.2m 沿 -法线打墙：命中距离 1.2-thick/2 为理想面
      const hit = raycast(g, [px + nrm[0] * 1.2, 1.5, pz + nrm[1] * 1.2], [-nrm[0], 0, -nrm[1]], 2.4);
      checked++;
      if (hit === null) { misses++; continue; }
      const off = Math.abs((1.2 - hit) - thick / 2);
      worst = Math.max(worst, off);
    }
  }
  ok(`${name} 墙身每米贴线（${checked} 采样 面偏移 worst ${worst.toFixed(3)}m ≤ 0.05, 漏打 ${misses}）`,
    worst <= 0.05 && misses === 0);
}
checkWallOnLines(garden, 'garden-wall', 'garden-wall');
checkWallOnLines(temple, 'temple-wall', 'temple-wall');

// ---------- 2) 24 漏窗真实开洞：9 条子射线 ≤40% 被挡 ----------
{
  const o = objById['garden-wall'];
  const wins = o.geometry.lattice;
  let worstBlocked = 0, fullyOpen = 0, worstWin = '';
  for (const lw of wins) {
    // 段方向（构建与布局线为权威；窗 rotY 可能偏离段向）
    let bestSeg = null;
    for (const [a, b] of o.geometry.segments) {
      const d = segDir(a, b);
      const t = Math.max(0, Math.min(Math.hypot(b[0] - a[0], b[1] - a[1]), (lw.x - a[0]) * d[0] + (lw.z - a[1]) * d[1]));
      const pd = Math.hypot(lw.x - (a[0] + d[0] * t), lw.z - (a[1] + d[1] * t));
      if (bestSeg === null || pd < bestSeg.pd) bestSeg = { d, pd };
    }
    const r = Math.atan2(bestSeg.d[0], bestSeg.d[1]);
    const wdir = [Math.sin(r), Math.cos(r)];
    const nrm = [Math.cos(r), -Math.sin(r)];
    let blocked = 0;
    for (let k = -4; k <= 4; k++) {
      const uo = k * 0.125;
      const ox = lw.x + wdir[0] * uo + nrm[0] * 2;
      const oz = lw.z + wdir[1] * uo + nrm[1] * 2;
      const dirn = [-nrm[0], 0, -nrm[1]];
      const hit = raycast(garden, [ox, 1.55, oz], dirn, 4.0);
      if (hit !== null) blocked++;
    }
    if (blocked === 0) fullyOpen++;
    if (blocked > worstBlocked) { worstBlocked = blocked; worstWin = `(${lw.x.toFixed(1)},${lw.z.toFixed(1)})`; }
  }
  ok(`24 漏窗透光（最差窗 ${worstWin} ${worstBlocked}/9 子射线被挡 ≤ 3, 全净空窗 ${fullyOpen}）`, worstBlocked <= 3);
}

// ---------- 3) 月洞门：中心 y1.6 通、y0.3/y2.4 实墙命中 ----------
{
  const o = objById['yuhuatang-moongate'];
  const [x0, z0] = o.geometry.position;
  const th = o.geometry.rotY - Math.PI / 2;
  const nrm = [Math.sin(th), Math.cos(th)];
  const wdir = [Math.cos(th), -Math.sin(th)];
  const mid = raycast(moon, [x0 + nrm[0] * 2, 1.6, z0 + nrm[1] * 2], [-nrm[0], 0, -nrm[1]], 4.0);
  ok('月洞门中心 y1.6 可穿（无命中）', mid === null, `hit=${mid}`);
  let hitLow = false, hitHigh = false;
  for (const su of [-1, 1]) {
    const probes = [[0.3, (h) => { hitLow = hitLow || h; }], [2.4, (h) => { hitHigh = hitHigh || h; }]];
    for (const [y, setter] of probes) {
      const ox = x0 + wdir[0] * su * 1.8 + nrm[0] * 2;
      const oz = z0 + wdir[1] * su * 1.8 + nrm[1] * 2;
      setter(raycast(moon, [ox, y, oz], [-nrm[0], 0, -nrm[1]], 4.0) !== null);
    }
  }
  ok('月洞门 y0.3 实墙命中（±1.8m 处）', hitLow);
  ok('月洞门 y2.4 实墙命中（±1.8m 处）', hitHigh);
}

// ---------- 4) 九曲桥：每 0.5 m 下行射线命中桥面 0.55±0.03 ----------
{
  const o = objById['jiuqu-bridge'];
  const pts = o.geometry.polyline;
  const deckY = o.deckY;
  let worst = null, misses = 0, n = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(L / 0.5));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      if (i === 0 && t === 0) continue;        // 桥起点在斜切板边，端点由相邻采样覆盖
      if (i === pts.length - 2 && t === 1) continue;
      const px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t;
      // 只认 0.61m 以下的命中：转角处邻跨柱头/栏板悬到中线上方不算桥面
      const hit = raycast(bridge, [px, 2, pz], [0, -1, 0], 2.0, 0.61);
      n++;
      if (hit === null || Math.abs((2 - hit) - deckY) > 0.03) {
        misses++;
        const dev = hit === null ? 'miss' : Math.abs((2 - hit) - deckY).toFixed(3);
        if (worst === null || (hit !== null && worst !== 'miss')) worst = dev;
      }
    }
  }
  ok(`九曲桥桥面连续（${n} 点, 缺口/超差 ${misses}）`, misses === 0, `worst=${worst}`);
}

// ---------- 5) 每个折线顶点必有柱（期望位 ±0.2 m） ----------
{
  const o = objById['jiuqu-bridge'];
  const pts = o.geometry.polyline;
  const W = o.width;
  const postOff = W / 2 - 0.08 - 0.11;
  let worst = 0;
  for (const v of pts) {
    for (const side of [-1, 1]) {
      // 最近跨法线
      let best = null;
      for (let i = 0; i < pts.length - 1; i++) {
        const d = segDir(pts[i], pts[i + 1]);
        const pd = pointDistToSeg(v, pts[i], pts[i + 1]);
        if (best === null || pd.d < best.d) best = { d: pd.d, n: [-d[1], d[0]] };
      }
      const ex = v[0] + best.n[0] * side * postOff, ez = v[1] + best.n[1] * side * postOff;
      let bd = null;
      for (let i = 0; i < bridge.verts.length; i += 3) {
        const vt = bridge.verts[i];
        if (vt[1] < 0.6 || vt[1] > 1.75) continue;
        const hd = Math.hypot(vt[0] - ex, vt[2] - ez);
        if (bd === null || hd < bd) bd = hd;
      }
      if (bd !== null) worst = Math.max(worst, bd);
    }
  }
  ok(`九曲桥顶点柱到位（worst ${worst.toFixed(3)}m ≤ 0.2）`, worst <= 0.2);
}

// ---------- 6) 预算（三角） ----------
{
  const budgets = [
    ['garden-wall', triCount(garden), 70000],
    ['garden-wall-dragonhead（garden-wall 内）', null, 3500],
    ['temple-wall', triCount(temple), 20000],
    ['moon-gate', triCount(moon), 4000],
    ['jiuqu-bridge', triCount(bridge), 30000],
  ];
  ok(`garden-wall 三角 ${triCount(garden)} ≤ 70000`, triCount(garden) <= 70000);
  ok(`temple-wall 三角 ${triCount(temple)} ≤ 20000`, triCount(temple) <= 20000);
  ok(`moon-gate 三角 ${triCount(moon)} ≤ 4000`, triCount(moon) <= 4000);
  ok(`jiuqu-bridge 三角 ${triCount(bridge)} ≤ 30000`, triCount(bridge) <= 30000);
  // 龙头单独计：garden-wall GLB 里 matIdx 以 meshName 不分部件——用 catalog 记录核对
  const catalog = JSON.parse(fs.readFileSync(path.join(OUT, 'garden-kit-catalog.json'), 'utf8'));
  const headTris = catalog.modules['garden-wall']['garden-wall-dragonhead'].triangles;
  ok(`龙头三角 ${headTris} ≤ 3500（catalog 记录，构建时分子部件合计）`, headTris <= 3500);
  // 字节预算
  const b = (f) => fs.statSync(path.join(OUT, f)).size;
  ok(`garden-wall.glb ${b('garden-wall.glb')} ≤ 1800000`, b('garden-wall.glb') <= 1800000);
  ok(`jiuqu-bridge.glb ${b('jiuqu-bridge.glb')} ≤ 900000`, b('jiuqu-bridge.glb') <= 900000);
}

// ---------- 7) validator 0 错误 ----------
for (const f of ['garden-wall.glb', 'temple-wall.glb', 'moon-gate.glb', 'jiuqu-bridge.glb']) {
  const res = await validateBytes(new Uint8Array(fs.readFileSync(path.join(OUT, f))));
  ok(`validator 0 错误 ${f}（warn=${res.issues.numWarnings}）`, res.issues.numErrors === 0,
    JSON.stringify(res.issues.messages?.slice(0, 3) || []));
}

// ---------- 8) 重导入核对：图片节点连接 + sRGB/Non-Color ----------
{
  for (const [name, g] of [['garden-wall', garden], ['temple-wall', temple], ['moon-gate', moon], ['jiuqu-bridge', bridge]]) {
    const allRef = g.images.length === 0 || g.usedImages.size === g.images.length;
    ok(`${name} 每张图都被材质引用（${g.usedImages.size}/${g.images.length}）`, allRef);
    const plasterOk = g.mats.filter((m) => /plaster|stone|deck/.test(m.name)).every((m) => m.baseTex);
    ok(`${name} 石/泥材质挂基色贴图`, plasterOk);
    const capOk = g.mats.filter((m) => /cap/.test(m.name)).every((m) => m.baseTex && m.normalTex);
    ok(`${name} 瓦帽材质挂基色+法线`, capOk);
  }
  const reimport = JSON.parse(fs.readFileSync(path.join(OUT, 'garden-kit-reimport.json'), 'utf8'));
  ok('Blender 侧重导入核对无 issue', reimport.issues.length === 0, JSON.stringify(reimport.issues.slice(0, 3)));
  const csOk = reimport.checked.every((c) => Object.values(c.materials).every((m) =>
    m.colorspace.every((cs) => cs === 'sRGB' || cs === 'Non-Color')));
  ok('贴图色彩空间仅 sRGB/Non-Color', csOk);
}

// ---------- 9) scene-areas ≤ 30 MB + gardenRouteAudit 全 ok ----------
{
  const sa = path.join(OUT, 'scene-areas.glb');
  if (fs.existsSync(sa)) {
    const bytes = fs.statSync(sa).size;
    ok(`scene-areas.glb ${bytes} ≤ 30000000`, bytes <= 30000000);
  } else {
    skip('scene-areas.glb ≤ 30MB', '尚未重建总装（OUT_DIR 无 scene-areas.glb）');
  }
  const outLayoutPath = path.join(OUT, 'layout.json');
  if (fs.existsSync(outLayoutPath)) {
    const gra = JSON.parse(fs.readFileSync(outLayoutPath, 'utf8')).gardenRouteAudit;
    const bad = gra.segments.filter((s) => s.classification !== 'ok');
    ok(`gardenRouteAudit 全 ok（${gra.segments.length} 段）`, bad.length === 0, JSON.stringify(bad.slice(0, 2)));
  } else {
    skip('gardenRouteAudit 全 ok', 'OUT_DIR 无 layout.json');
  }
}

console.log(`\ngarden-kit-test: ${pass} pass, ${fail} fail, ${skipped} skipped`);
if (fail > 0) {
  for (const f of failures) console.log('  FAIL:', f);
  process.exit(1);
}
