// Play-phase 1 entry contract: the installed profile matches GOAL.md, the
// DOM-free play core reports the exact read-only status fields the primary
// reviewer drives in a real browser, and a missing/broken asset produces a
// Chinese recoverable failure WITHOUT ever marking the core ready.
//
// Run: node tests/play_entry.test.mjs   (exit 0 = contract holds)
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAY_PROFILE, createPlayCore, assetFailureMessage } from '../scene-authoring/yuyuan-area/web/play/install.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}

// --- profile: the GOAL.md play numbers, not the viewer defaults
check('play capsule is r=0.28 / halfHeight=0.20 / eyeHeight=0.80',
  PLAY_PROFILE.capsule.radius === 0.28 && PLAY_PROFILE.capsule.halfHeight === 0.2
  && PLAY_PROFILE.capsule.eyeHeight === 0.8,
  JSON.stringify(PLAY_PROFILE.capsule));
check('play walk speed is 2.6 m/s with Shift run 4.2 (小吃工单)',
  PLAY_PROFILE.speed === 2.6 && PLAY_PROFILE.walkSpeed === 2.6 && PLAY_PROFILE.runSpeed === 4.2);

// --- real config: the entry manifest matches the profile it installs
{
  const manifest = JSON.parse(await readFile(resolve(root, 'scene-authoring/yuyuan-area/inputs/play-character.json'), 'utf8'));
  const core = createPlayCore({ manifest });
  check('core adopts actorId + sha256 from the real manifest',
    core.state.actorId === 'gray-cat'
    && core.state.assetSha256 === '5f60f225f8c46515119007023268c95a0cb904363c830b580cce70c0ad613981');

  const st = core.status({ walkMode: 'orbit', controller: null });
  const want = ['ready', 'actorId', 'assetSha256', 'mode', 'paused', 'feet', 'yaw', 'animation', 'cameraMode', 'assetError'];
  check('__play.status exposes every reviewer field', want.every(k => k in st), Object.keys(st).join(','));
  check('before the asset loads: not ready, no error, orbit camera',
    st.ready === false && st.assetError === null && st.mode === 'orbit' && st.cameraMode === 'orbit');

  // a fake avatar with the PlayAvatar surface is enough to drive the core
  const updates = [];
  const fakeAvatar = { root: {}, update: (u) => updates.push(u) };
  core.attachAvatar(fakeAvatar);
  check('attachAvatar flips ready', core.status({ walkMode: 'orbit' }).ready === true);

  core.onFrame({ feet: [1, 0, 2], yaw: 0.3, moving: true, actualSpeed: 0.7, facingYaw: -1.2, paused: false, dt: 1 / 60 });
  core.onFrame({ feet: [1, 0, 2], yaw: 0.3, moving: false, actualSpeed: 0.02, facingYaw: null, paused: false, dt: 1 / 60 });
  check('onFrame forwards ACTUAL speed and facing to the avatar (R0-4)',
    updates.length === 2 && updates[0].moving === true && updates[0].speed === 0.7
    && updates[0].facingYaw === -1.2
    && updates[1].moving === false && updates[1].speed === null && updates[1].facingYaw === null);
  check('animation state follows the moving flag', core.state.animation === 'idle');
  core.onFrame({ feet: [1, 0, 2], yaw: 0.3, moving: true, paused: false, dt: 1 / 60 }); // legacy caller without telemetry
  check('onFrame falls back to the play speed when no telemetry is given',
    updates[2].speed === 2.6 && core.state.animation === 'walk');

  core.session.begin({ teleport() {}, resume() {} }, { spawnFeet: [1, 0, 2] });
  const stPlaying = core.status({ walkMode: 'walk', controller: { feetPosition: () => [1, 0.02, 2], yaw: 0.3 } });
  check('playing status: mode=play, third-person camera, feet+yaw forwarded',
    stPlaying.mode === 'play' && stPlaying.cameraMode === 'third-person'
    && JSON.stringify(stPlaying.feet) === JSON.stringify([1, 0.02, 2]) && stPlaying.yaw === 0.3);

  core.session.pause({ pause() {} }, 'user');
  check('paused status propagates', core.status({ walkMode: 'walk' }).paused === true);
}

// --- load-failure state: Chinese recoverable message, never ready, no error → play
{
  const core = createPlayCore({});
  const msg = core.failAsset('inputs/play-character.json: 404');
  check('asset failure message is Chinese and recoverable',
    /灰猫角色未能加载/.test(msg) && /恢复|刷新/.test(msg), msg.slice(0, 40) + '…');
  check('asset failure message names the concrete cause', msg.includes('inputs/play-character.json: 404'));
  const st = core.status({ walkMode: 'orbit', controller: null });
  check('failed core never reports ready; assetError carries the message',
    st.ready === false && st.assetError === msg);
  check('assetFailureMessage rejects placeholder substitutes by contract',
    /占位/.test(assetFailureMessage('x')));
}

console.log(failures === 0 ? 'PLAY_ENTRY PASS' : `PLAY_ENTRY FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
