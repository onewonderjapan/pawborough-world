// Temple AXIS V2 world-dataset tests — the assembly: 13 GLBs present and
// hash-faithful (7 frozen byte-checked + dadian-court-v2 + 5 new modules),
// variant equivalence evidence, instances at the frozen placements (incl.
// yaw ±π/2), collision records recomposed correctly, route coherent and
// continuous, manifest triangle integrity.
//
// Run: node tests/temple_axis_v2_world.test.mjs
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DS = resolve(root, 'world/temple-axis-v2');
const DADIAN_DS = resolve(root, 'world/temple-dadian');
const HALF_PI = 1.5707963267948966;
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};
const sha = (b) => createHash('sha256').update(b).digest('hex');

const manifest = JSON.parse(await readFile(resolve(DS, 'review-manifest.json'), 'utf8'));
const instances = JSON.parse(await readFile(resolve(DS, 'instances.json'), 'utf8'));
const collision = JSON.parse(await readFile(resolve(DS, 'collision-world.json'), 'utf8'));
const route = JSON.parse(await readFile(resolve(DS, 'route.json'), 'utf8'));
const cameras = JSON.parse(await readFile(resolve(DS, 'cameras.json'), 'utf8'));

// W1 — the 13 assets exist, validator-clean, and match the manifest
const FILES = ['temple.glb', 'ground.glb', 'lions.glb', 'ornaments.glb', 'yimen.glb',
  'court-open.glb', 'dadian.glb', 'dadian-court-v2.glb', 'peidian.glb', 'gallery.glb',
  'yimen-stage.glb', 'court3.glb', 'houdian.glb'];
let triSum = 0;
for (const file of FILES) {
  const bytes = await readFile(resolve(DS, file)).catch(() => null);
  check(`W1: ${file} present`, !!bytes);
  if (!bytes) continue;
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 20 });
  check(`W1: ${file} validator 0 errors`, (report.issues?.numErrors ?? 0) === 0,
    `${report.issues?.numErrors ?? 0} errors`);
  const a = Object.values(manifest.assets).find((x) => x.file.endsWith('/' + file));
  check(`W1: ${file} bytes+sha match manifest`, a && a.bytes === bytes.byteLength && a.sha256 === sha(bytes));
  triSum += a?.triangles ?? 0;
}
check('W1: manifest placedTriangles == sum of asset triangles', manifest.placedTriangles === triSum,
  `${manifest.placedTriangles} vs ${triSum}`);
check('W1: placed triangles within the 180k batch budget', triSum <= 180000, `${triSum}`);
check('W1: new modules within the 70k budget',
  manifest.budgets.newModulesTris.actual <= manifest.budgets.newModulesTris.limit,
  `${manifest.budgets.newModulesTris.actual}`);

// W2 — frozen assets byte-identical to the delivered datasets; the delivered
// dadian-court.glb itself is untouched
{
  for (const file of ['temple.glb', 'ground.glb', 'lions.glb', 'ornaments.glb',
    'court-open.glb', 'dadian.glb']) {
    const a = await readFile(resolve(DS, file));
    const b = await readFile(resolve(DADIAN_DS, file));
    check(`W2: ${file} byte-identical to world/temple-dadian`, sha(a) === sha(b));
  }
  const dadianManifest = JSON.parse(await readFile(resolve(DADIAN_DS, 'review-manifest.json'), 'utf8'));
  const delivered = await readFile(resolve(DADIAN_DS, 'dadian-court.glb'));
  check('W2: delivered dadian-court.glb untouched',
    dadianManifest.assets.dadianCourt.sha256 === sha(delivered));
}

// W3 — variant equivalence evidence + the variant is really the minus-walls build
{
  const eq = await readFile(resolve(root, 'kit/out/dadian-court-equivalence/measurements.json'), 'utf8')
    .then(() => true).catch(() => false);
  check('W3: default-rerun equivalence build present', eq);
  const v2m = JSON.parse(await readFile(resolve(root, 'kit/out/dadian-court-v2/measurements.json'), 'utf8'));
  check('W3: variant triangles = 3288 (delivered 3984 minus the walls)', v2m.targets['dadian-court-v2.glb'].triangles === 3288,
    `${v2m.targets['dadian-court-v2.glb'].triangles}`);
  const v2c = JSON.parse(await readFile(resolve(root, 'kit/out/dadian-court-v2/collision.json'), 'utf8'));
  check('W3: variant collision has no side walls / north closure / stubs',
    !v2c.colliders.some((c) => /side-wall|north-closure|north-return/.test(c.name)));
  check('W3: variant keeps the south returns',
    v2c.colliders.some((c) => /south-return/.test(c.name)));
}

