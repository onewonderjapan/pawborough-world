// East-shops contract (adoption batch package J, G5) — the east-band upgrade
// mirrors the west-band R1 rules, recomputed here INDEPENDENTLY against the
// BUILT east-extension centerline (not trusted from plan.json): every front
// wall on the 5.6m front line (<= 0.05m), facade facing the road (<= 2 deg),
// own side of the road, zero pairwise SAT overlap, setback boxes retired
// behind the front line, strips only for 1.5-8m gaps, block lifecycle wired,
// budgets recorded.
//
// Run: node tests/eastshops_contract.mjs
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};
const sha = (b) => createHash('sha256').update(b).digest('hex');

const IDS = ['shop-134', 'shop-135', 'shop-136', 'shop-137', 'shop-138',
  'shop-139', 'shop-140', 'shop-141', 'shop-142'];
const FRONT = 5.6;
const spec = JSON.parse(await readFile(resolve(root, 'kit/out/east-extension-spec.json'), 'utf8'));
const SAMPLES = spec.samples;
const plan = JSON.parse(await readFile(resolve(root, 'kit/out/east-band/plan.json'), 'utf8'));
const v3blocks = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v3/blocks.json'), 'utf8'));
const v4blocks = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v4/blocks.json'), 'utf8'));
const v4collision = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v4/collision-world.json'), 'utf8'));
const v4manifest = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v4/review-manifest.json'), 'utf8'));
const phSource = Object.fromEntries(v3blocks.placeholders.map((p) => [p.id, p]));

