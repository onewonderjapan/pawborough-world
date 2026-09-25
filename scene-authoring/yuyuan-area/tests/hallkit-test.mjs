// 厅堂套件测试（WP8 样板仰山堂，HALL_KIT=1）。位置/朝向只认 baseline/layout.json 重算值，与总装产物实测对比；
// 位置公式 = footprint 多边形面积形心（GOAL 冻结，非顶点均值），矩形/朝向重算与 modules/hall-kit/build_hall.py 同式。
// 不读模块自报 placements（模块没有 placements——放置公式只有 layout 一份来源）。
// 用法：OUT_DIR=out-zone HALL_KIT=1 node tests/hallkit-test.mjs（无产物或开关未开时跳过）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBytes } from 'gltf-validator';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const LAYOUT = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const HK_ID = 'bld-428179902';
const HK_GLB = path.join(ROOT, 'out-garden-kits', 'hallkit-' + HK_ID, 'model.glb');

let pass = 0, fail = 0, skipped = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; failures.push(`${name}: ${detail}`); console.log('FAIL', name, detail); }
}
function skip(name, why) { skipped++; console.log('SKIP', name, '-', why); }

if (process.env.HALL_KIT !== '1' || !fs.existsSync(path.join(OUT, 'garden.glb')) || !fs.existsSync(HK_GLB)) {
  console.log(`hallkit artefacts not found or HALL_KIT!=1 (OUT_DIR=${OUT}) — skipping`);
  process.exit(0);
}

// ---------- GLB 解析（节点世界矩阵 + 子树顶点收集，与 sansuitang-test 同实现） ----------
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
      out.push(Array.from(new Arr(bin.buffer, bin.byteOffset + o, nc)));
    }
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
    return [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
  }
  const nodesByName = new Map((json.nodes || []).map((n, i) => [n.name || `node${i}`, { n, i }]));
  const parentOf = new Map();
  for (const [i, n] of (json.nodes || []).entries()) for (const c of n.children || []) parentOf.set(c, i);
  const triTotal = (json.meshes || []).reduce((s, m) => s + m.primitives.reduce((t, p) => t + Math.floor(json.accessors[p.indices].count / 3), 0), 0);
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
  return { json, nodesByName, subtreeVerts, triTotal, nodeCount: (json.nodes || []).length, materials: json.materials || [] };
}

