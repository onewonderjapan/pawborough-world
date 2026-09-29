// wave14-stalllight B：老城隍庙南侧过街楼街廊（anchor-old-south）檐灯补光——放置与灯光接线对账。
// 期望值独立重算：本文件按「pinned 冻结路线 old-south 第一段 + baseline/layout.json 建筑边」自己重算灯位
// （规则定义见 build_bazaar_stalls.py OLDSOUTH_* 常量注释；两实现独立，对账误差 ≤0.02 m / ≤0.01 rad）。
// 判据：
//   B1 records/lamps.json 恰有 6 盏（每侧 t=5/15/25），id/位置/朝向 = 独立重算值；
//      每盏贴墙（重算墙距 −0.22 m 回退）、面朝走廊（rotY = 墙法线朝走廊）。
//   B2 每盏灯位置在 tour 主体观测几何内：距走廊中线横向 ≤ 8 m（立面带盒半宽 HALF_W+FACADE_BAND_M=7.4 的来源侧）、
//      沿走廊 0 ≤ t ≤ 30.2（第一段长度）——灯照亮的墙面才是 anchor 掩膜主体（灯本体在走廊盒半宽 1.4 m 之外不算）。
//   B3 presets 接线：oldsouth-lamp 发光组（materials=[olds-lantern]，intensity>0）+ oldsouth-lamp node-anchor 源
//      （pattern 匹配 lamp id、offsetY ∈ (1.8,2.2)——罩底缘 2.19 下方、灯在罩外）+ pointLights.max 仍 ≤ 8。
//   B4 灯具 GLB 存在且含 olds-lantern 材质、tri 预算内（≤400）。
// 负例（LAMPS_NEG=drift）：把第 1 盏灯位置沿走廊漂移 3 m 后对账 → B1 红。
// 用法：[LAMPS_NEG=drift] node tests/oldsouth-lamps-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEG = process.env.LAMPS_NEG || null;

const FACADE_KINDS = new Set(['outerBuilding', 'bazaarBlock', 'tower', 'hall', 'xuan', 'pavilion', 'corridor',
  'waterside', 'stage', 'watersideGallery', 'facadeBay', 'shopAnchor', 'templeAnchor', 'wall', 'wallHead',
  'moonGateWall', 'gateAnchor']);
const TS = [5, 15, 25], SETBACK = 0.22;

// ---- 独立重算（与生成器同规则、独立实现） ----
const pin = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'commercial-route.pinned.json'), 'utf8'));
const route = pin.routes.find(r => r.from === 'old-south');
const p0 = route.points[0], p1 = route.points[1];
const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
const d = [(p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L];
const lay = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const cross = (pt) => { const vx = pt[0] - p0[0], vy = pt[1] - p0[1]; return vx * (-d[1]) + vy * d[0]; };
const tproj = (pt) => { const vx = pt[0] - p0[0], vy = pt[1] - p0[1]; return vx * d[0] + vy * d[1]; };
const edges = [];
for (const o of lay.objects) {
  if (!FACADE_KINDS.has(o.kind)) continue;
  const fp = o.geometry?.footprint;
  if (!fp) continue;
  const pts = fp[0] === fp[fp.length - 1] ? fp.slice(0, -1) : fp;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const smp = Array.from({ length: 21 }, (_, k) => [a[0] + (b[0] - a[0]) * k / 20, a[1] + (b[1] - a[1]) * k / 20]);
    const cs = smp.map(cross);
    const sides = new Set(cs.map(c => (c > 0 ? 1 : -1)));
    if (sides.size !== 1) continue;
    const lats = cs.map(Math.abs), ts = smp.map(tproj);
    const cover = Math.min(Math.max(...ts), L) - Math.max(Math.min(...ts), 0);
    if (cover < 8 || Math.max(...lats) > 8 || Math.min(...lats) < 0.3) continue;
    edges.push({ side: [...sides][0], a, b, id: o.id });
  }
}
const wallpoint = (e, t) => {
  const ta = tproj(e.a), tb = tproj(e.b);
  if (tb === ta) return null;
  const u = (t - ta) / (tb - ta);
  if (!(u >= 0 && u <= 1)) return null;
  const x = e.a[0] + (e.b[0] - e.a[0]) * u, z = e.a[1] + (e.b[1] - e.a[1]) * u;
  return [x, z, Math.abs(cross([x, z]))];
};
const expect = [];
for (const t of TS) {
  for (const side of [1, -1]) {
    const cand = [];
    for (const e of edges) {
      if (e.side !== side) continue;
      const wp = wallpoint(e, t);
      if (wp) cand.push([wp[2], e, wp]);
    }
    if (!cand.length) continue;
    cand.sort((x, y) => x[0] - y[0]);
    const [lat, e, wp] = cand[0];
    let bx = e.b[0] - e.a[0], bz = e.b[1] - e.a[1];
    const bl = Math.hypot(bx, bz); bx /= bl; bz /= bl;
    let nx = bz, nz = -bx;
    let gx = p0[0] + d[0] * t - wp[0], gz = p0[1] + d[1] * t - wp[1];
    const gl = Math.hypot(gx, gz); gx /= gl; gz /= gl;
    if (nx * gx + nz * gz < 0) { nx = -nx; nz = -nz; }
    expect.push({ id: `oldsouth-lamp-${expect.length + 1}`, t, side, wall: e.id, lat,
      position: [wp[0] + nx * SETBACK, wp[1] + nz * SETBACK], rotY: Math.atan2(nx, nz) });
  }
}