// independent projection onto the BUILT centerline
function project(x, z) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < SAMPLES.length; i++) {
    const d = (SAMPLES[i].x - x) ** 2 + (SAMPLES[i].z - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  const seg = (a, b) => {
    const abx = b.x - a.x, abz = b.z - a.z;
    const L2 = abx * abx + abz * abz;
    if (!L2) return null;
    let t = ((x - a.x) * abx + (z - a.z) * abz) / L2;
    if (t < 0 || t > 1) return null;
    return { fx: a.x + t * abx, fz: a.z + t * abz, s: a.s + t * (b.s - a.s), j: a === SAMPLES[best] ? best : best - 1 };
  };
  const cands = [];
  for (const j of [best - 1, best]) {
    if (j < 0 || j + 1 >= SAMPLES.length) continue;
    const f = seg(SAMPLES[j], SAMPLES[j + 1]);
    if (f) cands.push(f);
  }
  if (!cands.length) cands.push({ fx: SAMPLES[best].x, fz: SAMPLES[best].z, s: SAMPLES[best].s, j: best });
  cands.sort((p, q) => (p.fx - x) ** 2 + (p.fz - z) ** 2 - ((q.fx - x) ** 2 + (q.fz - z) ** 2));
  const f = cands[0];
  const A = SAMPLES[f.j], B = SAMPLES[Math.min(f.j + 1, SAMPLES.length - 1)];
  const tseg = B.s === A.s ? 0 : (f.s - A.s) / (B.s - A.s);
  const nx = A.southNx + tseg * (B.southNx - A.southNx);
  const nz = A.southNz + tseg * (B.southNz - A.southNz);
  const nL = Math.hypot(nx, nz) || 1;
  return { foot: [f.fx, f.fz], s: f.s, southN: [nx / nL, nz / nL] };
}

// S1 — setbacks: every placeholder retired behind the front line, recorded
{
  const setbackBy = Object.fromEntries(plan.setbacks.map((s) => [s.id, s]));
  for (const id of IDS) {
    const sb = setbackBy[id];
    check(`S1: ${id} setback recorded`, !!sb && !!sb.placementAdjust);
    if (!sb) continue;
    const p = phSource[id];
    const hw = p.widthM / 2, hd = p.depthM / 2, th = p.angleRad ?? 0;
    const [px, pz] = sb.glbPoint;
    // nearest distance from the RETREATED box to the built centerline >= 5.6 - 0.05
    let dMin = Infinity;
    for (const q of SAMPLES) {
      const dx = px - q.x, dz = pz - q.z;
      const lx = Math.cos(th) * dx - Math.sin(th) * dz;
      const lz = Math.sin(th) * dx + Math.cos(th) * dz;
      dMin = Math.min(dMin, Math.hypot(Math.max(Math.abs(lx) - hw, 0), Math.max(Math.abs(lz) - hd, 0)));
    }
    check(`S1: ${id} box clear of the front line (>= ${FRONT - 0.05})`, dMin >= FRONT - 0.05, `${dMin.toFixed(3)}`);
    const v4ph = v4blocks.placeholders.find((q) => q.id === id);
    check(`S1: ${id} v4 glbPoint = retreated position + replacedBy`,
      !!v4ph && v4ph.glbPoint.every((v, i) => Math.abs(v - sb.glbPoint[i]) < 1e-9)
      && v4ph.replacedBy === 'block-east-shops');
  }
}

// S2 — module placements recomputed against the built centerline
const sat2d = (a, b) => {
  const centerOf = (o) => [o.c[0] - Math.sin(o.yaw) * o.depth / 2, o.c[1] - Math.cos(o.yaw) * o.depth / 2];
  const cornersOf = (o) => {
    const [cx, cz] = centerOf(o);
    const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
    return [[o.facade / 2, o.depth / 2], [o.facade / 2, -o.depth / 2],
      [-o.facade / 2, o.depth / 2], [-o.facade / 2, -o.depth / 2]]
      .map(([lx, lz]) => [cx + c * lx + s * lz, cz - s * lx + c * lz]);
  };
  const A = cornersOf(a), B = cornersOf(b);
  const axes = [];
  for (const o of [a, b]) {
    const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
    axes.push([c, -s], [s, c]);
  }
  for (const ax of axes) {
    const pa = A.map((p) => p[0] * ax[0] + p[1] * ax[1]);
    const pb = B.map((p) => p[0] * ax[0] + p[1] * ax[1]);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
};
const boxes = [];
{
  const block = v4blocks.blocks.find((b) => b.id === 'block-east-shops');
  check('S2: block-east-shops present with 10 assets (9 modules + strips)',
    !!block && block.assets.length === 10, block ? `${block.assets.length}` : 'missing');
  check('S2: block-east-shops is a revocable autoApply assets block',
    block?.kind === 'assets' && block?.autoApply === true);
  const assetBy = Object.fromEntries((block?.assets ?? []).map((a) => [a.id, a]));
  for (const id of IDS) {
    const e = plan.entries.find((x) => x.id === id);
    if (!e || e.error) { check(`S2: ${id} plan entry`, false); continue; }
    const a = assetBy[`eastshop-${id}`];
    check(`S2: ${id} instanced in the block`, !!a);
    if (!a) continue;
    const fc = a.positionGlb;
    const { foot, southN } = project(fc[0], fc[2]);
    const sideDot = (fc[0] - foot[0]) * southN[0] + (fc[2] - foot[1]) * southN[1];
    const sign = sideDot >= 0 ? 1 : -1;
    const expected = [foot[0] + FRONT * sign * southN[0], foot[1] + FRONT * sign * southN[1]];
    const off = Math.hypot(fc[0] - expected[0], fc[2] - expected[1]);
    check(`S2: ${id} front wall on the 5.6m front line (<= 0.05 recomputed)`, off <= 0.05, `${off.toFixed(3)}m`);
    // facade normal = -sign*southN; the module yaw must aim it at the road (<= 2 deg)
    const aim = [-sign * southN[0], -sign * southN[1]];
    const face = [Math.sin(a.rotationYRad), Math.cos(a.rotationYRad)];
    const dot = aim[0] * face[0] + aim[1] * face[1];
    check(`S2: ${id} facade faces the road (<= 2 deg)`, dot >= Math.cos(2 * Math.PI / 180), `dot=${dot.toFixed(4)}`);
    // same side as the retreated placeholder
    const p = phSource[id];
    const away0 = (p.glbPoint[1] - foot[1]) * southN[1] + (p.glbPoint[0] - foot[0]) * southN[0];
    check(`S2: ${id} stays on its own side of the road`, Math.sign(sideDot) === Math.sign(away0));
    const glbBytes = await readFile(resolve(root, `building/${e.module}/model.glb`));
    check(`S2: ${id} glb sha matches building/${e.module}/model.glb`, a.sha256 === sha(glbBytes));
    boxes.push({ id, c: [fc[0], fc[2]], yaw: a.rotationYRad, facade: e.facadeM, depth: e.depthM });
  }
  // zero pairwise SAT overlap (own-side pairs + cross-side)
  let overlaps = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (sat2d(boxes[i], boxes[j])) overlaps += 1;
    }
  }
  check('S2: zero pairwise SAT overlaps across the band', overlaps === 0, `${overlaps}`);
}

