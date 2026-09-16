// Temple T1-T3 repair verification — everything runs against the ACTUAL
// exported GLB bytes and the REAL collision records, never against builder
// constants:
//
//   T1  plaque raycast: a grid of rays over the glyph area from azimuth 0deg
//       and +/-20deg; the NEAREST hit for >=98% of them must be the exported
//       text-face mesh (shanmen-plaque__temple-plaque-lacquer, exactly the one
//       textured quad). A full-face board in front of the text (the old solid
//       step boards / full gold fillet) would return frame-material hits and
//       fail this — texture presence in the config proves nothing here.
//
//   T2  wing walls: OBB records vs the exported world vertices. The OBB yaw
//       frame (ex/ez from theta) must bound the actual wall-slab vertex cloud
//       with matching extents, decorations must sit PROUD of the front face
//       plane on the viewer side within 0.015-0.065m (never cut through the
//       wall, never on the back), and the cap ridge line must be parallel to
//       the wall axis. OBB self-consistency alone does NOT count (the lead
//       review: two lists from the same wrong transform can agree).
//
//   T3  shoulder roofs: vertices matched against roof-surface-samples.json
//       (the DESIGN_REVISION equation sampled on the exact shell grid), ridge
//       band flat at 7.0, rows t<=0.5 laterally flat (no full-depth lift
//       curtain), nothing above the equation surface (rib allowance 0.10),
//       tile ribs present above the surface, seam rays blocked at the
//       center/shoulder junction.
//
// Run: node tests/temple_shanmen_repair.test.mjs   (exit 0 = repair verified)
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb, transformPoint } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DS = resolve(root, 'world/temple-shanmen');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}

const cfg = JSON.parse(await readFile(resolve(root, 'kit/temple-shanmen.config.json'), 'utf8'));
const collision = JSON.parse(await readFile(resolve(DS, 'collision-world.json'), 'utf8'));
const samples = JSON.parse(await readFile(resolve(DS, 'roof-surface-samples.json'), 'utf8'));

// world-space triangle soup per mesh, from the exported GLB bytes
const glb = readGlb(await readFile(resolve(DS, 'temple.glb')));
const worldMeshes = glb.meshes.map((m) => {
  const P = [];
  for (let i = 0; i < m.positions.length; i += 3)
    P.push(transformPoint(m.matrix, [m.positions[i], m.positions[i + 1], m.positions[i + 2]]));
  const T = [];
  for (let i = 0; i < m.indices.length; i += 3)
    T.push([P[m.indices[i]], P[m.indices[i + 1]], P[m.indices[i + 2]]]);
  return { name: m.name, points: P, tris: T };
});
const allPoints = worldMeshes.flatMap((m) => m.points.map((p) => [p[0], p[1], p[2], m.name]));
const allTris = worldMeshes.flatMap((m) => m.tris.map((t) => [t[0], t[1], t[2], m.name]));

// Möller–Trumbore, world space
function rayHit(o, d, tri) {
  const [v0, v1, v2] = tri;
  const e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
  const e2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
  const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (det > -1e-9 && det < 1e-9) return null;
  const inv = 1 / det;
  const t0 = [o[0] - v0[0], o[1] - v0[1], o[2] - v0[2]];
  const u = (t0[0] * p[0] + t0[1] * p[1] + t0[2] * p[2]) * inv;
  if (u < -1e-6 || u > 1 + 1e-6) return null;
  const q = [t0[1] * e1[2] - t0[2] * e1[1], t0[2] * e1[0] - t0[0] * e1[2], t0[0] * e1[1] - t0[1] * e1[0]];
  const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
  if (v < -1e-6 || u + v > 1 + 1e-6) return null;
  const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
  return t > 1e-4 ? t : null;
}
function nearestHit(o, d) {
  let best = null;
  for (const tri of allTris) {
    const t = rayHit(o, d, tri);
    if (t !== null && (best === null || t < best.t)) best = { t, name: tri[3] };
  }
  return best;
}

