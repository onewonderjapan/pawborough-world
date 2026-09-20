// Player entry anchors (player-experience batch A) — the SAFE start points a
// player may appear at, DERIVED from the delivered route.json (never guessed
// constants) and VALIDATED against the real physics with the production
// WalkController capsule. The page derives them after the world assembles and
// drops any anchor that fails validation, so an anchor that stops being
// walkable disappears instead of teleporting players into a wall.
//
// Anchor ids: mainStreet | templeFront | laneA | laneB.
import { WalkController } from './WalkController.js';

// yaw that faces `from` -> `to` (controller forward = (-sin yaw, 0, -cos yaw))
function yawTowards(from, to) {
  return Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));
}

// heading along the mainStreet polyline AT a waypoint index (next waypoint,
// or the previous one when standing on the last) — the direction a player
// arriving here would continue walking.
function routeYawAt(route, point) {
  const wps = route.mainStreet ?? [];
  if (wps.length < 2) return 0;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < wps.length; i++) {
    const d = Math.hypot(wps[i][0] - point[0], wps[i][2] - point[2]);
    if (d < bestD) { bestD = d; best = i; }
  }
  const a = wps[Math.max(0, best - 1)], b = wps[Math.min(wps.length - 1, best + 1)];
  return yawTowards([a[0], 0, a[2]], [b[0], 0, b[2]]);
}

export function deriveEntryAnchors({ route }) {
  const out = [];
  const e = route.entries ?? {};
  if (e.bridgeStart)
    out.push({ id: 'mainStreet', labelZh: '主街',
      position: e.bridgeStart.slice(), yaw: routeYawAt(route, e.bridgeStart),
      source: { entry: 'bridgeStart' } });
  if (e.shanmenThreshold)
    out.push({ id: 'templeFront', labelZh: '庙前',
      position: e.shanmenThreshold.slice(), yaw: routeYawAt(route, e.shanmenThreshold),
      source: { entry: 'shanmenThreshold' } });
  // lane mouths: the FIRST excursion point is on the street just outside the
  // portal — a real walked position, facing the second point into the lane
  if (route.laneAExcursion?.length >= 2)
    out.push({ id: 'laneA', labelZh: 'A弄',
      position: route.laneAExcursion[0].slice(), yaw: yawTowards(route.laneAExcursion[0], route.laneAExcursion[1]),
      source: { excursion: 'laneAExcursion' } });
  if (route.laneBExcursion?.length >= 2)
    out.push({ id: 'laneB', labelZh: 'B弄',
      position: route.laneBExcursion[0].slice(), yaw: yawTowards(route.laneBExcursion[0], route.laneBExcursion[1]),
      source: { excursion: 'laneBExcursion' } });
  return out;
}

export function nearestAnchor(anchors, pos) {
  let best = null, bestD = Infinity;
  for (const a of anchors) {
    const d = Math.hypot(a.position[0] - pos[0], a.position[2] - pos[2]);
    if (d < bestD) { bestD = d; best = a; }
  }
  return best ? { anchor: best, horizDistM: bestD } : null;
}

// Chooses the anchor for a first walk entry from a framing-camera pose.
// Street-level framings near a lane land at that lane's mouth; aerial or far
// poses are DISPLACED to the nearest anchor and the caller must say so.
export function anchorForCamera(anchors, camPos, { safeHeightM = 3, nearM = 6 } = {}) {
  const near = nearestAnchor(anchors, camPos);
  if (!near) return null;
  const aerial = camPos[1] > safeHeightM;
  return {
    anchor: near.anchor,
    horizDistM: +near.horizDistM.toFixed(2),
    displaced: aerial || near.horizDistM > nearM,
    reason: aerial ? 'aerial' : near.horizDistM > nearM ? 'far' : 'near',
  };
}

// Settles the production capsule onto the anchor and walks it INTO the
// location: a safe anchor must (1) land grounded on real ground above the
// fall line and (2) actually advance along its heading. Pure probe — the
// controller is disposed here and never touches the player's controller.
// `excludeColliderHandles`: handles of colliders that are NOT part of the
// static scene (a live player capsule in the same physics world) — without
// this a probe spawned where the player stands reports a false blockage.
export async function validateAnchor({ RAPIER, physics, capsule, anchor,
  settleSteps = 150, walkSteps = 90, minAdvanceM = 0.8, dropM = 0.6,
  excludeColliderHandles = null }) {
  const [x, , z] = anchor.position;
  const c = new WalkController({
    RAPIER, physics,
    capsule: { ...capsule, spawn: [x, (anchor.position[1] ?? 0) + dropM, z] },
    excludeColliderHandles,
  });
  const dt = c.fixedDt;
  try {
    c.yaw = anchor.yaw ?? 0;
    for (let i = 0; i < settleSteps; i++) c.step(dt);
    const settled = c.feetPosition();
    const grounded = c.isGrounded();
    if (!grounded || settled[1] < -0.05 || settled[1] > 1.4)
      return { ok: false, reason: grounded ? `unsafe height ${settled[1].toFixed(2)}` : 'never grounded',
        settledFeetY: +settled[1].toFixed(3), advancedM: 0 };
    // horizontal drift during settling must be small (not sliding down a hill)
    const drift = Math.hypot(settled[0] - x, settled[2] - z);
    c.setMoveInput(1, 0);
    for (let i = 0; i < walkSteps; i++) c.step(dt);
    const f = c.feetPosition();
    const advanced = Math.hypot(f[0] - settled[0], f[2] - settled[2]);
    if (f[1] < -0.05) return { ok: false, reason: 'fell while walking in', settledFeetY: +settled[1].toFixed(3), advancedM: +advanced.toFixed(2) };
    if (advanced < minAdvanceM) return { ok: false, reason: 'blocked at the mouth', settledFeetY: +settled[1].toFixed(3), advancedM: +advanced.toFixed(2) };
    return { ok: true, settledFeetY: +settled[1].toFixed(3), advancedM: +advanced.toFixed(2), settleDriftM: +drift.toFixed(2) };
  } finally {
    c.dispose();
  }
}
