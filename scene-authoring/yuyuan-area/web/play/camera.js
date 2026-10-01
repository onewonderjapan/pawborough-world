// Play-phase 1 third-person camera. DOM-free/Rapier-free math so node tests
// drive the exact placement code; the browser injects castRay (a real Rapier
// ray that EXCLUDES the player's own capsule — web/play/install.js).
//
// Contract:
//   - the camera pivots at feet + shoulderHeight and sits BEHIND the model
//     (opposite the WalkController forward), looking at the pivot
//   - the desired placement is ray-checked: a wall between pivot and camera
//     retracts the camera to (hit - margin), never through geometry, and the
//     distance floors at minDistance so the camera can never collapse onto
//     the player
//   - the camera is a pure follower: it NEVER writes the player's physics
//     position, and illegal dt (NaN/negative) is a no-op instead of NaN soup
import * as THREE from 'three';

// Pure placement: pivot + unit dir * clamped distance. hitT = distance from
// pivot to the first wall along dir (null/NaN = clear line).
// R1 (review R0-1): occlusion safety beats the comfort floor — with a wall on
// the line the applied distance is (hitT - margin), however small; the
// minDistance floor only applies on a CLEAR line. A wall closer than the
// margin clamps to the tiny minSafe floor (>= 0), never through the wall,
// never negative; near-player hiding is handled by the caller.
export function computeCameraPlacement({ pivot, dir, distance, hitT = null, margin = 0.12, minDistance = 0.5, minSafe = 0.02 }) {
  let d;
  if (hitT !== null && Number.isFinite(hitT)) {
    d = Math.max(minSafe, Math.min(distance, hitT - margin));
  } else {
    d = Math.max(minDistance, distance);
  }
  return {
    applied: d,
    position: new THREE.Vector3().copy(pivot).addScaledVector(dir, d),
  };
}

export class PlayCamera {
  constructor({ camera, shoulderHeight = 0.62, distance = 2.4, margin = 0.12, minDistance = 0.5, minSafe = 0.02 }) {
    this.camera = camera;
    this.shoulderHeight = shoulderHeight;
    this.distance = distance;
    this.margin = margin;
    this.minDistance = minDistance;
    this.minSafe = minSafe;
    this.pivot = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._look = new THREE.Vector3();
  }

  // controller: the WalkController (feetPosition/yaw/pitch). castRay:
  // (originVector3, dirVector3, maxToi) => timeOfImpact | null. Returns the
  // applied placement { applied, position }.
  update({ controller, castRay = null, dt }) {
    if (!controller) return null;
    // a non-finite or negative frame time must never move the camera
    if (dt !== undefined && (!Number.isFinite(dt) || dt < 0)) return null;
    const feet = controller.feetPosition();
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
    return place;
  }
}
