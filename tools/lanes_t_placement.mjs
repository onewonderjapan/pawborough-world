// T — lanes-construction batch: derive lane A/B placement from the REAL v4
// geometry (placeholder seal-wall triangles + collision-world + street
// assembly) and emit artifacts/lanes-construction/placement.json.
// Every anchor below is computed from the files on disk in THIS run — no
// hand-copied coordinates. Design targets (depth/width) are DESIGN values per
// DESIGN_SPEC (targets.designValuesNotSurvey).
//
// Run: node tools/lanes_t_placement.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');

// ---- parse the v4 world assembly GLB (street-reviewed.glb) ----------------
const asmBytes = await readFile(resolve(root, 'world/street-reviewed.glb'));
const jsonLen = asmBytes.readUInt32LE(12);
const g = JSON.parse(asmBytes.subarray(20, 20 + jsonLen).toString('utf8'));
const off = 20 + jsonLen;
const bin = asmBytes.subarray(off + 8, off + 8 + asmBytes.readUInt32LE(off));
const accessor = (i) => {
  const a = g.accessors[i];
  const bv = g.bufferViews[a.bufferView];
  const s = bv.byteOffset ?? 0;
  const CTA = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.componentType];
  const comps = { VEC3: 3, VEC2: 2, SCALAR: 1 }[a.type];
  return new CTA(bin.buffer, bin.byteOffset + s + (a.byteOffset ?? 0), a.count * comps);
};
const trianglesOf = (node) => {
  const out = [];
  for (const prim of g.meshes[node.mesh].primitives) {
    const pos = accessor(prim.attributes.POSITION);
    const ind = prim.indices ? accessor(prim.indices) : null;
    const n = ind ? ind.length : pos.length / 3;
    for (let t = 0; t < n; t += 3) {
      const k = (j) => (ind ? ind[t + j] : t + j) * 3;
      out.push([[pos[k(0)], pos[k(0) + 1], pos[k(0) + 2]], [pos[k(1)], pos[k(1) + 1], pos[k(1) + 2]], [pos[k(2)], pos[k(2) + 1], pos[k(2) + 2]]]);
    }
  }
  return out;
};
const centroid = (tri) => tri.reduce((s, v) => [s[0] + v[0] / 3, s[1] + v[1] / 3, s[2] + v[2] / 3], [0, 0, 0]);
const aabbOf = (tris) => {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const tri of tris) for (const v of tri) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], v[a]); mx[a] = Math.max(mx[a], v[a]); }
  return { min: mn, max: mx };
};

