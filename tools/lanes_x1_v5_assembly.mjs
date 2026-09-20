// X1 — build the v5 dataset: surgically patched assembly copy + manifests,
// blocks, collision world, route and cameras for fangbang-temple-v5.
//
// The assembly surgery removes exactly the 45 placeholder lane triangles
// recorded in artifacts/lanes-construction/placement.json from a COPY of
// world/street-reviewed.glb (the v4 original stays byte-frozen). Nodes whose
// triangles are all removed leave the scene (their defs stay orphaned — valid
// glTF, never instantiated); the two partially-trimmed street-kit meshes keep
// their vertices and lose only the placeholder triangles (indices rebuilt
// into an appended patch buffer).
//
// Run: node tools/lanes_x1_v5_assembly.mjs
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const V5 = resolve(root, 'world/fangbang-temple-v5');
await mkdir(V5, { recursive: true });

const placement = JSON.parse(await readFile(resolve(root, 'artifacts/lanes-construction/placement.json'), 'utf8'));
const patch = placement.replacedSurfaces.patchTriangles;

// ---- parse the source assembly --------------------------------------------
const src = await readFile(resolve(root, 'world/street-reviewed.glb'));
const srcJsonLen = src.readUInt32LE(12);
const g = JSON.parse(src.subarray(20, 20 + srcJsonLen).toString('utf8'));
const srcOff = 20 + srcJsonLen;
const srcBin = src.subarray(srcOff + 8, srcOff + 8 + src.readUInt32LE(srcOff));
const COMP = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array };
const readIndices = (accIdx) => {
  const a = g.accessors[accIdx];
  const bv = g.bufferViews[a.bufferView];
  const s = bv.byteOffset ?? 0;
  return new COMP[a.componentType](srcBin.buffer, srcBin.byteOffset + s + (a.byteOffset ?? 0), a.count);
};

// scene roots (all meshes are top-level in this assembly)
const roots = new Set(g.scenes[0].nodes);

// ---- rebuild: two trimmed meshes + two emptied nodes -----------------------
const patchChunks = [];   // {data:Buffer} appended as buffer 1
const newViews = [];      // pushed into g.bufferViews
let removedTotal = 0;
const surgeryLog = [];
for (const nodeName of Object.keys(patch)) {
  const rec = patch[nodeName];
  const node = g.nodes[rec.node];
  const mesh = g.meshes[node.mesh];
  if (mesh.primitives.length !== 1) throw new Error(`${nodeName}: expected 1 primitive`);
  const prim = mesh.primitives[0];
  const accIdx = prim.indices;
  const oldIdx = readIndices(accIdx);
  const remove = new Set([...rec.laneA, ...rec.laneB]);
  if (remove.size === oldIdx.length / 3) {
    // node fully removed from the scene (defs stay, never instantiated)
    roots.delete(rec.node);
    removedTotal += remove.size;
    surgeryLog.push({ node: nodeName, removedTriangles: remove.size, disposition: 'node removed from scene roots (defs orphaned)' });
    continue;
  }
  const keep = [];
  for (let t = 0; t < oldIdx.length / 3; t++) if (!remove.has(t)) keep.push(t);
  const out = Buffer.alloc(keep.length * 3 * 4);
  const u32 = new Uint32Array(out.buffer);
  keep.forEach((t, i) => {
    u32[i * 3] = oldIdx[t * 3]; u32[i * 3 + 1] = oldIdx[t * 3 + 1]; u32[i * 3 + 2] = oldIdx[t * 3 + 2];
  });
  patchChunks.push(out);
  newViews.push({ buffer: 1, byteOffset: 0, byteLength: out.byteLength, target: 34963, _for: accIdx, _count: keep.length * 3 });
  removedTotal += remove.size;
  surgeryLog.push({ node: nodeName, removedTriangles: remove.size, keptTriangles: keep.length, disposition: 'indices rebuilt without placeholder triangles' });
}
g.scenes[0].nodes = g.scenes[0].nodes.filter((i) => roots.has(i));
if (removedTotal !== placement.replacedSurfaces.laneA + placement.replacedSurfaces.laneB)
  throw new Error(`surgery removed ${removedTotal} tris, placement.json says ${placement.replacedSurfaces.laneA + placement.replacedSurfaces.laneB}`);

// wire the new views/accessors: the patch bytes are APPENDED to the GLB's
// single binary chunk (buffer 0) — a second buffer without a URI is invalid
// inside a GLB container
const buffer0Len = g.buffers[0].byteLength;
let cursor = 0;
for (const v of newViews) {
  v.byteOffset = buffer0Len + cursor; cursor += v.byteLength;
  v.buffer = 0;
  const acc = g.accessors[v._for];
  acc.bufferView = g.bufferViews.length;
  acc.componentType = 5125;
  acc.count = v._count;
  delete v._for; delete v._count;
  g.bufferViews.push(v);
}
g.buffers[0].byteLength = buffer0Len + cursor;

