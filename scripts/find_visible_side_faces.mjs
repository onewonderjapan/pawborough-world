// M1 — visible side/rear face survey (street-sidefaces package).
//
// Samples the delivered bridge route (world/fangbang-temple/route.json) every
// 2 m at eye height 1.6, and ray-tests EVERY side / rear / gable wall box of
// every street module against the sample eyes. A wall is VISIBLE when at least
// one eye->wall-face segment reaches it without passing through any OTHER
// collider first (same-module records are ignored — they are the wall's own
// body). Segment-vs-OBB via the slab method in the box's local frame.
//
// Sources of wall records:
//   world/collision-world.json                         (16 street facades)
//   world/east-edge/east-shop-12[89]/collision.json    (tail shops, per-module)
//   world/street-completion/east-shop-13[0-3]/collision.json
//
// Output: kit/out/sidefaces/targets.json — one entry per visible face with
// occlusion evidence. Run: node scripts/find_visible_side_faces.mjs
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EYE_Y = 1.6;
const STEP_M = 2.0;

// --- route polyline sampling ---------------------------------------------------
const route = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple/route.json'), 'utf8'));
const eyes = [];
{
  const pts = route.mainStreet;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const n = Math.max(1, Math.round(d / STEP_M));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      eyes.push([a[0] + (b[0] - a[0]) * t, EYE_Y, a[2] + (b[2] - a[2]) * t]);
    }
  }
  eyes.push([...pts[pts.length - 1]]);
}

// --- wall records ---------------------------------------------------------------
const isWallName = (n) => /side|back-wall|rear|gable/.test(n)
  && !/floor|interior|plinth|door|counter|sill|post|shelf|bed|stair|partition|inner/.test(n);
const boxes = [];      // wall targets (side/back/rear/gable)
const occluders = [];  // ALL solid records — buildings block rays with their bodies
const pushBox = (name, group, rec) => {
  if (isWallName(name)) {
    addBox(boxes, name, group, rec);
  }
  if (!/floor$|interior|mural-back-wall/.test(name) || isWallName(name)) {
    addBox(occluders, name, group, rec);
  }
};
const addBox = (list, name, group, rec) => {
  let pos = [0, 0, 0], theta = 0, center, size;
  if (rec.obb) ({ pos, theta, center, size } = rec.obb);
  else {
    center = [(rec.min[0] + rec.max[0]) / 2, (rec.min[1] + rec.max[1]) / 2, (rec.min[2] + rec.max[2]) / 2];
    size = [rec.max[0] - rec.min[0], rec.max[1] - rec.min[1], rec.max[2] - rec.min[2]];
  }
  const c = Math.cos(theta), s = Math.sin(theta);
  const wx = pos[0] + c * center[0] + s * center[2];
  const wz = pos[2] - s * center[0] + c * center[2];
  const wy = center[1] + (pos[1] ?? 0);
  list.push({
    name, group,
    center: [wx, wy, wz], yaw: theta, half: [size[0] / 2, size[1] / 2, size[2] / 2],
  });
};
{
  const street = JSON.parse(await readFile(resolve(root, 'world/collision-world.json'), 'utf8'));
  for (const rec of street.colliders) {
    const [mod, ...rest] = rec.name.split(':');
    pushBox(rest.join(':'), mod, rec);
  }
  for (const dir of ['world/east-edge', 'world/street-completion']) {
    const dsDir = resolve(root, dir);
    const entries = await readFile(dsDir + '/review-manifest.json', 'utf8'); // exists gate
    for (const f of (await (await import('node:fs/promises')).readdir(dsDir))) {
      if (!f.startsWith('east-shop-')) continue;
      const col = JSON.parse(await readFile(resolve(dsDir, f, 'collision.json'), 'utf8'));
      for (const rec of col.colliders) {
        const [mod, ...rest] = rec.name.split(':');
        pushBox(rest.join(':'), mod, rec);
      }
    }
  }
}

