// H2 (adoption batch 20260919) — compressed variant is the DEFAULT load state.
//
//   default URL        -> pages fetch *.cm.glb (and review-manifest.cm.json)
//   ?compressed=0      -> pages fetch the original bytes
//   ?compressed=1      -> still compressed (accepted legacy opt-in)
//
// State must be CONSISTENT per dataset (a page checks its GLBs against the
// manifest it fetched), so a dataset without a review-manifest.cm.json stays
// entirely original. This test pins: the flag logic, the three mains' install
// contract, both manifest states' file integrity (bytes+sha256 on disk), the
// triangle accounting across both states (quantization moves <= 0.1%), and
// the known original-state dataset list.
//
// Run: node tests/compressed_default.test.mjs
import { readFile, readdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};
const sha = (b) => createHash('sha256').update(b).digest('hex');

// ---- 1. flag logic (src/world/compressedState.js) -------------------------
const { compressedEnabled } = await import(resolve(root, 'src/world/compressedState.js'));
check('flag: default (no param) -> compressed', compressedEnabled(new URLSearchParams('')) === true);
check('flag: ?compressed=0 -> original', compressedEnabled(new URLSearchParams('compressed=0')) === false);
check('flag: ?compressed=1 -> compressed', compressedEnabled(new URLSearchParams('compressed=1')) === true);

