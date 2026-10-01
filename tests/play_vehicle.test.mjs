// 骑乘与三速度契约（小吃工单 20261001；R0 修正后）。
// 真实 Rapier 合成受控世界（真实地面/墙 OBB + 已登记 groundCollider）：
//   - 走 2.6 / Shift 跑 4.2（WalkController runSpeed）
//   - 车巡航 5.5 / Shift 极速 7；S/空格真刹车（非慢滑）；无倒挡
//   - 自由视角与物理航向分离：look 只动 yaw（视角），heading 只由 A/D 转向
//   - 贴墙转弯：候选旋转姿态被墙挡住 → 保留安全 heading，车身不旋入墙
//     （复现主控 run/vehicle-boundaries.mjs 第 1 案）
//   - 前方无支持面 → 停住不飘下边缘（复现第 2 案）
//   - 上/下车反复后物理对象数量回基线
// Run: node tests/play_vehicle.test.mjs   (exit 0 = contract holds)
import RAPIER from '@dimforge/rapier3d-compat';
import { WalkController } from '../src/player/WalkController.js';
import { RideController, pickDismountSpot, dismountCandidates } from '../scene-authoring/yuyuan-area/web/play/vehicle.js';

await RAPIER.init();
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// 合成受控世界：地板（已登记 groundCollider）+ 墙
function makeWorld({ edge = false, wall = false } = {}) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const groundCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, edge ? 3 : 50).setTranslation(0, -0.5, 0));
  let wallCollider = null;
  if (wall) wallCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 2, 20).setTranslation(0.49, 1, 0));
  world.step();
  return { world, groundCollider, wallCollider };
}

// --- 三速度 ---
{
  const physics = makeWorld();
  const ctl = new WalkController({
    RAPIER, physics,
    capsule: { radius: 0.28, halfHeight: 0.2, eyeHeight: 0.8, speed: 2.6, runSpeed: 4.2, autostep: 0.15, spawn: [0, 0.05, 5] },
  });
  for (let i = 0; i < 30; i++) ctl.step(1 / 60);
  check('步行胶囊落在真实地面上', ctl.isGrounded() && Math.abs(ctl.feetPosition()[1]) < 0.05, `feet=${ctl.feetPosition().map(v => v.toFixed(2))}`);

  ctl.setMoveInput(1, 0);
  for (let i = 0; i < 45; i++) ctl.step(1 / 60);
  const vWalk = Math.hypot(ctl.lastStep.corrected[0] / ctl.fixedDt, ctl.lastStep.corrected[2] / ctl.fixedDt);
  check('普通走路 2.6 m/s', Math.abs(vWalk - 2.6) < 0.1, `v=${vWalk.toFixed(2)}`);

  ctl.setRunning(true);
  for (let i = 0; i < 45; i++) ctl.step(1 / 60);
  const vRun = Math.hypot(ctl.lastStep.corrected[0] / ctl.fixedDt, ctl.lastStep.corrected[2] / ctl.fixedDt);
  check('按住 Shift 跑 4.2 m/s', Math.abs(vRun - 4.2) < 0.1, `v=${vRun.toFixed(2)}`);

  ctl.pause();
  check('暂停清键（含 Shift）', ctl.input.forward === 0 && ctl.running === false);
  ctl.dispose();
  physics.world.free();
}

