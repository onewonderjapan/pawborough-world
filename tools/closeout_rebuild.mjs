// P — reproducible-assembly proof for the closeout batch.
//
// Runs BOTH assembly generators into FRESH isolated directories (--out, no
// in-place regeneration), twice, then proves:
//   1. run1 == run2  byte-for-byte across all emitted files (stability)
//   2. rebuilt ORIGINAL GLBs are byte-identical to the ADOPTED datasets
//      (routes/cameras/instances/collision/manifests compared as JSON with a
//      diff report — provenance-note keys may differ, nothing else)
//   3. the ORIGINAL-PROBLEM repro passes against the REBUILT collision files:
//      axis-local capsule blocked both sides at (±2.4, 1.01, -27.085) while
//      the central passage stays open; the bridge world blocks the same walls;
//      every v4 AABB Y equals pos.y + center.y ± size.y/2 (obbToWorld); the
//      eight shop strips keep [0, 2.9]; the yimen-stage sidecar composes 9
//      distinct records (4 columns, 1 rail, 2 high flank guards, 2 ground
//      stucco wing walls)
//   4. derived compressed artifacts (*.cm.glb / *.cm.json) are excluded from
//      comparison — they are the N chain's output, not the assembly's
//
// Run: node tools/closeout_rebuild.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import R from '@dimforge/rapier3d-compat';
import { addWallCollider } from '../src/world/physics.js';
import { obbToWorld } from '../src/world/collisionAdapter.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ART = resolve(root, 'artifacts/world-closeout');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const CAPSULE = { halfHeight: 0.6, radius: 0.35 };
const AXIS_START = { x: 2.4, y: 1.01, z: -27.085, dist: 1.3 };

const walk = async (dir, base = dir) => {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p, base));
    else out.push(relative(base, p).split('\\').join('/'));
  }
  return out.sort();
};
const isDerived = (rel) => /\.cm\.glb$/i.test(rel) || /\.cm\.json$/i.test(rel);

// ---- 1. two isolated rebuild runs ------------------------------------------
const RUNS = ['rebuild-run1', 'rebuild-run2'];
for (const run of RUNS) {
  const dir = resolve(ART, run);
  if (existsSync(dir)) throw new Error(`${run} already exists — rebuild harness refuses to reuse/overwrite (delete by hand or choose fresh dirs)`);
  await mkdir(resolve(dir, 'temple-axis-v3'), { recursive: true });
  await mkdir(resolve(dir, 'fangbang-temple-v4'), { recursive: true });
  // generators refuse existing dirs, so hand them NOT-yet-existing paths
  await rm(resolve(dir, 'temple-axis-v3'), { recursive: true, force: true });
  await rm(resolve(dir, 'fangbang-temple-v4'), { recursive: true, force: true });
  execFileSync(process.execPath, ['scripts/build_temple_axis_v3_world.mjs', '--out', relative(root, resolve(dir, 'temple-axis-v3'))], { cwd: root, stdio: 'pipe' });
  execFileSync(process.execPath, ['scripts/build_fangbang_v4_world.mjs', '--out', relative(root, resolve(dir, 'fangbang-temple-v4'))], { cwd: root, stdio: 'pipe' });
  console.log(`ok   rebuild ${run} complete`);
}

// ---- 2. stability: run1 == run2 --------------------------------------------
const stability = [];
for (const ds of ['temple-axis-v3', 'fangbang-temple-v4']) {
  const files1 = await walk(resolve(ART, 'rebuild-run1', ds));
  const files2 = await walk(resolve(ART, 'rebuild-run2', ds));
  if (JSON.stringify(files1) !== JSON.stringify(files2)) stability.push({ ds, pass: false, why: 'file lists differ' });
  else {
    const differing = [];
    for (const f of files1) {
      const a = sha(await readFile(resolve(ART, 'rebuild-run1', ds, f)));
      const b = sha(await readFile(resolve(ART, 'rebuild-run2', ds, f)));
      if (a !== b) differing.push(f);
    }
    stability.push({ ds, pass: differing.length === 0, files: files1.length, differing });
  }
}
console.log(stability.map((s) => `${s.pass ? 'ok  ' : 'FAIL'} stability ${s.ds}: ${s.files ?? '?'} files${s.differing?.length ? ' differing=' + s.differing.join(',') : ''}`).join('\n'));

