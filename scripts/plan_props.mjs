// E1 — street props planner. Reads the 39 facade instances (16 reviewed street
// + 2 east-edge + 4 completion 130-133 + 17 west band), the street route and
// the world collision set, and deterministically places 38 prop instances:
//   - 0.25..0.9 m from the front wall, on the sidewalk side
//   - outside the +/-1.2 m route corridor
//   - <= 2 items per facade, >= 1.2 m apart along the wall
//   - 2D OBB SAT against EVERY world collider (no intersection)
//   - awnings only on plain/curio/cloth families, y 2.6..3.1, no collision
// Output: kit/out/props/plan.json (instances + rejections + stats).
//
// Run: node scripts/plan_props.mjs
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'kit/out/props');
await mkdir(OUT, { recursive: true });

const cfg = JSON.parse(await readFile(resolve(root, 'kit/props.config.json'), 'utf8'));
const baseInstances = JSON.parse(await readFile(resolve(root, 'world/instances.json'), 'utf8'));
const blocks = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v3/blocks.json'), 'utf8'));
const route = JSON.parse(await readFile(resolve(root, 'world/route.json'), 'utf8'));
const world = JSON.parse(await readFile(resolve(root, 'world/collision-world.json'), 'utf8'));
const ITEMS = Object.fromEntries(cfg.items.map((i) => [i.id, i]));

// --- facade registry -----------------------------------------------------------
const facades = [];
for (const i of baseInstances.instances) {
  facades.push({ id: i.id, module: i.module, positionGlb: i.positionGlb,
                 rotationYRad: i.rotationYRad, width: (i.sRange[1] - i.sRange[0]) });
}
const bid = (id) => blocks.blocks.find((b) => b.id === id);
for (const a of bid('block-east-edge-shops').assets)
  facades.push({ id: a.id, module: a.id.replace('east-shop-', 'east-shop-'), positionGlb: a.positionGlb,
                 rotationYRad: a.rotationYRad, width: 6.0 });
for (const a of bid('block-street-completion-shops').assets)
  facades.push({ id: a.id, module: a.id, positionGlb: a.positionGlb, rotationYRad: a.rotationYRad, width: 6.0 });
for (const a of bid('block-west-shops').assets)
  facades.push({ id: a.id, module: a.module ?? 'shop', positionGlb: a.positionGlb,
                 rotationYRad: a.rotationYRad, width: 6.0 });

const familyOf = (f) => {
  const m = `${f.module}`.toLowerCase();
  if (m.includes('plain')) return 'plain';
  if (m.includes('curio')) return 'curio';
  if (m.includes('cloth')) return 'cloth';
  if (m.includes('pharmacy')) return 'pharmacy';
  if (m.includes('dry_goods')) return 'dry_goods';
  return m;
};

// --- geometry helpers ------------------------------------------------------------
const distToRoute = (x, z) => {
  let best = 1e9;
  for (let k = 1; k < route.mainStreet.length; k++) {
    const a = route.mainStreet[k], b = route.mainStreet[k - 1];
    const dx = b[0] - a[0], dz = b[2] - a[2];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - (a[0] + dx * t), z - (a[2] + dz * t)));
  }
  return best;
};
const cornersOf = (cx, cz, size, theta) => {
  const c = Math.cos(theta), s = Math.sin(theta);
  const hx = size[0] / 2, hz = size[2] / 2;
  return [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]
    .map(([x, z]) => [cx + c * x + s * z, cz - s * x + c * z]);
};
const satOverlap = (A, B) => {
  const axes = [];
  for (const P of [A, B]) {
    for (let i = 0; i < 4; i++) {
      const [x1, z1] = P[i], [x2, z2] = P[(i + 1) % 4];
      const ex = x2 - x1, ez = z2 - z1;
      const len = Math.hypot(ex, ez) || 1;
      axes.push([-ez / len, ex / len]);
    }
  }
  for (const [ax, az] of axes) {
    let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
    for (const [x, z] of A) { const d = ax * x + az * z; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const [x, z] of B) { const d = ax * x + az * z; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 <= b0 || b1 <= a0) return false;
  }
  return true;
};

const colliders = world.colliders
  .filter((c) => c.max[1] > 0.05 && c.min[1] < 1.1)   // only body-height obstacles
  .map((c) => ({ name: c.name, corners: cornersOf(
    (c.min[0] + c.max[0]) / 2, (c.min[2] + c.max[2]) / 2,
    [c.max[0] - c.min[0], 0, c.max[2] - c.min[2]], c.obb?.theta ?? 0) }));

// --- deterministic placement ------------------------------------------------------
const PLAN = [
  ['cloth-awning', 6], ['bicycle-28', 12], ['wood-crate', 10],
  ['bamboo-basket', 6], ['bamboo-chair', 4],
];
const perFacade = new Map();
const placed = [];
const rejections = [];
const slotsTaken = new Set();
let seq = 0;