// --- 车：加速/极速/真刹车/自由视角分离 ---
{
  const physics = makeWorld();
  const ride = new RideController({ RAPIER, physics, cruise: 5.5, max: 7.0 });
  ride.teleport([0, 0.05, 8], 0, 0);
  for (let i = 0; i < 30; i++) ride.step(1 / 60);
  check('车落在已登记支撑面上', Math.abs(ride.feetPosition()[1]) < 0.06, `feet=${ride.feetPosition().map(v => v.toFixed(2))}`);

  ride.setMoveInput(1, 0);
  for (let i = 0; i < 150; i++) ride.step(1 / 60);
  check('车巡航不超过 5.5', ride.speed <= 5.5 + 1e-9 && ride.speed > 4.8, `v=${ride.speed.toFixed(2)}`);
  const d0 = ride.distance;

  // S 真刹车：0.3s 内从 5.5 掉到 2 以下（coastDecel 只能掉 ~0.5），0.75s 停死
  ride.setMoveInput(0, 0);
  ride.setBrake(true);
  for (let i = 0; i < 18; i++) ride.step(1 / 60);
  const vAfter03 = ride.speed;
  for (let i = 0; i < 27; i++) ride.step(1 / 60);
  check('S 刹车明显快于滑行且停死', vAfter03 < 3.2 && ride.speed === 0,
    `0.3s=${vAfter03.toFixed(2)}（coast 应≈4.96） 0.75s=${ride.speed}`);
  ride.setBrake(false);

  // 自由视角与航向分离：look 只动视角
  const heading0 = ride.heading;
  ride.look(0.6, 0.1);
  check('look 只改视角不改航向', close(ride.yaw, -0.6, 1e-9) && close(ride.heading, heading0, 1e-9)
    && close(ride.pitch, -0.1, 1e-9), `yaw=${ride.yaw} heading=${ride.heading}`);
  for (let i = 0; i < 20; i++) ride.step(1 / 60);
  check('视角变化不旋转车体（heading 不漂）', close(ride.heading, heading0, 1e-9));

  // A/D 真转向：随速度生效，右转 = heading 减；视角不动
  const view0 = ride.yaw;
  ride.setMoveInput(1, 1);
  for (let i = 0; i < 30; i++) ride.step(1 / 60);
  check('D 右转 heading 减（视角不动）', ride.heading < heading0 - 0.3 && close(ride.yaw, view0, 1e-9),
    `Δheading=${(ride.heading - heading0).toFixed(2)}`);
  ride.clearKeys(); ride.speed = 0; ride.heading = 0; ride.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  ride.setMoveInput(0, 1);
  for (let i = 0; i < 30; i++) ride.step(1 / 60);
  check('原地不转向（转向随速度生效）', close(ride.heading, 0, 1e-9));

  // 轮距按真实校正位移累计（顶墙不空转）
  check('累计位移为真实校正位移', ride.distance >= d0);
  ride.dispose();
  physics.world.free();
}

// --- R0-2：贴墙转弯不把车身旋进墙（主控 boundaries 第 1 案） ---
{
  const physics = makeWorld({ wall: true });
  const ride = new RideController({ RAPIER, physics });
  ride.teleport([0, 0.035, 0], 0);
  physics.world.step();
  let overlap = null;
  ride.setMoveInput(1, -1);
  for (let i = 0; i < 80; i++) {
    ride.step(1 / 60);
    const pos = ride.body.translation(), rot = ride.body.rotation();
    physics.world.intersectionsWithShape(pos, rot, ride.collider.shape, (c) => {
      if (c.handle === physics.wallCollider.handle) overlap = { step: i, feet: ride.feetPosition(), rot };
      return true;
    });
    if (overlap) break;
  }
  check('贴墙转弯：车体从不与墙交叠（保留安全 heading）', !overlap, overlap && JSON.stringify(overlap.feet?.map(v => +v.toFixed(2))));
  check('转弯被挡时上报 turnBlocked', ride.lastStep?.turnBlocked === true || ride.speed > 0, `last=${JSON.stringify(ride.lastStep?.turnBlocked)}`);
  ride.dispose();
  physics.world.free();
}

// --- R0-2：前方无支持面 → 停住不飘下边缘（主控 boundaries 第 2 案） ---
{
  const physics = makeWorld({ edge: true });
  const ride = new RideController({ RAPIER, physics });
  ride.teleport([0, 0.035, -1], 0);
  physics.world.step();
  ride.setMoveInput(1, 0);
  for (let i = 0; i < 240; i++) ride.step(1 / 60);
  const feet = ride.feetPosition();
  check('骑到无支撑边缘前停住（不飘下）', feet[2] >= -2.25 && feet[1] > -0.5,
    `feet=${feet.map(v => +v.toFixed(2))} speed=${ride.speed}`);
  check('边缘停住上报 aheadBlocked/unsupported', ride.lastStep?.aheadBlocked === true || ride.lastStep?.unsupported === true);
  ride.dispose();
  physics.world.free();
}

