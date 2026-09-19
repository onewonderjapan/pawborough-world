// F1 — assemble world/fangbang-temple-v4/: the bridge world v3 with the
// temple-axis V3 variants swapped in (lions-v2 / wing windows v2 /
// entry-court-v3 + 4 camphor trees), the burner detour carried into the world
// route, the props block referenced but DEFAULT NOT LOADED (?props=1 loads it,
// dataset-independent). The page selects it with ?ds=fangbang-temple-v4
// (the ?ds= mechanism shipped with the expansion batch).
//
// Run: node scripts/build_fangbang_v4_world.mjs
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'world/fangbang-temple-v4');
const V3 = resolve(root, 'world/fangbang-temple-v3');
const V3AXIS = resolve(root, 'world/temple-axis-v3');
const PROPS = resolve(root, 'world/street-props');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const T = [-127.817, 0.0, 27.057];
const YAW = 0.16703;
const cy = Math.cos(YAW), sy = Math.sin(YAW);
const axisToWorld = ([x, y, z]) => [T[0] + cy * x + sy * z, y, T[2] - sy * x + cy * z];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// --- copy the v3 dataset-owned files -------------------------------------------
// NOTE: review-manifest.cm.json is NOT copied — the v3 compressed manifest
// references v3-dataset paths and would fail the v4 page's integrity checks
// under the now-default compressed state. Regenerate it after this script:
//   node tools/make_cm_manifest.mjs --dataset fangbang-temple-v4
for (const f of ['cameras.json', 'instances.json', 'blocks.json', 'route.json', 'westshops-strips.glb',
  'westshops-strips.cm.glb']) {
  await copyFile(resolve(V3, f), resolve(OUT, f)).catch(() => {});
}
await cp(resolve(V3, 'temple-axis'), resolve(OUT, 'temple-axis'), { recursive: true });
await cp(resolve(V3, 'west-extension'), resolve(OUT, 'west-extension'), { recursive: true });

// --- swap the temple-axis variants ----------------------------------------------
const SWAPS = [
  // v3 bridge file <- axis-v3 file (bytes replaced; manifest sha updated below)
  ['lions.glb', 'lions-v2.glb'],
  ['ornaments.glb', 'ornaments-v2.glb'],
  ['court-open.glb', 'entry-court-v3.glb'],
];
const axisManifest = JSON.parse(await readFile(resolve(V3AXIS, 'review-manifest.json'), 'utf8'));
const swapInfo = {};
// east band (adoption batch package J, G5): plan + spec produced upstream
const EAST_PLAN = JSON.parse(await readFile(resolve(root, 'kit/out/east-band/plan.json'), 'utf8'));
const EAST_SPEC = JSON.parse(await readFile(resolve(root, 'kit/out/east-extension-spec.json'), 'utf8'));
const EAST_IDS = EAST_PLAN.setbacks.map((s) => s.id);
for (const [bridgeFile, axisFile] of SWAPS) {
  await copyFile(resolve(V3AXIS, axisFile), resolve(OUT, 'temple-axis', bridgeFile));
  const bytes = await readFile(resolve(OUT, 'temple-axis', bridgeFile));
  swapInfo[bridgeFile] = { bytes: bytes.byteLength, sha256: sha(bytes),
    triangles: axisManifest.assets[
      { 'lions.glb': 'lionsV2', 'ornaments.glb': 'ornamentsV2', 'court-open.glb': 'entryCourtV3' }[bridgeFile]]
      ?.triangles };
}
// trees: byte copy + world placements (v2, adoption batch 20260919: multi-lobe
// canopy rebuild, moved to the courtyard-wall line per the owner's G12 + frame
// rule; the v2 GLB lives in temple-axis-v3 since I2 replaced it there)
await copyFile(resolve(V3AXIS, 'tree-camphor-v2.glb'), resolve(OUT, 'temple-axis', 'tree-camphor-v2.glb'));
{
  const bytes = await readFile(resolve(OUT, 'temple-axis', 'tree-camphor-v2.glb'));
  swapInfo['tree-camphor-v2.glb'] = { bytes: bytes.byteLength, sha256: sha(bytes),
    triangles: axisManifest.assets.tree.triangles,
    instancesAt: axisManifest.assets.tree.instancesAt };
}

