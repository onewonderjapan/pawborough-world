// 骑乘控制器（小吃工单 20261001「自行车」）。DOM-free/Rapier-real，与
// WalkController 同一条固定步位移权威约定：唯一活动位移权威——骑乘时步行
// 控制器不 step，本控制器 step；world.step 每固定步一次（computeColliderMovement
// + setNextKinematicTranslation 的同一模式）。
//
//   - 方向性 kinematic cuboid（与可见整车+骑手尺寸匹配），不用细小玩家胶囊，
//     车轮/车架不穿墙；复用真实地面 OBB，无隐形城市地板。
//   - W 加速（巡航 5.5 / Shift 最高 7，平滑逼近），A/D 转向（随速度生效），
//     S/Space 刹车到 0（不倒车）；松键滑行缓降。不做摔车惩罚。
//   - 撞墙/陡坡：desired 有位移但 corrected 被大幅削减 → blocked 比例升高，
//     调用方据此提示「下车推行」，绝不跨墙/飞台阶（autostep 只留 0.12m 台阶）。
//   - 安全下车：候选点（左/右/后方）逐一用真实地面射线 + 胶囊碰撞重叠检查
//     （排除玩家/车自身），全部失败返回 null，由调用方提示移到开阔处；
//     不穿墙到另一侧。
export const FIXED_HZ = 60;
// 车体碰撞盒半尺寸（米）：整车宽 0.56 + 车把 → 半宽 0.34；座高+猫 ≈ 1.35 → 半高 0.68；
// 轴距 1.02 + 前后悬 → 半长 0.82。与派生车 GLB 实际尺寸一致（build-play-bicycle.py）。
export const BIKE_HALF_EXTENTS = [0.34, 0.68, 0.82];