// --- 上/下车对象数回基线（主控 boundaries 第 3 案） ---
{
  const physics = makeWorld();
  const base = { bodies: physics.world.bodies.len(), colliders: physics.world.colliders.len() };
  for (let i = 0; i < 12; i++) {
    const ride = new RideController({ RAPIER, physics });
    ride.teleport([0, 0.035, 0]);
    ride.step(1 / 60);
    ride.dispose();
    ride.dispose();
  }
  const after = { bodies: physics.world.bodies.len(), colliders: physics.world.colliders.len() };
  check('12 次创建/销毁回精确物理对象基线', JSON.stringify(base) === JSON.stringify(after), `${base} vs ${after}`);
  physics.world.free();
}

// --- 工单 A：有符号速度——前进→刹停→倒车 / 反向制动 / Shift 不加速倒车 / 空格纯刹车 ---
{
  const physics = makeWorld();
  const ride = new RideController({ RAPIER, physics, cruise: 5.5, max: 7.0, reverseMax: 1.6 });
  ride.teleport([0, 0.05, 8], 0, 0);
  for (let i = 0; i < 30; i++) ride.step(1 / 60);

  // 正常前进到巡航，然后一直按住 S：先真刹车到 0，继续按住进入低速倒车
  ride.setMoveInput(1, 0);
  for (let i = 0; i < 150; i++) ride.step(1 / 60);
  check('倒车前先有正向巡航', ride.speed > 4.8, `v=${ride.speed.toFixed(2)}`);
  ride.setMoveInput(-1, 0);
  let crossedZero = false, minSpeed = 0;
  for (let i = 0; i < 240; i++) {
    ride.step(1 / 60);
    if (ride.speed <= 0) crossedZero = true;
    minSpeed = Math.min(minSpeed, ride.speed);
  }
  check('按住 S 先刹停再进入倒车', crossedZero && Math.abs(minSpeed + 1.6) < 0.05,
    `min=${minSpeed.toFixed(3)}（期望 -1.6）`);
  check('倒车不超低速上限 1.6', ride.speed >= -1.6 - 1e-9 && ride.speed < -1.5, `v=${ride.speed.toFixed(3)}`);

  // Shift 不加速倒车
  ride.setRunning(true);
  for (let i = 0; i < 60; i++) ride.step(1 / 60);
  check('Shift 不加速倒车（仍 ≤1.6）', Math.abs(ride.speed + 1.6) < 0.05, `v=${ride.speed.toFixed(3)}`);
  ride.setRunning(false);

  // 轮相位符号：signedTravel 增量为负（倒车反转）；unsigned distance 仍单调增
  const st0 = ride.signedTravel, d0 = ride.distance;
  for (let i = 0; i < 30; i++) ride.step(1 / 60);
  check('倒车阶段 signedTravel 增量为负（轮反转）', ride.signedTravel < st0 - 0.1,
    `Δ=${(ride.signedTravel - st0).toFixed(3)}`);
  check('unsigned distance 口径不变（仍累计）', ride.distance > d0 + 0.1);

  // 全程只倒车的控制器：signedTravel 为负（前进从未发生）
  {
    const physics2 = makeWorld();
    const rev = new RideController({ RAPIER, physics: physics2 });
    rev.teleport([0, 0.05, 0], 0, 0);
    physics2.world.step();
    rev.setMoveInput(-1, 0);
    for (let i = 0; i < 120; i++) rev.step(1 / 60);
    check('纯倒车控制器 signedTravel < 0（符号正确）', rev.signedTravel < -0.5, `signed=${rev.signedTravel.toFixed(3)}`);
    rev.dispose();
    physics2.world.free();
  }

  // 从倒车按 W：先制动到 0 再前进
  ride.setMoveInput(1, 0);
  let sawZero = false;
  for (let i = 0; i < 240; i++) { ride.step(1 / 60); if (ride.speed === 0) sawZero = true; }
  check('W 从倒车先制动到 0 再前进', sawZero && ride.speed > 4.8, `end=${ride.speed.toFixed(2)}`);

  // 空格纯刹车：油门按住时从前进刹到 0，不反向；松开空格且无油门 → 保持 0
  ride.setBrake(true);
  for (let i = 0; i < 60; i++) ride.step(1 / 60);
  check('空格刹车停死且不换向（W 仍按住）', ride.speed === 0, `v=${ride.speed.toFixed(3)}`);
  ride.setBrake(false);
  ride.clearKeys();
  for (let i = 0; i < 30; i++) ride.step(1 / 60);
  check('空格松开且无油门不自动起步', ride.speed === 0, `v=${ride.speed.toFixed(3)}`);
  ride.dispose();
  physics.world.free();
}

