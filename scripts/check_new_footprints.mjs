// N1 footprint conflict check — temple-expansion-night-20260917.
//
// Takes the NEW modules' footprint boxes (DESIGN_SPEC numbers, moved to world
// by their instance transforms via the production obbToWorld math) and
// intersects every one of them against the DELIVERED
// world/temple-dadian/collision-world.json records MINUS the records the
// dadian-court-v2 variant removes (court2-side-wall x2, court2-north-closure,
// court2-north-return x2).
//
// Allowed intersections (not conflicts):
//   - the removed wall records (they no longer exist in the v2 dataset)
//   - ground records: walkable slabs the new footprints legitimately stand on
//     (group contains 'temple-ground', or entry-court apron/path/field/border)
// Everything else is a CONFLICT -> fallback #2 (<=0.5 m translation) or a
// recorded blocker.
//
// Run: node scripts/check_new_footprints.mjs [--spec ../DESIGN_SPEC.json]
// Writes kit/out/footprint-check/report.json; exit 0 = no unhandled conflicts.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const specIdx = process.argv.indexOf('--spec');
const SPEC_PATH = resolve(root, specIdx > -1 ? process.argv[specIdx + 1] : '../DESIGN_SPEC.json');

// --- the production transform (src/world/collisionAdapter.obbToWorld) -------
const obbToWorld = (pos, theta, center) => {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [pos[0] + c * center[0] + s * center[2],
          center[1] + (pos[1] ?? 0),
          pos[2] - s * center[0] + c * center[2]];
};
const aabbOf = (pos, theta, center, size) => {
  const [wx, , wz] = obbToWorld(pos, theta, center);
  const c = Math.abs(Math.cos(theta)), s = Math.abs(Math.sin(theta));
  const rx = size[0] / 2 * c + size[2] / 2 * s;
  const rz = size[0] / 2 * s + size[2] / 2 * c;
  return { min: [wx - rx, center[1] - size[1] / 2, wz - rz],
           max: [wx + rx, center[1] + size[1] / 2, wz + rz] };
};
const overlaps = (a, b, eps = 1e-6) => a.min[0] < b.max[0] - eps && a.max[0] > b.min[0] + eps
  && a.min[1] < b.max[1] - eps && a.max[1] > b.min[1] + eps
  && a.min[2] < b.max[2] - eps && a.max[2] > b.min[2] + eps;

const box = (id, pos, theta, center, size, kind) => ({ id, pos, theta, center, size, kind, aabb: aabbOf(pos, theta, center, size) });

// --- new-module footprints, straight from DESIGN_SPEC.json numbers ----------
const HALF_PI = 1.5707963267948966;
const spec = JSON.parse(await readFile(SPEC_PATH, 'utf8'));
const pd = spec.peidian.placement, ga = spec.gallery.placement, st = spec.stage;
const cw = spec.court3AndHoudian, hd = cw.houdian, bw = cw.boundaryWall, nc = cw.northClosure;

// peidian: base slab (local x +-3.75, local z 1.5..-4.6) + body walls
const pdBoxes = [];
for (const side of ['west', 'east']) {
  const p = pd[side], pos = p.originGlb, th = p.yawRad;
  pdBoxes.push(box(`peidian-${side}-base`, pos, th, [0, 0.15, (1.5 - 4.6) / 2], [7.5, 0.3, 6.1], 'structure'));
  pdBoxes.push(box(`peidian-${side}-body`, pos, th, [0, 3.1, -2.3], [7.2, 6.2, 4.6], 'structure'));
}
// gallery: floor + back wall band (local x +-1.5 length, local z 0.4..-2.52 depth)
const gaBoxes = [];
for (const side of ['west', 'east']) {
  const p = ga[side], pos = p.originGlb, th = p.yawRad;
  gaBoxes.push(box(`gallery-${side}`, pos, th, [0, 1.7, (0.4 - 2.52) / 2], [3.0, 3.4, 2.92], 'structure'));
}
// stage: yimen-local origin (0,0,-21), yaw 0 — floor slab + 4 columns + rail
const stPos = [0, 0, -21];
const stBoxes = [
  box('stage-floor', stPos, 0, [0, st.floor.y - st.floor.thicknessM / 2, (st.floor.zLocal[0] + st.floor.zLocal[1]) / 2],
      [st.floor.xM[1] - st.floor.xM[0], st.floor.thicknessM, Math.abs(st.floor.zLocal[1] - st.floor.zLocal[0])], 'structure'),
];
for (const [cx, cz] of st.columns.positions)
  stBoxes.push(box(`stage-column-${cx}_${cz}`, stPos, 0, [cx, st.columns.sizeM[1] / 2, cz],
                   st.columns.sizeM, 'column'));
stBoxes.push(box('stage-front-rail', stPos, 0, [0, st.floor.y + st.frontRail.heightM / 2, st.frontRail.atLocalZ],
                 [6.4, st.frontRail.heightM, 0.08], 'structure'));