// --- segment vs OBB (slab method in box space) ----------------------------------
function segmentHitsBox(p, q, box) {
  // transform to box local frame
  const c = Math.cos(box.yaw), s = Math.sin(box.yaw);
  const px = p[0] - box.center[0], pz = p[2] - box.center[2];
  const qx = q[0] - box.center[0], qz = q[2] - box.center[2];
  const pl = [c * px - s * pz, p[1] - box.center[1], s * px + c * pz];
  const ql = [c * qx - s * qz, q[1] - box.center[1], s * qx + c * qz];
  const d = [ql[0] - pl[0], ql[1] - pl[1], ql[2] - pl[2]];
  let tmin = 0, tmax = 1;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (Math.abs(pl[a]) > box.half[a]) return false;
    } else {
      let t1 = (-box.half[a] - pl[a]) / d[a], t2 = (box.half[a] - pl[a]) / d[a];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true; // segment intersects the box
}

// sample points: centers of the two largest-area faces + the 4 vertical edges' midpoints
function faceSamples(box) {
  // 3-across x 2-vertical grid on each of the two large faces + face centers,
  // so narrow-gap sight lines (lane mouths) are caught by near-edge samples
  const [hx, hy, hz] = box.half;
  const c = Math.cos(box.yaw), s = Math.sin(box.yaw);
  const local = [];
  const across = [-0.8, 0, 0.8];
  const up = [-hy * 0.35, hy * 0.25];
  for (const a of across) for (const u of up) {
    if (hx >= hz) { local.push([hx, u, a * hz], [-hx, u, a * hz]); }
    else { local.push([a * hx, u, hz], [a * hx, u, -hz]); }
  }
  return local.map(([lx, ly, lz]) => [
    box.center[0] + c * lx + s * lz,
    box.center[1] + ly,
    box.center[2] - s * lx + c * lz,
  ]);
}

// --- visibility pass -------------------------------------------------------------
const results = [];
for (const box of boxes) {
  // skip walls deep inside blocks: only faces whose module sits near the route
  // are candidates anyway; the ray test decides
  const samples = faceSamples(box);
  let visibleEyes = 0;
  let best = null;
  for (const eye of eyes) {
    for (const sp of samples) {
      const dist = Math.hypot(sp[0] - eye[0], sp[2] - eye[2]);
      if (dist < 2 || dist > 90) continue;
      let occludedBy = null;
      for (const other of occluders) {
        if (other.group === box.group) continue;
        // cheap broad phase: segment AABB vs occluder bounding sphere
        const r = Math.hypot(other.half[0], other.half[1], other.half[2]);
        const minx = Math.min(eye[0], sp[0]) - r, maxx = Math.max(eye[0], sp[0]) + r;
        const minz = Math.min(eye[2], sp[2]) - r, maxz = Math.max(eye[2], sp[2]) + r;
        if (other.center[0] < minx || other.center[0] > maxx
          || other.center[2] < minz || other.center[2] > maxz) continue;
        if (segmentHitsBox(eye, sp, other)) { occludedBy = other.name; break; }
      }
      if (!occludedBy) {
        visibleEyes++;
        if (!best || dist < best.dist) best = { eye: eye.map((v) => +v.toFixed(2)), sample: sp.map((v) => +v.toFixed(2)), dist: +dist.toFixed(1) };
      }
      if (visibleEyes >= 5) break;
    }
    if (visibleEyes >= 5) break;
  }
  if (visibleEyes > 0) {
    results.push({ module: box.group, record: box.name, center: box.center.map((v) => +v.toFixed(2)),
      half: box.half.map((v) => +v.toFixed(2)), yaw: +box.yaw.toFixed(4),
      visibleEyes: best, evidence: `unobstructed eye->face segment(s) exist; nearest eye ${best.dist}m` });
  }
}

