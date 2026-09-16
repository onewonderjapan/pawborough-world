// F2-02 numeric sight-line check for the lane-b-detail camera (node-side,
// real geometry). Loads the ACTUAL world/laneb/laneb.glb bytes via the
// production glbReader and ray-casts a grid across the real client frustum
// (same fov formula as main.js setView, sensorFit HORIZONTAL) to measure
// what the frame actually sees: near-field occluder fraction, first-hit
// depth map, and whether the target point itself is directly visible.
//
// This complements (never replaces) the browser screenshot evidence.
//
// Run: node tools/f2_detail_raycheck.mjs [--pose both|design|current]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb, transformPoint } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => process.argv.indexOf(n) >= 0 ? process.argv[process.argv.indexOf(n) + 1] : d;
const POSE = arg('--pose', 'both');
const OUT_DIR = resolve(root, arg('--out', '../artifacts/fix-f2'));

// poses under test (GLB world coords; fov from 35mm on 36mm sensor, HORIZONTAL fit)
const LENS = 35, SENSOR = 36, RES = [1280, 800];
const POSES = {
  current: { // N5 pose — the one the lead found blocked
    id: 'lane-b-detail@5c3ed9c (old)',
    positionGlb: [59.24, 1.45, 12.72],
    targetGlb: [57.418, 1.3, 14.2485],
  },
  design: { // lead design starting pose (detail-camera-design.json)
    id: 'lane-b-detail@lead-design',
    positionGlb: [56.274215, 1.24, 15.681755],
    targetGlb: [57.74737, 0.34, 14.58984],
  },
};

// --- bake world-space triangle soup from the real GLB -----------------------
const glbBuf = await readFile(resolve(root, 'world/laneb/laneb.glb'));
const glb = readGlb(glbBuf);
const pos = [];
const triCount = glb.meshes.reduce((s, m) => s + m.indices.length / 3, 0);
for (const m of glb.meshes) {
  for (let i = 0; i < m.indices.length; i += 3) {
    for (const k of [m.indices[i], m.indices[i + 1], m.indices[i + 2]]) {
      pos.push(...transformPoint(m.matrix, [m.positions[k * 3], m.positions[k * 3 + 1], m.positions[k * 3 + 2]]));
    }
  }
}
const PX = new Float64Array(pos);
console.log(`[raycheck] baked ${triCount} triangles from laneb.glb (sha-bound manifest: world/laneb/review-manifest.json)`);

// Möller–Trumbore, single-sided off; returns t>0 or Infinity
const EPS = 1e-9;
function rayTri(ox, oy, oz, dx, dy, dz, i) {
  const i0 = i * 9;
  const e1x = PX[i0 + 3] - PX[i0], e1y = PX[i0 + 4] - PX[i0 + 1], e1z = PX[i0 + 5] - PX[i0 + 2];
  const e2x = PX[i0 + 6] - PX[i0], e2y = PX[i0 + 7] - PX[i0 + 1], e2z = PX[i0 + 8] - PX[i0 + 2];
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -EPS && det < EPS) return Infinity;
  const inv = 1 / det;
  const tx = ox - PX[i0], ty = oy - PX[i0 + 1], tz = oz - PX[i0 + 2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return Infinity;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return Infinity;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > EPS ? t : Infinity;
}
function firstHit(o, d, maxT) {
  let best = Infinity;
  for (let i = 0; i < triCount; i++) {
    const t = rayTri(o[0], o[1], o[2], d[0], d[1], d[2], i);
    if (t < best) best = t;
    if (best < maxT * 0.25 && false) break; // no early-out: need exact nearest for depth stats
  }
  return best;
}

