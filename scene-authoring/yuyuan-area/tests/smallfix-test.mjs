// night-smallfix-20260926 B2 回归测试：wave8-smallqa FINDINGS #1/#4/#5/#6/#7/#8/#9/#10 的生成器级修复。
// 期望值一律从 baseline/layout.json + 模块 records 重算或用固定设计常量，不拿产物和自己比；
// 模块几何读 out-garden-kits / out-bazaar-stalls 真实旧产物，修前全量失败（artifacts/logs/smallfix-test-before.log）。
//   1) awning-facade-band        #1  檐棚上安装带最高 ≤2.851 m（旧 3.1015，切进立面线脚带 2.915–3.08）、挂帘下沿 ≥2.39 m
//   2) awning-neighbor-clearance #9  布面 × 非宿主块/outer 实体（OUT_DIR procedural GLB）交线 ≤5 条 / 0.5 m
//   3) grill-rack-connectivity   #7  烤架晾杆横杆/串扦 0 悬空块（旧 4 块）
//   4) drink-cabback-clearance   #8  茶饮柜背板顶 ≤ 柜顶板底(棚面) − 0.01 m（旧 −0.02）
//   5) pavilion-rafter-winding   #5  三座正多边形亭椽头盒闭合块体积全为正（旧 70/61/72 块整块反向）
//   6) pavilion-rafter-vs-sheet  #4  5 亭椽头（timber）顶点高出正下方瓦面 >0.02 m 的数量 = 0（旧 24–51/亭，最大 0.088 m）
//   7) pavilion-rect-tile-clean  #6  两座 rect 亭瓦面组朝内/内嵌共面三角 = 0（旧 40/16、72/36，戗脊接头盖帽）
//   8) pavilion-anchor-unique    #10 zone-garden GLB 里每亭恰好 1 个 bld-<id> 锚空节点（旧锚 + .002 空锚）
// 用法：OUT_DIR=out-zone node tests/smallfix-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as Q from './smallqa-lib.mjs';
import * as T from './templeqa-lib.mjs';

const ROOT = Q.ROOT;
const OUT_DIR = process.env.OUT_DIR || 'out-zone';
const OUT = path.resolve(ROOT, OUT_DIR);
let npass = 0, nfail = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { npass++; console.log('PASS', name); }
  else { nfail++; failures.push(`${name}: ${detail}`); console.log('FAIL', name, detail); }
};
const trisOf = (n) => {
  const out = [];
  for (let k = 0; k < n.T.length / 3; k++) {
    const A = [n.P[n.T[k * 3] * 3], n.P[n.T[k * 3] * 3 + 1], n.P[n.T[k * 3] * 3 + 2]];
    const B = [n.P[n.T[k * 3 + 1] * 3], n.P[n.T[k * 3 + 1] * 3 + 1], n.P[n.T[k * 3 + 1] * 3 + 2]];
    const C = [n.P[n.T[k * 3 + 2] * 3], n.P[n.T[k * 3 + 2] * 3 + 1], n.P[n.T[k * 3 + 2] * 3 + 2]];
    out.push({
      A, B, C,
      min: [Math.min(A[0], B[0], C[0]), Math.min(A[1], B[1], C[1]), Math.min(A[2], B[2], C[2])],
      max: [Math.max(A[0], B[0], C[0]), Math.max(A[1], B[1], C[1]), Math.max(A[2], B[2], C[2])],
    });
  }
  return out;
};

// ---------- 1) 檐棚安装带高度（模块 GLB，15 条活动 edge） ----------
{
  const bad = [];
  for (const a of Q.awningInstances()) {
    const mod = Q.readGlbTree(path.join(ROOT, 'out-bazaar-stalls', a.module));
    let clothTop = -Infinity, plateTop = -Infinity, armTop = -Infinity, valBottom = Infinity;
    for (const n of mod.nodes) {
      for (let i = 0; i < n.P.length / 3; i++) {
        const y = n.P[i * 3 + 1];
        if (n.name === 'awning_cloth' && y > clothTop) clothTop = y;
        if (n.name === 'awning_valance') { if (y > clothTop) clothTop = y; if (y < valBottom) valBottom = y; }
        if (n.name === 'awning_bracketPlate' && y > plateTop) plateTop = y;
        if (n.name === 'awning_bracketArm' && y > armTop) armTop = y;
      }
    }
    // 布面/安装板 ≤2.851（避开 2.915–3.08 线脚带）；斜臂盒角随旋出自然高出墙面端 ≤0.03（旧件同形 3.121-3.1015）
    if (clothTop > 2.851 || plateTop > 2.851 || armTop > 2.88 || valBottom < 2.39)
      bad.push({ awning: a.id, clothTopY: +clothTop.toFixed(4), plateTopY: +plateTop.toFixed(4), armTopY: +armTop.toFixed(4), valanceBottomY: +valBottom.toFixed(4) });
  }
  ok('awning-facade-band', bad.length === 0, JSON.stringify(bad));
}

