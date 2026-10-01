// Play-phase 1 asset contract — parses the REAL character.glb bytes (never a
// hand-written stand-in JSON) and pins every structural fact the avatar code
// relies on, plus the recovery manifest in inputs/play-character.json.
//
// Run: node tests/play_asset_contract.test.mjs   (exit 0 = contract holds)
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const area = resolve(root, 'scene-authoring/yuyuan-area');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}

const manifest = JSON.parse(await readFile(resolve(area, 'inputs/play-character.json'), 'utf8'));
const glbPath = resolve(area, manifest.path);
const bytes = await readFile(glbPath);

// --- file identity: bytes + sha256 must match the recovery manifest
check('character.glb byte count matches inputs/play-character.json', bytes.length === manifest.bytes,
  `${bytes.length} vs ${manifest.bytes}`);
const sha = createHash('sha256').update(bytes).digest('hex');
check('character.glb sha256 matches inputs/play-character.json', sha === manifest.sha256, sha);

// --- parse the GLB JSON chunk
const jsonLen = bytes.readUInt32LE(12);
if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(16) !== 0x4e4f534a) {
  console.log('FAIL not a GLB container'); process.exit(1);
}
const g = JSON.parse(bytes.slice(20, 20 + jsonLen).toString('utf8'));

// --- animations: exactly idle/walk/eat (avatar.js binds these names)
const animNames = (g.animations || []).map(a => a.name).sort();
check('GLB carries exactly the eat/idle/walk clips',
  animNames.length === 3 && animNames.join(',') === ['eat', 'idle', 'walk'].sort().join(','), animNames.join(','));

// --- skinning: 12 joints, 5 skinned meshes (never whole-piece static batch)
const skinned = (g.nodes || []).filter(n => n.skin !== undefined && n.mesh !== undefined);
check('5 skinned mesh nodes', skinned.length === manifest.skinnedMeshes, `got ${skinned.length}`);
check('single skin with 12 joints',
  (g.skins || []).length === 1 && g.skins[0].joints.length === manifest.skinJoints,
  `joints=${(g.skins || [])[0]?.joints.length}`);

// --- no root motion: every clip's `root` translation track is constant zero
let binOff = 20 + jsonLen, binStart = -1;
while (binOff < bytes.length) {
  const len = bytes.readUInt32LE(binOff), type = bytes.readUInt32LE(binOff + 4);
  if (type === 0x004e4942) { binStart = binOff + 8; break; }
  binOff += 8 + len;
}
const rootIdx = g.nodes.findIndex(n => n.name === 'root');
check('skeleton root node named `root` exists', rootIdx >= 0);
let maxRootDisp = 0;
for (const anim of g.animations) {
  for (const ch of anim.channels) {
    if (ch.target.node !== rootIdx || ch.target.path !== 'translation') continue;
    const s = anim.samplers[ch.sampler];
    const acc = g.accessors[s.output];
    const bv = g.bufferViews[acc.bufferView];
    const start = binStart + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const vals = new Float32Array(bytes.buffer, bytes.byteOffset + start, acc.count * 3);
    for (let i = 0; i < vals.length; i += 3) {
      maxRootDisp = Math.max(maxRootDisp, Math.hypot(vals[i], vals[i + 1], vals[i + 2]));
    }
  }
}
check('animation root translation tracks never add global displacement', maxRootDisp === 0,
  `max=${maxRootDisp}`);

// --- metric facts the avatar/placement rely on: height ~0.964 m, face on +Z
// (names live on the NODES; mesh 0 itself is unnamed, so key bounds by node name)
const nodeBounds = {};
for (const n of skinned) {
  const acc = g.accessors[g.meshes[n.mesh].primitives[0].attributes.POSITION];
  nodeBounds[n.name] = { min: acc.min, max: acc.max };
}
const usedBySkinned = skinned.map(n => n.mesh);
let minY = Infinity, maxY = -Infinity;
for (const mi of usedBySkinned) {
  const acc = g.accessors[g.meshes[mi].primitives[0].attributes.POSITION];
  minY = Math.min(minY, acc.min[1]); maxY = Math.max(maxY, acc.max[1]);
}
const height = maxY - minY;
check('rest-pose model height ≈ 0.964 m (0.90–1.03 band)', height > 0.90 && height < 1.03, `${height.toFixed(4)} m`);

const nose = nodeBounds.cat_nose;
const mouth = nodeBounds.cat_mouth;
const body = nodeBounds.cat_body;
check('face meshes (nose/mouth) sit on +Z: model forward is +Z as avatar.js assumes',
  nose && mouth && nose.max[2] > 0.25 && mouth.max[2] > 0.25,
  `nose zMax=${nose?.max[2].toFixed(3)} mouth zMax=${mouth?.max[2].toFixed(3)}`);
check('body extends well behind the face plane (tail on -Z)', body && body.min[2] < -0.3,
  `body zMin=${body?.min[2].toFixed(3)}`);

// --- the GLB itself stays out of git (recovered from the manifest, gitignored)
let tracked = true;
try { execFileSync('git', ['-C', root, 'ls-files', '--error-unmatch', `scene-authoring/yuyuan-area/${manifest.path}`], { stdio: 'pipe' }); }
catch { tracked = false; }
check('character.glb is NOT tracked by git', !tracked);

console.log(failures === 0 ? 'PLAY_ASSET_CONTRACT PASS' : `PLAY_ASSET_CONTRACT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
