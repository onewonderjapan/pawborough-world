// wave14-templeeast：庙东跨院（方案 B + 临街铺面，机主 2026-09-29）回归。
// 期望值一律从 baseline/layout.json、src/layout.mjs（重跑生成器）与只读模块 GLB（resources/temple-v3、resources/shops）重算，
// 不拿本单产物和自己比。
//   A 生成器一致：临时目录重跑 src/layout.mjs，temple-wall 与全部 templeeast-* 对象/实例与 baseline 逐字段相同；
//     temple-wall 悬空段已在生成端丢掉（layout 无可再丢）。
//   B 几何净距（layout + 只读模块几何）：
//     B1 所有楼/厅/店屋平面 ≥0.6 m 离开 temple-wall 每一段（含厚度 0.45 的半厚）；
//     B2 店屋前墙不进安仁街路面（到路中线 ≥ 路宽/2）；
//     B3 楼、厅、店屋两两不相交；楼背与店屋后墙之间留 ≥1.0 m 避弄；
//     B4 不压既有庙轴模块：court3 / 前院 / 大殿院 / 东配殿 / 东廊庑 / 东侧樟 的 GLB 顶点（按 layout 实例位姿变换）
//        不落进任何新平面，且平面外扩 0.5 m 内无这些顶点（y < 3 m 的墙体部分）；
//     B5 樟树、宝鼎位于院内（铺地多边形内）且不压任何新平面；树冠（半径 3.3 m）不进两层楼墙线。
//   C 分件（有 OUT_DIR/zones-manifest.json 时）：zone-temple-5.glb 存在、≤12 MB、role=temple-east；
//     全部 templeeast 锚/节点只在 temple-5 出现，其它庙区分件一个都没有。
//   D 碰撞（有 OUT_DIR/collision-temple.json 时）：每个 templeeast 对象都有碰撞记录；temple-wall:seg-19 缺席、seg-18/20 在。
//   B6（R1，astra 必修）横厅东侧南北过道——从 layout + hall-kit defaults 独立推台基外扩与楼门前踏步包络：
//      净宽 = 楼台基西缘 − 横厅台基东缘 ≥ 0.8 m；踏步块与横厅台基沿 z 间隔 ≥ 0.8 m（出入口不被夹窄）。
//   E（R1）碰撞包络连续通道（有 collision-temple.json 时）：把庙区碰撞盒（顶 > 0.30 m 自动跨步上限、底 < 1.9 m）
//      按 0.05 m 栅格投到庙轴本地系 x∈[16.5,24.3]（只留横厅与楼之间，不许绕安仁街/避弄），膨胀 0.40 m（通道 ≥0.8 m）后
//      南院 → 中院 → 北院必须连通；并报告两段过道逐行最小净宽。TEMPLEEAST_COLLISION 可指定别的 collision-temple.json（负例）。
// 用法：OUT_DIR=out-zone node tests/templeeast-test.mjs
//      负例：TEMPLEEAST_LAYOUT=<旧 layout.json> 指向改动前的冻结 layout，A/B 必须 FAIL。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readGlb } from '../../../src/world/glbReader.js';
import { dropFloatingSegments, distToSeg, pointInPoly, segIntersect } from '../src/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const LAYOUT_PATH = process.env.TEMPLEEAST_LAYOUT ? path.resolve(process.env.TEMPLEEAST_LAYOUT) : path.join(ROOT, 'baseline', 'layout.json');
const L = JSON.parse(fs.readFileSync(LAYOUT_PATH, 'utf8'));
const HK_DEF = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'hall-kit', 'defaults.json'), 'utf8'));
let pass = 0, fail = 0, skipped = 0;
const failures = [];
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS', name); } else { fail++; failures.push(name); console.log('FAIL', name, extra); } };
const skip = (name, why) => { skipped++; console.log('SKIP', name, '—', why); };

