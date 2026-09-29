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
ok(`庙东跨院对象齐：楼 ${towers.length}=3 厅 ${halls.length}=2 店屋 ${shops.length}≥6 樟 ${trees.length}=4 宝鼎 ${ding ? 1 : 0}=1 铺地 ${paving ? 1 : 0}=1`,
  towers.length === 3 && halls.length === 2 && shops.length >= 6 && trees.length === 4 && !!ding && !!paving);

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
