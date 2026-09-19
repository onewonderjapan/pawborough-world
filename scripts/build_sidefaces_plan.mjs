// A0 — build kit/out/sidefaces/plan-full.json from the M1 survey:
//   one instance per visible wall record; foundation-gable records merged into
//   their gable instance (offsetOverride = measured protrusion); mural
//   finished surfaces excluded; M-batch 10 combos frozen; shared centered
//   skins keyed by (local dims, face type, tSign); per-end shrink search
//   resolves corner joints with perpendicular walls (fallback #2 skips).
//
// Run: node scripts/build_sidefaces_plan.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';

const t = JSON.parse(await readFile('kit/out/sidefaces/targets.json', 'utf8'));
const street = JSON.parse(await readFile('world/collision-world.json', 'utf8'));
const streetByRec = Object.fromEntries(street.colliders.map((c) => [c.name, c]));
const eastLocal = {};
for (const dir of ['world/east-edge', 'world/street-completion']) {
  for (const f of await readdir(dir)) {
    if (!f.startsWith('east-shop-')) continue;
    const c = JSON.parse(await readFile(`${dir}/${f}/collision-local.json`, 'utf8'));
    eastLocal[f] = Object.fromEntries(c.colliders.map((x) => [x.name, x]));
  }
}
const eastInst = {};
for (const dir of ['world/east-edge', 'world/street-completion']) {
  const b = JSON.parse(await readFile(`${dir}/blocks.json`, 'utf8'));
  for (const blk of b.blocks) for (const a of blk.assets ?? []) {
    if (a.id?.startsWith('east-shop-')) eastInst[a.id] = { pos: a.positionGlb, yaw: a.rotationYRad };
  }
}

const M_BATCH = new Set([
  'N01-plain-v1:side-w', 'N05-restaurant-a:side-e', 'N05-restaurant-a:rear',
  'N06-curio-a:side-w', 'N06-curio-a:rear', 'S05-plain-v3:side-w', 'S05-plain-v3:rear',
  'S07-plain-v2:side-e', 'S07-plain-v2:rear', 'east-shop-133:side-e',
]);
const EXCLUDED = new Set(['N07-cat_corner:rear', 'N07-cat_corner:side-e', 'N07-cat_corner:side-w']);
const faceTypeOf = (r) => {
  if (/mural-back|back-wall|rear-wall/.test(r)) return 'rear';
  if (/left-side|side-wall-west|gable-wall-west|foundation-gable-west|mural-side-left/.test(r)) return 'side-w';
  return 'side-e';
};
const isFoundation = (r) => /foundation-gable/.test(r);

const byModule = {};
for (const f of t.visibleFaces) {
  const ft = faceTypeOf(f.record);
  const key = `${f.module}:${ft}`;
  if (EXCLUDED.has(key)) continue;
  (byModule[f.module] = byModule[f.module] ?? {})[ft] = (byModule[f.module][ft] ?? []).concat(f);
}

const walls = [];
for (const [mod, fts] of Object.entries(byModule)) {
  const isEast = mod.startsWith('east-shop-');
  for (const [ft, fs] of Object.entries(fts)) {
    const key = `${mod}:${ft}`;
    if (M_BATCH.has(key)) continue;
    const gableRecs = fs.filter((f) => !isFoundation(f.record));
    const foundRecs = fs.filter((f) => isFoundation(f.record));
    if (isEast) {
      const loc = eastLocal[mod];
      const placement = eastInst[mod];
      const recs = gableRecs.map((f) => f.record);
      const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      for (const r of recs) {
        const b = loc[r];
        for (let a = 0; a < 3; a++) {
          mn[a] = Math.min(mn[a], b.center[a] - b.size[a] / 2);
          mx[a] = Math.max(mx[a], b.center[a] + b.size[a] / 2);
        }
      }
      let oo = null;
      if (foundRecs.length) {
        const g = loc[recs[0]], fo = loc[foundRecs[0].record];
        oo = +(((fo.size[0] - g.size[0]) / 2)).toFixed(3);
      }
      const size = mn.map((v, a) => +(mx[a] - v).toFixed(3));
      const center = mn.map((v, a) => +((v + mx[a]) / 2).toFixed(3));
      walls.push({ id: `${mod}-${ft}`, module: mod, faceType: ft, rec: recs.join('+'),
        localBox: { center, size }, placement, offsetOverride: oo,
        ownWallNames: [`${mod}:${recs.join('+')}`, ...foundRecs.map((f) => `${mod}:${f.record}`)],
        source: 'union of collision-local records' });
    } else {
      const f = gableRecs[0] ?? foundRecs[0];
      const rec = streetByRec[`${mod}:${f.record}`];
      walls.push({ id: `${mod}-${ft}`, module: mod, faceType: ft, rec: f.record,
        localBox: { center: rec.obb.center, size: rec.obb.size },
        placement: { pos: rec.obb.pos, yaw: rec.obb.theta },
        ownWallNames: fs.map((x) => `${mod}:${x.record}`),
        source: 'world/collision-world.json obb' });
    }
  }
}

