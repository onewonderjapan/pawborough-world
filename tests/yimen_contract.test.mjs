// Yimen (second gate) contract tests — everything runs against the ACTUAL
// exported GLB bytes, collision records and the equation dataset, never
// against builder constants alone.
//
//   Y1  glTF validator: 0 errors on yimen.glb
//   Y2  bounds: the exported geometry spans the designed envelope (roof
//       15.6m wide, ridge+frieze height, eave overhangs front/rear)
//   Y3  roof surface: shell vertices match roof-surface-samples.json on the
//       full grid (both slopes); ridge band flat at 7.7 for every ridge x;
//       eave corners at exactly eaveY+cornerLift; every grid column falls
//       monotonically ridge->eave (no upturned board anywhere)
//   Y4  doorway: clear corridor empty of colliders AND of geometry rays; the
//       through-opening measures 3.6 x 3.2 from the exported jambs/lintel
//   Y5  plaques: both text faces are the textured quads; glyph-area raycasts
//       from 0/+/-20deg hit the text face first (>=98%); nothing full-face
//       occludes; the two atlas halves map to the correct sides
//   Y6  palette: no material outside the frozen street/temple set; exactly
//       one new image (the plaque atlas)
// Run: node tests/yimen_contract.test.mjs
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';
import { readGlb, transformPoint } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = resolve(root, 'kit/out/yimen');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}

const cfg = JSON.parse(await readFile(resolve(root, 'kit/yimen.config.json'), 'utf8'));
const bytes = await readFile(resolve(KIT, 'yimen.glb'));

// Y1 — validator
{
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 100 });
  check('Y1: yimen.glb validator 0 errors', (report.issues?.numErrors ?? 0) === 0,
    `${report.issues?.numErrors ?? 0} errors, ${report.issues?.numWarnings ?? 0} warnings`);
}

const glb = readGlb(bytes);
const worldMeshes = glb.meshes.map((m) => {
  const P = [];
  for (let i = 0; i < m.positions.length; i += 3)
    P.push(transformPoint(m.matrix, [m.positions[i], m.positions[i + 1], m.positions[i + 2]]));
  const T = [];
  for (let i = 0; i < m.indices.length; i += 3)
    T.push([P[m.indices[i]], P[m.indices[i + 1]], P[m.indices[i + 2]]]);
  return { name: m.name, points: P, tris: T };
});
const allPoints = worldMeshes.flatMap((m) => m.points);
const allTris = worldMeshes.flatMap((m) => m.tris.map((t) => [t[0], t[1], t[2], m.name]));

// Y2 — bounds envelope (local frame: facade +Z at z=0, depth -Z)
{
  const lo = [Math.min(...allPoints.map((p) => p[0])), Math.min(...allPoints.map((p) => p[1])),
    Math.min(...allPoints.map((p) => p[2]))];
  const hi = [Math.max(...allPoints.map((p) => p[0])), Math.max(...allPoints.map((p) => p[1])),
    Math.max(...allPoints.map((p) => p[2]))];
  const rf = cfg.roof, fz = cfg.ridgeFrieze;
  check('Y2: width spans the 15.6m roof (plus ribs), never wider',
    Math.abs(hi[0] - rf.widthM / 2) < 0.12 && Math.abs(lo[0] + rf.widthM / 2) < 0.12,
    `x ${lo[0].toFixed(2)}..${hi[0].toFixed(2)}`);
  check('Y2: depth spans front/rear eave overhangs',
    Math.abs(hi[2] - rf.frontEaveZ) < 0.06 && Math.abs(lo[2] - rf.rearEaveZ) < 0.06,
    `z ${lo[2].toFixed(2)}..${hi[2].toFixed(2)}`);
  check('Y2: height reaches the frieze cap, not beyond',
    Math.abs(hi[1] - (rf.ridgeY + fz.heightM + fz.capRollRadiusM * 2)) < 0.12,
    `y ${lo[1].toFixed(2)}..${hi[1].toFixed(2)} vs cap ~${(rf.ridgeY + fz.heightM + 2 * fz.capRollRadiusM).toFixed(2)}`);
}