// --- blocks.json: point the temple block at the swapped files + add trees -------
const blocks = JSON.parse(await readFile(resolve(OUT, 'blocks.json'), 'utf8'));
const templeBlock = blocks.blocks.find((b) => b.id === 'block-temple-axis');const swapByAssetId = {
  'shanmen-lions': ['lions.glb', swapInfo['lions.glb']],
  'shanmen-ornaments': ['ornaments.glb', swapInfo['ornaments.glb']],
  'entrycourt-open': ['court-open.glb', swapInfo['court-open.glb']],
};
for (const a of templeBlock.assets) {
  if (swapByAssetId[a.id]) {
    const [file, info] = swapByAssetId[a.id];
    a.glb = `./world/fangbang-temple-v4/temple-axis/${file}`;
    a.bytes = info.bytes;
    a.sha256 = info.sha256;
    a.triangles = info.triangles;
    a.variant = true;
  }
}
for (const [tid, loc] of Object.entries(swapInfo['tree-camphor-v2.glb'].instancesAt)) {
  const w = axisToWorld(loc);
  templeBlock.assets.push({
    id: tid, glb: './world/fangbang-temple-v4/temple-axis/tree-camphor-v2.glb',
    positionGlb: [+w[0].toFixed(6), 0, +w[2].toFixed(6)], rotationYRad: YAW,
    bytes: swapInfo['tree-camphor-v2.glb'].bytes, sha256: swapInfo['tree-camphor-v2.glb'].sha256,
    triangles: swapInfo['tree-camphor-v2.glb'].triangles, variant: true,
  });
}
// trees must be REAL instances for the page's collision validator (the tree
// trunk colliders composed below carry tree-court* name prefixes)
for (const [tid, loc] of Object.entries(swapInfo['tree-camphor-v2.glb'].instancesAt)) {
  const w = axisToWorld(loc);
  const inst = JSON.parse(await readFile(resolve(OUT, 'instances.json'), 'utf8'));
  inst.instances.push({
    id: tid, module: 'temple-axis-tree-camphor',
    positionGlb: [+w[0].toFixed(6), 0, +w[2].toFixed(6)], rotationYRad: YAW,
    group: 'temple-axis-v2',
    note: 'D3 trees v2 (adoption batch 20260919): moved to courtyard-wall line',
  });
  await writeFile(resolve(OUT, 'instances.json'), JSON.stringify(inst, null, 2) + '\n');
}
// the v3-bridge temple-axis dir still carries the v1 tree byte copy — v4 uses
// only the v2 GLB
await rm(resolve(OUT, 'temple-axis', 'tree-camphor.glb'), { force: true });
// the v3-bridge compressed GLBs for the three SWAPPED variants compress the
// PRE-variant bytes (v3 keeps the old geometry under the same file name) —
// serving them here would fail integrity with silently wrong geometry. The
// swap targets stay original until someone runs gltfpack on the v4 variants.
for (const f of ['court-open.cm.glb', 'lions.cm.glb', 'ornaments.cm.glb']) {
  await rm(resolve(OUT, 'temple-axis', f), { force: true });
}
await writeFile(resolve(OUT, 'blocks.json'), JSON.stringify(blocks, null, 2) + '\n');

