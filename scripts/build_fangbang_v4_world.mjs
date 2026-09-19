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
const templeBlock = blocks.blocks.find((b) => b.id === 'block-temple-axis');
const swapByAssetId = {
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
  const r = compose(axisToWorld(c.obb?.pos ?? [0, 0, 0]), YAW, c);
  r.name = renameForBridge(r.name);
  r.group = renameForBridge(r.group ?? 'body');
  return r;
});
const worldV4 = {
  ...worldV3,
  dataset: 'fangbang-temple-v4',
  variant: 'v4: bridge v3 with temple-axis V3 variants (lions-v2, wing windows v2, entry-court-v3 '
    + 'incense road + burner, 4 camphor trees v2); props block referenced but default OFF (?props=1); '
    + 'axis records anchored per-instance (adoption-batch composition fix)',
  colliders: [...kept, ...composedAxis],
};
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
m4.generatedBy = 'scripts/build_fangbang_v4_world.mjs';
await writeFile(resolve(OUT, 'review-manifest.json'), JSON.stringify(m4, null, 2) + '\n');

console.log(`V4_READY dir=world/fangbang-temple-v4 colliders=${worldV4.colliders.length} `
  + `routePts=${route.mainStreet.length} axisAssets=${m4.templeAxis.assets.length}`);