// ---- serialize -------------------------------------------------------------

const jsonBlob = Buffer.from(JSON.stringify(g), 'utf8');
const jsonPad = (4 - (jsonBlob.byteLength % 4)) % 4;
const binBlob = Buffer.concat([Buffer.from(srcBin), ...patchChunks]);
const binPad = (4 - (binBlob.byteLength % 4)) % 4;
const total = 12 + 8 + jsonBlob.byteLength + jsonPad + 8 + binBlob.byteLength + binPad;
const out = Buffer.alloc(total);
out.write('glTF', 0, 'ascii');
out.writeUInt32LE(2, 4);
out.writeUInt32LE(total, 8);
out.writeUInt32LE(jsonBlob.byteLength + jsonPad, 12);
out.write('JSON', 16, 'ascii');
jsonBlob.copy(out, 20);
for (let i = 0; i < jsonPad; i++) out[20 + jsonBlob.byteLength + i] = 0x20;
const binHeader = 20 + jsonBlob.byteLength + jsonPad;
out.writeUInt32LE(binBlob.byteLength + binPad, binHeader);
out.write('BIN\0', binHeader + 4, 'ascii');
binBlob.copy(out, binHeader + 8);
const asmRel = 'world/fangbang-temple-v5/street-reviewed-lanes.glb';
await writeFile(resolve(root, asmRel), out);
const asmSha = sha(out);
console.log(`assembly: ${asmRel} ${(out.byteLength / 1e6).toFixed(1)}MB removed ${removedTotal} placeholder tris sha ${asmSha.slice(0, 12)}…`);

// ---- v5 dataset JSONs ------------------------------------------------------
const v4Manifest = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v4/review-manifest.json'), 'utf8'));
const v4Blocks = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v4/blocks.json'), 'utf8'));
const v4Collision = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v4/collision-world.json'), 'utf8'));
const v4Route = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v4/route.json'), 'utf8'));
const v4Cameras = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v4/cameras.json'), 'utf8'));

const laneMeasure = async (p) => JSON.parse(await readFile(resolve(root, p), 'utf8'));
const laneA = await laneMeasure('kit/out/lanes-v2/lane-a/measurements.json');
const laneB = await laneMeasure('kit/out/lanes-v2/lane-b-v2/measurements.json');
const ifaces = await laneMeasure('kit/out/lanes-v2/interfaces/measurements.json');
const glbSha = async (p) => sha(await readFile(resolve(root, p)));
const laneAGlb = 'world/lanes-v2/lane-a/model.glb';
const laneBGlb = 'world/lanes-v2/lane-b-v2/model.glb';
const ifGlb = 'world/lanes-v2/interfaces/model.glb';
await mkdir(resolve(root, 'world/lanes-v2/lane-a'), { recursive: true });
await mkdir(resolve(root, 'world/lanes-v2/lane-b-v2'), { recursive: true });
await mkdir(resolve(root, 'world/lanes-v2/interfaces'), { recursive: true });
await copyFile(resolve(root, 'kit/out/lanes-v2/lane-a/model.glb'), resolve(root, laneAGlb));
await copyFile(resolve(root, 'kit/out/lanes-v2/lane-b-v2/model.glb'), resolve(root, laneBGlb));
await copyFile(resolve(root, 'kit/out/lanes-v2/interfaces/model.glb'), resolve(root, ifGlb));
// WORLD-SPACE collision sidecars for the asset blocks (the kit/out sidecars
// stay in module-local builder format; this is the install transform)
const writeWorldSidecar = async (kitSidecarRel, outRel, portal, yaw, assetId) => {
  const side = JSON.parse(await readFile(resolve(root, kitSidecarRel), 'utf8'));
  const recs = side.colliders.map((r) => {
    const b = obbWorldBounds(portal, yaw, r.center, r.size);
    return { name: `${assetId}:${r.name}`, module: assetId, type: 'box',
      min: b.min.map((v) => +v.toFixed(4)), max: b.max.map((v) => +v.toFixed(4)),
      obb: { pos: portal, theta: yaw, center: r.center, size: r.size } };
  });
  await writeFile(resolve(root, outRel), JSON.stringify({
    axis: 'glTF Y-up; world-space obb records (obb.pos = asset portal origin), consumed by blockViews.makeAssets',
    assetId, origin: portal, yawRad: yaw, colliders: recs,
  }, null, 2) + '\n');
  return recs.length;
};

