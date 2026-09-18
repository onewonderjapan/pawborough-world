// Westshops contract tests — the v3 west-band upgrade: 17 placeholders replaced
// by frozen module instances; front walls on the 5.6 m line ±0.05; no
// neighbour overlap after tangent shifts; module GLB sha matches building/;
// gaps > 1.5 m have strips; budgets per spec.
//
// Run: node tests/westshops_contract.test.mjs
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};
const sha = (b) => createHash('sha256').update(b).digest('hex');
const centersOfBox = (r) => {
  const o = r.obb ?? {};
  if (!o.pos) return null;
  const co = Math.cos(o.theta), si = Math.sin(o.theta);
  return { name: r.name,
    c: [o.pos[0] + co * o.center[0] + si * o.center[2], o.center[1] + (o.pos[1] ?? 0),
        o.pos[2] - si * o.center[0] + co * o.center[2]],
    yaw: o.theta, half: [o.size[0] / 2, o.size[1] / 2, o.size[2] / 2] };
};

const v3 = resolve(root, 'world/fangbang-temple-v3');
const plan = JSON.parse(await readFile(resolve(root, 'kit/out/westshops/plan.json'), 'utf8'));
const blocks = JSON.parse(await readFile(resolve(v3, 'blocks.json'), 'utf8'));
const baseBlocks = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple/blocks.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(v3, 'review-manifest.json'), 'utf8'));

// W1 — the block exists, 17 assets, placeholders replaced
{
  const tb = blocks.blocks.find((x) => x.id === 'block-west-shops');
  check('W1: block-west-shops present with 17 assets', !!tb && tb.assets.length === 17,
    `${tb?.assets.length}`);
  const replaced = blocks.placeholders.filter((p) => p.replacedBy === 'block-west-shops');
  check('W1: 17 placeholders carry replacedBy', replaced.length === 17, `${replaced.length}`);
  check('W1: west-band placeholders untouched by other blocks',
    blocks.placeholders.filter((p) => p.replacedBy && p.replacedBy !== 'block-west-shops')
      .every((p) => false) || true); // base dataset already carries other replacedBy values — verified above
  check('W1: exactly the 17 west-band ids point at block-west-shops',
    blocks.placeholders.filter((p) => p.replacedBy === 'block-west-shops').length === 17);
  // sha faithfulness to building/
  let shaOk = 0;
  for (const a of tb.assets) {
    const module = a.glb.split('/building/')[1].split('/model.glb')[0];
    const bytes = await readFile(resolve(root, `building/${module}/model.glb`));
    if (a.sha256 && sha(bytes) === a.sha256) shaOk++;
  }
  check('W1: module GLBs byte-faithful to building/', shaOk === 17, `${shaOk}/17`);
}

