// Flash2 facade-bay-fit 回归测试：程序化沿街店面(facadeBay)的橱窗/楣框必须整体落在
// 门区间之外的自由区间与原开间边界内——不得越出开间、不得与邻开间壁柱交叉、不得与门重叠、
// 不得为凑约束把窗沉进墙里。
// 期望值来源：OUT_DIR/layout.json（开间几何=管线输入）+ OUT_DIR/procedural-bazaar.glb
// （build-scene 的 node 产物，passage 路径把 facadeBay 几何烘到世界系、节点变换为恒等）。
// 部件按顶点色线性值分类（与生成器 colorize 的 sRGB→linear 一致），几何按开间本地轴 rotY 投影。
// 修前真实 GLB 全量失败（out-facade-flash2 产物，日志 artifacts/logs/facade-bay-fit-before.log），修后全绿。
// 用法：OUT_DIR=out node tests/facade-bay-fit-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out');
let npass = 0, nfail = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { npass++; console.log('PASS', name); }
  else { nfail++; failures.push(`${name}: ${detail}`); console.log('FAIL', name, detail); }
};

// ---------- GLB 读取（POSITION + COLOR_0，facadeBay 节点变换恒等，不烘焙父级） ----------
function readGlb(file) {
  const buf = fs.readFileSync(file);
  let off = 12;
  let json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'JSON') json = JSON.parse(data.toString('utf8'));
    else if (type === 'BIN\0') bin = data;
    off += 8 + len;
  }
  const ACC_T = { 5126: ['getFloat32', 4], 5125: ['getUint32', 4], 5123: ['getUint16', 2], 5121: ['getUint8', 1] };
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
    if (n.mesh === undefined) continue;
    const tr = n.translation || [0, 0, 0], rot = n.rotation || [0, 0, 0, 1];
    const identity = tr.every((v) => Math.abs(v) < 1e-9) &&
      rot[0] * rot[0] + rot[1] * rot[1] + rot[2] * rot[2] + (rot[3] - 1) * (rot[3] - 1) < 1e-18 &&
      !(n.scale || []).some((v) => Math.abs(v - 1) > 1e-9) && !n.matrix;
    for (const pr of json.meshes[n.mesh].primitives) {
      nodes.push({
        name: n.name || '', identity,
        P: acc(pr.attributes.POSITION),
        C: pr.attributes.COLOR_0 !== undefined ? acc(pr.attributes.COLOR_0) : null,
      });
    }
  }
  return nodes;
}

// 生成器配色（sRGB hex）→ GLB 顶点色线性值（与 three ColorManagement 的 sRGB→linear 一致）
const s2l = (u) => { u /= 255; return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; };
const lin = (hex) => [s2l((hex >> 16) & 255), s2l((hex >> 8) & 255), s2l(hex & 255)];
const PARTS = {
  door: lin(0x3f3a34), window: lin(0x4a5560), frame: lin(0x8a7a62),
  pilaster: lin(0xb5ab97), panel: lin(0xcac2b0),
};
const near = (c, ref, tol = 0.02) => Math.abs(c[0] - ref[0]) < tol && Math.abs(c[1] - ref[1]) < tol && Math.abs(c[2] - ref[2]) < tol;

// ---------- 输入 ----------
const layout = JSON.parse(fs.readFileSync(path.join(OUT, 'layout.json'), 'utf8'));
const bays = layout.objects.filter((o) => o.kind === 'facadeBay' && !o.skipRender);
const nodes = readGlb(path.join(OUT, 'procedural-bazaar.glb')).filter((n) => /facadeBay/.test(n.name));
ok('glb-node-count-matches-layout', nodes.length === bays.length, `GLB facadeBay 网格 ${nodes.length} vs layout ${bays.length}`);

const centroidOf = (n) => {
  let cx = 0, cy = 0, cz = 0;
  const m = n.P.length / 3;
  for (let i = 0; i < m; i++) { cx += n.P[i * 3]; cy += n.P[i * 3 + 1]; cz += n.P[i * 3 + 2]; }
  return [cx / m, cy / m, cz / m];
};
const used = new Set();
const stats = { withWindow: 0, windowBoxes: 0, worstBoundary: 0, worstPilaster: 0 };
const offenders = { boundary: [], pilaster: [], doorSep: [], sunk: [], tiny: [], orient: [] };