// ---- 3. correspondence with the ADOPTED datasets ---------------------------
// - numbers compare at the spec's 1e-5 tolerance (the adopted v4 collision was
//   written by the collision-only repair with raw float arithmetic; the
//   generator rounds to 6 decimals — same values, different float noise)
// - colliders compare as ORDER-INSENSITIVE canonical forms: the oriented box
//   (name, group, theta, world center = pos + R(theta)·center, size, AABB) —
//   representation-independent (the repair kept module-local centers while
//   the generator resolves the anchor; both compose to identical boxes) and
//   ignoring annotation-only fields (note / legacy top-level center+size)
// - provenance/historical-bookkeeping keys may differ (treeV2 block,
//   previousFile pointers, I2's placedShifts/droppedTrees records and the
//   pre-tree-swap budget sums); geometry, placements, routes, cameras,
//   original GLB bytes and all other content must match exactly
const ALLOWED_DIFF_RE = /^(treeV2(\.|$)|.*\.previousFile$|tree\.note$|assets\.tree\.placedShifts|^placementShifts|^droppedTrees|budgets\.(newModulesTris|placedTriangles)\.actual$)/;
const roundDeep = (v, d = 5) => {
  if (typeof v === 'number') return +v.toFixed(d);
  if (Array.isArray(v)) return v.map((x) => roundDeep(x, d));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = roundDeep(x, d);
    return o;
  }
  return v;
};
const diffJson = (a, b, path = '', out = []) => {
  a = typeof a === 'number' ? +a.toFixed(5) : a;
  b = typeof b === 'number' ? +b.toFixed(5) : b;
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  const bothObj = a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) === !Array.isArray(b);
  if (!bothObj) { out.push(path || '<root>'); return out; }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of [...keys].sort()) diffJson(a?.[k], b?.[k], path ? `${path}.${k}` : k, out);
  return out;
};
const canonicalCollider = (c) => {
  const o = c.obb;
  if (!o) return { name: c.name, group: c.group, type: c.type, min: roundDeep(c.min), max: roundDeep(c.max) };
  const ct = Math.cos(o.theta), st = Math.sin(o.theta);
  const wx = o.pos[0] + ct * o.center[0] + st * o.center[2];
  const wy = (o.pos[1] ?? 0) + o.center[1];
  const wz = o.pos[2] - st * o.center[0] + ct * o.center[2];
  return {
    name: c.name, group: c.group, type: c.type,
    theta: +o.theta.toFixed(8),
    worldCenter: [+wx.toFixed(5), +wy.toFixed(5), +wz.toFixed(5)],
    size: roundDeep(o.size),
    min: roundDeep(c.min), max: roundDeep(c.max),
  };
};
const multiset = (colliders) => colliders.map((c) => JSON.stringify(canonicalCollider(c))).sort();
const correspondence = [];
for (const ds of ['temple-axis-v3', 'fangbang-temple-v4']) {
  const rebuiltDir = resolve(ART, 'rebuild-run1', ds);
  const adoptedDir = resolve(root, 'world', ds);
  const files = (await walk(rebuiltDir)).filter((f) => !isDerived(f));
  const rows = [];
  for (const f of files) {
    const rb = await readFile(resolve(rebuiltDir, f));
    const adoptedPath = resolve(adoptedDir, f);
    if (!existsSync(adoptedPath)) { rows.push({ file: f, verdict: 'ADOPTED-MISSING (prohibited)' }); continue; }
    const ab = await readFile(adoptedPath);
    if (sha(rb) === sha(ab)) { rows.push({ file: f, verdict: 'identical' }); continue; }
    if (f === 'collision-world.json') {
      const a = multiset(JSON.parse(rb.toString('utf8')).colliders);
      const b = multiset(JSON.parse(ab.toString('utf8')).colliders);
      const onlyRebuilt = a.filter((x) => !b.includes(x)).slice(0, 3);
      const onlyAdopted = b.filter((x) => !a.includes(x)).slice(0, 3);
      rows.push({ file: f, verdict: (onlyRebuilt.length || onlyAdopted.length) ? 'COLLIDER-DIFF (prohibited)' : 'colliders equal (canonical, order-insensitive, 1e-5)',
        count: a.length, onlyRebuilt, onlyAdopted });
    } else if (f.endsWith('.json')) {
      const diffs = diffJson(JSON.parse(rb.toString('utf8')), JSON.parse(ab.toString('utf8')));
      const prohibited = diffs.filter((d) => !ALLOWED_DIFF_RE.test(d));
      rows.push({ file: f, verdict: prohibited.length ? 'JSON-DIFF (prohibited)' : 'json-diff (provenance/bookkeeping notes only)',
        diffs: diffs.slice(0, 12), prohibited: prohibited.slice(0, 12) });
    } else {
      rows.push({ file: f, verdict: 'BYTES-DIFF (prohibited)' });
    }
  }
  const prohibited = rows.filter((r) => /prohibited/i.test(r.verdict));
  correspondence.push({ ds, pass: prohibited.length === 0, rows });
}
for (const c of correspondence) {
  const bad = c.rows.filter((r) => /prohibited/i.test(r.verdict));
  console.log(`${c.pass ? 'ok  ' : 'FAIL'} correspondence ${c.ds} (${c.rows.length} non-derived files)`);
  for (const r of bad) console.log(`     ${r.file}: ${JSON.stringify(r.prohibited ?? r.verdict).slice(0, 220)}`);
}