// --- east band: block-east-shops + setbacks + strips (package J, G5) ------------
// The 9 east placeholders retire behind the 5.6m front line of the BUILT east
// centerline (plan.json setbacks), then upgrade to frozen street modules in a
// revocable `block-east-shops` assets block (?revoke=block-east-shops reverts
// to the gray boxes). Strips fill 1.5-8m gaps per side; >8m stays open.
const eastAssets = [];
const eastColliders = [];
{
  const setbackBy = Object.fromEntries(EAST_PLAN.setbacks.map((s) => [s.id, s]));
  const blocks2 = JSON.parse(await readFile(resolve(OUT, 'blocks.json'), 'utf8'));
  for (const ph of blocks2.placeholders) {
    const sb = setbackBy[ph.id];
    if (!sb) continue;
    ph.glbPoint = sb.glbPoint;                       // retreated position
    ph.placementAdjust = sb.placementAdjust;
    ph.replacedBy = 'block-east-shops';
  }
  for (const e of EAST_PLAN.entries) {
    if (e.error) continue;
    const bytes = await readFile(resolve(root, `building/${e.module}/model.glb`));
    let tris = 0;
    try {
      const mm = JSON.parse(await readFile(resolve(root, `building/${e.module}/measurements.json`), 'utf8'));
      tris = mm.triangles ?? 0;
    } catch { /* missing measurements -> 0 */ }
    eastAssets.push({
      id: `eastshop-${e.id}`, module: e.module,
      glb: `./building/${e.module}/model.glb`,
      positionGlb: [+e.frontCenter[0].toFixed(4), 0, +e.frontCenter[1].toFixed(4)],
      rotationYRad: +e.yawRad.toFixed(6),
      bytes: bytes.byteLength, sha256: sha(bytes), triangles: tris,
    });
    const col = JSON.parse(await readFile(resolve(root, `building/${e.module}/collision.json`), 'utf8'));
    const c = Math.cos(e.yawRad), s = Math.sin(e.yawRad);
    for (const r of col.colliders) {
      const wx = e.frontCenter[0] + c * r.center[0] + s * r.center[2];
      const wz = e.frontCenter[1] - s * r.center[0] + c * r.center[2];
      const corners = [[r.size[0] / 2, r.size[2] / 2], [r.size[0] / 2, -r.size[2] / 2],
        [-r.size[0] / 2, r.size[2] / 2], [-r.size[0] / 2, -r.size[2] / 2]]
        .map(([lx, lz]) => [c * lx + s * lz, -s * lx + c * lz]);
      const hx = Math.max(...corners.map((p) => Math.abs(p[0])));
      const hz = Math.max(...corners.map((p) => Math.abs(p[1])));
      eastColliders.push({
        name: `eastshop-${e.id}:${r.name}`, group: `eastshop-${e.id}`, type: 'box',
        min: [+(wx - hx).toFixed(6), 0, +(wz - hz).toFixed(6)],
        max: [+(wx + hx).toFixed(6), +r.size[1].toFixed(6), +(wz + hz).toFixed(6)],
        obb: { pos: [+e.frontCenter[0].toFixed(6), 0, +e.frontCenter[1].toFixed(6)],
               theta: +e.yawRad.toFixed(8), center: r.center, size: r.size },
      });
    }
  }
  // courtyard strips for 1.5-8m gaps (real geometry GLB built downstream by
  // kit/build_eaststrips.py from these records; second pipeline run picks it up)
  const STRIP_T = 0.28, STRIP_H = 2.9;
  const bySide = { north: [], south: [] };
  for (const e of EAST_PLAN.entries) {
    if (e.error) continue;
    (bySide[e.side] = bySide[e.side] ?? []).push(e);
  }
  for (const [side, list] of Object.entries(bySide)) {
    const ordered = list.slice().sort((a, b) => a.tCoord - b.tCoord);
    for (let i = 1; i < ordered.length; i++) {
      const a = ordered[i - 1], b = ordered[i];
      const gap = b.gapToPrevM ?? 0;
      if (gap <= 1.5 || gap > 8) continue;
      const cx = (a.finalCenter[0] + b.finalCenter[0]) / 2;
      const cz = (a.finalCenter[2] + b.finalCenter[2]) / 2;
      const T = a.tangent;
      const theta = Math.atan2(-T[0], T[1]);
      const id = `eaststrip-${side}-${i}`;
      const cc = Math.cos(theta), ss = Math.sin(theta);
      const wxs = [[-STRIP_T / 2, -gap / 2], [-STRIP_T / 2, gap / 2], [STRIP_T / 2, -gap / 2], [STRIP_T / 2, gap / 2]]
        .map(([lx, lz]) => [cx + cc * lx + ss * lz, cz - ss * lx + cc * lz]);
      eastColliders.push({
        name: `eastshops-strips:${id}`, group: 'eastshops-strips', type: 'box',
        min: [+Math.min(...wxs.map((p) => p[0])).toFixed(6), 0, +Math.min(...wxs.map((p) => p[1])).toFixed(6)],
        max: [+Math.max(...wxs.map((p) => p[0])).toFixed(6), STRIP_H, +Math.max(...wxs.map((p) => p[1])).toFixed(6)],
        obb: { pos: [+cx.toFixed(6), STRIP_H / 2, +cz.toFixed(6)], theta: +theta.toFixed(8),
               center: [0, 0, 0], size: [STRIP_T, STRIP_H, gap] },
      });
    }
  }
  // strips GLB (second pipeline run, after kit/build_eaststrips.py)
  const stripsGlb = resolve(root, 'kit/out/east-band/eastshops-strips.glb');
  try {
    const bytes = await readFile(stripsGlb);
    await copyFile(stripsGlb, resolve(OUT, 'eastshops-strips.glb'));
    const stripsJsonLen = bytes.readUInt32LE(12);
    const stripsGltf = JSON.parse(bytes.subarray(20, 20 + stripsJsonLen).toString('utf8'));
    const stripsTris = (stripsGltf.meshes ?? []).reduce((t3, mesh) => t3
      + mesh.primitives.reduce((t4, prim) => t4 + stripsGltf.accessors[prim.indices].count / 3, 0), 0);
    eastAssets.push({
      id: 'eastshops-strips', module: 'eastshops-strips',
      glb: './world/fangbang-temple-v4/eastshops-strips.glb',
      positionGlb: [0, 0, 0], rotationYRad: 0,
      bytes: bytes.byteLength, sha256: sha(bytes), triangles: Math.round(stripsTris),
    });
  } catch { /* first run: strips GLB not built yet */ }
  // the eastshop colliders live in the dataset collision file with
  // 'eastshop-*:' prefixes — validateWorldInputs needs matching instances
  // (the west-band pattern: block assets are REAL instances too)
  const inst2 = JSON.parse(await readFile(resolve(OUT, 'instances.json'), 'utf8'));
  const haveInst = new Set(inst2.instances.map((i) => i.id));
  for (const a of eastAssets) {
    if (haveInst.has(a.id)) continue;
    inst2.instances.push({
      id: a.id, module: a.module, positionGlb: a.positionGlb, rotationYRad: a.rotationYRad,
      bytes: a.bytes, sha256: a.sha256, group: 'east-band-shops',
    });
  }
  // surface + seal-wall rows (identity placements; the GLBs are world-authored)
  for (const row of [['eastext-surface', null], ['eastext-seal-wall', null]]) {
    if (!haveInst.has(row[0])) {
      inst2.instances.push({ id: row[0], module: row[0], positionGlb: [0, 0, 0], rotationYRad: 0, group: 'east-extension' });
    }
  }
  await writeFile(resolve(OUT, 'instances.json'), JSON.stringify(inst2, null, 2) + '\n');
  blocks2.blocks.push({
    id: 'block-east-shops', kind: 'assets', autoApply: true, persistent: true,
    collisionSource: './world/fangbang-temple-v4/collision-world.json',
    note: 'east-band upgrade (adoption batch 20260919, G5): 9 placeholders replaced by frozen street modules per category map; revoke = ?revoke=block-east-shops',
    assets: eastAssets,
  });
  await writeFile(resolve(OUT, 'blocks.json'), JSON.stringify(blocks2, null, 2) + '\n');
}

