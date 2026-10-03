// tests/play_subject_light.test.mjs
// U04: Subject light lifecycle, caching, walk-mode gating, and preset fallback test.
//
// Verification points:
//   - Exactly 2 unshadowed short-distance lights (front warm + rim cool)
//   - Correct soft readable parameters: front 1.4 @ 2.8m, rim 0.8 @ 2.5m
//   - Walk gating: orbit mode immediately disables lights, walk mode enables
//   - Actor caching: 0 per-frame full scene traversal, lookup count stays 1 during steady walk
//   - Low-frequency throttled lookup (<= 2/s) when actor is absent
//   - Actor unmount / re-entry / fallback clean transitions

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from '../scene-authoring/yuyuan-area/node_modules/three/build/three.module.js';
import { validatePresets } from '../scene-authoring/yuyuan-area/web/lighting.js';
import { createSubjectLight, SUBJECT_LIGHT_DEFAULTS } from '../scene-authoring/yuyuan-area/web/play/subject-light.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' -- ' + detail : ''}`);
  if (!cond) failures++;
}

// 1. Presets.json validation & soft-light parameters
const presetsPath = path.join(root, 'scene-authoring/yuyuan-area/lighting/presets.json');
const presets = JSON.parse(fs.readFileSync(presetsPath, 'utf8'));
const valErrors = validatePresets(presets);
check('presets.json schema valid', valErrors.length === 0, valErrors.join('; '));
check('presets.json <= 16 KB', fs.statSync(presetsPath).size <= 16384, `${fs.statSync(presetsPath).size} bytes`);

const sl = presets.subjectLight;
check('subjectLight front intensity 1.4', Math.abs(sl.front.intensity - 1.4) < 1e-4, sl.front.intensity);
check('subjectLight front distance 2.8', Math.abs(sl.front.distance - 2.8) < 1e-4, sl.front.distance);
check('subjectLight front color #ffe4c4', sl.front.color.toLowerCase() === '#ffe4c4', sl.front.color);
check('subjectLight front localOffset [.45, 1.05, .95]',
  Math.abs(sl.front.localOffset[0] - 0.45) < 1e-4 &&
  Math.abs(sl.front.localOffset[1] - 1.05) < 1e-4 &&
  Math.abs(sl.front.localOffset[2] - 0.95) < 1e-4,
  JSON.stringify(sl.front.localOffset)
);

check('subjectLight rim intensity 0.8', Math.abs(sl.rim.intensity - 0.8) < 1e-4, sl.rim.intensity);
check('subjectLight rim distance 2.5', Math.abs(sl.rim.distance - 2.5) < 1e-4, sl.rim.distance);
check('subjectLight rim color #d1dbe6', sl.rim.color.toLowerCase() === '#d1dbe6', sl.rim.color);
check('subjectLight rim localOffset [-.75, .85, -.85]',
  Math.abs(sl.rim.localOffset[0] - (-0.75)) < 1e-4 &&
  Math.abs(sl.rim.localOffset[1] - 0.85) < 1e-4 &&
  Math.abs(sl.rim.localOffset[2] - (-0.85)) < 1e-4,
  JSON.stringify(sl.rim.localOffset)
);

// 2. Lifecycle, walk gating & actor caching
const scene = new THREE.Scene();
let mode = 'orbit'; // starts in orbit mode
const subject = createSubjectLight({
  scene,
  config: presets.subjectLight,
  isActive: () => mode === 'walk',
});

check('two lights created', subject.lights.length === 2);
const [front, rim] = subject.lights;
check('front light castShadow false', front.castShadow === false);
check('rim light castShadow false', rim.castShadow === false);

// Mount actor
const cat = new THREE.Group();
cat.name = 'play-gray-cat';
cat.position.set(12, 1, -8);
scene.add(cat);

subject.setPreset('night');

// In orbit mode: must be DISABLED even with night preset and active cat
subject.tick(1000);
check('orbit mode: lights disabled', front.visible === false && rim.visible === false);
check('orbit mode: not active', subject.state().active === false);

// Switch to walk mode: must ACTIVATE
mode = 'walk';
subject.tick(1016);
check('walk mode: lights activated', front.visible === true && rim.visible === true);
check('walk mode: state active', subject.state().active === true);
check('walk mode: initial lookup count is 1', subject.getLookupCount() === 1);

// Run 100 ticks in walk mode: lookupCount MUST NOT INCREASE (cached!)
for (let i = 0; i < 100; i++) {
  subject.tick(1016 + i * 16);
}
check('cached actor: 100 ticks performed with 0 additional lookups', subject.getLookupCount() === 1, `count=${subject.getLookupCount()}`);
check('front light following cat', front.position.distanceTo(cat.localToWorld(new THREE.Vector3(0.45, 1.05, 0.95))) < 1e-3);

// Exit to orbit mode: must turn off immediately
mode = 'orbit';
subject.tick(3000);
check('exit to orbit: lights turn off immediately', front.visible === false && rim.visible === false);

// Re-enter walk mode: turns back on without redundant tree search
mode = 'walk';
subject.tick(3016);
check('re-enter walk: lights turn back on', front.visible === true && rim.visible === true);
check('re-enter walk: still uses cached actor', subject.getLookupCount() === 1);

// Actor unmounted: lights turn off, cache invalidated
scene.remove(cat);
subject.tick(3032);
check('actor unmounted: lights turn off', front.visible === false && rim.visible === false);
check('actor unmounted: cached actor cleared', subject.getCachedActor() === null);

// Throttled lookups when actor absent (500ms interval)
const baselineLookup = subject.getLookupCount();
// 10 ticks in quick succession (10ms apart): lookup count should only increment once
for (let i = 0; i < 10; i++) {
  subject.tick(3040 + i * 10);
}
check('absent actor: rapid ticks throttled (<= 2/s)', subject.getLookupCount() <= baselineLookup + 1, `lookups=${subject.getLookupCount() - baselineLookup}`);

// Re-entry: cat added back after 600ms
scene.add(cat);
subject.tick(4000);
check('re-entry: actor rediscovered after interval', front.visible === true && rim.visible === true);
check('re-entry: cached actor restored', subject.getCachedActor() === cat);

// Fallback behavior: preset=null turns off lights
subject.setPreset(null);
subject.tick(4016);
check('fallback (preset null): lights turned off', front.visible === false && rim.visible === false);
check('fallback: weight is 0', subject.state().weight === 0);

// Dispose: unmounts from scene and clears references
subject.dispose();
check('dispose: lights removed from scene', !scene.children.includes(front) && !scene.children.includes(rim));
check('dispose: cached actor cleared', subject.getCachedActor() === null);

console.log(`\nplay_subject_light tests: ${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