// ---- 4. original-problem repro against the REBUILT collision files ---------
await R.init();
const loadColliders = async (ds) => JSON.parse(await readFile(resolve(ART, 'rebuild-run1', ds, 'collision-world.json'), 'utf8')).colliders;
const physicsWorld = async (colliders) => {
  const w = new R.World({ x: 0, y: 0, z: 0 });
  for (const c of colliders) addWallCollider(R, w, c);
  w.step();
  return w;
};
const repro = {};
{
  // 4a. axis-local capsule: both sides blocked, central passage open
  const w = await physicsWorld(await loadColliders('temple-axis-v3'));
  try {
    repro.axisCapsule = { pass: true };
    for (const side of [-1, 1]) {
      const hit = w.castShape({ x: side * AXIS_START.x, y: AXIS_START.y, z: AXIS_START.z },
        { x: 0, y: 0, z: 0, w: 1 }, { x: side, y: 0, z: 0 }, new R.Capsule(CAPSULE.halfHeight, CAPSULE.radius), 0, AXIS_START.dist, true);
      if (!hit) { repro.axisCapsule.pass = false; repro.axisCapsule[`side${side}`] = 'NOT blocked'; }
    }
    const central = w.castShape({ x: 0, y: AXIS_START.y, z: AXIS_START.z },
      { x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 0, z: -1 }, new R.Capsule(CAPSULE.halfHeight, CAPSULE.radius), 0, AXIS_START.dist, true);
    repro.axisCapsule.centralOpen = central === null;
    if (central !== null) repro.axisCapsule.pass = false;
  } finally { w.free(); }

  // 4b. bridge world: same walls in world coords (T + yaw 0.16703)
  const colliders4 = await loadColliders('fangbang-temple-v4');
  const w4 = await physicsWorld(colliders4);
  try {
    const c = Math.cos(0.16703), s = Math.sin(0.16703);
    repro.bridgeCapsule = { pass: true };
    for (const side of [-1, 1]) {
      const x = side * AXIS_START.x, z = AXIS_START.z;
      const hit = w4.castShape({ x: -127.817 + c * x + s * z, y: AXIS_START.y, z: 27.057 - s * x + c * z },
        { x: 0, y: Math.sin(0.16703 / 2), z: 0, w: Math.cos(0.16703 / 2) },
        { x: c * side, y: 0, z: -s * side }, new R.Capsule(CAPSULE.halfHeight, CAPSULE.radius), 0, AXIS_START.dist, true);
      if (!hit) { repro.bridgeCapsule.pass = false; repro.bridgeCapsule[`side${side}`] = 'NOT blocked'; }
    }
  } finally { w4.free(); }

  // 4c. every rebuilt v4 AABB Y = pos.y + center.y ± size.y/2 (obbToWorld)
  let yBad = 0;
  for (const col of colliders4) {
    if (!col.obb) continue;
    const { center, halfExtents } = obbToWorld(col);
    if (Math.abs(col.min[1] - (center[1] - halfExtents[1])) > 1e-5 || Math.abs(col.max[1] - (center[1] + halfExtents[1])) > 1e-5) yBad += 1;
  }
  repro.v4TranslatedAabbs = { pass: yBad === 0, colliders: colliders4.length, violations: yBad };

  // 4d. eight strips keep [0, 2.9]
  const strips = colliders4.filter((r) => /^(westshops|eastshops)-strips:/.test(r.name));
  repro.shopStrips = { pass: strips.length === 8 && strips.every((r) => r.min[1] === 0 && r.max[1] === 2.9), count: strips.length };

  // 4e. yimen-stage sidecar: 9 distinct records reach the rebuilt v3 world
  const stageNames = (await loadColliders('temple-axis-v3'))
    .filter((r) => r.name.startsWith('yimenstage:')).map((r) => r.name);
  const want = { 'yimenstage:stage-column': 4, 'yimenstage:stage-front-rail': 1, 'yimenstage:stage-flank-wall': 2, 'yimenstage:stage-wing-wall': 2 };
  const got = {};
  for (const n of stageNames) got[n] = (got[n] ?? 0) + 1;
  const missing = Object.entries(want).filter(([k, v]) => (got[k] ?? 0) !== v);
  repro.yimenStageSidecar = { pass: missing.length === 0 && stageNames.length === 9, records: stageNames.length, missing };
}
console.log(Object.entries(repro).map(([k, v]) => `${v.pass ? 'ok  ' : 'FAIL'} repro ${k}${v.pass ? '' : ' ' + JSON.stringify(v).slice(0, 160)}`).join('\n'));

const report = {
  batch: 'pawborough-world-closeout-night-20260919',
  stage: 'P reproducible assembly',
  generatedAt: new Date().toISOString(),
  runs: RUNS,
  generatorChanges: [
    'scripts/build_temple_axis_v3_world.mjs: --out (refuses existing dirs; no in-place merge) + tree input fixed to the ADOPTED tree-camphor-v2.glb (old line would have restored the retired v1 module; kit hash guard now hard-fails that path)',
    'scripts/build_fangbang_v4_world.mjs: --out (replaces the rm -rf + regenerate default; the adopted dataset can never be rolled back by a rebuild)',
  ],
  stability, correspondence, repro,
  derivedCmExcluded: 'true (*.cm.glb / *.cm.json are the N chain provenance-gated output, not assembly output)',
  pass: stability.every((s) => s.pass) && correspondence.every((c) => c.pass) && Object.values(repro).every((v) => v.pass),
};
await writeFile(resolve(ART, 'rebuild-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`REBUILD_REPORT pass=${report.pass}`);
process.exit(report.pass ? 0 : 1);