// ---- 2. the three mains install the default-ON fetch ----------------------
for (const main of ['src/fangbangMain.js', 'src/templeV2Main.js', 'src/templeV3Main.js']) {
  const src = await readFile(resolve(root, main), 'utf8');
  check(`${main}: imports compressedState`,
    src.includes("from './world/compressedState.js'"));
  check(`${main}: installs the fetch before loading`,
    /installCompressedFetch\(/.test(src) &&
    src.indexOf('installCompressedFetch(') < src.indexOf('review-manifest.json'));
}

// ---- 3. both manifest states: every referenced GLB exists + sha true ------
const sumTriangles = (node) => {
  let sum = 0;
  const walk = (n) => {
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    if (n && typeof n === 'object') {
      for (const [k, v] of Object.entries(n)) (k === 'triangles' && typeof v === 'number') ? sum += v : walk(v);
    }
  };
  walk(node);
  return sum;
};
const collectGlbs = (node, out = []) => {
  const walk = (n) => {
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    if (n && typeof n === 'object') {
      for (const [k, v] of Object.entries(n)) {
        if (typeof v === 'string' && v.endsWith('.glb') && !v.endsWith('.cm.glb')) {
          // *previousFile fields are provenance notes pointing at RETIRED
          // assets (e.g. temple-axis-v3 tree-camphor.glb -> superseded by
          // tree-camphor-v2.glb) — no page ever fetches them, so they are
          // exempt from the on-disk load-reference checks
          if (/previousfile$/i.test(k)) continue;
          out.push({ node: n, key: k, value: v });
        } else walk(v);
      }
    }
  };
  walk(node);
  return out;
};
const exists = async (p) => { try { await access(p, constants.F_OK); return true; } catch { return false; } };

const worldDir = resolve(root, 'world');
const datasetDirs = (await readdir(worldDir, { withFileTypes: true }))
  .filter((e) => e.isDirectory()).map((e) => e.name).sort();
const cmDatasets = [], originalDatasets = [];
for (const ds of datasetDirs) {
  const origPath = resolve(worldDir, ds, 'review-manifest.json');
  if (!(await exists(origPath))) continue;
  const cmPath = resolve(worldDir, ds, 'review-manifest.cm.json');
  (await exists(cmPath) ? cmDatasets : originalDatasets).push(ds);
}

for (const ds of cmDatasets) {
  const orig = JSON.parse(await readFile(resolve(worldDir, ds, 'review-manifest.json'), 'utf8'));
  const cm = JSON.parse(await readFile(resolve(worldDir, ds, 'review-manifest.cm.json'), 'utf8'));

  // original state must stay fully loadable (the ?compressed=0 escape hatch)
  let origOk = true, origBad = '';
  for (const { value } of collectGlbs(orig)) {
    const f = resolve(root, value.replace(/^\.\//, ''));
    if (!(await exists(f))) { origOk = false; origBad = `missing ${value}`; break; }
  }
  check(`${ds}: original manifest -> every .glb on disk`, origOk, origBad);

  // compressed state: every .glb field exists on disk; where the node carries
  // sha256/bytes, they must match the FILE it now points to
  let cmOk = true, cmBad = '';
  for (const { node, value } of collectGlbs(cm)) {
    const f = resolve(root, value.replace(/^\.\//, ''));
    if (!(await exists(f))) { cmOk = false; cmBad = `missing ${value}`; break; }
    if (typeof node.sha256 === 'string' && typeof node.bytes === 'number') {
      const b = await readFile(f);
      if (sha(b) !== node.sha256 || b.byteLength !== node.bytes) {
        cmOk = false; cmBad = `${value}: bytes/sha mismatch`; break;
      }
    }
  }
  check(`${ds}: compressed manifest -> every referenced file exists with true bytes/sha`, cmOk, cmBad);

  // triangle accounting across both states: quantization may collapse a few
  // degenerate triangles — 0.1% ceiling (same tolerance the pages enforce)
  const t0 = sumTriangles(orig), t1 = sumTriangles(cm);
  const drift = t0 > 0 ? Math.abs(t0 - t1) / t0 : 0;
  check(`${ds}: triangle total drift <= 0.1% across states`, drift <= 0.001,
    `orig=${t0} cm=${t1} drift=${(drift * 100).toFixed(4)}%`);
}

check('compressed-state datasets present (fangbang-temple-v3/v4, street-sidefaces, temple-axis-v3, street-props)',
  ['fangbang-temple-v3', 'fangbang-temple-v4', 'street-sidefaces', 'temple-axis-v3', 'street-props'].every((d) => cmDatasets.includes(d)),
  `cm: ${cmDatasets.join(', ')}`);

// ---- 4. original-state datasets: the probe-fallback contract ---------------
// v1/v2 street datasets, temple-axis-v2 and laneb are READ-ONLY (frozen) —
// they have no compressed manifest and pages must serve them entirely original
// (no mixed states). (temple-axis-v3 and street-props gained verified cm
// variants in the world-closeout batch 20260919 — allowedChanges dirs.) If one
// of the frozen datasets grows a cm manifest again (the v4 incident), this pin
// fails loudly.
for (const ds of ['fangbang-temple', 'fangbang-temple-v2', 'temple-axis-v2', 'laneb']) {
  const has = await exists(resolve(worldDir, ds, 'review-manifest.cm.json'));
  check(`${ds}: serves ORIGINAL state (no cm manifest)`, !has);
}

// ---- 4b. tolerance-fallback pins (closeout batch 20260919) -----------------
// these assets have NO compressed variant by design: their cm candidates
// failed the 0.1% decode triangle-drift ceiling (degenerate triangles removed
// by meshopt), so the pages must keep loading the original bytes. If a cm
// file ever appears at these paths, the tolerance policy was bypassed.
for (const cm of [
  'world/fangbang-temple-v4/temple-axis/lions.cm.glb',
  'world/fangbang-temple-v4/east-extension/surface.cm.glb',
  'world/temple-axis-v3/lions-v2.cm.glb',
]) {
  const has = await exists(resolve(root, cm));
  check(`${cm}: stays ORIGINAL (cm candidate failed drift tolerance)`, !has);
}

// ---- 5. VERSION.json records the adoption + compressed default ------------
const version = JSON.parse(await readFile(resolve(root, 'VERSION.json'), 'utf8'));
check('VERSION.json: compressedDefault=true', version.compressedDefault === true);
check('VERSION.json: adoption block with decision file',
  version.adoption?.decisionFile === 'OWNER_DECISION-20260919.json');
check('VERSION.json: 10 in-tree adopted artifacts registered',
  (version.adoption?.inTreeBatches ?? []).length >= 10 &&
  (version.adoption?.inTreeBatches ?? []).every((b) => b.ownerAdopted === true));
check('VERSION.json: 5 historical adopted batches registered',
  (version.adoption?.historicalBatches ?? []).length >= 5);
check('VERSION.json: fangbang/temple-shanmen/temple-shanmen-repair among adopted artifacts',
  ['fangbang-temple', 'temple-shanmen', 'temple-shanmen-repair'].every((a) =>
    (version.adoption?.inTreeBatches ?? []).some((b) => b.artifact === a)));

process.exit(failures === 0 ? 0 : 1);