// ---------- 2) 布面 × 非宿主块/outer 实体交叉 ----------
{
  const solidFiles = [['procedural-bazaar.glb', 'bazaar'], ['procedural-outer.glb', 'outer']]
    .map(([f]) => path.join(OUT, f)).filter((p) => fs.existsSync(p));
  if (!solidFiles.length) {
    console.log('SKIP awning-neighbor-clearance -', OUT, 'has no procedural-bazaar/outer.glb (build-scene first)');
  } else {
    const byId = new Map();
    for (const f of solidFiles) {
      const t = Q.readGlbTree(f, { normLimit: 1e6 });
      for (const n of t.nodes) {
        const parts = (n.name || '').split('|');
        const id = parts[1];
        if (!id || !id.startsWith('bld-')) continue;
        if (!byId.has(id)) byId.set(id, []);
        byId.get(id).push(...trisOf(n));
      }
    }
    const cell = 2.0, grid = new Map();
    byId.forEach((tris, id) => {
      for (const [i, t] of tris.entries())
        for (let x = Math.floor(t.min[0] / cell); x <= Math.floor(t.max[0] / cell); x++)
          for (let y = Math.floor(t.min[1] / cell); y <= Math.floor(t.max[1] / cell); y++)
            for (let z = Math.floor(t.min[2] / cell); z <= Math.floor(t.max[2] / cell); z++) {
              const k = x + ',' + y + ',' + z + '|' + id;
              if (!grid.has(k)) grid.set(k, []);
              grid.get(k).push(i);
            }
    });
    const MAX_CROSS = 5, MAX_LEN = 0.5;
    const bad = [];
    for (const a of Q.awningInstances()) {
      const mod = Q.readGlbTree(path.join(ROOT, 'out-bazaar-stalls', a.module));
      const cloth = Q.bakeWorld(mod.nodes.filter((n) => n.name === 'awning_cloth'), a);
      const perN = new Map();
      for (const t of trisOf({ P: cloth[0].P, T: cloth[0].T })) {
        const cand = new Map();
        for (let x = Math.floor(t.min[0] / cell); x <= Math.floor(t.max[0] / cell); x++)
          for (let y = Math.floor(t.min[1] / cell); y <= Math.floor(t.max[1] / cell); y++)
            for (let z = Math.floor(t.min[2] / cell); z <= Math.floor(t.max[2] / cell); z++)
              for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
                const gk = (x + dx) + ',' + (y + dy) + ',' + (z + dz);
                for (const id of byId.keys()) {
                  const list = grid.get(gk + '|' + id);
                  if (list) for (const j of list) cand.set(id + '#' + j, byId.get(id)[j]);
                }
              }
        for (const [idj, u] of cand) {
          const nid = idj.split('#')[0];
          if (nid === a.blockId) continue;   // 宿主块贴墙共面/角柱属设计贴合（发现9 的宿主交叉即顶带问题，随降带消除）
          if (t.max[0] < u.min[0] || u.max[0] < t.min[0] || t.max[1] < u.min[1] || u.max[1] < t.min[1] || t.max[2] < u.min[2] || u.max[2] < t.min[2]) continue;
          const r = T.triTri(t, u);
          if (r && !r.coplanar && r.len > 0.01) {
            const e = perN.get(nid) || { c: 0, len: 0 };
            e.c++; e.len += r.len;
            perN.set(nid, e);
          }
        }
      }
      for (const [nid, e] of perN)
        if (e.c > MAX_CROSS || e.len > MAX_LEN) bad.push({ awning: a.id, neighbor: nid, crossings: e.c, lenM: +e.len.toFixed(2) });
    }
    ok('awning-neighbor-clearance', bad.length === 0, JSON.stringify(bad));
  }
}

// ---------- 3) 烤架晾杆连接 ----------
{
  const mod = Q.readGlbTree(path.join(ROOT, 'out-bazaar-stalls', 'stall-grill.glb'));
  const r = Q.floatBurySupported(mod);
  ok('grill-rack-connectivity', r.floating.length === 0, JSON.stringify(r.floating.map((x) => ({ node: x.node, bottomY: x.bottomY }))));
}

// ---------- 4) 茶饮柜背板净距 ----------
{
  const mod = Q.readGlbTree(path.join(ROOT, 'out-bazaar-stalls', 'stall-drink.glb'));
  const back = mod.nodes.find((n) => n.name === 'stallDrink_cabBack');
  const top = mod.nodes.find((n) => n.name === 'stallDrink_cabTop');
  if (!back || !top) ok('drink-cabback-clearance', false, 'cabBack/cabTop node missing');
  else {
    const backTop = Math.max(...back.P.filter((_, i) => i % 3 === 1));
    const shedY = Math.min(...top.P.filter((_, i) => i % 3 === 1));
    ok('drink-cabback-clearance', backTop <= shedY - 0.01 + 1e-6, `cabBackTop ${backTop.toFixed(4)} vs shed ${shedY.toFixed(4)} (need <= ${(shedY - 0.01).toFixed(4)})`);
  }
}