// --- east GLBs: extension surface + end wall -------------------------------------
await mkdir(resolve(OUT, 'east-extension'), { recursive: true });
const eastSurfaceBytes = await readFile(resolve(root, 'kit/out/east-band/east-extension/model.glb'));
await copyFile(resolve(root, 'kit/out/east-band/east-extension/model.glb'), resolve(OUT, 'east-extension', 'surface.glb'));
const eastWallBytes = await readFile(resolve(root, 'kit/out/east-band/east-extension/seal-wall.glb'));
await copyFile(resolve(root, 'kit/out/east-band/east-extension/seal-wall.glb'), resolve(OUT, 'east-extension', 'seal-wall.glb'));
const eastWallRecord = JSON.parse(await readFile(resolve(root, 'kit/out/east-band/east-extension/collision.json'), 'utf8')).colliders[0];
eastColliders.push(eastWallRecord);
globalThis.__eastSurfaceTris = (() => {
  const jl2 = eastSurfaceBytes.readUInt32LE(12);
  const g2 = JSON.parse(eastSurfaceBytes.subarray(20, 20 + jl2).toString('utf8'));
  return Math.round((g2.meshes ?? []).reduce((t3, mesh) => t3
    + mesh.primitives.reduce((t4, prim) => t4 + g2.accessors[prim.indices].count / 3, 0), 0));
})();
globalThis.__eastWallTris = 12;
globalThis.__eastAssets = eastAssets;

