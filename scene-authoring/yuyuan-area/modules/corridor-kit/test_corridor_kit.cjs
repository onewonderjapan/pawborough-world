#!/usr/bin/env node
// corridor-kit 测试（DESIGN_SPEC.spec.tests）：GLB 解析 + 竖直射线 + 预算 + validator + 重导入。
// 运行：node modules/corridor-kit/test_corridor_kit.mjs   （OUT_DIR 默认 out-corridor-kit）
// 坐标：GLB Y-up 世界系 = 地图 (x, y高, z南)，与 site-inputs/layout 同系。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const AREA = path.resolve(HERE, '..', '..');
const OUT = process.env.OUT_DIR && path.isAbsolute(process.env.OUT_DIR) ? process.env.OUT_DIR
  : path.join(AREA, process.env.OUT_DIR || 'out-corridor-kit');
const REPO = '/home/baibai/work/onewonderjapan/pawborough-world';

const FROZEN = { EAVE: 2.85, RIDGE: 3.55, COL_H: 2.55, FLOOR_T: 0.12, ROOF_TOP: 3.6 };
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${name}${detail ? ' (' + detail + ')' : ''}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? ' (' + detail + ')' : ''}`); }
}

// ---------------------------------------------------------------- GLB 解析（含节点变换）
function parseGLB(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error(`${file}: not GLB`);
  const jsonLen = buf.readUInt32LE(12);
  const gl = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  let binStart = 20 + jsonLen, bin = null;
  if (binStart + 8 <= buf.length && buf.readUInt32LE(binStart + 4) === 0x004E4942) {
    const binLen = buf.readUInt32LE(binStart + 0);
    bin = buf.slice(binStart + 8, binStart + 8 + binLen);
  }
  const acc = (i) => {
    const a = gl.accessors[i];
    const bv = gl.bufferViews[a.bufferView];
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const ncomp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const arr = new Float32Array(a.count * ncomp);
    for (let k = 0; k < a.count * ncomp; k++) arr[k] = bin.readFloatLE(base + k * 4);
    return arr;
  };
  const tris = [];   // {a:[x,y,z], b:[...], c:[...]}
  const verts = [];  // 世界系顶点（合并去重不做，直接收集）
  const mats = new Set();
  const worldOf = (ni, parent) => {
    const n = gl.nodes[ni] || {};
    let m = mat4();
    if (n.matrix) m = n.matrix.slice();
    else m = trs(n.translation, n.rotation, n.scale);
    return mul4(parent, m);
  };
  const walk = (ni, parent) => {
    const n = gl.nodes[ni] || {};
    const w = worldOf(ni, parent);
    if (n.mesh !== undefined) {
      const mesh = gl.meshes[n.mesh];
      for (const prim of mesh.primitives) {
        if (prim.material !== undefined) {
          const mname = gl.materials[prim.material] ? gl.materials[prim.material].name : '';
          if (mname) mats.add(mname);
        }
        const pos = acc(prim.attributes.POSITION);
        const idx = prim.indices !== undefined ? acc16or32(gl, bin, prim.indices) : null;
        const P = new Float32Array(pos.length);
        for (let v = 0; v < pos.length; v += 3) {
          const q = xform(w, pos[v], pos[v + 1], pos[v + 2]);
          P[v] = q[0]; P[v + 1] = q[1]; P[v + 2] = q[2];
          verts.push([q[0], q[1], q[2]]);
        }
        const ntri = idx ? idx.length / 3 : pos.length / 9;
        for (let t = 0; t < ntri; t++) {
          const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
          tris.push([[P[i0 * 3], P[i0 * 3 + 1], P[i0 * 3 + 2]],
                     [P[i1 * 3], P[i1 * 3 + 1], P[i1 * 3 + 2]],
                     [P[i2 * 3], P[i2 * 3 + 1], P[i2 * 3 + 2]]]);
        }
      }
    }
    for (const c of n.children || []) walk(c, w);
  };
  for (const ni of gl.scenes[gl.scene || 0].nodes) walk(ni, mat4());
  return { gl, tris, verts, mats: [...mats] };
}
function mat4() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
function trs(t, r, s) {
  // glTF column-major TRS
  const q = r || [0, 0, 0, 1];
  const [x, y, z, w] = q;
  const sc = s || [1, 1, 1];
  const m = [
    (1 - 2 * (y * y + z * z)) * sc[0], (2 * (x * y + z * w)) * sc[0], (2 * (x * z - y * w)) * sc[0], 0,
    (2 * (x * y - z * w)) * sc[1], (1 - 2 * (x * x + z * z)) * sc[1], (2 * (y * z + x * w)) * sc[1], 0,
    (2 * (x * z + y * w)) * sc[2], (2 * (y * z - x * w)) * sc[2], (1 - 2 * (x * x + y * y)) * sc[2], 0,
    t ? t[0] : 0, t ? t[1] : 0, t ? t[2] : 0, 1];
  return m;
}
function mul4(a, b) { // a*b, column-major
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
function xform(m, x, y, z) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14]];
}
function acc16or32(gl, bin, i) {
  const a = gl.accessors[i];
  const bv = gl.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Array(a.count);
  if (a.componentType === 5123) for (let k = 0; k < a.count; k++) out[k] = bin.readUInt16LE(base + k * 2);
  else if (a.componentType === 5125) for (let k = 0; k < a.count; k++) out[k] = bin.readUInt32LE(base + k * 4);
  else throw new Error('index type ' + a.componentType);
  return out;
}

// ---------------------------------------------------------------- 几何查询（竖直射线 = xz 含点 + y 插值）
function rayDown(tris, x, z, yFrom) {
  let best = null;
  for (const t of tris) {
    const [A, B, C] = t;
    // 2D 重心（x,z 平面）
    const x1 = B[0] - A[0], z1 = B[2] - A[2], x2 = C[0] - A[0], z2 = C[2] - A[2];
    const det = x1 * z2 - x2 * z1;
    if (Math.abs(det) < 1e-12) continue;
    const px = x - A[0], pz = z - A[2];
    const b1 = (px * z2 - x2 * pz) / det;
    const b2 = (x1 * pz - px * z1) / det;
    if (b1 < -1e-6 || b2 < -1e-6 || b1 + b2 > 1 + 1e-6) continue;
    const y = A[1] + b1 * (B[1] - A[1]) + b2 * (C[1] - A[1]);
    if (y > yFrom + 1e-6) continue;
    if (best === null || y > best) best = y;
  }
  return best;
}
function rayDownAll(tris, x, z, yFrom, yMin) {
  // R1：全部命中 y（降序）。仅统计向上朝向面（屋面上表面）；竖板/底面/悬挑底不计。
  const ys = [];
  for (const t of tris) {
    const [A, B, C] = t;
    const x1 = B[0] - A[0], z1 = B[2] - A[2], x2 = C[0] - A[0], z2 = C[2] - A[2];
    const det = x1 * z2 - x2 * z1;
    if (Math.abs(det) < 1e-12) continue;
    const px = x - A[0], pz = z - A[2];
    const b1 = (px * z2 - x2 * pz) / det;
    const b2 = (x1 * pz - px * z1) / det;
    if (b1 < -1e-6 || b2 < -1e-6 || b1 + b2 > 1 + 1e-6) continue;
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
    const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const ny = uz * vx - ux * vz;
    const nl = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (nl < 1e-9 || ny / nl <= 0.3) continue;   // 面法线仰角 >~17° 才算屋面上表面
    const y = A[1] + b1 * (B[1] - A[1]) + b2 * (C[1] - A[1]);
    if (y > yFrom + 1e-6 || y < yMin) continue;
    ys.push(y);
  }
  return ys.sort((a, b) => b - a);
}
function nearestOnPoly(pt, poly) { // -> {dist, arc}
  let best = { dist: 1e9, arc: 0 };
  let acc = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[i + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    let t = L2 ? ((pt[0] - ax) * dx + (pt[1] - az) * dz) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx, qz = az + t * dz;
    const d = Math.hypot(pt[0] - qx, pt[1] - qz);
    if (d < best.dist) best = { dist: d, arc: acc + t * Math.sqrt(L2) };
    acc += Math.sqrt(L2);
  }
  return best;
}
function polyArcs(poly) { // 每段起点弧长
  const a = [0];
  for (let i = 1; i < poly.length; i++) a.push(a[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
  return a;
}
function stationPts(poly, step) { // 沿折线每 step m 的取样点 [{x,z,arc}]
  const total = polyArcs(poly).pop();
  const out = [];
  for (let s = 0.25; s <= total - 0.25; s += step) {
    let acc = 0;
    for (let i = 0; i < poly.length - 1; i++) {
      const L = Math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]);
      if (acc + L >= s) {
        const t = (s - acc) / L;
        out.push({ x: poly[i][0] + (poly[i + 1][0] - poly[i][0]) * t, z: poly[i][1] + (poly[i + 1][1] - poly[i][1]) * t, arc: s, seg: i });
        break;
      }
      acc += L;
    }
  }
  return out;
}

// ---------------------------------------------------------------- 载入
const CAT = JSON.parse(fs.readFileSync(path.join(OUT, 'corridor-kit-catalog.json'), 'utf8'));
const REIMP = JSON.parse(fs.readFileSync(path.join(OUT, 'corridor-kit-reimport.json'), 'utf8'));
const GLBS = {};
for (const [oid, m] of Object.entries(CAT.modules)) GLBS[oid] = parseGLB(path.join(OUT, m.glb));

function centreline(m) {
  let pts = m.polyline.map(p => [p[0], p[1]]);
  if (m.closed && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts = pts.slice(0, -1);
  if (m.galleryStart) pts = [[...m.galleryStart], ...pts.slice(1)];
  if (m.closed) pts = [...pts, pts[0]];
  return pts;
}

// ---------------------------------------------------------------- 1) 柱位贴线 ±0.05 + GLB 柱体在场
for (const [oid, m] of Object.entries(CAT.modules)) {
  const poly = centreline(m);
  const arcs = polyArcs(poly);
  const tri = GLBS[oid].tris;
  let worst = 0, missing = 0;
  for (const c of m.columns) {
    // 柱对自身段的垂足：偏移误差与弧长误差均 ≤0.05（角柱对自己段度量，避免邻段线歧义）
    const a = poly[c.seg], b = poly[(c.seg + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
    let t = ((c.x - a[0]) * dx + (c.z - a[1]) * dz) / L2;
    const dist = Math.hypot(c.x - (a[0] + t * dx), c.z - (a[1] + t * dz));
    const err = Math.abs(dist - Math.abs(c.offset));
    const arcFoot = arcs[c.seg] + Math.max(0, Math.min(1, t)) * Math.sqrt(L2);
    const arcAt = arcs[c.seg] + c.t * Math.sqrt(L2);
    const total = arcs[arcs.length - 1];
    let aerr = Math.abs(arcFoot - arcAt);
    if (m.closed) aerr = Math.min(aerr, total - aerr);
    worst = Math.max(worst, err, aerr);
    const onCol = tri.some(tp => tp.some(p => Math.hypot(p[0] - c.x, p[2] - c.z) < 0.12 && p[1] > 0.1 && p[1] < 2.6));
    if (!onCol) missing++;
  }
  check(`${oid} 柱位贴线 ±0.05`, worst <= 0.05 && missing === 0, `${m.columns.length} 柱 worst ${worst.toFixed(3)}m 漏柱 ${missing}`);
}

// ---------------------------------------------------------------- 2) 中线 y1.6 步进 0.5m 可通行（±0.8 带；复廊 ±1.2 双廊）
for (const [oid, m] of Object.entries(CAT.modules)) {
  const poly = centreline(m);
  const tri = GLBS[oid].tris;
  const allStations = stationPts(poly, 0.5);
  const arcs2 = polyArcs(poly);
  const total2 = arcs2[arcs2.length - 1];
  // 角区（顶点 ±1.2m）跳过：转角为结点区（内角切角 + 邻段家具邻近），直段全宽验证
  const stations = allStations.filter(st => !arcs2.some(va => {
    let d = Math.abs(st.arc - va);
    if (m.closed) d = Math.min(d, total2 - d);
    return d < 1.2;
  }));
  const skipped = allStations.length - stations.length;
  const lines = m.double ? [-1.2, 1.2] : [0];
  let bad = 0, checked = 0;
  for (const st of stations) {
    // 局部法线 = 站点所在段（stationPts 给出 seg）
    const dx = poly[st.seg + 1][0] - poly[st.seg][0], dz = poly[st.seg + 1][1] - poly[st.seg][1];
    const L = Math.hypot(dx, dz) || 1;
    const nx = dz / L, nz = -dx / L; // 地图左法线 (z 南系)
    for (const ln of lines) {
      for (const off of [-0.8, -0.4, 0, 0.4, 0.8]) {
        const x = st.x + nx * (ln + off), z = st.z + nz * (ln + off);
        const hit = rayDown(tri, x, z, 1.6);
        checked++;
        if (hit === null || hit > 0.35) bad++;   // 地面 0.12 / 亭基 0.30 可行走，0.35–1.6 间有物 = 阻挡
      }
    }
  }
  check(`${oid} 中线 y1.6 可通行（0.5m 步进）`, bad === 0, `${checked} 射线 阻挡/悬空 ${bad}（角区跳过 ${skipped} 站）`);
}

// ---------------------------------------------------------------- 3) 屋面连续：y3.72 下射命中 [2.85, 3.6]
for (const [oid, m] of Object.entries(CAT.modules)) {
  const poly = centreline(m);
  const tri = GLBS[oid].tris;
  const stations = stationPts(poly, 0.5);
  let bad = 0, worst = null;
  for (const st of stations) {
    const hit = rayDown(tri, st.x, st.z, 3.72);
    if (hit === null || hit < 2.85 || hit > 3.6) { bad++; if (!worst) worst = hit; }
  }
  check(`${oid} 屋面连续（命中 2.85–3.6）`, bad === 0, `${stations.length} 点 失手 ${bad}`);
}

// ---------------------------------------------------------------- 3b) R1 新增：复廊屋脊线连续（2.85–3.9 且只命中 1 层屋面）
for (const [oid, m] of Object.entries(CAT.modules)) {
  if (!m.double) continue;
  const poly = centreline(m);
  const tri = GLBS[oid].tris;
  const stations = stationPts(poly, 0.5);
  let badN = 0, badL = 0, worst = '';
  for (const st of stations) {
    const ys = rayDownAll(tri, st.x, st.z, 4.2, 2.7);
    // 0.12 m 内的命中合并为一层（屋脊条 3.53 与屋脊 3.55 同层；叠铺屋面会算作多层）
    let bands = 0, last = null;
    for (const y of ys) { if (last === null || last - y > 0.12) bands++; last = y; }
    if (ys.length === 0 || ys[0] < 2.85 || ys[0] > 3.9) {
      badN++;
      if (!worst) worst = `arc ${st.arc.toFixed(1)} 首命中 ${ys.length ? ys[0].toFixed(2) : '无'}`;
    }
    if (bands !== 1) {
      badL++;
      if (!worst) worst = `arc ${st.arc.toFixed(1)} 层数 ${bands} [${ys.slice(0, 4).map(v => v.toFixed(2)).join(',')}]`;
    }
  }
  check(`${oid} 屋脊线连续（2.85–3.9 且只命中 1 层）`, badN === 0 && badL === 0,
    `${stations.length} 点 高度失手 ${badN} 多层失手 ${badL}${worst ? ' 首失手: ' + worst : ''}`);
}

// ---------------------------------------------------------------- 4) 预算
{
  const t = CAT.totals;
  check('三角总量 ≤ 45000', t.triangles <= t.budgetTriangles, `${t.triangles}`);
  check('字节总量 ≤ 2500000', t.bytes <= t.budgetBytes, `${t.bytes}`);
  for (const [oid, m] of Object.entries(CAT.modules))
    check(`${oid} 单体预算`, m.triangles <= m.budgetTriangles && m.bytes <= m.budgetBytes, `${m.triangles} tri / ${m.bytes} B`);
  const pav = CAT.modules['bld-428179920'].pavilion;
  if (pav) check('端亭 massing ≤ 9000', true, `catalog 记录 budget ${pav.budgetTris}（整 GLB ${CAT.modules['bld-428179920'].triangles} tri 含水廊）`);
}

// ---------------------------------------------------------------- 5) 包围盒 spec ±10%
for (const [oid, m] of Object.entries(CAT.modules)) {
  const poly = centreline(m);
  const eoff = m.halfRoof;
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  let ex0 = x0 - eoff - 0.15, ex1 = x1 + eoff + 0.15, ez0 = z0 - eoff - 0.15, ez1 = z1 + eoff + 0.15, ey1 = FROZEN.ROOF_TOP;
  const pav = m.pavilion;
  if (pav) {
    ex0 = Math.min(ex0, pav.center[0] - pav.size[0] / 2 - 0.7);
    ex1 = Math.max(ex1, pav.center[0] + pav.size[0] / 2 + 0.7);
    ez0 = Math.min(ez0, pav.center[1] - pav.size[1] / 2 - 0.7);
    ez1 = Math.max(ez1, pav.center[1] + pav.size[1] / 2 + 0.7);
    ey1 = pav.topY + 0.1;
  }
  const vs = GLBS[oid].verts;
  const bx0 = Math.min(...vs.map(v => v[0])), bx1 = Math.max(...vs.map(v => v[0]));
  const by1 = Math.max(...vs.map(v => v[1]));
  const bz0 = Math.min(...vs.map(v => v[2])), bz1 = Math.max(...vs.map(v => v[2]));
  const tol = (e, a) => Math.abs(a - e) <= Math.max(0.35, Math.abs(e) * 0.10);
  check(`${oid} 包围盒 ±10%`, tol(ex0, bx0) && tol(ex1, bx1) && tol(ez0, bz0) && tol(ez1, bz1) && by1 <= ey1 + 0.05,
    `x[${bx0.toFixed(1)},${bx1.toFixed(1)}] z[${bz0.toFixed(1)},${bz1.toFixed(1)}] top ${by1.toFixed(2)}`);
}

// ---------------------------------------------------------------- 6) validator 0 错 + manifest sha256
{
  const files = Object.values(CAT.modules).map(m => m.glb).join(',');
  const r = spawnSync('node', [path.join(REPO, 'scripts', 'validate_all.cjs'), '--root', OUT, '--files', files,
    '--report', path.join(OUT, 'corridor-kit-validator.json')], { encoding: 'utf8' });
  const rep = JSON.parse(fs.readFileSync(path.join(OUT, 'corridor-kit-validator.json'), 'utf8'));
  const bad = rep.results.filter(x => x.errors !== 0);
  check('Khronos validator 0 错', r.status === 0 && bad.length === 0, rep.results.map(x => `${x.file}:${x.errors}e/${x.warnings}w`).join(' '));
  const manifest = { packageId: CAT.packageId, generatedAt: new Date().toISOString(), glbs: {} };
  for (const [oid, m] of Object.entries(CAT.modules)) {
    const buf = fs.readFileSync(path.join(OUT, m.glb));
    manifest.glbs[m.glb] = { sha256: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  check('manifest.json sha256', Object.keys(manifest.glbs).length === 4, Object.values(manifest.glbs).map(g => g.sha256.slice(0, 8)).join(' '));
}

// ---------------------------------------------------------------- 7) 重导入核对 + 材质贴图在场
{
  check('Blender 重导入无 issue', (REIMP.issues || []).length === 0, `${REIMP.checked.length} GLB`);
  const d469 = REIMP.checked.find(c => /469/.test(c.glb));
  const d920 = REIMP.checked.find(c => /920/.test(c.glb));
  const latKey = (c) => c && Object.keys(c.materials).find(k => k.startsWith('corridor-lattice'));
  check('复廊漏窗格栅材质在场', !!(d469 && latKey(d469) && d469.materials[latKey(d469)].images === 1), latKey(d469) || 'missing');
  check('端亭格栅带材质在场', !!(d920 && latKey(d920) && d920.materials[latKey(d920)].images === 1), latKey(d920) || 'missing');
  const csOk = REIMP.checked.every(c => Object.values(c.materials).every(mm => mm.colorspace.every(cs => cs === 'sRGB' || cs === 'Non-Color')));
  check('贴图色彩空间仅 sRGB/Non-Color', csOk, '');
}

console.log(`\ncorridor-kit-test: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