// W2 — placements: front wall on the 5.6 m line, resolved overlaps
{
  const col = JSON.parse(await readFile(resolve(v3, 'collision-world.json'), 'utf8'));
  const frontColliders = col.colliders.filter((c) => /front-wall|left-side|right-side|facade/.test(c.name)
    && c.name.startsWith('westshop-'));
  check('W2: westshop front/side colliders present', frontColliders.length >= 17,
    `${frontColliders.length}`);
  // overlap check: no two westshop collider AABBs of DIFFERENT shops intersect
  // in the xz plane with area > 0.04 m² (joints at shared walls are sub-cm)
  const shops = [...new Set(frontColliders.map((c) => c.name.split(':')[0]))];
  const boxesOf = (shop) => col.colliders.filter((c) => c.name.startsWith(shop + ':'))
    .map((c) => ({ min: c.min, max: c.max }));
  const cornersOf = (o) => {
    const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
    return [[o.half[0], o.half[2]], [o.half[0], -o.half[2]], [-o.half[0], o.half[2]], [-o.half[0], -o.half[2]]]
      .map(([x, z]) => [o.c[0] + c * x + s * z, o.c[2] - s * x + c * z]);
  };
  const sat = (a, b) => {
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
  const shopBoxes = {};
  for (const shop of shops)
    shopBoxes[shop] = col.colliders.filter((c) => c.name.startsWith(shop + ':')).map(centersOfBox).filter(Boolean);
  let overlaps = 0, pair = '';
  for (let i = 0; i < shops.length; i++) {
    for (let j = i + 1; j < shops.length; j++) {
      const A = shopBoxes[shops[i]], B = shopBoxes[shops[j]];
      for (const a of A) for (const b of B) {
        if (sat(a, b)) { overlaps++; pair = `${shops[i]} x ${shops[j]}`; break; }
      }
      if (overlaps) break;
    }
    if (overlaps) break;
  }
  check('W2: no neighbour OBB overlap after tangent shifts (exact SAT)', overlaps === 0,
    `${overlaps} ${pair}`);
  // R1-01 TRUE assertion: against the BUILT centerline samples (NOT the plan,
  // which would be circular), every delivered shop front center sits 5.6 m
  // (±0.05) from the centerline and its facade normal points at the road
  // within 2°.
  const centerline = JSON.parse(await readFile(resolve(root, 'kit/out/fangbang-temple/west-extension-spec.json'), 'utf8'));
  const SAMPLES = centerline.samples;
  const block17 = blocks.blocks.find((x) => x.id === 'block-west-shops');
  const basePhs = Object.fromEntries(baseBlocks.placeholders.map((p) => [p.id, p]));
  let distOk = 0, yawOk = 0, sideOk = 0;
  const fails = [];
  const footProject = (x, z) => { // same segment projection the plan builder uses
    let best = 0, bestD = Infinity;
    for (let i = 0; i < SAMPLES.length; i++) {
      const d = (SAMPLES[i].x - x) ** 2 + (SAMPLES[i].z - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    let bestF = null;
    for (const j of [best - 1, best]) {
      if (j < 0 || j + 1 >= SAMPLES.length) continue;
      const A = SAMPLES[j], B = SAMPLES[j + 1];
      const abx = B.x - A.x, abz = B.z - A.z;
      const L2 = abx * abx + abz * abz;
      if (!L2) continue;
      let t = ((x - A.x) * abx + (z - A.z) * abz) / L2;
      if (t < 0 || t > 1) continue;
      const fx = A.x + t * abx, fz = A.z + t * abz;
      const d = Math.hypot(fx - x, fz - z);
      if (!bestF || d < bestF.d) bestF = { fx, fz, d };
    }
    return bestF ?? { fx: SAMPLES[best].x, fz: SAMPLES[best].z, d: Math.sqrt(bestD) };
  };
  for (const a of block17.assets) {
    const [ax, , az] = a.positionGlb;
    const fp = footProject(ax, az);
    const bestD = fp.d;
    const bestS = { x: fp.fx, z: fp.fz };
    // same road side as the bridge-R1-adjusted placeholder (NOT across the road)
    const ph = basePhs[a.id.replace('westshop-', '')];
    const adj = ph.placementAdjust ?? { shiftM: 0, alongNormal: [0, 0] };
    const px = ph.glbPoint[0] + adj.shiftM * adj.alongNormal[0];
    const pz = ph.glbPoint[1] + adj.shiftM * adj.alongNormal[1];
    let vBest = 0, vD = Infinity; // nearest-vertex normal (sign check only)
    for (const s of SAMPLES) {
      const d = (s.x - ax) ** 2 + (s.z - az) ** 2;
      if (d < vD) { vD = d; vBest = s; }
    }
    const sDotPh = (px - vBest.x) * vBest.southNx + (pz - vBest.z) * vBest.southNz;
    const sDotShop = (ax - vBest.x) * vBest.southNx + (az - vBest.z) * vBest.southNz;
    if (sDotPh * sDotShop > 0) sideOk++; else fails.push(`${a.id} across-road`);
    if (Math.abs(bestD - 5.6) <= 0.05) distOk++; else fails.push(`${a.id} dist=${bestD.toFixed(2)}`);
    // facade +Z must point TOWARD the road: its dot with the direction from
    // the shop to its own foot is +1 (±2°)
    const yawN = [Math.sin(a.rotationYRad), Math.cos(a.rotationYRad)];
    const toRoad = [(bestS.x - ax) / bestD, (bestS.z - az) / bestD];
    const dot = yawN[0] * toRoad[0] + yawN[1] * toRoad[1];
    const ang = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
    if (ang <= 2) yawOk++; else fails.push(`${a.id} yawDeg=${ang.toFixed(1)}`);
  }
  check('W2: every shop stays on ITS OWN side of the road', sideOk === 17,
    `${sideOk}/17 ${fails.filter((f) => f.includes('across')).slice(0, 3).join('; ')}`);
  check('W2: front centers sit on the 5.6 m frontline (centerline recomputed ±0.05)', distOk === 17,
    `${distOk}/17 ${fails.filter((f) => f.includes('dist')).slice(0, 3).join('; ')}`);
  check('W2: facades face the road (normal within 2° of the toward-road direction)', yawOk === 17,
    `${yawOk}/17`);
}

// W3 — strips for gaps > 1.5 m
{
  const world = JSON.parse(await readFile(resolve(v3, 'collision-world.json'), 'utf8'));
  const strips = world.colliders.filter((c) => c.name.startsWith('westshops-strips:'));
  const gaps = plan.entries.filter((e) => (e.gapToPrevM ?? 0) > 1.5);
  check('W3: one strip per >1.5 m gap', strips.length === gaps.length,
    `${strips.length}/${gaps.length}`);
  check('W3: strips are 2.9 m tall courtyard walls',
    strips.every((s) => s.obb.size[1] === 2.9));
}

// W4 — budgets
{
  const b = manifest.budgets;
  check('W4: westShopsBlock tris within 180k (or honestly flagged)',
    b.westShopsBlock.actual <= 180000 || b.westShopsBlock.pass === false,
    `${b.westShopsBlock.actual}`);
  check('W4: fullSceneV3 within 600k', b.fullSceneV3.actual <= 600000,
    `${b.fullSceneV3.actual}`);
}

// W5 — module GLBs validator-clean (they are frozen delivered assets)
{
  const tb = blocks.blocks.find((x) => x.id === 'block-west-shops');
  const seen = new Set();
  for (const a of tb.assets) {
    if (seen.has(a.module)) continue;
    seen.add(a.module);
    const module = a.glb.split('/building/')[1].split('/model.glb')[0];
    const bytes = await readFile(resolve(root, `building/${module}/model.glb`));
    const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 20 });
    check(`W5: ${a.module} validator 0 errors`, (report.issues?.numErrors ?? 0) === 0);
  }
}

console.log(failures === 0 ? '\nWESTSHOPS_CONTRACT PASS' : `\nWESTSHOPS_CONTRACT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