// delivered colliders for the shrink search
const allDelivered = [];
{
  const cw = JSON.parse(await readFile('world/collision-world.json', 'utf8'));
  allDelivered.push(...cw.colliders);
  for (const dir of ['world/east-edge', 'world/street-completion']) {
    for (const f of await readdir(dir)) {
      if (!f.startsWith('east-shop-')) continue;
      const c = JSON.parse(await readFile(`${dir}/${f}/collision.json`, 'utf8'));
      allDelivered.push(...c.colliders);
    }
  }
}
const centersOf = (r) => {
  const o = r.obb ?? {};
  if (!o.pos) return null;
  const co = Math.cos(o.theta), si = Math.sin(o.theta);
  return { name: r.name,
    c: [o.pos[0] + co * o.center[0] + si * o.center[2], o.center[1] + (o.pos[1] ?? 0),
        o.pos[2] - si * o.center[0] + co * o.center[2]],
    yaw: o.theta, half: [o.size[0] / 2, o.size[1] / 2, o.size[2] / 2] };
};
const deliveredBoxes = allDelivered.map(centersOf).filter(Boolean);
const cornersOf = (o) => {
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  return [[o.half[0], o.half[2]], [o.half[0], -o.half[2]], [-o.half[0], o.half[2]], [-o.half[0], -o.half[2]]]
    .map(([x, z]) => [o.c[0] + c * x + s * z, o.c[2] - s * x + c * z]);
};
const obbOverlap = (a, b) => {
  if (Math.abs(a.c[1] - b.c[1]) >= a.half[1] + b.half[1]) return false;
  const ca = cornersOf(a), cb = cornersOf(b);
  const axes = [];
  for (const box of [a, b]) {
    const c = Math.cos(box.yaw), s = Math.sin(box.yaw);
    axes.push([c, -s], [s, c]);
  }
  for (const ax of axes) {
    const pa = ca.map((p) => p[0] * ax[0] + p[1] * ax[1]);
    const pb = cb.map((p) => p[0] * ax[0] + p[1] * ax[1]);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
};

const skipped = [];
const classes = new Map();
const instances = [];
for (const w of walls) {
  const ls = w.localBox.size;
  const tAxis = ls[0] <= ls[2] ? 0 : 2;
  const tSign = Math.sign(w.localBox.center[tAxis]) || 1;
  const c0 = Math.cos(w.placement.yaw), s0 = Math.sin(w.placement.yaw);
  const outW = tAxis === 0 ? [c0 * tSign, -s0 * tSign] : [s0 * tSign, c0 * tSign];
  const co2 = Math.cos(w.placement.yaw), si2 = Math.sin(w.placement.yaw);
  const wc = [w.placement.pos[0] + co2 * w.localBox.center[0] + si2 * w.localBox.center[2],
              w.localBox.center[1],
              w.placement.pos[2] - si2 * w.localBox.center[0] + co2 * w.localBox.center[2]];
  // per-end shrink search: [0, 0.15, 0.30, 0.45] — skins die into perpendicular
  // walls; the first shrink whose probe clears ALL foreign colliders wins.
  // (fallback #2: still blocked at 0.45/end -> skip the face)
  const lenHalfFull = tAxis === 0 ? ls[2] / 2 : ls[0] / 2;
  const ownWallNames = new Set(w.ownWallNames ?? []);
  let chosenShrink = null, blockedName = null;
  for (const shrink of [0, 0.15, 0.3, 0.45]) {
    const lenHalf = Math.max(0.2, lenHalfFull - shrink);
    const probe = {
      c: [wc[0] + outW[0] * 0.11, wc[1], wc[2] + outW[1] * 0.11],
      yaw: w.placement.yaw,
      half: tAxis === 0 ? [0.03, ls[1] / 2, lenHalf] : [lenHalf, ls[1] / 2, 0.03],
    };
    let hit = null;
    for (const d of deliveredBoxes) {
      if (ownWallNames.has(d.name)) continue;
      if (obbOverlap(probe, d)) { hit = d.name; break; }
    }
    if (!hit) { chosenShrink = shrink; break; }
    blockedName = hit;
  }
  if (chosenShrink === null) {
    skipped.push({ module: w.module, faceType: w.faceType, record: w.rec,
      reason: `still blocked by ${blockedName} at 0.45m/end shrink — fallback #2` });
    continue;
  }
  const dk = `${ls.map((v) => v.toFixed(2)).join('x')}|${w.faceType}|t${tSign}`;
  if (!classes.has(dk)) classes.set(dk, { skinId: `cs-${dk}`, dims: ls, faceType: w.faceType,
    tSign, offsetOverride: w.offsetOverride ?? null, endShrinkM: chosenShrink, count: 0, modules: [] });
  const cl = classes.get(dk); cl.count++; cl.modules.push(w.module);
  instances.push({ module: w.module, record: w.rec, faceType: w.faceType, skinId: cl.skinId,
    placement: w.placement, localBox: w.localBox, tSign, endShrinkM: chosenShrink,
    offsetOverride: w.offsetOverride ?? null });
}
const plan = {
  source: 'kit/out/sidefaces/targets.json + delivered collision records',
  rule: '每条 visible 记录一件实例；east-shop 分段记录按侧并成整墙 union（基础带 offsetOverride 实测）；mural 排除；M 批 10 组合冻结；外皮 GLB 按 (本地尺寸,面型,tSign) 共享、盒中心为原点，实例变换=placement+localBox；端缩搜索解决墙角交接',
  surveyVisibleFaces: t.visibleFaces.length,
  wallCount: walls.length,
  skipped,
  skippedCount: skipped.length,
  instanceCount: instances.length,
  mBatchFrozen: [...M_BATCH],
  uniqueSkinClasses: classes.size,
  classes: [...classes.values()],
  instances,
};
await writeFile('kit/out/sidefaces/plan-full.json', JSON.stringify(plan, null, 2) + '\n');
console.log(`PLAN_FULL walls=${walls.length} instances=${instances.length} uniqueSkins=${classes.size} skipped=${skipped.length}`);