const byId = new Map(L.objects.map(o => [o.id, o]));
const te = L.objects.filter(o => o.id.startsWith('templeeast-'));
const teInst = L.instances.filter(i => i.id.startsWith('templeeast-'));
const ring = fp => (fp[0][0] === fp.at(-1)[0] && fp[0][1] === fp.at(-1)[1]) ? fp.slice(0, -1) : fp;
const edges = fp => { const r = ring(fp); return r.map((p, i) => [p, r[(i + 1) % r.length]]); };
const polyDist = (A, B) => {           // 两多边形边界最小距离（相交返回 0）
  for (const [a, b] of edges(A)) for (const [c, d] of edges(B)) if (segIntersect(a, b, c, d)) return 0;
  if (ring(A).some(p => pointInPoly(p, ring(B))) || ring(B).some(p => pointInPoly(p, ring(A)))) return 0;
  let m = Infinity;
  for (const p of ring(A)) for (const [c, d] of edges(B)) m = Math.min(m, distToSeg(p, c, d));
  for (const p of ring(B)) for (const [c, d] of edges(A)) m = Math.min(m, distToSeg(p, c, d));
  return m;
};

// ---------- 计数下限（防零执行） ----------
const towers = te.filter(o => o.kind === 'tower'), halls = te.filter(o => o.kind === 'hall');
const shops = te.filter(o => o.kind === 'shopAnchor');
const trees = teInst.filter(i => i.module === 'temple-tree-camphor'), ding = teInst.find(i => i.module === 'templeeast-ding');
const paving = byId.get('templeeast-paving');
const complete = towers.length === 3 && halls.length === 2 && shops.length >= 6 && trees.length === 4 && !!ding && !!paving;
ok(`庙东跨院对象齐：楼 ${towers.length}=3 厅 ${halls.length}=2 店屋 ${shops.length}≥6 樟 ${trees.length}=4 宝鼎 ${ding ? 1 : 0}=1 铺地 ${paving ? 1 : 0}=1`, complete);
if (!complete) {   // 旧 layout 负例：正常汇总失败退出（不让后续断言因缺对象抛 TypeError）
  console.log(`\ntempleeast-test: ${pass} pass, ${fail} fail, ${skipped} skipped（对象不齐，其余断言不执行）`);
  for (const f of failures) console.log('  FAIL:', f);
  process.exit(1);
}