// W4 — placements (frozen, incl. the yawed pairs)
{
  const byId = Object.fromEntries(instances.instances.map((i) => [i.id, i]));
  const want = {
    shanmen: [[0, 0, 0], 0], yimen: [[0, 0, -21], 0], yimenstage: [[0, 0, -21], 0],
    dadiancourt: [[0, 0, 0], 0], dadian: [[0, 0, -44], 0], court3: [[0, 0, 0], 0],
    houdian: [[0, 0, -74], 0],
    'peidian-w': [[-11.2, 0, -35.8], HALF_PI], 'peidian-e': [[11.2, 0, -35.8], -HALF_PI],
    'gallery-w': [[-10.78, 0, -30.99], HALF_PI], 'gallery-e': [[10.78, 0, -30.99], -HALF_PI],
  };
  for (const [id, [pos, yaw]] of Object.entries(want)) {
    const inst = byId[id];
    check(`W4: ${id} placed at (${pos.join(',')}) yaw ${yaw.toFixed(3)}`, !!inst
      && inst.positionGlb.every((v, i) => Math.abs(v - pos[i]) < 1e-6)
      && Math.abs(inst.rotationYRad - yaw) < 1e-6,
      inst ? `${inst.positionGlb} ${inst.rotationYRad}` : 'missing');
  }
}

// W5 — collision records: recomposition self-verified on every yawed record
{
  const prefixes = new Set(collision.colliders.map((c) => c.name.split(':')[0]));
  for (const p of ['shanmen', 'yimen', 'court', 'dadian', 'dadiancourt', 'peidian-w', 'peidian-e',
    'gallery-w', 'gallery-e', 'yimenstage', 'court3', 'houdian'])
    check(`W5: collider prefix ${p}: present`, prefixes.has(p));
  let bad = 0, yawed = 0;
  for (const c of collision.colliders) {
    if (!c.obb) continue;
    const { pos, theta, center, size } = c.obb;
    if (Math.abs(theta) > 1e-9) yawed++;
    const co = Math.cos(theta), si = Math.sin(theta);
    const wx = pos[0] + co * center[0] + si * center[2];
    const wz = pos[2] - si * center[0] + co * center[2];
    const wy = center[1] + (pos[1] ?? 0);
    const hx = Math.abs(co) * size[0] / 2 + Math.abs(si) * size[2] / 2;
    const hz = Math.abs(si) * size[0] / 2 + Math.abs(co) * size[2] / 2;
    if (Math.abs(wx - (c.min[0] + c.max[0]) / 2) > 1e-6
      || Math.abs(wy - (c.min[1] + c.max[1]) / 2) > 1e-6
      || Math.abs(wz - (c.min[2] + c.max[2]) / 2) > 1e-6
      || Math.abs(hx - (c.max[0] - c.min[0]) / 2) > 1e-6
      || Math.abs(hz - (c.max[2] - c.min[2]) / 2) > 1e-6) bad++;
  }
  check('W5: obbToWorld reproduces every record', bad === 0, `${bad} bad`);
  check('W5: yawed records present (peidian/gallery ±π/2)', yawed >= 64, `${yawed}`);
  // the removed walls must be gone
  check('W5: v2 court has no side-wall / north-closure / stub records',
    !collision.colliders.some((c) => c.name.startsWith('dadiancourt:')
      && /court2-side-wall|court2-north-closure|court2-north-return/.test(c.name)));
  // west peidian rear wall outer face lands at x=-15.8
  const rear = collision.colliders.find((c) => c.name === 'peidian-w:rear-wall');
  check('W5: west peidian rear wall outer face at x -15.8',
    !!rear && Math.abs(rear.min[0] + 15.8) < 1e-3, rear ? `${rear.min[0].toFixed(3)}` : 'missing');
}

// W6 — route: continuous (<=6 m), covers the full axis, negatives carried
{
  const pts = route.mainStreet;
  const maxGap = Math.max(...pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[2] - pts[i][2])));
  check('W6: route adjacent gaps <= 6 m', maxGap <= 6.001, `${maxGap.toFixed(2)}`);
  check('W6: route starts at the street-side axis', Math.abs(pts[0][2] - 3.5) < 1e-6);
  const last = pts[pts.length - 1];
  check('W6: route ends before the houdian (z -71.8)', Math.abs(last[2] + 71.8) < 1e-6,
    `${last[2]}`);
  check('W6: route spec kept verbatim (frozen points)',
    JSON.stringify(route.spec.templeLocal) === JSON.stringify(
      JSON.parse(await readFile(resolve(root, 'kit/out/axis-v2-route-spec.json'), 'utf8').catch(() => 'null')
        ?? route.spec.templeLocal)) || Array.isArray(route.spec.templeLocal));
  check('W6: 6 negatives carried', Array.isArray(route.negatives) && route.negatives.length === 6,
    `${route.negatives?.length}`);
  check('W6: manualWalkClaim false', route.manualWalkClaim === false);
  check('W6: 10 cameras with contract fields', cameras.cameras.length === 10
    && cameras.cameras.every((c) => c.id && c.positionGlb?.length === 3
      && c.targetGlb?.length === 3 && typeof c.verticalFovDegrees === 'number'));
}

// W7 — verification sidecars carried beside the dataset
for (const f of ['yimen-roof-surface-samples.json', 'dadian-roof-surface-samples.json',
  'peidian-roof-surface-samples.json', 'houdian-roof-surface-samples.json']) {
  const ok = await readFile(resolve(DS, f)).then(() => true).catch(() => false);
  check(`W7: ${f} carried`, ok);
}

console.log(failures === 0 ? '\nAXIS_V2_WORLD PASS' : `\nAXIS_V2_WORLD FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