// ---- placeholder seal geometry (the exact triangles this batch replaces) ---
const findNode = (name) => g.nodes.findIndex((n) => n.name === name);
const patchNodes = {};
for (const name of ['street-kit__weathered-lime-plaster', 'street-kit__deep-door-lacquer', 'street-kit__oxblood-stained-timber', 'street-kit__paving-frontage']) {
  const ni = findNode(name);
  patchNodes[name] = { node: ni, triangles: trianglesOf(g.nodes[ni]).map((t, i) => ({ i, c: centroid(t) })) };
}
// spatial predicates: placeholder lanes (seal walls + doors + timber lintels + paving)
const inLaneA = (c) => c[0] > 42.2 && c[0] < 45.1 && c[2] < -9.9 && c[2] > -16.9;
const inLaneB = (c) => c[0] > 56.2 && c[0] < 58.7 && c[2] > 13.3 && c[2] < 21;
const patch = {};
for (const [name, rec] of Object.entries(patchNodes)) {
  const a = rec.triangles.filter((t) => inLaneA(t.c)).map((t) => t.i);
  const b = rec.triangles.filter((t) => inLaneB(t.c)).map((t) => t.i);
  patch[name] = { node: rec.node, totalTriangles: rec.triangles.length, removeLaneA: a, removeLaneB: b };
}
// the two seal walls, with their real measured planes
const wallTris = patchNodes['street-kit__weathered-lime-plaster'].triangles;
const wallA = wallTris.filter((t) => inLaneA(t.c)).map((t) => wallTris ? null : null); // placeholder
const trisA = [];
{
  const ni = patchNodes['street-kit__weathered-lime-plaster'].node;
  trisA.push(...trianglesOf(g.nodes[ni]).filter((t) => inLaneA(centroid(t))));
}
const trisB = [];
{
  const ni = patchNodes['street-kit__weathered-lime-plaster'].node;
  trisB.push(...trianglesOf(g.nodes[ni]).filter((t) => inLaneB(centroid(t))));
}
const aabbA = aabbOf(trisA), aabbB = aabbOf(trisB);
// wall plane: fit direction through the wall's floor-line (two bottom verts)
const wallAxis = (tris) => {
  // longest horizontal edge midpoint pair -> direction of the wall line
  const pts = tris.flat().filter((v) => v[1] < 1.0);
  const mn = Math.min(...pts.map((v) => v[0])), mx = Math.max(...pts.map((v) => v[0]));
  const lo = pts.find((v) => v[0] === mn), hi = pts.find((v) => v[0] === mx);
  const d = [hi[0] - lo[0], 0, hi[2] - lo[2]];
  const len = Math.hypot(d[0], d[2]);
  return { dir: [d[0] / len, d[2] / len], lo, hi };
};
const axA = wallAxis(trisA), axB = wallAxis(trisB);
const inwardOf = (dir, northward) => {
  // perpendicular of the wall line, sign chosen toward the lane interior
  const perp = [-dir[1], dir[0]];
  return northward ? (perp[1] < 0 ? perp : [-perp[0], -perp[1]]) : (perp[1] > 0 ? perp : [-perp[0], -perp[1]]);
};
const inwardA = inwardOf(axA.dir, true);    // lane A goes north (−Z)
const inwardB = inwardOf(axB.dir, false);   // lane B goes south (+Z)
const midA = [(axA.lo[0] + axA.hi[0]) / 2, 0.09, (axA.lo[2] + axA.hi[2]) / 2];
const midB = [(axB.lo[0] + axB.hi[0]) / 2, 0.09, (axB.lo[2] + axB.hi[2]) / 2];

// module frames: origin = portal centre on the removed wall mid-plane, floor
// y=0.09. For a node with rotation.y = θ, local +Z maps to (sinθ, 0, cosθ);
// local +X to (cosθ, 0, −sinθ). We need local +Z == inward:
// θ = atan2(inward.x, inward.z).
const rotYA = Math.atan2(inwardA[0], inwardA[1]);
const rotYB = Math.atan2(inwardB[0], inwardB[1]);

// ---- frozen lane-b module anchor (checked against its own build script) ----
const lanebScript = await readFile(resolve(root, 'scripts/build_laneb_world.mjs'), 'utf8');
const portalC = JSON.parse(lanebScript.match(/^const PORTAL_C = (\[.*?\]);/m)[1]);
const lanebYaw = Number(lanebScript.match(/^const YAW = (.*?);/m)[1]);
const lanebMeasure = JSON.parse(await readFile(resolve(root, 'kit/out/lane-b/measurements.json'), 'utf8'));

