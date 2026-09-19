// E2 — assemble world/street-props/: the 5 prop GLBs + the planned 38
// instances + per-instance collision records (awnings excluded, they hang at
// y 2.85) + a review manifest. Revocable block: the page loads it ONLY with
// ?props=1 (default OFF).
//
// Run: node scripts/build_props_world.mjs
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'world/street-props');
const PROPS = resolve(root, 'kit/out/props');
const sha = (b) => createHash('sha256').update(b).digest('hex');

await mkdir(OUT, { recursive: true });
const cfg = JSON.parse(await readFile(resolve(root, 'kit/props.config.json'), 'utf8'));
const measurements = JSON.parse(await readFile(resolve(PROPS, 'measurements.json'), 'utf8'));
const plan = JSON.parse(await readFile(resolve(PROPS, 'plan.json'), 'utf8'));

// --- assets: hash-faithful copies ------------------------------------------------
const assets = {};
for (const item of cfg.items) {
  await copyFile(resolve(PROPS, item.glb), resolve(OUT, item.glb));
  const bytes = await readFile(resolve(OUT, item.glb));
  const m = measurements.items[item.id];
  if (m.fileBytes !== bytes.byteLength || m.sha256 !== sha(bytes))
    throw new Error(`${item.glb} drifted from its kit build`);
  assets[item.id] = { file: `./world/street-props/${item.glb}`, bytes: bytes.byteLength,
                      sha256: sha(bytes), triangles: m.triangles };
}

// --- instances ---------------------------------------------------------------------
await writeFile(resolve(OUT, 'instances.json'), JSON.stringify({
  axis: 'GLB Y-up; facade-facing +Z; bicycles rotated to park along the wall',
  source: 'kit/out/props/plan.json',
  defaultLoaded: false,
  loadParam: '?props=1',
  instances: plan.instances,
}, null, 2) + '\n');

// --- collision: per instance, thin box, awnings excluded ---------------------------
const itemCollision = measurements.collision;
const colliders = [];
for (const p of plan.instances) {
  if (p.item === 'cloth-awning') continue;
  const rec = itemCollision[p.item][0];
  const theta = p.rotationYRad;
  const c = Math.cos(theta), s = Math.sin(theta);
  const [cx, cy, cz] = rec.obb.center;
  const wx = p.positionGlb[0] + c * cx + s * cz;
  const wz = p.positionGlb[2] - s * cx + c * cz;
  const wy = cy + (p.y ?? 0);
  const [sx, sy2, sz] = rec.obb.size;
  colliders.push({
    name: `${p.id}:${rec.name}`, group: `props:${p.item}`, type: 'box',
    min: [wx - Math.abs(c) * sx / 2 - Math.abs(s) * sz / 2, wy - sy2 / 2,
          wz - Math.abs(s) * sx / 2 - Math.abs(c) * sz / 2],
    max: [wx + Math.abs(c) * sx / 2 + Math.abs(s) * sz / 2, wy + sy2 / 2,
          wz + Math.abs(s) * sx / 2 + Math.abs(c) * sz / 2],
    obb: { pos: [p.positionGlb[0], p.y ?? 0, p.positionGlb[2]], theta,
           center: [cx, cy, cz], size: [sx, sy2, sz] },
  });
}
await writeFile(resolve(OUT, 'collision.json'), JSON.stringify({
  axis: 'glTF Y-up; world-space records via obbToWorld',
  colliders,
}, null, 2) + '\n');

// --- manifest -----------------------------------------------------------------------
const placedTris = plan.instances.reduce((s2, p) => s2 + assets[p.item].triangles, 0);
const manifest = {
  datasetId: 'street-props',
  title: '方浜街道生活道具层（1990s，可撤销块 ?props=1 默认关）',
  status: 'delivered_for_lead_review',
  ownerAdopted: false,
  visualReview: 'pending_lead',
  reference: 'DESIGN_SPEC.json packageE_props; all design_inference, 1990s common objects',
  axis: 'GLB Y-up; world-space instance placements from kit/out/props/plan.json',
  assets,
  instances: plan.instances,
  counts: plan.counts,
  placedTriangles: placedTris,
  budgets: {
    uniqueTris: { actual: measurements.budgets.actualMaxUniqueTris, limit: cfg.budgets.uniqueTrisMax },
    placedTriangles: { actual: placedTris, limit: cfg.budgets.placedTrisMax },
    newImages: { actual: 0, limit: 0 },
  },
  revocable: { defaultLoaded: false, loadParam: '?props=1', revoke: 'unload the block or omit ?props=1' },
  collisionCount: colliders.length,
  generatedBy: 'scripts/build_props_world.mjs',
};
await writeFile(resolve(OUT, 'review-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`PROPS_WORLD_READY instances=${plan.instances.length} colliders=${colliders.length} `
  + `placedTris=${placedTris}`);