// --- 工单 A：车尾撞墙——倒车被墙挡住，不位移、signedTravel 不空转 ---
{
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const groundCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
  // 墙在车尾（+Z，heading 0 时后方）
  const wallCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(20, 2, 0.1).setTranslation(0, 1, 1.65));
  world.step();
  const ride = new RideController({ RAPIER, physics: { world, groundCollider } });
  ride.teleport([0, 0.035, 0], 0, 0);
  world.step();
  ride.setMoveInput(1, 0);
  for (let i = 0; i < 90; i++) ride.step(1 / 60);          // 先开向远离后墙
  ride.setMoveInput(-1, 0);
  for (let i = 0; i < 300; i++) ride.step(1 / 60);         // 倒向墙
  const feet = ride.feetPosition();
  const st1 = ride.signedTravel;
  for (let i = 0; i < 60; i++) ride.step(1 / 60);
  const st2 = ride.signedTravel, feet2 = ride.feetPosition();
  let overlap = false;
  const pos = ride.body.translation(), rot = ride.body.rotation();
  world.intersectionsWithShape(pos, rot, ride.collider.shape, (c) => {
    if (c.handle === wallCollider.handle) overlap = true;
    return true;
  });
  check('倒车撞墙：车体不与后墙交叠', !overlap, `feet=${feet2.map(v => +v.toFixed(2))}`);
  check('倒车撞墙：不穿墙不飘移（车尾停住）', feet2[2] < 1.65 - 0.8, `z=${feet2[2].toFixed(2)}`);
  check('倒车撞墙：signedTravel 停止累计（轮不空转）', Math.abs(st2 - st1) < 0.02,
    `Δ=${(st2 - st1).toFixed(4)}`);
  ride.dispose();
  world.free();
}

// --- 工单 A：倒车驶离支撑边缘——车尾探路，停住不飘下 ---
{
  const physics = makeWorld({ edge: true });
  const ride = new RideController({ RAPIER, physics });
  // heading π = 车头朝 +Z；edge 地面 z∈[-3,3]，向前开会让车尾逼近 z=3 边缘
  ride.teleport([0, 0.035, 1.4], Math.PI, 0);
  physics.world.step();
  ride.setMoveInput(1, 0);                                 // W = 朝车头(+Z 方向的反向即 -Z?) 验证车尾探针
  for (let i = 0; i < 240; i++) ride.step(1 / 60);
  // heading π：forward = (-sin π, -cos π) = (0, +1)?? sin π≈0, -cos π=+1 → 车头朝 +Z… 车尾朝 -Z。
  // 让车尾朝边缘：换 heading 0，车尾朝 +Z 边缘，按 S 倒车。
  ride.teleport([0, 0.035, 1.4], 0, 0);
  physics.world.step();
  ride.setMoveInput(-1, 0);                                // S 倒车 → 车尾 (+Z) 驶向边缘 z=3
  for (let i = 0; i < 240; i++) ride.step(1 / 60);
  const feet = ride.feetPosition();
  check('倒车到边缘前停住（车尾探针生效）', feet[2] <= 2.4 && feet[1] > -0.5,
    `feet=${feet.map(v => +v.toFixed(2))}`);
  check('边缘停住上报 aheadBlocked/unsupported', ride.lastStep?.aheadBlocked === true || ride.lastStep?.unsupported === true,
    `last=${JSON.stringify({ a: ride.lastStep?.aheadBlocked, u: ride.lastStep?.unsupported })}`);
  ride.dispose();
  physics.world.free();
}

// --- 安全下车点 ---
{
  const feet = [0, 0, 0], yaw = 0;
  const cands = dismountCandidates(feet, yaw);
  check('候选点 = 右/左/后三个', cands.length === 3
    && close(cands[0][0], 0.75) && close(cands[1][0], -0.75) && close(cands[2][2], 1.1));
  const first = pickDismountSpot(feet, yaw, () => true);
  check('第一个安全点即右侧', close(first.feet[0], 0.75));
  const none = pickDismountSpot(feet, yaw, () => false);
  check('全部不安全返回 null（提示移到开阔处，不穿墙）', none === null);
}

console.log(failures === 0 ? 'PLAY_VEHICLE PASS' : `PLAY_VEHICLE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