results.sort((a, b) => a.module.localeCompare(b.module) || a.record.localeCompare(b.record));
// --- target selection (PLAN package 2): the faces worth skinning -------------
// N01 west gable; lane-A mouth flanks (N05 + N06); lane-B mouth flanks
// (S05 + S07) — each flank = its lane-facing gable + the first 6 m of rear
// wall toward the lane; east tail 133 east gable.
const LANE_A = [43.5, -16.5], LANE_B = [57.5, 13.7];
const distTo = (box, p) => Math.hypot(box.center[0] - p[0], box.center[2] - p[1]);
const surveyOf = (mod, rec) => results.find((r) => r.module === mod && r.record === rec);
const pickSide = (mod, side) => {
  // the module's own two side records: choose the one whose center sits on the
  // requested world side (min x for 'west', max x for 'east' when the lane is
  // along z, judged purely by distance to the lane mouth otherwise)
  const sides = results.filter((r) => r.module === mod && /side/.test(r.record));
  return sides.sort((a, b) => distTo(a, side) - distTo(b, side))[0];
};
const pickRear = (mod, lane) => {
  const backs = results.filter((r) => r.module === mod && /back-wall|rear-wall/.test(r.record));
  return backs.sort((a, b) => distTo(a, lane) - distTo(b, lane))[0];
};
const n01 = results.filter((r) => r.module === 'N01-plain-v1' && /side/.test(r.record))
  .sort((a, b) => a.center[0] - b.center[0])[0]; // west-most side wall
const selectedTargets = [];
if (n01) selectedTargets.push({ place: 'N01-west-gable', module: n01.module, faces: [n01] });
for (const [place, mod, lane, other] of [
  ['laneA-west-flank', 'N05-restaurant-a', LANE_A, 'east'],
  ['laneA-east-flank', 'N06-curio-a', LANE_A, 'west'],
  ['laneB-west-flank', 'S05-plain-v3', LANE_B, 'east'],
  ['laneB-east-flank', 'S07-plain-v2', LANE_B, 'west'],
]) {
  const gable = pickSide(mod, lane);
  const rear = pickRear(mod, lane);
  selectedTargets.push({ place, module: mod, faces: [gable, rear].filter(Boolean),
    rearNote: 'skin covers the first 6 m of the rear wall adjacent to the lane mouth' });
}
{
  const g = results.filter((r) => r.module === 'east-shop-133' && r.record.includes('gable-wall-east-b0s0')
    || r.module === 'east-shop-133' && /gable-wall-east/.test(r.record));
  const east = g.sort((a, b) => distTo(a, [124, 28]) - distTo(b, [124, 28]))[0];
  if (east) selectedTargets.push({ place: 'east-tail-133-east-gable', module: east.module, faces: [east],
    note: 'foundation-gable-east is the same wall in the foundation band; one skin covers the full gable' });
}

const out = {
  source: 'world/fangbang-temple/route.json + delivered street/east-edge/street-completion collision sidecars',
  method: 'route sampled every 2m at eye 1.6; wall face samples ray-tested against ALL other module solid boxes (slab OBB, proper inverse rotation); unobstructed = visible',
  eyesSampled: eyes.length,
  wallsTested: boxes.length,
  occluders: occluders.length,
  selectedTargets,
  selectionNote: 'the PLAN package-2 set: N01 west gable, lane-A/B mouth flanks (gable + rear first 6m each), east tail 133 east gable; per-face ray evidence below in visibleFaces',
  visibleFaces: results,
};
await mkdir(resolve(root, 'kit/out/sidefaces'), { recursive: true });
await writeFile(resolve(root, 'kit/out/sidefaces/targets.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`SIDEFACE_SURVEY eyes=${eyes.length} walls=${boxes.length} visibleFaces=${results.length} selected=${selectedTargets.length} places`);
for (const t of selectedTargets)
  console.log(`  PLACE ${t.place} (${t.module}): ${t.faces.map((f) => `${f.record}@${f.visibleEyes.dist}m`).join(', ') || 'NOT VISIBLE'}`);