// ---------- A 生成器一致 ----------
{
  const tw = byId.get('temple-wall');
  ok(`A0 temple-wall 在 layout 已无悬空段（${tw.geometry.segments.length} 段，再过滤剩 ${dropFloatingSegments(tw.geometry.segments).length}）`,
    dropFloatingSegments(tw.geometry.segments).length === tw.geometry.segments.length && (tw.droppedFloating || []).length >= 1);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'templeeast-gen-'));
  try {
    execFileSync('node', [path.join(ROOT, 'src', 'layout.mjs')], { cwd: ROOT, env: { ...process.env, OUT_DIR: tmp }, stdio: 'pipe' });
    const G = JSON.parse(fs.readFileSync(path.join(tmp, 'layout.json'), 'utf8'));
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const gObj = new Map(G.objects.map(o => [o.id, o])), gInst = new Map(G.instances.map(i => [i.id, i]));
    ok('A1 temple-wall = 生成器输出（逐字段）', eq(byId.get('temple-wall'), gObj.get('temple-wall')));
    const genTe = G.objects.filter(o => o.id.startsWith('templeeast-'));
    ok(`A2 templeeast 对象集合 = 生成器（${te.length} / ${genTe.length}）`, genTe.length > 0 && eq(te.map(o => o.id).sort(), genTe.map(o => o.id).sort()));
    const diffObj = te.filter(o => !eq(o, gObj.get(o.id))).map(o => o.id);
    ok(`A3 templeeast 对象逐字段 = 生成器（不同 ${diffObj.length}）`, te.length > 0 && diffObj.length === 0, diffObj.slice(0, 5).join(','));
    const genTeInst = G.instances.filter(i => i.id.startsWith('templeeast-'));
    ok(`A4a templeeast 实例集合 = 生成器（${teInst.length} / ${genTeInst.length}）`, genTeInst.length > 0 && eq(teInst.map(i => i.id).sort(), genTeInst.map(i => i.id).sort()));
    const diffInst = teInst.filter(i => !eq(i, gInst.get(i.id))).map(i => i.id);
    ok(`A4 templeeast 实例逐字段 = 生成器（${teInst.length} 件，不同 ${diffInst.length}）`, teInst.length >= 11 && diffInst.length === 0, diffInst.slice(0, 5).join(','));
    ok('A5 顶层 templeEast 记录 = 生成器', !!L.templeEast && eq(L.templeEast, G.templeEast));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// ---------- B 几何净距 ----------
const plan = [...towers.map(o => ({ id: o.id, fp: o.geometry.footprint, kind: 'tower' })),
  ...halls.map(o => ({ id: o.id, fp: o.geometry.footprint, kind: 'hall' })),
  ...shops.map(o => ({ id: o.id, fp: o.unitFootprint, kind: 'shop' }))];
{
  const segs = byId.get('temple-wall').geometry.segments;
  let worst = Infinity, worstId = null;
  for (const p of plan) for (const [a, b] of segs) {
    const d = polyDist(p.fp, [a, b, b]) - 0.45 / 2;
    if (d < worst) { worst = d; worstId = p.id; }
  }
  ok(`B1 新平面离庙墙每段 ≥0.6 m（最近 ${worst.toFixed(2)} m @${worstId}，${plan.length} 件 × ${segs.length} 段）`, plan.length >= 11 && worst >= 0.6);
  const roads = L.objects.filter(o => o.kind === 'road' && o.name === '安仁街' && o.geometry.polyline);
  let rmin = Infinity;
  for (const s of shops) for (const p of ring(s.unitFootprint)) for (const road of roads) {
    let d = Infinity; const pl = road.geometry.polyline;
    for (let i = 1; i < pl.length; i++) d = Math.min(d, distToSeg(p, pl[i - 1], pl[i]));
    rmin = Math.min(rmin, d - road.geometry.width / 2);
  }
  ok(`B2 店屋不进安仁街路面（最近 ${rmin.toFixed(2)} m ≥ 0）`, shops.length > 0 && rmin >= 0);
  let overlap = [], back = Infinity;
  for (let i = 0; i < plan.length; i++) for (let j = i + 1; j < plan.length; j++) {
    const d = polyDist(plan[i].fp, plan[j].fp);
    const bothShops = plan[i].kind === 'shop' && plan[j].kind === 'shop';
    if (!bothShops && d < 1e-6) overlap.push(`${plan[i].id}×${plan[j].id}`);
    if ((plan[i].kind === 'tower' && plan[j].kind === 'shop') || (plan[i].kind === 'shop' && plan[j].kind === 'tower')) back = Math.min(back, d);
  }
  ok(`B3 楼/厅/店屋两两不相交（${overlap.length}）`, overlap.length === 0, overlap.slice(0, 4).join(' '));
  ok(`B3b 楼背与店屋后墙避弄 ≥1.0 m（${back.toFixed(3)} m）`, Number.isFinite(back) && back >= 1.0 - 1e-6);
  // B4 既有庙轴模块几何（只读 GLB，按 layout 实例位姿），墙/柱（y<3 m）的顶点
  const MODS = ['temple-court3', 'temple-entrycourt', 'temple-dadiancourt', 'temple-peidian-e', 'temple-gallery-e', 'temple-tree-court2-e', 'temple-tree-court3-e'];
  const pts = [];
  for (const id of MODS) {
    const inst = L.instances.find(i => i.id === id);
    const { meshes } = readGlb(fs.readFileSync(path.join(ROOT, 'resources', 'temple-v3', inst.file)));
    const c = Math.cos(inst.rotY), s = Math.sin(inst.rotY);
    for (const m of meshes) {
      const M = m.matrix;
      for (let k = 0; k < m.positions.length; k += 3) {
        const x = m.positions[k], y = m.positions[k + 1], z = m.positions[k + 2];
        const wx0 = M[0] * x + M[4] * y + M[8] * z + M[12], wy = M[1] * x + M[5] * y + M[9] * z + M[13], wz0 = M[2] * x + M[6] * y + M[10] * z + M[14];
        if (wy > 3) continue;
        pts.push([inst.position[0] + wx0 * c + wz0 * s, inst.position[1] - wx0 * s + wz0 * c, id]);
      }
    }
  }
  let hits = [], near = Infinity;
  for (const p of plan) for (const q of pts) {
    if (pointInPoly([q[0], q[1]], ring(p.fp))) { hits.push(`${p.id}<-${q[2]}`); continue; }
    for (const [a, b] of edges(p.fp)) near = Math.min(near, distToSeg([q[0], q[1]], a, b));
  }
  ok(`B4 新平面不压既有庙轴模块（顶点 ${pts.length}，落入 ${hits.length}，最近 ${near.toFixed(2)} m ≥0.5）`, pts.length > 1000 && hits.length === 0 && near >= 0.5, [...new Set(hits)].slice(0, 4).join(' '));
  // B5 樟 / 宝鼎
  const pav = ring(paving.geometry.footprint);
  const obj = [...trees, ding];
  const inPave = obj.filter(i => pointInPoly(i.position, pav)).length;
  ok(`B5 樟 ${trees.length} + 宝鼎 1 都在铺地内（${inPave}/${obj.length}）`, inPave === obj.length);
  let crown = Infinity, onPlan = [];
  for (const t of obj) for (const p of plan) {
    if (pointInPoly(t.position, ring(p.fp))) onPlan.push(`${t.id}@${p.id}`);
    if (t.module === 'temple-tree-camphor' && p.kind === 'tower') for (const [a, b] of edges(p.fp)) crown = Math.min(crown, distToSeg(t.position, a, b));
  }
  ok(`B5b 樟/宝鼎不压平面（${onPlan.length}），樟到两层楼墙线 ≥3.3 m（${crown.toFixed(2)}）`, onPlan.length === 0 && crown >= 3.3, onPlan.join(' '));
}

// ---------- B6 横厅东侧过道（layout + hall-kit defaults 独立推台基 / 踏步包络） ----------
const sm = L.instances.find(i => i.id === 'temple-shanmen');
const [OX, OZ] = sm.position, TH0 = sm.rotY, C0 = Math.cos(TH0), S0 = Math.sin(TH0);
const toLocal = ([x, z]) => [(x - OX) * C0 - (z - OZ) * S0, (x - OX) * S0 + (z - OZ) * C0];
const rectLocal = fp => { const q = ring(fp).map(toLocal); const xs = q.map(p => p[0]), zs = q.map(p => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) }; };
{
  const PO = HK_DEF.platformOut, tread = HK_DEF.stepTread, stepW = HK_DEF.stepWidth;
  const platY = k => (HK_DEF.kinds?.[k]?.platformY ?? HK_DEF.platformY);
  let minW = Infinity, minZ = Infinity, pairs = 0;
  for (const h of halls) {
    const hr = rectLocal(h.geometry.footprint), hp = { x1: hr.x1 + PO, z0: hr.z0 - PO, z1: hr.z1 + PO };
    for (const t of towers) {
      const tr = rectLocal(t.geometry.footprint), tp = { x0: tr.x0 - PO, z0: tr.z0 - PO, z1: tr.z1 + PO };
      if (tp.z1 < hp.z0 || tp.z0 > hp.z1) continue;
      pairs++;
      minW = Math.min(minW, tp.x0 - hp.x1);
      // 楼门脸朝 −X，踏步居楼段中：台基外 n·tread，宽 stepWidth（build_hall.py：n = max(3, ceil(platformY/0.18))）
      const n = Math.max(3, Math.ceil(platY('tower') / 0.18)), zc = (tr.z0 + tr.z1) / 2;
      const st = { x0: tp.x0 - n * tread, z0: zc - stepW / 2, z1: zc + stepW / 2 };
      if (st.x0 < hp.x1 + 0.8) {   // 踏步伸进过道：与横厅台基沿 z 的间隔
        const gap = st.z1 < hp.z0 ? hp.z0 - st.z1 : st.z0 > hp.z1 ? st.z0 - hp.z1 : -Math.min(st.z1, hp.z1) + Math.max(st.z0, hp.z0);
        minZ = Math.min(minZ, gap);
      }
    }
  }
  ok(`B6 横厅东侧过道净宽（台基包络）≥0.8 m（最窄 ${minW.toFixed(3)} m，${pairs} 对）`, pairs >= 2 && minW >= 0.8);
  ok(`B6b 楼门前踏步与横厅台基沿 z 间隔 ≥0.8 m（${Number.isFinite(minZ) ? minZ.toFixed(3) : '无相邻踏步'}）`, !Number.isFinite(minZ) || minZ >= 0.8);
}