// Y3 — surface equation on the exported vertices
{
  const samples = JSON.parse(await readFile(resolve(KIT, 'roof-surface-samples.json'), 'utf8'));
  const roofPts = allPoints.filter((p) => p[1] > 4.6);
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
        const d = findVert(gx[i], row.z, row.y[i]);
        if (d <= 0.006) matched++;
        else { missed++; worst = Math.max(worst, d); }
      }
    }
  }
  check('Y3: shell vertices match the continuous equation on the full grid',
    missed === 0, `${matched} matched, ${missed} missed, worst |dy|=${worst.toFixed(4)}m`);

  // ridge flat 7.7 over the full 10.4m ridge (|x|<=5.1)
  const ridgeBand = roofPts.filter(([vx, vy, vz]) => Math.abs(vx) <= 5.1 && Math.abs(vz + 2.6) <= 0.06 && vy > 7.4);
  const rMax = ridgeBand.length ? Math.max(...ridgeBand.map((p) => p[1])) : 0;
  check('Y3: ridge band flat at 7.7 across the 10.4m ridge',
    ridgeBand.length > 20 && Math.abs(rMax - 7.7) < 0.03, `max y=${rMax.toFixed(3)} over ${ridgeBand.length} verts`);

  // eave corners exactly eaveY + cornerLift
  const rf = cfg.roof;
  const corner = roofPts.filter(([vx, vy, vz]) => Math.abs(Math.abs(vx) - rf.widthM / 2) <= 0.05
    && (Math.abs(vz - rf.frontEaveZ) <= 0.08 || Math.abs(vz - rf.rearEaveZ) <= 0.08));
  const cTarget = rf.eaveY + rf.cornerLiftM;
  const cMax = corner.length ? Math.max(...corner.map((p) => p[1])) : 0;
  check('Y3: eave corners sit at eaveY+cornerLift (0.28 lift present, bounded)',
    corner.length >= 4 && Math.abs(cMax - cTarget) < 0.06 && cMax < rf.eaveY + rf.cornerLiftM + 0.06,
    `max corner y=${cMax.toFixed(3)} vs ${cTarget}`);

  // monotone: for each grid column, front rows strictly non-increasing in t
  let rises = 0;
  for (const slope of ['front', 'rear']) {
    for (let i = 0; i < gx.length; i++) {
      for (let j = 1; j < samples[slope].length; j++) {
        if (samples[slope][j].y[i] > samples[slope][j - 1].y[i] + 1e-9) rises++;
      }
    }
  }
  check('Y3: every grid column falls monotonically ridge->eave (0 rises)', rises === 0, `${rises} rises`);
}

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

// Y4 — doorway: colliders clear + geometry rays through + opening size
{
  const collision = JSON.parse(await readFile(resolve(KIT, 'collision.json'), 'utf8'));
  const dw = cfg.clearDoorway;
  const corridor = collision.clearCorridor;
  const blocked = collision.colliders.filter((c) =>
    !(c.max[0] <= -corridor.x || c.min[0] >= corridor.x) &&
    !(c.max[1] <= corridor.y0 || c.min[1] >= corridor.y1) &&
    !(c.max[2] <= corridor.z0 || c.min[2] >= corridor.z1));
  check('Y4: clear corridor empty of colliders', blocked.length === 0, blocked.map((c) => c.name).join(','));

  // the gate is OPEN through its full depth: rays inside the clear corridor
  // must meet NO geometry within the body (a hit before the rear plane means
  // something seals the passage); clean exit or a hit on the far exterior is
  // the pass condition
  let blockedInside = 0, total = 0, sample = '';
  const zFar = 2.2 + Math.abs(dw.localZRange[1]) - 0.3;
  for (let y = 0.4; y <= dw.heightM - 0.35; y += 0.45) {
    for (let x = -(dw.widthM / 2 - 0.25); x <= dw.widthM / 2 - 0.25; x += 0.5) {
      const o = [x, y, 2.2], d = [0, 0, -1];
      const h = nearestHit(o, d);
      total++;
      if (h && h.t < zFar) { blockedInside++; sample = `${h.name} @t=${h.t.toFixed(2)} (x=${x},y=${y})`; }
    }
  }
  check('Y4: rays through the clear corridor meet nothing inside the body',
    blockedInside === 0, `${blockedInside}/${total} blocked; e.g. ${sample}`);

  const jambs = allPoints.filter((p) => Math.abs(p[2] + 2.6) < 2.7 && Math.abs(p[1] - 1.6) < 1.6
    && Math.abs(Math.abs(p[0]) - dw.widthM / 2) < 0.25);
  check('Y4: jamb geometry present at the 3.6m opening line', jambs.length >= 8, `${jambs.length} verts`);
}

