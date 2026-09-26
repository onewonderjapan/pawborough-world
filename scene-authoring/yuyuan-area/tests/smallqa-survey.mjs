// wave8-smallqa Q1 普查（只查不改）：亭子套件 5 座 + 摊位套件（3 摊 + 凳 + 16 檐棚）。
//   模块级：非屋面穿出屋面 / 背面朝外 / 浮空埋地 / 同名同尺寸异图贴图 / 挂落明度（hall-kit 阈值的贴图层版）
//   世界级（--zones <OUT_DIR>）：亭实例 vs 园区（园路/水/龙墙/树/邻件）；檐棚 vs 商城楼（zone-bazaar-3）/
//   程序化街块（zone-bazaar-2）/ 街面（zone-bazaar）；摊凳 vs 街面。亭/檐棚世界位姿由 smallqa-lib 从 layout+records 重算。
// 用法：node tests/smallqa-survey.mjs --json <out.json> [--zones out-zone]
//       [--only module,inter,tex,luma] [--inter-family pavilion,awning,stall]
import fs from 'node:fs';
import path from 'node:path';
import * as Q from './smallqa-lib.mjs';
import * as T from './templeqa-lib.mjs';

const args = process.argv.slice(2);
const opt = (k, d = null) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const ROOT = Q.ROOT;
const ONLY = new Set((opt('--only', 'module,inter,tex,luma')).split(','));
const FAMS = new Set((opt('--inter-family', 'pavilion,awning,stall')).split(','));
const ZONES = opt('--zones');      // OUT_DIR（相对 ROOT）
const out = { generated: new Date().toISOString(), zones: ZONES, modules: {}, inter: {}, textures: null, luma: {} };

const PAV_RE = /^(bld-428179924|bld-428186467|bld-428196085|bld-428196091|bld-428196098)(\.|$)/;
const isPavRoof = (n) => n.part === 'roof' && n.mat === 'pav-tile';
const isStallRoof = (n) => /top$/i.test(n.name || '') || (n.material?.name || '') === 'canvasIndigo';
const isAwningRoof = (n) => (n.name || '') === 'awning_cloth';

// 家族清单：{ id, file, inst(世界位姿重算), roofPred }
function inventory() {
  const items = [];
  for (const p of Q.pavilionInstances()) items.push({ family: 'pavilion', id: p.id, file: path.join('out-garden-kits', `pavilion-${p.id}`, 'model.glb'), inst: { ...p, position: p.position }, roof: isPavRoof });
  for (const s of Q.stallInstances().filter((s, i, a) => a.findIndex((x) => x.module === s.module) === i))   // 模块 GLB 去重：43 摊位共用 3 个 GLB
    items.push({ family: s.kind === 'bench' ? 'bench' : 'stall', id: s.module.replace('.glb', ''), file: path.join('out-bazaar-stalls', s.module), roof: isStallRoof });
  for (const a of Q.awningInstances()) items.push({ family: 'awning', id: a.id, file: path.join('out-bazaar-stalls', a.module), inst: a, roof: isAwningRoof });
  return items;
}

const items = inventory();
console.log('inventory', items.map((i) => i.family + ':' + i.id).join(' '), '\n');

