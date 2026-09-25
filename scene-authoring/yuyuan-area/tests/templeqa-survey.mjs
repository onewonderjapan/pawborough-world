// 庙区模块普查（wave5-templeqa Q1，只读）：逐模块几何检查 + 实例间互穿 + 贴图同名异图。
// 用法：node tests/templeqa-survey.mjs --json <out.json> [--dir <模块目录，缺省 resources/temple-v3>] [--only roof,back,float,inter,tex]
//       [--zones <OUT_DIR>]（给了就额外核对该产物目录里分区 GLB 的同名贴图最终落到哪份字节）
import fs from 'node:fs';
import path from 'node:path';
import * as Q from './templeqa-lib.mjs';

const args = process.argv.slice(2);
const opt = (k, d = null) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const DIR = path.resolve(opt('--dir', Q.TEMPLE_V3));
const ONLY = new Set((opt('--only', 'roof,back,float,inter,tex')).split(','));
const out = { dir: DIR, generated: new Date().toISOString(), modules: {}, interpenetration: [], textures: null };

const MF = Q.moduleFileMap();
const files = [...new Set(Object.values(MF))];
const mods = {};
for (const f of files) {
  const t0 = Date.now();
  const mod = Q.readModule(path.join(DIR, f));
  mods[f] = mod;
  const r = { tris: mod.nodes.reduce((s, n) => s + n.T.length / 3, 0), nodes: mod.nodes.length };
  if (ONLY.has('roof')) {
    const c = Q.roofClip(mod);
    r.roofClip = { checked: c.checked, total: c.total, rootExempt: c.rootExempt, violations: c.violations.length, worstM: c.violations.length ? c.violations[0].maxExcessM : null,
      byNode: Object.entries(c.violations.reduce((m, v) => { (m[v.node] ||= { n: 0, worst: 0 }); m[v.node].n++; m[v.node].worst = Math.max(m[v.node].worst, v.maxExcessM); return m; }, {})),
      list: c.violations.slice(0, 40), seatedOrnaments: c.seatedOrnaments.length, seatedSample: c.seatedOrnaments.slice(0, 10) };
  }
  if (ONLY.has('back')) {
    const b = Q.backfaces(mod);
    r.backfaces = { windingVsNormalTris: b.reduce((s, x) => s + x.windingVsNormal.tris, 0), windingVsNormalAreaM2: +b.reduce((s, x) => s + x.windingVsNormal.areaM2, 0).toFixed(3),
      closedInwardTris: b.reduce((s, x) => s + x.closed.inwardTris, 0), closedInwardAreaM2: +b.reduce((s, x) => s + x.closed.inwardAreaM2, 0).toFixed(3),
      invertedIslands: b.reduce((s, x) => s + x.closed.invertedIslands, 0), closedTris: b.reduce((s, x) => s + x.closed.tris, 0),
      allDoubleSided: b.every((x) => x.doubleSided), perNode: b };
  }
  if (ONLY.has('float')) {
    const fb = Q.floatBury(mod);
    r.floatBury = { blocks: fb.blocks, floating: fb.floating.length, buried: fb.buried.length, deep: fb.deep.length, floatingList: fb.floating.slice(0, 30), buriedList: fb.buried.slice(0, 30), deepList: fb.deep.slice(0, 10) };
  }
  r.ms = Date.now() - t0;
  out.modules[f] = r;
  console.log(f, JSON.stringify({ tris: r.tris, roof: r.roofClip && [r.roofClip.violations, r.roofClip.worstM, r.roofClip.seatedOrnaments],
    back: r.backfaces && [r.backfaces.windingVsNormalTris, r.backfaces.closedInwardTris, r.backfaces.invertedIslands],
    float: r.floatBury && [r.floatBury.floating, r.floatBury.buried, r.floatBury.deep], ms: r.ms }));
}

if (ONLY.has('inter')) {
  const insts = Q.templeInstances();
  const W = insts.map((i) => ({ inst: i, tris: Q.worldTris(mods[i.file], i) }));
  for (const w of W) w.box = Q.bboxOf(w.tris);
  for (let a = 0; a < W.length; a++) for (let b = a + 1; b < W.length; b++) {
    const bi = Q.boxInter(W[a].box, W[b].box);
    if (!bi) continue;
    const t0 = Date.now();
    const r = Q.crossIntersect(W[a].tris, W[b].tris);
    const rec = { a: W[a].inst.id, b: W[b].inst.id, bboxOverlapM3: +bi.vol.toFixed(2), bboxOverlap: { min: bi.min.map(Q.f3), max: bi.max.map(Q.f3) },
      crossings: r.crossings, lenM: r.lenM, coplanarTris: r.coplanarTris, box: r.box, pairs: r.pairs.slice(0, 20), ms: Date.now() - t0 };
    out.interpenetration.push(rec);
    console.log('inter', rec.a, rec.b, 'bbox', rec.bboxOverlapM3, 'cross', rec.crossings, 'len', rec.lenM, 'coplanar', rec.coplanarTris, rec.ms + 'ms');
  }
}

if (ONLY.has('tex')) {
  const byKey = new Map();
  for (const f of files) for (const im of Q.imagesOf(path.join(DIR, f))) {
    const k = im.key + '@' + (im.dims || []).join('x');
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push({ file: f, name: im.name, sha: im.sha.slice(0, 16), bytes: im.bytes, users: im.users });
  }
  const conflicts = [...byKey.entries()].filter(([, v]) => new Set(v.map((x) => x.sha)).size > 1).map(([k, v]) => ({ key: k, variants: new Set(v.map((x) => x.sha)).size, entries: v }));
  out.textures = { keys: byKey.size, conflictsWithinTemple: conflicts };
  console.log('tex keys', byKey.size, 'conflicts within temple modules', conflicts.length, conflicts.map((c) => c.key).join(', '));
}

const J = opt('--json');
if (J) fs.writeFileSync(J, JSON.stringify(out, null, 1));