// module-local collision -> world-space records (same transform as render)
const rotate = (c, yaw) => [Math.cos(yaw) * c[0] + Math.sin(yaw) * c[2], 0, -Math.sin(yaw) * c[0] + Math.cos(yaw) * c[2]];
const worldColliders = (sidecarPath, portal, yaw, prefix) => (async () => {
  const side = JSON.parse(await readFile(resolve(root, sidecarPath), 'utf8'));
  return side.colliders.map((r) => {
    const wx = portal[0] + Math.cos(yaw) * r.center[0] + Math.sin(yaw) * r.center[2];
    const wz = portal[2] - Math.sin(yaw) * r.center[0] + Math.cos(yaw) * r.center[2];
    return {
      name: `${prefix}:${r.name}`, module: prefix, type: 'box',
      obb: { pos: [portal[0], portal[1] ?? 0, portal[2]], theta: yaw, center: [r.center[0], r.center[1], r.center[2]], size: r.size },
      min: null, max: null,
      _worldCenter: [wx, wz],
    };
  });
})();

// collision world: drop the two placeholder walls, add the three assets'
// world-space records (obb + AABB from the 4 rotated corners, like the v4
// composition rule "obb.pos' = T + R(yaw)*pos; theta' = theta + yaw")
const obbWorldBounds = (pos, theta, center, size) => {
  const c = Math.cos(theta), s = Math.sin(theta);
  const cx = pos[0] + c * center[0] + s * center[2];
  const cz = pos[2] - s * center[0] + c * center[2];
  const hx = size[0] / 2, hz = size[2] / 2;
  const xs = [], zs = [];
  for (const [dx, dz] of [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]) {
    xs.push(cx + c * dx + s * dz);
    zs.push(cz - s * dx + c * dz);
  }
  const y0 = (pos[1] ?? 0) + center[1] - size[1] / 2, y1 = (pos[1] ?? 0) + center[1] + size[1] / 2;
  return { min: [Math.min(...xs), y0, Math.min(...zs)], max: [Math.max(...xs), y1, Math.max(...zs)] };
};
const toWorldRecord = (r, portal, yaw, prefix) => { // (kept for reference; sidecars carry the records)
  const { center, size } = r;
  const bounds = obbWorldBounds(portal, yaw, center, size);
  return {
    name: `${prefix}:${r.name}`, module: prefix, type: 'box',
    min: bounds.min.map((v) => +v.toFixed(4)), max: bounds.max.map((v) => +v.toFixed(4)),
    obb: { pos: portal, theta: yaw, center, size },
  };
};
const newColliders = v4Collision.colliders.filter((r) => r.name !== 'lane-A-end-wall' && r.name !== 'lane-B-end-wall');
// the lanes-v2 wall colliders ride in the ASSET-BLOCK sidecars (world-space,
// revoked with the block); the dataset collision world only loses the two
// placeholder walls
const sidecarCounts = {
  laneA: await writeWorldSidecar('kit/out/lanes-v2/lane-a/collision.json', 'world/lanes-v2/lane-a/collision.json', [43.545, 0.09, -16.375], 3.1165, 'lane-a'),
  laneB: await writeWorldSidecar('kit/out/lanes-v2/lane-b-v2/collision.json', 'world/lanes-v2/lane-b-v2/collision.json', [57.418, 0.09, 14.2485], -0.4818, 'lane-b-v2'),
  interfaces: await writeWorldSidecar('kit/out/lanes-v2/interfaces/collision.json', 'world/lanes-v2/interfaces/collision.json', [0, 0, 0], 0, 'interfaces'),
};
const v5Collision = {
  ...v4Collision,
  dataset: 'fangbang-temple-v5',
  colliders: newColliders,
  composition: {
    ...v4Collision.composition,
    lanesNote: 'v5: removed placeholder lane-A/lane-B end walls; added world-space records for the three lanes-v2 assets (modules keep their local sidecars; interfaces sidecar is already world-space)',
  },
};
await writeFile(resolve(V5, 'collision-world.json'), JSON.stringify(v5Collision, null, 2) + '\n');

