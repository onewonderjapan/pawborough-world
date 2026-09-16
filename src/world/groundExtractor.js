// Ground collider extraction — production code shared by browser and tests.
// Input: array of { name, positions: Float32Array, indices: Uint16/32Array,
// matrix: number[16] } — i.e. whatever geometry source was loaded.
// Output: { positions: Float32Array, indices: Uint32Array } triangle soup in
// world space for the Rapier ground trimesh. Only the lead-verified road /
// paving / worn-stone faces qualify (GROUND_NODE_RE); nothing else, and no
// synthetic plane is ever added.

import { GROUND_NODE_RE } from './collisionAdapter.js';

// column-major 4x4 point transform (same math as glbReader.transformPoint)
function applyMatrix(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

export function collectGroundTriangles(meshes) {
  const posChunks = [];
  const idxChunks = [];
  let vertexBase = 0;
  let usedMeshes = 0;
  for (const mesh of meshes) {
    if (!GROUND_NODE_RE.test(mesh.name)) continue;
    const out = new Float32Array(mesh.positions.length);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const [x, y, z] = applyMatrix(mesh.matrix, mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]);
      out[i] = x; out[i + 1] = y; out[i + 2] = z;
    }
    posChunks.push(out);
    const idx = new Uint32Array(mesh.indices.length);
    for (let i = 0; i < mesh.indices.length; i++) idx[i] = mesh.indices[i] + vertexBase;
    idxChunks.push(idx);
    vertexBase += mesh.positions.length / 3;
    usedMeshes += 1;
  }
  if (usedMeshes === 0) throw new Error('ground extraction: no qualifying ground meshes found');
  const positions = concatFloat32(posChunks);
  const indices = concatUint32(idxChunks);
  return { positions, indices, usedMeshes, triangleCount: indices.length / 3 };
}

function concatFloat32(chunks) {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
function concatUint32(chunks) {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Uint32Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
