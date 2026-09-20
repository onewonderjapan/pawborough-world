// Derive world/fangbang-temple-v7 from the delivered v6 candidate:
//   - assembly GLB, instances, collision-world, route: verbatim copies (v6 read-only)
//   - block-lanes-v2 repointed at the lane-b-polish assets (new lane-b module +
//     new interfaces); lane-a KEEPS its v6 asset paths and bytes (A untouched)
//   - review-manifest lanesV2 section rebuilt with REAL bytes/sha/triangles of
//     the new GLBs (the page reconciles block assets against it and counts
//     every placed triangle — fake numbers cannot pass the load gate)
//   - cameras.json: v6 set + four lane-B close-range review views
// Nothing outside world/fangbang-temple-v7 and world/lane-b-polish is written.
// Run: node scripts/make_fangbang_v7_dataset.mjs
import { copyFile, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const V6 = resolve(root, 'world/fangbang-temple-v6');
const V7 = resolve(root, 'world/fangbang-temple-v7');
const POL = resolve(root, 'world/lane-b-polish');

const sha = (b) => createHash('sha256').update(b).digest('hex');
const info = async (rel) => {
  const p = resolve(root, rel);
  const b = await readFile(p);
  return { glb: `./${rel}`, bytes: b.byteLength, sha256: sha(b) };
};

await mkdir(V7, { recursive: true });
for (const f of ['street-reviewed-lanes.glb', 'instances.json', 'collision-world.json', 'route.json'])
  await copyFile(resolve(V6, f), resolve(V7, f));

// ---- new asset entries (true bytes/sha from the files the page will fetch) ---
const laneB = { id: 'lane-b', ...(await info('world/lane-b-polish/lane-b/model.glb')),
  collision: './world/lane-b-polish/lane-b/collision.json',
  positionGlb: [57.418, 0.09, 14.2485], rotationYRad: -0.4818 };
const ifc = { id: 'lanes-interfaces', ...(await info('world/lane-b-polish/interfaces/model.glb')),
  collision: './world/lane-b-polish/interfaces/collision.json',
  positionGlb: [0, 0, 0], rotationYRad: 0 };

// triangles per GLB from the sidecar measurements (written by the builders)
const measB = JSON.parse(await readFile(resolve(POL, 'lane-b/measurements.json'), 'utf8'));
const measI = JSON.parse(await readFile(resolve(POL, 'interfaces/measurements.json'), 'utf8'));
laneB.triangles = measB.triangles;
ifc.triangles = measI.triangles;

// ---- blocks.json: only block-lanes-v2 changes -------------------------------
const blocks = JSON.parse(await readFile(resolve(V6, 'blocks.json'), 'utf8'));
const lanesBlock = blocks.blocks.find((b) => b.id === 'block-lanes-v2');
for (const a of lanesBlock.assets) {
  if (a.id === 'lane-b-v2') {
    // the repaired B module replaces the v5 asset under a NEW asset id
    Object.assign(a, { id: 'lane-b', glb: laneB.glb, collision: laneB.collision });
  }
  if (a.id === 'lanes-interfaces') Object.assign(a, { glb: ifc.glb, collision: ifc.collision });
}
lanesBlock.note = 'lane-b-polish 20260920 candidate: repaired B mouth (production-transform apron/drain/pier bases, funnel walls) + refined B module (real recesses, ring doors); lane-a keeps its v6 asset; revoke returns the v4 state minus the removed placeholder patches';
blocks.generatedBy = 'scripts/make_fangbang_v7_dataset.mjs (derived from world/fangbang-temple-v6; only block-lanes-v2 B paths + note changed)';
await writeFile(resolve(V7, 'blocks.json'), JSON.stringify(blocks, null, 2) + '\n', 'utf8');

// ---- review-manifest.json ----------------------------------------------------
const m = JSON.parse(await readFile(resolve(V6, 'review-manifest.json'), 'utf8'));
const laneA6 = m.lanesV2.assets.find((a) => a.id === 'lane-a');
m.datasetId = 'fangbang-temple-v7';
m.title = '方浜↔庙宇桥接世界 v7 候选（B弄收口与双弄堂运行基线：实测嘴线地面闭合/漏斗墙/真凹口门窗/环框侧门；ownerAdopted=false）';
m.status = 'delivered_for_lead_review';
m.generatedBy = 'scripts/make_fangbang_v7_dataset.mjs + kit/build_lane_b_v3.py + kit/build_lanes_interfaces_v3.py (from fangbang-temple-v6, baseline ec2ab2f)';
m.lanesV2 = {
  ...m.lanesV2,
  note: 'lane-b-polish candidate assets: lane-b + interfaces rebuilt from measured mouth lines (survey 2026-09-20); lane-a verbatim from the v6 candidate',
  assets: [
    laneA6,
    { ...laneB, id: 'lane-b' },
    { ...ifc, id: 'lanes-interfaces' },
  ],
  budgets: {
    laneA: m.lanesV2.budgets.laneA,
    laneB: { actual: laneB.triangles, limit: 4500, pass: laneB.triangles <= 4500,
             note: 'v5 module was 8044; funnel walls added, invisible bevels removed' },
    interfaces: { actual: ifc.triangles, limit: 1000, pass: ifc.triangles <= 1000,
                  note: 'A part identical to v6; B apron/drain/pier bases rebuilt at the measured mouth' },
    totalAdded: laneA6.triangles + laneB.triangles + ifc.triangles,
  },
};
// base-scene expectation under the page's own accounting:
// v6 default 698704 with lane-b-v2 (8044) + v6 interfaces (911) replaced
const baseV7 = 698704 - 8044 - 911 + laneB.triangles + ifc.triangles;
m.budgets = {
  ...m.budgets,
  fullSceneV7Tris: baseV7,
  fullSceneV7Max: 700000,
  fullSceneV7Pass: baseV7 <= 700000,
  fullSceneV7Note: 'page-default configuration (assembly + autoApply asset blocks + dataset surfaces); skins/props are separate single-flag configs itemized at runtime',
};
await writeFile(resolve(V7, 'review-manifest.json'), JSON.stringify(m, null, 2) + '\n', 'utf8');

// ---- cameras.json: v6 views + four lane-B close-range review views -----------
const cams = JSON.parse(await readFile(resolve(V6, 'cameras.json'), 'utf8'));
const c = Math.cos(-0.4818), s = Math.sin(-0.4818);
const lw = (lx, y, ls) => [57.418 + c * lx + s * ls, y, 14.2485 - s * lx + c * ls];
const extra = [
  { id: 'lane-b-street-mouth', positionGlb: lw(-0.55, 1.62, -2.90), targetGlb: [57.44, 1.15, 14.19], verticalFovDegrees: 45, labelZh: 'B弄·街口（对照位）' },
  { id: 'lane-b-threshold-foot', positionGlb: lw(0.15, 0.45, -1.15), targetGlb: [57.43, 0.12, 14.15], verticalFovDegrees: 45, labelZh: 'B弄·门槛墙脚（对照位）' },
  { id: 'lane-b-window-door', positionGlb: lw(0.10, 1.90, 4.10), targetGlb: lw(1.74, 2.30, 4.70), verticalFovDegrees: 45, labelZh: 'B弄·东侧门窗（对照位）' },
  { id: 'lane-b-pocket-lookback', positionGlb: lw(-0.30, 1.60, 8.60), targetGlb: [57.6, 1.20, 13.2], verticalFovDegrees: 45, labelZh: 'B弄·回望（对照位）' },
];
const have = new Set(cams.cameras.map((v) => v.id));
cams.cameras.push(...extra.filter((v) => !have.has(v.id)));
cams.note = 'fangbang-temple-v7: delivered v6 cameras verbatim + four lane-B close-range comparison views';
await writeFile(resolve(V7, 'cameras.json'), JSON.stringify(cams, null, 2) + '\n', 'utf8');

// ---- self-check: the files the page fetches must all exist with true sizes ---
const required = [
  'street-reviewed-lanes.glb', 'instances.json', 'collision-world.json', 'route.json',
  'cameras.json', 'blocks.json', 'review-manifest.json',
  'world/lane-a-polish/lane-a/model.glb', 'world/lane-a-polish/lane-a/collision.json',
  'world/lane-b-polish/lane-b/model.glb', 'world/lane-b-polish/lane-b/collision.json',
  'world/lane-b-polish/interfaces/model.glb', 'world/lane-b-polish/interfaces/collision.json',
];
const missing = [];
for (const f of required) {
  const p = f.startsWith('world/') ? resolve(root, f) : resolve(V7, f);
  try { await stat(p); } catch { missing.push(f); }
}
if (missing.length) { console.error('V7_DATASET_INCOMPLETE', missing); process.exit(1); }

// lane-a must stay byte-identical to the v6 reference
const a6sha = (await info('world/lane-a-polish/lane-a/model.glb')).sha256;
if (a6sha !== laneA6.sha256) { console.error('LANE_A_BYTES_CHANGED', a6sha); process.exit(1); }

console.log(`V7_DATASET_READY laneB=${laneB.triangles}tris interfaces=${ifc.triangles}tris baseTotal=${baseV7} (<=700000: ${baseV7 <= 700000})`);
if (baseV7 > 700000) process.exit(1);