// ---- blocks -----------------------------------------------------------------
const lanesAssets = [
  { id: 'lane-a', glb: './world/lanes-v2/lane-a/model.glb', collision: './world/lanes-v2/lane-a/collision.json', positionGlb: [43.545, 0.09, -16.375], rotationYRad: 3.1165 },
  { id: 'lane-b-v2', glb: './world/lanes-v2/lane-b-v2/model.glb', collision: './world/lanes-v2/lane-b-v2/collision.json', positionGlb: [57.418, 0.09, 14.2485], rotationYRad: -0.4818 },
  { id: 'lanes-interfaces', glb: './world/lanes-v2/interfaces/model.glb', collision: './world/lanes-v2/interfaces/collision.json', positionGlb: [0, 0, 0], rotationYRad: 0 },
];
const v5Blocks = {
  ...v4Blocks,
  blocks: [
    ...v4Blocks.blocks,
    { id: 'block-lanes-v2', kind: 'assets', autoApply: true, assets: lanesAssets, persistent: false,
      note: 'lanes-construction-20260920 candidate: two refined lanes + street interfaces; revoke returns the v4 state minus the removed placeholder patches' },
  ],
};
await writeFile(resolve(V5, 'blocks.json'), JSON.stringify(v5Blocks, null, 2) + '\n');

// ---- manifest ----------------------------------------------------------------
const lanesV2ManifestAssets = [
  { id: 'lane-a', glb: './world/lanes-v2/lane-a/model.glb', bytes: null, sha256: await glbSha(laneAGlb), triangles: laneA.triangles },
  { id: 'lane-b-v2', glb: './world/lanes-v2/lane-b-v2/model.glb', bytes: null, sha256: await glbSha(laneBGlb), triangles: laneB.triangles },
  { id: 'lanes-interfaces', glb: './world/lanes-v2/interfaces/model.glb', bytes: null, sha256: await glbSha(ifGlb), triangles: ifaces.triangles },
];
for (const e of lanesV2ManifestAssets) {
  e.bytes = (await readFile(resolve(root, e.glb.replace('./', '')))).byteLength;
}
const v5Manifest = {
  ...v4Manifest,
  datasetId: 'fangbang-temple-v5',
  modules: [
    ...v4Manifest.modules,
    { id: 'lane-a', path: './world/lanes-v2/lane-a/model.glb', bytes: lanesV2ManifestAssets[0].bytes, sha256: lanesV2ManifestAssets[0].sha256, triangles: laneA.triangles },
    { id: 'lane-b-v2', path: './world/lanes-v2/lane-b-v2/model.glb', bytes: lanesV2ManifestAssets[1].bytes, sha256: lanesV2ManifestAssets[1].sha256, triangles: laneB.triangles },
    { id: 'interfaces', path: './world/lanes-v2/interfaces/model.glb', bytes: lanesV2ManifestAssets[2].bytes, sha256: lanesV2ManifestAssets[2].sha256, triangles: ifaces.triangles },
  ],
  title: '方浜↔庙宇桥接世界 v5 候选（两处支弄精修 + 两处弄口连接；ownerAdopted=false）',
  status: 'delivered_for_lead_review',
  ownerAdopted: false,
  visualReview: 'pending_lead',
  worldAssembly: { path: `./${asmRel}`, bytes: out.byteLength, sha256: asmSha },
  placedTriangles: v4Manifest.placedTriangles - removedTotal,
  lanesV2: {
    note: 'lanes-construction-20260920 candidate assets; the assembly copy removed the 45 placeholder lane triangles (see artifacts/lanes-construction/placement.json)',
    assets: lanesV2ManifestAssets,
    placedTriangles: lanesV2ManifestAssets.reduce((s2, a2) => s2 + a2.triangles, 0),
    assemblySurgery: surgeryLog,
    budgets: {
      laneA: laneA.triangles, laneB: laneB.triangles, interfaces: ifaces.triangles,
      totalAdded: laneA.triangles + laneB.triangles + ifaces.triangles,
      caps: { A: 30000, B: 30000, interfacesCombined: 20000, totalAddedMax: 80000 },
    },
  },
  triangleAccounting: {
    ...v4Manifest.triangleAccounting,
    bridgeWorldTris: v4Manifest.triangleAccounting.bridgeWorldTris,
    lanesV2: laneA.triangles + laneB.triangles + ifaces.triangles,
    note: 'fullScene accounting unchanged for adopted v4 content; lanes-v2 adds ' + (laneA.triangles + laneB.triangles + ifaces.triangles) + ' candidate tris on top',
  },
  generatedBy: 'tools/lanes_x1_v5_assembly.mjs (lanes-construction batch)',
};
await writeFile(resolve(V5, 'review-manifest.json'), JSON.stringify(v5Manifest, null, 2) + '\n');

