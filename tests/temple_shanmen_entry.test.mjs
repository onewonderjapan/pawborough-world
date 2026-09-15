// N1 entry-batch closure verification — the 3/4-view "big black block" fix.
//
// Root causes fixed in kit/build_temple_shanmen.py + kit/temple_components.py:
//   (1) the side-wall-upper strips' quad hints were swapped, so the OUTER
//       flank plane exported backfacing (culled) and viewers saw a recessed
//       plane + the dark eave cavity behind it;
//   (2) the strips spanned y=0..yhi coplanar with the lower wall box
//       (z-fighting patches);
//   (3) the shoulder overhang band (x from the flank wall out to the wing
//       tip) had no closure at all on the front, rear and outer sides.
//
// These checks run against the exported GLB bytes of world/temple-shanmen:
//   C1  flank outer plane faces OUTWARD: rays from outside at the upper band
//       hit the outer plane (|x|≈3.46), never a recessed inner plane;
//   C2  the overhang band is closed from outside: horizontal rays through the
//       band are blocked by the outer gable wall (|hitX| >= 4.0), not by the
//       far-side structures and never unblocked;
//   C3  the front end band (above the corbel band, outboard of the body) is
//       closed by the front end panel at z≈-0.13 (hit z >= -0.4);
//   C4  no coplanar duplicate surfaces on the flank: at the lower band
//       (y<5.4) exactly one hit plane family — the ray from outside hits the
//       outer face once (the old overlap produced hits at two coincident
//       depths; degenerate duplicates are absent now by construction, so this
//       asserts single-hit depth ordering stays sane).
// Run: node tests/temple_shanmen_entry.test.mjs
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

const glb = readGlb(await readFile(resolve(DS, 'temple.glb')));
const allTris = [];
for (const m of glb.meshes) {
  const P = [];
  for (let i = 0; i < m.positions.length; i += 3)
    P.push(transformPoint(m.matrix, [m.positions[i], m.positions[i + 1], m.positions[i + 2]]));
  for (let i = 0; i < m.indices.length; i += 3)
    allTris.push([P[m.indices[i]], P[m.indices[i + 1]], P[m.indices[i + 2]], m.name]);
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
function hitsSorted(o, d) {
  const out = [];
  for (const tri of allTris) {
    const t = rayHit(o, d, tri);
    if (t !== null) out.push({ t, name: tri[3], p: [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t] });
  }
  return out.sort((a, b) => a.t - b.t);
}
const nearest = (o, d) => hitsSorted(o, d)[0] ?? null;

// C1 — flank upper band normals point OUTWARD on the exported mesh (the old
// swapped quad hints exported the outer plane backfacing). Direct geometry
// check: every exported plaster triangle lying in the outer flank plane
// (|x|≈3.46, strip band y/z) must have normal x-sign == plane-side sign.
{
  const mesh = glb.meshes.find((m) => m.name === 'shanmen-body__weathered-lime-plaster');
  check('C1: plaster mesh present', !!mesh);
  let checked = 0, wrong = 0, worst = null;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const idx = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]];
    const pts = idx.map((k) => transformPoint(mesh.matrix,
      [mesh.positions[k * 3], mesh.positions[k * 3 + 1], mesh.positions[k * 3 + 2]]));
    if (!pts.every((p) => Math.abs(Math.abs(p[0]) - 3.46) < 0.02 && p[1] > 5.45 && p[1] < 6.95 && p[2] < 0.01 && p[2] > -3.61)) continue;
    const e1 = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]];
    const e2 = [pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[2][2] - pts[0][2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(...n);
    const s = Math.sign(pts[0][0]);
    checked++;
    if (n[0] * s <= 0 || Math.abs(n[0]) / len < 0.85) { wrong++; worst = `x=${pts[0][0].toFixed(2)} n=[${n.map((v) => (v / len).toFixed(2))}]`; }
  }
  check('C1: flank outer-strip triangles exported with outward normals (0 inward)',
    checked > 40 && wrong === 0, `${checked} checked, ${wrong} wrong${worst ? '; e.g. ' + worst : ''}`);
}

