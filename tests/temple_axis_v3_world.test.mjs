// Temple AXIS V3 world-dataset tests — the corridor-batch assembly: 14 GLBs
// present and hash-faithful (10 frozen from v2 + 4 v3 variants/new), variant
// equivalence evidence, instances (frozen + 4 trees), collision recomposition
// (lion guards in, plinth records out, burner in), route with the burner
// detour and 7 negatives, manifest triangle integrity.
//
// Run: node tests/temple_axis_v3_world.test.mjs
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DS = resolve(root, 'world/temple-axis-v3');
const V2 = resolve(root, 'world/temple-axis-v2');
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
const v2Manifest = JSON.parse(await readFile(resolve(V2, 'review-manifest.json'), 'utf8'));

// W1 — the 14 assets exist, validator-clean, and match the manifest
const FILES = ['temple.glb', 'ground.glb', 'lions-v2.glb', 'ornaments-v2.glb', 'yimen.glb',
  'entry-court-v3.glb', 'dadian.glb', 'dadian-court-v2.glb', 'peidian.glb', 'gallery.glb',
  'yimen-stage.glb', 'court3.glb', 'houdian.glb', 'tree-camphor.glb'];
for (const file of FILES) {
  const bytes = await readFile(resolve(DS, file)).catch(() => null);
  check(`W1: ${file} present`, !!bytes);
  if (!bytes) continue;
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 20 });
  check(`W1: ${file} validator 0 errors`, (report.issues?.numErrors ?? 0) === 0,
    `${report.issues?.numErrors ?? 0} errors`);
  const a = Object.values(manifest.assets).find((x) => x.file.endsWith('/' + file));
  check(`W1: ${file} bytes+sha match manifest`, a && a.bytes === bytes.byteLength && a.sha256 === sha(bytes));
}
// triangle integrity exactly as the page computes it (peidian/gallery x2, tree x4)
{
  const t = (id) => manifest.assets[id]?.triangles ?? 0;
  const expected = Object.values(manifest.assets).reduce((s, a) => s + a.triangles, 0)
    + t('peidian') + t('gallery') + t('tree') * 3;
  check('W1: placedTriangles == page expectation (peidian/gallery/tree instancing)',
    manifest.placedTriangles === expected, `${manifest.placedTriangles} vs ${expected}`);
  check('W1: placed triangles within the 200k batch budget', manifest.placedTriangles <= 200000,
    `${manifest.placedTriangles}`);
  check('W1: new variant tris within the 16k budget',
    manifest.budgets.newModulesTris.actual <= manifest.budgets.newModulesTris.limit,
    `${manifest.budgets.newModulesTris.actual}`);
  check('W1: zero new images budget recorded', manifest.budgets.newImages.actual === 0);
}

// W2 — frozen assets byte-identical to temple-axis-v2
for (const id of ['temple', 'ground', 'yimen', 'dadian', 'dadianCourtV2', 'peidian',
  'gallery', 'yimenStage', 'court3', 'houdian']) {
  const a = await readFile(resolve(DS, v2Manifest.assets[id].file.split('/').pop()));
  check(`W2: frozen ${id} byte-identical to temple-axis-v2`, sha(a) === v2Manifest.assets[id].sha256);
}
{
  // the SWAPPED v1 slots are gone from the dataset files (replaced by variants)
  for (const file of ['lions.glb', 'ornaments.glb', 'court-open.glb']) {
    const gone = await readFile(resolve(DS, file)).then(() => false).catch(() => true);
    check(`W2: superseded ${file} not shipped in v3`, gone);
  }
}

// W3 — variant equivalence evidence on disk
for (const p of ['kit/out/shanmen-v1-equivalence-proof/lions-equivalence.json',
  'kit/out/shanmen-v1-equivalence-proof/ornaments-equivalence.json',
  'kit/out/court-open-equivalence/equivalence-proof.json']) {
  const ok = await readFile(resolve(root, p)).then((b) => JSON.parse(b).equivalent === true)
    .catch(() => false);
  check(`W3: equivalence proof ${p.split('/').pop()}`, ok);
}

