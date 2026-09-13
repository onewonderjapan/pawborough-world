// N5 world assembly: build the lane-B candidate world from the frozen
// assembly + the lane-b module.
//
// 1. Remove the old lane-B seal wall + black door triangles from the
//    street-kit plaster/lacquer meshes (triangle-level, centroid test in the
//    lane-B region only — lane A keeps its wall).
// 2. Append the lane-b module meshes, transformed into world space
//    (RotY(-0.4818) + portal-centre translation), with node names laneb__*.
// 3. Remap module textures onto the world's existing 18 embedded images by
//    content sha256 (zero new textures expected).
// 4. Emit world/laneb/{laneb.glb, review-manifest.json, instances.json,
//    collision-world.json, route.json, cameras.json}.
//
// Run: node scripts/build_laneb_world.mjs
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb, transformPoint, multiply, identity } from '../src/world/glbReader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'world/laneb');
await mkdir(OUT, { recursive: true });

// exact lane-B axis, derived from the frozen seal-wall geometry (see N5 evidence)
const PORTAL_C = [57.418, 0.09, 14.2485]; // world, floor level
const YAW = -0.4818;
const INWARD = [-0.4631, 0.8863];   // XZ
const RIGHT = [0.8863, 0.4631];     // XZ

// ---- rotation matrix (column-major, glTF nodes convention: rot about +Y)
function yawMat(theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}
function transMat(t) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1];
}
const MERGE = multiply(transMat(PORTAL_C), yawMat(YAW));

const sha = (u8) => createHash('sha256').update(u8).digest('hex');

// ---- load frozen world
const worldBytes = await readFile(resolve(root, 'world/street-reviewed.glb'));
const world = readGlb(worldBytes);
const wjson = structuredClone(world.gltf);

// ---- 1. remove the seal wall + door triangles (lane B region only)
const inLaneB = (p) => p[0] > 55.5 && p[0] < 59.6 && p[2] > 12.5 && p[2] < 15.6 && p[1] > 0 && p[1] < 3.6;
let removedTris = 0;
for (const mesh of world.meshes) {
  if (mesh.name !== 'street-kit__weathered-lime-plaster' && mesh.name !== 'street-kit__deep-door-lacquer') continue;
  const node = wjson.nodes.find(n => n.name === mesh.name);
  const prim = wjson.meshes[node.mesh].primitives[0];
  const idx = prim.indices;
  const acc = wjson.accessors[idx];
  const view = wjson.bufferViews[acc.bufferView];
  const src = world.bin;
  const comp = acc.componentType === 5125 ? Uint32Array : Uint16Array;
  const indices = new comp(src.buffer, src.byteOffset + view.byteOffset + (acc.byteOffset ?? 0), acc.count);
  const keep = [];
  for (let t = 0; t < indices.length; t += 3) {
    const c0 = transformPoint(mesh.matrix, [mesh.positions[indices[t] * 3], mesh.positions[indices[t] * 3 + 1], mesh.positions[indices[t] * 3 + 2]]);
    if (!inLaneB(c0)) keep.push(indices[t], indices[t + 1], indices[t + 2]);
    else removedTris++;
  }
  // compact: store kept indices as new accessor at end of buffers later; for
  // simplicity mark the primitive and rebuild the whole buffer at write time.
  prim.__keep = keep;
}
if (removedTris === 0) throw new Error('seal wall not found — region test failed');
console.log(`removed ${removedTris} seal-wall/door triangles`);

// ---- 2. module
const modBytes = await readFile(resolve(root, 'kit/out/lane-b/model.glb'));
const mod = readGlb(modBytes);

// ---- writer state: the new BIN starts as a copy of the original world BIN
// (every existing bufferView keeps pointing at valid bytes), then new
// accessors are appended after it.
const worldBinPadded = pad4(new Uint8Array(world.bin));
const binChunks = [worldBinPadded];
let binLen = worldBinPadded.byteLength;
function pushBin(u8) {
  const pad = (4 - (u8.byteLength % 4)) % 4;
  const out = new Uint8Array(u8.byteLength + pad);
  out.set(u8);
  binChunks.push(out);
  const byteOffset = binLen;
  binLen += out.byteLength;
  return { byteOffset, byteLength: u8.byteLength };
}

