// 骑乘控制器（小吃工单 20261001「自行车」；R0 修正：自由视角/航向分离、
// 旋转碰撞检查、真实支撑面边缘停止）。DOM-free/Rapier-real，与 WalkController
// 同一条固定步位移权威约定：骑乘时步行控制器不 step，本控制器是唯一 step 权威。
//
//   - 自由视角与物理航向分离（R0-1）：yaw/pitch 只是相机视角（look 只动视角，
//     绝不旋转实体车）；车头 heading 只由 A/D 安全转向，候选旋转姿态先做
//     真实碰撞检查（中点+终点），被墙挡住就保留安全 heading 并提示（R0-2）。
//   - 支撑面（R0-2）：车体/前后轴点只查已登记 groundColliders（地面射线过滤
//     器共用，墙顶/柜台顶不算 ground）；前方无支持面/高台阶/陡坡 → 立即停
//     （speed=0、不位移、不飘下边缘），unsupported/aheadBlocked 供 HUD 提示。
//   - 方向性 kinematic cuboid（与可见整车+骑手尺寸匹配）；W/S 有符号速度：
//     按住方向先制动到 0 再进入该方向（前进巡航 5.5 / Shift 7，倒车上限 1.6，
//     Shift 不加速倒车），空格是纯刹车（任何方向只减速到 0，不换向）；不做摔车惩罚。
//   - lastStep.corrected 是真实校正位移：unsigned distance 保留原口径（轮距总量），
//     signedTravel 把校正位移投影到车头推进轴——倒车为负、碰墙静止不空转
//     （R0-3；轮/曲柄视觉按 signedTravel 反转）。
export const FIXED_HZ = 60;
// 车体碰撞盒半尺寸（米）：与派生车 GLB 实际尺寸一致（build-play-bicycle.py）。
export const BIKE_HALF_EXTENTS = [0.34, 0.68, 0.82];
const AXLE_HALF_M = 0.36;      // 前后轮轴距半长（与 GLB wheelbaseHalfM 一致）
const AHEAD_PROBE_M = 0.5;     // 行进方向支撑探针距离（前后各一）
const MAX_STEP_DROP_M = 0.45;  // 行进方向可接受的最大下坎/台阶高差
const MIN_GROUND_NORMAL_Y = 0.7; // 法线过陡 = 墙/坡，不算可骑支撑

