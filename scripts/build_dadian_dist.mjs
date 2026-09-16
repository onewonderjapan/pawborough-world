// Build the standalone dist for the THREE pilot pages (temple.html,
// temple-entry.html, dadian.html) and carry the world datasets inside it — a
// dist that 404s (or SPA-fallbacks) the GLBs serves a dead page, which is
// exactly the state 5291 was delivered in before the entry fix. Runs vite
// build, then copies the datasets and verifies every required file exists
// (hard fail).
import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');

const DATASETS = ['world/temple-shanmen', 'world/temple-entry', 'world/temple-dadian'];
const copyDir = async (srcRel) => {
  const src = resolve(root, srcRel), dst = resolve(root, 'dist', srcRel);
  await mkdir(dst, { recursive: true });
  for (const f of await readdir(src)) {
    if (f.endsWith('.blend') || f.endsWith('.blend1')) continue;
    await copyFile(resolve(src, f), resolve(dst, f));
  }
};

for (const ds of DATASETS) await copyDir(ds);

// required-file gate: the dist either carries all three pilots complete or fails
const REQUIRED = [
  'index.html', 'temple.html', 'temple-entry.html', 'dadian.html',
  ...DATASETS.flatMap((ds) => {
    const base = ds.endsWith('temple-shanmen')
      ? ['temple.glb', 'ground.glb', 'lions.glb', 'ornaments.glb', 'review-manifest.json',
         'cameras.json', 'collision-world.json']
      : ds.endsWith('temple-entry')
        ? ['temple.glb', 'ground.glb', 'lions.glb', 'ornaments.glb', 'yimen.glb', 'court.glb',
           'review-manifest.json', 'cameras.json', 'collision-world.json', 'route.json', 'instances.json']
        : ['temple.glb', 'ground.glb', 'lions.glb', 'ornaments.glb', 'yimen.glb', 'court-open.glb',
           'dadian.glb', 'dadian-court.glb', 'review-manifest.json', 'cameras.json',
           'collision-world.json', 'route.json', 'instances.json',
           'yimen-roof-surface-samples.json', 'dadian-roof-surface-samples.json'];
    return base.map((f) => `${ds}/${f}`);
  }),
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
await writeFile(resolve(root, 'dist/dist-inventory.json'),
  JSON.stringify({ generatedBy: 'scripts/build_dadian_dist.mjs', files: inventory }, null, 2) + '\n', 'utf8');
console.log(`DIST_DATASETS_READY files=${REQUIRED.length} bytes=${Object.values(inventory).reduce((s, v) => s + v, 0)}`);