export class RideController {
  constructor({
    RAPIER, physics,
    halfExtents = BIKE_HALF_EXTENTS,
    cruise = 5.5, max = 7.0,
    accel = 3.5, brakeDecel = 9, coastDecel = 1.8,
    steerRate = 1.9,
    wheelRadius = 0.17,
    excludeColliderHandles = null,
  } = {}) {
    this.RAPIER = RAPIER;
    this.physics = physics;
    this.fixedDt = 1 / FIXED_HZ;
    this.halfExtents = halfExtents;
    this.cruise = cruise;
    this.max = max;
    this.accel = accel;
    this.brakeDecel = brakeDecel;
    this.coastDecel = coastDecel;
    this.steerRate = steerRate;
    this.wheelRadius = wheelRadius;
    this.excludeColliderHandles = new Set(excludeColliderHandles ?? []);

    this.spawn = [0, 1, 0];
    this.yaw = 0;
    this.speed = 0;              // m/s，前向标量（无倒挡）
    this.distance = 0;           // 累计真实位移（轮转随真实距离）
    this.input = { forward: 0, right: 0, brake: false, sprint: false };
    this.paused = false;
    this.accumulator = 0;
    this.lastStep = null;
    this.disposed = false;

    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(this.spawn[0], this.spawn[1] + halfExtents[1], this.spawn[2]));
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(...halfExtents), this.body);
    this.controller = physics.world.createCharacterController(0.03);
    this.controller.enableAutostep(0.12, 0.18, false);   // 小台阶可过，真台阶/墙过不去
    this.controller.enableSnapToGround(0.25);
    this.controller.setApplyImpulsesToDynamicBodies(false);
  }

  // --- input（与 WalkController 同语义，walk.js 可原样路由） ---
  setMoveInput(forward, right) {
    this.input.forward = clamp(forward);
    this.input.right = clamp(right);
  }
  setRunning(on) { this.input.sprint = Boolean(on); }
  setBrake(on) { this.input.brake = Boolean(on); }
  look(yawDelta /*, pitchDelta unused for bike */) {
    this.yaw -= yawDelta;
  }
  clearKeys() {
    this.input.forward = 0;
    this.input.right = 0;
    this.input.brake = false;
    this.input.sprint = false;
  }
  pause() { this.paused = true; this.clearKeys(); this.accumulator = 0; }
  resume() { this.paused = false; this.accumulator = 0; this.clearKeys(); }

  teleport(feet, yaw = this.yaw) {
    this.body.setTranslation({ x: feet[0], y: feet[1] + this.halfExtents[1], z: feet[2] }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.yaw = yaw;
    this.speed = 0;
    this.clearKeys();
  }

  // --- stepping ---
  step(dtSeconds) {
    if (this.disposed || this.paused) return;
    this.accumulator += Math.min(dtSeconds, 0.25);
    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < 8) {
      this.fixedStep(this.fixedDt);
      this.accumulator -= this.fixedDt;
      steps += 1;
    }
  }

  fixedStep(dt) {
    const { forward, right, brake, sprint } = this.input;
    // 速度：加速 → 巡航/极速；刹车/无输入 → 衰减；无倒挡
    const target = forward > 0 ? (sprint ? this.max : this.cruise) : 0;
    if (brake) this.speed = Math.max(0, this.speed - this.brakeDecel * dt);
    else if (this.speed < target) this.speed = Math.min(target, this.speed + this.accel * dt);
    else if (this.speed > target) this.speed = Math.max(target, this.speed - this.coastDecel * dt);

    // 转向：A/D，随速度生效（原地不转），右转 = yaw 减（controller 约定）
    const steerFactor = Math.min(1, this.speed / 2.5);
    this.yaw -= right * this.steerRate * steerFactor * dt;

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const dx = -sy * this.speed * dt;
    const dz = -cy * this.speed * dt;
    const t = this.body.translation();
    // 旋转（Y-up，-Z 前向）与位移同一固定步提交
    const half = this.yaw / 2;
    const rot = { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
    if (this.excludeColliderHandles.size)
      this.controller.computeColliderMovement(this.collider, { x: dx, y: -0.5 * dt, z: dz },
        undefined, undefined, (c) => !this.excludeColliderHandles.has(c.handle));
    else
      this.controller.computeColliderMovement(this.collider, { x: dx, y: -0.5 * dt, z: dz });
    const m = this.controller.computedMovement();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    this.body.setNextKinematicRotation(rot);
    this.physics.world.step();
    const horiz = Math.hypot(m.x, m.z);
    this.distance += horiz;
    this.lastStep = {
      desired: [dx, dz],
      corrected: [m.x, m.z],
      desiredSpeed: this.speed,
      // 被墙/台阶大幅削减 → 调用方提示推行（狭窄提示）
      blockedRatio: this.speed > 0.3 ? 1 - Math.min(1, horiz / Math.max(1e-6, Math.hypot(dx, dz))) : 0,
      grounded: this.controller.computedGrounded(),
    };
  }

  // --- queries（PlayCamera 兼容 feetPosition/yaw/pitch 接口） ---
  get pitch() { return 0; }
  set pitch(v) { /* 车不俯仰，保持兼容 */ }
  bodyPosition() {
    const t = this.body.translation();
    return [t.x, t.y, t.z];
  }
  feetPosition() {
    const t = this.body.translation();
    return [t.x, t.y - this.halfExtents[1], t.z];
  }
  isGrounded() { return this.lastStep ? this.lastStep.grounded : false; }

  // --- teardown：上/下车反复后物理对象数量回基线 ---
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.physics.world.removeCollider(this.collider, true);
    this.physics.world.removeCharacterController(this.controller);
    this.physics.world.removeRigidBody(this.body);
    this.body = null;
    this.collider = null;
    this.controller = null;
  }
}

function clamp(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}

// ---- 安全下车点（纯决策，探针由调用方注入；节点测试用真实世界探针驱动） ----
// candidatesOrder：车体局部系 [右侧, 左侧, 正后方]，yaw→方向的换算与控制器一致。
export function dismountCandidates(feet, yaw) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  const side = (sx) => [feet[0] + cy * sx, feet[1], feet[2] - sy * sx];       // right vector
  const back = (d) => [feet[0] + sy * d, feet[1], feet[2] + cy * d];          // -forward = (sy, cy)
  return [side(0.75), side(-0.75), back(1.1)];
}

// probe(x, y, z) → true 表示该胶囊落点安全（有真实地面且不与墙交叠）。
// 返回第一个安全点；全部不安全返回 null（提示移到开阔处，不穿墙）。
export function pickDismountSpot(feet, yaw, probe) {
  for (const c of dismountCandidates(feet, yaw)) {
    if (probe(c[0], c[1], c[2])) return { feet: c };
  }
  return null;
}
