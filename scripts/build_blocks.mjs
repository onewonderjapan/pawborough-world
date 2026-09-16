// N6: derive the block dataset from the frozen map data (read-only input) and
// the reviewed instances' documented anchor (worldOriginMapSpace).
//
// No historical detail is invented for placeholders: each placeholder keeps
// the map's own id, point, angle, width/depth/height and placeholder status
// (historicalPositionVerified stays false). Shops whose footprint actually
// overlaps a reviewed storefront frontage (within OVERLAP_M via the anchor
// mapping) are marked replacedBy the reviewed street block so the two never
// stack; revoking the reviewed block restores them.
//
// Run: node scripts/build_blocks.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAP = '/home/baibai/outbox/pawborough-fangbang-map-1990s-20260912/workspace/public/map-data.json';

const instances = JSON.parse(await readFile(resolve(root, 'world/instances.json'), 'utf8'));
const map = JSON.parse(await readFile(MAP, 'utf8'));
const [AX, AZ] = instances.worldOriginMapSpace; // GLB origin in map space (documented anchor)

// GLB-space extent of the reviewed street (from route entries)
const route = JSON.parse(await readFile(resolve(root, 'world/route.json'), 'utf8'));
const streetX = route.mainStreet.map(p => p[0]);
const X0 = Math.min(...streetX), X1 = Math.max(...streetX);

// map -> glb (anchor translation only; map axis = GLB axis: X east, Z south)
const toGlb = (p) => [p[0] - AX, p[1] - AZ];

const OVERLAP_M = 9; // reviewed frontage half-width + margin
const replacedIds = new Set();
const placeholders = [];
for (const s of map.shops) {
  const [gx, gz] = toGlb(s.point);
  // overlap with any reviewed instance footprint centre (frontage midpoint)
  let replacedBy = null;
  for (const i of instances.instances) {
    const d = Math.hypot(i.positionGlb[0] - gx, i.positionGlb[2] - gz);
    if (d < OVERLAP_M) { replacedBy = 'block-review-street'; replacedIds.add(s.id); break; }
  }
  // adjacency: east or west of the street ends (placeholder background districts)
  const adjEast = gx > X1 + 4 && gx < X1 + 140;
  const adjWest = gx < X0 - 4 && gx > X0 - 140;
  const inStreetBand = gx >= X0 - 4 && gx <= X1 + 4 && Math.abs(gz) < 70;
  let block = null;
  if (replacedBy || inStreetBand) block = 'block-adjacent-east'; // band shops live with the street; culled while replaced
  if (adjEast) block = 'block-adjacent-east';
  if (adjWest) block = 'block-adjacent-west';
  if (!block) continue;
  placeholders.push({
    id: s.id,
    baseId: s.id,
    replacedBy: replacedBy ?? null,
    mapPoint: s.point,
    glbPoint: [+gx.toFixed(3), +gz.toFixed(3)],
    angleRad: s.angle,
    widthM: s.width,
    depthM: s.depth,
    heightM: s.height,
    category: s.category,
    historicalPositionVerified: s.historicalPositionVerified === true,
    source: 'pawborough-fangbang-map-1990s (placeholder, low-poly extrusion only)',
  });
}

const dataset = {
  generatedBy: 'scripts/build_blocks.mjs',
  mapSource: MAP,
  mapSha256Note: 'input read-only; see artifacts/N6 for hashes',
  anchor: { worldOriginMapSpace: [AX, AZ], kind: 'documented approximate anchor from world/instances.json; per-shop residuals up to ~17m are a map-data property (historicalPositionVerified=false), not calibrated' },
  axis: 'GLB Y-up X east Z south; map local equirectangular meters X east Z south',
  streetExtentX: [X0, X1],
  blocks: [
    {
      id: 'block-review-street',
      kind: 'reviewed',
      replacesBaseIds: [...replacedIds].sort(),
      persistent: false,
    },
    { id: 'block-adjacent-east', kind: 'placeholders' },
    { id: 'block-adjacent-west', kind: 'placeholders' },
  ],
};
// assign placeholder ids per block (explicit)
dataset.blocks[1].placeholderIds = placeholders.filter(p => p.glbPoint[0] > X1 - 4).map(p => p.id);
dataset.blocks[2].placeholderIds = placeholders.filter(p => p.glbPoint[0] < X0 + 4).map(p => p.id);

await mkdir(resolve(root, 'world'), { recursive: true });
await writeFile(resolve(root, 'world/blocks.json'), JSON.stringify({ ...dataset, placeholders }, null, 2) + '\n');
console.log(`BLOCKS_READY placeholders=${placeholders.length} replaced=${replacedIds.size} ` +
  `east=${dataset.blocks[1].placeholderIds.length} west=${dataset.blocks[2].placeholderIds.length}`);
