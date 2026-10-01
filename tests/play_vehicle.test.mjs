// 骑乘与三速度契约（小吃工单 20261001「自行车」+「更快移动」）。
// 用真实 Rapier（合成受控世界：真实地面/墙 OBB，非隐形城市地板）驱动：
//   - 走 2.6 / Shift 跑 4.2（WalkController runSpeed）
//   - 车巡航 5.5 / Shift 极速 7，加速平滑、刹车能停、无倒挡
//   - 方向性 kinematic 碰撞体撞墙 → corrected≪desired，blockedRatio 高
//   - 转向只随速度生效；A/D 方向正确
//   - 上/下车反复后物理对象数量回基线；安全下车点全败返回 null
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

// 合成受控世界：地板 + 三面墙（真实静态 OBB）
function makeWorld() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const floor = world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
  const wallN = world.createCollider(RAPIER.ColliderDesc.cuboid(3, 2, 0.2).setTranslation(0, 2, -3));   // 北墙（-Z）
  const wallS = world.createCollider(RAPIER.ColliderDesc.cuboid(3, 2, 0.2).setTranslation(0, 2, 8));
  const wallW = world.createCollider(RAPIER.ColliderDesc.cuboid(0.2, 2, 12).setTranslation(-3, 2, 2));
  return { world, statics: [floor, wallN, wallS, wallW] };
}
const physics = makeWorld();
const baseBodies = physics.world.bodies.len();
const baseColliders = physics.world.colliders.len();

// --- 三速度 ---
{
  const ctl = new WalkController({
    RAPIER, physics,
    capsule: { radius: 0.28, halfHeight: 0.2, eyeHeight: 0.8, speed: 2.6, runSpeed: 4.2, autostep: 0.15, spawn: [0, 0.05, 5] },
  });
  // 站稳
  for (let i = 0; i < 30; i++) ctl.step(1 / 60);
  check('步行胶囊落在真实地面上', ctl.isGrounded() && Math.abs(ctl.feetPosition()[1]) < 0.05, `feet=${ctl.feetPosition().map(v => v.toFixed(2))}`);

  ctl.setMoveInput(1, 0);
  for (let i = 0; i < 45; i++) ctl.step(1 / 60);   // 0.75s：达到稳态
  const vWalk = Math.hypot(ctl.lastStep.corrected[0] / ctl.fixedDt, ctl.lastStep.corrected[2] / ctl.fixedDt);
  check('普通走路 2.6 m/s', Math.abs(vWalk - 2.6) < 0.1, `v=${vWalk.toFixed(2)}`);

  ctl.setRunning(true);
  for (let i = 0; i < 45; i++) ctl.step(1 / 60);
  const vRun = Math.hypot(ctl.lastStep.corrected[0] / ctl.fixedDt, ctl.lastStep.corrected[2] / ctl.fixedDt);
  check('按住 Shift 跑 4.2 m/s', Math.abs(vRun - 4.2) < 0.1, `v=${vRun.toFixed(2)}`);

  ctl.pause();
  check('暂停清键（含 Shift）', ctl.input.forward === 0 && ctl.running === false);
  ctl.dispose();
}

// --- 车：加速/极速/刹车/转向/撞墙 ---
{
  const ride = new RideController({ RAPIER, physics });
  ride.teleport([0, 0.05, 5], 0);          // yaw=0 → 前进 -Z，北墙在 z=-3
  for (let i = 0; i < 30; i++) ride.step(1 / 60);

  ride.setMoveInput(1, 0);
  for (let i = 0; i < 150; i++) ride.step(1 / 60);   // 2.5s 加速到巡航（距墙 ~3m，中途撞墙）
  check('车巡航不超过 5.5', ride.speed <= 5.5 + 1e-9, `v=${ride.speed.toFixed(2)}`);

  // 顶墙：desired 大、corrected≈0 → blockedRatio≈1（提示推行的依据）
  const zBefore = ride.feetPosition()[2];
  ride.step(1 / 60);
  const blocked = ride.lastStep.blockedRatio;
  check('顶墙时 blockedRatio 高（窄路提示依据）', blocked > 0.8, `blocked=${blocked.toFixed(2)}`);
  check('车不穿墙', Math.abs(ride.feetPosition()[2] - zBefore) < 0.05, `z=${ride.feetPosition()[2].toFixed(2)}`);

  // 刹车能停
  ride.setBrake(true);
  for (let i = 0; i < 90; i++) ride.step(1 / 60);
  check('刹车后完全停下', ride.speed === 0, `v=${ride.speed}`);

  // 极速：Shift 上 7（北墙挡着，掉头向南跑）
  ride.setBrake(false);
  ride.yaw = Math.PI;                       // 前进 +Z（向南，开阔）
  ride.body.setRotation({ x: 0, y: 1, z: 0, w: 0 }, true);
  ride.setRunning(true);
  for (let i = 0; i < 240; i++) ride.step(1 / 60);   // 4s
  check('Shift 极速 7 m/s', Math.abs(ride.speed - 7.0) < 0.15, `v=${ride.speed.toFixed(2)}`);
  check('轮距随真实位移累计', ride.distance > 10, `d=${ride.distance.toFixed(1)}`);

  // 转向：随速度生效，右转 = yaw 减
  const yaw0 = ride.yaw;
  ride.setMoveInput(1, 1);                  // W + D
  for (let i = 0; i < 30; i++) ride.step(1 / 60);
  check('行进中右转 yaw 减（controller 约定）', ride.yaw < yaw0 - 0.3, `Δ=${(ride.yaw - yaw0).toFixed(2)}`);
  ride.clearKeys(); ride.speed = 0; ride.yaw = 0;
  ride.setMoveInput(0, 1);
  for (let i = 0; i < 30; i++) ride.step(1 / 60);
  check('原地不转向（随速度生效）', close(ride.yaw, 0, 1e-9));

  // 位移权威：骑乘时步行控制器不 step（walk.js 只 step 一个）
  const walkCtl = new WalkController({
    RAPIER, physics,
    capsule: { radius: 0.28, halfHeight: 0.2, eyeHeight: 0.8, speed: 2.6, spawn: [0, 0.05, 5] },
  });
  const walkZ0 = walkCtl.feetPosition()[2];
  ride.step(1 / 60);                        // 只 step 车
  check('骑乘时步行胶囊不产生位移（单一位移权威）', close(walkCtl.feetPosition()[2], walkZ0, 1e-9));

  // 上/下车对象数回基线（步行胶囊在世 = 基线+1；骑乘 = 基线+2；下车回收）
  const bodiesWithRide = physics.world.bodies.len();
  check('骑乘世界只多车一个刚体', bodiesWithRide === baseBodies + 2, `${bodiesWithRide} vs base ${baseBodies} + walk + ride`);
  ride.dispose();
  check('下车后刚体只余步行胶囊', physics.world.bodies.len() === baseBodies + 1, `${physics.world.bodies.len()}`);
  walkCtl.dispose();
  check('全部下车回基线',
    physics.world.bodies.len() === baseBodies && physics.world.colliders.len() === baseColliders,
    `bodies=${physics.world.bodies.len()} colliders=${physics.world.colliders.len()}`);
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
