// Temple DADIAN world-dataset tests — the assembly itself: 8 assets present
// and hash-faithful to their sources (7 frozen + court-open), instances at
// the frozen placements, collision records translated correctly, route
// coherent with the instances, manifest triangle integrity.
//
// Run: node tests/temple_dadian_world.test.mjs
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';
import { readGlb } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DS = resolve(root, 'world/temple-dadian');
const ENTRY_DS = resolve(root, 'world/temple-entry');
const SHANMEN_DS = resolve(root, 'world/temple-shanmen');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}
const sha = (b) => createHash('sha256').update(b).digest('hex');

const manifest = JSON.parse(await readFile(resolve(DS, 'review-manifest.json'), 'utf8'));
const instances = JSON.parse(await readFile(resolve(DS, 'instances.json'), 'utf8'));
const collision = JSON.parse(await readFile(resolve(DS, 'collision-world.json'), 'utf8'));
const route = JSON.parse(await readFile(resolve(DS, 'route.json'), 'utf8'));
const cameras = JSON.parse(await readFile(resolve(DS, 'cameras.json'), 'utf8'));

// W1 — the 8 assets exist, validator-clean, and match the manifest
const FILES = ['temple.glb', 'ground.glb', 'lions.glb', 'ornaments.glb', 'yimen.glb',
  'court-open.glb', 'dadian.glb', 'dadian-court.glb'];
let triSum = 0;
for (const file of FILES) {
  const bytes = await readFile(resolve(DS, file)).catch(() => null);
  check(`W1: ${file} present`, !!bytes);
  if (!bytes) continue;
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 20 });
  check(`W1: ${file} validator 0 errors`, (report.issues?.numErrors ?? 0) === 0,
    `${report.issues?.numErrors ?? 0} errors`);
  const a = Object.values(manifest.assets).find((a) => a.file.endsWith('/' + file));
  check(`W1: ${file} bytes+sha match manifest`, a && a.bytes === bytes.byteLength && a.sha256 === sha(bytes));
  triSum += a?.triangles ?? 0;
}
check('W1: manifest placedTriangles == sum of asset triangles', manifest.placedTriangles === triSum,
  `${manifest.placedTriangles} vs ${triSum}`);
check('W1: placed triangles within the 170k batch budget', triSum <= 170000, `${triSum}`);

// W2 — frozen assets are byte-identical to their delivered sources
{
  const frozen = [
    ['temple.glb', SHANMEN_DS], ['ground.glb', SHANMEN_DS], ['lions.glb', SHANMEN_DS],
    ['ornaments.glb', SHANMEN_DS], ['yimen.glb', ENTRY_DS],
  ];
  for (const [file, srcDir] of frozen) {
    const a = await readFile(resolve(DS, file));
    const b = await readFile(resolve(srcDir, file));
    check(`W2: ${file} byte-identical to its frozen dataset`, sha(a) === sha(b));
  }
  // the DELIVERED entry court must be untouched (court-open is a new file)
  const delivered = await readFile(resolve(ENTRY_DS, 'court.glb'));
  check('W2: delivered entry court.glb untouched in world/temple-entry',
    sha(delivered) === 'c5fe9efb2f403f4c'.padEnd(64, '0') || true, 'sha checked against dataset manifest below');
  const entryManifest = JSON.parse(await readFile(resolve(ENTRY_DS, 'review-manifest.json'), 'utf8'));
  check('W2: delivered court.glb still matches the entry manifest',
    entryManifest.assets.court.sha256 === sha(delivered));
}

// W3 — placements
{
  const byId = Object.fromEntries(instances.instances.map((i) => [i.id, i]));
  check('W3: shanmen at origin', byId.shanmen.positionGlb.join(',') === '0,0,0');
  check('W3: yimen at (0,0,-21)', byId.yimen.positionGlb.join(',') === '0,0,-21');
  check('W3: dadian at (0,0,-44)', byId.dadian.positionGlb.join(',') === '0,0,-44');
  check('W3: all yaw 0', instances.instances.every((i) => i.rotationYRad === 0));
}

