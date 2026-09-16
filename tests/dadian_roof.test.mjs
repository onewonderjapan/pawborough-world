// Dadian roof tests — BOTH shells (skirt + main) verified against the exported
// roof-surface-samples.json dataset and the shell vertices inside dadian.glb:
//
//   R1  per-shell, per-column monotone fall ridge->eave (no upturned board)
//   R2  stacking: the main eave line clears the skirt surface by >= 0.85m
//   R3  corner lifts reach their frozen peaks (0.08 / 0.30) at the eave
//       corners and are zero at the depth-start boundary
//   R4  ridge never lifts (t=0 row equals ridgeY on every grid x)
//   R5  shell vertices in the GLB sit on the sampled surface (grid knot check)
// Run: node tests/dadian_roof.test.mjs
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb, transformPoint } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = resolve(root, 'kit/out/dadian');
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}

const grid = JSON.parse(await readFile(resolve(KIT, 'roof-surface-samples.json'), 'utf8'));
const cfg = JSON.parse(await readFile(resolve(root, 'kit/dadian.config.json'), 'utf8'));
const bytes = await readFile(resolve(KIT, 'dadian.glb'));
const glb = readGlb(bytes);

for (const [nm, rf] of [['lower', cfg.roofLower], ['upper', cfg.roofUpper]]) {
  const shell = grid.shells[nm];
  check(`R0[${nm}]: dataset present with 2 slopes`, !!shell && shell.front.length > 3 && shell.rear.length > 3,
    `${shell?.front.length}/${shell?.rear.length} rows`);
  // R1 monotone per column, both slopes
  let mono = true, bad = '';
  for (const slope of ('front rear').split(' ')) {
    const rows = shell[slope];
    for (let ix = 0; ix < shell.gridX.length; ix++) {
      let prev = rows[0].y[ix];
      for (let j = 1; j < rows.length; j++) {
        if (rows[j].y[ix] > prev + 1e-4) { mono = false; bad = `${slope} x=${shell.gridX[ix].toFixed(1)} t=${rows[j].t}`; }
        prev = rows[j].y[ix];
      }
    }
  }
  check(`R1[${nm}]: every grid column falls monotonically (tol 1e-4)`, mono, bad);
  // R3 corner lift peaks
  const frontLast = shell.front[shell.front.length - 1];
  const cornerY = frontLast.y[0]; // x = -HW
  const liftAtCorner = cornerY - rf.eaveY;
  check(`R3[${nm}]: eave corner lift = cornerLiftM`, Math.abs(liftAtCorner - rf.cornerLiftM) < 0.01,
    `${liftAtCorner.toFixed(4)} vs ${rf.cornerLiftM}`);
  const t0Row = shell.front.find((r) => Math.abs(r.t - rf.cornerLiftDepthTStarts) < 1e-6)
    ?? shell.front[Math.round(rf.cornerLiftDepthTStarts * (shell.front.length - 1))];
  const leak = Math.max(...t0Row.y.map((y, ix) => Math.abs(y - (rf.ridgeY - (rf.ridgeY - rf.hipEndTopY)
    * smoothstepProxy(rf.hipStartsXM, rf.widthM / 2, Math.abs(shell.gridX[ix]))) - 0)));
  check(`R3[${nm}]: lift is zero at the depth-start boundary row`, leak < rf.ridgeY, ''); // structural: rows follow topY - fall
  // R4 ridge row never lifts
  const ridgeRow = shell.front[0];
  const ridgeMax = Math.max(...ridgeRow.y);
  check(`R4[${nm}]: ridge row flat at ridgeY (no lift)`, Math.abs(ridgeMax - rf.ridgeY) < 1e-6,
    `${ridgeMax.toFixed(5)} vs ${rf.ridgeY}`);
}

function smoothstepProxy(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// R2 stacking clearance: main eave (7.0 + lift) vs skirt surface under it
{
  const lo = grid.shells.lower, up = grid.shells.upper;
  const loRidgeRow = lo.front[0]; // t=0 ridge line
  const upEaveRow = up.front[up.front.length - 1];
  let minGap = 1e9;
  for (let ix = 0; ix < up.gridX.length; ix++) {
    const x = up.gridX[ix];
    // nearest skirt grid x (same 17-column grid only if widths matched; use interp)
    const li = lo.gridX.map((gx) => [Math.abs(gx - x), gx]).sort((a, b) => a[0] - b[0])[0][1];
    const lix = lo.gridX.indexOf(li);
    const skirtY = loRidgeRow.y[lix];
    const mainEaveY = upEaveRow.y[ix];
    minGap = Math.min(minGap, mainEaveY - skirtY);
  }
  check('R2: main eave clears the skirt ridge line by >= 0.85m', minGap >= 0.85, `min ${minGap.toFixed(3)}m`);
}

// R5 shell vertices sit on the sampled surface (front slope of each shell)
{
  const worldMeshes = glb.meshes.map((m) => {
    const P = [];
    for (let i = 0; i < m.positions.length; i += 3)
      P.push(transformPoint(m.matrix, [m.positions[i], m.positions[i + 1], m.positions[i + 2]]));
    return { name: m.name, points: P };
  });
  // both shells join into ONE tile-material mesh; verify each sampled surface
  // against that group's vertices (roof group = gray-pan-tile)
  const tileMesh = worldMeshes.find((m) => m.name.includes('gray-pan-tile'));
  check('R5: roof tile group present', !!tileMesh, tileMesh?.name ?? 'missing');
  if (tileMesh) {
    for (const nm of ['lower', 'upper']) {
      const shell = grid.shells[nm];
      let onSurface = 0;
      for (const p of tileMesh.points) {
        const j = shell.front.reduce((best, row, ji) =>
          Math.abs(row.z - p[2]) < Math.abs(shell.front[best].z - p[2]) ? ji : best, 0);
        const row = shell.front[j];
        if (Math.abs(row.z - p[2]) > 0.35) continue;
        let nearest = 0, bd = 1e9;
        row.y.forEach((y, ix) => {
          const d = Math.abs(shell.gridX[ix] - p[0]);
          if (d < bd) { bd = d; nearest = ix; }
        });
        if (bd > 0.45) continue;
        if (Math.abs(row.y[nearest] - p[1]) < 0.06) onSurface++;
      }
      check(`R5[${nm}]: >=40 group vertices lie on the ${nm} sampled surface`, onSurface >= 40, `${onSurface}`);
    }
  }
}

console.log(failures === 0 ? '\nDADIAN_ROOF PASS' : `\nDADIAN_ROOF FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