function yawQuat(yaw) {
  const h = yaw / 2;
  return { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
}

export class RideController {
  constructor({
    RAPIER, physics,
    halfExtents = BIKE_HALF_EXTENTS,
    cruise = 5.5, max = 7.0,
    reverseMax = 1.6,
    accel = 3.5, brakeDecel = 9, coastDecel = 1.8,
    steerRate = 1.9,
    wheelRadius = 0.17,
    excludeColliderHandles = null,
    groundColliders = null,     // array | () => array | null；缺省用 physics.groundCollider
    minimumGroundY = -Infinity,
  } = {}) {
    this.RAPIER = RAPIER;
    this.physics = physics;
    this.fixedDt = 1 / FIXED_HZ;
    this.halfExtents = halfExtents;
    this.cruise = cruise;
    this.max = max;
    this.reverseMax = reverseMax;
    this.accel = accel;
    this.brakeDecel = brakeDecel;
    this.coastDecel = coastDecel;
    this.steerRate = steerRate;
    this.wheelRadius = wheelRadius;
    this.excludeColliderHandles = new Set(excludeColliderHandles ?? []);
    this.getGroundColliders = Array.isArray(groundColliders) ? () => groundColliders
      : typeof groundColliders === 'function' ? groundColliders
        : (physics.groundCollider ? () => [physics.groundCollider] : () => []);
    this._groundHandles = new Set();
    this._groundKey = '';
    this.minimumGroundY = minimumGroundY;
    this._cuboid = null;      // 惰性：rapier 形状对象，用于形状查询

    this.spawn = [0, 1, 0];
    this.yaw = 0;             // 视角 yaw（相机跟随；look 只改这个）
    this.pitch = 0;           // 视角 pitch（同上）
    this.heading = 0;         // 物理航向（只由 A/D 转向改）
    this.speed = 0;           // m/s，有符号：>0 前进，<0 倒车
    this.distance = 0;        // 累计真实校正水平位移（unsigned，原口径不变）
    this.signedTravel = 0;    // 校正位移在车头推进轴上的投影和（倒车为负；轮/曲柄唯一来源）
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
    this.controller.enableAutostep(0.12, 0.18, false);   // 小坎可过，真台阶/墙过不去
    this.controller.enableSnapToGround(0.25);
    this.controller.setApplyImpulsesToDynamicBodies(false);
  }

  _shapeObject() {
    if (!this._cuboid) this._cuboid = new this.RAPIER.Cuboid(...this.halfExtents);
    return this._cuboid;
  }
  _refreshGroundHandles() {
    const list = this.getGroundColliders() ?? [];
    const key = list.map(c => c.handle).join(',');
    if (key !== this._groundKey) {
      this._groundHandles = new Set(list.map(c => c.handle));
      this._groundKey = key;
    }
    return this._groundHandles;
  }
  // 旋转/停驻的墙过滤：自身/地面/玩家胶囊都不算"被旋转撞上的墙"
  _wallFilter(selfHandle) {
    const grounds = this._refreshGroundHandles();
    const excl = this.excludeColliderHandles;
    return (c) => c.handle !== selfHandle && !grounds.has(c.handle) && !excl.has(c.handle);
  }

  // --- input（与 WalkController 同语义，walk.js 原样路由） ---
  setMoveInput(forward, right) {
    this.input.forward = clamp(forward);
    this.input.right = clamp(right);
  }
  setRunning(on) { this.input.sprint = Boolean(on); }
  setBrake(on) { this.input.brake = Boolean(on); }
  // 自由视角：只动相机视角，绝不旋转实体车（R0-1）
  look(yawDelta, pitchDelta = 0) {
    this.yaw -= yawDelta;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - pitchDelta));
  }
  clearKeys() {
    this.input.forward = 0;
    this.input.right = 0;
    this.input.brake = false;
    this.input.sprint = false;
  }
  pause() { this.paused = true; this.clearKeys(); this.accumulator = 0; }
  resume() { this.paused = false; this.accumulator = 0; this.clearKeys(); }

  teleport(feet, heading = this.heading, viewYaw = this.yaw) {
    this.body.setTranslation({ x: feet[0], y: feet[1] + this.halfExtents[1], z: feet[2] }, true);
    this.body.setRotation(yawQuat(heading), true);
    this.heading = heading;
    this.yaw = viewYaw;
    this.pitch = 0;
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

  // 支撑查询：只认已登记 groundColliders（地面射线过滤器）
  supportAt(x, z, fromY) {
    const grounds = this._refreshGroundHandles();
    if (!grounds.size) return null;
    const ray = new this.RAPIER.Ray({ x, y: fromY + 1.0, z }, { x: 0, y: -1, z: 0 });
    const hit = this.physics.world.castRayAndGetNormal(ray, 4, true,
      undefined, undefined, undefined, undefined, (c) => grounds.has(c.handle));
    if (!hit) return null;
    const y=fromY+1.0-hit.timeOfImpact;
    return y>=this.minimumGroundY?{y,ny:hit.normal?hit.normal.y:1}:null;
  }
  _axles() {
    const t = this.body.translation();
    const sy = Math.sin(this.heading), cy = Math.cos(this.heading);
    // forward = (-sin, -cos)；前轴在前，后轴在后；behind = 后轴再向车尾探
    return {
      t,
      front: [t.x - sy * AXLE_HALF_M, t.z - cy * AXLE_HALF_M],
      rear: [t.x + sy * AXLE_HALF_M, t.z + cy * AXLE_HALF_M],
      ahead: [t.x - sy * (AXLE_HALF_M + AHEAD_PROBE_M), t.z - cy * (AXLE_HALF_M + AHEAD_PROBE_M)],
      behind: [t.x + sy * (AXLE_HALF_M + AHEAD_PROBE_M), t.z + cy * (AXLE_HALF_M + AHEAD_PROBE_M)],
    };
  }

  fixedStep(dt) {
    const { forward, right, brake, sprint } = this.input;
    // 有符号速度（工单 A）：W/S 相对当前行进方向先真刹车到 0，继续按住才进入
    // 该方向（前进巡航/极速、倒车低速上限）；Shift 只加速前进；空格纯刹车。
    if (brake) {
      this.speed = toward(this.speed, 0, this.brakeDecel * dt);
    } else if (forward > 0) {
      if (this.speed < 0) this.speed = toward(this.speed, 0, this.brakeDecel * dt);
      else {
        const target = sprint ? this.max : this.cruise;
        this.speed = this.speed < target
          ? toward(this.speed, target, this.accel * dt)
          : toward(this.speed, target, this.coastDecel * dt);
      }
    } else if (forward < 0) {
      if (this.speed > 0) this.speed = toward(this.speed, 0, this.brakeDecel * dt);
      else this.speed = toward(this.speed, -this.reverseMax, this.accel * dt);   // Shift 不加速倒车
    } else {
      this.speed = toward(this.speed, 0, this.coastDecel * dt);
    }

    const step = {
      desired: [0, 0], corrected: [0, 0], desiredSpeed: this.speed,
      blockedRatio: 0, turnBlocked: false, unsupported: false, aheadBlocked: false,
      grounded: true,
    };

    // ---- 支撑检查（R0-2）：前后轴必须踩在已登记支撑面上 ----
    const ax = this._axles();
    const fromY = ax.t.y - this.halfExtents[1];   // 车底（≈脚点）
    const sf = this.supportAt(ax.front[0], ax.front[1], fromY);
    const sr = this.supportAt(ax.rear[0], ax.rear[1], fromY);
    if ((!sf || sf.ny < MIN_GROUND_NORMAL_Y) && (!sr || sr.ny < MIN_GROUND_NORMAL_Y)) {
      // 悬空/驶离支持面：立即停住，不位移、不飘下（重力由恢复支撑或下车处理）
      this.speed = 0;
      this.clearKeys();
      step.unsupported = true;
      this._commit(0, 0, step, dt);
      return;
    }
    const groundY = (sf && sf.ny >= MIN_GROUND_NORMAL_Y ? sf : sr).y;

    // ---- 转向（R0-2）：候选旋转姿态先做真实碰撞检查；随 |速度| 生效，
    // 倒车时车尾摆向与前进相反（行进符号取反，真实倒车方向感） ----
    const steerFactor = Math.min(1, Math.abs(this.speed) / 2.5);
    const travelSign = this.speed < 0 ? -1 : 1;
    const dHeading = -right * this.steerRate * steerFactor * travelSign * dt;
    if (dHeading !== 0 && this._rotationBlocked(this.heading + dHeading)) {
      step.turnBlocked = true;      // 保留安全 heading，HUD 提示
    } else if (dHeading !== 0) {
      this.heading += dHeading;
      this.body.setRotation(yawQuat(this.heading), true);
    }

    // ---- 行进方向支撑探针：无支持面/高坎/陡坡 → 立即停（倒车探车尾） ----
    if (Math.abs(this.speed) > 0.05) {
      const probe = this.speed > 0 ? ax.ahead : ax.behind;
      const sa = this.supportAt(probe[0], probe[1], fromY);
      if (!sa || sa.ny < MIN_GROUND_NORMAL_Y || sa.y < groundY - MAX_STEP_DROP_M) {
        this.speed = 0;
        step.aheadBlocked = true;
        this._commit(0, 0, step, dt);
        return;
      }
    }

    // ---- 位移（唯一活动位移权威；signed speed 直接给出倒车方向） ----
    const sy = Math.sin(this.heading), cy = Math.cos(this.heading);
    const dx = -sy * this.speed * dt;
    const dz = -cy * this.speed * dt;
    step.desired = [dx, dz];
    this._commit(dx, dz, step, dt);
  }

  _commit(dx, dz, step, dt) {
    const t = this.body.translation();
    if (this.excludeColliderHandles.size)
      this.controller.computeColliderMovement(this.collider, { x: dx, y: -0.5 * dt, z: dz },
        undefined, undefined, (c) => !this.excludeColliderHandles.has(c.handle));
    else
      this.controller.computeColliderMovement(this.collider, { x: dx, y: -0.5 * dt, z: dz });
    const m = this.controller.computedMovement();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    this.physics.world.step();
    const horiz = Math.hypot(m.x, m.z);
    this.distance += horiz;                      // unsigned 口径不变
    // signedTravel：校正位移投影到车头推进轴（前进 +，倒车 -；撞墙 ≈0 不空转）
    const sy = Math.sin(this.heading), cy = Math.cos(this.heading);
    this.signedTravel += m.x * -sy + m.z * -cy;
    const desiredH = Math.hypot(dx, dz);
    step.corrected = [m.x, m.z];
    step.blockedRatio = desiredH > 1e-6 ? 1 - Math.min(1, horiz / desiredH) : 0;
    step.grounded = this.controller.computedGrounded();
    this.lastStep = step;
  }

  // 候选旋转姿态与沿旋转扫过的中点姿态，均不得与墙交叠（R0-2）
  _rotationBlocked(candidateHeading) {
    const t = this.body.translation();
    const shape = this._shapeObject();
    const self = this.collider.handle;
    const filter = this._wallFilter(self);
    const y0 = this.heading;
    for (const frac of [0.5, 1]) {
      const q = yawQuat(y0 + (candidateHeading - y0) * frac);
      if (this.physics.world.intersectionWithShape(
        { x: t.x, y: t.y, z: t.z }, q, shape,
        undefined, undefined, undefined, undefined, filter)) return true;
    }
    return false;
  }

  // --- queries（PlayCamera 兼容 feetPosition/yaw/pitch 接口；yaw=自由视角） ---
  bodyPosition() {
    const t = this.body.translation();
    return [t.x, t.y, t.z];
  }
  feetPosition() {
    const t = this.body.translation();
    return [t.x, t.y - this.halfExtents[1], t.z];
  }
  isGrounded() { return this.lastStep ? this.lastStep.grounded : false; }
  // 骑乘中相机与模型要用真实航向（install/bike-view 读这个）
  get headingQuat() { return yawQuat(this.heading); }

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

// 把 v 向 target 最多移动 maxDelta（用于有符号速度的加速/制动/滑行）
function toward(v, target, maxDelta) {
  if (v < target) return Math.min(target, v + maxDelta);
  if (v > target) return Math.max(target, v - maxDelta);
  return target;
}

// ---- 安全下车点（纯决策，探针由调用方注入；节点测试用真实世界探针驱动） ----
export function dismountCandidates(feet, yaw) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  const side = (sx) => [feet[0] + cy * sx, feet[1], feet[2] - sy * sx];       // right vector
  const back = (d) => [feet[0] + sy * d, feet[1], feet[2] + cy * d];          // -forward = (sy, cy)
  return [side(0.75), side(-0.75), back(1.1)];
}

// probe(x, y, z) → true 表示该胶囊落点安全（有真实支撑面且不与墙交叠）。
// 返回第一个安全点；全部不安全返回 null（提示移到开阔处，不穿墙）。
export function pickDismountSpot(feet, yaw, probe) {
  for (const c of dismountCandidates(feet, yaw)) {
    if (probe(c[0], c[1], c[2])) return { feet: c };
  }
  return null;
}
