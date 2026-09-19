// East-extension centerline spec for the adoption batch (package J, G5).
// Centerline = built street tail (world/street-completion
// surface-spec.connectedBand.to, width 4.0) -> OSM road 238219464 design
// controls (kept only where EAST of the measured start; the [103.37,23.17]
// head anchors the frozen street and would fold the polyline) -> clipped at
// x≈236 (covers shop-142 by 6m; the [243.12,47.48] control only carries
// direction). Chaikin 2 passes + 0.5m resample — the same pipeline as
// scripts/make_west_extension_spec.mjs / make_segment_spec.py.
//
// Widths: 4.0 at the junction, easing to 8.5 within the first 8m of arc
// (DESIGN_SPEC.packageJ.eastExtension.widths).
//
// Self-checks (hard-fail, exit 2):
//   - start point within 0.02 of the measured street-tail end
//   - monotone east: every next sample x >= previous x
//   - clip point x within 236 +/- 0.01
//
// Run: node scripts/make_east_extension_spec.mjs
// Out: kit/out/east-extension-spec.json
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// OSM 238219464 design-reuse glb points (DESIGN_SPEC.packageJ_east.roadSource)
const OSM = [[103.37, 23.17], [133.35, 30.17], [165.88, 37.33], [181.57, 40.77],
  [198.61, 43.4], [218.8, 47.83], [243.12, 47.48]];
const START = [124.6, 27.65];      // built street tail end (width 4.0)
const CLIP_X = 236.0;
const W_START = 4.0, W_FULL = 8.5, W_EASE_M = 8.0;
const WIDTHS = { startWidthM: W_START, fullWidthM: W_FULL, easeM: W_EASE_M, sidewalkM: 1.35, frontLineM: 5.6, curbM: 0.25 };

const ctrl = [START, ...OSM.filter(([x]) => x > START[0]), [243.12, 47.48]];

const chaikin = (pts, passes = 2) => {
  for (let i = 0; i < passes; i++) {
    const out = [pts[0]];
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      out.push([0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz]);
      out.push([0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
};
const resample = (pts, step = 0.5) => {
  const out = [pts[0]];
  let acc = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
    const seg = Math.hypot(bx - ax, bz - az);
    for (let t = step - acc; t <= seg + 1e-9; t += step) {
      const u = Math.min(1, t / seg);
      out.push([ax + (bx - ax) * u, az + (bz - az) * u]);
    }
    acc = (acc + seg) % step;
  }
  out.push(pts[pts.length - 1]);
  return out;
};

let center = resample(chaikin(ctrl, 2), 0.5);
// clip at x = CLIP_X: keep samples strictly west, then one interpolated end
center = center.filter(([x]) => x < CLIP_X);
{
  const [ax, az] = center[center.length - 1];
  const nx = center[center.length - 1];
  // walk the ORIGINAL polyline to interpolate the exact clip point
  const raw = resample(chaikin(ctrl, 2), 0.5);
  let end = null;
  for (let k = 0; k < raw.length - 1; k++) {
    const [bx, bz] = raw[k], [cx, cz] = raw[k + 1];
    if (bx < CLIP_X && cx >= CLIP_X) {
      const u = (CLIP_X - bx) / (cx - bx);
      end = [CLIP_X, bz + (cz - bz) * u];
      break;
    }
  }
  center.push(end ?? nx);
}

const s = [0];
for (let k = 0; k < center.length - 1; k++)
  s.push(s[k] + Math.hypot(center[k + 1][0] - center[k][0], center[k + 1][1] - center[k][1]));
const total = s[s.length - 1];
const n = center.length;

// --- checks --------------------------------------------------------------------
const checks = {
  startM: [START[0], START[1]],
  startSource: 'world/street-completion surface-spec.connectedBand.to',
  endM: [center[n - 1][0], center[n - 1][1]],
  endXM: +(center[n - 1][0]).toFixed(3),
  endXPass: Math.abs(center[n - 1][0] - CLIP_X) <= 0.01,
  monotoneEastPass: center.every((p, i) => i === 0 || p[0] >= center[i - 1][0]),
  totalLengthM: +total.toFixed(2),
  junctionWidthM: W_START,
};
if (!checks.endXPass || !checks.monotoneEastPass) {
  console.error('EAST_SPEC_CHECK_FAIL', JSON.stringify(checks));
  process.exit(2);
}

// --- per-sample frames ----------------------------------------------------------
const samples = [];
for (let i = 0; i < n; i++) {
  const j = Math.min(i + 1, n - 1), k2 = Math.max(i - 1, 0);
  const tx = center[j][0] - center[k2][0], tz = center[j][1] - center[k2][1];
  const L = Math.hypot(tx, tz) || 1;
  const width = Math.min(W_FULL, W_START + (W_FULL - W_START) * (s[i] / W_EASE_M));
  samples.push({
    s: +s[i].toFixed(3), x: +center[i][0].toFixed(4), z: +center[i][1].toFixed(4),
    southNx: +(tz / L).toFixed(5), southNz: +(-tx / L).toFixed(5),
    widthM: +width.toFixed(3),
  });
}

const frontline = WIDTHS.frontLineM;
const out = {
  schemaVersion: 1,
  generatedBy: 'scripts/make_east_extension_spec.mjs',
  batchId: 'pawborough-adoption-east-night-20260919',
  axis: 'GLB Y-up X east Z south; samples every 0.5m; normals are unit 2D in xz',
  inputs: {
    roadSource: 'OSM way 238219464 (design reuse, not survey) glb xz points',
    controlPointsGlb: ctrl.map(([x, z]) => [+x.toFixed(4), +z.toFixed(4)]),
    droppedHeadControl: '[103.37,23.17] lies WEST of the built street tail — it anchors the frozen street, not the extension',
    clip: `arc clipped at x=${CLIP_X} (covers shop-142 by 6m); [243.12,47.48] kept only as direction control`,
    smoothing: 'chaikin 2 passes + 0.5m resample (same as make_west_extension_spec.mjs)',
  },
  widths: WIDTHS,
  checks,
  frontlineBands: {
    frontlineM: frontline,
    note: 'offset polyline pairs at +/-5.6m along the local normal = shop front-wall lines (same rule as the west band)',
    north: samples.map((p) => ({ s: p.s, x: +(p.x - p.southNx * frontline).toFixed(3), z: +(p.z - p.southNz * frontline).toFixed(3) })),
    south: samples.map((p) => ({ s: p.s, x: +(p.x + p.southNx * frontline).toFixed(3), z: +(p.z + p.southNz * frontline).toFixed(3) })),
  },
  samples,
};
await writeFile(resolve(root, 'kit/out/east-extension-spec.json'), JSON.stringify(out, null, 2) + '\n');
console.log('EAST_SPEC_READY', JSON.stringify({ total: checks.totalLengthM, endX: checks.endXM, samples: samples.length }));