// --- collision-world: swap the axis-derived records ------------------------------
// Composition rule (adoption-batch fix): every axis-v3 record carries
// obb.pos = the INSTANCE ANCHOR in axis-local coords and obb.center = the box
// center LOCAL to that anchor. The previous two-step strip+re-anchor dropped
// the anchor for every instance not authored at the origin (yimen / dadian /
// peidian / gallery / houdian / trees — ~180 records landed near the shanmen
// instead of their buildings). Compose once with the world anchor.
const worldV3 = JSON.parse(await readFile(resolve(V3, 'collision-world.json'), 'utf8'));
const axisCollision = JSON.parse(await readFile(resolve(V3AXIS, 'collision-world.json'), 'utf8'));
// v3-bridge-era axis records are ALL replaced by the axis-v3 composed set
// (entrycourt-open: covers the old entry court, court: its pre-v3 name)
const AXIS_PREFIXES = ['shanmen:', 'court:', 'entrycourt-open:', 'yimen:', 'yimenstage:', 'dadiancourt:',
  'peidian-w:', 'peidian-e:', 'gallery-w:', 'gallery-e:', 'dadian:', 'court3:', 'houdian:'];
const kept = worldV3.colliders.filter((c) => !AXIS_PREFIXES.some((p) => c.name.startsWith(p)));
const compose = (pos, theta, rec) => {
  const c = Math.cos(theta), s = Math.sin(theta);
  const [cx2, cy2, cz2] = rec.obb ? rec.obb.center : rec.center;
  const [sx, sy2, sz] = rec.obb ? rec.obb.size : rec.size;
  const wx = pos[0] + c * cx2 + s * cz2;
  const wz = pos[2] - s * cx2 + c * cz2;
  const wy = cy2 + (pos[1] ?? 0);
  const hx = Math.abs(c) * sx / 2 + Math.abs(s) * sz / 2;
  const hz = Math.abs(s) * sx / 2 + Math.abs(c) * sz / 2;
  return {
    name: rec.name, group: rec.group ?? 'body', type: 'box',
    min: [wx - hx, wy - sy2 / 2, wz - hz],
    max: [wx + hx, wy + sy2 / 2, wz + hz],
    obb: { pos, theta, center: [cx2, cy2, cz2], size: [sx, sy2, sz] },
  };
};
// the axis-v3 dataset names its entry-court instance 'court:'; the bridge
// world instances it as 'entrycourt-open:' — rename during composition
const renameForBridge = (name) => name.startsWith('court:') ? `entrycourt-open:${name.slice('court:'.length)}` : name;
const composedAxis = axisCollision.colliders.map((c) => {
  const o = c.obb;
  // the record's center is MODULE-LOCAL (yawed modules: peidian/gallery carry
  // their own theta) — rotate it by the record's theta into the axis frame,
  // anchor there, then place in the world frame with the summed yaw
  const ct = Math.cos(o.theta), st = Math.sin(o.theta);
  const anchorLocal = [o.pos[0] + ct * o.center[0] + st * o.center[2], o.pos[1],
    o.pos[2] - st * o.center[0] + ct * o.center[2]];
  const r = compose(axisToWorld(anchorLocal), YAW + o.theta, {
    name: c.name, group: c.group ?? 'body', type: 'box',
    obb: { pos: [0, 0, 0], theta: 0, center: [0, o.center[1], 0], size: o.size },
  });
  r.name = renameForBridge(r.name);
  r.group = renameForBridge(r.group ?? 'body');
  return r;
});
const worldV4 = {
  ...worldV3,
  dataset: 'fangbang-temple-v4',
  variant: 'v4: bridge v3 with temple-axis V3 variants (lions-v2, wing windows v2, entry-court-v3 '
    + 'incense road + burner, 4 camphor trees v2); props block referenced but default OFF (?props=1); '
    + 'axis records anchored per-instance with module-local yaw; AABB Y reconciled to obb.center ± size/2',
  colliders: [...kept, ...composedAxis, ...eastColliders],
};
// AABB Y reconcile (GPT review re-check): every collider's min/max Y must be
// derived from its OWN obb center/size — the westshop records carried
// [0, size.y] ranges that flattened upper floors (y 3.49..3.71 -> 0..0.22),
// counters, thresholds and parapets onto the ground. Y is yaw-invariant, so
// this is exact for every rotation.
let yFixed = 0;
for (const c of worldV4.colliders) {
  if (!c.obb) continue;
  const [cy, sy] = [c.obb.center[1], c.obb.size[1]];
  const lo = +(cy - sy / 2).toFixed(6), hi = +(cy + sy / 2).toFixed(6);
  if (Math.abs(c.min[1] - lo) > 1e-4 || Math.abs(c.max[1] - hi) > 1e-4) yFixed += 1;
  c.min[1] = lo;
  c.max[1] = hi;
}
console.log(`Y_RECONCILE fixed=${yFixed}/${worldV4.colliders.length}`);
await writeFile(resolve(OUT, 'collision-world.json'), JSON.stringify(worldV4, null, 2) + '\n');