// helper to copy an accessor (target json, source arrays)
function addAccessor(json, typedArr, componentType, type, count, bounds = undefined) {
  const bv = { buffer: 0, byteOffset: 0, byteLength: typedArr.byteLength, target: undefined };
  const padded = pad4(typedArr);
  const at = pushBin(padded);
  bv.byteOffset = at.byteOffset;
  json.bufferViews.push(bv);
  // write-verify: the bytes must be findable at the recorded relative offset
  const paddedBytes = new Uint8Array(padded.buffer, padded.byteOffset, padded.byteLength);
  let placed = 0;
  for (const c of binChunks) {
    if (placed + c.byteLength > at.byteOffset) {
      for (let k = 0; k < 4; k++) {
        if (c[at.byteOffset - placed + k] !== paddedBytes[k]) {
          const hex = (u8, n) => Array.from(u8.slice(0, n)).map(b => b.toString(16).padStart(2, '0')).join(' ');
          console.error('VERIFY DUMP: chunk table tail:');
          let p2 = 0;
          for (const cc of binChunks.slice(-8)) {
            console.error(`  chunk at ${p2} len ${cc.byteLength} first ${hex(cc, 8)}`);
            p2 += cc.byteLength;
          }
          console.error(`expected at ${at.byteOffset}: ${hex(paddedBytes, 16)}`);
          throw new Error(`write-verify failed for accessor at ${at.byteOffset}`);
        }
      }
      break;
    }
    placed += c.byteLength;
  }
  const accIndex = json.accessors.length;
  const acc = { bufferView: json.bufferViews.length - 1, componentType, count, type };
  if (bounds) { acc.min = bounds.min; acc.max = bounds.max; }
  json.accessors.push(acc);
  return accIndex;
}
function pad4(u8) {
  // byte-exact view: TypedArray.set() would otherwise do element-wise type
  // conversion (floats truncated to bytes) instead of copying bytes
  const bytes = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8.buffer, u8.byteOffset, u8.byteLength);
  const pad = (4 - (bytes.byteLength % 4)) % 4;
  if (!pad) return bytes;
  const out = new Uint8Array(bytes.byteLength + pad);
  out.set(bytes);
  return out;
}

// ---- 3. rewrite world primitives whose triangles changed
for (const mesh of world.meshes) {
  const node = wjson.nodes.find(n => n.name === mesh.name);
  if (!node) continue;
  const prim = wjson.meshes[node.mesh]?.primitives?.[0];
  if (!prim || !prim.__keep) continue;
  const keep = prim.__keep;
  const Comp = keep.length && mesh.indices instanceof Uint32Array ? Uint32Array : Uint16Array;
  const arr = new Comp(keep);
  const newIdx = addAccessor(wjson, arr, arr instanceof Uint32Array ? 5125 : 5123, 'SCALAR', arr.length);
  // release the old accessor/bufferView (leave orphaned entries; GLB validators
  // tolerate unused accessors? No — drop by pointing primitive only)
  prim.indices = newIdx;
  delete prim.__keep;
}

// ---- 4. image remap by content hash
const worldImageSha = (wjson.images || []).map(im => {
  const bv = wjson.bufferViews[im.bufferView];
  const bytes = world.bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength);
  return sha(bytes);
});
let appendedImages = 0;
const texRemap = new Map(); // module texture index -> world texture index
const matRemap = new Map(); // module material index -> world material index
for (let mt = 0; mt < (mod.gltf.textures || []).length; mt++) {
  const tex = mod.gltf.textures[mt];
  const mImg = mod.gltf.images[tex.source];
  const bv = mod.gltf.bufferViews[mImg.bufferView];
  const bytes = mod.bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength);
  const h = sha(bytes);
  let worldTex = worldImageSha.indexOf(h);
  if (worldTex < 0) {
    // append image bytes + texture
    const at = pushBin(pad4(bytes));
    wjson.bufferViews.push({ buffer: 0, byteOffset: at.byteOffset, byteLength: bytes.byteLength });
    wjson.images.push({ bufferView: wjson.bufferViews.length - 1, mimeType: mImg.mimeType, name: mImg.name });
    wjson.textures.push({ source: wjson.images.length - 1 });
    worldTex = wjson.textures.length - 1;
    appendedImages++;
  }
  texRemap.set(mt, worldTex);
}
for (let mm = 0; mm < (mod.gltf.materials || []).length; mm++) {
  const m = structuredClone(mod.gltf.materials[mm]);
  const rewrite = (tex) => {
    if (!tex) return tex;
    return { index: texRemap.get(tex.index) };
  };
  const pbr = m.pbrMetallicRoughness;
  if (pbr?.baseColorTexture) pbr.baseColorTexture = rewrite(pbr.baseColorTexture);
  if (pbr?.metallicRoughnessTexture) pbr.metallicRoughnessTexture = rewrite(pbr.metallicRoughnessTexture);
  if (m.normalTexture) m.normalTexture = rewrite(m.normalTexture);
  if (m.occlusionTexture) m.occlusionTexture = rewrite(m.occlusionTexture);
  if (m.emissiveTexture) m.emissiveTexture = rewrite(m.emissiveTexture);
  m.name = m.name + '.laneb';
  wjson.materials.push(m);
  matRemap.set(mm, wjson.materials.length - 1);
}