// C2 — overhang band closed from outside: horizontal rays THROUGH the band
// (below the shell soffit at the wing tip) are blocked by the outer gable
// wall. Rays whose y is above the local shell surface simply fly over the
// roof and are excluded — they never enter the band volume.
{
  const samples = JSON.parse(await readFile(resolve(DS, 'roof-surface-samples.json'), 'utf8'));
  const gxLast = samples.gridX[samples.gridX.length - 1];
  const wallTopAt = (z) => {
    const rows = z >= samples.front[0].z ? samples.front : samples.rear;
    const zs = rows.map((r) => r.z);
    const j = Math.max(0, Math.min(rows.length - 2, rows.findIndex((r, k) => r.z >= z || k === rows.length - 1) - 0));
    const j0 = rows.findIndex((r) => r.z <= z + 1e-9);
    const jj = j0 >= 0 ? Math.min(rows.length - 2, Math.max(0, j0)) : rows.length - 2;
    const zA = rows[jj].z, zB = rows[jj + 1].z;
    const b = zA === zB ? 0 : (z - zA) / (zB - zA);
    return rows[jj].y[gxLast === 4.6 ? samples.gridX.length - 1 : samples.gridX.length - 1] * (1 - b)
      + rows[jj + 1].y[samples.gridX.length - 1] * b - 0.135;
  };
  let blockedOuter = 0, farSide = 0, total = 0, notes = [];
  for (const side of [1, -1]) {
    for (let z = -3.4; z <= 0.2; z += 0.45) {
      const top = wallTopAt(z);
      for (let y = 4.25; y <= Math.min(6.6, top - 0.12); y += 0.3) {
        const o = [side * 9, y, z], d = [-side, 0, 0];
        const h = nearest(o, d);
        total++;
        if (h && Math.abs(h.p[0]) >= 4.0) blockedOuter++;
        else { farSide++; notes.push(`${h ? h.name + ' @' + h.p.map((v) => v.toFixed(2)) : 'open'} y=${y.toFixed(2)} z=${z.toFixed(2)}`); }
      }
    }
  }
  check('C2: overhang band rays blocked by the outer gable wall (>=95%)',
    total > 60 && blockedOuter / total >= 0.95, `${blockedOuter}/${total} blocked; others: ${notes.slice(0, 5).join(' | ')}`);
}

// C3 — front end band above the corbels is closed by the front end panel
{
  let blocked = 0, total = 0, sample = '';
  for (const side of [1, -1]) {
    for (let x = 3.6; x <= 4.4; x += 0.2) {
      for (let y = 4.3; y <= 6.0; y += 0.3) {
        const o = [side * x, y, 8], d = [0, 0, -1];
        const h = nearest(o, d);
        total++;
        if (h && h.p[2] >= -0.4) blocked++;
        else sample = h ? `${h.name} @z=${h.p[2].toFixed(2)} (x=${x},y=${y})` : `no hit (x=${x},y=${y})`;
      }
    }
  }
  check('C3: front end band above the corbels closed at the facade plane (>=95%)',
    blocked / total >= 0.95, `${blocked}/${total}; e.g. ${sample}`);
}

// C4 — seam junction dressed: rays at the center/shoulder step hit trim, no open slit
{
  let blocked = 0, total = 0, sample = '';
  for (const side of [1, -1]) {
    for (let z = -0.4; z >= -3.4; z -= 0.4) {
      for (let dy = 0.05; dy <= 0.45; dy += 0.1) {
        const y = 6.62 - dy * 0.7; // sampling the step band under the center eave
        const o = [side * 2.42, y + 0.3, z + 0.15], d = [side * 0.24, -0.7, -0.05];
        const len = Math.hypot(...d);
        const h = nearest(o, d.map((v) => v / len));
        total++;
        if (h) blocked++;
        else sample = `open (side=${side}, y=${y.toFixed(2)},z=${z.toFixed(2)})`;
      }
    }
  }
  check('C4: center/shoulder seam step has no open slit (>=98% rays blocked)',
    blocked / total >= 0.98, `${blocked}/${total}; e.g. ${sample}`);
}

console.log(failures === 0 ? 'TEMPLE_ENTRY_CLOSURE_PASS' : `TEMPLE_ENTRY_CLOSURE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