// --- route: carry the burner detour into world coordinates ------------------------
const route = JSON.parse(await readFile(resolve(OUT, 'route.json'), 'utf8'));
{
  const detourLocal = [[0, -10], [-2, -10.5], [-2, -13.5], [0, -14]];
  const w0 = axisToWorld([0, 0, -10]);
  const w1 = axisToWorld([0, 0, -21]);
  // locate the route points nearest to local (0,-10) and (0,-21)
  const d = (p, q) => Math.hypot(p[0] - q[0], p[2] - q[2]);
  let i0 = 0, d0 = 1e9, i1 = 0, d1 = 1e9;
  route.mainStreet.forEach((p, i) => {
    if (d(p, w0) < d0) { d0 = d(p, w0); i0 = i; }
    if (d(p, w1) < d1) { d1 = d(p, w1); i1 = i; }
  });
  const detourWorld = [[-2, -10.5], [-2, -13.5], [0, -14]].map((p) => axisToWorld([p[0], 0, p[1]]))
    .map((p) => [+p[0].toFixed(4), 0, +p[2].toFixed(4)]);
  route.mainStreet.splice(i0 + 1, i1 - i0, ...detourWorld);
  route.detourNote = 'v4: burner detour carried into world coords '
    + '(DESIGN_SPEC packageD.entryCourtBurner); frozen spec untouched in temple-axis-v3/route.json';
  route.negatives = [...(route.negatives ?? []), {
    spawn: (() => { const s = axisToWorld([0, 0, -9.5]); return [+s[0].toFixed(3), 0, +s[2].toFixed(3)]; })(),
    walk: 'north (axis-local sense)',
    assert: 'burner blocks the axis: vessel face + capsule r -> stop ~z(local) -11.10 '
      + '(DESIGN_SPEC -10.9 rounded; recorded in temple-axis-v3 route negative)',
  }];
}
await writeFile(resolve(OUT, 'route.json'), JSON.stringify(route, null, 2) + '\n');

// --- route east extension: mainStreet starts 3m before the east end wall --------
{
  const samples = EAST_SPEC.samples;
  const total = samples[samples.length - 1].s;
  const sStart = total - 3.0;                       // 3m before the end wall
  const eastPts = samples.filter((q) => q.s >= 0.25 && q.s <= sStart)
    .sort((a, b) => b.s - a.s)                      // east -> west (mainStreet[0] = east end)
    .map((q) => [+q.x.toFixed(4), 0, +q.z.toFixed(4)]);
  route.mainStreet.unshift(...eastPts);
  route.entries.eastExtensionStart = eastPts[0];
  route.eastExtensionNote = 'adoption batch (G5): mainStreet extended along the built east centerline '
    + `(OSM 238219464 design reuse) to 3m before the end wall at x=${EAST_SPEC.checks.endXM}; junction preserved at [124.6, 27.65]`;
  await writeFile(resolve(OUT, 'route.json'), JSON.stringify(route, null, 2) + '\n');
}

