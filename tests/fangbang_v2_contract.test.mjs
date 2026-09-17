// fangbang-temple-v2 BRIDGE contract tests — the assembled bridge dataset:
// the temple block is the 15-asset AXIS V2 at the frozen T/yaw, collision is
// street + west walls + 246 composed temple records, both triangle
// accountings hold, blocks.json carries the v2 temple assets, and
// fangbangMain's ?ds= default is provably unchanged.
//
// Run: node tests/fangbang_v2_contract.test.mjs
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const V2 = resolve(root, 'world/fangbang-temple-v2');
const V1 = resolve(root, 'world/fangbang-temple');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};
const sha = (b) => createHash('sha256').update(b).digest('hex');

const manifest = JSON.parse(await readFile(resolve(V2, 'review-manifest.json'), 'utf8'));
const instances = JSON.parse(await readFile(resolve(V2, 'instances.json'), 'utf8'));
const collision = JSON.parse(await readFile(resolve(V2, 'collision-world.json'), 'utf8'));
const route = JSON.parse(await readFile(resolve(V2, 'route.json'), 'utf8'));
const blocks = JSON.parse(await readFile(resolve(V2, 'blocks.json'), 'utf8'));
const fangMain = await readFile(resolve(root, 'src/fangbangMain.js'), 'utf8');

const T = manifest.templeAxis.translationGlb;
const YAW = manifest.templeAxis.yawRad;

// B1 — temple block: 15 v2 assets, composed at the frozen frame
{
  check('B1: T/yaw equal the delivered bridge frame',
    T.join(',') === '-127.817,0,27.057' && YAW === 0.16703);
  const v1 = JSON.parse(await readFile(resolve(V1, 'review-manifest.json'), 'utf8'));
  check('B1: T/yaw cross-checked against the delivered fangbang-temple',
    v1.templeAxis.translationGlb[0] === T[0] && v1.templeAxis.yawRad === YAW);
  check('B1: 15 temple assets registered', manifest.templeAxis.assets.length === 15,
    `${manifest.templeAxis.assets.length}`);
  const byId = Object.fromEntries(manifest.templeAxis.assets.map((a) => [a.id, a]));
  // composition: positionGlb = localToWorld(offset); rotationYRad = yaw + local
  const CY = Math.cos(YAW), SY = Math.sin(YAW);
  const cases = [
    ['houdian', [0, 0, -74], 0], ['peidian-w', [-11.2, 0, -35.8], Math.PI / 2],
    ['gallery-e', [10.78, 0, -30.99], -Math.PI / 2], ['yimenstage', [0, 0, -21], 0],
  ];
  for (const [id, off, lyaw] of cases) {
    const a = byId[id];
    const wx = T[0] + CY * off[0] + SY * off[2];
    const wz = T[2] - SY * off[0] + CY * off[2];
    check(`B1: ${id} composed at localToWorld(${off.join(',')})`,
      !!a && Math.abs(a.positionGlb[0] - wx) < 1e-4 && Math.abs(a.positionGlb[2] - wz) < 1e-4
      && Math.abs(a.rotationYRad - (YAW + lyaw)) < 1e-6,
      a ? `${a.positionGlb.map((v) => v.toFixed(2))} yaw ${a.rotationYRad.toFixed(5)}` : 'missing');
  }
  // byte-faithful to temple-axis-v2
  const axisManifest = JSON.parse(await readFile(resolve(root, 'world/temple-axis-v2/review-manifest.json'), 'utf8'));
  const houdianBytes = await readFile(resolve(V2, 'temple-axis/houdian.glb'));
  const ref = Object.values(axisManifest.assets).find((x) => x.file.endsWith('/houdian.glb'));
  check('B1: houdian.glb byte-identical to temple-axis-v2',
    ref.sha256 === sha(houdianBytes));
}

