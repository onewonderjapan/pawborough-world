// Kinematic walk controller — the single authoritative displacement chain:
// input intent -> fixed-step desired translation -> Rapier character
// controller correction -> kinematic body transform -> camera follows.
// Nothing else may write the capsule translation (route cruise included: it
// also goes through setInput).
//
// DOM-free on purpose: node tests drive this exact class against the real
// Rapier physics world.
//
// Capsule is real metric: radius 0.35 m (the route.json clearance radius),
// cylinder half-height 0.6 m -> total height 1.9 m, feet at
// bodyCenter.y - (halfHeight + radius), eyes at feet + 1.6 m.
// These are NOT the old cat-controller dimensions.

const FIXED_HZ = 60;
const WALK_SPEED = 2.2;          // m/s
const GRAVITY = 9.81;            // m/s^2
const JUMP_HEIGHT = 0.55;        // m
const STEP_UP = 0.30;            // curbs (0.10 m) pass, real walls do not
const SNAP_TO_GROUND = 0.30;

export class WalkController {
  // groundColliderHandles（可选）：步行地面 collider 的 handle 集合。提供后启用
  // 手动台阶抬升（wave13-templefix R2）：rapier autostep 对「大面积 trimesh 平面的
  // 边缘」（九曲桥面 0.55 → 湖心亭承台 0.57 的 0.02 m 让桥缝台沿）不触发——胶囊球
  // 与台缘的边接触被解析为水平墙、desired movement 每步清零，huxinting-walkin 卡
  // waypoint 2/3，浏览器步行同源同卡。手动抬升仅在「水平被拦 ≥ 一半 + grounded +
  // 前方一步处 STEP_UP 内确有地面」三条同时成立时触发，真墙（高过 STEP_UP）与
  // 悬崖（前方无地面）都不会触发；不传该参数保持旧行为。
  constructor({ RAPIER, physics, capsule, excludeColliderHandles = null, groundColliderHandles = null }) {
    this.RAPIER = RAPIER;
    this.physics = physics;
    this.groundColliderHandles = groundColliderHandles ? new Set(groundColliderHandles) : null;
    this.fixedDt = 1 / FIXED_HZ;
    this.speed = WALK_SPEED;
    this.radius = capsule.radius;
    this.halfHeight = capsule.halfHeight;
    this.eyeHeight = capsule.eyeHeight;
    this.centerOffset = capsule.halfHeight + capsule.radius;
    const s = Array.isArray(capsule.spawn)
      ? { x: capsule.spawn[0], y: capsule.spawn[1], z: capsule.spawn[2] }
      : capsule.spawn;
    // Collider handles this controller must IGNORE when moving (e.g. a probe
    // validating anchors while a live player capsule exists in the same
    // physics world). Static-scene geometry is never excluded.
    this.excludeColliderHandles = new Set(excludeColliderHandles ?? []);

    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(s.x, s.y + this.centerOffset, s.z));
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(this.halfHeight, this.radius), this.body);

    this.controller = physics.world.createCharacterController(0.02);
    this.controller.enableAutostep(STEP_UP, 0.18, false);
    this.controller.enableSnapToGround(SNAP_TO_GROUND);
    this.controller.setApplyImpulsesToDynamicBodies(false);

    this.input = { forward: 0, right: 0, jump: false };
    this.yaw = 0;
    this.pitch = 0;
    this.vy = 0;
    this.paused = false;
    this.accumulator = 0;
    this.lastStep = null;
    this.disposed = false;
  }

  // --- input -------------------------------------------------------------
  // Explicit placement (session spawn/restore, validated anchor relocation).
  // A teleport is NEVER walk evidence — callers record it as such. Feet land
  // at the given point; vertical velocity and pending input reset.
  teleport(feetXyz, yaw = this.yaw, pitch = this.pitch) {
    this.body.setTranslation({ x: feetXyz[0], y: feetXyz[1] + this.centerOffset, z: feetXyz[2] }, true);
    this.vy = 0;
    this.yaw = yaw;
    this.pitch = pitch;
    this.clearKeys();
  }
  setMoveInput(forward, right) {
    this.input.forward = clampInput(forward);
    this.input.right = clampInput(right);
  }
  setJump(want) { this.input.jump = Boolean(want); }
  look(yawDelta, pitchDelta) {
    // Camera look is instantaneous and separate from physics; it never
    // touches the capsule translation.
    this.yaw -= yawDelta;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - pitchDelta));
  }
  clearKeys() {
    this.input.forward = 0;
    this.input.right = 0;
    this.input.jump = false;
  }
  pause() {
    this.paused = true;
    this.clearKeys();
    this.accumulator = 0;
  }
  resume() {
    this.paused = false;
    this.accumulator = 0;
    this.clearKeys(); // a resumed session always starts from a clean input state
  }

  // --- stepping ------------------------------------------------------------
  step(dtSeconds) {
    if (this.disposed || this.paused) return;
    this.accumulator += Math.min(dtSeconds, 0.25); // tab-switch spike guard
    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < 8) {
      this.fixedStep(this.fixedDt);
      this.accumulator -= this.fixedDt;
      steps += 1;
    }
  }

  fixedStep(dt) {
    const f = this.input.forward, r = this.input.right;
    const len = Math.hypot(f, r);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // forward = (-sin yaw, 0, -cos yaw); right = (cos yaw, 0, -sin yaw)
    let dx = 0, dz = 0;
    if (len > 0) {
      const k = this.speed / len;
      dx = (-sy * f + cy * r) * k * dt;
      dz = (-cy * f - sy * r) * k * dt;
    }
    const t = this.body.translation();
    if (this.controller.computedGrounded()) {
      this.vy = this.input.jump ? Math.sqrt(2 * GRAVITY * JUMP_HEIGHT) : -1.5; // stick to ground
    } else {
      this.vy -= GRAVITY * dt;
    }
    if (this.excludeColliderHandles.size)
      this.controller.computeColliderMovement(this.collider, { x: dx, y: this.vy * dt, z: dz },
        undefined, undefined, (c) => !this.excludeColliderHandles.has(c.handle));
    else
      this.controller.computeColliderMovement(this.collider, { x: dx, y: this.vy * dt, z: dz });
    const m = this.controller.computedMovement();
    // 手动台阶抬升（见构造函数注释）：autostep 不触发的台缘边接触兜底。
    const wantH = Math.hypot(dx, dz), gotH = Math.hypot(m.x, m.z);
    if (this.groundColliderHandles && wantH > 1e-9 && gotH < wantH * 0.5 &&
        this.controller.computedGrounded() && this.tryManualStepUp(t, dx / wantH, dz / wantH)) {
      this.lastStep = {
        desired: [dx, this.vy * dt, dz],
        corrected: [dx, 0, dz],
        grounded: true,
        manualStepUp: true,
      };
      if (this.input.jump) this.input.jump = false;
      return;
    }
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    this.physics.world.step(); // applies the kinematic movement this step
    this.lastStep = {
      desired: [dx, this.vy * dt, dz],
      corrected: [m.x, m.y, m.z],
      grounded: this.controller.computedGrounded(),
    };
    // consume one-shot jump intent after applying it in a step
    if (this.input.jump && this.controller.computedGrounded()) this.input.jump = false;
  }

  // 前方一步的台缘/接缝检测 + 强制通过：probe 点（胶囊直径 + 6 cm 前方）从脚底 +
  // STEP_UP 高度向下打步行地面。触发前提是水平 desired 被砍半（见 fixedStep），即
  // rapier 已把本步判死；此处放宽为 rise ∈ [-0.06, STEP_UP]（上台沿 / 平走 / 微降
  // 的接缝——湖心亭抱厦地面 mesh 内部接缝与 2 cm 让桥缝都会以近水平法线锁死），
  // 并要求 probe 中点无墙相交（不穿墙）。真墙（probe 打在墙顶高于 STEP_UP）与
  // 悬崖（射线无命中）都不触发。
  tryManualStepUp(t, ux, uz) {
    const feetY = t.y - this.centerOffset;
    const px = t.x + ux * (this.radius * 2 + 0.06), pz = t.z + uz * (this.radius * 2 + 0.06);
    const ray = new this.RAPIER.Ray(
      { x: px, y: feetY + STEP_UP + 0.05, z: pz }, { x: 0, y: -1, z: 0 });
    const hit = this.physics.world.castRay(ray, STEP_UP + 0.7, true,
      undefined, undefined, undefined, undefined,
      (c) => this.groundColliderHandles.has(c.handle));
    if (!hit) return false;
    const stepTop = feetY + STEP_UP + 0.05 - hit.timeOfImpact;
    const rise = stepTop - feetY;
    if (rise < -0.06 || rise > STEP_UP + 0.02) return false;
    // 中点墙检：两段位移的中点处胶囊不得与任何非地面 collider 相交（防穿墙瞬移）
    const mx = t.x + (px - t.x) * 0.5, mz = t.z + (pz - t.z) * 0.5;
    const my = Math.max(stepTop, feetY) + this.centerOffset;
    const shape = new this.RAPIER.Capsule(this.halfHeight, this.radius);
    const probeBody = { x: mx, y: my, z: mz };
    const wall = this.physics.world.intersectionWithShape(probeBody, { x: 0, y: 0, z: 0, w: 1 },
      shape, undefined, undefined, this.collider, undefined,
      (c) => !this.groundColliderHandles.has(c.handle));
    if (wall) return false;
    this.body.setNextKinematicTranslation({ x: px, y: Math.max(stepTop, feetY) + this.centerOffset, z: pz });
    this.physics.world.step();
    this.vy = -1.5;
    return true;
  }

  // --- queries -------------------------------------------------------------
  bodyPosition() {
    const t = this.body.translation();
    return [t.x, t.y, t.z];
  }
  feetPosition() {
    const t = this.body.translation();
    return [t.x, t.y - this.centerOffset, t.z];
  }
  eyePosition() {
    const t = this.body.translation();
    return [t.x, t.y - this.centerOffset + this.eyeHeight, t.z];
  }
  isGrounded() { return this.lastStep ? this.lastStep.grounded : false; }

  // --- teardown ------------------------------------------------------------
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.physics.world.removeCollider(this.collider, true);
    this.physics.world.removeCharacterController(this.controller);
  }
}

function clampInput(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}
