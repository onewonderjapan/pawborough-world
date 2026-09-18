// E3 props contract — the revocable street life layer as REAL data: dataset
// integrity, placement rules (wall band, route corridor, per-facade cap,
// awning families/height/collision-free), SAT re-verification against the
// world colliders, budgets, and default-off revocability.
//
// Run: node tests/props_contract.test.mjs
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DS = resolve(root, 'world/street-props');
const PLAN = resolve(root, 'kit/out/props/plan.json');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};
const sha = (b) => createHash('sha256').update(b).digest('hex');

const manifest = JSON.parse(await readFile(resolve(DS, 'review-manifest.json'), 'utf8'));
const instances = JSON.parse(await readFile(resolve(DS, 'instances.json'), 'utf8'));
const collision = JSON.parse(await readFile(resolve(DS, 'collision.json'), 'utf8'));
const world = JSON.parse(await readFile(resolve(root, 'world/collision-world.json'), 'utf8'));
const route = JSON.parse(await readFile(resolve(root, 'world/route.json'), 'utf8'));
const baseInstances = JSON.parse(await readFile(resolve(root, 'world/instances.json'), 'utf8'));
const blocks = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v3/blocks.json'), 'utf8'));

// P1 — assets: validator clean, manifest-faithful, budgets
for (const [id, a] of Object.entries(manifest.assets)) {
  const bytes = await readFile(resolve(root, a.file.replace('./', '')));
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 20 });
  check(`P1: ${id}.glb validator 0 errors`, (report.issues?.numErrors ?? 0) === 0,
    `${report.issues?.numErrors ?? 0}e/${report.issues?.numWarnings ?? 0}w`);
  check(`P1: ${id}.glb bytes+sha match manifest`, a.bytes === bytes.byteLength && a.sha256 === sha(bytes));
  check(`P1: ${id}.glb unique tris <= 1500`, a.triangles <= 1500, `${a.triangles}`);
}
check('P1: placed triangles <= 20k', manifest.placedTriangles <= manifest.budgets.placedTriangles.limit,
  `${manifest.placedTriangles}`);
check('P1: counts hit the spec target exactly',
  JSON.stringify(manifest.counts) === JSON.stringify({
    'cloth-awning': 6, 'bicycle-28': 12, 'wood-crate': 10, 'bamboo-basket': 6, 'bamboo-chair': 4 }),
  JSON.stringify(manifest.counts));

// P2 — revocability contract: default OFF, explicit opt-in only
check('P2: defaultLoaded false', instances.defaultLoaded === false);
check('P2: load documented as ?props=1', instances.loadParam === '?props=1');

// P3 — placement rules re-verified from the instance table
const facadeMap = new Map();
for (const i of baseInstances.instances)
  facadeMap.set(i.id, { positionGlb: i.positionGlb, rotationYRad: i.rotationYRad });
for (const bid of ['block-east-edge-shops', 'block-street-completion-shops', 'block-west-shops']) {
  const b = blocks.blocks.find((x) => x.id === bid);
  for (const a of b.assets ?? [])
    facadeMap.set(a.id, { positionGlb: a.positionGlb, rotationYRad: a.rotationYRad });
}
const familyOf = (m) => {
  const s = `${m}`.toLowerCase();
  if (s.includes('plain')) return 'plain';
  if (s.includes('curio')) return 'curio';
  if (s.includes('cloth')) return 'cloth';
  return s;
};
{
  const perFacade = new Map();
  for (const inst of instances.instances)
    perFacade.set(inst.facade, (perFacade.get(inst.facade) ?? 0) + 1);
  check('P3: max 2 items per facade', Math.max(...perFacade.values()) <= 2,
    `${Math.max(...perFacade.values())}`);
  let badWall = 0, badRoute = 0, badAnchor = 0, badFamily = 0;
  for (const inst of instances.instances) {
    const f = facadeMap.get(inst.facade);
    if (!f) { badAnchor++; continue; }
    const yaw = f.rotationYRad;
    const nx = Math.sin(yaw), nz = Math.cos(yaw);
    const dx = inst.positionGlb[0] - f.positionGlb[0];
    const dz = inst.positionGlb[2] - f.positionGlb[2];
    const along = dx * Math.cos(yaw) + dz * (-Math.sin(yaw));
    const dWall = dx * nx + dz * nz;
    if (inst.item !== 'cloth-awning' && !inst.stackOn
      && (dWall < 0.25 - 0.35 || dWall > 0.9 + 0.35)) badWall += 1;
    if (inst.item === 'cloth-awning') {
      if (!(familyOf(inst.module) === 'plain' || familyOf(inst.module) === 'curio'
        || familyOf(inst.module) === 'cloth')) badFamily += 1;
      if (Math.abs((inst.y ?? 0) - 2.85) > 0.3) badFamily += 1;
    }
    // route corridor (point distance, props are small)
    let best = 1e9;
    for (let k = 1; k < route.mainStreet.length; k++) {
      const a = route.mainStreet[k - 1], b = route.mainStreet[k];
      const ddx = b[0] - a[0], ddz = b[2] - a[2];
      const t = Math.max(0, Math.min(1, ((inst.positionGlb[0] - a[0]) * ddx
        + (inst.positionGlb[2] - a[2]) * ddz) / (ddx * ddx + ddz * ddz)));
      best = Math.min(best, Math.hypot(inst.positionGlb[0] - (a[0] + ddx * t),
        inst.positionGlb[2] - (a[2] + ddz * t)));
    }
    if (best < 1.2 - 0.3) badRoute += 1;
  }
  check('P3: every instance anchors a real facade', badAnchor === 0, `${badAnchor}`);
  check('P3: ground items within the wall band (0.25-0.9 +- half size)', badWall === 0, `${badWall}`);
  check('P3: items outside the route corridor (>= 1.2 - prop half)', badRoute === 0, `${badRoute}`);
  check('P3: awnings only on plain/curio/cloth at ~2.85', badFamily === 0, `${badFamily}`);
}

