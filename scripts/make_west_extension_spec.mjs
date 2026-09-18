// West-extension centerline spec for the fangbang-temple bridge batch.
// Centerline = measured frozen-road west wedge midpoint (west-wedge.json)
// -> DESIGN_SPEC.westExtension control points (roadCenterlineGlbWestOfStreet,
// kept only where they lie WEST of the measured start; the (0.04,-0.01)
// junction control is ~1.9m EAST of the wedge mid and would fold the
// polyline back) -> westEndGlb. Chaikin 2 passes + 0.5m resample, identical
// to scripts/make_segment_spec.py / kit/build_street_completion_surface.py.
//
// Self-checks (hard-fail, exit 2):
//   - map foot point (footOnCenterlineGlb) within 0.10m of the centerline
//   - total length within 156 +/- 3m  (wedge->foot 132 +/- 3 plus 24m tail)
//
// Run: node scripts/make_west_extension_spec.mjs
// Out: kit/out/fangbang-temple/west-extension-spec.json
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TASK = resolve(root, '../../pawborough-fangbang-temple-bridge-night-20260916');
const wedge = JSON.parse(await readFile(resolve(root, 'kit/out/fangbang-temple/west-wedge.json'), 'utf8'));
const spec = JSON.parse(await readFile(resolve(TASK, 'DESIGN_SPEC.json'), 'utf8'));
const WE = spec.westExtension;
const REG = spec.mapRegistration;

const mid = wedge.westEnd.midpoint;           // [x, y, z]
const westEndX = WE.westEndGlb[0];
const ctrl = [[mid[0], mid[2]],
  // keep documented controls that lie between the measured start and the
  // west end: (0.04,-0.01) is ~1.9m EAST of the wedge mid (frozen-street
  // anchor, would fold the line), (-167.95,45.71) is beyond westEndGlb
  ...REG.roadCenterlineGlbWestOfStreet.filter(([x]) => x < mid[0] && x >= westEndX),
  [westEndX, WE.westEndGlb[2]]];

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

const center = resample(chaikin(ctrl, 2), 0.5);
const s = [0];
for (let k = 0; k < center.length - 1; k++)
  s.push(s[k] + Math.hypot(center[k + 1][0] - center[k][0], center[k + 1][1] - center[k][1]));
const total = s[s.length - 1];
const n = center.length;

const segDist = ([ax, az], [bx, bz], [px, pz]) => {
  const vx = bx - ax, vz = bz - az;
  const l2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2));
  return { d: Math.hypot(px - (ax + t * vx), pz - (az + t * vz)), t };
};

// --- checks ------------------------------------------------------------------
const foot = [REG.footOnCenterlineGlb[0], REG.footOnCenterlineGlb[2]];
let footBest = { d: Infinity };
for (let k = 0; k < n - 1; k++) {
  const { d, t } = segDist(center[k], center[k + 1], foot);
  if (d < footBest.d) footBest = { d, t, k, x: center[k][0] + (center[k + 1][0] - center[k][0]) * t, z: center[k][1] + (center[k + 1][1] - center[k][1]) * t };
}
const footArc = s[footBest.k] + footBest.t * (s[footBest.k + 1] - s[footBest.k]);
const checks = {
  footOnCenterlineM: +footBest.d.toFixed(4),
  footOnCenterlinePass: footBest.d <= 0.10,
  totalLengthM: +total.toFixed(2),
  totalLengthPass: total >= 153 && total <= 159,
  footArcM: +footArc.toFixed(2),
  tailAfterFootM: +(total - footArc).toFixed(2),
  tailAfterFootPass: Math.abs(total - footArc - 24) <= 3,
};
if (!checks.footOnCenterlinePass || !checks.totalLengthPass || !checks.tailAfterFootPass) {
  console.error('WEST_SPEC_CHECK_FAIL', JSON.stringify(checks));
  process.exit(2);
}

// --- per-sample frames ---------------------------------------------------------
const samples = [];
for (let i = 0; i < n; i++) {
  const j = Math.min(i + 1, n - 1), k2 = Math.max(i - 1, 0);
  const tx = center[j][0] - center[k2][0], tz = center[j][1] - center[k2][1];
  const L = Math.hypot(tx, tz) || 1;
  // south normal: tangent (1,0) -> (0,1); north normal is its negation
  samples.push({
    s: +s[i].toFixed(3), x: +center[i][0].toFixed(4), z: +center[i][1].toFixed(4),
    southNx: +(tz / L).toFixed(5), southNz: +(-tx / L).toFixed(5),
  });
}

const frontline = WE.widths.frontLineM; // 5.6 = 4.25 road half + 1.35 sidewalk
const out = {
  schemaVersion: 1,
  generatedBy: 'scripts/make_west_extension_spec.mjs',
  batchId: spec.batchId,
  axis: 'GLB Y-up X east Z south; samples every 0.5m; normals are unit 2D in xz',
  inputs: {
    westWedge: 'kit/out/fangbang-temple/west-wedge.json',
    westWedgeMidpoint: mid,
    measuredCutWidthM: wedge.westEnd.cutWidthM,
    controlPointsGlb: ctrl.map(([x, z]) => [+x.toFixed(4), +z.toFixed(4)]),
    droppedJunctionControl: 'roadCenterlineGlbWestOfStreet[0]=(0.04,-0.01) lies ~1.9m EAST of the measured wedge start (it anchors the frozen street, not the extension) — dropped to keep the polyline monotone west',
    westEndGlb: WE.westEndGlb,
    smoothing: 'chaikin 2 passes + 0.5m resample (same as make_segment_spec.py)',
  },
  widths: WE.widths,
  junctionWidthM: wedge.westEnd.cutWidthM,
  checks,
  frontlineBands: {
    frontlineM: frontline,
    note: 'offset polyline pairs at +/-' + frontline + 'm along the local normal = front-wall lines; the temple forecourt south edge (local z=+7) coincides with the north band at the foot (spec forecourtJoint)',
    north: samples.map((p) => ({ s: p.s, x: +(p.x - p.southNx * frontline).toFixed(3), z: +(p.z - p.southNz * frontline).toFixed(3) })),
    south: samples.map((p, i) => ({ s: samples[i].s, x: +(p.x + p.southNx * frontline).toFixed(3), z: +(p.z + p.southNz * frontline).toFixed(3) })),
  },
  samples,
};
await writeFile(resolve(root, 'kit/out/fangbang-temple/west-extension-spec.json'), JSON.stringify(out, null, 2) + '\n');
console.log('WEST_SPEC_READY', JSON.stringify({ total: checks.totalLengthM, footArc: checks.footArcM, tail: checks.tailAfterFootM, footDist: checks.footOnCenterlineM, samples: samples.length }));