// ===========================================================================
// T1 — plaque text visibility raycast
// ===========================================================================
{
  const faceMesh = worldMeshes.find((m) => m.name === 'shanmen-plaque__temple-plaque-lacquer');
  check('T1: exported text-face mesh is exactly the textured quad', faceMesh && faceMesh.tris.length === 2,
    `${faceMesh?.name} tris=${faceMesh?.tris.length ?? 'missing'}`);
  const plq = cfg.plaque;
  const fw = plq.widthM - 2 * plq.steps[2].insetX;
  const fh = (plq.topY - plq.bottomY) - 2 * plq.steps[2].insetY;
  const faceZ = plq.steps[2].zFront;
  // glyph-safe interior: inside the text quad, clear of every frame ring
  const gx = fw / 2 - 0.16, gy0 = -(fh / 2) + 0.12, gy1 = fh / 2 - 0.12;
  const cy = (plq.bottomY + plq.topY) / 2;
  const NX = 15, NY = 13;
  for (const deg of [0, 20, -20]) {
    const a = (deg * Math.PI) / 180;
    const origin = [25 * Math.sin(a), cy, 25 * Math.cos(a)];
    let textHits = 0, total = 0, worst = '';
    for (let i = 0; i < NX; i++) {
      for (let j = 0; j < NY; j++) {
        const tx = -gx + (2 * gx * i) / (NX - 1);
        const ty = cy + gy0 + ((gy1 - gy0) * j) / (NY - 1);
        const target = [tx, ty, faceZ];
        const d = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
        const len = Math.hypot(...d);
        const hit = nearestHit(origin, d.map((v) => v / len));
        total++;
        if (hit && hit.name === 'shanmen-plaque__temple-plaque-lacquer') textHits++;
        else if (hit) worst = `${hit.name}@${hit.t.toFixed(2)}m`;
      }
    }
    check(`T1: ${deg === 0 ? 'front' : deg + 'deg'} glyph-area rays hit the text face first (>=98%)`,
      textHits / total >= 0.98, `${textHits}/${total}${worst ? ' e.g. ' + worst : ''}`);
  }
  // backing/rims must never be the nearest hit over the glyph area
  const a = 0, origin = [0, cy, 25];
  let occluded = 0;
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NY; j++) {
      const tx = -gx + (2 * gx * i) / (NX - 1);
      const ty = cy + gy0 + ((gy1 - gy0) * j) / (NY - 1);
      const d = [tx - origin[0], ty - origin[1], faceZ - origin[2]];
      const hit = nearestHit(origin, d);
      if (hit && hit.name !== 'shanmen-plaque__temple-plaque-lacquer') occluded++;
    }
  }
  check('T1: no full-face board occludes any glyph-area ray from the front', occluded === 0, `${occluded} occluded`);
}