// --- east-band evidence cameras (J6) ----------------------------------------------
{
  const cams = JSON.parse(await readFile(resolve(OUT, 'cameras.json'), 'utf8'));
  const have = new Set(cams.cameras.map((c) => c.id));
  const S = EAST_SPEC.samples;
  const at = (sVal, off = 0.0) => {
    const q = S.reduce((a, b) => (Math.abs(b.s - sVal) < Math.abs(a.s - sVal) ? b : a));
    return [+(q.x + q.southNx * off).toFixed(2), 0, +(q.z + q.southNz * off).toFixed(2)];
  };
  const end = S[S.length - 1];
  const NEW_CAMS = [
    { id: 'east-junction', positionGlb: [...at(1, -1.2).slice(0, 1), 1.6, at(1, -1.2)[2]], targetGlb: [at(22, 0)[0], 1.8, at(22, 0)[2]], verticalFovDegrees: 60,
      labelZh: '东延伸接口：街尾接东段（G5）' },
    { id: 'east-road-mid', positionGlb: [at(50, 1.5)[0], 1.6, at(50, 1.5)[2]], targetGlb: [at(75, 0)[0], 1.8, at(75, 0)[2]], verticalFovDegrees: 60,
      labelZh: '东延伸中段：双侧店屋 frontline 5.6' },
    { id: 'east-end-wall', positionGlb: [at(104, -1.0)[0], 1.6, at(104, -1.0)[2]], targetGlb: [+end.x.toFixed(2), 1.8, +end.z.toFixed(2)], verticalFovDegrees: 55,
      labelZh: '样段端墙（非历史）' },
  ];
  for (const c of NEW_CAMS) {
    if (!have.has(c.id)) cams.cameras.push(c);
  }
  await writeFile(resolve(OUT, 'cameras.json'), JSON.stringify(cams, null, 2) + '\n');
}