// ---------- 模块级 ----------
if (ONLY.has('module')) {
  for (const it of items) {
    const t0 = Date.now();
    const mod = Q.readGlbTree(path.join(ROOT, it.file));
    const r = { family: it.family, tris: mod.nodes.reduce((s, n) => s + n.T.length / 3, 0), nodes: mod.nodes.length };
    r.bbox = mod.nodes.reduce((b, n) => {
      for (let i = 0; i < n.P.length / 3; i++) for (let c = 0; c < 3; c++) { const v = n.P[i * 3 + c]; b[0][c] = Math.min(b[0][c], v); b[1][c] = Math.max(b[1][c], v); }
      return b;
    }, [[1e9, 1e9, 1e9], [-1e9, -1e9, -1e9]]).map((v) => v.map((x) => +x.toFixed(3)));
    const clip = Q.roofClipPred(mod, it.roof);
    r.roofClip = { violations: clip.violations.length, worstM: clip.violations.length ? clip.violations[0].maxExcessM : null,
      seatedOrnaments: clip.seatedOrnaments.length, list: clip.violations.slice(0, 20) };
    const bf = T.backfaces({ nodes: mod.nodes });
    r.backfaces = { windingVsNormalTris: bf.reduce((s, x) => s + x.windingVsNormal.tris, 0), windingVsNormalAreaM2: +bf.reduce((s, x) => s + x.windingVsNormal.areaM2, 0).toFixed(3),
      closedInwardTris: bf.reduce((s, x) => s + x.closed.inwardTris, 0), invertedIslands: bf.reduce((s, x) => s + x.closed.invertedIslands, 0),
      internalCoincidentTris: bf.reduce((s, x) => s + x.closed.internalCoincidentTris, 0), perNode: bf.filter((x) => x.windingVsNormal.tris || x.closed.inwardTris || x.closed.invertedIslands) };
    const fb = Q.floatBurySupported({ nodes: mod.nodes });
    r.floatBury = { blocks: fb.blocks, floating: fb.floating.length, buried: fb.buried.length, deep: fb.deep.length,
      floatingList: fb.floating.slice(0, 20), buriedList: fb.buried, deepList: fb.deep.slice(0, 10) };
    out.modules[it.family + '/' + it.id] = r;
    console.log(it.family + '/' + it.id, JSON.stringify({ tris: r.tris, clip: [r.roofClip.violations, r.roofClip.worstM, r.roofClip.seatedOrnaments],
      back: [r.backfaces.windingVsNormalTris, r.backfaces.closedInwardTris, r.backfaces.invertedIslands], float: [r.floatBury.floating, r.floatBury.buried, r.floatBury.deep], ms: Date.now() - t0 }));
  }
}

// ---------- 世界位姿实例 & 分区加载 ----------
const instsOf = (fam) => items.filter((i) => i.family === fam && i.inst).map((i) => ({ ...i, mod: Q.readGlbTree(path.join(ROOT, i.file)) }));

function counterpartyLabel(n) {
  if (n.anchor) {
    if (PAV_RE.test(n.anchor)) return 'pavilion:' + n.anchor.split('.')[0];
    if (/^awning-/.test(n.anchor)) return 'awning';
    if (/^stall-/.test(n.anchor)) return 'stall:' + n.anchor.split('.')[0];
    if (/^bench-/.test(n.anchor)) return 'bench:' + n.anchor.split('.')[0];
    if (/^food-/.test(n.anchor)) return 'food';
    if (/^gtree|^tree|^tk-/.test(n.anchor)) return 'tree';
    if (/^garden-wall/.test(n.anchor)) return 'garden-wall';
    if (/corridor/.test(n.anchor)) return 'corridor';
    if (/^bld-/.test(n.anchor)) return 'tower:' + n.anchor.split('.')[0];
    return 'anchored:' + n.anchor;
  }
  const nm = n.name || '';
  if (/gpath|path/.test(nm)) return 'garden-path';
  if (/water/.test(nm)) return 'water';
  if (/bazaarBlock/.test(nm)) return 'bazaarBlock:' + (nm.split('|')[1] || '');
  if (/outerBuilding/.test(nm)) return 'outerBuilding';
  if (/facadeBay/.test(nm)) return 'street-facade';
  if (nm.startsWith('bazaar|')) return 'bazaar-street';
  return 'zone-other';
}

// 节点数组 → 三角记录数组（crossIntersect 输入形）
function trisOf(nodes) {
  const out = [];
  for (const n of nodes) for (let t = 0; t < n.T.length / 3; t++) {
    const A = [n.P[n.T[t * 3] * 3], n.P[n.T[t * 3] * 3 + 1], n.P[n.T[t * 3] * 3 + 2]];
    const B = [n.P[n.T[t * 3 + 1] * 3], n.P[n.T[t * 3 + 1] * 3 + 1], n.P[n.T[t * 3 + 1] * 3 + 2]];
    const C = [n.P[n.T[t * 3 + 2] * 3], n.P[n.T[t * 3 + 2] * 3 + 1], n.P[n.T[t * 3 + 2] * 3 + 2]];
    out.push({ A, B, C, node: n.name,
      min: [Math.min(A[0], B[0], C[0]), Math.min(A[1], B[1], C[1]), Math.min(A[2], B[2], C[2])],
      max: [Math.max(A[0], B[0], C[0]), Math.max(A[1], B[1], C[1]), Math.max(A[2], B[2], C[2])] });
  }
  return out;
}

