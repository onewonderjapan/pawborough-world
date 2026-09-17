// Build the standalone dist for the temple-axis-v2 expansion (temple-v2.html)
// and carry BOTH new world datasets inside it — a dist that 404s (or
// SPA-fallbacks) the GLBs serves a dead page. Runs vite build (the
// temple-v2.html rollup input was added to vite.config.js), copies the two
// v2 datasets, and verifies every required file exists (hard fail).
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// the STANDARD review build first (street payload, shop blocks, laneb,
// east-edge, temple pilot — everything the bridge page also needs), then the
// two v2 datasets on top
const built = spawnSync('node', ['scripts/build_review.mjs'], { cwd: root, stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);

const DATASETS = ['world/temple-axis-v2', 'world/fangbang-temple-v2'];
const { lstat } = await import('node:fs/promises');
const copyDir = async (srcRel) => {
  const src = resolve(root, srcRel), dst = resolve(root, 'dist', srcRel);
  await mkdir(dst, { recursive: true });
  for (const f of await readdir(src)) {
    if (f.endsWith('.blend') || f.endsWith('.blend1')) continue;
    const st = await lstat(resolve(src, f));
    if (st.isDirectory()) { await copyDir(`${srcRel}/${f}`); continue; }
    await copyFile(resolve(src, f), resolve(dst, f));
  }
};
for (const ds of DATASETS) await copyDir(ds);

const AXIS_JSON = ['review-manifest.json', 'cameras.json', 'collision-world.json', 'route.json',
  'instances.json'];
const BRIDGE_JSON = [...AXIS_JSON, 'blocks.json'];
const REQUIRED = [
  'index.html', 'temple-v2.html', 'fangbang.html',
  ...AXIS_JSON.map((f) => `world/temple-axis-v2/${f}`),
  ...['temple.glb', 'ground.glb', 'lions.glb', 'ornaments.glb', 'yimen.glb', 'court-open.glb',
    'dadian.glb', 'dadian-court-v2.glb', 'peidian.glb', 'gallery.glb', 'yimen-stage.glb',
    'court3.glb', 'houdian.glb'].map((f) => `world/temple-axis-v2/${f}`),
  ...['yimen-roof-surface-samples.json', 'dadian-roof-surface-samples.json',
    'peidian-roof-surface-samples.json', 'houdian-roof-surface-samples.json']
    .map((f) => `world/temple-axis-v2/${f}`),
  ...BRIDGE_JSON.map((f) => `world/fangbang-temple-v2/${f}`),
  ...['temple.glb', 'ground.glb', 'lions.glb', 'ornaments.glb', 'yimen.glb', 'court-open.glb',
    'dadian.glb', 'dadian-court-v2.glb', 'peidian.glb', 'gallery.glb', 'yimen-stage.glb',
    'court3.glb', 'houdian.glb'].map((f) => `world/fangbang-temple-v2/temple-axis/${f}`),
  ...['west-extension/surface.glb', 'west-extension/seal-wall.glb',
    'west-extension/forecourt-bounds.glb', 'west-extension/collision.json']
    .map((f) => `world/fangbang-temple-v2/${f}`),
];
const inventory = {};
const missing = [];
for (const f of REQUIRED) {
  try {
    const st = await stat(resolve(root, 'dist', f));
    inventory[f] = st.size;
  } catch { missing.push(f); }
}
if (missing.length) { console.error('DIST_INCOMPLETE', missing); process.exit(1); }
await writeFile(resolve(root, 'dist/dist-inventory-temple-v2.json'),
  JSON.stringify({ generatedBy: 'scripts/build_temple_v2_dist.mjs', files: inventory }, null, 2) + '\n', 'utf8');
console.log(`TEMPLE_V2_DIST_READY files=${REQUIRED.length} bytes=${Object.values(inventory).reduce((s, v) => s + v, 0)}`);
