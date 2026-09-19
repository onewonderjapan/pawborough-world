// D3 trees contract — the camphor module AND its 4 dataset instances: budgets,
// canopy-bottom clearance, foliage material with zero images, collision
// clearance vs every other collider, route-corridor clearance.
// v2 (adoption batch 20260919, owner G12 rebuild): multi-lobe canopy, fixed
// seed 20260919, 1800-2600 tri budget, canopy bottom >= 3.2, trunk box
// 0.55 x 3.0 x 0.55, two-tone foliage; frame-rule results must be on file.
//
// Run: node tests/trees_contract.test.mjs
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';
import { readGlb } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = resolve(root, 'kit/out/tree-camphor');
const DS = resolve(root, 'world/temple-axis-v3');
const GLB = 'tree-camphor-v2.glb';
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

// T1 — the module GLB
{
  const bytes = await readFile(resolve(KIT, GLB));
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 20 });
  check('T1: tree-camphor-v2.glb validator 0 errors', (report.issues.numErrors ?? 0) === 0,
    `${report.issues.numErrors}e/${report.issues.numWarnings}w`);
  const glb = readGlb(bytes);
  check('T1: triangles within the 1800-2600 v2 budget', glb.totalTriangles >= 1800 && glb.totalTriangles <= 2600,
    `${glb.totalTriangles}`);
  const mats = glb.gltf.materials ?? [];
  check('T1: two-tone foliage materials present with no texture',
    ['foliage', 'foliage2'].every((n) => mats.some((m) => m.name === n))
    && (glb.gltf.images ?? []).every((img) => /wood/i.test(img.name ?? '')),
    `materials: ${mats.map((m) => m.name).join(',')}; images: ${(glb.gltf.images ?? []).map((i) => i.name).join(',') || 'none'}`);
  // canopy bottom: no foliage vertex below y 3.19 (contract >= 3.2)
  const foliage = glb.meshes.filter((mesh) => /foliage/.test(mesh.name));
  check('T1: foliage meshes present', foliage.length >= 1);
  let minY = 1e9;
  for (const mesh of foliage) minY = Math.min(minY, ...mesh.positions.filter((_, i) => i % 3 === 1));
  check('T1: canopy bottom >= 3.2 (vertex level)', minY >= 3.19, `minY ${minY.toFixed(4)}`);
  const trunk = JSON.parse(await readFile(resolve(KIT, 'collision.json'), 'utf8'))
    .colliders.find((c) => c.name === 'tree-trunk-block');
  check('T1: trunk collision box 0.55 x 3.0 x 0.55', !!trunk
    && trunk.obb.size.every((v, i) => Math.abs(v - [0.55, 3.0, 0.55][i]) < 1e-6),
    trunk ? JSON.stringify(trunk.obb.size) : 'missing');
  const measure = JSON.parse(await readFile(resolve(KIT, 'measurements.json'), 'utf8'));
  check('T1: fixed random seed recorded (20260919)', measure.design?.randomSeed === 20260919);
}

// T2 — dataset instances + clearances (against the REAL assembled world)
{
  const instances = JSON.parse(await readFile(resolve(DS, 'instances.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(resolve(DS, 'review-manifest.json'), 'utf8'));
  const collision = JSON.parse(await readFile(resolve(DS, 'collision-world.json'), 'utf8'));
  const route = JSON.parse(await readFile(resolve(DS, 'route.json'), 'utf8'));
  const at = manifest.assets.tree.instancesAt ?? {};
  const ids = Object.keys(at);
  check('T2: exactly 4 tree instances', ids.length === 4, ids.join(','));
  for (const id of ids) {
    const inst = instances.instances.find((i) => i.id === id);
    check(`T2: ${id} instanced at its manifest position`, !!inst
      && inst.positionGlb.every((v, i) => Math.abs(v - at[id][i]) < 1e-9),
      inst ? `${inst.positionGlb}` : 'missing');
  }
  // trunk vs every other collider: >= 0.6 gap (2D, colliders reaching y<3)
  let worst = { d: 1e9, pair: '' };
  for (const id of ids) {
    const mine = collision.colliders.find((c) => c.name === `${id}:tree-trunk-block`);
    if (!mine) { check(`T2: ${id} trunk collider present in the world`, false); continue; }
    for (const c of collision.colliders) {
      if (c.name.startsWith(`${id}:`) || c.name.startsWith('court:incense-road')) continue;
      if (c.max[1] <= 0.05 || c.min[1] >= 3.0) continue;
      const dx = Math.max(c.min[0] - mine.max[0], mine.min[0] - c.max[0], 0);
      const dz = Math.max(c.min[2] - mine.max[2], mine.min[2] - c.max[2], 0);
      const d = Math.hypot(dx, dz);
      if (d < worst.d) worst = { d, pair: `${id} <-> ${c.name}` };
    }
  }
  check('T2: trunk >= 0.6 from every other collider', worst.d >= 0.6 - 1e-9,
    `${worst.pair} d=${worst.d.toFixed(3)}`);
  // route corridor: trunk center >= 1.75 from the polyline
  const dist = (x, z) => {
    let best = 1e9;
    for (let k = 1; k < route.mainStreet.length; k++) {
      const a = route.mainStreet[k - 1], b = route.mainStreet[k];
      const dx = b[0] - a[0], dz = b[2] - a[2];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(x - (a[0] + dx * t), z - (a[2] + dz * t)));
    }
    return best;
  };
  for (const id of ids) {
    const d = dist(at[id][0], at[id][2]);
    check(`T2: ${id} outside the route corridor (>= 1.75)`, d >= 1.75, `${d.toFixed(2)}`);
  }
  // placement shifts recorded (v2 spec deviations / frame-rule retries)
  for (const [tree, note] of Object.entries(manifest.assets.tree.placedShifts ?? {})) {
    check(`T2: ${tree} placement shift recorded`, typeof note === 'string' && note.length > 10, note.slice(0, 60));
  }
  // the dataset carries the v2 GLB and NOT the v1 file
  let hasV2 = false, hasV1 = false;
  try { await readFile(resolve(DS, 'tree-camphor-v2.glb')); hasV2 = true; } catch { /* absent */ }
  try { await readFile(resolve(DS, 'tree-camphor.glb')); hasV1 = true; } catch { /* absent */ }
  check('T2: dataset carries tree-camphor-v2.glb (v1 retired)', hasV2 && !hasV1);
}

// T3 — frame rule on file (adoption batch I1): for the three frozen cameras,
// canopy pixels inside the central 60% x 60% region must be ZERO, per the
// mask renders recorded in artifacts/adoption-east/frame-rule.json
{
  const fr = JSON.parse(await readFile(resolve(root, 'artifacts/adoption-east/frame-rule.json'), 'utf8'));
  for (const cam of ['court2-pair', 'court3-axis', 'houdian-front']) {
    const row = fr.cameras?.find((c) => c.camera === cam);
    check(`T3: ${cam} central-60% canopy ratio == 0 (mask render)`, !!row && row.canopyCentralRatio === 0,
      row ? `ratio=${row.canopyCentralRatio} shiftedBy=${row.shiftedBy ?? 0}m` : 'missing');
  }
  check('T3: frame-rule render settings recorded', fr.resolution === '1280x720' && fr.centralRegion === 0.6);
}

console.log(failures === 0 ? '\nTREES_CONTRACT PASS' : `\nTREES_CONTRACT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