// 交叉统计：A 组实例三角 vs B 组分区三角（B 按 counterpartyLabel 分桶）
function interAgainst(instNodes, byLabel, { minY = -Infinity } = {}) {
  const instTris = trisOf(instNodes);
  const rows = [];
  for (const [label, nodes] of byLabel) {
    const tris = trisOf(nodes);
    if (!tris.length) continue;
    const r = T.crossIntersect(instTris, tris, 1.0, { minY });
    if (r.crossings || r.coplanarTris) rows.push({ with: label, crossings: r.crossings, lenM: r.lenM, coplanarTris: r.coplanarTris, box: r.box, pairs: r.pairs.slice(0, 8) });
  }
  rows.sort((a, b) => b.lenM - a.lenM || b.crossings - a.crossings);
  return rows;
}

function nodeBox(nodes) {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const n of nodes) for (let i = 0; i < n.P.length / 3; i++) for (let c = 0; c < 3; c++) { const v = n.P[i * 3 + c]; if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; }
  return { mn, mx };
}
const boxOverlap = (a, b) => a.mn[0] <= b.mx[0] && b.mn[0] <= a.mx[0] && a.mn[1] <= b.mx[1] && b.mn[1] <= a.mx[1] && a.mn[2] <= b.mx[2] && b.mn[2] <= a.mx[2];

// 分区文件惰性加载：{file → {byLabel: Map, box}}；file 是 OUT_DIR 下相对名（如 zone-garden.glb）
const OUT_DIR = ZONES || 'out-zone';
const zoneCache = new Map();
function zoneByLabel(file, anchorRe) {
  if (zoneCache.has(file)) return zoneCache.get(file);
  const t = Q.readGlbTree(path.join(ROOT, OUT_DIR, file), { anchorRe, normLimit: 1e6 });
  const byLabel = new Map();
  for (const n of t.nodes) {
    const k = counterpartyLabel(n);
    if (!byLabel.has(k)) byLabel.set(k, []);
    byLabel.get(k).push(n);
  }
  const box = nodeBox(t.nodes);
  const rec = { byLabel, box };
  zoneCache.set(file, rec);
  return rec;
}