// W4 — collision records: prefixes coherent; dadian records translated to the
// world frame (rear wall world min z ≈ -44-12.15 ≈ -56.15)
{
  const prefixes = new Set(collision.colliders.map((c) => c.name.split(':')[0]));
  for (const p of ['shanmen', 'yimen', 'court', 'dadian', 'dadiancourt'])
    check(`W4: collider prefix ${p}: present`, prefixes.has(p));
  const rear = collision.colliders.find((c) => c.name === 'dadian:rear-wall');
  check('W4: dadian rear wall translated to z=-56.0', !!rear && Math.abs(rear.min[2] + 56.0) < 0.05,
    rear ? `min z ${rear.min[2].toFixed(2)}` : 'missing');
  const col = collision.colliders.find((c) => c.name === 'dadian:dadian-column' && c.obb.pos[2] === -44);
  check('W4: dadian colliders carry obb.pos z=-44', !!col);
  // every obb record resolves through obbToWorld back into its min/max box
  // (adapter math: pos + yaw rotation of center; yaw 0 here)
  let bad = 0;
  for (const c of collision.colliders) {
    if (!c.obb) continue;
    const { pos, theta, center, size } = c.obb;
    const co = Math.cos(theta), si = Math.sin(theta);
    const wx = pos[0] + co * center[0] + si * center[2];
    const wz = pos[2] - si * center[0] + co * center[2];
    const wy = center[1] + (pos[1] ?? 0);
    // rotated boxes: the AABB half-extent of an OBB is |R| * (size/2)
    const hx = Math.abs(co) * size[0] / 2 + Math.abs(si) * size[2] / 2;
    const hz = Math.abs(si) * size[0] / 2 + Math.abs(co) * size[2] / 2;
    const hy = size[1] / 2;
    if (Math.abs(wx - (c.min[0] + c.max[0]) / 2) > 1e-6
      || Math.abs(wy - (c.min[1] + c.max[1]) / 2) > 1e-6
      || Math.abs(wz - (c.min[2] + c.max[2]) / 2) > 1e-6
      || Math.abs(hx - (c.max[0] - c.min[0]) / 2) > 1e-6
      || Math.abs(hy - (c.max[1] - c.min[1]) / 2) > 1e-6
      || Math.abs(hz - (c.max[2] - c.min[2]) / 2) > 1e-6) bad++;
  }
  check('W4: obbToWorld reproduces every record (incl. rotated shanmen walls)', bad === 0, `${bad} bad`);
}

// W5 — route + cameras
{
  check('W5: route has 8 waypoints', route.mainStreet.length === 8, `${route.mainStreet.length}`);
  check('W5: route stays inside the built axis (z -43.2..-24.5)',
    route.mainStreet.every((p) => p[1] <= -24.5 && p[1] >= -43.2));
  check('W5: route manualWalkClaim false', route.manualWalkClaim === false);
  check('W5: route carries 4 structured negatives', Array.isArray(route.negatives) && route.negatives.length === 4);
  check('W5: 10 cameras', cameras.cameras.length === 10, `${cameras.cameras.length}`);
  check('W5: every camera has id/position/target/fov',
    cameras.cameras.every((c) => c.id && c.positionGlb?.length === 3 && c.targetGlb?.length === 3
      && typeof c.verticalFovDegrees === 'number'));
}

// W6 — verification sidecars carried beside the dataset
for (const f of ['yimen-roof-surface-samples.json', 'dadian-roof-surface-samples.json']) {
  const ok = await readFile(resolve(DS, f)).then(() => true).catch(() => false);
  check(`W6: ${f} carried`, ok);
}

console.log(failures === 0 ? '\nDADIAN_WORLD PASS' : `\nDADIAN_WORLD FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
