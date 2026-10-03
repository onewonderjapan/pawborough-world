// Play-phase 1 third-person camera. DOM-free/Rapier-free math so node tests
// drive the exact placement code; the browser injects castRay (a real Rapier
// ray that EXCLUDES the player's own capsule — web/play/install.js).
//
// Contract:
//   - the camera pivots at feet + shoulderHeight and sits BEHIND the model
//     (opposite the WalkController forward), looking at the pivot
//   - the desired placement is ray-checked: a wall between pivot and camera
//     retracts the camera to (hit - margin), never through geometry, and the
//     comfort floor applies only when unobstructed; collision clearance
//     always wins, and an obstructed camera may retract to the pivot
//   - the camera is a pure follower: it NEVER writes the player's physics
//     position, and illegal dt (NaN/negative) is a no-op instead of NaN soup
import * as THREE from 'three';

// Pure placement: pivot + unit dir * clamped distance. hitT = distance from
// pivot to the first wall along dir (null/NaN = clear line).
// R1 (review R0-1): occlusion safety beats the comfort floor — with a wall on
// the line the applied distance is (hitT - margin), however small; the
// minDistance floor only applies on a CLEAR line. A wall closer than the
// margin retracts to the pivot (zero clearance), never through the wall,
// never negative; near-player hiding is handled by the caller. minSafe stays
// accepted for compatibility, but cannot override collision clearance.
export function computeCameraPlacement({ pivot, dir, distance, hitT = null, margin = 0.12, minDistance = 0.5, minSafe = 0.02 }) {
  let d;
  if (hitT !== null && Number.isFinite(hitT)) {
    d = Math.max(0, Math.min(distance, hitT - margin));
  } else {
    d = Math.max(minDistance, distance);
  }
  return {
    applied: d,
    position: new THREE.Vector3().copy(pivot).addScaledVector(dir, d),
  };
}

export class PlayCamera {
  constructor({
    camera,
    shoulderHeight = 0.62,
    distance = 2.4,
    margin = 0.12,
    minDistance = 0.5,
    minSafe = 0.02,
    foodDistance = 1.15,
    foodShoulderHeight = 0.54,
    foodYawOffset = Math.PI,
    foodPitchOffset = -0.06,
    foodMinDistance = 0.25,
  }) {
    this.camera = camera;
    this.shoulderHeight = shoulderHeight;
    this.distance = distance;
    this.margin = margin;
    this.minDistance = minDistance;
    this.minSafe = minSafe;
    this.pivot = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._look = new THREE.Vector3();

    // Food inspection view state (U03)
    this.viewMode = 'follow';
    this.foodDistance = foodDistance;
    this.foodShoulderHeight = foodShoulderHeight;
    this.foodYawOffset = foodYawOffset;
    this.foodPitchOffset = foodPitchOffset;
    this.foodMinDistance = foodMinDistance;
    this.lastPlacement = null;
  }

  setViewMode(mode) {
    this.viewMode = mode === 'food' ? 'food' : 'follow';
    return this.viewMode;
  }

  toggleFoodView() {
    return this.setViewMode(this.viewMode === 'food' ? 'follow' : 'food');
  }

  isFoodView() {
    return this.viewMode === 'food';
  }

  // controller: the WalkController (feetPosition/yaw/pitch). castRay:
  // (originVector3, dirVector3, maxToi) => timeOfImpact | null. Returns the
  // applied placement { applied, position }.
  update({ controller, castRay = null, dt, facingYaw = null }) {
    if (!controller) return null;
    // a non-finite or negative frame time must never move the camera
    if (dt !== undefined && (!Number.isFinite(dt) || dt < 0)) return null;
    const feet = controller.feetPosition();
    const isFood = this.viewMode === 'food';

    if (isFood) {
      this.pivot.set(feet[0], feet[1] + this.foodShoulderHeight, feet[2]);
      const baseYaw = facingYaw !== null && facingYaw !== undefined ? facingYaw : controller.yaw;
      const camYaw = baseYaw + this.foodYawOffset;
      const camPitch = Math.max(-0.25, Math.min(0.25, (controller.pitch ?? 0) * 0.3 + this.foodPitchOffset));
      this._dir.set(
        Math.cos(camPitch) * Math.sin(camYaw),
        -Math.sin(camPitch),
        Math.cos(camPitch) * Math.cos(camYaw),
      );
      const hitT = castRay ? castRay(this.pivot, this._dir, this.foodDistance) : null;
      const place = computeCameraPlacement({
        pivot: this.pivot, dir: this._dir, distance: this.foodDistance,
        hitT, margin: this.margin, minDistance: this.foodMinDistance, minSafe: this.minSafe,
      });
      this.camera.position.copy(place.position);
      this._look.copy(this.pivot);
      this.camera.lookAt(this._look);
      this.lastPlacement = { ...place, mode: 'food', hitT };
      return place;
    } else {
      this.pivot.set(feet[0], feet[1] + this.shoulderHeight, feet[2]);
      const { yaw, pitch } = controller;
      // behind the model = opposite the controller forward (-sin yaw, -cos yaw),
      // orbiting with pitch (same Euler convention as applyWalkOrientation)
      this._dir.set(
        Math.cos(pitch) * Math.sin(yaw),
        -Math.sin(pitch),
        Math.cos(pitch) * Math.cos(yaw),
      );
      const hitT = castRay ? castRay(this.pivot, this._dir, this.distance) : null;
      const place = computeCameraPlacement({
        pivot: this.pivot, dir: this._dir, distance: this.distance,
        hitT, margin: this.margin, minDistance: this.minDistance, minSafe: this.minSafe,
      });
      this.camera.position.copy(place.position);
      this._look.copy(this.pivot);
      this.camera.lookAt(this._look);
      this.lastPlacement = { ...place, mode: 'follow', hitT };
      return place;
    }
  }
}