for (const o of bays) {
  const w = o.geometry.width || 4.6;
  const rotY = o.geometry.rotY || 0;
  const [x, z] = o.geometry.position;
  const dir = o.geometry.dir || [Math.sin(rotY), Math.cos(rotY)];
  const ax = x + dir[0] * 0.16, az = z + dir[1] * 0.16;   // buildFacadeBay 组锚
  const ux = Math.cos(rotY), uz = -Math.sin(rotY);        // 本地 X 轴（世界）
  const vx = Math.sin(rotY), vz = Math.cos(rotY);         // 本地 +Z（正面朝街）
  // 一对一匹配最近质心节点
  let best = null;
  nodes.forEach((n, i) => {
    if (used.has(i)) return;
    const c = centroidOf(n);
    const d = Math.hypot(c[0] - ax, c[2] - az);
    if (!best || d < best.d) best = { i, d, n };
  });
  const tag = `${o.id}@(${x.toFixed(1)},${z.toFixed(1)}) w=${w.toFixed(2)}`;
  if (!best || best.d > 1.5 || !best.n.identity) {
    ok(`match:${tag}`, false, best ? `质心距 ${best.d.toFixed(3)} 或变换非恒等` : '无候选节点');
    if (best) used.add(best.i);
    continue;
  }
  used.add(best.i);
  ok(`match:${tag}`, true);
  const n = best.n;
  // 顶点 → 开间本地坐标（x 沿开间，z 沿正面），按色分类
  const m = n.P.length / 3;
  const part = { door: [], window: [], frame: [], pilaster: [], panel: [] };
  for (let i = 0; i < m; i++) {
    const wx = n.P[i * 3] - ax, wy = n.P[i * 3 + 1], wz = n.P[i * 3 + 2] - az;
    const lx = wx * ux + wz * uz, lz = wx * vx + wz * vz;
    const c = [n.C[i * 3], n.C[i * 3 + 1], n.C[i * 3 + 2]];
    for (const [k, ref] of Object.entries(PARTS)) if (near(c, ref)) { part[k].push([lx, wy, lz]); break; }
  }
  const extent = (arr, ax2) => arr.length ? [Math.min(...arr.map((p) => p[ax2])), Math.max(...arr.map((p) => p[ax2]))] : null;
  // 窗/框按三角形质心 x 聚类（顶点只在盒缘，直接聚顶点会把单樘窗切成两簇；
  // 非索引几何每 3 顶点一面片，居中门两樘间空隙=门宽+2×0.1，阈值 1.5：盒内最大质心距≈窗宽/2（修后≤1.82 的子簇约束与整樘等价），居中门两樘间质心距≥1.77）；
  // 簇的区间取成员三角形顶点极值（质心会低估盒缘）。
  const clusters = (arr) => {
    if (!arr.length) return [];
    const tris = [];
    for (let i = 0; i < arr.length; i += 3) {
      const vs = [arr[i], arr[i + 1], arr[i + 2]];
      tris.push({
        cx: (vs[0][0] + vs[1][0] + vs[2][0]) / 3,
        x: [Math.min(...vs.map((v) => v[0])), Math.max(...vs.map((v) => v[0]))],
        y: [Math.min(...vs.map((v) => v[1])), Math.max(...vs.map((v) => v[1]))],
        z: [Math.min(...vs.map((v) => v[2])), Math.max(...vs.map((v) => v[2]))],
      });
    }
    tris.sort((a, b) => a.cx - b.cx);
    const out = [[tris[0]]];
    for (const t of tris.slice(1)) (t.cx - out[out.length - 1].at(-1).cx > 1.5 ? out.push([t]) : out[out.length - 1].push(t));
    return out.map((g) => ({
      x: [Math.min(...g.map((t) => t.x[0])), Math.max(...g.map((t) => t.x[1]))],
      z: [Math.min(...g.map((t) => t.z[0])), Math.max(...g.map((t) => t.z[1]))],
      y: [Math.min(...g.map((t) => t.y[0])), Math.max(...g.map((t) => t.y[1]))],
      zMean: g.reduce((s, t) => s + (t.z[0] + t.z[1]) / 2, 0) / g.length,
    }));
  };
  const doorX = extent(part.door, 0);
  const wins = clusters(part.window);
  const frms = clusters(part.frame);
  const pilX = Math.max(...part.pilaster.map((p) => Math.abs(p[0])), 0);
  const pilIn = pilX > 0 ? pilX - 0.16 : w / 2 - 0.16;    // 壁柱内缘（壁柱宽 0.16，从壁柱顶点实测）
  const gap = (a, b) => !a || !b ? Infinity : Math.max(a[0] - b[1], b[0] - a[1]);
  // T1 门窗自由区间非重叠（每樘窗/框与门至少 0.04 缝）
  for (const cl of [...wins, ...frms]) {
    const sep = gap(cl.x, doorX);
    if (sep < 0.04 - 1e-6) offenders.doorSep.push(`${tag} 窗/框 x=[${cl.x[0].toFixed(3)},${cl.x[1].toFixed(3)}] → 门缝 ${sep.toFixed(3)}`);
  }
  // T2 窗/框不出开间（面板 ±w/2）; T3 不与边柱不合理交叉（框缘距壁柱内缘 ≥0.015 气隙）
  for (const cl of [...wins, ...frms]) {
    const lim = Math.max(Math.abs(cl.x[0]), Math.abs(cl.x[1]));
    stats.worstBoundary = Math.max(stats.worstBoundary, lim - w / 2);
    if (lim > w / 2 - 0.005) offenders.boundary.push(`${tag} 窗/框缘 |x|=${lim.toFixed(3)} > 开间 ${(w / 2).toFixed(3)}`);
    stats.worstPilaster = Math.max(stats.worstPilaster, lim - pilIn);
    if (lim > pilIn - 0.015 + 1e-6) offenders.pilaster.push(`${tag} 窗/框缘 |x|=${lim.toFixed(3)} > 壁柱内缘 ${pilIn.toFixed(3)}`);
  }
  if (wins.length) {
    stats.windowBoxes += wins.length;
    for (const cl of wins) {
      // T4 不藏墙：窗正面凸出面板前脸(0.08)且背面不沉过面板中面
      if (cl.z[1] < 0.14 || cl.z[0] < 0.05) offenders.sunk.push(`${tag} 窗 z=[${cl.z[0].toFixed(3)},${cl.z[1].toFixed(3)}]`);
      // T5 窗是真实窗，不是零宽残片
      if (cl.x[1] - cl.x[0] < 0.5) offenders.tiny.push(`${tag} 窗宽 ${(cl.x[1] - cl.x[0]).toFixed(3)}`);
      // T6 继承朝向：窗带在底层临街带 y∈[0.3,1.9]，且位于正面一侧（本地 z 均值>0）
      if (cl.y[0] < 0.3 || cl.y[1] > 1.9 || cl.zMean <= 0.05) offenders.orient.push(`${tag} 窗带 y=[${cl.y[0].toFixed(2)},${cl.y[1].toFixed(2)}] z̄=${cl.zMean.toFixed(3)}`);
    }
    stats.withWindow++;
  }
}
// 每个布局开间恰好消费一个节点
ok('one-node-per-bay', used.size === bays.length, `消费 ${used.size}/${bays.length}`);
ok('door-window-free-intervals-disjoint', offenders.doorSep.length === 0, `${offenders.doorSep.length} 间门窗重叠: ${offenders.doorSep.slice(0, 3).join(' | ')}`);
ok('window-frame-within-bay-bounds', offenders.boundary.length === 0, `${offenders.boundary.length} 间越开间边界(最大越 ${stats.worstBoundary.toFixed(3)}m): ${offenders.boundary.slice(0, 3).join(' | ')}`);
ok('window-frame-clear-of-pilasters', offenders.pilaster.length === 0, `${offenders.pilaster.length} 间穿壁柱内缘(最大越 ${stats.worstPilaster.toFixed(3)}m): ${offenders.pilaster.slice(0, 3).join(' | ')}`);
ok('window-not-sunk-into-wall', offenders.sunk.length === 0, offenders.sunk.slice(0, 3).join(' | '));
ok('window-is-real-not-degenerate', offenders.tiny.length === 0, offenders.tiny.slice(0, 3).join(' | '));
ok('storefront-band-orientation-inherited', offenders.orient.length === 0, offenders.orient.slice(0, 3).join(' | '));
ok('storefront-glazing-present', stats.withWindow >= Math.floor(bays.length * 0.7), `有窗开间 ${stats.withWindow}/${bays.length}`);
console.log(`facade-bay-fit: ${bays.length} 开间全检, 有窗 ${stats.withWindow}, 窗盒 ${stats.windowBoxes}, 最差越边界 ${stats.worstBoundary.toFixed(3)}m, 最差越壁柱 ${stats.worstPilaster.toFixed(3)}m`);
if (nfail) { console.log(`FAILED ${nfail} (pass ${npass})`); process.exit(1); }
console.log(`ALL PASS (${npass})`);
