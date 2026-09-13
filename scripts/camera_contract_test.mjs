// R3 camera contract: after controls.update(), every one of the 11 delivered
// cameras must land exactly on its cameras.json position/target, including
// eye-level (polar = 90 deg) and upward-looking (polar > 90 deg) views.
// Negative controls re-enable the shipped bug (maxPolarAngle = PI*.495) and
// must be CAUGHT by this same matcher.
//
// Run: node scripts/camera_contract_test.mjs  (exit 0 = contract holds)
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, '../artifacts/camera-contract');
const {cameras} = JSON.parse(await readFile(resolve(root, 'world/cameras.json'), 'utf8'));
if (cameras.length !== 11) throw Error(`expected 11 cameras, got ${cameras.length}`);

const TOL = 1e-6;
function makeRig(maxPolarAngle) {
  const camera = new T.PerspectiveCamera(45, 16 / 9, .1, 600);
  const controls = new OrbitControls(camera);
  controls.enableDamping = false;
  controls.minDistance = .5;
  controls.maxDistance = 220;
  controls.maxPolarAngle = maxPolarAngle;
  return {camera, controls};
}
function runView(rig, v) {
  rig.camera.position.set(...v.positionGlb);
  rig.camera.aspect = 16 / 9;
  rig.camera.fov = 2 * Math.atan(v.sensorWidthMm / 2 / v.lensMm / rig.camera.aspect) * 180 / Math.PI;
  rig.camera.updateProjectionMatrix();
  rig.controls.target.set(...v.targetGlb);
  rig.controls.update();
  const p = rig.camera.position.toArray(), t = rig.controls.target.toArray();
  const err = Math.max(...p.map((c, i) => Math.abs(c - v.positionGlb[i])),
                       ...t.map((c, i) => Math.abs(c - v.targetGlb[i])));
  return {position: p.map(c => +c.toFixed(9)), target: t.map(c => +c.toFixed(9)), maxError: err};
}

// 1) contract suite with the fixed limit (Math.PI = level and upward allowed)
const fixed = makeRig(Math.PI);
const rows = cameras.map(v => {
  const r = runView(fixed, v);
  return {id: v.id, positionGlb: v.positionGlb, targetGlb: v.targetGlb,
          observedPosition: r.position, observedTarget: r.target, maxError: r.maxError,
          pass: r.maxError <= TOL};
});
const contractPass = rows.every(r => r.pass);

// 2) negative control A: the shipped bug must lift the eye-level camera (eye-west)
const oldRig = makeRig(Math.PI * .495);
const eyeWest = cameras.find(v => v.id === 'eye-west');
const negLevel = runView(oldRig, eyeWest);
const negLevelCaught = negLevel.maxError > 1e-3;

// 3) negative control B: an upward-looking view must break under the old limit
const upView = {positionGlb: [0, 1.0, 6], targetGlb: [0, 6.0, 0], lensMm: 32, sensorWidthMm: 36};
const oldRig2 = makeRig(Math.PI * .495);
const negUp = runView(oldRig2, upView);
const fixedRig2 = makeRig(Math.PI);
const negUpFixed = runView(fixedRig2, upView);
const negUpCaught = negUp.maxError > 1e-3 && negUpFixed.maxError <= TOL;

const report = {
  what: 'R3 OrbitControls camera contract after controls.update()',
  fixedMaxPolarAngle: Math.PI,
  oldBuggyMaxPolarAngle: Math.PI * .495,
  tolerance: TOL,
  cameras: rows,
  contractPass,
  negativeControls: {
    eyeLevelUnderOldLimit: {view: 'eye-west', observedPosition: negLevel.position, maxError: negLevel.maxError, caught: negLevelCaught},
    upwardViewUnderOldLimit: {view: 'synthetic upward (pos y=1 -> target y=6)', observedPosition: negUp.position, maxError: negUp.maxError, caught: negUpCaught, passesWithFix: negUpFixed.maxError <= TOL},
  },
  negativePass: negLevelCaught && negUpCaught,
  verdict: contractPass && negLevelCaught && negUpCaught ? 'PASS' : 'FAIL',
};
await mkdir(outDir, {recursive: true});
await writeFile(resolve(outDir, 'camera-contract.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log('CAMERA_CONTRACT', JSON.stringify({verdict: report.verdict,
  failingCameras: rows.filter(r => !r.pass).map(r => r.id),
  negLevelCaught, negUpCaught}));
if (report.verdict !== 'PASS') process.exit(1);