// W4 — placements: frozen ones carried + 4 trees at the manifest positions
{
  const byId = Object.fromEntries(instances.instances.map((i) => [i.id, i]));
  for (const id of ['shanmen', 'entrycourt', 'yimen', 'yimenstage', 'dadiancourt',
    'peidian-w', 'peidian-e', 'gallery-w', 'gallery-e', 'dadian', 'court3', 'houdian']) {
    const inst = byId[id], v2 = v2Manifest.assets[id] ? null : null;
    check(`W4: ${id} instance carried`, !!inst);
  }
  const at = manifest.assets.tree.instancesAt ?? {};
  for (const [id, pos] of Object.entries(at)) {
    const inst = byId[id];
    check(`W4: ${id} at manifest position`, !!inst
      && inst.positionGlb.every((v, i) => Math.abs(v - pos[i]) < 1e-9),
      inst ? `${inst.positionGlb}` : 'missing');
  }
}

// W5 — collision recomposition
{
  const names = collision.colliders.map((c) => c.name);
  check('W5: v1 lion plinth records retired', !names.includes('shanmen:lion-plinth'));
  const guard = collision.colliders.find((c) => c.name === 'shanmen:lion2-w-guard');
  check('W5: lion v2 guard boxes present per spec size', !!guard
    && guard.obb.size.every((v, i) => Math.abs(v - [0.62, 1.35, 0.75][i]) < 1e-6));
  const burner = collision.colliders.find((c) => c.name === 'court:burner-vessel-block');
  check('W5: burner vessel box at (0,0.65,-12)', !!burner
    && burner.obb.center.every((v, i) => Math.abs(v - [0, 0.65, -12][i]) < 1e-6
      && Math.abs(v - [0, 0.65, -12][i]) < 1e-6)
    && burner.obb.size.every((v, i) => Math.abs(v - [1.1, 1.3, 1.1][i]) < 1e-6));
  for (const id of Object.keys(manifest.assets.tree.instancesAt ?? {})) {
    check(`W5: tree trunk collider ${id}:tree-trunk-block present`,
      names.includes(`${id}:tree-trunk-block`));
  }
  // obbToWorld reproduces every record (same verifier as the v2 test)
  let bad = 0;
  for (const c of collision.colliders) {
    if (!c.obb) continue;
    const { pos, theta, center, size } = c.obb;
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
  check('W5: obbToWorld reproduces every record', bad === 0, `${bad} bad of ${collision.colliders.length}`);
}

// W6 — route: burner detour in spec AND polyline, 7 negatives, 10 cameras
{
  const specPts = route.spec.templeLocal;
  const hasDetour = specPts.some((p, i) => i > 0 && p[0] === -2 && p[1] === -10.5)
    && specPts.some((p) => p[0] === -2 && p[1] === -13.5);
  check('W6: burner detour points in route.spec', hasDetour);
  const pts = route.mainStreet;
  const maxGap = Math.max(...pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[2] - pts[i][2])));
  check('W6: route adjacent gaps <= 6 m', maxGap <= 6.001, `${maxGap.toFixed(2)}`);
  // no straight x=0 leg crosses the burner blocked band (vessel box
  // z -12.55..-11.45 + capsule radius 0.35 -> z in [-12.9, -11.1])
  check('W6: route never walks the axis through the burner (no x=0 leg in z -12.9..-11.1)',
    !pts.some((p, i) => {
      if (i === 0) return false;
      const a = pts[i - 1];
      return a[0] === 0 && p[0] === 0
        && ((a[2] <= -11.1 && p[2] >= -12.9) || (p[2] <= -11.1 && a[2] >= -12.9));
    }));
  check('W6: 7 negatives carried (6 frozen + burner)', route.negatives.length === 7,
    `${route.negatives.length}`);
  check('W6: burner negative present', route.negatives.some((n) => n.spawn[2] === -9.5));
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

console.log(failures === 0 ? '\nAXIS_V3_WORLD PASS' : `\nAXIS_V3_WORLD FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