// court3 + boundary walls + north closure (world coords, yaw 0)
const [bz0, bz1] = bw.zM, wallTh = 0.28;
const cwBoxes = [];
for (const sgn of [-1, 1])
  cwBoxes.push(box(`boundary-wall-${sgn < 0 ? 'w' : 'e'}`, [0, 0, 0], 0,
                   [sgn * (bw.innerX + wallTh / 2), bw.heightM / 2, (bz0 + bz1) / 2],
                   [wallTh, bw.heightM, Math.abs(bz1 - bz0)], 'structure'));
cwBoxes.push(box('north-closure', [0, 0, 0], 0, [0, nc.heightM / 2, nc.z], [32.8, nc.heightM, wallTh], 'structure'));
{
  const [hx0, hx1] = hd.base.extentX, [hz0, hz1] = hd.base.extentLocalZ;
  const pos = hd.originGlb;
  cwBoxes.push(box('houdian-base', pos, 0, [0, hd.base.topY / 2, (hz0 + hz1) / 2],
                   [hx1 - hx0, hd.base.topY, Math.abs(hz1 - hz0)], 'structure'));
  cwBoxes.push(box('houdian-body', pos, 0, [0, hd.roof.ridgeY / 2, -hd.bodyDepthM / 2],
                   [13.2, hd.roof.ridgeY, hd.bodyDepthM], 'structure'));
}
// walkable new ground (conflicts with ground are allowed, listed for completeness)
const [px0, px1] = cw.sidePassages.xM[0], [qx0, qx1] = cw.sidePassages.xM[1];
const [pz0, pz1] = cw.sidePassages.zM;
cwBoxes.push(box('side-passage-w', [0, 0, 0], 0, [(px0 + px1) / 2, 0, (pz0 + pz1) / 2], [px1 - px0, 0.02, pz1 - pz0], 'ground'));
cwBoxes.push(box('side-passage-e', [0, 0, 0], 0, [(qx0 + qx1) / 2, 0, (pz0 + pz1) / 2], [qx1 - qx0, 0.02, pz1 - pz0], 'ground'));
{
  const [fx0, fx1] = cw.court3.floor.xM, [fz0, fz1] = cw.court3.floor.zM;
  cwBoxes.push(box('court3-floor', [0, 0, 0], 0, [0, 0, (fz0 + fz1) / 2], [fx1 - fx0, 0.02, fz1 - fz0], 'ground'));
}

// --- delivered collision-world minus the v2-removed records -----------------
const world = JSON.parse(await readFile(resolve(root, 'world/temple-dadian/collision-world.json'), 'utf8'));
const REMOVED = new Set(['court2-side-wall', 'court2-north-closure', 'court2-north-return']);
const isGround = (c) => (c.group ?? '').includes('temple-ground')
  || /apron|path-slab|field-slab|border|stair-step|platform-top/.test(c.name);
const oldRecords = world.colliders
  .filter((c) => !REMOVED.has(c.name.replace(/^dadiancourt:/, '')))
  .map((c) => ({ name: c.name, group: c.group,
                 aabb: { min: c.min.map(Number), max: c.max.map(Number) } }));

// --- intersect ----------------------------------------------------------------
const report = { spec: SPEC_PATH, oldRecords: oldRecords.length, conflicts: [], allowed: [], clean: [] };
for (const nb of [...pdBoxes, ...gaBoxes, ...stBoxes, ...cwBoxes]) {
  for (const rec of oldRecords) {
    if (!overlaps(nb.aabb, rec.aabb)) continue;
    const entry = { footprint: nb.id, record: rec.name, group: rec.group };
    if (isGround(rec)) { report.allowed.push({ ...entry, reason: 'ground record' }); continue; }
    report.conflicts.push({ ...entry, note: 'unhandled conflict vs delivered collider' });
  }
}
// compact the allowed list per (footprint, record name)
const dedup = (list) => Object.values(list.reduce((m, e) => {
  const k = `${e.footprint}|${e.record}|${e.reason ?? ''}`;
  (m[k] = m[k] ?? { ...e, count: 0 }).count++;
  return m;
}, {}));
report.allowed = dedup(report.allowed);
report.conflicts = dedup(report.conflicts);
report.summary = {
  footprintsChecked: pdBoxes.length + gaBoxes.length + stBoxes.length + cwBoxes.length,
  conflicts: report.conflicts.length,
  allowedIntersections: report.allowed.length,
  verdict: report.conflicts.length === 0 ? 'PASS' : 'CONFLICT',
};
await mkdir(resolve(root, 'kit/out/footprint-check'), { recursive: true });
await writeFile(resolve(root, 'kit/out/footprint-check/report.json'),
  JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`FOOTPRINT_CHECK ${report.summary.verdict} footprints=${report.summary.footprintsChecked} `
  + `conflicts=${report.summary.conflicts} allowedGround=${report.summary.allowedIntersections}`);
if (report.conflicts.length) {
  for (const c of report.conflicts) console.log(`  CONFLICT ${c.footprint} x ${c.record}`);
  process.exit(3);
}