// ---- route --------------------------------------------------------------------
const inwardA = [0.0251, -0.9997];
const laneAPts = (depths) => depths.map((d) => [+(43.545 + inwardA[0] * d).toFixed(3), 0, +(-16.375 + inwardA[1] * d).toFixed(3)]);
const bIn = [-0.4631, 0.8863];
const laneBPts = (depths) => depths.map((d) => [+(57.418 + bIn[0] * d).toFixed(3), 0, +(14.2485 + bIn[1] * d).toFixed(3)]);
const v5Route = {
  ...v4Route,
  dataset: 'fangbang-temple-v5',
  laneAExcursion: [[43.096, 0, -10.697], [43.238, 0, -12.491], [43.381, 0, -14.286], ...laneAPts([0.8, 2.6, 4.4, 6.2, 7.5])],
  laneBExcursion: [[60.086, 0, 9.144], [59.623, 0, 10.03], [59.252, 0, 10.739], [58.6, 0, 12.1], [57.9, 0, 13.4], ...laneBPts([0.8, 2.5, 4.0, 5.5, 7.0, 8.5, 9.4])],
  lanesLoopNote: 'street west -> lane A in/out -> street east -> lane B in/out -> temple axis (mainStreet composition, same physics chain)',
};
await writeFile(resolve(V5, 'route.json'), JSON.stringify(v5Route, null, 2) + '\n');

// ---- cameras -------------------------------------------------------------------
const y = 1.6;
// same field contract as the v4 cameras (positionGlb/targetGlb/verticalFovDegrees)
const laneCams = [
  { id: 'lane-a-street-look-in', positionGlb: [41.6, y, -8.6], targetGlb: [43.5, 1.3, -16.4], verticalFovDegrees: 55, labelZh: 'A弄·街口望入（窄门洞纵深）' },
  { id: 'lane-a-forward', positionGlb: [43.35, y, -11.4], targetGlb: [43.6, 1.3, -23.5], verticalFovDegrees: 55, labelZh: 'A弄·弄内向前（8m弄身）' },
  { id: 'lane-a-return', positionGlb: [43.7, y, -23.6], targetGlb: [43.2, 1.5, -11.5], verticalFovDegrees: 55, labelZh: 'A弄·尽端回望' },
  { id: 'lane-a-detail', positionGlb: [42.9, 1.5, -19.6], targetGlb: [44.4, 1.2, -21.4], verticalFovDegrees: 55, labelZh: 'A弄·门槛/排水近景' },
  { id: 'lane-b-street-look-in', positionGlb: [59.4, y, 11.6], targetGlb: [57.4, 1.3, 15.2], verticalFovDegrees: 55, labelZh: 'B弄·街口望入' },
  { id: 'lane-b-forward', positionGlb: [57.7, y, 13.6], targetGlb: [54.5, 1.3, 22.0], verticalFovDegrees: 55, labelZh: 'B弄·弄内向前（渐宽口袋）' },
  { id: 'lane-b-return', positionGlb: [53.6, y, 22.3], targetGlb: [57.6, 1.5, 13.5], verticalFovDegrees: 55, labelZh: 'B弄·弄内回望主街' },
  { id: 'lane-b-detail', positionGlb: [56.4, 1.5, 15.9], targetGlb: [57.5, 1.0, 14.4], verticalFovDegrees: 55, labelZh: 'B弄·门槛/排水近景' },
];
const v5Cameras = { ...v4Cameras, dataset: 'fangbang-temple-v5', cameras: [...(v4Cameras.cameras ?? []), ...laneCams] };
await writeFile(resolve(V5, 'cameras.json'), JSON.stringify(v5Cameras, null, 2) + '\n');

// ---- instances.json: v4 content + the three lanes-v2 placements --------------
const v4Instances = JSON.parse(await readFile(resolve(root, 'world/fangbang-temple-v4/instances.json'), 'utf8'));
const v5Instances = {
  ...v4Instances,
  dataset: 'fangbang-temple-v5',
  instances: [
    ...v4Instances.instances,
    { id: 'lane-a', module: 'lane-a', positionGlb: [43.545, 0.09, -16.375], rotationYRad: 3.1165 },
    { id: 'lane-b-v2', module: 'lane-b-v2', positionGlb: [57.418, 0.09, 14.2485], rotationYRad: -0.4818 },
    { id: 'interfaces', module: 'interfaces', positionGlb: [0, 0, 0], rotationYRad: 0 },
  ],
};
await writeFile(resolve(V5, 'instances.json'), JSON.stringify(v5Instances, null, 2) + '\n');

console.log(`v5 dataset: ${v5Collision.colliders.length} dataset colliders (2 placeholder walls removed) + sidecar records ${JSON.stringify(sidecarCounts)}, route laneA ${v5Route.laneAExcursion.length}pts laneB ${v5Route.laneBExcursion.length}pts, cameras +${laneCams.length}`);
console.log('V5_DATASET_OK');