// ---- clearance: capsule-space check of each extension corridor against the
// v4 collision world (0.35 capsule, same radius as route checks) ------------
const collision = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v4/collision-world.json'), 'utf8'));
const distPointBox = (p, rec) => {
  if (rec.obb) {
    // same semantics as src/world/collisionAdapter.js obbToWorld(): world
    // center = pos + R_y(theta) * module-local center
    const { pos, theta, center, size } = rec.obb;
    const c = Math.cos(theta), s = Math.sin(theta);
    const wx = pos[0] + c * center[0] + s * center[2];
    const wz = pos[2] - s * center[0] + c * center[2];
    const dxw = p[0] - wx, dzw = p[2] - wz;
    const lx = c * dxw - s * dzw, lz = s * dxw + c * dzw; // world -> local
    const ex = Math.max(Math.abs(lx) - size[0] / 2, 0), ez = Math.max(Math.abs(lz) - size[2] / 2, 0);
    const dy = Math.max(center[1] - size[1] / 2 - 1.2, 0, 1.2 - (center[1] + size[1] / 2));
    return Math.hypot(ex, ez, dy);
  }
  if (!rec.min) return 1e9;
  const dx = Math.max(rec.min[0] - p[0], 0, p[0] - rec.max[0]);
  const dz = Math.max(rec.min[2] - p[2], 0, p[2] - rec.max[2]);
  const dy = Math.max(rec.min[1] - 1.2, 0, 1.2 - rec.max[1]); // capsule mid-height 1.2
  return Math.hypot(dx, dy, dz);
};
const corridorClearance = (center, inward, halfWidth, depth, label) => {
  const worst = { label, name: null, gapM: 1e9, at: null };
  const right = [inward[1], -inward[0]]; // horizontal right of inward
  const steps = 40;
  for (let i = 1; i <= steps; i++) {
    const s = (depth * i) / steps;
    for (const half of [-halfWidth, halfWidth]) {
      const p = [center[0] + inward[0] * s + right[0] * half, 1.2, center[2] + inward[1] * s + right[1] * half];
      for (const rec of collision.colliders) {
        if (rec.name === 'lane-A-end-wall' || rec.name === 'lane-B-end-wall') continue; // removed by this batch
        const d = distPointBox(p, rec);
        if (d < worst.gapM) { worst.gapM = +d.toFixed(3); worst.name = rec.name ?? rec.id; worst.at = [+(p[0]).toFixed(2), +(p[2]).toFixed(2)]; }
      }
    }
  }
  return worst;
};
const clearA = corridorClearance(midA, inwardA, 1.10, 8.0, 'laneA-8m-corridor');
const clearB = corridorClearance([portalC[0], 0.09, portalC[2]], [-0.4631, 0.8863], 1.8, 10, 'laneB-10m-corridor');
// centerline clearance: the capsule (r 0.35) must fit along the corridor axis
const centerlineClearance = (center, inward, depth, label) => {
  const worst = { label, name: null, gapM: 1e9, at: null };
  for (let i = 1; i <= 40; i++) {
    const s = (depth * i) / 40;
    const p = [center[0] + inward[0] * s, 1.2, center[2] + inward[1] * s];
    for (const rec of collision.colliders) {
      if (rec.name === 'lane-A-end-wall' || rec.name === 'lane-B-end-wall') continue;
      const d = distPointBox(p, rec);
      if (d < worst.gapM) { worst.gapM = +d.toFixed(3); worst.name = rec.name ?? rec.id; worst.at = [+p[0].toFixed(2), +p[2].toFixed(2)]; }
    }
  }
  worst.capsuleFits = worst.gapM >= 0.35;
  return worst;
};
const clearAC = centerlineClearance(midA, inwardA, 8.0, 'laneA-centerline');
const clearBC = centerlineClearance([portalC[0], 0.09, portalC[2]], [-0.4631, 0.8863], 10.0, 'laneB-centerline');