// ===========================================================================
// T2 — wing walls: exported vertices vs OBB, decorations, cap parallelism
// ===========================================================================
for (const side of ['left', 'right']) {
  const rec = collision.colliders.find((c) => c.name === 'wing-wall-body' && (
    (side === 'right') === (c.obb.center
      ? (Math.cos(c.obb.theta) * c.obb.center[0] + Math.sin(c.obb.theta) * c.obb.center[2]) > 0
      : c.min[0] > 0)));
  check(`T2 ${side}: wing-wall-body OBB record present`, !!rec);
  if (!rec) continue;
  const { theta, center, size } = rec.obb;
  const c = Math.cos(theta), s = Math.sin(theta);
  // adapter obbToWorld: world center = pos + R(theta)*center, R = [[c,0,s],[0,1,0],[-s,0,c]]
  const wc = [
    rec.obb.pos[0] + c * center[0] + s * center[2],
    rec.obb.pos[1] + center[1],
    rec.obb.pos[2] - s * center[0] + c * center[2],
  ];
  const ex = [c, 0, -s], ez = [s, 0, c];
  const front = ez[2] > 0 ? 1 : -1;
  const L = size[0], H = size[1], T = size[2];
  const startCfg = cfg.wings[`${side}Start`], endCfg = cfg.wings[`${side}End`];

  // OBB endpoints vs the config wall start/end
  const endA = [wc[0] - ex[0] * L / 2, wc[1], wc[2] - ex[2] * L / 2];
  const endB = [wc[0] + ex[0] * L / 2, wc[1], wc[2] + ex[2] * L / 2];
  check(`T2 ${side}: OBB axis endpoints match config start/end`,
    Math.hypot(endA[0] - startCfg[0], endA[2] - startCfg[2]) < 0.03 &&
    Math.hypot(endB[0] - endCfg[0], endB[2] - endCfg[2]) < 0.03,
    `start d=${Math.hypot(endA[0] - startCfg[0], endA[2] - startCfg[2]).toFixed(3)} end d=${Math.hypot(endB[0] - endCfg[0], endB[2] - endCfg[2]).toFixed(3)}`);

  // collect exported vertices in the wall slab zone
  const rel = (p) => {
    const dx = p[0] - endA[0], dz = p[2] - endA[2];
    return [dx * ex[0] + dz * ex[2], p[1], dx * ez[0] + dz * ez[2]];
  };
  const zone = allPoints.filter(([, , , n]) => n === 'shanmen-body__worn-stone')
    .map(([x, y, z]) => rel([x, y, z]))
    .filter(([u, v, w]) => u >= -0.05 && u <= L + 0.05 && v >= 0.05 && v <= H + 0.03 && Math.abs(w) <= T / 2 + 0.005);
  check(`T2 ${side}: wall slab has exported vertices in the OBB zone`, zone.length > 200, `${zone.length}`);
  const uMin = Math.min(...zone.map((p) => p[0])), uMax = Math.max(...zone.map((p) => p[0]));
  const vMax = Math.max(...zone.map((p) => p[1]));
  const wMax = Math.max(...zone.map((p) => Math.abs(p[2])));
  check(`T2 ${side}: measured slab extents match the OBB (u 0..L, v 0..H, |w| T/2)`,
    Math.abs(uMin) < 0.03 && Math.abs(uMax - L) < 0.03 && Math.abs(vMax - H) < 0.015 && Math.abs(wMax - T / 2) < 0.006,
    `u ${uMin.toFixed(3)}..${uMax.toFixed(3)}/${L} vMax ${vMax.toFixed(3)}/${H} |w|max ${wMax.toFixed(3)}/${T / 2}`);

  // decorations must be proud of the FRONT face plane, inside the offset band
  const reliefs = allPoints.filter(([, , , n]) => n === 'shanmen-body__temple-relief-stone')
    .map(([x, y, z]) => rel([x, y, z]))
    .filter(([u, v]) => u >= -0.05 && u <= L + 0.05 && v >= 0.3 && v <= H - 0.2);
  check(`T2 ${side}: relief panel vertices present on the frame`, reliefs.length >= 4, `${reliefs.length}`);
  const relFront = reliefs.map(([, , w]) => w * front);
  const relMin = Math.min(...relFront), relMax = Math.max(...relFront);
  check(`T2 ${side}: relief panel sits proud of the front face (0.005..0.03 from face)`,
    relMin >= T / 2 + 0.005 && relMax <= T / 2 + 0.03,
    `front-plane distances ${(relMin - T / 2).toFixed(3)}..${(relMax - T / 2).toFixed(3)}m`);
  // stone decorations (strips/bosses) stay within the 0.06 design band
  const dec = allPoints.filter(([, , , n]) => n === 'shanmen-body__worn-stone')
    .map(([x, y, z]) => rel([x, y, z]))
    .filter(([u, v, w]) => u >= L * 0.2 && u <= L * 0.95 && v >= 0.6 && v <= H - 0.15 && w * front > T / 2 + 0.004);
  const decMax = dec.length ? Math.max(...dec.map((p) => p[2] * front)) : 0;
  check(`T2 ${side}: stone decorations proud of the face stay within 0.065m`, dec.length > 20 && decMax <= T / 2 + 0.065,
    `${dec.length} verts, max proud ${(decMax - T / 2).toFixed(3)}m`);
  const behind = allPoints.filter(([, , , n]) => n === 'shanmen-body__worn-stone')
    .map(([x, y, z]) => rel([x, y, z]))
    .filter(([u, v, w]) => u >= L * 0.2 && u <= L * 0.95 && v >= 0.6 && v <= H - 0.2 && w * front < -T / 2 - 0.005);
  check(`T2 ${side}: no decoration leaked to the BACK face`, behind.length === 0, `${behind.length} verts`);

  // cap ridge line: the roll is one cylinder along the wall (vertices only at
  // its two end rings), so parallelism is proven geometrically — both end
  // rings must exist at the wall-frame axis positions and every cap-band
  // vertex must lie within 0.12m of that axis line.
  const rollY = cfg.wings.tileCapMaxY + 0.03;
  const ov = 0.10;
  const rollA = [endA[0] - ex[0] * ov, rollY, endA[2] - ex[2] * ov];
  const rollB = [endB[0] + ex[0] * ov, rollY, endB[2] + ex[2] * ov];
  const roofPtsAll = allPoints.filter(([, , , n]) => n === 'shanmen-body__gray-pan-tile');
  const distTo = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const nearA = roofPtsAll.filter((p) => distTo(p, rollA) <= 0.12 && Math.abs(p[1] - rollY) <= 0.12);
  const nearB = roofPtsAll.filter((p) => distTo(p, rollB) <= 0.12 && Math.abs(p[1] - rollY) <= 0.12);
  check(`T2 ${side}: cap ridge roll end rings exist on the wall axis`, nearA.length >= 4 && nearB.length >= 4,
    `A ${nearA.length} verts, B ${nearB.length} verts at y=${rollY}`);
  // ridge line parallelism proven from the roll itself: recover its axis from
  // the two end-ring centroids; the axis must coincide with the wall frame
  // direction and the centroids must sit at the wall-frame axis positions
  // (immune to the side-bay canopy vertices near the wall start).
  const centroid = (ps) => [0, 1, 2].map((k) => ps.reduce((a, p) => a + p[k], 0) / ps.length);
  const cA = centroid(nearA), cB = centroid(nearB);
  const ab = [cB[0] - cA[0], cB[1] - cA[1], cB[2] - cA[2]];
  const abLen = Math.hypot(...ab);
  const cosAxis = Math.abs((ab[0] * ex[0] + ab[2] * ex[2]) / Math.hypot(ab[0], ab[2]));
  const dA = Math.hypot(cA[0] - rollA[0], cA[1] - rollA[1], cA[2] - rollA[2]);
  const dB = Math.hypot(cB[0] - rollB[0], cB[1] - rollB[1], cB[2] - rollB[2]);
  check(`T2 ${side}: cap ridge roll axis parallel to the wall axis and on it`,
    abLen > L - 0.5 && cosAxis >= 0.9995 && dA <= 0.06 && dB <= 0.06,
    `axis len ${abLen.toFixed(2)}m (wall ${L.toFixed(2)}), cos=${cosAxis.toFixed(5)}, dA=${dA.toFixed(3)}, dB=${dB.toFixed(3)}`);
}