// --- manifest -----------------------------------------------------------------------
const m = JSON.parse(await readFile(resolve(V3, 'review-manifest.json'), 'utf8'));
for (const a of m.templeAxis.assets) {
  const swap = swapByAssetId[a.id];
  if (swap) {
    a.glb = `./world/fangbang-temple-v4/temple-axis/${swap[0]}`;
    a.bytes = swap[1].bytes;
    a.sha256 = swap[1].sha256;
    a.triangles = swap[1].triangles;
    a.variant = true;
  }
}
for (const [tid, loc] of Object.entries(swapInfo['tree-camphor-v2.glb'].instancesAt)) {
  const w = axisToWorld(loc);
  m.templeAxis.assets.push({
    id: tid, glb: './world/fangbang-temple-v4/temple-axis/tree-camphor-v2.glb',
    positionGlb: [+w[0].toFixed(6), 0, +w[2].toFixed(6)], rotationYRad: YAW,
    bytes: swapInfo['tree-camphor-v2.glb'].bytes, sha256: swapInfo['tree-camphor-v2.glb'].sha256,
    triangles: swapInfo['tree-camphor-v2.glb'].triangles, variant: true,
  });
}
// module table: synced to the SWAPPED bytes (the v3 module rows still carry
// pre-variant-swap sha/bytes) + one shared tree module for the tree instances
const swapByFile = Object.fromEntries(Object.entries(swapInfo).map(([f, v]) => [f, v]));
for (const mod of m.modules) {
  const base = mod.path?.split('/').pop();
  if (base && swapByFile[base] && mod.path.includes('fangbang-temple-v3')) {
    mod.bytes = swapByFile[base].bytes;
    mod.sha256 = swapByFile[base].sha256;
    if (swapByFile[base].triangles) mod.triangles = swapByFile[base].triangles;
  }
}
m.modules.push({
  id: 'temple-axis-tree-camphor',
  path: './world/fangbang-temple-v4/temple-axis/tree-camphor-v2.glb',
  bytes: swapInfo['tree-camphor-v2.glb'].bytes,
  sha256: swapInfo['tree-camphor-v2.glb'].sha256,
  triangles: swapInfo['tree-camphor-v2.glb'].triangles,
});
// the eastshops-strips instance (second run) references its own module row
const stripsMod = eastAssets.find((a) => a.id === 'eastshops-strips');
if (stripsMod && !m.modules.some((x) => x.id === 'eastshops-strips')) {
  m.modules.push({
    id: 'eastshops-strips',
    path: stripsMod.glb,
    bytes: stripsMod.bytes,
    sha256: stripsMod.sha256,
    triangles: stripsMod.triangles,
  });
}
// east-extension rows (west-extension pattern: surface + seal wall instances)
if (!m.modules.some((x) => x.id === 'eastext-surface')) {
  m.modules.push({
    id: 'eastext-surface', path: './world/fangbang-temple-v4/east-extension/surface.glb',
    bytes: eastSurfaceBytes.byteLength, sha256: sha(eastSurfaceBytes),
    triangles: globalThis.__eastSurfaceTris,
  });
}
if (!m.modules.some((x) => x.id === 'eastext-seal-wall')) {
  m.modules.push({
    id: 'eastext-seal-wall', path: './world/fangbang-temple-v4/east-extension/seal-wall.glb',
    bytes: eastWallBytes.byteLength, sha256: sha(eastWallBytes), triangles: 12,
  });
}
// dataset-owned path rewrite (v3 -> v4), shared frozen paths untouched
const rewrite = (node) => {
  if (typeof node === 'string') return node.replaceAll('./world/fangbang-temple-v3/', './world/fangbang-temple-v4/');
  if (Array.isArray(node)) return node.map(rewrite);
  if (node && typeof node === 'object') {
    const out2 = {};
    for (const [k, v] of Object.entries(node)) out2[k] = rewrite(v);
    return out2;
  }
  return node;
};
const m4 = rewrite(m);
m4.datasetId = 'fangbang-temple-v4';
m4.title = '方浜↔庙宇桥接世界 v4（庙轴 v3 变体 + 樟树；道具块默认关）';
m4.status = 'delivered_for_lead_review';
m4.ownerAdopted = false;
m4.visualReview = 'pending_lead';
m4.propsBlock = {
  dataset: './world/street-props/',
  defaultLoaded: false,
  loadParam: '?props=1',
  instances: 38,
  note: 'revocable street life layer (E batch, G12 gate)',
};
// east band (package J, G5): page-level surface + end wall, byte-checked
m4.eastShops = {
  note: 'block-east-shops asset inventory (adoption batch 20260919, G5); the page reconciles block assets against this section',
  assets: eastAssets,
};
m4.eastExtension = {
  surface: { path: './world/fangbang-temple-v4/east-extension/surface.glb',
    bytes: eastSurfaceBytes.byteLength, sha256: sha(eastSurfaceBytes),
    triangles: globalThis.__eastSurfaceTris },
  sealWall: { path: './world/fangbang-temple-v4/east-extension/seal-wall.glb',
    bytes: eastWallBytes.byteLength, sha256: sha(eastWallBytes), triangles: 12 },
  spec: 'kit/out/east-extension-spec.json (OSM 238219464 design reuse, chaikin 2 + 0.5m resample)',
  widths: EAST_SPEC.widths,
  junction: 'measured street-tail end edge, gap 0.00 / top step 0.00 by construction',
  endWall: { label: '样段端墙，非历史', sizeM: [11.2, 3.4, 0.3], at: EAST_SPEC.checks.endM },
  block: 'block-east-shops (9 placeholders upgraded per the west-band R1 rules; ?revoke=block-east-shops reverts)',
};
// budget accounting (DESIGN_SPEC.packageJ: eastShopsBlock <= 110k, fullSceneV4 <= 700k)
const eastBlockTris = eastAssets.reduce((s, a) => {
  if (a.triangles) return s + a.triangles;
  try {
    const mm = JSON.parse(readFileSync(resolve(root, `building/${a.module}/measurements.json`), 'utf8'));
    return s + (mm.triangles ?? 0);
  } catch { return s; }
}, 0);
const fullV4Tris = (m.placedTriangles ?? 0) + (m.templeAxis?.placedTriangles ?? 0)
  + eastBlockTris + globalThis.__eastSurfaceTris + 12
  + (m.westExtension?.surface?.triangles ?? 0) + (m.streetCompletion?.surface?.triangles ?? 0)
  + (m.streetCompletion?.eastTailSurface?.triangles ?? 0);
m4.budgets = {
  ...(m4.budgets ?? {}),
  eastShopsBlockTris: Math.round(eastBlockTris), eastShopsBlockTrisMax: 110000,
  eastShopsBlockPass: eastBlockTris <= 110000,
  fullSceneV4Tris: Math.round(fullV4Tris), fullSceneV4TrisMax: 700000,
  fullSceneV4Pass: fullV4Tris <= 700000,
};
m4.generatedBy = 'scripts/build_fangbang_v4_world.mjs';
await writeFile(resolve(OUT, 'review-manifest.json'), JSON.stringify(m4, null, 2) + '\n');

console.log(`V4_READY dir=world/fangbang-temple-v4 colliders=${worldV4.colliders.length} `
  + `routePts=${route.mainStreet.length} axisAssets=${m4.templeAxis.assets.length} `
  + `eastAssets=${globalThis.__eastAssets.length} eastBlockTris=${m4.budgets.eastShopsBlockTris} `
  + `fullV4Tris=${m4.budgets.fullSceneV4Tris} surfaceTris=${globalThis.__eastSurfaceTris}`);