// ---------- E 碰撞包络连续通道 ----------
const ctFile = process.env.TEMPLEEAST_COLLISION ? path.resolve(process.env.TEMPLEEAST_COLLISION) : path.join(OUT, 'collision-temple.json');
if (fs.existsSync(ctFile)) {
  const { obbToWorld } = await import('../../../src/world/collisionAdapter.js');
  const ct = JSON.parse(fs.readFileSync(ctFile, 'utf8'));
  const STEP = 0.05, X0 = 16.5, X1 = 24.3, Z0 = -72.0, Z1 = -4.0, RAD = 0.40, STEP_UP = 0.30;
  const NX = Math.round((X1 - X0) / STEP), NZ = Math.round((Z1 - Z0) / STEP);
  const occ = new Uint8Array(NX * NZ);
  let used = 0;
  for (const c of ct.colliders) {
    const w = obbToWorld(c);
    const yb = w.center[1] - w.halfExtents[1], yt = w.center[1] + w.halfExtents[1];
    if (yt <= STEP_UP + 1e-6 || yb >= 1.9) continue;
    const [hx, , hz] = w.halfExtents, cy = Math.cos(w.yaw), sy = Math.sin(w.yaw);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => toLocal([w.center[0] + a * hx * cy + b * hz * sy, w.center[2] - a * hx * sy + b * hz * cy]));
    const xs = corners.map(p => p[0]), zs = corners.map(p => p[1]);
    if (Math.max(...xs) < X0 || Math.min(...xs) > X1 || Math.max(...zs) < Z0 || Math.min(...zs) > Z1) continue;
    used++;
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - X0) / STEP)), i1 = Math.min(NX - 1, Math.ceil((Math.max(...xs) - X0) / STEP));
    const k0 = Math.max(0, Math.floor((Math.min(...zs) - Z0) / STEP)), k1 = Math.min(NZ - 1, Math.ceil((Math.max(...zs) - Z0) / STEP));
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const p = [X0 + (i + 0.5) * STEP, Z0 + (k + 0.5) * STEP];
      if (pointInPoly(p, corners)) occ[k * NX + i] = 1;
    }
  }
  // 逐行过道净宽（横厅 z 范围内，从 x=23.5 向两侧找第一块障碍）
  const rowWidth = (zl) => { const k = Math.floor((zl - Z0) / STEP); let i = Math.floor((23.5 - X0) / STEP);
    if (occ[k * NX + i]) return 0; let a = i, b = i; while (a > 0 && !occ[k * NX + a - 1]) a--; while (b < NX - 1 && !occ[k * NX + b + 1]) b++;
    return (b - a + 1) * STEP; };
  const widths = halls.map(h => { const hr = rectLocal(h.geometry.footprint); let m = Infinity;
    for (let zl = hr.z0; zl <= hr.z1; zl += STEP) m = Math.min(m, rowWidth(zl)); return { id: h.id, minWidthM: +m.toFixed(2) }; });
  ok(`E1 碰撞包络过道逐行净宽 ≥0.8 m（${widths.map(w => `${w.id} ${w.minWidthM}`).join('，')}；碰撞盒 ${used}）`, used >= 20 && widths.every(w => w.minWidthM >= 0.8));   // 下限 20：HALL_KIT=0 时楼/厅只有 footprint 薄墙（实测 27 盒），默认 hall-kit 62 盒
  // 膨胀 RAD 后 BFS：南院 → 北院（域限 x ≤ 24.3，只能走横厅东侧过道）
  const r = Math.ceil(RAD / STEP), blocked = new Uint8Array(NX * NZ);
  for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) if (occ[k * NX + i])
    for (let dk = -r; dk <= r; dk++) for (let di = -r; di <= r; di++) {
      if (di * di + dk * dk > r * r) continue; const kk = k + dk, ii = i + di;
      if (kk >= 0 && kk < NZ && ii >= 0 && ii < NX) blocked[kk * NX + ii] = 1;
    }
  for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) if (X0 + (i + 0.5) * STEP > X1 - RAD) blocked[k * NX + i] = 1;
  const cell = ([x, z]) => Math.floor((z - Z0) / STEP) * NX + Math.floor((x - X0) / STEP);
  const reach = (from, to) => { const seen = new Uint8Array(NX * NZ); const q = [cell(from)]; if (blocked[q[0]]) return 'seed-blocked';
    seen[q[0]] = 1; while (q.length) { const c = q.pop(); if (c === cell(to)) return true; const i = c % NX, k = (c - i) / NX;
      for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, kk = k + dk; if (ii < 0 || kk < 0 || ii >= NX || kk >= NZ) continue;
        const n = kk * NX + ii; if (!seen[n] && !blocked[n]) { seen[n] = 1; q.push(n); } } } return false; };
  const SOUTH = [22.0, -16.0], MID = [22.0, -31.0], NORTH = [22.0, -57.0];
  const sm2 = reach(SOUTH, MID), mn = reach(MID, NORTH);
  ok(`E2 胶囊 0.8 m 通道连通：南院→中院 ${sm2}，中院→北院 ${mn}（域 x∈[${X0},${X1}]，不绕街）`, sm2 === true && mn === true);
} else skip('E 碰撞包络通道', `${ctFile} 不存在`);