// ---------- 世界级互穿 ----------
if (ONLY.has('inter') && ZONES) {
  if (FAMS.has('pavilion')) {
    out.inter.pavilion = [];
    const files = ['zone-garden.glb', 'zone-garden-2.glb', 'zone-garden-3.glb', 'zone-pond.glb'];
    for (const p of instsOf('pavilion')) {
      const t0 = Date.now();
      const nodes = Q.bakeWorld(p.mod.nodes, p.inst);
      const ibox = nodeBox(nodes);
      const byLabel = new Map();
      for (const f of files) {
        const z = zoneByLabel(f, PAV_RE);
        if (!boxOverlap(ibox, z.box)) continue;
        for (const [k, ns] of z.byLabel) {
          if (k === 'pavilion:' + p.id) continue;   // 自己（zone 里的实例拷贝）
          const kb = nodeBox(ns);
          if (!boxOverlap(ibox, kb)) continue;
          if (!byLabel.has(k)) byLabel.set(k, []);
          byLabel.get(k).push(...ns);
        }
      }
      const rows = interAgainst(nodes, byLabel);
      out.inter.pavilion.push({ id: p.id, position: p.inst.position.map(Q.f3 || T.f3), rotY: +p.inst.rotY.toFixed(4), rows, ms: Date.now() - t0 });
      console.log('inter pavilion', p.id, rows.map((r) => `${r.with}:${r.crossings}/${r.lenM}m`).join(' ') || 'clean', Date.now() - t0 + 'ms');
    }
  }
  if (FAMS.has('awning')) {
    out.inter.awning = [];
    for (const a of instsOf('awning')) {
      const t0 = Date.now();
      const nodes = Q.bakeWorld(a.mod.nodes, a.inst);
      const ibox = nodeBox(nodes);
      const sources = [
        ['zone-bazaar-3.glb', /^bld-/],        // 商城楼套件（2026-09-26 默认开）
        ['zone-bazaar-2.glb', null],           // 程序化街块（宿主墙）
        ['zone-bazaar.glb', /^awning-|^stall-|^bench-|^food-/],  // 街面 + 其它实例
      ];
      const byLabel = new Map();
      for (const [f, re] of sources) {
        const z = zoneByLabel(f, re);
        if (!boxOverlap(ibox, z.box)) continue;
        for (const [k, ns] of z.byLabel) {
          if (k === 'awning' && re) continue;                       // 其它檐棚
          if (k === 'bazaarBlock:' + a.inst.blockId) { /* 宿主块单列 */ }
          const kb = nodeBox(ns);
          if (!boxOverlap(ibox, kb)) continue;
          if (!byLabel.has(k)) byLabel.set(k, []);
          byLabel.get(k).push(...ns);
        }
      }
      const rows = interAgainst(nodes, byLabel);
      // 吞没度：檐棚布面质心射 +Y 对塔楼闭合体做奇偶内点，比例大即「被吞」
      const towerNodes = [];
      for (const k of byLabel.keys()) if (k.startsWith('tower:')) towerNodes.push(...byLabel.get(k));
      let swallow = null;
      if (towerNodes.length) {
        const cloth = nodes.filter((n) => isAwningRoof(n));
        const tt = [];
        for (const n of towerNodes) for (let t = 0; t < n.T.length / 3; t++) {
          const A = [n.P[n.T[t * 3] * 3], n.P[n.T[t * 3] * 3 + 1], n.P[n.T[t * 3] * 3 + 2]];
          const B = [n.P[n.T[t * 3 + 1] * 3], n.P[n.T[t * 3 + 1] * 3 + 1], n.P[n.T[t * 3 + 1] * 3 + 2]];
          const C = [n.P[n.T[t * 3 + 2] * 3], n.P[n.T[t * 3 + 2] * 3 + 1], n.P[n.T[t * 3 + 2] * 3 + 2]];
          tt.push({ A, B, C, min: [Math.min(A[0], B[0], C[0]), Math.min(A[1], B[1], C[1]), Math.min(A[2], B[2], C[2])], max: [Math.max(A[0], B[0], C[0]), Math.max(A[1], B[1], C[1]), Math.max(A[2], B[2], C[2])] });
        }
        let inside = 0, tot = 0;
        for (const n of cloth) for (let t = 0; t < n.T.length / 3; t++) {
          const cx = (n.P[n.T[t * 3] * 3] + n.P[n.T[t * 3 + 1] * 3] + n.P[n.T[t * 3 + 2] * 3]) / 3;
          const cy = (n.P[n.T[t * 3] * 3 + 1] + n.P[n.T[t * 3 + 1] * 3 + 1] + n.P[n.T[t * 3 + 2] * 3 + 1]) / 3;
          const cz = (n.P[n.T[t * 3] * 3 + 2] + n.P[n.T[t * 3 + 1] * 3 + 2] + n.P[n.T[t * 3 + 2] * 3 + 2]) / 3;
          tot++;
          let cnt = 0;
          for (const u of tt) {
            if (cx < u.min[0] || cx > u.max[0] || cz < u.min[2] || cz > u.max[2] || cy < u.min[1]) continue;
            const s = T.rayTri([cx, cy, cz], [0, 1, 0], u.A, u.B, u.C);
            if (s !== null && s > 1e-6) cnt++;
          }
          if (cnt % 2 === 1) inside++;
        }
        if (tot) swallow = +(inside / tot).toFixed(3);
      }
      out.inter.awning.push({ id: a.id, blockId: a.inst.blockId, street: a.inst.street, position: a.inst.position.map(T.f3), rotY: +a.inst.rotY.toFixed(4), outward: a.inst.outward.map(T.f3), swallowFractionInTower: swallow, rows, ms: Date.now() - t0 });
      console.log('inter awning', a.id, 'swallow', swallow, rows.map((r) => `${r.with}:${r.crossings}/${r.lenM}m`).join(' ') || 'clean', Date.now() - t0 + 'ms');
    }
  }
  if (FAMS.has('stall')) {
    out.inter.stall = [];
    out.inter.stallPairs = [];
    const mods = new Map();
    const bakedAll = [];
    for (const s of Q.stallInstances()) {
      const key = s.module;
      if (!mods.has(key)) mods.set(key, Q.readGlbTree(path.join(ROOT, 'out-bazaar-stalls', key)));
      const nodes = Q.bakeWorld(mods.get(key).nodes, s);
      bakedAll.push({ id: s.id, kind: s.kind, nodes });
      const ibox = nodeBox(nodes);
      const byLabel = new Map();
      for (const [f, re] of [['zone-bazaar.glb', /^awning-|^stall-|^bench-|^food-/], ['zone-bazaar-2.glb', null], ['zone-bazaar-3.glb', /^bld-/]]) {
        const z = zoneByLabel(f, re);
        if (!boxOverlap(ibox, z.box)) continue;
        for (const [k, ns] of z.byLabel) {
          if (/^(stall|bench|awning|food)[:.-]/.test(k)) continue;
          const kb = nodeBox(ns);
          if (!boxOverlap(ibox, kb)) continue;
          if (!byLabel.has(k)) byLabel.set(k, []);
          byLabel.get(k).push(...ns);
        }
      }
      const rows = interAgainst(nodes, byLabel);
      if (rows.length) out.inter.stall.push({ id: s.id, module: s.module, position: s.position.map(T.f3), rotY: +s.rotY.toFixed(4), rows });
      console.log('inter stall', s.id, rows.map((r) => `${r.with}:${r.crossings}/${r.lenM}m`).join(' ') || 'clean');
    }
    // 摊/凳两两互穿（集群相邻摆放的咬合）
    const triCache = new Map();
    const trisCached = (b) => {
      if (!triCache.has(b.id)) triCache.set(b.id, trisOf(b.nodes));
      return triCache.get(b.id);
    };
    for (let a = 0; a < bakedAll.length; a++) for (let b = a + 1; b < bakedAll.length; b++) {
      const A = trisCached(bakedAll[a]), B = trisCached(bakedAll[b]);
      if (!A.length || !B.length) continue;
      if (!boxOverlap(nodeBox(bakedAll[a].nodes), nodeBox(bakedAll[b].nodes))) continue;
      const r = T.crossIntersect(A, B, 1.0, {});
      if (r.crossings >= 10) out.inter.stallPairs.push({ a: bakedAll[a].id, b: bakedAll[b].id, crossings: r.crossings, lenM: r.lenM, box: r.box });
    }
    out.inter.stallPairs.sort((x, y) => y.lenM - x.lenM);
    console.log('stall pairs (>=10 crossings):', out.inter.stallPairs.length, out.inter.stallPairs.slice(0, 12).map((p) => `${p.a}×${p.b}:${p.crossings}/${p.lenM}m`).join(' '));
  }
}