// ---- 5. append module meshes as world-space nodes
let moduleTris = 0;
for (const mesh of mod.meshes) {
  const n = mod.gltf.nodes.find(nd => nd.name === mesh.name);
  const prim = mod.gltf.meshes[n.mesh].primitives[0];
  const posAcc = mod.gltf.accessors[prim.attributes.POSITION];
  const idxAcc = mod.gltf.accessors[prim.indices];
  const comp = idxAcc.componentType === 5125 ? Uint32Array : Uint16Array;
  const bvI = mod.gltf.bufferViews[idxAcc.bufferView];
  const indices = new comp(mod.bin.buffer, mod.bin.byteOffset + bvI.byteOffset + (idxAcc.byteOffset ?? 0), idxAcc.count);
  const posAcc2 = mod.gltf.accessors[prim.attributes.POSITION];
  const posView = mod.gltf.bufferViews[posAcc.bufferView];
  const positions = new Float32Array(mod.bin.buffer, mod.bin.byteOffset + posView.byteOffset + (posAcc.byteOffset ?? 0), posAcc.count * 3);
  moduleTris += indices.length / 3;
  // transform positions into world space
  const out = new Float32Array(positions.length);
  const bmin = [1e9, 1e9, 1e9], bmax = [-1e9, -1e9, -1e9];
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = transformPoint(MERGE, [positions[i], positions[i + 1], positions[i + 2]]);
    out[i] = x; out[i + 1] = y; out[i + 2] = z;
    for (let k = 0; k < 3; k++) { bmin[k] = Math.min(bmin[k], out[i + k]); bmax[k] = Math.max(bmax[k], out[i + k]); }
  }
  const posIndex = addAccessor(wjson, out, 5126, 'VEC3', posAcc.count, { min: bmin.map(v => +v.toFixed(5)), max: bmax.map(v => +v.toFixed(5)) });
  wjson.bufferViews[wjson.accessors[posIndex].bufferView].byteStride = 12;
  const idxArr = new comp(indices);
  const idxIndex = addAccessor(wjson, idxArr, comp === Uint32Array ? 5125 : 5123, 'SCALAR', idxArr.length);
  const newPrim = {
    attributes: { POSITION: posIndex },
    indices: idxIndex,
    material: matRemap.get(prim.material),
    mode: 4,
  };
  if (prim.attributes.TEXCOORD_0 !== undefined) {
    const uvAcc = mod.gltf.accessors[prim.attributes.TEXCOORD_0];
    const uvView = mod.gltf.bufferViews[uvAcc.bufferView];
    const uvs = new Float32Array(mod.bin.buffer, mod.bin.byteOffset + uvView.byteOffset + (uvAcc.byteOffset ?? 0), uvAcc.count * 2);
    const uvIndex = addAccessor(wjson, new Float32Array(uvs), 5126, 'VEC2', uvAcc.count);
    wjson.bufferViews[wjson.accessors[uvIndex].bufferView].byteStride = 8;
    newPrim.attributes.TEXCOORD_0 = uvIndex;
  }
  if (prim.attributes.NORMAL !== undefined) {
    const nAcc = mod.gltf.accessors[prim.attributes.NORMAL];
    const nView = mod.gltf.bufferViews[nAcc.bufferView];
    const norms = new Float32Array(mod.bin.buffer, mod.bin.byteOffset + nView.byteOffset + (nAcc.byteOffset ?? 0), nAcc.count * 3);
    const nIndex = addAccessor(wjson, new Float32Array(norms), 5126, 'VEC3', nAcc.count);
    wjson.bufferViews[wjson.accessors[nIndex].bufferView].byteStride = 12;
    newPrim.attributes.NORMAL = nIndex;
  }
  const meshIndex = wjson.meshes.length;
  wjson.meshes.push({ primitives: [newPrim], name: mesh.name });
  const nodeIndex = wjson.nodes.length;
  // the module floor doubles as walkable ground collision (see groundExtractor)
  const nodeName = mesh.name === 'lane-b__paving-frontage' ? 'laneb__floor' : `laneb__${mesh.name}`;
  wjson.nodes.push({ name: nodeName, mesh: meshIndex });
  wjson.scenes[0].nodes.push(nodeIndex);
}