// P4 — SAT re-check: every prop OBB vs every body-height world collider
{
  const cornersOf = (cx, cz, size, theta) => {
    const c = Math.cos(theta), s = Math.sin(theta);
    const hx = size[0] / 2, hz = size[2] / 2;
    return [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]
      .map(([x, z]) => [cx + c * x + s * z, cz - s * x + c * z]);
  };
  const sat = (A, B) => {
    const axes = [];
    for (const P of [A, B]) for (let i = 0; i < 4; i++) {
      const [x1, z1] = P[i], [x2, z2] = P[(i + 1) % 4];
      const ex = x2 - x1, ez = z2 - z1, len = Math.hypot(ex, ez) || 1;
      axes.push([-ez / len, ex / len]);
    }
    for (const [ax, az] of axes) {
      let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
      for (const [x, z] of A) { const d = ax * x + az * z; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (const [x, z] of B) { const d = ax * x + az * z; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      if (a1 <= b0 || b1 <= a0) return false;
    }
    return true;
  };
  const worldBoxes = world.colliders
    .filter((c) => c.max[1] > 0.05 && c.min[1] < 1.1)
    .map((c) => cornersOf((c.min[0] + c.max[0]) / 2, (c.min[2] + c.max[2]) / 2,
      [c.max[0] - c.min[0], 0, c.max[2] - c.min[2]], c.obb?.theta ?? 0));
  let hits = 0;
  for (const c of collision.colliders) {
    const o = c.obb;
    const co = Math.cos(o.theta), si = Math.sin(o.theta);
    const cx = o.pos[0] + co * o.center[0] + si * o.center[2];
    const cz = o.pos[2] - si * o.center[0] + co * o.center[2];
    const mine = cornersOf(cx, cz, o.size, o.theta);
    for (const wb of worldBoxes) if (sat(mine, wb)) hits += 1;
  }
  check('P4: zero prop/world collider intersections (SAT)', hits === 0, `${hits}`);
  check('P4: awnings have no collision records',
    !collision.colliders.some((c) => c.group.includes('awning')));
}

// P5 — collision records consistent (obbToWorld)
{
  let bad = 0;
  for (const c of collision.colliders) {
    const { pos, theta, center, size } = c.obb;
    const co = Math.cos(theta), si = Math.sin(theta);
    const wx = pos[0] + co * center[0] + si * center[2];
    const wz = pos[2] - si * center[0] + co * center[2];
    const wy = center[1] + (pos[1] ?? 0);
    const hx = Math.abs(co) * size[0] / 2 + Math.abs(si) * size[2] / 2;
    const hz = Math.abs(si) * size[0] / 2 + Math.abs(co) * size[2] / 2;
    if (Math.abs(wx - (c.min[0] + c.max[0]) / 2) > 1e-6
      || Math.abs(wy - (c.min[1] + c.max[1]) / 2) > 1e-6
      || Math.abs(wz - (c.min[2] + c.max[2]) / 2) > 1e-6) bad++;
  }
  check('P5: obbToWorld reproduces every prop collider', bad === 0, `${bad}`);
}

console.log(failures === 0 ? '\nPROPS_CONTRACT PASS' : `\nPROPS_CONTRACT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
