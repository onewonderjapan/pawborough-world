// Build the standalone dist for fangbang.html — the bridge page. Runs the
// delivered strict build (scripts/build_review.mjs: vite build + the frozen
// dataset copy set) FIRST, then carries the fangbang-temple dataset and a
// required-file gate: a dist that 404s (or SPA-fallbacks) the GLBs serves a
// dead page. Writes its own inventory (the delivered dist-inventory.json is
// left untouched).
//
// Run: node scripts/build_fangbang_dist.mjs
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const built = spawnSync(resolve(root, 'node_modules/.bin/node'), [], { stdio: 'ignore' });
void built;
const review = spawnSync(process.execPath, [resolve(root, 'scripts/build_review.mjs')], { cwd: root, stdio: 'inherit' });
if (review.status !== 0) process.exit(review.status ?? 1);

const DS = 'world/fangbang-temple';
const srcDir = resolve(root, DS), dstDir = resolve(root, 'dist', DS);
await mkdir(dstDir, { recursive: true });
async function copyTree(src, dst) {
  await mkdir(dst, { recursive: true });
  for (const f of await readdir(src, { withFileTypes: true })) {
    if (f.name.endsWith('.blend') || f.name.endsWith('.blend1')) continue;
    if (f.isDirectory()) await copyTree(resolve(src, f.name), resolve(dst, f.name));
    else await copyFile(resolve(src, f.name), resolve(dst, f.name));
  }
}
await copyTree(srcDir, dstDir);

// required-file gate: the page plus every dataset file it fetches at runtime
const REQUIRED = [
  'fangbang.html',
  `${DS}/review-manifest.json`, `${DS}/instances.json`, `${DS}/collision-world.json`,
  `${DS}/route.json`, `${DS}/cameras.json`, `${DS}/blocks.json`, `${DS}/map-registry.json`,
  ...DS && ['temple.glb', 'ground.glb', 'lions.glb', 'ornaments.glb', 'court-open.glb',
    'yimen.glb', 'dadian-court.glb', 'dadian.glb'].map((f) => `${DS}/temple-axis/${f}`),
  `${DS}/west-extension/surface.glb`, `${DS}/west-extension/seal-wall.glb`, `${DS}/west-extension/collision.json`,
  // referenced street datasets (verbatim paths, never copied twice)
  'world/street-reviewed.glb',
  'world/street-completion/surface.glb',
  ...['east-shop-130', 'east-shop-131', 'east-shop-132', 'east-shop-133'].flatMap((d) =>
    [`world/street-completion/${d}/model.glb`, `world/street-completion/${d}/collision.json`]),
  ...['east-shop-128', 'east-shop-129'].flatMap((d) =>
    [`world/east-edge/${d}/model.glb`, `world/east-edge/${d}/collision.json`]),
];
const inventory = {};
let missing = [];
for (const f of REQUIRED) {
  try {
    const st = await stat(resolve(root, 'dist', f));
    inventory[f] = st.size;
  } catch { missing.push(f); }
}
if (missing.length) { console.error('DIST_INCOMPLETE', missing); process.exit(1); }
await writeFile(resolve(root, 'dist/fangbang-dist-inventory.json'),
  JSON.stringify({ generatedBy: 'scripts/build_fangbang_dist.mjs', files: inventory,
    totalBytes: Object.values(inventory).reduce((s, v) => s + v, 0) }, null, 2) + '\n', 'utf8');
console.log(`FANGBANG_DIST_READY files=${REQUIRED.length} bytes=${Object.values(inventory).reduce((s, v) => s + v, 0)}`);