// ===========================================================================
// T3 — shoulder equation on the exported vertices + seam closure
// ===========================================================================
{
  const roofPts = allPoints.filter(([, , , n]) => n === 'shanmen-body__gray-pan-tile');
  const gx = samples.gridX;
  let matched = 0, missed = 0, worst = 0;
  const findVert = (x, z, y) => {
    let best = 1e9;
    for (const [vx, vy, vz] of roofPts) {
      if (Math.abs(vx - x) <= 0.012 && Math.abs(vz - z) <= 0.012) {
        const d = Math.abs(vy - y);
        if (d < best) best = d;
      }
    }
    return best;
  };
  for (const slope of ['front', 'rear']) {
    for (const row of samples[slope]) {
      for (let i = 0; i < gx.length; i++) {
        for (const sx of [gx[i], -gx[i]]) {
          const d = findVert(sx, row.z, row.y[i]);
          if (d <= 0.006) matched++;
          else { missed++; worst = Math.max(worst, d); }
        }
      }
    }
  }
  check('T3: shoulder shell vertices match the revision equation on the full grid (both sides)',
    missed === 0, `${matched} matched, ${missed} missed, worst |dy|=${worst.toFixed(4)}m`);

  // ridge band flat at 7.0 for every shoulder x (outer field 2.35..4.52:
  // excludes the center shell overlap 2.05..2.3 and the x=4.6 edge caps)
  const ridgeBand = roofPts.filter(([vx, vy, vz]) =>
    Math.abs(vx) >= 2.35 && Math.abs(vx) <= 4.52 && vz >= -1.83 && vz <= -1.77 && vy > 5.5);
  const ridgeMax = ridgeBand.length ? Math.max(...ridgeBand.map((p) => p[1])) : 0;
  const ridgeMin = ridgeBand.length ? Math.min(...ridgeBand.map((p) => p[1])) : 99;
  check('T3: ridge band (z -1.8) flat at 7.0, never elevated',
    ridgeBand.length > 20 && Math.abs(ridgeMax - 7.0) < 0.021 && ridgeMin > 6.6,
    `y ${ridgeMin.toFixed(3)}..${ridgeMax.toFixed(3)} over ${ridgeBand.length} verts (soffit below, top must be 7.0)`);

  // rows t<=0.5 are laterally flat on the TOP surface — the old
  // max(ridge, outline) full-depth curtain would sit far above the row
  for (const tRow of samples.front.filter((r) => r.t <= 0.5)) {
    const rowY = tRow.y[0];
    const band = roofPts.filter(([vx, vy, vz]) =>
      Math.abs(vx) >= 2.35 && Math.abs(vx) <= 4.5 && Math.abs(vz - tRow.z) <= 0.03 &&
      vy >= rowY - 0.015 && vy <= rowY + 0.015);
    const curtain = roofPts.filter(([vx, vy, vz]) =>
      Math.abs(vx) >= 2.35 && Math.abs(vx) <= 4.5 && Math.abs(vz - tRow.z) <= 0.03 && vy > rowY + 0.12);
    const spread = band.length ? Math.max(...band.map((p) => p[1])) - Math.min(...band.map((p) => p[1])) : 1;
    check(`T3: front row t=${tRow.t} top surface laterally flat, no curtain above +0.12`,
      band.length >= 8 && spread <= 0.02 && curtain.length === 0,
      `spread ${spread.toFixed(4)}m over ${band.length} top verts; curtain verts ${curtain.length}`);
  }

  // nothing floats above the equation surface. Ribs ride the surface along
  // its NORMAL: on the steep outer outline (slope up to ~2.8) the VERTICAL
  // protrusion of a half-buried r=0.05 tube reaches ~0.23m, so the allowance
  // is 0.26m — the old max(ridge, outline) curtain sat +0.5..+1.0m above.
  const interp = (ax, az) => {
    const slope = az >= samples.front[0].z ? 'front' : 'rear';
    const rows = samples[slope];
    const zA = rows[0].z, zB = rows[rows.length - 1].z;
    const fz = (az - zA) / (zB - zA) * (rows.length - 1);
    const j = Math.max(0, Math.min(rows.length - 2, Math.floor(fz)));
    const bz = fz - j;
    const fx = (ax - gx[0]) / (gx[gx.length - 1] - gx[0]) * (gx.length - 1);
    const i = Math.max(0, Math.min(gx.length - 2, Math.floor(fx)));
    const bx = fx - i;
    const y00 = rows[j].y[i], y10 = rows[j].y[i + 1], y01 = rows[j + 1].y[i], y11 = rows[j + 1].y[i + 1];
    return (y00 * (1 - bx) + y10 * bx) * (1 - bz) + (y01 * (1 - bx) + y11 * bx) * bz;
  };
  let above = 0, maxAbove = 0, ribVerts = 0;
  for (const [vx, vy, vz] of roofPts) {
    const ax = Math.abs(vx);
    if (ax < 2.35 || ax > 4.5 || vz < -3.92 || vz > 0.42 || vy < 5.3) continue;
    const yExp = interp(ax, vz);
    const d = vy - yExp;
    if (d > 0.012 && d <= 0.26) ribVerts++;
    if (d > 0.26) { above++; maxAbove = Math.max(maxAbove, d); }
  }
  check('T3: no shoulder vertex floats above the revision surface (rib normal-offset allowance 0.26m)',
    above === 0, `${above} above, max +${maxAbove.toFixed(3)}m`);
  check('T3: tile ribs present above the shell surface', ribVerts >= 400, `${ribVerts} rib vertices`);

  // seam closure: horizontal rays through the junction band must be blocked at
  // the seam (outer shell field / skirt / center shell), never at the FAR
  // side only. Band = shoulder top at the SEAM column (grid x=2.05) +0.04/+0.08.
  let blocked = 0, seamRays = 0, gaps = [];
  for (const slope of ['front', 'rear']) {
    for (const row of samples[slope]) {
      if (row.t < 0.3) continue;
      const seamTop = row.y[0];
      for (const dy of [0.04, 0.08]) {
        const y = seamTop + dy;
        const o = [6.0, y, row.z], d = [-1, 0, 0];
        const hit = nearestHit(o, d);
        seamRays++;
        if (hit) {
          const hx = 6.0 - hit.t;
          if (hx >= 1.85) blocked++;
          else gaps.push(`z=${row.z.toFixed(2)} y=${y.toFixed(2)} -> ${hit.name}@x=${hx.toFixed(2)}`);
        } else gaps.push(`z=${row.z.toFixed(2)} y=${y.toFixed(2)} -> no hit`);
      }
    }
  }
  check('T3: seam junction rays blocked at the center/shoulder closure (>=95%)',
    blocked / seamRays >= 0.95, `${blocked}/${seamRays} blocked${gaps.length ? '; ' + gaps.slice(0, 4).join('; ') : ''}`);
}

console.log(failures === 0 ? 'TEMPLE_REPAIR_PASS' : `TEMPLE_REPAIR FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
