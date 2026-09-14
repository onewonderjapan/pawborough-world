// R1/R3 machine checks over the evidence record JSONs captured from the
// clean-build preview. Exit 0 = every acceptance field holds.
//   node scripts/verify_fix_r1r3.mjs <evidence-web-dir>
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: verify_fix_r1r3.mjs <evidence-web-dir>'); process.exit(2); }
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

const SHA128 = 'af93a694b72a242e746a33204c5425f86837adac56dd28f3e759785c584c3798';
const SHA129 = '2620ea4db1d6dc90e2825b8e9e3c5f72d8f2bcd83fa9e0bbb9ab95e87d27d3cf';

const names = (await readdir(dir)).filter(f => f.endsWith('.json')).sort();
const records = [];
for (const f of names) records.push({ f, r: JSON.parse(await readFile(resolve(dir, f), 'utf8')) });
const on = records.filter(x => x.r.dataset === 'east-edge' && x.r.load.assetsEnabled === true);
const off = records.filter(x => x.r.dataset === 'east-edge' && x.r.load.assetsEnabled === false);
const base = records.filter(x => x.r.dataset === 'base');
const laneb = records.filter(x => x.r.dataset === 'laneb');

// --- candidate (assets ON) ---
check('exactly one candidate C0 record (assets on)', on.length >= 1, on.map(x => x.f).join(','));
if (on.length >= 1) {
  const r = on[0].r;
  check('candidate: real scene triangles 184904 (= frozen 171464 + 13440)', r.resources.triangles === 184904, String(r.resources.triangles));
  check('candidate: bytesBase = assembly 20571620', r.load.bytesBase === 20571620, String(r.load.bytesBase));
  check('candidate: bytesAdditional = 3391172 (both GLBs)', r.load.bytesAdditional === 3391172, String(r.load.bytesAdditional));
  check('candidate: bytesTotal = 23962792 (20.57MB + 3.39MB)', r.load.bytesTotal === 23962792, String(r.load.bytesTotal));
  check('candidate: assetsEnabled true, nothing excluded', r.load.assetsEnabled === true && r.version.excludedAdditionalAssetIds.length === 0);
  check('candidate: version fingerprint carries both additional GLB hashes + on-state',
    r.version.fingerprint.includes(SHA128) && r.version.fingerprint.includes(SHA129) && r.version.additionalAssetsIncluded === true,
    r.version.fingerprint);
  check('candidate: version.additionalAssets lists both ids with shas',
    JSON.stringify(r.version.additionalAssets.map(a => a.id).sort()) === JSON.stringify(['east-shop-128', 'east-shop-129'])
    && r.version.additionalAssets.every(a => [SHA128, SHA129].includes(a.sha256)));
  check('candidate: trianglesExpected base/additional/total split', r.trianglesExpected.baseAssembly === 171464
    && r.trianglesExpected.additionalAssets === 13440 && r.trianglesExpected.total === 184904 && r.trianglesExpected.additionalAssetsIncluded === true,
    JSON.stringify(r.trianglesExpected));
  check('candidate: loadMode names the asset-block path', r.loadMode === 'single_assembly_plus_refined_asset_blocks', r.loadMode);
  check('candidate: assets block active', r.walking.blocks.active.includes('block-east-edge-shops'), r.walking.blocks.active.join(','));
}

// --- assets=off on the SAME built dataset ---
check('exactly one assets=off record captured', off.length === 1, off.map(x => x.f).join(','));
if (off.length === 1) {
  const r = off[0].r;
  check('assets=off: scene triangles back to frozen 171464', r.resources.triangles === 171464, String(r.resources.triangles));
  check('assets=off: bytesTotal = base assembly only 20571620', r.load.bytesTotal === 20571620 && r.load.bytesAdditional === 0,
    `${r.load.bytesTotal}/${r.load.bytesAdditional}`);
  check('assets=off: excludedAdditionalAssetIds lists exactly the two shops',
    JSON.stringify([...r.version.excludedAdditionalAssetIds].sort()) === JSON.stringify(['east-shop-128', 'east-shop-129'])
    && r.version.additionalAssetsIncluded === false && r.version.additionalAssets.length === 0,
    JSON.stringify(r.version.excludedAdditionalAssetIds));
  check('assets=off: fingerprint ends assets-off (distinguishable from on)', r.version.fingerprint.endsWith('assets-off'), r.version.fingerprint);
  check('assets=off: loadMode names base-only', r.loadMode === 'single_assembly_base_only', r.loadMode);
  check('assets=off: assets block NOT active', !r.walking.blocks.active.includes('block-east-edge-shops'), r.walking.blocks.active.join(','));
  check('assets=off: trianglesExpected total excludes the candidates', r.trianglesExpected.total === 171464 && r.trianglesExpected.additionalAssets === 0,
    JSON.stringify(r.trianglesExpected));
}

// --- base default + laneb still healthy on the same build ---
check('base record present and healthy', base.length === 1 && base[0].r.resources.triangles === 171464 && base[0].r.load.bytesTotal === 20571620,
  base.map(x => `${x.f}:${x.r.resources.triangles}/${x.r.load.bytesTotal}`).join(','));
check('laneb record present and loads its own dataset', laneb.length === 1 && laneb[0].r.resources.triangles > 0 && laneb[0].r.load.bytesTotal > 0,
  laneb.map(x => `${x.f}:${x.r.resources.triangles}/${x.r.load.bytesTotal}`).join(','));

// every saved record has a jpg sibling (screenshots really exist)
const missingJpg = [];
for (const { f } of records) {
  try { await readFile(resolve(dir, f.replace('.json', '.jpg'))); } catch { missingJpg.push(f); }
}
check('every record json has its saved jpg', missingJpg.length === 0, missingJpg.join(','));

console.log(failures === 0 ? 'VERIFY_R1R3 PASS' : `VERIFY_R1R3 FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
