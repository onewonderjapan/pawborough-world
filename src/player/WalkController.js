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
  constructor({ RAPIER, physics, capsule, excludeColliderHandles = null }) {
    this.RAPIER = RAPIER;
    this.physics = physics;
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