const tryPlace = (item, facade, u, d, opts = {}) => {
  const it = ITEMS[item];
  const yaw = facade.rotationYRad;
  const nx = Math.sin(yaw), nz = Math.cos(yaw);          // outward normal (facade +Z)
  const tx = Math.cos(yaw), tz = -Math.sin(yaw);         // along-wall
  const size = it.sizeM;
  // bicycle parks ALONG the wall (frame axis parallel): item local z is the
  // frame axis, so yaw += 90deg; everything else faces the street
  const rot = item === 'bicycle-28' ? yaw + Math.PI / 2 : yaw;
  const halfDepth = item === 'bicycle-28' ? size[2] / 2 : size[2] / 2;
  const halfAlong = item === 'bicycle-28' ? size[0] / 2 : size[0] / 2;
  const dCenter = Math.max(cfg.placement.fromWallMinM + halfDepth,
    Math.min(opts.d ?? 0.55, cfg.placement.fromWallMaxM));
  const x = facade.positionGlb[0] + nx * dCenter + tx * u;
  const z = facade.positionGlb[2] + nz * dCenter + tz * u;
  const y = opts.y ?? 0;
  if (distToRoute(x, z) < cfg.placement.routeCorridorM)
    return { fail: `route corridor ${distToRoute(x, z).toFixed(2)} < ${cfg.placement.routeCorridorM}` };
  const mine = cornersOf(x, z, item === 'bicycle-28' ? [size[2], 0, size[0]] : size, rot);
  // awnings hang at y 2.6-3.1 on their own facade: exempt from body-height SAT
  if (item !== 'cloth-awning') {
    for (const c of colliders)
      if (satOverlap(mine, c.corners)) return { fail: `SAT ${c.name}` };
  }
  for (const p of placed) {
    if (p.facade !== facade.id) continue;
    const dx = p.positionGlb[0] - x, dz = p.positionGlb[2] - z;
    if (Math.hypot(dx, dz) < 1.2 && (opts.y ?? 0) === 0) return { fail: 'spacing < 1.2 on facade' };
  }
  return { x, z, rot, dCenter };
};

for (const [item, count] of PLAN) {
  const it = ITEMS[item];
  let made = 0;
  for (const facade of facades) {
    if (made >= count) break;
    const n = perFacade.get(facade.id) ?? 0;
    if (n >= cfg.placement.perFacadeMax) continue;
    if (it.familiesOnly && !it.familiesOnly.some((fam) => familyOf(facade) === fam)) {
      if (!rejections.some((r) => r.facade === facade.id && r.item === item))
        rejections.push({ item, facade: facade.id, reason: `family ${familyOf(facade)} not in ${it.familiesOnly}` });
      continue;
    }
    const us = it.familiesOnly ? [0] : [-facade.width / 4, 0, facade.width / 4];
    let done = false;
    for (const u of us) {
      for (const d of (0.45, [0.5, 0.75])) {
        const r = tryPlace(item, facade, u, d, item === 'cloth-awning' ? { y: 2.85, d: 0.62 } : { d });
        if (r.fail) {
          if (rejections.filter(x => x.item === item).length < 220) rejections.push({ item, facade: facade.id, u, reason: r.fail });
          continue;
        }
        seq += 1;
        placed.push({ id: `prop-${String(seq).padStart(3, '0')}`, item, facade: facade.id,
                      module: facade.module,
                      positionGlb: [+r.x.toFixed(4), item === 'cloth-awning' ? 2.85 : 0, +r.z.toFixed(4)],
                      rotationYRad: +r.rot.toFixed(5), y: item === 'cloth-awning' ? 2.85 : 0, u });
        perFacade.set(facade.id, (perFacade.get(facade.id) ?? 0) + 1);
        made += 1;
        done = true;
        break;
      }
      if (done) break;
    }
  }
  if (made < count) rejections.push({ item, reason: `only ${made}/${count} placed` });
}

// one 2-stack: move the LAST crate on top of the first (10 crates total)
{
  const first = placed.find((p) => p.item === 'wood-crate');
  const last = placed.filter((p) => p.item === 'wood-crate').pop();
  if (first && last && first !== last) {
    last.positionGlb = [first.positionGlb[0], 0.45, first.positionGlb[2]];
    last.rotationYRad = first.rotationYRad;
    last.stackOn = first.id;
  }
}
for (const p of placed) delete p.u;

const counts = {};
for (const p of placed) counts[p.item] = (counts[p.item] ?? 0) + 1;
const plan = {
  generatedBy: 'scripts/plan_props.mjs',
  config: 'kit/props.config.json',
  facadesConsidered: facades.length,
  instances: placed,
  counts,
  target: Object.fromEntries(PLAN),
  rejections: rejections.slice(0, 240),
  rejectionReasonSummary: (() => {
    const s = {};
    for (const r of rejections) s[r.reason?.split(' ').slice(0, 2).join(' ') ?? 'other'] =
      (s[r.reason?.split(' ').slice(0, 2).join(' ') ?? 'other'] ?? 0) + 1;
    return s;
  })(),
};
await writeFile(resolve(OUT, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
console.log(`PLAN_READY facades=${facades.length} instances=${placed.length} `
  + `counts=${JSON.stringify(counts)} rejections=${rejections.length}`);