// ---------- C 分件 ----------
const manPath = path.join(OUT, 'zones-manifest.json');
if (fs.existsSync(manPath)) {
  const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  const t5 = man.zones.find(z => z.id === 'temple' && z.part === 5);
  ok(`C1 zones-manifest 有 temple part 5（${t5 && t5.file}）`, !!t5 && t5.file === 'zone-temple-5.glb' && t5.role === 'temple-east');
  if (t5 && t5.file) {
    ok(`C2 zone-temple-5.glb ${t5.bytes} ≤ 12000000`, t5.bytes <= 12000000 && t5.withinCap === true);
    const names = f => new Set((readGlb(fs.readFileSync(path.join(OUT, f))).gltf.nodes || []).map(n => n.name || ''));
    const wantIds = [...te.map(o => o.id)].filter(id => id !== 'templeeast-paving');
    const n5 = names('zone-temple-5.glb');
    // HALL_KIT=1：楼/厅是 hall-kit 锚节点（名 = id）；HALL_KIT=0：程序化件节点名 temple|<id>|<kind>|L1…
    const miss = wantIds.filter(id => !n5.has(id) && ![...n5].some(n => n.startsWith(`temple|${id}|`)));
    ok(`C3 templeeast 锚 ${wantIds.length} 个全在 temple-5（缺 ${miss.length}）`, wantIds.length >= 17 && miss.length === 0, miss.join(','));
    ok('C4 铺地节点 temple|templeeast-paving|plaza|L1 在 temple-5', [...n5].some(n => n.startsWith('temple|templeeast-paving|plaza|L1')));
    const leak = [];
    for (const z of man.zones.filter(z => z.id === 'temple' && z.file && z.part !== 5)) {
      for (const n of names(z.file)) if (n.startsWith('templeeast-') || n.startsWith('temple|templeeast-')) leak.push(`${z.file}:${n}`);
    }
    ok(`C5 其它庙区分件不含 templeeast 节点（${leak.length}）`, leak.length === 0, leak.slice(0, 4).join(' '));
  }
} else skip('C 分件', `${manPath} 不存在（未 ZONE_SPLIT 导出）`);