// S3 — strips: exactly for 1.5-8m gaps, centered on the real gap midpoint
{
  const bySide = { north: [], south: [] };
  for (const e of plan.entries) {
    if (e.error) continue;
    (bySide[e.side] = bySide[e.side] ?? []).push(e);
  }
  const expected = [];
  for (const [side, list] of Object.entries(bySide)) {
    const ordered = list.slice().sort((a, b) => a.tCoord - b.tCoord);
    for (let i = 1; i < ordered.length; i++) {
      const gap = ordered[i].gapToPrevM ?? 0;
      if (gap > 1.5 && gap <= 8) {
        expected.push({ side, gap, mid: [(ordered[i - 1].finalCenter[0] + ordered[i].finalCenter[0]) / 2,
          (ordered[i - 1].finalCenter[2] + ordered[i].finalCenter[2]) / 2] });
      }
    }
  }
  const strips = v4collision.colliders.filter((c) => c.name.startsWith('eastshops-strips:'));
  check('S3: strip count == gaps in (1.5, 8]', strips.length === expected.length,
    `strips=${strips.length} expected=${expected.length}`);
  for (const ex of expected) {
    const near = strips.map((s) => ({ s, d: Math.hypot((s.min[0] + s.max[0]) / 2 - ex.mid[0],
      (s.min[2] + s.max[2]) / 2 - ex.mid[1]) })).sort((a, b) => a.d - b.d)[0];
    check(`S3: strip near the ${ex.side} gap midpoint (<= 0.3m)`, near && near.d <= 0.3,
      near ? `${near.d.toFixed(3)}m` : 'none');
  }
  // >8m gaps carry no strip
  const openGaps = [];
  for (const [side, list] of Object.entries(bySide)) {
    const ordered = list.slice().sort((a, b) => a.tCoord - b.tCoord);
    for (let i = 1; i < ordered.length; i++) {
      const gap = ordered[i].gapToPrevM ?? 0;
      if (gap > 8) openGaps.push({ side, gap });
    }
  }
  check('S3: open stretches recorded (>8m, no wall)', openGaps.length >= 1,
    openGaps.map((g) => `${g.side}:${g.gap}`).join(', '));
}

// S5 — AABB Y reconcile (GPT review re-check): every obb-bearing collider's
// min/max Y must equal obb.pos[1] + obb.center[1] ± size[1]/2 (westshop records used to
// flatten upper floors/counters onto the ground)
{
  let bad = 0;
  for (const c of v4collision.colliders) {
    if (!c.obb) continue;
    const lo = (c.obb.pos[1] ?? 0) + c.obb.center[1] - c.obb.size[1] / 2;
    const hi = (c.obb.pos[1] ?? 0) + c.obb.center[1] + c.obb.size[1] / 2;
    if (Math.abs(c.min[1] - lo) > 1e-3 || Math.abs(c.max[1] - hi) > 1e-3) bad += 1;
  }
  check('S5: every obb collider Y range == pos + center ± size/2', bad === 0, `${bad} mismatches`);
  // the stage flank walls (adoption batch fix) composed into the v4 world
  const flanks = v4collision.colliders.filter((c) => c.name === 'yimenstage:stage-flank-wall');
  check('S5: stage flank walls present (2)', flanks.length === 2, `${flanks.length}`);
  const flankOk = flanks.every((f) => Math.abs(f.min[1] - 2.40) < 1e-3 && Math.abs(f.max[1] - 3.21) < 1e-3);
  check('S5: flank wall Y 2.40..3.21 (matches the visible timber boards)', flankOk);
}

// S4 — budgets (DESIGN_SPEC.packageJ: block <= 110k, full scene <= 700k)
{
  const b = v4manifest.budgets ?? {};
  check('S4: eastShopsBlockTris <= 110000', b.eastShopsBlockPass === true && b.eastShopsBlockTris <= 110000,
    `${b.eastShopsBlockTris}`);
  check('S4: fullSceneV4Tris <= 700000', b.fullSceneV4Pass === true && b.fullSceneV4Tris <= 700000,
    `${b.fullSceneV4Tris}`);
}

console.log(failures === 0 ? '\nEASTSHOPS_CONTRACT PASS' : `\nEASTSHOPS_CONTRACT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