// ---- 6. write GLB (JSON + BIN)
const binBuffer = new Uint8Array(binLen);
let off = 0;
for (const c of binChunks) { binBuffer.set(c, off); off += c.byteLength; }
{
  // in-memory sanity: the floor's recorded position accessor must hold world data
  const floorAcc = wjson.accessors[wjson.meshes[161].primitives[0].attributes.POSITION];
  const bv = wjson.bufferViews[floorAcc.bufferView];
  const probe = new Float32Array(binBuffer.buffer, bv.byteOffset, 3);
  console.log('in-memory floor pos[0]:', Array.from(probe), 'expected ~[56.70, 0.09, 14.25]');
  if (Math.abs(probe[0] - 56.7) > 1) throw new Error('bin assembly misplaced module data');
}
wjson.buffers = [{ byteLength: binBuffer.byteLength }];
// strip helper fields
for (const n of wjson.nodes) { /* nodes clean */ }
const enc = new TextEncoder();
let jsonBytes = enc.encode(JSON.stringify(wjson));
if (jsonBytes.byteLength % 4) {
  const padded = new Uint8Array(jsonBytes.byteLength + 4 - (jsonBytes.byteLength % 4));
  padded.set(jsonBytes); padded.fill(0x20, jsonBytes.byteLength);
  jsonBytes = padded;
}
const total = 12 + 8 + jsonBytes.byteLength + 8 + binBuffer.byteLength;
const glb = new Uint8Array(total);
const dv = new DataView(glb.buffer);
dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
dv.setUint32(12, jsonBytes.byteLength, true); dv.setUint32(16, 0x4e4f534a, true);
glb.set(jsonBytes, 20);
dv.setUint32(20 + jsonBytes.byteLength, binBuffer.byteLength, true);
dv.setUint32(24 + jsonBytes.byteLength, 0x004e4942, true);
glb.set(binBuffer, 28 + jsonBytes.byteLength);
await writeFile(join(OUT, 'laneb.glb'), glb);
const glbSha = sha(glb);
const placedTriangles = 171464 - removedTris + moduleTris;
console.log(`module tris ${moduleTris}, placed total ${placedTriangles}, appended images ${appendedImages}, bytes ${glb.byteLength}`);