// ---------- 贴图：同「名 + 尺寸」不同内容 ----------
if (ONLY.has('tex')) {
  const byKey = new Map();
  for (const it of items) for (const im of Q.imagesOf(path.join(ROOT, it.file))) {
    const k = im.key + '@' + (im.dims || []).join('x');
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push({ family: it.family, file: it.file, name: im.name, sha: im.sha.slice(0, 16), bytes: im.bytes, users: im.users });
  }
  const conflicts = [...byKey.entries()].filter(([, v]) => new Set(v.map((x) => x.sha)).size > 1).map(([k, v]) => ({ key: k, variants: new Set(v.map((x) => x.sha)).size, entries: v }));
  out.textures = { keys: byKey.size, conflicts: conflicts };
  console.log('tex keys', byKey.size, 'conflicts', conflicts.length, conflicts.map((c) => c.key).join(', '));
}

// ---------- 挂落 / 立面明度 ----------
if (ONLY.has('luma')) {
  for (const it of items.filter((i) => i.family === 'pavilion')) {
    out.luma[it.id] = Q.latticeLuma(path.join(ROOT, it.file));
    console.log('luma', it.id, JSON.stringify(out.luma[it.id].map((x) => [x.material, x.hsvV, x.pass])));
  }
}

const J = opt('--json');
if (J) fs.writeFileSync(J, JSON.stringify(out, null, 1));
