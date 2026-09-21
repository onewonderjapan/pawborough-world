// world-preview entry data — derived from the DELIVERED route.json only.
// The four player start points mirror src/player/entryAnchors.js rules
// (bridgeStart / shanmenThreshold / first two lane-excursion points) so the
// homepage never invents coordinates; the game page re-validates whatever it
// receives through ?entry= against the real physics before spawning.
// tests/world-preview.test.mjs pins this module to the same output as
// deriveEntryAnchors on the real v7 route.

export const DATASET_ID = 'fangbang-temple-v7';
export const GAME_URL_BASE = `fangbang.html?ds=${DATASET_ID}`;

// yaw that faces `from` -> `to` (controller forward = (-sin yaw, 0, -cos yaw));
// identical formula to entryAnchors.yawTowards
function yawTowards(from, to) {
  return Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));
}

export function derivePreviewAnchors(route, templeYawRad = null) {
  const out = [];
  const e = route.entries ?? {};
  if (e.bridgeStart)
    out.push({ id: 'mainStreet', position: e.bridgeStart.slice(),
      yaw: previewRouteYaw(route, e.bridgeStart), source: 'route.entries.bridgeStart' });
  if (route.laneAExcursion?.length >= 2)
    out.push({ id: 'laneA', position: route.laneAExcursion[0].slice(),
      yaw: yawTowards(route.laneAExcursion[0], route.laneAExcursion[1]),
      source: 'route.laneAExcursion[0..1]' });
  if (route.laneBExcursion?.length >= 2)
    out.push({ id: 'laneB', position: route.laneBExcursion[0].slice(),
      yaw: yawTowards(route.laneBExcursion[0], route.laneBExcursion[1]),
      source: 'route.laneBExcursion[0..1]' });
  if (e.shanmenThreshold)
    out.push({ id: 'templeFront', position: e.shanmenThreshold.slice(),
      yaw: previewTempleFrontYaw(route, e.shanmenThreshold, templeYawRad),
      source: 'route.entries.shanmenThreshold' });
  return out;
}

// REL-04 (world-reliability 20260921): same rule as entryAnchors.deriveEntry
// Anchors — face INTO the temple along the actual gate axis (yaw = placement
// yawRad) when it is known; the v7 zigzag degenerates the route-only rule to
// -π (facing out through the door, back to the temple).
function previewTempleFrontYaw(route, point, templeYawRad) {
  if (templeYawRad === null || templeYawRad === undefined || !Number.isFinite(templeYawRad))
    return previewRouteYaw(route, point);
  return templeYawRad;
}

// heading of the mainStreet polyline at the closest waypoint (same rule as
// entryAnchors.routeYawAt: direction toward the next waypoint, or the previous
// one when standing on the last)
function previewRouteYaw(route, point) {
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

// game URL: relative so the homepage works from the workspace dev server AND
// from the portable package root. config is 'default' | 'allOn'; the default
// NEVER carries skins/props flags. An empty entryId yields the plain game URL
// (the game page keeps its own default entry behavior).
export function gameUrl(entryId, config = 'default') {
  const [path, query] = GAME_URL_BASE.split('?');
  const sp = new URLSearchParams(query);
  if (entryId) sp.set('entry', entryId);
  if (config === 'allOn') { sp.set('skins', '1'); sp.set('props', '1'); }
  return `${path}?${sp.toString()}`;
}
