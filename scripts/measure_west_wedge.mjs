// Measure the WEST wedge end of the verified frozen road, for the
// fangbang-temple west extension. Same method as the S3 batch used for the
// EAST wedge end (kit/build_street_completion_surface.py ROAD_END comment:
// "measured from street-kit__quiet-gray-asphalt"): read
// world/street-reviewed.glb, collect the world-space vertices of every
// primitive of the street-kit__quiet-gray-asphalt node(s), and report the
// min-x end — its two corner points, the cut width and the cut midpoint.
//
// Run: node scripts/measure_west_wedge.mjs
// Out: kit/out/fangbang-temple/west-wedge.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb, transformPoint } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GLB = resolve(root, 'world/street-reviewed.glb');
const OUT = resolve(root, 'kit/out/fangbang-temple/west-wedge.json');
const NODE = 'street-kit__quiet-gray-asphalt';

const data = await readFile(GLB);
const { meshes } = readGlb(data);
const road = meshes.filter((m) => m.name === NODE);
if (!road.length) throw new Error(`measure_west_wedge: node ${NODE} not found (nodes: ${[...new Set(meshes.map(m => m.name))].join(', ')})`);

// world-space vertices of all road primitives
const pts = [];
for (const m of road) for (let i = 0; i < m.positions.length; i += 3) {
  const [x, y, z] = transformPoint(m.matrix, [m.positions[i], m.positions[i + 1], m.positions[i + 2]]);
  pts.push([x, y, z]);
}
// The west end is a diagonal cut: the road's north edge (z<0) and south edge
// (z>0) each start at their own westernmost vertex, with a tessellated
// sawtooth between (measured 2026-09-16: north (-3.274,-3.368), south
// (-0.508,4.669), cut width 8.50m). Corner = min-x vertex per edge side.
const cornerOf = (side) => {
  const half = pts.filter(p => side * p[2] > 0.5);
  if (!half.length) throw new Error(`measure_west_wedge: no road vertices with ${side > 0 ? 'z>0.5' : 'z<-0.5'}`);
  return half.reduce((a, b) => (b[0] < a[0] ? b : a));
};
const cA = cornerOf(-1);   // north edge (GLB north = -Z)
const cB = cornerOf(+1);   // south edge
const width = Math.hypot(cB[0] - cA[0], cB[2] - cA[2]);
const mid = [(cA[0] + cB[0]) / 2, (cA[1] + cB[1]) / 2, (cA[2] + cB[2]) / 2];

const out = {
  schemaVersion: 1,
  generatedBy: 'scripts/measure_west_wedge.mjs',
  source: { glb: 'world/street-reviewed.glb', node: NODE, method: 'S3 east-wedge method (min/max extreme vertices of the min-x cut), batch fangbang-temple-bridge-night-20260916' },
  verticesSampled: pts.length,
  westEnd: {
    minX: +Math.min(cA[0], cB[0]).toFixed(4),
    cornerLowZ: [+cA[0].toFixed(4), +cA[1].toFixed(4), +cA[2].toFixed(4)],
    cornerHighZ: [+cB[0].toFixed(4), +cB[1].toFixed(4), +cB[2].toFixed(4)],
    cutWidthM: +width.toFixed(4),
    midpoint: [+mid[0].toFixed(4), +mid[1].toFixed(4), +mid[2].toFixed(4)],
    cutTangentXZ: [+(cB[0] - cA[0]).toFixed(4), +(cB[2] - cA[2]).toFixed(4)],
  },
};
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out, null, 2) + '\n');
console.log('WEST_WEDGE_READY', JSON.stringify(out.westEnd));