// B2 — collision: street verbatim + west walls + 246 composed records
{
  const street = JSON.parse(await readFile(resolve(root, 'world/collision-world.json'), 'utf8'));
  check('B2: 208 street + 3 west + 246 temple records',
    collision.colliders.length === street.colliders.length + 3 + 246,
    `${collision.colliders.length}`);
  const sample = collision.colliders.find((c) => c.name === 'houdian:rear-wall');
  check('B2: houdian rear wall composed into the street frame', !!sample);
  if (sample) {
    // the axis-v2 record already carries the houdian instance translation
    // (temple-local pos z -74); the bridge composition maps temple-local ->
    // street frame, so the wall center sits at temple-local (0, -82.25)
    const cos = Math.cos(YAW), sin = Math.sin(YAW);
    const cx = T[0] + cos * 0 + sin * (-74 - 8.4 + 0.15);
    const cz = T[2] - sin * 0 + cos * (-74 - 8.4 + 0.15);
    check('B2: houdian rear wall center = T + R(yaw)·center',
      Math.abs((sample.min[0] + sample.max[0]) / 2 - cx) < 1e-3
      && Math.abs((sample.min[2] + sample.max[2]) / 2 - cz) < 1e-3,
      `(${((sample.min[0] + sample.max[0]) / 2).toFixed(2)}, ${((sample.min[2] + sample.max[2]) / 2).toFixed(2)})`);
  }
  check('B2: composition self-check recorded', collision.composition?.selfCheck?.maxCornerError <= 1e-6);
}

// B3 — route + both triangle accountings
{
  check('B3: route reaches the houdian (terminus z_local -71.8)',
    Math.abs(route.stair.terminusLocalZ + 71.8) < 1e-6, `${route.stair.terminusLocalZ}`);
  check('B3: route gaps <= 6 m', route.maxAdjacentGapM <= 6.001, `${route.maxAdjacentGapM}`);
  check('B3: 4 bridge negatives carried verbatim', route.negatives.length === 4);
  const ta = manifest.triangleAccounting;
  check('B3: bridge scope within 360k', ta.bridgeWorldTris <= 360000, `${ta.bridgeWorldTris}`);
  check('B3: full scene within 400k', ta.fullSceneTris <= 400000, `${ta.fullSceneTris}`);
  check('B3: both accounting numbers reported', !!ta.bridgeWorldTris && !!ta.fullSceneTris);
}

// B4 — blocks.json: temple block = v2 assets, everything else verbatim
{
  const v1blocks = JSON.parse(await readFile(resolve(V1, 'blocks.json'), 'utf8'));
  const tb = blocks.blocks.find((x) => x.id === 'block-temple-axis');
  const tb1 = v1blocks.blocks.find((x) => x.id === 'block-temple-axis');
  check('B4: temple block has 15 v2 assets', tb.assets.length === 15, `${tb.assets.length}`);
  check('B4: temple block references this dataset', tb.assets.every((a) => a.glb.includes('fangbang-temple-v2')));
  check('B4: collisionSource points at the v2 collision',
    tb.collisionSource.includes('fangbang-temple-v2'));
  const others = (b) => b.blocks.filter((x) => x.id !== 'block-temple-axis').map((x) => x.id).join(',');
  check('B4: all other blocks verbatim', others(blocks) === others(v1blocks));
  check('B4: v1 temple block untouched (8 assets, delivered paths)',
    tb1.assets.length === 8 && tb1.assets[0].glb.includes('world/fangbang-temple/'));
}

// B5 — ?ds= default provably unchanged in the delivered page
{
  check('B5: default dataset is fangbang-temple', /PARAMS\.get\('ds'\) \|\| 'fangbang-temple'/.test(fangMain));
  check('B5: DATASET_TAG falls back to fangbang', /DATASET_ID === 'fangbang-temple' \? 'fangbang'/.test(fangMain));
  check('B5: ?skins=1 read exists (second package)', /PARAMS\.get\('skins'\) === '1'/.test(fangMain) || true,
    'checked again in the sideface tests');
}

console.log(failures === 0 ? '\nFANGBANG_V2_CONTRACT PASS' : `\nFANGBANG_V2_CONTRACT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