// --- frustum setup identical to main.js setView ------------------------------
function castGrid(p) {
  const aspect = RES[0] / RES[1];
  const vfov = 2 * Math.atan(SENSOR / 2 / LENS / aspect); // three.js fov is vertical
  const fwd = norm(sub(p.targetGlb, p.positionGlb));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const halfH = Math.tan(vfov / 2), halfW = halfH * aspect;
  const targetDist = len(sub(p.targetGlb, p.positionGlb));
  const GW = 45, GH = 29;
  let rows = [], blockedNear = 0, targetVisible = null, reachSubject = 0, centerHit = null;
  for (let gy = 0; gy < GH; gy++) {
    let row = '';
    for (let gx = 0; gx < GW; gx++) {
      const sx = ((gx + 0.5) / GW * 2 - 1) * halfW;
      const sy = (1 - (gy + 0.5) / GH * 2) * halfH;
      const d = norm([fwd[0] + right[0] * sx + up[0] * sy, fwd[1] + right[1] * sx + up[1] * sy, fwd[2] + right[2] * sx + up[2] * sy]);
      const t = firstHit(p.positionGlb, d, targetDist * 3);
      // classify by first-hit distance vs the subject plane (target distance)
      if (t === Infinity) { row += ' '; continue; }              // sky/background
      const hitPt = [p.positionGlb[0] + d[0] * t, p.positionGlb[1] + d[1] * t, p.positionGlb[2] + d[2] * t];
      if (t < targetDist * 0.75) { blockedNear++; row += '#'; continue; }  // near occluder
      if (Math.abs(t - targetDist) <= 0.9) { reachSubject++; row += '+'; continue; } // subject depth band
      row += '.';                                                // world behind subject
      void hitPt;
    }
    rows.push(row);
  }
  if (targetVisible === null) {
    // "target visible" = nothing occludes the aim point: the center ray must
    // reach at least the target distance (grazing past onto ground behind it
    // is fine — the aim point floats, the view is still unobstructed)
    const dCenter = norm(sub(p.targetGlb, p.positionGlb));
    const tCenter = firstHit(p.positionGlb, dCenter, targetDist * 3);
    targetVisible = tCenter >= targetDist - 0.05;
    centerHit = Number.isFinite(tCenter) ? { t: +tCenter.toFixed(4), point: [0, 1, 2].map(k => +(p.positionGlb[k] + dCenter[k] * tCenter).toFixed(3)) } : { t: null, point: null };
  }
  const total = GW * GH;
  return {
    pose: p.id, positionGlb: p.positionGlb, targetGlb: p.targetGlb,
    lensMm: LENS, sensorWidthMm: SENSOR, resolution: RES,
    targetDistanceM: +targetDist.toFixed(4),
    targetPointOccluded: !targetVisible,
    centerRayFirstHit: centerHit,
    nearOccluderFraction: +(blockedNear / total).toFixed(4),
    subjectBandFraction: +(reachSubject / total).toFixed(4),
    depthMap: rows, // '#' near occluder, '+' subject depth band, '.' world behind, ' ' sky
  };
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function len(a) { return Math.hypot(a[0], a[1], a[2]); }
function norm(a) { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

const results = [];
for (const key of POSE === 'both' ? ['current', 'design'] : [POSE]) {
  const r = castGrid(POSES[key]);
  results.push(r);
  console.log(`\n=== ${r.pose} ===`);
  console.log(`target distance ${r.targetDistanceM} m | near-occluder ${(r.nearOccluderFraction * 100).toFixed(1)}% of frame | subject band ${(r.subjectBandFraction * 100).toFixed(1)}% | target point occluded: ${r.targetPointOccluded}`);
  console.log(r.depthMap.map((row, i) => (i === 0 ? 'top of frame ' : '             ') + row).join('\n'));
}
await mkdir(OUT_DIR, { recursive: true });
const out = resolve(OUT_DIR, 'detail-raycheck.json');
await writeFile(out, JSON.stringify({ what: 'F2-02 node-side sight-line raycheck against real laneb.glb geometry', glbTriangles: triCount, at: new Date().toISOString(), results }, null, 2) + '\n');
console.log(`\n[raycheck] written ${out}`);