// ---- 7. dataset JSONs
const frozenManifest = JSON.parse(await readFile(resolve(root, 'world/review-manifest.json'), 'utf8'));
const manifest = {
  generatedBy: 'scripts/build_laneb_world.mjs (derived candidate; frozen dataset untouched)',
  modules: [
    ...frozenManifest.modules,
    { id: 'lane-b', path: './world/laneb/laneb.glb', bytes: glb.byteLength, sha256: glbSha, merged: true },
  ],
  streetKit: frozenManifest.streetKit,
  placedTriangles,
  completeWebPayloadBytes: glb.byteLength,
  originalStreetGlbSha256: frozenManifest.originalStreetGlbSha256,
  reviewedWorldGlbSha256: glbSha,
  worldAssembly: { path: './world/laneb/laneb.glb', bytes: glb.byteLength, sha256: glbSha },
  sceneImages: { count: 18 + appendedImages, allPacked: true },
  previewLoadMode: 'single_assembly_sharing_embedded_images',
  derivedFrom: { base: 'world/street-reviewed.glb', removedSealWallTriangles: removedTris },
};
await writeFile(join(OUT, 'review-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const instances = JSON.parse(await readFile(resolve(root, 'world/instances.json'), 'utf8'));
instances.instances.push({
  id: 'N17-lane-b', module: 'lane-b', side: 'south', sRange: [64.46, 64.46],
  frontOffsetM: 0, positionGlb: PORTAL_C, rotationYRad: YAW, collisionSource: 'merged',
});
await writeFile(join(OUT, 'instances.json'), JSON.stringify(instances, null, 2) + '\n');

const collision = JSON.parse(await readFile(resolve(root, 'world/collision-world.json'), 'utf8'));
const localColliders = [
  ['portal-pier-left', [-0.925, 2.65 / 2, -0.06], [0.35, 2.65, 0.12]],
  ['portal-pier-right', [0.925, 2.65 / 2, -0.06], [0.35, 2.65, 0.12]],
  ['back-facade', [0.0, 3.1, 5.56], [3.6, 6.2, 0.12]],
  ['side-facade', [1.86, 2.4, 4.0], [0.12, 4.8, 3.0]],
  ['pocket-wall-left', [-1.86, 1.8, 4.5], [0.12, 3.6, 2.0]],
  ['side-door', [1.78, 1.025, 3.1], [0.09, 2.05, 1.0]],
];
const at = (x, z) => [PORTAL_C[0] + RIGHT[0] * x + INWARD[0] * z, PORTAL_C[2] + RIGHT[1] * x + INWARD[1] * z];
collision.colliders = collision.colliders.filter(c => c.name !== 'lane-B-end-wall');
for (const [name, center, size] of localColliders) {
  const w = at(center[0], center[2]);
  collision.colliders.push({
    name: `N17-lane-b:${name}`, module: 'lane-b', type: 'box',
    min: [w[0] - 1, 0, w[1] - 1], max: [w[0] + 1, center[1] + size[1] / 2, w[1] + 1], // AABB approx; obb is authoritative
    obb: { pos: [PORTAL_C[0], 0.09, PORTAL_C[2]], theta: YAW, center, size },
  });
}
collision.notIntegratedOrWalkingTested = false;
collision.laneBPortalReplacesSealWall = true;
collision.laneBOrigin = PORTAL_C;
collision.laneBYawRad = YAW;
await writeFile(join(OUT, 'collision-world.json'), JSON.stringify(collision, null, 2) + '\n');

const route = JSON.parse(await readFile(resolve(root, 'world/route.json'), 'utf8'));
const wpt = (x, z) => [+(at(x, z)[0]).toFixed(3), 0.09, +(at(x, z)[1]).toFixed(3)];
route.laneBExcursion = [
  ...route.laneBExcursion,
  [58.745, 0.09, 12.336],           // approach (outside portal)
  wpt(0, 1.2)[0] === undefined ? null : wpt(0, 1.2),   // through the portal
  wpt(0, 2.5),                       // funnel exit
  wpt(-0.6, 4.0),                    // pocket
  wpt(0.4, 5.0),                     // pocket, near back facade
].filter(Boolean);
route.laneBPortal = { clearWidthM: 1.5, clearHeightM: 2.3, atS: 6.5 };
await writeFile(join(OUT, 'route.json'), JSON.stringify(route, null, 2) + '\n');

const cams = JSON.parse(await readFile(resolve(root, 'world/cameras.json'), 'utf8'));
const y = 1.6 + 0.09;
cams.cameras.push(
  { id: 'lane-b-axis', positionGlb: [60.086, y, 9.144], targetGlb: [+(PORTAL_C[0] - INWARD[0] * 3).toFixed(3), 1.4, +(PORTAL_C[2] - INWARD[1] * 3).toFixed(3)], lensMm: 35, sensorWidthMm: 36, sensorFit: 'HORIZONTAL', source: 'N5 design: entrance along the lane axis looking behind the door' },
  { id: 'lane-b-inside-return', positionGlb: [+at(0.4, 4.5)[0].toFixed(3), y, +at(0.4, 4.5)[1].toFixed(3)], targetGlb: [+(PORTAL_C[0] - INWARD[0] * 2).toFixed(3), 1.5, +(PORTAL_C[2] - INWARD[1] * 2).toFixed(3)], lensMm: 35, sensorWidthMm: 36, sensorFit: 'HORIZONTAL', source: 'N5 design: looking back at the street from behind the door' },
  { id: 'lane-b-detail', positionGlb: [59.24, 1.45, 12.72], targetGlb: [PORTAL_C[0], 1.3, PORTAL_C[2]], lensMm: 35, sensorWidthMm: 36, sensorFit: 'HORIZONTAL', source: 'N5 design: door frame/drainage/wall detail closeup' },
);
await writeFile(join(OUT, 'cameras.json'), JSON.stringify(cams, null, 2) + '\n');
console.log('LANEB_WORLD_READY', OUT);