// ---- 对账 ----
const recFile = path.join(ROOT, 'modules', 'bazaar-stalls', 'records', 'lamps.json');
const rec = JSON.parse(fs.readFileSync(recFile, 'utf8'));
const lamps = rec.lamps.map(l => ({ ...l }));
if (NEG === 'drift' && lamps[0]) { lamps[0] = { ...lamps[0], position: [lamps[0].position[0] + d[0] * 3, lamps[0].position[1] + d[1] * 3] }; }

let fails = 0;
const fail = (m) => { console.error('FAIL ' + m); fails++; };
const ok = (m) => console.log('PASS ' + m);
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// B1 数量与逐盏对账
if (lamps.length !== expect.length) fail(`B1 灯数 ${lamps.length} ≠ 独立重算 ${expect.length}`);
for (let i = 0; i < Math.min(lamps.length, expect.length); i++) {
  const g = lamps[i], e = expect[i];
  if (g.id !== e.id) fail(`B1 ${g.id} 顺序错位（期望 ${e.id}）`);
  if (!near(g.position[0], e.position[0], 0.02) || !near(g.position[1], e.position[1], 0.02))
    fail(`B1 ${g.id} 位置 (${g.position.map(v => v.toFixed(2))}) ≠ 重算 (${e.position.map(v => v.toFixed(2))})，贴墙/规则失配`);
  if (!near(g.rotY, e.rotY, 0.01)) fail(`B1 ${g.id} rotY ${g.rotY} ≠ 重算 ${e.rotY.toFixed(4)}（未面朝走廊）`);
  if (g.wall !== e.wall) fail(`B1 ${g.id} 挂墙 ${g.wall} ≠ 重算 ${e.wall}`);
}
if (!fails) ok(`B1 ${lamps.length} 盏灯位置/朝向/挂墙与独立重算逐盏一致（贴墙 0.22 m）`);

// B2 主体观测几何内
for (const g of lamps) {
  const vx = g.position[0] - p0[0], vz = g.position[1] - p0[1];
  const t = vx * d[0] + vz * d[1], lat = Math.abs(vx * (-d[1]) + vz * d[0]);
  if (!(t >= 0 && t <= L + 0.5)) fail(`B2 ${g.id} 走廊投影 t=${t.toFixed(1)} 超出第一段 [0,${L.toFixed(1)}]`);
  if (lat > 8) fail(`B2 ${g.id} 横向 ${lat.toFixed(1)} m > 8 m（立面带盒之外，照亮的面不在主体掩膜）`);
}
if (!fails || fails === lamps.length * 0) ok('B2 全部灯位在走廊段内、横向 ≤8 m（立面带盒内）');

// B3 presets 接线
const P = JSON.parse(fs.readFileSync(path.join(ROOT, 'lighting', 'presets.json'), 'utf8'));
const grp = (P.emissiveGroups || []).find(g => g.id === 'oldsouth-lamp');
if (!grp) fail('B3 presets 无 oldsouth-lamp 发光组');
else {
  if (JSON.stringify(grp.materials) !== JSON.stringify(['olds-lantern'])) fail(`B3 oldsouth-lamp 组材质异常: ${grp.materials}`);
  if (!(grp.intensity > 0)) fail(`B3 oldsouth-lamp 组 intensity=${grp.intensity}`);
}
const src = (P.pointLights.sources || []).find(s => s.id === 'oldsouth-lamp');
if (!src) fail('B3 presets.pointLights.sources 无 oldsouth-lamp 源');
else {
  if (src.kind !== 'node-anchor') fail(`B3 源 kind=${src.kind} ≠ node-anchor`);
  const re = new RegExp(src.pattern);
  if (!lamps.every(l => re.test(l.id))) fail(`B3 pattern ${src.pattern} 不匹配全部灯 id`);
  if (!(src.offsetY > 1.8 && src.offsetY < 2.2)) fail(`B3 源 offsetY=${src.offsetY} 不在 (1.8,2.2)——须在罩底缘 2.19 附近下方（灯在罩外，防 Cycles 罩体遮光）`);
}
if (P.pointLights.max !== 8) fail(`B3 pointLights.max=${P.pointLights.max} 应保持 8（池容量不变，见 SUMMARY 分配影响分析）`);
if (!fails || !fails) ok(`B3 接线：oldsouth-lamp 组 + node-anchor 源 offsetY=${src?.offsetY}，max=8 不变`);

// B4 灯具 GLB
const glb = path.join(ROOT, process.env.STALL_DIR || 'out-bazaar-stalls', 'oldsouth-lamp.glb');
if (!fs.existsSync(glb)) fail(`B4 灯具 GLB 缺失: ${glb}`);
else {
  const b = fs.readFileSync(glb);
  const jl = b.readUInt32LE(12);
  const g = JSON.parse(b.slice(20, 20 + jl).toString('utf8'));
  const mats = (g.materials || []).map(m => m.name);
  if (!mats.includes('olds-lantern')) fail(`B4 灯具 GLB 无 olds-lantern 材质: ${mats}`);
  let tris = 0;
  for (const mesh of g.meshes || []) for (const p of mesh.primitives) {
    const a = g.accessors[p.indices];
    tris += a.count / 3;
  }
  if (tris > 400) fail(`B4 灯具 tris=${tris} > 预算 400`);
  else if (mats.includes('olds-lantern')) ok(`B4 灯具 GLB ${tris} tris ≤ 400，含 olds-lantern`);
}

console.log(`${NEG ? '[NEG ' + NEG + '] ' : ''}oldsouth-lamps-test: ${fails} failure(s)`);
if (NEG) {
  if (!fails) { console.error(`负例 ${NEG} 未变红——测试抓不住该故障`); process.exit(1); }
  console.log(`负例 ${NEG} 如预期 FAIL`);
  process.exit(0);
}
process.exit(fails ? 1 : 0);