// ---------- D 碰撞 ----------
const ctPath = path.join(OUT, 'collision-temple.json');
if (fs.existsSync(ctPath)) {
  const ct = JSON.parse(fs.readFileSync(ctPath, 'utf8'));
  const cn = ct.colliders.map(c => c.name);
  const noColl = te.filter(o => o.id !== 'templeeast-paving' && !cn.some(n => n.startsWith(o.id + ':'))).map(o => o.id);
  ok(`D1 templeeast 对象都有碰撞记录（缺 ${noColl.length}，记录 ${cn.filter(n => n.startsWith('templeeast-')).length}）`, noColl.length === 0 && cn.filter(n => n.startsWith('templeeast-')).length >= 20, noColl.join(','));
  ok('D2 temple-wall:seg-19 缺席、seg-18 / seg-20 在（原索引不重编号）', !cn.includes('temple-wall:seg-19') && cn.includes('temple-wall:seg-18') && cn.includes('temple-wall:seg-20'));
  ok('D3 铺地列入庙区地面节点', (ct.extraGroundNodes || []).includes('temple|templeeast-paving|plaza|L1*'));
} else skip('D 碰撞', `${ctPath} 不存在`);

console.log(`\ntempleeast-test: ${pass} pass, ${fail} fail, ${skipped} skipped`);
if (fail > 0) { for (const f of failures) console.log('  FAIL:', f); process.exit(1); }
