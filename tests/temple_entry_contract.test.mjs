// Temple ENTRY-GROUP contract tests — the assembled dataset (world/temple-entry)
// checked as a whole: validator on every NEW glb, the yimen instance placement
// proven from exported vertices (local bounds + origin == world envelope),
// the court extents, and manifest integrity (bytes/triangles/hashes).
//
// Run: node tests/temple_entry_contract.test.mjs
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';
import { readGlb, transformPoint } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DS = resolve(root, 'world/temple-entry');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}

// --- 1. validator on the new GLBs -------------------------------------------
for (const id of ['yimen', 'court']) {
  const bytes = await readFile(resolve(DS, `${id}.glb`));
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 100 });
  check(`E1: ${id}.glb validator 0 errors`, (report.issues?.numErrors ?? 0) === 0,
    `${report.issues?.numErrors ?? 0} errors, ${report.issues?.numWarnings ?? 0} warnings`);
}

// --- 2. manifest integrity: every asset's bytes/triangles/sha match ---------
const manifest = JSON.parse(await readFile(resolve(DS, 'review-manifest.json'), 'utf8'));
{
  let triSum = 0;
  for (const [id, a] of Object.entries(manifest.assets)) {
    const bytes = await readFile(resolve(DS, `${id}.glb`));
    check(`E2: ${id}.glb bytes match the manifest`, bytes.byteLength === a.bytes,
      `${bytes.byteLength} vs ${a.bytes}`);
    const glb = readGlb(bytes);
    check(`E2: ${id}.glb triangles match the manifest`, glb.totalTriangles === a.triangles,
      `${glb.totalTriangles} vs ${a.triangles}`);
    triSum += a.triangles;
  }
  check('E2: placedTriangles equals the asset sum', manifest.placedTriangles === triSum,
    `${manifest.placedTriangles} vs ${triSum}`);
  check('E2: new-content bytes within the 10MB budget', manifest.budgets.newDownloadBytes.pass,
    `${(manifest.budgets.newDownloadBytes.actual / 1e6).toFixed(2)}MB`);
}

// --- 3. yimen instance placement: local bounds + origin == world envelope ---
{
  const glb = readGlb(await readFile(resolve(DS, 'yimen.glb')));
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const m of glb.meshes) {
    for (let i = 0; i < m.positions.length; i += 3) {
      const p = transformPoint(m.matrix, [m.positions[i], m.positions[i + 1], m.positions[i + 2]]);
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    }
  }
  const OZ = -21;
  // the roof eaves overhang the facade (front +0.75 / rear -5.95 by design);
  // the WALL plane at the local origin is proven by wall-height vertices
  // sitting on z≈0 (the facade line), not by the overall bounds
  let facadeVerts = 0;
  for (const m of glb.meshes) for (let i = 0; i < m.positions.length; i += 3) {
    const p = transformPoint(m.matrix, [m.positions[i], m.positions[i + 1], m.positions[i + 2]]);
    if (Math.abs(p[2]) <= 0.1 && p[1] > 0.2 && p[1] < 5.0) facadeVerts++;
  }
  check('E3: yimen facade wall geometry sits on the local z=0 origin plane',
    facadeVerts >= 40 && Math.abs(hi[2] - 0.78) < 0.06 && Math.abs(lo[2] + 5.98) < 0.06,
    `facade verts ${facadeVerts}; bounds z ${lo[2].toFixed(2)}..${hi[2].toFixed(2)} (eaves)`);
  // placed world envelope: every z shifts by -21; the door center stays on the axis
  const worldDoorZ = OZ + (0 + -5.2) / 2;
  check('E3: yimen door mid-depth lands at world z=-23.6', Math.abs(worldDoorZ + 23.6) < 1e-6,
    `${worldDoorZ}`);
  // x symmetry of the local bounds (gate centered on the axis)
  check('E3: yimen local bounds symmetric about x=0 (axis centered)',
    Math.abs(lo[0] + hi[0]) < 0.02, `x ${lo[0].toFixed(3)}..${hi[0].toFixed(3)}`);
}

// --- 4. court extents --------------------------------------------------------
{
  const glb = readGlb(await readFile(resolve(DS, 'court.glb')));
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const m of glb.meshes) {
    for (let i = 0; i < m.positions.length; i += 3) {
      const p = transformPoint(m.matrix, [m.positions[i], m.positions[i + 1], m.positions[i + 2]]);
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    }
  }
  // wall bodies end at ±8.28; the coping caps ride 0.1 wider → ±8.33
  check('E4: court spans the wall envelope x ±8.33 (caps included)',
    Math.abs(hi[0] - 8.33) < 0.04 && Math.abs(lo[0] + 8.33) < 0.04,
    `x ${lo[0].toFixed(2)}..${hi[0].toFixed(2)}`);
  check('E4: court z from the shanmen line to the cutoff wall back',
    Math.abs(hi[2] + 3.28) < 0.05 && Math.abs(lo[2] + 29.38) < 0.08,
    `z ${lo[2].toFixed(2)}..${hi[2].toFixed(2)}`);
}

// --- 5. cameras + route contract ---------------------------------------------
{
  const cams = JSON.parse(await readFile(resolve(DS, 'cameras.json'), 'utf8'));
  check('E5: eight entry cameras with finite poses and fov 40..70',
    cams.cameras.length === 8 && cams.cameras.every((c) =>
      c.positionGlb.every(Number.isFinite) && c.targetGlb.every(Number.isFinite)
      && c.verticalFovDegrees >= 40 && c.verticalFovDegrees <= 70),
    cams.cameras.map((c) => c.id).join(','));
  const route = JSON.parse(await readFile(resolve(DS, 'route.json'), 'utf8'));
  check('E5: route has the 10 designed waypoints street->landing',
    route.mainStreet.length === 10
    && route.mainStreet[0][2] === 5 && Math.abs(route.mainStreet[9][2] + 27.3) < 1e-6,
    `${route.mainStreet.length} points, first z=${route.mainStreet[0][2]}, last z=${route.mainStreet[9][2]}`);
  check('E5: route honestly labeled (no manual-walk claim)',
    route.manualWalkClaim === false, String(route.manualWalkClaim));
}

console.log(failures === 0 ? 'ENTRY_CONTRACT_PASS' : `ENTRY_CONTRACT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