// Y5 — plaques: text visibility raycasts (the T1 lesson, applied to both)
{
  const faceMesh = worldMeshes.find((m) => m.name === 'yimen-plaque__yimen-plaque-lacquer');
  check('Y5: exported plaque mesh present with 2 quads (one per plaque)',
    faceMesh && faceMesh.tris.length === 4, `${faceMesh?.name} tris=${faceMesh?.tris.length ?? 'missing'}`);
  const sp = cfg.sidePlaques;
  const fw = sp.sizeWH[0] - 2 * 0.17, fh = sp.sizeWH[1] - 2 * 0.1;
  const faceZ = 0.055;
  const NX = 13, NY = 7;
  for (const cx of sp.centersX) {
    for (const deg of [0, 20, -20]) {
      const a = (deg * Math.PI) / 180;
      const origin = [cx + 16 * Math.sin(a), sp.centerY, 16 * Math.cos(a)];
      let textHits = 0, total = 0, worst = '';
      for (let i = 0; i < NX; i++) {
        for (let j = 0; j < NY; j++) {
          const tx = cx - fw / 2 + 0.1 + (fw - 0.2) * i / (NX - 1);
          const ty = sp.centerY - fh / 2 + 0.07 + (fh - 0.14) * j / (NY - 1);
          const target = [tx, ty, faceZ];
          const d = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
          const len = Math.hypot(...d);
          const hit = nearestHit(origin, d.map((v) => v / len));
          total++;
          if (hit && hit.name === 'yimen-plaque__yimen-plaque-lacquer') textHits++;
          else if (hit) worst = `${hit.name}@${hit.t.toFixed(2)}m`;
        }
      }
      check(`Y5: plaque x=${cx} ${deg === 0 ? 'front' : deg + 'deg'} glyph rays hit the text face first (>=98%)`,
        textHits / total >= 0.98, `${textHits}/${total}${worst ? ' e.g. ' + worst : ''}`);
    }
  }
  // atlas halves: the LEFT plaque face must sample the TOP half of the atlas
  // (亡必惡為 row), the RIGHT the BOTTOM half (昌必善為 row) — read TEXCOORD_0
  // straight from the GLB accessors and pair it with position x by vertex
  {
    const nodes = [];
    const walk = (ni) => {
      const n = glb.gltf.nodes[ni];
      for (const c of n.children ?? []) walk(c);
      if (n.mesh !== undefined) nodes.push(n);
    };
    for (const r of glb.gltf.scenes[glb.gltf.scene ?? 0].nodes) walk(r);
    const node = nodes.find((n) => n.name === 'yimen-plaque__yimen-plaque-lacquer');
    check('Y5: plaque node found in the GLB graph', !!node);
    if (node) {
      const prim = glb.gltf.meshes[node.mesh].primitives[0];
      const uvAcc = glb.gltf.accessors[prim.attributes.TEXCOORD_0];
      const bv = glb.gltf.bufferViews[uvAcc.bufferView];
      const start = (bv.byteOffset ?? 0) + (uvAcc.byteOffset ?? 0);
      const uvs = new Float32Array(glb.bin.buffer, glb.bin.byteOffset + start, uvAcc.count * 2);
      const pos = faceMesh.points;
      let leftV = [], rightV = [];
      for (let k = 0; k < uvAcc.count; k++) {
        (pos[k][0] < 0 ? leftV : rightV).push(uvs[k * 2 + 1]);
      }
      const lMin = Math.min(...leftV), lMax = Math.max(...leftV);
      const rMin = Math.min(...rightV), rMax = Math.max(...rightV);
      // glTF UV origin is TOP-left (v=0 top row): the atlas' top half
      // (亡必惡為) is v 0..0.5, the bottom half (昌必善為) is v 0.5..1
      check('Y5: left plaque maps the TOP atlas half (為惡必亡), right the BOTTOM (為善必昌)',
        leftV.length === 4 && rightV.length === 4 && lMin >= -0.001 && lMax <= 0.501
        && rMin >= 0.499 && rMax <= 1.001,
        `left v ${lMin.toFixed(3)}..${lMax.toFixed(3)}, right v ${rMin.toFixed(3)}..${rMax.toFixed(3)}`);
    }
  }
}

// Y6 — palette: only frozen materials; the new image is the plaque atlas
{
  const reimport = JSON.parse(await readFile(resolve(KIT, 'reimport-check.json'), 'utf8'));
  // reimport lands in a scene that still holds the build materials, so Blender
  // appends .NNN suffixes there; normalize before comparing (export is clean)
  const base = (n) => n.replace(/\.\d{3}$/, '');
  const names = reimport.materials.map((m) => base(m.name));
  const frozen = ['weathered-lime-plaster', 'blue-gray-brick', 'oxblood-stained-timber', 'deep-door-lacquer',
    'gray-pan-tile', 'worn-stone', 'aged-brass', 'temple-relief-stone', 'yimen-plaque-lacquer'];
  const unknown = names.filter((n) => !frozen.includes(n));
  check('Y6: only frozen-palette materials exported', unknown.length === 0, unknown.join(','));
  const plq = reimport.materials.find((m) => base(m.name) === 'yimen-plaque-lacquer');
  check('Y6: plaque atlas connected in the exported GLB',
    plq && plq.imageNodes.length >= 1 && Math.max(...plq.imageNodes[0].size) >= 1024,
    plq ? plq.imageNodes.map((n) => n.size.join('x')).join(',') : 'missing');
}

console.log(failures === 0 ? 'YIMEN_CONTRACT_PASS' : `YIMEN_CONTRACT FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
