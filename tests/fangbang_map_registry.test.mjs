// fangbang-temple MAP REGISTRY test — the registration file against the
// frozen map and the DESIGN_SPEC numbers:
//   - mapSourceSha256 equals the sha256 of the actual (read-only) map file
//   - the registered foot lies ON the registered road segment (<= 1e-3)
//   - the shanmen threshold equals foot + 12.6 * northNormal (<= 1e-3)
//   - yaw equals atan2(southNormal.x, southNormal.z) (<= 1e-4)
//   - the temple threshold in the assembled instances/route equals the
//     registry translation (dataset and registry never disagree)
//
// Run: node tests/fangbang_map_registry.test.mjs   (exit 0 = contract holds)
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TASK = resolve(root, '..');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

const registry = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple/map-registry.json'), 'utf8'));
const DS = JSON.parse(await readFile(resolve(TASK, 'DESIGN_SPEC.json'), 'utf8'));

// map source sha (fallback #1 would record both hashes; a match means clean)
const mapBytes = await readFile(registry.mapSource.path);
const mapSha = createHash('sha256').update(mapBytes).digest('hex');
check('mapSourceSha256 matches the actual map file', mapSha === registry.mapSource.sha256, mapSha.slice(0, 12) + '…');
check('map sha also equals DESIGN_SPEC', mapSha === DS.mapRegistration.mapSourceSha256);

const foot = registry.foot.onCenterlineGlb;          // [x, 0, z]
const seg = registry.foot.segment;                   // [[x,z],[x,z]]
const north = registry.foot.northNormalUnit;
const south = [-north[0], -north[1]];

// foot on the registered segment
{
  const [a, b] = seg;
  const vx = b[0] - a[0], vz = b[1] - a[1];
  const L2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((foot[0] - a[0]) * vx + (foot[2] - a[1]) * vz) / L2));
  const d = Math.hypot(foot[0] - (a[0] + t * vx), foot[2] - (a[1] + t * vz));
  check('foot lies on the registered footSegment', d <= 1e-3, `d=${d.toFixed(6)}m`);
}

// threshold = foot + 12.6 * northNormal
{
  const T = registry.templePlacement.translationGlb;
  const expect = [foot[0] + 12.6 * north[0], foot[2] + 12.6 * north[1]];
  const d = Math.hypot(T[0] - expect[0], T[2] - expect[1]);
  check('threshold = foot + 12.6 * northNormal', d <= 1e-3, `d=${d.toFixed(6)}m`);
}

// yaw = atan2(south.x, south.z)
{
  const yaw = Math.atan2(south[0], south[1]);
  check('yaw = atan2(southNormal)', Math.abs(yaw - registry.templePlacement.yawRad) <= 1e-4,
    `atan2=${yaw.toFixed(6)} vs ${registry.templePlacement.yawRad}`);
}

// registry == dataset (route threshold point and temple assets block)
{
  const route = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple/route.json'), 'utf8'));
  const blocks = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple/blocks.json'), 'utf8'));
  const T = registry.templePlacement.translationGlb;
  const threshold = route.entries.shanmenThreshold;
  check('dataset route threshold == registry translation',
    Math.hypot(threshold[0] - T[0], threshold[2] - T[2]) <= 1e-3,
    `route ${threshold} vs registry ${T}`);
  const tb = blocks.blocks.find((b) => b.id === registry.templePlacement.groupId);
  const shanmen = tb.assets.find((a) => a.id === 'shanmen');
  check('temple assets block anchors shanmen at the registry translation',
    Math.hypot(shanmen.positionGlb[0] - T[0], shanmen.positionGlb[2] - T[2]) <= 1e-3);
  check('registry ownerAdopted=false and registeredBy set',
    registry.ownerAdopted === false && /fangbang-temple-bridge-night-20260916/.test(registry.registeredBy));
}

console.log(failures === 0 ? 'FANGBANG_MAP_REGISTRY PASS' : `FANGBANG_MAP_REGISTRY FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