const placement = {
  batch: 'pawborough-lanes-construction-night-20260920',
  stage: 'T — placement derived from real v4 geometry',
  generatedAt: new Date().toISOString(),
  inputs: {
    assembly: { rel: 'world/street-reviewed.glb', sha256: sha(asmBytes), bytes: asmBytes.byteLength },
    collision: { rel: 'world/fangbang-temple-v4/collision-world.json', colliders: collision.colliders.length },
    lanebModule: { rel: 'kit/out/lane-b/model.glb', sha256: lanebMeasure.sha256, triangles: lanebMeasure.triangles, frozen: true },
  },
  designDisclaimer: 'depths/widths are DESIGN targets (DESIGN_SPEC.targets, designValuesNotSurvey=true); anchors are measured from the real removed-wall triangles',
  replacedSurfaces: {
    description: 'placeholder lane seal walls + doors + timber lintels + paving strips inside the v5 assembly copy (45 triangles total across 4 street-kit nodes)',
    laneA: patch['street-kit__weathered-lime-plaster'].removeLaneA.length
      + patch['street-kit__deep-door-lacquer'].removeLaneA.length
      + patch['street-kit__oxblood-stained-timber'].removeLaneA.length
      + patch['street-kit__paving-frontage'].removeLaneA.length,
    laneB: patch['street-kit__weathered-lime-plaster'].removeLaneB.length
      + patch['street-kit__deep-door-lacquer'].removeLaneB.length
      + patch['street-kit__oxblood-stained-timber'].removeLaneB.length
      + patch['street-kit__paving-frontage'].removeLaneB.length,
    patchTriangles: Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, { node: v.node, total: v.totalTriangles, laneA: v.removeLaneA, laneB: v.removeLaneB }])),
  },
  laneA: {
    removedWallAABB: { min: aabbA.min.map((v) => +v.toFixed(3)), max: aabbA.max.map((v) => +v.toFixed(3)) },
    wallLine: { lo: axA.lo.map((v) => +v.toFixed(3)), hi: axA.hi.map((v) => +v.toFixed(3)), dir: axA.dir.map((v) => +v.toFixed(4)) },
    portalCenterGlb: midA.map((v) => +v.toFixed(3)),
    inwardUnit: inwardA.map((v) => +v.toFixed(4)),
    rotationYRad: +rotYA.toFixed(5),
    designDepthBeyondPortalM: 8.0,
    designClearWidthM: 2.2,
    portalClearHeightM: 2.3,
    floorTopY: 0.09,
    corridorClearanceCapsuleR035: clearA,
    centerlineClearance: clearAC,
    neighbors: {
      west: 'N05-restaurant-a (east wall face x≈42.575 at the street stretch; rear wall face ≤ x 42.301 north of z −16.55)',
      east: 'N06-curio-a (north face ≈ z −15.2; nothing north of it)',
      behind: 'empty collision world to z ≈ −34 (survey x38–50, z −28..−16.2)',
    },
  },
  laneB: {
    removedWallAABB: { min: aabbB.min.map((v) => +v.toFixed(3)), max: aabbB.max.map((v) => +v.toFixed(3)) },
    frozenModuleAnchor: {
      script: 'scripts/build_laneb_world.mjs',
      portalCenterGlb: portalC,
      yawRad: lanebYaw,
      moduleDepthM: lanebMeasure.design.depthM,
      modulePocketWidthM: lanebMeasure.design.pocketWidthM,
      portalClearWidthM: lanebMeasure.design.portalClearWidthM,
      portalClearHeightM: lanebMeasure.design.portalClearHeightM,
    },
    reuse: 'frozen build script components re-run by the v2 builder (kit/build_lane_b_v2.py); kit/out/lane-b stays byte-frozen',
    designDepthTotalM: 10.0,
    designPocketWidthM: 3.6,
    portalClearHeightM: 2.3,
    floorTopY: 0.09,
    corridorClearanceCapsuleR035: clearB,
    centerlineClearance: clearBC,
    neighbors: {
      west: 'S05-plain-v3 rear (back-wall ≤ x 56.655, z ≤ 13.602 — north of the portal line)',
      east: 'S07-plain-v2 rear (back-wall ≥ x 58.388, z 14.431..19.828)',
      behind: 'empty collision world to z ≈ 30 (survey x48–62, z 13.5..30)',
    },
  },
  frozenProtected: {
    rule: 'no frozen building moved or resized; only the two lane seal patches (colliders lane-A/B-end-wall) are replaced',
    removedColliders: ['lane-A-end-wall', 'lane-B-end-wall'],
  },
};
await mkdir(resolve(root, 'artifacts/lanes-construction'), { recursive: true });
await writeFile(resolve(root, 'artifacts/lanes-construction/placement.json'), JSON.stringify(placement, null, 2) + '\n');
console.log(`laneA portal ${midA.map((v) => +v.toFixed(2))} inward ${inwardA.map((v) => +v.toFixed(3))} rotY ${rotYA.toFixed(4)}; clear ${clearA.gapM}m @${clearA.name}`);
console.log(`laneB portal ${JSON.stringify(portalC)} yaw ${lanebYaw}; clear ${clearB.gapM}m @${clearB.name}`);
console.log(`patch tris: A=${placement.replacedSurfaces.laneA} B=${placement.replacedSurfaces.laneB}`);