// ---------- 5/6/7) 亭子几何 ----------
const POLY_IDS = ['bld-428186467', 'bld-428196085', 'bld-428196091'];
const RECT_IDS = ['bld-428179924', 'bld-428196098'];
const pavMod = (pid) => Q.readGlbTree(path.join(ROOT, 'out-garden-kits', 'pavilion-' + pid, 'model.glb'));

{
  const bad = [];
  for (const pid of POLY_IDS) {
    const bf = T.backfaces(pavMod(pid));
    const timber = bf.find((n) => n.node === 'roof__pav-timber');
    if (!timber) { bad.push({ pid, note: 'no roof__pav-timber' }); continue; }
    if (timber.closed.invertedIslands > 0)
      bad.push({ pid, invertedIslands: timber.closed.invertedIslands, closedIslands: timber.closed.islands });
  }
  ok('pavilion-rafter-winding', bad.length === 0, JSON.stringify(bad));
}
{
  // 椽头顶点 vs 正下方瓦面：瓦面 = roof__pav-tile 大片层（tris>100 的连通块）三角；
  // y>4.6 的宝顶区（坐在脊上的设计饰件）豁免。
  const bad = [];
  for (const pid of [...POLY_IDS, ...RECT_IDS]) {
    const mod = pavMod(pid);
    const tile = mod.nodes.find((n) => n.name === 'roof__pav-tile');
    const timber = mod.nodes.find((n) => n.name === 'roof__pav-timber');
    if (!tile || !timber) { bad.push({ pid, note: 'missing node' }); continue; }
    const til = T.islands(tile);
    const sheet = [];
    for (const L of til.list) if (L.tris.length > 100)
      for (const t of L.tris) {
        const A = [tile.P[tile.T[t * 3] * 3], tile.P[tile.T[t * 3] * 3 + 1], tile.P[tile.T[t * 3] * 3 + 2]];
        const B = [tile.P[tile.T[t * 3 + 1] * 3], tile.P[tile.T[t * 3 + 1] * 3 + 1], tile.P[tile.T[t * 3 + 1] * 3 + 2]];
        const C = [tile.P[tile.T[t * 3 + 2] * 3], tile.P[tile.T[t * 3 + 2] * 3 + 1], tile.P[tile.T[t * 3 + 2] * 3 + 2]];
        sheet.push({ A, B, C });
      }
    const cover = (x, z) => {
      let best = null;
      for (const { A, B, C } of sheet) {
        const den = (B[2] - C[2]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[2] - C[2]);
        if (Math.abs(den) < 1e-12) continue;
        const l1 = ((B[2] - C[2]) * (x - C[0]) + (C[0] - B[0]) * (z - C[2])) / den;
        const l2 = ((C[2] - A[2]) * (x - C[0]) + (A[0] - C[0]) * (z - C[2])) / den;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
        const y = l1 * A[1] + l2 * B[1] + l3 * C[1];
        if (best === null || y > best) best = y;
      }
      return best;
    };
    let over = 0, worst = 0;
    for (let i = 0; i < timber.P.length / 3; i++) {
      const x = timber.P[i * 3], y = timber.P[i * 3 + 1], z = timber.P[i * 3 + 2];
      if (y > 4.6) continue;
      const c = cover(x, z);
      if (c === null) continue;
      const ex = y - c;
      if (ex > 0.02) over++;
      if (ex > worst) worst = ex;
    }
    if (over > 0) bad.push({ pid, vertsOver0p02: over, worstM: +worst.toFixed(4) });
  }
  ok('pavilion-rafter-vs-sheet', bad.length === 0, JSON.stringify(bad));
}
{
  const bad = [];
  for (const pid of RECT_IDS) {
    const bf = T.backfaces(pavMod(pid));
    const tile = bf.find((n) => n.node === 'roof__pav-tile');
    if (!tile) { bad.push({ pid, note: 'no roof__pav-tile' }); continue; }
    if (tile.closed.inwardTris > 0 || tile.closed.internalCoincidentTris > 0)
      bad.push({ pid, inward: tile.closed.inwardTris, internalCoincident: tile.closed.internalCoincidentTris });
  }
  ok('pavilion-rect-tile-clean', bad.length === 0, JSON.stringify(bad));
}

// ---------- 8) zone-garden 亭锚唯一 ----------
{
  const zg = path.join(OUT, 'zone-garden.glb');
  if (!fs.existsSync(zg)) {
    console.log('SKIP pavilion-anchor-unique -', zg, 'missing (run export-zones first)');
  } else {
    const raw = T.readGlbRaw(zg);
    const nodes = raw.json.nodes || [];
    const rootSet = new Set(raw.json.scenes?.[raw.json.scene || 0]?.children || []);
    const bad = [];
    for (const pid of Q.PAVILION_IDS) {
      const anchors = nodes.filter((n) => n.mesh === undefined && (n.name || '').startsWith(pid));
      if (anchors.length !== 1) bad.push({ pid, anchorNodes: anchors.map((n) => n.name) });
    }
    ok('pavilion-anchor-unique', bad.length === 0, JSON.stringify(bad));
  }
}

console.log(`smallfix-test: ${npass} pass, ${nfail} fail`);
if (nfail) { console.log('failures:', failures.join(' | ')); process.exit(1); }
