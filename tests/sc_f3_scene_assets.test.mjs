// SC-F3 contract: one loaded-scene inventory drives every statistic.
// The lead found the street-completion surface (1468 tri / 985560 B) live in
// the scene yet absent from record.trianglesExpected, load.bytesTotal,
// version.additionalAssets and the fingerprint — four hand-maintained
// formulas that had each grown a special case. main.js now derives all four
// from src/world/sceneAssets.js; this test pins that logic against the REAL
// dataset manifests, including the invariants the earlier review rounds
// established (R3 east-edge markers stay byte-compatible).
//
// Run: node tests/sc_f3_scene_assets.test.mjs   (exit 0 = contract holds)
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadedSceneAssets, expectedTriangles, sceneFingerprint, surfaceEntry, SURFACE_ID } from '../src/world/sceneAssets.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}

const scManifest = JSON.parse(await readFile(resolve(root, 'world/street-completion/review-manifest.json'), 'utf8'));
const eeManifest = JSON.parse(await readFile(resolve(root, 'world/east-edge/review-manifest.json'), 'utf8'));

// the six refined shops declared by the two asset blocks, in block order
const allShopInfos = [
  ...eeManifest.eastEdgeAssets.assets,
  ...scManifest.streetCompletion.assets,
].map(a => ({ id: a.id, glb: a.glb, bytes: a.bytes, sha256: a.sha256, triangles: a.triangles }));
const surface = surfaceEntry(scManifest);
check('street-completion manifest declares the surface with bytes/sha/triangles',
  !!surface && surface.bytes === 985560 && surface.triangles === 1468 && /^[0-9a-f]{64}$/.test(surface.sha256),
  surface ? `${surface.bytes}B ${surface.triangles}tri` : 'missing');

// --- candidate mode: all six shops + the surface ---------------------------
const on = loadedSceneAssets(scManifest, allShopInfos, true);
check('candidate inventory: 6 shop assets + 1 surface', on.length === 7 &&
  on.filter(e => e.kind === 'asset').length === 6 && on.filter(e => e.kind === 'surface').length === 1,
  `len ${on.length}`);
const expOn = expectedTriangles(scManifest.placedTriangles, on);
check('candidate: expected total = placed + shops + surface (matches live scene 214360)',
  expOn.total === 214360, JSON.stringify(expOn));
check('candidate: surface contributes its 1468 triangles to the expectation',
  expOn.extra === 13440 + 27988 + 1468, String(expOn.extra));
const fpOn = sceneFingerprint(scManifest, on, true);
check('candidate: fingerprint carries all 7 sha entries',
  on.every(e => fpOn.includes(e.sha256)) && fpOn.startsWith(`glb-sha256-${scManifest.worldAssembly.sha256}`), fpOn);

// --- comparison mode (assets=off): surface STILL loaded and counted --------
const off = loadedSceneAssets(scManifest, [], false);
check('assets=off inventory: surface only', off.length === 1 && off[0].id === SURFACE_ID);
const expOff = expectedTriangles(scManifest.placedTriangles, off);
check('assets=off: expected total = placed + surface (ground is not off)',
  expOff.total === scManifest.placedTriangles + 1468, JSON.stringify(expOff));
const fpOff = sceneFingerprint(scManifest, off, false);
check('assets=off: fingerprint differs from candidate', fpOff !== fpOn);
check('assets=off: fingerprint keeps the legacy assets-off marker AND the surface sha',
  fpOff.endsWith('assets-off') === false && fpOff.includes('assets-off') && fpOff.includes(surface.sha256), fpOff);
check('assets=off: marker still distinguishably ends with the surface entry (R3 tools match the marker, not the tail)',
  fpOff.includes('assets-off+'), fpOff);

// --- surface-only change must move version and expectation -----------------
const mutated = JSON.parse(JSON.stringify(scManifest));
mutated.streetCompletion.surface = { ...mutated.streetCompletion.surface, sha256: '0'.repeat(64) };
const surfAfter = surfaceEntry(mutated);
const fpMut = sceneFingerprint(mutated, loadedSceneAssets(mutated, allShopInfos, true), true);
check('surface-only sha change alters the fingerprint', fpMut !== fpOn, fpMut.split('+').pop());
const expMut = expectedTriangles(mutated.placedTriangles, loadedSceneAssets(mutated, allShopInfos, true).map(e => e.id === SURFACE_ID ? { ...e, triangles: 99999 } : e));
check('surface-only triangle change alters the expected total', expMut.total === expOn.total + 99999 - 1468);

// --- east-edge dataset has no surface: legacy shapes unchanged (R1-R3) -----
const eeOn = loadedSceneAssets(eeManifest, allShopInfos.filter(i => i.id.startsWith('east-shop-128') || i.id.startsWith('east-shop-129')), true);
check('east-edge inventory: two shops, no surface entry', eeOn.length === 2 && eeOn.every(e => e.kind === 'asset'));
check('east-edge fingerprint: unchanged legacy shape (base + both shas)',
  sceneFingerprint(eeManifest, eeOn, true) ===
  [`glb-sha256-${eeManifest.worldAssembly.sha256}`, ...eeOn.map(a => `${a.id}:${a.sha256}`)].join('+'));
check('east-edge assets=off fingerprint still ENDS with assets-off (verify_fix_r1r3 compatibility)',
  sceneFingerprint(eeManifest, [], false).endsWith('assets-off'));
check('east-edge expected total = 184904 (R3 value untouched)',
  expectedTriangles(eeManifest.placedTriangles, eeOn).total === 184904);

// --- integrity identity on the real dataset: bytes summed from entries -----
check('candidate bytes sum: base + 6 shops + surface = 32049956',
  scManifest.worldAssembly.bytes + on.reduce((s, e) => s + e.bytes, 0) === 32049956,
  String(scManifest.worldAssembly.bytes + on.reduce((s, e) => s + e.bytes, 0)));

console.log(failures === 0 ? '\nSC_F3_SCENE_ASSETS_PASS' : `\nSC_F3_SCENE_ASSETS_FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