// ---------- layout 重算（唯一权威来源）：面积形心 + 最小面积外接矩形 ----------
const obj = LAYOUT.objects.find((o) => o.id === HK_ID);
if (!obj) { console.log('FAIL layout has no', HK_ID); process.exit(1); }
const fpRaw = obj.geometry.footprint;
const fp = fpRaw[0][0] === fpRaw[fpRaw.length - 1][0] && fpRaw[0][1] === fpRaw[fpRaw.length - 1][1] ? fpRaw.slice(0, -1) : fpRaw;
const n = fp.length;
const a2 = fp.reduce((s, p, i) => s + p[0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * p[1], 0) / 2;
const cx = Math.abs(a2) < 1e-6 ? fp.reduce((s, q) => s + q[0], 0) / n
  : fp.reduce((s, p, i) => s + (p[0] + fp[(i + 1) % n][0]) * (p[0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * p[1]), 0) / (6 * a2);
const cz = Math.abs(a2) < 1e-6 ? fp.reduce((s, q) => s + q[1], 0) / n
  : fp.reduce((s, p, i) => s + (p[1] + fp[(i + 1) % n][1]) * (p[0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * p[1]), 0) / (6 * a2);
const [dx, dz] = obj.facade.dir;
const wantRotY = Math.atan2(dx, dz);

// 最小面积外接矩形（旋转卡壳，同 build_hall.py）
function hullOf(pts) {
  const s = [...new Set(pts.map((p) => `${p[0]},${p[1]}`))].map((k) => k.split(',').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const p of s) { while (lo.length >= 2 && cr(lo.at(-2), lo.at(-1), p) <= 0) lo.pop(); lo.push(p); }
  const up = [];
  for (const p of s.reverse()) { while (up.length >= 2 && cr(up.at(-2), up.at(-1), p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
const H = hullOf(fp);
let best = null;
for (let i = 0; i < H.length; i++) {
  const [x1, y1] = H[i], [x2, y2] = H[(i + 1) % H.length];
  const ddx = x2 - x1, ddy = y2 - y1, L = Math.hypot(ddx, ddy);
  if (L < 1e-9) continue;
  const ux = ddx / L, uy = ddy / L;
  const us = H.map((p) => (p[0] - x1) * ux + (p[1] - y1) * uy);
  const vs = H.map((p) => -(p[0] - x1) * uy + (p[1] - y1) * ux);
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
  const area = (u1 - u0) * (v1 - v0);
  if (!best || area < best.area) best = { area, ux, uy, u0, u1, v0, v1, px: x1, py: y1 };
}
let { ux, uy, u0, u1, v0, v1, px, py } = best;
if (u1 - u0 < v1 - v0) { [ux, uy] = [-uy, ux]; [u0, u1, v0, v1] = [v0, v1, -u1, -u0]; }
if (-uy * dx + ux * dz < 0) { [ux, uy] = [-ux, -uy]; [u0, u1, v0, v1] = [-u1, -u0, -v1, -v0]; }
const hu = (u1 - u0) / 2, hv = (v1 - v0) / 2;
// 矩形中心世界坐标
const rcx = px + ((u0 + u1) / 2) * ux - ((v0 + v1) / 2) * uy;
const rcz = py + ((u0 + u1) / 2) * uy + ((v0 + v1) / 2) * ux;
console.log(`layout 重算：面积形心=(${cx.toFixed(3)}, ${cz.toFixed(3)})  rect=${(2 * hu).toFixed(2)}×${(2 * hv).toFixed(2)}  rotY=${wantRotY.toFixed(4)}`);

// ---------- 1) 总装 garden.glb 锚点实测 ----------
const garden = parseGlb(path.join(OUT, 'garden.glb'));
const anchorEntry = garden.nodesByName.get(HK_ID);
ok('garden.glb 有 bld-428179902 锚节点', !!anchorEntry);
let testOk = !!anchorEntry;
if (testOk) {
  const nA = anchorEntry.n;
  const t = nA.translation || [0, 0, 0];
  const q = nA.rotation || [0, 0, 0, 1];
  const dist = Math.hypot(t[0] - cx, t[2] - cz);
  ok(`锚点位置 = footprint 面积形心（偏差 ${dist.toFixed(3)} m ≤ 0.5）`, dist <= 0.5, `got (${t[0].toFixed(2)}, ${t[2].toFixed(2)})`);
  const yaw = 2 * Math.atan2(q[1], q[3]);
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const ang = Math.acos(Math.max(-1, Math.min(1, (fx * dx + fz * dz) / Math.hypot(dx, dz)))) * 180 / Math.PI;
  ok(`锚点朝向 vs facade.dir（夹角 ${ang.toFixed(2)}° ≤ 5）`, ang <= 5, `yaw=${yaw.toFixed(4)}`);

  // 2) 子树几何实测：平面包围盒中心 vs 外接矩形中心；本地系尺寸 vs 矩形 + 台基外扩 0.2
  const verts = garden.subtreeVerts(HK_ID);
  ok('bld-428179902 子树有几何', !!verts && verts.length > 500, `verts=${verts ? verts.length : 0}`);
  if (verts && verts.length) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const v of verts) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); z0 = Math.min(z0, v[2]); z1 = Math.max(z1, v[2]); }
    const bcx = (x0 + x1) / 2, bcz = (z0 + z1) / 2;
    const d = Math.hypot(bcx - rcx, bcz - rcz);
    ok(`实际几何平面中心 vs 外接矩形中心（偏差 ${d.toFixed(3)} m ≤ 0.5）`, d <= 0.5, `bbox=(${bcx.toFixed(2)}, ${bcz.toFixed(2)}) want=(${rcx.toFixed(2)}, ${rcz.toFixed(2)})`);
    let uu0 = 1e9, uu1 = -1e9, vv0 = 1e9, vv1 = -1e9;
    const ct = Math.cos(-wantRotY), st = Math.sin(-wantRotY);
    for (const v of verts) {
      const rx = v[0] - cx, rz = v[2] - cz;
      const ux2 = rx * ct + rz * st, vz2 = -rx * st + rz * ct;
      uu0 = Math.min(uu0, ux2); uu1 = Math.max(uu1, ux2); vv0 = Math.min(vv0, vz2); vv1 = Math.max(vv1, vz2);
    }
    const w = uu1 - uu0, dep = vv1 - vv0;
    // 台基 = 矩形外扩 0.2（+踏步出挑 0.9）；容差 ±1.2
    ok(`实际几何本地系尺寸（${w.toFixed(1)} × ${dep.toFixed(1)} m，预期 ${(2 * hu + 0.4).toFixed(1)} × ${(2 * hv + 1.3).toFixed(1)} ±1.2）`,
      Math.abs(w - (2 * hu + 0.4)) < 1.2 && Math.abs(dep - (2 * hv + 1.3)) < 1.2);
  }
}

// ---------- 3) 模块 GLB：validator 0 错 + 预算 10k + 节点数（无散件） + 格心 alpha ----------
{
  const res = await validateBytes(new Uint8Array(fs.readFileSync(HK_GLB)));
  ok('模块 GLB validator 0 错误', res.issues.numErrors === 0, JSON.stringify(res.issues.messages?.filter((m) => m.severity === 0).slice(0, 3) || []));
  const tris = res.info?.totalTriangleCount ?? 0;
  ok(`模块三角 ${tris} ≤ 10000（单栋预算）`, tris > 0 && tris <= 10000);
  const bytes = fs.statSync(HK_GLB).size;
  ok(`模块字节 ${bytes} ≤ 1500000`, bytes <= 1500000);
  const g = parseGlb(HK_GLB);
  // 无散件：节点 = (part × material) 合并组（台基/框架/墙/格扇/屋面），无未合并碎片
  ok(`无散件：模块节点数 ${g.nodeCount} ≤ 16`, g.nodeCount <= 16, `nodes=${g.nodeCount}`);
  const lat = g.materials.find((m) => /lattice/.test(m.name));
  ok('格心材质 alphaMode=MASK', !!lat && lat.alphaMode === 'MASK', lat && lat.alphaMode);
  const alphaImg = (g.json.images || []).some((i) => /lattice/.test(i.name || ''));
  ok('解析 alpha 贴图已内嵌', alphaImg);
}

// ---------- 4) 程序化 hall 确实让位 + 碰撞世界记录 ----------
{
  const ps = JSON.parse(fs.readFileSync(path.join(OUT, 'procedural-stats.json'), 'utf8'));
  const def = (ps.deferred || []).find((x) => x.id === HK_ID);
  ok(`程序化 hall 已让位（why=${def ? def.why : '未推迟'}）`, !!def && def.why === 'hall-kit');
  const cw = path.join(OUT, 'hallkit-collision-world.json');
  if (fs.existsSync(cw)) {
    const c = JSON.parse(fs.readFileSync(cw, 'utf8'));
    ok(`碰撞世界记录 ≥ 20 盒（${c.colliders.length}）`, c.colliders.length >= 20);
    const stI = c.instance;
    const dist = Math.hypot(stI.position[0] - cx, stI.position[1] - cz);
    ok(`碰撞实例位姿与 layout 面积形心一致（偏差 ${dist.toFixed(3)} m）`, dist <= 0.5);
  } else {
    skip('碰撞世界记录', 'OUT_DIR 无 hallkit-collision-world.json');
  }
}

// ---------- 5) 分区预算：garden zone 原始 GLB ≤ 12 MB ----------
{
  const zg = path.join(OUT, 'zone-garden.glb');
  if (fs.existsSync(zg)) {
    const b = fs.statSync(zg).size;
    ok(`zone-garden.glb ${b} ≤ 12000000`, b <= 12000000);
  } else skip('zone-garden.glb ≤ 12MB', '未导出分区');
}

console.log(`\nhallkit-test: ${pass} pass, ${fail} fail, ${skipped} skipped`);
if (fail > 0) { for (const f of failures) console.log('  FAIL:', f); process.exit(1); }
