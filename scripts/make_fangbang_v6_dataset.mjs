// Derive world/fangbang-temple-v6 from the delivered v5 candidate:
//   - assembly GLB, instances, collision-world, route: verbatim copies (v5 read-only)
//   - block-lanes-v2 repointed at the lane-a-polish assets (new lane-a +
//     new interfaces); lane-b-v2 keeps its v5 GLB/sidecar untouched
//   - review-manifest lanesV2 section rebuilt with REAL bytes/sha/triangles of
//     the new GLBs (the page reconciles block assets against it and counts
//     every placed triangle — fake numbers cannot pass the load gate)
//   - cameras.json: v5 set + four A close-range review views
// Nothing outside world/fangbang-temple-v6 and world/lane-a-polish is written.
// Run: node scripts/make_fangbang_v6_dataset.mjs
import { copyFile, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const V5 = resolve(root, 'world/fangbang-temple-v5');
const V6 = resolve(root, 'world/fangbang-temple-v6');
const POL = resolve(root, 'world/lane-a-polish');

const sha = (b) => createHash('sha256').update(b).digest('hex');
const info = async (rel) => {
  const p = resolve(root, rel);
  const b = await readFile(p);
  return { glb: `./${rel}`, bytes: b.byteLength, sha256: sha(b) };
};

await mkdir(V6, { recursive: true });
for (const f of ['street-reviewed-lanes.glb', 'instances.json', 'collision-world.json', 'route.json'])
  await copyFile(resolve(V5, f), resolve(V6, f));

// ---- new asset entries (true bytes/sha from the files the page will fetch) ---
const laneA = { id: 'lane-a', ...(await info('world/lane-a-polish/lane-a/model.glb')),
  collision: './world/lane-a-polish/lane-a/collision.json',
  positionGlb: [43.545, 0.09, -16.375], rotationYRad: 3.1165 };
const ifc = { id: 'lanes-interfaces', ...(await info('world/lane-a-polish/interfaces/model.glb')),
  collision: './world/lane-a-polish/interfaces/collision.json',
  positionGlb: [0, 0, 0], rotationYRad: 0 };

// triangles per GLB from the sidecar measurements (written by the builders)
const meas = JSON.parse(await readFile(resolve(POL, 'lane-a/measurements.json'), 'utf8'));
const measI = JSON.parse(await readFile(resolve(POL, 'interfaces/measurements.json'), 'utf8'));
laneA.triangles = meas.triangles;
ifc.triangles = measI.triangles;

// ---- blocks.json: only block-lanes-v2 changes -------------------------------
const blocks = JSON.parse(await readFile(resolve(V5, 'blocks.json'), 'utf8'));
const lanesBlock = blocks.blocks.find((b) => b.id === 'block-lanes-v2');
for (const a of lanesBlock.assets) {
  if (a.id === 'lane-a') Object.assign(a, { glb: laneA.glb, collision: laneA.collision });
  if (a.id === 'lanes-interfaces') Object.assign(a, { glb: ifc.glb, collision: ifc.collision });
}
lanesBlock.note = 'lane-a-polish 20260920 candidate: rebuilt lane A module + measured-line mouth interfaces (floor closure, east mouth wall, re-anchored piers); lane-b-v2 verbatim; revoke returns the v4 state minus the removed placeholder patches';
blocks.generatedBy = 'scripts/make_fangbang_v6_dataset.mjs (derived from world/fangbang-temple-v5; only block-lanes-v2 asset paths + note changed)';
await writeFile(resolve(V6, 'blocks.json'), JSON.stringify(blocks, null, 2) + '\n', 'utf8');

// ---- review-manifest.json ----------------------------------------------------
const m = JSON.parse(await readFile(resolve(V5, 'review-manifest.json'), 'utf8'));
const laneB = m.lanesV2.assets.find((a) => a.id === 'lane-b-v2');
m.datasetId = 'fangbang-temple-v6';
m.title = '方浜↔庙宇桥接世界 v6 候选（A弄近景精修：实测墙线地面闭合/新东墙/真凹口门窗/尽端壁龛；ownerAdopted=false）';
m.status = 'delivered_for_lead_review';
m.generatedBy = 'scripts/make_fangbang_v6_dataset.mjs + kit/build_lane_a_v2.py + kit/build_lanes_interfaces_v2.py (from fangbang-temple-v5, baseline 96b6690)';
m.lanesV2 = {
  ...m.lanesV2,
  note: 'lane-a-polish candidate assets: lane-a + interfaces rebuilt from measured wall lines (survey 2026-09-20); lane-b-v2 verbatim from the lanes-construction batch',
  assets: [
    { ...laneA, id: 'lane-a' },
    laneB,
    { ...ifc, id: 'lanes-interfaces' },
  ],
  budgets: {
    laneA: { actual: laneA.triangles, limit: 4000, pass: laneA.triangles <= 4000 },
    laneB: m.lanesV2.budgets.laneB,
    interfaces: { actual: ifc.triangles, limit: 950, pass: ifc.triangles <= 950, note: 'includes the new east mouth wall' },
    totalAdded: laneA.triangles + laneB.triangles + ifc.triangles,
  },
};
// base-scene expectation under the page's own accounting:
// v5 default 703049 with old lane-a (7290) + old interfaces (876) replaced
const v5Lanes = m.lanesV2.budgets;
const baseV6 = 703049 - 7290 - 876 + laneA.triangles + ifc.triangles;
m.budgets = {
  ...m.budgets,
  fullSceneV6Tris: baseV6,
  fullSceneV6Max: 700000,
  fullSceneV6Pass: baseV6 <= 700000,
  fullSceneV6Note: 'page-default configuration (assembly + autoApply asset blocks + dataset surfaces); skins/props are separate single-flag configs itemized at runtime',
};
await writeFile(resolve(V6, 'review-manifest.json'), JSON.stringify(m, null, 2) + '\n', 'utf8');

// ---- cameras.json: v5 views + four A close-range review views ----------------
const cams = JSON.parse(await readFile(resolve(V5, 'cameras.json'), 'utf8'));
const extra = [
  { id: 'lane-a-gate-mouth', positionGlb: [43.42, 1.55, -9.55], targetGlb: [43.62, 1.15, -14.8], verticalFovDegrees: 55, labelZh: 'A弄·街口（对照位）' },
  { id: 'lane-a-threshold-foot', positionGlb: [43.15, 0.42, -11.3], targetGlb: [43.3, 0.25, -10.15], verticalFovDegrees: 55, labelZh: 'A弄·门槛墙脚（对照位）' },
  { id: 'lane-a-window-door', positionGlb: [43.85, 1.65, -20.1], targetGlb: [42.55, 1.75, -21.3], verticalFovDegrees: 55, labelZh: 'A弄·门窗近景（对照位）' },
  { id: 'lane-a-end-niche', positionGlb: [43.72, 1.55, -21.7], targetGlb: [43.78, 1.65, -24.4], verticalFovDegrees: 55, labelZh: 'A弄·尽端（对照位）' },
];
const have = new Set(cams.cameras.map((c) => c.id));
cams.cameras.push(...extra.filter((c) => !have.has(c.id)));
cams.note = 'fangbang-temple-v6: delivered v5 bridge cameras verbatim + four lane-A close-range comparison views';
await writeFile(resolve(V6, 'cameras.json'), JSON.stringify(cams, null, 2) + '\n', 'utf8');

// ---- self-check: the files the page fetches must all exist with true sizes ---
const required = [
  'street-reviewed-lanes.glb', 'instances.json', 'collision-world.json', 'route.json',
  'cameras.json', 'blocks.json', 'review-manifest.json',
  'world/lane-a-polish/lane-a/model.glb', 'world/lane-a-polish/lane-a/collision.json',
  'world/lane-a-polish/interfaces/model.glb', 'world/lane-a-polish/interfaces/collision.json',
  'world/lanes-v2/lane-b-v2/model.glb', 'world/lanes-v2/lane-b-v2/collision.json',
];
const missing = [];
for (const f of required) {
  const p = f.startsWith('world/') ? resolve(root, f) : resolve(V6, f);
  try { await stat(p); } catch { missing.push(f); }
}
if (missing.length) { console.error('V6_DATASET_INCOMPLETE', missing); process.exit(1); }

const manifest6 = JSON.parse(await readFile(resolve(V6, 'review-manifest.json'), 'utf8'));
console.log(`V6_DATASET_READY laneA=${laneA.triangles}tris interfaces=${ifc.triangles}tris baseTotal=${baseV6} (<=700000: ${baseV6 <= 700000})`);
if (baseV6 > 700000) process.exit(1);
